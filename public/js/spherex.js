// SPHEREx data layer: archive search (via our proxy), range-read cutouts from
// NASA's public AWS copy of SPHEREx, reprojection to a common north-up grid,
// per-detector wavelength lookup, stacking and photometry.
import { RangeFile, parseCards, dataSize, findHDU, bigEndianFloat32, parseBinTableRow } from './fits.js';
import { TanSip, offsetToWorld } from './wcs.js';
import { CONFIG } from './config.js';

const NX = 2040;
const files = new Map();
function rfile(url) { if (!files.has(url)) files.set(url, new RangeFile(url)); return files.get(url); }

export async function searchImages(ra, dec) {
  // When the page itself is served from IRSA (test harness) we can query SIA directly.
  if (location.hostname === 'irsa.ipac.caltech.edu') return directSia(ra, dec);
  const u = `${CONFIG.apiBase}/api/sia?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&collections=${CONFIG.collections.join(',')}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('Archive search failed (' + r.status + ')');
  const j = await r.json();
  return j.images.sort((a, b) => a.t - b.t);
}

async function directSia(ra, dec) {
  const q = CONFIG.collections.map(c => 'COLLECTION=' + c).join('&');
  const text = await (await fetch(`/SIA?${q}&POS=circle+${ra}+${dec}+0.001&RESPONSEFORMAT=CSV`)).text();
  const lines = text.trim().split('\n');
  const head = lines.shift().split(',');
  const idx = k => head.indexOf(k);
  const out = [];
  for (const l of lines) {
    // split on commas outside quotes
    const f = []; let cur = '', q2 = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q2 && l[i + 1] === '"') { cur += '"'; i++; } else q2 = !q2; } else if (ch === ',' && !q2) { f.push(cur); cur = ''; } else cur += ch; }
    f.push(cur);
    const det = +f[idx('energy_bandpassname')].replace(/\D/g, '');
    let s3 = f[idx('access_url')];
    try { const ca = JSON.parse(f[idx('cloud_access')]); s3 = `https://${ca.aws.bucket_name}.s3.amazonaws.com/${ca.aws.key}`; } catch { }
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
    im, data: out, n, fov, ...st, px, py,
    mjd: c2['MJD-AVG'] ?? im.t,
    dateObs: c2['DATE-AVG'] || c2['DATE-OBS'],
    pixScale: wcs.pixScale,
    flagCounts: Object.fromEntries(Object.entries(c2).filter(([k]) => /^L2 N_/.test(k))),
  };
}

// Aperture photometry at grid position (cx, cy) — approximate, no aperture
// correction. Background = the cutout's robust median. Returns mJy and error.
export function apertureFlux(cut, cx, cy, radiusArcsec = 9) {
  const { data, n, fov, bg, sigma } = cut;
  const scale = fov / n, rp = radiusArcsec / scale;
  let s = 0, cnt = 0;
  for (let j = Math.floor(cy - rp); j <= Math.ceil(cy + rp); j++) for (let i = Math.floor(cx - rp); i <= Math.ceil(cx + rp); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n) return { flux: NaN, err: NaN };
    if ((i - cx) ** 2 + (j - cy) ** 2 > rp * rp) continue;
    const v = data[j * n + i]; if (!Number.isFinite(v)) return { flux: NaN, err: NaN };
    s += v - bg; cnt++;
  }
  // resampled pixels are correlated: noise per native pixel area
  const omega = (scale / 206264.806) ** 2;
  const nativePix = cnt * (scale / cut.pixScale) ** 2;
  const errSurf = sigma * Math.sqrt(Math.max(1, nativePix)) * (cut.pixScale / scale) ** 2;
  return { flux: s * omega * 1e9, err: errSurf * omega * 1e9 };
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
    for (const c of cuts) { const v = c.data[k]; if (Number.isFinite(v)) vals[m++] = (v - c.bg) / c.sigma; }
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
