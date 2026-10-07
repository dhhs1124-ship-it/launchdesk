// Cafe24 함수의 API 401 응답 · OAuth 콜백 저장 순서 · 주문 동기화 기록 저장 실패 — 실행: node --test tests/cafe24-function-errors.test.mjs
// 실제 supabase/functions/<함수>/index.ts를 Node에서 실행한다(Deno 전용 import만 가짜, tests/helpers 참고).
// Supabase · Cafe24는 가짜이며 네트워크에 나가지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFunction, jsonRequest, fakeSupabase, setCtx, setEnv, fakeFetch, jsonResponse,
} from './helpers/edge-function-harness.mjs';

setEnv({ CAFE24_CLIENT_ID: 'client', CAFE24_CLIENT_SECRET: 'secret' });

const HOUR = 3600e3;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const kst = (offsetMs) => new Date(Date.now() + offsetMs + 9 * HOUR).toISOString().slice(0, 19).replace('T', ' ');
const VALID_CREDENTIAL = { access_token: 'A0', refresh_token: 'R0', access_token_expires_at: iso(2 * HOUR), refresh_token_expires_at: iso(14 * 24 * HOUR), updated_at: iso(-HOUR) };
const EXPIRED_CREDENTIAL = { ...VALID_CREDENTIAL, access_token_expires_at: iso(-HOUR) };
const CAFE24_ACCOUNT = { id: 9, external_account_id: 'mall1', status: 'connected', last_synced_at: null, orders_synced_from: null };

// 사용자(RLS) 클라이언트: 쇼핑몰 · Cafe24 연결 행. service role: 토큰(갱신 포함) · 주문 저장 · 동기화 기록.
function setup({ credential = VALID_CREDENTIAL, cursorError = null } = {}) {
  let row = { ...credential };
  const user = fakeSupabase({
    stores: () => ({ data: { id: 's1', platform: 'cafe24' } }),
    connected_accounts: () => ({ data: { ...CAFE24_ACCOUNT } }),
  });
  const admin = fakeSupabase({
    integration_credentials: (q) => {
      if (q.op === 'update') {
        Object.assign(row, q.values);
        return q.mode === 'maybeSingle' ? { data: { ...row } } : { data: null };
      }
      return { data: { ...row } };
    },
    orders: () => ({ data: null }),
    connected_accounts: () => (cursorError ? { error: cursorError } : { data: null }),
  });
  setCtx({ supabase: user, supabaseAdmin: admin });
  return { user, admin, credential: () => row };
}

const ORDER = (id) => ({ order_id: id, order_date: '2026-10-07T10:00:00+09:00', order_status: 'N1', currency: 'KRW', payment_amount: '10000', actual_order_amount: { order_price_amount: '10000' } });
const tokenRefreshOk = () => jsonResponse(200, { access_token: 'A1', refresh_token: 'R1', expires_at: kst(2 * HOUR), refresh_token_expires_at: kst(14 * 24 * HOUR) });

// Cafe24 가짜: 토큰 갱신 · 주문 · 쇼핑몰 정보 요청을 나눠 응답한다.
function cafe24({ token = tokenRefreshOk, orders = () => jsonResponse(200, { orders: [] }), store = () => jsonResponse(200, { store: { mall_id: 'mall1' } }) } = {}) {
  return fakeFetch((url, init) => {
    if (url.includes('/oauth/token')) return token(url, init);
    if (url.includes('/admin/orders')) return orders(url, init);
    if (url.includes('/admin/store')) return store(url, init);
    throw new Error('unexpected fetch ' + url);
  });
}
const unauthorized = () => jsonResponse(401, { error: { code: 401, message: 'Invalid access_token' } });

const ordersSync = await loadFunction('cafe24-orders-sync');
const orderItems = await loadFunction('cafe24-order-items');
const storeInfo = await loadFunction('cafe24-store-info');
const cafe24Callback = await loadFunction('cafe24-oauth-callback');

const callSync = () => ordersSync(jsonRequest({ store_id: 's1' }));
const writes = (admin, table) => admin.calls.filter((c) => c.table === table && c.op !== 'select');

// ---------------------------------------------------------------- 3. Cafe24 API 401
test('orders-sync: Cafe24 API 401은 502가 아니라 401 RECONNECT_REQUIRED(reason: CAFE24_API_UNAUTHORIZED)', async () => {
  const { admin } = setup();
  cafe24({ orders: unauthorized });
  const res = await callSync();
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, 'RECONNECT_REQUIRED');
  assert.equal(body.reason, 'CAFE24_API_UNAUTHORIZED');
  assert.equal(writes(admin, 'orders').length, 0);
  assert.equal(writes(admin, 'connected_accounts').length, 0, '실패한 동기화가 동기화 기록을 바꾸면 안 됨');
});

test('orders-sync: 401 본문이 JSON이 아니어도 같은 재연결 응답(500으로 새지 않음)', async () => {
  setup();
  cafe24({ orders: () => new Response('Unauthorized', { status: 401 }) });
  const res = await callSync();
  assert.equal(res.status, 401);
  assert.equal((await res.json()).reason, 'CAFE24_API_UNAUTHORIZED');
});

test('orders-sync: 401 외 Cafe24 오류(500)는 기존대로 502 · 재연결 아님', async () => {
  setup();
  cafe24({ orders: () => jsonResponse(500, { error: { code: 500, message: 'internal' } }) });
  const res = await callSync();
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.status, 500);
  assert.notEqual(body.code, 'RECONNECT_REQUIRED');
});

test('토큰 갱신 자체가 거부된 경우와 갱신 뒤 API 401은 응답으로 구분된다', async () => {
  // a) 갱신 거부(invalid_grant): 주문 API는 부르지 않고, reason 없는 RECONNECT_REQUIRED
  let s = setup({ credential: EXPIRED_CREDENTIAL });
  let calls = cafe24({ token: () => jsonResponse(400, { error: 'invalid_grant', error_description: 'expired' }) });
  let res = await callSync();
  let body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, 'RECONNECT_REQUIRED');
  assert.equal(body.reason, undefined);
  assert.equal(calls.filter((c) => c.url.includes('/admin/orders')).length, 0);

  // b) 갱신 성공(새 토큰 저장) 뒤 주문 API가 401: reason CAFE24_API_UNAUTHORIZED
  s = setup({ credential: EXPIRED_CREDENTIAL });
  calls = cafe24({ orders: unauthorized });
  res = await callSync();
  body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, 'RECONNECT_REQUIRED');
  assert.equal(body.reason, 'CAFE24_API_UNAUTHORIZED');
  assert.equal(s.credential().access_token, 'A1', '갱신된 토큰이 저장돼 있어야 함');
  const orderCall = calls.find((c) => c.url.includes('/admin/orders'));
  assert.equal(orderCall.init.headers.Authorization, 'Bearer A1');
});

test('order-items: 주문 상품 조회 401은 401 RECONNECT_REQUIRED(reason), 500은 기존대로 502', async () => {
  const req = () => orderItems(jsonRequest({ store_id: 's1', start_date: '2026-10-01', end_date: '2026-10-07' }));
  setup();
  cafe24({ orders: unauthorized });
  let res = await req();
  let body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, 'RECONNECT_REQUIRED');
  assert.equal(body.reason, 'CAFE24_API_UNAUTHORIZED');

  setup();
  cafe24({ orders: () => jsonResponse(503, { error: { code: 503 } }) });
  res = await req();
  body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.status, 503);
});

test('store-info: 쇼핑몰 정보 조회 401은 401 RECONNECT_REQUIRED(reason)', async () => {
  setup();
  cafe24({ store: unauthorized });
  const res = await storeInfo(jsonRequest({ store_id: 's1' }));
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.code, 'RECONNECT_REQUIRED');
  assert.equal(body.reason, 'CAFE24_API_UNAUTHORIZED');
});

// ---------------------------------------------------------------- 5. 동기화 기록(cursor) 저장 실패
test('orders-sync: 주문 저장 후 동기화 기록 저장이 실패하면 성공으로 숨기지 않고 503 재시도 오류', async () => {
  const { admin } = setup({ cursorError: { code: '57014', message: 'statement timeout' } });
  cafe24({ orders: () => jsonResponse(200, { orders: [ORDER('O-1'), ORDER('O-2')] }) });
  const res = await callSync();
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.notEqual(body.ok, true);
  assert.equal(body.code, 'SYNC_CURSOR_SAVE_FAILED');
  assert.equal(body.saved, 2);
  // 이미 저장한 주문은 지우거나 되돌리지 않는다
  const orderWrites = writes(admin, 'orders');
  assert.equal(orderWrites.length, 1);
  assert.equal(orderWrites[0].op, 'upsert');
});

test('orders-sync: 같은 기간을 다시 동기화해도 주문은 같은 키로 덮어써 중복되지 않고, 기록 저장이 되면 성공', async () => {
  let s = setup({ cursorError: { message: 'timeout' } });
  cafe24({ orders: () => jsonResponse(200, { orders: [ORDER('O-1'), ORDER('O-2')] }) });
  assert.equal((await callSync()).status, 503);
  const first = writes(s.admin, 'orders')[0];

  s = setup();
  cafe24({ orders: () => jsonResponse(200, { orders: [ORDER('O-1'), ORDER('O-2')] }) });
  const res = await callSync();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.last_synced_at_updated, true);
  const second = writes(s.admin, 'orders')[0];
  for (const w of [first, second]) {
    assert.equal(w.op, 'upsert');
    assert.deepEqual(w.options, { onConflict: 'store_id,provider,external_order_id' });
  }
  assert.deepEqual(second.values.map((r) => r.external_order_id), first.values.map((r) => r.external_order_id));
  const cursor = writes(s.admin, 'connected_accounts');
  assert.equal(cursor.length, 1);
  assert.ok(cursor[0].values.last_synced_at);
});

// ---------------------------------------------------------------- 4. OAuth 콜백 저장 순서
// connected_accounts를 메모리 행 하나로 흉내 내 마지막 상태를 확인한다.
function callbackSetup({ existing = null, failOn = null } = {}) {
  const state = { account: existing ? { ...existing } : null, credential: null, order: [] };
  const fail = (step) => (failOn === step ? { error: { message: 'forced ' + step } } : null);
  const admin = fakeSupabase({
    oauth_states: () => ({ data: { store_id: 's1', mall_id: 'mall1', return_origin: null } }),
    connected_accounts: (q) => {
      if (q.op === 'select') return { data: state.account ? [{ id: state.account.id }] : [] };
      if (q.op === 'insert') {
        state.order.push('insert:' + q.values.status);
        state.account = { id: 11, ...q.values };
        return { data: { id: 11 } };
      }
      if (q.op === 'update') {
        const next = q.values.status || '(no status)';
        state.order.push('update:' + next);
        const f = fail(next === 'connected' ? 'connect' : 'prepare');
        if (f) return f;
        Object.assign(state.account, q.values);
        return { data: null };
      }
      return { data: null };
    },
    integration_credentials: (q) => {
      state.order.push('credential');
      const f = fail('credential');
      if (f) return f;
      state.credential = q.values;
      return { data: null };
    },
    stores: () => {
      state.order.push('store');
      return fail('store') || { data: null };
    },
  });
  setCtx({ supabase: fakeSupabase({}), supabaseAdmin: admin, userId: null });
  fakeFetch((url) => {
    assert.match(url, /mall1\.cafe24api\.com\/api\/v2\/oauth\/token/);
    return tokenRefreshOk();
  });
  return state;
}
const callCallback = () => cafe24Callback(new Request('https://fn.local/cafe24-oauth-callback?code=abc&state=st'));
const location = (res) => res.headers.get('location');

test('callback(최초 연결): 토큰 저장이 실패하면 연결 행이 connected로 남지 않는다', async () => {
  const state = callbackSetup({ failOn: 'credential' });
  const res = await callCallback();
  assert.match(location(res), /cafe24=server_error/);
  assert.ok(state.account, '연결 행(토큰 FK용)은 만들어져도 됨');
  assert.notEqual(state.account.status, 'connected');
  assert.ok(!state.order.includes('insert:connected'), '저장 전에 connected로 만들면 안 됨: ' + state.order.join(' → '));
});

test('callback(재연결): 토큰 저장이 실패하면 기존 connected 행도 connected로 남지 않는다', async () => {
  const state = callbackSetup({ existing: { id: 5, status: 'connected', external_account_id: 'oldmall' }, failOn: 'credential' });
  const res = await callCallback();
  assert.match(location(res), /cafe24=server_error/);
  assert.notEqual(state.account.status, 'connected');
});

test('callback: stores 기록이 실패해도 connected로 남지 않는다', async () => {
  const state = callbackSetup({ failOn: 'store' });
  const res = await callCallback();
  assert.match(location(res), /cafe24=server_error/);
  assert.equal(state.credential.access_token, 'A1');
  assert.notEqual(state.account.status, 'connected');
});

test('callback: 마지막 connected 표시가 실패하면 server_error · 상태는 connected 아님', async () => {
  const state = callbackSetup({ failOn: 'connect' });
  const res = await callCallback();
  assert.match(location(res), /cafe24=server_error/);
  assert.notEqual(state.account.status, 'connected');
});

test('callback 정상 흐름: 토큰 · stores 저장 뒤 마지막에만 connected', async () => {
  const state = callbackSetup();
  const res = await callCallback();
  assert.match(location(res), /cafe24=connected/);
  assert.equal(state.account.status, 'connected');
  assert.equal(state.account.external_account_id, 'mall1');
  assert.ok(state.account.connected_at);
  assert.equal(state.credential.access_token, 'A1');
  assert.equal(state.credential.connected_account_id, 11);
  assert.deepEqual(state.order, ['insert:pending', 'credential', 'store', 'update:connected']);
});

test('callback 재연결 정상 흐름: 기존 행을 pending으로 바꾼 뒤 저장 → 마지막에 connected', async () => {
  const state = callbackSetup({ existing: { id: 5, status: 'connected', external_account_id: 'oldmall' } });
  const res = await callCallback();
  assert.match(location(res), /cafe24=connected/);
  assert.equal(state.account.status, 'connected');
  assert.equal(state.account.external_account_id, 'mall1');
  assert.equal(state.credential.connected_account_id, 5);
  assert.deepEqual(state.order, ['update:pending', 'credential', 'store', 'update:connected']);
});

