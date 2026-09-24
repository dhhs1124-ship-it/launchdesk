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

test('today/yesterday/month/all/date만 허용하고 last_7d 등은 명시적으로 거부한다(임의 계산 금지)', async () => {
  const m = await modPromise;
  for (const period of ['last_7d', 'last_14d', 'last_30d', 'maximum', undefined]) {
    const r = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period });
    assert.equal(r.ok, false, 'period=' + period);
    assert.equal(r.code, 'UNSUPPORTED_PERIOD');
  }
  for (const period of ['today', 'yesterday', 'month', 'all']) {
    assert.equal(m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period }).ok, true, period);
  }
});

test('date 기간: 실제 달력 날짜만 허용한다', async () => {
  const m = await modPromise;
  const ok = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period: 'date', date: '2026-09-10' });
  assert.equal(ok.ok, true);
  assert.equal(ok.date, '2026-09-10');
  for (const date of [undefined, '2026-9-10', '2026-02-30', '2026-13-01', '20260910']) {
    const r = m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period: 'date', date });
    assert.equal(r.ok, false, 'date=' + date);
    assert.equal(r.code, 'INVALID_DATE');
  }
  // date는 period=date일 때만 전달된다
  assert.equal(m.validateAdsetInsightsRequest({ store_id: 's1', scope: 'adsets', period: 'today', date: '2026-09-10' }).date, undefined);
});

test('resolvePeriodRange: 광고계정 시간대 기준 오늘 · 어제 · 이번 달 · 날짜, 전체는 시작일 없이 maximum', async () => {
  const m = await modPromise;
  const now = new Date('2026-09-01T16:30:00Z'); // 서울 9/2 01:30, UTC 9/1
  assert.deepEqual(m.resolvePeriodRange('today', now, 'Asia/Seoul'), { since: '2026-09-02', until: '2026-09-02' });
  assert.deepEqual(m.resolvePeriodRange('yesterday', now, 'Asia/Seoul'), { since: '2026-09-01', until: '2026-09-01' });
  assert.deepEqual(m.resolvePeriodRange('yesterday', now, 'UTC'), { since: '2026-08-31', until: '2026-08-31' }); // 월 경계
  assert.deepEqual(m.resolvePeriodRange('month', now, 'Asia/Seoul'), { since: '2026-09-01', until: '2026-09-02' });
  assert.deepEqual(m.resolvePeriodRange('date', now, 'Asia/Seoul', '2026-08-15'), { since: '2026-08-15', until: '2026-08-15' });
  assert.deepEqual(m.resolvePeriodRange('all', now, 'Asia/Seoul'), { since: null, until: '2026-09-02', preset: 'maximum' });
  assert.equal(m.isFutureDate('2026-09-02', now, 'Asia/Seoul'), false);
  assert.equal(m.isFutureDate('2026-09-02', now, 'UTC'), true);
  // 37개월 조회 한도(서울 오늘 2026-09-02 → 가장 이른 날 2023-08-03)
  assert.equal(m.isBeyondLookback('2023-08-02', now, 'Asia/Seoul'), true);
  assert.equal(m.isBeyondLookback('2023-08-03', now, 'Asia/Seoul'), false);
});

test('전체 기간 URL은 time_range 대신 date_preset=maximum을 쓴다', async () => {
  const m = await modPromise;
  const all = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'adset', since: null, until: '2026-09-02', preset: 'maximum' }));
  assert.equal(all.searchParams.get('date_preset'), 'maximum');
  assert.equal(all.searchParams.has('time_range'), false);
  const day = new URL(m.buildInsightsUrl({ accountId: 'act_1', level: 'adset', since: '2026-09-01', until: '2026-09-01' }));
  assert.equal(day.searchParams.has('date_preset'), false);
  assert.equal(day.searchParams.get('time_range'), JSON.stringify({ since: '2026-09-01', until: '2026-09-01' }));
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
  // 여러 우선순위 후보가 동시에 존재해도 basis는 선택된 단 하나(최상단
  // 후보)만 반환한다 — 다른 두 후보 이름이 basis에 섞여 나오면 안 된다.
  assert.equal(metrics.purchase.basis, 'offsite_conversion.fb_pixel_purchase');
  assert.equal(metrics.purchase_value.basis, 'offsite_conversion.fb_pixel_purchase');
});

// observed의 정확한 의미(교정): "이번 Meta 응답의 actions/action_values
// 배열에 우선순위 후보 action_type 중 하나가 실제로 존재했는가"만
// 나타낸다. observed:false만으로 "추적 미설정" · "픽셀 없음" · "이 기간
// 0건이 확정" 중 무엇인지는 구분할 수 없다 — 아래 두 테스트는 그 경계를
// 정확히 이 정의로만 나눈다(추적 설정 여부에 대한 판단은 하지 않는다).

test('후보 action_type 자체가 이번 응답에 없으면 value:0 · observed:false · basis:null이다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ actions: [], action_values: [] }));
  assert.deepEqual(metrics.landing_page_view, { value: 0, observed: false, basis: null });
  assert.deepEqual(metrics.add_to_cart, { value: 0, observed: false, basis: null });
  assert.deepEqual(metrics.initiate_checkout, { value: 0, observed: false, basis: null });
  assert.deepEqual(metrics.purchase, { value: 0, observed: false, basis: null });
  assert.deepEqual(metrics.purchase_value, { value: 0, observed: false, basis: null });
});

test('후보 action_type이 존재하고 값이 "0"이면 value:0 · observed:true · basis=실제 선택된 이름이다(응답 자체에 없는 경우와 구분)', async () => {
  const m = await modPromise;
  const presentButZero = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '100',
    actions: [{ action_type: 'landing_page_view', value: '0' }],
  }));
  assert.deepEqual(presentButZero.landing_page_view, { value: 0, observed: true, basis: 'landing_page_view' });

  const absentFromResponse = m.normalizeAdsetMetrics(row({ inline_link_clicks: '100', actions: [] }));
  assert.deepEqual(absentFromResponse.landing_page_view, { value: 0, observed: false, basis: null });

  // value는 둘 다 0이지만 observed가 다르므로 파생 지표(landing_rate) 결과가
  // 달라진다 — observed:true·value:0은 실제 계산 가능한 0%, observed:false는
  // "이번 응답만으로는 계산 근거가 없음"을 뜻하는 null이다(0으로 위장하지 않음).
  assert.equal(presentButZero.landing_rate, 0);
  assert.equal(absentFromResponse.landing_rate, null);
});

test('basis는 add_to_cart/initiate_checkout에서도 실제 선택된 action_type을 반환한다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '200',
    actions: [
      { action_type: 'omni_add_to_cart', value: '3' },
      { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: '2' },
    ],
  }));
  assert.equal(metrics.add_to_cart.basis, 'omni_add_to_cart');
  assert.equal(metrics.initiate_checkout.basis, 'offsite_conversion.fb_pixel_initiate_checkout');
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

// ===== funnel_status(실계정 검증 후 추가) ====================================
// 실계정 검증에서 landing_page_view가 link_clicks보다 큰 값(link_clicks=36,
// landing_page_view=1035 / link_clicks=771, landing_page_view=4493)으로
// 반환되는 사례가 실제로 확인됐다 — 아래 두 테스트는 그 실측값을 그대로
// 재현한다. 원인은 단정하지 않고, "비교 불가" 상태만 구조적으로 검증한다.

test('실계정에서 확인된 사례(link_clicks=36, landing_page_view=1035) → landing_rate:null, usable:false, LPV_EXCEEDS_LINK_CLICKS', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '36',
    actions: [{ action_type: 'landing_page_view', value: '1035' }],
  }));
  assert.equal(metrics.landing_rate, null);
  assert.deepEqual(metrics.funnel_status, { usable: false, code: 'LPV_EXCEEDS_LINK_CLICKS' });
  // 원본 값은 그대로 유지되어야 한다(삭제·보정 금지) — 이상값이어도 숨기지 않는다.
  assert.equal(metrics.link_clicks, 36);
  assert.equal(metrics.landing_page_view.value, 1035);
});

test('실계정에서 확인된 사례(link_clicks=771, landing_page_view=4493) → landing_rate:null, usable:false, LPV_EXCEEDS_LINK_CLICKS', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '771',
    actions: [{ action_type: 'landing_page_view', value: '4493' }],
  }));
  assert.equal(metrics.landing_rate, null);
  assert.deepEqual(metrics.funnel_status, { usable: false, code: 'LPV_EXCEEDS_LINK_CLICKS' });
  assert.equal(metrics.link_clicks, 771);
  assert.equal(metrics.landing_page_view.value, 4493);
});

test('link_clicks=100, landing_page_view=80(정상 범위) → landing_rate:80, usable:true, code:null', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '100',
    actions: [{ action_type: 'landing_page_view', value: '80' }],
  }));
  assert.equal(metrics.landing_rate, 80);
  assert.deepEqual(metrics.funnel_status, { usable: true, code: null });
});

test('landing_page_view이 이번 응답에 없으면(observed:false) usable:false · code:LPV_NOT_OBSERVED', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({ inline_link_clicks: '100', actions: [] }));
  assert.deepEqual(metrics.funnel_status, { usable: false, code: 'LPV_NOT_OBSERVED' });
  assert.equal(metrics.landing_rate, null);
});

test('link_clicks<=0이면 usable:false · code:NO_LINK_CLICKS', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '0',
    actions: [{ action_type: 'landing_page_view', value: '5' }],
  }));
  assert.deepEqual(metrics.funnel_status, { usable: false, code: 'NO_LINK_CLICKS' });
  assert.equal(metrics.landing_rate, null);
});

test('funnel_status.usable=false면 add_to_cart_rate · purchase_rate도 null이지만 checkout_rate는 영향받지 않는다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    inline_link_clicks: '36', // landing_page_view(1035) > link_clicks(36) → usable:false
    actions: [
      { action_type: 'landing_page_view', value: '1035' },
      { action_type: 'add_to_cart', value: '5' },
      { action_type: 'initiate_checkout', value: '2' },
      { action_type: 'purchase', value: '1' },
    ],
    action_values: [{ action_type: 'purchase', value: '10000' }],
  }));
  assert.equal(metrics.funnel_status.usable, false);
  assert.equal(metrics.landing_rate, null);
  assert.equal(metrics.add_to_cart_rate, null); // landing_page_view를 분모로 씀 → 차단
  assert.equal(metrics.purchase_rate, null);    // landing_page_view를 분모로 씀 → 차단
  // checkout_rate의 분모는 add_to_cart이지 landing_page_view가 아니므로
  // funnel_status와 무관하게 정상 계산되어야 한다.
  assert.equal(metrics.checkout_rate, (2 / 5) * 100);
});

test('funnel_status.usable=false여도 CPA · ROAS · link_ctr · link_cpc · CPM은 영향받지 않는다(회귀 없음)', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    spend: '10000',
    impressions: '20000',
    inline_link_clicks: '36',
    actions: [
      { action_type: 'landing_page_view', value: '1035' }, // usable:false를 유발
      { action_type: 'purchase', value: '2' },
    ],
    action_values: [{ action_type: 'purchase', value: '40000' }],
  }));
  assert.equal(metrics.funnel_status.usable, false);
  assert.equal(metrics.link_ctr, (36 / 20000) * 100);
  assert.equal(metrics.link_cpc, 10000 / 36);
  assert.equal(metrics.cpm, (10000 / 20000) * 1000);
  assert.equal(metrics.cpa, 10000 / 2);
  assert.equal(metrics.roas, 40000 / 10000);
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
  assert.equal(valueNotObserved.purchase_value.basis, null); // 찾으려 시도한 이름이 아니라 실제로 못 찾았다는 뜻
  assert.equal(valueNotObserved.roas, null);
});

// ===== purchase_value.basis 의미 교정 =========================================
// basis는 "그 action_type으로 찾아봤다"가 아니라 "실제로 그 배열에서
// 찾았다"는 뜻이어야 한다 — count(actions)와 value(action_values)는 각자
// 독립적으로 찾았는지를 반영하며, 서로 다른 후보를 섞어 쓰지 않는다.

test('actions와 action_values에 같은 basis가 있으면 purchase.basis와 purchase_value.basis가 동일하다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    actions: [{ action_type: 'omni_purchase', value: '3' }],
    action_values: [{ action_type: 'omni_purchase', value: '90000' }],
  }));
  assert.equal(metrics.purchase.basis, 'omni_purchase');
  assert.equal(metrics.purchase_value.basis, 'omni_purchase');
  assert.equal(metrics.purchase.observed, true);
  assert.equal(metrics.purchase_value.observed, true);
});

test('actions에만 basis가 있고 action_values에는 없으면 purchase_value는 value:0 · observed:false · basis:null이다', async () => {
  const m = await modPromise;
  const metrics = m.normalizeAdsetMetrics(row({
    actions: [{ action_type: 'omni_purchase', value: '3' }],
    action_values: [],
  }));
  assert.equal(metrics.purchase.observed, true);
  assert.equal(metrics.purchase.basis, 'omni_purchase');
  assert.deepEqual(metrics.purchase_value, { value: 0, observed: false, basis: null });
});

test('actions는 최우선 후보, action_values는 다른 하위 후보만 있으면 교차 혼합하지 않는다', async () => {
  const m = await modPromise;
  // actions: 최우선 후보(offsite_conversion.fb_pixel_purchase)만 존재.
  // action_values: 그보다 하위 후보(purchase, 맨 아래 순위)만 존재 —
  // 서로 다른 action_type이므로 절대 대신 쓰면 안 된다.
  const metrics = m.normalizeAdsetMetrics(row({
    actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' }],
    action_values: [{ action_type: 'purchase', value: '99999' }],
  }));
  assert.equal(metrics.purchase.basis, 'offsite_conversion.fb_pixel_purchase');
  assert.deepEqual(metrics.purchase_value, { value: 0, observed: false, basis: null });
});

test('purchase_value.basis 교정 후에도 CPA/ROAS와 0/null 규칙은 회귀 없이 그대로다', async () => {
  const m = await modPromise;
  // 정상: 같은 basis로 count/value 모두 존재 → cpa/roas 정상 계산.
  const ok = m.normalizeAdsetMetrics(row({
    spend: '100000',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [{ action_type: 'purchase', value: '400000' }],
  }));
  assert.equal(ok.cpa, 25000);
  assert.equal(ok.roas, 4);
  // value만 못 찾은 경우 → roas는 null(0 아님), cpa는 count만으로 계산되므로 그대로.
  const noValue = m.normalizeAdsetMetrics(row({
    spend: '100000',
    actions: [{ action_type: 'purchase', value: '4' }],
    action_values: [],
  }));
  assert.equal(noValue.cpa, 25000);
  assert.equal(noValue.roas, null);
  // 후보 자체가 전혀 없는 경우 → 둘 다 null.
  const none = m.normalizeAdsetMetrics(row({ spend: '100000', actions: [], action_values: [] }));
  assert.equal(none.cpa, null);
  assert.equal(none.roas, null);
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
