import * as T from '../vendor/three.module.js';

// Recover the authored electrical fittings from connected mesh islands.
// Coordinates are in the exported, bottom-centred pole geometry, not guessed
// from the overall height (the five source variants have different crossarms).
export function poleSockets(variant) {
  const p=variant.near.attributes.position,lookup=new Map(),parent=[],ids=[];
  const root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>n.toFixed(4)).join(',');
    if(!lookup.has(key)){const id=parent.length;lookup.set(key,id);parent.push(id);}
    ids.push(lookup.get(key));
  }
  for(let i=0;i<ids.length;i+=3){parent[root(ids[i+1])]=root(ids[i]);parent[root(ids[i+2])]=root(ids[i]);}
  const groups=new Map();
  for(let i=0;i<ids.length;i++){
    const id=root(ids[i]);if(!groups.has(id))groups.set(id,{box:new T.Box3(),vertices:[]});
    const g=groups.get(id),v=new T.Vector3().fromBufferAttribute(p,i);g.box.expandByPoint(v);g.vertices.push(v);
  }
  const islands=[...groups.values()];
  const top=g=>{
    const points=g.vertices.filter(v=>v.y>g.box.max.y-.002);
    return points.reduce((v,p)=>v.add(p),new T.Vector3()).divideScalar(points.length).toArray();
  };
  const insulators=islands.filter(g=>g.vertices.length===192&&g.box.min.y>variant.size[1]*.7);
  if(insulators.length!==4)throw Error(`Expected four crossarm sockets: ${variant.name}`);
  const terminals=insulators.map(top),extent=new T.Box3().setFromPoints(terminals.map(p=>new T.Vector3(...p))).getSize(new T.Vector3());
  const transformers=islands.filter(g=>(g.vertices.length===420||g.vertices.length===120)&&g.box.min.y>variant.size[1]*.65);
  return {axis:extent.x>extent.z?'x':'z',terminals,transformers:transformers.map(top)};
}
