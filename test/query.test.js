import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildQuery } from '../src/catalog.js';
import { queryPublicRecords, parseResults, readBounded } from '../src/query.js';

const fixture = { head: { vars: ['label'] }, results: { bindings: [
  { label: { type: 'literal', value: '테스트 자료', 'xml:lang': 'ko' } },
  { label: { type: 'literal', value: '두 번째 자료' } },
] } };
const input = { source: 'nlk', operation: 'examples', limit: 1 };

test('fixed templates reject unsupported sources, injection, joins and excessive limits', () => {
  for (const invalid of [
    { ...input, source: 'toString' }, { ...input, source: 'arbitrary' },
    { ...input, limit: 21 }, { ...input, limit: 1.5 }, { ...input, operation: 'join' },
    { ...input, uri: 'http://lod.nl.go.kr/resource/test' },
    { ...input, operation: 'describe', uri: 'https://attacker.example/resource/test' },
    { ...input, operation: 'describe', uri: 'http://lod.nl.go.kr/resource/x> } SERVICE <http://localhost' },
  ]) assert.throws(() => buildQuery(invalid));
  assert.match(buildQuery({ source: 'worknet', operation: 'describe', uri: 'http://lod.work.go.kr/job/직업/A012001', limit: 20 }), /LIMIT 21$/);
});

test('both standard and double-encoded SPARQL JSON are accepted; malformed shapes are rejected', () => {
  for (const raw of [JSON.stringify(fixture), JSON.stringify(JSON.stringify(fixture))]) assert.deepEqual(parseResults(raw), fixture);
  for (const raw of ['<html>Error</html>', '{}', JSON.stringify({ ...fixture, head: { vars: [] } })]) assert.throws(() => parseResults(raw));
});

test('live-query adapter bounds rows and retains query, provenance and response hash', async () => {
  const raw = JSON.stringify(fixture); let request;
  const result = await queryPublicRecords(input, { fetchImpl: async (url, options) => { request = { url, options }; return new Response(raw); } });
  assert.equal(result.status, 'ok'); assert.equal(result.returnedRows, 1); assert.equal(result.hasMore, true);
  assert.equal(result.factVerified, false); assert.equal(result.sourceDataIsUntrusted, true);
  assert.equal(result.responseSha256, createHash('sha256').update(raw).digest('hex'));
  assert.match(result.provenance.query, /LIMIT 2$/); assert.equal(request.url.hostname, 'lod.nl.go.kr');
  assert.equal(request.options.redirect, 'error'); assert.match(request.options.headers.Accept, /sparql-results/);
});

test('Worknet requests the JSON endpoint and normalizes its double encoding', async () => {
  const result = await queryPublicRecords({ ...input, source: 'worknet' }, { fetchImpl: async url => {
    assert.equal(url.pathname, '/jsonView.do'); assert.equal(url.searchParams.get('resultType'), 'JSON');
    return new Response(JSON.stringify(JSON.stringify(fixture)));
  } });
  assert.equal(result.status, 'ok');
});

test('invalid requests never contact an endpoint', async () => {
  let calls = 0;
  const result = await queryPublicRecords({ ...input, endpoint: 'http://localhost' }, { fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(result.code, 'INVALID_REQUEST');
});

test('empty, HTTP failure, invalid format and timeout stay distinct', async () => {
  const empty = await queryPublicRecords(input, { fetchImpl: async () => new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } })) });
  assert.equal(empty.status, 'empty');
  const http = await queryPublicRecords(input, { fetchImpl: async () => new Response('failure', { status: 503 }) });
  assert.equal(http.code, 'UPSTREAM_HTTP_ERROR'); assert.equal(http.httpStatus, 503);
  const invalid = await queryPublicRecords(input, { fetchImpl: async () => new Response('<html>failure</html>') });
  assert.equal(invalid.code, 'INVALID_RESPONSE');
  const timeout = await queryPublicRecords(input, { timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  assert.equal(timeout.code, 'TIMEOUT'); assert.equal(timeout.status, 'error');
});

test('response byte limit applies with and without content-length', async () => {
  await assert.rejects(readBounded(new Response('12345'), 4), /RESPONSE_TOO_LARGE/);
  await assert.rejects(readBounded(new Response('a', { headers: { 'content-length': '100' } }), 4), /RESPONSE_TOO_LARGE/);
  assert.equal(await readBounded(new Response('가'), 3), '가');
});
