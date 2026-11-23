import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {updateTaskMarker} from '../task-markers.js';
for(const color of [0xff5a4a,0x38c76a]){
  const marker=new T.Group();marker.position.set(0,600,0);
  const ring=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color}));
  const beam=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial({color,transparent:true,opacity:.14,depthWrite:false}));
  const icon=new T.Sprite(new T.SpriteMaterial({depthTest:false}));
  marker.userData={ring,beam,icon};marker.add(ring,beam,icon);
  const camera=new T.PerspectiveCamera(50);camera.position.set(0,3100,0);
  updateTaskMarker(marker,{overview:true,camera,viewportHeight:720,baseScale:3});
  assert.ok(marker.scale.x>3);assert.equal(beam.material.opacity,.58);
  for(const child of marker.children){assert.equal(child.material.fog,false);assert.equal(child.material.depthTest,false);assert.equal(child.material.depthWrite,false);}
  assert.equal(ring.material.color.getHex(),color);
  updateTaskMarker(marker,{overview:false,camera,viewportHeight:720,baseScale:3});
  assert.equal(marker.scale.x,3);assert.equal(icon.scale.x,1.6);assert.equal(beam.material.opacity,.14);
  assert.equal(ring.material.depthTest,true);assert.equal(ring.material.depthWrite,true);assert.equal(icon.material.depthTest,false);
  assert.equal(beam.material.fog,true);
}
console.log('PASS: red/green overview beacon visibility and riding-view restoration');
