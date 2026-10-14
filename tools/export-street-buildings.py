"""Read-only extraction from the supplied blend; no changes saved to source."""
import bpy,os,json,hashlib,math,zlib,struct
import numpy as np
from mathutils import Vector
ROOT=r'D:\GPT\postman-3d'
TEMP=r'D:\GPT\output\street-building-export'
os.makedirs(TEMP,exist_ok=True)
OUT=os.path.join(ROOT,'assets','buildings');os.makedirs(OUT,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=r'D:\GPT\twentyone_buildings\二十一栋街区建筑.blend')
names=['转角商店','烧鸟店','三层公寓','蓝招牌便利店','绿顶住宅','木构小食堂','阶梯杂货铺','五金行公寓','木屋咖啡馆','拉面店','蓝白错层办公楼','红黑露台楼','白木窄高公寓','绿百叶办公楼','玻璃顶棚错层公寓','木饰面车棚公寓','灰石窄高公寓','屋顶花架露台餐厅','屋顶花园便利店','町市食堂','蓝瓦杂货书店公寓']
materials={};tiles=[];keys={}
def srgb(x):return 12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055
def tile(mat):
 if mat.name in materials:return materials[mat.name]
 p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 links=list(p.inputs['Base Color'].links)
 node=links[0].from_node if links else None
 if node and node.type=='TEX_IMAGE':
  data=bytes(node.image.packed_file.data);key=hashlib.sha256(data).hexdigest()
  filename=key+'.png';open(os.path.join(TEMP,filename),'wb').write(data)
  desc={'image':filename}
 else:
  rgba=[round(max(0,min(1,srgb(v)))*255) for v in p.inputs['Base Color'].default_value[:3]]+[255]
  key=str(rgba);desc={'color':rgba}
 if key not in keys:keys[key]=len(tiles);tiles.append(desc)
 materials[mat.name]=keys[key];return keys[key]
for name in names:
 for ob in bpy.data.collections[name].objects:
  for m in ob.data.materials:tile(m)
CELL=264;INNER=256;ATLAS=2**math.ceil(math.log2(math.ceil(math.sqrt(len(tiles)))*CELL));COLS=ATLAS//CELL
records=[];chunks=[];offset=0;deps=bpy.context.evaluated_depsgraph_get()
for index,name in enumerate(names):
 col=bpy.data.collections[name];shift=Vector(col['场景偏移']);rows=[]
 for ob in col.objects:
  if ob.type!='MESH':continue
  obj=ob.evaluated_get(deps);mesh=obj.to_mesh();mesh.calc_loop_triangles()
  world=obj.matrix_world;normalmat=world.to_3x3().inverted().transposed();uv=mesh.uv_layers.active.data
  for tri in mesh.loop_triangles:
   t=tile(mesh.materials[tri.material_index]);x=t%COLS*CELL+4;y=t//COLS*CELL+4
   rect=[x/ATLAS,1-(y+INNER)/ATLAS,INNER/ATLAS,INNER/ATLAS]
   for vi,li in zip(tri.vertices,tri.loops):
    p=world@mesh.vertices[vi].co-shift;n=(normalmat@mesh.corner_normals[li].vector).normalized();u=uv[li].uv
    rows.append([p.x,p.z,-p.y,n.x,n.z,-n.y,u.x,u.y,*rect])
  obj.to_mesh_clear()
 a=np.array(rows,dtype='<f4');lo=a[:,:3].min(axis=0);hi=a[:,:3].max(axis=0)
 # Centre the entire footprint, including stairs and street furniture. +Z is
 # the original -Y entrance facade; origin is the bottom of the paving slab.
 center=(lo+hi)/2;center[1]=lo[1];a[:,:3]-=center
 rec={'id':index,'name':name,'start':offset,'count':len(a),'size':(hi-lo).tolist(),'front':[0,0,1]}
 records.append(rec);offset+=len(a);chunks.append(a.tobytes())
raw=b''.join(chunks);open(os.path.join(OUT,'street-buildings-v1.bin'),'wb').write(zlib.compress(raw,9))
json.dump({'stride':12,'vertices':offset,'variants':records},open(os.path.join(OUT,'street-buildings-v1.json'),'w',encoding='utf8'),ensure_ascii=False,indent=2)
json.dump({'size':ATLAS,'cell':CELL,'inner':INNER,'tiles':tiles},open(os.path.join(TEMP,'atlas.json'),'w'),indent=2)
print('EXPORTED',len(records),'buildings',offset//3,'triangles',len(tiles),'tiles','atlas',ATLAS,'raw',len(raw))
