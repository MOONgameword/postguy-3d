import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {navigationAxes,navigationOffset,distanceArrowRotation,renderHeadingMap} from '../navigation-indicators.js';
const up=new T.Vector3(),forward=new T.Vector3(),right=new T.Vector3(),offset=new T.Vector2();
let cases=0;
for(const location of [[0,1,0],[0,-1,0],[0,0,-1],[.7,.5,.3]])for(const yaw of [0,.6,Math.PI,-1.4]){
  const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(...location).normalize()).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw));
  navigationAxes(q,up,forward,right);
  const origin=up.clone().multiplyScalar(602);
  // Independent screen basis: actual behind-character camera, including poles.
  const camera=new T.PerspectiveCamera(50,1,.1,5000);
  camera.up.copy(up);camera.position.copy(origin).addScaledVector(forward,-25).addScaledVector(up,10);camera.lookAt(origin.clone().addScaledVector(forward,10));camera.updateMatrixWorld();
  const screenRight=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  assert.ok(right.dot(screenRight)>.9999);
  for(const [x,y] of [[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1]]){
    const target=origin.clone().addScaledVector(screenRight,20*x).addScaledVector(forward,-20*y);
    navigationOffset(q,origin,target,offset);
    const expected=Math.atan2(y,x),actual=distanceArrowRotation(offset);
    assert.ok(Math.abs(Math.sin(actual)-Math.sin(expected))<1e-9);
    assert.ok(Math.abs(Math.cos(actual)-Math.cos(expected))<1e-9);cases++;
  }
  // A colour-coded globe confirms map/marker agreement at the poles and seam.
  const w=360,h=180,size=21,source=new Uint8ClampedArray(w*h*4),dest=new Uint8ClampedArray(size*size*4);
  for(let v=0;v<h;v++)for(let u=0;u<w;u++){
    const theta=(v+.5)/h*Math.PI,phi=((u+.5)/w-.5)*2*Math.PI;
    const dir=new T.Vector3(Math.sin(theta)*Math.sin(phi),Math.cos(theta),Math.sin(theta)*Math.cos(phi));
    const i=(v*w+u)*4;source[i]=dir.dot(right)>0?255:0;source[i+1]=dir.dot(forward)>0?255:0;
  }
  renderHeadingMap(source,w,h,dest,size,602,186,up,forward,right);
  assert.equal(dest[(10*size+19)*4],255,'Right-hand terrain stays right');
  assert.equal(dest[(10*size+1)*4],0,'Left-hand terrain stays left');
  assert.equal(dest[(1*size+10)*4+1],255,'Ahead terrain stays above');
  assert.equal(dest[(19*size+10)*4+1],0,'Behind terrain stays below');
}
console.log(`PASS: ${cases} target bearings, 16 map orientations, poles and longitude seam`);
