// GET /api/sia?ra=..&dec=..&collections=spherex_dr1
// Lists every SPHEREx spectral image covering a sky position (IRSA SIA v2),
// returned as compact JSON with direct links to NASA's AWS copy of each file.
import { rateLimited, getQuery, send, num, parseCSV, fetchText } from './_lib.js';

const ALLOWED = /^spherex_[a-z0-9_]+$/;
const IRSA_PREFIX = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/';
export const toS3 = url => url && url.startsWith(IRSA_PREFIX) ? 'https://nasa-irsa-spherex.s3.amazonaws.com/' + url.slice(IRSA_PREFIX.length) : null;

export default async function handler(req, res) {
  if (rateLimited(req, res)) return;
  try {
    const q = getQuery(req);
    const ra = num(q.ra, 0, 360), dec = num(q.dec, -90, 90);
    const cols = String(q.collections || 'spherex_dr1').split(',').filter(c => ALLOWED.test(c)).slice(0, 4);
    const params = cols.map(c => 'COLLECTION=' + c).join('&');
    const url = `https://irsa.ipac.caltech.edu/SIA?${params}&POS=circle+${ra}+${dec}+0.001&RESPONSEFORMAT=CSV`;
    const rows = parseCSV(await fetchText(url, 12000, 2));
    const seen = new Set();
    const images = [];
    for (const r of rows) {
      if (!r.obs_id || !r.energy_bandpassname) continue;
      const det = +String(r.energy_bandpassname || '').replace(/\D/g, '');
      const id = r.obs_id + '/' + det;
      if (seen.has(id)) continue;
      seen.add(id);
      // IRSA's CSV `cloud_access` JSON is not CSV-escaped, so derive the AWS
      // location from the archive path instead (identical layout on S3).
      const s3 = toS3(r.access_url);
      images.push({
        id, obs: r.obs_id, det,
        t: +r.t_min, tEnd: +r.t_max, exp: +r.t_exptime,
        wlMin: +r.em_min * 1e6, wlMax: +r.em_max * 1e6,
        url: r.access_url, s3,
        collection: r.obs_collection, released: r.obs_release_date,
      });
    }
    send(res, 200, { ra, dec, collections: cols, count: images.length, images }, 86400);
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
}
