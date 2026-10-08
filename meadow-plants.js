import * as T from 'three';
import { lakeMetric } from './lakeside.js?v=20260930-22';

export const GRASS_TEXTURE_URL = './assets/trees/grass-cards-v1-512.png';

// Alpha silhouette from the supplied TGA, with no FBX or solid grass geometry.
export function createGrassCards(texture = null, turf = null) {
  if (texture) {
    texture.colorSpace = T.NoColorSpace;
    texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  function cards(count) {
    const positions=[],uvs=[],normals=[],colors=[];
    const bottom=new T.Color('#8eae55'),top=new T.Color('#d8e992');
    for(let n=0;n<count;n++) {
      const angle=n*Math.PI/count,dx=Math.cos(angle),dz=Math.sin(angle);
      for(const i of [0,1,2,0,2,3]) {
        const [x,y,u,v]=[[-.93,0,0,0],[.93,0,1,0],[.93,1.2705,1,.69],[-.93,1.2705,0,.69]][i];
        positions.push(x*dx,y,x*dz);uvs.push(u,v);
        // Upward-biased normals blend the cards into the turf under sunlight.
        normals.push(0,1,0);
        colors.push(...(y===0?bottom:top).toArray());
      }
    }
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
    g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  const material=new T.MeshStandardMaterial({name:'MeadowAlphaCards',roughness:1,metalness:0,map:texture,
    color:0xffffff,vertexColors:!turf,side:T.DoubleSide,transparent:true,
    alphaTest:.08,depthWrite:true,forceSinglePass:true});
  material.onBeforeCompile = shader => {
    // Both faces use the ground-facing normal, including on instanced cards.
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',
      T.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;',''));
    if (!turf) return;
    Object.assign(shader.uniforms,{turfBase:{value:turf.base},turfNap:{value:turf.nap}});
    shader.vertexShader='varying vec3 grassGroundPosition; varying float grassHeight;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vec4 groundVertex=vec4(position.x,0.,position.z,1.);
      #ifdef USE_INSTANCING
        groundVertex=instanceMatrix*groundVertex;
      #endif
      grassGroundPosition=(modelMatrix*groundVertex).xyz;
      grassHeight=position.y/1.2705;
    `);
    shader.fragmentShader='varying vec3 grassGroundPosition; varying float grassHeight; uniform sampler2D turfBase; uniform sampler2D turfNap;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      // Same world mapping, linear palette and grain as City_Grass.
      vec3 gp=grassGroundPosition;
      vec3 w=pow(abs(normalize(gp)),vec3(4.)); w/=dot(w,vec3(1.));
      vec3 sp=gp/14.;
      vec3 albedo=texture2D(turfBase,sp.yz).rgb*w.x+texture2D(turfBase,sp.xz).rgb*w.y+texture2D(turfBase,sp.xy).rgb*w.z;
      float lum=dot(albedo,vec3(.2126,.7152,.0722));
      float rolling=.5+.13*sin(dot(gp,vec3(.019,.027,.013)))+.13*sin(dot(gp,vec3(-.037,.011,.023)));
      float tone=clamp(.30+lum*1.35+rolling*.22,0.,1.);
      float grain=texture2D(turfNap,sp.yz).r*w.x+texture2D(turfNap,sp.xz).r*w.y+texture2D(turfNap,sp.xy).r*w.z;
      vec3 groundColor=mix(vec3(.09,.20,.040),vec3(.34,.52,.105),tone)*(.48+1.05*grain);
      // Roots use the same sampled turf tone; the upper blades rise into the
      // warm yellow-green shown in the reference instead of staying flat green.
      float bladeGradient=smoothstep(.04,.92,grassHeight);
      vec3 tipColor=mix(vec3(.25,.39,.055),vec3(.48,.61,.13),tone);
      diffuseColor.rgb*=mix(groundColor,tipColor,bladeGradient);
      diffuseColor.a*=smoothstep(0.,.12,grassHeight);
    `);
  };
  material.customProgramCacheKey=()=> `grass-ground-blend-v6-${!!turf}`;
  return {geometry:cards(3),farGeometry:cards(2),material};
}

const CELL = 48;
const key = (x, y, z) => `${x},${y},${z}`;
const smooth = (a, b, x) => T.MathUtils.smoothstep(x, a, b);

// Sample the final terrain triangles, so roots follow both the hills and lake cut.
// Keep only positions; a fixed-size set of GPU instances draws the nearby region.
export function scatterMeadow(planet, allowed = () => true) {
  planet.updateWorldMatrix(true, false);
  const geo = planet.geometry, pos = geo.attributes.position, bins = new Map();
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const ab = new T.Vector3(), ac = new T.Vector3(), n = new T.Vector3(), p = new T.Vector3(), up = new T.Vector3();
  let seed = 291201, count = 0, flowers = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const read = (v, i) => v.fromBufferAttribute(pos, geo.index ? geo.index.getX(i) : i).applyMatrix4(planet.matrixWorld);
  for (let i = 0; i < (geo.index?.count ?? pos.count); i += 3) {
    read(a, i); read(b, i + 1); read(c, i + 2);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const area = n.length() * .5; n.normalize();
    up.copy(a).add(b).add(c).normalize();
    if (Math.abs(n.dot(up)) < .86) continue;
    const attempts = Math.floor(area * 1.4 + random());
    for (let j = 0; j < attempts; j++) {
      const u = Math.sqrt(random()), v = random();
      p.copy(a).multiplyScalar(1 - u).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v);
      const patch = .5 + .5 * Math.sin(p.x * .057 + Math.sin(p.z * .034) * 2) * Math.cos(p.y * .051 - p.z * .027);
      if (random() > .45 + .55 * patch || lakeMetric(p) < 1.13) continue;
      up.copy(p).normalize();
      if (!allowed(p, up)) continue;
      // Half the flower density; consume the same random values to preserve grass placement.
      const flower = random() < .0125 + .0335 * smooth(.55, .88, patch);
      const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL));
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(p.x, p.y, p.z, random(), flower ? 1 : 0);
      count++; if (flower) flowers++;
    }
  }
  for (const [k, values] of bins) bins.set(k, new Float32Array(values));
  const cellRecords = [];
  for (const [cellKey, data] of bins) {
    const [x,y,z] = cellKey.split(',').map(Number);
    cellRecords.push({ data, center: new T.Vector3((x + .5) * CELL, (y + .5) * CELL, (z + .5) * CELL) });
  }
  return { bins, cellRecords, stats: { roots: count, flowers, cells: bins.size } };
}

function stemGeometry() {
  const positions=[],colors=[];
  const dark=new T.Color('#4b7942'),light=new T.Color('#96b66a');
  for(let j=0;j<2;j++) {
    const angle=j*2.399,dx=Math.cos(angle),dz=Math.sin(angle),w=.055,h=1.38;
    for(const i of [0,1,2,0,2,3]) {
      const [x,y]=[[-w,0],[w,0],[w,h],[-w,h]][i];
      positions.push(dx*x,y,dz*x);colors.push(...dark.clone().lerp(light,y/h).toArray());
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals(); return geo;
}

export function createMeadowPlants(scene, field, { mobile = false, model = createGrassCards() } = {}) {
  // The visible planet is smaller than this radius; the larger budget keeps
  // grass ready while the camera travels and avoids pop-in at the horizon.
  const range = mobile ? 7920 : 10800;
  const nearRange = mobile ? 240 : 330;
  // Three crossed cards nearby, two in the distant ring; keep existing budgets.
  const capacity = model ? (mobile ? 1620 : 3780) : (mobile ? 28000 : 64000);
  const farCapacity = model ? (mobile ? 4000 : 10000) : 0;
  const densityKeep = model ? .6 : 1;
  const uniforms = { meadowTime: { value: 0 }, meadowFocus: { value: new T.Vector3() }, meadowRange: { value: range } };
  function material(flower = false, base = null) {
    const mat = base || (flower ? new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide })
      : new T.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: T.DoubleSide }));
    const baseCompile = mat.onBeforeCompile;
    const baseKey = mat.customProgramCacheKey();
    mat.onBeforeCompile = shader => {
      baseCompile.call(mat, shader);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'uniform float meadowTime; uniform float meadowRange; uniform vec3 meadowFocus;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vec3 root = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
        float growth = 1. - smoothstep(meadowRange - 28., meadowRange, distance(root, meadowFocus));
        transformed *= growth;
        transformed.x += sin(meadowTime * 1.35 + root.x * .16 + root.z * .11) * .075 * position.y * growth;
      `);
      if (flower) shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        float size = length(instanceMatrix[0].xyz);
        float sway = sin(meadowTime * 1.35 + root.x * .16 + root.z * .11) * .1035 * growth;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(sway, 1.38 * growth, 0., 1.);
        mvPosition.xy += position.xy * size * growth;
        gl_Position = projectionMatrix * mvPosition;
      `);
    };
    mat.customProgramCacheKey = () => `meadow-ground-v4-${flower}-${baseKey}`;
    return mat;
  }
  const grassGeometry = model.geometry;
  const grassMaterial = material(false, model.material);
  const grass = new T.InstancedMesh(grassGeometry, grassMaterial, capacity);
  const farGrass = model?.farGeometry ? new T.InstancedMesh(model.farGeometry, grassMaterial, farCapacity) : null;
  const stems = new T.InstancedMesh(stemGeometry(), material(), Math.ceil(capacity * .14));
  const blooms = new T.InstancedMesh(new T.CircleGeometry(.30, 12), material(true), stems.instanceMatrix.count);
  const renderMeshes = [[grass, 'MeadowBlades'], ...(farGrass ? [[farGrass, 'MeadowFarBlades']] : []), [stems, 'MeadowStems'], [blooms, 'MeadowRoundFlowers']];
  for (const [mesh, name] of renderMeshes) {
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = name === 'MeadowBlades' || name === 'MeadowFarBlades';
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); scene.add(mesh);
  }
  const last = new T.Vector3(Infinity, 0, 0), p = new T.Vector3(), up = new T.Vector3(), scale = new T.Vector3();
  const cellRecords = field.cellRecords || [...field.bins].map(([cellKey, data]) => {
    const [x,y,z] = cellKey.split(',').map(Number);
    return { data, center: new T.Vector3((x + .5) * CELL, (y + .5) * CELL, (z + .5) * CELL) };
  });
  const cellDistance = new Float32Array(cellRecords.length);
  const q = new T.Quaternion(), yaw = new T.Quaternion(), axis = new T.Vector3(0, 1, 0), matrix = new T.Matrix4();
  const colors = ['#f3ce55', '#ead9b3'].map(c => new T.Color(c));

  function update(time, focus) {
    uniforms.meadowTime.value = time; uniforms.meadowFocus.value.copy(focus);
    if (last.distanceToSquared(focus) < 36) return;
    last.copy(focus); let gi = 0, fgi = 0, fi = 0;
    // Visit occupied bins only, rather than millions of empty cube cells.
    const cells=[];
    for(let ci=0; ci<cellRecords.length; ci++) {
      const record=cellRecords[ci];
      const distance=cellDistance[ci]=record.center.distanceToSquared(focus);
      if(distance <= (range + CELL) * (range + CELL)) cells.push({data:record.data,distance,ci});
    }
    // Sorting occupied cells is cheaper than walking the old cubic grid and
    // lets the nearest cells fill first without string parsing per update.
    cells.sort((a, b) => a.distance - b.distance);
    const farQuota=Math.max(1,Math.floor(farCapacity/Math.max(1,cells.length)));
    roots: for (const { data } of cells) for (let i = 0; i < data.length; i += 5) {
      p.fromArray(data, i); const distanceSq = p.distanceToSquared(focus); if (distanceSq > range * range) continue;
      const seed = data[i + 3], flower = data[i + 4] > 0;
      if (seed > densityKeep || (mobile && seed < .22)) continue;
      if(gi>=capacity && (!farGrass || fgi>=farCapacity)) break roots;
      if(distanceSq<=nearRange*nearRange ? gi>=capacity : !farGrass || fgi>=farCapacity) continue;
      // Evenly distribute far cards across bins; never exhaust the pool in
      // the first few cells and leave the expanded distance empty.
      if(distanceSq>nearRange*nearRange && Math.floor(i/5)%Math.max(1,Math.ceil(data.length/5/Math.max(1,farQuota)))!==0) continue;
      up.copy(p).normalize(); q.setFromUnitVectors(axis, up).multiply(yaw.setFromAxisAngle(axis, seed * Math.PI * 2));
      const size = .68 + seed * .55;
      // Sink roots slightly so no sliver appears between blades and sloping land.
      matrix.compose(p.addScaledVector(up, -.08), q, scale.set(size, size, size));
      if (distanceSq <= nearRange * nearRange) {
        if (gi >= capacity) continue;
        grass.setMatrixAt(gi++, matrix);
      } else if (farGrass) {
        if (fgi >= farCapacity) continue;
        farGrass.setMatrixAt(fgi++, matrix);
      } else continue;
      if (flower && fi < stems.instanceMatrix.count) {
        stems.setMatrixAt(fi, matrix); blooms.setMatrixAt(fi, matrix);
        blooms.setColorAt(fi, colors[Math.min(colors.length - 1, Math.floor(seed * colors.length))]); fi++;
      }
    }
    grass.count = gi; if (farGrass) farGrass.count = fgi; stems.count = blooms.count = fi;
    for (const mesh of [grass, farGrass, stems, blooms]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    if (farGrass?.instanceColor) farGrass.instanceColor.needsUpdate = true;
    if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
  }
  function setVisible(visible) {
    grass.visible = visible;
    if (farGrass) farGrass.visible = visible;
    stems.visible = visible; blooms.visible = visible;
  }
  return { update, setVisible, grass, farGrass, stems, blooms, stats: { ...field.stats, maxGrass: capacity + farCapacity, nearRange, range, drawCalls: farGrass ? 4 : 3 } };
}
