// Forward hold engages sprint until input is released or reversed.
export function updateAutoRun(control, dt, forward, moving, swimming = false) {
  if (!moving || forward < -.15 || swimming) {
    control.forwardTime = 0;
    control.autoRun = false;
  } else if (!control.autoRun) {
    control.forwardTime = forward >= .65 ? (control.forwardTime || 0) + dt : 0;
    control.autoRun = control.forwardTime >= .8;
  }
  return control.autoRun;
}

// Track each finger separately so a second-finger tap can jump while steering.
export function installTapJump({stage, acceptsTarget, enabled, jump, now = () => performance.now()}) {
  const pointers = new Map();
  const clear = () => pointers.clear();
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !enabled() || !acceptsTarget(event.target)) return;
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY, time:now(), moved:false});
  }, true);
  stage.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (pointer && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12) pointer.moved=true;
  }, true);
  stage.addEventListener('pointerup', event => {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointer && !pointer.moved && now()-pointer.time<=250 &&
        Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<=12 && enabled()) jump();
  }, true);
  for (const type of ['pointercancel','lostpointercapture']) {
    stage.addEventListener(type, event => pointers.delete(event.pointerId), true);
  }
  window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);
  return {reset:clear};
}
