import * as T from 'three';
import {maskTreeLeaves} from './outline-mask.js?v=20261023-v1';
import { unzlibSync } from './vendor/libs/fflate.module.js';

export const JAPAN_VERSION = '20261023-japan-v1';
export function decodeJapanAssets(bytes, manifest) {
  const raw=unzlibSync(new Uint8Array(bytes));
  const array=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
  const geometry=range=>{
    const g=new T.BufferGeometry(),buffer=new T.InterleavedBuffer(array.subarray(range.start*12,(range.start+range.count)*12),12);
    g.setAttribute('position',new T.InterleavedBufferAttribute(buffer,3,0));
    g.setAttribute('normal',new T.InterleavedBufferAttribute(buffer,3,3));
    g.setAttribute('uv',new T.InterleavedBufferAttribute(buffer,2,6));
    g.setAttribute('buildingTile',new T.InterleavedBufferAttribute(buffer,4,8));
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  };
  return manifest.variants.map(v=>{const near=geometry(v.near);return {...v,near,far:v.far.start===v.near.start?near:geometry(v.far),trunk:v.trunk?geometry(v.trunk):null};});
}

// Both the visible and shadow pass sample the same atlas and leaf alpha mask.
// Lambert uses the scene's shared cartoon light bands, without extra draw calls.
function atlasShader(material) {
  material.extensions={...material.extensions,derivatives:true,shaderTextureLOD:true};
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec4 buildingTile; varying vec4 vJapanTile; varying vec2 vJapanUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvJapanTile=buildingTile;vJapanUV=uv;');
    shader.fragmentShader='varying vec4 vJapanTile; varying vec2 vJapanUV;\n'+shader.fragmentShader;
    shader.uniforms.japanTexel={value:1/material.map.image.width};
    shader.fragmentShader='uniform float japanTexel;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      vec2 japanDx = dFdx(vJapanUV) * vJapanTile.zw;
      vec2 japanDy = dFdy(vJapanUV) * vJapanTile.zw;
      // Differentiate before fract, and keep footprints inside the wrap gutter.
      float japanFootprint=max(length(japanDx),length(japanDy));
      float japanLimit=min(1.0, 8.0*japanTexel/max(japanFootprint,0.000001));
      diffuseColor *= texture2DGradEXT(map, vJapanTile.xy + fract(vJapanUV) * vJapanTile.zw, japanDx*japanLimit, japanDy*japanLimit);
    `);
  };
  material.customProgramCacheKey=()=>`japan-atlas-v1-${material.type}`;
  return material;
}
export function japanMaterials(atlas,kind) {
  atlas.colorSpace=T.SRGBColorSpace;atlas.minFilter=T.LinearMipmapLinearFilter;atlas.magFilter=T.LinearFilter;atlas.generateMipmaps=true;
  const material=atlasShader(new T.MeshLambertMaterial({name:`Japan_${kind}`,map:atlas,alphaTest:.45,side:T.DoubleSide}));
  const depth=atlasShader(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map:atlas,alphaTest:.45,side:T.DoubleSide}));
  return {material,depth};
}
export function installJapanBuildings(city,variants,materials,placements,mobile=false) {
  const old=[];city.traverse(o=>{if(o.isMesh&&/^Bld_/.test(o.name))old.push(o)});
  old.forEach(o=>o.removeFromParent());city.updateMatrixWorld(true);
  const inv=city.matrixWorld.clone().invert(),matrix=new T.Matrix4();
  for(const p of placements){
    const v=variants[p.variant],mesh=new T.Mesh(v.near,materials.material);
    mesh.name=p.name;mesh.userData.japanAsset=v.name;
    mesh.userData.assetLod={near:v.near,far:v.far};mesh.userData.collisionGeometry=v.near;
    mesh.castShadow=!mobile;mesh.receiveShadow=true;mesh.customDepthMaterial=materials.depth;
    matrix.compose(new T.Vector3().fromArray(p.position),new T.Quaternion().fromArray(p.quaternion),new T.Vector3().setScalar(p.scale)).premultiply(inv);
    matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);city.add(mesh);
  }
  city.updateMatrixWorld(true);
  return {removed:old.length,installed:placements.length,variants:new Set(placements.map(p=>p.variant)).size};
}
const hash=name=>{let h=2166136261;for(const c of name)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export function installJapanTrees(city,variants,materials,mobile=false) {
  maskTreeLeaves(variants,materials.material);
  city.updateMatrixWorld(true);const trees=[];city.traverse(o=>{if(o.isMesh&&/^Tree_/.test(o.name))trees.push(o)});
  const point=new T.Vector3(),axis=new T.Vector3(0,1,0);
  for(const tree of trees){
    const id=hash(tree.name),v=variants[id%variants.length],pivot=tree.getWorldPosition(new T.Vector3()),up=pivot.clone().normalize();
    let bottom=Infinity,top=-Infinity;const pos=tree.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){const height=point.fromBufferAttribute(pos,i).applyMatrix4(tree.matrixWorld).dot(up);bottom=Math.min(bottom,height);top=Math.max(top,height);}
    const scale=T.MathUtils.clamp(top-bottom,22,40)*.93/v.size[1];
    pivot.addScaledVector(up,bottom-pivot.dot(up)-.1);
    const q=new T.Quaternion().setFromUnitVectors(axis,up).multiply(new T.Quaternion().setFromAxisAngle(axis,id%6283/1000));
    const matrix=new T.Matrix4().compose(pivot,q,new T.Vector3().setScalar(scale)).premultiply(tree.parent.matrixWorld.clone().invert());
    matrix.decompose(tree.position,tree.quaternion,tree.scale);
    tree.geometry=v.near;tree.material=materials.material;tree.customDepthMaterial=materials.depth;
    tree.userData.collisionGeometry=v.trunk;tree.userData.stylizedTree=true;tree.userData.japanAsset=v.name;
    tree.userData.assetLod={near:v.near,far:v.far};tree.castShadow=!mobile;tree.receiveShadow=true;
    delete tree.userData.treeLod;
  }
  city.updateMatrixWorld(true);
  return {replaced:trees.length,variants:new Set(trees.map(t=>t.userData.japanAsset)).size};
}
