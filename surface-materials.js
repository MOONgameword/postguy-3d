import * as THREE from 'three';

// One turf palette for the ground and the grass blades standing on it, so blade
// roots are exactly the colour of the soil-level turf they grow out of.
export const TURF_GLSL = `
vec3 turfColor( float tone ) {
  // deep cool green -> fresh green -> sunny yellow-green
  return tone < .5 ? mix( vec3( .08, .27, .04 ), vec3( .15, .41, .05 ), tone * 2. )
                   : mix( vec3( .15, .41, .05 ), vec3( .33, .59, .07 ), tone * 2. - 1. );
}
float turfGrainFactor( float grain ) { return .48 + 1.05 * grain; }
// World-space meadow regions shared by the lawn and the grass blades, so a
// patch of deep green or sunny yellow-green turf carries matching blades, and
// tall-grass zones line up with the darker, lusher ground under them.
float meadowHash( vec3 p ) { p = fract( p * .3183099 + .1 ); p *= 17.; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float meadowNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3. - 2. * f );
  return mix( mix( mix( meadowHash( i ), meadowHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( meadowHash( i + vec3( 0, 1, 0 ) ), meadowHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( meadowHash( i + vec3( 0, 0, 1 ) ), meadowHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( meadowHash( i + vec3( 0, 1, 1 ) ), meadowHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float meadowPatch( vec3 p ) { return smoothstep( .25, .75, meadowNoise( p / 26. ) * .65 + meadowNoise( p / 9. + 7.3 ) * .35 ); }
float meadowTall( vec3 p ) { return smoothstep( .32, .68, meadowNoise( p / 15. + vec3( 19.1, 3.7, 11.4 ) ) * .7 + meadowNoise( p / 6. + 4.1 ) * .3 ); }
float meadowTone( vec3 p, float tone ) {
  return clamp( tone * .55 + .27 + ( meadowPatch( p ) - .5 ) * .5 - ( meadowTall( p ) - .5 ) * .1, 0., 1. );
}
`;

// Terrain and asphalt have no directional pattern, so world-space triplanar
// mapping keeps them continuous around the planet. Paving uses road-following UVs.
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
        ${grass ? 'uniform sampler2D surfaceNap;' + TURF_GLSL : ''}
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
        float grassTone = meadowTone(surfacePosition, clamp(.30 + grassLight * 1.35 + rollingColor * .22, 0., 1.));
        vec3 meadowColor = turfColor(grassTone);
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
        diffuseColor.rgb *= mix(1.0, turfGrainFactor(turfGrain), meadowCover);
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
  material.customProgramCacheKey = () => `planet-surface-v6-${grass ? 'grass' : 'stone'}`;
  return material;
}

// Worn road paint. Crosswalk stripes carry uv = distance (scene units) to the
// nearest long / short edge (baked in rounded-junctions.js); other markings
// carry uv >= 100 and stay crisp. A tileable erosion mask in world space sets
// how much paint is left: the survival threshold rises toward the edges, so
// edges chip into ragged bites and a few small holes open inside the stripe.
function wornPaintMaterial(wear) {
  const material = new THREE.MeshLambertMaterial({ name: 'City_RoadLine', color: 0xf1eee6, side: THREE.DoubleSide });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.onBeforeCompile = shader => {
    shader.uniforms.paintWear = { value: wear };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 paintEdge; varying vec3 paintPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\npaintEdge = uv; paintPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 paintEdge; varying vec3 paintPosition; uniform sampler2D paintWear;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (paintEdge.x < 50.0) {
          vec3 pu = normalize(paintPosition);
          vec3 pw = pow(abs(pu), vec3(4.0)); pw /= dot(pw, vec3(1.0));
          vec3 pp = paintPosition / 3.5;
          vec2 erosion = texture2D(paintWear, pp.yz).rg * pw.x + texture2D(paintWear, pp.xz).rg * pw.y + texture2D(paintWear, pp.xy).rg * pw.z;
          float edge = min(paintEdge.x, paintEdge.y * 0.6);
          // Light wear: only ~0.28 units of the edge chips, rare pinholes inside.
          float keep = mix(0.5, 0.05, smoothstep(0.0, 0.28, edge));
          if (erosion.r < keep) discard;
          // Old paint: a little grime in the low spots, slightly greyer near the bites.
          diffuseColor.rgb *= mix(0.84, 1.0, erosion.g) * mix(0.9, 1.0, smoothstep(keep, keep + 0.12, erosion.r));
        }
      `);
  };
  material.customProgramCacheKey = () => 'road-paint-worn-v2';
  return material;
}

export async function installSurfaceMaterials(city, renderer, loadTexture) {
  const kinds = ['grass-v2', 'asphalt', 'curb-v2'];
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
  const [grass, asphalt, curb] = textures;
  // Sidewalk set from tools/build-sidewalk-v3.ps1: staggered grey stone slabs
  // and yellow guidance tiles whose bars run along the street.
  const [slab, tactile] = await Promise.all(['slab-v3', 'tactile-v3'].map(async kind => {
    const [base, detail] = await Promise.all([
      loadTexture(`./assets/surfaces/${kind}-base-512.jpg`),
      loadTexture(`./assets/surfaces/${kind}-normal-512.png`)]);
    for (const texture of [base, detail]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.colorSpace = texture === base ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
    }
    return { base, detail };
  }));
  // Baked sidewalk UVs: one u unit = 8 scene units along the street, one v unit
  // = 6 across. One slab texture (4x4 slabs) spans 10x10, i.e. 2.5-unit slabs.
  for (const texture of [slab.base, slab.detail]) texture.repeat.set(8 / 10, 6 / 10);
  const nap = await loadTexture('./assets/surfaces/grass-nap-v1-512.webp');
  nap.wrapS = nap.wrapT = THREE.RepeatWrapping;
  nap.colorSpace = THREE.NoColorSpace;
  nap.minFilter = THREE.LinearMipmapLinearFilter;
  nap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  nap.needsUpdate = true;
  const wear = await loadTexture('./assets/surfaces/paint-wear-v1-512.png');
  wear.wrapS = wear.wrapT = THREE.RepeatWrapping;
  wear.colorSpace = THREE.NoColorSpace;
  wear.minFilter = THREE.LinearMipmapLinearFilter;
  wear.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  wear.needsUpdate = true;
  const pavingMaterial = (name, textures, strength) => new THREE.MeshStandardMaterial({
    name, map: textures.base, normalMap: textures.detail,
    normalScale: new THREE.Vector2(strength, strength), color: 0xffffff,
    roughness: .92, metalness: 0, side: THREE.DoubleSide
  });
  // Kerb stones read as a pale cut-concrete band between the grey slabs and the
  // asphalt: the curb texture keeps its grain but is lifted toward warm off-white.
  const curbMaterial = textures => {
    const material = pavingMaterial('City_Curb', textures, .55);
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = mix(vec3(.80, .78, .73), vec3(1.0, .99, .96), smoothstep(.25, .55, diffuseColor.g));`);
    };
    material.customProgramCacheKey = () => 'curb-light-v1';
    return material;
  };
  const replacements = {
    City_Grass: surfaceMaterial('City_Grass', grass.base, grass.detail, { color: 0xffffff, period: 14, strength: .18, grass: true, nap }),
    City_Meadow: surfaceMaterial('City_Meadow', grass.base, grass.detail, { color: 0xffffff, period: 14, strength: .18, grass: true, nap }),
    City_Road: surfaceMaterial('City_Road', asphalt.base, asphalt.detail, { color: 0x8a8e98, period: 12, strength: .16 }),
    City_Sidewalk: pavingMaterial('City_Sidewalk', slab, .9),
    // Guidance bars, bevels and stone joints are texture/normal detail;
    // all three surfaces stay in the same batched road mesh.
    City_Tactile: pavingMaterial('City_Tactile', tactile, 1.0),
    City_Curb: curbMaterial(curb),
    City_RoadLine: wornPaintMaterial(wear)
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
