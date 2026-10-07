// AI(Claude API) 비용 보호 — 실제 ai-insights · ai-weekly-review index.ts를 Node에서 실행한다(Deno 전용 import만 가짜).
// 실행: node --test tests/ai-cost-guards.test.mjs
// Anthropic · Supabase · Meta는 가짜이며 네트워크에 나가지 않는다. 핵심 확인: 막혀야 하는 경로에서 Claude API를 한 번도 부르지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction, jsonRequest, fakeSupabase, setCtx, setEnv, fakeFetch } from './helpers/edge-function-harness.mjs';

const aiInsights = await loadFunction('ai-insights');
const aiWeekly = await loadFunction('ai-weekly-review');

// 모든 외부 요청을 기록만 하고, Anthropic 요청이 오면 실패로 남긴다.
function watchFetch() {
  return fakeFetch((url) => new Response(JSON.stringify({ error: 'unexpected call ' + url }), { status: 500 }));
}
const anthropicCalls = (calls) => calls.filter((c) => c.url.includes('anthropic.com'));

test('ai-insights: 키가 있어도 키를 읽거나 Claude API를 부르지 않고 AI_DISABLED(410)로 멈춘다', async () => {
  setEnv({ ANTHROPIC_API_KEY: 'sk-test', AI_MODEL: 'claude-sonnet-5-5' });
  setCtx({ supabase: fakeSupabase({}), supabaseAdmin: fakeSupabase({}) });
  const calls = watchFetch();
  const res = await aiInsights(jsonRequest({ payload: { current: { adsets: [{ link_ctr: 1.2 }] } } }));
  const body = await res.json();
  assert.equal(res.status, 410);
  assert.equal(body.code, 'AI_DISABLED');
  assert.equal(calls.length, 0, '어떤 외부 요청도 하지 않는다');
  for (let i = 0; i < 5; i++) assert.equal((await aiInsights(jsonRequest({ payload: { current: {} } }))).status, 410);
  assert.equal(anthropicCalls(calls).length, 0);
});

// ai-weekly-review: 소유한 쇼핑몰 1개 · 이번 주 기록(row) · 월 사용액(rpc)을 가짜로 둔다.
function weekly({ row = null, monthSpent = 0 } = {}) {
  const user = fakeSupabase({ stores: () => ({ data: { id: 4 } }) });
  const admin = fakeSupabase({
    ai_weekly_reviews: (q) => (q.op === 'select' ? { data: row } : { data: null, error: { message: 'should not write' } }),
    'rpc:ai_month_spent': () => ({ data: monthSpent }),
    'rpc:ai_budget_reserve': () => ({ data: [{ ok: false, reservation_id: null, spent_usd: monthSpent, reason: 'budget' }] }),
  });
  setCtx({ supabase: user, supabaseAdmin: admin });
  return admin;
}
const run = (action = 'run') => aiWeekly(jsonRequest({ store_id: 4, action }));
const writes = (admin) => admin.calls.filter((c) => c.table === 'ai_weekly_reviews' && c.op !== 'select');

test('ai-weekly-review: 켜기 스위치(AI_WEEKLY_ENABLED)가 꺼져 있으면 키가 있어도 실행하지 않는다', async () => {
  setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: 'sk-test' }); // AI_WEEKLY_ENABLED 없음(= 꺼짐)
  const admin = weekly();
  const calls = watchFetch();
  const body = await (await run()).json();
  assert.equal(body.code, 'AI_NOT_CONFIGURED');
  assert.equal(anthropicCalls(calls).length, 0);
  assert.equal(writes(admin).length, 0, '이용 횟수도 쓰지 않는다');
  setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_ENABLED: 'yes' }); // 정확히 "true"만 켜짐
  assert.equal((await (await run()).json()).code, 'AI_NOT_CONFIGURED');
});

test('ai-weekly-review: 이번 주 점검을 이미 썼으면(계정당 주 1회) 실행하지 않는다', async () => {
  setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_ENABLED: 'true' });
  const admin = weekly({ row: { id: 1, store_id: 4, status: 'completed', updated_at: new Date().toISOString() } });
  const calls = watchFetch();
  const body = await (await run()).json();
  assert.equal(body.code, 'WEEKLY_LIMIT');
  assert.equal(anthropicCalls(calls).length, 0);
  assert.equal(writes(admin).length, 0);
});

test('ai-weekly-review: 서비스 전체 월 예산에 도달했거나 사용액을 확인하지 못하면 실행하지 않는다', async () => {
  setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_ENABLED: 'true', AI_MONTHLY_BUDGET_USD: '30' });
  let admin = weekly({ monthSpent: 30 });
  let calls = watchFetch();
  let body = await (await run()).json();
  assert.equal(body.code, 'BUDGET_EXCEEDED');
  assert.equal(anthropicCalls(calls).length, 0);
  assert.equal(writes(admin).length, 0);

  admin = weekly({ monthSpent: null }); // 사용액 조회 실패 — 0으로 보지 않는다
  calls = watchFetch();
  const res = await run();
  body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.code, 'BUDGET_CHECK_FAILED');
  assert.equal(anthropicCalls(calls).length, 0);
  assert.equal(writes(admin).length, 0);
});

test('ai-weekly-review: 운영자 검증 경로(verify · verify_video)는 허용 목록 사용자만 — 그 외에는 403', async () => {
  setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_ENABLED: 'true', AI_VERIFY_USER_IDS: 'operator-1' });
  for (const action of ['verify', 'verify_video']) {
    weekly();
    const calls = watchFetch();
    const res = await run(action);
    assert.equal(res.status, 403, action);
    assert.equal((await res.json()).code, 'FORBIDDEN');
    assert.equal(anthropicCalls(calls).length, 0);
  }
});

test('ai-weekly-review: 로그인 사용자가 아니면(userClaims 없음) 401', async () => {
  setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_ENABLED: 'true' });
  setCtx({ supabase: fakeSupabase({}), supabaseAdmin: fakeSupabase({}), userId: null });
  const calls = watchFetch();
  const res = await run();
  assert.equal(res.status, 401);
  assert.equal(anthropicCalls(calls).length, 0);
});
