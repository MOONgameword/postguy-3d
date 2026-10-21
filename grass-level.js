import * as THREE from 'three';
import { lakeMetric } from './lakeside.js?v=20261021-norock';

const WALK = 602 + 2.6 / 3;
const smooth = x => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// Raise low grass toward the existing pavement; keep the road and sidewalk fixed.
// The lake basin and shore retain their water clearance, with a gradual land blend.
export function grassLift(point) {
  const r = point.length();
  if (r >= WALK) return 0;
  const shoreWeight = smooth((lakeMetric(point) - 1.45) / .35);
  return (WALK - r) * (2 / 3) * shoreWeight;
}

export function raiseGrassLevel(city) {
  if (city.userData.grassLevel) return city.userData.grassLevel;
  city.updateMatrixWorld(true);
  const terrain = city.getObjectByName('Planet'), road = city.getObjectByName('Roads');
  const geometry = terrain.geometry.clone(), pos = geometry.attributes.position;
  const inverse = terrain.matrixWorld.clone().invert(), p = new THREE.Vector3();
  let terrainVertices = 0, props = 0, skirtVertices = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(terrain.matrixWorld);
    const lift = grassLift(p);
    if (lift > 0) { p.setLength(p.length() + lift).applyMatrix4(inverse); pos.setXYZ(i, p.x, p.y, p.z); terrainVertices++; }
  }
  pos.needsUpdate = true;
  // Keep the lake's smoothed normals; the radial lift is gradual and preserves
  // the source low-poly shading on the land.
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  terrain.geometry = geometry;
  const roadGeo = road.geometry.clone(), roadPos = roadGeo.attributes.position;
  const roadInverse = road.matrixWorld.clone().invert();
  for (const group of roadGeo.groups) {
    if (road.material[group.materialIndex].name !== 'City_Curb') continue;
    for (let i = group.start; i < group.start + group.count; i++) {
      p.fromBufferAttribute(roadPos, i).applyMatrix4(road.matrixWorld);
      // Only the land-facing skirt reaches radius 600. Road-facing curb is 602.
      if (Math.abs(p.length() - 600) > .001) continue;
      p.setLength(p.length() + grassLift(p)).applyMatrix4(roadInverse);
      roadPos.setXYZ(i, p.x, p.y, p.z); skirtVertices++;
    }
  }
  roadPos.needsUpdate = true; roadGeo.computeBoundingBox(); roadGeo.computeBoundingSphere();
  road.geometry = roadGeo;
  city.traverse(mesh => {
    if (!mesh.isMesh || !/^(Bld|Tree|Rock)_/.test(mesh.name)) return;
    let bottom = Infinity;
    const attr = mesh.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) bottom = Math.min(bottom, p.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld).length());
    const pivot = mesh.getWorldPosition(new THREE.Vector3()), up = pivot.clone().normalize();
    const lift = grassLift(up.clone().multiplyScalar(bottom));
    if (lift <= 0) return;
    mesh.position.copy(mesh.parent.worldToLocal(pivot.addScaledVector(up, lift))); props++;
  });
  city.updateMatrixWorld(true);
  const stats = { terrainVertices, skirtVertices, props, previousFlatGap: WALK - 600, flatGap: (WALK - 600) / 3 };
  city.userData.grassLevel = stats;
  return stats;
}
