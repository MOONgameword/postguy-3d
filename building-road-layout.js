// Apply the offline, deterministic roadside layout without touching building
// geometry or materials. Keeping this as transforms makes it cheap to load and
// keeps collision footprints in sync when the city is baked at runtime.
export function installBuildingRoadLayout(city, placements) {
  let applied = 0;
  for (const p of placements || []) {
    const mesh = city.getObjectByName(p.name);
    if (!mesh) continue;
    if (p.position) mesh.position.fromArray(p.position);
    if (p.quaternion) mesh.quaternion.fromArray(p.quaternion);
    if (p.scale) mesh.scale.fromArray(p.scale);
    applied++;
  }
  city.updateMatrixWorld(true);
  return { applied, total: placements?.length || 0 };
}
