import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SOURCES, buildQuery } from './catalog.js';

export const inputSchema = z.strictObject({
  source: z.enum(['nlk', 'worknet']), operation: z.enum(['examples', 'describe']),
  uri: z.string().max(500).optional(), limit: z.number().int().min(1).max(20).default(5),
});
const cellSchema = z.object({
  type: z.enum(['uri', 'literal', 'typed-literal', 'bnode']), value: z.string().max(200_000),
  datatype: z.string().optional(), 'xml:lang': z.string().optional(),
});
const resultSchema = z.object({ head: z.object({ vars: z.array(z.string().max(100)).max(20) }),
  results: z.object({ bindings: z.array(z.record(z.string(), cellSchema)).max(1000) }) });

export function parseResults(text) {
  let data = JSON.parse(text);
  if (typeof data === 'string') data = JSON.parse(data);
  const parsed = resultSchema.parse(data);
  if (parsed.results.bindings.some(row => Object.keys(row).some(key => !parsed.head.vars.includes(key)))) throw new Error('UNDECLARED_COLUMN');
  return parsed;
}

export async function readBounded(response, maximum = 2_000_000) {
  if (Number(response.headers.get('content-length') ?? 0) > maximum) {
    await response.body?.cancel(); throw new Error('RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function queryPublicRecords(input, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const started = Date.now(); const runId = randomUUID();
  const base = { runId, startedAt: new Date(started).toISOString(), appVersion: '0.1.0', mode: 'live', factVerified: false };
  let parameters, query, profile;
  try { parameters = inputSchema.parse(input); query = buildQuery(parameters); profile = SOURCES[parameters.source]; }
  catch { return { ...base, status: 'error', code: 'INVALID_REQUEST', message: '지원하는 기관과 조회 방식, 원문 주소를 확인해 주세요.', durationMs: Date.now() - started }; }
  const provenance = { sourceId: profile.id, sourceName: profile.name, endpoint: profile.endpoint,
    documentation: profile.documentation, resourceUri: parameters.uri ?? null, query, limit: parameters.limit,
    notice: profile.notice, authentication: 'none' };
  const url = new URL(profile.endpoint); url.searchParams.set('query', query);
  if (profile.id === 'worknet') url.searchParams.set('resultType', 'JSON');
  else url.searchParams.set('format', 'application/sparql-results+json');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  let statusCode = null;
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/sparql-results+json, application/json' },
      signal: controller.signal, redirect: 'error' });
    statusCode = response.status;
    if (!response.ok) { await response.body?.cancel(); throw new Error('UPSTREAM_HTTP_ERROR'); }
    const text = await readBounded(response);
    let parsed;
    try { parsed = parseResults(text); } catch { throw new Error('INVALID_RESPONSE'); }
    const rows = parsed.results.bindings.slice(0, parameters.limit);
    return { ...base, status: rows.length ? 'ok' : 'empty', provenance,
      receivedAt: new Date().toISOString(), durationMs: Date.now() - started, httpStatus: statusCode,
      responseSha256: createHash('sha256').update(text).digest('hex'), columns: parsed.head.vars, rows,
      returnedRows: rows.length, hasMore: parsed.results.bindings.length > parameters.limit,
      coverage: 'bounded_query_not_full_dataset', freshness: 'source_update_time_unknown',
      sourceDataIsUntrusted: true };
  } catch (error) {
    const code = controller.signal.aborted ? 'TIMEOUT' : ['INVALID_RESPONSE', 'UPSTREAM_HTTP_ERROR', 'RESPONSE_TOO_LARGE'].includes(error.message) ? error.message : 'CONNECTION_FAILED';
    const messages = { TIMEOUT: '기관 응답이 제한 시간 안에 도착하지 않았습니다. 자료가 없다는 뜻은 아닙니다.',
      INVALID_RESPONSE: '기관이 예상한 결과 형식으로 응답하지 않았습니다. 검색 결과 없음으로 처리하지 않습니다.',
      UPSTREAM_HTTP_ERROR: `기관에서 HTTP ${statusCode} 오류를 반환했습니다.`,
      RESPONSE_TOO_LARGE: '응답이 허용 크기를 넘었습니다. 더 좁은 원문 조회를 사용해 주세요.',
      CONNECTION_FAILED: '기관에 연결하지 못했습니다. 네트워크와 원천 서비스 상태를 확인해 주세요.' };
    return { ...base, status: 'error', code, message: messages[code], provenance,
      httpStatus: statusCode, durationMs: Date.now() - started };
  } finally { clearTimeout(timer); }
}
