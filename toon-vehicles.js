import * as T from 'three';
import {decodeJapanAssets,japanMaterials} from './japan-assets.js?v=20261023-japan-v1';
import {bakeObjectInk,objectInkMaterial} from './object-ink.js?v=20261026-far-gray-v1';

export function createToonVehicleFleet(bytes,manifest,atlas) {
  const variants=decodeJapanAssets(bytes,manifest);
  const geometries=variants.map(v=>{
    // Deinterleave once so parked cars can be merged without losing UV tiles.
    const g=new T.BufferGeometry();
    for(const [name,a] of Object.entries(v.near.attributes)){
      const data=new Float32Array(a.count*a.itemSize);
      for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)data[i*a.itemSize+j]=a.data.array[i*a.data.stride+a.offset+j];
      g.setAttribute(name,new T.BufferAttribute(data,a.itemSize));
    }
    g.computeBoundingBox();g.computeBoundingSphere();
    g.userData.vehicleName=v.name;
    return bakeObjectInk(g);
  });
  const {material}=japanMaterials(atlas,'vehicles');
  // Shared cartoon surface ink: no extra shell or outline rendering pass.
  const ink=objectInkMaterial(material,.8);
  let cursor=0;
  return {geometries,material:ink,next(){return geometries[cursor++%geometries.length];}};
}
