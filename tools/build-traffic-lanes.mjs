import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import { loadCity } from './load-city.mjs';
import { buildRoundedJunctions } from '../rounded-junctions.js';
import { createRoadQuery } from './road-plan-utils.mjs';

const {road}=loadCity(),plan=buildRoundedJunctions(road),onRoad=createRoadQuery(plan);
const paths=[],lanes=[];
function addPath(points,metadata) {
  const id=paths.length;
  paths.push({id,...metadata,points:points.map(p=>p.toArray().map(n=>+n.toFixed(5))),next:[]});
  return id;
}
for(const [ci,c] of plan.corridors.entries()) for(const sign of [1,-1]) {
  const count=c.arm.half===35?2:1;
  for(let lane=0;lane<count;lane++) {
    const offset=count===2?8.75+17.5*lane:9;
    const n=Math.ceil((c.end-c.start)*602/2),points=[];
    for(let k=0;k<=n;k++) {
      const t=sign===1?k/n:1-k/n;
      points.push(c.at(c.start+(c.end-c.start)*t,sign*offset,602));
    }
    const from=sign===1?c.j:c.other,to=sign===1?c.other:c.j;
    const startArm=sign===1?c.arm:c.reverse,endArm=sign===1?c.reverse:c.arm;
    const id=addPath(points,{kind:'lane',half:c.arm.half,offset,corridor:ci,from:plan.junctions.indexOf(from),to:plan.junctions.indexOf(to),lane});
    lanes.push({id,c,from,to,startArm,endArm,offset,points});
  }
}
const point2=(j,p)=>new T.Vector2(p.dot(j.x),p.dot(j.y)).multiplyScalar(600/p.dot(j.up));
function safe(points) {
  for(let i=0;i<points.length;i+=2) {
    const p=points[i],up=p.clone().normalize();
    const f=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize();
    const right=new T.Vector3().crossVectors(up,f).normalize();
    for(const x of [-6.5,0,6.5]) for(const z of [-11,0,11])
      if(!onRoad(p.clone().addScaledVector(right,x).addScaledVector(f,z))) return false;
  }
  return true;
}
let missing=[];
for(const incoming of lanes) {
  const j=incoming.to;
  for(const outgoing of lanes.filter(l=>l.from===j&&l.to!==incoming.from)) {
    // Maintain the lane on the arterial; merge to the sole lane of a side road.
    const destCount=outgoing.c.arm.half===35?2:1;
    if(paths[outgoing.id].lane!==Math.min(paths[incoming.id].lane,destCount-1)) continue;
    const a=point2(j,incoming.points.at(-1)),b=point2(j,outgoing.points[0]);
    let chosen=null;
    for(const factor of [.48,.35,.6,.75,.22,.9]) {
      const handle=a.distanceTo(b)*factor;
      const c1=a.clone().addScaledVector(incoming.endArm.d,-handle);
      const c2=b.clone().addScaledVector(outgoing.startArm.d,-handle);
      const curve=new T.CubicBezierCurve(a,c1,c2,b);
      const n=Math.ceil(curve.getLength()/1.5);
      const points=Array.from({length:n+1},(_,k)=>plan.world(j,curve.getPoint(k/n),602));
      if(safe(points)) { chosen=points;break; }
    }
    if(!chosen) { missing.push([incoming.id,outgoing.id]);continue; }
    const id=addPath(chosen,{kind:'turn',junction:plan.junctions.indexOf(j),fromLane:incoming.id,toLane:outgoing.id});
    paths[id].next=[outgoing.id];paths[incoming.id].next.push(id);
  }
}
for(const lane of lanes) if(!paths[lane.id].next.length) throw new Error('Lane has no safe exit: '+lane.id);
const result={version:1,mainPath:plan.mainPath,body:{halfWidth:4.5,halfLength:9},paths};
fs.writeFileSync('assets/traffic-lanes-v1.json',JSON.stringify(result));
console.log(JSON.stringify({lanes:lanes.length,turns:paths.length-lanes.length,missing,samples:paths.reduce((n,p)=>n+p.points.length,0)}));
