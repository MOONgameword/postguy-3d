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

// Input-driven orbit, with no velocity/decay after release. Reverse keeps the
// view heading so the character can walk toward the camera.
export function walkOrbitDelta(horizontal, forward, dt) {
  return forward < -.15 || Math.abs(horizontal)<.08 ? 0 : -Math.max(-1,Math.min(1,horizontal))*1.7*dt;
}

export function installCameraDrag({stage, canvas, enabled, rotate}) {
  let pointer=null, lastX=0, lastY=0, originX=0, originY=0, dragging=false;
  function reset() {
    const old=pointer;pointer=null;dragging=false;
    if(old!==null && stage.hasPointerCapture(old)) stage.releasePointerCapture(old);
  }
  stage.addEventListener('pointerdown',event=>{
    if(pointer!==null || !enabled() || event.target!==canvas || ![0,2].includes(event.button))return;
    const bounds=stage.getBoundingClientRect();
    // The left lower region belongs to the floating movement stick.
    if(event.button===0 && event.clientX-bounds.left<=bounds.width*.52 && event.clientY-bounds.top>=bounds.height*.30)return;
    pointer=event.pointerId;lastX=originX=event.clientX;lastY=originY=event.clientY;
    stage.setPointerCapture(pointer);event.preventDefault();
  });
  stage.addEventListener('pointermove',event=>{
    if(event.pointerId!==pointer)return;
    if(!enabled()){reset();return;}
    if(!dragging && Math.hypot(event.clientX-originX,event.clientY-originY)<=12)return;
    dragging=true;
    rotate(-(event.clientX-lastX)*.005,(event.clientY-lastY)*.004);
    lastX=event.clientX;lastY=event.clientY;event.preventDefault();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,event=>{if(event.pointerId===pointer)reset();});
  window.addEventListener('blur',reset);
  document.addEventListener('visibilitychange',reset);
  return {reset,get active(){return dragging;}};
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
