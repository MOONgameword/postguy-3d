import {loadCity} from './load-city.mjs';
import {buildRoundedJunctions,relocateJunctionFurniture} from '../rounded-junctions.js';
import {conformRoadMarkings} from '../road-markings.js';
import fs from 'node:fs';
import {deflateSync} from 'node:zlib';
import {Vector3} from '../vendor/three.module.js';
const {city,road}=loadCity();
const t=performance.now();
const result=buildRoundedJunctions(road);
console.log('NETWORK',result.stats,'ms',performance.now()-t);
const furniture=relocateJunctionFurniture(city,result);
fs.writeFileSync(new URL('../assets/junction-furniture-v4.json',import.meta.url),JSON.stringify(furniture));
console.log('FURNITURE',furniture.length);
road.geometry=result.geometry;
const painted=conformRoadMarkings(city,new Vector3());
console.log('PAINT',painted,'total ms',performance.now()-t);
const g=road.geometry;
const header=16+g.groups.length*12;
const count=g.attributes.position.count;
const array=new ArrayBuffer(header+count*32),data=new DataView(array);
data.setUint32(0,0x524a3031,true);data.setUint32(4,count,true);data.setUint32(8,g.groups.length,true);data.setUint32(12,1,true);
g.groups.forEach((gr,i)=>{data.setUint32(16+i*12,gr.start,true);data.setUint32(20+i*12,gr.count,true);data.setUint32(24+i*12,gr.materialIndex,true)});
let offset=header;
for(const name of ['position','normal','uv']){const attribute=g.attributes[name];new Float32Array(array,offset,attribute.array.length).set(attribute.array);offset+=attribute.array.byteLength;}
const compressed=deflateSync(Buffer.from(array),{level:9});
fs.writeFileSync(new URL('../assets/roads-rounded-v14.bin',import.meta.url),compressed);
const info={...result.stats,junctionCount:result.stats.junctions,paint:painted,vertices:count,bytes:array.byteLength,compressedBytes:compressed.length,junctions:result.junctions.map((j,index)=>({index,position:j.up.clone().multiplyScalar(602).toArray(),arms:j.arms.length,cuts:j.arms.map(a=>a.cut),gaps:j.sectors.map(s=>s.gap*180/Math.PI)}))};
fs.writeFileSync(new URL('../assets/rounded-road-report-v14.json',import.meta.url),JSON.stringify(info,null,2));
fs.writeFileSync(new URL('../assets/crosswalk-report-v14.json',import.meta.url),JSON.stringify(result.crosswalks,null,2));
const signalRadius=602.8666667, signals=[];
for(const crossing of result.crosswalks){
  const corridor=result.corridors[crossing.corridor], mid=(crossing.from+crossing.to)/2;
  for(const sign of [-1,1]){
    const position=corridor.at(mid,sign*(crossing.width+5.2),signalRadius);
    const roadward=corridor.side.clone().multiplyScalar(-sign).normalize();
    const tangent=corridor.arm.direction.clone().addScaledVector(position.clone().normalize(),-corridor.arm.direction.dot(position.clone().normalize())).normalize();
    signals.push({position:position.toArray(),roadward:roadward.toArray(),tangent:tangent.toArray(),side:sign,corridor:crossing.corridor,junction:crossing.junction});
  }
}
fs.writeFileSync(new URL('../assets/crosswalk-signals-v1.json',import.meta.url),JSON.stringify(signals,null,2));
console.log('SAVED',count,'vertices',array.byteLength,'bytes',compressed.length,'compressed bytes');
