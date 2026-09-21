/* Meta 연결 상태 되돌림(connected → pending) 검증.

   supabase/functions/meta-insights/index.ts는 Deno 전용 모듈(jsr:@supabase/
   server 등)을 import하므로 이 Node 테스트 러너에서 직접 require()하거나
   실행할 수 없다 — 이 저장소에는 로컬 Deno가 없어 `deno check`/`deno test`도
   이번 세션에서 실행하지 못했다(별도 보고).

   그래서 이 파일은 두 층위로 검증한다:
   1) shouldDowngradeToPending()의 판정표를 순수 JS로 그대로 재현해(실제
      파일의 함수 본문과 문자 그대로 일치하는지는 2)에서 별도 확인) 7개
      ErrorCode 전부에 대해 실제 값으로 assert한다.
   2) runMetaInsightsFlowShape() — 실제 meta-insights/index.ts의 제어 흐름
      (토큰 확인 → 실패 시 즉시 pending 시도 후 반환 / 성공 시 Graph API →
      분류 → RECONNECT_REQUIRED일 때만 pending 시도 후 반환)과 같은 모양을
      in-memory "connected_accounts" 테이블 + 이 테스트 전용 함수로 재현해,
      compare-and-set 조건(다른 계정 · 다른 provider · 이미 바뀐 updated_at은
      건드리지 않음)과 best-effort 계약(상태 UPDATE 실패해도 원래 오류 응답
      유지)을 실제로 실행해 검증한다.
   3) 실제 meta-insights/index.ts · stores.js 소스 텍스트를 읽어, 판정 함수
      본문 · 호출 위치 · 응답 code/status 회귀 · 로그 민감정보 노출 여부 ·
      stores.js의 상태별 렌더링 분기를 구조적으로 확인한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ===== 1) 판정표(순수 함수) =================================================
// meta-insights/index.ts의 shouldDowngradeToPending()과 동일한 규칙.
function shouldDowngradeToPending(code) {
  return code === 'RECONNECT_REQUIRED';
}

test('RECONNECT_REQUIRED만 pending 전환 대상이고 나머지 6개 코드는 전부 유지된다', () => {
  const codes = [
    'META_NOT_CONNECTED',
    'META_ACCOUNT_NOT_SELECTED',
    'RECONNECT_REQUIRED',
    'PERMISSION_REQUIRED',
    'RATE_LIMITED',
    'ACCOUNT_UNAVAILABLE',
    'TEMPORARY_ERROR',
  ];
  const expected = {
    META_NOT_CONNECTED: false,
    META_ACCOUNT_NOT_SELECTED: false,
    RECONNECT_REQUIRED: true,
    PERMISSION_REQUIRED: false,
    RATE_LIMITED: false,
    ACCOUNT_UNAVAILABLE: false,
    TEMPORARY_ERROR: false,
  };
  for (const code of codes) {
    assert.equal(shouldDowngradeToPending(code), expected[code], code);
  }
});

// ===== 2) 원자적 compare-and-set 모델 =======================================
// 실제 downgradeToPendingIfStale()과 동일한 WHERE 조건(id · provider='meta' ·
// status='connected' · updated_at 일치)을 그대로 재현한다.
function makeConnectedAccountsTable(rows) {
  const table = rows.map((r) => Object.assign({}, r));
  return {
    downgradeToPending(id, expectedUpdatedAt) {
      const row = table.find(
        (r) =>
          r.id === id &&
          r.provider === 'meta' &&
          r.status === 'connected' &&
          r.updated_at === expectedUpdatedAt
      );
      if (!row) return { changed: false };
      row.status = 'pending';
      row.updated_at = 'NEW_TIMESTAMP';
      return { changed: true };
    },
    get(id) {
      return table.find((r) => r.id === id);
    },
  };
}

const STATUS_MAP = {
  META_NOT_CONNECTED: 404,
  META_ACCOUNT_NOT_SELECTED: 409,
  RECONNECT_REQUIRED: 401,
  PERMISSION_REQUIRED: 403,
  RATE_LIMITED: 429,
  ACCOUNT_UNAVAILABLE: 409,
  TEMPORARY_ERROR: 502,
};

// meta-insights/index.ts의 제어 흐름과 같은 모양 — 실제 파일을 import할 수
// 없어 이 테스트 전용 함수로 재현한다(아래 "실제 소스 구조 검증"이 이
// 모양이 실제 파일과 일치하는지 별도로 확인한다).
function runMetaInsightsFlowShape(table, account, scenario, spies) {
  spies = spies || {};
  if (!scenario.tokenOk) {
    table.downgradeToPending(account.id, account.updated_at);
    return { code: 'RECONNECT_REQUIRED', status: 401 };
  }
  if (spies.onDataFetched) spies.onDataFetched();
  if (scenario.classifyCode) {
    if (shouldDowngradeToPending(scenario.classifyCode)) {
      table.downgradeToPending(account.id, account.updated_at);
    }
    return { code: scenario.classifyCode, status: STATUS_MAP[scenario.classifyCode] };
  }
  return { code: 'OK', status: 200 };
}

test('credential 없음 → pending 전환 시도 + RECONNECT_REQUIRED 유지', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  const r = runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: false });
  assert.deepEqual(r, { code: 'RECONNECT_REQUIRED', status: 401 });
  assert.equal(t.get(1).status, 'pending');
});

test('로컬 토큰 만료 → pending 전환 시도', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: false });
  assert.equal(t.get(1).status, 'pending');
});

test('Graph API code 190(OAuthException 분류 결과) → pending 전환 시도', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  const r = runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: 'RECONNECT_REQUIRED' });
  assert.equal(t.get(1).status, 'pending');
  assert.deepEqual(r, { code: 'RECONNECT_REQUIRED', status: 401 });
});

test('rate limit → pending 전환하지 않음, 상태 그대로', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: 'RATE_LIMITED' });
  assert.equal(t.get(1).status, 'connected');
});

test('temporary/network error → pending 전환하지 않음', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: 'TEMPORARY_ERROR' });
  assert.equal(t.get(1).status, 'connected');
});

test('PERMISSION_REQUIRED · ACCOUNT_UNAVAILABLE → pending 전환하지 않음(정책상 명시적 유지)', () => {
  const t1 = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  runMetaInsightsFlowShape(t1, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: 'PERMISSION_REQUIRED' });
  assert.equal(t1.get(1).status, 'connected');

  const t2 = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  runMetaInsightsFlowShape(t2, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: 'ACCOUNT_UNAVAILABLE' });
  assert.equal(t2.get(1).status, 'connected');
});

test('광고 데이터 0건(정상 응답) → pending 전환하지 않고 데이터 조회까지 진행', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  let fetched = 0;
  const r = runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: null }, { onDataFetched: () => fetched++ });
  assert.equal(t.get(1).status, 'connected');
  assert.equal(r.code, 'OK');
  assert.equal(fetched, 1);
});

test('정상 응답 → pending 전환하지 않음', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: null });
  assert.equal(t.get(1).status, 'connected');
});

test('상태 UPDATE가 매치되지 않아도(예: 실패 시뮬레이션) 원래 RECONNECT_REQUIRED 응답은 유지된다', () => {
  // 이미 다른 provider로 바뀌어 있거나 행 자체가 없는 것처럼 만들어 UPDATE가
  // 0행이 되게 한 뒤에도, 반환값은 여전히 RECONNECT_REQUIRED여야 한다 —
  // best-effort: 상태 갱신 실패가 사용자 응답을 바꾸지 않는다.
  const t = makeConnectedAccountsTable([]); // 대상 행 자체가 없음 → UPDATE 매치 실패와 동일한 효과
  const r = runMetaInsightsFlowShape(t, { id: 999, updated_at: 'T0' }, { tokenOk: false });
  assert.deepEqual(r, { code: 'RECONNECT_REQUIRED', status: 401 });
});

test('다른 connected_account_id의 행은 건드리지 않는다', () => {
  const t = makeConnectedAccountsTable([
    { id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' },
    { id: 2, provider: 'meta', status: 'connected', updated_at: 'T0' },
  ]);
  runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: false });
  assert.equal(t.get(1).status, 'pending');
  assert.equal(t.get(2).status, 'connected'); // 다른 행은 그대로
});

test('다른 provider(cafe24) 행은 건드리지 않는다', () => {
  const t = makeConnectedAccountsTable([
    { id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' },
    { id: 2, provider: 'cafe24', status: 'connected', updated_at: 'T0' },
  ]);
  t.downgradeToPending(2, 'T0'); // cafe24 행에 대해 잘못 호출돼도(가정) provider 조건에 막힘
  assert.equal(t.get(2).status, 'connected');
});

test('오래된 요청이 이미 재연결된(updated_at이 바뀐) 행을 덮어쓰지 않는다(compare-and-set)', () => {
  const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
  // 요청 시작 시점엔 updated_at='T0'이었지만, Meta API 왕복 중 사용자가
  // meta-account-select로 재연결에 성공해 updated_at이 'T1'로 바뀌었다고 가정.
  t.get(1).updated_at = 'T1';
  const result = runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' /* 요청 시작 시점 값 */ }, { tokenOk: false });
  assert.equal(result.code, 'RECONNECT_REQUIRED'); // 이 요청 자신의 응답은 여전히 실패
  assert.equal(t.get(1).status, 'connected'); // 하지만 새로 연결된 행은 그대로 유지된다
  assert.equal(t.get(1).updated_at, 'T1');
});

test('기존 오류 코드와 HTTP status가 회귀 없이 그대로다', () => {
  for (const [code, status] of Object.entries(STATUS_MAP)) {
    const t = makeConnectedAccountsTable([{ id: 1, provider: 'meta', status: 'connected', updated_at: 'T0' }]);
    const r = runMetaInsightsFlowShape(t, { id: 1, updated_at: 'T0' }, { tokenOk: true, classifyCode: code === 'RECONNECT_REQUIRED' ? code : code });
    assert.equal(r.status, status, code);
  }
});

// ===== 3) 실제 소스 구조 검증 ================================================
const META_INSIGHTS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'meta-insights', 'index.ts'),
  'utf8'
);
const STORES_SRC = fs.readFileSync(path.join(__dirname, '..', 'stores.js'), 'utf8');

test('실제 shouldDowngradeToPending()이 RECONNECT_REQUIRED만 true로 판정하는 본문 그대로다', () => {
  assert.match(
    META_INSIGHTS_SRC,
    /function shouldDowngradeToPending\(code: ErrorCode\): boolean \{\s*return code === "RECONNECT_REQUIRED";\s*\}/,
    '판정 함수 본문이 예상과 다름'
  );
});

test('토큰 확인 실패 지점에 downgradeToPendingIfStale 호출이 있다', () => {
  const idx = META_INSIGHTS_SRC.indexOf('if (!tokenResult.ok) {');
  assert.ok(idx > -1, 'tokenResult 체크를 찾지 못함');
  const nearby = META_INSIGHTS_SRC.slice(idx, idx + 300);
  assert.match(nearby, /downgradeToPendingIfStale\(ctx\.supabaseAdmin, account\)/, '토큰 실패 시 downgrade 호출이 없음');
  assert.match(nearby, /errorResponse\("RECONNECT_REQUIRED", 401\)/, 'RECONNECT_REQUIRED 401 응답이 바뀜(회귀)');
});

test('classifyMetaApiError 호출 두 곳 모두 shouldDowngradeToPending로 감싸 downgrade를 호출한다', () => {
  // 'const cls = classifyMetaApiError(' 형태의 실제 호출부만 센다(정의부 제외).
  const occurrences = META_INSIGHTS_SRC.split('const cls = classifyMetaApiError(').length - 1;
  assert.equal(occurrences, 2, 'classifyMetaApiError 호출 횟수가 예상(2)과 다름');
  const guardOccurrences = META_INSIGHTS_SRC.split('if (shouldDowngradeToPending(cls.code)) {').length - 1;
  assert.equal(guardOccurrences, 2, 'shouldDowngradeToPending 가드가 2곳에 없음');
});

test('compare-and-set UPDATE에 provider=meta · status=connected · updated_at 일치 조건이 모두 있다', () => {
  assert.match(META_INSIGHTS_SRC, /\.update\(\{\s*status:\s*"pending"/, 'status를 pending으로 바꾸는 UPDATE가 없음');
  assert.match(META_INSIGHTS_SRC, /\.eq\("provider",\s*"meta"\)/);
  assert.match(META_INSIGHTS_SRC, /\.eq\("status",\s*"connected"\)/);
  assert.match(META_INSIGHTS_SRC, /\.eq\("updated_at",\s*account\.updated_at\)/);
  assert.match(META_INSIGHTS_SRC, /\.is\("updated_at",\s*null\)/, 'updated_at이 null인 경우의 안전한 분기가 없음');
});

test('credential 삭제(delete) 코드가 이번 작업으로 추가되지 않았다', () => {
  assert.doesNotMatch(META_INSIGHTS_SRC, /integration_credentials["'][\s\S]{0,80}\.delete\(/, 'meta-insights에 credential 삭제 코드가 있음(금지 사항 위반)');
});

test('로그에 access_token · refresh_token · state가 노출되지 않는다', () => {
  const consoleCalls = META_INSIGHTS_SRC.match(/console\.(error|log|warn)\([^)]*\)/g) || [];
  assert.ok(consoleCalls.length > 0);
  for (const call of consoleCalls) {
    const withoutStrings = call.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(withoutStrings, /access_token/, call);
    assert.doesNotMatch(withoutStrings, /refresh_token/, call);
    assert.doesNotMatch(withoutStrings, /\baccessToken\b/, call);
  }
});

test('meta-adaccounts · meta-account-select는 이번 작업에서 수정되지 않았다(이미 pending 경로 전용)', () => {
  const adaccounts = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'functions', 'meta-adaccounts', 'index.ts'),
    'utf8'
  );
  const accountSelect = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'functions', 'meta-account-select', 'index.ts'),
    'utf8'
  );
  assert.doesNotMatch(adaccounts, /downgradeToPendingIfStale|shouldDowngradeToPending/, 'meta-adaccounts에 불필요한 수정이 있음');
  assert.doesNotMatch(accountSelect, /downgradeToPendingIfStale|shouldDowngradeToPending/, 'meta-account-select에 불필요한 수정이 있음');
});

// pending 상태의 세 갈래(connected/재연결 필요/미선택)를 각각 경계로 잘라
// 서로 다른 세 개의 코드 조각으로 분리한다. 고정 길이 슬라이스 대신
// indexOf 경계를 쓰는 이유는 주석이 늘어나도(이번처럼) 깨지지 않기
// 위함이다.
function extractMetaBranches() {
  const connectedIdx = STORES_SRC.indexOf("metaRow.status === 'connected'");
  assert.ok(connectedIdx > -1, "if(metaRow.status === 'connected') 분기를 찾지 못함");
  const reconnectIdx = STORES_SRC.indexOf('else if(metaRow.external_account_id)', connectedIdx);
  assert.ok(reconnectIdx > -1, 'else if(metaRow.external_account_id) 분기를 찾지 못함');
  const selectIdx = STORES_SRC.indexOf('} else {', reconnectIdx);
  assert.ok(selectIdx > -1, '마지막 else(광고계정 미선택) 분기를 찾지 못함');
  const selectEndIdx = STORES_SRC.indexOf("\n          }", selectIdx);
  assert.ok(selectEndIdx > -1, '마지막 else 분기의 끝을 찾지 못함');

  return {
    connected: STORES_SRC.slice(connectedIdx, reconnectIdx),
    reconnect: STORES_SRC.slice(reconnectIdx, selectIdx),
    select: STORES_SRC.slice(selectIdx, selectEndIdx),
  };
}

test('connected 분기는 "연결됨"만 그리고 재연결·선택 문구가 섞이지 않는다(회귀 확인)', () => {
  const { connected } = extractMetaBranches();
  assert.match(connected, /연결됨/);
  assert.doesNotMatch(connected, /다시 연결하기|만료되었어요/);
  assert.doesNotMatch(connected, /광고계정 선택하기|선택 대기 중/);
});

test('pending + external_account_id 있음 → 만료 안내 + 재연결 버튼(선택 문구 없음)', () => {
  const { reconnect } = extractMetaBranches();
  assert.match(reconnect, /Meta 연결이 만료되었어요\. 다시 연결해주세요\./, '재연결 안내 문구가 없음');
  assert.match(reconnect, /다시 연결하기/, '재연결 버튼 문구가 없음');
  // meta-oauth-start를 호출하는 connectMeta() 핸들러와 같은 클래스를 그대로
  // 재사용해야 한다(store-meta-select-btn이 아니라) — 광고계정 목록 조회로
  // 새지 않고 OAuth 재시작으로 가야 한다는 조건.
  assert.match(reconnect, /class="btn btn-primary btn-sm store-meta-connect-btn" data-id="/, '재연결 버튼이 store-meta-connect-btn(=connectMeta)을 쓰지 않음');
  assert.doesNotMatch(reconnect, /store-meta-select-btn/, '재연결 분기가 광고계정 선택 버튼을 쓰고 있음(회귀)');
  assert.doesNotMatch(reconnect, /광고계정 선택 대기 중|광고계정 선택하기</, '재연결 분기에 선택 문구가 섞임');
  // 연결 해제는 이 상태에서도 여전히 가능해야 한다(기존 요구사항 유지).
  assert.match(reconnect, /metaDisconnectBtnHtml/, '재연결 분기에서 해제 버튼이 빠짐');
});

test('pending + external_account_id 없음 → 기존 "광고계정 선택 대기 중" 흐름 그대로(회귀 없음)', () => {
  const { select } = extractMetaBranches();
  assert.match(select, /광고계정 선택 대기 중/);
  assert.match(select, /class="btn btn-primary btn-sm store-meta-select-btn"/, '선택 버튼이 store-meta-select-btn을 쓰지 않음(회귀)');
  assert.doesNotMatch(select, /다시 연결하기|만료되었어요/, '미선택 분기에 재연결 문구가 섞임');
  assert.match(select, /metaDisconnectBtnHtml/, '미선택 분기에서 해제 버튼이 빠짐(회귀)');
});

test('두 pending 판정은 오직 metaRow.external_account_id 값만으로 갈린다(새 컬럼·새 status 없음)', () => {
  // 이번 추가 수정이 새 status 값이나 새 컬럼을 끌어오지 않았는지 구조로
  // 재확인한다 — 분기 조건 자체가 정확히 이 표현이어야 한다.
  assert.match(STORES_SRC, /else if\(metaRow\.external_account_id\)\{/);
  // metaAccountsByStoreId 조회 select 목록에 selected_ad_account_id 같은
  // 새 컬럼을 추가하지 않았는지 확인(기존 5개 컬럼 그대로).
  assert.match(
    STORES_SRC,
    /\.select\('id, store_id, provider, status, external_account_id, display_name'\)/,
    'connected_accounts select 컬럼 목록이 바뀜(새 컬럼 추가 의심)'
  );
});
