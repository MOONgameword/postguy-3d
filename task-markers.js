import * as T from 'three';

// Keep task beacons readable at the orbital camera distance, including portrait
// screens. The overlay depth mode also locates destinations behind the globe.
export function updateTaskMarker(marker,{overview,camera,viewportHeight,baseScale,time=0}) {
  const {ring,beam,icon}=marker.userData;
  const distance=camera.position.distanceTo(marker.position);
  const unitsPerPixel=2*distance*Math.tan(T.MathUtils.degToRad(camera.fov*.5))/Math.max(1,viewportHeight);
  marker.scale.setScalar(overview?Math.max(baseScale,unitsPerPixel*5.5):baseScale);
  icon.position.y=(overview?12:3.2)+Math.sin(time*2.2)*.22;
  icon.scale.setScalar(overview?3.5:1.6);
  beam.material.opacity=overview?.58:.14;
  for(const object of [ring,beam,icon]){
    object.renderOrder=overview?1002:0;
    const material=object.material;
    const depthTest=overview?false:object!==icon;
    if(material.depthTest!==depthTest)material.depthTest=depthTest;
    // Fog at the orbital distance otherwise washes the colours into the sky.
    if(material.fog===overview){material.fog=!overview;material.needsUpdate=true;}
    material.depthWrite=overview?false:object===ring;
  }
}
