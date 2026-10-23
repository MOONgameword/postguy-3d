import * as T from 'three';
import {setOutlineMask,useOutlineMask} from './outline-mask.js?v=20261023-v1';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';

/** Shared model/atlas instances; visibility compacts each draw, rather than
 * cloning thousands of meshes or submitting the opposite side of the planet. */
export function installJapanDressing(city,variants,materials,layout,{mobile=false}={}){
  for(const v of variants)setOutlineMask(v.near,()=>!/^SM_(grass_|leaves_ground)/.test(v.name));
  useOutlineMask(materials.material);
  const source=new Map(variants.map(v=>[v.name,v])),groups=new Map();
  const root=new T.Group();root.name='JapanStreetDressing';city.add(root);city.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),matrix=new T.Matrix4();
  const collisionMaterial=new T.MeshBasicMaterial();
  let triangles=0,colliders=0;
  for(const p of layout.placements){
    const v=source.get(p.asset);if(!v)throw Error(`Missing dressing asset ${p.asset}`);
    matrix.compose(new T.Vector3().fromArray(p.position),new T.Quaternion().fromArray(p.quaternion),new T.Vector3().fromArray(p.scale));
    const local=matrix.clone().premultiply(inverse),position=new T.Vector3().fromArray(p.position);
    const detail=!!p.detail,key=p.asset;
    if(!groups.has(key))groups.set(key,{variant:v,items:[]});
    groups.get(key).items.push({matrix:local,position,up:position.clone().normalize(),detail});
    triangles+=v.near.attributes.position.count/3;
    if(p.solid){
      const mesh=new T.Mesh(v.near,collisionMaterial);mesh.name=`Street_JapanCollider_${colliders++}`;
      local.decompose(mesh.position,mesh.quaternion,mesh.scale);mesh.visible=false;
      mesh.userData.collisionOnly=true;mesh.userData.japanAsset=p.asset;root.add(mesh);
    }
  }
  const batches=[];
  for(const {variant:v,items} of groups.values()){
    const mesh=new T.InstancedMesh(v.near,materials.material,items.length);
    mesh.name=`JapanDressing_${v.name}`;mesh.userData.japanDressingBatch=true;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.count=0;
    mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;
    root.add(mesh);batches.push({mesh,items});
  }
  // A few merged wire meshes, grouped by road side, replace floating templates.
  // The curve endpoints use the same world-space sockets as the placed poles.
  const wireGroups=new Map(),wireBatches=[];
  for(const wire of layout.wires||[]){
    const ids=wire.kind==='span'?wire.poles:[wire.pole],key=ids.join('_');
    if(!wireGroups.has(key))wireGroups.set(key,{parts:[],anchors:ids.map(id=>new T.Vector3(...layout.placements[id].position))});
    const curve=new T.QuadraticBezierCurve3(new T.Vector3(...wire.start),new T.Vector3(...wire.control),new T.Vector3(...wire.end));
    wireGroups.get(key).parts.push(new T.TubeGeometry(curve,wire.kind==='span'?10:5,.035,4,false).applyMatrix4(inverse));
  }
  const wireMaterial=new T.MeshBasicMaterial({color:0x39434b});
  for(const [key,{parts,anchors}] of wireGroups){
    const geo=mergeGeometries(parts);parts.forEach(g=>g.dispose());geo.computeBoundingSphere();
    const mesh=new T.Mesh(geo,wireMaterial);mesh.name=`JapanDressing_Wires_${key}`;mesh.userData.japanDressingBatch=true;
    root.add(mesh);
    wireBatches.push({mesh,anchors:anchors.map(position=>({position,up:position.clone().normalize()}))});
  }
  let previousOverview=null,next=0;
  const cameraUp=new T.Vector3(),stats={placements:layout.placements.length,assetTypes:groups.size,colliders,triangles,wires:layout.wires?.length||0,visible:0,draws:0};
  function update(cameraPosition,overview=false,now=performance.now()){
    if(now<next&&overview===previousOverview)return;next=now+120;previousOverview=overview;
    cameraUp.copy(cameraPosition).normalize();const eye=Math.acos(Math.min(1,600/cameraPosition.length()));
    let visible=0,draws=0;
    for(const {mesh,items} of batches){
      let count=0;
      for(const item of items){
        const limit=item.detail?(mobile?95:135):(mobile?260:350);
        if(overview&&item.detail)continue;
        if(!overview&&item.position.distanceToSquared(cameraPosition)>limit*limit)continue;
        if(item.up.dot(cameraUp)<Math.cos(eye+.20))continue;
        mesh.setMatrixAt(count++,item.matrix);
      }
      mesh.count=count;mesh.visible=count>0;if(count){mesh.instanceMatrix.needsUpdate=true;draws++;visible+=count;}
    }
    for(const wire of wireBatches){
      wire.mesh.visible=wire.anchors.every(a=>(overview||a.position.distanceTo(cameraPosition)<(mobile?260:350))&&a.up.dot(cameraUp)>=Math.cos(eye+.20));
      if(wire.mesh.visible)draws++;
    }
    stats.visible=visible;stats.draws=draws;
  }
  city.updateMatrixWorld(true);root.userData.dressingStats=stats;
  return {root,stats,update};
}
