import * as T from 'three';
import { FBXLoader } from './vendor/loaders/FBXLoader.js';

export function titleGeometries(model) {
  model.updateMatrixWorld(true);
  const letters=[];
  model.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    letters.push({geometry,center:geometry.boundingBox.getCenter(new T.Vector3()),size:geometry.boundingBox.getSize(new T.Vector3())});
  });
  letters.sort((a,b)=>a.center.x-b.center.x);
  if(letters.length!==4)throw new Error('标题 FBX 应包含四个独立文字');
  const size=Math.max(...letters.flatMap(letter=>[letter.size.x,letter.size.y]));
  return letters.map(({geometry,center})=>{
    geometry.translate(-center.x,-center.y,-center.z).scale(1/size,1/size,1/size);
    geometry.computeVertexNormals();geometry.clearGroups();
    const normal=geometry.attributes.normal,index=geometry.index;
    const count=index?index.count:normal.count;
    let previous=-1,start=0;
    for(let i=0;i<count;i+=3){
      const material=Math.abs(normal.getZ(index?index.getX(i):i))>.9?0:1;
      if(material!==previous){if(previous!==-1)geometry.addGroup(start,i-start,previous);start=i;previous=material;}
    }
    geometry.addGroup(start,count-start,previous);
    return geometry;
  });
}

export function glyphGeometry(glyph,depth=.14) {
  const path=new T.ShapePath();
  for(const contour of glyph.contours){
    contour.forEach(([x,y],i)=>i?path.lineTo(x,y):path.moveTo(x,y));
    path.currentPath.closePath();
  }
  const geometry=new T.ExtrudeGeometry(path.toShapes(),{depth,steps:1,bevelEnabled:false,curveSegments:2});
  geometry.translate(0,0,-depth/2);
  geometry.userData.glyph=true;
  return geometry;
}

// Real extruded glyphs, rendered over the live planet using the existing WebGL context.
export async function createIntroModels({renderer,gate,button,onStart}) {
  const [response,titleModel]=await Promise.all([
    fetch('./assets/ui/intro-glyphs.json?v=20261106-1'),
    new FBXLoader().loadAsync('./assets/ui/title-wenzi.fbx?v=20261106-1')
  ]);
  if(!response.ok)throw new Error('无法读取立体标题');
  const glyphs=await response.json();
  const titleMeshes=titleGeometries(titleModel);
  titleModel.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]))material.dispose();}});
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,3000);
  camera.position.z=1200;
  const front=new T.MeshBasicMaterial({color:'#f1f1df',toneMapped:false});
  const side=new T.MeshBasicMaterial({color:'#758b88',toneMapped:false});
  const yellow=new T.MeshBasicMaterial({color:'#efc956',toneMapped:false});
  const gold=new T.MeshBasicMaterial({color:'#ad8942',toneMapped:false});
  const ink=new T.LineBasicMaterial({color:'#202c29'});
  const targets=[],hits=[],labels=[];
  function outlined(geometry,materials,parent){
    const mesh=new T.Mesh(geometry,materials);parent.add(mesh);
    let edgeGeometry=new T.EdgesGeometry(geometry,35);
    if(geometry.userData.glyph){
      // Outline the front/back perimeter, without striping each curved side segment.
      const positions=edgeGeometry.attributes.position,keep=[];
      for(let i=0;i<positions.count;i+=2){
        if(Math.abs(positions.getZ(i)-positions.getZ(i+1))>1e-5)continue;
        for(let j=i;j<i+2;j++)keep.push(positions.getX(j),positions.getY(j),positions.getZ(j));
      }
      edgeGeometry.dispose();edgeGeometry=new T.BufferGeometry();edgeGeometry.setAttribute('position',new T.Float32BufferAttribute(keep,3));
    }
    const edges=new T.LineSegments(edgeGeometry,ink);mesh.add(edges);
    return mesh;
  }
  for(const [i,char] of [...'小熊快送'].entries()){
    const pivot=new T.Group();scene.add(pivot);pivot.rotation.set(-.20,-.12,0);
    const mesh=outlined(titleMeshes[i],[front,side],pivot);
    mesh.userData.pivot=pivot;hits.push(mesh);targets.push(pivot);
    const control=document.createElement('button');control.type='button';control.className='intro-letter';
    control.setAttribute('aria-label',`${char}：拖动旋转，方向键旋转`);gate.append(control);labels.push(control);
    control.addEventListener('keydown',event=>{
      if(!event.key.startsWith('Arrow'))return;event.preventDefault();
      pivot.rotation.y+=(event.key==='ArrowLeft'?-.2:event.key==='ArrowRight'?.2:0);
      pivot.rotation.x+=(event.key==='ArrowUp'?-.2:event.key==='ArrowDown'?.2:0);
    });
  }
  const start=new T.Group();scene.add(start);start.rotation.set(.13,-.035,0);targets.push(start);
  const panelShape=new T.Shape();panelShape.moveTo(-1.65,-.43);panelShape.lineTo(1.65,-.43);panelShape.lineTo(1.65,.43);panelShape.lineTo(-1.65,.43);panelShape.closePath();
  const panelGeo=new T.ExtrudeGeometry(panelShape,{depth:.22,bevelEnabled:true,bevelThickness:.06,bevelSize:.06,bevelSegments:1,steps:1});
  panelGeo.translate(0,0,-.16);
  const panel=outlined(panelGeo,[yellow,gold],start);panel.userData.pivot=start;hits.push(panel);
  [...'开始送货'].forEach((char,i)=>{
    const mesh=outlined(glyphGeometry(glyphs[char],.055),[front,side],start);
    mesh.scale.setScalar(.57);mesh.position.set(-1.12+i*.60,0,.16);
    mesh.userData.pivot=start;hits.push(mesh);
  });
  const arrow=new T.Shape();arrow.moveTo(-.24,-.18);arrow.lineTo(.04,.10);arrow.lineTo(-.12,.10);arrow.lineTo(-.12,.26);arrow.lineTo(.32,.26);arrow.lineTo(.32,-.18);arrow.lineTo(.16,-.18);arrow.lineTo(.16,-.02);arrow.lineTo(-.12,-.30);arrow.closePath();
  const arrowMesh=outlined(new T.ExtrudeGeometry(arrow,{depth:.045,bevelEnabled:false}),[front,side],start);arrowMesh.position.set(1.22,0,.16);arrowMesh.userData.pivot=start;hits.push(arrowMesh);
  let width=0,height=0,pointer=null,active=null,lastX=0,lastY=0,downX=0,downY=0,moved=false;
  const ray=new T.Raycaster(),ndc=new T.Vector2();
  function resize(){
    const r=gate.getBoundingClientRect();if(!r.width||!r.height)return;
    width=r.width;height=r.height;camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();
    const size=Math.min(width*.30,height*.24),gap=size*1.07;
    const center=height*.035;
    targets.slice(0,4).forEach((pivot,i)=>{
      pivot.scale.setScalar(size);pivot.position.set((i%2?1:-1)*gap/2,center+(i<2?1:-1)*gap/2,30);
      Object.assign(labels[i].style,{left:`${width/2+pivot.position.x-size*.5}px`,top:`${height/2-pivot.position.y-size*.5}px`,width:`${size}px`,height:`${size}px`});
    });
    const buttonScale=Math.min(width*.15,height*.12);
    start.scale.setScalar(buttonScale);start.position.set(0,-height*.335,30);
    Object.assign(button.style,{left:`${width/2-buttonScale*1.75}px`,top:`${height/2-start.position.y-buttonScale*.52}px`,width:`${buttonScale*3.5}px`,height:`${buttonScale*1.04}px`});
  }
  function pick(event){
    const r=gate.getBoundingClientRect();ndc.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);ray.setFromCamera(ndc,camera);
    return ray.intersectObjects(hits,false)[0]?.object.userData.pivot;
  }
  function reset(){const old=pointer;pointer=null;active=null;if(old!==null&&gate.hasPointerCapture(old))gate.releasePointerCapture(old);}
  gate.addEventListener('pointerdown',event=>{
    if(pointer!==null||event.button!==0)return;
    active=pick(event);if(!active)return;
    pointer=event.pointerId;downX=lastX=event.clientX;downY=lastY=event.clientY;moved=false;
    gate.setPointerCapture(pointer);event.preventDefault();
  });
  gate.addEventListener('pointermove',event=>{
    if(event.pointerId!==pointer)return;
    if(Math.hypot(event.clientX-downX,event.clientY-downY)>8)moved=true;
    if(moved){active.rotation.y+=(event.clientX-lastX)*.012;active.rotation.x+=(event.clientY-lastY)*.012;}
    lastX=event.clientX;lastY=event.clientY;
  });
  gate.addEventListener('pointerup',event=>{
    if(event.pointerId!==pointer)return;
    const launch=active===start&&!moved&&pick(event)===start;reset();if(launch)onStart();
  });
  for(const type of ['pointercancel','lostpointercapture'])gate.addEventListener(type,event=>{if(event.pointerId===pointer)reset();});
  window.addEventListener('blur',reset);
  button.addEventListener('click',event=>{if(event.detail===0)onStart();});
  gate.classList.add('models-ready');resize();
  return {render(){
    const r=gate.getBoundingClientRect();if(r.width!==width||r.height!==height)resize();
    const autoClear=renderer.autoClear;renderer.autoClear=false;renderer.clearDepth();renderer.render(scene,camera);renderer.autoClear=autoClear;
  },dispose(){
    reset();window.removeEventListener('blur',reset);
    scene.traverse(object=>object.geometry?.dispose());
    for(const material of [front,side,yellow,gold,ink])material.dispose();
  }};
}
