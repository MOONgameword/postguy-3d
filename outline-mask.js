import * as T from 'three';

// Reserve the offscreen colour buffer's alpha as an outline eligibility mask.
// RGB lighting and alpha-tested leaf silhouettes are unchanged; the final
// composite restores opaque alpha. No extra scene pass is required.
export function setOutlineMask(geometry,predicate){
  const values=new Float32Array(geometry.attributes.position.count);
  for(let i=0;i<values.length;i++)values[i]=predicate(i)?1:0;
  geometry.setAttribute('outlineAllowed',new T.BufferAttribute(values,1));
}
export function useOutlineMask(material){
  if(material.userData.outlineMask)return;
  material.userData.outlineMask=true;
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);
    shader.vertexShader='attribute float outlineAllowed; varying float vOutlineAllowed;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvOutlineAllowed=outlineAllowed;');
    shader.fragmentShader='varying float vOutlineAllowed;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\ngl_FragColor.a=vOutlineAllowed;');
  };
  material.customProgramCacheKey=()=>key+'-outline-mask-v1';
  material.needsUpdate=true;
}

export function maskTreeLeaves(variants,material){
  for(const v of variants){
    const bark=new Set(),tile=v.trunk.attributes.buildingTile;
    const key=(a,i)=>[a.getX(i),a.getY(i),a.getZ(i),a.getW(i)].join(',');
    for(let i=0;i<tile.count;i++)bark.add(key(tile,i));
    for(const g of new Set([v.near,v.far]))setOutlineMask(g,i=>bark.has(key(g.attributes.buildingTile,i)));
  }
  useOutlineMask(material);
}

export function excludeBlendedGrass(material){
  // Keep the original RGB SrcAlpha blend, but write zero only to mask alpha.
  material.blending=T.CustomBlending;
  material.blendEquation=T.AddEquation;
  material.blendSrc=T.SrcAlphaFactor;material.blendDst=T.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha=T.AddEquation;
  material.blendSrcAlpha=T.ZeroFactor;material.blendDstAlpha=T.ZeroFactor;
}

export function excludeFromOutline(material){
  if(material.userData.outlineExcluded)return;
  material.userData.outlineExcluded=true;
  // Preserve the material's visible RGB blending while reserving alpha only
  // for the post-process eligibility mask. This is required for transparent
  // water and foam: setting output alpha to zero must not hide their colour.
  material.blending=T.CustomBlending;
  material.blendEquation=T.AddEquation;
  material.blendSrc=T.SrcAlphaFactor;
  material.blendDst=T.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha=T.AddEquation;
  material.blendSrcAlpha=T.ZeroFactor;
  material.blendDstAlpha=T.ZeroFactor;
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    compile?.call(this,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\ngl_FragColor.a=0.;');
  };
  material.customProgramCacheKey=()=>key+'-outline-excluded-v1';
  material.needsUpdate=true;
}
