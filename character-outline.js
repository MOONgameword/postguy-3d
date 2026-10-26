import * as T from 'three';

// A back-face hull shares the character's skeleton, so the ink follows every
// animation. Weld normals across UV seams without modifying the lit geometry.
export function addCharacterOutline(root, width = .018) {
  const sources = [];
  root.updateWorldMatrix(true, true);
  root.traverse(mesh => {
    if (mesh.isMesh && !mesh.userData.__outline && !mesh.userData.characterOutline) sources.push(mesh);
  });
  const scale = new T.Vector3();
  for (const source of sources) {
    const geometry = source.geometry.clone();
    const position = geometry.attributes.position, normal = geometry.attributes.normal;
    if (!position || !normal) { geometry.dispose(); continue; }
    const sums = new Map(), keys = [], smooth = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)].map(x => Math.round(x * 100000)).join(',');
      keys.push(key);
      if (!sums.has(key)) sums.set(key, new T.Vector3());
      sums.get(key).add(new T.Vector3().fromBufferAttribute(normal, i));
    }
    for (const n of sums.values()) n.normalize();
    for (let i = 0; i < position.count; i++) sums.get(keys[i]).toArray(smooth, i * 3);
    geometry.setAttribute('outlineNormal', new T.BufferAttribute(smooth, 3));
    source.getWorldScale(scale);
    const localWidth = width / Math.max(.00001, Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    const material = new T.MeshBasicMaterial({
      name: 'PandaCartoonInk', color: 0x000000, side: T.BackSide, toneMapped: false, fog: true,
    });
    material.onBeforeCompile = shader => {
      shader.uniforms.outlineWidth = { value: localWidth };
      shader.uniforms.outlineFarColor = { value: new T.Color(0x454b50) };
      shader.vertexShader = 'attribute vec3 outlineNormal; uniform float outlineWidth; varying float vOutlineDistance;\n' + shader.vertexShader;
      // Displace before skinning; the same bone blend deforms the outline too.
      shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>',
        'transformed += outlineNormal * outlineWidth;\n#include <skinning_vertex>');
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvOutlineDistance=max(0.,-mvPosition.z);');
      shader.fragmentShader = 'varying float vOutlineDistance; uniform vec3 outlineFarColor;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <output_fragment>',
        'float outlineDistanceMix=smoothstep(35.,260.,vOutlineDistance);\nvec3 outlineColor=mix(vec3(0.0),outlineFarColor,outlineDistanceMix);\n diffuseColor.rgb=outlineColor;\n#include <output_fragment>');
    };
    material.customProgramCacheKey = () => 'panda-cartoon-ink-v1';
    const shell = source.isSkinnedMesh ? new T.SkinnedMesh(geometry, material) : new T.Mesh(geometry, material);
    shell.name = source.name + '_CartoonOutline';
    shell.userData.__outline = true;
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.receiveShadow = false;
    source.add(shell);
    if (source.isSkinnedMesh) {
      shell.bindMode = source.bindMode;
      shell.bind(source.skeleton, source.bindMatrix);
    }
    if (source.morphTargetInfluences) shell.morphTargetInfluences = source.morphTargetInfluences;
    source.userData.characterOutline = true;
  }
  return sources.length;
}
