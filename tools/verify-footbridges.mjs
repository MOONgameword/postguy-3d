import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import { FBXLoader } from '../vendor/loaders/FBXLoader.js';
import { loadCity } from './load-city.mjs';
import { decodeRoadGeometry, installRoadGeometry } from '../road-geometry.js';
import { createTrafficLanes } from '../traffic-lanes.js';
import { installFootbridges } from '../footbridges.js';
import { buildFootprint, footprintBlocked } from '../collision-world.js';
const { city } = loadCity();
const rb = fs.readFileSync('assets/roads-rounded-v16.bin');
installRoadGeometry(city, decodeRoadGeometry(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength)));
const lanes = createTrafficLanes(JSON.parse(fs.readFileSync('assets/traffic-lanes-v1.json')));
const fb = fs.readFileSync('assets/footbridge-v1.fbx');
const src = new FBXLoader().parse(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), '');
const res = installFootbridges(city, src, lanes, { corridors: [0, 7, 13, 14], makeMaterial: (name) => new T.MeshBasicMaterial({ name }) });
console.log({ count: res.count, removed: res.removedFurniture, tris: res.triangles });
const bodies = res.root.children.filter(m => m.userData.footbridge === 'body');
const shapes = bodies.map(m => buildFootprint(m));
let laneHits = 0, laneSamples = 0;
for (const p of lanes.paths) for (const q of p.points) {
  const d = q.clone().normalize();
  laneSamples++;
  // Car half-width ~2.5 units around each lane sample.
  if (shapes.some(s => footprintBlocked(s, d, 2.5))) laneHits++;
}
// Tower base heights vs sidewalk deck (602.8667) and deck clearance over road centre.
const v = new T.Vector3();
for (const m of bodies) {
  const p = m.geometry.attributes.position;
  let baseMin = Infinity, baseMax = -Infinity, deckLow = Infinity;
  const local = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    local.fromBufferAttribute(p, i);
    v.copy(local).applyMatrix4(m.matrixWorld);
    const r = v.length();
    if (Math.abs(local.x) > 21 && local.y < .5) { baseMin = Math.min(baseMin, r); baseMax = Math.max(baseMax, r); }
    if (Math.abs(local.x) < 18) deckLow = Math.min(deckLow, r - 602);
  }
  console.log(m.name, 'tower base radius', baseMin.toFixed(2), '..', baseMax.toFixed(2), 'deck clearance over road', deckLow.toFixed(2), 'footprint cells', shapes[bodies.indexOf(m)].occupied);
}
console.log({ laneSamples, laneHits });
assert.equal(res.count, 4, 'Four footbridges');
assert.equal(laneHits, 0, 'Stair towers must not block any traffic lane');
console.log(JSON.stringify({ result: 'PASS', bridges: res.count, laneSamples }));
