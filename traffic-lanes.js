import * as THREE from 'three';

// One immutable network shared by every car. Distances are measured along the
// sampled spherical paths, so frame rate cannot make a car cut across a bend.
export function createTrafficLanes(data, center = new THREE.Vector3()) {
  const paths=data.paths.map(p=>{
    const points=p.points.map(v=>new THREE.Vector3().fromArray(v));
    const lengths=new Float32Array(points.length);
    for(let i=1;i<points.length;i++) lengths[i]=lengths[i-1]+points[i].distanceTo(points[i-1]);
    return {...p,points,lengths,length:lengths.at(-1)};
  });
  const up=new THREE.Vector3(),forward=new THREE.Vector3(),right=new THREE.Vector3(),matrix=new THREE.Matrix4();
  return {
    paths, lanes:paths.filter(p=>p.kind==='lane'),
    advance(cursor,distance,out={}) {
      Object.assign(out,cursor);out.distance+=distance;
      while(out.distance>=paths[out.path].length) {
        const p=paths[out.path];out.distance-=p.length;
        out.path=p.next[(out.choice+p.id)%p.next.length];out.choice++;
      }
      return out;
    },
    sample(cursor,position,quaternion) {
      const p=paths[cursor.path];let lo=0,hi=p.points.length-1;
      while(hi-lo>1) {const mid=(lo+hi)>>1;if(p.lengths[mid]>cursor.distance) hi=mid;else lo=mid;}
      const t=THREE.MathUtils.clamp((cursor.distance-p.lengths[lo])/(p.lengths[hi]-p.lengths[lo]),0,1);
      position.copy(p.points[lo]).lerp(p.points[hi],t).setLength(602);
      // Gameplay collision/raster frames use the measured planet centre, which
      // is slightly offset from the origin used by the offline city geometry.
      up.copy(position).sub(center).normalize();
      forward.copy(p.points[hi]).sub(p.points[lo]).addScaledVector(up,-forward.dot(up)).normalize();
      right.crossVectors(up,forward).normalize();
      quaternion.setFromRotationMatrix(matrix.makeBasis(right,up,forward));
      return p.kind;
    }
  };
}
