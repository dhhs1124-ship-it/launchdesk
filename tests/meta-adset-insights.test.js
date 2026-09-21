/* Meta 캠페인/광고 세트/광고 레벨 Insights(진단 1단계) 검증.

   supabase/functions/meta-adset-insights/index.ts는 Deno 전용 모듈(jsr:...)을
   import하므로 이 Node 테스트 러너에서 직접 require()/실행할 수 없다 — 이
   저장소에는 로컬 Deno가 없어 이번에도 `deno check`를 실행하지 못했다(별도
   보고).

   그래서 이번 단계는 순수 로직을 아예 별도 파일
   (supabase/functions/_shared/meta-adset-normalize.mjs)로 분리했다 — 이
   파일은 Deno 전용 구문이 전혀 없는 표준 ESM이라 동적 import()로 Node에서
   그대로, 진짜로 실행해 검증할 수 있다(단순 문자열 검사가 아니다). 이
   테스트 파일은:
   1) meta-adset-normalize.mjs의 모든 순수 함수를 실제로 호출해 값으로 검증하고,
   2) 실제 Deno 파일(meta-adset-insights/index.ts, meta-insights/index.ts)의
      소스 텍스트로 보안 규칙 · 회귀 여부만 구조적으로 재확인한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'meta-adset-normalize.mjs');
const modPromise = import(require('node:url').pathToFileURL(MODULE_PATH).href);

// ===== 1) URL/레벨/필터링 =====================================================

test('adsets 요청은 level=adset을 쓴다', async () => {
  const m = await modPromise;
  const url = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'adset', since: '2026-09-01', until: '2026-09-21' }));
  assert.equal(url.searchParams.get('level'), 'adset');
});

test('ads 요청은 level=ad를 쓴다', async () => {
  const m = await modPromise;
  const url = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'ad', since: '2026-09-01', until: '2026-09-21', filteringAdsetId: '12345' }));
  assert.equal(url.searchParams.get('level'), 'ad');
});

test('광고 목록 조회는 광고계정 노드(act_*)를 통해 요청한 adset_id 하나로만 filtering된다(다른 광고 세트로 새지 않음)', async () => {
  const m = await modPromise;
  const url = new URL(m.buildInsightsUrl({ accountId: 'act_999', level: 'ad', since: '2026-09-01', until: '2026-09-21', filteringAdsetId: '555666777' }));
  assert.equal(url.hostname, 'graph.facebook.com');
  assert.match(url.pathname, /^\/v21\.0\/act_999\/insights$/, '광고계정 노드를 통해 조회하지 않음');
  const filtering = JSON.parse(url.searchParams.get('filtering'));
  assert.deepEqual(filtering, [{ field: 'adset.id', operator: 'IN', value: ['555666777'] }]);
});

test('adsets 요청에는 filtering 파라미터가 없다(계정 전체 조회)', async () => {
  const m = await modPromise;
  const url = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'adset', since: '2026-09-01', until: '2026-09-21' }));
  assert.equal(url.searchParams.has('filtering'), false);
});

test('요청 fields에 식별 정보 · 성과 원본이 모두 포함된다', async () => {
  const m = await modPromise;
  const adsetUrl = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'adset', since: 'x', until: 'y' }));
  const adsetFields = adsetUrl.searchParams.get('fields').split(',');
  for (const f of ['campaign_id', 'campaign_name', 'objective', 'adset_id', 'adset_name', 'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks', 'actions', 'action_values']) {
    assert.ok(adsetFields.includes(f), `adsets fields에 ${f}가 없음`);
  }
  assert.equal(adsetFields.includes('ad_id'), false, 'adsets 요청에 ad_id가 섞여 있음');

  const adUrl = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'ad', since: 'x', until: 'y' }));
  const adFields = adUrl.searchParams.get('fields').split(',');
  assert.ok(adFields.includes('ad_id') && adFields.includes('ad_name'), 'ads fields에 ad_id/ad_name이 없음');
});

test('time_increment=all_days, limit=100(기존 패턴 재사용)', async () => {
  const m = await modPromise;
  const url = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'adset', since: 'x', until: 'y' }));
  assert.equal(url.searchParams.get('time_increment'), 'all_days');
  assert.equal(url.searchParams.get('limit'), '100');
});

// ===== 2) 요청 검증(순수 함수) ================================================

test('잘못된 scope는 거부된다', async () => {
  const m = await modPromise;
  const r = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'campaigns', period: 'today' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('ads scope에서 adset_id 누락은 거부된다', async () => {
  const m = await modPromise;
  const r = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'ads', period: 'today' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('잘못된 형식의 adset_id는 거부된다', async () => {
  const m = await modPromise;
  const r1 = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'ads', period: 'today', adset_id: 'abc123' });
  assert.equal(r1.ok, false);
  const r2 = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'ads', period: 'today', adset_id: 'act_123' });
  assert.equal(r2.ok, false);
  const r3 = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'ads', period: 'today', adset_id: '123456789' });
  assert.equal(r3.ok, true);
});

test('store_id 누락은 거부된다', async () => {
  const m = await modPromise;
  const r = m.validateAdsetInsightsRequest({ scope: 'adsets', period: 'today' });
  assert.equal(r.ok, false);
});

test('today/month만 허용하고 last_7d 등은 명시적으로 거부한다(임의 계산 금지)', async () => {
  const m = await modPromise;
  for (const period of ['last_7d', 'last_14d', 'last_30d', 'yesterday', undefined]) {
    const r = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period });
    assert.equal(r.ok, false, 'period=' + period);
    assert.equal(r.code, 'UNSUPPORTED_PERIOD');
  }
  assert.equal(m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period: 'today' }).ok, true);
  assert.equal(m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period: 'month' }).ok, true);
});

// ===== 3) 전체 클릭 vs 링크 클릭, 파생 지표 ===================================

function row(overrides) {
  return Object.assign(
    {
      campaign_id: '1', campaign_name: 'C1', objective: 'OUTCOME_SALES',
      adset_id: '10', adset_name: 'AS1',
      spend: '10000', impressions: '20000', reach: '15000', frequency: '1.33',
      clicks: '300', inline_link_clicks: '120',
      actions: [], action_values: [],
    },
    overrides
  );
}

test('전체 clicks와 inline_link_clicks(link_clicks)를 분리한다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ clicks: '300', inline_link_clicks: '120' }));
  assert.equal(metrics.clicks, 300);
  assert.equal(metrics.link_clicks, 120);
  assert.notEqual(metrics.clicks, metrics.link_clicks);
});

test('link_ctr = inline_link_clicks ÷ impressions × 100', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ impressions: '20000', inline_link_clicks: '120' }));
  assert.equal(metrics.link_ctr, (120 / 20000) * 100);
});

test('link_cpc = spend ÷ inline_link_clicks', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ spend: '10000', inline_link_clicks: '125' }));
  assert.equal(metrics.link_cpc, 80);
});

test('cpm = spend ÷ impressions × 1000', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ spend: '10000', impressions: '20000' }));
  assert.equal(metrics.cpm, 500);
});

test('분모가 0이면 link_ctr/link_cpc/cpm은 NaN·Infinity가 아니라 null이다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ impressions: '0', inline_link_clicks: '0', spend: '5000' }));
  assert.equal(metrics.link_ctr, null);
  assert.equal(metrics.link_cpc, null);
  assert.equal(metrics.cpm, null);
});

test('purchase 액션 우선순위 — 여러 action_type이 동시에 와도 중복 집계하지 않는다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    actions: [
      { action_type: 'purchase', value: '5' },
      { action_type: 'omni_purchase', value: '5' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' },
    ],
    action_values: [
      { action_type: 'purchase', value: '50000' },
      { action_type: 'omni_purchase', value: '50000' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '50000' },
    ],
  }));
  // 세 후보가 동시에 있어도 우선순위 최상단(offsite_conversion.fb_pixel_purchase)
  // 하나만 쓰고 15(=5+5+5)로 합산되면 안 된다.
  assert.equal(metrics.purchase.value, 5);
  assert.equal(metrics.purchase_value.value, 50000);
  assert.equal(metrics.purchase.observed, true);
});

// observed의 정확한 의미(교정): "이번 Meta 응답의 actions/action_values
// 배열에 우선순위 후보 action_type 중 하나가 실제로 존재했는가"만
// 나타낸다. observed:false만으로 "추적 미설정" · "픽셀 없음" · "이 기간
// 0건이 확정" 중 무엇인지는 구분할 수 없다 — 아래 두 테스트는 그 경계를
// 정확히 이 정의로만 나눈다(추적 설정 여부에 대한 판단은 하지 않는다).

test('후보 action_type 자체가 이번 응답에 없으면 value:0 · observed:false다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ actions: [], action_values: [] }));
  assert.deepEqual(metrics.landing_page_view, { value: 0, observed: false });
  assert.deepEqual(metrics.add_to_cart, { value: 0, observed: false });
  assert.deepEqual(metrics.initiate_checkout, { value: 0, observed: false });
  assert.deepEqual(metrics.purchase, { value: 0, observed: false });
  assert.deepEqual(metrics.purchase_value, { value: 0, observed: false });
});

test('후보 action_type이 존재하고 값이 "0"이면 value:0 · observed:true다(응답 자체에 없는 경우와 구분)', async () => {
  const m = await modPromise;
  const presentButZero = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '100',
    actions: [{ action_type: 'landing_page_view', value: '0' }],
  }));
  assert.deepEqual(presentButZero.landing_page_view, { value: 0, observed: true });

  const absentFromResponse = m.normalizeAdsetMetrics(row({ inline_link_clicks: '100', actions: [] }));
  assert.deepEqual(absentFromResponse.landing_page_view, { value: 0, observed: false });

  // value는 둘 다 0이지만 observed가 다르므로 파생 지표(landing_rate) 결과가
  // 달라진다 — observed:true·value:0은 실제 계산 가능한 0%, observed:false는
  // "이번 응답만으로는 계산 근거가 없음"을 뜻하는 null이다(0으로 위장하지 않음).
  assert.equal(presentButZero.landing_rate, 0);
  assert.equal(absentFromResponse.landing_rate, null);
});

test('funnel 단계별 비율(landing_rate/add_to_cart_rate/checkout_rate/purchase_rate) 계산', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '200',
    actions: [
      { action_type: 'landing_page_view', value: '100' },
      { action_type: 'add_to_cart', value: '40' },
      { action_type: 'initiate_checkout', value: '20' },
      { action_type: 'purchase', value: '10' },
    ],
    action_values: [{ action_type: 'purchase', value: '300000' }],
  }));
  assert.equal(metrics.landing_rate, (100 / 200) * 100);
  assert.equal(metrics.add_to_cart_rate, (40 / 100) * 100);
  assert.equal(metrics.checkout_rate, (20 / 40) * 100);
  assert.equal(metrics.purchase_rate, (10 / 100) * 100); // 명세: purchase ÷ landing_page_view
});

test('선행 단계의 action_type이 이번 응답에 없으면 그 다음 단계 비율도 null이다(0으로 위장하지 않음)', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '200',
    actions: [{ action_type: 'add_to_cart', value: '5' }], // landing_page_view 후보가 응답에 없음
  }));
  assert.equal(metrics.landing_rate, null); // landing_page_view 자체가 이번 응답에 없음(observed:false)
  assert.equal(metrics.add_to_cart_rate, null); // 분모(landing_page_view)가 이번 응답에 없음
});

test('cpa = spend ÷ purchase, purchase가 응답에 없거나 0건이면 null', async () => {
  const m = await modPromise;
  const withPurchase = m.normalizeAdsetMetrics(row({
    spend: '100000',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [{ action_type: 'purchase', value: '400000' }],
  }));
  assert.equal(withPurchase.cpa, 25000);
  const noPurchase = m.normalizeAdsetMetrics(row({ spend: '100000', actions: [], action_values: [] }));
  assert.equal(noPurchase.cpa, null);
});

test('roas = purchase_value ÷ spend, purchase_value가 응답에 없거나 spend=0이면 null', async () => {
  const m = await modPromise;
  const withRoas = m.normalizeAdsetMetrics(row({
    spend: '100000',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [{ action_type: 'purchase', value: '400000' }],
  }));
  assert.equal(withRoas.roas, 4);
  const zeroSpend = m.normalizeAdsetMetrics(row({
    spend: '0',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [{ action_type: 'purchase', value: '400000' }],
  }));
  assert.equal(zeroSpend.roas, null);
  // purchase(건수)는 actions에 있지만 purchase_value(금액)는 action_values에
  // 없는 응답 — 원인은 이 값만으로 알 수 없다. 이 경우 roas는 0이 아니라
  // null이어야 한다(계산할 수 없음, 0 아님).
  const valueNotObserved = m.normalizeAdsetMetrics(row({
    spend: '100000',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [],
  }));
  assert.equal(valueNotObserved.purchase.observed, true);
  assert.equal(valueNotObserved.purchase_value.observed, false);
  assert.equal(valueNotObserved.roas, null);
});

// ===== 4) 캠페인/광고 세트 그룹화 ============================================

test('캠페인별로 그룹화되고, 같은 캠페인의 광고 세트는 배열로 모인다', async () => {
  const m = await modPromise;
  const rows = [
    m.normalizeIdentityRow(row({ campaign_id: '1', campaign_name: 'C1', adset_id: '10', adset_name: 'AS1' }), 'adset'),
    m.normalizeIdentityRow(row({ campaign_id: '1', campaign_name: 'C1', adset_id: '11', adset_name: 'AS2' }), 'adset'),
    m.normalizeIdentityRow(row({ campaign_id: '2', campaign_name: 'C2', adset_id: '20', adset_name: 'AS3' }), 'adset'),
  ];
  const grouped = m.groupAdsetsByCampaign(rows);
  assert.equal(grouped.length, 2);
  const c1 = grouped.find((c) => c.campaign_id === '1');
  assert.equal(c1.adsets.length, 2);
  assert.deepEqual(c1.adsets.map((a) => a.adset_id), ['10', '11']);
  const c2 = grouped.find((c) => c.campaign_id === '2');
  assert.equal(c2.adsets.length, 1);
});

test('광고 목록 모드의 각 행은 ad_id/ad_name을 포함하고 adset 식별 정보와 분리된다', async () => {
  const m = await modPromise;
  const normalized = m.normalizeIdentityRow(row({ ad_id: '999', ad_name: 'AD1' }), 'ad');
  assert.equal(normalized.ad_id, '999');
  assert.equal(normalized.ad_name, 'AD1');
  assert.equal(normalized.adset_id, '10');
  assert.ok(normalized.metrics);
});

// ===== 5) 페이지네이션 · 상한 ==================================================

function fakePages(pages) {
  let i = 0;
  return async () => {
    const p = pages[Math.min(i, pages.length - 1)];
    i++;
    return p;
  };
}

test('2페이지 이상 정상 순회', async () => {
  const m = await modPromise;
  const fetchPage = fakePages([
    { ok: true, rows: [{ a: 1 }], nextAfter: 'CUR1' },
    { ok: true, rows: [{ a: 2 }], nextAfter: undefined },
  ]);
  const result = await m.fetchAllInsightsRows(fetchPage, { maxPages: 10, maxRows: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.pageCount, 2);
  assert.equal(result.fetchedRows, 2);
  assert.equal(result.truncated, false);
});

test('최대 페이지 수 제한 — 더 있어도 조용히 자르지 않고 truncated:true로 표시', async () => {
  const m = await modPromise;
  let calls = 0;
  const fetchPage = async () => {
    calls++;
    return { ok: true, rows: [{ n: calls }], nextAfter: 'CUR' + calls }; // 매번 다른 cursor, 끝없이 다음 페이지 있음
  };
  const result = await m.fetchAllInsightsRows(fetchPage, { maxPages: 3, maxRows: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.pageCount, 3);
  assert.equal(calls, 3, '상한을 넘는 페이지를 실제로 요청함');
  assert.equal(result.truncated, true);
});

test('최대 행 수 제한 — 한 페이지 안에서도 잘리고 truncated:true', async () => {
  const m = await modPromise;
  const fetchPage = fakePages([{ ok: true, rows: [1, 2, 3, 4, 5], nextAfter: undefined }]);
  const result = await m.fetchAllInsightsRows(fetchPage, { maxPages: 10, maxRows: 3 });
  assert.equal(result.fetchedRows, 3);
  assert.equal(result.truncated, true);
});

test('같은 cursor가 반복되면 무한 루프에 빠지지 않고 즉시 중단한다', async () => {
  const m = await modPromise;
  let calls = 0;
  const fetchPage = async () => {
    calls++;
    if (calls > 1000) throw new Error('무한 루프 감지 실패 — 테스트 스스로 중단');
    return { ok: true, rows: [{ n: calls }], nextAfter: 'SAME_CURSOR' }; // 항상 같은 cursor
  };
  const result = await m.fetchAllInsightsRows(fetchPage, { maxPages: 50, maxRows: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.ok(result.pageCount < 50, 'cursor 반복을 감지하지 못하고 페이지 상한까지 다 돎');
  assert.ok(calls <= 3, 'cursor 반복 감지 전 불필요하게 여러 번 더 요청함');
});

test('Meta 응답 오류 발생 시 즉시 중단하고 오류를 그대로 전달한다', async () => {
  const m = await modPromise;
  const fetchPage = fakePages([
    { ok: true, rows: [1], nextAfter: 'CUR1' },
    { ok: false, network: false, status: 401, data: { error: { code: 190, type: 'OAuthException' } } },
  ]);
  const result = await m.fetchAllInsightsRows(fetchPage, { maxPages: 10, maxRows: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.error.status, 401);
});

// ===== 6) 오류 분류 · 재연결 정책(직전 단계와 동일 정책 재확인) ===============

test('code 190/OAuthException은 RECONNECT_REQUIRED이고 pending 전환 대상이다', async () => {
  const m = await modPromise;
  const cls190 = m.classifyMetaApiError({ error: { code: 190 } });
  assert.deepEqual(cls190, { code: 'RECONNECT_REQUIRED', status: 401 });
  assert.equal(m.shouldDowngradeToPending(cls190.code), true);

  const clsType = m.classifyMetaApiError({ error: { type: 'OAuthException' } });
  assert.equal(clsType.code, 'RECONNECT_REQUIRED');
});

test('rate limit(4/17/32/613)은 RATE_LIMITED이고 pending 전환 대상이 아니다(connected 유지)', async () => {
  const m = await modPromise;
  for (const code of [4, 17, 32, 613]) {
    const cls = m.classifyMetaApiError({ error: { code } });
    assert.equal(cls.code, 'RATE_LIMITED', 'code=' + code);
    assert.equal(m.shouldDowngradeToPending(cls.code), false);
  }
});

test('permission(200/10)·미분류 오류는 pending 전환 대상이 아니다', async () => {
  const m = await modPromise;
  assert.equal(m.shouldDowngradeToPending(m.classifyMetaApiError({ error: { code: 200 } }).code), false);
  assert.equal(m.shouldDowngradeToPending(m.classifyMetaApiError({ error: { code: 10 } }).code), false);
  assert.equal(m.shouldDowngradeToPending(m.classifyMetaApiError({ error: {} }).code), false); // TEMPORARY_ERROR
});

// ===== 7) 소스 구조 검증(보안 · 회귀) ==========================================

const NEW_FN_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'meta-adset-insights', 'index.ts'),
  'utf8'
);
const OLD_FN_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'meta-insights', 'index.ts'),
  'utf8'
);

test('access_token/refresh_token이 새 함수의 로그·응답에 노출되지 않는다', () => {
  const consoleCalls = NEW_FN_SRC.match(/console\.(error|log|warn)\([^)]*\)/g) || [];
  assert.ok(consoleCalls.length > 0);
  for (const call of consoleCalls) {
    const withoutStrings = call.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(withoutStrings, /access_token/, call);
    assert.doesNotMatch(withoutStrings, /refresh_token/, call);
    assert.doesNotMatch(withoutStrings, /\baccessToken\b/, call);
  }
  assert.doesNotMatch(NEW_FN_SRC, /Response\.json\(\s*\{[^}]*accessToken/, '응답 JSON에 accessToken 필드가 있음');
});

test('service_role 키나 JWT처럼 보이는 문자열이 코드에 하드코딩되지 않았다', () => {
  // "service_role"이라는 단어 자체는 ctx.supabaseAdmin의 역할을 설명하는
  // 주석에 정상적으로 등장한다(그 자체가 위험 신호는 아님) — 실제 위험
  // 신호는 리터럴 키/토큰 값이 박혀 있는 경우이므로 JWT 형태(eyJ로 시작)와
  // "service_role" 뒤에 실제 값이 대입되는 패턴만 확인한다.
  assert.doesNotMatch(NEW_FN_SRC, /eyJ[A-Za-z0-9_-]{10,}/, 'JWT처럼 보이는 문자열이 하드코딩됨');
  assert.doesNotMatch(NEW_FN_SRC, /service_role["']?\s*[:=]\s*["'][A-Za-z0-9._-]{10,}/, 'service_role에 리터럴 값이 대입됨');
});

test('store_id/connected_accounts 소유권 확인이 ctx.supabase(RLS)로 이루어진다(service role로 먼저 조회하지 않음)', () => {
  // 파일 순서상 downgradeToPendingIfStale(관리자 컨텍스트 helper)이 먼저
  // 나오므로, 실제 요청 처리부(export default 이후)에서만 검색해 helper의
  // supabaseAdmin.from(...) 호출과 섞이지 않게 한다.
  const handlerSrc = NEW_FN_SRC.slice(NEW_FN_SRC.indexOf('export default'));

  const storesIdx = handlerSrc.indexOf('.from("stores")');
  assert.ok(storesIdx > -1, 'stores 조회를 찾지 못함');
  assert.match(handlerSrc.slice(storesIdx - 40, storesIdx), /ctx\.supabase\s*$/, 'stores 조회가 ctx.supabase(RLS)를 쓰지 않음');

  const accountsIdx = handlerSrc.indexOf('.from("connected_accounts")');
  assert.ok(accountsIdx > -1, 'connected_accounts 조회를 찾지 못함');
  assert.match(handlerSrc.slice(accountsIdx - 40, accountsIdx), /ctx\.supabase\s*$/, 'connected_accounts 조회가 ctx.supabase(RLS)를 쓰지 않음');
});

test('토큰 확보 실패 시 pending 전환 시도 후 RECONNECT_REQUIRED를 반환한다(직전 단계 정책 재사용)', () => {
  const idx = NEW_FN_SRC.indexOf('if (!tokenResult.ok) {');
  assert.ok(idx > -1);
  const nearby = NEW_FN_SRC.slice(idx, idx + 250);
  assert.match(nearby, /downgradeToPendingIfStale\(ctx\.supabaseAdmin, account\)/);
  assert.match(nearby, /errorResponse\("RECONNECT_REQUIRED", 401\)/);
});

test('compare-and-set 조건(provider=meta · status=connected · updated_at 일치)이 존재한다', () => {
  assert.match(NEW_FN_SRC, /\.eq\("provider",\s*"meta"\)/);
  assert.match(NEW_FN_SRC, /\.eq\("status",\s*"connected"\)/);
  assert.match(NEW_FN_SRC, /\.eq\("updated_at",\s*account\.updated_at\)/);
});

test('DB 저장 금지 — insert/upsert가 connected_accounts 상태 되돌림 외에는 없다(신규 테이블 없음)', () => {
  assert.doesNotMatch(NEW_FN_SRC, /\.insert\(/, '예상치 못한 insert 호출이 있음');
  assert.doesNotMatch(NEW_FN_SRC, /\.upsert\(/, '예상치 못한 upsert 호출이 있음(성과 저장 의심)');
});

test('Meta API 버전은 기존과 동일한 v21.0이다(임의 변경 없음)', () => {
  assert.match(NEW_FN_SRC, /GRAPH_API_VERSION/);
  const modText = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'meta-adset-normalize.mjs'), 'utf8');
  assert.match(modText, /GRAPH_API_VERSION = "v21\.0"/);
});

test('기존 meta-insights/index.ts는 이번 작업으로 전혀 참조·수정되지 않았다', () => {
  assert.doesNotMatch(OLD_FN_SRC, /meta-adset-insights/);
  assert.doesNotMatch(OLD_FN_SRC, /meta-adset-normalize/);
  // 직전 단계에서 확인된 계정 레벨 계산(전체 clicks 기준 ctr/cpc)이 그대로인지 —
  // 이번 작업이 그 계산식을 바꾸지 않았음을 재확인(회귀 없음).
  assert.match(OLD_FN_SRC, /ctr: impressions > 0 \? \(clicks \/ impressions\) \* 100 : null/);
  assert.match(OLD_FN_SRC, /cpc: clicks > 0 \? spend \/ clicks : null/);
});

test('config.toml에 meta-adset-insights가 로그인 필수(verify_jwt=true)로 등록됐다', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
  const idx = cfg.indexOf('[functions.meta-adset-insights]');
  assert.ok(idx > -1, 'config.toml에 함수 등록이 없음');
  assert.match(cfg.slice(idx, idx + 80), /verify_jwt = true/);
});
