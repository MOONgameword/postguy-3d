import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {decodeStreetBuildings,installStreetBuildings} from '../street-buildings.js';
import {installBuildingRoadLayout} from '../building-road-layout.js';
export function installTestBuildings(city){
 const read=name=>JSON.parse(fs.readFileSync('assets/buildings/'+name));
 const placements=read('street-layout-v1.json');
 const geometries=decodeStreetBuildings(fs.readFileSync('assets/buildings/street-buildings-v1.bin'),read('street-buildings-v1.json'));
 const stats=installStreetBuildings(city,geometries,new T.MeshLambertMaterial(),placements);
 installBuildingRoadLayout(city,read('street-props-v1.json'));
 return {placements,stats,geometries};
}
