import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = new URL('../', import.meta.url);
const directory = new URL('artifacts/', root);
await mkdir(directory, { recursive: true });
const client = new Client({ name: 'search-verification', version: '0.2.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('src/mcp.js', root))], stderr: 'pipe' });
const records = [];
let failure = null;
async function query(arguments_) {
  const response = await client.callTool({ name: 'query_public_records', arguments: arguments_ });
  const result = JSON.parse(response.content[0].text);
  records.push(result);
  console.log(JSON.stringify({ operation: arguments_.operation, term: arguments_.term,
    status: result.status, code: result.code, rows: result.returnedRows, durationMs: result.durationMs }));
  assert.notEqual(result.status, 'error', result.message);
  return result;
}
try {
  await client.connect(transport);
  for (const term of ['디자인', '간호', '데이터']) {
    const result = await query({ source: 'worknet', operation: 'search', term, limit: 5 });
    assert.equal(result.status, 'ok', `No matching occupation names for ${term}`);
    assert(result.rows.every(row => row.label?.value.toLowerCase().includes(term.toLowerCase())));
    assert.equal(result.provenance.search.term, term);
    if (term === '디자인') {
      const uri = result.rows[0].uri.value;
      const detail = await query({ source: 'worknet', operation: 'describe', uri, limit: 20 });
      assert.equal(detail.status, 'ok');
      assert.equal(detail.provenance.resourceUri, uri);
      assert(detail.rows.some(row => row.value?.value === result.rows[0].label.value), 'Returned name not found in detail');
      assert(detail.rows.some(row => row.predicate?.value === 'http://lod.work.go.kr/job/업무/수행직무'
        && row.value?.type === 'literal' && row.value.value.length > 0), 'Occupation duties not found in detail');
    }
  }
  const empty = await query({ source: 'worknet', operation: 'search', term: '검색검증없는직업이름7e4c92', limit: 5 });
  assert.equal(empty.status, 'empty', 'The deliberate no-match query unexpectedly returned results');
} catch (error) {
  failure = { name: error.name, message: error.message };
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
  const report = {
    checkedAt: new Date().toISOString(), transport: 'official_sdk_stdio',
    platform: process.platform, node: process.version, scope: 'bounded_live_smoke_not_search_accuracy',
    passed: failure === null, failure, records,
  };
  const contents = JSON.stringify(report, null, 2) + '\n';
  await writeFile(new URL('search-verification-' + report.checkedAt.replaceAll(':', '-') + '.json', directory), contents);
  await writeFile(new URL('search-verification.json', directory), contents);
}
