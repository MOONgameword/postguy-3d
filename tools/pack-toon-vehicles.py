from pathlib import Path
import json,numpy as np,sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];TEMP=Path(r'D:\GPT\output\toon-vehicles-export')
for kind in ['cars']:
 spec=json.loads((TEMP/f'{kind}-atlas.json').read_text());size=spec['size'];cell=spec['cell'];inner=spec['inner'];pad=spec['pad'];cols=size//cell
 atlas=Image.new('RGBA',(size,size),(255,255,255,0))
 for i,t in enumerate(spec['tiles']):
  im=Image.open(TEMP/t['image']).convert('RGBA').resize((inner,inner),Image.Resampling.LANCZOS) if 'image' in t else Image.new('RGBA',(inner,inner),(255,255,255,255))
  data=np.asarray(im).astype(np.float32)/255;rgb=data[:,:,:3];rgb=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)*np.array(t['color'][:3])
  data[:,:,:3]=np.where(rgb<=.0031308,12.92*rgb,1.055*np.maximum(rgb,0)**(1/2.4)-.055)
  data[:,:,3]=(data[:,:,3]>=t['cutoff']).astype(np.float32) if t['cutoff'] else 1
  data=np.uint8(np.clip(data*255,0,255));tile=Image.fromarray(np.pad(data,((pad,pad),(pad,pad),(0,0)),mode='wrap'))
  atlas.paste(tile,(i%cols*cell,i//cols*cell))
 atlas.save(ROOT/f'assets/vehicles/{kind}-atlas-v1.png',optimize=True)
 print(kind,size,'tiles',len(spec['tiles']))
