import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {collectDeliverySites,createDeliveryPicker} from '../delivery-sites.js';
import {loadCity} from './load-city.mjs';
import {installTestJapanBuildings} from './install-test-japan.mjs';
import {createCollisionWorld} from '../collision-world.js';
import {buildRoundedJunctions} from '../rounded-junctions.js';
import {createRoadQuery} from './road-plan-utils.mjs';
const {city,road,center}=loadCity();installTestJapanBuildings(city);
const world=createCollisionWorld(city,center),roadAt=createRoadQuery(buildRoundedJunctions(road));
const project=p=>p.sub(center).normalize().multiplyScalar(602).add(center);
const sites=collectDeliverySites(city,{center,project,accept:(site,forward)=>{
  const up=site.position.clone().sub(center).normalize();
  if(!roadAt(site.position,true)||roadAt(site.position)||world.blocked(up,2.5))return false;
  for(let d=2;d<=24;d+=2){
    const p=project(site.position.clone().addScaledVector(forward,d));
    if(world.blocked(p.clone().sub(center).normalize(),1.5))return false;
    if(roadAt(p))return true;
  }
  return false;
}});
assert.ok(sites.length>40,`Enough doorsteps: ${sites.length}`);
assert.equal(new Set(sites.map(s=>s.id)).size,sites.length);
let seed=99;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const distance=(a,b)=>a.clone().sub(center).angleTo(b.clone().sub(center))*602;
const picker=createDeliveryPicker(sites,{distance,random});
let origin=sites[0].position,previous=null;const recent=[],lengths=[];
for(let i=0;i<100;i++){
  const selected=picker.next(origin);
  assert.ok(!recent.includes(selected.id),'Recent doorsteps must not repeat');
  assert.ok(selected.distance>=100,'Avoid immediately completing the next phase');
  if(previous!==null)assert.ok(Math.abs(selected.distance-previous)>=45,'Vary successive travel distances');
  recent.push(selected.id);if(recent.length>12)recent.shift();
  lengths.push(selected.distance);previous=selected.distance;origin=selected.position;
}
const blocked=new Set([sites[0].id]);
const filtered=createDeliveryPicker(sites,{distance,random,available:s=>!blocked.has(s.id)});
for(let i=0;i<20;i++)assert.ok(!blocked.has(filtered.next(origin).id));
const disc=world.addDisc(sites[0].position.clone().sub(center),1.5,'ActiveMailbox');
disc.up.copy(sites[1].position).sub(center).normalize();
assert.ok(!world.explain(sites[0].position.clone().sub(center).normalize()).includes('ActiveMailbox'),'Moving mailbox removes old collision');
assert.ok(world.explain(disc.up).includes('ActiveMailbox'));
console.log(JSON.stringify({result:'PASS',doorsteps:sites.length,tasks:100,range: [Math.round(Math.min(...lengths)),Math.round(Math.max(...lengths))]}));
