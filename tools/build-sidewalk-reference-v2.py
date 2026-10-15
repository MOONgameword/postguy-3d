from pathlib import Path
import numpy as np
from PIL import Image
OUT=Path(__file__).resolve().parent.parent/'assets'/'surfaces'; OUT.mkdir(parents=True,exist_ok=True); N=512
y,x=np.mgrid[:N,:N]; rng=np.random.default_rng(14921)
def smooth(a):
 for _ in range(3): a=(a+np.roll(a,1,0)+np.roll(a,-1,0)+np.roll(a,1,1)+np.roll(a,-1,1))/5
 return a
def save(name,rgb,height,rough=.9,strength=.8):
 rgb=np.uint8(np.clip(rgb,0,255));Image.fromarray(rgb,'RGB').save(OUT/f'{name}-base-512.webp',quality=92,method=6)
 dx=(np.roll(height,-1,1)-np.roll(height,1,1))*.5;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.5
 n=np.dstack([-dx*strength,dy*strength,np.ones_like(height)]);n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-6)
 rr=np.clip(rough+.04*(height<.18),.6,1); Image.fromarray(np.uint8(np.clip(np.dstack([n*.5+.5,rr[...,None]])*255,0,255)),'RGBA').save(OUT/f'{name}-detail-512.webp',lossless=True,method=6)
# Pavers: U follows road, staggered rectangular slabs, narrow joints.
cellx,celly=128,96; row=y//celly; xx=(x+(row&1)*64)%cellx; yy=y%celly
edge=np.minimum.reduce([xx,cellx-1-xx,yy,celly-1-yy]).astype(float); joint=np.clip(edge/3.0,0,1); bevel=np.clip(edge/9.,0,1)
noise=smooth(rng.normal(0,1,(N,N))); stone=174+noise*3-22*(1-joint)-4*(1-bevel)
save('pavers-v2',np.dstack([stone+2,stone+4,stone+5]),.18+.68*bevel+.04*noise,.91,.9)
# Tactile: longitudinal ribs (vertical image axis is across strip; x is along road).
tx,ty=x%512,y%512; seam=np.minimum.reduce([tx,511-tx,ty,511-ty]).astype(float); h=.56+.18*np.clip(seam/4,0,1)
for yy0 in (116,190,264,338,412): h-=.18*np.exp(-((ty-yy0)/3.0)**2)
noise=smooth(rng.normal(0,1,(N,N))); base=217+noise*1.3
save('tactile-v2',np.dstack([base+24,base+5,base-56]),h,.84,1.0)
# Curb: each UV tile is one long stone along U, with only end joints.
cx=x%512; edge=np.minimum(cx,511-cx).astype(float); seam=np.clip(edge/5,0,1); noise=smooth(rng.normal(0,1,(N,N))); h=.16+.72*seam+.03*noise; stone=166+noise*4-20*(1-seam)
save('curb-v2',np.dstack([stone+4,stone+6,stone+7]),h,.93,.72)
print('generated',*[p.name for p in OUT.glob('*-v2-*.webp')])
