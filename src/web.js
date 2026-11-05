import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { listSources } from './catalog.js';
import { queryPublicRecords } from './query.js';

const publicRoot = new URL('../public/', import.meta.url);
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/open-props.min.css', ['open-props.min.css', 'text/css']], ['/network.svg', ['network.svg', 'image/svg+xml']]]);

export function createWebServer(queryFn = queryPublicRecords) {
  let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const port = res.socket.localPort;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(403, { code: 'INVALID_HOST' });
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(403, { code: 'INVALID_ORIGIN' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { code: 'CROSS_SITE' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/sources') return json(200, listSources());
    if (req.method === 'GET' && assets.has(url.pathname)) {
      try { const [file, type] = assets.get(url.pathname); const body = await readFile(new URL(file, publicRoot)); res.writeHead(200, { 'Content-Type': type }); res.end(body); }
      catch { json(500, { code: 'ASSET_UNAVAILABLE' }); }
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/query') return json(404, { code: 'NOT_FOUND' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { code: 'JSON_REQUIRED' });
    if (active >= 2) return json(429, { code: 'BUSY', message: '실행 중인 조회가 끝난 뒤 다시 시도해 주세요.' });
    active++;
    try {
      const chunks = []; let length = 0;
      for await (const part of req) {
        length += part.length; if (length > 8192) { json(413, { code: 'REQUEST_TOO_LARGE' }); return; }
        chunks.push(part);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, { code: 'INVALID_JSON' }); }
      const result = await queryFn(input); return json(result.code === 'INVALID_REQUEST' ? 400 : 200, result);
    } catch { if (!res.headersSent) json(500, { code: 'SERVER_ERROR' }); }
    finally { active--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PUBLIC_KNOWLEDGE_PORT || 8784);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const server = createWebServer(); server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  server.listen(port, '127.0.0.1', () => console.log(`Public Knowledge Connect: http://127.0.0.1:${port}/`));
}
