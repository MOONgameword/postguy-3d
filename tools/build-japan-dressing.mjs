// Additive art pass. Never writes the building, road or terrain assets.
import fs from 'node:fs';
import {poleSockets} from './japan-pole-sockets.mjs';
import * as T from '../vendor/three.module.js';
import {loadCity} from './load-city.mjs';
import {installTestTerrain} from './install-test-terrain.mjs';
import {installTestJapanBuildings,installTestJapanTrees,loadTestJapan} from './install-test-japan.mjs';
import {buildRoundedJunctions} from '../rounded-junctions.js';
import {decodeRoadGeometry,installRoadGeometry,installJunctionFurniture} from '../road-geometry.js';
import {createRoadQuery} from './road-plan-utils.mjs';
import {createLakeside,lakeMetric} from '../lakeside.js';
import {reduceSceneDensity} from '../scene-density.js';
import {raiseGrassLevel} from '../grass-level.js';
import {createCollisionWorld} from '../collision-world.js';

const read=p=>JSON.parse(fs.readFileSync(p));
const {city,road}=loadCity(),plan=buildRoundedJunctions(road),onRoad=createRoadQuery(plan);
const roads=fs.readFileSync('assets/roads-rounded-v16.bin');installRoadGeometry(city,decodeRoadGeometry(roads));
installTestTerrain(city);installJunctionFurniture(city,read('assets/junction-furniture-v4.json'));
createLakeside(city);reduceSceneDensity(city);
const {placements}=installTestJapanBuildings(city);raiseGrassLevel(city);installTestJapanTrees(city);
const rocks=[];city.traverse(o=>{if(/^Rock_/.test(o.name))rocks.push(o)});rocks.forEach(o=>o.removeFromParent());
const baseCollision=createCollisionWorld(city);
const variants=loadTestJapan('props'),byName=new Map(variants.map(v=>[v.name,v]));
const list=prefix=>variants.map(v=>v.name).filter(n=>n.startsWith('SM_'+prefix));
const cycle=(names,i)=>names[((i%names.length)+names.length)%names.length];
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),Y=V(0,1,0),Z=V(0,0,1);
const ray=new T.Raycaster(),terrain=city.getObjectByName('Planet');terrain.material=new T.MeshBasicMaterial({side:T.DoubleSide});
const wires=[],poleConnections=[];
const records=[],occupied=[],used=new Map(),counts={},rejects={};
const fail=why=>{rejects[why]=(rejects[why]||0)+1;return null;};
const WALK=602+2.6/3;
function groundRadius(p){
 if(onRoad(p,true))return WALK;
 ray.set(p.clone().normalize().multiplyScalar(900),p.clone().normalize().negate());
 return ray.intersectObject(terrain,false)[0]?.point.length()||602.5;
}
function frame(p,forward){const up=p.clone().normalize(),z=forward.clone().projectOnPlane(up).normalize(),x=V().crossVectors(up,z).normalize();return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,up,z));}
function add(name,position,quaternion,scale,category,{ground=false,solid=false,detail=false,allowBuilding=false,allowRoad=false,anchor=null,overlap=false}={}){
 // Shop advertising, freestanding boards and street sign panels are removed.
 if(/^SM_(sign|board_|sticker_|warning_panel|cloth_storefront)/.test(name))return null;
 const v=byName.get(name);if(!v)throw Error('Missing '+name);
 scale=typeof scale==='number'?[scale,scale,scale]:scale;
 const p=position.clone();if(ground)p.setLength(groundRadius(p)+.025);
 const m=new T.Matrix4().compose(p,quaternion,V(...scale));
 let box=v.near.boundingBox;
 if(name.startsWith('SM_utility_pole')){
  // Crossarms overhang the curb overhead; only the actual foot occupies paving.
  box=new T.Box3();const vertices=v.near.attributes.position;
  for(let i=0;i<vertices.count;i++)if(vertices.getY(i)<v.size[1]*.1)box.expandByPoint(V().fromBufferAttribute(vertices,i));
 }
 if(ground){
  const corners=[];for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z])corners.push(V(x,0,z).applyMatrix4(m));
  if(!allowRoad&&corners.some(q=>onRoad(q)))return fail('road');
  if(solid&&corners.some(q=>plan.corridors.some(c=>{
   const u=q.clone().normalize(),s=Math.atan2(u.dot(c.arm.direction),u.dot(c.j.up));
   if(s<c.start||s>c.end)return false;
   const lateral=Math.abs(600*u.dot(c.side)/Math.sqrt(1-u.dot(c.side)**2));
   return lateral>c.arm.half+5.0&&lateral<c.arm.half+10.0;
  })))return fail('walk-clearance');
  if(corners.some(q=>lakeMetric(q)<1.18))return fail('lake');
  const reach=Math.min(v.size[0]*scale[0],v.size[2]*scale[2])*.32;
  if(!allowBuilding&&baseCollision.blocked(p.clone().normalize(),reach))return fail('existing-solid');
  // Sidewalk middle stays open: furniture is restricted to the frontage strip
  // or curbside strip; all bridge stair approaches have an explicit exclusion.
  for(const c of plan.corridors){
   const u=p.clone().normalize(),s=Math.atan2(u.dot(c.arm.direction),u.dot(c.j.up));
   if(s<c.start||s>c.end)continue;
   const lateral=Math.abs(600*u.dot(c.side)/Math.sqrt(1-u.dot(c.side)**2));
   if(lateral<c.arm.outer+3&&[0,7,13,14].includes(plan.corridors.indexOf(c))&&Math.abs(s-(c.start+c.end)/2)*600<29)return fail('bridge');
  }
  if(solid&&!overlap){
   const r=Math.hypot(v.size[0]*scale[0],v.size[2]*scale[2])*.38;
   if(occupied.some(o=>p.distanceToSquared(o.p)<(r+o.r+.12)**2))return fail('prop-spacing');
   occupied.push({p:p.clone(),r});
  }
 }
 const rec={asset:name,position:p.toArray(),quaternion:quaternion.toArray(),scale,category,solid,detail};
 if(anchor)rec.anchor=anchor;if(ground)rec.ground=true;
 records.push(rec);used.set(name,(used.get(name)||0)+1);counts[category]=(counts[category]||0)+1;return rec;
}

const signs=list('signboard_wide'),vertical=list('signboard_vertical'),smallSigns=list('signboard_small'),letters=list('sign_3d'),boards=[...list('board_foldable'),...list('board_digital')];
const plants=[...list('flowerpot'),...list('plants_box')],vending=list('vendingmachine'),trash=[...list('trash_can'),...list('trash_container'),...list('trash_recycling')];
const fuse=list('fusebox_wall'),lamps=list('lamp_'),awnings=list('sunscreen_shop'),curtains=list('cloth_storefront'),stickers=list('sticker_');
const buildings=placements.slice().sort((a,b)=>a.name.localeCompare(b.name));
for(let i=0;i<buildings.length;i++){
 const placement=buildings[i],building=city.getObjectByName(placement.name),geo=building.geometry,box=geo.boundingBox;
 const w=box.max.x-box.min.x,h=box.max.y,front=box.max.z,back=box.min.z,world=building.matrixWorld;
 const rootQ=building.getWorldQuaternion(new T.Quaternion()),rootScale=building.getWorldScale(V()).x;
 const source=building.userData.japanAsset,residential=/house_residential/.test(source),apartment=/apartment/.test(source),ramen=/ramenshop/.test(source);
 const category=ramen?'ramen':residential?'residential':apartment?'apartments':'shops';
 const facade=new T.Mesh(geo,new T.MeshBasicMaterial({side:T.DoubleSide}));
 const place=(name,x,y,z,options={})=>{
  const yaw=options.yaw||0,scale=options.scale||1;
  return add(name,V(x,y,z).applyMatrix4(world),rootQ.clone().multiply(new T.Quaternion().setFromAxisAngle(Y,yaw)),typeof scale==='number'?scale*rootScale:scale.map(s=>s*rootScale),options.category||category,{anchor:building.name,...options});
 };
 const wall=(name,x,y,options={})=>{
  const v=byName.get(name),factor=options.scale||1;
  const width=v.size[0]*(Array.isArray(factor)?factor[0]:factor);
  x=T.MathUtils.clamp(x,box.min.x+width*.52,box.max.x-width*.52);
  ray.set(V(x,y+v.size[1]*.45*(Array.isArray(factor)?factor[1]:factor),front+4),V(0,0,-1));
  const hit=ray.intersectObject(facade,false)[0];if(!hit)return fail('no-wall');
  return place(name,x,y,hit.point.z+v.size[2]*.5*(Array.isArray(factor)?factor[2]:factor)+.025,{...options,detail:options.detail??true});
 };
 // A recognisable frontage silhouette: one sign, one projected hanging sign,
 // one canopy (commercial only), a warm fixture and readable shop decals.
 if(!residential&&!ramen){
  const sign=ramen?'SM_signboard_wide_03':cycle(signs,i);
  wall(sign,0,Math.min(h-1.4,2.85),{scale:Math.min(1,w*.76/byName.get(sign).size[0]),detail:false});
  if(i%2===0)wall(cycle(vertical,i/2),-w*.36,Math.min(h-2.9,4.1),{scale:.65,detail:false});
  if(i%3===0)wall(cycle(letters,Math.floor(i/3)),0,Math.min(h-1.1,6.1),{scale:Math.min(.75,w*.7/byName.get(cycle(letters,Math.floor(i/3))).size[0]),detail:false});
  if(!apartment&&!ramen){const awn=cycle(awnings,i);wall(awn,0,2.5,{scale:Math.min(.85,w*.8/byName.get(awn).size[0]),detail:false});}
  wall(cycle(stickers,i),w*.17,1.1,{scale:.85});
  if(i%4===0)wall(cycle(smallSigns,Math.floor(i/4)),w*.29,3.5,{scale:.65,detail:false});
  wall(cycle(lamps,i),w*.33,2.4,{scale:.8});
 }else if(residential){
  wall(cycle(['SM_mailbox_resident_01','SM_mailbox_resident_02'],i),w*.3,.95);
  wall(cycle(lamps,i),w*.29,2.15,{scale:.7});
 }
 // Keep a central entrance opening. Ground items use the outermost 1.5 m
 // of a 5 m sidewalk; all heights are projected onto the existing paving.
 const edge=w*.36;
 place(cycle(plants,i),-edge,0,front+.38,{ground:true,solid:true,scale:.85});
 if(residential){
  place(i%2?'SM_bicycle':'SM_mofa_vehicle',edge,0,front+.6,{ground:true,solid:true,scale:.8,yaw:0});
  place(cycle(['SM_broom_stick','SM_bucket',...list('carton')],Math.floor(i/20)),-edge+.7,0,front+.35,{ground:true,scale:.8,detail:true});
 }else{
  const item=i%3===0?cycle(vending,i/3):cycle(boards,Math.floor(i/3)+i);
  const size=byName.get(item).size;
  place(item,edge,0,front+size[2]*.45+.08,{ground:true,solid:true,scale:.9});
  if(i%4===0)place(cycle(trash,i/4),edge-1,0,front+.4,{ground:true,solid:true,scale:.75});
 }
 // Utility details on the upper facade, distributed instead of pasted onto
 // every window. Larger fittings already authored into the building stay.
 if(i%3===0)wall(cycle(fuse,i/3),-w*.39,.7,{scale:.8});
 if(i%4===0)wall(cycle(list('cables_hanging'),i/4),0,3.9,{scale:Math.min(1,w*.75/4.4)});
 if(i%5===0)wall(cycle(list('sunscreen_window'),i/5),w*.16,Math.min(h-1,5.2),{scale:.55});
 if(i%2===0&&h>8)wall(cycle(list('airconditioner'),i/2),w*.35,Math.min(h-2,7.3),{scale:.85});
 if(i%7===0)wall(cycle(list('ventilation'),i/7),-w*.36,3.8,{scale:.8});
 // Residential rear/side gardens use free grass, with low fencing and openings.
 if(residential||i%9===0){
  const fence=cycle(list('fence_'),i),side=box.max.x+1.5;
  for(let k=0;k<2;k++)place(fence,side,0,back+1+k*2.4,{ground:true,solid:true,scale:.9,yaw:Math.PI/2,category:'gardens'});
  place(cycle(['SM_wall_flowerbed','SM_bush_01',...list('plants_box')],Math.floor(i/20)),side-.5,0,back+1,{ground:true,solid:true,scale:.9,category:'gardens'});
  place(cycle(['SM_grass_patch_large','SM_grass_patch_small','SM_leaves_ground'],i),side+.2,0,back+3,{ground:true,scale:1,detail:true,category:'gardens'});
  place(cycle(['SM_wall_pillar','SM_entrance_edge','SM_entrance_fence','SM_entrance_fence_02','SM_entrance_fence_03'],i),side,0,front-1.5,{ground:true,solid:true,scale:.8,category:'gardens'});
 }
 if(ramen){
  // Open-front ramen kiosk: counters and stools are inside the building,
  // bowls and utensils sit on the tables rather than on the pavement.
  place('SM_cloth_storefront_01',0,1.5,front+.15,{scale:Math.min(1,w*.85/4.9),detail:false});
  place(cycle(list('lantern_traditional'),Math.floor(i/20)),-w*.38,1.3,front+.2,{scale:.7,detail:false});
  wall(cycle(lamps,Math.floor(i/20)),w*.35,2.4,{scale:.6});
  place('SM_counter_shop',0,0,front-1.9,{scale:[.9,1,.65],solid:true,allowBuilding:true});
  place('SM_shelves_store',0,0,back+.7,{scale:.8,detail:true});
  for(let k=0;k<4;k++){
   const x=-1.6+k*1.05;place(cycle(['SM_stool_01','SM_stool_02','SM_chair'],k),x,0,front-.65,{scale:.8,solid:true,allowBuilding:true});
   place(cycle(['SM_ramenbowl','SM_rice_curry_dish','SM_sushi_plate','SM_soup'],k),x,1.13,front-1.85,{scale:.85,detail:true});
   place(cycle(list('bottle_drink'),k),x+.27,1.13,front-2.15,{scale:.8,detail:true});
  }
  for(const [k,name] of ['SM_soysauce','SM_chopsticks','SM_plate_wooden_01','SM_knife_01','SM_knife_02','SM_pot01','SM_pot02','SM_trowel_01'].entries())place(name,-1.6+k*.48,1.13,front-2.2,{scale:.7,detail:true});
 }else if(!residential&&!apartment&&i%3===1){
  // A small side terrace, outside the primary walking strip.
  const x=box.min.x-1.4,z=front-1.5;
  place(cycle(['SM_table_01','SM_table_shop'],i),x,0,z,{ground:true,solid:true,scale:.8,category:'terraces'});
  place('SM_chair_02',x,0,z+.95,{ground:true,solid:true,scale:.7,category:'terraces'});
  place(cycle(['SM_book_shelf_01','SM_book_shelf_02','SM_shelf_wooden'],Math.floor(i/3)),x,0,z-1,{ground:true,solid:true,scale:.7,category:'terraces'});
  wall(cycle(['SM_cloth_storefront_02','SM_cloth_storefront_03'],i),0,2.0,{scale:Math.min(.7,w*.72/4.9),detail:false});
 }
}

// Crossarms run across the road; conductors run along it. Each endpoint is
// an actual transformed insulator socket, including the planet curvature.
const sockets=new Map(list('utility_pole').map(name=>[name,poleSockets(byName.get(name))]));
for(const [ci,c] of plan.corridors.entries())for(const sign of [-1,1]){
 const poles=[];let k=0;
 for(let s=c.start+22/600;s<c.end-22/600;s+=70/600,k++){
  if([0,7,13,14].includes(ci)&&Math.abs(s-(c.start+c.end)/2)*600<35)continue;
  const p=c.at(s,sign*(c.arm.half+2.5),WALK),up=p.clone().normalize();
  const roadward=c.at(s,0,WALK).sub(p).projectOnPlane(up).normalize();
  const name=cycle(list('utility_pole'),ci+k),v=byName.get(name),socket=sockets.get(name),factor=21/v.size[1];
  const q=frame(p,socket.axis==='x'?V().crossVectors(roadward,up):roadward);
  const pole=add(name,p,q,factor,'power',{ground:true,solid:true});
  if(!pole)continue;
  const index=records.length-1,base=V(...pole.position),world=local=>V(...local).multiplyScalar(factor).applyQuaternion(q).add(base);
  const terminals=socket.terminals.map(world).sort((a,b)=>a.dot(c.side)-b.dot(c.side));
  const transformers=socket.transformers.map(world);
  poleConnections.push({placement:index,axis:socket.axis,roadward:roadward.toArray(),terminals:terminals.map(v=>v.toArray()),transformers:transformers.map(v=>v.toArray())});
  poles.push({index,base,terminals});
  // Short slack leads connect the distribution conductors to pole equipment.
  for(let j=0;j<transformers.length;j++){
   const a=terminals[j%4],b=transformers[j];
   const mid=a.clone().lerp(b,.5).addScaledVector(roadward,.55);
   wires.push({group:ci+'_'+sign,kind:'jumper',pole:index,start:a.toArray(),end:b.toArray(),control:mid.toArray()});
  }
  if(k%4===0)add(cycle(['SM_mirror_round_02','SM_mirror_round_03'],ci+k),c.at(s+15/600,sign*(c.arm.half+2.5),WALK),frame(p,roadward),2,'wayfinding',{ground:true,solid:true});
 }
 for(let k=1;k<poles.length;k++){
  const a=poles[k-1],b=poles[k];if(a.base.distanceTo(b.base)>100)continue;
  for(let j=0;j<4;j++){
   const start=a.terminals[j],end=b.terminals[j],mid=start.clone().lerp(end,.5);
   // A quadratic sag leaves both authored socket positions exact.
   const control=mid.clone().addScaledVector(mid.clone().normalize(),-2.4);
   wires.push({group:ci+'_'+sign,kind:'span',poles:[a.index,b.index],start:start.toArray(),end:end.toArray(),control:control.toArray()});
  }
 }
}

// Small service pockets occupy empty roadside land, never a new road or a
// relocated building. They give the rarer authored props a coherent purpose.
const services=[
 ['SM_fusebox_large','SM_firehydrant','SM_pole_street','SM_traffic_pylon','SM_drain_street','SM_manhole'],
 ['SM_bikestand','SM_bicycle','SM_mofa_vehicle','SM_mailbox_post','SM_trash_recycling'],
 ...[0,1,2].map(k=>vending.slice(k*2,k*2+2).concat(trash.slice(k*2,k*2+2))),
 ['SM_wall_01','SM_wall_corner','SM_wall_fence','SM_wall_pillar','SM_wall_flowerbed'],
 ['SM_bush_01','SM_plants_box_01','SM_flowerpot_01','SM_chair'],
 ['SM_cornerwall','SM_walls_poarch_02','SM_walls_poarch_03','SM_walls_poarch_05'],
];
let serviceIndex=0;
for(const [ci,c] of plan.corridors.entries()){
 if(serviceIndex>=services.length)break;
 for(let s=c.start+.08;s<c.end-.08&&serviceIndex<services.length;s+=.14){
  const p=c.at(s,c.arm.outer+13,WALK);if(lakeMetric(p)<1.7||baseCollision.blocked(p.clone().normalize(),12))continue;
  const q=frame(p,c.at(s,0,WALK).sub(p)),items=services[serviceIndex];let placed=0;
  for(const [k,name] of items.entries()){
   const v=byName.get(name),scale=Math.min(2.4,7/Math.max(v.size[0],v.size[2]));
   const at=p.clone().add(V((k%3-1)*9,0,Math.floor(k/3)*-9).applyQuaternion(q));
   if(add(name,at,q,scale,'service-pockets',{ground:true,solid:!/(drain|manhole)/.test(name),detail:/(drain|manhole)/.test(name)}))placed++;
  }
  if(placed)serviceIndex++;
 }
}

// Roof-top equipment uses actual upward-facing roof intersections.
for(let i=0;i<buildings.length;i+=4){
 const building=city.getObjectByName(buildings[i].name),box=building.geometry.boundingBox;
 const local=new T.Mesh(building.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
 ray.set(V(0,box.max.y+4,0),V(0,-1,0));const hit=ray.intersectObject(local,false)[0];if(!hit)continue;
 const p=hit.point.clone().add(V(0,.05,0)).applyMatrix4(building.matrixWorld),q=building.getWorldQuaternion(new T.Quaternion());
 add(cycle(list('antenna'),i/4),p,q,2,'rooftops',{detail:true});
}

// Report used and omitted source variants explicitly; don't force structural
// road modules or railway crossings into an unchanged street network.
const report={wires:wires.length,poles:poleConnections.length,placements:records.length,assetTypes:used.size,available:variants.length,categories:counts,rejected:rejects,
 used:[...used].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=>({name,count})),
 unused:variants.filter(v=>!used.has(v.name)).map(v=>v.name)};
fs.writeFileSync('assets/japan/dressing-layout-v2.json',JSON.stringify({version:2,placements:records,wires,poleConnections}));
fs.writeFileSync('assets/japan/dressing-report-v2.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,used:undefined},null,2));
