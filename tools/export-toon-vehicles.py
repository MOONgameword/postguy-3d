"""Export the 24 authored collection instances, including wheels and attachments.
Read-only: the user blend remains untouched. +Z is forward, Y is up.
"""
import bpy,json,math,zlib,hashlib,re
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(r'D:\小邮差\日系建筑资源\Toon Vehicles v1.4_提取\car 合集.blend')
OUT=ROOT/'assets/vehicles';OUT.mkdir(exist_ok=True)
TEMP=Path(r'D:\GPT\output\toon-vehicles-export');TEMP.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
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


instances={o.name:[] for o in bpy.context.scene.objects if o.instance_collection}
dg=bpy.context.evaluated_depsgraph_get()
for instance in dg.object_instances:
 if instance.is_instance and instance.object.type=='MESH':
  if instance.parent.name not in instances:raise RuntimeError('Unexpected nested instance')
  instances[instance.parent.name].append((instance.object.original,instance.matrix_world.copy()))
assert len(instances)==24
mats={};tiles=[];keys={}
for parts in instances.values():
 for obj,_ in parts:
  for m in obj.data.materials:
   key=m.name if m else 'NULL'
   if key in mats:continue
   desc=describe(m);uv=desc.pop('uv');signature=json.dumps(desc,sort_keys=True)
   if signature not in keys:keys[signature]=len(tiles);tiles.append(desc)
   mats[key]=(keys[signature],uv)
inner=512;pad=8;cell=inner+2*pad;size=4096;cols=size//cell
assert cols*cols>=len(tiles)
chunks=[];records=[];offset=0
for name,parts in instances.items():
 rows=[];partnames=[];front=[];rear=[]
 for obj,world in parts:
  mesh=obj.data;mesh.calc_loop_triangles();normalmat=world.to_3x3().inverted().transposed()
  uv=mesh.uv_layers.active.data if mesh.uv_layers.active else None
  partnames.append(obj.name)
  if obj.name.startswith('Wheel_'):
   (front if '_F.' in obj.name else rear).append([world.translation.x,world.translation.z,-world.translation.y])
  for tri in mesh.loop_triangles:
   m=mesh.materials[tri.material_index];tile,transform=mats[m.name if m else 'NULL'];sx,sy,ox,oy=transform
   x=tile%cols*cell+pad;y=tile//cols*cell+pad;rect=[x/size,1-(y+inner)/size,inner/size,inner/size]
   for vi,li in zip(tri.vertices,tri.loops):
    p=world@mesh.vertices[vi].co;n=(normalmat@mesh.corner_normals[li].vector).normalized();u=uv[li].uv if uv else (0,0)
    rows.append([p.x,p.z,-p.y,n.x,n.z,-n.y,u[0]*sx+ox,u[1]*sy+oy,*rect])
 a=np.array(rows,dtype='<f4');lo=a[:,:3].min(axis=0);hi=a[:,:3].max(axis=0);center=(lo+hi)/2;center[1]=lo[1];a[:,:3]-=center
 assert front and rear, name
 if np.mean(front,axis=0)[2]<np.mean(rear,axis=0)[2]:
  a[:,[0,2,3,5]]*=-1
 # Keep normal cars at the existing scale; reduce long trucks proportionally
 # so all source variants fit the verified 8 x 17 vehicle movement envelope.
 dimensions=hi-lo;factor=min(2.25,7.8/dimensions[0],16.5/dimensions[2]);a[:,:3]*=factor
 body=next((o.name for o,_ in parts if re.fullmatch(r'Car_\d+[A-Z]',o.name) and o.parent is None),name)
 rec={'id':len(records),'name':body,'sourceInstance':name,'parts':partnames,'size':(dimensions*factor).tolist(),'scale':float(factor),'front':[0,0,1],'sourceTriangles':len(a)//3,'near':{'start':offset,'count':len(a)},'far':{'start':offset,'count':len(a)}}
 offset+=len(a);chunks.append(a.tobytes());records.append(rec);print(body,len(parts),len(a)//3,rec['size'],flush=True)
(OUT/'cars-v1.bin').write_bytes(zlib.compress(b''.join(chunks),9))
(OUT/'cars-v1.json').write_text(json.dumps({'stride':12,'source':SOURCE.name,'variants':records},ensure_ascii=False,indent=2),encoding='utf8')
(TEMP/'cars-atlas.json').write_text(json.dumps({'size':size,'cell':cell,'inner':inner,'pad':pad,'tiles':tiles},indent=2))
print('EXPORTED',len(records),'vehicles',len(tiles),'materials',sum(v['sourceTriangles'] for v in records),'triangles')
