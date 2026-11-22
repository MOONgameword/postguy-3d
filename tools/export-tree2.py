"""Export the evaluated authored tree, without saving changes to its Blend source."""
import bpy, json, zlib
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(r'D:\小邮差\树\树2.blend')
OUT=ROOT/'assets/trees'; OUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.hide_render]
dg=bpy.context.evaluated_depsgraph_get()
meshes=[]; palettes={}
for o in objects:
 e=o.evaluated_get(dg); mesh=bpy.data.meshes.new_from_object(e,depsgraph=dg)
 mesh.transform(o.matrix_world)
 material=o.data.materials[0]
 ramp=next(n for n in material.node_tree.nodes if n.type=='VALTORGB')
 colors=[list(x.color)[:3] for x in ramp.color_ramp.elements]
 canopy=colors[-1][1]>colors[-1][0]
 palettes['canopy' if canopy else 'bark']=colors
 meshes.append((mesh,canopy))
points=np.array([v.co[:] for m,_ in meshes for v in m.vertices]);lo=points.min(axis=0);hi=points.max(axis=0);height=hi[2]-lo[2]
base=np.array([v.co[:] for m,c in meshes if not c for v in m.vertices if v.co.z<lo[2]+height*.04]).mean(axis=0)
base[2]=lo[2]
chunks=[];offset=0;records={}
def extract(mesh,canopy):
 mesh.calc_loop_triangles();rows=[]
 for tri in mesh.loop_triangles:
  for vi,li in zip(tri.vertices,tri.loops):
   p=(np.array(mesh.vertices[vi].co[:])-base)/height;n=mesh.corner_normals[li].vector
   rows.append([p[0],p[2],-p[1],n.x,n.z,-n.y,2 if canopy else 1])
 return np.array(rows,dtype='<f4')
def record(name,parts):
 global offset
 a=np.concatenate(parts); records[name]={'start':offset,'count':len(a)};offset+=len(a);chunks.append(a)
record('near',[extract(m,c) for m,c in meshes])
record('trunk',[extract(m,c) for m,c in meshes if not c])
far=[]
for mesh,canopy in meshes:
 ob=bpy.data.objects.new('Export_LOD',mesh.copy());bpy.context.collection.objects.link(ob)
 modifier=ob.modifiers.new('Distance simplification','DECIMATE');modifier.ratio=.24 if canopy else .5
 ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh();far.append(extract(m,canopy));ev.to_mesh_clear();bpy.data.objects.remove(ob,do_unlink=True)
record('far',far)
data=np.concatenate(chunks)
(OUT/'tree2-v1.bin').write_bytes(zlib.compress(data.tobytes(),9))
report={'source':SOURCE.name,'stride':7,'ranges':records,'palettes':palettes,'height':float(height),'triangles':{k:v['count']//3 for k,v in records.items()}}
(OUT/'tree2-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
