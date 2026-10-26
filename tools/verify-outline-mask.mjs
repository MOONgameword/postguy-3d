import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {loadTestJapan} from './install-test-japan.mjs';
import {maskTreeLeaves,excludeBlendedGrass,excludeFromOutline} from '../outline-mask.js';
const variants=loadTestJapan('trees'),material=new T.MeshLambertMaterial();
maskTreeLeaves(variants,material);
for(const v of variants)for(const g of new Set([v.near,v.far])){
 const mask=g.attributes.outlineAllowed;
 assert.equal(mask.count,g.attributes.position.count);
 assert.ok(mask.array.some(n=>n===2),v.name+' has canopy silhouette mask');
 assert.ok(mask.array.some(n=>n===1),v.name+' retains outlined bark');
 for(let i=0;i<mask.count;i+=3)assert.ok(mask.getX(i)===mask.getX(i+1)&&mask.getX(i)===mask.getX(i+2),'No interpolated masks across a face');
}
const grass=new T.MeshStandardMaterial({transparent:true,alphaTest:.08});
excludeBlendedGrass(grass);
assert.equal(grass.blendSrc,T.SrcAlphaFactor);
assert.equal(grass.blendDst,T.OneMinusSrcAlphaFactor);
assert.equal(grass.blendSrcAlpha,T.ZeroFactor);
assert.equal(grass.blendDstAlpha,T.ZeroFactor);
assert.equal(grass.alphaTest,.08);
const water=new T.MeshPhongMaterial({transparent:true,opacity:.32});
excludeFromOutline(water);
assert.equal(water.blendSrc,T.SrcAlphaFactor);
assert.equal(water.blendDst,T.OneMinusSrcAlphaFactor);
assert.equal(water.blendSrcAlpha,T.ZeroFactor);
assert.equal(water.blendDstAlpha,T.ZeroFactor);
console.log({result:'PASS',treeVariants:variants.length,grassRgbBlend:'unchanged',canopyOutline:'silhouette only',barkOutline:true});
