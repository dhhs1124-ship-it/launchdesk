// Cafe24 토큰 동시 갱신 — 가짜 DB(integration_credentials 1행)와 가짜 Cafe24 토큰 서버로 실제 모듈을 실행한다.
// 가짜 Cafe24는 공식 문서대로 refresh_token을 한 번 쓰면 폐기하고 새 토큰을 발급한다.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: (k) => ({ CAFE24_CLIENT_ID: 'id', CAFE24_CLIENT_SECRET: 'secret' })[k] } };
const { getValidCafe24AccessToken } = await import('../supabase/functions/_shared/cafe24-token.ts');

const tick = () => new Promise((r) => setTimeout(r, 3));
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

function fakeDb(row) {
  const db = { row: { ...row }, writes: 0 };
  db.client = {
    from() {
      const filters = [];
      let values = null;
      const matches = () => filters.every(([k, v]) => (v === null ? db.row[k] == null : String(db.row[k]) === String(v)));
      // update는 조건이 맞을 때만 적용하고, 적용된 행(RETURNING)을 돌려준다.
      const run = async () => { await tick(); if (!matches()) return null; if (values) { Object.assign(db.row, values); db.writes++; } return { ...db.row }; };
      const q = {
        select() { return q; },
        update(v) { values = v; return q; },
        eq(k, v) { filters.push([k, v]); return q; },
        is(k, v) { filters.push([k, v]); return q; },
        async single() { const r = await run(); return r ? { data: r, error: null } : { data: null, error: { message: 'none' } }; },
        async maybeSingle() { return { data: await run(), error: null }; },
        then(ok, fail) { return run().then(() => ({ error: null })).then(ok, fail); },
      };
      return q;
    },
  };
  return db;
}

function fakeCafe24(validRefresh) {
  const server = { valid: validRefresh, calls: 0, issued: 0 };
  globalThis.fetch = async (_url, init) => {
    server.calls++;
    await tick();
    const token = new URLSearchParams(init.body).get('refresh_token');
    if (token !== server.valid) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    server.issued++;
    server.valid = 'R' + server.issued; // 이전 refresh_token 폐기
    return new Response(JSON.stringify({ access_token: 'A' + server.issued, refresh_token: server.valid,
      expires_at: kst(Date.now() + 2 * 3600e3), refresh_token_expires_at: kst(Date.now() + 14 * 86400e3) }), { status: 200 });
  };
  return server;
}

const expiredRow = () => ({ connected_account_id: 1, access_token: 'A0', refresh_token: 'R0',
  access_token_expires_at: new Date(Date.now() - 60e3).toISOString(), refresh_token_expires_at: new Date(Date.now() + 86400e3).toISOString(),
  updated_at: '2026-10-05T06:21:37.1+00:00' });

test('만료된 토큰에 요청 3개가 동시에 오면 Cafe24 갱신은 한 번만 하고 셋 다 새 토큰으로 성공한다', async () => {
  const db = fakeDb(expiredRow()), cafe24 = fakeCafe24('R0');
  const results = await Promise.all([1, 2, 3].map(() => getValidCafe24AccessToken(db.client, 1, 'mall')));
  assert.deepEqual(results.map((r) => r.ok), [true, true, true], JSON.stringify(results));
  assert.deepEqual(results.map((r) => r.accessToken), ['A1', 'A1', 'A1']);
  assert.equal(cafe24.calls, 1, 'Cafe24 refresh 호출은 한 번');
  assert.equal(db.row.refresh_token, cafe24.valid, 'DB에는 Cafe24가 지금 유효하다고 보는 refresh_token이 남는다');
});

test('갱신 직후 다시 오는 요청은 갱신하지 않고 저장된 토큰을 쓴다', async () => {
  const db = fakeDb(expiredRow()), cafe24 = fakeCafe24('R0');
  assert.equal((await getValidCafe24AccessToken(db.client, 1, 'mall')).accessToken, 'A1');
  assert.equal((await getValidCafe24AccessToken(db.client, 1, 'mall')).accessToken, 'A1');
  assert.equal(cafe24.calls, 1);
});

test('Cafe24가 refresh_token을 거부하면 재연결이 필요하다고 알리고 DB 토큰은 바꾸지 않는다', async () => {
  const db = fakeDb(expiredRow()); fakeCafe24('다른 토큰');
  const r = await getValidCafe24AccessToken(db.client, 1, 'mall');
  assert.equal(r.ok, false); assert.equal(r.code, 'RECONNECT_REQUIRED');
  assert.equal(db.row.refresh_token, 'R0');
});

// 시차 요청: 첫 요청이 갱신 권한을 잡고(updated_at 변경) Cafe24 응답을 기다리는 동안 두 번째 요청이 와서
// 바뀐 updated_at을 읽는 경우 — 두 번째 요청이 다시 권한을 잡아 같은 refresh_token으로 중복 갱신하면 안 된다.
test('갱신 중에 늦게 온 요청은 다시 갱신하지 않고 기다렸다가 새 토큰을 쓴다(Cafe24 호출 1회 · 둘 다 성공)', async () => {
  const db = fakeDb(expiredRow()), cafe24 = fakeCafe24('R0');
  const real = globalThis.fetch; let release; const gate = new Promise((r) => { release = r; }); let started;
  const firstCall = new Promise((r) => { started = r; });
  globalThis.fetch = async (url, init) => { started(); await gate; return real(url, init); }; // 첫 갱신 응답을 붙잡아 둔다
  const first = getValidCafe24AccessToken(db.client, 1, 'mall');
  await firstCall; // 첫 요청이 권한을 잡고 Cafe24에 요청을 보낸 뒤
  const second = getValidCafe24AccessToken(db.client, 1, 'mall'); // 두 번째 요청 시작(바뀐 updated_at을 읽는다)
  await new Promise((r) => setTimeout(r, 50));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.ok, b.ok], [true, true], JSON.stringify([a, b]));
  assert.deepEqual([a.accessToken, b.accessToken], ['A1', 'A1']);
  assert.equal(cafe24.calls, 1, 'Cafe24 refresh 호출은 한 번');
  assert.equal(db.row.refresh_token, cafe24.valid);
});

test('갱신 권한을 잡은 요청이 끝내지 못하면(임대 시간 경과) 다음 요청이 권한을 다시 잡아 갱신한다', async () => {
  const row = expiredRow(); row.updated_at = new Date(Date.now() - 60e3).toISOString(); // 1분 전에 잡힌 뒤 끝나지 않은 권한
  const db = fakeDb(row), cafe24 = fakeCafe24('R0');
  const r = await getValidCafe24AccessToken(db.client, 1, 'mall');
  assert.equal(r.ok, true); assert.equal(cafe24.calls, 1);
});

// 갱신 실패 분류: 시간 초과 · 네트워크 오류 · 일시적 서버 오류 · 본문 읽기 실패는 재시도 가능(REFRESH_RETRYABLE, 503)이고,
// 토큰 만료 · 폐기 근거(invalid_grant)가 있는 응답만 재연결(RECONNECT_REQUIRED, 401)이다. 어느 실패든 DB 토큰은 그대로 둔다.
const { cafe24TokenErrorStatus } = await import('../supabase/functions/_shared/cafe24-token.ts');
async function refreshWith(fetchImpl) {
  const db = fakeDb(expiredRow()); let signal;
  globalThis.fetch = async (url, init) => { signal = init.signal; return fetchImpl(); };
  const r = await getValidCafe24AccessToken(db.client, 1, 'mall');
  assert.equal(db.row.refresh_token, 'R0', '실패하면 DB의 refresh_token은 바꾸지 않는다');
  assert.ok(signal instanceof AbortSignal, '갱신 요청에는 시간 제한 신호가 붙는다');
  return r;
}
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
const brokenBody = (status, err) => ({ ok: status >= 200 && status < 300, status, json: async () => { throw err; } });
const html = (status) => new Response('<html>error</html>', { status, headers: { 'Content-Type': 'text/html' } });
const cases = [
  ['시간 초과(TimeoutError)', () => { throw timeoutError(); }, 'REFRESH_RETRYABLE'],
  ['네트워크 오류', () => { throw new TypeError('error sending request'); }, 'REFRESH_RETRYABLE'],
  ['서버 오류 500 · JSON', () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }), 'REFRESH_RETRYABLE'],
  ['게이트웨이 502 · HTML 본문', () => html(502), 'REFRESH_RETRYABLE'],
  ['서비스 불가 503', () => new Response('', { status: 503 }), 'REFRESH_RETRYABLE'],
  ['요청 한도 429', () => new Response(JSON.stringify({ error: 'too_many_requests' }), { status: 429 }), 'REFRESH_RETRYABLE'],
  ['200인데 본문 읽기 시간 초과', () => brokenBody(200, timeoutError()), 'REFRESH_RETRYABLE'],
  ['400인데 본문 읽기 중 연결 끊김', () => brokenBody(400, new TypeError('connection reset')), 'REFRESH_RETRYABLE'],
  ['200인데 토큰 없는 본문', () => new Response(JSON.stringify({}), { status: 200 }), 'REFRESH_RETRYABLE'],
  ['400 invalid_grant(만료 · 폐기)', () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh_token time expired' }), { status: 400 }), 'RECONNECT_REQUIRED'],
  ['401 invalid_client(앱 설정 오류)', () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }), 'CONFIG_ERROR'],
  ['400 · 근거 없는 HTML 본문', () => html(400), 'REFRESH_FAILED'],
];
for (const [name, impl, code] of cases) {
  test(`갱신 실패 분류 — ${name} → ${code}`, async () => {
    const r = await refreshWith(impl);
    assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(r));
  });
}
test('재시도 가능 실패는 503, 재연결만 401', () => {
  assert.equal(cafe24TokenErrorStatus('REFRESH_RETRYABLE'), 503);
  assert.equal(cafe24TokenErrorStatus('RECONNECT_REQUIRED'), 401);
  assert.equal(cafe24TokenErrorStatus('REFRESH_FAILED'), 500);
});
