// Fit the decorated planet to the narrower viewport dimension, including phones.
export function overviewDistance(radius, verticalFov, aspect) {
  const halfVertical = verticalFov * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  return (radius + 120) * 1.08 / Math.sin(Math.min(halfVertical, halfHorizontal));
}

export function updatePlanetClipping(camera, center, radius) {
  const distance = camera.position.distanceTo(center);
  // Roads sit less than 0.1 units above turf. A riding near plane at orbital
  // distances cannot separate them reliably in the depth buffer. Increase it
  // only once the camera clears the buildings, also during view transitions.
  const clearance = Math.max(0, distance - radius - 120);
  const near = Math.max(.45, Math.min(150, clearance * .25));
  const far = Math.max(1800, distance + 2 * (radius + 120));
  if (Math.abs(camera.near - near) < .01 && Math.abs(camera.far - far) < 1) return;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}
