import * as T from 'three';
import {unzlibSync} from './vendor/libs/fflate.module.js';
import {useOutlineMask} from './outline-mask.js?v=20261026-canopy-v1';

export const TREE_LEAF_MASK_URL='./assets/trees/tree-leaves03-v1.png';

// Replace the solid crown with masked cards sampled over its authored lobes.
// Both distance levels retain the same trunk and canopy shape.
export function withLeafCards(asset) {
  const source=asset.near,p=source.attributes.position,n=source.attributes.normal;
  const faces=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let area=0;
  for(let i=0;i<p.count;i+=3)if(source.attributes.outlineAllowed.getX(i)>1.5){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    area+=b.sub(a).cross(c.sub(a)).length()*.5;faces.push({i,area});
  }
  function build(base,count,size) {
    let seed=73921;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const pos=[],norm=[],uv=[],mask=[];
    // Keep only the authored bark from this LOD, removing every solid leaf face.
    for(let i=0;i<base.attributes.position.count;i++)if(base.attributes.outlineAllowed.getX(i)<1.5){
      pos.push(base.attributes.position.getX(i),base.attributes.position.getY(i),base.attributes.position.getZ(i));
      norm.push(base.attributes.normal.getX(i),base.attributes.normal.getY(i),base.attributes.normal.getZ(i));uv.push(-1,-1);mask.push(1);
    }
    const center=new T.Vector3(),normal=new T.Vector3(),tangent=new T.Vector3(),bitangent=new T.Vector3(),point=new T.Vector3();
    for(let k=0;k<count;k++){
      const value=random()*area;let low=0,high=faces.length-1;
      while(low<high){const mid=(low+high)>>1;if(faces[mid].area<value)low=mid+1;else high=mid;}
      const i=faces[low].i,r=Math.sqrt(random()),s=random(),weights=[1-r,r*(1-s),r*s];
      center.set(0,0,0);normal.set(0,0,0);
      for(let j=0;j<3;j++){center.addScaledVector(a.fromBufferAttribute(p,i+j),weights[j]);normal.addScaledVector(a.fromBufferAttribute(n,i+j),weights[j]);}
      normal.normalize();center.addScaledVector(normal,-.018);
      tangent.set(0,1,0);if(Math.abs(normal.y)>.95)tangent.set(1,0,0);
      tangent.cross(normal).normalize().applyAxisAngle(normal,random()*Math.PI*2);bitangent.crossVectors(normal,tangent).normalize();
      const radius=size*(.85+random()*.3);
      // A shared outward normal keeps the front/back of a card in one toon band.
      for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]){
        point.copy(center).addScaledVector(tangent,x*radius).addScaledVector(bitangent,y*radius);
        pos.push(point.x,point.y,point.z);norm.push(normal.x,normal.y,normal.z);uv.push((x+1)*.5,(y+1)*.5);mask.push(2);
      }
    }
    const g=new T.BufferGeometry();
    for(const [name,values,width] of [['position',pos,3],['normal',norm,3],['uv',uv,2],['outlineAllowed',mask,1]])g.setAttribute(name,new T.Float32BufferAttribute(values,width));
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  return {...asset,near:build(asset.near,460,.092),far:build(asset.far,190,.12),leafCards:true};
}

function cutoutLeaves(material,texture) {
  if(!texture)return material;
  texture.colorSpace=T.NoColorSpace;
  const compile=material.onBeforeCompile;
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);
    shader.uniforms.treeLeafMask={value:texture};
    shader.vertexShader='varying vec2 treeLeafUv;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntreeLeafUv=uv;');
    shader.fragmentShader='uniform sampler2D treeLeafMask; varying vec2 treeLeafUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(treeLeafUv.x>=0. && texture2D(treeLeafMask,treeLeafUv).r<.45)discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',T.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','normal *= treeLeafUv.x>=0. ? 1.0 : faceDirection;'));
  };
  material.side=T.DoubleSide;material.shadowSide=T.DoubleSide;
  material.customProgramCacheKey=()=> 'tree2-leafcards-v1-'+material.type;
  return material;
}

export function authoredTreeDepthMaterial(leafMask) {
  return cutoutLeaves(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking}),leafMask);
}

export function decodeAuthoredTree(bytes,manifest) {
  const raw=unzlibSync(new Uint8Array(bytes)), floats=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
  const geometries={};
  for(const [name,r] of Object.entries(manifest.ranges)) {
    const g=new T.BufferGeometry(),a=floats.subarray(r.start*7,(r.start+r.count)*7);
    for(const [key,offset,size] of [['position',0,3],['normal',3,3],['outlineAllowed',6,1]]) {
      const values=new Float32Array(r.count*size);
      for(let i=0;i<r.count;i++)for(let j=0;j<size;j++)values[i*size+j]=a[i*7+offset+j];
      g.setAttribute(key,new T.BufferAttribute(values,size));
    }
    g.computeBoundingBox();g.computeBoundingSphere();geometries[name]=g;
  }
  return {...geometries,palettes:manifest.palettes};
}

export function authoredTreeMaterial(palettes,leafMask=null) {
  const material=new T.MeshLambertMaterial({name:'Tree2_AuthoredToon'});
  const vec=c=>`vec3(${c.map(x=>x.toFixed(7)).join(',')})`;
  material.onBeforeCompile=shader=>{
    // Recreate the Blend's Shader-to-RGB colour ramp in the game renderer.
    // Normals and the scene sun drive discrete authored colours, not a baked light texture.
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      float treeLight=0.5;
      #if NUM_DIR_LIGHTS > 0
        treeLight=dot(normal,directionalLights[0].direction);
      #endif
      vec3 treeColor;
      if(vOutlineAllowed>1.5) {
        treeColor=treeLight<-.12?${vec(palettes.canopy[0])}:treeLight<.25?${vec(palettes.canopy[1])}:treeLight<.65?${vec(palettes.canopy[2])}:${vec(palettes.canopy[3])};
      } else {
        treeColor=treeLight<.05?${vec(palettes.bark[0])}:treeLight<.5?${vec(palettes.bark[1])}:${vec(palettes.bark[2])};
      }
      outgoingLight=treeColor;
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=> 'authored-tree2-ramp-v1';
  cutoutLeaves(material,leafMask);useOutlineMask(material);
  return material;
}

const hash=name=>{let h=2166136261;for(const c of name)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export function installAuthoredTrees(city,asset,{mobile=false,leafMask=null}={}) {
  city.updateMatrixWorld(true);
  const trees=[];city.traverse(o=>{if(o.isMesh&&/^Tree_/.test(o.name))trees.push(o);});
  const material=authoredTreeMaterial(asset.palettes,leafMask),profiles=new Map();
  const depth=leafMask?authoredTreeDepthMaterial(leafMask):null;
  const p=new T.Vector3(),axis=new T.Vector3(0,1,0);
  const tp=asset.trunk.attributes.position;let rootRadius=0;
  for(let i=0;i<tp.count;i++)if(tp.getY(i)<.04)rootRadius=Math.max(rootRadius,Math.hypot(tp.getX(i),tp.getZ(i)));
  for(const tree of trees) {
    const pivot=tree.getWorldPosition(new T.Vector3()),up=pivot.clone().normalize(),pos=tree.geometry.attributes.position;
    let bottom=Infinity,top=-Infinity,oldRadius=0;
    for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(tree.matrixWorld);const h=p.dot(up);bottom=Math.min(bottom,h);top=Math.max(top,h);}
    for(let i=0;i<pos.count;i++){
      p.fromBufferAttribute(pos,i).applyMatrix4(tree.matrixWorld);
      if(p.dot(up)>bottom+.7)continue;
      p.sub(pivot);p.addScaledVector(up,-p.dot(up));oldRadius=Math.max(oldRadius,p.length());
    }
    const scale=T.MathUtils.clamp(top-bottom,22,48)*.93;
    // Narrow only the root to retain the original walkable roadside clearance.
    const rootScale=Math.max(.1,Math.floor(Math.min(1,Math.max(.3,oldRadius)/(rootRadius*scale))*10)/10);
    if(!profiles.has(rootScale)){
      const profile={};
      for(const key of ['near','far','trunk']){
        const g=asset[key].clone(),v=g.attributes.position,mask=g.attributes.outlineAllowed;
        for(let i=0;i<v.count;i++)if(mask.getX(i)<1.5){const blend=1-T.MathUtils.smoothstep(v.getY(i),0,.25),s=1-blend+blend*rootScale;v.setX(i,v.getX(i)*s);v.setZ(i,v.getZ(i)*s);}
        g.computeBoundingBox();g.computeBoundingSphere();profile[key]=g;
      }
      profiles.set(rootScale,profile);
    }
    const profile=profiles.get(rootScale),id=hash(tree.name);
    pivot.addScaledVector(up,bottom-pivot.dot(up)-.12);
    const q=new T.Quaternion().setFromUnitVectors(axis,up).multiply(new T.Quaternion().setFromAxisAngle(axis,id%6283/1000));
    new T.Matrix4().compose(pivot,q,new T.Vector3().setScalar(scale)).premultiply(tree.parent.matrixWorld.clone().invert()).decompose(tree.position,tree.quaternion,tree.scale);
    tree.geometry=profile.near;tree.material=material;tree.castShadow=!mobile;tree.receiveShadow=true;
    if(depth)tree.customDepthMaterial=depth;else delete tree.customDepthMaterial;
    delete tree.userData.assetLod;
    tree.userData.collisionGeometry=profile.trunk;tree.userData.stylizedTree=true;tree.userData.treeAsset='tree2-v1';
    tree.userData.treeLod={near:profile.near,far:profile.far};
  }
  city.updateMatrixWorld(true);
  return {trees:trees.length,sharedProfiles:profiles.size,nearTriangles:asset.near.attributes.position.count/3,farTriangles:asset.far.attributes.position.count/3};
}
