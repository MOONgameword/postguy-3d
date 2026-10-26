import * as T from 'three';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import {installClearLake} from './lake-water.js?v=20261027-water-mask-v1';
import {excludeFromOutline} from './outline-mask.js?v=20261027-v1';

// The wooded basin behind Bld_0333, identified against the user's marked view.
const oldUp = new T.Vector3(-365,405,-330).normalize();
const towardTown = new T.Vector3(-194.6302795,461.355835,-330.5599365).normalize();
towardTown.addScaledVector(oldUp,-towardTown.dot(oldUp)).normalize();
export const LAKE_UP = oldUp.clone().multiplyScalar(600).addScaledVector(towardTown,-25).normalize();
const Z = towardTown.clone().addScaledVector(LAKE_UP,-towardTown.dot(LAKE_UP)).normalize();
const X = new T.Vector3().crossVectors(LAKE_UP,Z).normalize();
export const LAKE_WATER = 599.4;
// Integral of the gnomonic footprint on radius 599.4: 155794.35 / 31158.87 = 5.
const WATER = LAKE_WATER, RX = 243.84388749, RZ = 248.92396848, CENTER_Z = -165;
export const LAKE_BOUNDS={rx:RX,rz:RZ,centerZ:CENTER_Z,areaRatio:5};
const smooth = (a,b,x) => {const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function lakePoint(x,z,r=WATER){return LAKE_UP.clone().multiplyScalar(600).addScaledVector(X,x).addScaledVector(Z,z).normalize().multiplyScalar(r);}
function coords(p){const d=p.dot(LAKE_UP);return d>0?new T.Vector2(600*p.dot(X)/d,600*p.dot(Z)/d):new T.Vector2(1e6,1e6);}
function boundary(a){return 1+.075*Math.sin(3*a+.5)+.045*Math.cos(5*a-.7)+.025*Math.sin(7*a);}
function metric(x,z){z-=CENTER_Z;return Math.hypot(x/RX,z/RZ)/boundary(Math.atan2(z/RZ,x/RX));}
export function lakePolar(a,s){return [RX*Math.cos(a)*boundary(a)*s,CENTER_Z+RZ*Math.sin(a)*boundary(a)*s];}
const polar=lakePolar;
export function lakeBedRadius(q,original=602){const inner=590.4+8.78*smooth(.40,1,q);const rim=599.18+2.52*smooth(1,1.10,q);return q<1?inner:T.MathUtils.lerp(rim,original,smooth(1.10,1.24,q));}
const bedRadius=lakeBedRadius;
export function lakeMetric(point){const p=coords(point);return metric(p.x,p.y);}
export function isLakeWater(point){const d=point.dot(LAKE_UP);if(d<=0)return false;const x=600*point.dot(X)/d,z=600*point.dot(Z)/d;return metric(x,z)<1&&!onDock(x,z);}
function onDock(x,z){return (Math.abs(x-28)<4.4&&z>38.5&&z<100)||(Math.abs(x-28)<11.5&&z>36.5&&z<43.5);}

export function createLakeside(city, { includeReeds = false } = {}){
  city.updateMatrixWorld(true);
  const planet=city.getObjectByName('Planet');
  if(!planet)throw new Error('Planet terrain missing');
  const source=planet.geometry,inv=planet.matrixWorld.clone().invert();
  const positions=[],uvs=[],groups=[];let changed=0;
  const read=i=>({p:new T.Vector3().fromBufferAttribute(source.attributes.position,source.index?source.index.getX(i):i).applyMatrix4(planet.matrixWorld),uv:source.attributes.uv?new T.Vector2().fromBufferAttribute(source.attributes.uv,source.index?source.index.getX(i):i):new T.Vector2()});
  function emit(a,b,c,depth=0){
    const ps=[a,b,c],cs=ps.map(v=>coords(v.p));
    const near=cs.some(p=>metric(p.x,p.y)<1.7);
    const lengths=[a.p.distanceToSquared(b.p),b.p.distanceToSquared(c.p),c.p.distanceToSquared(a.p)];
    if(near&&Math.max(...lengths)>36&&depth<9){const i=lengths.indexOf(Math.max(...lengths)),u=ps[i],v=ps[(i+1)%3],w=ps[(i+2)%3],m={p:u.p.clone().lerp(v.p,.5),uv:u.uv.clone().lerp(v.uv,.5)};emit(u,m,w,depth+1);emit(m,v,w,depth+1);return;}
    for(let k=0;k<3;k++){const p=ps[k].p.clone(),q=metric(cs[k].x,cs[k].y);if(q<1.24){p.setLength(bedRadius(q,p.length())-.45*(1-smooth(1.1,1.24,q)));changed++;}p.applyMatrix4(inv);positions.push(...p.toArray());uvs.push(...ps[k].uv.toArray());}
  }
  for(const g of source.groups.length?source.groups:[{start:0,count:source.index?source.index.count:source.attributes.position.count,materialIndex:0}]){const start=positions.length/3;for(let i=g.start;i<g.start+g.count;i+=3)emit(read(i),read(i+1),read(i+2));groups.push({...g,start,count:positions.length/3-start});}
  const terrain=new T.BufferGeometry();terrain.setAttribute('position',new T.Float32BufferAttribute(positions,3));terrain.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));terrain.groups=groups;terrain.computeVertexNormals();terrain.computeBoundingSphere();planet.geometry=terrain;
  // Smooth only the newly cut basin. Keep the original distant low-poly hills.
  const normalSums=new Map(),normalKeys=[];
  for(let i=0;i<positions.length;i+=3){const p=new T.Vector3(positions[i],positions[i+1],positions[i+2]);if(lakeMetric(p.clone().applyMatrix4(planet.matrixWorld))>1.45)continue;const key=p.toArray().map(v=>Math.round(v*10000)).join(',');normalKeys[i/3]=key;const n=new T.Vector3().fromBufferAttribute(terrain.attributes.normal,i/3);if(!normalSums.has(key))normalSums.set(key,new T.Vector3());normalSums.get(key).add(n);}
  for(const n of normalSums.values())n.normalize();
  normalKeys.forEach((key,i)=>{const n=normalSums.get(key);terrain.attributes.normal.setXYZ(i,n.x,n.y,n.z);});
  // Remove submerged vegetation; re-seat retained bank vegetation on the new slope.
  const remove=[],reposition=[];
  city.traverse(o=>{if(!o.isMesh||! /^(Tree|Grass|Rock)_/.test(o.name))return;const p=o.getWorldPosition(new T.Vector3()),v=coords(p),q=metric(v.x,v.y);if(q<1.14)remove.push(o);else if(q<1.5)reposition.push(o);});
  for(const o of remove)o.removeFromParent();
  const ray=new T.Raycaster(),point=new T.Vector3();planet.updateWorldMatrix(true,false);
  for(const o of reposition){const p=o.getWorldPosition(new T.Vector3()),up=p.clone().normalize();ray.set(up.clone().multiplyScalar(850),up.clone().negate());const hit=ray.intersectObject(planet,false)[0];if(!hit)continue;let min=Infinity;const attr=o.geometry.attributes.position;for(let i=0;i<attr.count;i++)min=Math.min(min,point.fromBufferAttribute(attr,i).applyMatrix4(o.matrixWorld).length());p.addScaledVector(up,hit.point.length()-min+.15);o.position.copy(o.parent.worldToLocal(p));}

  const root=new T.Group();root.name='Lakeside';city.add(root);
  const materials={sand:new T.MeshLambertMaterial({color:0xc7bb92,side:T.DoubleSide}),wood:new T.MeshLambertMaterial({color:0x947050}),lightWood:new T.MeshLambertMaterial({color:0xb19166}),darkWood:new T.MeshLambertMaterial({color:0x665d48}),reed:new T.MeshLambertMaterial({color:0x758654,side:T.DoubleSide}),reedLight:new T.MeshLambertMaterial({color:0xa4aa6e,side:T.DoubleSide}),cattail:new T.MeshLambertMaterial({color:0x70533d}),stone:new T.MeshLambertMaterial({color:0x999f8c}),cream:new T.MeshLambertMaterial({color:0xf0e2b9,side:T.DoubleSide}),red:new T.MeshLambertMaterial({color:0xb66548}),green:new T.MeshLambertMaterial({color:0x4b7872})};
  [materials.reed,materials.reedLight,materials.cattail].forEach(excludeFromOutline);
  const batches=new Map();
  function batch(geo,mat,matrix){if(matrix)geo.applyMatrix4(matrix);if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(geo.index?geo.toNonIndexed():geo);}
  function frame(x,z,radius=WATER){const p=lakePoint(x,z,radius),up=p.clone().normalize(),east=X.clone().addScaledVector(up,-X.dot(up)).normalize(),south=new T.Vector3().crossVectors(east,up);return new T.Matrix4().makeBasis(east,up,south).setPosition(p);}
  function box(x,z,r,w,h,d,mat){batch(new T.BoxGeometry(w,h,d),mat,frame(x,z,r));}
  const clearLake=installClearLake(root,{point:lakePoint,polar,bedRadius,frame,waterRadius:WATER,metric});
  let seed=491;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  // Dock follows the planet curvature; a separate deck is included in ground baking.
  const deck=[];for(let i=0;i<=25;i++){const z=39+i*2.4;const g=new T.BoxGeometry(10,.85,2.17);g.applyMatrix4(frame(28,z,602.1));deck.push(g.toNonIndexed());const support=new T.BoxGeometry(9.6,.35,2.45);support.applyMatrix4(frame(28,z,601.7));deck.push(support.toNonIndexed());}
  for(let x=17;x<=39;x+=2.4){const g=new T.BoxGeometry(2.17,.85,9);g.applyMatrix4(frame(x,40,602.1));deck.push(g.toNonIndexed());const support=new T.BoxGeometry(2.45,.35,8.6);support.applyMatrix4(frame(x,40,601.7));deck.push(support.toNonIndexed());}
  const deckMat=materials.wood.clone();deckMat.name='Lake_Wood';const dock=new T.Mesh(mergeGeometries(deck),deckMat);dock.name='Planet_LakeDock';dock.receiveShadow=true;root.add(dock);
  for(const z of[40,54,70,86,98])for(const x of[22,34]){box(x,z,599,1.25,10,1.25,materials.darkWood);box(x,z,604.3,1.65,.6,1.65,materials.lightWood);}
  // Short landward boardwalk and reeds grouped in irregular bank-side clusters.
  if(includeReeds) for(let i=0;i<32;i++){const a=random()*Math.PI*2;if(Math.abs(a-Math.PI/2)<.3)continue;const s=1.015+random()*.065,[x,z]=polar(a,s);for(let j=0;j<6;j++){const xx=x+(random()-.5)*5,zz=z+(random()-.5)*5,q=metric(xx,zz),h=2.6+random()*4;const base=bedRadius(q,602);batch(new T.CylinderGeometry(.10,.18,h,4),materials.reed,frame(xx,zz,base+h/2));const leaf=new T.BufferGeometry();leaf.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1.8,h*.65,.4,.3,h*.9,0,0,0,0,-1.3,h*.55,-.5,0,h*.8,0],3));leaf.computeVertexNormals();batch(leaf,materials.reedLight,frame(xx,zz,base));if(j%3===0)batch(new T.CylinderGeometry(.3,.32,1.4,6),materials.cattail,frame(xx,zz,base+h+.35));}}
  // Shore stones removed (no rocks in the scene); still draw their 5 random
  // numbers each so the seeded layout of everything after stays identical.
  for(let i=0;i<20*5;i++)random();
  for(const[mat,geos]of batches){const mesh=new T.Mesh(mergeGeometries(geos),mat);mesh.name=[materials.reed,materials.reedLight,materials.cattail].includes(mat)?'LakeReeds':'LakeDetail';mesh.receiveShadow=true;root.add(mesh);}

  const boats=[];
  function boat(x,z,heading,sail,color){const group=new T.Group();group.name='LakeBoat';root.add(group);const hullPoints=[[-2.5,-5],[2.5,-5],[3,2],[0,7],[-3,2]],shape=new T.Shape();shape.moveTo(...hullPoints[0]);for(const p of hullPoints.slice(1))shape.lineTo(...p);shape.closePath();const geo=new T.ExtrudeGeometry(shape,{depth:1.7,bevelEnabled:true,bevelSize:.65,bevelThickness:.6,bevelSegments:1,steps:1});geo.rotateX(-Math.PI/2);const hull=new T.Mesh(geo,materials[color]);hull.position.y=-.8;group.add(hull);const inside=new T.Mesh(new T.BoxGeometry(4.1,.3,7.5),materials.darkWood);inside.position.set(0,1.1,0);group.add(inside);for(const z of[-2.8,1.5]){const seat=new T.Mesh(new T.BoxGeometry(4.7,.55,1),materials.lightWood);seat.position.set(0,1.6,z);group.add(seat);}if(sail){const mast=new T.Mesh(new T.CylinderGeometry(.2,.28,15,7),materials.darkWood);mast.position.set(0,8,0);group.add(mast);const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute([.25,3.5,0,.25,15.5,0,6.5,4.2,2,-.25,4,0,-.25,13.5,0,-4.8,4,1.4],3));sg.computeVertexNormals();group.add(new T.Mesh(sg,materials.cream));}else{for(const side of[-1,1]){const oar=new T.Mesh(new T.BoxGeometry(.25,.25,10),materials.lightWood);oar.position.set(side*3,1.8,0);oar.rotation.y=side*.6;group.add(oar);}}
    const matrix=frame(x,z,WATER+.5),base=new T.Quaternion().setFromRotationMatrix(matrix);group.position.setFromMatrixPosition(matrix);group.quaternion.copy(base).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),heading));boats.push({group,base:group.quaternion.clone(),p:group.position.clone(),up:group.position.clone().normalize(),phase:boats.length*2});}
  boat(44,40,.15,false,'red');boat(-75,-145,.3,true,'green');boat(85,-235,-.3,true,'wood');
  city.updateMatrixWorld(true);
  return {root,stats:{terrainVerticesChanged:changed,vegetationRemoved:remove.length,vegetationAdjusted:reposition.length,boats:boats.length,...clearLake.stats,areaRatio:5},update(t){clearLake.update(t);for(const b of boats){b.group.position.copy(b.p).addScaledVector(b.up,.18*Math.sin(t*1.1+b.phase));b.group.quaternion.copy(b.base).multiply(new T.Quaternion().setFromEuler(new T.Euler(.015*Math.sin(t+b.phase),0,.025*Math.sin(t*.8+b.phase))));}},waterContains:isLakeWater};
}
