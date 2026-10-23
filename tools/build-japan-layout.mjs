import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {loadCity} from './load-city.mjs';
import {buildRoundedJunctions} from '../rounded-junctions.js';
import {createRoadQuery} from './road-plan-utils.mjs';
import {installTestTerrain} from './install-test-terrain.mjs';
import {createLakeside,lakeMetric} from '../lakeside.js';
import {reduceSceneDensity} from '../scene-density.js';
import {installBuildingRoadLayout} from '../building-road-layout.js';
import {createCollisionWorld,footprintBlocked} from '../collision-world.js';
import {installJunctionFurniture} from '../road-geometry.js';
import {decodeJapanAssets,installJapanBuildings} from '../japan-assets.js';
const read=p=>JSON.parse(fs.readFileSync(p));
const {city,road}=loadCity(),plan=buildRoundedJunctions(road),onRoad=createRoadQuery(plan);
installTestTerrain(city);createLakeside(city);
installJunctionFurniture(city,read('assets/junction-furniture-v4.json'));
reduceSceneDensity(city);
installBuildingRoadLayout(city,read('assets/building-road-layout-v1.json'));
const manifest=read('assets/japan/buildings-v1.json');
const variants=decodeJapanAssets(fs.readFileSync('assets/japan/buildings-v1.bin'),manifest);
const geometries=variants.map(v=>v.near);
city.updateMatrixWorld(true);
const buildings=[];city.traverse(m=>{if(m.isMesh&&/^Bld_/.test(m.name))buildings.push({name:m.name,original:m.getWorldPosition(new T.Vector3())})});
buildings.sort((a,b)=>a.name.localeCompare(b.name));
buildings.forEach((b,i)=>{b.variant=i%variants.length;b.scale=b.variant<5?2.4:3.0;b.rx=manifest.variants[b.variant].size[0]*b.scale/2;b.ry=manifest.variants[b.variant].size[2]*b.scale/2;b.diag=Math.hypot(b.rx,b.ry);b.name='Bld_Japan_'+String(i).padStart(4,'0')});
for(const b of buildings) {
 const pos=geometries[b.variant].attributes.position;
 b.front=-Infinity;
 for(let i=0;i<pos.count;i++) if(pos.getY(i)*b.scale<=5.4)
  b.front=Math.max(b.front,pos.getZ(i)*b.scale);
}
const terrain=city.getObjectByName('Planet');terrain.material=new T.MeshBasicMaterial({side:T.DoubleSide});
const occupied=[],placements=[],failures=[],ray=new T.Raycaster(),temp=new T.Vector3();
for(const b of buildings.slice().sort((a,b)=>b.diag-a.diag||a.name.localeCompare(b.name))){
 const candidates=[];
 for(const [ci,c] of plan.corridors.entries())for(const sign of [-1,1]){
  // Align the actual foundation/entrance, not a roof-inclusive bounding box.
  // Add tangent angles so the front edge follows the spherical street edge.
  const offset=600*Math.tan(Math.atan((c.arm.outer+.15)/600)+Math.atan(b.front/600)),margin=(b.rx+8)/600;
  for(let s=c.start+margin;s<c.end-margin;s+=5/600){
   const p=c.at(s,sign*offset,600);candidates.push({p,s,sign,c,ci,score:p.distanceToSquared(b.original)});
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 let chosen=null;
 for(const cand of candidates){
  const {p,c,s}=cand,up=p.clone().normalize();if(lakeMetric(p)<1.4)continue;
  // Keep the existing stair towers and their sidewalk approaches clear.
  if([0,7,13,14].includes(cand.ci) && Math.abs(s-(c.start+c.end)/2)*600 < b.rx+26)continue;
  const forward=c.at(s,0,600).sub(p).projectOnPlane(up).normalize();
  const right=new T.Vector3().crossVectors(up,forward).normalize();
  const corners=[];for(const x of [-b.rx,0,b.rx])for(const z of [-b.ry,0,b.front])corners.push(p.clone().addScaledVector(right,x).addScaledVector(forward,z));
  if(corners.some(q=>onRoad(q,true)||lakeMetric(q)<1.25))continue;
  if(occupied.some(o=>{const d=o.p.clone().sub(p);if(d.length()>b.diag+o.diag+4)return false;return [right,forward,o.right,o.forward].every(axis=>Math.abs(d.dot(axis))<b.rx*Math.abs(right.dot(axis))+b.ry*Math.abs(forward.dot(axis))+o.rx*Math.abs(o.right.dot(axis))+o.ry*Math.abs(o.forward.dot(axis))+3)}))continue;
  ray.set(up.clone().multiplyScalar(900),up.clone().negate());const hit=ray.intersectObject(terrain,false)[0];if(!hit||hit.point.length()>605)continue;
  // A tangent foundation meets the sphere at the centre; bury its underside
  // slightly to prevent a bright floating seam along the low paving slab.
  p.setLength(hit.point.length()-.08);
  const rotation=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right,up,forward));
  chosen={...cand,rotation,right,forward};break;
 }
 if(!chosen){failures.push(b.name);continue;}
 const {p,rotation,right,forward}=chosen;
 placements.push({name:b.name,variant:b.variant,position:p.toArray(),quaternion:rotation.toArray(),scale:b.scale,corridor:chosen.ci,s:chosen.s,sign:chosen.sign});
 occupied.push({...b,p:p.clone(),right,forward});
}
console.log({buildings:buildings.length,placed:placements.length,failures});
if(failures.length)throw new Error('Buildings need more frontage');
installJapanBuildings(city,variants,{material:new T.MeshBasicMaterial()},placements);
const world=createCollisionWorld(city),houses=world.shapes.filter(s=>/^Bld_/.test(s.name));
const adjustments=[],colliders=world.shapes.filter(s=>/^(Tree|Rock)_/.test(s.name));
for(const shape of colliders){
 if(!houses.some(h=>footprintBlocked(h,shape.up,4)))continue;
 const mesh=city.getObjectByName(shape.name),original=mesh.getWorldPosition(new T.Vector3()),up=original.clone().normalize();
 const east=new T.Vector3(1,0,0).projectOnPlane(up).normalize(),north=new T.Vector3().crossVectors(up,east);
 let target=null;
 outer:for(let d=12;d<=150;d+=6)for(let k=0;k<32;k++){
  const v=original.clone().addScaledVector(east,d*Math.cos(k*Math.PI/16)).addScaledVector(north,d*Math.sin(k*Math.PI/16)).normalize();
  if(onRoad(v,true)||lakeMetric(v.clone().multiplyScalar(600))<1.5||houses.some(h=>footprintBlocked(h,v,10)))continue;
  if(colliders.some(o=>o!==shape&&v.distanceTo(o.up)*600<10)||adjustments.some(o=>v.distanceTo(new T.Vector3().fromArray(o.up))*600<10))continue;
  ray.set(v.clone().multiplyScalar(900),v.clone().negate());const hit=ray.intersectObject(terrain,false)[0];if(!hit)continue;
  target=v.multiplyScalar(hit.point.length());break outer;
 }
 if(!target)throw new Error('Cannot relocate '+shape.name);
 const rot=new T.Quaternion().setFromUnitVectors(up,target.clone().normalize()),matrix=new T.Matrix4().makeRotationFromQuaternion(rot).multiply(mesh.matrixWorld);
 let bottom=Infinity;for(let i=0;i<mesh.geometry.attributes.position.count;i++)bottom=Math.min(bottom,temp.fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(matrix).length());
 const shift=target.clone().normalize().multiplyScalar(target.length()-bottom);matrix.elements[12]+=shift.x;matrix.elements[13]+=shift.y;matrix.elements[14]+=shift.z;
 matrix.premultiply(mesh.parent.matrixWorld.clone().invert());const pos=new T.Vector3(),quat=new T.Quaternion(),scale=new T.Vector3();matrix.decompose(pos,quat,scale);
 adjustments.push({name:shape.name,position:pos.toArray(),quaternion:quat.toArray(),scale:scale.toArray(),up:target.clone().normalize().toArray()});
}
fs.writeFileSync('assets/japan/building-layout-v1.json',JSON.stringify(placements));
fs.writeFileSync('assets/japan/landscape-layout-v1.json',JSON.stringify(adjustments));
console.log('Relocated landscape props:',adjustments.length);
