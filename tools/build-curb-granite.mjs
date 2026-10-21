// Tileable light-grey granite for kerb stones (512x512 sRGB PNG, no deps).
// One tile covers 2.5 scene units (projected in world space by the curb shader).
// Usage: node tools/build-curb-granite.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const N = 512;
let seed = 7654321;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function layer(period) {
  const g = Float32Array.from({ length: period * period }, rnd);
  return (x, y) => {
    const fx = x / N * period, fy = y / N * period;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i, j) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}
const cloud = [8, 16, 32, 64].map(layer);
const v = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let c = 0, a = .5; for (const l of cloud) { c += (l(x, y) - .5) * a; a *= .5; }
  v[y * N + x] = .80 + c * .10 + (rnd() - .5) * .05;
}
// Mineral speckles: many small dark grains, fewer bright quartz flecks. Wrapped so the tile repeats.
function dots(count, rMin, rMax, lo, hi) {
  for (let n = 0; n < count; n++) {
    const cx = rnd() * N, cy = rnd() * N, r = rMin + rnd() * (rMax - rMin), value = lo + rnd() * (hi - lo);
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy), cover = Math.min(1, Math.max(0, r + .5 - d));
      if (cover <= 0) continue;
      const i = ((y % N + N) % N) * N + ((x % N + N) % N);
      v[i] += (value - v[i]) * cover;
    }
  }
}
dots(14000, .6, 1.6, .50, .66);
dots(2500, 1.2, 2.6, .58, .70);
dots(6000, .5, 1.3, .92, .98);

const raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const g = Math.round(Math.min(1, Math.max(0, v[y * N + x])) * 255), o = y * (N * 3 + 1) + 1 + x * 3;
    raw[o] = g; raw[o + 1] = g; raw[o + 2] = Math.min(255, g + 3);
  }
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(new URL('../assets/surfaces/curb-granite-v1-512.png', import.meta.url), png);
console.log('curb-granite-v1-512.png', png.length, 'bytes');
