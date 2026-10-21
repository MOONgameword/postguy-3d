import * as THREE from 'three';

const CELL = 0.45;
const BODY_HEIGHT = 5.4;
const HASH_CELL = 48;
const HASH_RADIUS = 600;
const OBSTACLE = /^(Bld|Tree|Rock|Street)_/i;

function clip(poly, axis, value, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a[axis] - value) * sign, db = (b[axis] - value) * sign;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

// Slice the actual mesh at player height. Roofs, tree crowns and lamp arms do
// not become ground obstacles. Work in each object's tangent plane, so rotated
// facades and objects near the planet poles keep their actual footprint.
export function buildFootprint(mesh, center = new THREE.Vector3()) {
  mesh.updateWorldMatrix(true, false);
  const pivot = mesh.getWorldPosition(new THREE.Vector3()).sub(center);
  const radius = pivot.length();
  if (radius < 1) return null;
  const up = pivot.clone().normalize();
  const east = new THREE.Vector3(Math.abs(up.y) < .9 ? 0 : 1, Math.abs(up.y) < .9 ? 1 : 0, 0);
  east.addScaledVector(up, -east.dot(up)).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const geo = mesh.userData.collisionGeometry || mesh.geometry, attr = geo.attributes.position;
  const vertices = [], p = new THREE.Vector3();
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < attr.count; i++) {
    p.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld).sub(center).sub(pivot);
    const h = p.dot(up);
    vertices.push([p.dot(east), p.dot(north), h]);
    low = Math.min(low, h); high = Math.max(high, h);
  }
  if (high - low < .2) return null;
  const polys = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const count = geo.index ? geo.index.count : attr.count;
  for (let i = 0; i < count; i += 3) {
    let poly = [0, 1, 2].map(k => vertices[geo.index ? geo.index.getX(i + k) : i + k]);
    poly = clip(poly, 2, low + Math.min(.12, (high - low) * .1), 1);
    poly = clip(poly, 2, low + BODY_HEIGHT, -1);
    if (poly.length < 3) continue;
    poly = poly.map(v => {
      const s = radius / (radius + v[2]);
      const x = v[0] * s, y = v[1] * s;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      return [x, y];
    });
    polys.push(poly);
  }
  if (!polys.length) return null;
  minX = Math.floor(minX / CELL) * CELL - CELL;
  minY = Math.floor(minY / CELL) * CELL - CELL;
  const width = Math.ceil((maxX - minX) / CELL) + 2;
  const height = Math.ceil((maxY - minY) / CELL) + 2;
  const mask = new Uint8Array(width * height);
  // Conservative scan conversion includes thin walls and poles without the
  // old rectangular envelope. Error is bounded by one 0.45-unit cell.
  for (const poly of polys) {
    const y0 = Math.max(0, Math.floor((Math.min(...poly.map(v => v[1])) - minY) / CELL));
    const y1 = Math.min(height - 1, Math.floor((Math.max(...poly.map(v => v[1])) - minY) / CELL));
    for (let y = y0; y <= y1; y++) {
      const strip = clip(clip(poly, 1, minY + y * CELL, 1), 1, minY + (y + 1) * CELL, -1);
      if (!strip.length) continue;
      const x0 = Math.max(0, Math.floor((Math.min(...strip.map(v => v[0])) - minX) / CELL));
      const x1 = Math.min(width - 1, Math.floor((Math.max(...strip.map(v => v[0])) - minX) / CELL));
      mask.fill(1, y * width + x0, y * width + x1 + 1);
    }
  }
  // Seal enclosed solids. Separate pillars, archways and concave entrances stay
  // connected to the exterior and remain passable.
  const outside = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const enqueue = i => { if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % width;
    if (x) enqueue(i - 1);
    if (x < width - 1) enqueue(i + 1);
    if (i >= width) enqueue(i - width);
    if (i + width < mask.length) enqueue(i + width);
  }
  let occupied = 0;
  for (let i = 0; i < mask.length; i++) { if (!outside[i]) mask[i] = 1; occupied += mask[i]; }
  const reach = Math.hypot(Math.max(Math.abs(minX), Math.abs(maxX + CELL)), Math.max(Math.abs(minY), Math.abs(maxY + CELL)));
  return { name: mesh.name, up, east, north, radius, minX, minY, width, height, mask, occupied, reach, cell: CELL };
}

export function footprintBlocked(shape, dir, radius = 0) {
  const dot = dir.dot(shape.up);
  if (dot <= .85) return false;
  const x = dir.dot(shape.east) * shape.radius / dot;
  const y = dir.dot(shape.north) * shape.radius / dot;
  const r = radius / dot;
  if (x + r < shape.minX || y + r < shape.minY ||
      x - r > shape.minX + shape.width * CELL || y - r > shape.minY + shape.height * CELL) return false;
  const x0 = Math.max(0, Math.floor((x - r - shape.minX) / CELL));
  const x1 = Math.min(shape.width - 1, Math.floor((x + r - shape.minX) / CELL));
  const y0 = Math.max(0, Math.floor((y - r - shape.minY) / CELL));
  const y1 = Math.min(shape.height - 1, Math.floor((y + r - shape.minY) / CELL));
  for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
    if (!shape.mask[iy * shape.width + ix]) continue;
    const dx = Math.max(shape.minX + ix * CELL - x, 0, x - (shape.minX + (ix + 1) * CELL));
    const dy = Math.max(shape.minY + iy * CELL - y, 0, y - (shape.minY + (iy + 1) * CELL));
    if (dx * dx + dy * dy <= r * r + 1e-10) return true;
  }
  return false;
}

export function createCollisionWorld(root, center = new THREE.Vector3()) {
  const shapes = [], bins = new Map(), discs = [];
  root.updateMatrixWorld(true);
  const key = (x, y, z) => `${x},${y},${z}`;
  root.traverse(mesh => {
    if (!mesh.isMesh || !OBSTACLE.test(mesh.name) || mesh.userData.__outline) return;
    const shape = buildFootprint(mesh, center);
    if (shape) { shape.walkable = !!mesh.userData.walkable; shapes.push(shape); }
  });
  for (const shape of shapes) {
    // Broad phase only. The narrow phase always checks the actual footprint.
    const p = shape.up.clone().multiplyScalar(HASH_RADIUS);
    const reach = shape.reach * HASH_RADIUS / shape.radius + 32;
    const lo = p.clone().addScalar(-reach).divideScalar(HASH_CELL).floor();
    const hi = p.clone().addScalar(reach).divideScalar(HASH_CELL).floor();
    for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) {
      const k = key(x, y, z);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(shape);
    }
  }
  // skipWalkable: ignore footprints of structures the walker can climb
  // (footbridges); their own walk query handles stairs, decks and rails.
  function query(dir, radius = 0, names = null, skipWalkable = false) {
    const candidates = radius > 30 ? shapes : bins.get(key(Math.floor(dir.x * HASH_RADIUS / HASH_CELL), Math.floor(dir.y * HASH_RADIUS / HASH_CELL), Math.floor(dir.z * HASH_RADIUS / HASH_CELL))) || [];
    for (const s of candidates) if (!(skipWalkable && s.walkable) && footprintBlocked(s, dir, radius)) { if (names) names.push(s.name); else return true; }
    for (const d of discs) if (dir.dot(d.up) > Math.cos((radius + d.radius) / d.distance)) { if (names) names.push(d.name); else return true; }
    return names ? names.length > 0 : false;
  }
  return {
    shapes,
    stats: { objects: shapes.length, occupiedCells: shapes.reduce((n, s) => n + s.occupied, 0), cellSize: CELL, bodyHeight: BODY_HEIGHT },
    blocked: query,
    explain(dir, radius = 0) { const names = []; query(dir, radius, names); return names; },
    addDisc(up, radius, name = 'PlacedProp', distance = 600) { discs.push({ up: up.clone().normalize(), radius, name, distance }); },
    // This image is used only for the minimap. Movement never samples a
    // latitude/longitude rectangle, avoiding inflated collisions near poles.
    map(width, height) {
      const mask = new Uint8Array(width * height), p = new THREE.Vector3();
      for (const s of shapes) for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
        if (!s.mask[y * s.width + x]) continue;
        p.copy(s.up).multiplyScalar(s.radius).addScaledVector(s.east, s.minX + (x + .5) * CELL).addScaledVector(s.north, s.minY + (y + .5) * CELL).normalize();
        const u = (Math.floor((Math.atan2(p.x, p.z) / (2 * Math.PI) + .5) * width) + width) % width;
        const v = Math.min(height - 1, Math.floor(Math.acos(THREE.MathUtils.clamp(p.y, -1, 1)) / Math.PI * height));
        mask[v * width + u] = 1;
      }
      return mask;
    }
  };
}

// Sweep in short steps, retaining the last safe position. Thin poles cannot be
// skipped by a fast frame; hitting a wall no longer discards all prior movement.
export function sweepSphere(q, out, distance, bodyRadius, planetRadius, blocked) {
  out.copy(q);
  if (!distance) return true;
  const steps = Math.ceil(Math.abs(distance) / Math.max(.3, Math.min(.9, bodyRadius * .5)));
  const delta = distance / steps;
  const trial = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const axis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const advance = (frame, amount) => {
    axis.set(1, 0, 0).applyQuaternion(frame);
    rotation.setFromAxisAngle(axis, amount / planetRadius);
    frame.premultiply(rotation).normalize();
  };
  let clear = true;
  for (let i = 0; i < steps; i++) {
    trial.copy(out); advance(trial, delta);
    if (!blocked(trial, bodyRadius)) { out.copy(trial); continue; }
    clear = false;
    let slid = false;
    for (const angle of [.55, -.55, 1, -1]) {
      trial.copy(out).multiply(rotation.setFromAxisAngle(up, angle));
      advance(trial, delta * .8);
      trial.multiply(rotation.setFromAxisAngle(up, -angle));
      if (!blocked(trial, bodyRadius)) { out.copy(trial); slid = true; break; }
    }
    if (!slid) break;
  }
  return clear;
}
