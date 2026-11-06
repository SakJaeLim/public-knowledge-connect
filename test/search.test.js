import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildQuery, listSources } from '../src/catalog.js';
import { queryPublicRecords } from '../src/query.js';
import { createMcpServer } from '../src/mcp.js';

const search = { source: 'worknet', operation: 'search', term: '디자인', limit: 5 };
const fixture = { head: { vars: ['uri', 'label'] }, results: { bindings: [
  { uri: { type: 'uri', value: 'http://lod.work.go.kr/job/직업/test' }, label: { type: 'literal', value: '테스트 디자인 직업' } },
] } };

test('catalog advertises name search only for the verified source', () => {
  const sources = listSources();
  assert.equal(sources.find(s => s.id === 'nlk').capabilities.includes('search'), false);
  assert.ok(sources.find(s => s.id === 'worknet').capabilities.includes('search'));
  assert.equal(sources.find(s => s.id === 'worknet').search.mode, 'label_contains');
});

test('unsupported, ambiguous and unbounded search requests never reach a source', async () => {
  let calls = 0;
  const invalid = [
    { ...search, source: 'nlk' }, { ...search, term: 'a' }, { ...search, term: ' '.repeat(10) },
    { ...search, term: 'x'.repeat(81) }, { ...search, term: '디자\n인' },
    { ...search, term: undefined }, { ...search, uri: 'http://lod.work.go.kr/job/직업/A012001' },
    { ...search, operation: 'examples' }, { ...search, operation: 'describe', uri: 'http://lod.work.go.kr/job/직업/A012001' },
  ];
  for (const input of invalid) {
    const result = await queryPublicRecords(input, { fetchImpl: async () => { calls++; return new Response('{}'); } });
    assert.equal(result.code, 'INVALID_REQUEST');
  }
  assert.equal(calls, 0);
});

test('quotes and SPARQL-looking input remain one escaped literal', () => {
  const query = buildQuery({ ...search, term: '디자인") } SERVICE <https://example.org/> { ?s ?p "x\\y' });
  const literals = query.match(/"(?:[^"\\]|\\.)*"/g);
  assert.equal(literals.length, 1);
  assert.equal(JSON.parse(literals[0]), '디자인") } SERVICE <https://example.org/> { ?s ?p "x\\y');
  const outsideLiteral = query.replace(literals[0], '"term"');
  assert.equal(outsideLiteral.includes('SERVICE'), false);
  assert.match(query, /LIMIT 6$/);
});

test('normalized search term and the executed query travel with the evidence', async () => {
  let calledUrl;
  const result = await queryPublicRecords({ ...search, term: '  디자인  '.normalize('NFD') }, { fetchImpl: async url => {
    calledUrl = url; return new Response(JSON.stringify(JSON.stringify(fixture)));
  } });
  assert.equal(result.status, 'ok'); assert.equal(result.provenance.search.term, '디자인');
  assert.equal(result.provenance.operation, 'search'); assert.equal(result.provenance.resourceUri, null);
  assert.equal(calledUrl.searchParams.get('query'), result.provenance.query);
  assert.match(result.provenance.query, /ORDER BY \?label \?uri LIMIT 6$/);
});

test('a failed search is never reported as zero matches', async () => {
  const result = await queryPublicRecords(search, { fetchImpl: async () => new Response('not found', { status: 404 }) });
  assert.equal(result.status, 'error'); assert.equal(result.code, 'UPSTREAM_HTTP_ERROR');
  assert.equal(result.provenance.search.term, '디자인'); assert.equal(result.returnedRows, undefined);
});

test('MCP client can search, then describe a returned URI', async t => {
  const calls = [];
  const server = createMcpServer(async input => { calls.push(input); return { status: 'ok', rows: fixture.results.bindings }; });
  const client = new Client({ name: 'search-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(a); await client.connect(b);
  const found = await client.callTool({ name: 'query_public_records', arguments: search });
  const uri = JSON.parse(found.content[0].text).rows[0].uri.value;
  await client.callTool({ name: 'query_public_records', arguments: { source: 'worknet', operation: 'describe', uri } });
  assert.equal(calls[0].operation, 'search'); assert.equal(calls[1].operation, 'describe');
  assert.equal(calls[1].uri, uri); assert.equal(calls[1].term, undefined);
});
