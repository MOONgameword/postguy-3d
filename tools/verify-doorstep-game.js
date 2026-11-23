import * as T from 'three';

// Explicit debug-only integration check against the real baked scene and props.
export function verifyDoorstepTasks({state,player,PLANET,collisionWorld,nextTask,framePos,frameFromDir,syncBody,updateCamera}) {
  const samples=[];
  for(let i=0;i<24;i++){
    const old=state.target.clone();
    state.q.copy(state.targetQ);state.gr=undefined;syncBody(player,state.q,0,state,1);
    state.phase=i%2?'pickup':'deliver';nextTask();
    const d=old.clone().sub(PLANET.C).angleTo(state.target.clone().sub(PLANET.C))*PLANET.R;
    if(d<40)throw new Error('Mailbox phase did not move away');
    if(state.mailboxes.length!==1||state.mailboxes[0].position.distanceTo(state.target)>.01)throw new Error('Physical mailbox and target differ');
    if(collisionWorld.explain(old.sub(PLANET.C).normalize()).includes('ActiveMailbox'))throw new Error('Stale mailbox collision');
    samples.push({phase:state.phase,distance:Math.round(d)});
  }
  // End on the street looking directly at the active doorstep for visual QA.
  const forward=new T.Vector3(0,0,1).applyQuaternion(state.targetQ);
  const right=new T.Vector3(1,0,0).applyQuaternion(state.targetQ);
  const cameraSpot=state.target.clone().addScaledVector(forward,24).addScaledVector(right,8);
  state.q.copy(frameFromDir(cameraSpot.sub(PLANET.C).normalize(),forward.clone().negate()));
  state.gr=undefined;state.speed=0;syncBody(player,state.q,0,state,1);updateCamera(1);
  console.info('Doorstep integration PASS:',JSON.stringify(samples));
}
