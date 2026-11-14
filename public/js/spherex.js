// SPHEREx data layer: archive search (via our proxy), range-read cutouts from
// NASA's public AWS copy of SPHEREx, reprojection to a common north-up grid,
// per-detector wavelength lookup, stacking and photometry.
import { RangeFile, parseCards, dataSize, findHDU, bigEndianFloat32, parseBinTableRow } from './fits.js';
import { TanSip, offsetToWorld } from './wcs.js';
import { CONFIG } from './config.js';
import { readCompressedRows } from './rice.js';

const NX = 2040;
const files = new Map();
function rfile(url) { if (!files.has(url)) files.set(url, new RangeFile(url)); return files.get(url); }

// Snapshot of the archive listing for the challenge test targets, used only
// when the live IRSA search is down (keeps the demo targets working).
let snapshot = null;
async function fromSnapshot(key) {
  if (!key) return null;
  snapshot ||= fetch(new URL('../data/snapshot.json', import.meta.url)).then(r => r.ok ? r.json() : null).catch(() => null);
  const snap = await snapshot;
  const list = snap?.targets?.[key];
  if (!list) return null;
  const base = 'https://nasa-irsa-spherex.s3.amazonaws.com/';
  const wl = { 1: [0.7455, 1.1167], 2: [1.1033, 1.6499], 3: [1.6301, 2.4346], 4: [2.4027, 3.8473], 5: [3.8113, 4.4300], 6: [4.4115, 5.0096] };
  const images = list.map(([obs, det, t, ver]) => {
    const week = obs.split('_').slice(0, 2).join('_');
    const key2 = `${snap.release}/level2/${week}/l2b${ver}/${det}/level2_${obs}D${det}_spx_l2b${ver}.fits`;
    return { id: obs + '/' + det, obs, det, t, tEnd: t + 0.0013, exp: 113.58, wlMin: wl[det][0], wlMax: wl[det][1], url: 'https://irsa.ipac.caltech.edu/ibe/data/spherex/' + key2, s3: base + key2, snapshot: snap.date };
  });
  return images.sort((a, b) => a.t - b.t);
}

export async function searchImages(ra, dec, presetKey) {
  try {
    return await liveSearch(ra, dec);
  } catch (e) {
    const snap = await fromSnapshot(presetKey);
    if (snap) { snap.fromSnapshot = true; return snap; }
    throw e;
  }
}

async function liveSearch(ra, dec) {
  // When the page itself is served from IRSA (test harness) we can query SIA directly.
  if (location.hostname === 'irsa.ipac.caltech.edu') return directSia(ra, dec);
  const u = `${CONFIG.apiBase}/api/sia?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&collections=${CONFIG.collections.join(',')}`;
  let r = await fetch(u);
  if (!r.ok) { await new Promise(res => setTimeout(res, 2000)); r = await fetch(u); }
  if (!r.ok) throw new Error('NASA archive search is busy (' + r.status + ') — try again in a minute');
  const j = await r.json();
  return j.images.sort((a, b) => a.t - b.t);
}

async function directSia(ra, dec) {
  const q = CONFIG.collections.map(c => 'COLLECTION=' + c).join('&');
  let text = '';
  for (let i = 0; i < 4; i++) {
    text = await (await fetch(`/SIA?${q}&POS=circle+${ra}+${dec}+0.001&RESPONSEFORMAT=CSV`)).text();
    if (!/^\s*</.test(text)) break;
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  if (/^\s*</.test(text)) throw new Error('IRSA archive is busy — try again in a minute');
  const lines = text.trim().split('\n');
  const head = lines.shift().split(',');
  const idx = k => head.indexOf(k);
  const out = [];
  for (const l of lines) {
    // split on commas outside quotes
    const f = []; let cur = '', q2 = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q2 && l[i + 1] === '"') { cur += '"'; i++; } else q2 = !q2; } else if (ch === ',' && !q2) { f.push(cur); cur = ''; } else cur += ch; }
    f.push(cur);
    if (f.length < idx('access_url') + 1) continue;
    const det = +f[idx('energy_bandpassname')].replace(/\D/g, '');
    const s3 = f[idx('access_url')].replace('https://irsa.ipac.caltech.edu/ibe/data/spherex/', 'https://nasa-irsa-spherex.s3.amazonaws.com/');
    out.push({ id: f[idx('obs_id')] + '/' + det, obs: f[idx('obs_id')], det, t: +f[idx('t_min')], tEnd: +f[idx('t_max')], exp: +f[idx('t_exptime')], wlMin: f[idx('em_min')] * 1e6, wlMax: f[idx('em_max')] * 1e6, url: f[idx('access_url')], s3, released: f[idx('obs_release_date')] });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Cluster exposures into survey passes (SPHEREx re-maps the sky every ~6 months)
export function groupEpochs(images, gapDays = 30) {
  const epochs = [];
  let cur = null;
  for (const im of images) {
    if (!cur || im.t - cur.tEnd > gapDays) { cur = { images: [], tStart: im.t, tEnd: im.t }; epochs.push(cur); }
    cur.images.push(im); cur.tEnd = im.t;
  }
  epochs.forEach((e, i) => { e.index = i; e.tMid = e.images.reduce((s, x) => s + x.t, 0) / e.images.length; im2epoch(e); });
  return epochs;
}
function im2epoch(e) { for (const im of e.images) im.epoch = e.index; }

// Pick which exposures to download: up to `perDet` per detector per epoch,
// spread evenly through each epoch so we sample many wavelengths.
export function planDownloads(epochs, dets, perDet) {
  // group by (pass, detector), pick evenly spaced exposures in each group, then
  // interleave so every pass/detector gets its first exposure early (frames
  // appear quickly and fill in as more data arrives)
  const groups = [];
  for (const d of dets) for (const e of epochs) {
    const list = e.images.filter(im => im.det === d);
    if (!list.length) continue;
    const n = Math.min(perDet, list.length);
    groups.push(Array.from({ length: n }, (_, k) => list[Math.floor((k + 0.5) * list.length / n)]));
  }
  const out = [];
  for (let k = 0; groups.some(g => g.length > k); k++) for (const g of groups) if (g[k]) out.push(g[k]);
  return out;
}

async function openImage(url) {
  const f = rfile(url);
  if (f.img) return f.img;
  f.img = (async () => {
    const buf = await f.read(0, 2880 * 16);
    const text = new TextDecoder('latin1').decode(buf);
    const p = parseCards(text);
    const pLen = Math.ceil(p.length / 2880) * 2880;
    let h = parseCards(text.slice(pLen));
    let cards, dataStart;
    if (h.end) { cards = h.cards; dataStart = pLen + Math.ceil(h.length / 2880) * 2880; }
    else { const hh = await f.header(pLen); cards = hh.cards; dataStart = hh.dataStart; }
    return { cards, dataStart, wcs: new TanSip(cards), primary: p.cards };
  })();
  f.img.catch(() => { f.img = null; });
  return f.img;
}

// Wavelength lookup table — fixed per detector (linear variable filter), so cache by detector.
const waveCache = new Map();
export function waveTable(im) {
  if (waveCache.has(im.det)) return waveCache.get(im.det);
  const p = (async () => {
    const f = rfile(im.s3);
    const img = await openImage(im.s3);
    const h = await findHDU(f, 'WCS-WAVE', img.dataStart + dataSize(img.cards));
    const buf = await f.read(h.dataStart, h.cards.NAXIS1 * h.cards.NAXIS2);
    const row = parseBinTableRow(h.cards, buf);
    return { X: row.X, Y: row.Y, V: row.VALUES };
  })();
  waveCache.set(im.det, p);
  p.catch(() => waveCache.delete(im.det));
  return p;
}
export function lambdaAt(tab, x, y) {
  const { X, Y, V } = tab; const nx = X.length, ny = Y.length;
  const seg = (arr, v) => { let i = 0; while (i < arr.length - 2 && v > arr[i + 1]) i++; return i; };
  const i = seg(X, x), j = seg(Y, y);
  const tx = Math.min(1, Math.max(0, (x - X[i]) / (X[i + 1] - X[i])));
  const ty = Math.min(1, Math.max(0, (y - Y[j]) / (Y[j + 1] - Y[j])));
  const g = (ii, jj, k) => V[k + 2 * (ii + nx * jj)];
  const bil = k => g(i, j, k) * (1 - tx) * (1 - ty) + g(i + 1, j, k) * tx * (1 - ty) + g(i, j + 1, k) * (1 - tx) * ty + g(i + 1, j + 1, k) * tx * ty;
  return { wl: bil(0), bw: bil(1) };
}

// Central wavelength (µm) seen by a given exposure at a sky position
export async function wavelengthAt(im, ra, dec) {
  const img = await openImage(im.s3);
  const [x, y] = img.wcs.worldToPix(ra, dec);
  return lambdaAt(await waveTable(im), x, y);
}

function median(arr) {
  const a = Float32Array.from(arr).sort();
  return a.length ? a[a.length >> 1] : NaN;
}
function robustStats(img) {
  const v = []; for (const x of img) if (Number.isFinite(x)) v.push(x);
  if (v.length < 10) return { bg: 0, sigma: 1 };
  const bg = median(v);
  const sigma = 1.4826 * median(v.map(x => Math.abs(x - bg))) || 1e-6;
  return { bg, sigma };
}

// Read the patch around (ra,dec) from one exposure and resample it onto a
// north-up grid of n x n pixels covering fov arcsec.
export async function loadCutout(im, ra, dec, fov, n) {
  const img = await openImage(im.s3);
  const { wcs } = img;
  const [px, py] = wcs.worldToPix(ra, dec);
  if (!(px >= 1 && px <= NX && py >= 1 && py <= NX)) return null;
  // exact rows needed: project the border of the output grid into the detector
  let ymin = Infinity, ymax = -Infinity;
  const h = fov / 2;
  for (let k = 0; k <= 16; k++) {
    const t = -h + 2 * h * k / 16;
    for (const [e, nn] of [[t, h], [t, -h], [h, t], [-h, t]]) {
      const [wr, wd] = offsetToWorld(ra, dec, e, nn);
      const [, yy] = wcs.worldToPix(wr, wd);
      if (yy < ymin) ymin = yy; if (yy > ymax) ymax = yy;
    }
  }
  const y0 = Math.max(1, Math.floor(ymin) - 2), y1 = Math.min(NX, Math.ceil(ymax) + 2);
  const f = rfile(im.s3);
  const buf = await f.read(img.dataStart + (y0 - 1) * NX * 4, (y1 - y0 + 1) * NX * 4, { cache: false });
  const raw = bigEndianFloat32(buf);
  const out = new Float32Array(n * n);
  const scale = fov / n, c = (n - 1) / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [wra, wdec] = offsetToWorld(ra, dec, (c - i) * scale, (c - j) * scale);
    const [x, y] = wcs.worldToPix(wra, wdec);
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 1 || xi >= NX || yi < y0 || yi >= y1) { out[j * n + i] = NaN; continue; }
    const tx = x - xi, ty = y - yi;
    const k = (yi - y0) * NX + (xi - 1);
    out[j * n + i] = raw[k] * (1 - tx) * (1 - ty) + raw[k + 1] * tx * (1 - ty) + raw[k + NX] * (1 - tx) * ty + raw[k + NX + 1] * tx * ty;
  }
  const st = robustStats(out);
  const c2 = img.cards;
  return {
    im, data: out, n, fov, ...st, px, py, rows: [y0, y1], center: [ra, dec],
    mjd: c2['MJD-AVG'] ?? im.t,
    dateObs: c2['DATE-AVG'] || c2['DATE-OBS'],
    pixScale: wcs.pixScale,
    flagCounts: Object.fromEntries(Object.entries(c2).filter(([k]) => /^L2 N_/.test(k))),
  };
}

// Aperture photometry at grid position (cx, cy) — approximate, no aperture
// correction. Background = the cutout's robust median. Returns mJy and error.
// Saturated stars (blank core pixels) fall back to PSF-wing photometry: the
// flux in a ring just outside the saturated core, which still tracks the
// star's brightness (good for light curves, flagged as relative).
export function apertureFlux(cut, cx, cy, radiusArcsec = 9) {
  const { data, n, fov, bg, sigma } = cut;
  const scale = fov / n;
  const omega = (scale / 206264.806) ** 2;
  const at = (i, j) => (i < 0 || j < 0 || i >= n || j >= n) ? undefined : data[j * n + i];
  const ring = (r0, r1) => {
    let s = 0, cnt = 0, nan = 0, out = false;
    const R = Math.ceil(r1);
    for (let j = Math.floor(cy) - R; j <= Math.ceil(cy) + R; j++) for (let i = Math.floor(cx) - R; i <= Math.ceil(cx) + R; i++) {
      const d2 = (i - cx) ** 2 + (j - cy) ** 2;
      if (d2 > r1 * r1 || d2 < r0 * r0) continue;
      const v = at(i, j);
      if (v === undefined) { out = true; continue; }
      if (!Number.isFinite(v)) { nan++; continue; }
      s += v - bg; cnt++;
    }
    return { s, cnt, nan, out };
  };
  const rp = radiusArcsec / scale;
  const core = ring(0, rp);
  if (core.out) return { flux: NaN, err: NaN };
  const errOf = cnt => sigma * Math.sqrt(Math.max(1, cnt * (scale / cut.pixScale) ** 2)) * (cut.pixScale / scale) ** 2 * omega * 1e9;
  if (!core.nan) return { flux: core.s * omega * 1e9, err: errOf(core.cnt) };
  // saturated: find the extent of the blank core, then measure a ring outside it
  let rN = 0;
  for (let r = 0; r < 40 / scale; r += 0.5) { const q = ring(r, r + 1); if (q.nan) rN = r + 1; }
  const r0 = rN + 4 / scale, r1 = rN + 16 / scale;
  const w = ring(r0, r1);
  if (w.out || w.cnt < 8) return { flux: NaN, err: NaN };
  return { flux: w.s * omega * 1e9, err: errOf(w.cnt), saturated: true };
}

// Stack cutouts into one frame. Each input is normalised by its own noise so
// detectors with different brightness scales combine into one S/N image.
// Outliers (hot pixels, cosmic rays, satellite streaks) are rejected against
// the per-pixel median when there are 3+ inputs.
export function stack(cuts) {
  if (!cuts.length) return null;
  const n = cuts[0].n, N = cuts.length, out = new Float32Array(n * n);
  const vals = new Float32Array(N);
  for (let k = 0; k < n * n; k++) {
    let m = 0;
    for (const c of cuts) { const v = c.data[k]; if (Number.isFinite(v) && !(c.flagMask && c.flagMask[k])) vals[m++] = (v - c.bg) / c.sigma; }
    if (!m) { out[k] = NaN; continue; }
    if (m >= 3) {
      const sorted = vals.slice(0, m).sort();
      const med = sorted[m >> 1];
      let s = 0, cnt = 0;
      for (let i = 0; i < m; i++) if (Math.abs(vals[i] - med) < 4) { s += vals[i]; cnt++; }
      out[k] = cnt ? s / Math.sqrt(cnt) : med;
    } else {
      let s = 0; for (let i = 0; i < m; i++) s += vals[i];
      out[k] = s / Math.sqrt(m);
    }
  }
  return { data: out, n, count: N };
}

export function subtract(a, b) {
  const out = new Float32Array(a.data.length);
  for (let k = 0; k < out.length; k++) out[k] = a.data[k] - b.data[k];
  return { data: out, n: a.n, count: a.count };
}

export function mjdToDate(mjd) { return new Date((mjd - 40587) * 86400000); }
export function mjdToYear(mjd) { return 2000 + (mjd - 51544.5) / 365.25; }

// Propagate a catalogue position by proper motion (mas/yr) from epoch0 to epoch1 (decimal years)
export function propagate(ra, dec, pmra, pmdec, epoch0, epoch1) {
  const dt = epoch1 - epoch0;
  if (!pmra && !pmdec) return [ra, dec];
  return offsetToWorld(ra, dec, (pmra || 0) / 1000 * dt, (pmdec || 0) / 1000 * dt);
}

// 3x3 Gaussian smoothing (σ≈1 px) — boosts S/N of point sources in difference images
export function smooth(data, n) {
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = data[y * n + x]; if (!Number.isFinite(v)) continue;
      const kk = k[(dj + 1) * 3 + di + 1]; s += v * kk; w += kk;
    }
    out[j * n + i] = w ? s / w * Math.sqrt(w / 16 * 16 / 4) : NaN;
  }
  return out;
}

// Contamination bits (see SPHEREx FLAGS definitions): transient, non-functional,
// hot, persistence, outlier, crosstalk, ghosts, streak, bloom, snowball, halo.
// (SOURCE, bit 21, just marks known stars and is not contamination.)
export const CONTAM_BITS = [0, 6, 10, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28];
const CONTAM_MASK = CONTAM_BITS.reduce((m, b) => m | (1 << b), 0);

// Per-pixel contamination mask for a loaded cutout, on the same grid.
export async function loadFlagMask(cut) {
  if (cut.flagMask) return cut.flagMask;
  const img = await openImage(cut.im.s3);
  const f = rfile(cut.im.s3);
  const h = await f.header(img.dataStart + dataSize(img.cards));
  if ((h.cards.EXTNAME || '').trim() !== 'FLAGS') throw new Error('FLAGS HDU not found');
  const [y0, y1] = cut.rows;
  const rows = await readCompressedRows(f, h, y0, y1);
  const { n, fov } = cut, [ra, dec] = cut.center;
  const scale = fov / n, c = (n - 1) / 2;
  const mask = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [wr, wd] = offsetToWorld(ra, dec, (c - i) * scale, (c - j) * scale);
    const [x, y] = img.wcs.worldToPix(wr, wd);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || xi > NX || yi < y0 || yi > y1) continue;
    if (rows[(yi - y0) * NX + (xi - 1)] & CONTAM_MASK) mask[j * n + i] = 1;
  }
  cut.flagMask = mask;
  return mask;
}
