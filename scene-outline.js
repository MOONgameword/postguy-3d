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
  // Smooth only canopy coverage, without rendering the scene again. The
  // small holes between leaf cards disappear from this silhouette mask.
  const canopyTarget=new T.WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
  const canopyScratch=canopyTarget.clone();
  const canopyUniforms={colorMap:{value:target.texture},texel:{value:new T.Vector2()},decodeMask:{value:true}};
  const canopyMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,
    uniforms:canopyUniforms,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D colorMap;uniform vec2 texel;uniform bool decodeMask;varying vec2 vUv;
      void main(){float sum=0.;
        for(int i=-4;i<=4;i++){
          float weight=5.-abs(float(i));
          vec4 sampleColor=texture2D(colorMap,vUv+float(i)*texel);
          sum+=weight*(decodeMask?smoothstep(1.3,1.8,sampleColor.a):sampleColor.r);
        }
        gl_FragColor=vec4(vec3(sum/25.),1.);
      }`});
  const canopyQuad=new T.Mesh(new T.PlaneGeometry(2,2),canopyMaterial),canopyScene=new T.Scene();
  canopyQuad.frustumCulled=false;canopyScene.add(canopyQuad);
  const uniforms={
    colorMap:{value:target.texture},depthMap:{value:target.depthTexture},
    canopyMap:{value:canopyTarget.texture},
    texel:{value:new T.Vector2(1,1)},nearFar:{value:new T.Vector2()},
    width:{value:1.15},ink:{value:new T.Color('#000000')},farInk:{value:new T.Color('#454b50')},
    fogRange:{value:new T.Vector2(250,600)},overview:{value:0},
  };
  const material=new T.ShaderMaterial({
    uniforms,depthTest:false,depthWrite:false,toneMapped:true,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      uniform sampler2D colorMap,depthMap,canopyMap;
      uniform vec2 texel,nearFar,fogRange;
      uniform float width,overview;
      uniform vec3 ink,farInk;
      varying vec2 vUv;
      float ordinaryMask(vec2 uv){float a=texture2D(colorMap,uv).a;return a*(1.-smoothstep(1.1,1.4,a));}
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
        // The contour footprint stays constant at every distance. Only the
        // colour/strength changes, so distant lines do not become thinner.
        float distanceMix=smoothstep(mix(35.,250.,overview),mix(260.,1600.,overview),nearest);
        // Second depth difference highlights silhouettes while cancelling
        // smooth slopes, avoiding ink over every ground pixel.
        float crease=max(abs(l+r-2.*c),abs(b+t-2.*c));
        float threshold=max(.12,nearest*.012);
        float edge=smoothstep(threshold,threshold*2.4,crease);
        // Also sample neighbours so the outside half of foliage contours
        // disappears, rather than leaving a dark halo around uninked leaves.
        float allowed=min(ordinaryMask(vUv),min(min(ordinaryMask(vUv-dx),ordinaryMask(vUv+dx)),min(ordinaryMask(vUv-dy),ordinaryMask(vUv+dy))));
        edge*=smoothstep(.5,.98,allowed);
        float coverage=texture2D(canopyMap,vUv).r;
        float gradient=max(abs(texture2D(canopyMap,vUv+dx).r-texture2D(canopyMap,vUv-dx).r),
                           abs(texture2D(canopyMap,vUv+dy).r-texture2D(canopyMap,vUv-dy).r));
        float canopyEdge=1.-smoothstep(gradient*.30,gradient*.90+.001,abs(coverage-.46));
        // Draw within visible foliage only: buildings, trunks and the player
        // in front of a tree cannot receive a canopy halo.
        canopyEdge*=smoothstep(1.3,1.8,base.a)*smoothstep(.015,.06,gradient);
        edge=max(edge,canopyEdge);
        float fade=1.-smoothstep(fogRange.x,fogRange.y,nearest);
        edge*=mix(1.,.28,distanceMix)*mix(fade,.22,overview);
        gl_FragColor=base;
        #include <tonemapping_fragment>
        // The authored sky is unlit and was already intentionally toneMapped=false.
        if(raw>.999999)gl_FragColor=base;
        vec3 contourColor=mix(ink,farInk,distanceMix);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,contourColor,edge*.84);
        gl_FragColor.a=1.;
        #include <colorspace_fragment>
      }`,
  });
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),material),scene=new T.Scene(),camera=new T.Camera();
  scene.add(quad);quad.frustumCulled=false;
  const size=new T.Vector2();
  function render(world,view,{overview=false}={}){
    renderer.getDrawingBufferSize(size);
    if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
    // Coverage only needs half resolution; colour/depth remain full resolution.
    const maskWidth=Math.ceil(size.x/2),maskHeight=Math.ceil(size.y/2);
    if(canopyTarget.width!==maskWidth||canopyTarget.height!==maskHeight){
      canopyTarget.setSize(maskWidth,maskHeight);canopyScratch.setSize(maskWidth,maskHeight);
    }
    uniforms.texel.value.set(1/size.x,1/size.y);
    uniforms.width.value=Math.max(1,renderer.getPixelRatio())*1.1;
    uniforms.nearFar.value.set(view.near,view.far);
    uniforms.fogRange.value.set(world.fog?.near??250,world.fog?.far??600);
    uniforms.overview.value=overview?1:0;
    const previous=renderer.getRenderTarget();
    renderer.info.reset();
    renderer.setRenderTarget(target);renderer.render(world,view);
    // Separable coverage smoothing: 18 samples instead of 81 per mask pixel.
    const spacing=2*Math.max(1,renderer.getPixelRatio());
    canopyUniforms.colorMap.value=target.texture;
    canopyUniforms.decodeMask.value=true;
    canopyUniforms.texel.value.set(spacing/size.x,0);
    renderer.setRenderTarget(canopyScratch);renderer.render(canopyScene,camera);
    canopyUniforms.colorMap.value=canopyScratch.texture;
    canopyUniforms.decodeMask.value=false;
    canopyUniforms.texel.value.set(0,spacing/size.y);
    renderer.setRenderTarget(canopyTarget);renderer.render(canopyScene,camera);
    renderer.setRenderTarget(previous);renderer.render(scene,camera);
  }
  return {render,target,dispose(){target.dispose();canopyTarget.dispose();canopyScratch.dispose();canopyQuad.geometry.dispose();canopyMaterial.dispose();quad.geometry.dispose();material.dispose();}};
}
