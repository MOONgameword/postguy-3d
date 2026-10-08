import * as THREE from 'three';
import {loadPanda, PANDA_URL} from './panda-character.js?v=20260930-28';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { createAtmosphere, createDriftingSeeds } from './atmosphere.js?v=20260928';
import { decodeRoadGeometry, installRoadGeometry, installJunctionFurniture } from './road-geometry.js?v=20260928-4';
import { createLakeside, isLakeWater, lakePoint, LAKE_WATER } from './lakeside.js?v=20260930-22';
import { reduceSceneDensity } from './scene-density.js?v=20260929-9';
import { raiseGrassLevel } from './grass-level.js?v=20260930-22';
import { createCollisionWorld, sweepSphere } from './collision-world.js?v=20260929-15';
import { installSurfaceMaterials } from './surface-materials.js?v=20261008-08';
import { installSoftTerrain, smoothTerrainNormals } from './soft-terrain.js?v=20260929-11';
import { scatterMeadow, createMeadowPlants, createGrassCards, GRASS_TEXTURE_URL } from './meadow-plants.js?v=20261008-08';
import { replaceStylizedTrees, loadTreeTrunk, TREE_TRUNK_URL } from './stylized-trees.js?v=20260930-32';
import { roundSceneRocks } from './rounded-rocks.js?v=20260929-19';
import { installFloatingStick } from './floating-stick.js?v=20260929-16';
import { overviewDistance, updatePlanetClipping } from './planet-camera.js?v=20261008-08';

let meadowPlants = null;

/* ?pc / ?mob 强制切换手机/桌面档：headless 截图和手机档的画质差别很大
   （比如手机档城市不投影），排查画面问题时必须能指定跑哪一档。 */
const IS_MOBILE = /(\?|&)pc(&|$)/.test(location.search) ? false
  : /(\?|&)mob(&|$)/.test(location.search) ? true
  : /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
const DEBUG = /(\?|&)debug/.test(location.search);
document.body.classList.toggle('mobile-ui', IS_MOBILE);
const AUTO = /(\?|&)auto/.test(location.search);
const SELFTEST = /(\?|&)selftest/.test(location.search);

/* 星球城市是按「巨人尺度」建的：路灯 28.8 米高、马路 16 米宽、楼 30 米高，
   照真人 1.72 米放进去，人和车就成了地上的小蚂蚁。
   所以整套长度和速度都乘 S，角速度（转向、转身）保持不变——
   这样转弯半径 v/ω 和跳跃高度 v²/2g 也正好跟着放大 S 倍，手感和放大前一致。
   凡是描述城市模型本身的量（FLAT、EYE、VIEW_ARC、雾、格网分辨率）不参与缩放。 */
const S = 3;

const CFG = {
  bikeLen: 1.95 * S,
  riderHeight: 1.72 * S,
  maxSpeed: 17 * S,
  accel: 11 * S,
  brake: 22 * S,
  drag: 0.8,                    // 1/秒，与尺度无关
  steer: 2.3,                   // 弧度/秒，与尺度无关
  reachRadius: 4.2 * S,
  walkSpeed: 1.9 * S,
  runSpeed: 5.4 * S,
  jumpVel: 4.8 * S,
  gravity: 15 * S,
  footTurn: 10,                 // 弧度/秒的跟随系数，与尺度无关
  footRadius: 0.42 * S,
  mountRange: 3.4 * S,
  bikeRadius: 0.7 * S,          // 电动车的碰撞半径
  shadowSize: IS_MOBILE ? 512 : 2048,
  shadowSpan: (IS_MOBILE ? 38 : 52) * S,
  /* 雾要淡、要远：近端往外推，远处的楼才不会一上来就被刷白。
     但远端必须压在 VIEW_ARC 之内（雾把剔除那一下跳变盖住），
     所以放雾必须连着放 VIEW_ARC，两个值一起改。 */
  fog: IS_MOBILE ? [180, 440] : [240, 570],
  maxDpr: IS_MOBILE ? 1.25 : 1.75
};

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);

const state = {
  coin: 0, parcel: 0, lv: 1, xp: 0, xpMax: 100,
  phase: 'pickup', target: null, mailboxes: [],
  speed: 0, tris: 0,
  onBike: true,
  /* 骑手所在的球面 frame（位置 + 朝向合一），以及镜头相对朝向的偏角 */
  q: new THREE.Quaternion(), camOff: 0,
  rs: {}                                // 车流重投原因计数（?cartest 用）
};

/* ---------- renderer / scene ---------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, CFG.maxDpr));
renderer.shadowMap.enabled = !/(\?|&)noshadow/.test(location.search);
renderer.shadowMap.type = IS_MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd9d5bf, CFG.fog[0], CFG.fog[1]);

const camera = new THREE.PerspectiveCamera(48, 1, 0.15 * S, 5200);
camera.position.set(0, 6, -10);

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  const puff = (x, y, r, warm) => {
    const rg = g.createRadialGradient(x, y, r * 0.15, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.80, warm ? 'rgba(233,243,252,1)' : 'rgba(255,255,255,1)');
    rg.addColorStop(0.92, warm ? 'rgba(226,238,250,.92)' : 'rgba(255,255,255,.95)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  };
  [[74, 74, 40], [118, 56, 50], [172, 76, 38], [102, 88, 34], [146, 90, 32], [200, 92, 26]]
    .forEach(([x, y, r]) => puff(x, y, r, false));
  [[96, 102, 30], [150, 105, 26]].forEach(([x, y, r]) => puff(x, y, r, true));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const cloudTex = cloudTexture();
/* 云的位置每帧在玩家脚下的切平面里重算，这里只存「东/北向偏移 + 高度」 */
const clouds = [];
for (let i = 0; i < (IS_MOBILE ? 4 : 7); i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0xe7dfcd, transparent: true, opacity: 0.16, fog: false, depthWrite: false }));
  const s = (70 + Math.random() * 90) * S;
  sp.scale.set(s, s * 0.46, 1);
  scene.add(sp);
  clouds.push({
    sp,
    u: rand(-300, 300), v: rand(-260, 260), h: (48 + Math.random() * 80) * S,
    spd: (1.1 + Math.random() * 1.5) * S
  });
}

const hemisphere = new THREE.HemisphereLight(0xb9c9c5, 0x969b7d, 1.35);
const ambient = new THREE.AmbientLight(0xe4dfcc, 0.55);
scene.add(hemisphere, ambient);
const sun = new THREE.DirectionalLight(0xfff8e6, 1.3);
sun.position.set(46 * S, 86 * S, 38 * S);
sun.castShadow = true;
sun.shadow.mapSize.set(CFG.shadowSize, CFG.shadowSize);
sun.shadow.bias = -0.0006;
/* 阴影范围乘了 S，一个阴影像素覆盖的世界尺寸也跟着大 S 倍，偏移量必须一起放大 */
sun.shadow.normalBias = 0.075 * S;
sun.shadow.radius = IS_MOBILE ? 1 : 2;
const sc = sun.shadow.camera;
sc.left = -CFG.shadowSpan; sc.right = CFG.shadowSpan;
sc.top = CFG.shadowSpan; sc.bottom = -CFG.shadowSpan;
sc.near = 1; sc.far = 240 * S;
scene.add(sun, sun.target);
const atmosphere = createAtmosphere(scene, renderer, sun, hemisphere, ambient);
const updateSeeds = createDriftingSeeds(scene, IS_MOBILE ? 20 : 42);
let scenicView = new URLSearchParams(location.search).has('scenic');
let evening = false;
let lakeside = null;
let introPreview = !DEBUG && !/(?:\?|&)(?:selftest|cartest|footest)(?:&|$)/.test(location.search);

/* Matte postcard palette; preserve the source model's faceted normals. */
const WASH = { sat: 0.78, contrast: 0.94, coolShadow: 0.04 };
function pastel(m) {
  const f = v => v.toFixed(4);
  m.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float green = smoothstep(0.015, 0.12, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
       float vegetationLight = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));
       vec3 sage = vec3(0.24, 0.32, 0.15) * (0.55 + vegetationLight * 1.6);
       diffuseColor.rgb = mix(diffuseColor.rgb, sage, green * 0.74);
       float wg = dot(diffuseColor.rgb, vec3(0.299,0.587,0.114));
       diffuseColor.rgb = mix(vec3(wg), diffuseColor.rgb, ${f(WASH.sat)});
       diffuseColor.rgb = (diffuseColor.rgb - 0.5) * ${f(WASH.contrast)} + 0.5;
       diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86,0.94,1.12), ${f(WASH.coolShadow)} * (1.0 - wg));
       diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);`);
  };
  m.customProgramCacheKey = () => 'postcard-matte-v1';
  return m;
}

/* 同一个源材质只转换一次：星球城市有 3000 多个 mesh，每个都新建一份
   MeshToonMaterial 会编译出几千个 program、拖垮启动。
   palette 模式针对「一格一个纯色」的调色板图集：必须用 NearestFilter，
   线性插值会把相邻色格糊在一起，模型上会出现莫名的杂色条纹。 */
/* 模型里 City_Road 的底色是 #131417——亮度只有 7%，比沥青该有的灰暗得多。
   赛璐璐再往上加对比（暗部乘 0.7、(c-0.5)*1.06+0.5），整条马路就压成一片死黑，
   紧贴着饱和的绿草，看着像地上破了个洞。这里把这几个过暗的地表色抬到正常灰度。 */
const CITY_TINT = {
  City_Road: 0x85877b, City_RoadLine: 0xe9dec0, City_Sidewalk: 0xb9b39a,
  City_Curb: 0xd4cbb1, City_Grass: 0x8d9a66, City_Meadow: 0xa2ab78,
  City_Rock: 0xa6a392,
};

const toonCache = new Map();
function toonMat(m, opts) {
  const src = opts.map || (m && m.map) || null;
  const key = (m ? m.uuid : '-') + '|' + (src ? src.uuid : '-') + (opts.palette ? '|p' : '');
  let out = toonCache.get(key);
  if (out) return out;
  if (src) {
    src.colorSpace = THREE.SRGBColorSpace;
    if (opts.palette) {
      src.magFilter = src.minFilter = THREE.NearestFilter;
      src.generateMipmaps = false;
      src.anisotropy = 1;
    } else {
      src.anisotropy = IS_MOBILE ? 2 : 4;
    }
    src.needsUpdate = true;
  }
  out = pastel(new THREE.MeshLambertMaterial({
    name: (m && m.name) || '',
    /* 有贴图的（Bld / Street / 树石草）颜色全在调色板图上，底色刷白；
       没贴图的（City_Road / City_Grass / City_Curb…）颜色只存在 material.color 里，
       刷白就会变成一整片惨白的地面，必须原样保留。 */
    color: src ? 0xffffff
      : CITY_TINT[(m && m.name) || ''] !== undefined ? CITY_TINT[m.name]
        : (m && m.color ? m.color.getHex() : 0xffffff),
    map: src
  }));
  toonCache.set(key, out);
  return out;
}

function toonify(root, opts = {}) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => toonMat(m, opts));
    o.material = out.length === 1 ? out[0] : out;
    o.castShadow = opts.castShadow !== false;
    o.receiveShadow = true;
  });
}

/* ---------- 描边（反向壳 / inverted hull） ---------- */
const OUTLINE = /(?:\?|&)outline(?:&|$)/.test(location.search);
const OUTLINE_MUL = parseFloat((location.search.match(/[?&]lw=([\d.]+)/) || [])[1]) || 1;
const OUTLINE_COLOR = 0x2b2622;
const outlineMats = new Map();
function outlineMaterial(thickness) {
  const w = Math.max(0.0004, thickness);
  const key = w.toFixed(5);
  if (outlineMats.has(key)) return outlineMats.get(key);
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide, fog: true });
  m.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec3 aHull;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed += aHull * ' + Number(key).toFixed(6) + ';');
  };
  m.customProgramCacheKey = () => 'outline' + key;
  outlineMats.set(key, m);
  return m;
}

/* 低多边形模型的法线是分面的，直接沿法线挤会让每个面各自飞出去、棱角处露出缝。
   这里按顶点位置把法线焊接平均一次，存成 aHull 属性，壳体才是连续的。 */
function bakeHullNormals(geo) {
  if (geo.attributes.aHull) return;
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  if (!pos || !nrm) return;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const sums = new Map();
  const keys = new Array(n);
  const Q = 1000;
  for (let i = 0; i < n; i++) {
    const k = (Math.round(pos.getX(i) * Q) * 73856093 ^ Math.round(pos.getY(i) * Q) * 19349663 ^
      Math.round(pos.getZ(i) * Q) * 83492791) | 0;
    keys[i] = k;
    let s = sums.get(k);
    if (!s) sums.set(k, s = [0, 0, 0]);
    s[0] += nrm.getX(i); s[1] += nrm.getY(i); s[2] += nrm.getZ(i);
  }
  for (let i = 0; i < n; i++) {
    const s = sums.get(keys[i]);
    let x = s[0], y = s[1], z = s[2];
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) { x = nrm.getX(i); y = nrm.getY(i); z = nrm.getZ(i); }
    else { x /= len; y /= len; z /= len; }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  geo.setAttribute('aHull', new THREE.BufferAttribute(out, 3));
}

const vScale = new THREE.Vector3();
function addOutline(root, world = 0.03) {
  if (!OUTLINE) return;
  const list = [];
  root.traverse(o => { if (o.isMesh && !o.userData.__outline) list.push(o); });
  for (const o of list) {
    if (!o.geometry || !o.geometry.attributes.normal) continue;
    bakeHullNormals(o.geometry);
    if (!o.geometry.attributes.aHull) continue;
    o.getWorldScale(vScale);
    const avg = (Math.abs(vScale.x) + Math.abs(vScale.y) + Math.abs(vScale.z)) / 3 || 1;
    const mat = outlineMaterial(world * OUTLINE_MUL / avg);
    let shell;
    if (o.isSkinnedMesh) {
      shell = new THREE.SkinnedMesh(o.geometry, mat);
      shell.bind(o.skeleton, o.bindMatrix);
      shell.frustumCulled = false;
    } else {
      shell = new THREE.Mesh(o.geometry, mat);
    }
    shell.userData.__outline = true;
    shell.renderOrder = -1;
    shell.castShadow = false;
    shell.receiveShadow = false;
    o.add(shell);
  }
}

/* ---------- 顶点色道具（车 / 树共享一个卡通材质） ---------- */
const VC_MAT = pastel(new THREE.MeshLambertMaterial({ vertexColors: true }));
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function pbox(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return paint(g, hex);
}
function pcyl(rt, rb, h, seg, x, y, z, hex, rz) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z); return paint(g, hex);
}
function psphere(r, x, y, z, hex, squash) {
  const g = new THREE.SphereGeometry(r, 9, 7);
  if (squash) g.scale(1, squash, 1);
  g.translate(x, y, z); return paint(g, hex);
}
function mergeParts(parts) {
  const g = BufferGeometryUtils.mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

/* ---------- 汽车车款（城市资源包 car-city.fbx，63 款共用城市那张调色板图集） ----------
   资源里 63 辆车一排排摆在原点旁边，长轴已经朝 +Z、车头也在 +Z 那端，
   正好对上车流逻辑的 fFwd。这里把每辆搬回原点（XZ 居中、轮胎贴 y=0），
   再统一乘同一个系数——「普通轿车 356 单位 = 3.9 个身位」。
   不逐辆归一化车长：那样校车、加长车会被压成轿车大小，街上全是一个尺码。 */
const CAR_UNIT = 3.9 * S / 356;
const carVariants = [];
let CAR_MAT = VC_MAT;
function buildCars(root, atlas) {
  /* 车的贴图就是城市那张图集（textures\Textures.png，和 assets/Textures.png 同一份文件）。
     FBX 里写的是相对路径，FBXLoader 会去找 ./assets/textures/ 找不到，所以这里手动喂给它。 */
  toonify(root, { palette: true, map: atlas });
  root.updateMatrixWorld(true);
  const ctr = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    CAR_MAT = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.clone();
    for (const k in g.attributes) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!g.attributes.uv) {
      /* 停靠车要合并成一个网格：属性表必须齐整，缺 UV 的补一份空的 */
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();   // 停靠车要合并成一个网格，索引状态必须一致
    g.computeBoundingBox();
    g.boundingBox.getCenter(ctr);
    g.translate(-ctr.x, -g.boundingBox.min.y, -ctr.z);
    /* 万一某个车款的长轴摆在 X 上，转 90° 掰回 +Z，不然它会横着在路上开 */
    if (g.boundingBox.max.x - g.boundingBox.min.x > g.boundingBox.max.z - g.boundingBox.min.z) g.rotateY(Math.PI / 2);
    g.scale(CAR_UNIT, CAR_UNIT, CAR_UNIT);
    g.computeBoundingBox();
    carVariants.push(g);
  });
}
function carGeo() { return carVariants[(Math.random() * carVariants.length) | 0]; }

/* ---------- 最近墙面方向与距离（贴边停车用） ---------- */
const _wpQ = new THREE.Quaternion();
function wallProbe(q) {
  let best = null;
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI / 2;
    let d = 7 * S;
    for (let t = 1.2 * S; t < 7 * S; t += 0.7 * S) {
      _wpQ.copy(q);
      turn(_wpQ, ang);
      advance(_wpQ, t);
      if (blockedAt(_wpQ, 0.5 * S)) { d = t; break; }
    }
    if (!best || d < best.d) best = { ang, d };
  }
  return best;
}

/* frame -> 世界矩阵（把道具几何体烘到球面上） */
const _fmP = new THREE.Vector3(), _fmS = new THREE.Vector3(1, 1, 1);
function frameMatrix(q, h, out) {
  framePos(q, h, _fmP);
  return out.compose(_fmP, q, _fmS);
}

/* ---------- 路边停靠车辆（合并成一个静态网格） ---------- */
function placeParked(n) {
  const geos = [], placed = [];
  const q = new THREE.Quaternion(), back = new THREE.Quaternion();
  const m = new THREE.Matrix4(), pos = new THREE.Vector3();
  for (let i = 0, tries = 0; i < n && tries < n * 14; tries++) {
    /* 只停在出生点这片街区，撒满整颗星球的话一辆也看不见 */
    const road = findRoadFrame(2.2 * S, state.q, 320 * S);
    const w = wallProbe(road);
    if (!w || w.d < 3.4 * S || w.d > 5.6 * S) continue;
    /* 先朝墙那侧挪过去，再转 90° 让车身与街道平行 */
    q.copy(road);
    turn(q, w.ang);
    advance(q, w.d - 2.6 * S);
    turn(q, Math.PI / 2);
    if (Math.random() < 0.5) turn(q, Math.PI);
    if (!onFlatRoad(q)) continue;
    back.copy(q);
    turn(back, Math.PI);
    if (!dirClear(q, 3.4 * S, 1.1 * S) || !dirClear(back, 3.4 * S, 1.1 * S)) continue;
    framePos(q, 0, pos);
    if (placed.some(p => p.distanceTo(pos) < 6 * S)) continue;
    if (state.mailboxes.some(mb => mb.position.distanceTo(pos) < 4 * S)) continue;
    placed.push(pos.clone());
    const g = carGeo().clone();
    g.applyMatrix4(frameMatrix(q, 0, m));
    geos.push(g);
    stampOcc(q, 1.1 * S);
    i++;
  }
  if (!geos.length) return;
  const mesh = new THREE.Mesh(mergeParts(geos), CAR_MAT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addOutline(mesh, 0.015 * S);
  scene.add(mesh);
}

/* ---------- 路上车流 ---------- */
const traffic = [];
const CAR_SPEED = 6.5 * S;
/* 车流只准待在车道上。占用图只挡楼和树，草坪、广场、人行道在它眼里全是空地，
   所以光用 dirClear 探路的车会一头开进草地。这里前方每 1.6 个身位取一点，
   既查障碍也查车道掩码，横向留 0.9 个身位的余量（掩码格 1.2 单位、车宽 5 单位）。
   注意起点从 1.6 个身位算，不查车自己脚下：车贴着路边线走时脚下那一圈本来就压线，
   连自己脚下一起查会让四个方向全判不通、原地卡死，压测里出现过 300 秒重投 4 万次。 */
const LANE_R = 0.9 * S;
/* ?nolane 关掉车道约束（只剩障碍探路），用来对比「车是被车道卡住的还是本来就慢」 */
const LANE_FREE = /(\?|&)nolane/.test(location.search);
const _lcQ = new THREE.Quaternion(), _olU = new THREE.Vector3();
function laneClear(q, dist) {
  _lcQ.copy(q);
  for (let d = 1.6 * S; d <= dist; d += 1.6 * S) {
    advance(_lcQ, 1.6 * S);
    if (blockedAt(_lcQ, 1.05 * S)) return false;
    if (!LANE_FREE && !driveAt(_lcQ, LANE_R)) return false;
  }
  return true;
}
/* 落位硬闸门：只看车心那一格在不在车道上。这条不带横向余量，
   探路负责「早点转弯别贴边」，这里只负责「车心一步都不许离开路面」。 */
function onLane(q) { return LANE_FREE || driveDir(fUp(q, _olU)); }
const _scPos = new THREE.Vector3(), _scNear = new THREE.Vector3();
function spawnCar(c, nearQ, why) {
  state.carResp = (state.carResp || 0) + 1;
  if (why) state.rs[why] = (state.rs[why] || 0) + 1;
  if (nearQ) framePos(nearQ, 0, _scNear);
  for (let i = 0; i < 30; i++) {
    const q = findRoadFrame(2.4 * S, nearQ, nearQ ? 95 * S : 0);
    framePos(q, 0, _scPos);
    if (nearQ && _scPos.distanceTo(_scNear) < 14 * S) continue;
    /* 太远的也不要：findRoadFrame 在这一圈里凑不出车道时会退回北极那个兜底 frame，
       那位置离玩家半个星球远，落位后立刻又触发「太远重投」，一帧一次死循环——
       压测里 300 秒空转出过 3 万次重投。 */
    if (nearQ && _scPos.distanceTo(_scNear) > 105 * S) continue;
    /* 找一个「顺着车道」能往前开一段的朝向，四个方向都不顺就换地方 */
    let ok = false;
    for (let k = 0; k < 4; k++) {
      if (laneClear(q, 8 * S)) { ok = true; break; }
      turn(q, Math.PI / 2);
    }
    if (!ok) continue;
    if (traffic.some(o => o !== c && o.alive && o.mesh.position.distanceTo(_scPos) < 7 * S)) continue;
    c.q.copy(q);
    c.v = 0;
    c.stuck = 0;
    c.alive = true;
    c.mesh.position.copy(_scPos);
    c.mesh.quaternion.copy(q);
    c.mesh.visible = true;
    return;
  }
  c.alive = false;
  c.mesh.visible = false;
}
function initTraffic(n) {
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(carGeo(), CAR_MAT);
    mesh.castShadow = true;
    addOutline(mesh, 0.015 * S);
    scene.add(mesh);
    const c = { mesh, q: new THREE.Quaternion(), v: 0, stuck: 0, alive: false };
    traffic.push(c);
    spawnCar(c, state.q);
  }
}

/* 把某个 frame 沿切平面推离一个点，朝向不变（撞车时顶开玩家） */
const _paP = new THREE.Vector3(), _paD = new THREE.Vector3(), _paU = new THREE.Vector3();
const _paF = new THREE.Vector3(), _paC = new THREE.Vector3();
function pushAway(q, fromPos, amount) {
  framePos(q, 0, _paP);
  _paD.copy(_paP).sub(fromPos);
  fUp(q, _paU);
  _paD.addScaledVector(_paU, -_paD.dot(_paU));
  if (_paD.lengthSq() < 1e-8) return;
  _paD.normalize();
  const ang = Math.atan2(_paC.crossVectors(fFwd(q, _paF), _paD).dot(_paU), _paF.dot(_paD));
  turn(q, ang);
  advance(q, amount);
  turn(q, -ang);
}

const _tq1 = new THREE.Quaternion(), _tq2 = new THREE.Quaternion();
const _tFwd = new THREE.Vector3(), _tD = new THREE.Vector3();
function updateTraffic(dt) {
  const fq = focusFrame(), fp = focusPos();
  for (const c of traffic) {
    if (!c.alive) {
      /* spawnCar 一次找不到位置会把车收起来（alive=false）。这里隔一秒再试一次，
         否则街上的车只会越跑越少，最后一辆不剩。 */
      c.wait = (c.wait || 0) + dt;
      if (c.wait > 1) { c.wait = 0; spawnCar(c, fq, 'retry'); }
      continue;
    }
    let want = CAR_SPEED;
    c.why = 'go';
    if (!laneClear(c.q, 5.2 * S)) {
      /* 前面到头了（撞上障碍，或者车道在这儿拐弯 / 结束）：先试左右两条车道 */
      _tq1.copy(c.q); turn(_tq1, Math.PI / 2);
      _tq2.copy(c.q); turn(_tq2, -Math.PI / 2);
      if (laneClear(_tq1, 8 * S)) c.q.copy(_tq1);
      else if (laneClear(_tq2, 8 * S)) c.q.copy(_tq2);
      else {
        /* 三面都出车道就掉头。掉头也不行才算真困住——不掉头的话车会顶着草地
           一直等，路口边上停一排不动的车。 */
        _tq1.copy(c.q); turn(_tq1, Math.PI);
        if (laneClear(_tq1, 8 * S)) c.q.copy(_tq1);
        else {
          want = 0;
          c.why = 'lane';
          c.stuck += dt;
          if (c.stuck > 2.5) { spawnCar(c, fq, 'lane'); continue; }
        }
      }
    } else if (Math.random() < dt * 0.25) {
      _tq1.copy(c.q);
      turn(_tq1, Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      if (laneClear(_tq1, 9 * S)) c.q.copy(_tq1);
    }

    const cp = c.mesh.position;
    fFwd(c.q, _tFwd);
    for (const o of traffic) {
      if (o === c || !o.alive) continue;
      _tD.copy(o.mesh.position).sub(cp);
      if (_tD.dot(_tFwd) > 0.5 && _tD.lengthSq() < 16 * S * S) { want = 0; c.why = 'car'; break; }
    }
    _tD.copy(fp).sub(cp);
    if (_tD.dot(_tFwd) > 0.3 && _tD.lengthSq() < 14 * S * S) { want = 0; c.why = 'you'; }

    c.v += clamp(want - c.v, -9 * S * dt, 2.5 * S * dt);
    if (c.v > 0.05) {
      _tq1.copy(c.q);
      advance(_tq1, c.v * dt);
      _tq2.copy(_tq1);
      advance(_tq2, 1.9 * S);
      /* 真正落位前再确认一次：往前 1.9 个身位既不撞东西、也还在车道上。
         这一步是硬闸门，前面的探路只影响转向，出车道的位移一律不许提交。 */
      if (!blockedAt(_tq2, 0.95 * S) && onLane(_tq2)) { c.q.copy(_tq1); c.stuck = 0; }
      else {
        c.v = 0;
        c.why = 'wall';
        c.stuck += dt;
        if (c.stuck > 2.5) { spawnCar(c, fq, 'wall'); continue; }
      }
    }
    framePos(c.q, 0, cp);
    c.mesh.quaternion.slerp(c.q, Math.min(1, dt * 7));
    /* 车流健康度：全时段平均速度 + 重投次数。只看瞬时速度会被「刚重投完在加速」骗过去 */
    state.carVs = (state.carVs || 0) + c.v * dt;
    state.carTs = (state.carTs || 0) + dt;

    const dd = cp.distanceTo(fp);
    if (dd < 2.1 * S && dd > 0.01) {
      pushAway(fq, cp, 2.1 * S - dd);
      if (state.onBike) state.speed *= 0.3; else foot.speed *= 0.3;
      if (!state.bumpT || clock.elapsedTime - state.bumpT > 2) {
        state.bumpT = clock.elapsedTime;
        toast('小心车辆！');
      }
    }
    if (dd > 115 * S) spawnCar(c, fq, 'far');
  }
}

/* ---------- 取信 / 送达动效 ---------- */
function fxEl(cls, txt, x, y) {
  const el = document.createElement('div');
  el.className = 'fx ' + cls;
  el.textContent = txt;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  $('fx').appendChild(el);
  return el;
}
function flyLetter() {
  const stage = $('stage').getBoundingClientRect();
  const pill = $('parcel').getBoundingClientRect();
  const sx = stage.width / 2, sy = stage.height * 0.55;
  const dx = pill.left - stage.left + pill.width / 2 - sx;
  const dy = pill.top - stage.top + pill.height / 2 - sy;
  const el = fxEl('fly', '✉️', sx, sy);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 1 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.55)`, opacity: .9 }
  ], { duration: 620, easing: 'cubic-bezier(.25,.7,.3,1)' }).onfinish = () => el.remove();
}
function coinPop(gain) {
  const stage = $('stage').getBoundingClientRect();
  const el = fxEl('pop', '+' + gain + ' 金币', stage.width / 2, stage.height * 0.42);
  el.animate([
    { transform: 'translate(-50%,-50%) translateY(0)', opacity: 1 },
    { transform: 'translate(-50%,-50%) translateY(-70px)', opacity: 0 }
  ], { duration: 900, easing: 'ease-out' }).onfinish = () => el.remove();
  $('coin').parentElement.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 320 });
}

/* ---------- loading ----------
   星球城市模型 8.6MB，加上骑手 / 电动车贴图一共约 16MB，GitHub Pages 不给
   .fbx 和 .jpg 做有效压缩（里面是浮点顶点和已压缩的图），省流量这条路走不通，只能：
     1. 存到 Cache Storage —— 首次下完之后再进游戏是秒开，断网也能玩
     2. 下载失败退避重试 —— 手机弱网下断一次不至于整局白费              */
const loader = new FBXLoader();

const CACHE_NAME = 'postman-assets-v5';
const NOCACHE = /(\?|&)nocache/.test(location.search);
let assetCache;

/* caches 只在安全上下文可用（https / localhost）。
   局域网 http://192.168.x.x 拿不到，此时静默退化成普通下载。 */
/* Cache API 在某些环境（隐私模式、配额满、WebView 实现有坑）会卡住不返回。
   所有缓存操作都套一层超时，卡住就当没缓存，绝不能拖死整个加载。 */
function withTimeout(promise, ms, fallback) {
  return new Promise(res => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(fallback); } }, ms);
    promise.then(v => { if (!done) { done = true; clearTimeout(t); res(v); } },
      () => { if (!done) { done = true; clearTimeout(t); res(fallback); } });
  });
}

async function openCache() {
  if (assetCache !== undefined) return assetCache;
  assetCache = false;
  if (!self.caches) return assetCache;
  if (NOCACHE) {
    /* ?nocache 不只是「这次不用缓存」，而是把旧缓存全删掉 ——
       万一哪次发布忘了升 CACHE_NAME、导致旧资源一直命中，这就是补救开关 */
    await withTimeout((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => k.startsWith('postman-assets-') ? caches.delete(k) : null));
    })(), 6000, null);
    return assetCache;
  }
  assetCache = await withTimeout((async () => {
    const keys = await caches.keys();
    /* 换了资源就升 CACHE_NAME，这里顺手把旧版本删掉，否则旧文件会一直命中 */
    await Promise.all(keys.map(k => k.startsWith('postman-assets-') && k !== CACHE_NAME
      ? caches.delete(k) : null));
    return await caches.open(CACHE_NAME);
  })(), 4000, false);
  return assetCache;
}

function fileOf(url) { return url.slice(url.lastIndexOf('/') + 1); }

/* 用 XHR 而不是 fetch 流式读取：fetch 的 ReadableStream 在旧版 iOS Safari 上没有，
   而 XHR 的 progress 事件到处都能用 */
function fetchProgress(url, onFrac) {
  return new Promise((res, rej) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 90000;
    xhr.onprogress = e => { if (onFrac && e.lengthComputable) onFrac(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) res(xhr.response);
      else rej(new Error('HTTP ' + xhr.status + ' · ' + fileOf(url)));
    };
    xhr.onerror = () => rej(new Error('网络中断 · ' + fileOf(url)));
    xhr.ontimeout = () => rej(new Error('下载超时 · ' + fileOf(url)));
    xhr.send();
  });
}

async function fetchAsset(url, onFrac) {
  const c = await openCache();
  if (c) {
    const hit = await withTimeout(c.match(url), 6000, null);
    if (hit) {
      const buf = await withTimeout(hit.arrayBuffer(), 20000, null);
      if (buf) {
        setTip('已从本机缓存读取 · ' + fileOf(url));
        if (onFrac) onFrac(1);
        return buf;
      }
    }
  }
  const buf = await fetchProgress(url, onFrac);
  if (c) {
    /* 存缓存不阻塞后续加载：存不进去（配额满 / 隐私模式）也照样能玩 */
    withTimeout(c.put(url, new Response(buf.slice(0),
      { headers: { 'Content-Type': 'application/octet-stream' } })), 30000, null);
  }
  return buf;
}

async function withRetry(url, fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i === tries - 1) break;
      const wait = 800 * Math.pow(2, i);
      setTip(fileOf(url) + ' 下载中断，' + (wait / 1000) + ' 秒后重试（第 ' + (i + 1) + '/' + (tries - 1) + ' 次）');
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw last;
}

function loadOne(url, onFrac) {
  return withRetry(url, async () => {
    const buf = await fetchAsset(url, onFrac);
    return loader.parse(buf, url.slice(0, url.lastIndexOf('/') + 1));
  });
}

function loadTex(url) {
  return withRetry(url, async () => {
    const buf = await fetchAsset(url);
    const blob = new Blob([buf]);
    const src = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('解码失败 · ' + fileOf(url)));
        im.src = src;
      });
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    } finally { URL.revokeObjectURL(src); }
  });
}

/* 反向壳只能描出剪影，窗框 / 面板缝这类「内部结构线」描不出来。
   这里对贴图本身跑一遍 Sobel，把颜色突变的地方压暗，等于把墨线直接印进贴图。 */
const INK = /(?:\?|&)ink(?:&|$)/.test(location.search);
function inkTexture(tex, { strength = 0.62, threshold = 0.11 } = {}) {
  if (!INK || !tex || !tex.image) return tex;
  const img = tex.image;
  const w = img.width | 0, h = img.height | 0;
  if (!w || !h) return tex;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h);
  const p = src.data;
  const lum = new Float32Array(w * h);
  for (let i = 0, n = w * h; i < n; i++) {
    lum[i] = (p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114) / 255;
  }
  const out = ctx.createImageData(w, h);
  const q = out.data;
  q.set(p);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i - w - 1] + 2 * lum[i - 1] + lum[i + w - 1] -
        lum[i - w + 1] - 2 * lum[i + 1] - lum[i + w + 1];
      const gy = lum[i - w - 1] + 2 * lum[i - w] + lum[i - w + 1] -
        lum[i + w - 1] - 2 * lum[i + w] - lum[i + w + 1];
      const g = Math.hypot(gx, gy);
      if (g <= threshold) continue;
      const k = 1 - Math.min(1, (g - threshold) * 2.2) * strength;
      const o = i * 4;
      q[o] = p[o] * k; q[o + 1] = p[o + 1] * k; q[o + 2] = p[o + 2] * k;
    }
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.flipY = tex.flipY;
  t.needsUpdate = true;
  return t;
}
function setProgress(f, text) {
  $('ldFill').style.width = Math.round(f * 100) + '%';
  if (text) $('loading').firstChild.textContent = text;
}
function setTip(text) { const e = $('ldTip'); if (e) e.textContent = text || ''; }

/* 缩放到目标尺寸、XZ 居中、底面贴 y=0 */
function normalize(obj, { span, height }) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const s = b.getSize(new THREE.Vector3());
  const k = height ? height / s.y : span / Math.max(s.x, s.z);
  obj.scale.multiplyScalar(k);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b2.min.y;
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
}

/* 把整棵树烘成一个几何体（世界坐标） */
function flatten(root) {
  root.updateMatrixWorld(true);
  const geos = [];
  let material = null;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!material) material = Array.isArray(o.material) ? o.material[0] : o.material;
    const g = o.geometry.clone();
    for (const k in g.attributes) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    g.applyMatrix4(o.matrixWorld);
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  if (!geos.length) return null;
  const geometry = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
  return { geometry, material };
}

/* ---------- 几何体去重 ----------
   FBX 把每栋楼、每棵树都导成独立 mesh，但它们大多共用同一份网格。
   按「顶点数 + 抽样顶点」做指纹，重复的直接指向同一个 BufferGeometry。
   3007 个物体只剩 201 份几何体，显存从 200MB+ 掉到十几 MB。
   注意不能合批：球面上视野被地平线挡住，逐物体视锥剔除比合批更划算。 */
function dedupeGeometries(root) {
  const map = new Map();
  let saved = 0, total = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, p = g.attributes.position;
    if (!p || !p.count) return;
    total++;
    let h = p.count + ':' + (g.index ? g.index.count : 0);
    const NS = 12;                      // 采样 12 个顶点当指纹
    for (let i = 0; i < NS; i++) {
      const j = Math.floor(i * (p.count - 1) / (NS - 1));
      h += '|' + p.getX(j).toFixed(3) + ',' + p.getY(j).toFixed(3) + ',' + p.getZ(j).toFixed(3);
    }
    const hit = map.get(h);
    if (!hit) map.set(h, g);
    /* 这里不要 dispose 重复的几何体：它们还没上传过 GPU，
       但 three.js 的 dispose 事件照样会把 info.memory.geometries 减一，
       几千次之后计数变成负数，性能面板就再也读不准了。丢掉引用交给 GC 就行。 */
    else if (hit !== g) { o.geometry = hit; saved++; }
  });
  return { unique: map.size, saved, total };
}


/* ---------- 星球坐标系 ----------
   城市贴在一个半径约 600 的球面上，原来那套「XZ 平面 + Y 朝上」全部失效。
   这里把「站在哪」和「朝哪」合并成一个四元数 frame：
       up    = frame · (0,1,0)   本地朝天
       fwd   = frame · (0,0,1)   本地朝前
       right = frame · (1,0,0)
   世界坐标 = 球心 + up * (地表半径 + 离地高度)
   前进 d 米 = 绕 right 轴转 d/R（即沿大圆走）；转向 = 绕本地 up 轴转。
   位置和朝向共用同一个量，永远自洽，也不会像「经纬度 + 航向角」那样在极点退化。
   顺带一个好处：模型容器的 rotation.y=-π/2（把朝 +X 的模型转成朝 +Z）这类
   本地修正全都不用动，因为 frame 的本地轴语义和原来完全一致。 */
const PLANET = { C: new THREE.Vector3(), R: 600 };
const YAXIS = new THREE.Vector3(0, 1, 0);

/* 哪些网格算地形（可以走上去），哪些算障碍（撞不过去）。
   模型的命名很规整：Planet 球壳 / Roads 整张路网 /
   Bld_* 楼 / Tree_* 树 / Rock_* 石头 / Grass_* 地被草 / Street_* 路灯。
   Street_* 是 336 根路灯（单个 7.7×28.8×6.2），当初误当成地形，
   结果它们既不参与地平线剔除、又一直全部提交绘制，白白多出 600 多次 draw call。
   草是贴地装饰，既不当地形也不挡路，直接开过去。 */
const TERRAIN = /^(Planet|Roads)/i;

/* 地表半径场 + 障碍占用图，都存成等距圆柱（经纬）网格。
   ground 存浮点半径，地形是低频的，格子粗一点够用；
   occ 是 1 字节挡路标记，必须细，不然贴着楼角走会穿墙。 */
const GRID = { gw: 1280, gh: 640, ground: null, ow: 3072, oh: 1536, occ: null, surf: null, img: null };
const M_DRIVE = 1, M_PAVE = 2;   // surf 的两个标记位：车道 / 人行道+路缘
const _lakeWorld = new THREE.Vector3();

/* 方向 -> 网格下标。d 必须是单位向量（要用 d.y 求极角）。 */
function cellOf(d, w, h) {
  let cu = Math.floor((Math.atan2(d.x, d.z) / (Math.PI * 2) + 0.5) * w);
  let cv = Math.floor(Math.acos(clamp(d.y, -1, 1)) / Math.PI * h);
  if (cu < 0) cu += w; else if (cu >= w) cu -= w;
  if (cv < 0) cv = 0; else if (cv >= h) cv = h - 1;
  return cv * w + cu;
}
function groundR(dir) {
  return GRID.ground ? GRID.ground[cellOf(dir, GRID.gw, GRID.gh)] : PLANET.R;
}
// Lake meshes are centered on world origin; the sampled terrain center can
// differ slightly. Intersect its radial frame with the actual water sphere.
function waterSurfaceR(dir) {
  const offset = PLANET.C.dot(dir);
  return -offset + Math.sqrt(offset * offset + LAKE_WATER * LAKE_WATER - PLANET.C.lengthSq());
}
function blockedDir(dir) {
  if (isLakeWater(_lakeWorld.copy(dir).multiplyScalar(600).add(PLANET.C))) return true;
  return collisionWorld?.blocked(dir) || false;
}
/* 是不是车道（电动车、车流、出生点只认这个）。没烘出掩码时一律当成是。 */
function driveDir(dir) {
  return GRID.surf ? (GRID.surf[cellOf(dir, GRID.ow, GRID.oh)] & M_DRIVE) !== 0 : true;
}
/* 车道 + 人行道 + 路缘：邮箱、停靠车辆、步行可以用 */
function paveDir(dir) {
  return GRID.surf ? GRID.surf[cellOf(dir, GRID.ow, GRID.oh)] !== 0 : true;
}

/* ---------- frame 运算 ----------
   每组临时向量只在一个函数里用，避免嵌套调用互相踩。 */
const _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
const _qt = new THREE.Quaternion();
function fUp(q, out = _up) { return out.set(0, 1, 0).applyQuaternion(q); }
function fFwd(q, out = _fw) { return out.set(0, 0, 1).applyQuaternion(q); }
function fRight(q, out = _rt) { return out.set(1, 0, 0).applyQuaternion(q); }

const _adv = new THREE.Vector3();
function advance(q, dist) {                      // 沿大圆前进
  if (!dist) return q;
  _qt.setFromAxisAngle(fRight(q, _adv), dist / PLANET.R);
  return q.premultiply(_qt).normalize();
}
function turn(q, ang) {                          // 绕本地朝天轴转向
  if (!ang) return q;
  _qt.setFromAxisAngle(YAXIS, ang);
  return q.multiply(_qt).normalize();
}
const _fpU = new THREE.Vector3();
function framePos(q, h, out) {                   // frame + 离地高度 -> 世界坐标
  fUp(q, _fpU);
  return out.copy(PLANET.C).addScaledVector(_fpU, groundR(_fpU) + h);
}

/* 由「朝天方向 + 朝向参考」构造 frame。基底满足 right = up × fwd（右手系）。 */
const _bU = new THREE.Vector3(), _bF = new THREE.Vector3(), _bR = new THREE.Vector3();
const _bM = new THREE.Matrix4();
function frameFromDir(dir, refFwd, out = new THREE.Quaternion()) {
  _bU.copy(dir).normalize();
  _bF.copy(refFwd && refFwd.lengthSq() > 1e-8 ? refFwd : YAXIS);
  _bF.addScaledVector(_bU, -_bF.dot(_bU));
  if (_bF.lengthSq() < 1e-8) {
    _bF.set(1, 0, 0).addScaledVector(_bU, -_bU.x);
    if (_bF.lengthSq() < 1e-8) _bF.set(0, 0, 1).addScaledVector(_bU, -_bU.z);
  }
  _bF.normalize();
  _bR.crossVectors(_bU, _bF);
  _bM.makeBasis(_bR, _bU, _bF);
  return out.setFromRotationMatrix(_bM);
}

/* 大圆距离：球面上两点之间真正要走的路程 */
const _adA = new THREE.Vector3(), _adB = new THREE.Vector3();
function arcDist(a, b) {
  _adA.copy(a).sub(PLANET.C).normalize();
  _adB.copy(b).sub(PLANET.C).normalize();
  return PLANET.R * Math.acos(clamp(_adA.dot(_adB), -1, 1));
}

/* frame 朝向相对「正北」（指向 +Y 极点的切向）的角度，小地图用 */
const _brN = new THREE.Vector3(), _brC = new THREE.Vector3();
function frameBearing(q) {
  fUp(q, _up); fFwd(q, _fw);
  _brN.copy(YAXIS).addScaledVector(_up, -YAXIS.dot(_up));
  if (_brN.lengthSq() < 1e-8) return 0;
  _brN.normalize();
  return Math.atan2(_brC.crossVectors(_brN, _fw).dot(_up), _brN.dot(_fw));
}

/* 目标点相对 frame 正前方的偏角（0 = 正前），导航箭头用 */
const _rbT = new THREE.Vector3(), _rbC = new THREE.Vector3();
function relBearing(q, from, target) {
  fUp(q, _up); fFwd(q, _fw);
  _rbT.copy(target).sub(from);
  _rbT.addScaledVector(_up, -_rbT.dot(_up));
  if (_rbT.lengthSq() < 1e-8) return 0;
  _rbT.normalize();
  return Math.atan2(_rbC.crossVectors(_fw, _rbT).dot(_up), _fw.dot(_rbT));
}

/* ---------- 烘地表半径场 ----------
   逐三角形做重心插值，而不是像平面版那样按包围盒填最大值：
   球壳一个面片能盖住上百个格子，填最大值会把地面变成台阶，车会一路弹跳。 */
function rasterRadius(buf, W, H, au, av, ar) {
  /* 跨 ±180° 经线的三角形，把靠左那侧整体 +W，写入时再取模绕回来 */
  let u0 = au[0], u1 = au[1], u2 = au[2];
  if (Math.max(u0, u1, u2) - Math.min(u0, u1, u2) > W * 0.5) {
    if (u0 < W * 0.5) u0 += W;
    if (u1 < W * 0.5) u1 += W;
    if (u2 < W * 0.5) u2 += W;
  }
  const v0 = av[0], v1 = av[1], v2 = av[2];

  /* 面片比格子还小时，重心测试可能一个格心都覆盖不到，先把三个顶点所在格点上 */
  for (let k = 0; k < 3; k++) {
    const cv = clamp(Math.floor(av[k]), 0, H - 1);
    let cu = Math.floor(au[k]) % W; if (cu < 0) cu += W;
    const j = cv * W + cu;
    if (buf[j] < ar[k]) buf[j] = ar[k];
  }

  const den = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
  if (Math.abs(den) < 1e-9) return;
  const cv0 = Math.max(0, Math.floor(Math.min(v0, v1, v2)));
  const cv1 = Math.min(H - 1, Math.floor(Math.max(v0, v1, v2)));
  let cu0 = Math.floor(Math.min(u0, u1, u2)), cu1 = Math.floor(Math.max(u0, u1, u2));
  if (cu1 - cu0 >= W) { cu0 = 0; cu1 = W - 1; }
  for (let cv = cv0; cv <= cv1; cv++) {
    const py = cv + 0.5, row = cv * W;
    for (let cu = cu0; cu <= cu1; cu++) {
      const px = cu + 0.5;
      const w0 = ((v1 - v2) * (px - u2) + (u2 - u1) * (py - v2)) / den;
      const w1 = ((v2 - v0) * (px - u2) + (u0 - u2) * (py - v2)) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.03 || w1 < -0.03 || w2 < -0.03) continue;
      let x = cu % W; if (x < 0) x += W;
      const r = w0 * ar[0] + w1 * ar[1] + w2 * ar[2];
      if (buf[row + x] < r) buf[row + x] = r;
    }
  }
}

/* 只标记「是不是这个面」，不插值数值。给路面掩码用，bit 是标记位 */
function rasterMask(buf, W, H, au, av, bit) {
  let u0 = au[0], u1 = au[1], u2 = au[2];
  if (Math.max(u0, u1, u2) - Math.min(u0, u1, u2) > W * 0.5) {
    if (u0 < W * 0.5) u0 += W;
    if (u1 < W * 0.5) u1 += W;
    if (u2 < W * 0.5) u2 += W;
  }
  const v0 = av[0], v1 = av[1], v2 = av[2];
  for (let k = 0; k < 3; k++) {
    const cv = clamp(Math.floor(av[k]), 0, H - 1);
    let cu = Math.floor(au[k]) % W; if (cu < 0) cu += W;
    buf[cv * W + cu] |= bit;
  }
  const den = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
  if (Math.abs(den) < 1e-9) return;
  const cv0 = Math.max(0, Math.floor(Math.min(v0, v1, v2)));
  const cv1 = Math.min(H - 1, Math.floor(Math.max(v0, v1, v2)));
  let cu0 = Math.floor(Math.min(u0, u1, u2)), cu1 = Math.floor(Math.max(u0, u1, u2));
  if (cu1 - cu0 >= W) { cu0 = 0; cu1 = W - 1; }
  for (let cv = cv0; cv <= cv1; cv++) {
    const py = cv + 0.5, row = cv * W;
    for (let cu = cu0; cu <= cu1; cu++) {
      const px = cu + 0.5;
      const w0 = ((v1 - v2) * (px - u2) + (u2 - u1) * (py - v2)) / den;
      const w1 = ((v2 - v0) * (px - u2) + (u0 - u2) * (py - v2)) / den;
      if (w0 < -0.03 || w1 < -0.03 || 1 - w0 - w1 < -0.03) continue;
      let x = cu % W; if (x < 0) x += W;
      buf[row + x] |= bit;
    }
  }
}

/* 极点附近可能一个面片都没落上，先横向补，再从中纬往两极纵向补 */
function fillHoles(buf, W, H) {
  for (let cv = 0; cv < H; cv++) {
    const row = cv * W;
    let first = -1;
    for (let cu = 0; cu < W; cu++) if (buf[row + cu] > 0) { first = cu; break; }
    if (first < 0) continue;
    let last = buf[row + first];
    for (let k = 0; k < W; k++) {
      const cu = (first + k) % W;
      if (buf[row + cu] > 0) last = buf[row + cu];
      else buf[row + cu] = last;
    }
  }
  const mid = H >> 1;
  for (let cv = mid; cv >= 0; cv--) if (buf[cv * W] === 0 && cv + 1 < H) buf.copyWithin(cv * W, (cv + 1) * W, (cv + 2) * W);
  for (let cv = mid; cv < H; cv++) if (buf[cv * W] === 0 && cv > 0) buf.copyWithin(cv * W, (cv - 1) * W, cv * W);
}

/* 球心用球壳自身顶点的质心拟合。用整个模型的 bbox 中心会被分布不均的
   高楼带偏二十几个单位，量出来的地表就会凭空多出上百单位的假起伏。 */
function fitPlanet(root) {
  root.updateMatrixWorld(true);
  let shell = null;
  root.traverse(o => { if (o.isMesh && /^Planet/i.test(o.name)) shell = o; });
  PLANET.C.set(0, 0, 0);
  if (shell) {
    const p = shell.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) PLANET.C.add(v.fromBufferAttribute(p, i).applyMatrix4(shell.matrixWorld));
    PLANET.C.divideScalar(p.count);
  } else {
    new THREE.Box3().setFromObject(root).getCenter(PLANET.C);
  }
}

/* 路面材质：整张路网是一个 mesh，靠材质分组区分车道、路缘、人行道和草坪。
   车流和电动车只跑车道，邮箱和停靠车辆可以上人行道，草坪山地一概不算路。 */
const DRIVEMAT = /road/i;                  // City_Road / City_RoadLine
const PAVEMAT = /(sidewalk|curb)/i;        // City_Sidewalk / City_Curb

function bakeGround(root) {
  const W = GRID.gw, H = GRID.gh;
  const OW = GRID.ow, OH = GRID.oh;
  const buf = GRID.ground = new Float32Array(W * H);
  const surf = GRID.surf = new Uint8Array(OW * OH);
  const v = new THREE.Vector3();
  const au = [0, 0, 0], av = [0, 0, 0], ar = [0, 0, 0];
  const ou = [0, 0, 0], ov = [0, 0, 0];
  let tris = 0, driveTris = 0;
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || o.userData.__outline || !TERRAIN.test(o.name)) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, m = o.matrixWorld;
    const n = idx ? idx.count : pos.count;
    /* 每个三角形属于哪一段材质：groups 是按索引区间划分的 */
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = o.geometry.groups && o.geometry.groups.length ? o.geometry.groups : null;
    const bitOf = mm => {
      const nm = (mm && mm.name) || '';
      return DRIVEMAT.test(nm) ? M_DRIVE : PAVEMAT.test(nm) ? M_PAVE : 0;
    };
    let gi = 0, bit = groups ? 0 : bitOf(mats[0]);
    for (let i = 0; i + 2 < n; i += 3) {
      if (groups) {
        while (gi < groups.length && i >= groups[gi].start + groups[gi].count) gi++;
        const g = groups[gi];
        bit = bitOf(g ? mats[g.materialIndex] || mats[0] : mats[0]);
      }
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m).sub(PLANET.C);
        const r = v.length() || 1;
        ar[k] = r;
        const th = Math.acos(clamp(v.y / r, -1, 1)) / Math.PI;
        const ph = Math.atan2(v.x, v.z) / (Math.PI * 2) + 0.5;
        av[k] = th * H; au[k] = ph * W;
        ov[k] = th * OH; ou[k] = ph * OW;
      }
      rasterRadius(buf, W, H, au, av, ar);
      if (bit) {
        rasterMask(surf, OW, OH, ou, ov, bit);
        if (bit === M_DRIVE) driveTris++;
      }
      tris++;
    }
  });
  fillHoles(buf, W, H);
  /* 基准半径取中位数：山地只占少数，中位数就是「平地」的半径 */
  const s = [];
  for (let i = 0; i < buf.length; i += 31) s.push(buf[i]);
  s.sort((a, b) => a - b);
  PLANET.R = s[s.length >> 1] || 600;
  state.terrainTris = tris;
  state.driveTris = driveTris;
  /* 材质名对不上时掩码会是空的，那就退回「哪都算路」，别把游戏卡死 */
  if (!driveTris) GRID.surf = null;
}

/* ---------- 实体脚下轮廓碰撞 ---------- */
let collisionWorld = null;
function bakeOcc(root) {
  collisionWorld = createCollisionWorld(root, PLANET.C);
  GRID.occ = collisionWorld.map(GRID.ow, GRID.oh);
  state.occObjects = collisionWorld.stats.objects;
  if (DEBUG) console.info('Collision footprints:', collisionWorld.stats);
}

/* Mailboxes and parked props use round footprints, never latitude rectangles. */
const _placedUp = new THREE.Vector3();
function stampOcc(q, r) {
  if (!collisionWorld) return;
  fUp(q, _placedUp);
  collisionWorld.addDisc(_placedUp, r, 'PlacedProp', PLANET.R);
}
/* ---------- 地平线剔除 ----------
   three.js 只做视锥剔除、不做遮挡剔除：星球另一面的几千栋楼照样会进 draw call，
   只是被地表挡住看不见（实测 1100+ 次绘制）。这里按几何关系手工算一次：
   眼高 e 时地平线在 acos(R/(R+e)) 角距处，高 H 的物体自己还能再露出 acos(R/(R+H))，
   两者相加就是它有可能被看到的最大角距。每帧只要一个点积，比多画一千次便宜得多。 */
const EYE = 15;
/* 可见弧长：楼要「早点出现」就得把它放大，代价是提交数按弧长平方涨。
   手机档留一档余量。它必须 >= 雾的远端，否则楼会在雾外面被硬切掉。 */
const VIEW_ARC = IS_MOBILE ? 450 : 580;
/* 描边壳只在近处画：壳厚 0.045 单位，100 单位外还不到半个像素，
   却要多一次提交。远处的楼只画本体，省下的正好抵掉看得更远多出来的开销。 */
const ARC_LINE = 150;
const horizon = [];
const _hzC = new THREE.Vector3(), _hzB = new THREE.Box3(), _hzP = new THREE.Vector3();
function prepareHorizon(root) {
  horizon.length = 0;
  root.updateMatrixWorld(true);
  const eyeAng = Math.acos(clamp(PLANET.R / (PLANET.R + EYE), -1, 1));
  const maxAng = VIEW_ARC / PLANET.R;
  root.traverse(o => {
    if (!o.isMesh || o.userData.__outline || TERRAIN.test(o.name)) return;
    _hzB.setFromObject(o);
    if (_hzB.isEmpty()) return;
    _hzB.getCenter(_hzC).sub(PLANET.C);
    if (_hzC.lengthSq() < 1e-6) return;
    let top = 0;
    for (let i = 0; i < 8; i++) {
      _hzP.set(i & 1 ? _hzB.max.x : _hzB.min.x, i & 2 ? _hzB.max.y : _hzB.min.y, i & 4 ? _hzB.max.z : _hzB.min.z);
      top = Math.max(top, _hzP.sub(PLANET.C).length());
    }
    const H = Math.max(0.5, top - PLANET.R);
    const ang = eyeAng + Math.acos(clamp(PLANET.R / (PLANET.R + H), -1, 1)) + 0.03;
    horizon.push({
      o, d: _hzC.clone().normalize(),
      castsShadow: o.castShadow && !/^Grass/i.test(o.name),
      topAngle: Math.acos(clamp(PLANET.R / (PLANET.R + H), -1, 1)),
      lim: Math.cos(Math.min(ang, maxAng)),
      shell: o.children.find(c => c.userData.__outline) || null,
      limS: Math.cos(Math.min(ang, ARC_LINE / PLANET.R))
    });
  });
}

const _hzU = new THREE.Vector3(), _hzFocus = new THREE.Vector3();
function horizonCull(q) {
  fUp(q, _hzFocus);
  const shadowLimit = Math.cos((CFG.shadowSpan * 1.45) / PLANET.R);
  _hzU.copy(camera.position).sub(PLANET.C);
  const eyeHeight = Math.max(EYE, _hzU.length() - PLANET.R);
  _hzU.normalize();
  const eyeAngle = Math.acos(PLANET.R / (PLANET.R + eyeHeight));
  const maxAngle = (scenicView || introPreview ? 1350 : VIEW_ARC) / PLANET.R;
  let on = 0;
  for (const e of horizon) {
    const dot = e.d.dot(_hzU);
    const v = dot >= Math.cos(Math.min(eyeAngle + e.topAngle + 0.05, maxAngle));
    e.o.visible = v;
    if (v && e.o.userData.treeLod) {
      const lod = e.o.userData.treeLod;
      _hzP.setFromMatrixPosition(e.o.matrixWorld);
      const distance = _hzP.distanceToSquared(camera.position), limit = IS_MOBILE ? 105 : 175;
      const threshold = e.o.geometry === lod.far ? limit - 12 : limit + 12;
      e.o.geometry = distance > threshold * threshold ? lod.far : lod.near;
    }
    e.o.castShadow = e.castsShadow && e.d.dot(_hzFocus) > shadowLimit;
    if (e.shell) e.shell.visible = v && dot >= e.limS;
    if (v) on++;
  }
  state.hzOn = on;
}

/* ---------- 碰撞查询 ---------- */
const _blU = new THREE.Vector3(), _blF = new THREE.Vector3(), _blR = new THREE.Vector3(), _blT = new THREE.Vector3();
function blockedAt(q, r = CFG.bikeRadius, allowWater = false) {
  fUp(q, _blU);
  if (collisionWorld?.blocked(_blU, r)) return true;
  if (allowWater) return false;
  if (isLakeWater(_lakeWorld.copy(_blU).multiplyScalar(600).add(PLANET.C))) return true;
  fFwd(q, _blF); fRight(q, _blR);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    _blT.copy(_blU).multiplyScalar(600)
      .addScaledVector(_blR, Math.cos(a) * r)
      .addScaledVector(_blF, Math.sin(a) * r).normalize();
    if (isLakeWater(_lakeWorld.copy(_blT).multiplyScalar(600).add(PLANET.C))) return true;
  }
  return false;
}
/* 从 frame 出发，正前方 dist 米内是否通畅 */
const _dcQ = new THREE.Quaternion();
function dirClear(q, dist, r = 1.05 * S) {
  _dcQ.copy(q);
  advance(_dcQ, 2 * S);
  for (let d = 2 * S; d <= dist; d += 1.6 * S) {
    if (blockedAt(_dcQ, r)) return false;
    advance(_dcQ, 1.6 * S);
  }
  return true;
}

/* 这个位置周围的空旷半径（米），用来找马路中间 */
const _orQ = new THREE.Quaternion(), _orU = new THREE.Vector3();
function openRadius(q, max = 7 * S) {
  for (let r = S; r <= max; r += S) {
    for (let a = 0; a < 8; a++) {
      _orQ.copy(q);
      turn(_orQ, a * Math.PI / 4);
      advance(_orQ, r);
      if (blockedDir(fUp(_orQ, _orU))) return r - S;
    }
  }
  return max;
}

/* 车道判定要看一小片、不能只看脚底一点：路面和草地共用边界顶点，
   光栅化时会把车道标记漏进邻格，只查中心点会把人放到路缘外的绿化带上。 */
const _daU = new THREE.Vector3(), _daF = new THREE.Vector3();
const _daR = new THREE.Vector3(), _daT = new THREE.Vector3();
function driveAt(q, r = 1.5 * S) {
  fUp(q, _daU);
  if (!driveDir(_daU)) return false;
  if (!GRID.surf || !r) return true;
  fFwd(q, _daF); fRight(q, _daR);
  for (let i = 0; i < 4; i++) {
    _daT.copy(_daU).multiplyScalar(PLANET.R)
      .addScaledVector(_daR, i === 0 ? r : i === 1 ? -r : 0)
      .addScaledVector(_daF, i === 2 ? r : i === 3 ? -r : 0)
      .normalize();
    if (!driveDir(_daT)) return false;
  }
  return true;
}

/* 地表比基准半径高出这么多以内算平地（路面 / 人行道 / 路缘）；再高就是山，不生成任务点 */
const FLAT = 6;
const _isU = new THREE.Vector3();
function onFlatRoad(q) {
  fUp(q, _isU);
  return groundR(_isU) <= PLANET.R + FLAT && paveDir(_isU) && !blockedDir(_isU);
}

/* 随机找一个「路面上」的 frame：平地 + 不挡路 + 周围有一定空旷度。
   near 给定时只在它周围 maxDist 米内找；pave 为真时人行道也算。 */
const _frU = new THREE.Vector3(), _frD = new THREE.Vector3();
function findRoadFrame(minOpen = 3 * S, near = null, maxDist = 0, pave = false) {
  const q = new THREE.Quaternion();
  for (let i = 0; i < 1500; i++) {
    if (near && maxDist) {
      q.copy(near);
      turn(q, rand(0, Math.PI * 2));
      advance(q, rand(maxDist * 0.35, maxDist));
    } else {
      /* 球面均匀采样：z 均匀分布才不会在两极堆点 */
      const z = rand(-1, 1), a = rand(0, Math.PI * 2), s = Math.sqrt(Math.max(0, 1 - z * z));
      frameFromDir(_frD.set(s * Math.cos(a), z, s * Math.sin(a)), null, q);
    }
    fUp(q, _frU);
    if (groundR(_frU) > PLANET.R + FLAT) continue;
    if (!(pave ? paveDir(_frU) : driveAt(q))) continue;
    if (blockedDir(_frU)) continue;
    if (openRadius(q, minOpen + S) < minOpen) continue;
    turn(q, rand(0, Math.PI * 2));
    return q;
  }
  return frameFromDir(YAXIS, null, q);
}

/* 出生点：找一块空旷、且至少有一个方向能连着开 22 个车身长的地方 */
function pickSpawn() {
  let best = null;
  for (let i = 0; i < 100; i++) {
    const q = findRoadFrame(3 * S);
    const up = fUp(q, new THREE.Vector3());
    // The sampler can fall back to the north pole. Never accept that fallback
    // unless it really is a drivable, correctly baked piece of ground.
    if (!driveAt(q, CFG.bikeRadius) || blockedDir(up)
        || groundR(up) < PLANET.R - 4 || groundR(up) > PLANET.R + FLAT) continue;
    const r = openRadius(q, 7 * S);
    if (r < 3 * S) continue;
    for (let k = 0; k < 4; k++) {
      if (dirClear(q, 22 * S, 1.2 * S)) {
        const score = r * 10 + 22 * S;
        if (!best || score > best.score) best = { q: q.clone(), score };
        break;
      }
      turn(q, Math.PI / 2);
    }
    if (best && best.score > 90 * S) break;
  }
  if (best) return best.q;
  for (let i = 0; i < 30; i++) {
    const q = findRoadFrame(S);
    const up = fUp(q, new THREE.Vector3());
    if (driveAt(q, CFG.bikeRadius) && !blockedDir(up)
        && groundR(up) >= PLANET.R - 4 && groundR(up) <= PLANET.R + FLAT) return q;
  }
  throw new Error('没有找到安全的道路出生点，请重试');
}

/* ---------- 邮箱 / 标记 ---------- */
/* 邮箱是四个零件，做成四个 mesh 就是四份提交、加描边壳翻倍，九个邮箱要 72 次。
   用顶点色合成一个网格，只剩 2 次。 */
let mailboxGeo = null;
function makeMailbox(q) {
  if (!mailboxGeo) {
    mailboxGeo = mergeParts([
      pbox(0.62, 0.86, 0.5, 0, 1.06, 0, 0xdb3b32),
      pcyl(0.31, 0.31, 0.5, 12, 0, 1.49, 0, 0xdb3b32, Math.PI / 2),
      pcyl(0.09, 0.09, 0.66, 8, 0, 0.33, 0, 0x39404a),
      pbox(0.4, 0.07, 0.04, 0, 1.3, 0.26, 0x39404a)
    ]);
    mailboxGeo.scale(S, S, S);          // 城市是巨人尺度，邮箱也得跟着大
  }
  const g = new THREE.Mesh(mailboxGeo, VC_MAT);
  g.castShadow = true;
  g.receiveShadow = true;
  addOutline(g, 0.022 * S);
  /* 站到球面上：本地 +Y 朝天由 frame 的四元数直接给出 */
  framePos(q, 0, g.position);
  g.quaternion.copy(q);
  g.userData.q = q.clone();
  scene.add(g);
  return g;
}

function iconSprite(text) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '92px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
}

function makeMarker(color, icon) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.7, 0.13, 8, 28),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.14;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.35, 11, 14, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.y = 5.6;
  const sp = iconSprite(icon);
  sp.position.y = 3.2;
  sp.scale.setScalar(1.6);
  g.add(ring, beam, sp);
  g.userData.ring = ring;
  g.userData.icon = sp;
  /* 光柱按整组放大：updateMarkers 里的 3.2 / 0.22 也就自动跟着放大了 */
  g.scale.setScalar(S);
  scene.add(g);
  return g;
}

/* 光柱得沿着当地的「上」立起来，不然在星球侧面会歪着躺下去 */
function placeMarker(m, q) {
  framePos(q, 0, m.position);
  m.quaternion.copy(q);
  m.visible = true;
}

/* ---------- 玩家（电动车 + 骑手） ----------
   容器的 position / quaternion 每帧由球面 frame 算出；
   rig 的 rotation.y = -π/2 这类本地修正照旧有效，因为 frame 的本地轴语义没变。 */
const player = new THREE.Group();
scene.add(player);
const rig = new THREE.Group();       // 模型朝 +X，转成朝 +Z
rig.rotation.y = -Math.PI / 2;
player.add(rig);
const bikeHolder = new THREE.Group();
const riderHolder = new THREE.Group();
rig.add(bikeHolder, riderHolder);

/* 下车后在世界里独立行走的角色容器 */
const walker = new THREE.Group();
walker.visible = false;
scene.add(walker);
const walkerRig = new THREE.Group();
walkerRig.rotation.y = -Math.PI / 2;
walker.add(walkerRig);

const foot = { speed: 0, vy: 0, air: false, swimming: false, h: 0, q: new THREE.Quaternion(), camOff: 0 };

/* ---------- 骨骼动画 ---------- */
const boy = { pivot: null, mixer: null, actions: {}, cur: '', seat: new THREE.Vector3() };

function playAnim(name, { fade = 0.18, once = false, speed = 1 } = {}) {
  const a = boy.actions[name];
  if (!a) return null;
  a.timeScale = speed;
  if (boy.cur === name) return a;
  const prev = boy.actions[boy.cur];
  a.reset();
  if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  else a.setLoop(THREE.LoopRepeat, Infinity);
  a.fadeIn(fade).play();
  if (prev && prev !== a) prev.fadeOut(fade);
  boy.cur = name;
  return a;
}

function setRideBtn() {
  const b = $('btnRide');
  if (b) b.textContent = state.onBike ? '下车' : '上车';
}

const _dmQ = new THREE.Quaternion();
function dismount() {
  if (!state.onBike || !boy.pivot) return;
  if (Math.abs(state.speed) > 3.2) { toast('停稳后才能下车'); return; }
  state.speed = 0;
  state.onBike = false;
  walkerRig.add(boy.pivot);
  boy.pivot.position.set(0, 0, 0);

  /* 从车侧下来：先转 90° 走一个车宽，再把朝向转回和车一致 */
  const side = q => { turn(q, Math.PI / 2); advance(q, 1.15 * S); turn(q, -Math.PI / 2); };
  _dmQ.copy(state.q);
  side(_dmQ);
  if (blockedAt(_dmQ, CFG.footRadius)) {
    _dmQ.copy(state.q);
    turn(_dmQ, -Math.PI / 2); advance(_dmQ, 1.15 * S); turn(_dmQ, Math.PI / 2);
  }
  if (blockedAt(_dmQ, CFG.footRadius)) _dmQ.copy(state.q);
  foot.q.copy(_dmQ);
  foot.h = 0;
  foot.gr = undefined;                 // 换了位置，别从车的地表半径插值过来
  foot.camOff = 0;
  foot.speed = 0; foot.vy = 0; foot.air = false; foot.swimming = false;
  syncBody(walker, foot.q, 0, foot, 1);
  walker.visible = true;
  // Preserve the previous action so playAnim can fade the riding pose out.
  playAnim('idle', { fade: 0.12 });
  setRideBtn();
  toast('下车 · 摇杆走，油门跑，刹车跳');
}

function mount() {
  if (state.onBike || !boy.pivot) return;
  if (foot.swimming) { toast('先游回岸边再上车'); return; }
  if (walker.position.distanceTo(player.position) > CFG.mountRange) { toast('走到电动车旁再上车'); return; }
  state.onBike = true;
  walker.visible = false;
  riderHolder.add(boy.pivot);
  boy.pivot.position.copy(boy.seat);
  // Fade out the on-foot action when returning to the saddle.
  playAnim('sit', { fade: 0.15 });
  setRideBtn();
  toast('上车 · 油门加速，刹车减速');
}

function toggleRide() { state.onBike ? dismount() : mount(); }

function focusFrame() { return state.onBike ? state.q : foot.q; }
function focusPos() { return state.onBike ? player.position : walker.position; }
function focusSpeed() { return state.onBike ? state.speed : foot.speed; }

/* ---------- HUD ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}
function syncHud() {
  $('coin').textContent = state.coin >= 10000 ? (state.coin / 10000).toFixed(1) + '万' : state.coin;
  $('parcel').textContent = state.parcel;
  $('lvNum').textContent = state.lv;
  $('lvFill').style.width = (state.xp / state.xpMax * 100) + '%';
  $('lvTxt').textContent = state.xp + '/' + state.xpMax;
}
function addXp(n) {
  state.xp += n;
  while (state.xp >= state.xpMax) {
    state.xp -= state.xpMax;
    state.lv++;
    state.xpMax = Math.round(state.xpMax * 1.35);
    toast('升级！Lv.' + state.lv);
  }
  syncHud();
}

const pickupMarker = makeMarker(0xff5a4a, '📮');
const dropMarker = makeMarker(0x38c76a, '🏠');
dropMarker.visible = false;

function nextTask() {
  if (state.phase === 'pickup') {
    /* 取最近的那个（但别是刚刚站着的那个）：邮箱铺开三百米，随机挑会挑到最远的 */
    const here = focusPos();
    let mb = null, bd = Infinity;
    for (const c of state.mailboxes) {
      const d = c.position.distanceTo(here);
      if (d > 25 * S && d < bd) { bd = d; mb = c; }
    }
    if (!mb) mb = state.mailboxes[Math.floor(Math.random() * state.mailboxes.length)];
    state.target = mb.position.clone();
    state.targetQ = mb.userData.q;
    placeMarker(pickupMarker, state.targetQ);
    dropMarker.visible = false;
    $('taskTitle').textContent = '新的信件';
    $('taskDesc').textContent = '去红色邮箱领取下一封信';
    $('taskIcon').textContent = '📮';
  } else {
    const q = findRoadFrame(2.5 * S, focusFrame(), 60 * S, true);
    state.targetQ = q;
    state.target = framePos(q, 0, new THREE.Vector3());
    placeMarker(dropMarker, q);
    pickupMarker.visible = false;
    $('taskTitle').textContent = '送信中';
    $('taskDesc').textContent = '把信送到绿色光柱的住户';
    $('taskIcon').textContent = '✉️';
  }
}

function reachTarget() {
  if (state.phase === 'pickup') {
    state.parcel++;
    state.phase = 'deliver';
    toast('收到一封信 ✉️');
    flyLetter();
  } else {
    state.parcel = Math.max(0, state.parcel - 1);
    const gain = 120 + Math.floor(Math.random() * 80);
    state.coin += gain;
    addXp(35);
    state.phase = 'pickup';
    toast('送达！+' + gain + ' 金币');
    coinPop(gain);
  }
  syncHud();
  nextTask();
}

/* ---------- 输入 ---------- */
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });

$('hint').textContent = IS_MOBILE
  ? '左侧空白处按住拖动 · 油门/刹车 · 下车步行'
  : 'W/S 油门刹车 · A/D 转向 · F 上下车 · 步行时 Shift 跑 / 空格跳';
if (IS_MOBILE) document.querySelector('.intro-help').textContent = '左侧空白处按住拖动 · 右侧油门与刹车 · 下车步行';
addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
addEventListener('gesturestart', e => e.preventDefault());
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('dblclick', e => e.preventDefault());
addEventListener('orientationchange', () => setTimeout(resize, 250));
document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });

const stick = $('stick'), knob = $('knob');
const joystick = installFloatingStick({stage:$('stage'),canvas,stick,knob,
  enabled:() => !introPreview && !$('mask').classList.contains('on') && !document.body.classList.contains('quiet')});
const stickVec = joystick.vector;

let gasOn = false, brakeOn = false, jumpQueued = false;
function hold(el, set) {
  let pointer = null;
  const off = () => { const old = pointer; pointer = null; set(false); if (old !== null && el.hasPointerCapture(old)) el.releasePointerCapture(old); };
  el.addEventListener('pointerdown', e => {
    if (pointer !== null || e.button !== 0) return;
    pointer = e.pointerId; el.setPointerCapture(pointer); set(true); e.preventDefault();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) el.addEventListener(type,e => { if (e.pointerId === pointer) off(); });
  addEventListener('blur',off);
  document.addEventListener('visibilitychange',() => { if (document.hidden) off(); });
}
hold($('gas'), v => gasOn = v);
hold($('brake'), v => {
  if (v && !brakeOn && !state.onBike) jumpQueued = true;   // 下车时刹车键 = 跳
  brakeOn = v;
});
if ($('btnRide')) $('btnRide').addEventListener('click', toggleRide);
addEventListener('keydown', e => {
  if (e.code === 'KeyF') toggleRide();
  if (e.code === 'Space' && !state.onBike) jumpQueued = true;
});

const PANELS = {
  bag: ['🎒 背包', [['✉️', '平信'], ['📦', '包裹'], ['🥤', '汽水'], ['🔧', '扳手'], ['🗺️', '地图'], ['🎫', '优惠券']]],
  task: ['📒 任务笔记', [['📮', '取信'], ['🏠', '送信'], ['⭐', '好评'], ['⏱️', '限时'], ['🏅', '成就'], ['🧧', '红包']]],
  shop: ['🛒 商店', [['🛵', '车辆改装'], ['⚡', '电量+'], ['🎽', '皮肤'], ['🧰', '扩容'], ['🔔', '喇叭'], ['💡', '车灯']]]
};
document.querySelectorAll('.bbtn').forEach(b => b.addEventListener('click', () => {
  joystick.reset();
  const [title, cells] = PANELS[b.dataset.panel];
  $('pTitle').textContent = title;
  $('pList').innerHTML = cells.map(([e, t]) => `<div class="cell"><em>${e}</em>${t}</div>`).join('');
  $('mask').classList.add('on');
}));
document.querySelectorAll('.bbtn').forEach(b => b.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); }
}));
$('pClose').onclick = () => $('mask').classList.remove('on');
$('btnGear').onclick = () => toast('Demo 版本 · 送信赚金币升级');
function toggleView() {
  scenicView = !scenicView;
  $('btnView').setAttribute('aria-pressed', String(scenicView));
  $('btnView').textContent = scenicView ? '↙ 返回骑行' : '◎ 星球远眺';
}
function toggleLight() {
  evening = !evening;
  atmosphere.setTheme(evening ? 'evening' : 'day');
  $('btnLight').setAttribute('aria-pressed', String(evening));
  $('btnLight').textContent = evening ? '☾ 黄昏' : '☀ 晴日';
  document.documentElement.dataset.light = evening ? 'evening' : 'day';
}
$('btnView').onclick = toggleView;
$('btnLight').onclick = toggleLight;
$('btnGear').onclick = () => toast(IS_MOBILE ? '左侧空白处拖动移动 · 右侧油门/刹车 · 下车步行' : 'V 切换远眺 · H 收起界面 · 晴日 / 黄昏可切换');
$('btnQuiet').onclick = () => {
  joystick.reset();
  const quiet = document.body.classList.toggle('quiet');
  $('btnQuiet').textContent = quiet ? '显示界面' : '收起界面';
  $('btnQuiet').setAttribute('aria-pressed', String(quiet));
};
addEventListener('keydown', e => {
  if (e.repeat || introPreview) return;
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyH') $('btnQuiet').click();
});
if (scenicView) {
  $('btnView').setAttribute('aria-pressed', 'true');
  $('btnView').textContent = '↙ 返回骑行';
}
document.querySelector('.taskbar').addEventListener('click', () =>
  document.querySelector('.bbtn[data-panel="task"]').click());
document.querySelectorAll('.res .plus').forEach(p => p.addEventListener('click', e => {
  e.stopPropagation();
  document.querySelector('.bbtn[data-panel="shop"]').click();
}));

/* ---------- 小地图 ----------
   底图就是等距圆柱（经纬）展开的地表格网，玩家所在处截一小块出来。
   高纬度处一格经度对应的实际距离会缩短，所以横向要按 sin(θ) 少截一些，
   否则小地图会被横向拉扁。 */
const mini = $('mini'), mg = mini.getContext('2d');
function buildMiniImage() {
  const W = GRID.gw, H = GRID.gh;
  if (!GRID.ground) return;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  for (let v = 0; v < H; v++) {
    const theta = (v + 0.5) / H * Math.PI;
    for (let u = 0; u < W; u++) {
      const i = v * W + u;
      const rel = GRID.ground[i] - PLANET.R;
      const oi = Math.min(GRID.oh - 1, (v * GRID.oh / H) | 0) * GRID.ow +
        Math.min(GRID.ow - 1, (u * GRID.ow / W) | 0);
      let r, gg, b;
      const phi = ((u + 0.5) / W - 0.5) * Math.PI * 2;
      _lakeWorld.set(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)).multiplyScalar(600).add(PLANET.C);
      if (isLakeWater(_lakeWorld)) { r = 89; gg = 148; b = 145; }
      else if (GRID.occ && GRID.occ[oi]) { r = 186; gg = 178; b = 166; }   // 楼 / 树 / 石
      else if (GRID.surf && (GRID.surf[oi] & M_DRIVE)) { r = 71; gg = 76; b = 84; }   // 车道，跟 CITY_TINT 一致
      else if (GRID.surf && GRID.surf[oi]) { r = 120; gg = 116; b = 106; }           // 人行道
      else if (rel > FLAT * 2) { r = 150; gg = 132; b = 104; }        // 山
      else { r = 96; gg = 118; b = 84; }                              // 草地 / 空地
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  GRID.img = cv;
}

const _mmU = new THREE.Vector3(), _mmN = new THREE.Vector3(), _mmE = new THREE.Vector3();
const _mmF = new THREE.Vector3(), _mmD = new THREE.Vector3();
function drawMini() {
  /* PX 是画布像素边长，RV 是小地图半径对应的世界米数（跟着巨人尺度放大） */
  const PX = mini.width, RV = 62 * S;
  mg.fillStyle = '#1a222a';
  mg.fillRect(0, 0, PX, PX);
  const fq = focusFrame(), fp = focusPos();
  fUp(fq, _mmU);
  /* 当地的「北」= 世界 +Y 投到切平面；东 = 北 × 上（与经度 u 增大方向一致） */
  _mmN.copy(YAXIS).addScaledVector(_mmU, -YAXIS.dot(_mmU));
  if (_mmN.lengthSq() < 1e-6) fFwd(fq, _mmN);
  _mmN.normalize();
  _mmE.crossVectors(_mmN, _mmU).normalize();
  const k = PX / (RV * 2);

  if (GRID.img) {
    const W = GRID.gw, H = GRID.gh;
    const theta = Math.acos(clamp(_mmU.y, -1, 1));
    const cu = (Math.atan2(_mmU.x, _mmU.z) / (Math.PI * 2) + 0.5) * W;
    const cv = theta / Math.PI * H;
    const halfV = RV / (PLANET.R * Math.PI / H);
    const halfU = RV / (PLANET.R * Math.PI * 2 * Math.max(0.08, Math.sin(theta)) / W);
    const dw = halfU * 2, dh = halfV * 2;
    mg.imageSmoothingEnabled = false;
    mg.save();
    mg.beginPath(); mg.rect(0, 0, PX, PX); mg.clip();
    /* 跨 ±180° 经线时窗口一半在图的另一端，左右各补画一次 */
    for (const sh of [-W, 0, W]) {
      mg.drawImage(GRID.img, cu - halfU + sh, cv - halfV, dw, dh, -sh * (PX / dw), 0, PX, PX);
    }
    mg.restore();
  }

  const dot = (pos, color, r) => {
    _mmD.copy(pos).sub(fp);
    const x = PX / 2 + _mmD.dot(_mmE) * k, y = PX / 2 - _mmD.dot(_mmN) * k;
    if (Math.abs(x - PX / 2) > PX / 2 - r || Math.abs(y - PX / 2) > PX / 2 - r) return;
    mg.fillStyle = color;
    mg.beginPath(); mg.arc(x, y, r, 0, 7); mg.fill();
  };

  if (state.target) {
    /* 目标可能在视野外，把它压到边缘上 */
    _mmD.copy(state.target).sub(fp);
    let dx = _mmD.dot(_mmE), dy = _mmD.dot(_mmN);
    const d = Math.hypot(dx, dy);
    if (d > RV) { dx *= RV / d; dy *= RV / d; }
    mg.fillStyle = state.phase === 'pickup' ? '#ff5a4a' : '#38c76a';
    mg.beginPath(); mg.arc(PX / 2 + dx * k, PX / 2 - dy * k, 7, 0, 7); mg.fill();
  }
  if (!state.onBike) dot(player.position, '#ff9d2e', 4);
  for (const car of traffic) if (car.alive) dot(car.mesh.position, '#10161c', 2.5);

  /* 箭头：北朝上，所以按「朝向在东/北上的分量」转 */
  fFwd(fq, _mmF);
  mg.save();
  mg.translate(PX / 2, PX / 2);
  mg.rotate(Math.atan2(_mmF.dot(_mmE), _mmF.dot(_mmN)));
  mg.fillStyle = '#ffd24a';
  mg.beginPath();
  mg.moveTo(0, -10); mg.lineTo(7, 9); mg.lineTo(0, 4); mg.lineTo(-7, 9);
  mg.closePath();
  mg.fill();
  mg.restore();
}

/* ---------- 物理 ---------- */
/* 地表半径在路缘、草坡处会跳一下，直接贴上去人会瞬移，拿上一帧的值做平滑。
   跳变超过 8 米当成重生 / 传送，直接贴过去不平滑。 */
const _sbU = new THREE.Vector3();
function syncBody(obj, q, h, ent, k) {
  fUp(q, _sbU);
  let gr = groundR(_sbU);
  if (ent === foot && ent.swimming) gr = waterSurfaceR(_sbU) - 0.65 * S;
  if (ent) {
    if (ent.gr === undefined || Math.abs(gr - ent.gr) > 8) ent.gr = gr;
    else ent.gr += (gr - ent.gr) * k;
    gr = ent.gr;
  }
  obj.position.copy(PLANET.C).addScaledVector(_sbU, gr + h);
  obj.quaternion.copy(q);
}

/* 撞墙时沿墙滑行：朝斜前方试着挪一点，但朝向不变。返回是否畅通 */
function slide(q, out, step, r, allowWater = false) {
  return sweepSphere(q, out, step, r, PLANET.R, allowWater ? (q, r) => blockedAt(q, r, true) : blockedAt);
}
/* ?auto 时自动朝任务点打方向，用来无人值守跑一遍「取信 -> 送达」全流程 */
const _asU = new THREE.Vector3(), _asF = new THREE.Vector3();
const _asD = new THREE.Vector3(), _asC = new THREE.Vector3();
function autoSteer(q) {
  if (!state.target) return 0;
  fUp(q, _asU);
  _asD.copy(state.target).sub(PLANET.C).normalize();
  _asD.addScaledVector(_asU, -_asD.dot(_asU));
  if (_asD.lengthSq() < 1e-8) return 0;
  _asD.normalize();
  fFwd(q, _asF);
  return clamp(Math.atan2(_asC.crossVectors(_asF, _asD).dot(_asU), _asF.dot(_asD)) * 1.6, -1, 1);
}

const _plQ = new THREE.Quaternion();
function updatePlayer(dt) {
  let th = 0, st = 0;
  /* 自动驾驶（?auto / 自测）：朝任务点打方向。两个必须处理的细节——
     一是快到了要收油（到达判定要求车速低于 6m/s，全油门会以 50km/h 冲过标记）；
     二是顶上墙角后 slide 只能左右偏一点、出不来，得倒车脱困。 */
  if (AUTO || state.autoDrive) {
    if (state.esc > 0) {
      state.esc -= dt;
      th -= 1;
      st += state.escS;
    } else {
      if (state.speed < 0.2 * S) {
        state.slowT = (state.slowT || 0) + dt;
        if (state.slowT > 0.5) { state.esc = 1.1; state.escS = Math.random() < 0.5 ? -1 : 1; state.slowT = 0; }
      } else state.slowT = 0;
      st += autoSteer(state.q);
      const near = state.target && arcDist(player.position, state.target) < 4 * S;
      th += near ? (state.speed > 1.3 * S ? -1 : 0.15) : 1;
    }
  }
  if (keys.KeyW || keys.ArrowUp || gasOn) th += 1;
  if (keys.KeyS || keys.ArrowDown || brakeOn) th -= 1;
  if (keys.KeyA || keys.ArrowLeft) st += 1;
  if (keys.KeyD || keys.ArrowRight) st -= 1;
  st -= stickVec.x;
  if (stickVec.y < -0.25) th += -stickVec.y;
  if (stickVec.y > 0.25) th -= stickVec.y;
  th = clamp(th, -1, 1);
  st = clamp(st, -1, 1);

  if (th > 0) state.speed += CFG.accel * th * dt;
  else if (th < 0) {
    if (state.speed > 0.1 * S) state.speed -= CFG.brake * (-th) * dt;
    else state.speed -= CFG.accel * 0.5 * (-th) * dt;
  }
  state.speed -= state.speed * CFG.drag * dt;
  if (keys.Space) state.speed -= Math.sign(state.speed) * CFG.brake * 1.2 * dt;
  state.speed = clamp(state.speed, -5 * S, CFG.maxSpeed);
  if (Math.abs(state.speed) < 0.05 * S) state.speed = 0;

  /* 车速太低时轮胎「抓不住地」，转向也就打不动 */
  const grip = clamp(Math.abs(state.speed) / (3.5 * S), 0, 1);
  turn(state.q, st * CFG.steer * dt * grip * Math.sign(state.speed || 1));

  const step = state.speed * dt;
  if (!slide(state.q, _plQ, step, CFG.bikeRadius)) {
    state.speed *= 0.35;
    state.hits = (state.hits || 0) + 1;
  }
  state.q.copy(_plQ);
  syncBody(player, state.q, 0, state, Math.min(1, dt * 8));

  const lean = -st * clamp(Math.abs(state.speed) / CFG.maxSpeed, 0, 1) * 0.3;
  rig.rotation.z += (lean - rig.rotation.z) * Math.min(1, dt * 8);
}

/* ---------- 步行 / 跑 / 跳 ---------- */
const camF = new THREE.Vector3(), camR = new THREE.Vector3(), moveDir = new THREE.Vector3();
const _ftU = new THREE.Vector3(), _ftF = new THREE.Vector3(), _ftC = new THREE.Vector3();
const _ftQ = new THREE.Quaternion();
function updateFoot(dt) {
  /* 操作是「相对镜头」的：先把镜头朝向投到脚下那块切平面上 */
  fUp(foot.q, _ftU);
  camera.getWorldDirection(camF);
  camF.addScaledVector(_ftU, -camF.dot(_ftU));
  if (camF.lengthSq() < 1e-8) fFwd(foot.q, camF);
  camF.normalize();
  camR.crossVectors(camF, _ftU).normalize();          // 屏幕右方向

  moveDir.set(0, 0, 0);
  moveDir.addScaledVector(camF, -stickVec.y).addScaledVector(camR, stickVec.x);
  if (keys.KeyW || keys.ArrowUp) moveDir.add(camF);
  if (keys.KeyS || keys.ArrowDown) moveDir.sub(camF);
  if (keys.KeyD || keys.ArrowRight) moveDir.add(camR);
  if (keys.KeyA || keys.ArrowLeft) moveDir.sub(camR);
  /* ?auto 步行时也直奔任务点，没有任务点就一直往前走 */
  if (AUTO) {
    if (state.target) moveDir.add(_asD.copy(state.target).sub(PLANET.C).normalize()
      .addScaledVector(_ftU, -_asD.dot(_ftU)));
    else moveDir.add(camF);
  }

  const running = gasOn || keys.ShiftLeft || keys.ShiftRight;
  let mag = Math.min(1, moveDir.length());
  if (mag > 0.08) {
    moveDir.addScaledVector(_ftU, -moveDir.dot(_ftU)).normalize();
    const target = (foot.swimming ? (running ? 2.2 : 1.35) * S : running ? CFG.runSpeed : CFG.walkSpeed) * mag;
    foot.speed += (target - foot.speed) * Math.min(1, dt * 9);
    fFwd(foot.q, _ftF);
    const dh = Math.atan2(_ftC.crossVectors(_ftF, moveDir).dot(_ftU), _ftF.dot(moveDir));
    const step = dh * Math.min(1, dt * CFG.footTurn);
    turn(foot.q, step);
    foot.camOff -= step;                              // 人转了镜头先不动，之后慢慢跟上
  } else {
    mag = 0;
    foot.speed += (0 - foot.speed) * Math.min(1, dt * 12);
    if (foot.speed < 0.05 * S) foot.speed = 0;
  }

  if (jumpQueued) {
    jumpQueued = false;
    if (!foot.air && !foot.swimming) {
      foot.air = true;
      foot.vy = CFG.jumpVel;
      boy.cur = '';
      playAnim('jump', { fade: 0.06, once: true, speed: 1.35 });
    }
  }

  if (!slide(foot.q, _ftQ, foot.speed * dt, CFG.footRadius, true)) foot.speed *= 0.3;
  foot.q.copy(_ftQ);
  fUp(foot.q, _ftU);
  const inWater = isLakeWater(_lakeWorld.copy(_ftU).multiplyScalar(600).add(PLANET.C));
  const swimming = inWater && waterSurfaceR(_ftU) - groundR(_ftU) > (foot.swimming ? .58 : .68) * S;
  if (swimming !== foot.swimming) {
    foot.swimming = swimming;
    if (swimming) { foot.air = false; foot.vy = 0; foot.h = 0; toast('开始游泳 · 摇杆划水，油门加速'); }
  }

  /* 高度只在「离地」这一维上算重力，方向由 frame 的本地 up 给出 */
  if (foot.air) {
    foot.vy -= CFG.gravity * dt;
    foot.h += foot.vy * dt;
    if (foot.h <= 0 && foot.vy < 0) {
      foot.h = 0;
      foot.air = false;
      foot.vy = 0;
      boy.cur = '';
    }
  } else {
    foot.h += (0 - foot.h) * Math.min(1, dt * 10);
  }
  syncBody(walker, foot.q, foot.h, foot, Math.min(1, dt * 10));

  if (!foot.air) {
    if (foot.swimming) playAnim('swim', { fade: .25, speed: foot.speed > .2 ? clamp(foot.speed / (1.35 * S), .7, 1.4) : .55 });
    else if (foot.speed > CFG.walkSpeed * 1.15) playAnim('run', { fade: 0.16, speed: clamp(foot.speed / CFG.runSpeed, 0.65, 1.5) });
    else if (foot.speed > 0.2) playAnim('walk', { fade: 0.16, speed: clamp(foot.speed / CFG.walkSpeed, 0.5, 1.6) });
    else playAnim('idle', { fade: 0.2 });
  }
}

const camGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3();
const camQ = new THREE.Quaternion();
const _cUp = new THREE.Vector3(), _cDir = new THREE.Vector3();
const _cdU = new THREE.Vector3(), _cdQ = new THREE.Quaternion(), _scenicDir = new THREE.Vector3();
const INSPECT = /(\?|&)insp/.test(location.search);
/* ?top=200 从正上方看，用来核对出生点、路面掩码、车流是不是真在马路上 */
const TOPDOWN = parseFloat((location.search.match(/[?&]top=?(\d*)/) || [])[1] || 0) ||
  (/(\?|&)top/.test(location.search) ? 60 * S : 0);

/* 镜头往后退时撞到楼就拉近一点 */
function cameraDistance(want) {
  for (let d = 3 * S; d <= want; d += 0.9 * S) {
    _cdQ.copy(camQ);
    turn(_cdQ, Math.PI);
    advance(_cdQ, d);
    if (blockedDir(fUp(_cdQ, _cdU))) return Math.max(5.5 * S, d - 0.9 * S);
  }
  return want;
}

function updateCamera(dt) {
  const q = focusFrame();
  const p = focusPos();

  /* 骑车时镜头就在车正后方；步行时慢慢转回身后，避免和「相对镜头」操作互相带偏 */
  camQ.copy(q);
  if (!state.onBike) {
    const rate = foot.speed > 0.3 * S ? 1.8 : 0.5;
    foot.camOff += (0 - foot.camOff) * Math.min(1, dt * rate);
    turn(camQ, foot.camOff);
  }
  fUp(camQ, _cUp);
  fFwd(camQ, _cDir);
  /* 必须同步 up：否则 lookAt 拿世界 +Y 当上方，跑到星球另一面镜头就倒过来了 */
  camera.up.copy(_cUp);

  if (TOPDOWN) {
    camera.position.copy(p).addScaledVector(_cUp, TOPDOWN);
    camera.up.copy(_cDir);
    camera.lookAt(p);
    return;
  }

  if (INSPECT) {
    fRight(camQ, _rt);
    camera.position.copy(p).addScaledVector(_rt, 3.4 * S).addScaledVector(_cUp, 1.2 * S).addScaledVector(_cDir, 0.6 * S);
    camera.lookAt(lookGoal.copy(p).addScaledVector(_cUp, 0.9 * S));
    return;
  }

  /* 跟随镜头按场景尺度 S 定位；速度本身已经乘过 S。 */
  const wide = scenicView || introPreview;
  scene.fog.near += ((wide ? 120 : CFG.fog[0]) - scene.fog.near) * Math.min(1, dt * 3);
  scene.fog.far += ((wide ? 4600 : CFG.fog[1]) - scene.fog.far) * Math.min(1, dt * 3);
  if (wide) {
    // Scenic view is an actual orbital shot: aim at the planet centre and
    // place the camera far enough out that the complete sphere fits on both
    // desktop and portrait phone viewports.
    const scenicDistance = overviewDistance(PLANET.R, camera.fov, camera.aspect);
    _scenicDir.copy(_cUp).normalize();
    camGoal.copy(PLANET.C).addScaledVector(_scenicDir, scenicDistance);
    camera.position.lerp(camGoal, Math.min(1, dt * 2.4));
    camera.up.copy(_cDir);
    camera.lookAt(PLANET.C);
    return;
  }
  const base = state.onBike ? 9.0 * S + Math.abs(state.speed) * 0.11 : 7.2 * S + foot.speed * 0.2;
  const back = cameraDistance(base);
  // Lower the bike camera slightly and aim a little behind the rider so the
  // character sits nearer the middle of the mobile frame.
  const high = (state.onBike ? 3.7 : 3.0) * S;
  camGoal.copy(p).addScaledVector(_cDir, -back).addScaledVector(_cUp, high + back * 0.22);
  lookGoal.copy(p).addScaledVector(_cDir, (state.onBike ? -0.8 : 4.2) * S).addScaledVector(_cUp, 1.1 * S);
  camera.position.lerp(camGoal, Math.min(1, dt * (state.onBike ? 6 : 7)));
  camera.lookAt(lookGoal);
}

function updateMarkers(dt, time) {
  [pickupMarker, dropMarker].forEach(m => {
    if (!m.visible) return;
    m.userData.ring.rotation.z += dt * 1.6;
    m.userData.icon.position.y = 3.2 + Math.sin(time * 2.2) * 0.22;
  });
  if (!state.target) return;
  const p = focusPos();
  const d = arcDist(p, state.target);
  /* 世界是 S 倍巨人尺度，HUD 上换算回真人尺度：
     不然一辆电动车会显示 150km/h、送一趟信要跑 900 米。 */
  $('dist').textContent = Math.round(d / S) + ' m';
  const ang = relBearing(focusFrame(), p, state.target);
  $('arw').style.transform = `rotate(${(-ang * 180 / Math.PI)}deg)`;
  if (d < CFG.reachRadius && Math.abs(focusSpeed()) < 2 * S) reachTarget();
}

/* ---------- 主循环 ---------- */
const clock = new THREE.Clock();
/* 舞台高度自己算，不靠 100dvh。安卓 Chrome 横屏里 dvh 比真正能看见的那块高
   （地址栏、手势条各算一次），舞台一超出去，底下那排摇杆、油门、刹车就掉到
   屏幕外面点不到了。宽度交给 CSS 的 100vw，只压高度这一轴。
   每帧对一次：地址栏收起是个动画，只听 resize 会停在中间那个尺寸。 */
const stage = $('stage');
let stageH = 0;
function fitStage() {
  const vv = window.visualViewport;
  const h = Math.round(Math.min(innerHeight || 1e9, vv ? vv.height : 1e9));
  if (h > 0 && h !== stageH) { stageH = h; stage.style.height = h + 'px'; return true; }
  return false;
}
function resize() {
  fitStage();
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
if (window.visualViewport) visualViewport.addEventListener('resize', resize);

/* DEBUG 用：真正会被提交绘制的网格数，以及它们一共有多少个材质分组
   （一个 mesh 挂 N 个材质就是 N 次 draw call） */
function countDrawn(o, acc) {
  if (!o.visible) return acc;
  if (o.isMesh || o.isSprite) {
    acc.n++;
    acc.g += Array.isArray(o.material) ? o.material.length : 1;
    if (o.castShadow) acc.s++;
  }
  for (const c of o.children) countDrawn(c, acc);
  return acc;
}

/* 太阳、天空、云都得跟着「当地的上方」走，否则跑到星球侧面时
   阳光会从地下打上来、天空渐变会横过来。 */
const _lpU = new THREE.Vector3(), _lpN = new THREE.Vector3(), _lpE = new THREE.Vector3();
function loop() {
  requestAnimationFrame(loop);
  if (fitStage()) resize();
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  if (!introPreview) {
    if (state.onBike) updatePlayer(dt);
    else updateFoot(dt);
  }
  if (boy.mixer) boy.mixer.update(dt);
  updateTraffic(dt);
  updateCamera(dt);
  updatePlanetClipping(camera, PLANET.C, PLANET.R);
  if (!introPreview) updateMarkers(dt, time);

  const fp = focusPos();
  fUp(focusFrame(), _lpU);
  horizonCull(focusFrame());
  _lpN.copy(YAXIS).addScaledVector(_lpU, -YAXIS.dot(_lpU));
  if (_lpN.lengthSq() < 1e-6) fFwd(focusFrame(), _lpN);
  _lpN.normalize();
  _lpE.crossVectors(_lpN, _lpU).normalize();

  atmosphere.update(camera, fp, _lpU, _lpE, _lpN);
  updateSeeds(time, fp, _lpU, _lpE, _lpN);
  lakeside?.update(time);
  if (meadowPlants) {
    meadowPlants.setVisible(!scenicView);
    if (!scenicView) meadowPlants.update(time, fp);
  }
  for (const c of clouds) {
    c.u += c.spd * dt;
    if (c.u > 300) c.u -= 600;
    /* 加上球面下沉量，云才不会在远处扎进地里 */
    const sag = (c.u * c.u + c.v * c.v) / (2 * PLANET.R);
    c.sp.position.copy(fp)
      .addScaledVector(_lpE, c.u).addScaledVector(_lpN, c.v)
      .addScaledVector(_lpU, c.h + sag);
  }

  $('spd').textContent = Math.round(Math.abs(focusSpeed()) * 3.6 / S);
  if (DEBUG) {
    if (state.odoP) state.odo = (state.odo || 0) + state.odoP.distanceTo(fp);
    else state.odoP = new THREE.Vector3();
    state.odoP.copy(fp);
  }
  if (DEBUG && time - (state.dbgT || 0) > 0.5) {
    state.dbgT = time;
    const r = renderer.info.render;
    const cd = countDrawn(scene, { n: 0, g: 0, s: 0 });
    /* 车流有没有跑出车道：alive 的车逐个查一下自己脚下的车道掩码，
       分母是活着的车。正常应该一直是 n/n，出现 x/n 就是有车压上草地了。 */
    let carN = 0, carOn = 0;
    const carWhy = {};
    for (const c of traffic) {
      if (!c.alive) continue;
      carN++;
      if (driveAt(c.q, LANE_R)) carOn++;
      carWhy[c.why || '-'] = (carWhy[c.why || '-'] || 0) + 1;
    }
    $('dbg').textContent = `draw=${r.calls} tri=${(r.triangles / 1000) | 0}k fps=${(1 / Math.max(dt, 0.001)) | 0}\n` +
      `R=${groundR(_lpU).toFixed(1)}/${PLANET.R.toFixed(0)} 方位=${(frameBearing(focusFrame()) * 57.3).toFixed(0)}°` +
      ` ${state.onBike ? '骑车' : '步行 ' + boy.cur} 地平线内=${state.hzOn}/${horizon.length}\n` +
      `提交=${cd.n} 分组=${cd.g} 投影=${cd.s} 速=${(focusSpeed() * 3.6).toFixed(0)} 撞=${state.hits || 0}` +
      ` 车流在道=${carOn}/${carN}@${(state.carVs / Math.max(0.01, state.carTs) * 3.6 / S).toFixed(0)}km/h ` +
      Object.keys(carWhy).map(k => k + ':' + carWhy[k]).join(' ') + ` 重投=${state.carResp || 0}` +
      ` 里程=${(state.odo || 0).toFixed(0)}m/${time.toFixed(0)}s`;
  }
  if (time - (state.miniTime || 0) > .10) { drawMini(); state.miniTime = time; }
  renderer.render(scene, camera);
}

/* ---------- 启动 ---------- */
async function boot() {
  resize();
  const c = await openCache();
  if (c) {
    const cached = await withTimeout(c.match('./assets/planet-city.fbx'), 6000, null);
    setTip(cached ? '本机已有缓存，马上就好' : '首次加载约 19MB，下载一次后会存到本机，之后秒开');
  } else {
    setTip('本机缓存不可用（需要 https 打开），每次都要重新下载');
  }
  setProgress(0.03, '加载星球城市…');
  /* 天空贴图和城市并行下（1.4MB，不占进度条），失败也不拦着开局 */

  /* 贴图不用手动指定：FBXLoader 会把模型里的贴图引用去掉 Windows 路径，
     然后到 ./assets/ 下找 Textures.png 和 texture_gradient.png */
  const city = await loadOne('./assets/planet-city.fbx', f => setProgress(0.03 + f * 0.40));
  setProgress(0.45, '整理网格…');
  const dd = dedupeGeometries(city);
  state.geoUnique = dd.unique;
  toonify(city, { palette: true, castShadow: !IS_MOBILE });
  /* 城市那张调色板图集：汽车模型也用它上色，从这里顺一份，省一次 4MB 下载 */
  let atlas = null;
  city.traverse(o => {
    if (atlas || !o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.map) { atlas = m.map; break; }
  });
  /* 地表要单独处理两件事：
     一是 Roads 那层里有一半三角形绕序朝内（法线也跟着朝内，是模型自带的毛病），
     单面渲染会把它们整片剔掉，路面就一条条露出下面 2 米处的草地，看着像镂空破洞，
     所以地表整层改双面渲染，把被剔掉的那一半补回来；
     二是地表不投影——球壳一个面 29 单位宽、阴影图一像素 0.15 单位，
     自投影只会在地上糊出一片片脏斑（shadow acne），楼和树投影就够了。 */
  city.traverse(o => {
    if (!o.isMesh || !TERRAIN.test(o.name)) return;
    o.castShadow = false;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.side = THREE.DoubleSide;
  });
  /* ?mat：地表按材质刷成纯色，天空藏起来、背景刷洋红。
     地上要是真有洞，洞里会是洋红；黑斑其实是路面的话，就会变成红色。 */
  if (/(\?|&)mat/.test(location.search)) {
    const DC = {
      City_Road: 0xff2200, City_RoadLine: 0xffffff, City_Sidewalk: 0x2266ff,
      City_Curb: 0xffee00, City_Grass: 0x00cc44, City_Meadow: 0x00ffd0, City_Rock: 0xcc00ff
    };
    city.traverse(o => {
      if (!o.isMesh || !TERRAIN.test(o.name)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (DC[m.name] === undefined) continue;
        m.map = null; m.color.setHex(DC[m.name]); m.needsUpdate = true;
      }
    });
    atmosphere.sky.visible = false;
    scene.background = new THREE.Color(0xff00ff);
  }
  scene.add(city);
  await new Promise(r => setTimeout(r, 16));

  setProgress(0.52, '测量星球…');
  fitPlanet(city);
  setProgress(0.54, '连接圆弧路口…');
  const [roundedRoads, junctionFurniture, softTerrain, terrainProps] = await Promise.all([
    withRetry('./assets/roads-rounded-v6.bin', () => fetchAsset('./assets/roads-rounded-v6.bin')),
    withRetry('./assets/junction-furniture-v2.json', () => fetchAsset('./assets/junction-furniture-v2.json')),
    withRetry('./assets/terrain-soft-v1.bin', () => fetchAsset('./assets/terrain-soft-v1.bin')),
    withRetry('./assets/terrain-props-v1.json', () => fetchAsset('./assets/terrain-props-v1.json'))
  ]);
  installRoadGeometry(city, decodeRoadGeometry(roundedRoads));
  installJunctionFurniture(city, JSON.parse(new TextDecoder().decode(junctionFurniture)));
  installSoftTerrain(city, decodeRoadGeometry(softTerrain), JSON.parse(new TextDecoder().decode(terrainProps)));
  setProgress(0.57, '铺开湖岸与木码头…');
  lakeside = createLakeside(city);
  if (DEBUG) console.info('Lakeside:', lakeside.stats);
  const density = reduceSceneDensity(city);
  if (DEBUG) console.info('Scene density:', density);
  const grassLevel = raiseGrassLevel(city);
  if (DEBUG) console.info('Grass level:', grassLevel);
  setProgress(0.58, '种下木纹树干…');
  const trunkAsset = await withRetry(TREE_TRUNK_URL, async () => loadTreeTrunk(await fetchAsset(TREE_TRUNK_URL)));
  const trees = replaceStylizedTrees(city, { mobile: IS_MOBILE, trunkAsset });
  if (DEBUG) console.info('Stylized trees:', trees);
  const rocks = roundSceneRocks(city);
  if (DEBUG) console.info('Rounded rocks:', rocks);
  const terrainNormals = smoothTerrainNormals(city);
  if (DEBUG) console.info('Soft terrain:', terrainNormals);
  setProgress(0.59, '铺设草地与街道纹理…');
  const surfaces = await installSurfaceMaterials(city, renderer, loadTex);
  if (DEBUG) console.info('Surface textures:', surfaces);
  bakeGround(city);
  await new Promise(r => setTimeout(r, 16));

  setProgress(0.6, '计算碰撞地图…');
  bakeOcc(city);
  setProgress(0.63, '种下草叶与圆形小花…');
  const meadowField = scatterMeadow(city.getObjectByName('Planet'), (point, up) => {
    const cell = cellOf(up, GRID.ow, GRID.oh), x = cell % GRID.ow, y = Math.floor(cell / GRID.ow);
    // Leave a full raster-cell margin around pavement and solid footprints.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const row = Math.max(0, Math.min(GRID.oh - 1, y + dy));
      const index = row * GRID.ow + (x + dx + GRID.ow) % GRID.ow;
      if (GRID.surf?.[index] || GRID.occ?.[index]) return false;
    }
    return true;
  });
  setProgress(0.64, '铺设半透明插片草…');
  const grassAsset = createGrassCards(await loadTex(GRASS_TEXTURE_URL), surfaces.grassAppearance);
  meadowPlants = createMeadowPlants(scene, meadowField, { mobile: IS_MOBILE, model: grassAsset });
  meadowPlants.setVisible(!scenicView);
  if (DEBUG) console.info('Meadow plants:', meadowPlants.stats);
  buildMiniImage();
  await new Promise(r => setTimeout(r, 16));

  setProgress(0.66, '铺开街道与树影…');
  /* 减少场景物件后再创建描边；地表本身不能描边，避免包住整个星球。 */
  const inked = [];
  city.traverse(o => { if (o.isMesh && !TERRAIN.test(o.name) && !/^Grass/i.test(o.name) && !o.userData.stylizedTree) inked.push(o); });
  for (const o of inked) addOutline(o, 0.015 * S);
  /* 地平线剔除要在描边之后建表：它顺手记下每个物体的描边壳，好按距离单独关掉 */
  prepareHorizon(city);
  await new Promise(r => setTimeout(r, 16));

  setProgress(0.7, '加载电动车…');
  const bikeRoot = await loadOne('./assets/motuo.fbx');
  const bikeSize = normalize(bikeRoot, { span: CFG.bikeLen });
  toonify(bikeRoot, { map: inkTexture(await loadTex('./assets/motuo_basecolor.jpg'), { threshold: 0.16 }) });
  const bikeFlat = flatten(bikeRoot);
  const bikeMesh = new THREE.Mesh(bikeFlat.geometry, bikeFlat.material);
  bikeMesh.castShadow = true;
  bikeMesh.receiveShadow = true;
  bikeHolder.add(bikeMesh);
  addOutline(bikeHolder, 0.021 * S);

  setProgress(0.78, '加载汽车…');
  const carRoot = await loadOne('./assets/car-city.fbx', f => setProgress(0.78 + f * 0.06));
  buildCars(carRoot, atlas);

  setProgress(0.85, '加载小熊猫与骨骼动作…');
  const boyRoot = await withRetry(PANDA_URL, async () => loadPanda(await fetchAsset(PANDA_URL)));
  normalize(boyRoot, { height: CFG.riderHeight });

  boy.pivot = new THREE.Group();
  boy.pivot.add(boyRoot);
  boy.mixer = new THREE.AnimationMixer(boyRoot);

  // Only sit is replaced with a fixed handlebar pose; the other GLB clips stay intact.
  for (const clip of boyRoot.animations) boy.actions[clip.name] = boy.mixer.clipAction(clip);

  /* 用骑坐姿势下的骨盆高度对齐座垫，避免人浮在车上或陷进车里 */
  scene.add(boy.pivot);
  boy.pivot.position.set(0, 0, 0);
  playAnim('sit', { fade: 0 });
  boy.mixer.update(0.001);
  boy.pivot.updateMatrixWorld(true);
  const pelvis = boyRoot.getObjectByName('Pelvis') || boyRoot.getObjectByName('Hip');
  const pelvisY = pelvis ? pelvis.getWorldPosition(new THREE.Vector3()).y : CFG.riderHeight * 0.5;
  const pelvisX = pelvis ? pelvis.getWorldPosition(new THREE.Vector3()).x : 0;
  boy.seat.set(-0.10 * S - pelvisX, bikeSize.y * 0.60 - pelvisY, 0);
  scene.remove(boy.pivot);
  riderHolder.add(boy.pivot);
  boy.pivot.position.copy(boy.seat);
  setRideBtn();

  setProgress(0.93, '投放邮箱…');
  state.q.copy(pickSpawn());
  // Shareable lake view: start on the existing street facing the new scenery.
  if (new URLSearchParams(location.search).has('lake')) {
    const lakeTarget = lakePoint(0, -165);
    let best = null;
    for (let x = -230; x <= 30; x += 8) for (let z = 160; z <= 290; z += 8) {
      const p = lakePoint(x, z, 602), up = p.clone().sub(PLANET.C).normalize();
      const q = frameFromDir(up, lakeTarget.clone().sub(p));
      if (!driveAt(q, CFG.bikeRadius) || blockedAt(q, 3 * S)) continue;
      const score = Math.abs(x + 180) + Math.abs(z - 215);
      if (!best || score < best.score) best = { q: q.clone(), score };
    }
    if (best) state.q.copy(best.q);
  }
  atmosphere.orientSun(state.q);
  state.gr = undefined;
  syncBody(player, state.q, 0, state, 1);
  updateCamera(1);                      // dt=1 让镜头一次就位，不然开局会从远处飞过来

  /* 星球周长 3.8 公里，邮箱要是撒满整颗星，最近的一个平均也在四百米外，
     一趟送信得开两分钟。全都投在出生点这片街区里，最远 300 个身位。 */
  const mbQ = new THREE.Quaternion(), mbU = new THREE.Vector3();
  for (let i = 0; i < 9; i++) {
    const q = findRoadFrame(3 * S, state.q, 300 * S);
    /* 从车道往路边挪一点，落在人行道上，别站在马路正中间 */
    let ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      mbQ.copy(q);
      turn(mbQ, rand(0, Math.PI * 2));
      advance(mbQ, rand(2.4 * S, 4.2 * S));
      ok = paveDir(fUp(mbQ, mbU)) && !blockedAt(mbQ, 0.6 * S);
    }
    if (!ok) mbQ.copy(q);
    turn(mbQ, rand(0, Math.PI * 2));
    state.mailboxes.push(makeMailbox(mbQ));
    stampOcc(mbQ, 0.5 * S);
  }

  setProgress(0.96, '布置车流与街景…');
  placeParked(IS_MOBILE ? 9 : 14);

  await new Promise(r => setTimeout(r, 16));

  initTraffic(IS_MOBILE ? 4 : 6);
  if (/(\?|&)foot/.test(location.search)) dismount();
  if (DEBUG && new URLSearchParams(location.search).has('pandatest')) {
    const { verifyPandaGame } = await import('./tools/panda-game-check.js');
    verifyPandaGame({T:THREE,foot,state,boy,walker,player,PLANET,S,CFG,keys,camera,
      updateFoot,updateCamera,syncBody,dismount,mount,blockedAt,frameFromDir,turn,
      queueJump:()=>{jumpQueued=true;}});
  }

  syncHud();
  nextTask();
  if (/(\?|&)fx/.test(location.search)) setInterval(() => { flyLetter(); coinPop(128); }, 700);
  setProgress(1, '出发！');
  $('loading').style.display = 'none';
  renderer.render(scene, camera);

  if (/(\?|&)footest/.test(location.search)) {
    const boneOf = boyRoot.getObjectByName('R_Thigh');
    const snap = () => boneOf ? boneOf.quaternion.clone() : null;
    const res = [];
    const run2 = (label, secs, opts) => {
      gasOn = !!opts.run;
      stickVec.x = 0; stickVec.y = -1;
      if (opts.stop) { stickVec.y = 0; gasOn = false; }
      if (opts.jump) jumpQueued = true;
      const p0 = walker.position.clone();
      const q0 = snap();
      let air = 0, maxH = 0;
      const n = Math.round(secs * 60);
      for (let i = 0; i < n; i++) {
        updateFoot(1 / 60);
        boy.mixer.update(1 / 60);
        if (foot.air) air += 1 / 60;
        maxH = Math.max(maxH, foot.h);
      }
      const q1 = snap();
      const bone = q0 && q1 ? (1 - Math.abs(q0.dot(q1))).toFixed(4) : 'n/a';
      res.push(`${label}: 位移${p0.distanceTo(walker.position).toFixed(2)}m 速度${foot.speed.toFixed(2)}m/s ` +
        `动作=${boy.cur} 骨骼变化=${bone} 滞空${air.toFixed(2)}s 最高${maxH.toFixed(2)}m`);
    };
    dismount();
    run2('走 2s', 2, {});
    run2('跑 2s', 2, { run: true });
    run2('跳', 1.6, { jump: true, run: false });
    run2('站 1s', 1, { stop: true });
    stickVec.x = stickVec.y = 0; gasOn = false;
    $('dbg').textContent = res.join('\n');
    renderer.render(scene, camera);
    return;
  }

  if (SELFTEST) {
    gasOn = true;
    const res = [];
    for (let t = 0; t < 6; t++) {
      state.q.copy(pickSpawn());
      state.gr = undefined;
      state.speed = 0;
      state.hits = 0;
      syncBody(player, state.q, 0, state, 1);
      let dist = 0;
      const p0 = player.position.clone();
      const before = new THREE.Vector3();
      for (let i = 0; i < 1200; i++) {
        before.copy(player.position);
        updatePlayer(1 / 60);
        dist += before.distanceTo(player.position);
      }
      res.push(`#${t} 行驶${dist.toFixed(0)}m 直线${arcDist(p0, player.position).toFixed(0)}m ` +
        `撞击${state.hits}次 末速${(state.speed * 3.6).toFixed(0)}km/h`);
    }
    /* 再跑一遍完整任务流程：自动朝任务点打方向，看能不能取到信、送到家。
       headless 里 requestAnimationFrame 一秒只走几帧，只能像这样同步空转。 */
    state.autoDrive = true;
    gasOn = false;                      // 油门交给自动驾驶，不然收不了油
    state.q.copy(pickSpawn());
    state.gr = undefined; state.speed = 0; state.hits = 0;
    syncBody(player, state.q, 0, state, 1);
    state.phase = 'pickup';
    nextTask();
    let got = 0, put = 0, odo = 0;
    const prev = new THREE.Vector3();
    for (let i = 0; i < 12000; i++) {
      prev.copy(player.position);
      updatePlayer(1 / 60);
      odo += prev.distanceTo(player.position);
      if (state.target && arcDist(player.position, state.target) < CFG.reachRadius
        && Math.abs(state.speed) < 6) {
        if (state.phase === 'pickup') got++; else put++;
        reachTarget();
      }
    }
    state.autoDrive = false;
    /* 撞击次数会很高：自动驾驶是「直线追踪」，没有寻路，一路蹭着墙走。
       只要「取信 / 送达」不是 0，就说明球面上的任务闭环是通的。 */
    res.push(`任务 200s 取信${got} 送达${put} 里程${odo | 0}m 撞击${state.hits}次 ` +
      `终距${state.target ? arcDist(player.position, state.target).toFixed(0) : '-'}m`);
    $('dbg').textContent = `R=${PLANET.R.toFixed(1)} 几何体=${state.geoUnique} ` +
      `地形三角=${((state.terrainTris || 0) / 1000) | 0}k 占用物=${state.occObjects || 0}\n` + res.join('\n');
    renderer.render(scene, camera);
    return;
  }

  /* ?cartest：车道约束的同步压测。headless 里 rAF 一秒只走几帧
     （HUD 上 696 秒也只推进了不到 1 秒的物理），光看那行「车流在道」
     测到的永远是刚出生那一瞬间，必须像 selftest 一样空转步进。 */
  if (/(\?|&)cartest/.test(location.search)) {
    const N = 9000, step = 1 / 30;
    let mid = 0, wide = 0, samples = 0, vsum = 0, worst = 0;
    const resp0 = state.carResp || 0;
    const u = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      updateTraffic(step);
      let bad = 0;
      for (const c of traffic) {
        if (!c.alive) continue;
        samples++; vsum += c.v;
        if (!driveDir(fUp(c.q, u))) { mid++; bad++; }        // 车心在不在车道上
        if (!driveAt(c.q, 1.6 * S)) wide++;                  // 半个车身范围全在车道上吗
      }
      if (bad > worst) worst = bad;
    }
    $('dbg').textContent =
      `车流压测 ${(N * step).toFixed(0)}s × ${traffic.length} 辆  采样 ${samples} 次` +
      (LANE_FREE ? '  ?nolane 已关闭车道约束' : '') + '\n' +
      `车心出车道 ${mid} 次 (${(mid / samples * 100).toFixed(2)}%)  同一帧最多 ${worst} 辆\n` +
      `半车身出车道 ${wide} 次 (${(wide / samples * 100).toFixed(2)}%)\n` +
      `平均速度 ${(vsum / samples * 3.6 / S).toFixed(1)}km/h（巡航 ${(CAR_SPEED * 3.6 / S).toFixed(0)}）` +
      `  重投 ${(state.carResp || 0) - resp0} 次 ` +
      Object.keys(state.rs).map(k => k + ':' + state.rs[k]).join(' ');
    renderer.render(scene, camera);
    return;
  }

  if (DEBUG) { loop(); return; }
  const gate = $('start');
  gate.classList.add('on');
  document.body.classList.add('welcome');
  loop();
  $('btnStart').addEventListener('click', () => {
    gate.classList.remove('on');
    document.body.classList.remove('welcome');
    introPreview = false;
    resize();
    clock.getDelta();
  }, { once: true });
}

function goFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn && !document.fullscreenElement) fn.call(el).catch(() => {});
  /* 不锁方向：横竖两套 HUD 都在，玩家转手机就跟着转。
     锁过 landscape 的话竖着拿会被系统硬转回来，反而更别扭。 */
}

boot().catch(e => {
  const msg = (e && (e.message || e)) + '';
  setTip('');
  $('ldErr').textContent = '加载失败：' + msg +
    '\n\n多半是网络中断。点下面「重试」会接着用已下载好的缓存继续，不用从头再来。';
  const btn = $('ldRetry');
  if (btn) btn.classList.add('on');
});

if ($('ldRetry')) $('ldRetry').addEventListener('click', () => location.reload());
