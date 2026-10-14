import * as THREE from 'three';

const groundPlants = /^(Grass|Flowers?|Floral|LakeReeds)(_|$)/i;
// Source FBX Street_* includes both lamps and obsolete sidewalk furniture.
// Its local Z axis is vertical. Only lamps have a tall, narrow silhouette;
// planter trees, bins and benches are all broader than this profile.
export function isLegacySidewalkProp(mesh) {
  if (!mesh.isMesh || !/^Street_\d+$/.test(mesh.name)) return false;
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  return size.z <= Math.max(size.x, size.y) * 4;
}
const hash = name => {
  let value = 2166136261;
  for (const ch of name) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return value >>> 0;
};

export function sceneMeshStats(root) {
  const stats = { buildings: 0, trees: 0, groundPlants: 0, sidewalkProps: 0, meshes: 0, triangles: 0 };
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    stats.meshes++;
    stats.triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    if (/^Bld_/.test(mesh.name)) stats.buildings++;
    if (/^Tree_/.test(mesh.name)) stats.trees++;
    if (groundPlants.test(mesh.name)) stats.groundPlants++;
    if (isLegacySidewalkProp(mesh)) stats.sidewalkProps++;
  });
  return stats;
}

// Distribute the removals among small regions of the planet instead of clearing
// entire streets or forests. Stable names keep the same layout on every visit.
function chooseThird(meshes) {
  const regions = new Map();
  for (const mesh of meshes) {
    const up = mesh.getWorldPosition(new THREE.Vector3()).normalize();
    const key = up.toArray().map(v => Math.floor((v + 1) * 3)).join(',');
    if (!regions.has(key)) regions.set(key, { key, total: 0, available: [], quota: 0 });
    const region = regions.get(key);
    region.total++;
    // Keep the existing lakeside landmark used to orient the shared lake view.
    if (mesh.name !== 'Bld_0333') region.available.push(mesh);
  }
  let remaining = Math.floor(meshes.length / 3);
  const sorted = [...regions.values()].sort((a, b) => b.total % 3 - a.total % 3 || hash(a.key) - hash(b.key));
  for (const region of sorted) {
    region.available.sort((a, b) => hash(a.name) - hash(b.name) || a.name.localeCompare(b.name));
    region.quota = Math.min(Math.floor(region.total / 3), region.available.length);
    remaining -= region.quota;
  }
  for (const region of sorted) {
    if (remaining && region.quota < region.available.length) { region.quota++; remaining--; }
  }
  if (remaining) throw new Error('Unable to distribute scene density reduction');
  return sorted.flatMap(region => region.available.slice(0, region.quota));
}

export function reduceSceneDensity(city) {
  if (city.userData.densityReduction) return city.userData.densityReduction;
  city.updateMatrixWorld(true);
  const before = sceneMeshStats(city), buildings = [], trees = [], plants = [], sidewalkProps = [];
  city.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (/^Bld_/.test(mesh.name)) buildings.push(mesh);
    else if (/^Tree_/.test(mesh.name)) trees.push(mesh);
    else if (groundPlants.test(mesh.name)) plants.push(mesh);
    else if (isLegacySidewalkProp(mesh)) sidewalkProps.push(mesh);
  });
  const removed = [...chooseThird(buildings), ...chooseThird(trees), ...plants, ...sidewalkProps];
  for (const mesh of removed) mesh.removeFromParent();
  // Dedupe shares geometry across instances; only release geometry with no users.
  const retainedGeometry = new Set();
  city.traverse(mesh => { if (mesh.isMesh) retainedGeometry.add(mesh.geometry); });
  for (const geometry of new Set(removed.map(mesh => mesh.geometry))) {
    if (!retainedGeometry.has(geometry)) geometry.dispose();
  }
  const after = sceneMeshStats(city);
  if (after.groundPlants !== 0) throw new Error('Ground plant cleanup incomplete');
  const result = { before, after, removed: {
    buildings: before.buildings - after.buildings,
    trees: before.trees - after.trees,
    groundPlants: before.groundPlants - after.groundPlants,
    sidewalkProps: before.sidewalkProps - after.sidewalkProps,
    meshes: before.meshes - after.meshes,
    triangles: before.triangles - after.triangles
  } };
  city.userData.densityReduction = result;
  return result;
}
