// Shared helpers for the tiny proxy API (Vercel functions + local server.mjs).
// IRSA and some catalogue services do not send CORS headers, so the browser
// cannot call them directly; these functions forward a fixed, whitelisted
// query and return compact JSON.

// Simple per-IP rate limit (per serverless instance): protects the upstream
// archives and our function quota from abuse. 90 requests / minute / IP.
const hits = new Map();
export function rateLimited(req, res, limit = 90) {
  const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, t: now };
  if (now - h.t > 60000) { h.n = 0; h.t = now; }
  h.n++; hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  if (h.n > limit) { res.setHeader('Retry-After', '60'); send(res, 429, { error: 'Too many requests — slow down a little' }); return true; }
  return false;
}

export function getQuery(req) {
  if (req.query && Object.keys(req.query).length) return req.query;
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams);
}

export function send(res, status, obj, maxAge = 3600) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // long CDN caching + serve-stale-on-error keeps tested targets working even
  // when the upstream archive is briefly down
  if (status === 200) res.setHeader('Cache-Control', `public, max-age=300, s-maxage=${maxAge}, stale-while-revalidate=604800, stale-if-error=604800`);
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

export async function fetchText(url, timeoutMs = 25000, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'blinkscope (NASA Space Apps 2026)' } });
      const text = await r.text();
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      if (/^\s*<!DOCTYPE HTML|^\s*<html/i.test(text)) throw new Error('upstream returned an error page');
      return text;
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    } finally { clearTimeout(t); }
  }
  throw last;
}
