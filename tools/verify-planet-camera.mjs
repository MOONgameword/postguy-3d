import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { overviewDistance, updatePlanetClipping } from '../planet-camera.js';

const radius = 602, center = new T.Vector3();
function depthStep(camera, z) {
  // Worst separation represented by one integer step in a 24-bit depth buffer.
  return z * z * (camera.far - camera.near) / (camera.far * camera.near * (2 ** 24 - 1));
}
for (const [w,h] of [[1280,720],[475,740],[390,844],[844,390]]) {
  const camera = new T.PerspectiveCamera(48, w / h, .45, 5200);
  const distance = overviewDistance(radius, camera.fov, camera.aspect);
  camera.position.set(0, 0, distance);camera.lookAt(center);
  updatePlanetClipping(camera, center, radius);
  assert.ok(camera.near >= 80);
  assert.ok(camera.near < distance - radius - 120 && camera.far > distance + radius + 120);
  // A sphere's projected silhouette, plus 120 units for hills/buildings, fits.
  const projected = (radius + 120) / Math.sqrt(distance ** 2 - (radius + 120) ** 2);
  assert.ok(projected / Math.tan(camera.fov * Math.PI / 360) / Math.min(1,w/h) < 1);
  assert.ok(depthStep(camera,distance+radius) < .02, 'Road and turf depth must be distinguishable at orbit distance');
  for (let d=distance;d>radius+12;d-=30) {
    camera.position.z=d;updatePlanetClipping(camera,center,radius);
    assert.ok(camera.near < d-radius, 'Zoom transitions cannot clip terrain');
  }
  camera.position.z=radius+12;updatePlanetClipping(camera,center,radius);
  assert.equal(camera.near,.45,'Return to riding restores close-up visibility');
}
console.log('PASS: four viewport shapes, orbital depth precision and return-to-riding transitions');
