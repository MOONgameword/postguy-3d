import { installTestTerrain } from './install-test-terrain.mjs';
import { replaceStylizedTrees } from '../stylized-trees.js';
import {loadTestTrunk} from './load-test-trunk.mjs';
import { roundSceneRocks } from '../rounded-rocks.js';
import * as T from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';
import { createCollisionWorld, sweepSphere } from '../collision-world.js';
import { loadCity } from './load-city.mjs';
import { buildRoundedJunctions } from '../rounded-junctions.js';
import { createLakeside, lakePoint, isLakeWater } from '../lakeside.js';
import { reduceSceneDensity } from '../scene-density.js';
import { raiseGrassLevel } from '../grass-level.js';
import { installBuildingRoadLayout } from '../building-road-layout.js';
import { installJunctionFurniture } from '../road-geometry.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const mat = new T.MeshBasicMaterial();
const dir = (x,z) => new T.Vector3(x,600,z).normalize();
function fixture(geometry,name='Bld_Test',rotation=0){const mesh=new T.Mesh(geometry,mat);mesh.name=name;mesh.position.set(0,600,0);mesh.rotation.y=rotation;const root=new T.Group();root.add(mesh);return {root,mesh};}
let cases=0;
// A rotated narrow facade must not fill its rectangular envelope.
{
  const {root}=fixture(new T.BoxGeometry(2,20,40).translate(0,10,0),'Bld_Diagonal',Math.PI/4);
  const world=createCollisionWorld(root);
  assert.equal(world.blocked(dir(12,-12),1.26),false);
  assert.equal(world.blocked(dir(10,10),1.26),true);
  assert.equal(world.blocked(dir(0,0)),true);
  cases++;
}
// Low tree crown starts above head height; only the trunk blocks the player.
{
  const geo=mergeGeometries([new T.CylinderGeometry(.6,.8,15,8).translate(0,7.5,0).toNonIndexed(),new T.ConeGeometry(12,20,8).translate(0,17,0).toNonIndexed()]);
  const {root}=fixture(geo,'Tree_Test');const world=createCollisionWorld(root);
  assert.equal(world.blocked(dir(5,0),1.26),false);
  assert.equal(world.blocked(dir(0,0)),true);
  cases++;
}
// Disconnected supports and high arch beams leave the real opening passable.
{
  const geo=mergeGeometries([new T.BoxGeometry(2,10,3).translate(-6,5,0),new T.BoxGeometry(2,10,3).translate(6,5,0),new T.BoxGeometry(14,2,3).translate(0,11,0)]);
  const {root}=fixture(geo,'Bld_Arch');const world=createCollisionWorld(root);
  assert.equal(world.blocked(dir(0,0),1.26),false);
  assert.equal(world.blocked(dir(6,0)),true);
  cases++;
}
// Latitude poles and the longitude seam use exactly the same physical footprint.
{
  for(const up of[new T.Vector3(0,1,0),new T.Vector3(0,-1,0),new T.Vector3(.001,.1,-1).normalize()]){
    const {root,mesh}=fixture(new T.BoxGeometry(2,10,30).translate(0,5,0));
    mesh.position.copy(up).multiplyScalar(600);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),up);
    const world=createCollisionWorld(root),point=(x,z)=>new T.Vector3(x,0,z).applyQuaternion(mesh.quaternion).add(mesh.position).normalize();
    assert.equal(world.blocked(point(5,0),1.26),false);assert.equal(world.blocked(point(0,10),1.26),true);
  }
  cases++;
}
// Fast movement stops at a thin wall instead of testing only the far endpoint.
{
  const {root}=fixture(new T.BoxGeometry(80,10,.4).translate(0,5,10));const world=createCollisionWorld(root);
  const start=new T.Quaternion(),out=new T.Quaternion();
  const blocked=(q,r)=>world.blocked(new T.Vector3(0,1,0).applyQuaternion(q),r);
  assert.equal(sweepSphere(start,out,30,1.26,600,blocked),false);
  const p=new T.Vector3(0,600,0).applyQuaternion(out);
  assert.ok(p.z>5&&p.z<10,'Keep the partial safe move without tunneling');
  assert.equal(blocked(out,1.26),false);
  cases++;
}
// An actual corridor remains traversable with a finite-size player.
{
  const geo=mergeGeometries([new T.BoxGeometry(1,10,50).translate(-3,5,15),new T.BoxGeometry(1,10,50).translate(3,5,15)]);
  const {root}=fixture(geo);const world=createCollisionWorld(root),out=new T.Quaternion();
  assert.equal(sweepSphere(new T.Quaternion(),out,30,1.26,600,(q,r)=>world.blocked(new T.Vector3(0,1,0).applyQuaternion(q),r)),true);
  cases++;
}
// Placed props use circles: diagonal empty corners remain open.
{
  const world=createCollisionWorld(new T.Group());world.addDisc(new T.Vector3(0,1,0),2);
  assert.equal(world.blocked(dir(1.8,1.8)),false);assert.equal(world.blocked(dir(0,0)),true);cases++;
}
const {city,road,center}=loadCity();
const plan=buildRoundedJunctions(road);
installJunctionFurniture(city,JSON.parse(fs.readFileSync(new URL('../assets/junction-furniture-v3.json',import.meta.url))));
installTestTerrain(city);createLakeside(city);
reduceSceneDensity(city);
installBuildingRoadLayout(city,JSON.parse(fs.readFileSync('assets/building-road-layout-v1.json')));
installBuildingRoadLayout(city,JSON.parse(fs.readFileSync('assets/roadside-props-v1.json')));
raiseGrassLevel(city);
replaceStylizedTrees(city,{trunkAsset:await loadTestTrunk()});
roundSceneRocks(city);
const world=createCollisionWorld(city,center);let roadSamples=0;const blocked=[];
for(const c of plan.corridors)for(let k=0;k<=20;k++){
  const s=c.start+(c.end-c.start)*k/20;
  const p=c.j.up.clone().multiplyScalar(Math.cos(s)).addScaledVector(c.arm.direction,Math.sin(s)).multiplyScalar(602).sub(center).normalize();
  const names=world.explain(p,2.1);if(names.length)blocked.push({corridor:plan.corridors.indexOf(c),k,names});roadSamples++;
}
assert.deepEqual(blocked,[],'Existing street centerlines must remain passable');
let traversedCorridors=0,turnSamples=0;
const frame=(up,forward)=>{const f=forward.clone().addScaledVector(up,-forward.dot(up)).normalize();return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(up,f).normalize(),up,f));};
for(const c of plan.corridors){
  const at=s=>c.j.up.clone().multiplyScalar(Math.cos(s)).addScaledVector(c.arm.direction,Math.sin(s)).multiplyScalar(602).sub(center).normalize();
  const start=at(c.start),end=at(c.end),q=frame(start,end),out=new T.Quaternion();
  const distance=Math.acos(T.MathUtils.clamp(start.dot(end),-1,1))*600;
  assert.equal(sweepSphere(q,out,distance,2.1,600,(q,r)=>world.blocked(new T.Vector3(0,1,0).applyQuaternion(q),r)),true,'Complete corridor traversal');
  assert.ok(new T.Vector3(0,1,0).applyQuaternion(out).distanceTo(end)<1e-6);
  traversedCorridors++;
}
for(const j of plan.junctions)for(const sector of j.sectors)for(const v of plan.sectorPath(sector,sector.a.half/2,sector.b.half/2)){
  const p=plan.world(j,v,602).sub(center).normalize();
  assert.deepEqual(world.explain(p,2.1),[],'Rounded turn must stay passable');turnSamples++;
}
for(let z=40;z<=98;z+=2){const p=lakePoint(28,z);assert.equal(isLakeWater(p),false);assert.equal(world.blocked(p.sub(center).normalize(),1.26),false,'Dock must stay clear');}
assert.equal(isLakeWater(lakePoint(0,0)),true);
assert.equal(isLakeWater(lakePoint(0,91)),false,'Visible dry shore must remain open');
console.log(JSON.stringify({result:'PASS',regressionCases:cases,roadSamples,traversedCorridors,turnSamples,dockSamples:30,...world.stats},null,2));
