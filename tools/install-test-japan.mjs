import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {decodeJapanAssets,installJapanBuildings,installJapanTrees} from '../japan-assets.js';
import {installBuildingRoadLayout} from '../building-road-layout.js';
const read=name=>JSON.parse(fs.readFileSync('assets/japan/'+name));
export function loadTestJapan(kind){return decodeJapanAssets(fs.readFileSync(`assets/japan/${kind}-v1.bin`),read(`${kind}-v1.json`))}
export function installTestJapanBuildings(city){
 const placements=read('building-layout-v1.json'),variants=loadTestJapan('buildings');
 const stats=installJapanBuildings(city,variants,{material:new T.MeshLambertMaterial()},placements);
 installBuildingRoadLayout(city,read('landscape-layout-v1.json'));
 return {placements,stats,geometries:variants.map(v=>v.near)};
}
export function installTestJapanTrees(city){return installJapanTrees(city,loadTestJapan('trees'),{material:new T.MeshLambertMaterial()});}
