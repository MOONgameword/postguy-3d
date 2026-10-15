import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {loadCity} from './load-city.mjs';
import {buildRoundedJunctions} from '../rounded-junctions.js';
import {decodeRoadGeometry} from '../road-geometry.js';
const {road}=loadCity(),plan=buildRoundedJunctions(road);
const data=fs.readFileSync(new URL('../assets/roads-rounded-v10.bin',import.meta.url));
const geo=decodeRoadGeometry(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
function materialMesh(name){
 const group=geo.groups.find(g=>road.material[g.materialIndex].name===name),g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(geo.attributes.position.array.slice(group.start*3,(group.start+group.count)*3),3));
 g.applyMatrix4(road.matrixWorld);const mesh=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld();return mesh;
}
const paint=materialMesh('City_RoadLine'),asphalt=materialMesh('City_Road'),ray=new T.Raycaster();
const hit=(mesh,p)=>{ray.set(new T.Vector3(),p.clone().normalize());return ray.intersectObject(mesh,false);};
assert.equal(plan.crosswalks.length,26);
for(const [index,j] of plan.junctions.entries())assert.equal(plan.crosswalks.filter(c=>c.junction===index).length,j.arms.length>=3?j.arms.length:0);
let samples=0,minGap=Infinity,maxGap=-Infinity;
for(const crosswalk of plan.crosswalks){
 const road=plan.corridors[crosswalk.corridor];
 const spacing=(2*crosswalk.width-10)/crosswalk.stripes;
 for(let stripe=0;stripe<crosswalk.stripes;stripe++)for(const t of [.15,.5,.85]){
   const p=road.at(crosswalk.from+(crosswalk.to-crosswalk.from)*t,-crosswalk.width+5+stripe*spacing+spacing*.26,602);
   const a=hit(asphalt,p),b=hit(paint,p);assert.ok(a.length&&b.length,'Every crossing stripe must sit on asphalt');
   const gap=b[0].distance-a[0].distance;minGap=Math.min(minGap,gap);maxGap=Math.max(maxGap,gap);
   assert.ok(gap>.010&&gap<.015,'Crosswalk must conform to the underlying triangle');samples++;
 }
 for(let stripe=0;stripe<crosswalk.stripes-1;stripe++){
   const p=road.at((crosswalk.from+crosswalk.to)/2,-crosswalk.width+5+stripe*spacing+spacing*.76,602);
   assert.equal(hit(paint,p).length,0,'No old lane paint may fill crosswalk gaps');
 }
}
// Probe the baked centre paint and the empty gap, across every road corridor.
let centreDashes=0,centreGaps=0;
for(const c of plan.corridors){
 const intervals=[];let from=c.start;
 for(const x of c.crossings.slice().sort((a,b)=>a.from-b.from)){
  if(x.from-1/600>from)intervals.push([from,x.from-1/600]);
  from=x.to+1/600;
 }
 if(from<c.end)intervals.push([from,c.end]);
 for(const [a,b] of intervals)for(let s=a;s+13.5/600<b;s+=18/600){
  const p=c.at(s+4.5/600,0,602),gap=c.at(s+13.5/600,0,602);
  const asphaltHit=hit(asphalt,p),paintHit=hit(paint,p);
  assert.ok(asphaltHit.length&&paintHit.length,'White centre dash on every road');
  assert.equal(hit(paint,gap).length,0,'Centre dash must have an unpainted gap');
  assert.ok(Math.abs(paintHit[0].distance-asphaltHit[0].distance-.012)<.001,'Centre dash follows asphalt');
  centreDashes++;centreGaps++;
 }
}
console.log(JSON.stringify({result:'PASS',intersections:8,crosswalks:26,stripes:plan.crosswalks.reduce((n,x)=>n+x.stripes,0),samples,minGap,maxGap,centreDashes,centreGaps},null,2));
