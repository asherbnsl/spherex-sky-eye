// Shared helpers for the tiny proxy API (Vercel functions + local server.mjs).
// IRSA and some catalogue services do not send CORS headers, so the browser
// cannot call them directly; these functions forward a fixed, whitelisted
// query and return compact JSON.

export function getQuery(req) {
  if (req.query && Object.keys(req.query).length) return req.query;
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams);
}

export function send(res, status, obj, maxAge = 3600) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (status === 200) res.setHeader('Cache-Control', `public, max-age=300, s-maxage=${maxAge}, stale-while-revalidate=86400`);
  res.end(JSON.stringify(obj));
}

export function num(v, lo, hi) {
  const x = parseFloat(v);
  if (!Number.isFinite(x) || x < lo || x > hi) throw new Error('bad number: ' + v);
  return x;
}

// RFC4180-ish CSV parser (handles quoted fields with commas / doubled quotes)
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export async function fetchText(url, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'spherex-sky-viewer (hackathon)' } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
