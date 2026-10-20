import * as THREE from 'three';

// All colours are authored in sRGB; Three converts them to linear light.
export const PALETTES = {
  day: {
    zenith: '#1c66dc', horizon: '#9fd0f4', lower: '#cfe6f5', fog: '#b6d9f2',
    sun: '#fffaf0', light: '#fff6e6', skyFill: '#a8ccf2', ground: '#7f9a5e', ambient: '#cfe0f7',
    cloud: '#ffffff', cloudShade: '#b9cbe6',
    strength: 3.1, fill: 1.05, exposure: 1.0, elevation: 0.5,
  },
  evening: {
    zenith: '#4f6fb8', horizon: '#f2c99e', lower: '#d8c3b0', fog: '#e2c8b0',
    sun: '#ffd28a', light: '#ffc98a', skyFill: '#a9b6dc', ground: '#86907a', ambient: '#d9d2e6',
    cloud: '#fff1dc', cloudShade: '#c4a8b8',
    strength: 2.5, fill: 1.1, exposure: 1.0, elevation: 0.25,
  },
};

export function createAtmosphere(scene, renderer, sun, hemisphere, ambient) {
  const uniforms = {
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
    lower: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
    cloudColor: { value: new THREE.Color() }, cloudShade: { value: new THREE.Color() },
    up: { value: new THREE.Vector3(0, 1, 0) },
    east: { value: new THREE.Vector3(1, 0, 0) }, north: { value: new THREE.Vector3(0, 0, 1) },
    sunDir: { value: new THREE.Vector3(0.65, 0.43, 0.62).normalize() },
    time: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = mat3(modelMatrix) * position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, lower, sunColor, cloudColor, cloudShade, up, east, north, sunDir;
      uniform float time;
      varying vec3 vDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDirection);
        float h = dot(d, up);
        vec3 col = mix(horizon, zenith, pow(smoothstep(0.0, 0.75, h), 0.55));
        col = mix(col, lower, 1.0 - smoothstep(-0.8, 0.02, h));
        float towardSun = max(0.0, dot(d, sunDir));
        col += sunColor * pow(towardSun, 24.0) * 0.12;
        if (h > -0.02) {
          vec2 uv = vec2(dot(d, east), dot(d, north)) / (h + 0.16) * 1.1;
          uv += vec2(time * 0.006, time * 0.002);
          uv += vec2(fbm(uv * 0.7 + 3.1), fbm(uv * 0.7 + 8.3)) * 0.6;
          float n = fbm(uv);
          float coverage = mix(0.52, 0.64, smoothstep(0.05, 0.7, h));
          float cloud = smoothstep(coverage, coverage + 0.045, n) * smoothstep(-0.02, 0.05, h);
          vec2 toSun = normalize(vec2(dot(sunDir, east), dot(sunDir, north)) + 1e-4);
          float base = fbm(uv + toSun * 0.1);
          float lit = clamp(0.5 + (n - base) * 5.0 + smoothstep(coverage, coverage + 0.25, n) * 0.45, 0.0, 1.0);
          vec3 cc = mix(cloudShade, cloudColor, smoothstep(0.25, 0.6, lit));
          cc += sunColor * pow(towardSun, 8.0) * 0.15;
          col = mix(col, cc, cloud);
        }
        float disk = smoothstep(cos(0.035), cos(0.031), towardSun);
        col = mix(col, sunColor * 1.35, disk);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
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
    for (const name of ['zenith', 'horizon', 'lower']) uniforms[name].value.set(palette[name]);
    uniforms.sunColor.value.set(palette.sun);
    uniforms.cloudColor.value.set(palette.cloud);
    uniforms.cloudShade.value.set(palette.cloudShade);
    scene.fog.color.set(palette.fog);
    sun.color.set(palette.light);
    sun.intensity = palette.strength;
    hemisphere.color.set(palette.skyFill);
    hemisphere.groundColor.set(palette.ground);
    hemisphere.intensity = palette.fill;
    ambient.color.set(palette.ambient);
    renderer.toneMappingExposure = palette.exposure;
  }
  function update(camera, focus, up, east, north) {
    uniforms.up.value.copy(up);
    uniforms.east.value.copy(east);
    uniforms.north.value.copy(north);
    uniforms.time.value = performance.now() / 1000;
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
