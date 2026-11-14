// GET /api/resolve?name=Barnard's Star
// Name -> J2000 position + proper motion, via the CDS Sesame name resolver.
import { getQuery, send, fetchText } from './_lib.js';

export default async function handler(req, res) {
  try {
    const name = String(getQuery(req).name || '').slice(0, 120);
    if (!name.trim()) throw new Error('missing name');
    const xml = await fetchText('https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?' + encodeURIComponent(name));
    const g = tag => { const m = xml.match(new RegExp(`<${tag}>\\s*([^<]+)</${tag}>`)); return m ? m[1].trim() : null; };
    const ra = parseFloat(g('jradeg')), dec = parseFloat(g('jdedeg'));
    if (!Number.isFinite(ra)) return send(res, 404, { error: 'Name not found: ' + name });
    const pm = tag => { const v = parseFloat(g(tag)); return Number.isFinite(v) ? v : 0; };
    send(res, 200, {
      name, ra, dec, pmra: pm('pmRA'), pmdec: pm('pmDE'), epoch: 2000.0,
      oname: g('oname'), otype: g('otype'),
    }, 86400);
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
}
