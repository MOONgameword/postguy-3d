import * as THREE from 'three';
import { tessellateJunction } from './junction-tessellation.js';

const BASE = 600, ROAD = 602, ORIGINAL_WALK = 604.6;
// Keep the paving deck slightly below the raised curb caps.  The small step
// reads in the normal map and keeps the sidewalk walkable without adding a
// high-poly curb profile.
const WALK = ROAD + (ORIGINAL_WALK - ROAD) / 3;
const CURB_TOP = WALK + 0.20;
// The source FBX uses a wide four-lane strip everywhere.  Keep one continuous
// arterial at that width, and make every other corridor a compact two-lane road.
const MAIN_HALF = 35, SIDE_HALF = 18, SIDEWALK = 15;
const CURB_GAP = 1.4;
const TACTILE_GAP = 3.2, TACTILE_WIDTH = 2.0;
const TAU = Math.PI * 2;
const v2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
const left = d => v2(-d.y, d.x);

// Used by the offline baker. Derive the graph from the real FBX strip boundaries,
// so junctions on the back of the planet receive exactly the same treatment.
export function buildRoundedJunctions(mesh) {
  mesh.updateWorldMatrix(true, false);
  const source = mesh.geometry;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const materialIndex = name => mats.findIndex(m => m.name === name);
  const roadIndex = materialIndex('City_Road'), lineIndex = materialIndex('City_RoadLine');
  const walkIndex = materialIndex('City_Sidewalk'), curbIndex = materialIndex('City_Curb');
  if ([roadIndex, lineIndex, walkIndex, curbIndex].some(i => i < 0)) throw new Error('Missing road material groups');
  // The source FBX has four material slots.  The baked road adds one light
  // tactile strip slot; it is installed by road-geometry.js at runtime.
  const tactileIndex = mats.length;
  const vertexMap = new Map(), vertices = [], edges = new Map();
  const read = i => new THREE.Vector3().fromBufferAttribute(source.attributes.position,
    source.index ? source.index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  for (const group of source.groups) {
    if (group.materialIndex !== roadIndex) continue;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const ids = [0, 1, 2].map(k => {
        const p = read(i + k), key = p.toArray().map(x => Math.round(x * 100)).join(',');
        if (!vertexMap.has(key)) { vertexMap.set(key, vertices.length); vertices.push(p); }
        return vertexMap.get(key);
      });
      for (let k = 0; k < 3; k++) {
        const a = ids[k], b = ids[(k + 1) % 3], key = [a, b].sort((a, b) => a - b).join(',');
        if (!edges.has(key)) edges.set(key, { a, b, count: 0 });
        edges.get(key).count++;
      }
    }
  }
  const adjacency = new Map();
  for (const { a, b, count } of edges.values()) {
    if (count !== 1) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!adjacency.has(x)) adjacency.set(x, []);
      adjacency.get(x).push(y);
    }
  }
  const corners = new Set();
  for (const [id, ns] of adjacency) {
    if (ns.length !== 2) throw new Error('Road boundary is not a closed strip');
    const p = vertices[id], up = p.clone().normalize();
    const ds = ns.map(n => { const d = vertices[n].clone().sub(p); return d.addScaledVector(up, -d.dot(up)).normalize(); });
    if (ds[0].dot(ds[1]) > Math.cos(160 * Math.PI / 180)) corners.add(id);
  }
  const junctions = [];
  for (const id of corners) {
    const across = adjacency.get(id).find(n => corners.has(n));
    if (across === undefined || across < id) continue;
    const p = vertices[id].clone().add(vertices[across]).multiplyScalar(0.5);
    let junction = junctions.find(j => j.origin.distanceTo(p) < 0.05);
    if (!junction) {
      const up = p.clone().normalize();
      const x = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
      junction = { origin: p, up, x, y: new THREE.Vector3().crossVectors(up, x).normalize(), arms: [], sectors: [] };
      junctions.push(junction);
    }
    const next = adjacency.get(id).find(n => n !== across);
    const direction = vertices[next].clone().sub(vertices[id]);
    direction.addScaledVector(junction.up, -direction.dot(junction.up)).normalize();
    junction.arms.push({ direction, cut: 90 });
  }
  // Replace the boundary-edge estimate with the exact great-circle tangent.
  for (const j of junctions) for (const arm of j.arms) {
    let best, score = -1;
    for (const other of junctions) {
      if (other === j) continue;
      const d = other.up.clone().addScaledVector(j.up, -other.up.dot(j.up)).normalize();
      const dot = d.dot(arm.direction);
      if (dot > score) { score = dot; best = other; }
    }
    if (score < 0.998) throw new Error('Cannot pair source road endpoints');
    arm.destination = best;
    arm.direction.copy(best.up).addScaledVector(j.up, -best.up.dot(j.up)).normalize();
    arm.d = v2(arm.direction.dot(j.x), arm.direction.dot(j.y)).normalize();
    arm.angle = Math.atan2(arm.d.y, arm.d.x);
  }
  // One continuous arterial through the residential centre. Its internal
  // junctions follow the straightest continuation, without branches or loops.
  const mainPath = [4, 0, 3, 5, 9];
  const edgeKey = (a,b) => [junctions.indexOf(a),junctions.indexOf(b)].sort((a,b)=>a-b).join(':');
  const mainEdges = new Set();
  for (let i = 1; i < mainPath.length; i++) mainEdges.add(edgeKey(junctions[mainPath[i - 1]], junctions[mainPath[i]]));
  for (const j of junctions) for (const arm of j.arms) {
    arm.half = mainEdges.has(edgeKey(j, arm.destination)) ? MAIN_HALF : SIDE_HALF;
    arm.outer = arm.half + SIDEWALK;
  }
  for (const j of junctions) {
    j.arms.sort((a, b) => a.angle - b.angle);
    for (let i=0;i<j.arms.length;i++) {
      const a=j.arms[i], b=j.arms[(i+1)%j.arms.length];
      const gap=(b.angle-a.angle+TAU)%TAU;
      // Solve a circular fillet tangent to both edges, including unequal widths.
      const radius=gap<Math.PI?50:-100;
      const na=left(a.d), nb=left(b.d).negate();
      const ha=a.half+radius, hb=b.half+radius;
      const det=na.x*nb.y-na.y*nb.x;
      const center=v2((ha*nb.y-na.y*hb)/det,(na.x*hb-ha*nb.x)/det);
      const ta=center.dot(a.d),tb=center.dot(b.d);
      a.cut=Math.max(a.cut,ta+16); b.cut=Math.max(b.cut,tb+16);
      j.sectors.push({a,b,gap,sweep:gap-Math.PI,ta,tb,center,radius});
    }
  }
  const world = (j, p, radius) => j.up.clone().multiplyScalar(BASE)
    .addScaledVector(j.x, p.x).addScaledVector(j.y, p.y).normalize().multiplyScalar(radius);
  const mouth = (arm, width) => arm.d.clone().multiplyScalar(arm.cut)
    .addScaledVector(left(arm.d), width * Math.sqrt(1 + (arm.cut / BASE) ** 2));
  function sectorPath(sector, widthA, widthB = widthA) {
    const {a,b,ta:tA,tb:tB,center,sweep,radius}=sector;
    const start=mouth(a,widthA),end=mouth(b,-widthB);
    const ta=a.d.clone().multiplyScalar(tA).addScaledVector(left(a.d),widthA);
    const tb=b.d.clone().multiplyScalar(tB).addScaledVector(left(b.d),-widthB);
    const nA=Math.max(1,Math.ceil((a.cut-tA)/5)),nB=Math.max(1,Math.ceil((b.cut-tB)/5));
    const nArc=Math.max(4,Math.ceil(Math.abs(sweep)*(Math.abs(radius)+SIDEWALK)/4));
    const points=[];
    for(let k=0;k<nA;k++) points.push(start.clone().lerp(ta,k/nA));
    const r=ta.clone().sub(center),endRadius=tb.distanceTo(center);
    for(let k=0;k<=nArc;k++) {
      const f=k/nArc,angle=sweep*f,c=Math.cos(angle),s=Math.sin(angle);
      const scale=THREE.MathUtils.lerp(r.length(),endRadius,f)/r.length();
      points.push(v2(center.x+(r.x*c-r.y*s)*scale,center.y+(r.x*s+r.y*c)*scale));
    }
    for(let k=1;k<=nB;k++) points.push(tb.clone().lerp(end,k/nB));
    return points;
  }
  const buffers = mats.map(() => ({ position: [], normal: [], uv: [] }));
  buffers.push({ position: [], normal: [], uv: [] });
  const inverse = mesh.matrixWorld.clone().invert();
  const normalToLocal = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld).transpose();
  const local = p => {
    const q = p.clone().applyMatrix4(inverse);
    return q.set(Math.fround(q.x), Math.fround(q.y), Math.fround(q.z));
  };
  function triangle(index, a, b, c, uv = [[0, 0], [0, 0], [0, 0]]) {
    const la = local(a), lb = local(b), lc = local(c);
    const outward = a.clone().add(b).add(c).normalize().applyMatrix3(normalToLocal).normalize();
    const face = lb.clone().sub(la).cross(lc.clone().sub(la));
    if (face.lengthSq() < 1e-18) return;
    const flip = face.dot(outward) < 0;
    const points = [la, lb, lc], order = flip ? [0, 2, 1] : [0, 1, 2];
    // Vertical curb skirts need their actual face normal, not a radial road
    // normal. Quantize first so tiny faces cannot flip after GPU conversion.
    const normal = face.normalize().multiplyScalar(flip ? -1 : 1);
    for (const id of order) {
      const p = points[id];
      buffers[index].position.push(...p.toArray());
      const shadingNormal = index === roadIndex
        ? [a, b, c][id].clone().normalize().applyMatrix3(normalToLocal).normalize() : normal;
      buffers[index].normal.push(...shadingNormal.toArray());
      buffers[index].uv.push(...uv[id]);
    }
  }
  const quad = (index, a, b, c, d, u0 = 0, u1 = 1) => {
    // Follow the curb, including bends, instead of projecting joints on world axes.
    const v = index === curbIndex ? a.distanceTo(d) / 4 : 0;
    const uv = index === curbIndex ? [[u0, 0], [u1, 0], [u1, v], [u0, v]] : [[0, 0], [0, 0], [0, 0], [0, 0]];
    triangle(index, a, b, c, uv.slice(0, 3));
    triangle(index, a, c, d, [uv[0], uv[2], uv[3]]);
  };
  function ribbon(j, pathA, pathB, radiusA, radiusB, index) {
    const lengths = pathA.slice(1).map((p, k) => world(j, p, WALK).distanceTo(world(j, pathA[k], WALK)));
    const total = lengths.reduce((a, b) => a + b, 0);
    const repeats = Math.max(1, Math.round(total / 4));
    let along = 0;
    for (let k = 0; k < pathA.length - 1; k++) {
      quad(index, world(j, pathA[k], radiusA), world(j, pathA[k + 1], radiusA),
        world(j, pathB[k + 1], radiusB), world(j, pathB[k], radiusB), along / total * repeats, (along + lengths[k]) / total * repeats);
      along += lengths[k];
    }
  }
  for (const j of junctions) {
    const outline = [];
    for (const sector of j.sectors) {
      const front = sectorPath(sector, sector.a.half, sector.b.half);
      const curbPath = sectorPath(sector, sector.a.half + CURB_GAP, sector.b.half + CURB_GAP);
      const back = sectorPath(sector, sector.a.outer, sector.b.outer);
      outline.push(...front);
      // Symmetric cross-sections match at both ends of each corridor.
      const strips=Math.ceil(2*sector.b.half/10);
      for(let k=1;k<strips;k++) outline.push(mouth(sector.b,-sector.b.half+2*sector.b.half*k/strips));
      ribbon(j, front, back, WALK, WALK, walkIndex);
      ribbon(j, front, front, ROAD, CURB_TOP, curbIndex);
      ribbon(j, front, curbPath, CURB_TOP, CURB_TOP, curbIndex);
      ribbon(j, back, back, CURB_TOP, 600, curbIndex);
      ribbon(j, back, sectorPath(sector, sector.a.outer - CURB_GAP, sector.b.outer - CURB_GAP), CURB_TOP, CURB_TOP, curbIndex);
      const tactileA = sectorPath(sector, sector.a.half + TACTILE_GAP, sector.b.half + TACTILE_GAP);
      const tactileB = sectorPath(sector, sector.a.half + TACTILE_GAP + TACTILE_WIDTH, sector.b.half + TACTILE_GAP + TACTILE_WIDTH);
      ribbon(j, tactileA, tactileB, WALK + .018, WALK + .018, tactileIndex);
      ribbon(j,sectorPath(sector,sector.a.half-3.7,sector.b.half-3.7),
        sectorPath(sector,sector.a.half-2.3,sector.b.half-2.3),ROAD+.02,ROAD+.02,lineIndex);
    }
    // Earcut also handles the outside of two-arm bends where the origin need not
    // lie inside the drivable polygon. A fan at the origin would create overlaps.
    const polygon = outline.filter((p, i) => !i || p.distanceToSquared(outline[i - 1]) > 1e-12);
    const tessellation = tessellateJunction(polygon);
    for (const [a, b, c] of tessellation.triangles) {
      triangle(roadIndex, ...[a, b, c].map(i => world(j, tessellation.points[i], ROAD)));
    }
    j.outline = polygon;
  }
  const corridors = [], crosswalks = [];
  for (let ji = 0; ji < junctions.length; ji++) for (const arm of junctions[ji].arms) {
    const j = junctions[ji], other = arm.destination, oi = junctions.indexOf(other);
    if (oi < ji) continue;
    const reverse = other.arms.find(a => a.destination === j);
    if (!reverse) throw new Error('Road graph is not reciprocal');
    const angle = Math.acos(THREE.MathUtils.clamp(j.up.dot(other.up), -1, 1));
    const start = Math.atan(arm.cut / BASE), end = angle - Math.atan(reverse.cut / BASE);
    if (end <= start) throw new Error('Rounded junctions overlap along a road');
    const side = new THREE.Vector3().crossVectors(j.up, arm.direction).normalize();
    function at(s, width, radius) {
      return j.up.clone().multiplyScalar(Math.cos(s) * BASE)
        .addScaledVector(arm.direction, Math.sin(s) * BASE).addScaledVector(side, width).normalize().multiplyScalar(radius);
    }
    const half = arm.half, outer = arm.outer;
    const crossings=[];
    // Put one crossing at every mouth of a true intersection. Two-arm bends
    // stay unmarked. Use the same great-circle coordinates as the asphalt.
    if(j.arms.length>=3)crossings.push({junction:ji,from:start+4/BASE,to:start+20/BASE,width:half});
    if(other.arms.length>=3)crossings.push({junction:oi,from:end-20/BASE,to:end-4/BASE,width:reverse.half});
    if(crossings.length===2&&crossings[0].to+4/BASE>crossings[1].from)throw new Error('Crosswalks overlap');
    for(const crossing of crossings){
      if(crossing.from<start||crossing.to>end)throw new Error('Crosswalk exceeds road corridor');
      const stripes = half <= SIDE_HALF + 0.1 ? 6 : 9;
      const step = (2 * crossing.width - 10) / stripes, stripeWidth = step * 0.52;
      for(let stripe=0;stripe<stripes;stripe++){
        const w = -crossing.width + 5 + stripe * step;
        quad(lineIndex,at(crossing.from,w,ROAD),at(crossing.to,w,ROAD),
          at(crossing.to,w+stripeWidth,ROAD),at(crossing.from,w+stripeWidth,ROAD));
      }
      crosswalks.push({...crossing,corridor:corridors.length,stripes,
        position:at((crossing.from+crossing.to)/2,0,ROAD).toArray()});
    }
    const count = Math.ceil((end - start) * BASE / 8);
    const curbRepeats = Math.max(1, Math.round((end - start) * WALK / 4));
    for (let k = 0; k < count; k++) {
      const a = start + (end - start) * k / count, b = start + (end - start) * (k + 1) / count;
      const strips=Math.ceil(2*half/10);
      for(let k=0;k<strips;k++) {
        const w=-half+2*half*k/strips,next=-half+2*half*(k+1)/strips;
        quad(roadIndex,at(a,w,ROAD),at(b,w,ROAD),at(b,next,ROAD),at(a,next,ROAD));
      }
      for (const sign of [-1, 1]) {
        quad(walkIndex, at(a, sign * half, WALK), at(b, sign * half, WALK), at(b, sign * outer, WALK), at(a, sign * outer, WALK));
        const tactileCenter = half + TACTILE_GAP + TACTILE_WIDTH / 2;
        quad(tactileIndex, at(a, sign * (tactileCenter - TACTILE_WIDTH / 2), WALK + .018), at(b, sign * (tactileCenter - TACTILE_WIDTH / 2), WALK + .018),
          at(b, sign * (tactileCenter + TACTILE_WIDTH / 2), WALK + .018), at(a, sign * (tactileCenter + TACTILE_WIDTH / 2), WALK + .018));
        const u0 = k / count * curbRepeats, u1 = (k + 1) / count * curbRepeats;
        quad(curbIndex, at(a, sign * half, ROAD), at(b, sign * half, ROAD), at(b, sign * half, CURB_TOP), at(a, sign * half, CURB_TOP), u0, u1);
        quad(curbIndex, at(a, sign * half, CURB_TOP), at(b, sign * half, CURB_TOP), at(b, sign * (half + CURB_GAP), CURB_TOP), at(a, sign * (half + CURB_GAP), CURB_TOP), u0, u1);
        quad(curbIndex, at(a, sign * outer, CURB_TOP), at(b, sign * outer, CURB_TOP), at(b, sign * outer, 600), at(a, sign * outer, 600), u0, u1);
        const innerEdge = sign * (outer - CURB_GAP);
        quad(curbIndex, at(a, sign * outer, CURB_TOP), at(b, sign * outer, CURB_TOP), at(b, innerEdge, CURB_TOP), at(a, innerEdge, CURB_TOP), u0, u1);
      }
    }
    corridors.push({ j, other, arm, reverse, start, end, side, crossings, at });
  }
  // Generate dividers from lane counts instead of retaining old four-lane paint.
  for(const c of corridors) {
    const paint=(from,to,w,width)=>{
      const steps=Math.max(1,Math.ceil((to-from)*BASE/6));
      for(let k=0;k<steps;k++) {
        const a=from+(to-from)*k/steps,b=from+(to-from)*(k+1)/steps;
        quad(lineIndex,c.at(a,w-width/2,ROAD),c.at(b,w-width/2,ROAD),
          c.at(b,w+width/2,ROAD),c.at(a,w+width/2,ROAD));
      }
    };
    for(const sign of [-1,1]) paint(c.start,c.end,sign*(c.arm.half-3),1.4);
    const intervals=[]; let from=c.start;
    for(const x of c.crossings.slice().sort((a,b)=>a.from-b.from)) {
      if(x.from-1/BASE>from) intervals.push([from,x.from-1/BASE]);
      from=x.to+1/BASE;
    }
    if(from<c.end) intervals.push([from,c.end]);
    for(const [a,b] of intervals) {
      // Short white centre dashes with equal gaps, matching the lane dividers.
      // Keep the crosswalk clear and bake into the existing road paint group.
      for(let s=a;s<b;s+=18/BASE) paint(s,Math.min(b,s+9/BASE),0,1.2);
      if(c.arm.half===MAIN_HALF) for(const w of [-17.5,17.5])
        for(let s=a;s<b;s+=18/BASE) paint(s,Math.min(b,s+9/BASE),w,1.1);
    }
  }
  const geometry = new THREE.BufferGeometry(), positions = [], normals = [], uvs = [];
  for (let index = 0; index < buffers.length; index++) {
    const data = buffers[index], start = positions.length / 3;
    for (const n of data.position) positions.push(n);
    for (const n of data.normal) normals.push(n);
    for (const n of data.uv) uvs.push(n);
    geometry.addGroup(start, data.position.length / 3, index);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, junctions, corridors, crosswalks, sectorPath, world, mainPath,
    stats: { junctions: junctions.length, corners: junctions.reduce((n, j) => n + j.sectors.length, 0), corridors: corridors.length, crosswalks:crosswalks.length, triangles: positions.length / 9,
      mainPath, mainEdges: [...mainEdges], mainHalf: MAIN_HALF, sideHalf: SIDE_HALF } };
}

export function relocateJunctionFurniture(city, plan) {
  const placements=[],occupied=[],candidates=[];
  for(const j of plan.junctions)for(const sector of j.sectors)
    for(const p of plan.sectorPath(sector,sector.a.outer-3.2,sector.b.outer-3.2))
      candidates.push(plan.world(j,p,WALK));
  for(const c of plan.corridors)for(const sign of [-1,1]) {
    const n=Math.ceil((c.end-c.start)*BASE/4);
    for(let k=0;k<=n;k++) candidates.push(c.at(c.start+(c.end-c.start)*k/n,sign*(c.arm.outer-3.2),WALK));
  }
  city.updateMatrixWorld(true);
  const props=[];city.traverse(o=>{if(o.isMesh&&/^Street_/.test(o.name))props.push(o);});
  props.sort((a,b)=>a.name.localeCompare(b.name));
  for(const mesh of props) {
    const pivot=mesh.getWorldPosition(new THREE.Vector3()),dir=pivot.clone().normalize();
    const ordered=candidates.slice().sort((a,b)=>a.distanceToSquared(pivot)-b.distanceToSquared(pivot));
    const target=ordered.find(p=>occupied.every(q=>p.distanceTo(q)>8));
    if(!target||target.distanceTo(pivot)>140)throw new Error('Cannot place roadside furniture: '+mesh.name);
    occupied.push(target);
    const rotation=new THREE.Quaternion().setFromUnitVectors(dir,target.clone().normalize());
    const matrix=new THREE.Matrix4().makeRotationFromQuaternion(rotation).multiply(mesh.matrixWorld);
    const attr=mesh.geometry.attributes.position,point=new THREE.Vector3();let bottom=Infinity;
    for(let i=0;i<attr.count;i++)bottom=Math.min(bottom,point.fromBufferAttribute(attr,i).applyMatrix4(matrix).length());
    const shift=target.clone().normalize().multiplyScalar(WALK-bottom);
    matrix.elements[12]+=shift.x;matrix.elements[13]+=shift.y;matrix.elements[14]+=shift.z;
    matrix.premultiply(mesh.parent.matrixWorld.clone().invert());
    const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
    matrix.decompose(position,quaternion,scale);
    placements.push({name:mesh.name,position:position.toArray(),quaternion:quaternion.toArray(),scale:scale.toArray()});
  }
  return placements;
}
