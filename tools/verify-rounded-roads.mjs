import * as THREE from '../vendor/three.module.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadCity } from './load-city.mjs';
import { buildRoundedJunctions } from '../rounded-junctions.js';
import { decodeRoadGeometry, installJunctionFurniture } from '../road-geometry.js';
import { isLegacySidewalkProp } from '../scene-density.js';

const { city, road } = loadCity();
const plan = buildRoundedJunctions(road);
assert.deepEqual([plan.stats.junctions, plan.stats.corners, plan.stats.corridors], [10, 30, 15]);
const bytes = fs.readFileSync(new URL('../assets/roads-rounded-v11.bin', import.meta.url));
const geometry = decodeRoadGeometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const positions = geometry.attributes.position, normals = geometry.attributes.normal;
const sidewalkGroup=geometry.groups.find(g=>road.material[g.materialIndex].name==='City_Sidewalk');
let heightChecks=0;
for(let i=sidewalkGroup.start;i<sidewalkGroup.start+sidewalkGroup.count;i++) {
 const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(road.matrixWorld);
 assert.ok(Math.abs(p.length()-(602+2.6/3))<.0002);heightChecks++;
}
let reversed = 0, invalid = 0, checkedFaces = 0;
for (let i = 0; i < positions.count; i += 3) {
  const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(positions, i + k));
  const face = b.sub(a).cross(c.sub(a));
  if (!a.toArray().concat(b.toArray(), c.toArray()).every(Number.isFinite)) invalid++;
  if (face.lengthSq() < 1e-18) continue;
  const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
  if (face.dot(normal) < -1e-10) reversed++;
  checkedFaces++;
}
assert.equal(invalid, 0); assert.equal(reversed, 0, 'Face winding must agree with lighting');

function materialMesh(index) {
  const group = geometry.groups.find(g => g.materialIndex === index);
  const data = [];
  for (let i = group.start; i < group.start + group.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(road.matrixWorld);
    data.push(...p.toArray());
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true); return mesh;
}
const asphalt = materialMesh(0), sidewalk = materialMesh(2), ray = new THREE.Raycaster();
const curbIndex = road.material.findIndex(m => m.name === 'City_Curb');
const curb = materialMesh(curbIndex);
const curbGroup = geometry.groups.find(g => g.materialIndex === curbIndex);
let mappedCurbTriangles = 0;
for (let i = curbGroup.start; i < curbGroup.start + curbGroup.count; i += 3) {
  const uv = [0, 1, 2].map(k => new THREE.Vector2().fromBufferAttribute(geometry.attributes.uv, i + k));
  assert.ok(uv.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(Math.abs(uv[1].clone().sub(uv[0]).cross(uv[2].clone().sub(uv[0]))) > 1e-10, 'Curb texture UV must have area');
  mappedCurbTriangles++;
}
const origin = new THREE.Vector3();
let roadChecks = 0, walkChecks = 0, minGap = Infinity, maxGap = -Infinity;
let grassCurbChecks = 0;
function assertGround(p, mesh, label) {
  ray.set(origin, p.clone().normalize());
  let hits = ray.intersectObject(mesh, false);
  // A ray exactly on a shared Float32 seam can miss both adjacent faces. Probe
  // 0.0001 scene units on either side; never accept a visible-width opening.
  if (!hits.length) for (const axis of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)]) {
    ray.set(origin, p.clone().addScaledVector(axis, .0001).normalize());
    hits = ray.intersectObject(mesh, false);
    if (hits.length) break;
  }
  assert.ok(hits.length, label + ' must land on the intended surface: ' + p.toArray().join(','));
  return hits[0].distance;
}
// Follow every rounded corner through its full sweep, including reflex bends.
for (const [ji, junction] of plan.junctions.entries()) for (const [si, sector] of junction.sectors.entries()) {
  for (const p of plan.sectorPath(sector, sector.a.outer-.7, sector.b.outer-.7).slice(1, -1)) {
    const height = assertGround(plan.world(junction, p, 602 + 2.6 / 3 + .02), curb, 'Grass-side curb cap');
    assert.ok(height > 603.02 && height < 603.14, 'Grass curb must stay just above sidewalk height');
    grassCurbChecks++;
  }
  // The cap must cover the new narrow edge, leaving the old broad strip paved.
  const narrow = plan.sectorPath(sector, sector.a.half+.7, sector.b.half+.7), paved = plan.sectorPath(sector, sector.a.half+4, sector.b.half+4);
  for (let k = 1; k < narrow.length - 1; k++) {
    assertGround(plan.world(junction, narrow[k], (602 + 2.6 / 3 + .12)), curb, 'Narrow curb continuity');
    ray.set(origin, plan.world(junction, paved[k], (602 + 2.6 / 3 + .12)).normalize());
    assert.equal(ray.intersectObject(curb, false).length, 0, 'Old wide cap must be removed');
  }
  for (const [pi, p] of plan.sectorPath(sector, sector.a.half*.5, sector.b.half*.5).entries()) { assertGround(plan.world(junction, p, 602), asphalt, `J${ji} turn ${si} sample ${pi} (${p.x},${p.y})`); roadChecks++; }
  for (const p of plan.sectorPath(sector, sector.a.half+7, sector.b.half+7)) { assertGround(plan.world(junction, p, (602 + 2.6 / 3)), sidewalk, `J${ji} sidewalk ${si}`); walkChecks++; }
}
for (const corridor of plan.corridors) for (let k = 0; k <= 20; k++) {
  const s = corridor.start + (corridor.end - corridor.start) * k / 20;
  const p = corridor.j.up.clone().multiplyScalar(Math.cos(s)).addScaledVector(corridor.arm.direction, Math.sin(s)).multiplyScalar(602);
  assertGround(p, asphalt, 'Corridor continuity'); roadChecks++;
  if (k > 0 && k < 20) for (const sign of [-1, 1]) {
    const edge = p.clone().multiplyScalar(600 / 602).addScaledVector(corridor.side, sign * (corridor.arm.outer-.7));
    const height = assertGround(edge, curb, 'Straight grass-side curb cap');
    assert.ok(height > 603.02 && height < 603.14);
    grassCurbChecks++;
  }
}
// Sample paint throughout the entire planet, rather than just the initial view.
const paint = geometry.groups[1], stride = Math.max(1, Math.floor(paint.count / 3 / 1200));
for (let i = paint.start; i < paint.start + paint.count; i += 3 * stride) {
  const p = new THREE.Vector3();
  for (let k = 0; k < 3; k++) p.add(new THREE.Vector3().fromBufferAttribute(positions, i + k).applyMatrix4(road.matrixWorld));
  p.divideScalar(3);
  const gap = p.length() - assertGround(p, asphalt, 'Road paint');
  minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap);
}
assert.ok(minGap > 0.010 && maxGap < 0.015, `Paint clearance ${minGap}–${maxGap}`);
const placements = JSON.parse(fs.readFileSync(new URL('../assets/junction-furniture-v4.json', import.meta.url)));
installJunctionFurniture(city, placements);
assert.equal(placements.length, 336, 'All street furniture follows the lowered sidewalk');
const outerEdgeSegments=[];
for(const j of plan.junctions)for(const s of j.sectors){
  const path=plan.sectorPath(s,s.a.outer,s.b.outer).map(p=>plan.world(j,p,600));
  for(let i=1;i<path.length;i++) outerEdgeSegments.push(new THREE.Line3(path[i-1],path[i]));
}
for(const c of plan.corridors)for(const sign of [-1,1]){
  const n=Math.ceil((c.end-c.start)*600/2);
  for(let i=0;i<n;i++)outerEdgeSegments.push(new THREE.Line3(c.at(c.start+(c.end-c.start)*i/n,sign*c.arm.outer,600),c.at(c.start+(c.end-c.start)*(i+1)/n,sign*c.arm.outer,600)));
}
const lampInsets=[];
for (const placement of placements) {
  const mesh = city.getObjectByName(placement.name), p = mesh.getWorldPosition(new THREE.Vector3());
  if(isLegacySidewalkProp(mesh))continue;
  assertGround(p, sidewalk, 'Relocated ' + placement.name);
  let bottom = Infinity;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    bottom = Math.min(bottom, vertex.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld).length());
  }
  assert.ok(Math.abs(bottom - (602 + 2.6 / 3)) < .2, 'Furniture base must follow the new sidewalk: ' + placement.name);
  const base=[];
  for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    const v=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);
    if(v.length()<bottom+.2){assertGround(v,sidewalk,'Lamp base on paving '+placement.name);base.push(v);}
  }
  assert.ok(base.length);
  const centre=base.reduce((v,p)=>v.add(p),new THREE.Vector3()).divideScalar(base.length).setLength(600);
  const closest=new THREE.Vector3();
  const inset=Math.min(...outerEdgeSegments.map(edge=>edge.closestPointToPoint(centre,true,closest).distanceTo(centre)));
  assert.ok(inset>2.5&&inset<3.8,`${placement.name}: lamp inset ${inset}`);
  lampInsets.push(inset);
}
assert.equal(lampInsets.length,168);
console.log(JSON.stringify({ junctions: 10, roundedCorners: 30, corridors: 15, checkedFaces,
  reversed, invalid, roadChecks, walkChecks, minPaintGap: minGap, maxPaintGap: maxGap,
  relocatedFurniture: placements.length, lampInsetRange:[Math.min(...lampInsets),Math.max(...lampInsets)], mappedCurbTriangles, heightChecks, grassCurbChecks, result: 'PASS' }, null, 2));
