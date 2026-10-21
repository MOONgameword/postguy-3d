import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.js';
import { FBXLoader } from '../vendor/loaders/FBXLoader.js';
import { loadCity } from './load-city.mjs';
import { decodeRoadGeometry, installRoadGeometry } from '../road-geometry.js';
import { createTrafficLanes } from '../traffic-lanes.js';
import { installFootbridges, createFootbridgeWalk } from '../footbridges.js';
import { buildFootprint, footprintBlocked } from '../collision-world.js';
const { city } = loadCity();
const rb = fs.readFileSync('assets/roads-rounded-v16.bin');
installRoadGeometry(city, decodeRoadGeometry(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength)));
const lanes = createTrafficLanes(JSON.parse(fs.readFileSync('assets/traffic-lanes-v1.json')));
const fb = fs.readFileSync('assets/footbridge-v1.fbx');
const src = new FBXLoader().parse(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), '');
const res = installFootbridges(city, src, lanes, { corridors: [0, 7, 13, 14], makeMaterial: (name) => new T.MeshBasicMaterial({ name }) });
console.log({ count: res.count, removed: res.removedFurniture, tris: res.triangles });
const bodies = res.root.children.filter(m => m.userData.footbridge === 'body');
const shapes = bodies.map(m => buildFootprint(m));
let laneHits = 0, laneSamples = 0;
for (const p of lanes.paths) for (const q of p.points) {
  const d = q.clone().normalize();
  laneSamples++;
  // Car half-width ~2.5 units around each lane sample.
  if (shapes.some(s => footprintBlocked(s, d, 2.5))) laneHits++;
}
// Tower base heights vs sidewalk deck (602.8667) and deck clearance over road centre.
const v = new T.Vector3();
for (const m of bodies) {
  const p = m.geometry.attributes.position;
  let baseMin = Infinity, baseMax = -Infinity, deckLow = Infinity;
  const local = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    local.fromBufferAttribute(p, i);
    v.copy(local).applyMatrix4(m.matrixWorld);
    const r = v.length();
    if (Math.abs(local.x) > 21 && local.y < .5) { baseMin = Math.min(baseMin, r); baseMax = Math.max(baseMax, r); }
    if (Math.abs(local.x) < 18) deckLow = Math.min(deckLow, r - 602);
  }
  console.log(m.name, 'tower base radius', baseMin.toFixed(2), '..', baseMax.toFixed(2), 'deck clearance over road', deckLow.toFixed(2), 'footprint cells', shapes[bodies.indexOf(m)].occupied);
}
console.log({ laneSamples, laneHits });
assert.equal(res.count, 4, 'Four footbridges');
assert.equal(laneHits, 0, 'Stair towers must not block any traffic lane');

// Walk simulation with the game's own walker queries (no planet-centre offset here).
const walk = createFootbridgeWalk(res.walkers, new T.Vector3());
const bridge = res.walkers[0].mesh, M = bridge.matrixWorld;
const worldAt = (x, z, y = 0) => new T.Vector3(x, y, z).applyMatrix4(M);
const W = 602 + 2.6 / 3, R = .42 * 3;
// Floor profile along the tower centre line shows where each stair starts.
const towerX = 26.3;
let profile = '';
for (let z = -22; z <= 22; z += 2) { const d = worldAt(towerX, z).normalize(); const s = walk.support(d, 615); profile += (s === -Infinity ? ' --' : ' ' + (s - W).toFixed(1)); }
console.log('tower floor profile (z -22..22):' + profile);
let across = '';
for (let x = -32; x <= 32; x += 2) { const d = worldAt(x, 0).normalize(); const s = walk.support(d, 615); across += (s === -Infinity ? ' --' : ' ' + (s - W).toFixed(1)); }
console.log('floor profile across at z=0 (x -32..32):' + across);
function stroll(path) {
  let feet = W, top = 0, stuck = null;
  for (let i = 0; i < path.length; i++) {
    const d = worldAt(path[i][0], path[i][1]).normalize();
    if (walk.blocked(d, feet, R)) { stuck = path[i]; break; }
    feet = Math.max(W, walk.support(d, feet));
    top = Math.max(top, feet - W);
  }
  return { top, stuck, end: feet - W };
}
const line = (x0, z0, x1, z1, n = 400) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
// Up the stair from the sidewalk end, onto the top landing, across the deck, down the far side.
const up = stroll([...line(towerX, -21, towerX, 0), ...line(towerX, 0, -towerX, 0), ...line(-towerX, 0, -towerX, -21)]);
console.log('walk over the bridge', up);
// Walking off the side of the deck must hit the railing.
const off = stroll([...line(towerX, -21, towerX, 0), ...line(towerX, 0, 0, 0), ...line(0, 0, 0, 10)]);
console.log('walk off the deck side', off);
// Walking along the road under the deck is unaffected.
const under = stroll(line(-5, -40, -5, 40));
console.log('walk along the road under the deck', under);
assert.ok(up.stuck === null && up.top > 9, 'Walker climbs the stair and crosses the deck');
assert.ok(Math.abs(up.end) < .5, 'Walker comes back down to the sidewalk');
assert.ok(off.stuck !== null, 'Deck railing blocks walking off the side');
assert.ok(under.stuck === null && under.top < .01, 'Road under the deck is clear');
console.log(JSON.stringify({ result: 'PASS', bridges: res.count, laneSamples, climb: +up.top.toFixed(2) }));

// Both stair approaches, both towers and every planet orientation must support
// the bike's full collision radius. Also ensure the long deck is one plane.
for (const {mesh,grid} of res.walkers) {
  assert.equal(grid.flights,4);
  const ys=[];
  for(let x=-29;x<=29;x+=.5) ys.push(grid.floorAt(x,0));
  assert.ok(Math.max(...ys)-Math.min(...ys)<.0001,'Deck and top landings are coplanar');
  for(const side of [-1,1]) for(const entrance of [-1,1]) {
    const path=[...line(side*towerX,entrance*21,side*towerX,0),...line(side*towerX,0,-side*towerX,0),...line(-side*towerX,0,-side*towerX,-entrance*21)];
    let feet=W, top=0;
    for(const [x,z] of path){
      const d=new T.Vector3(x,0,z).applyMatrix4(mesh.matrixWorld).normalize();
      assert.equal(walk.blocked(d,feet,2.1),false,`Bike path blocked ${mesh.name} ${x},${z}`);
      feet=Math.max(W,walk.support(d,feet));top=Math.max(top,feet-W);
    }
    assert.ok(top>9&&Math.abs(feet-W)<.5,'Bike goes up, crosses, and descends');
  }
  // Sample every 1 cm of the main ramp: no half-unit tread-height jumps.
  for(const sign of [-1,1]) {
    let last=grid.floorAt(towerX,sign*17.8);
    for(let z=17.79;z>3.7;z-=.01){
      const y=grid.floorAt(towerX,sign*z);
      assert.ok(Number.isFinite(y)&&Math.abs(y-last)<.015,'Continuous ramp support');last=y;
    }
  }
}
console.log('PASS: flat deck, 16 bike crossings, continuous ramps');
// Exercise the runtime movement functions themselves, including height updates
// during swept bike motion (the old code rejected every staircase footprint).
const game=fs.readFileSync('game.js','utf8');
const section=(a,b)=>game.slice(game.indexOf(a),game.indexOf(b,game.indexOf(a)));
const {createCollisionWorld,sweepSphere}=await import('../collision-world.js');
const collisionWorld=createCollisionWorld(res.root,new T.Vector3());
const state={gr:W},foot={gr:W,h:0},PLANET={C:new T.Vector3(),R:600};
const groundR=()=>W;
const fUp=(q,v)=>v.set(0,1,0).applyQuaternion(q);
const fFwd=(q,v)=>v.set(0,0,1).applyQuaternion(q);
const fRight=(q,v)=>v.set(1,0,0).applyQuaternion(q);
const runtime=new Function('THREE','collisionWorld','footbridgeWalk','state','foot','PLANET','groundR','sweepSphere','fUp','fFwd','fRight',`
const CFG={bikeRadius:2.1},_lakeWorld=new THREE.Vector3(),isLakeWater=()=>false;
const walkerFeetR=d=>(foot.gr??groundR(d))+foot.h;
${section('const _blU =','/* 从 frame 出发')}
${section('const _sbU =','/* ?auto')}
return {slide,syncBody,blockedAt};
`)(T,collisionWorld,walk,state,foot,PLANET,groundR,sweepSphere,fUp,fFwd,fRight);
for(const {mesh} of res.walkers) for(const entrance of [-1,1]) {
  state.gr=W;
  const bike=new T.Object3D();
  const path=[...line(towerX,21*entrance,towerX,0,20),...line(towerX,0,-towerX,0,50),...line(-towerX,0,-towerX,-21*entrance,20)];
  let prev=new T.Vector3(path[0][0],0,path[0][1]).applyMatrix4(mesh.matrixWorld).normalize();
  let top=0;
  for(const [x,z] of path.slice(1)){
    const target=new T.Vector3(x,0,z).applyMatrix4(mesh.matrixWorld).normalize();
    const dot=T.MathUtils.clamp(target.dot(prev),-1,1),dist=Math.acos(dot)*600;
    if(dist<1e-5)continue;
    const forward=target.clone().addScaledVector(prev,-dot).normalize();
    const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(prev,forward),prev,forward));
    const out=new T.Quaternion();
    // Sweep along the great-circle tangent toward the next route sample.
    assert.equal(runtime.slide(q,out,dist,2.1),true,'Runtime bike sweep must climb');
    runtime.syncBody(bike,out,0,state,.133);
    top=Math.max(top,state.gr-W);prev=fUp(out,new T.Vector3());
  }
  console.log({top,end:state.gr-W}); assert.ok(top>9&&state.gr-W<.7,'Runtime bike traverses entire bridge');
}
console.log('PASS: actual game slide/syncBody, 8 bike crossings');
