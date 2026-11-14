// Minimal FITS reader built around HTTP Range requests.
// Reads only the bytes it needs from very large multi-extension SPHEREx files.

const BLOCK = 2880;

export function parseCards(text) {
  const cards = {};
  let end = false;
  for (let i = 0; i + 80 <= text.length; i += 80) {
    const c = text.slice(i, i + 80);
    let key = c.slice(0, 8).trim();
    if (key === 'END') { end = true; return { cards, end, length: i + 80 }; }
    let v;
    if (key === 'HIERARCH') {
      const eq = c.indexOf('=');
      if (eq < 0) continue;
      key = c.slice(9, eq).trim();
      v = c.slice(eq + 1);
    } else {
      if (c[8] !== '=' || !key) continue;
      v = c.slice(10);
    }
    let val;
    const s = v.trimStart();
    if (s.startsWith("'")) {
      const m = s.match(/^'((?:[^']|'')*)'/);
      val = m ? m[1].replace(/''/g, "'").trimEnd() : s;
    } else {
      const raw = s.split('/')[0].trim();
      if (raw === 'T') val = true;
      else if (raw === 'F') val = false;
      else if (raw !== '' && !isNaN(+raw)) val = +raw;
      else val = raw;
    }
    cards[key] = val;
  }
  return { cards, end, length: text.length };
}

export class RangeFile {
  constructor(url, fetchImpl = (...a) => fetch(...a)) {
    this.url = url;
    this.fetch = fetchImpl;
    this.cache = new Map();
  }
  async read(start, length) {
    const key = start + ':' + length;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await this.fetch(this.url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
          if (r.status !== 206 && r.status !== 200) throw new Error('HTTP ' + r.status);
          let buf = await r.arrayBuffer();
          if (r.status === 200 && buf.byteLength > length) buf = buf.slice(start, start + length);
          return buf;
        } catch (e) {
          if (attempt === 2) throw e;
          await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
        }
      }
    })();
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key));
    return p;
  }
  // Read a header starting at byte `offset`. Returns cards + byte offset of data start.
  async header(offset) {
    let len = BLOCK * 12;
    for (;;) {
      const buf = await this.read(offset, len);
      const text = new TextDecoder('latin1').decode(buf);
      const h = parseCards(text);
      if (h.end) {
        const hdrBytes = Math.ceil(h.length / BLOCK) * BLOCK;
        return { cards: h.cards, dataStart: offset + hdrBytes };
      }
      if (buf.byteLength < len) throw new Error('FITS header END not found');
      len *= 2;
    }
  }
}

export function dataSize(c) {
  const n = c.NAXIS || 0;
  if (n === 0) return 0;
  let size = Math.abs(c.BITPIX) / 8;
  for (let i = 1; i <= n; i++) size *= c['NAXIS' + i];
  size += (c.PCOUNT || 0);
  size *= (c.GCOUNT || 1);
  return Math.ceil(size / BLOCK) * BLOCK;
}

// Walk HDUs until extname found (headers only — data is skipped).
export async function findHDU(file, extname, startOffset = 0, maxHdus = 10) {
  let off = startOffset;
  for (let i = 0; i < maxHdus; i++) {
    const h = await file.header(off);
    if ((h.cards.EXTNAME || '').trim() === extname) return h;
    off = h.dataStart + dataSize(h.cards);
  }
  throw new Error('HDU not found: ' + extname);
}

export function bigEndianFloat32(buf) {
  const dv = new DataView(buf);
  const n = buf.byteLength / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, false);
  return out;
}

// Parse a 1-row binary table into {colName: TypedArray}
export function parseBinTableRow(cards, buf) {
  const dv = new DataView(buf);
  const ncol = cards.TFIELDS;
  let off = 0;
  const out = {};
  for (let i = 1; i <= ncol; i++) {
    const form = String(cards['TFORM' + i]).trim();
    const m = form.match(/^(\d*)([A-Z])/);
    const rep = m[1] === '' ? 1 : +m[1];
    const t = m[2];
    const size = { E: 4, D: 8, J: 4, K: 8, I: 2, B: 1, L: 1, A: 1 }[t];
    const arr = [];
    for (let k = 0; k < rep; k++) {
      const p = off + k * size;
      arr.push(t === 'E' ? dv.getFloat32(p) : t === 'D' ? dv.getFloat64(p) : t === 'J' ? dv.getInt32(p) : t === 'I' ? dv.getInt16(p) : t === 'K' ? Number(dv.getBigInt64(p)) : dv.getUint8(p));
    }
    out[String(cards['TTYPE' + i]).trim()] = arr;
    off += rep * size;
  }
  return out;
}
