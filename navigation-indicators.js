import * as T from 'three';

// The character faces local +Z. When viewed from behind, screen right is
// forward x up (local -X), not the simulation's local +X rotation axis.
export function navigationAxes(q,up,forward,right){
  up.set(0,1,0).applyQuaternion(q);
  forward.set(0,0,1).applyQuaternion(q);
  right.crossVectors(forward,up).normalize();
}
const up=new T.Vector3(),forward=new T.Vector3(),right=new T.Vector3(),delta=new T.Vector3();
export function navigationOffset(q,from,target,out){
  navigationAxes(q,up,forward,right);delta.copy(target).sub(from);
  return out.set(delta.dot(right),-delta.dot(forward));
}
// The visible ➤ glyph points right before CSS rotation. Canvas and CSS both
// use a downward Y axis, so this angle is identical to the minimap target ray.
export function distanceArrowRotation(offset){return Math.atan2(offset.y,offset.x);}

// Sample the globe in a character-facing tangent plane instead of rotating a
// latitude crop. This stays aligned at poles and across the longitude seam.
export function renderHeadingMap(source,width,height,dest,size,radius,range,up,forward,right){
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=((x+.5)/size*2-1)*range,dy=(1-(y+.5)/size*2)*range;
    const px=up.x*radius+right.x*dx+forward.x*dy;
    const py=up.y*radius+right.y*dx+forward.y*dy;
    const pz=up.z*radius+right.z*dx+forward.z*dy;
    const length=Math.hypot(px,py,pz);
    const u=((Math.floor((Math.atan2(px,pz)/(Math.PI*2)+.5)*width)%width)+width)%width;
    const v=Math.min(height-1,Math.floor(Math.acos(T.MathUtils.clamp(py/length,-1,1))/Math.PI*height));
    const src=(v*width+u)*4,dst=(y*size+x)*4;
    dest[dst]=source[src];dest[dst+1]=source[src+1];dest[dst+2]=source[src+2];dest[dst+3]=255;
  }
}
