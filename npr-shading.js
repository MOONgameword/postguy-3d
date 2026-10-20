import * as THREE from 'three';

// NPR "3D to 2D" lighting, patched into Three's shared shader chunks so every
// lit material (Lambert / Phong / Standard, including onBeforeCompile variants)
// gets the same flat cel bands without swapping materials or adding draw calls.
//
// Direct light is quantised into three tones (shade / mid / lit). A cast shadow
// does not multiply on top of that — it only caps the tone at `shade`, so a face
// that is already turned away from the sun looks identical whether or not it is
// also in a cast shadow (no doubled-dark patches, no acne stripes on back faces).
// `shade` stays well above zero so shadows read bright and airy like painted
// backgrounds instead of collapsing to the ambient term alone.
// litAt sits well below the flat-ground value (sun ≈23° → N·L ≈ 0.39): grass
// cards use the radial "up" normal, so gentle hillsides must stay in the lit band
// too or the lawn and the blades standing on it would split into two tones.
export const NPR = { shade: 0.55, mid: 0.86, midAt: 0.0, litAt: 0.12, soft: 0.05 };

const f = v => v.toFixed(4);
const DOT_NL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
const CEL_DOT_NL = 'float dotNL = nprRamp( dot( geometryNormal, directLight.direction ) );';

let installed = false;
export function installNprShading() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.common += `
float nprShadowValue = 1.0;
float nprRamp( const in float x ) {
  float tone = mix( ${f(NPR.shade)}, ${f(NPR.mid)}, smoothstep( ${f(NPR.midAt)}, ${f(NPR.midAt + NPR.soft)}, x ) );
  tone = mix( tone, 1.0, smoothstep( ${f(NPR.litAt)}, ${f(NPR.litAt + NPR.soft)}, x ) );
  // Near the terminator the shadow map is unreliable (acne), and the face is shaded by the ramp anyway.
  float shadowCap = mix( ${f(NPR.shade)}, 1.0, max( nprShadowValue, 1.0 - smoothstep( 0.04, 0.2, x ) ) );
  return min( tone, shadowCap );
}
`;
  for (const name of ['lights_lambert_pars_fragment', 'lights_phong_pars_fragment', 'lights_physical_pars_fragment']) {
    if (!C[name].includes(DOT_NL)) throw new Error(`NPR patch: ${name} changed`);
    C[name] = C[name].replace(DOT_NL, CEL_DOT_NL);
  }
  // Flat painted surfaces: no GGX sun glare on asphalt / turf / paving (it read
  // as pale washed-out patches when looking toward the sun). Phong water keeps its glint.
  const GGX = 'reflectedLight.directSpecular += irradiance * BRDF_GGX(';
  if (!C.lights_physical_pars_fragment.includes(GGX)) throw new Error('NPR patch: RE_Direct_Physical changed');
  C.lights_physical_pars_fragment = C.lights_physical_pars_fragment.replace(GGX, 'reflectedLight.directSpecular += 0.0 * irradiance * BRDF_GGX(');
  const shadowCall = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \], ([^;]*?) \) : 1\.0;/;
  if (!shadowCall.test(C.lights_fragment_begin)) throw new Error('NPR patch: lights_fragment_begin changed');
  C.lights_fragment_begin = C.lights_fragment_begin.replace(shadowCall,
    'nprShadowValue = ( directLight.visible && receiveShadow ) ? smoothstep( 0.4, 0.6, getShadow( directionalShadowMap[ i ], $1 ) ) : 1.0;');
}
