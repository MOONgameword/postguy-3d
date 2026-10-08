import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { loadCity } from './load-city.mjs';
import { installTestTerrain } from './install-test-terrain.mjs';
import { createLakeside, lakeMetric } from '../lakeside.js';
import { reduceSceneDensity } from '../scene-density.js';
import { raiseGrassLevel } from '../grass-level.js';
import { scatterMeadow, createMeadowPlants } from '../meadow-plants.js';

const { city } = loadCity();
installTestTerrain(city); createLakeside(city); reduceSceneDensity(city); raiseGrassLevel(city);
const planet = city.getObjectByName('Planet');
const original = planet.geometry.attributes.position.array.slice();
// A hemisphere exclusion stands in for road/obstacle masks; no rejected root may survive.
const field = scatterMeadow(planet, p => p.x > 0);
assert.ok(field.stats.roots > 20000 && field.stats.flowers > 1000);
const p = new T.Vector3(), ray = new T.Raycaster(), tested = [];
for (const data of field.bins.values()) {
  for (let i = 0; i < data.length; i += 5) {
    p.fromArray(data, i); assert.ok(p.x > 0 && lakeMetric(p) >= 1.13);
  }
  if (tested.length < 20) tested.push(new T.Vector3().fromArray(data));
}
planet.material = new T.MeshBasicMaterial({ side: T.DoubleSide });
for (const point of tested) {
  const up = point.clone().normalize(); ray.set(up.clone().multiplyScalar(800), up.clone().negate());
  assert.ok(ray.intersectObject(planet, false)[0].point.distanceTo(point) < .002, 'Roots must lie on the actual triangle surface');
}
const scene = new T.Scene(), plants = createMeadowPlants(scene, field);
plants.update(0, tested[0]);
assert.ok(plants.grass.count > 0 && plants.blooms.count > 0);
assert.equal(plants.stems.count, plants.blooms.count);
assert.ok(plants.grass.count <= plants.stats.maxGrass);
assert.equal(scene.children.length, 4);
plants.update(1, new T.Vector3(-650, 0, 0));
assert.equal(plants.grass.count, 0, 'Moving to an empty region must clear old instances');
assert.deepEqual(planet.geometry.attributes.position.array, original, 'Decoration cannot change terrain/collision geometry');
console.log(JSON.stringify({ result: 'PASS', ...field.stats, terrainRayChecks: tested.length, maxDrawCalls: 4 }, null, 2));
