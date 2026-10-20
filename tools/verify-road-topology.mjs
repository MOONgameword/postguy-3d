import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { loadCity } from './load-city.mjs';
import { decodeRoadGeometry } from '../road-geometry.js';

const { road } = loadCity();
const file = process.argv[2] || 'assets/roads-rounded-v14.bin';
const bytes = fs.readFileSync(file);
const geometry = decodeRoadGeometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const pos = geometry.attributes.position;
const vertexKey = i => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
const edgeKey = (a, b) => [a, b].sort().join('|');
const edges = new Map(), rim = new Set(), faces = new Set();
let duplicates = 0;
for (const group of geometry.groups) {
  const name = road.material[group.materialIndex]?.name || (group.materialIndex === 4 ? 'City_Tactile' : '');
  if (!['City_Road', 'City_Curb'].includes(name)) continue;
  for (let i = group.start; i < group.start + group.count; i += 3) {
    const ids = [0, 1, 2].map(k => vertexKey(i + k));
    const points = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(road.matrixWorld));
    if (name === 'City_Road') {
      const key = ids.slice().sort().join('|');
      if (faces.has(key)) duplicates++;
      faces.add(key);
    }
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(ids[k], ids[(k + 1) % 3]);
      if (name === 'City_Road') edges.set(key, (edges.get(key) || 0) + 1);
      else if ([points[k], points[(k + 1) % 3]].every(p => Math.abs(p.length() - 602) < .0002)) rim.add(key);
    }
  }
}
const unpaired = [...edges].filter(([key, count]) => count === 1 && !rim.has(key));
const missingRim = [...rim].filter(key => edges.get(key) !== 1);
const nonManifold = [...edges].filter(([, count]) => count > 2);
console.log(JSON.stringify({ file, roadTriangles: faces.size, roadEdges: edges.size, curbEdges: rim.size,
  internalCrackEdges: unpaired.length, missingCurbConnections: missingRim.length,
  nonManifoldEdges: nonManifold.length, duplicateFaces: duplicates }, null, 2));
assert.equal(unpaired.length, 0, 'Interior and corridor joins must share entire edges');
assert.equal(missingRim.length, 0, 'Asphalt must share all curb bottom edges');
assert.equal(nonManifold.length, 0);
assert.equal(duplicates, 0);
