import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {createToonVehicleFleet} from '../toon-vehicles.js';
import {mergeGeometries} from '../vendor/utils/BufferGeometryUtils.js';
const manifest=JSON.parse(fs.readFileSync('assets/vehicles/cars-v1.json'));
const texture=new T.Texture();texture.image={width:4096,height:4096};
const fleet=createToonVehicleFleet(fs.readFileSync('assets/vehicles/cars-v1.bin'),manifest,texture);
assert.equal(fleet.geometries.length,24);
assert.equal(new Set(manifest.variants.map(v=>v.sourceInstance)).size,24);
for(const [i,g] of fleet.geometries.entries()){
 const size=g.boundingBox.getSize(new T.Vector3());
 assert.ok(size.x<=8&&size.z<=17,'All cars fit existing traffic envelope');
 assert.ok(size.y>2&&size.y<8,'Models are upright');
 assert.ok(Math.abs(g.boundingBox.min.y)<1e-5,'Tyres touch ground');
 assert.ok(manifest.variants[i].parts.filter(n=>n.startsWith('Wheel_')).length>=4,'Wheels are included');
 for(const attribute of Object.values(g.attributes))assert.ok([...attribute.array].every(Number.isFinite));
 assert.ok(g.attributes.inkEdge,'Cartoon surface outline baked');
 assert.equal(g.attributes.buildingTile.itemSize,4,'Correct atlas tile preserved');
}
const cycle=Array.from({length:48},()=>fleet.next().userData.vehicleName);
assert.equal(new Set(cycle.slice(0,24)).size,24,'No models omitted from rotation');
assert.deepEqual(cycle.slice(0,24),cycle.slice(24),'All variants recycle');
const merged=mergeGeometries(fleet.geometries.map(g=>g.clone()));
assert.ok(merged&&merged.attributes.inkEdge&&merged.attributes.buildingTile,'Parked batch keeps atlas and ink');
assert.equal(merged.attributes.position.count,manifest.variants.reduce((n,v)=>n+v.near.count,0));
const code=fs.readFileSync('game.js','utf8');
assert.ok(!code.includes('car-city.fbx'),'Old car source no longer loaded');
console.log({result:'PASS',variants:24,triangles:merged.attributes.position.count/3,maximumWidth:Math.max(...manifest.variants.map(v=>v.size[0])),maximumLength:Math.max(...manifest.variants.map(v=>v.size[2]))});
