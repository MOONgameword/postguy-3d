from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'surfaces'
OUT.mkdir(parents=True, exist_ok=True)
N = 512
y, x = np.mgrid[:N, :N]
rng = np.random.default_rng(8271)

def normal_from_height(height, strength):
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * .5
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * .5
    n = np.dstack([-dx * strength, dy * strength, np.ones_like(height)])
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-5)
    return n

def save_pair(name, rgb, height, roughness, strength):
    Image.fromarray(np.uint8(np.clip(rgb, 0, 255)), 'RGB').save(OUT / f'{name}-base-512.webp', quality=90, method=6)
    n = normal_from_height(height, strength)
    rgba = np.dstack([n * .5 + .5, np.clip(roughness, 0, 1)])
    Image.fromarray(np.uint8(np.clip(rgba * 255, 0, 255)), 'RGBA').save(OUT / f'{name}-detail-512.webp', lossless=True, method=6)

tile_w, tile_h = 128, 72
row = y // tile_h
xx = (x + (row & 1) * (tile_w // 2)) % tile_w
yy = y % tile_h
edge = np.minimum.reduce([xx, tile_w - 1 - xx, yy, tile_h - 1 - yy]).astype(float)
joint = np.clip(edge / 3.5, 0, 1)
bevel = np.clip(edge / 8.0, 0, 1)
grain = rng.normal(0, 1.0, (N, N))
grain = (grain + np.roll(grain, 1, 0) + np.roll(grain, -1, 0) + np.roll(grain, 1, 1) + np.roll(grain, -1, 1)) / 5
stone = 166 + grain * 2.5 - (1 - joint) * 31 - (1 - bevel) * 4
save_pair('pavers', np.dstack([stone + 5, stone + 7, stone + 8]), (1 - bevel) * .8 + grain * .035, np.clip(.91 + (1 - joint) * .08, .78, 1), .78)

tile = 128
tx, ty = x % tile, y % tile
joint_t = np.minimum.reduce([tx, tile - 1 - tx, ty, tile - 1 - ty]).astype(float)
base = 211 - np.clip(3 - joint_t, 0, 3) * 15
ribs = np.zeros((N, N), dtype=np.float32)
for offset in (22, 38, 54, 70, 86, 102):
    ribs += np.exp(-((tx - offset) / 2.6) ** 2)
ribs = np.clip(ribs, 0, 1)
yellow = base + ribs * 5
save_pair('tactile', np.dstack([yellow + 23, yellow - 10, yellow - 73]), (1 - np.clip(joint_t / 6, 0, 1)) * .6 + ribs * .8, np.clip(.87 + (1 - joint_t / 128) * .05, .8, .98), .85)

for name in ('pavers', 'tactile'):
    for channel in ('base', 'detail'):
        assert Image.open(OUT / f'{name}-{channel}-512.webp').size == (512, 512)
print('updated reference sidewalk textures')
