// SI disclosure: written with AI assistance (Claude, Anthropic) under the direction of Arsh Bansal (Team Shrapnel); reviewed and tested by the team.
// FITS tile-compressed images: RICE_1 decoder (port of cfitsio fits_rdecomp
// for 32-bit integers) and a helper that reads only the rows (tiles) it needs
// from a remote file via HTTP Range requests. Used for SPHEREx FLAGS.

export function riceDecode32(bytes, npix, nblock = 32) {
  const fsbits = 5, fsmax = 25, bbits = 32;
  const out = new Int32Array(npix);
  let p = 0;
  let lastpix = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) | 0;
  p = 4;
  let b = bytes[p++], nbits = 8; // bit buffer (uses only low `nbits` bits)
  const readBits = n => { // n <= 25
    while (nbits < n) { b = ((b << 8) | bytes[p++]) >>> 0; nbits += 8; }
    nbits -= n;
    const v = (b >>> nbits) & ((1 << n) - 1);
    b &= (1 << nbits) - 1;
    return v;
  };
  for (let i = 0; i < npix;) {
    const fs = readBits(fsbits) - 1;
    const imax = Math.min(i + nblock, npix);
    if (fs < 0) {
      for (; i < imax; i++) out[i] = lastpix;
    } else if (fs === fsmax) {
      for (; i < imax; i++) {
        const hi = readBits(16), lo = readBits(16);
        const diff = ((hi << 16) | lo) >>> 0;
        const d = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (lastpix + d) | 0; out[i] = lastpix;
      }
    } else {
      for (; i < imax; i++) {
        // count leading zeros (unary high part)
        let nzero = 0;
        while (readBits(1) === 0) nzero++;
        const lo = fs ? readBits(fs) : 0;
        const diff = ((nzero * 2 ** fs) + lo) >>> 0;
        const d = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (lastpix + d) | 0; out[i] = lastpix;
      }
    }
  }
  return out;
}

// Read rows y0..y1 (1-based, inclusive) of a row-tiled RICE_1 compressed image
// whose BINTABLE header is `h` ({cards, dataStart}) in RangeFile `f`.
export async function readCompressedRows(f, h, y0, y1) {
  const c = h.cards, W = c.ZNAXIS1;
  if (c.ZCMPTYPE !== 'RICE_1' || c.ZTILE2 !== 1) throw new Error('unsupported compression ' + c.ZCMPTYPE);
  const rowBytes = c.NAXIS1; // 8 bytes: int32 nelem, int32 heap offset (P descriptor)
  const desc = new DataView(await f.read(h.dataStart + (y0 - 1) * rowBytes, (y1 - y0 + 1) * rowBytes, { cache: false }));
  const heapStart = h.dataStart + c.NAXIS1 * c.NAXIS2 + (c.THEAP ? c.THEAP - c.NAXIS1 * c.NAXIS2 : 0);
  const tiles = [];
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k <= y1 - y0; k++) {
    const n = desc.getInt32(k * 8), off = desc.getInt32(k * 8 + 4);
    tiles.push([n, off]); lo = Math.min(lo, off); hi = Math.max(hi, off + n);
  }
  const heap = new Uint8Array(await f.read(heapStart + lo, hi - lo, { cache: false }));
  const block = (() => { for (let i = 1; i < 6; i++) if (c['ZNAME' + i] === 'BLOCKSIZE') return c['ZVAL' + i]; return 32; })();
  const out = new Int32Array((y1 - y0 + 1) * W);
  tiles.forEach(([n, off], k) => out.set(riceDecode32(heap.subarray(off - lo, off - lo + n), W, block), k * W));
  return out;
}
