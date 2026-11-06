import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createWebServer } from '../src/web.js';

async function setup(t, query) {
  const server = createWebServer(query); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('loopback app serves the module and source catalog with a restrictive CSP', async t => {
  const { url } = await setup(t);
  const page = await fetch(url); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /script type="module" src="app.js"/);
  for (const path of ['/app.js', '/style.css', '/search.css', '/open-props.min.css', '/network.svg']) assert.equal((await fetch(url + path)).status, 200);
  const sources = await (await fetch(url + '/api/sources')).json(); assert.equal(sources.length, 2);
  assert.ok(sources.every(s => s.connectionStatus === 'not_checked'));
});

test('untrusted origins and Host headers cannot invoke local queries', async t => {
  let calls = 0; const { url, server } = await setup(t, async () => { calls++; return {}; });
  const badOrigin = post({}); badOrigin.headers.Origin = 'https://attacker.example';
  assert.equal((await fetch(url + '/api/query', badOrigin)).status, 403);
  const crossSite = post({}); crossSite.headers['Sec-Fetch-Site'] = 'cross-site';
  assert.equal((await fetch(url + '/api/query', crossSite)).status, 403);
  const code = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/api/sources', headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(code, 403); assert.equal(calls, 0);
});

test('malformed, oversized and unsupported requests fail before querying', async t => {
  let calls = 0; const { url } = await setup(t, async () => { calls++; return {}; });
  assert.equal((await fetch(url + '/api/query', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(url + '/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(url + '/api/query', post({ value: 'x'.repeat(9000) }))).status, 413);
  assert.equal((await fetch(url + '/api/query')).status, 404); assert.equal(calls, 0);
});

test('query results preserve upstream error codes without returning empty success', async t => {
  const { url } = await setup(t, async () => ({ status: 'error', code: 'TIMEOUT' }));
  const response = await fetch(url + '/api/query', post({ source: 'nlk' }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'error', code: 'TIMEOUT' });
});
