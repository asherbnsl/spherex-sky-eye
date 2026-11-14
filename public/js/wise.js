// WISE reference epoch: unWISE W2 (4.6 µm) coadd of the original 2010 AllWISE
// mission data, from the public unWISE cutout service (unwise.me). Prepending
// it to the SPHEREx flipbook gives a ~15-year baseline, like WiseView.
import { parseCards, bigEndianFloat32 } from './fits.js';
import { TanSip, offsetToWorld } from './wcs.js';

export const WISE_MJD = 55400; // ~2010.6, mid AllWISE epoch
const PIX = 2.75;              // unWISE arcsec / pixel

async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  return new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
}
function untar(buf) {
  const files = [];
  const u8 = new Uint8Array(buf);
  let off = 0;
  while (off + 512 <= u8.length) {
    const name = new TextDecoder().decode(u8.subarray(off, off + 100)).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(new TextDecoder().decode(u8.subarray(off + 124, off + 136)).replace(/\0.*$/s, '').trim(), 8) || 0;
    files.push({ name, data: buf.slice(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export async function loadWiseFrame(ra, dec, fov, n, band = 2) {
  const size = Math.min(1024, Math.ceil(fov * 1.45 / PIX) + 6);
  const url = `https://unwise.me/cutout_fits?version=allwise&ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&size=${size}&bands=${band}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('unWISE ' + r.status);
  let buf = await r.arrayBuffer();
  const u8 = new Uint8Array(buf, 0, 2);
  if (u8[0] === 0x1f && u8[1] === 0x8b) buf = await gunzip(buf);
  const files = untar(buf).filter(f => new RegExp(`w${band}-img-m\\.fits$`).test(f.name));
  if (!files.length) throw new Error('no unWISE image');
  // a cutout near a tile edge can come from several tiles: use all of them
  const imgs = files.map(f => {
    const text = new TextDecoder('latin1').decode(f.data.slice(0, 2880 * 4));
    const h = parseCards(text);
    const start = Math.ceil(h.length / 2880) * 2880;
    const c = h.cards;
    const npix = c.NAXIS1 * c.NAXIS2;
    let data;
    if (c.BITPIX === -32) data = bigEndianFloat32(f.data.slice(start, start + npix * 4));
    else throw new Error('unexpected BITPIX ' + c.BITPIX);
    return { c, data, wcs: new TanSip(c) };
  });
  const out = new Float32Array(n * n).fill(NaN);
  const scale = fov / n, cc = (n - 1) / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [wr, wd] = offsetToWorld(ra, dec, (cc - i) * scale, (cc - j) * scale);
    for (const im of imgs) {
      const [x, y] = im.wcs.worldToPix(wr, wd);
      const W = im.c.NAXIS1, H = im.c.NAXIS2;
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < 1 || yi < 1 || xi >= W || yi >= H) continue;
      const tx = x - xi, ty = y - yi, k = (yi - 1) * W + (xi - 1);
      out[j * n + i] = im.data[k] * (1 - tx) * (1 - ty) + im.data[k + 1] * tx * (1 - ty) + im.data[k + W] * (1 - tx) * ty + im.data[k + W + 1] * tx * ty;
      break;
    }
  }
  // normalise to S/N units like the SPHEREx frames
  const v = [...out].filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 20) throw new Error('unWISE cutout empty');
  const bg = v[v.length >> 1];
  const sigma = 1.4826 * [...v].map(x => Math.abs(x - bg)).sort((a, b) => a - b)[v.length >> 1] || 1;
  return { kind: 'mono', n, data: out.map(x => (x - bg) / sigma), mjd: WISE_MJD, wise: true, label: `WISE 2010 · unWISE W${band} ${band === 1 ? '3.4' : '4.6'} µm (AllWISE epoch)`, cuts: [] };
}
