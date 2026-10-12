import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/loaders/GLTFLoader.js';
import {addCharacterOutline} from '../character-outline.js';
const loader=new GLTFLoader();
loader.register(()=>({name:'TEST_TEXTURE_STUB',loadTexture:()=>Promise.resolve(new T.Texture())}));
const bytes=fs.readFileSync('assets/characters/red-panda-v3.glb');
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const root=gltf.scene;
root.scale.setScalar(3); root.rotation.set(.2,.4,.1);root.position.set(4,600,20);
let source;root.traverse(o=>{if(o.isSkinnedMesh)source=o;});
const original=source.geometry.attributes.position.array.slice();
const clips=gltf.animations.map(c=>c.name==='sit'?T.AnimationClip.parse(JSON.parse(fs.readFileSync('assets/characters/panda-riding-v1.json'))):c);
assert.equal(addCharacterOutline(root),1);
assert.equal(addCharacterOutline(root),0,'Repeated installation cannot double the outline');
const shell=source.children.find(o=>o.userData.__outline);
assert.equal(shell.skeleton,source.skeleton);
assert.equal(shell.material.side,T.BackSide);
assert.equal(shell.castShadow,false);
assert.ok(shell.geometry.attributes.outlineNormal.array.every(Number.isFinite));
const shader={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader};
shell.material.onBeforeCompile(shader);
assert.ok(shader.vertexShader.indexOf('transformed += outlineNormal')<shader.vertexShader.indexOf('#include <skinning_vertex>'));
const mixer=new T.AnimationMixer(root),a=new T.Vector3(),b=new T.Vector3();
for(const clip of clips){
 mixer.stopAllAction();mixer.clipAction(clip).play();
 for(let i=0;i<=8;i++){
  mixer.setTime(clip.duration*i/8);root.updateMatrixWorld(true);source.skeleton.update();
  for(let v=0;v<original.length/3;v+=101){
   source.getVertexPosition(v,a).applyMatrix4(source.matrixWorld);
   shell.getVertexPosition(v,b).applyMatrix4(shell.matrixWorld);
   assert.ok(a.distanceTo(b)<1e-5,`${clip.name}: outline must follow skin and root transforms`);
  }
 }
}
assert.deepEqual(source.geometry.attributes.position.array,original);
console.log('PASS: outline follows all six clips including handlebar pose; geometry unchanged; no duplicate hull');
