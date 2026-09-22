/* Cafe24 연동 해제(cafe24-disconnect Edge Function + disconnect_cafe24_
   integration RPC) 검증.

   supabase/functions/cafe24-disconnect/index.ts와 supabase/migrations/
   20260922120000_cafe24_disconnect.sql은 각각 Deno 전용 모듈과 실제
   PostgreSQL 서버가 필요해 이 Node 테스트 러너에서 직접 실행할 수 없다
   (이 저장소에는 로컬 Deno·Postgres가 없다 — 별도 보고).

   그래서 이 파일은 두 층위로 검증한다:
   1) runDisconnect() — RPC 본문의 계약(소유권 확인 → 4개 테이블 provider=
      'cafe24' 스코프 삭제 → stores.external_store_id 초기화 → 삭제 개수
      반환)을 순수 JS in-memory 테이블로 그대로 재현해, 소유권 격리 ·
      provider 스코프 · idempotent 재호출을 실제로 실행해 검증한다.
   2) 실제 migration SQL · cafe24-disconnect/index.ts · stores.js ·
      config.toml 소스 텍스트를 읽어, 1)의 계약과 정확히 같은 구조(SECURITY
      DEFINER · search_path='' · GRANT/REVOKE · for update 잠금 · 원자적
      단일 RPC 호출 · 민감정보 미노출 · UI 확인창/중복 클릭 방지/Meta 회귀
      없음)가 실제 코드에 있는지 구조적으로 확인한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ===== 1) RPC 계약을 순수 JS로 재현 =========================================
// disconnect_cafe24_integration(p_store_id)의 규칙을 그대로 흉내낸 in-memory
// 모델. 실제 함수와 같은 순서(credentials → connected_accounts → orders →
// oauth_states → stores.external_store_id)로 지우고, 삭제 개수를 반환한다.
function makeDb({ stores, connectedAccounts, integrationCredentials, orders, oauthStates }) {
  return {
    stores: stores.map((s) => Object.assign({}, s)),
    connectedAccounts: connectedAccounts.map((r) => Object.assign({}, r)),
    integrationCredentials: integrationCredentials.map((r) => Object.assign({}, r)),
    orders: orders.map((r) => Object.assign({}, r)),
    oauthStates: oauthStates.map((r) => Object.assign({}, r)),
  };
}

function runDisconnect(db, authUid, pStoreId) {
  if (!authUid) {
    throw new Error('AUTH_REQUIRED');
  }
  const store = db.stores.find((s) => s.id === pStoreId && s.user_id === authUid);
  if (!store) {
    throw new Error('STORE_NOT_FOUND');
  }
  const prevExternalStoreId = store.external_store_id;

  const targetCaIds = db.connectedAccounts
    .filter((r) => r.store_id === pStoreId && r.provider === 'cafe24')
    .map((r) => r.id);

  const beforeIc = db.integrationCredentials.length;
  db.integrationCredentials = db.integrationCredentials.filter(
    (r) => !targetCaIds.includes(r.connected_account_id)
  );
  const icDeleted = beforeIc - db.integrationCredentials.length;

  const beforeCa = db.connectedAccounts.length;
  db.connectedAccounts = db.connectedAccounts.filter(
    (r) => !(r.store_id === pStoreId && r.provider === 'cafe24')
  );
  const caDeleted = beforeCa - db.connectedAccounts.length;

  const beforeOrders = db.orders.length;
  db.orders = db.orders.filter((r) => !(r.store_id === pStoreId && r.provider === 'cafe24'));
  const ordersDeleted = beforeOrders - db.orders.length;

  const beforeStates = db.oauthStates.length;
  db.oauthStates = db.oauthStates.filter(
    (r) => !(r.store_id === pStoreId && r.provider === 'cafe24')
  );
  const statesDeleted = beforeStates - db.oauthStates.length;

  store.external_store_id = null;

  return {
    connected_accounts_deleted: caDeleted,
    integration_credentials_deleted: icDeleted,
    orders_deleted: ordersDeleted,
    oauth_states_deleted: statesDeleted,
    store_external_id_cleared: prevExternalStoreId !== null && prevExternalStoreId !== undefined,
  };
}

function makeFixtureDb() {
  return makeDb({
    stores: [
      { id: 1, user_id: 'A', external_store_id: 'mallA', name: 'storeA' },
      { id: 2, user_id: 'A', external_store_id: null, name: 'storeA-other' },
      { id: 3, user_id: 'B', external_store_id: 'mallB', name: 'storeB' },
    ],
    connectedAccounts: [
      { id: 10, store_id: 1, provider: 'cafe24' },
      { id: 11, store_id: 1, provider: 'meta' },
      { id: 12, store_id: 3, provider: 'cafe24' },
    ],
    integrationCredentials: [
      { connected_account_id: 10, access_token: 'tok-cafe24' },
      { connected_account_id: 11, access_token: 'tok-meta' },
    ],
    orders: [
      { store_id: 1, provider: 'cafe24', external_order_id: 'o1' },
      { store_id: 1, provider: 'cafe24', external_order_id: 'o2' },
      { store_id: 2, provider: 'cafe24', external_order_id: 'o3' },
    ],
    oauthStates: [
      { store_id: 1, provider: 'cafe24' },
      { store_id: 1, provider: 'meta' },
    ],
  });
}

test('정상 소유자 호출 — 정확한 개수 삭제 + external_store_id NULL 초기화', () => {
  const db = makeFixtureDb();
  const r = runDisconnect(db, 'A', 1);
  assert.deepEqual(r, {
    connected_accounts_deleted: 1,
    integration_credentials_deleted: 1,
    orders_deleted: 2,
    oauth_states_deleted: 1,
    store_external_id_cleared: true,
  });
  assert.equal(db.stores.find((s) => s.id === 1).external_store_id, null);
});

test('다른 사용자(B)가 A 소유 store_id로 호출 → STORE_NOT_FOUND, 아무것도 삭제되지 않음', () => {
  const db = makeFixtureDb();
  assert.throws(() => runDisconnect(db, 'B', 1), /STORE_NOT_FOUND/);
  assert.equal(db.connectedAccounts.length, 3);
  assert.equal(db.integrationCredentials.length, 2);
  assert.equal(db.orders.length, 3);
  assert.equal(db.oauthStates.length, 2);
});

test('존재하지 않는 store_id → STORE_NOT_FOUND', () => {
  const db = makeFixtureDb();
  assert.throws(() => runDisconnect(db, 'A', 999), /STORE_NOT_FOUND/);
});

test('auth.uid()가 없으면(로그인 안 됨) AUTH_REQUIRED', () => {
  const db = makeFixtureDb();
  assert.throws(() => runDisconnect(db, null, 1), /AUTH_REQUIRED/);
});

test('같은 store의 Meta 연결·자격증명·oauth_state는 전혀 건드리지 않는다', () => {
  const db = makeFixtureDb();
  runDisconnect(db, 'A', 1);
  assert.ok(db.connectedAccounts.some((r) => r.id === 11 && r.provider === 'meta'));
  assert.ok(db.integrationCredentials.some((r) => r.connected_account_id === 11));
  assert.ok(db.oauthStates.some((r) => r.store_id === 1 && r.provider === 'meta'));
});

test('다른 store(같은 provider)의 주문과 다른 사용자(B)의 cafe24 연결은 그대로 유지된다', () => {
  const db = makeFixtureDb();
  runDisconnect(db, 'A', 1);
  assert.ok(db.orders.some((r) => r.store_id === 2 && r.provider === 'cafe24'), 'store_id 조건 누락 의심');
  assert.ok(db.connectedAccounts.some((r) => r.id === 12 && r.store_id === 3), 'B의 연결이 훼손됨');
  assert.ok(db.stores.some((s) => s.id === 3 && s.external_store_id === 'mallB'), 'B의 store가 훼손됨');
});

test('stores 행 자체와 다른 컬럼(name/user_id)은 유지된다 — external_store_id만 초기화', () => {
  const db = makeFixtureDb();
  runDisconnect(db, 'A', 1);
  const store = db.stores.find((s) => s.id === 1);
  assert.equal(store.name, 'storeA');
  assert.equal(store.user_id, 'A');
});

test('같은 요청을 두 번 호출해도 안전(idempotent) — 2회차는 전부 0/false', () => {
  const db = makeFixtureDb();
  runDisconnect(db, 'A', 1);
  const second = runDisconnect(db, 'A', 1);
  assert.deepEqual(second, {
    connected_accounts_deleted: 0,
    integration_credentials_deleted: 0,
    orders_deleted: 0,
    oauth_states_deleted: 0,
    store_external_id_cleared: false,
  });
});

test('이미 external_store_id가 NULL인 store를 해제해도 정상 동작(store_external_id_cleared=false)', () => {
  const db = makeFixtureDb();
  const r = runDisconnect(db, 'A', 2);
  assert.equal(r.store_external_id_cleared, false);
});

// ===== 2) 실제 소스 구조 검증 ================================================
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', '20260922120000_cafe24_disconnect.sql');
const MIGRATION_SRC = fs.readFileSync(MIGRATION_PATH, 'utf8');
const FN_SRC = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'cafe24-disconnect', 'index.ts'),
  'utf8'
);
const STORES_SRC = fs.readFileSync(path.join(ROOT, 'stores.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');

test('마이그레이션: SECURITY DEFINER + search_path 빈 값으로 고정', () => {
  assert.match(MIGRATION_SRC, /security definer\s*\nset search_path = ''/);
});

test('마이그레이션: stores 행을 for update로 잠근 뒤에만 진행한다(동시성 방어 + 소유권 재검증)', () => {
  const idx = MIGRATION_SRC.indexOf('select external_store_id into v_prev_external_store_id');
  assert.ok(idx > -1, '소유권 확인 select를 찾지 못함');
  const nearby = MIGRATION_SRC.slice(idx, idx + 300);
  assert.match(nearby, /where id = p_store_id\s*\n\s*and user_id = v_user_id/, 'auth.uid() 기준 소유권 조건이 없음');
  assert.match(nearby, /for update/, 'for update 잠금이 없음');
  assert.match(nearby, /if not found then\s*\n\s*raise exception 'STORE_NOT_FOUND'/, '소유자가 아니면 STORE_NOT_FOUND로 거부하지 않음');
});

test('마이그레이션: 4개 삭제 문장 모두 provider=\'cafe24\' 조건을 명시한다', () => {
  assert.match(MIGRATION_SRC, /delete from public\.integration_credentials\n\s*where connected_account_id in \(\n\s*select id from public\.connected_accounts\n\s*where store_id = p_store_id and provider = 'cafe24'/);
  assert.match(MIGRATION_SRC, /delete from public\.connected_accounts\n\s*where store_id = p_store_id and provider = 'cafe24'/);
  assert.match(MIGRATION_SRC, /delete from public\.orders\n\s*where store_id = p_store_id and provider = 'cafe24'/);
  assert.match(MIGRATION_SRC, /delete from public\.oauth_states\n\s*where store_id = p_store_id and provider = 'cafe24'/);
});

test('마이그레이션: integration_credentials를 connected_accounts보다 먼저 지운다(FK 순서 방어, meta-disconnect와 동일한 이유)', () => {
  const icIdx = MIGRATION_SRC.indexOf('delete from public.integration_credentials');
  const caIdx = MIGRATION_SRC.indexOf('delete from public.connected_accounts');
  assert.ok(icIdx > -1 && caIdx > -1 && icIdx < caIdx, 'integration_credentials 삭제가 connected_accounts보다 먼저 나와야 함');
});

test('마이그레이션: stores.external_store_id만 NULL로 초기화하고 stores 행 자체는 삭제하지 않는다', () => {
  assert.match(MIGRATION_SRC, /update public\.stores\n\s*set external_store_id = null/);
  assert.doesNotMatch(MIGRATION_SRC, /delete from public\.stores/, 'stores 행을 삭제하는 문장이 있으면 안 됨');
});

test('마이그레이션: 반환값에 access_token/refresh_token/raw_data 등 민감정보를 싣지 않는다(개수·boolean만)', () => {
  const returnIdx = MIGRATION_SRC.indexOf('return query');
  assert.ok(returnIdx > -1);
  const returnStmt = MIGRATION_SRC.slice(returnIdx, returnIdx + 200);
  assert.doesNotMatch(returnStmt, /access_token|refresh_token|raw_data/i);
});

test('마이그레이션: PUBLIC/anon EXECUTE 권한 회수 후 authenticated에만 부여', () => {
  assert.match(MIGRATION_SRC, /revoke all on function public\.disconnect_cafe24_integration\(bigint\) from public;/);
  assert.match(MIGRATION_SRC, /revoke all on function public\.disconnect_cafe24_integration\(bigint\) from anon;/);
  assert.match(MIGRATION_SRC, /grant execute on function public\.disconnect_cafe24_integration\(bigint\) to authenticated;/);
});

test('마이그레이션: 과거 migration 파일은 이번 작업에서 수정되지 않았다(새 파일만 추가)', () => {
  const untouched = [
    '20260921100000_orders_privilege_hardening.sql',
    '20260918120000_setup_inquiries_consent_rpc.sql',
    '20260922100000_setup_inquiries_privacy_v1_1.sql',
  ];
  for (const file of untouched) {
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase', 'migrations', file)), `${file}이 없어졌다`);
  }
  // 새 migration 파일명이 과거 파일보다 뒤 타임스탬프인지(정렬상 마지막에 적용됨).
  assert.match(path.basename(MIGRATION_PATH), /^20260922120000_/);
});

test('Edge Function: ctx.supabase(사용자 JWT)로 RPC를 호출한다(ctx.supabaseAdmin이 아님 — auth.uid() 해석을 위해 필수)', () => {
  assert.match(FN_SRC, /ctx\.supabase\.rpc\(\s*\n?\s*"disconnect_cafe24_integration"/);
});

test('Edge Function: RPC 호출 전에 ctx.supabase로 stores 소유권을 먼저 확인한다', () => {
  const rpcIdx = FN_SRC.indexOf('ctx.supabase.rpc(');
  const storeCheckIdx = FN_SRC.indexOf('.from("stores")');
  assert.ok(storeCheckIdx > -1 && storeCheckIdx < rpcIdx, 'stores 소유권 확인이 RPC 호출보다 먼저 있어야 함');
});

test('Edge Function: service_role로 개별 테이블을 순차 삭제하지 않는다(meta-disconnect 패턴 재사용 금지)', () => {
  assert.doesNotMatch(
    FN_SRC,
    /ctx\.supabaseAdmin[\s\S]{0,60}\.from\("(integration_credentials|connected_accounts|orders|oauth_states)"\)[\s\S]{0,20}\.delete\(/,
    '개별 테이블 delete가 있으면 원자성 요구사항 위반'
  );
});

test('Edge Function: 성공 응답은 { ok: true } 중심이고 삭제 개수·토큰 등을 반환하지 않는다', () => {
  assert.match(FN_SRC, /Response\.json\(\{ ok: true \}\)/);
  // 주석에는 "access_token/refresh_token" 언급이 있어도 되지만(민감정보를
  // 다루지 않는다는 설명), 실제로 응답에 실리는 코드(Response.json(...)
  // 호출 인자)에는 있으면 안 된다.
  const responseCalls = FN_SRC.match(/Response\.json\(\{[^}]*\}/g) || [];
  assert.ok(responseCalls.length > 0);
  for (const call of responseCalls) {
    assert.doesNotMatch(call, /access_token|refresh_token|raw_data/i, call);
  }
});

test('Edge Function: verify_jwt=true로 로그인 사용자만 호출 가능(config.toml)', () => {
  assert.match(CONFIG_SRC, /\[functions\.cafe24-disconnect\]\s*\nverify_jwt = true/);
});

test('Edge Function: 로그에 access_token/refresh_token/store_id 원문 등을 남기지 않는다', () => {
  const consoleCalls = FN_SRC.match(/console\.(error|log|warn)\([^)]*\)/g) || [];
  assert.ok(consoleCalls.length > 0);
  for (const call of consoleCalls) {
    const withoutStrings = call.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(withoutStrings, /access_token|refresh_token/i, call);
  }
});

test('stores.js: 연결된 Cafe24 카드에만 "연결 해제" 버튼이 보인다(미연결 카드에는 없음)', () => {
  const idx = STORES_SRC.indexOf("var cafe24DisconnectBtnHtml = '';");
  assert.ok(idx > -1);
  const nearby = STORES_SRC.slice(idx, idx + 900);
  assert.match(nearby, /if\(isConnected\)\{/, '연결된 경우에만 버튼을 만드는 조건이 없음');
  assert.match(nearby, /store-cafe24-disconnect-btn/);
});

test('stores.js: 클릭 시 정확한 확인 문구로 window.confirm을 띄우고, 확인 전에는 어떤 호출도 없다', () => {
  const idx = STORES_SRC.indexOf('function disconnectCafe24(');
  assert.ok(idx > -1);
  const body = STORES_SRC.slice(idx, STORES_SRC.indexOf('\n  }\n', idx));
  assert.match(
    body,
    /window\.confirm\('Cafe24 연결을 해제하면 저장된 연결 정보와 불러온 주문 데이터가 삭제됩니다\. 쇼핑몰 정보와 마진 계산 기록은 유지됩니다\.'\)/
  );
  // confirm 호출과 취소 시 return이 실제 함수 호출(sb.functions.invoke)보다 앞에 있어야 한다.
  const confirmIdx = body.indexOf('window.confirm(');
  const invokeIdx = body.indexOf('sb.functions.invoke(');
  assert.ok(confirmIdx > -1 && invokeIdx > -1 && confirmIdx < invokeIdx, 'confirm이 실제 호출보다 먼저 실행되어야 함');
});

test('stores.js: 처리 중 중복 클릭을 막는다(in-flight 가드 + 버튼 disabled)', () => {
  assert.match(STORES_SRC, /if\(cafe24DisconnectInFlightStoreIds\[storeId\]\) return;/);
  assert.match(STORES_SRC, /cafe24DisconnectInFlightStoreIds\[storeId\] = true;/);
  assert.match(STORES_SRC, /var isCafe24Disconnecting = !!cafe24DisconnectInFlightStoreIds\[String\(s\.id\)\];/);
});

test('stores.js: 성공 시 connected_accounts를 다시 조회해 화면을 즉시 미연결 상태로 되돌린다', () => {
  const idx = STORES_SRC.indexOf('function disconnectCafe24(');
  const body = STORES_SRC.slice(idx, STORES_SRC.indexOf('\n  }\n', idx));
  assert.match(body, /fetchConnectedAccounts\(seqAtStart\)/);
});

test('stores.js: 실패 시(에러 응답) 성공 처리로 넘어가지 않고 in-flight 상태를 해제한 뒤 오류를 안내한다', () => {
  const idx = STORES_SRC.indexOf('function disconnectCafe24(');
  const body = STORES_SRC.slice(idx, STORES_SRC.indexOf('\n  }\n', idx));
  assert.match(body, /delete cafe24DisconnectInFlightStoreIds\[storeId\];/);
  assert.match(body, /if\(res\.error\)\{/);
  assert.match(body, /if\(!data \|\| data\.ok !== true\)\{/);
});

test('stores.js: Meta 연결 해제(disconnectMeta) 기존 코드는 이번 작업으로 수정되지 않았다(회귀 없음)', () => {
  const metaIdx = STORES_SRC.indexOf('function disconnectMeta(');
  const metaBody = STORES_SRC.slice(metaIdx, STORES_SRC.indexOf('\n  }\n', metaIdx));
  assert.match(metaBody, /meta-disconnect/);
  assert.match(metaBody, /Meta 광고 연결을 해제할까요\?\\n저장된 Meta 인증 정보가 삭제됩니다\./);
  assert.doesNotMatch(metaBody, /cafe24/i, 'disconnectMeta 안에 cafe24 관련 코드가 섞이면 안 됨');
});

test('stores.js: cafe24DisconnectInFlightStoreIds가 hydrateFromSession의 세 초기화 지점 모두에서 정리된다(로그인 전환 시 이전 사용자 잠금이 새지 않음)', () => {
  // 선언부(var ... = {};) 1곳 + hydrateFromSession의 3개 분기(클라이언트
  // 없음/로그인/로그아웃) = 총 4곳에서 이 리터럴이 나와야 한다.
  const occurrences = STORES_SRC.split('cafe24DisconnectInFlightStoreIds = {};').length - 1;
  assert.equal(occurrences, 4, '선언 1곳 + hydrateFromSession 3개 분기 모두에서 초기화되어야 함');
});
