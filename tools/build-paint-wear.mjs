// Tileable wear mask for worn crosswalk paint (512x512 RGB PNG, no deps).
//   R: erosion field. Paint survives where R is above a threshold that rises
//      toward stripe edges, so edges chip away first and a few holes open inside.
//   G: fine grime / speckle, used to tint the surviving paint a little.
// Usage: node tools/build-paint-wear.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const N = 512;
let seed = 1234567;
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
function fbm(periods) {
  const layers = periods.map(layer);
  return (x, y) => { let v = 0, a = .5, s = 0; for (const l of layers) { v += l(x, y) * a; s += a; a *= .5; } return v / s; };
}
const erosion = fbm([6, 12, 24, 48, 96, 192]);
const grime = fbm([24, 48, 96, 192]);
const R = new Float32Array(N * N), G = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { R[y * N + x] = erosion(x, y); G[y * N + x] = grime(x, y); }
const normalize = a => { let lo = Infinity, hi = -Infinity; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / (hi - lo); };
normalize(R); normalize(G);

const raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const o = y * (N * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(R[y * N + x] * 255); raw[o + 1] = Math.round(G[y * N + x] * 255); raw[o + 2] = 0;
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
const out = new URL('../assets/surfaces/paint-wear-v1-512.png', import.meta.url);
fs.writeFileSync(out, png);
console.log('paint-wear-v1-512.png', png.length, 'bytes');
