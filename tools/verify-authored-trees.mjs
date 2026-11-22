import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {loadCity} from './load-city.mjs';
import {installTestTerrain} from './install-test-terrain.mjs';
import {createLakeside} from '../lakeside.js';
import {reduceSceneDensity} from '../scene-density.js';
import {raiseGrassLevel} from '../grass-level.js';
import {decodeAuthoredTree,withLeafCards,installAuthoredTrees} from '../authored-trees.js';
import {buildFootprint,footprintBlocked} from '../collision-world.js';
const original=decodeAuthoredTree(fs.readFileSync(new URL('../assets/trees/tree2-v1.bin',import.meta.url)),JSON.parse(fs.readFileSync(new URL('../assets/trees/tree2-v1.json',import.meta.url))));
const asset=withLeafCards(original);
assert.equal(asset.near.attributes.position.count/3,1128+460*2);
assert.ok(asset.far.attributes.position.count<asset.near.attributes.position.count*.5);
assert.equal(asset.trunk,original.trunk);assert.deepEqual(asset.palettes,original.palettes);
for(const geometry of [asset.near,asset.far]){
  const uv=geometry.attributes.uv,mask=geometry.attributes.outlineAllowed;
  for(let i=0;i<uv.count;i++){
    if(mask.getX(i)>1.5)assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1);
    else assert.equal(uv.getX(i),-1);
  }
}
const {city}=loadCity();installTestTerrain(city);createLakeside(city);reduceSceneDensity(city);raiseGrassLevel(city);city.updateMatrixWorld(true);
const before=new Map(),untouched=new Map(),p=new T.Vector3();
city.traverse(o=>{
 if(!o.isMesh)return;
 if(!/^Tree_/.test(o.name)){untouched.set(o,{matrix:o.matrixWorld.clone(),geometry:o.geometry,material:o.material});return;}
 const pivot=o.getWorldPosition(new T.Vector3()),up=pivot.clone().normalize();let bottom=Infinity;
 for(let i=0;i<o.geometry.attributes.position.count;i++)bottom=Math.min(bottom,p.fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld).dot(up));
 before.set(o.name,{up,bottom});
});
const stats=installAuthoredTrees(city,asset,{leafMask:new T.Texture()});assert.equal(stats.trees,before.size);assert.ok(stats.trees>0);
city.traverse(o=>{
 if(!before.has(o.name))return;
 const old=before.get(o.name),root=o.getWorldPosition(new T.Vector3());
 assert.ok(Math.abs(root.dot(old.up)-(old.bottom-.12))<1e-4);
 assert.ok(new T.Vector3(0,1,0).transformDirection(o.matrixWorld).dot(old.up)>.99999);
 assert.equal(o.userData.treeAsset,'tree2-v1');assert.ok(o.material.userData.outlineMask);
 assert.ok(o.customDepthMaterial?.isMeshDepthMaterial);assert.equal(o.material.side,T.DoubleSide);
 assert.ok(o.userData.collisionGeometry.attributes.outlineAllowed.array.every(x=>x===1));
 for(const g of [o.userData.treeLod.near,o.userData.treeLod.far]){
  assert.ok(g.attributes.outlineAllowed.array.includes(2));
  for(const a of Object.values(g.attributes))assert.ok(a.array.every(Number.isFinite));
 }
 const footprint=buildFootprint(o);assert.ok(footprint);
 assert.ok(footprintBlocked(footprint,root.clone().normalize()),'Trunk blocks movement');
 const side=new T.Vector3(1,0,0).addScaledVector(old.up,-old.up.x).normalize();
 assert.equal(footprintBlocked(footprint,root.clone().addScaledVector(side,8).normalize()),false,'Canopy does not block walking');
});
for(const [o,old] of untouched){assert.deepEqual(o.matrixWorld.elements,old.matrix.elements);assert.equal(o.geometry,old.geometry);assert.equal(o.material,old.material);}
console.log(JSON.stringify({result:'PASS',...stats,untouchedMeshes:untouched.size},null,2));
