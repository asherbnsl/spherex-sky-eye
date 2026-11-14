// Local server: serves the static app from ./public and the proxy API from ./api.
// Usage:  node server.mjs   ->  http://localhost:8080
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import sia from './api/sia.js';
import resolve from './api/resolve.js';
import catalog from './api/catalog.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const routes = { '/api/sia': sia, '/api/resolve': resolve, '/api/catalog': catalog };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PORT = process.env.PORT || 8080;

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (routes[path]) return routes[path](req, res);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, () => console.log(`BLINKSCOPE running at http://localhost:${PORT}`));
