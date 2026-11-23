import * as T from 'three';

// The imported buildings are authored with their entrance facade facing +Z.
// Use the ground-floor frontage (not roof overhangs) and keep a clear approach.
export function collectDeliverySites(city,{center=new T.Vector3(),project,accept}) {
  city.updateMatrixWorld(true);const sites=[];
  city.traverse(building=>{
    if(!building.isMesh||!/^Bld_Japan_/.test(building.name))return;
    const geometry=building.userData.collisionGeometry||building.geometry;
    geometry.computeBoundingBox();const box=geometry.boundingBox;
    const scale=building.getWorldScale(new T.Vector3()).x,p=geometry.attributes.position;
    let front=-Infinity,minX=Infinity,maxX=-Infinity;
    for(let i=0;i<p.count;i++)if((p.getY(i)-box.min.y)*scale<=5.4){
      front=Math.max(front,p.getZ(i));minX=Math.min(minX,p.getX(i));maxX=Math.max(maxX,p.getX(i));
    }
    const forward=new T.Vector3(0,0,1).transformDirection(building.matrixWorld);
    for(const side of [0,-2.5,2.5,-5,5]){
      if(Math.abs(side)>(maxX-minX)*scale*.25)continue;
      let accepted=null;
      for(const gap of [3,4.5,6,7.5]){
        const base=new T.Vector3((minX+maxX)*.5+side/scale,box.min.y,front).applyMatrix4(building.matrixWorld);
        const position=project(base.clone().addScaledVector(forward,gap));
        const up=position.clone().sub(center).normalize();
        const facing=forward.clone().projectOnPlane(up).normalize(),right=new T.Vector3().crossVectors(up,facing).normalize();
        const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right,up,facing));
        const site={id:building.name,position,q,frontage:base,gap};
        if(accept(site,facing,project)){accepted=site;break;}
      }
      if(accepted){sites.push(accepted);break;}
    }
  });
  return sites;
}

// Rotate distance bands, then choose randomly within the band. Recent building
// IDs are excluded across both phases, so deliveries cannot bounce between two doors.
export function createDeliveryPicker(sites,{distance,random=Math.random,available=()=>true}={}) {
  const recent=[];let lastDistance=null,lastBand=-1;
  return {
    next(origin){
      let choices=sites.filter(s=>available(s)).map(site=>({site,d:distance(origin,site.position)}));
      if(!choices.length)throw new Error('没有可到达的建筑门前邮箱位置');
      let fresh=choices.filter(x=>!recent.includes(x.site.id)&&x.d>=100);
      if(!fresh.length)fresh=choices.filter(x=>x.site.id!==recent.at(-1)&&x.d>=40);
      if(!fresh.length)fresh=choices.filter(x=>x.site.id!==recent.at(-1));
      if(!fresh.length)throw new Error('需要至少两个可到达的建筑门前位置');
      const varied=fresh.filter(x=>lastDistance===null||Math.abs(x.d-lastDistance)>=45);
      if(varied.length)fresh=varied;
      const bands=[[100,250],[250,450],[450,750],[750,1100]];
      let buckets=bands.map(([min,max],i)=>({i,items:fresh.filter(x=>x.d>=min&&x.d<max)})).filter(b=>b.items.length);
      const other=buckets.filter(b=>b.i!==lastBand);if(other.length)buckets=other;
      const bucket=buckets.length?buckets[Math.floor(random()*buckets.length)]:{i:-1,items:fresh};
      const chosen=bucket.items[Math.floor(random()*bucket.items.length)];
      lastBand=bucket.i;lastDistance=chosen.d;recent.push(chosen.site.id);if(recent.length>Math.min(12,sites.length-1))recent.shift();
      return {...chosen.site,distance:chosen.d};
    }
  };
}
