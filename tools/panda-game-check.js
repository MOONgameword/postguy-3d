import {lakePoint,lakePolar,lakeMetric,isLakeWater,LAKE_WATER} from '../lakeside.js?v=20261021-norock';
export function verifyPandaGame(c){
 const {T,foot,state,boy,walker,player,PLANET,S,keys}=c,rows=[];
 const check=(name,ok,detail='')=>{rows.push({name,pass:!!ok,detail});if(!ok)console.error('Panda check:',name,detail)};
 const tick=n=>{for(let i=0;i<n;i++){c.updateCamera(1/60);c.camera.updateMatrixWorld(true);c.updateFoot(1/60);boy.mixer.update(1/60)}};
 state.speed=0;c.dismount();keys.KeyW=false;keys.ShiftLeft=false;tick(60);check('站立动画',boy.cur==='idle',boy.cur);
 const start=walker.position.clone();keys.KeyW=true;tick(30);check('走路移动与动画',walker.position.distanceTo(start)>1&&boy.cur==='walk',boy.cur);
 tick(30);check('持续向前自动奔跑',foot.autoRun&&boy.cur==='run',boy.cur);
 keys.ShiftLeft=true;tick(90);check('跑步动画',boy.cur==='run',boy.cur);keys.KeyW=false;keys.ShiftLeft=false;tick(90);
 check('松开退出自动奔跑',!foot.autoRun);
 c.updateCamera(1/60);const headingBefore=c.camera.getWorldDirection(new T.Vector3());
 keys.KeyD=true;tick(45);keys.KeyD=false;tick(60);c.updateCamera(1/60);c.camera.updateMatrixWorld(true);
 check('左右移动带动镜头转向',headingBefore.angleTo(c.camera.getWorldDirection(new T.Vector3()))>.3);
 keys.KeyS=true;tick(90);keys.KeyS=false;tick(60);
 const up=new T.Vector3(0,1,0).applyQuaternion(foot.q),facing=new T.Vector3(0,0,1).applyQuaternion(foot.q);
 const towardCamera=c.camera.position.clone().sub(walker.position);towardCamera.addScaledVector(up,-towardCamera.dot(up)).normalize();
 check('后退能看到角色正面',facing.dot(towardCamera)>.98,`dot=${facing.dot(towardCamera).toFixed(3)}`);
 c.updateCamera(1/60);const fixedCamera=c.camera.position.clone();c.updateCamera(1/60);
 check('镜头无旋转惯性',fixedCamera.distanceTo(c.camera.position)<1e-7);
 c.queueJump();tick(5);check('原生跳跃动画',foot.air&&boy.cur==='jump',boy.cur);tick(120);check('落地恢复',!foot.air&&boy.cur==='idle',boy.cur);
 const shore=lakePoint(...lakePolar(0,1.04),602),deep=lakePoint(...lakePolar(0,.35),602);
 foot.q.copy(c.frameFromDir(shore.clone().normalize(),deep.clone().sub(shore)));foot.speed=0;foot.swimming=false;foot.air=false;foot.h=0;foot.vy=0;foot.gr=undefined;foot.camOff=0;c.syncBody(walker,foot.q,0,foot,1);c.updateCamera(1);c.camera.updateMatrixWorld(true);
 keys.KeyW=true;let entered=false;for(let i=0;i<1800;i++){tick(1);if(foot.swimming){entered=true;break}}keys.KeyW=false;tick(90);
 check('从岸边连续走入湖水',entered,`q=${lakeMetric(walker.position).toFixed(3)}`);
 check('游泳动作与漂浮高度',boy.cur==='swim'&&Math.abs(walker.position.length()-(LAKE_WATER-.65*S))<.3,`${boy.cur}, radius=${walker.position.length().toFixed(2)}`);
 check('自行车仍被湖水阻挡',c.blockedAt(foot.q,c.CFG.bikeRadius));check('步行允许湖水通行',!c.blockedAt(foot.q,c.CFG.footRadius,true));
 c.turn(foot.q,Math.PI);foot.camOff=0;c.updateCamera(1);c.camera.updateMatrixWorld(true);keys.KeyW=true;let exited=false;for(let i=0;i<1200;i++){tick(1);if(!foot.swimming){exited=true;break}}keys.KeyW=false;tick(90);check('游回浅滩恢复站立',exited&&boy.cur==='idle',boy.cur);
 // Return to the parked bike and exercise the same mount/dismount paths as UI.
 foot.q.copy(state.q);foot.gr=undefined;foot.swimming=false;foot.h=0;foot.air=false;foot.speed=0;c.syncBody(walker,foot.q,0,foot,1);c.mount();check('重新骑车',state.onBike&&boy.cur==='sit',boy.cur);
 const result={result:rows.every(r=>r.pass)?'PASS':'FAIL',checks:rows};const el=document.createElement('pre');el.id='panda-check-result';el.style.cssText='position:absolute;z-index:20;left:10px;top:180px;max-width:80%;max-height:55%;overflow:auto;background:#fffef0e8;color:#234;padding:12px;font-size:12px';el.textContent=JSON.stringify(result,null,2);document.querySelector('#stage').append(el);console.info('Panda integration',result);
 if(new URLSearchParams(location.search).has('swimreview')){
  c.dismount();const p=lakePoint(...lakePolar(0,.65)),shore=lakePoint(...lakePolar(0,1.1));
  foot.q.copy(c.frameFromDir(p.clone().sub(PLANET.C).normalize(),shore.sub(p)));foot.speed=0;foot.air=false;foot.h=0;foot.swimming=true;foot.gr=undefined;foot.camOff=0;c.syncBody(walker,foot.q,0,foot,1);tick(60);el.hidden=true;
 }
 return result;
}
