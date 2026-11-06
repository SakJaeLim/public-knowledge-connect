export const SOURCES = Object.freeze({
  nlk: Object.freeze({
    id: 'nlk', name: '국립중앙도서관', englishName: 'National Library of Korea',
    description: '국가서지 LOD의 자료와 작성자 관계를 조회합니다.',
    endpoint: 'https://lod.nl.go.kr/sparql', homepage: 'https://lod.nl.go.kr/home/',
    documentation: 'https://lod.nl.go.kr/home/sparql/getting.do',
    exampleUri: 'http://lod.nl.go.kr/resource/CMO201901189',
    exampleLabel: '아리랑 자료의 원문 속성',
    resourcePattern: /^https?:\/\/lod\.nl\.go\.kr\/resource\/[A-Za-z0-9._~-]+$/,
    exampleQuery: 'SELECT ?uri ?label ?creator ?creatorName WHERE { ?uri a <http://purl.org/ontology/bibo/Book> ; <http://www.w3.org/2000/01/rdf-schema#label> ?label ; <http://purl.org/dc/terms/creator> ?creator . ?creator <http://xmlns.com/foaf/0.1/name> ?creatorName . }',
    notice: '관계는 원천 데이터의 주장입니다. 실제 저작자 사실을 독립 검증한 결과가 아닙니다. 이미지와 원문 파일의 이용 조건은 별도 확인이 필요합니다.',
    officialMcp: 'https://www.nl.go.kr/NL/contents/N50603000000.do?id=58649&schBcid=normal0302&schM=view',
    officialMcpNote: '도서관 정보나루 공식 MCP는 국가서지 LOD와 별도 서비스입니다.',
  }),
  worknet: Object.freeze({
    id: 'worknet', name: '워크넷', englishName: 'Worknet',
    description: '직업 LOD의 이름과 수행직무, 개요를 조회합니다.',
    endpoint: 'https://lod.work.go.kr/jsonView.do', homepage: 'https://lod.work.go.kr/',
    documentation: 'https://lod.work.go.kr/lod_endpoint.do',
    exampleUri: 'http://lod.work.go.kr/job/직업/A012001',
    exampleLabel: '공군장교의 수행직무',
    search: Object.freeze({ mode: 'label_contains', minLength: 2, maxLength: 80,
      examples: ['디자인', '간호', '데이터'], documentation: 'https://lod.work.go.kr/lod_example.do' }),
    resourcePattern: /^https?:\/\/lod\.work\.go\.kr\/job\/[\p{L}\p{N}._~\/-]+$/u,
    exampleQuery: 'SELECT ?uri ?label WHERE { ?uri a <http://lod.work.go.kr/job/직업> ; <http://www.w3.org/2000/01/rdf-schema#label> ?label . }',
    notice: '채용 공고나 현재 모집 중인 훈련 목록이 아닙니다. 관련 자격과 다른 기관의 코드를 자동으로 연결하지 않습니다. 재배포 조건은 별도 확인이 필요합니다.',
    officialMcp: 'https://openapi.hrdkorea.or.kr/mcp.html',
    officialMcpNote: '자격과 NCS에는 HRDK 공식 MCP도 있습니다. 워크넷 LOD와 같은 원천으로 취급하지 않습니다.',
  }),
});

export function listSources() {
  return Object.values(SOURCES).map(({ resourcePattern, exampleQuery, ...publicSource }) => ({
    ...publicSource,
    capabilities: publicSource.search ? ['search', 'examples', 'describe'] : ['examples', 'describe'],
    unsupported: [...(publicSource.search ? [] : ['name_search']), 'semantic_search', 'cross_agency_join', 'qualification_eligibility'],
    connectionStatus: 'not_checked',
  }));
}

export function buildQuery({ source, operation, uri, term, limit }) {
  if (!Object.hasOwn(SOURCES, source)) throw new Error('UNKNOWN_SOURCE');
  const profile = SOURCES[source];
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_LIMIT');
  if (operation === 'search') {
    if (!profile.search) throw new Error('SEARCH_NOT_SUPPORTED');
    if (uri !== undefined) throw new Error('UNEXPECTED_URI');
    if (typeof term !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(term)) throw new Error('INVALID_TERM');
    const normalized = term.trim().normalize('NFC');
    if (normalized.length < 2 || normalized.length > 80) throw new Error('INVALID_TERM');
    const literal = JSON.stringify(normalized);
    return `SELECT DISTINCT ?uri ?label WHERE { ?uri a <http://lod.work.go.kr/job/직업> ; <http://www.w3.org/2000/01/rdf-schema#label> ?label . FILTER(CONTAINS(LCASE(STR(?label)), LCASE(${literal}))) } ORDER BY ?label ?uri LIMIT ${limit + 1}`;
  }
  if (term !== undefined) throw new Error('UNEXPECTED_TERM');
  if (operation === 'examples') {
    if (uri !== undefined) throw new Error('UNEXPECTED_URI');
    return `${profile.exampleQuery} LIMIT ${limit + 1}`;
  }
  if (operation !== 'describe') throw new Error('UNSUPPORTED_OPERATION');
  if (typeof uri !== 'string' || uri.length > 500 || !profile.resourcePattern.test(uri)) throw new Error('INVALID_SOURCE_URI');
  return `SELECT ?predicate ?value WHERE { <${uri}> ?predicate ?value . } LIMIT ${limit + 1}`;
}
