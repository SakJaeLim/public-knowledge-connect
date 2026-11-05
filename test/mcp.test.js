import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';

test('official MCP client negotiates tools, validates inputs and receives source errors', async t => {
  let calls = 0;
  const server = createMcpServer(async () => { calls++; return { status: 'error', code: 'TIMEOUT', factVerified: false }; });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(a); await client.connect(b);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['list_public_sources', 'query_public_records']);
  const catalog = await client.callTool({ name: 'list_public_sources', arguments: {} });
  assert.equal(JSON.parse(catalog.content[0].text).length, 2);
  const result = await client.callTool({ name: 'query_public_records', arguments: { source: 'nlk', operation: 'examples' } });
  assert.equal(result.isError, true); assert.equal(JSON.parse(result.content[0].text).code, 'TIMEOUT');
  const invalid = await client.callTool({ name: 'query_public_records', arguments: { source: 'unknown', operation: 'examples' } });
  assert.equal(invalid.isError, true); assert.equal(calls, 1);
});
