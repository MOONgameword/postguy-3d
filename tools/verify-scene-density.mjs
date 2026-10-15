import { installTestTerrain } from './install-test-terrain.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { loadCity } from './load-city.mjs';
import { createLakeside } from '../lakeside.js';
import { reduceSceneDensity, sceneMeshStats } from '../scene-density.js';
import { decodeRoadGeometry, installRoadGeometry, installJunctionFurniture } from '../road-geometry.js';
import { createCollisionWorld } from '../collision-world.js';

const { city, road } = loadCity();
const roadBytes = fs.readFileSync('assets/roads-rounded-v12.bin');
installRoadGeometry(city, decodeRoadGeometry(roadBytes.buffer.slice(roadBytes.byteOffset, roadBytes.byteOffset + roadBytes.byteLength)));
installJunctionFurniture(city, JSON.parse(fs.readFileSync('assets/junction-furniture-v4.json')));
installTestTerrain(city);
// Exercise removal of reeds too, including loading a scene where they exist.
createLakeside(city, { includeReeds: true });
const before = sceneMeshStats(city), originalMeshes = [];
city.traverse(mesh => { if (mesh.isMesh) originalMeshes.push(mesh); });
const reordered = city.clone(true);
reordered.children.reverse();
const roads = road.geometry, terrain = city.getObjectByName('Planet').geometry;
const stats = reduceSceneDensity(city);
assert.equal(stats.removed.buildings, Math.floor(before.buildings / 3));
assert.equal(stats.removed.trees, Math.floor(before.trees / 3));
assert.equal(stats.after.groundPlants, 0);
assert.equal(stats.removed.sidewalkProps, 168, 'Remove all original sidewalk decorations');
assert.equal(stats.after.sidewalkProps, 0);
assert.equal(originalMeshes.filter(m => /^Street_/.test(m.name) && m.parent).length, 168, 'Keep the street lamps');
assert.equal(city.getObjectByName('Roads').geometry, roads);
assert.equal(city.getObjectByName('Planet').geometry, terrain);
assert.ok(city.getObjectByName('Bld_0333'));
assert.ok(city.getObjectByName('Planet_LakeDock'));
assert.ok(city.getObjectByName('LakeWater'));
assert.equal(city.getObjectByName('Lakeside').children.filter(o => o.name === 'LakeBoat').length, 3);
assert.deepEqual(reduceSceneDensity(city), stats, 'Repeated setup must not remove another third');
reduceSceneDensity(reordered);
const names = root => { const result = []; root.traverse(o => { if (o.isMesh) result.push(o.name); }); return result.sort(); };
assert.deepEqual(names(city), names(reordered), 'Layout must be deterministic and independent of object order');
const retained = new Set(names(city));
const world = createCollisionWorld(city);
assert.ok(world.shapes.every(shape => retained.has(shape.name)), 'No removed object may remain in collision data');
let removedObstacleProbes = 0;
for (const mesh of originalMeshes) {
  if (retained.has(mesh.name) || !/^(Bld|Tree|Street)_/.test(mesh.name)) continue;
  const dir = mesh.getWorldPosition(new THREE.Vector3()).normalize();
  assert.ok(!world.explain(dir, 0).includes(mesh.name), 'Deleted model must not leave a collider');
  removedObstacleProbes++;
}
const expectedObjects = stats.after.buildings + stats.after.trees
  + originalMeshes.filter(m => /^(Rock|Street)_/.test(m.name) && retained.has(m.name)).length;
assert.equal(world.stats.objects, expectedObjects, 'Collision world contains retained obstacles only');
assert.ok(stats.removed.triangles > 0);
const report = { ...stats, triangleReductionPercent: Number((stats.removed.triangles / before.triangles * 100).toFixed(1)),
  removedObstacleProbes, collisionObjects: world.stats.objects, result: 'PASS' };
fs.writeFileSync('assets/scene-density-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
