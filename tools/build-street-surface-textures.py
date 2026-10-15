from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'surfaces'
OUT.mkdir(parents=True, exist_ok=True)
N = 512
rng = np.random.default_rng(8417)
y, x = np.mgrid[:N, :N]

def normal_from_height(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * .5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * .5
    n = np.dstack([-dx * strength, dy * strength, np.ones_like(height)])
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    return n

def save_pair(name, rgb, height, rough=.92, strength=.7):
    Image.fromarray(np.uint8(np.clip(rgb, 0, 255)), 'RGB').save(OUT / f'{name}-base-512.webp', quality=90, method=6)
    n = normal_from_height(height, strength)
    rgba = np.dstack([n * .5 + .5, np.full((N, N), rough)])
    Image.fromarray(np.uint8(np.clip(rgba * 255, 0, 255)), 'RGBA').save(OUT / f'{name}-detail-512.webp', lossless=True, method=6)

# Cool gray rectangular paving, with narrow dark joints and soft edge bevels.
tile_w, tile_h = 128, 64
xx, yy = x % tile_w, y % tile_h
edge = np.minimum.reduce([xx, tile_w - 1 - xx, yy, tile_h - 1 - yy]).astype(float)
joint = np.clip(edge / 2.2, 0, 1)
bevel = np.clip(edge / 7.0, 0, 1)
row = y // tile_h
col = ((x + (row % 2) * tile_w // 2) // tile_w) % 4
variation = rng.uniform(-4.0, 4.0, (8, 4))[row % 8, col]
grain = (np.sin(x * .071) + np.sin(y * .109)) * 1.0
v = 164 + variation + grain - (1 - joint) * 22 - (1 - bevel) * 5
save_pair('pavers', np.dstack([v + 2, v + 3, v + 1]), (1 - bevel) * .5 + (1 - joint) * .16, .91, .72)

# Light segmented granite curb: subtle joints, rounded/beveled edges, and
# enough contrast to read against the paving without a dark stripe.
seg_w, seg_h = 96, 64
cx, cy = x % seg_w, y % seg_h
cedge = np.minimum.reduce([cx, seg_w - 1 - cx, cy, seg_h - 1 - cy]).astype(float)
cjoint = np.clip(cedge / 2.0, 0, 1)
cbevel = np.clip(cedge / 8.0, 0, 1)
stone = 193 + (np.sin(x * .045) + np.sin(y * .083)) * 2.0 - (1 - cjoint) * 25 - (1 - cbevel) * 4
save_pair('curb-v1', np.dstack([stone + 1, stone + 2, stone]), (1 - cbevel) * .42 + (1 - cjoint) * .18, .89, .62)

# Warm yellow guidance strip. Parallel raised ribs run along the long direction;
# cross joints remain shallow so the strip reads as tactile paving tiles.
tile = 128
tx, ty = x % tile, y % tile
joint = np.minimum.reduce([tx, tile - 1 - tx, ty, tile - 1 - ty]).astype(float)
tj = np.clip(joint / 2.0, 0, 1)
rib = np.zeros((N, N), dtype=np.float32)
for off in (30, 55, 80, 105):
    rib += np.exp(-((tx - off) / 3.0) ** 2)
rib = np.clip(rib, 0, 1)
seam = np.exp(-((ty - 127.0) / 1.8) ** 2)
base = 212 + rib * 7 - (1 - tj) * 19 - seam * 18
save_pair('tactile', np.dstack([base + 17, base - 2, base - 35]), rib * .95 + seam * .25, .9, 1.25)

for name in ('pavers', 'curb-v1', 'tactile'):
    for channel in ('base', 'detail'):
        assert Image.open(OUT / f'{name}-{channel}-512.webp').size == (512, 512)
print('rebuilt pavers, curb-v1 and tactile at 512x512')
