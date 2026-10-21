import * as THREE from 'three';

// Pedestrian footbridges over the two-lane roads (assets/footbridge-v1.fbx).
// The source model spans its local X with a stair tower at each end (inner
// edge |x| = 600, outer edge |x| ≈ 990, height 424.5, units ≈ cm). It is baked
// once into scene units:
//   • stair towers keep their proportions and fill the sidewalk band
//     (|x| from TOWER_IN to TOWER_OUT), the deck span is stretched to match;
//   • every vertex is lowered by d²/2R so both towers sit flat on the curved
//     planet sidewalk;
//   • glass is split into its own mesh so the opaque parts can carry an
//     outline shell without darkening the panes behind it.
export const FOOTBRIDGE_URL = './assets/footbridge-v1.fbx';
const SOURCE_TOWER_IN = 600, SOURCE_TOWER_OUT = 990;
const TOWER_IN = 20.2, TOWER_OUT = 32.4;     // sidewalk: curb ends at 19.4, grass curb starts at 33
const WALK = 602 + 2.6 / 3;
const FOOTPRINT_HALF_ALONG = 23;

// Light concrete / stone / silver rails / pale blue glass, as in the reference.
const PALETTE = {
  '双梯天桥_混凝土': { color: 0xc9ccc6 },
  '双梯天桥_踏面石材': { color: 0xbab6aa },
  '双梯天桥_踢面': { color: 0x8f938e },
  '双梯天桥_银灰扶手': { color: 0xc6d0d5 },
  '双梯天桥_蓝色玻璃': { color: 0x9fd0ee, glass: true },
};

function bakeTemplate(source) {
  source.updateMatrixWorld(true);
  let mesh = null;
  source.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error('Footbridge mesh not found');
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const zMid = (box.min.z + box.max.z) / 2;
  const kt = (TOWER_OUT - TOWER_IN) / (SOURCE_TOWER_OUT - SOURCE_TOWER_IN);
  const kd = TOWER_IN / SOURCE_TOWER_IN;
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), ax = Math.abs(x), deck = ax < SOURCE_TOWER_IN;
    const sx = deck ? kd : kt;
    const nx = deck ? x * kd : Math.sign(x) * (TOWER_IN + (ax - SOURCE_TOWER_IN) * kt);
    const nz = (p.getZ(i) - zMid) * kt;
    // Planet curvature: lower each point by d²/2R so the towers sit flat on the
    // sidewalk. The span between the towers is kept rigid (same drop as the
    // tower's inner edge): its deck beam only has vertices at the ends, so a
    // per-vertex drop would bend the railings away from the straight deck.
    const cx = Math.max(Math.abs(nx), TOWER_IN + .8);
    const ny = (p.getY(i) - box.min.y) * kt - (cx * cx + nz * nz) / (2 * WALK);
    p.setXYZ(i, nx, ny, nz);
    // Inverse-transpose of the per-section scale keeps lighting correct.
    const v = new THREE.Vector3(n.getX(i) / sx, n.getY(i) / kt, n.getZ(i) / kt).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  const names = [].concat(mesh.material).map(m => m.name);
  const split = glass => {
    const keep = geometry.groups.filter(g => !!PALETTE[names[g.materialIndex]]?.glass === glass);
    const out = new THREE.BufferGeometry();
    for (const [key, attr] of Object.entries(geometry.attributes)) {
      const size = attr.itemSize, data = [];
      const groups = [];
      for (const g of keep) {
        groups.push({ start: data.length / size, count: g.count, materialIndex: g.materialIndex });
        data.push(...attr.array.slice(g.start * size, (g.start + g.count) * size));
      }
      out.setAttribute(key, new THREE.Float32BufferAttribute(data, size));
      if (key === 'position') for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex);
    }
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  };
  return { opaque: split(false), glass: split(true), names };
}

// Walk data in bridge-local space (x across the road, y up, z along it), on a
// 0.3-unit grid. Triangles are sampled densely:
//   floor[c]  highest upward-facing concrete / tread surface (stairs, landings, deck)
//   wallLo/Hi vertical extent of everything else in the cell (rails, glass,
//             risers, stair side walls, pillars, deck edges)
// A walker steps onto any floor within STEP of its feet, and is stopped by wall
// geometry (or a floor too high to step on) between STEP and BODY above its feet.
const WALK_CELL = .3, STEP = 1.6, BODY = 5.4;
const WALKABLE = /混凝土|踏面/, RISER = /踢面/;
function buildWalkGrid(geometry, names) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const x0 = box.min.x - 1, z0 = box.min.z - 1;
  const w = Math.ceil((box.max.x + 1 - x0) / WALK_CELL), h = Math.ceil((box.max.z + 1 - z0) / WALK_CELL);
  const floor = new Float32Array(w * h).fill(-Infinity);
  const wallLo = new Float32Array(w * h).fill(Infinity), wallHi = new Float32Array(w * h).fill(-Infinity);
  const p = geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3();
  for (const group of geometry.groups) {
    const walkable = WALKABLE.test(names[group.materialIndex]);
    // Risers sit between treads; tread heights already decide what can be climbed.
    if (RISER.test(names[group.materialIndex])) continue;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      n.subVectors(b, a).cross(q.subVectors(c, a));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const isFloor = walkable && n.y > .7;
      if (walkable && n.y < -.7) continue;          // undersides never block or support
      const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (WALK_CELL * .5)));
      for (let u = 0; u <= steps; u++) for (let v = 0; u + v <= steps; v++) {
        q.copy(a).multiplyScalar(1 - (u + v) / steps).addScaledVector(b, u / steps).addScaledVector(c, v / steps);
        const ix = Math.floor((q.x - x0) / WALK_CELL), iz = Math.floor((q.z - z0) / WALK_CELL);
        if (ix < 0 || iz < 0 || ix >= w || iz >= h) continue;
        const k = iz * w + ix;
        if (isFloor) floor[k] = Math.max(floor[k], q.y);
        else { wallLo[k] = Math.min(wallLo[k], q.y); wallHi[k] = Math.max(wallHi[k], q.y); }
      }
    }
  }
  return { x0, z0, w, h, floor, wallLo, wallHi };
}

// World-space queries for the walking character over all bridges.
export function createFootbridgeWalk(bridges, center) {
  const items = bridges.map(({ mesh, grid }) => ({
    grid, mesh,
    inverse: mesh.matrixWorld.clone().invert(),
    origin: mesh.getWorldPosition(new THREE.Vector3()),
  }));
  const point = new THREE.Vector3(), local = new THREE.Vector3(), lift = new THREE.Vector3();
  // Local point under world direction `dir` at radius `r` from the planet centre.
  const toLocal = (item, dir, r) => {
    point.copy(center).addScaledVector(dir, r);
    if (point.distanceToSquared(item.origin) > 45 * 45) return null;
    return local.copy(point).applyMatrix4(item.inverse);
  };
  const radiusOf = (item, x, y, z) => lift.set(x, y, z).applyMatrix4(item.mesh.matrixWorld).distanceTo(center);
  return {
    // Radius of the highest bridge floor the walker can stand on, or -Infinity.
    support(dir, feetR) {
      let best = -Infinity;
      for (const item of items) {
        const l = toLocal(item, dir, feetR);
        if (!l) continue;
        const g = item.grid, ix = Math.floor((l.x - g.x0) / WALK_CELL), iz = Math.floor((l.z - g.z0) / WALK_CELL);
        if (ix < 0 || iz < 0 || ix >= g.w || iz >= g.h) continue;
        const y = g.floor[iz * g.w + ix];
        if (y === -Infinity || y > l.y + STEP) continue;
        best = Math.max(best, radiusOf(item, l.x, y, l.z));
      }
      return best;
    },
    // Rails, walls, pillars or a too-high ledge inside the walker's body circle.
    blocked(dir, feetR, radius) {
      for (const item of items) {
        const l = toLocal(item, dir, feetR);
        if (!l) continue;
        const g = item.grid, lo = l.y + STEP, hi = l.y + BODY;
        const ix0 = Math.max(0, Math.floor((l.x - radius - g.x0) / WALK_CELL)), ix1 = Math.min(g.w - 1, Math.floor((l.x + radius - g.x0) / WALK_CELL));
        const iz0 = Math.max(0, Math.floor((l.z - radius - g.z0) / WALK_CELL)), iz1 = Math.min(g.h - 1, Math.floor((l.z + radius - g.z0) / WALK_CELL));
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
          const cx = g.x0 + (ix + .5) * WALK_CELL - l.x, cz = g.z0 + (iz + .5) * WALK_CELL - l.z;
          if (cx * cx + cz * cz > radius * radius) continue;
          const k = iz * g.w + ix;
          if (g.wallHi[k] > lo && g.wallLo[k] < hi) return true;
          if (g.floor[k] > lo && g.floor[k] < hi) return true;
        }
      }
      return false;
    },
  };
}

/**
 * Picks one bridge per requested two-lane corridor (mid-length, so it sits
 * well clear of junctions and crosswalks) and adds it to `city`. Street
 * furniture standing inside a bridge's sidewalk footprint is removed.
 */
export function installFootbridges(city, source, lanes, { corridors, makeMaterial }) {
  const template = bakeTemplate(source);
  const grid = buildWalkGrid(template.opaque, template.names);
  const materials = template.names.map(name => makeMaterial(name, PALETTE[name] || { color: 0xc9ccc6 }));
  const root = new THREE.Group();
  root.name = 'Footbridges';
  city.add(root);
  city.updateMatrixWorld(true);
  const frames = [];
  for (const corridor of corridors) {
    const pair = lanes.lanes.filter(l => l.corridor === corridor && l.half === 18);
    if (pair.length < 2) continue;
    const [a, b] = pair;
    const k = a.points.length >> 1;
    const pa = a.points[k];
    let best = b.points[0];
    for (const q of b.points) if (q.distanceToSquared(pa) < best.distanceToSquared(pa)) best = q;
    const up = pa.clone().add(best).normalize();
    const forward = a.points[k + 1].clone().sub(a.points[k - 1]);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, forward).normalize();
    frames.push({ corridor, up, forward, right, position: up.clone().multiplyScalar(WALK) });
  }
  const basis = new THREE.Matrix4();
  const walkers = [];
  frames.forEach((f, i) => {
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(f.right, f.up, f.forward));
    for (const [part, geometry] of [['', template.opaque], ['Glass', template.glass]]) {
      // Street_ prefix: counted as an obstacle by the collision world.
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = part ? `FootbridgeGlass_${i}` : `Street_Footbridge_${i}`;
      mesh.position.copy(f.position);
      mesh.quaternion.copy(quaternion);
      mesh.castShadow = true;
      mesh.receiveShadow = !part;
      mesh.userData.footbridge = part ? 'glass' : 'body';
      // Still a solid obstacle for the bike, traffic and spawns; the walker
      // ignores this footprint and uses the walk grid instead.
      if (!part) { mesh.userData.walkable = true; walkers.push({ mesh, grid }); }
      root.add(mesh);
    }
  });
  // Clear lamps / bins / signals that would stand inside a stair tower.
  const remove = [], local = new THREE.Vector3();
  city.traverse(o => {
    if (o === root || o.parent === root || !(o.isMesh || o.userData.streetComponent)) return;
    if (!/^(Street|StreetComponent)_/.test(o.name)) return;
    const p = o.getWorldPosition(new THREE.Vector3());
    for (const f of frames) {
      local.copy(p).sub(f.position);
      if (Math.abs(local.dot(f.forward)) < FOOTPRINT_HALF_ALONG && Math.abs(local.dot(f.right)) > TOWER_IN - 2
        && Math.abs(local.dot(f.right)) < TOWER_OUT + 2 && Math.abs(local.dot(f.up)) < 20) { remove.push(o); break; }
    }
  });
  for (const o of remove) o.removeFromParent();
  root.updateMatrixWorld(true);
  return { root, walkers, count: frames.length, removedFurniture: remove.length, corridors: frames.map(f => f.corridor), triangles: (template.opaque.attributes.position.count + template.glass.attributes.position.count) / 3 };
}
