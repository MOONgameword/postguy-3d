import * as THREE from 'three';

// Cast-iron manhole covers set into the asphalt along the traffic lanes.
// One instanced draw for all covers: a flat textured disc a hair above the
// road (asphalt faces are chords of the 602 sphere, so 602.02 always clears
// them) with a polygon offset against distant z-fighting.
export const MANHOLE_TEXTURES = ['./assets/surfaces/manhole-v2-base-512.jpg', './assets/surfaces/manhole-v1-normal-512.png'];
const RADIUS = 2.3, HEIGHT = 602.02;
const SPACING = 110, END_CLEARANCE = 34;

export function createManholes(scene, lanes, [base, normal], renderer) {
  base.colorSpace = THREE.SRGBColorSpace;
  normal.colorSpace = THREE.NoColorSpace;
  for (const texture of [base, normal]) {
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
  }
  // Disc in XZ facing +Y; image top points along +Z (the lane's forward), so
  // the "下水" lettering reads upright for a rider approaching the cover.
  const geometry = new THREE.CircleGeometry(RADIUS, 48).rotateX(-Math.PI / 2).rotateY(Math.PI);
  const material = new THREE.MeshStandardMaterial({
    name: 'Manhole', map: base, normalMap: normal, normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: .72, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });

  const placements = [];
  for (const lane of lanes.lanes) {
    const usable = lane.length - 2 * END_CLEARANCE;
    if (usable < 20) continue;
    // Deterministic per-lane phase so neighbouring lanes do not line up.
    const phase = (lane.id * 37.17) % SPACING;
    for (let s = END_CLEARANCE + (phase % Math.min(SPACING, usable)); s <= lane.length - END_CLEARANCE; s += SPACING) placements.push([lane, s]);
  }
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  mesh.name = 'Manholes';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const position = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  placements.forEach(([lane, s], i) => {
    let k = 1;
    while (k < lane.points.length - 1 && lane.lengths[k] < s) k++;
    const a = lane.points[k - 1], b = lane.points[k];
    const t = THREE.MathUtils.clamp((s - lane.lengths[k - 1]) / (lane.lengths[k] - lane.lengths[k - 1]), 0, 1);
    position.copy(a).lerp(b, t);
    up.copy(position).normalize();
    position.copy(up).multiplyScalar(HEIGHT);
    forward.copy(b).sub(a).addScaledVector(up, -forward.dot(up)).normalize();
    right.crossVectors(up, forward).normalize();
    quaternion.setFromRotationMatrix(matrix.makeBasis(right, up, forward));
    mesh.setMatrixAt(i, matrix.compose(position, quaternion, one));
  });
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return { mesh, count: placements.length };
}
