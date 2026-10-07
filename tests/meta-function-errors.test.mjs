// Meta 함수의 오류 응답 · 연결 상태 되돌림 · 요청 시간 제한 — 실행: node --test tests/meta-function-errors.test.mjs
// 실제 supabase/functions/<함수>/index.ts를 Node에서 실행한다(Deno 전용 import만 가짜, tests/helpers 참고).
// Supabase · Meta는 가짜이며 네트워크에 나가지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFunction, jsonRequest, fakeSupabase, setCtx, setEnv, fakeFetch, hangUntilAborted, shortenTimeouts, jsonResponse,
} from './helpers/edge-function-harness.mjs';

const { META_REQUEST_TIMEOUT_MS } = await import('../supabase/functions/_shared/meta-adset-normalize.mjs');

const ACCOUNT = { id: 7, store_id: 's1', provider: 'meta', status: 'connected', external_account_id: 'act_1', updated_at: '2026-10-01T00:00:00.000Z' };
const FUTURE = new Date(Date.now() + 30 * 86400e3).toISOString();
const CREDENTIAL_OK = { data: { access_token: 'meta-token', access_token_expires_at: FUTURE } };
const CREDENTIAL_MISSING = { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
const CREDENTIAL_DB_ERROR = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
const ACCOUNT_META = { name: '테스트 광고계정', currency: 'KRW', timezone_name: 'Asia/Seoul', account_status: 1 };
const OAUTH = 'OAuthException';

// 사용자(RLS) 클라이언트: 쇼핑몰 · Meta 연결 행. service role 클라이언트: 토큰 · 상태 되돌림.
function setup({ credential = CREDENTIAL_OK } = {}) {
  const user = fakeSupabase({
    stores: () => ({ data: { id: 's1' } }),
    connected_accounts: () => ({ data: { ...ACCOUNT } }),
  });
  const admin = fakeSupabase({
    integration_credentials: () => credential,
    connected_accounts: () => ({ data: null, error: null }),
  });
  setCtx({ supabase: user, supabaseAdmin: admin });
  return { user, admin };
}
const downgrades = (admin) => admin.calls.filter((c) => c.table === 'connected_accounts' && c.op === 'update');
const metaCalls = (calls) => calls.filter((c) => c.url.startsWith('https://graph.facebook.com/'));

// Graph API 가짜: 계정 정보 요청 · 인사이트 요청을 나눠 응답한다.
function graph({ account = () => jsonResponse(200, ACCOUNT_META), insights = () => jsonResponse(200, { data: [] }), adaccounts } = {}) {
  return fakeFetch((url, init) => {
    if (url.includes('/insights')) return insights(url, init);
    if (url.includes('/me/adaccounts')) return adaccounts(url, init);
    return account(url, init);
  });
}

const metaInsights = await loadFunction('meta-insights');
const adsetInsights = await loadFunction('meta-adset-insights');
const adaccounts = await loadFunction('meta-adaccounts');
const accountSelect = await loadFunction('meta-account-select');
const metaCallback = await loadFunction('meta-oauth-callback');

const callInsights = () => metaInsights(jsonRequest({ connected_account_id: 7 }));
const callAdsets = () => adsetInsights(jsonRequest({ store_id: 's1', scope: 'adsets', period: 'today' }));

// ---------------------------------------------------------------- meta-insights
test('meta-insights: 정상 조회는 그대로 성공한다(모든 Meta 요청에 시간 제한 signal)', async () => {
  setup();
  const calls = graph({ insights: () => jsonResponse(200, { data: [{ spend: '1000', impressions: '100', clicks: '4' }] }) });
  const res = await callInsights();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.today.spend, 1000);
  assert.equal(metaCalls(calls).length, 3); // 계정 정보 + 오늘 + 이번 달
  for (const c of metaCalls(calls)) assert.ok(c.init.signal instanceof AbortSignal, c.url);
});

test('meta-insights: 요청 한도(code 17 + OAuthException)는 429 RATE_LIMITED · 연결 유지', async () => {
  const { admin } = setup();
  graph({ insights: () => jsonResponse(400, { error: { code: 17, type: OAUTH, message: 'User request limit reached' } }) });
  const res = await callInsights();
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, 'RATE_LIMITED');
  assert.equal(downgrades(admin).length, 0, '요청 한도로 연결을 pending으로 내리면 안 됨');
});

test('meta-insights: 권한 오류(code 200 + OAuthException)는 403 PERMISSION_REQUIRED · 연결 유지', async () => {
  const { admin } = setup();
  graph({ account: () => jsonResponse(400, { error: { code: 200, type: OAUTH } }) });
  const res = await callInsights();
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'PERMISSION_REQUIRED');
  assert.equal(downgrades(admin).length, 0);
});

test('meta-insights: Meta 5xx(본문 HTML)는 502 TEMPORARY_ERROR · 연결 유지', async () => {
  const { admin } = setup();
  graph({ account: () => new Response('<html>Service Unavailable</html>', { status: 503 }) });
  const res = await callInsights();
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'TEMPORARY_ERROR');
  assert.equal(downgrades(admin).length, 0);
});

test('meta-insights: 토큰 만료(code 190)는 401 RECONNECT_REQUIRED · 연결을 pending으로(조건부)', async () => {
  const { admin } = setup();
  graph({ account: () => jsonResponse(400, { error: { code: 190, type: OAUTH, error_subcode: 463 } }) });
  const res = await callInsights();
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'RECONNECT_REQUIRED');
  const d = downgrades(admin);
  assert.equal(d.length, 1);
  assert.equal(d[0].values.status, 'pending');
  assert.deepEqual(d[0].filters.find((f) => f[1] === 'updated_at'), ['eq', 'updated_at', ACCOUNT.updated_at]);
});

test('meta-insights: 토큰 조회 DB 오류는 500 INTERNAL_ERROR — 연결 안 됨으로 오인하지 않음', async () => {
  const { admin } = setup({ credential: CREDENTIAL_DB_ERROR });
  const calls = graph();
  const res = await callInsights();
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, 'INTERNAL_ERROR');
  assert.equal(downgrades(admin).length, 0, 'DB 오류로 연결을 pending으로 내리면 안 됨');
  assert.equal(metaCalls(calls).length, 0);
});

test('meta-insights: 토큰 행이 실제로 없으면(PGRST116) 기존대로 401 RECONNECT_REQUIRED · pending', async () => {
  const { admin } = setup({ credential: CREDENTIAL_MISSING });
  graph();
  const res = await callInsights();
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'RECONNECT_REQUIRED');
  assert.equal(downgrades(admin).length, 1);
});

test('meta-insights: Meta 응답이 오지 않으면 시간 제한 뒤 502 TEMPORARY_ERROR · 연결 유지', { timeout: 5000 }, async () => {
  const { admin } = setup();
  const t = shortenTimeouts(20);
  try {
    graph({ account: (_u, init) => hangUntilAborted(init) });
    const res = await callInsights();
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'TEMPORARY_ERROR');
    assert.equal(downgrades(admin).length, 0);
    assert.ok(t.requested.includes(META_REQUEST_TIMEOUT_MS), '시간 제한 상수로 요청하지 않음: ' + JSON.stringify(t.requested));
  } finally { t.restore(); }
});

// ---------------------------------------------------------------- meta-adset-insights
test('meta-adset-insights: 요청 한도(code 4 + OAuthException)는 429 · 연결 유지', async () => {
  const { admin } = setup();
  graph({ insights: () => jsonResponse(400, { error: { code: 4, type: OAUTH } }) });
  const res = await callAdsets();
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, 'RATE_LIMITED');
  assert.equal(downgrades(admin).length, 0);
});

test('meta-adset-insights: 토큰 조회 DB 오류는 500 INTERNAL_ERROR · 연결 유지', async () => {
  const { admin } = setup({ credential: CREDENTIAL_DB_ERROR });
  graph();
  const res = await callAdsets();
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, 'INTERNAL_ERROR');
  assert.equal(downgrades(admin).length, 0);
});

test('meta-adset-insights: 인사이트 응답이 오지 않으면 502 TEMPORARY_ERROR', { timeout: 5000 }, async () => {
  const { admin } = setup();
  const t = shortenTimeouts(20);
  try {
    graph({ insights: (_u, init) => hangUntilAborted(init) });
    const res = await callAdsets();
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'TEMPORARY_ERROR');
    assert.equal(downgrades(admin).length, 0);
  } finally { t.restore(); }
});

test('meta-adset-insights: 정상 조회는 그대로 성공한다', async () => {
  setup();
  const calls = graph({ insights: () => jsonResponse(200, { data: [{ adset_id: '11', adset_name: 'A', campaign_id: '1', campaign_name: 'C', spend: '500' }] }) });
  const res = await callAdsets();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  for (const c of metaCalls(calls)) assert.ok(c.init.signal instanceof AbortSignal, c.url);
});

// ---------------------------------------------------------------- meta-adaccounts · meta-account-select
const callAdaccounts = () => adaccounts(jsonRequest({ connected_account_id: 7 }));

test('meta-adaccounts: 토큰 만료(code 190)는 401 RECONNECT_REQUIRED로 알려 화면이 재연결 안내를 띄울 수 있다', async () => {
  setup();
  graph({ adaccounts: () => jsonResponse(400, { error: { code: 190, type: OAUTH } }) });
  const res = await callAdaccounts();
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'RECONNECT_REQUIRED');
});

test('meta-adaccounts: 요청 한도는 429 RATE_LIMITED', async () => {
  setup();
  graph({ adaccounts: () => jsonResponse(400, { error: { code: 17, type: OAUTH } }) });
  const res = await callAdaccounts();
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, 'RATE_LIMITED');
});

test('meta-adaccounts: 토큰 조회 DB 오류는 연결 없음(CREDENTIAL_NOT_FOUND)이 아니라 조회 실패로 응답', async () => {
  setup({ credential: CREDENTIAL_DB_ERROR });
  graph();
  const res = await callAdaccounts();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.code, 'CREDENTIAL_LOOKUP_FAILED');
});

test('meta-adaccounts: 정상 목록 · 응답 없음(시간 제한 → 502)', { timeout: 5000 }, async () => {
  setup();
  graph({ adaccounts: () => jsonResponse(200, { data: [{ id: 'act_1', name: 'A', account_status: 1, currency: 'KRW', timezone_name: 'Asia/Seoul' }] }) });
  let res = await callAdaccounts();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ad_accounts.length, 1);

  const t = shortenTimeouts(20);
  try {
    setup();
    graph({ adaccounts: (_u, init) => hangUntilAborted(init) });
    res = await callAdaccounts();
    assert.equal(res.status, 502);
  } finally { t.restore(); }
});

test('meta-account-select: Meta 응답이 없으면 502 · 연결 행을 바꾸지 않는다', { timeout: 5000 }, async () => {
  const { admin } = setup();
  const t = shortenTimeouts(20);
  try {
    graph({ adaccounts: (_u, init) => hangUntilAborted(init) });
    const res = await accountSelect(jsonRequest({ connected_account_id: 7, ad_account_id: 'act_1' }));
    assert.equal(res.status, 502);
    assert.equal(admin.calls.filter((c) => c.table === 'connected_accounts').length, 0);
  } finally { t.restore(); }
});

// ---------------------------------------------------------------- meta-oauth-callback
test('meta-oauth-callback: 토큰 교환 응답이 없으면 server_error로 돌아가고 아무것도 저장하지 않는다', { timeout: 5000 }, async () => {
  setEnv({ META_APP_ID: 'app', META_APP_SECRET: 'secret' });
  const admin = fakeSupabase({
    oauth_states: () => ({ data: { store_id: 's1', return_origin: null } }),
    connected_accounts: () => ({ data: [] }),
    integration_credentials: () => ({ data: null }),
  });
  setCtx({ supabase: fakeSupabase({}), supabaseAdmin: admin, userId: null });
  const t = shortenTimeouts(20);
  try {
    const calls = fakeFetch((_u, init) => hangUntilAborted(init));
    const res = await metaCallback(new Request('https://fn.local/meta-oauth-callback?code=abc&state=st'));
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /meta=server_error/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(admin.calls.filter((c) => c.table !== 'oauth_states').length, 0);
  } finally { t.restore(); setEnv({}); }
});
