import * as THREE from 'three';

// All colours are authored in sRGB; Three converts them to linear light.
// The sky is an equirectangular panorama (assets/sky-cyan-original.png, 3840×1920).
// SKY_SUN is where the sun sits in that image (measured centroid); the panorama
// is spun every frame so its painted sun lines up with the DirectionalLight, and
// the light's elevation matches the painted sun's height (≈23°).
const SKY_URL = './assets/sky-cyan-original.png?v=20261023';
const SKY_SUN_U = 801 / 3840;
const SKY_SUN_ANGLE = (0.5 - 713 / 1920) * Math.PI;
const SKY_SUN_ELEVATION = 0.92 * Math.tan(SKY_SUN_ANGLE);
// On the small planet the ground horizon sits ~12° below the local horizontal.
// This panorama already has open sky and cumulus down to about -23° (its cloud
// sea starts below that), so it is used unwarped (SKY_DROP = 0). A non-zero
// SKY_DROP would pull the image's horizon down to -SKY_DROP, stretching the band
// up to the painted sun and leaving the sun and everything above it in place.
const SKY_DROP = 0;
// Where the hills actually meet the sky; the fog blend sits just above it.
const GROUND_DIP = THREE.MathUtils.degToRad(10);

export const PALETTES = {
  day: {
    fog: '#b8d9dc', light: '#fff7ea', skyFill: '#a9c6f5', ground: '#a3b48c', ambient: '#c9d6f0',
    strength: 1.3, fill: 1.4, ambientStrength: 0.5, exposure: 1.0, elevation: SKY_SUN_ELEVATION,
  },
  evening: {
    fog: '#e2c8b0', light: '#ffc98a', skyFill: '#a9b6dc', ground: '#86907a', ambient: '#d9d2e6',
    strength: 1.2, fill: 1.25, ambientStrength: 0.5, exposure: 1.0, elevation: 0.25,
  },
};

export function createAtmosphere(scene, renderer, sun, hemisphere, ambient) {
  const panorama = new THREE.TextureLoader().load(SKY_URL);
  panorama.colorSpace = THREE.SRGBColorSpace;
  panorama.wrapS = THREE.RepeatWrapping;
  panorama.wrapT = THREE.ClampToEdgeWrapping;
  panorama.generateMipmaps = false;
  panorama.minFilter = panorama.magFilter = THREE.LinearFilter;
  const uniforms = {
    panorama: { value: panorama },
    sunU: { value: SKY_SUN_U },
    sunAngle: { value: SKY_SUN_ANGLE },
    drop: { value: SKY_DROP },
    groundDip: { value: GROUND_DIP },
    fogColor: { value: new THREE.Color() },
    up: { value: new THREE.Vector3(0, 1, 0) },
    east: { value: new THREE.Vector3(1, 0, 0) }, north: { value: new THREE.Vector3(0, 0, 1) },
    sunDir: { value: new THREE.Vector3(0.65, 0.43, 0.62).normalize() },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = mat3(modelMatrix) * position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D panorama;
      uniform float sunU, sunAngle, drop, groundDip;
      uniform vec3 fogColor, up, east, north, sunDir;
      varying vec3 vDirection;
      const float INV_TAU = 0.15915494;
      const float SKY_PI = 3.14159265;
      void main() {
        vec3 d = normalize(vDirection);
        float h = clamp(dot(d, up), -1.0, 1.0);
        float a = asin(h);
        float image = a >= sunAngle ? a
          : a >= -drop ? (a + drop) / (sunAngle + drop) * sunAngle
          : (a + drop) / (0.5 * SKY_PI - drop) * 0.5 * SKY_PI;
        float azimuth = atan(dot(d, east), dot(d, north));
        float sunAzimuth = atan(dot(sunDir, east), dot(sunDir, north));
        vec2 uv = vec2(fract((azimuth - sunAzimuth) * INV_TAU + sunU), 0.5 + image / SKY_PI);
        vec3 col = texture2D(panorama, uv).rgb;
        // Blend just above the ground horizon into the scene fog so distant streets dissolve into the sky.
        col = mix(col, fogColor, (1.0 - smoothstep(-groundDip - 0.02, -groundDip + 0.07, a)) * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);

  let palette = PALETTES.day;
  let eastWeight = 0.68, northWeight = 0.62;
  const direction = new THREE.Vector3();
  const lightOffset = new THREE.Vector3();
  function orientSun(frame) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(frame);
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-6) north.copy(forward);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const desired = forward.addScaledVector(right, -0.55).normalize().multiplyScalar(0.92);
    eastWeight = desired.dot(east); northWeight = desired.dot(north);
  }
  function setTheme(theme) {
    palette = PALETTES[theme] || PALETTES.day;
    uniforms.fogColor.value.set(palette.fog);
    scene.fog.color.set(palette.fog);
    sun.color.set(palette.light);
    sun.intensity = palette.strength;
    hemisphere.color.set(palette.skyFill);
    hemisphere.groundColor.set(palette.ground);
    hemisphere.intensity = palette.fill;
    ambient.color.set(palette.ambient);
    ambient.intensity = palette.ambientStrength;
    renderer.toneMappingExposure = palette.exposure;
  }
  function update(camera, focus, up, east, north) {
    uniforms.up.value.copy(up);
    uniforms.east.value.copy(east);
    uniforms.north.value.copy(north);
    direction.copy(up).multiplyScalar(palette.elevation)
      .addScaledVector(east, eastWeight).addScaledVector(north, northWeight).normalize();
    uniforms.sunDir.value.copy(direction);
    sky.position.copy(camera.position);
    sky.scale.setScalar(camera.far * 0.82);
    lightOffset.copy(direction).multiplyScalar(380);
    sun.position.copy(focus).add(lightOffset);
    sun.target.position.copy(focus);
    // HemisphereLight also follows local gravity, including the planet's far side.
    hemisphere.position.copy(up);
  }
  setTheme('day');
  return { sky, setTheme, update, orientSun };
}

// Subtle drifting seeds: one instanced draw, no per-frame geometry allocations.
export function createDriftingSeeds(scene, count) {
  const geometry = new THREE.PlaneGeometry(0.3, 0.12);
  const material = new THREE.MeshBasicMaterial({
    color: '#f6e6bc', side: THREE.DoubleSide, transparent: true, opacity: 0.5,
    depthWrite: false, fog: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const dummy = new THREE.Object3D();
  const seeds = Array.from({ length: count }, (_, i) => ({
    x: ((i * 37.79) % 150) - 75,
    z: ((i * 57.17) % 150) - 75,
    y: 2 + ((i * 13.7) % 30), phase: i * 2.39,
  }));
  return (time, focus, up, east, north) => {
    seeds.forEach((seed, i) => {
      const x = ((seed.x + time * 1.6 + 75) % 150) - 75;
      dummy.position.copy(focus).addScaledVector(east, x)
        .addScaledVector(north, seed.z)
        .addScaledVector(up, seed.y + Math.sin(time * 0.5 + seed.phase) * 1.8);
      dummy.rotation.set(time * 0.4 + seed.phase, seed.phase, time * 0.3);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}
