import * as T from '../vendor/three.module.js';

export function insidePolygon(p, polygon) {
  let inside=false;
  for(let i=0,k=polygon.length-1;i<polygon.length;k=i++) {
    const a=polygon[i],b=polygon[k];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

// Same gnomonic coordinates and boundaries as the generated geometry.
export function createRoadQuery(plan) {
  return (point, sidewalk=false) => {
    const u=point.clone().normalize();
    for(const c of plan.corridors) {
      const along=Math.atan2(u.dot(c.arm.direction),u.dot(c.j.up));
      if(along<c.start-1e-7||along>c.end+1e-7) continue;
      const lateral=600*u.dot(c.side)/Math.sqrt(Math.max(1e-12,1-u.dot(c.side)**2));
      if(Math.abs(lateral)<=(sidewalk?c.arm.outer:c.arm.half)+.0001) return true;
    }
    for(const j of plan.junctions) {
      const dot=u.dot(j.up);
      if(dot<.9) continue;
      const p=new T.Vector2(u.dot(j.x),u.dot(j.y)).multiplyScalar(600/dot);
      const polygon=sidewalk?(j.walkOutline ||= j.sectors.flatMap(s=>plan.sectorPath(s,s.a.outer,s.b.outer))):j.outline;
      if(insidePolygon(p,polygon)) return true;
    }
    return false;
  };
}

export function frameAt(point, forward) {
  const up=point.clone().normalize();
  const f=forward.clone().addScaledVector(up,-forward.dot(up)).normalize();
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(up,f).normalize(),up,f));
}
