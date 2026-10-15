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
  return { up, tangent, base: up.clone().multiplyScalar(radius) };
}

function orient(root, frame, offset = 0, scale = 1) {
  const x = frame.tangent.clone();
  const y = frame.up.clone();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  root.position.copy(frame.base).addScaledVector(frame.tangent, offset);
  root.scale.setScalar(scale);
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
  const add = (id, frame, offset = 0, factor = 1) => {
    const item = templates.get(id)?.clone(true);
    if (!item) return;
    item.name = `StreetComponent_${id}_${placed.length}`;
    orient(item, frame, offset, scale * factor);
    item.userData.streetComponent = true;
    root.add(item);
    toonify?.(item, { palette: false, castShadow: !mobile });
    addOutline?.(item, outline);
    placed.push(item);
  };

  // Four-lane lighting is replaced one-for-one, preserving the existing
  // sidewalk coverage and the lamp-to-road orientation.
  for (const frame of anchors) add('04', frame, 0, .98);

  // Small deterministic counts keep the authored street kit visible without
  // recreating the old dense sidewalk clutter. Wider barriers/planters get a
  // tangent offset so their footprint stays inside the paving band.
  const counts = { '01': 4, '02': 4, '03': 4, '05': 4, '06': 4, '07': 4,
    '08': 4, '09': 8, '10': 4, '11': 4, '12': 4, '13': 8, '14': 10 };
  let seed = 7;
  for (const id of Object.keys(counts)) {
    for (const index of spreadIndices(anchors.length, counts[id], seed)) {
      const frame = anchors[index];
      const sign = (index + Number(id)) % 2 ? 1 : -1;
      const offset = ['05', '06', '07', '08'].includes(id) ? sign * 3.4 : sign * 1.8;
      add(id, frame, offset, id === '14' ? .9 : 1);
    }
    seed += 11;
  }
  source.visible = false;
  root.userData.streetComponentStats = { lampAnchors: anchors.length, placed: placed.length, componentTypes: 14 };
  return root.userData.streetComponentStats;
}
