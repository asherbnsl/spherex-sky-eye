// GET /api/catalog?cat=gaia|allwise&ra=..&dec=..&r=<deg>
// Cone search of reference catalogues used as overlays:
//   gaia    -> ESA Gaia DR3 (positions at epoch 2016.0 + proper motions)
//   allwise -> NASA AllWISE (IRSA, mean epoch ~2010.5)
import { getQuery, send, num, parseCSV, fetchText } from './_lib.js';

export default async function handler(req, res) {
  let vizErr = null;
  try {
    const q = getQuery(req);
    const ra = num(q.ra, 0, 360), dec = num(q.dec, -90, 90), r = num(q.r || 0.05, 0.001, 0.5);
    let url, map;
    if (q.cat === 'gaia') {
      const adql = `SELECT TOP 2000 source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r})) ORDER BY phot_g_mean_mag`;
      url = 'https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql);
      map = s => ({ id: s.source_id, ra: +s.ra, dec: +s.dec, pmra: +s.pmra || 0, pmdec: +s.pmdec || 0, plx: +s.parallax || null, mag: +s.phot_g_mean_mag, epoch: 2016.0 });
    } else if (q.cat === 'allwise') {
      // CDS VizieR copy of AllWISE first (fast), NASA IRSA TAP as backup
      const viz = `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=II/328/allwise&-c=${ra}%20${dec >= 0 ? '%2B' : ''}${dec}&-c.rd=${r}&-out=AllWISE,RAJ2000,DEJ2000,W1mag,W2mag,pmRA,pmDE&-out.max=2000&-sort=W2mag`;
      try {
        const lines = (await fetchText(viz, 10000, 1)).split('\n').filter(l => l && !l.startsWith('#'));
        const head = lines[0].split('\t').map(h => h.trim());
        const rows = lines.slice(3).map(l => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v.trim()])))
          .map(s => ({ id: s.AllWISE, ra: +s.RAJ2000, dec: +s.DEJ2000, w1: +s.W1mag, w2: +s.W2mag, pmra: +s.pmRA || 0, pmdec: +s.pmDE || 0, epoch: 2010.5 }))
          .filter(s => Number.isFinite(s.ra) && s.id);
        return send(res, 200, { cat: 'allwise', source: 'CDS VizieR II/328', count: rows.length, sources: rows }, 86400);
      } catch (e) { vizErr = String(e.message || e); }
      const adql = `SELECT TOP 2000 designation,ra,dec,w1mpro,w2mpro,pmra,pmdec FROM allwise_p3as_psd WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r}))=1`;
      url = 'https://irsa.ipac.caltech.edu/TAP/sync?FORMAT=csv&QUERY=' + encodeURIComponent(adql);
      map = s => ({ id: s.designation, ra: +s.ra, dec: +s.dec, w1: +s.w1mpro, w2: +s.w2mpro, pmra: +s.pmra || 0, pmdec: +s.pmdec || 0, epoch: 2010.5 });
    } else throw new Error('cat must be gaia or allwise');
    const rows = parseCSV(await fetchText(url, 15000, 1)).map(map).filter(s => Number.isFinite(s.ra));
    send(res, 200, { cat: q.cat, count: rows.length, sources: rows }, 86400);
  } catch (e) {
    send(res, 502, { error: String(e.message || e), ...(vizErr ? { vizier: vizErr } : {}) });
  }
}
