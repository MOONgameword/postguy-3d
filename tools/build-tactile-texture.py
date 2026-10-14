from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'surfaces'
OUT.mkdir(parents=True, exist_ok=True)
N = 512
y, x = np.mgrid[:N, :N]

# Warm guidance paving: a subtle 4-by-4 tile rhythm with a repeated raised
# bar/dot relief.  The relief is encoded in the normal map, not geometry.
tile = 128
xx = x % tile
yy = y % tile
joint = np.minimum.reduce([xx, tile - 1 - xx, yy, tile - 1 - yy]).astype(float)
base = 222 - np.clip(3.0 - joint, 0, 3) * 12
grain = (np.sin(x * .13) + np.sin(y * .17)) * 1.5
rgb = np.dstack([base + grain + 10, base + grain - 2, base + grain - 28])
Image.fromarray(np.uint8(np.clip(rgb, 0, 255)), 'RGB').save(OUT / 'tactile-base-512.webp', quality=88, method=6)

# Raised directional bars crossing each tile.  Encode height to tangent-space
# normal RGB and use alpha for roughness, matching the other surface assets.
bar = np.zeros((N, N), dtype=np.float32)
for offset in (32, 96):
    bar += np.exp(-((xx - offset) / 5.0) ** 2)
bar = np.clip(bar, 0, 1)
dx = (np.roll(bar, -1, axis=1) - np.roll(bar, 1, axis=1)) * .5
dy = (np.roll(bar, -1, axis=0) - np.roll(bar, 1, axis=0)) * .5
normal = np.dstack([-dx * .9, dy * .9, np.ones_like(bar)])
normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-5)
rgba = np.dstack([normal * .5 + .5, np.full((N, N), .93)])
Image.fromarray(np.uint8(np.clip(rgba * 255, 0, 255)), 'RGBA').save(OUT / 'tactile-detail-512.webp', lossless=True, method=6)

for name in ('tactile-base-512.webp', 'tactile-detail-512.webp'):
    assert Image.open(OUT / name).size == (512, 512)
print('generated', OUT / 'tactile-base-512.webp', OUT / 'tactile-detail-512.webp')
