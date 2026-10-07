/* Meta Graph API 오류 분류 — 실행: node --test

   supabase/functions/_shared/meta-adset-normalize.mjs의 실제 classifyMetaApiError를
   불러와 Meta 공식 오류 코드별로 확인한다(meta-insights · meta-adset-insights ·
   meta-adaccounts · meta-account-select가 모두 이 함수로 분류한다).

   핵심: Meta는 요청 한도(4/17/32/613)와 권한(10/200~299) 오류에도
   type:"OAuthException"을 붙여 보낸다. type을 먼저 보면 이런 일시 오류가
   '재연결 필요'가 되어 연결이 pending으로 내려간다(수정 전 동작). code/subcode가
   먼저이고, code가 아예 없을 때만 type을 참고한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_PATH = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'meta-adset-normalize.mjs');
const modPromise = import(pathToFileURL(MODULE_PATH).href);

const OAUTH = 'OAuthException';
const classify = async (error) => (await modPromise).classifyMetaApiError(error === undefined ? undefined : { error });

test('토큰 만료 · 무효(code 190 · 102)는 type과 무관하게 RECONNECT_REQUIRED(401)', async () => {
  for (const err of [
    { code: 190 }, { code: 190, type: OAUTH }, { code: 190, type: OAUTH, error_subcode: 463 },
    { code: 190, type: OAUTH, error_subcode: 460 }, { code: 102, type: OAUTH },
  ]) {
    assert.deepEqual(await classify(err), { code: 'RECONNECT_REQUIRED', status: 401 }, JSON.stringify(err));
  }
});

test('요청 한도는 type:"OAuthException"이 붙어 있어도 RATE_LIMITED(429) — 재연결 아님', async () => {
  for (const code of [4, 17, 32, 341, 613, 80000, 80004, 80014]) {
    assert.deepEqual(await classify({ code, type: OAUTH }), { code: 'RATE_LIMITED', status: 429 }, 'code=' + code);
    assert.deepEqual(await classify({ code }), { code: 'RATE_LIMITED', status: 429 }, 'code=' + code + ' (type 없음)');
  }
  // 광고 인사이트 사용자 요청 한도(17 + subcode 2446079)도 요청 한도
  assert.equal((await classify({ code: 17, type: OAUTH, error_subcode: 2446079 })).code, 'RATE_LIMITED');
});

test('권한 부족(10 · 200~299)은 type:"OAuthException"이 붙어 있어도 PERMISSION_REQUIRED(403)', async () => {
  for (const code of [10, 200, 270, 294, 299]) {
    assert.deepEqual(await classify({ code, type: OAUTH }), { code: 'PERMISSION_REQUIRED', status: 403 }, 'code=' + code);
  }
});

test('Meta 일시 장애 · 알 수 없는 code는 TEMPORARY_ERROR(502) — 재연결로 몰지 않는다', async () => {
  for (const err of [
    { code: 1, type: OAUTH, is_transient: true }, { code: 2, type: OAUTH, is_transient: true },
    { code: 1 }, { code: 100, type: OAUTH }, { code: 2500, type: OAUTH }, { code: 80015 }, { code: 300 },
  ]) {
    assert.deepEqual(await classify(err), { code: 'TEMPORARY_ERROR', status: 502 }, JSON.stringify(err));
  }
});

test('본문이 없거나 형식이 다른 응답(5xx HTML 등)은 TEMPORARY_ERROR', async () => {
  const m = await modPromise;
  assert.equal(m.classifyMetaApiError(null).code, 'TEMPORARY_ERROR');
  assert.equal(m.classifyMetaApiError(undefined).code, 'TEMPORARY_ERROR');
  assert.equal(m.classifyMetaApiError('<html>502 Bad Gateway</html>').code, 'TEMPORARY_ERROR');
  assert.equal(m.classifyMetaApiError({}).code, 'TEMPORARY_ERROR');
  assert.equal(m.classifyMetaApiError({ error: {} }).code, 'TEMPORARY_ERROR');
});

test('code가 없을 때만 subcode · type으로 판단한다(토큰 subcode · OAuthException → 재연결)', async () => {
  assert.equal((await classify({ type: OAUTH })).code, 'RECONNECT_REQUIRED');
  assert.equal((await classify({ error_subcode: 463 })).code, 'RECONNECT_REQUIRED');
  assert.equal((await classify({ error_subcode: 467, type: 'GraphMethodException' })).code, 'RECONNECT_REQUIRED');
  assert.equal((await classify({ type: 'GraphMethodException' })).code, 'TEMPORARY_ERROR');
});

test('숫자 문자열 code도 같은 기준으로 분류한다', async () => {
  assert.equal((await classify({ code: '17', type: OAUTH })).code, 'RATE_LIMITED');
  assert.equal((await classify({ code: '190', type: OAUTH })).code, 'RECONNECT_REQUIRED');
});

test('연결을 pending으로 내리는 것은 RECONNECT_REQUIRED뿐이다', async () => {
  const m = await modPromise;
  const cases = [{ code: 4, type: OAUTH }, { code: 200, type: OAUTH }, { code: 1, type: OAUTH }, { code: 190 }];
  const downgraded = cases.filter((e) => m.shouldDowngradeToPending(m.classifyMetaApiError({ error: e }).code));
  assert.deepEqual(downgraded, [{ code: 190 }]);
});

test('Meta 요청 시간 제한: 상수 하나와 그 값으로 만든 AbortSignal', async () => {
  const m = await modPromise;
  assert.equal(typeof m.META_REQUEST_TIMEOUT_MS, 'number');
  // 정상 조회(수 초)를 끊지 않을 만큼 길고, 함수 실행 한도보다는 충분히 짧아야 한다.
  assert.ok(m.META_REQUEST_TIMEOUT_MS >= 10000 && m.META_REQUEST_TIMEOUT_MS <= 60000, String(m.META_REQUEST_TIMEOUT_MS));
  const original = AbortSignal.timeout;
  const requested = [];
  AbortSignal.timeout = (ms) => { requested.push(ms); return original.call(AbortSignal, ms); };
  try {
    const signal = m.metaRequestSignal();
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
  } finally {
    AbortSignal.timeout = original;
  }
  assert.deepEqual(requested, [m.META_REQUEST_TIMEOUT_MS]);
});
