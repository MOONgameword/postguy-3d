import * as THREE from 'three';

// World-space triplanar mapping does not depend on the FBX palette UVs or the
// rounded road mesh's empty UVs. It remains continuous around the whole planet.
function surfaceMaterial(name, base, detail, { color, period, strength, grass = false, nap = null }) {
  const material = new THREE.MeshStandardMaterial({
    name, color, roughness: 1, metalness: 0, side: THREE.DoubleSide
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      surfaceBase: { value: base }, surfaceDetail: { value: detail },
      surfaceScale: { value: 1 / period }, surfaceStrength: { value: strength }
    });
    if (grass) shader.uniforms.surfaceNap = { value: nap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 surfacePosition; varying vec3 surfaceWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nsurfacePosition = (modelMatrix * vec4(transformed, 1.0)).xyz; surfaceWorldNormal = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 surfacePosition;
        varying vec3 surfaceWorldNormal;
        uniform sampler2D surfaceBase;
        uniform sampler2D surfaceDetail;
        uniform float surfaceScale;
        uniform float surfaceStrength;
        ${grass ? 'uniform sampler2D surfaceNap;' : ''}
      `)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 surfaceUp = normalize(surfacePosition);
        vec3 surfaceWeight = pow(abs(surfaceUp), vec3(4.0));
        surfaceWeight /= dot(surfaceWeight, vec3(1.0));
        vec3 sp = surfacePosition * surfaceScale;
        vec3 surfaceAlbedo = texture2D(surfaceBase, sp.yz).rgb * surfaceWeight.x
          + texture2D(surfaceBase, sp.xz).rgb * surfaceWeight.y
          + texture2D(surfaceBase, sp.xy).rgb * surfaceWeight.z;
        ${grass ? `float grassLight = dot(surfaceAlbedo, vec3(.2126,.7152,.0722));
        float rollingColor = .5 + .13 * sin(dot(surfacePosition, vec3(.019,.027,.013)))
          + .13 * sin(dot(surfacePosition, vec3(-.037,.011,.023)));
        float grassTone = clamp(.30 + grassLight * 1.35 + rollingColor * .22, 0., 1.);
        vec3 meadowColor = mix(vec3(.09,.20,.040), vec3(.34,.52,.105), grassTone);
        float slope = dot(normalize(surfaceWorldNormal), surfaceUp);
        float meadowCover = smoothstep(.50, .84, slope);
        vec3 limestone = mix(vec3(.28,.34,.32), vec3(.48,.54,.49), grassTone);
        surfaceAlbedo = mix(limestone, meadowColor, meadowCover);` : ''}
        diffuseColor.rgb *= surfaceAlbedo;
        vec4 detailX = texture2D(surfaceDetail, sp.yz);
        vec4 detailY = texture2D(surfaceDetail, sp.xz);
        vec4 detailZ = texture2D(surfaceDetail, sp.xy);
        vec4 surfaceDetailValue = detailX * surfaceWeight.x + detailY * surfaceWeight.y + detailZ * surfaceWeight.z;
        ${grass ? `float turfGrain = texture2D(surfaceNap, sp.yz).r * surfaceWeight.x
          + texture2D(surfaceNap, sp.xz).r * surfaceWeight.y
          + texture2D(surfaceNap, sp.xy).r * surfaceWeight.z;
        diffuseColor.rgb *= mix(1.0, .48 + 1.05 * turfGrain, meadowCover);
        ` : ''}
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= clamp(surfaceDetailValue.a, .65, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 nx = detailX.xy * 2.0 - 1.0;
        vec2 ny = detailY.xy * 2.0 - 1.0;
        vec2 nz = detailZ.xy * 2.0 - 1.0;
        vec3 worldDetail = vec3(0.0, nx.x, nx.y) * surfaceWeight.x
          + vec3(ny.x, 0.0, ny.y) * surfaceWeight.y
          + vec3(nz.x, nz.y, 0.0) * surfaceWeight.z;
        worldDetail -= surfaceUp * dot(worldDetail, surfaceUp);
        normal = normalize(normal + mat3(viewMatrix) * worldDetail * surfaceStrength);
      `);
    if (grass) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Soft grazing light suggests a dense grass nap without blade meshes.
      float nap = pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 3.0);
      outgoingLight += vec3(.035,.055,.009) * nap * meadowCover;
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `planet-surface-v2-${grass ? 'grass' : 'stone'}`;
  return material;
}

export async function installSurfaceMaterials(city, renderer, loadTexture) {
  const kinds = ['grass-v2', 'asphalt', 'pavers', 'curb-v1'];
  const textures = await Promise.all(kinds.map(async kind => {
    const [base, detail] = await Promise.all(['base', 'detail'].map(channel =>
      loadTexture(`./assets/surfaces/${kind}-${channel}-512.webp`)));
    for (const texture of [base, detail]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.colorSpace = texture === base ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
    }
    return { base, detail };
  }));
  const [grass, asphalt, pavers, curb] = textures;
  const nap = await loadTexture('./assets/surfaces/grass-nap-v1-512.webp');
  nap.wrapS = nap.wrapT = THREE.RepeatWrapping;
  nap.colorSpace = THREE.NoColorSpace;
  nap.minFilter = THREE.LinearMipmapLinearFilter;
  nap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  nap.needsUpdate = true;
  const replacements = {
    City_Grass: surfaceMaterial('City_Grass', grass.base, grass.detail, { color: 0xffffff, period: 14, strength: .18, grass: true, nap }),
    City_Meadow: surfaceMaterial('City_Meadow', grass.base, grass.detail, { color: 0xffffff, period: 14, strength: .18, grass: true, nap }),
    City_Road: surfaceMaterial('City_Road', asphalt.base, asphalt.detail, { color: 0xc2c4be, period: 12, strength: .16 }),
    City_Sidewalk: surfaceMaterial('City_Sidewalk', pavers.base, pavers.detail, { color: 0xe4e1d0, period: 12, strength: .24 }),
    City_Curb: new THREE.MeshStandardMaterial({
      name: 'City_Curb', map: curb.base, normalMap: curb.detail,
      normalScale: new THREE.Vector2(.22, .22), color: 0xffffff,
      roughness: .94, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
    })
  };
  const counts = Object.fromEntries(Object.keys(replacements).map(name => [name, 0]));
  city.traverse(mesh => {
    if (!mesh.isMesh || !/^(Planet|Roads)/.test(mesh.name)) return;
    const single = !Array.isArray(mesh.material);
    const materials = (single ? [mesh.material] : mesh.material).map(old => {
      const replacement = replacements[old.name];
      if (!replacement) return old;
      counts[old.name]++;
      return replacement;
    });
    mesh.material = single ? materials[0] : materials;
  });
  return { grassAppearance: {base:grass.base,nap}, counts, textureCount: textures.length * 2 + 1, resolution: 512 };
}
