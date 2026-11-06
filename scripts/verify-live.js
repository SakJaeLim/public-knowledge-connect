import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SOURCES } from '../src/catalog.js';

const root = new URL('../', import.meta.url);
const directory = new URL('artifacts/', root); await mkdir(directory, { recursive: true });
const client = new Client({ name: 'live-verification', version: '0.2.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('src/mcp.js', root))], stderr: 'pipe' });
const records = [];
try {
  await client.connect(transport);
  const catalog = await client.callTool({ name: 'list_public_sources', arguments: {} });
  if (JSON.parse(catalog.content[0].text).length !== 2) throw new Error('Unexpected source catalog');
  for (const source of Object.values(SOURCES)) {
    const response = await client.callTool({ name: 'query_public_records', arguments: { source: source.id, operation: 'describe', uri: source.exampleUri, limit: 5 } });
    const result = JSON.parse(response.content[0].text); records.push(result);
    console.log(JSON.stringify({ source: source.id, status: result.status, code: result.code, rows: result.returnedRows, durationMs: result.durationMs }));
  }
} finally { await client.close(); }
const report = { checkedAt: new Date().toISOString(), transport: 'official_sdk_stdio', platform: process.platform, node: process.version, records };
await writeFile(new URL('live-verification.json', directory), JSON.stringify(report, null, 2) + '\n');
if (records.length !== 2 || records.some(r => r.status !== 'ok')) process.exitCode = 1;
