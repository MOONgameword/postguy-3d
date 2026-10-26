import * as T from 'three';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';
import {excludeFromOutline} from './outline-mask.js?v=20261027-v1';

// Shared, inexpensive materials: sand and submerged plants draw before the
// transparent water; the foam pass is drawn last. No screen-size render targets.
export function installClearLake(root,{point,polar,bedRadius,frame,waterRadius,metric}){
  const time={value:0},N=192;
  function meshSurface(rings,radius,material,name){
    const p=[],uv=[],normals=[];
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<N;i++){
      const a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2,s=rings[j],t=rings[j+1];
      const corners=s===0?[[a,s],[b,t],[a,t]]:[[a,s],[b,s],[b,t],[a,s],[b,t],[a,t]];
      for(const [angle,q]of corners){const [x,z]=polar(angle,q),v=point(x,z,radius(q));p.push(...v.toArray());normals.push(...v.clone().normalize().toArray());uv.push(x,z);}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    // The local lake frame has X cross Z pointing inward; correct every triangle.
    const pos=g.attributes.position;
    for(let i=0;i<pos.count;i+=3){const a=new T.Vector3().fromBufferAttribute(pos,i),b=new T.Vector3().fromBufferAttribute(pos,i+1),c=new T.Vector3().fromBufferAttribute(pos,i+2);if(b.sub(a).cross(c.sub(a)).dot(a)<0)for(const attr of Object.values(g.attributes))for(let k=0;k<attr.itemSize;k++){const v=attr.getComponent(i+1,k);attr.setComponent(i+1,k,attr.getComponent(i+2,k));attr.setComponent(i+2,k,v);}}
    g.computeBoundingSphere();const mesh=new T.Mesh(g,material);mesh.name=name;root.add(mesh);return mesh;
  }
  const common=`varying vec2 lakeUv; uniform float lakeTime;
    float lakeHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float lakeNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(lakeHash(i),lakeHash(i+vec2(1,0)),f.x),mix(lakeHash(i+vec2(0,1)),lakeHash(i+vec2(1,1)),f.x),f.y);}
    float lakeQ(vec2 p){vec2 e=(p-vec2(0,-165.0))/vec2(243.84388749,248.92396848);float a=atan(e.y,e.x);return length(e)/(1.0+.075*sin(3.0*a+.5)+.045*cos(5.0*a-.7)+.025*sin(7.0*a));}
    float caustic(vec2 p){p+=vec2(sin(p.y*.19+lakeTime*.35),cos(p.x*.17-lakeTime*.28))*1.4;float a=abs(sin(p.x*.31+sin(p.y*.23))),b=abs(sin(p.y*.29+cos(p.x*.27)));return pow(1.0-min(a,b),14.0);}
  `;
  function shaderMaterial(material,key,fragment,normal=''){
    material.onBeforeCompile=shader=>{
      shader.uniforms.lakeTime=time;
      shader.vertexShader='varying vec2 lakeUv;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlakeUv=uv;');
      shader.fragmentShader=common+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+fragment);
      if(normal)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\n'+normal);
    };
    material.customProgramCacheKey=()=>key;return material;
  }
  const sandFragment=`
    float q=lakeQ(lakeUv),grain=lakeNoise(lakeUv*2.4),dunes=lakeNoise(lakeUv*.055);
    vec3 dry=vec3(.63,.52,.32),wet=vec3(.26,.41,.32),deep=vec3(.045,.20,.20);
    vec3 sand=mix(deep,wet,smoothstep(.25,.95,q));sand=mix(sand,dry,smoothstep(.99,1.065,q));
    sand*=.94+.07*grain+.07*dunes;
    float underwater=1.0-smoothstep(.96,1.01,q);
    sand+=vec3(.06,.11,.095)*caustic(lakeUv)*underwater;
    diffuseColor.rgb*=sand;
  `;
  const sandOptions={color:0xffffff,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2};
  const sandMat=shaderMaterial(new T.MeshLambertMaterial(sandOptions),'clear-lake-sand-v2',sandFragment);
  const sand=meshSurface(Array.from({length:53},(_,i)=>i*1.04/52),q=>bedRadius(q)+.14,sandMat,'Planet_LakeShore');sand.receiveShadow=true;
  // Only the dry outer rim blends over the real grass texture. Keep the lakebed
  // opaque and draw this shallow overlay before water, without writing depth.
  const edgeMat=shaderMaterial(new T.MeshLambertMaterial({...sandOptions,transparent:true,depthWrite:false,side:T.FrontSide}),'clear-lake-sand-edge-v1',sandFragment+`
    float edgeNoise=(lakeNoise(lakeUv*.12)-.5)*.012;
    diffuseColor.a=1.0-smoothstep(1.048,1.112,q+edgeNoise);
  `);
  const edge=meshSurface(Array.from({length:9},(_,i)=>1.04+i*.01),q=>bedRadius(q)+.14,edgeMat,'LakeShoreBlend');
  edge.receiveShadow=true;edge.renderOrder=2;
  const waterMat=shaderMaterial(new T.MeshPhongMaterial({color:0xffffff,transparent:true,opacity:.32,depthWrite:false,side:T.FrontSide,shininess:95,specular:0x9ccdc4}),'clear-lake-water-v1',`
    float q=lakeQ(lakeUv),wave=sin(lakeUv.x*.11+lakeTime*.6)*sin(lakeUv.y*.13-lakeTime*.45);
    diffuseColor.rgb=mix(vec3(.025,.26,.29),vec3(.27,.61,.49),smoothstep(.35,1.0,q))*(1.0+.035*wave);
    float fresnel=pow(1.0-abs(dot(normalize(vNormal),normalize(vViewPosition))),3.0);
    diffuseColor.a=(.23+.13*(1.0-smoothstep(.55,1.0,q))+.24*fresnel)*(1.0-smoothstep(.985,1.002,q));
  `,`normal=normalize(normal+vec3(sin(lakeUv.x*.17+lakeTime*.7)*.055,cos(lakeUv.y*.15-lakeTime*.6)*.055,0.0));`);
  const water=meshSurface(Array.from({length:41},(_,i)=>i/40),()=>waterRadius,waterMat,'LakeWater');water.renderOrder=3;
  excludeFromOutline(waterMat);
  const foamMat=shaderMaterial(new T.MeshBasicMaterial({color:0xfff9e9,transparent:true,depthWrite:false,side:T.DoubleSide}),'clear-lake-foam-v1',`
    float q=lakeQ(lakeUv),noise=lakeNoise(lakeUv*.30),coast=lakeNoise(lakeUv*.055);
    float phase=fract(lakeTime*.105+coast*.30);
    float front=.951+phase*.046;
    float wash=(1.0-smoothstep(.002,.009,abs(q-front+(noise-.5)*.004)))*sin(phase*3.14159);
    float fringe=1.0-smoothstep(.003,.010,abs(q-.993+(noise-.5)*.005));
    diffuseColor.a=max(fringe*.78,wash*.60)*(.5+.5*noise)*smoothstep(.15,.55,coast+noise*.3);
  `);
  const foam=meshSurface([.935,.955,.975,.99,1.003],()=>waterRadius+.065,foamMat,'LakeFoam');foam.renderOrder=4;
  excludeFromOutline(foamMat);
  let seed=893;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const batches=new Map(),positions=[];
  function batch(g,mat,matrix){g.applyMatrix4(matrix);if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(g.index?g.toNonIndexed():g);}
  const grassMat=new T.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:T.DoubleSide});
  grassMat.onBeforeCompile=shader=>{
    shader.uniforms.lakeTime=time;shader.vertexShader='uniform float lakeTime;\nattribute float sway;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 up=normalize(position);vec3 tangent=normalize(cross(up,vec3(.31,.79,.21)));transformed+=tangent*sin(lakeTime*1.1+position.x*.21+position.z*.14)*sway*.32;');
  };grassMat.customProgramCacheKey=()=> 'lake-seagrass-v1';
  excludeFromOutline(grassMat);
  const coralMats=['#bc8874','#b99c64','#9d8baa','#799e8c'].map(color=>new T.MeshLambertMaterial({color}));
  coralMats.forEach(excludeFromOutline);
  let grassClumps=0,corals=0;
  for(let i=0;i<210;i++){
    const angle=random()*Math.PI*2,q=.28+Math.sqrt(random())*.60,[x,z]=polar(angle,q),base=bedRadius(q)+.20;
    if(Math.abs(x-28)<18&&z>25)continue;
    const depth=waterRadius-base,h=Math.min(depth*.64,2.2+random()*3.2),mat=frame(x,z,base);
    const p=[],color=[],sway=[],dark=new T.Color('#286b5a'),light=new T.Color('#a4c47c');
    for(let blade=0;blade<7;blade++){
      const a=random()*Math.PI*2,ox=(random()-.5)*4,oz=(random()-.5)*4,height=h*(.6+random()*.4),width=.35+random()*.4,bend=.7+random();
      const at=t=>new T.Vector3(ox+Math.cos(a)*bend*t*t,t*height,oz+Math.sin(a)*bend*t*t);
      for(let k=0;k<3;k++){
        const lo=k/3,hi=(k+1)/3,A=at(lo),B=at(hi),side=new T.Vector3(-Math.sin(a),0,Math.cos(a));
        const corners=[A.clone().addScaledVector(side,width*(1-lo)),A.clone().addScaledVector(side,-width*(1-lo)),B.clone().addScaledVector(side,-width*(1-hi)),B.clone().addScaledVector(side,width*(1-hi))];
        for(const index of [0,1,2,0,2,3]){p.push(...corners[index].toArray());const t=index<2?lo:hi;color.push(...dark.clone().lerp(light,t*.75).toArray());sway.push(t*t);}
      }
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('color',new T.Float32BufferAttribute(color,3));g.setAttribute('sway',new T.Float32BufferAttribute(sway,1));g.computeVertexNormals();batch(g,grassMat,mat);grassClumps++;positions.push({x,z,base,height:h,kind:'grass'});
  }
  function branch(a,b,r,mat,matrix){const delta=b.clone().sub(a),g=new T.CylinderGeometry(r*.5,r,delta.length(),5,1);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());batch(g,mat,matrix);}
  for(let i=0;i<32;i++){
    const angle=random()*Math.PI*2,q=.32+random()*.46,[x,z]=polar(angle,q),base=bedRadius(q)+.22,h=Math.min(3.2+random()*1.6,(waterRadius-base)*.70-.65),matrix=frame(x,z,base),mat=coralMats[i%4];
    for(let k=0;k<5;k++){
      const a=k/5*Math.PI*2+random(),end=new T.Vector3(Math.cos(a)*h*.42,h*(.5+random()*.5),Math.sin(a)*h*.42);
      branch(new T.Vector3(),end,.30,mat,matrix);
      for(const sign of [-1,1]){const tip=end.clone().add(new T.Vector3(sign*.65,.6,Math.sin(a+sign)*.6));branch(end.clone().multiplyScalar(.65),tip,.16,mat,matrix);}
    }
    if(i%3===0){
      const mound=new T.SphereGeometry(1,8,6);mound.scale(1.8,.8,1.5);mound.translate(0,.6,0);batch(mound,mat,matrix);
      for(let k=0;k<4;k++){const lobe=new T.SphereGeometry(.65,6,4);lobe.scale(1,.7,1);lobe.translate(Math.cos(k*1.57)*1.1,1,Math.sin(k*1.57));batch(lobe,mat,matrix);}
    }
    corals++;positions.push({x,z,base,height:h+.6,kind:'coral'});
  }
  for(const [material,geos]of batches){const mesh=new T.Mesh(mergeGeometries(geos),material);mesh.name=material===grassMat?'LakeSeagrass':'LakeCoral';root.add(mesh);for(const g of geos)g.dispose();}
  root.userData.underwaterPlants=positions;
  return {stats:{seagrassClumps:grassClumps,corals,waterTransparent:true},update(t){time.value=t;}};
}
