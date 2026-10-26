import assert from 'node:assert/strict';
import {updateAutoRun,installTapJump} from '../player-controls.js';

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
installTapJump({stage,acceptsTarget:target=>target===canvas,enabled:()=>enabled,jump:()=>jumps++,now:()=>time});
function send(type,id,x=10,y=10,target=canvas){
  const event=new Event(type);
  for(const [key,value] of Object.entries({pointerId:id,clientX:x,clientY:y,button:0,target}))Object.defineProperty(event,key,{value});
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
console.log('PASS: auto-run timing/reset, tap/drag distinction, multitouch, UI exclusion, cancellation and focus loss');
