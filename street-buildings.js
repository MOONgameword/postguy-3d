import * as T from 'three';
import { unzlibSync } from './vendor/libs/fflate.module.js';

export function decodeStreetBuildings(bytes, manifest) {
  const data=unzlibSync(new Uint8Array(bytes));
  const array=new Float32Array(data.buffer,data.byteOffset,data.byteLength/4);
  return manifest.variants.map(v=>{
    const g=new T.BufferGeometry();
    const buffer=new T.InterleavedBuffer(array.subarray(v.start*12,(v.start+v.count)*12),12);
    g.setAttribute('position',new T.InterleavedBufferAttribute(buffer,3,0));
    g.setAttribute('normal',new T.InterleavedBufferAttribute(buffer,3,3));
    g.setAttribute('uv',new T.InterleavedBufferAttribute(buffer,2,6));
    g.setAttribute('buildingTile',new T.InterleavedBufferAttribute(buffer,4,8));
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  });
}

export function streetBuildingMaterial(atlas) {
  atlas.colorSpace=T.SRGBColorSpace;
  atlas.minFilter=T.LinearFilter;atlas.magFilter=T.LinearFilter;atlas.generateMipmaps=false;
  const mat=new T.MeshLambertMaterial({name:'StreetBuildingsAtlas',map:atlas,alphaTest:.4,side:T.DoubleSide});
  mat.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec4 buildingTile; varying vec4 vBuildingTile; varying vec2 vBuildingUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBuildingTile=buildingTile;vBuildingUV=uv;');
    shader.fragmentShader='varying vec4 vBuildingTile; varying vec2 vBuildingUV;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
      'diffuseColor *= texture2D(map, vBuildingTile.xy + fract(vBuildingUV) * vBuildingTile.zw);');
  };
  mat.customProgramCacheKey=()=> 'street-building-atlas-v1';
  return mat;
}

export function installStreetBuildings(city, geometries, material, placements, mobile=false) {
  const old=[];city.traverse(o=>{if(o.isMesh&&/^Bld_/.test(o.name))old.push(o)});
  for(const o of old)o.removeFromParent();
  city.updateMatrixWorld(true);
  const inv=city.matrixWorld.clone().invert(),m=new T.Matrix4();
  for(const p of placements){
    const mesh=new T.Mesh(geometries[p.variant],material);
    mesh.name=p.name;mesh.userData.streetBuildingVariant=p.variant;
    mesh.castShadow=!mobile;mesh.receiveShadow=true;
    m.compose(new T.Vector3().fromArray(p.position),new T.Quaternion().fromArray(p.quaternion),new T.Vector3().setScalar(p.scale)).premultiply(inv);
    m.decompose(mesh.position,mesh.quaternion,mesh.scale);city.add(mesh);
  }
  city.updateMatrixWorld(true);
  return {removed:old.length,installed:placements.length,variants:new Set(placements.map(p=>p.variant)).size};
}
