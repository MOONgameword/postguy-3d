import * as T from 'three';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { useOutlineMask } from './outline-mask.js?v=20261026-canopy-v1';

export const TREE_TRUNK_URL = './assets/trees/wooden-trunk-v1.glb';
export async function loadTreeTrunk(buffer) {
  const gltf = buffer
    ? await new GLTFLoader().parseAsync(buffer, './assets/trees/')
    : await new GLTFLoader().loadAsync(TREE_TRUNK_URL);
  return prepareTreeTrunk(gltf.scene);
}

export function prepareTreeTrunk(root) {
  root.updateMatrixWorld(true);
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (meshes.length !== 1 || Array.isArray(meshes[0].material)) throw new Error('树干模型需要单一网格和材质');
  const mesh = meshes[0], geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, height = box.max.y - box.min.y;
  if (!(height > 0)) throw new Error('树干模型高度无效');
  // Center the root, not the asymmetric branch canopy, and fit its tips inside
  // the existing foliage. Uniform scaling preserves the supplied silhouette.
  const p = geometry.attributes.position, base = new T.Vector3(); let count = 0;
  for (let i=0;i<p.count;i++) if (p.getY(i)<box.min.y+height*.04) { base.add(new T.Vector3(p.getX(i),0,p.getZ(i))); count++; }
  base.divideScalar(count);
  geometry.translate(-base.x,-box.min.y,-base.z);
  geometry.scale(.88/height,.88/height,.88/height);
  geometry.rotateY(Math.PI/2);
  const uv = geometry.attributes.uv;
  if (!uv || !mesh.material.map) throw new Error('树干模型缺少木纹贴图或 UV');
  // Negative U tags bark for a shared bark/foliage shader, retaining one draw
  // call per tree and the model's original texture coordinates.
  for(let i=0;i<uv.count;i++) uv.setX(i,-3-uv.getX(i));
  const colors = new Float32Array(p.count*3), color = mesh.material.color;
  for(let i=0;i<p.count;i++) colors.set(color.toArray(),i*3);
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  for(const name of Object.keys(geometry.attributes)) if(!['position','normal','uv','color'].includes(name)) geometry.deleteAttribute(name);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  let baseRadius = 0;
  for(let i=0;i<p.count;i++) if(p.getY(i)<.025) baseRadius=Math.max(baseRadius,Math.hypot(p.getX(i),p.getZ(i)));
  return {geometry,texture:mesh.material.map,baseRadius};
}

const hash = name => { let h = 2166136261; for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

const leafMasks=[];
function getLeafMask(index) {
  if (!leafMasks[index]) {
    leafMasks[index] = typeof document === 'undefined' ? new T.Texture() : new T.TextureLoader().load(new URL(`./assets/trees/rei-leaves-${index?'b':'a'}-512.png`,import.meta.url).href);
    leafMasks[index].colorSpace = T.NoColorSpace;
  }
  return leafMasks[index];
}

// Rei's rounded leaf-cluster mask is shared by the visible and shadow passes.
function reiLeaves(material, barkTexture = null) {
  material.onBeforeCompile = shader => {
    shader.uniforms.reiLeafMaskA = {value:getLeafMask(0)};
    shader.uniforms.reiLeafMaskB = {value:getLeafMask(1)};
    shader.vertexShader = 'varying vec2 leafDiskUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nleafDiskUv = uv;');
    shader.fragmentShader = 'uniform sampler2D reiLeafMaskA;\nuniform sampler2D reiLeafMaskB;\nvarying vec2 leafDiskUv;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (leafDiskUv.x >= 0.0) {
        float mask=leafDiskUv.x>1.5 ? texture2D(reiLeafMaskB,leafDiskUv-vec2(2.0,0.0)).r : texture2D(reiLeafMaskA,leafDiskUv).r;
        if (mask < 0.48) discard;
      }`);
    // Leaf cards inherit the crown normal on both sides, avoiding dark back-face rims.
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',T.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','normal *= leafDiskUv.x > -1.5 ? 1.0 : faceDirection;'));
    if (barkTexture && material.isMeshLambertMaterial) {
      shader.uniforms.treeBarkMap = {value:barkTexture};
      shader.fragmentShader = 'uniform sampler2D treeBarkMap;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\nif (leafDiskUv.x <= -2.5) { vec3 bark = texture2D(treeBarkMap, vec2(-3.0-leafDiskUv.x,leafDiskUv.y)).rgb; bark = mix(bark, vec3(.56,.42,.29), .28); diffuseColor.rgb *= bark * vec3(1.12,1.08,1.02); }');
    }
  };
  material.customProgramCacheKey = () => `rei-two-leaf-masks-bark-v3-${!!barkTexture}`;
  return material;
}

export function createTreeMaterial(barkTexture = null) {
  return reiLeaves(new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide}), barkTexture);
}

// Rei_treeLeavesGN: a smooth inner crown with outward-facing masked leaf clusters.
export function buildStylizedTree(seed = 1, stride = 1, trunkGeometry = null) {
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const parts = [], leafPositions = [], leafNormals = [], leafColors = [], leafUvs = [];
  const bark = new T.Color('#65554a'), barkLight = new T.Color('#877260');
  function branch(start, end, bottom, top) {
    const a = new T.Vector3(...start), b = new T.Vector3(...end), d = b.clone().sub(a);
    const geo = new T.CylinderGeometry(top, bottom, d.length(), 7, 1).toNonIndexed();
    geo.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()));
    geo.translate(...a.add(b).multiplyScalar(.5).toArray());
    const colors = [];
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const color = bark.clone().lerp(barkLight, .25 + .4 * Math.max(0, geo.attributes.normal.getX(i)));
      colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count*2).fill(-2),2));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); parts.push(geo);
  }
  if (!trunkGeometry) {
  branch([0, 0, 0], [.035, .29, -.012], .049, .034);
  branch([.035, .28, -.012], [-.035, .49, .025], .035, .024);
  branch([-.035, .47, .025], [-.16, .69, .015], .024, .009);
  branch([-.005, .39, .014], [.17, .55, -.035], .025, .017);
  branch([.17, .54, -.035], [.21, .77, -.015], .017, .006);
  branch([-.045, .48, .02], [-.045, .73, .16], .021, .007);
  }
  const crowns = [[-.20,.70,0,.25,.20,.23],[.22,.77,-.015,.25,.22,.24],[-.035,.94,.015,.24,.23,.23],[-.03,.74,.21,.23,.18,.23],[.015,.72,-.20,.24,.19,.23]];
  const dark = new T.Color('#23735c'), mid = new T.Color('#60a955'), light = new T.Color('#a9cd67');
  const foliageColor = (y,n) => {
    const tint=T.MathUtils.clamp((y-.48)/.68*.72+(n+1)*.14,0,1);
    return tint<.5?dark.clone().lerp(mid,tint*2):mid.clone().lerp(light,(tint-.5)*2);
  };
  const cores=[];
  const center = new T.Vector3(), normal = new T.Vector3(), tangent = new T.Vector3(), bitangent = new T.Vector3(), point = new T.Vector3();
  for (const [x,y,z,rx,ry,rz] of crowns) {
    const core=new T.IcosahedronGeometry(1,0);
    core.scale(rx*.79,ry*.79,rz*.79);core.translate(x,y,z);
    const cp=core.attributes.position,cn=core.attributes.normal,cc=[];
    for(let i=0;i<cp.count;i++){
      const n=new T.Vector3((cp.getX(i)-x)/rx,(cp.getY(i)-y)/ry+.65,(cp.getZ(i)-z)/rz).normalize();
      cn.setXYZ(i,n.x,n.y,n.z);cc.push(...foliageColor(cp.getY(i),n.y).toArray());
    }
    core.setAttribute('color',new T.Float32BufferAttribute(cc,3));
    core.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(cp.count*2).fill(-1),2));cores.push(core);
    for (let i = 0; i < 80; i++) {
      const h = 1 - 2 * (i + .25 + random() * .5) / 80, angle = i * 2.399963 + random() * .3, radial = Math.sqrt(1 - h * h);
      normal.set(radial * Math.cos(angle), h, radial * Math.sin(angle));
      const depth = .88 + random() * .12;
      center.set(x + normal.x * rx * depth, y + normal.y * ry * depth, z + normal.z * rz * depth);
      tangent.set(Math.cos(angle), .25 + random() * .65, Math.sin(angle)).normalize();
      bitangent.crossVectors(normal, tangent);
      if (bitangent.lengthSq() < .01) bitangent.set(1,0,0).cross(normal);
      bitangent.normalize(); tangent.crossVectors(bitangent, normal).normalize();
      tangent.applyAxisAngle(normal, random() * Math.PI * 2);
      bitangent.crossVectors(normal,tangent).normalize();
      const radius = (.081 + random() * .025) * Math.sqrt(stride);
      random(); // Preserve all other random choices and placements.
      const color = foliageColor(center.y+(random()-.5)*.035,normal.y);
      const maskIndex=random()<.5?0:1;
      if (i % stride !== 0) continue;
      const shape = [[-1,-1],[1,-1],[1,1],[-1,1]];
      for (const index of [0,2,1,0,3,2]) {
        const v = shape[index]; point.copy(center).addScaledVector(tangent,v[1]*radius).addScaledVector(bitangent,v[0]*radius);
        leafPositions.push(point.x,point.y,point.z);
        leafUvs.push((v[0]+1)*.5+maskIndex*2,(v[1]+1)*.5);
        // Use crown normals for cohesive soft foliage lighting.
        const nx=normal.x*.65,ny=normal.y*.40+.65,nz=normal.z*.65,nl=Math.hypot(nx,ny,nz);
        leafNormals.push(nx/nl,ny/nl,nz/nl);
        const shade = 1 + v[1]*.025;
        leafColors.push(color.r * shade,color.g * shade,color.b * shade);
      }
    }
  }
  const leaves = new T.BufferGeometry();
  leaves.setAttribute('position',new T.Float32BufferAttribute(leafPositions,3));
  leaves.setAttribute('normal',new T.Float32BufferAttribute(leafNormals,3));
  leaves.setAttribute('color',new T.Float32BufferAttribute(leafColors,3));
  leaves.setAttribute('uv',new T.Float32BufferAttribute(leafUvs,2));
  const trunk = trunkGeometry ? trunkGeometry.clone() : mergeGeometries(parts, false), geometry = mergeGeometries([trunk,...cores,leaves], false);
  geometry.userData.coreTriangles=cores.reduce((n,g)=>n+g.attributes.position.count/3,0);
  for (const part of [...parts,...cores,leaves]) part.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, trunk };
}

export function replaceStylizedTrees(city, { mobile = false, trunkAsset = null } = {}) {
  city.updateMatrixWorld(true);
  const trees = []; city.traverse(o => { if (o.isMesh && /^Tree_/.test(o.name)) trees.push(o); });
  const variants = Array.from({length:6}, (_, i) => buildStylizedTree(817 + i * 397, mobile ? 2 : 1, trunkAsset?.geometry));
  const distant = Array.from({length:6}, (_, i) => buildStylizedTree(817 + i * 397, 4, trunkAsset?.geometry));
  const profiles = new Map();
  const material = createTreeMaterial(trunkAsset?.texture);
  useOutlineMask(material);
  const depthMaterial = reiLeaves(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide}));
  material.name = 'StylizedTree';
  const point = new T.Vector3(), pivot = new T.Vector3(), up = new T.Vector3(), local = new T.Vector3();
  const axis = new T.Vector3(0,1,0), q = new T.Quaternion(), yaw = new T.Quaternion(), scale = new T.Vector3();
  const matrix = new T.Matrix4(); let oldTriangles = 0;
  for (const tree of trees) {
    const id = hash(tree.name), variant = variants[id % variants.length];
    tree.getWorldPosition(pivot); up.copy(pivot).normalize();
    let bottom = Infinity, top = -Infinity;
    const pos = tree.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos,i).applyMatrix4(tree.matrixWorld); const h = point.dot(up);
      bottom = Math.min(bottom,h); top = Math.max(top,h);
    }
    let oldTrunkRadius = 0;
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos,i).applyMatrix4(tree.matrixWorld);
      if (point.dot(up) > bottom + .7) continue;
      local.copy(point).sub(pivot); local.addScaledVector(up,-local.dot(up));
      oldTrunkRadius = Math.max(oldTrunkRadius,local.length());
    }
    const sourceHeight = T.MathUtils.clamp(top-bottom,22,48);
    const height = sourceHeight * .93;
    // Keep the existing crown width while lowering the canopy slightly.
    const width = sourceHeight * (.88 + (id % 101) / 500);
    // Preserve narrow street-tree bases instead of widening their collision footprint.
    const ratio = Math.min(1, Math.max(.3,oldTrunkRadius) / ((trunkAsset?.baseRadius || .049) * width));
    const trunkScale = Math.max(.1,Math.floor(ratio * 10)/10), profileKey = `${id % variants.length}:${trunkScale}`;
    if (!profiles.has(profileKey)) {
      const geo = variant.geometry.clone(), trunk = variant.trunk.clone(), far = distant[id % variants.length].geometry.clone();
      const trunkVertexCount = trunk.attributes.position.count;
      for (const g of [geo,trunk,far]) {
        const p = g.attributes.position;
        for (let i=0;i<Math.min(p.count,trunkVertexCount);i++) {
          const blend = 1 - T.MathUtils.smoothstep(p.getY(i),0,.25);
          p.setX(i,p.getX(i)*(1-blend+blend*trunkScale)); p.setZ(i,p.getZ(i)*(1-blend+blend*trunkScale));
        }
        g.computeBoundingBox(); g.computeBoundingSphere();
      }
      if (trunkAsset) {
        trunk.computeVertexNormals();
        for (const g of [geo,far]) {
          g.attributes.normal.array.set(trunk.attributes.normal.array,0);
        }
      }
      // Keep the current whole-canopy outline without outlining individual leaf cards.
      for (const g of [geo,far]) {
        const mask = new Float32Array(g.attributes.position.count).fill(2);
        mask.fill(1,0,trunkVertexCount);
        g.setAttribute('outlineAllowed',new T.BufferAttribute(mask,1));
      }
      profiles.set(profileKey,{geometry:geo,trunk,far});
    }
    pivot.addScaledVector(up,bottom-pivot.dot(up)-.12);
    q.setFromUnitVectors(axis,up).multiply(yaw.setFromAxisAngle(axis,(id%6283)/1000));
    matrix.compose(pivot,q,scale.set(width,height,width));
    // Share crown/base profiles instead of allocating a separate geometry per tree.
    matrix.premultiply(tree.parent.matrixWorld.clone().invert());
    oldTriangles += (tree.geometry.index?.count ?? pos.count)/3;
    matrix.decompose(tree.position,tree.quaternion,tree.scale);
    tree.geometry=profiles.get(profileKey).geometry; tree.material=material;
    tree.customDepthMaterial=depthMaterial;
    tree.userData.collisionGeometry=profiles.get(profileKey).trunk;
    tree.userData.stylizedTree=true;
    tree.userData.treeLod={near:tree.geometry,far:profiles.get(profileKey).far};
  }
  for(const variant of [...variants,...distant]){variant.geometry.dispose();variant.trunk.dispose();}
  city.updateMatrixWorld(true);
  return { trees:trees.length,oldTriangles,triangles:trees.reduce((n,t)=>n+t.geometry.attributes.position.count/3,0),variants:6,sharedGeometries:profiles.size,trunkModel:trunkAsset ? TREE_TRUNK_URL : 'procedural' };
}
