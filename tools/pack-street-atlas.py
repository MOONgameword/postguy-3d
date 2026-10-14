import json,os
from PIL import Image
root=r'D:\GPT\output\street-building-export'
spec=json.load(open(os.path.join(root,'atlas.json')));size=spec['size'];cell=spec['cell'];inner=spec['inner'];cols=size//cell
atlas=Image.new('RGBA',(size,size),(255,255,255,255))
for i,t in enumerate(spec['tiles']):
 im=Image.open(os.path.join(root,t['image'])).convert('RGBA').resize((inner,inner),Image.Resampling.LANCZOS) if 'image' in t else Image.new('RGBA',(inner,inner),tuple(t['color']))
 x=i%cols*cell+4;y=i//cols*cell+4;atlas.paste(im,(x,y))
 # Wrap gutters keep repeating roofs / walls clean at their UV seam.
 atlas.paste(im.crop((inner-4,0,inner,inner)),(x-4,y));atlas.paste(im.crop((0,0,4,inner)),(x+inner,y))
 atlas.paste(atlas.crop((x-4,y+inner-4,x+inner+4,y+inner)),(x-4,y-4));atlas.paste(atlas.crop((x-4,y,x+inner+4,y+4)),(x-4,y+inner))
atlas.save(r'D:\GPT\postman-3d\assets\buildings\street-atlas-v1.png',optimize=True)
print('Atlas packed',size,len(spec['tiles']))
