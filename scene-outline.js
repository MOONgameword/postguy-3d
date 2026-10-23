import * as T from 'three';

/** One shared depth-contour pass for the entire scene, including instances,
 * alpha-tested foliage, terrain and animated/skinned characters. No geometry
 * clones or extra scene render are needed. Smooth depth slopes are suppressed
 * so the spherical roads don't acquire their triangulation as black lines. */
export function createSceneOutline(renderer,{mobile=false}={}) {
  renderer.info.autoReset=false;
  const target=new T.WebGLRenderTarget(1,1,{
    type:T.HalfFloatType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,
    depthBuffer:true,stencilBuffer:false,
    samples:renderer.capabilities.isWebGL2&&!mobile?Math.min(4,renderer.capabilities.maxSamples):0,
  });
  target.depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);
  const uniforms={
    colorMap:{value:target.texture},depthMap:{value:target.depthTexture},
    texel:{value:new T.Vector2(1,1)},nearFar:{value:new T.Vector2()},
    width:{value:1.15},ink:{value:new T.Color('#28363b')},
    fogRange:{value:new T.Vector2(250,600)},overview:{value:0},
  };
  const material=new T.ShaderMaterial({
    uniforms,depthTest:false,depthWrite:false,toneMapped:true,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      uniform sampler2D colorMap,depthMap;
      uniform vec2 texel,nearFar,fogRange;
      uniform float width,overview;
      uniform vec3 ink;
      varying vec2 vUv;
      float distanceAt(vec2 uv){
        float d=texture2D(depthMap,uv).x;
        return nearFar.x*nearFar.y/(nearFar.y-d*(nearFar.y-nearFar.x));
      }
      void main(){
        vec4 base=texture2D(colorMap,vUv);
        float raw=texture2D(depthMap,vUv).x;
        float c=distanceAt(vUv);
        vec2 dx=vec2(texel.x*width,0.),dy=vec2(0.,texel.y*width);
        float l=distanceAt(vUv-dx),r=distanceAt(vUv+dx),b=distanceAt(vUv-dy),t=distanceAt(vUv+dy);
        float nearest=min(c,min(min(l,r),min(b,t)));
        // Second depth difference highlights silhouettes while cancelling
        // smooth slopes, avoiding ink over every ground pixel.
        float crease=max(abs(l+r-2.*c),abs(b+t-2.*c));
        float threshold=max(.12,nearest*.012);
        float edge=smoothstep(threshold,threshold*2.4,crease);
        float fade=1.-smoothstep(fogRange.x,fogRange.y,nearest);
        edge*=mix(fade,.22,overview);
        gl_FragColor=base;
        #include <tonemapping_fragment>
        // The authored sky is unlit and was already intentionally toneMapped=false.
        if(raw>.999999)gl_FragColor=base;
        gl_FragColor.rgb=mix(gl_FragColor.rgb,ink,edge*.84);
        #include <colorspace_fragment>
      }`,
  });
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),material),scene=new T.Scene(),camera=new T.Camera();
  scene.add(quad);quad.frustumCulled=false;
  const size=new T.Vector2();
  function render(world,view,{overview=false}={}){
    renderer.getDrawingBufferSize(size);
    if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
    uniforms.texel.value.set(1/size.x,1/size.y);
    uniforms.width.value=Math.max(1,renderer.getPixelRatio())*(overview?.8:1.1);
    uniforms.nearFar.value.set(view.near,view.far);
    uniforms.fogRange.value.set(world.fog?.near??250,world.fog?.far??600);
    uniforms.overview.value=overview?1:0;
    const previous=renderer.getRenderTarget();
    renderer.info.reset();
    renderer.setRenderTarget(target);renderer.render(world,view);
    renderer.setRenderTarget(previous);renderer.render(scene,camera);
  }
  return {render,target,dispose(){target.dispose();quad.geometry.dispose();material.dispose();}};
}
