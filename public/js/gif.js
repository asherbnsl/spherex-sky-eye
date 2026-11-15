// SI disclosure: written with AI assistance (Claude, Anthropic) under the direction of Arsh Bansal (Team Shrapnel); reviewed and tested by the team.
// Minimal animated-GIF encoder (GIF89a, LZW) — no dependencies.
// Frames are RGBA ImageData of equal size; colours are mapped to a fixed
// 6x7x6 palette (252 colours), which is plenty for these false-colour maps.

const R = 6, G = 7, B = 6;
function palette() {
  const p = new Uint8Array(256 * 3);
  let k = 0;
  for (let r = 0; r < R; r++) for (let g = 0; g < G; g++) for (let b = 0; b < B; b++) {
    p[k * 3] = Math.round(r * 255 / (R - 1)); p[k * 3 + 1] = Math.round(g * 255 / (G - 1)); p[k * 3 + 2] = Math.round(b * 255 / (B - 1)); k++;
  }
  return p;
}
function indexOf(r, g, b) {
  return Math.round(r * (R - 1) / 255) * G * B + Math.round(g * (G - 1) / 255) * B + Math.round(b * (B - 1) / 255);
}

function lzw(indices, minCode = 8) {
  const out = []; let cur = 0, bits = 0;
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const emit = code => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

export function encodeGif(frames, width, height, delayMs = 500) {
  const bytes = [];
  const w16 = v => bytes.push(v & 255, (v >> 8) & 255);
  const str = s => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  str('GIF89a'); w16(width); w16(height);
  bytes.push(0xF7, 0, 0); // global colour table, 256 entries
  bytes.push(...palette());
  bytes.push(0x21, 0xFF, 0x0B); str('NETSCAPE2.0'); bytes.push(3, 1, 0, 0, 0); // loop forever
  for (const img of frames) {
    bytes.push(0x21, 0xF9, 4, 0, ...[Math.round(delayMs / 10) & 255, (Math.round(delayMs / 10) >> 8) & 255], 0, 0);
    bytes.push(0x2C); w16(0); w16(0); w16(width); w16(height); bytes.push(0);
    const d = img.data, idx = new Uint8Array(width * height);
    for (let i = 0; i < idx.length; i++) idx[i] = indexOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const data = lzw(idx);
    bytes.push(8);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); bytes.push(chunk.length, ...chunk); }
    bytes.push(0);
  }
  bytes.push(0x3B);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}
