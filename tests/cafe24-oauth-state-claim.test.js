/* Cafe24 OAuth state 원자적 claim 검증.

   supabase/functions/cafe24-oauth-callback/index.ts는 Deno 전용 모듈
   (jsr:@supabase/server 등)을 import하므로 이 Node 테스트 러너에서 직접
   require()하거나 실행할 수 없다 — 이 저장소에는 로컬 Deno가 없어
   `deno check`/`deno test`도 이번 세션에서 실행하지 못했다(별도 보고).

   그래서 이 파일은 두 층위로 검증한다:
   1) makeOauthStatesTable() — 실제 UPDATE ... WHERE state=? AND provider=?
      AND used_at IS NULL AND expires_at > now() ... RETURNING이 Postgres에서
      보장하는 "조건 확인과 사용 처리가 한 번의 원자적 연산"이라는 계약을
      순수 JS로 그대로 재현해, claim 성공/실패 조건과 동시 요청 시 1건만
      성공하는지를 실제로 실행해 검증한다.
   2) 실제 cafe24-oauth-callback/index.ts 소스 텍스트를 읽어, 그 계약과
      정확히 같은 쿼리 체인이 실제 코드에 존재하는지 · 옛 SELECT→UPDATE
      분리 패턴이 완전히 사라졌는지 · claim 실패 시 토큰 교환/credential
      저장 코드보다 앞에서 반환하는지 · 민감정보가 로그에 안 남는지 ·
      기존 리다이렉트 문구가 그대로인지를 구조적으로 확인한다.
   문자열 존재 여부만 보는 게 아니라, 1)의 계약 테스트가 실제 동시성 결과를
   assert하고 2)는 순서 자체를 소스 내 문자열 위치로 비교한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}
function future() { return iso(10 * 60 * 1000); }
function past() { return iso(-10 * 60 * 1000); }

/* cafe24-oauth-callback/index.ts가 쓰는 정확한 체인:
     .from("oauth_states").update({ used_at: nowIso })
       .eq("state", state).eq("provider", "cafe24")
       .is("used_at", null).gt("expires_at", nowIso)
       .select("store_id,mall_id").maybeSingle()
   을 그대로 흉내낸 in-memory 테이블. claim()은 이 체인 전체를 "한 번의
   호출"로 처리해, 조건 확인과 값 변경 사이에 다른 호출이 끼어들 수
   없다(Postgres 행 잠금이 주는 원자성과 동일한 성질) — find()로 조건에
   맞는 행을 고르는 것과 그 행의 used_at을 바꾸는 것이 같은 동기 함수
   호출 안에서 분리 없이 일어난다는 뜻. */
function makeOauthStatesTable(rows) {
  const table = rows.map((r) => Object.assign({}, r));
  return {
    claim(usedAtIso, state, provider, nowIso) {
      const row = table.find(
        (r) =>
          r.state === state &&
          r.provider === provider &&
          r.used_at === null &&
          new Date(r.expires_at).getTime() > new Date(nowIso).getTime()
      );
      if (!row) return { data: null, error: null };
      row.used_at = usedAtIso;
      return { data: { store_id: row.store_id, mall_id: row.mall_id }, error: null };
    },
  };
}

test('정상 state는 1회 claim 성공', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: null, expires_at: future(), store_id: 1, mall_id: 'mymall' },
  ]);
  const r = t.claim(iso(0), 's1', 'cafe24', iso(0));
  assert.equal(r.error, null);
  assert.deepEqual(r.data, { store_id: 1, mall_id: 'mymall' });
});

test('동일 state 두 번째 claim은 실패(null)', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: null, expires_at: future(), store_id: 1, mall_id: 'mymall' },
  ]);
  const first = t.claim(iso(0), 's1', 'cafe24', iso(0));
  const second = t.claim(iso(0), 's1', 'cafe24', iso(0));
  assert.notEqual(first.data, null);
  assert.equal(second.data, null);
});

test('동시에 두 번 claim을 시도해도 성공은 1건뿐(동시 요청 계약)', async () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: null, expires_at: future(), store_id: 1, mall_id: 'mymall' },
  ]);
  // Promise.all로 "동시에 들어온 두 콜백 요청"을 흉내낸다. claim()이 원자적
  // 함수 호출이라(체크와 변경이 분리되지 않음) 실행 순서와 무관하게 항상
  // 정확히 1건만 성공해야 한다.
  const results = await Promise.all([
    Promise.resolve().then(() => t.claim(iso(0), 's1', 'cafe24', iso(0))),
    Promise.resolve().then(() => t.claim(iso(0), 's1', 'cafe24', iso(0))),
  ]);
  const successes = results.filter((r) => r.data !== null);
  assert.equal(successes.length, 1);
});

test('이미 사용된 state 거부', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: iso(0), expires_at: future(), store_id: 1, mall_id: 'm' },
  ]);
  assert.equal(t.claim(iso(0), 's1', 'cafe24', iso(0)).data, null);
});

test('만료된 state 거부', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: null, expires_at: past(), store_id: 1, mall_id: 'm' },
  ]);
  assert.equal(t.claim(iso(0), 's1', 'cafe24', iso(0)).data, null);
});

test('존재하지 않는 state 거부', () => {
  const t = makeOauthStatesTable([]);
  assert.equal(t.claim(iso(0), 'no-such-state', 'cafe24', iso(0)).data, null);
});

test('provider가 다른 state 거부(meta용 state로 cafe24 claim 시도)', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'meta', used_at: null, expires_at: future(), store_id: 1, mall_id: 'm' },
  ]);
  assert.equal(t.claim(iso(0), 's1', 'cafe24', iso(0)).data, null);
});

// ===== claim 실패 시 호출 순서 계약(스파이 기반) ==============================
// 실제 cafe24-oauth-callback/index.ts를 import할 수 없으므로, 그 파일의
// 제어 흐름(claim → 실패면 즉시 반환 → 성공해야만 토큰 교환 → credential
// 저장)과 같은 모양을 이 테스트 전용 함수로 재현해 스파이 호출 여부를
// 검증한다. 아래 "실제 소스 구조 검증" 테스트가 이 모양이 실제 파일과
// 일치하는지를 별도로 확인한다.
function runCallbackFlowShape(table, state, provider, nowIso, spies) {
  const claimed = table.claim(nowIso, state, provider, nowIso);
  if (claimed.error || !claimed.data) {
    return { ok: false, reason: 'invalid_state' };
  }
  spies.exchangeToken();
  spies.saveCredential();
  return { ok: true };
}

test('claim 실패 시 토큰 교환 함수가 호출되지 않는다', () => {
  const t = makeOauthStatesTable([]); // 존재하지 않는 state → claim 실패
  let exchangeCalls = 0;
  const spies = { exchangeToken: () => exchangeCalls++, saveCredential: () => {} };
  const r = runCallbackFlowShape(t, 'no-such-state', 'cafe24', iso(0), spies);
  assert.equal(r.ok, false);
  assert.equal(exchangeCalls, 0);
});

test('claim 실패 시 credential 저장 함수가 호출되지 않는다', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: iso(0), expires_at: future(), store_id: 1, mall_id: 'm' }, // 이미 사용됨
  ]);
  let saveCalls = 0;
  const spies = { exchangeToken: () => {}, saveCredential: () => saveCalls++ };
  const r = runCallbackFlowShape(t, 's1', 'cafe24', iso(0), spies);
  assert.equal(r.ok, false);
  assert.equal(saveCalls, 0);
});

test('claim 성공 시에는 토큰 교환 · credential 저장이 모두 호출된다(대조군)', () => {
  const t = makeOauthStatesTable([
    { state: 's1', provider: 'cafe24', used_at: null, expires_at: future(), store_id: 1, mall_id: 'm' },
  ]);
  let exchangeCalls = 0;
  let saveCalls = 0;
  const spies = { exchangeToken: () => exchangeCalls++, saveCredential: () => saveCalls++ };
  const r = runCallbackFlowShape(t, 's1', 'cafe24', iso(0), spies);
  assert.equal(r.ok, true);
  assert.equal(exchangeCalls, 1);
  assert.equal(saveCalls, 1);
});

// ===== 실제 소스 구조 검증(파일 텍스트 기준) ==================================
const SRC_PATH = path.join(__dirname, '..', 'supabase', 'functions', 'cafe24-oauth-callback', 'index.ts');
const src = fs.readFileSync(SRC_PATH, 'utf8');

test('원자적 claim 쿼리 체인이 정확한 조건으로 존재한다', () => {
  assert.match(src, /\.from\("oauth_states"\)\s*\.update\(\{\s*used_at:\s*nowIso\s*\}\)/, 'update({ used_at: nowIso }) 형태가 없음');
  assert.match(src, /\.eq\("state",\s*state\)/, 'state 일치 조건이 없음');
  assert.match(src, /\.eq\("provider",\s*"cafe24"\)/, 'provider=cafe24 조건이 없음');
  assert.match(src, /\.is\("used_at",\s*null\)/, 'used_at IS NULL 조건이 없음');
  assert.match(src, /\.gt\("expires_at",\s*nowIso\)/, 'expires_at > now 조건이 없음');
  assert.match(src, /\.select\("store_id,mall_id"\)/, 'RETURNING(select) 대상이 없음');
  assert.match(src, /\.maybeSingle\(\)/, 'maybeSingle()이 없음');
});

test('옛 SELECT → 별도 UPDATE(used_at) 분리 패턴이 완전히 제거됐다', () => {
  assert.doesNotMatch(src, /\.select\(\s*"state,user_id,store_id,mall_id,expires_at,used_at"\s*\)/, '옛 SELECT 컬럼 목록이 남아있음');
  assert.doesNotMatch(src, /if\s*\(\s*oauthState\.used_at\s*\)/, '별도 used_at 체크가 남아있음');
  assert.doesNotMatch(src, /new Date\(oauthState\.expires_at\)\.getTime\(\)\s*<=\s*Date\.now\(\)/, '별도 만료 체크가 남아있음');
  // 끝부분의 "state 재사용 방지" 별도 UPDATE(파일 안에 claim용 update가 이미
  // 있으므로, 두 번째 .update({ used_at: ... 가 없어야 한다 — 정확히 1개만 존재).
  const updateUsedAtCount = (src.match(/\.update\(\{\s*used_at:/g) || []).length;
  assert.equal(updateUsedAtCount, 1, 'used_at을 쓰는 UPDATE가 claim 하나가 아니라 여러 개 남아있음');
});

test('claim 실패 응답(early return)이 토큰 교환 · credential 저장보다 코드상 앞에 있다', () => {
  const claimFailIdx = src.indexOf('Invalid, expired, or already-used OAuth state.');
  const tokenExchangeIdx = src.indexOf('cafe24api.com/api/v2/oauth/token');
  const credentialSaveIdx = src.indexOf('integration_credentials');
  assert.ok(claimFailIdx > -1, 'claim 실패 응답 문구를 찾지 못함');
  assert.ok(tokenExchangeIdx > -1, '토큰 교환 호출을 찾지 못함');
  assert.ok(credentialSaveIdx > -1, 'credential 저장 호출을 찾지 못함');
  assert.ok(claimFailIdx < tokenExchangeIdx, 'claim 실패 처리가 토큰 교환보다 뒤에 있음');
  assert.ok(tokenExchangeIdx < credentialSaveIdx, '토큰 교환이 credential 저장보다 뒤에 있음(순서 확인)');
});

test('로그에 state 원문 · code · access_token · refresh_token이 남지 않는다', () => {
  const consoleCalls = src.match(/console\.(error|log|warn)\([^)]*\)/g) || [];
  assert.ok(consoleCalls.length > 0, 'console 호출 자체를 찾지 못함(테스트 전제 확인)');
  for (const call of consoleCalls) {
    // 로그 라벨 문자열("Cafe24 OAuth state claim error:" 등) 안에 "state"라는
    // 단어가 들어있는 건 안전하다 — 위험한 건 따옴표 밖의 실제 식별자
    // (state/code 변수 자체, 또는 토큰 값)가 인자로 넘어가는 경우이므로,
    // 문자열 리터럴을 먼저 제거한 뒤 남은 코드 부분만 검사한다.
    const withoutStringLiterals = call.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(withoutStringLiterals, /\bstate\b/, 'console 호출 인자에 state 식별자가 그대로 노출됨: ' + call);
    assert.doesNotMatch(withoutStringLiterals, /\bcode\b/, 'console 호출 인자에 code 식별자가 그대로 노출됨: ' + call);
    assert.doesNotMatch(withoutStringLiterals, /access_token/, 'console 호출 인자에 access_token이 노출됨: ' + call);
    assert.doesNotMatch(withoutStringLiterals, /refresh_token/, 'console 호출 인자에 refresh_token이 노출됨: ' + call);
  }
});

test('기존 성공 · 실패 리다이렉트(goBack 상태값)가 그대로 유지된다', () => {
  assert.match(src, /goBack\("denied"\)/, 'denied 리다이렉트가 없음');
  assert.match(src, /goBack\("server_error"\)/, 'server_error 리다이렉트가 없음');
  assert.match(src, /goBack\("token_error"\)/, 'token_error 리다이렉트가 없음');
  assert.match(src, /goBack\("connected"\)/, 'connected 리다이렉트가 없음');
  assert.match(src, /\?cafe24=\$\{encodeURIComponent\(status\)\}#\/account/, 'cafe24 상태 쿼리 URL 형식이 바뀜');
});

test('claim에 성공한 요청만 토큰 교환을 시작한다는 주석 · 구조가 남아있다(회귀 방지)', () => {
  assert.match(src, /claim에 성공한 이 요청만 아래로 진행/, 'claim 성공 후에만 진행한다는 표시가 없음');
});
