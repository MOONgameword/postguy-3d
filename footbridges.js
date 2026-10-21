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
    const ny = (p.getY(i) - box.min.y) * kt - (nx * nx + nz * nz) / (2 * WALK);
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

/**
 * Picks one bridge per requested two-lane corridor (mid-length, so it sits
 * well clear of junctions and crosswalks) and adds it to `city`. Street
 * furniture standing inside a bridge's sidewalk footprint is removed.
 */
export function installFootbridges(city, source, lanes, { corridors, makeMaterial }) {
  const template = bakeTemplate(source);
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
  return { root, count: frames.length, removedFurniture: remove.length, corridors: frames.map(f => f.corridor), triangles: (template.opaque.attributes.position.count + template.glass.attributes.position.count) / 3 };
}
