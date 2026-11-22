import * as T from 'three';
import {unzlibSync} from './vendor/libs/fflate.module.js';
import {useOutlineMask} from './outline-mask.js?v=20261026-canopy-v1';

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

export function authoredTreeMaterial(palettes) {
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
  useOutlineMask(material);
  return material;
}

const hash=name=>{let h=2166136261;for(const c of name)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export function installAuthoredTrees(city,asset,{mobile=false}={}) {
  city.updateMatrixWorld(true);
  const trees=[];city.traverse(o=>{if(o.isMesh&&/^Tree_/.test(o.name))trees.push(o);});
  const material=authoredTreeMaterial(asset.palettes),profiles=new Map();
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
    delete tree.customDepthMaterial;delete tree.userData.assetLod;
    tree.userData.collisionGeometry=profile.trunk;tree.userData.stylizedTree=true;tree.userData.treeAsset='tree2-v1';
    tree.userData.treeLod={near:profile.near,far:profile.far};
  }
  city.updateMatrixWorld(true);
  return {trees:trees.length,sharedProfiles:profiles.size,nearTriangles:asset.near.attributes.position.count/3,farTriangles:asset.far.attributes.position.count/3};
}
