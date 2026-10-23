"""Read-only extraction of the user's asset library; shared atlas + two LODs."""
import bpy,json,math,zlib,hashlib
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(r'D:\小邮差\日系建筑资源\Idyllic Anime Japan_提取\Idyllic_Anime_Japan_资产合集.blend')
OUT=ROOT/'assets/japan';OUT.mkdir(exist_ok=True)
TEMP=Path(r'D:\GPT\output\japan-game-export');TEMP.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
report=json.loads((SOURCE.parent/'conversion_report.json').read_text(encoding='utf-8'))
names=sorted(Path(r['file']).stem for r in report['imported'] if '\\buildings\\' in r['file'])
trees=sorted(o.name for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('SM_tree_'))

def describe(m):
 if not m:return {'color':[.65,.65,.65,1],'uv':[1,1,0,0],'cutoff':0}
 bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 color=list(bs.inputs['Base Color'].default_value);node=bs.inputs['Base Color'].links[0].from_node if bs.inputs['Base Color'].links else None
 if node and node.type=='MIX_RGB':
  color=list(node.inputs[2].default_value);node=node.inputs[1].links[0].from_node if node.inputs[1].links else None
 desc={'color':color,'uv':[1,1,0,0],'cutoff':0}
 if node and node.type=='TEX_IMAGE' and node.image:
  im=node.image;data=bytes(im.packed_file.data) if im.packed_file else Path(bpy.path.abspath(im.filepath)).read_bytes()
  file=hashlib.sha256(data).hexdigest()+'.png';(TEMP/file).write_bytes(data);desc['image']=file
  if node.inputs['Vector'].links:
   mapping=node.inputs['Vector'].links[0].from_node
   if mapping.type=='MAPPING':
    desc['uv']=[*mapping.inputs['Scale'].default_value[:2],*mapping.inputs['Location'].default_value[:2]]
 if bs.inputs['Alpha'].links:
  alpha=bs.inputs['Alpha'].links[0].from_node
  desc['cutoff']=alpha.inputs[1].default_value if alpha.type=='MATH' and alpha.operation=='GREATER_THAN' else .3
 return desc

for kind,selected in [('buildings',names),('trees',trees)]:
 mats={};tiles=[];keys={}
 for name in selected:
  for m in bpy.data.objects[name].data.materials:
   key=m.name if m else 'NULL'
   if key in mats:continue
   desc=describe(m);uv=desc.pop('uv');signature=json.dumps(desc,sort_keys=True)
   if signature not in keys:keys[signature]=len(tiles);tiles.append(desc)
   mats[key]=(keys[signature],uv)
 inner=256 if kind=='buildings' else 512;pad=8;cell=inner+2*pad
 size=2**math.ceil(math.log2(math.ceil(math.sqrt(len(tiles)))*cell));cols=size//cell
 while cols*cols<len(tiles):size*=2;cols=size//cell
 chunks=[];records=[];offset=0
 def extract(obj,center=None):
  obj.data.calc_loop_triangles();mesh=obj.data
  world=obj.matrix_world;normalmat=world.to_3x3().inverted().transposed();uv=mesh.uv_layers.active.data
  rows=[];bark=[]
  for tri in mesh.loop_triangles:
   m=mesh.materials[tri.material_index];tile,transform=mats[m.name if m else 'NULL'];sx,sy,ox,oy=transform
   x=tile%cols*cell+pad;y=tile//cols*cell+pad
   rect=[x/size,1-(y+inner)/size,inner/size,inner/size]
   for vi,li in zip(tri.vertices,tri.loops):
    p=world@mesh.vertices[vi].co;n=(normalmat@mesh.corner_normals[li].vector).normalized();u=uv[li].uv
    rows.append([p.x,p.z,-p.y,n.x,n.z,-n.y,u.x*sx+ox,u.y*sy+oy,*rect])
    bark.append(bool(m and 'tree_base' in m.name))
  a=np.array(rows,dtype='<f4');lo=a[:,:3].min(axis=0);hi=a[:,:3].max(axis=0)
  if center is None:
   center=(lo+hi)/2;center[1]=lo[1]
   if kind=='trees':
    base=a[a[:,1]<lo[1]+.08*(hi[1]-lo[1]),:3];center[0]=base[:,0].mean();center[2]=base[:,2].mean()
  a[:,:3]-=center
  return a,center,(hi-lo).tolist(),np.array(bark)
 def store(a):
  global offset
  rec={'start':offset,'count':len(a)};offset+=len(a);chunks.append(a.tobytes());return rec
 for index,name in enumerate(selected):
  source=bpy.data.objects[name];original=sum(len(p.vertices)-2 for p in source.data.polygons)
  a,center,dimensions,bark=extract(source)
  record={'id':index,'name':name,'size':dimensions,'front':[0,0,1],'sourceTriangles':original}
  # Preserve a collision-only copy from source bark, never from leaf cards.
  if kind=='trees':record['trunk']=store(a[bark])
  for lod,target in [('near',12000 if kind=='buildings' else 4000),('far',2300 if kind=='buildings' else 1250)]:
   # Aggressive collapse destroys the disconnected thin facade panels in this
   # kit. Buildings share the verified near mesh at distance; trees retain LOD.
   if lod=='far' and kind=='buildings':
    record[lod]=record['near'];continue
   if original<=target:geo=a
   else:
    clone=source.copy();clone.data=source.data.copy();bpy.context.scene.collection.objects.link(clone)
    bpy.context.view_layer.objects.active=clone
    modifier=clone.modifiers.new('Web LOD','DECIMATE');modifier.ratio=target/original;modifier.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    geo,_,_,_=extract(clone,center)
    bpy.data.objects.remove(clone,do_unlink=True)
   record[lod]=store(geo)
  records.append(record);print(kind,name,original,record['near']['count']//3,record['far']['count']//3,flush=True)
 raw=b''.join(chunks);(OUT/f'{kind}-v1.bin').write_bytes(zlib.compress(raw,9))
 (OUT/f'{kind}-v1.json').write_text(json.dumps({'stride':12,'source':SOURCE.name,'variants':records},indent=2),encoding='utf8')
 (TEMP/f'{kind}-atlas.json').write_text(json.dumps({'size':size,'cell':cell,'inner':inner,'pad':pad,'tiles':tiles},indent=2))
 print('EXPORTED',kind,len(records),'tiles',len(tiles),'atlas',size,'bytes',len(raw),flush=True)
