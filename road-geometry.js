import * as THREE from 'three';
import { unzlibSync } from './vendor/libs/fflate.module.js';

export function decodeRoadGeometry(buffer) {
  const unpacked = unzlibSync(new Uint8Array(buffer));
  buffer = unpacked.buffer.slice(unpacked.byteOffset, unpacked.byteOffset + unpacked.byteLength);
  const data = new DataView(buffer);
  if (buffer.byteLength < 16 || data.getUint32(0, true) !== 0x524a3031 || data.getUint32(12, true) !== 1) throw new Error('Invalid rounded-road asset');
  const count = data.getUint32(4, true), groupCount = data.getUint32(8, true);
  const header = 16 + groupCount * 12;
  if (buffer.byteLength !== header + count * 32) throw new Error('Incomplete rounded-road asset');
  const geometry = new THREE.BufferGeometry();
  let offset = header;
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(buffer, offset, count * size), size));
    offset += count * size * 4;
  }
  for (let i = 0; i < groupCount; i++) {
    const start = data.getUint32(16 + i * 12, true), length = data.getUint32(20 + i * 12, true), material = data.getUint32(24 + i * 12, true);
    if (start + length > count || length % 3 || material > 4) throw new Error('Invalid rounded-road material group');
    geometry.addGroup(start, length, material);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function installRoadGeometry(city, geometry) {
  let installed = false;
  city.traverse(mesh => {
    if (!mesh.isMesh || mesh.name !== 'Roads') return;
    mesh.geometry = geometry;
    // Rounded-road v9 adds a narrow tactile guidance strip as a fifth
    // material group.  Append a named placeholder before surface materials
    // are installed so the normal-map material can be swapped in uniformly.
    const groups = geometry.groups || [];
    const maxMaterial = groups.reduce((n, g) => Math.max(n, g.materialIndex), -1);
    if (maxMaterial >= 0) {
      const current = Array.isArray(mesh.material) ? mesh.material.slice() : [mesh.material];
      while (current.length <= maxMaterial) current.push(new THREE.MeshStandardMaterial({
        name: 'City_Tactile', color: 0xe5c987, roughness: .92, metalness: 0, side: THREE.DoubleSide
      }));
      mesh.material = current;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of mats) if (/^City_(RoadLine|Curb)$/.test(material.name)) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -2;
    }
    installed = true;
  });
  if (!installed) throw new Error('City road mesh not found');
}

export function installJunctionFurniture(city, placements) {
  for (const placement of placements) {
    const mesh = city.getObjectByName(placement.name);
    if (!mesh) throw new Error('Junction furniture not found: ' + placement.name);
    mesh.position.fromArray(placement.position);
    mesh.quaternion.fromArray(placement.quaternion);
    mesh.scale.fromArray(placement.scale);
  }
  city.updateMatrixWorld(true);
}
