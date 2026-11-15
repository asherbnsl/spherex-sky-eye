// SI disclosure: written with AI assistance (Claude, Anthropic) under the direction of Arsh Bansal (Team Shrapnel); reviewed and tested by the team.
// GET /api/catalog?cat=gaia|allwise&ra=..&dec=..&r=<deg>
// Cone search of reference catalogues used as overlays:
//   gaia    -> ESA Gaia DR3 (positions at epoch 2016.0 + proper motions)
//   allwise -> NASA AllWISE (IRSA, mean epoch ~2010.5)
import { rateLimited, getQuery, send, num, parseCSV, fetchText } from './_lib.js';

export default async function handler(req, res) {
  if (rateLimited(req, res)) return;
  let vizErr = null;
  try {
    const q = getQuery(req);
    const ra = num(q.ra, 0, 360), dec = num(q.dec, -90, 90), r = num(q.r || 0.05, 0.001, 0.5);
    let url, map;
    if (q.cat === 'gaia') {
      // ESA Gaia archive first; NASA MAST's copy of Gaia DR3 as backup
      const adql = `SELECT TOP 2000 source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r})) ORDER BY phot_g_mean_mag`;
      url = 'https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql);
      map = s => ({ id: s.source_id, ra: +s.ra, dec: +s.dec, pmra: +s.pmra || 0, pmdec: +s.pmdec || 0, plx: +s.parallax || null, mag: +s.phot_g_mean_mag, epoch: 2016.0 });
      try {
        const rows = parseCSV(await fetchText(url, 9000, 1)).map(map).filter(s => Number.isFinite(s.ra));
        return send(res, 200, { cat: 'gaia', source: 'ESA Gaia Archive', count: rows.length, sources: rows }, 86400);
      } catch (e) { vizErr = 'ESA: ' + String(e.message || e); }
      const rows = await gaiaFromMast(ra, dec, r);
      return send(res, 200, { cat: 'gaia', source: 'NASA MAST (Gaia DR3)', count: rows.length, sources: rows }, 86400);
    } else if (q.cat === 'allwise') {
      // ESA Gaia archive's copy of the NASA AllWISE catalogue first (reliable),
      // NASA IRSA TAP as backup
      const esa = `SELECT TOP 2000 designation,ra,dec,w1mpro,w2mpro FROM gaiadr1.allwise_original_valid WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r}))`;
      try {
        const rows = parseCSV(await fetchText('https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(esa), 12000, 1))
          .map(s => ({ id: s.designation, ra: +s.ra, dec: +s.dec, w1: +s.w1mpro, w2: +s.w2mpro, pmra: 0, pmdec: 0, epoch: 2010.5 }))
          .filter(s => Number.isFinite(s.ra));
        return send(res, 200, { cat: 'allwise', source: 'ESA Gaia archive copy of AllWISE', count: rows.length, sources: rows }, 86400);
      } catch (e) { vizErr = String(e.message || e); }
      const adql = `SELECT TOP 2000 designation,ra,dec,w1mpro,w2mpro,pmra,pmdec FROM allwise_p3as_psd WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r}))=1`;
      url = 'https://irsa.ipac.caltech.edu/TAP/sync?FORMAT=csv&QUERY=' + encodeURIComponent(adql);
      map = s => ({ id: s.designation, ra: +s.ra, dec: +s.dec, w1: +s.w1mpro, w2: +s.w2mpro, pmra: +s.pmra || 0, pmdec: +s.pmdec || 0, epoch: 2010.5 });
    } else throw new Error('cat must be gaia or allwise');
    const rows = parseCSV(await fetchText(url, 15000, 1)).map(map).filter(s => Number.isFinite(s.ra));
    send(res, 200, { cat: q.cat, count: rows.length, sources: rows }, 86400);
  } catch (e) {
    send(res, 502, { error: String(e.message || e), ...(vizErr ? { esa: vizErr } : {}) });
  }
}

// NASA MAST copy of Gaia DR3 (the resource linked from the challenge)
async function gaiaFromMast(ra, dec, r) {
  const request = { service: 'Mast.Catalogs.GaiaDR3.Cone', params: { ra, dec, radius: r }, format: 'json', pagesize: 2000, page: 1, removenullcolumns: true };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const resp = await fetch('https://mast.stsci.edu/api/v0/invoke', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'blinkscope (NASA Space Apps 2026)' },
      body: 'request=' + encodeURIComponent(JSON.stringify(request)),
    });
    if (!resp.ok) throw new Error('MAST ' + resp.status);
    const j = await resp.json();
    const data = j.data || [];
    return data.map(s => ({ id: String(s.source_id ?? s.solution_id ?? ''), ra: +s.ra, dec: +s.dec, pmra: +s.pmra || 0, pmdec: +s.pmdec || 0, plx: +s.parallax || null, mag: +(s.phot_g_mean_mag ?? s.phot_g_mean_mag), epoch: 2016.0 }))
      .filter(s => Number.isFinite(s.ra) && Number.isFinite(s.dec))
      .sort((a, b) => (a.mag || 99) - (b.mag || 99));
  } finally { clearTimeout(t); }
}
