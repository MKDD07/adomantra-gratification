import http from 'node:http';
import path from 'node:path';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Load local development settings without requiring an additional package.
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requestOrigin = req.headers.origin || '';
    const apiCorsHeaders = /^https?:\/\/(localhost|127\.0\.0\.1):5500$/.test(requestOrigin)
      ? { 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin' }
      : {};

    if (pathname === '/api/pexels-search') {
      const query = (requestUrl.searchParams.get('query') || '').trim();
      if (!query || query.length > 160) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...apiCorsHeaders }).end(JSON.stringify({ error: 'Provide a search query of 1 to 160 characters.' }));
        return;
      }
      if (!process.env.PEXELS_API_KEY) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...apiCorsHeaders }).end(JSON.stringify({ error: 'Add PEXELS_API_KEY to .env and restart the server.' }));
        return;
      }

      try {
        const endpoint = new URL('https://api.pexels.com/v1/search');
        endpoint.searchParams.set('query', query);
        endpoint.searchParams.set('per_page', '1');
        endpoint.searchParams.set('orientation', 'landscape');
        const response = await fetch(endpoint, { headers: { Authorization: process.env.PEXELS_API_KEY } });
        if (!response.ok) {
          res.writeHead(502, { 'Content-Type': 'application/json', ...apiCorsHeaders }).end(JSON.stringify({ error: 'Pexels image search failed.' }));
          return;
        }
        const payload = await response.json();
        const photo = payload.photos?.[0];
        const image = photo?.src?.large2x || photo?.src?.large || photo?.src?.landscape || photo?.src?.medium || null;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...apiCorsHeaders }).end(JSON.stringify({ image }));
      } catch {
        res.writeHead(502, { 'Content-Type': 'application/json', ...apiCorsHeaders }).end(JSON.stringify({ error: 'Could not reach Pexels.' }));
      }
      return;
    }

    const segments = pathname.split('/');
    if (segments.some(segment => segment.startsWith('.'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const filename = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!filename.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filename);
    if (!info.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`Website running at http://localhost:${port} (listening on ${host})`);
});
