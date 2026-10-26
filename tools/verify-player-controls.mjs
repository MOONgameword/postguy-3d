import assert from 'node:assert/strict';
import {updateAutoRun,installTapJump,walkOrbitDelta,installCameraDrag} from '../player-controls.js';

const control={};
for(let i=0;i<47;i++) updateAutoRun(control,1/60,1,true);
assert.equal(control.autoRun,false,'Brief forward input remains walking');
for(let i=0;i<3;i++) updateAutoRun(control,1/60,1,true);
assert.equal(control.autoRun,true,'Sustained forward movement engages sprint');
updateAutoRun(control,.1,0,true);
assert.equal(control.autoRun,true,'Steering sideways preserves sprint while moving');
updateAutoRun(control,.1,0,false);
assert.equal(control.autoRun,false,'Releasing movement exits sprint');
updateAutoRun(control,1,1,true);updateAutoRun(control,.1,-1,true);
assert.equal(control.autoRun,false,'Reverse exits sprint');
updateAutoRun(control,1,1,true);updateAutoRun(control,.1,1,true,true);
assert.equal(control.autoRun,false,'Swimming resets sprint');

globalThis.window=new EventTarget();globalThis.document=new EventTarget();
const stage=new EventTarget(),canvas={},button={};let time=0,jumps=0,enabled=true;
stage.getBoundingClientRect=()=>({left:0,top:0,width:390,height:844});
let captured=null;stage.setPointerCapture=id=>captured=id;stage.hasPointerCapture=id=>captured===id;stage.releasePointerCapture=()=>captured=null;
installTapJump({stage,acceptsTarget:target=>target===canvas,enabled:()=>enabled,jump:()=>jumps++,now:()=>time});
function send(type,id,x=10,y=10,target=canvas,mouseButton=0){
  const event=new Event(type);
  for(const [key,value] of Object.entries({pointerId:id,clientX:x,clientY:y,button:mouseButton,target}))Object.defineProperty(event,key,{value});
  stage.dispatchEvent(event);
}
send('pointerdown',1);time+=100;send('pointerup',1);assert.equal(jumps,1);
send('pointerdown',2);send('pointermove',2,100,100);send('pointermove',2);send('pointerup',2);
assert.equal(jumps,1,'Drag returning to origin must not jump');
send('pointerdown',3);time+=400;send('pointerup',3);assert.equal(jumps,1,'Hold is not a tap');
send('pointerdown',4,10,10,button);send('pointerup',4);assert.equal(jumps,1,'UI cannot jump');
send('pointerdown',5);send('pointermove',5,10,100);
send('pointerdown',6,300,400);time+=80;send('pointerup',6,300,400);send('pointerup',5,10,100);
assert.equal(jumps,2,'Second finger jumps while movement finger drags');
for(const type of ['pointercancel','lostpointercapture']){send('pointerdown',7);send(type,7);send('pointerup',7);}
assert.equal(jumps,2,'Cancelled pointers never jump');
send('pointerdown',8);enabled=false;send('pointerup',8);assert.equal(jumps,2);
enabled=true;send('pointerdown',9);window.dispatchEvent(new Event('blur'));send('pointerup',9);assert.equal(jumps,2);
assert.ok(walkOrbitDelta(1,1,1/60)<0,'Right movement rotates view right');
assert.ok(walkOrbitDelta(-1,0,1/60)>0,'Left movement rotates view left');
assert.equal(walkOrbitDelta(0,1,1/60),0,'Forward keeps heading');
assert.equal(walkOrbitDelta(1,-1,1/60),0,'Reverse diagonal preserves front view');
assert.equal(walkOrbitDelta(0,0,1/60),0,'No rotation after input release');
let yaw=0,pitch=0;
const drag=installCameraDrag({stage,canvas,enabled:()=>enabled,rotate:(x,y)=>{yaw+=x;pitch+=y;}});
send('pointerdown',10,50,600);send('pointermove',10,100,600);assert.equal(yaw,0,'Left joystick cannot drag camera');send('pointerup',10,100,600);
send('pointerdown',11,300,400);send('pointermove',11,305,405);assert.equal(yaw,0,'Tap jitter cannot orbit');
send('pointermove',11,350,450);assert.ok(yaw<0&&pitch>0);assert.equal(drag.active,true);
const beforeRelease=yaw;send('pointerup',11,350,450);send('pointermove',11,380,450);assert.equal(yaw,beforeRelease,'Release stops rotation immediately');assert.equal(drag.active,false);
send('pointerdown',12,300,400,button);send('pointermove',12,350,450);assert.equal(yaw,beforeRelease,'UI does not orbit');
send('pointerdown',13,300,400);send('pointercancel',13);send('pointermove',13,350,450);assert.equal(yaw,beforeRelease);
send('pointerdown',14,50,600,canvas,2);send('pointermove',14,100,600);assert.ok(yaw<beforeRelease,'Right mouse drags from either side');send('pointerup',14,100,600);
console.log('PASS: auto-run timing/reset, tap/drag distinction, multitouch, UI exclusion, cancellation and focus loss');
console.log('PASS: input-driven orbit, reverse/front view, drag ownership, no inertia and right mouse');
