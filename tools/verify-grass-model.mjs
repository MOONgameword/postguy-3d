import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import { createGrassCards, createMeadowPlants } from '../meadow-plants.js';

const model = createGrassCards(new T.Texture());
const geo = model.geometry, box = geo.boundingBox;
assert.ok(geo.attributes.position.count > 0);
assert.ok(Math.abs(box.min.y) < 1e-5 && Math.abs(box.max.y - 1.2705) < 1e-4);
assert.ok(geo.attributes.color && geo.attributes.color.count === geo.attributes.position.count);
assert.equal(model.material.name, 'MeadowAlphaCards');
assert.ok(model.material.transparent && model.material.forceSinglePass);
assert.equal(geo.attributes.position.count/3,6);
assert.equal(model.farGeometry.attributes.position.count/3,4);
for(const g of [geo,model.farGeometry]) for(const a of Object.values(g.attributes)) assert.ok(a.array.every(Number.isFinite));
for(const mobile of [false,true]) {
 const turf={base:new T.Texture(),nap:new T.Texture()};
 const focus=new T.Vector3(0,600,0),p2=new T.Vector3(500,400,0);
 const field={stats:{},bins:new Map([['0,12,0',new Float32Array([0,600,0,.4,1])],['10,8,0',new Float32Array([...p2.toArray(),.4,0])]])};
 const plants=createMeadowPlants(new T.Scene(),field,{mobile,model:createGrassCards(new T.Texture(),turf)});
 plants.update(1,focus);assert.equal(plants.grass.count,1);assert.equal(plants.farGrass.count,1);
 assert.equal(plants.blooms.count,1);
 const mat=new T.Matrix4();plants.grass.getMatrixAt(0,mat);
 assert.ok(new T.Vector3().setFromMatrixPosition(mat).distanceTo(focus.clone().add(new T.Vector3(0,-.08,0)))<1e-4);
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};
 plants.grass.material.onBeforeCompile(shader);assert.ok(shader.vertexShader.includes('float growth'));
 assert.equal(shader.uniforms.turfBase.value,turf.base);assert.equal(shader.uniforms.turfNap.value,turf.nap);
 assert.ok(shader.fragmentShader.includes('groundColor'));
 assert.ok(!shader.fragmentShader.includes('normal *= faceDirection;'));
 assert.equal(plants.grass.instanceColor,null);assert.equal(plants.grass.material.vertexColors,false);
 assert.equal(plants.stats.range,mobile?1320:1800);
 const distant=new T.Vector3(0,-550,0);field.bins.set('0,-12,0',new Float32Array([...distant.toArray(),.4,0]));
 plants.update(1.5,focus.clone().add(new T.Vector3(8,0,0)));assert.equal(plants.farGrass.count,2);
 assert.ok(plants.grass.count+plants.farGrass.count<=plants.stats.maxGrass);
 plants.update(2,new T.Vector3(0,-5000,0));assert.equal(plants.grass.count+plants.farGrass.count,0);
}
assert.ok(model.farGeometry.attributes.position.count > 0 && model.farGeometry.attributes.position.count < geo.attributes.position.count);
assert.ok(!fs.readFileSync('game.js','utf8').includes('GRASS_MODEL_URL'));
console.log(JSON.stringify({result:'PASS',nearTriangles:6,farTriangles:4,height:1.2705,texture:'grass-cards-v1-512.png',mobileAndDesktop:true},null,2));
