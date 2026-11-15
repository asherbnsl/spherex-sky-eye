// SI disclosure: written with AI assistance (Claude, Anthropic) under the direction of Arsh Bansal (Team Shrapnel); reviewed and tested by the team.
// Image display: stretches, sensor-style colour maps, RGB composites.

function lut(stops) {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = c0[ch] + (c1[ch] - c0[ch]) * f;
  }
  return out;
}

export const LOOKS = {
  ironbow: { name: 'IRONBOW', lut: lut([[0, [0, 0, 8]], [0.2, [40, 0, 110]], [0.4, [160, 20, 120]], [0.6, [235, 90, 30]], [0.8, [255, 190, 40]], [1, [255, 255, 230]]]) },
  infrared: { name: 'INFRARED', lut: lut([[0, [0, 0, 0]], [0.35, [120, 10, 0]], [0.65, [255, 120, 0]], [0.9, [255, 230, 120]], [1, [255, 255, 255]]]) },
  nvg: { name: 'NIGHT VISION', lut: lut([[0, [0, 6, 0]], [0.5, [40, 170, 60]], [1, [210, 255, 210]]]) },
  cyan: { name: 'CYAN HUD', lut: lut([[0, [0, 4, 10]], [0.5, [0, 140, 170]], [1, [220, 255, 255]]]) },
  mono: { name: 'MONO', lut: lut([[0, [0, 0, 0]], [1, [255, 255, 255]]]) },
  invert: { name: 'INVERTED', lut: lut([[0, [255, 255, 255]], [1, [0, 0, 0]]]) },
};
const DIVERGE = lut([[0, [40, 120, 255]], [0.5, [0, 0, 0]], [1, [255, 70, 50]]]);

// Values are in noise (sigma) units. asinh keeps faint and bright stars visible.
function stretch(v, lo, hi) {
  if (!Number.isFinite(v)) return -1;
  const a = Math.asinh(v - lo), b = Math.asinh(hi - lo);
  return Math.max(0, Math.min(1, a / b));
}

export function drawFrame(canvas, frame, opts) {
  const n = frame.n;
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  const d = img.data;
  const { lo, hi } = opts;
  if (frame.kind === 'rgb') {
    for (let k = 0; k < n * n; k++) {
      const chans = [frame.r, frame.g, frame.b];
      for (let c = 0; c < 3; c++) {
        const s = chans[c] ? stretch(chans[c].data[k], lo, hi) : 0;
        d[4 * k + c] = s < 0 ? 20 : s * 255;
      }
      d[4 * k + 3] = 255;
    }
  } else if (frame.kind === 'diff') {
    // Only show changes that clearly stand out from this frame's own noise:
    // below ~3x the noise is drawn black, so real movers appear as clean
    // red (now) / blue (before) pairs instead of a speckled background.
    if (frame.noise === undefined) {
      const a = []; for (let k = 0; k < frame.data.length; k += 2) { const v = frame.data[k]; if (Number.isFinite(v)) a.push(Math.abs(v)); }
      a.sort((x, y) => x - y);
      frame.noise = (a.length ? a[a.length >> 1] : 1) * 1.4826 || 1;
    }
    const t = 3 * frame.noise, w = 4 * frame.noise;
    for (let k = 0; k < n * n; k++) {
      const v0 = frame.data[k];
      const v = Number.isFinite(v0) ? Math.sign(v0) * Math.max(0, Math.abs(v0) - t) : NaN;
      const s = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * Math.tanh(v / w)))) : 127;
      d[4 * k] = DIVERGE[s * 3]; d[4 * k + 1] = DIVERGE[s * 3 + 1]; d[4 * k + 2] = DIVERGE[s * 3 + 2]; d[4 * k + 3] = 255;
    }
  } else {
    const L = (LOOKS[opts.look] || LOOKS.ironbow).lut;
    for (let k = 0; k < n * n; k++) {
      const s = stretch(frame.data[k], lo, hi);
      if (s < 0) { d[4 * k] = 18; d[4 * k + 1] = 22; d[4 * k + 2] = 30; d[4 * k + 3] = 255; continue; }
      const i = Math.round(s * 255) * 3;
      d[4 * k] = L[i]; d[4 * k + 1] = L[i + 1]; d[4 * k + 2] = L[i + 2]; d[4 * k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Export the current frames as an animated sequence of PNG data URLs
export function frameToDataURL(frame, opts, size = 512) {
  const c = document.createElement('canvas');
  drawFrame(c, frame, opts);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = !opts.pixelated;
  ctx.drawImage(c, 0, 0, size, size);
  return out;
}
