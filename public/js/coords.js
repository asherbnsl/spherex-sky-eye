// Parse decimal or sexagesimal 'RA Dec' strings.
export function parseCoords(str) {
  const s = str.trim().replace(/−/g, '-').replace(/[,;]/g, ' ').replace(/\s+/g, ' ');
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (m) { const ra = +m[1], dec = +m[2]; if (ra >= 0 && ra < 360 && Math.abs(dec) <= 90) return { ra, dec }; }
  const sex = s.replace(/[hdms:°′″'"]/gi, ' ').replace(/\s+/g, ' ').trim().split(' ');
  if (sex.length === 6) {
    const [h, mi, se, d, dm, ds] = sex.map(Number);
    if ([h, mi, se, d, dm, ds].every(Number.isFinite)) {
      const neg = /^-|^−/.test(sex[3]);
      const ra = (h + mi / 60 + se / 3600) * 15;
      const dec = (Math.abs(d) + dm / 60 + ds / 3600) * (neg ? -1 : 1);
      if (ra < 360 && Math.abs(dec) <= 90) return { ra, dec };
    }
  }
  return null;
}
