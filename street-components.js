import * as THREE from 'three';

const ASSET_RE = /^StreetAsset_(\d\d)_/;
const COMPONENTS = [
  '电线杆', '横向交通信号灯', '心形行人信号灯', '弧臂路灯', '蓝白道路护栏',
  '黄黑防撞栏', '石质绿篱花池', '木质缤纷花箱', '双分类垃圾桶', '红色邮筒',
  '灰色邮筒', '配电柜', '红色消火栓', '雨水井盖'
];

function assetId(node) {
  let found = null;
  node.traverse(o => {
    if (!found) found = o.name.match(ASSET_RE)?.[1] || null;
  });
  return found;
}

function sidewalkFrame(lamp, radius) {
  const p = lamp.getWorldPosition(new THREE.Vector3());
  const up = p.normalize();
  const q = lamp.getWorldQuaternion(new THREE.Quaternion());
  // The source FBX has local Z up and its long axis along local X. Project the
  // old lamp's X axis onto the tangent plane so every replacement follows its
  // original street direction, including planet-side bends.
  const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    .addScaledVector(up, -new THREE.Vector3(1, 0, 0).applyQuaternion(q).dot(up));
  if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0).cross(up);
  tangent.normalize();
  // The replacement lamp's source X axis is the arm/head direction.  The
  // old sidewalk anchors have their tangent oriented consistently, so the
  // road is on the negative tangent×up side of every anchor.
  const roadward = new THREE.Vector3().crossVectors(tangent, up).normalize().negate();
  return { up, tangent, roadward, base: up.clone().multiplyScalar(radius) };
}

function orient(root, frame, offset = 0, scale = 1, faceRoad = false) {
  const y = frame.up.clone();
  let x, z;
  if (faceRoad === 'front') {
    // Signal housings have their visible lens on source +Z. Rotate that face
    // toward the carriageway while keeping their pole vertical.
    z = frame.roadward.clone();
    x = new THREE.Vector3().crossVectors(y, z).normalize();
  } else {
    x = (faceRoad ? frame.roadward : frame.tangent).clone();
    z = new THREE.Vector3().crossVectors(x, y).normalize();
  }
  root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  root.position.copy(frame.base).addScaledVector(frame.tangent, offset);
  root.scale.setScalar(scale);
}

function lightSignal(root, id) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.emissive) continue;
      const name = m.name || '';
      let color = null;
      if (id === '03' && /红灯/.test(name)) color = 0xff3045;
      if (id === '02' && /红灯/.test(name)) color = 0xff3045;
      if (id === '02' && /黄/.test(name)) color = 0xffc51b;
      if (id === '02' && /青灯/.test(name)) color = 0x20e6c4;
      if (!color) continue;
      m.emissive.setHex(color);
      m.emissiveIntensity = id === '03' ? 1.35 : 1.1;
      m.toneMapped = false;
      m.needsUpdate = true;
    }
  });
}

function makeTemplates(source) {
  const templates = new Map(COMPONENTS.map((name, i) => [String(i + 1).padStart(2, '0'), new THREE.Group()]));
  for (const child of source.children) {
    const id = assetId(child);
    if (id && templates.has(id)) templates.get(id).add(child.clone(true));
  }
  for (const [id, root] of templates) {
    root.name = `StreetComponentTemplate_${id}`;
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }
  return templates;
}

function spreadIndices(total, count, seed) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const index = (seed + Math.floor((i + .5) * total / count)) % total;
    if (!out.includes(index)) out.push(index);
  }
  return out;
}

/**
 * Replace the 168 tiny FBX lamp meshes and distribute the other 13 authored
 * components over the same sidewalk anchors. The imported GLB stays batched
 * by shared geometry/materials; only Object3D transforms are instanced.
 */
export function installStreetComponents(city, source, {
  radius = 602.8666667,
  scale = 3,
  toonify,
  addOutline,
  outline = .015,
  crosswalkSignals = [],
  mobile = false
} = {}) {
  city.updateMatrixWorld(true);
  const lamps = [];
  city.traverse(o => {
    if (!o.isMesh || !/^Street_\d+$/.test(o.name)) return;
    o.geometry.computeBoundingBox();
    const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
    // The source asset contains 168 tall lamp meshes and 168 old sidewalk
    // props; density cleanup has already removed the latter.
    if (s.z > Math.max(s.x, s.y) * 4) lamps.push(o);
  });
  lamps.sort((a, b) => a.name.localeCompare(b.name));
  if (lamps.length < 100) throw new Error(`Expected sidewalk lamps, got ${lamps.length}`);
  const anchors = lamps.map(lamp => sidewalkFrame(lamp, radius));
  for (const lamp of lamps) lamp.removeFromParent();

  const templates = makeTemplates(source);
  const root = new THREE.Group();
  root.name = 'StreetComponents_14_Source';
  city.add(root);

  const placed = [];
  const add = (id, frame, offset = 0, factor = 1, faceRoad = false) => {
    const item = templates.get(id)?.clone(true);
    if (!item) return;
    item.name = `StreetComponent_${id}_${placed.length}`;
    orient(item, frame, offset, scale * factor, faceRoad);
    item.userData.streetComponent = true;
    root.add(item);
    toonify?.(item, { palette: false, castShadow: !mobile });
    if (id === '02' || id === '03') lightSignal(item, id);
    addOutline?.(item, outline);
    placed.push(item);
  };

  // Four-lane lighting is replaced one-for-one, preserving the existing
  // sidewalk coverage and the lamp-to-road orientation.
  // The request is a 50% enlargement: keep the authored proportions and
  // multiply the lamp instance scale by 1.5.
  for (const frame of anchors) add('04', frame, 0, .98 * 1.5, true);

  // Crosswalks stay painted, but no pedestrian or horizontal signals are installed.

  // Keep only the road-facing lamps. The small sidewalk props (barriers,
  // planters, bins, mailboxes, cabinets, hydrants and manhole assets) make the
  // narrow pavement look cluttered and are intentionally retired.
  source.visible = false;
  root.userData.streetComponentStats = { lampAnchors: anchors.length, placed: placed.length, componentTypes: 1, removedSidewalkProps: true };
  return root.userData.streetComponentStats;
}
