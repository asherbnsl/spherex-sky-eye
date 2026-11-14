// TAN-SIP world coordinate system (FITS Paper II + SIP convention).
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export class TanSip {
  constructor(c) {
    this.crpix = [c.CRPIX1, c.CRPIX2];
    this.crval = [c.CRVAL1 * D2R, c.CRVAL2 * D2R];
    if (c.CD1_1 !== undefined) {
      this.cd = [c.CD1_1, c.CD1_2 || 0, c.CD2_1 || 0, c.CD2_2];
    } else {
      const d1 = c.CDELT1, d2 = c.CDELT2;
      const p = [c.PC1_1 ?? 1, c.PC1_2 ?? 0, c.PC2_1 ?? 0, c.PC2_2 ?? 1];
      this.cd = [d1 * p[0], d1 * p[1], d2 * p[2], d2 * p[3]];
    }
    const det = this.cd[0] * this.cd[3] - this.cd[1] * this.cd[2];
    this.cdi = [this.cd[3] / det, -this.cd[1] / det, -this.cd[2] / det, this.cd[0] / det];
    const poly = (pfx, order) => {
      const t = [];
      if (!order) return t;
      for (let p = 0; p <= order; p++) for (let q = 0; q <= order - p; q++) {
        const v = c[`${pfx}_${p}_${q}`];
        if (v) t.push([p, q, v]);
      }
      return t;
    };
    this.A = poly('A', c.A_ORDER); this.B = poly('B', c.B_ORDER);
    this.AP = poly('AP', c.AP_ORDER); this.BP = poly('BP', c.BP_ORDER);
    this.pixScale = Math.sqrt(Math.abs(det)) * 3600; // arcsec/pixel
  }
  static ev(t, u, v) { let s = 0; for (const [p, q, a] of t) s += a * u ** p * v ** q; return s; }

  // 1-based FITS pixel -> [ra, dec] degrees
  pixToWorld(x, y) {
    const u = x - this.crpix[0], v = y - this.crpix[1];
    const U = u + TanSip.ev(this.A, u, v), V = v + TanSip.ev(this.B, u, v);
    const xi = (this.cd[0] * U + this.cd[1] * V) * D2R;
    const eta = (this.cd[2] * U + this.cd[3] * V) * D2R;
    const [a0, d0] = this.crval;
    const den = Math.cos(d0) - eta * Math.sin(d0);
    let ra = a0 + Math.atan2(xi, den);
    const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den));
    ra = ((ra * R2D) % 360 + 360) % 360;
    return [ra, dec * R2D];
  }

  // [ra, dec] degrees -> 1-based FITS pixel (SIP inverse + Newton refine)
  worldToPix(ra, dec) {
    const [a0, d0] = this.crval;
    const a = ra * D2R, d = dec * D2R;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
    if (cosc <= 0) return [NaN, NaN];
    const xi = Math.cos(d) * Math.sin(a - a0) / cosc * R2D;
    const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc * R2D;
    const U = this.cdi[0] * xi + this.cdi[1] * eta;
    const V = this.cdi[2] * xi + this.cdi[3] * eta;
    let u = U + TanSip.ev(this.AP, U, V), v = V + TanSip.ev(this.BP, U, V);
    // Newton refinement against forward SIP
    for (let i = 0; i < 4; i++) {
      const fu = u + TanSip.ev(this.A, u, v) - U, fv = v + TanSip.ev(this.B, u, v) - V;
      if (Math.abs(fu) < 1e-6 && Math.abs(fv) < 1e-6) break;
      const h = 0.5;
      const j11 = (1 + (TanSip.ev(this.A, u + h, v) - TanSip.ev(this.A, u - h, v)) / (2 * h));
      const j12 = (TanSip.ev(this.A, u, v + h) - TanSip.ev(this.A, u, v - h)) / (2 * h);
      const j21 = (TanSip.ev(this.B, u + h, v) - TanSip.ev(this.B, u - h, v)) / (2 * h);
      const j22 = (1 + (TanSip.ev(this.B, u, v + h) - TanSip.ev(this.B, u, v - h)) / (2 * h));
      const dt = j11 * j22 - j12 * j21;
      u -= (j22 * fu - j12 * fv) / dt; v -= (-j21 * fu + j11 * fv) / dt;
    }
    return [u + this.crpix[0], v + this.crpix[1]];
  }
}

// Gnomonic offsets (arcsec, +east, +north) about a centre -> ra/dec degrees
export function offsetToWorld(ra0, dec0, east, north) {
  const xi = east / 3600 * D2R, eta = north / 3600 * D2R, d0 = dec0 * D2R;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = ra0 * D2R + Math.atan2(xi, den);
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den));
  return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
}
export function worldToOffset(ra0, dec0, ra, dec) {
  const a0 = ra0 * D2R, d0 = dec0 * D2R, a = ra * D2R, d = dec * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = Math.cos(d) * Math.sin(a - a0) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return [xi * R2D * 3600, eta * R2D * 3600];
}
