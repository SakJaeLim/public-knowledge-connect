const $ = s => document.querySelector(s);
let sources = [], selected, lastResult, busy = false;
const labels = { uri: '자료 주소', label: '자료 이름', creator: '작성자 연결', creatorName: '작성자 이름', predicate: '관계', value: '값' };
const propertyLabels = {
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type': '자료 유형',
  'http://www.w3.org/2000/01/rdf-schema#label': '이름',
  'http://purl.org/dc/terms/title': '제목',
  'http://purl.org/dc/terms/creator': '작성자',
  'http://xmlns.com/foaf/0.1/name': '이름',
  'http://lod.nl.go.kr/ontology/create': '작성한 자료',
  'http://lod.work.go.kr/job/업무/수행직무': '수행직무',
  'http://lod.work.go.kr/job/직업/직무개요': '직무개요',
};
function element(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function webLink(value) { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
function choose(source) {
  selected = source; lastResult = undefined; $('#result').replaceChildren(); $('#download').disabled = true;
  $('#source-title').textContent = source.name; $('#source-description').textContent = source.description;
  $('#homepage').href = source.homepage; $('#record-uri').value = source.exampleUri;
  $('#example-label').textContent = `예시: ${source.exampleLabel}`;
  $('#notice').textContent = source.notice; $('#official-note').textContent = source.officialMcpNote;
  $('#official-link').href = source.officialMcp;
  $('#status').className = ''; $('#status').textContent = '아직 조회하지 않았습니다. 연결 상태는 실제 응답으로 확인합니다.';
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.source === source.id)));
}
function setBusy(value) { busy = value; document.querySelectorAll('nav button, #examples, #describe, #limit, #record-uri').forEach(n => { n.disabled = value; }); }
async function run(operation, uri) {
  if (busy || !selected) return;
  const source = selected; lastResult = undefined; $('#download').disabled = true; $('#result').replaceChildren();
  setBusy(true); $('#status').className = ''; $('#status').textContent = `${source.name}에 조회 중입니다. 최대 20초 기다립니다.`;
  try {
    const response = await fetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source.id, operation, ...(uri ? { uri } : {}), limit: Number($('#limit').value) }) });
    const result = await response.json(); lastResult = result; $('#download').disabled = false;
    if (result.status === 'error' || !response.ok) {
      $('#status').className = 'error'; $('#status').textContent = `${result.message || '요청을 처리하지 못했습니다.'} (${result.code || response.status})`;
      renderMetadata(result); return;
    }
    $('#status').className = 'success';
    $('#status').textContent = result.status === 'empty' ? '이 질의에 반환된 행이 없습니다. 전체 기관 자료가 없다는 뜻은 아닙니다.' : `${source.name}에서 ${result.returnedRows}행을 받았습니다. ${result.hasMore ? '표시한 행 뒤에 결과가 더 있습니다.' : '이 요청 범위의 결과입니다.'} 사실 검증은 별도입니다.`;
    if (result.rows.length) {
      const wrap = element('div', undefined, 'table-wrap'); const table = element('table'); const head = element('thead'); const header = element('tr');
      result.columns.forEach(c => header.append(element('th', labels[c] || c))); head.append(header); table.append(head);
      const body = element('tbody');
      for (const row of result.rows) {
        const tr = element('tr');
        for (const col of result.columns) {
          const td = element('td'); const cell = row[col];
          if (cell?.type === 'uri' && webLink(cell.value)) {
            if (col === 'predicate' && propertyLabels[cell.value]) td.append(element('strong', propertyLabels[cell.value]));
            const a = element('a', cell.value); a.href = cell.value; a.target = '_blank'; a.rel = 'noreferrer'; td.append(a);
            if ((col === 'uri' || col === 'creator' || col === 'value') && isSourceResource(source.id, cell.value)) {
              const inspect = element('button', '원문 속성 조회'); inspect.type = 'button'; inspect.addEventListener('click', () => { $('#record-uri').value = cell.value; run('describe', cell.value); }); td.append(inspect);
            }
          } else if ((cell?.value.length ?? 0) > 600) {
            td.append(element('span', cell.value.slice(0, 600))); const details = element('details'); details.append(element('summary', '나머지 원문 보기'), element('p', cell.value.slice(600))); td.append(details);
          } else td.textContent = cell?.value ?? '';
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body); wrap.append(table); $('#result').append(wrap);
    }
    renderMetadata(result);
  } catch { $('#status').className = 'error'; $('#status').textContent = '로컬 서버 응답을 받지 못했습니다. 서버 실행 상태를 확인해 주세요.'; }
  finally { setBusy(false); }
}
function isSourceResource(id, uri) {
  return id === 'nlk' ? /^https?:\/\/lod\.nl\.go\.kr\/resource\/[A-Za-z0-9._~-]+$/.test(uri) : /^https?:\/\/lod\.work\.go\.kr\/job\/[\p{L}\p{N}._~\/-]+$/u.test(uri);
}
function renderMetadata(result) {
  const meta = element('div', undefined, 'metadata');
  if (result.startedAt) meta.append(element('span', `조회 ${new Date(result.startedAt).toLocaleString('ko-KR')}`));
  if (Number.isFinite(result.durationMs)) meta.append(element('span', `${(result.durationMs / 1000).toFixed(2)}초`));
  if (result.httpStatus) meta.append(element('span', `HTTP ${result.httpStatus}`));
  $('#result').append(meta);
  const details = element('details'); details.append(element('summary', '실행한 질의와 근거 정보')); details.append(element('pre', JSON.stringify(result, null, 2))); $('#result').append(details);
}
$('#record-form').addEventListener('submit', e => { e.preventDefault(); run('describe', $('#record-uri').value.trim()); });
$('#examples').addEventListener('click', () => run('examples'));
$('#download').addEventListener('click', () => {
  if (!lastResult) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' }));
  const a = element('a'); a.href = url; a.download = `public-query-${lastResult.runId || 'error'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const response = await fetch('/api/sources'); if (!response.ok) throw new Error('catalog'); sources = await response.json();
  for (const source of sources) { const button = element('button', source.name); button.dataset.source = source.id; button.type = 'button'; button.append(element('small', source.englishName)); button.addEventListener('click', () => choose(source)); $('#sources').append(button); }
  choose(sources[0]); setBusy(false);
} catch { $('#source-title').textContent = '기관 목록을 불러오지 못했습니다'; $('#status').textContent = '서버를 실행한 뒤 이 화면을 새로고침해 주세요.'; }
