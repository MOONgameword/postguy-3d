import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { loadCity } from './load-city.mjs';
import { buildRoundedJunctions } from '../rounded-junctions.js';
import { installRoadGeometry,decodeRoadGeometry,installJunctionFurniture } from '../road-geometry.js';
import { installBuildingRoadLayout } from '../building-road-layout.js';
import { installTestBuildings } from './install-test-buildings.mjs';
import { createTrafficLanes } from '../traffic-lanes.js';
import { createRoadQuery } from './road-plan-utils.mjs';
import { installTestTerrain } from './install-test-terrain.mjs';
import { createLakeside,lakeMetric } from '../lakeside.js';
import { reduceSceneDensity } from '../scene-density.js';
import { raiseGrassLevel } from '../grass-level.js';
import { createCollisionWorld,footprintBlocked } from '../collision-world.js';
import { replaceStylizedTrees } from '../stylized-trees.js';
import { loadTestTrunk } from './load-test-trunk.mjs';
import { roundSceneRocks } from '../rounded-rocks.js';

const read=n=>JSON.parse(fs.readFileSync('assets/'+n));
const {city,road,center}=loadCity(),plan=buildRoundedJunctions(road),query=createRoadQuery(plan);
const bytes=fs.readFileSync('assets/roads-rounded-v16.bin');
installRoadGeometry(city,decodeRoadGeometry(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
installTestTerrain(city);installJunctionFurniture(city,read('junction-furniture-v4.json'));
createLakeside(city);reduceSceneDensity(city);
const {placements,stats}=installTestBuildings(city);
assert.deepEqual(stats,{removed:276,installed:276,variants:21});
raiseGrassLevel(city);replaceStylizedTrees(city,{trunkAsset:await loadTestTrunk()});roundSceneRocks(city);
const world=createCollisionWorld(city,center),lanes=createTrafficLanes(read('traffic-lanes-v1.json'),center);
assert.equal(plan.corridors.filter(c=>c.arm.half===35).length,4);
assert.equal(plan.corridors.filter(c=>c.arm.half===18).length,11);
assert.deepEqual(plan.mainPath,[4,0,3,5,9]);
let samples=0,bodyChecks=0;const obstacles=new Map();
const p=new T.Vector3(),q=new T.Quaternion(),u=new T.Vector3(),f=new T.Vector3(),right=new T.Vector3();
for(const path of lanes.paths) {
  assert.ok(path.next.length);
  for(const next of path.next) assert.ok(path.points.at(-1).distanceTo(lanes.paths[next].points[0])<.001,'Continuous lane transition');
  for(let s=0;s<path.length;s+=3) {
    lanes.sample({path:path.id,distance:s},p,q);u.set(0,1,0).applyQuaternion(q);f.set(0,0,1).applyQuaternion(q);right.set(1,0,0).applyQuaternion(q);
    for(const x of [-4.5,0,4.5]) for(const z of [-9,0,9]) {
      const probe=p.clone().addScaledVector(right,x).addScaledVector(f,z);
      assert.ok(query(probe),`Body outside asphalt on ${path.id} @ ${s}`);bodyChecks++;
      for(const name of world.explain(probe.sub(center).normalize(),.4)) obstacles.set(name,(obstacles.get(name)||0)+1);
    }
    samples++;
  }
}
// Foundations must touch the curb without blocking pedestrians. Upper awnings
// may project over the sidewalk; every vertex must still stay off the asphalt.
let buildingChecks=0,buildingIntrusions=[],frontageGaps=[];
for(const item of placements) {
  const m=city.getObjectByName(item.name),pos=m.geometry.attributes.position;
  const pivot=m.getWorldPosition(new T.Vector3()),up=pivot.clone().normalize();
  const forward=new T.Vector3(0,0,1).transformDirection(m.matrixWorld);
  const roadward=plan.corridors[item.corridor].at(item.s,0,600).sub(pivot).projectOnPlane(up).normalize();
  assert.ok(forward.dot(roadward)>.9999,'Every entrance facade must face its street');
  const corridor=plan.corridors[item.corridor];
  let frontGap=Infinity;
  for(let i=0;i<pos.count;i++) {
    const v=new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld);
    const low=pos.getY(i)*item.scale<=5.4;
    if(query(v,low)||lakeMetric(v)<1.1){buildingIntrusions.push(item.name);break;}
    if(low){
      const lateral=v.clone().normalize().dot(corridor.side)*item.sign;
      frontGap=Math.min(frontGap,600*lateral/Math.sqrt(1-lateral*lateral)-corridor.arm.outer);
    }
  }
  assert.ok(frontGap>=0 && frontGap<.4, `${item.name}: foundation gap ${frontGap}`);
  frontageGaps.push(frontGap);
  buildingChecks++;
}
const treeOverlaps=world.shapes.filter(s=>/^Tree_/.test(s.name)&&world.shapes.some(b=>/^Bld_/.test(b.name)&&footprintBlocked(b,s.up,2))).map(s=>s.name);
console.log(JSON.stringify({treeOverlaps,samples,bodyChecks,buildingChecks,buildingIntrusions,frontageGapRange:[Math.min(...frontageGaps),Math.max(...frontageGaps)],obstacles:[...obstacles]},null,2));
assert.deepEqual(buildingIntrusions,[]);
assert.equal(obstacles.size,0,'All lane envelopes must be clear of scene collision geometry');

assert.deepEqual(treeOverlaps,[]);
