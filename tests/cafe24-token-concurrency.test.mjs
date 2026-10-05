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
