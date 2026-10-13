import * as T from 'three';

// Feature edges are shaded inside the existing surface draw. No outline mesh,
// extra render pass, texture lookup, or per-frame geometry work is required.
const geometries = new WeakMap();
const materials = new WeakMap();

export function bakeObjectInk(source, angle = 32) {
  if (source.attributes.inkEdge) return source;
  if (geometries.has(source)) return geometries.get(source);
  const geometry = source.index ? source.toNonIndexed() : source;
  const p = geometry.attributes.position;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new T.Vector3());
  const quantum = Math.max(size.x, size.y, size.z, 1) * 1e-6;
  const welded = new Map(), ids = [], edges = new Map();
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const normals = [], active = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v / quantum)).join(',');
    if (!welded.has(key)) welded.set(key, welded.size);
    ids.push(welded.get(key));
  }
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    normals.push(normal.clone());
    if (normal.lengthSq() < .5) continue;
    for (let opposite = 0; opposite < 3; opposite++) {
      const u = ids[i + (opposite + 1) % 3], v = ids[i + (opposite + 2) % 3];
      const key = u < v ? u + ':' + v : v + ':' + u;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(i + opposite);
    }
  }
  const threshold = Math.cos(T.MathUtils.degToRad(angle));
  let featureEdges = 0;
  for (const entries of edges.values()) {
    // UV seams and coplanar triangulation diagonals never become ink lines.
    const crease = entries.length === 1 || entries.some(e => entries.some(other =>
      Math.abs(normals[Math.floor(e / 3)].dot(normals[Math.floor(other / 3)])) < threshold));
    if (!crease) continue;
    featureEdges++;
    for (const e of entries) active[e] = 1;
  }
  // Barycentric distance to each opposite edge. A disabled edge stays at 1
  // across the triangle, making its derivative zero. One compact attribute
  // holds both the barycentrics and the edge mask (3 bytes per vertex).
  const values = new Uint8Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    for (let vertex = 0; vertex < 3; vertex++) for (let edge = 0; edge < 3; edge++) {
      values[(i + vertex) * 3 + edge] = !active[i + edge] || vertex === edge ? 255 : 0;
    }
  }
  geometry.setAttribute('inkEdge', new T.Uint8BufferAttribute(values, 3, true));
  geometry.userData.objectInk = { featureEdges, bytes: values.byteLength };
  geometries.set(source, geometry);
  return geometry;
}

export function objectInkMaterial(source, width = 1) {
  let variants = materials.get(source);
  if (!variants) materials.set(source, variants = new Map());
  if (variants.has(width)) return variants.get(width);
  const material = source.clone();
  material.name = source.name + '_SurfaceInk';
  material.extensions = { ...source.extensions, derivatives: true };
  material.onBeforeCompile = (shader, renderer) => {
    // Preserve the existing palette, light response, fog, and tone mapping.
    source.onBeforeCompile.call(source, shader, renderer);
    shader.uniforms.objectInkWidth = { value: width };
    shader.uniforms.objectInkColor = { value: new T.Color(0x39332d) };
    shader.vertexShader = 'attribute vec3 inkEdge; varying vec3 vInkEdge;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvInkEdge = inkEdge;');
    shader.fragmentShader = 'varying vec3 vInkEdge; uniform float objectInkWidth; uniform vec3 objectInkColor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 inkDx = dFdx(vInkEdge), inkDy = dFdy(vInkEdge);
      vec3 inkSlope = sqrt(inkDx * inkDx + inkDy * inkDy);
      vec3 inkPixels = vInkEdge / max(inkSlope, vec3(0.000001));
      vec3 inkCoverage = 1.0 - smoothstep(vec3(objectInkWidth - 0.5), vec3(objectInkWidth + 0.5), inkPixels);
      // Subpixel details fade at a distance instead of turning into black
      // triangles or sparkling in the planet overview / mobile portrait view.
      inkCoverage *= 1.0 - smoothstep(vec3(0.16), vec3(0.48), inkSlope);
      float ink = max(inkCoverage.x, max(inkCoverage.y, inkCoverage.z));
      outgoingLight = mix(outgoingLight, objectInkColor, ink * 0.88);
      #include <opaque_fragment>`);
  };
  const sourceKey = source.customProgramCacheKey();
  material.customProgramCacheKey = () => sourceKey + '|surface-ink-v1';
  variants.set(width, material);
  return material;
}

export function applyObjectInk(mesh, width = 1) {
  if (!mesh.isMesh || mesh.userData.surfaceInk) return;
  mesh.geometry = bakeObjectInk(mesh.geometry);
  mesh.material = Array.isArray(mesh.material)
    ? mesh.material.map(m => objectInkMaterial(m, width))
    : objectInkMaterial(mesh.material, width);
  mesh.userData.surfaceInk = true;
}
