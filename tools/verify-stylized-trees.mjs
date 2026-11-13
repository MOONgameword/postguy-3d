import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {loadCity} from './load-city.mjs';
import {installTestTerrain} from './install-test-terrain.mjs';
import {createLakeside} from '../lakeside.js';
import {reduceSceneDensity} from '../scene-density.js';
import {raiseGrassLevel} from '../grass-level.js';
import {replaceStylizedTrees} from '../stylized-trees.js';
import {buildFootprint,footprintBlocked} from '../collision-world.js';
import {loadTestTrunk} from './load-test-trunk.mjs';
const trunkAsset=await loadTestTrunk();
assert.equal(trunkAsset.geometry.attributes.position.count/3,500);
const {city}=loadCity();installTestTerrain(city);createLakeside(city);reduceSceneDensity(city);raiseGrassLevel(city);
const before=new Map(),p=new T.Vector3();
city.traverse(o=>{if(!o.isMesh||!/^Tree_/.test(o.name))return;const pivot=o.getWorldPosition(new T.Vector3()),up=pivot.clone().normalize();let bottom=Infinity;
for(let i=0;i<o.geometry.attributes.position.count;i++)bottom=Math.min(bottom,p.fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld).dot(up));
before.set(o.name,{up,bottom});});
const stats=replaceStylizedTrees(city,{trunkAsset});assert.equal(stats.trees,before.size);assert.ok(stats.trees>0);
const geometries=new Set();let verified=0;
city.traverse(o=>{if(!o.isMesh||!/^Tree_/.test(o.name))return;
 assert.equal(o.userData.stylizedTree,true);assert.equal(o.material.name,'StylizedTree');geometries.add(o.geometry);
 assert.equal(o.userData.collisionGeometry.attributes.position.count,1500);
 const near=o.userData.treeLod.near,far=o.userData.treeLod.far;
 assert.equal(o.material.userData.outlineMask,true);
 for(const g of [near,far]) {
   const mask=g.attributes.outlineAllowed.array;
   assert.equal(mask.length,g.attributes.position.count);
   assert.ok(mask.slice(0,1500).every(x=>x===1),'Bark keeps its outline');
   assert.ok(mask.slice(1500).every(x=>x===2),'Leaves use whole-canopy outlines only');
 }
 for(const key of ['position','normal','uv','color']) {
   const trunk=o.userData.collisionGeometry.attributes[key].array;
   assert.deepEqual(near.attributes[key].array.slice(0,trunk.length),trunk,'Near trunk matches collision mesh');
   assert.deepEqual(far.attributes[key].array.slice(0,trunk.length),trunk,'Distant trunk matches near trunk');
 }
 const old=before.get(o.name),root=o.getWorldPosition(new T.Vector3());
 assert.ok(Math.abs(root.dot(old.up)-(old.bottom-.12))<.0001,'Preserve original planted base height');
 const axis=new T.Vector3(0,1,0).transformDirection(o.matrixWorld);assert.ok(axis.dot(old.up)>.99999,'Trees grow away from the sphere');
 const footprint=buildFootprint(o);assert.ok(footprint&&footprint.occupied>0);
 assert.ok(footprintBlocked(footprint,root.clone().normalize()),'The trunk must block movement');
 const side=new T.Vector3(1,0,0).addScaledVector(old.up,-old.up.x).normalize();
 assert.equal(footprintBlocked(footprint,root.clone().addScaledVector(side,8).normalize()),false,'Canopy must not form an air wall');
 for(const attr of Object.values(o.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));verified++;
});
assert.ok(geometries.size<=60,'Share reusable tree profiles');
console.log(JSON.stringify({result:'PASS',...stats,verified},null,2));
