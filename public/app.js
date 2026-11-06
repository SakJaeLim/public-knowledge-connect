const $ = selector => document.querySelector(selector);
let sources = [], selected, lastResult, busy = false;
const history = [];
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
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function webLink(value) { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
function choose(source) {
  selected = source; lastResult = undefined; history.length = 0;
  $('#result').replaceChildren(); $('#download').disabled = true; $('#back').hidden = true;
  $('#results-title').textContent = '조회 결과';
  $('#source-title').textContent = source.name; $('#source-description').textContent = source.description;
  $('#homepage').href = source.homepage; $('#record-uri').value = source.exampleUri;
  $('#example-label').textContent = '예시: ' + source.exampleLabel;
  $('#notice').textContent = source.notice; $('#official-note').textContent = source.officialMcpNote;
  $('#official-link').href = source.officialMcp;
  $('#search-form').hidden = !source.search;
  $('#uri-panel').open = !source.search;
  $('#search-term').value = '';
  $('#browse-help').textContent = source.search ? '검색어가 떠오르지 않으면 예시 직업부터 살펴보세요.' : '도서관 자료는 예시 목록에서 골라 원문을 확인하세요. 제목 검색은 아직 지원하지 않습니다.';
  $('#search-examples').replaceChildren();
  for (const term of source.search?.examples ?? []) {
    const button = element('button', term); button.type = 'button';
    button.addEventListener('click', () => { $('#search-term').value = term; run('search', { term }); });
    $('#search-examples').append(button);
  }
  $('#status').className = '';
  $('#status').textContent = source.search ? '검색어를 입력하면 기관의 실제 자료를 조회합니다.' : '아직 조회하지 않았습니다. 연결 상태는 실제 응답으로 확인합니다.';
  document.querySelectorAll('nav button').forEach(button => button.setAttribute('aria-current', String(button.dataset.source === source.id)));
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('nav button, #search, #search-term, #search-examples button, #examples, #describe, #limit, #record-uri, #back').forEach(node => { node.disabled = value; });
}
async function run(operation, extra = {}, remember = false) {
  if (busy || !selected) return;
  if (remember && lastResult) history.push(lastResult);
  else if (!remember) history.length = 0;
  $('#back').hidden = history.length === 0;
  lastResult = undefined; $('#download').disabled = true; $('#result').replaceChildren();
  setBusy(true); $('#status').className = '';
  $('#status').textContent = selected.name + '에 조회 중입니다. 최대 20초 기다립니다.';
  try {
    const response = await fetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: selected.id, operation, ...extra, limit: Number($('#limit').value) }) });
    const result = await response.json();
    if (!response.ok && !result.status) result.status = 'error';
    render(result);
  } catch {
    $('#status').className = 'error'; $('#status').textContent = '로컬 서버 응답을 받지 못했습니다. 서버 실행 상태를 확인해 주세요.';
  } finally { setBusy(false); }
}
function render(result) {
  lastResult = result; $('#download').disabled = false; $('#result').replaceChildren();
  $('#back').hidden = history.length === 0;
  const operation = result.provenance?.operation;
  $('#results-title').textContent = operation === 'search' ? '검색 결과' : operation === 'describe' ? '원문 내용' : '조회 결과';
  if (result.status === 'error') {
    $('#status').className = 'error';
    $('#status').textContent = (result.message || '요청을 처리하지 못했습니다.') + ' (' + (result.code || 'UNKNOWN') + ')';
    renderMetadata(result); return;
  }
  const term = result.provenance?.search?.term;
  $('#status').className = 'success';
  $('#status').textContent = result.status === 'empty'
    ? (term ? '이름에 검색어가 포함된 직업이 반환되지 않았습니다. 다른 표현으로 다시 찾아보세요.' : '이 질의에 반환된 행이 없습니다. 전체 기관 자료가 없다는 뜻은 아닙니다.')
    : selected.name + '에서 ' + result.returnedRows + '행을 받았습니다. ' + (result.hasMore ? '표시한 행 뒤에 결과가 더 있습니다.' : '이 요청 범위의 결과입니다.');
  if (term) $('#result').append(element('p', '검색어: ' + term + ' / 직업 이름 부분 일치', 'search-context'));
  if (result.rows?.length) renderTable(result);
  renderMetadata(result);
}
function renderTable(result) {
  const wrap = element('div', undefined, 'table-wrap');
  const table = element('table'), head = element('thead'), header = element('tr');
  result.columns.forEach(column => header.append(element('th', column === 'label' && selected.id === 'worknet' ? '직업 이름' : labels[column] || column)));
  head.append(header); table.append(head);
  const body = element('tbody');
  for (const row of result.rows) {
    const tr = element('tr');
    for (const column of result.columns) {
      const td = element('td'), cell = row[column];
      if (cell?.type === 'uri' && webLink(cell.value)) {
        if (column === 'predicate' && propertyLabels[cell.value]) td.append(element('strong', propertyLabels[cell.value]));
        const link = element('a', cell.value); link.href = cell.value; link.target = '_blank'; link.rel = 'noreferrer'; td.append(link);
        if (['uri', 'creator', 'value'].includes(column) && isSourceResource(selected.id, cell.value)) {
          const inspect = element('button', '원문 속성 조회'); inspect.type = 'button';
          inspect.addEventListener('click', () => { $('#record-uri').value = cell.value; run('describe', { uri: cell.value }, true); }); td.append(inspect);
        }
      } else if ((cell?.value.length ?? 0) > 600) {
        td.append(element('span', cell.value.slice(0, 600)));
        const details = element('details'); details.append(element('summary', '나머지 원문 보기'), element('p', cell.value.slice(600))); td.append(details);
      } else td.textContent = cell?.value ?? '';
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); wrap.append(table); $('#result').append(wrap);
}
function isSourceResource(id, uri) {
  return id === 'nlk' ? /^https?:\/\/lod\.nl\.go\.kr\/resource\/[A-Za-z0-9._~-]+$/.test(uri) : /^https?:\/\/lod\.work\.go\.kr\/job\/[\p{L}\p{N}._~\/-]+$/u.test(uri);
}
function renderMetadata(result) {
  const meta = element('div', undefined, 'metadata');
  if (result.startedAt) meta.append(element('span', '조회 ' + new Date(result.startedAt).toLocaleString('ko-KR')));
  if (Number.isFinite(result.durationMs)) meta.append(element('span', (result.durationMs / 1000).toFixed(2) + '초'));
  if (result.httpStatus) meta.append(element('span', 'HTTP ' + result.httpStatus));
  $('#result').append(meta);
  const details = element('details'); details.append(element('summary', '실행한 질의와 근거 정보'), element('pre', JSON.stringify(result, null, 2))); $('#result').append(details);
}
$('#search-form').addEventListener('submit', event => { event.preventDefault(); run('search', { term: $('#search-term').value.trim() }); });
$('#record-form').addEventListener('submit', event => { event.preventDefault(); run('describe', { uri: $('#record-uri').value.trim() }); });
$('#examples').addEventListener('click', () => run('examples'));
$('#back').addEventListener('click', () => {
  if (busy || !history.length) return;
  const previous = history.pop(); render(previous);
  if (previous.provenance?.resourceUri) $('#record-uri').value = previous.provenance.resourceUri;
  if (previous.provenance?.search?.term) $('#search-term').value = previous.provenance.search.term;
});
$('#download').addEventListener('click', () => {
  if (!lastResult) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = 'public-query-' + (lastResult.runId || 'error') + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const response = await fetch('/api/sources'); if (!response.ok) throw new Error('catalog'); sources = await response.json();
  for (const source of sources) {
    const button = element('button', source.name); button.dataset.source = source.id; button.type = 'button';
    button.append(element('small', source.englishName)); button.addEventListener('click', () => choose(source)); $('#sources').append(button);
  }
  choose(sources.find(source => source.search) ?? sources[0]); setBusy(false);
} catch {
  $('#source-title').textContent = '기관 목록을 불러오지 못했습니다'; $('#status').textContent = '서버를 실행한 뒤 이 화면을 새로고침해 주세요.';
}
