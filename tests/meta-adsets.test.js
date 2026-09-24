/* Meta 광고 세트 · 광고별 성과 — 순수 core + 연결 소스 검증
   실행: node --test tests/meta-adsets.test.js

   core(meta-adsets-core.js)를 실제로 require해 값으로 검증하고, 화면 연결
   파일(meta-adsets.js) · index.html · styles.css · ops-overview.js는 소스
   텍스트로 규칙(호출 조건 · 금지 필드 · 저장 금지 · 접근성 속성 · 스크립트
   순서)을 확인한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../meta-adsets-core.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const CORE_SRC = read('meta-adsets-core.js');
const DOM_SRC = read('meta-adsets.js');
const INDEX = read('index.html');
const CSS = read('styles.css');
const OPS_SRC = read('ops-overview.js');

// ------------------------------------------------------------------ 픽스처
const metrics = (o) => Object.assign({
  spend: 10000, impressions: 5000, reach: 4000, frequency: 1.25, clicks: 120, link_clicks: 100,
  link_ctr: 2, link_cpc: 100, cpm: 2000,
  landing_page_view: { value: 90, observed: true, basis: 'landing_page_view' },
  add_to_cart: { value: 10, observed: true, basis: 'offsite_conversion.fb_pixel_add_to_cart' },
  initiate_checkout: { value: 5, observed: true, basis: 'offsite_conversion.fb_pixel_initiate_checkout' },
  purchase: { value: 2, observed: true, basis: 'offsite_conversion.fb_pixel_purchase' },
  purchase_value: { value: 60000, observed: true, basis: 'offsite_conversion.fb_pixel_purchase' },
  funnel_status: { usable: true, code: null },
  landing_rate: 90, add_to_cart_rate: 11.1, checkout_rate: 50, purchase_rate: 2.2, cpa: 5000, roas: 6
}, o || {});

const adset = (id, name, m) => ({ adset_id: '1202200000000' + id, adset_name: name, metrics: m });
const campaign = (id, name, objective, adsets) => ({
  campaign_id: '1202100000000' + id, campaign_name: name, objective, adsets
});
const payload = (campaigns, o) => Object.assign({
  ok: true,
  account: { id: 'act_999888777666', name: '계정', currency: 'KRW', timezone: 'Asia/Seoul' },
  range: { period: 'month', since: '2026-09-01', until: '2026-09-21' },
  campaigns, truncated: false, fetched_rows: 3, page_count: 1
}, o || {});
const adsPayload = (ads, o) => Object.assign({
  ok: true,
  account: { id: 'act_999888777666', name: '계정', currency: 'KRW', timezone: 'Asia/Seoul' },
  range: { period: 'month', since: '2026-09-01', until: '2026-09-21' },
  adset: { adset_id: '120220000000011', adset_name: 'x' },
  ads, truncated: false
}, o || {});
const ad = (id, name, m) => ({ ad_id: '1202300000000' + id, ad_name: name, metrics: m });

const readyView = (list, extra) => Object.assign({ period: 'month', status: 'ready', code: null, vm: list.vm, open: {}, ads: {} }, extra || {});

// 컨트롤러 하니스 — 가짜 시계 · 호출 기록
function harness(handler) {
  let t = 1000;
  const calls = [];
  const ctl = Core.createController({
    invoke: (body) => { calls.push(body); return handler(body); },
    now: () => t,
    onChange: () => {}
  });
  return { ctl, calls, tick: (ms) => { t += ms; } };
}
const okHandler = (b) => Promise.resolve({
  ok: true,
  data: b.scope === 'ads'
    ? adsPayload([ad('1', '광고 A', metrics())])
    : payload([campaign('1', '캠페인', 'OUTCOME_SALES', [adset('11', '세트 A', metrics()), adset('12', '세트 B', metrics({ spend: 500 }))])])
});

// =========================================================== 응답 → 뷰모델
test('목록 응답 → 뷰모델: 캠페인 · 광고 세트 표시 문자열과 로컬 키', () => {
  const list = Core.buildListVm(payload([
    campaign('1', '봄 캠페인', 'OUTCOME_SALES', [adset('11', '세트 A', metrics())])
  ]));
  const c = list.vm.campaigns[0];
  assert.equal(c.key, 'c0');
  assert.equal(c.name, '봄 캠페인');
  assert.equal(c.objective, '판매');
  assert.equal(c.adsetCount, 1);
  const a = c.adsets[0];
  assert.equal(a.key, 'c0-a0');
  assert.equal(a.name, '세트 A');
  assert.equal(a.spend, '₩10,000');
  assert.equal(a.linkCtr, '2.00%');
  assert.equal(a.purchases, '2건');
  assert.equal(a.cpa, '₩5,000');
  assert.equal(a.roas, '600%');
  assert.equal(a.note, null);
  assert.deepEqual(a.detail.map((d) => d.label),
    ['노출', '도달', '빈도', '링크 클릭', '링크 CPC', 'CPM', '장바구니', '결제 시작', '구매금액']);
  assert.equal(list.vm.range.since, '2026-09-01');
  assert.equal(list.vm.timezone, 'Asia/Seoul');
  assert.equal(list.idByKey['c0-a0'], '120220000000011');
});

test('실계정 LPV 이상 사례(링크 클릭 779 · LPV 4502): LPV · 차단된 비율 · basis가 뷰모델과 HTML에 없다', () => {
  const m = metrics({
    link_clicks: 779,
    landing_page_view: { value: 4502, observed: true, basis: 'landing_page_view' },
    funnel_status: { usable: false, code: 'LPV_EXCEEDS_LINK_CLICKS' },
    landing_rate: null, add_to_cart_rate: null, purchase_rate: null, checkout_rate: 40
  });
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', m)])]));
  const a = list.vm.campaigns[0].adsets[0];
  assert.equal(a.dataNote, 'Meta 집계 기준이 달라 클릭 이후 구간의 비율은 비교하지 않았어요.');
  assert.ok(a.detail.some((d) => d.label === '링크 클릭' && d.value === '779'));

  const ads = Core.buildAdsVm(adsPayload([ad('1', '광고', m)]));
  const view = readyView(list, { open: { 'c0-a0': true }, ads: { 'c0-a0': { status: 'ready', code: null, vm: ads } } });
  const html = Core.renderBody(view);
  const blob = JSON.stringify(list.vm) + JSON.stringify(ads) + html;
  assert.doesNotMatch(blob, /4502|landing|basis|offsite_conversion|_rate|랜딩/i);
  assert.match(html, /Meta 집계 기준이 달라 클릭 이후 구간의 비율은 비교하지 않았어요\./);
});

test('funnel_status가 LPV_EXCEEDS_LINK_CLICKS가 아니면 데이터 안내가 없다', () => {
  for (const fs_ of [{ usable: true, code: null }, { usable: false, code: 'LPV_NOT_OBSERVED' }, { usable: false, code: 'NO_LINK_CLICKS' }]) {
    const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics({ funnel_status: fs_ }))])]));
    assert.equal(list.vm.campaigns[0].adsets[0].dataNote, null);
  }
});

test('이름이 식별자와 같거나 비어 있으면 대체 문구를 쓰고 식별자 원문은 HTML 어디에도 없다', () => {
  const list = Core.buildListVm(payload([
    campaign('1', '1202100000000' + '1', 'OUTCOME_SALES', [adset('11', '1202200000000' + '11', metrics()), adset('12', '', metrics())])
  ]));
  const c = list.vm.campaigns[0];
  assert.equal(c.name, '이름 없는 캠페인');
  assert.equal(c.adsets[0].name, '이름 없는 광고 세트');
  assert.equal(c.adsets[1].name, '이름 없는 광고 세트');

  const ads = Core.buildAdsVm(adsPayload([ad('5', '1202300000000' + '5', metrics()), ad('6', null, metrics())]));
  assert.deepEqual(ads.ads.map((a) => a.name), ['이름 없는 광고', '이름 없는 광고']);

  const view = readyView(list, { open: { 'c0-a0': true }, ads: { 'c0-a0': { status: 'ready', code: null, vm: ads } } });
  const html = Core.renderBody(view);
  assert.doesNotMatch(html, /1202\d{9,}/);
  assert.doesNotMatch(html, /data-[a-z-]+="[^"]*\d{8,}/);
  assert.doesNotMatch(html, /id="[^"]*\d{8,}/);
  assert.doesNotMatch(JSON.stringify(list.vm), /1202\d{9,}/);
});

test('이름이 정상이면 그대로 쓰고, 이름에 HTML이 있어도 이스케이프된다', () => {
  const list = Core.buildListVm(payload([campaign('1', '<img src=x onerror=1>', 'OUTCOME_SALES', [adset('11', 'A & "B"', metrics())])]));
  const html = Core.renderBody(readyView(list));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /A &amp; &quot;B&quot;/);
});

test('purchase.observed=false → "—"와 안내 문구, observed 0건 → "이 기간 구매 0건", 그 외 문구 없음', () => {
  const absent = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [
    adset('11', 'S', metrics({
      purchase: { value: 0, observed: false, basis: null },
      purchase_value: { value: 0, observed: false, basis: null },
      add_to_cart: { value: 0, observed: false, basis: null },
      initiate_checkout: { value: 0, observed: false, basis: null },
      cpa: null, roas: null, frequency: null, link_ctr: null
    }))
  ])])).vm.campaigns[0].adsets[0];
  assert.equal(absent.purchases, '—');
  assert.equal(absent.cpa, '—');
  assert.equal(absent.roas, '—');
  assert.equal(absent.linkCtr, '—');
  assert.equal(absent.note, '이 기간 Meta 응답에 구매 항목이 없어요.');
  const byLabel = Object.fromEntries(absent.detail.map((d) => [d.label, d.value]));
  assert.equal(byLabel['장바구니'], '—');
  assert.equal(byLabel['결제 시작'], '—');
  assert.equal(byLabel['구매금액'], '—');
  assert.equal(byLabel['빈도'], '—');

  const zero = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [
    adset('11', 'S', metrics({ purchase: { value: 0, observed: true, basis: 'x' }, cpa: null }))
  ])])).vm.campaigns[0].adsets[0];
  assert.equal(zero.purchases, '0건');
  assert.equal(zero.note, '이 기간 구매 0건');

  const some = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])])).vm.campaigns[0].adsets[0];
  assert.equal(some.note, null);
});

test('캠페인 헤더: 광고비 합계만 만들고 reach · frequency · 비율 지표는 합산하지 않는다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [
    adset('11', 'A', metrics({ spend: 1000, reach: 999999, frequency: 7 })),
    adset('12', 'B', metrics({ spend: 2500, reach: 888888, frequency: 9 }))
  ])]));
  const c = list.vm.campaigns[0];
  assert.equal(c.spendTotal, '₩3,500');
  assert.deepEqual(Object.keys(c).sort(),
    ['adsetCount', 'adsets', 'hasObjective', 'key', 'name', 'objective', 'spendLabel', 'spendTotal']);
  const html = Core.renderBody(readyView(list));
  const head = html.match(/<header class="madsets-campaign-head">[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(head, /999,999|888,888|도달|빈도|CTR|CPA|ROAS|클릭률/);
  assert.match(head, /광고 세트 2개/);
  assert.match(head, /광고비 ₩3,500/);
});

test('truncated: 캠페인 라벨이 "표시된 광고 세트 광고비"로 바뀌고 상단 안내가 나온다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'A', metrics())])], { truncated: true }));
  assert.equal(list.vm.campaigns[0].spendLabel, '표시된 광고 세트 광고비');
  const html = Core.renderBody(readyView(list));
  assert.match(html, /표시된 광고 세트 광고비 ₩10,000/);
  assert.match(html, /광고 세트가 많아 일부 데이터만 표시돼요\./);
  const normal = Core.renderBody(readyView(Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'A', metrics())])]))));
  assert.doesNotMatch(normal, /일부 데이터만/);
  assert.match(normal, /광고비 ₩10,000/);
  assert.doesNotMatch(normal, /표시된 광고 세트 광고비/);
});

test('정렬: 캠페인은 광고비 합계, 광고 세트 · 광고는 광고비 내림차순, 같은 값은 Meta 반환 순서 유지', () => {
  const list = Core.buildListVm(payload([
    campaign('1', '작은', 'OUTCOME_SALES', [adset('11', 'x', metrics({ spend: 50 }))]),
    campaign('2', '큰 A', 'OUTCOME_SALES', [
      adset('21', 'A', metrics({ spend: 10 })), adset('22', 'B', metrics({ spend: 30 })),
      adset('23', 'C', metrics({ spend: 10 })), adset('24', 'D', metrics({ spend: 30 }))
    ]),
    campaign('3', '큰 B', 'OUTCOME_SALES', [adset('31', 'y', metrics({ spend: 80 }))])
  ]));
  assert.deepEqual(list.vm.campaigns.map((c) => c.name), ['큰 A', '큰 B', '작은']); // 80 == 80 → 원래 순서
  assert.deepEqual(list.vm.campaigns[0].adsets.map((a) => a.name), ['B', 'D', 'A', 'C']);
  assert.deepEqual(list.vm.campaigns.map((c) => c.key), ['c0', 'c1', 'c2']);

  const ads = Core.buildAdsVm(adsPayload([
    ad('1', 'p', metrics({ spend: 5 })), ad('2', 'q', metrics({ spend: 9 })), ad('3', 'r', metrics({ spend: 5 }))
  ]));
  assert.deepEqual(ads.ads.map((a) => a.name), ['q', 'p', 'r']);
});

test('목적 라벨: 6개만 한국어, 그 외는 원문, null은 "목적 정보 없음"', () => {
  assert.equal(Core.objectiveLabel('OUTCOME_AWARENESS'), '인지도');
  assert.equal(Core.objectiveLabel('OUTCOME_TRAFFIC'), '트래픽');
  assert.equal(Core.objectiveLabel('OUTCOME_ENGAGEMENT'), '참여');
  assert.equal(Core.objectiveLabel('OUTCOME_LEADS'), '잠재 고객');
  assert.equal(Core.objectiveLabel('OUTCOME_APP_PROMOTION'), '앱 홍보');
  assert.equal(Core.objectiveLabel('OUTCOME_SALES'), '판매');
  assert.equal(Core.objectiveLabel('CONVERSIONS'), 'CONVERSIONS');
  assert.equal(Core.objectiveLabel('constructor'), 'constructor');
  assert.equal(Core.objectiveLabel(null), '목적 정보 없음');
  assert.equal(Core.objectiveLabel(undefined), '목적 정보 없음');
  const list = Core.buildListVm(payload([campaign('1', 'C', null, [adset('11', 'S', metrics())])]));
  assert.match(Core.renderBody(readyView(list)), /<span>목적 정보 없음<\/span>/);
  const sales = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])]));
  assert.match(Core.renderBody(readyView(sales)), /<span>목적 판매<\/span>/);
});

test('빈 목록과 이상한 응답에서도 뷰모델이 만들어진다', () => {
  assert.deepEqual(Core.buildListVm(payload([])).vm.campaigns, []);
  assert.deepEqual(Core.buildListVm({ ok: true }).vm.campaigns, []);
  assert.match(Core.renderBody(readyView(Core.buildListVm(payload([])))), /이 기간에 표시할 광고 성과가 없습니다\./);
  assert.deepEqual(Core.buildAdsVm({ ok: true }).ads, []);
});

// ================================================================= 통화·비율
test('통화: KRW · JPY는 0자리, USD는 2자리, 코드는 응답 값 그대로', () => {
  assert.equal(Core.fmtMoney(1234.56, 'KRW'), '₩1,235');
  assert.equal(Core.fmtMoney(1234.56, 'JPY'), '¥1,235');
  assert.equal(Core.fmtMoney(1234.5, 'USD'), '$1,234.50');
  assert.equal(Core.fmtMoney(0, 'USD'), '$0.00');
  assert.equal(Core.fmtMoney(null, 'USD'), '—');
  assert.equal(Core.fmtMoney(undefined, 'USD'), '—');
});

test('잘못된 currency: 숫자와 받은 코드만 안전하게 표시', () => {
  assert.equal(Core.fmtMoney(1234.56, 'US'), '1,234.56 US');
  assert.equal(Core.fmtMoney(1234.56, undefined), '1,234.56');
  assert.equal(Core.fmtMoney(1234.56, ''), '1,234.56');
  const evil = Core.fmtMoney(5, '<b>x</b>');
  assert.doesNotMatch(evil, /[<>]/);
  assert.match(evil, /^5 /);
});

test('USD 계정이면 광고 세트 카드에 달러로 표시된다(통화 하드코딩 없음)', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics({ spend: 12.5, cpa: 3.25, link_cpc: 0.4, cpm: 8.1 }))])],
    { account: { currency: 'USD', timezone: 'America/Los_Angeles' } }));
  const a = list.vm.campaigns[0].adsets[0];
  assert.equal(a.spend, '$12.50');
  assert.equal(a.cpa, '$3.25');
  assert.equal(a.detail.find((d) => d.label === '링크 CPC').value, '$0.40');
  assert.equal(list.vm.campaigns[0].spendTotal, '$12.50');
});

test('ROAS는 ratio × 100 한 % 로 표시', () => {
  assert.equal(Core.fmtRoas(3.379073), '338%');
  assert.equal(Core.fmtRoas(0), '0%');
  assert.equal(Core.fmtRoas(12.5), '1,250%');
  assert.equal(Core.fmtRoas(null), '—');
  assert.equal(Core.fmtRoas(undefined), '—');
  assert.equal(Core.fmtPercent(1.23456), '1.23%');
  assert.equal(Core.fmtPercent(null), '—');
});

test('기간 · 시간대 문구: range 와 광고계정 시간대 기준이 함께 나온다', () => {
  const html = Core.renderBody(readyView(Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])]))));
  assert.match(html, /2026-09-01 ~ 2026-09-21 · 광고계정 시간대 기준 \(Asia\/Seoul\)/);
});

// =================================================================== 캐시
test('캐시 키: 쇼핑몰 · 기간 · 광고 세트가 모두 구분된다', () => {
  const keys = new Set([
    Core.cacheKey('s1', 'month'), Core.cacheKey('s1', 'today'), Core.cacheKey('s2', 'month'),
    Core.cacheKey('s1', 'month', 'a1'), Core.cacheKey('s1', 'today', 'a1'), Core.cacheKey('s1', 'month', 'a2')
  ]);
  assert.equal(keys.size, 6);
});

test('TTL 5분: 안에서는 호출 없이 캐시, 지나면 다시 호출', async () => {
  const { ctl, calls, tick } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.ensureList();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { store_id: 's1', scope: 'adsets', period: 'today' });
  tick(Core.TTL_MS - 1);
  await ctl.ensureList();
  assert.equal(calls.length, 1);
  tick(2);
  await ctl.ensureList();
  assert.equal(calls.length, 2);
  assert.equal(Core.TTL_MS, 5 * 60 * 1000);
});

test('동일 요청 in-flight 병합: 동시에 두 번 불러도 호출은 1회', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  await Promise.all([ctl.ensureList(), ctl.ensureList(), ctl.ensureList()]);
  assert.equal(calls.length, 1);
});

test('기간 전환: 기본은 오늘, 이번 달 1회 호출, 오늘 복귀는 캐시로 0회', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  assert.equal(ctl.getView().period, 'today');
  await ctl.ensureList();
  await ctl.setPeriod('month');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].period, 'month');
  await ctl.setPeriod('today');
  assert.equal(calls.length, 2);
  assert.equal(ctl.getView().period, 'today');
  assert.equal(ctl.getView().status, 'ready');
  await ctl.setPeriod('last_7d'); // 지원하지 않는 기간은 무시
  assert.equal(calls.length, 2);
});

test('어제 · 전체 · 날짜 선택: 요청 본문과 캐시가 기간(날짜 포함)별로 분리된다', async () => {
  const { ctl, calls, tick } = harness(okHandler);
  tick(Date.UTC(2026, 8, 24, 3) - 1000); // 2026-09-24 낮(브라우저 시간대와 무관하게 같은 날)
  ctl.setStore('s1');
  await ctl.setPeriod('yesterday');
  await ctl.setPeriod('all');
  assert.deepEqual(calls.map((c) => c.period), ['yesterday', 'all']);
  assert.equal(calls[0].date, undefined);

  await ctl.setPeriod('date', '2026-09-10');
  assert.deepEqual(calls[2], { store_id: 's1', scope: 'adsets', period: 'date', date: '2026-09-10' });
  await ctl.toggle('c0-a0'); // 상세(광고별)도 같은 날짜로 요청
  assert.equal(calls[3].scope, 'ads');
  assert.equal(calls[3].date, '2026-09-10');
  await ctl.setPeriod('date', '2026-09-11'); // 다른 날짜는 다른 캐시
  assert.equal(calls.length, 5);
  await ctl.setPeriod('date', '2026-09-10'); // 돌아오면 캐시
  assert.equal(calls.length, 5);
  assert.equal(ctl.getView().date, '2026-09-10');
});

test('날짜 선택: 미래 날짜 · 형식 오류는 호출 없이 무시된다', async () => {
  const { ctl, calls, tick } = harness(okHandler);
  tick(Date.UTC(2026, 8, 24, 3) - 1000);
  ctl.setStore('s1');
  await ctl.setPeriod('date', '2026-09-30');
  await ctl.setPeriod('date', '2026/09/10');
  await ctl.setPeriod('date');
  assert.equal(calls.length, 0);
  assert.equal(ctl.getView().period, 'today');
});

test('기간 문구: 카드 목록 · 상세 제목 · 상태 문구가 같은 기간을 표시한다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])],
    { range: { period: 'date', since: '2026-09-10', until: '2026-09-10' } }));
  const view = readyView(list, { period: 'date', date: '2026-09-10', open: { 'c0-a0': true },
    ads: { 'c0-a0': { status: 'ready', vm: Core.buildAdsVm(adsPayload([])) } } });
  const html = Core.renderBody(view);
  assert.match(html, /<p class="madsets-range">선택한 날짜 · 2026-09-10 · 광고계정 시간대 기준/);
  assert.match(html, /광고별 성과 · 2026-09-10/);
  assert.match(Core.statusText(view), /^2026-09-10 광고 세트 1개/);
});

test('전체 기간: "조회 가능한 전체 기간"으로 표시하고 시작일부터라고 표현하지 않는다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])],
    { range: { period: 'all', since: null, until: '2026-09-24' } }));
  const view = readyView(list, { period: 'all' });
  const html = Core.renderBody(view);
  assert.match(html, /조회 가능한 전체 기간 · ~ 2026-09-24/);
  assert.match(html, /최근 37개월 안의 성과를 모두 더한 값/);
  assert.doesNotMatch(html, /광고 시작일 ~|시작한 날부터|null/);
  assert.match(Core.statusText(view), /^조회 가능한 전체 기간 광고 세트/);
});

test('날짜 선택 하한: 37개월 조회 한도 밖 날짜는 호출하지 않는다', async () => {
  const { ctl, calls, tick } = harness(okHandler);
  tick(Date.UTC(2026, 8, 24, 3) - 1000);
  const earliest = Core.earliestDateString(Date.UTC(2026, 8, 24, 3));
  assert.equal(earliest, '2023-08-25');
  ctl.setStore('s1');
  await ctl.setPeriod('date', '2023-08-24');
  assert.equal(calls.length, 0);
  await ctl.setPeriod('date', earliest);
  assert.equal(calls.length, 1);
});

test('FUTURE_DATE 오류는 다시 시도 버튼 없이 안내만 한다', () => {
  const html = Core.renderBody({ period: 'date', date: '2026-09-30', status: 'error', code: 'FUTURE_DATE', vm: null, open: {}, ads: {} });
  assert.match(html, /오늘 이후 날짜는 조회할 수 없어요/);
  assert.doesNotMatch(html, /data-madsets-retry/);
});

test('광고 세트 펼침: ads 1회 · 재펼침 0회 · 다른 세트는 1회, 요청 본문에 세트 값이 실린다', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { store_id: 's1', scope: 'ads', period: 'today', adset_id: '120220000000011' });
  assert.equal(ctl.getView().open['c0-a0'], true);
  assert.equal(ctl.getView().ads['c0-a0'].status, 'ready');

  await ctl.toggle('c0-a0'); // 접기
  assert.equal(ctl.getView().open['c0-a0'], undefined);
  await ctl.toggle('c0-a0'); // 재펼침 — 캐시
  assert.equal(calls.length, 2);

  await ctl.toggle('c0-a1');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].adset_id, '120220000000012');
  await ctl.toggle('c9-a9'); // 없는 키는 무시
  assert.equal(calls.length, 3);
});

test('기간을 바꾸면 펼침 상태가 초기화된다(자동 ads 호출 없음)', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  await ctl.setPeriod('month');
  assert.deepEqual(ctl.getView().open, {});
  assert.equal(calls.filter((c) => c.scope === 'ads').length, 1);
});

test('패널 새로고침 · 전역 새로고침: 캐시를 비우고 다시 조회, 이전 세대의 늦은 응답은 무시', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.refresh();
  assert.equal(calls.length, 2);

  ctl.invalidate(); // 전역 새로고침
  assert.equal(ctl.getView().status, 'idle');
  await ctl.ensureList();
  assert.equal(calls.length, 3);

  // 로딩 중 새로고침 클릭은 무시(중복 호출 방지)
  let release;
  const slow = harness(() => new Promise((r) => { release = () => r({ ok: true, data: payload([]) }); }));
  slow.ctl.setStore('s1');
  const p = slow.ctl.ensureList();
  await slow.ctl.refresh();
  assert.equal(slow.calls.length, 1);
  release();
  await p;
});

test('stale 응답 무시: 쇼핑몰이 바뀐 뒤 도착한 이전 응답은 반영되지 않는다', async () => {
  let release;
  const { ctl, calls } = harness(() => new Promise((r) => { release = () => r({ ok: true, data: payload([campaign('1', '옛 쇼핑몰', 'OUTCOME_SALES', [adset('11', 'S', metrics())])]) }); }));
  ctl.setStore('s1');
  const p = ctl.ensureList();
  await new Promise((r) => setImmediate(r)); // invoke가 실제로 호출될 때까지
  ctl.setStore('s2');
  release();
  assert.equal(await p, null);
  assert.equal(ctl.getView().status, 'idle');
  assert.equal(ctl.getView().vm, null);
  ctl.setStore('s1'); // 돌아와도 캐시에 남아 있지 않다
  assert.equal(ctl.getView().status, 'idle');
  assert.equal(calls.length, 1);
});

test('store/user 변경 시 전체 초기화: 캐시 · 펼침 · 기간이 리셋되고, 같은 값이면 유지', async () => {
  const { ctl, calls } = harness(okHandler);
  assert.equal(ctl.setStore('s1'), true);
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  await ctl.setPeriod('month');
  assert.equal(ctl.setStore('s1'), false); // 같은 값 — 아무 일 없음
  assert.equal(ctl.getView().period, 'month');

  assert.equal(ctl.setStore(null), true); // 로그아웃
  assert.equal(ctl.getStoreId(), null);
  assert.equal(ctl.getView().status, 'idle');
  assert.equal(await ctl.ensureList(), null); // 쇼핑몰 없으면 호출하지 않는다
  const before = calls.length;
  ctl.setStore('s1'); // 다시 로그인 — 기본 기간(오늘)으로
  assert.equal(ctl.getView().period, 'today');
  assert.deepEqual(ctl.getView().open, {});
  await ctl.ensureList();
  assert.equal(calls.length, before + 1);
});

test('sync: 같은 사용자의 재조회 중 잠깐 null이 돼도 캐시를 유지하고, 다른 쇼핑몰 · 로그아웃이면 초기화한다', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.sync('s1', true);
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  assert.equal(calls.length, 2);

  assert.equal(ctl.sync(null, true), false); // 재조회 중 일시적 null — 로그인 상태
  assert.equal(ctl.getStoreId(), 's1');
  assert.equal(ctl.sync('s1', true), false); // 같은 쇼핑몰로 복귀
  await ctl.ensureList(); // 계정 요약 재성공 시점 — 캐시라 호출 없음
  assert.equal(calls.length, 2);
  assert.equal(ctl.getView().open['c0-a0'], true);

  assert.equal(ctl.sync('s2', true), true); // 다른 쇼핑몰(다른 사용자 포함)
  assert.equal(ctl.getView().status, 'idle');
  assert.deepEqual(ctl.getView().open, {});

  ctl.sync('s2', true);
  await ctl.ensureList();
  assert.equal(ctl.sync(null, false), true); // 로그아웃
  assert.equal(ctl.getStoreId(), null);
  assert.equal(ctl.getView().status, 'idle');
});

// ================================================================== 오류
test('오류 코드 매핑: 메시지와 동작(링크 / 수동 다시 시도)', () => {
  const expect = {
    RECONNECT_REQUIRED: ['Meta 연결이 만료되었어요. 다시 연결해주세요.', 'link'],
    PERMISSION_REQUIRED: ['이 광고계정 데이터를 볼 권한이 없습니다.', 'link'],
    RATE_LIMITED: ['Meta 요청이 많아 잠시 불러오지 못했어요.', 'retry'],
    TEMPORARY_ERROR: ['Meta 데이터를 불러오지 못했습니다.', 'retry'],
    ACCOUNT_UNAVAILABLE: ['이 광고계정에 접근할 수 없습니다.', 'link']
  };
  for (const [code, [message, action]] of Object.entries(expect)) {
    const info = Core.errorInfo(code);
    assert.equal(info.message, message, code);
    assert.equal(info.action, action, code);
    assert.equal(info.link.href, '#/account');
  }
  assert.equal(Core.errorInfo('SOMETHING_ELSE').code, 'TEMPORARY_ERROR');
  assert.equal(Core.errorInfo('constructor').code, 'TEMPORARY_ERROR');
  assert.equal(Core.errorInfo(undefined).code, 'TEMPORARY_ERROR');
});

test('invoke 결과 정규화: 성공 · 서버 오류 바디 · 바디 없음 · ok 아님', async () => {
  const good = { ok: true, campaigns: [] };
  assert.deepEqual(await Core.normalizeInvokeResult({ data: good, error: null }), { ok: true, data: good });
  const withBody = (code) => ({ data: null, error: { message: 'x', context: { json: () => Promise.resolve({ error: '메시지', code }) } } });
  assert.deepEqual(await Core.normalizeInvokeResult(withBody('RECONNECT_REQUIRED')), { ok: false, code: 'RECONNECT_REQUIRED' });
  assert.deepEqual(await Core.normalizeInvokeResult(withBody('RATE_LIMITED')), { ok: false, code: 'RATE_LIMITED' });
  assert.deepEqual(await Core.normalizeInvokeResult(withBody('UNKNOWN')), { ok: false, code: 'TEMPORARY_ERROR' });
  assert.deepEqual(await Core.normalizeInvokeResult({ data: null, error: { message: 'relay' } }), { ok: false, code: 'TEMPORARY_ERROR' });
  assert.deepEqual(await Core.normalizeInvokeResult({ data: null, error: { context: { json: () => Promise.reject(new Error('bad')) } } }), { ok: false, code: 'TEMPORARY_ERROR' });
  assert.deepEqual(await Core.normalizeInvokeResult({ data: { ok: false, code: 'ACCOUNT_UNAVAILABLE' } }), { ok: false, code: 'ACCOUNT_UNAVAILABLE' });
  assert.deepEqual(await Core.normalizeInvokeResult(undefined), { ok: false, code: 'TEMPORARY_ERROR' });
});

test('목록 오류: 패널 안에서 role=alert로 표시, 자동 재시도 없음, 수동 다시 시도만 재호출', async () => {
  const { ctl, calls } = harness(() => Promise.resolve({ ok: false, code: 'RATE_LIMITED' }));
  ctl.setStore('s1');
  await ctl.ensureList();
  assert.equal(ctl.getView().status, 'error');
  assert.equal(ctl.getView().code, 'RATE_LIMITED');
  const html = Core.renderBody(ctl.getView());
  assert.match(html, /role="alert"/);
  assert.match(html, /Meta 요청이 많아 잠시 불러오지 못했어요\./);
  assert.match(html, /data-madsets-retry="list"/);
  assert.doesNotMatch(html, /href=/);
  await new Promise((r) => setTimeout(r, 20)); // 시간이 지나도 스스로 다시 부르지 않는다
  assert.equal(calls.length, 1);
  await ctl.ensureList(); // 수동 다시 시도
  assert.equal(calls.length, 2);

  const link = harness(() => Promise.resolve({ ok: false, code: 'RECONNECT_REQUIRED' }));
  link.ctl.setStore('s1');
  await link.ctl.ensureList();
  const linkHtml = Core.renderBody(link.ctl.getView());
  assert.match(linkHtml, /Meta 연결이 만료되었어요\. 다시 연결해주세요\./);
  assert.match(linkHtml, /href="#\/account"/);
  assert.doesNotMatch(linkHtml, /data-madsets-retry/);
});

test('invoke가 예외를 던져도 오류 상태로 정리된다', async () => {
  const { ctl } = harness(() => { throw new Error('boom'); });
  ctl.setStore('s1');
  await ctl.ensureList();
  assert.equal(ctl.getView().status, 'error');
  assert.equal(ctl.getView().code, 'TEMPORARY_ERROR');
});

test('ads 오류는 해당 광고 세트 상세 안에서만 표시되고 목록은 그대로다', async () => {
  const { ctl, calls } = harness((b) => b.scope === 'ads'
    ? Promise.resolve({ ok: false, code: 'PERMISSION_REQUIRED' })
    : okHandler(b));
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  const view = ctl.getView();
  assert.equal(view.status, 'ready');
  assert.equal(view.ads['c0-a0'].status, 'error');
  const html = Core.renderBody(view);
  assert.equal((html.match(/role="alert"/g) || []).length, 1);
  const detail = html.match(/<div class="madsets-detail" id="madsets-c0-a0-detail"[\s\S]*?<\/div><\/div><\/li>/)[0];
  assert.match(detail, /role="alert"/);
  assert.match(detail, /이 광고계정 데이터를 볼 권한이 없습니다\./);
  assert.match(html, /세트 B/); // 다른 세트는 정상 표시
  assert.equal(calls.length, 2);
  await ctl.retryAds('c0-a0'); // 오류 항목은 수동으로만 다시 호출
  assert.equal(calls.length, 3);
});

test('ads 빈 결과 · 일부만 표시', async () => {
  const empty = harness((b) => b.scope === 'ads' ? Promise.resolve({ ok: true, data: adsPayload([]) }) : okHandler(b));
  empty.ctl.setStore('s1');
  await empty.ctl.ensureList();
  await empty.ctl.toggle('c0-a0');
  assert.match(Core.renderBody(empty.ctl.getView()), /이 기간에 표시할 광고가 없습니다\./);

  const part = harness((b) => b.scope === 'ads' ? Promise.resolve({ ok: true, data: adsPayload([ad('1', 'A', metrics())], { truncated: true }) }) : okHandler(b));
  part.ctl.setStore('s1');
  await part.ctl.ensureList();
  await part.ctl.toggle('c0-a0');
  assert.match(Core.renderBody(part.ctl.getView()), /광고가 많아 일부만 표시돼요\./);
});

// ============================================================ HTML · 접근성
test('접근성 속성: 토글 aria-expanded/aria-controls, 상세 role=region, 지표 dl, 헤딩', async () => {
  const { ctl } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  let html = Core.renderBody(ctl.getView());
  assert.match(html, /<button type="button" class="madsets-toggle" id="madsets-c0-a0-toggle" data-mk="c0-a0" data-mf="toggle-c0-a0" aria-expanded="false" aria-controls="madsets-c0-a0-detail" aria-labelledby="madsets-c0-a0-toggle madsets-c0-a0-name">상세 보기<\/button>/);
  assert.match(html, /<div class="madsets-detail" id="madsets-c0-a0-detail" role="region" aria-labelledby="madsets-c0-a0-name" hidden><\/div>/);
  assert.match(html, /<dl class="madsets-kpis">/);
  assert.match(html, /<h3 class="madsets-campaign-name"/);
  assert.match(html, /<h4 class="madsets-adset-name" id="madsets-c0-a0-name"/);
  assert.match(html, /<article class="madsets-campaign" aria-labelledby="madsets-c0-title">/);
  assert.doesNotMatch(html, /role="alert"/);

  await ctl.toggle('c0-a0');
  html = Core.renderBody(ctl.getView());
  assert.match(html, /aria-expanded="true" aria-controls="madsets-c0-a0-detail"[^>]*>상세 접기</);
  assert.doesNotMatch(html, /id="madsets-c0-a0-detail" role="region" aria-labelledby="madsets-c0-a0-name" hidden/);
  assert.match(html, /<dl class="madsets-detail-list">/);
  assert.match(html, /<ul class="madsets-ads-list">/);
  // aria-controls 대상 id가 실제로 존재한다
  for (const m of html.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(html.includes('id="' + m[1] + '"'), m[1]);
});

test('신규 영역 HTML에는 표 · 이모지가 없다', async () => {
  const { ctl } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  const html = Core.renderBody(ctl.getView());
  assert.doesNotMatch(html, /<table|<tr|<td|<th/i);
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
});

test('상태 문구(aria-live용): 로딩 · 개수 · 빈 결과 · 오류', async () => {
  assert.equal(Core.statusText({ status: 'idle', vm: null, period: 'month' }), '광고 세트를 불러오는 중이에요.');
  assert.equal(Core.statusText({ status: 'error', vm: null, period: 'month' }), '');
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'A', metrics()), adset('12', 'B', metrics())])]));
  assert.equal(Core.statusText(readyView(list)), '이번 달 광고 세트 2개를 불러왔어요.');
  assert.equal(Core.statusText(readyView(list, { period: 'today' })), '오늘 광고 세트 2개를 불러왔어요.');
  assert.equal(Core.statusText(readyView(Core.buildListVm(payload([])))), '표시할 광고 성과가 없어요.');
});

test('금지 표현이 HTML 문구에 없다(좋음/나쁨 · 합격선 · 추적 · 평균 비교)', async () => {
  const { ctl } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  assert.doesNotMatch(Core.renderBody(ctl.getView()), /좋음|나쁨|양호|주의|합격|추적 미설정|픽셀 오류|평균보다/);
});

// ============================================================ 소스 · 연결 규칙
test('랜딩 관련 금지 필드가 core · 화면 연결 코드에서 쓰이지 않는다', () => {
  for (const [name, src] of [['core', CORE_SRC], ['dom', DOM_SRC]]) {
    assert.doesNotMatch(src, /landing_page_view|landing_rate|add_to_cart_rate|purchase_rate|checkout_rate|basis/, name);
  }
});

test('금지 표현 · 통화 하드코딩이 소스에 없다', () => {
  for (const [name, src] of [['core', CORE_SRC], ['dom', DOM_SRC]]) {
    assert.doesNotMatch(src, /좋음|나쁨|양호|주의|합격선|추적 미설정|픽셀 오류|평균보다/, name);
    assert.doesNotMatch(src, /KRW/, name);
  }
});

test('저장 금지(광고 성과): localStorage · sessionStorage가 없고, core는 여전히 완전한 순수 함수다', () => {
  for (const [name, src] of [['core', CORE_SRC], ['dom', DOM_SRC]]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, name);
  }
  // meta-adsets-core.js는 광고 세트 손익분기 기준 연결이 생긴 뒤에도 여전히
  // DOM · 네트워크 · DB를 전혀 모르는 순수 모듈이어야 한다.
  assert.doesNotMatch(CORE_SRC, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.from\(|\.rpc\(/);
  assert.doesNotMatch(CORE_SRC, /document|XMLHttpRequest|fetch\(/);
});

test('DB 쓰기는 ad_margin_links 하나로만 한정되고, Meta 광고 성과 자체는 저장하지 않는다', () => {
  // meta-adsets.js의 유일한 DB 접근 대상은 ad_margin_links(손익분기 기준
  // 연결)뿐이다 — .from(...)에 다른 테이블 이름이 등장하면 안 된다.
  const fromCalls = DOM_SRC.match(/\.from\(\s*(['"])([^'"]+)\1/g) || [];
  assert.ok(fromCalls.length > 0, 'ad_margin_links 접근 코드를 찾지 못함');
  for (const call of fromCalls) assert.match(call, /ad_margin_links/, call);
  // 광고 성과 지표(광고비 · ROAS · 구매 등)를 쓰기 페이로드 필드로 쓰는
  // 코드가 없다 — 저장하는 것은 사용자가 선택한 마진 계산 스냅샷뿐이다.
  assert.doesNotMatch(DOM_SRC, /\bspend\s*:|\broas\s*:|\bpurchases\s*:|\bimpressions\s*:|\breach\s*:|\bfrequency\s*:|\blink_ctr\s*:|\bcpa\s*:/);
  // upsert/delete 대상도 ad_margin_links로만 한정된다.
  assert.match(DOM_SRC, /\.upsert\(payload, \{ onConflict: 'store_id,meta_adset_id' \}\)/);
  assert.match(DOM_SRC, /\.delete\(\)\s*\n\s*\.eq\('store_id', storeId\)\.eq\('meta_adset_id', adsetId\)/);
});

test('원본 Meta adset_id(rawId)는 store_id/meta_adset_id 키 이름으로만 페이로드에 실리고, 그 값 자체는 로그에 남지 않는다', () => {
  const consoleCalls = DOM_SRC.match(/console\.(error|log|warn)\([^)]*\)/g) || [];
  for (const call of consoleCalls) {
    assert.doesNotMatch(call, /rawId|adsetId|snap\.value|snapshotValue|candidate\.record|rawLabel/, call);
  }
});

test('호출 조건: 운영 현황 경로 · storeId · meta.state==="data"만 쓰고 Cafe24 상태는 조건이 아니다', () => {
  assert.match(DOM_SRC, /'\/dashboard'/);
  assert.match(DOM_SRC, /snapshot\.storeId/);
  assert.match(DOM_SRC, /metaState === 'data'/);
  assert.doesNotMatch(DOM_SRC, /cafe24/i);
  assert.match(DOM_SRC, /becameReady && isDashboardRoute\(\)/);
  assert.match(DOM_SRC, /ctl\.sync\(storeId, authed\)/);
  assert.match(DOM_SRC, /launchdeskStore\.isAuthed\(\)/);
  assert.match(DOM_SRC, /functions\.invoke\('meta-adset-insights'/);
});

test('ops-overview.js: 스냅샷에 storeId만 추가됐고 Meta 조회 흐름은 그대로다', () => {
  assert.match(OPS_SRC, /storeId: selectedStoreId,/);
  assert.equal((OPS_SRC.match(/storeId: selectedStoreId/g) || []).length, 1);
  assert.match(OPS_SRC, /sb\.functions\.invoke\('meta-insights', \{ body: \{ connected_account_id: connectedAccountId \} \}\)/);
  assert.doesNotMatch(OPS_SRC, /meta-adset-insights/); // 신규 함수 호출은 ops-overview가 하지 않는다
});

test('index.html 스크립트 순서: ops-overview → core → 연결 파일 → 이후 기존 스크립트', () => {
  const ops = INDEX.indexOf('<script src="ops-overview.js">');
  const core = INDEX.indexOf('<script src="meta-adsets-core.js">');
  const dom = INDEX.indexOf('<script src="meta-adsets.js">');
  const next = INDEX.indexOf('<script src="wholesalers.js">');
  assert.ok(ops > 0 && ops < core && core < dom && dom < next, [ops, core, dom, next].join(','));
});

test('index.html 패널 위치와 접근성 속성', () => {
  const opsPanel = INDEX.indexOf('opsdash-ops-panel');
  const start = INDEX.indexOf('id="metaAdsetsPanel"');
  const triple = INDEX.indexOf('opsdash-row triple');
  assert.ok(opsPanel > 0 && opsPanel < start && start < triple, [opsPanel, start, triple].join(','));
  const sec = INDEX.slice(start, INDEX.indexOf('</section>', start));
  assert.match(sec, /\bhidden\b/);
  assert.match(sec, /role="group" aria-label="조회 기간"/);
  assert.match(sec, /data-madsets-period="today" aria-pressed="true"/);
  for (const p of ['yesterday', 'month', 'all']) assert.match(sec, new RegExp('data-madsets-period="' + p + '" aria-pressed="false"'));
  assert.match(sec, /<span class="sr-only">날짜 선택\(하루\)<\/span><input type="date" id="metaAdsetsDate"/);
  assert.match(sec, /id="metaAdsetsStatus" aria-live="polite"/);
  assert.match(sec, /id="metaAdsetsBody" aria-busy="true"/);
  assert.doesNotMatch(sec, /<table/i);
  assert.doesNotMatch(sec, /\p{Extended_Pictographic}/u);
  // 오픈 베타 전 단순화(3차)로 #/tools의 레거시 "쇼핑몰 운영 현황"/"Meta
  // 광고 성과" 패널은 완전히 제거됐다(#/dashboard와 중복 + 계산기와
  // 무관) — 마크업은 사라졌지만 ops-overview.js의 조회·발행 로직은
  // window.launchdeskOpsSnapshot으로 그대로 남아 #/dashboard가 구독한다.
  assert.equal((INDEX.match(/id="metaOpsPanel"/g) || []).length, 0);
  assert.equal((INDEX.match(/id="opsOverviewPanel"/g) || []).length, 0);
});

test('스타일: 신규 규칙은 기존 토큰만 쓰고 색 리터럴 · good/warn · table이 없다', () => {
  const rules = CSS.split('\n').filter((l) => l.includes('.madsets-'));
  assert.ok(rules.length > 20);
  for (const l of rules) {
    assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, l);
    assert.doesNotMatch(l, /\.good|\.warn|table/, l);
  }
  assert.match(CSS, /\.madsets-toggle\{[^}]*min-height:44px/);
  assert.match(CSS, /\.madsets-period\{display:grid; grid-template-columns:1fr 1fr; width:100%;\}/);
  assert.match(CSS, /\.madsets-detail\[hidden\]\{display:none;\}/);
});

// ================================================ 광고 세트 손익분기 기준 연결
const MarginCore = require('../meta-margin-core.js');

function linkedView(list, mk, linkOverride){
  return readyView(list, { links: Object.assign({ [mk]: { connected: false } }, linkOverride ? { [mk]: linkOverride } : {}) });
}

test('renderAdset: 연결 없음 → 안내 문구 + "마진 계산 연결" 버튼, 원본 Meta ID는 어디에도 없다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])]));
  const view = linkedView(list, 'c0-a0');
  const html = Core.renderBody(view);
  assert.match(html, /손익분기 기준이 연결되지 않았어요\./);
  assert.match(html, /data-mlink-action="connect" data-mk="c0-a0"/);
  assert.doesNotMatch(html, /기준 변경|연결 해제/);
  assert.doesNotMatch(html, /1202\d{9,}/); // Meta adset_id 원문 없음
});

test('renderAdset: 연결됨 + 유효 → 상품명 · 현재/손익분기 ROAS · 비교 문구 · 변경/해제 버튼', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics({ roas: 2.44 }))])]));
  const breakeven = MarginCore.computeBreakeven(25000, 10000); // 250.0%
  const compare = MarginCore.compareRoas(2.44, breakeven.ratio);
  const view = linkedView(list, 'c0-a0', { connected: true, productLabel: '여름 원피스', breakeven, compare });
  const html = Core.renderBody(view);
  assert.match(html, /여름 원피스/);
  assert.match(html, /현재 ROAS 244%/);
  assert.match(html, /연결한 손익분기 기준 250\.0%/);
  assert.match(html, /연결한 기준보다 6\.0%p 낮아요\./);
  assert.match(html, /연결한 계산 기준/);
  assert.match(html, /data-mlink-action="change" data-mk="c0-a0"/);
  assert.match(html, /data-mlink-action="disconnect" data-mk="c0-a0"/);
});

test('renderAdset: 연결됨 + 손익분기 계산 불가 → 사유 문구만, ROAS 비교 없음', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])]));
  const breakeven = MarginCore.computeBreakeven(10000, 0);
  const view = linkedView(list, 'c0-a0', { connected: true, productLabel: 'X', breakeven, compare: null });
  const html = Core.renderBody(view);
  assert.match(html, /광고비 전 남는 금액이 0원이라 손익분기 ROAS가 없어요\./);
  assert.doesNotMatch(html, /연결한 손익분기 기준 \d/);
  assert.doesNotMatch(html, /낮아요|높아요/);
});

test('오늘 기간 + 유효한 비교가 있을 때만 "오늘 데이터는 집계가 늦어" 안내가 붙는다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics({ roas: 2.44 }))])]));
  const breakeven = MarginCore.computeBreakeven(25000, 10000);
  const compare = MarginCore.compareRoas(2.44, breakeven.ratio);
  const todayView = Object.assign({}, linkedView(list, 'c0-a0', { connected: true, productLabel: 'X', breakeven, compare }), { period: 'today' });
  assert.match(Core.renderBody(todayView), /오늘 데이터는 집계가 늦어 값이 바뀔 수 있어요\./);
  const monthView = linkedView(list, 'c0-a0', { connected: true, productLabel: 'X', breakeven, compare });
  assert.doesNotMatch(Core.renderBody(monthView), /오늘 데이터는 집계가 늦어/);
});

test('연결 카드에 좋음/나쁨/성공/위험/중단 같은 확정 표현이나 색상 클래스가 없다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics({ roas: 2.62 }))])]));
  const breakeven = MarginCore.computeBreakeven(25000, 10000);
  const compare = MarginCore.compareRoas(2.62, breakeven.ratio);
  const html = Core.renderBody(linkedView(list, 'c0-a0', { connected: true, productLabel: 'X', breakeven, compare }));
  assert.doesNotMatch(html, /좋음|나쁨|성공|위험|중단|양호|주의|class="[^"]*good|class="[^"]*warn/);
});

test('view.links가 아예 없어도(과거 호출부와 호환) 렌더는 "연결 없음"으로 안전하게 처리된다', () => {
  const list = Core.buildListVm(payload([campaign('1', 'C', 'OUTCOME_SALES', [adset('11', 'S', metrics())])]));
  const html = Core.renderBody(readyView(list)); // links 필드 자체가 없음
  assert.match(html, /손익분기 기준이 연결되지 않았어요\./);
});

test('renderLinkModal — pick 단계: 후보 나열, 지금 입력한 값 태그, 빈 목록이면 #/tools 링크', () => {
  const candidates = [
    { source: 'current', dateLabel: '지금', qty: 1, priceLabel: '10,000원', preAdLabel: '3,000원', platformLabel: '카페24', breakeven: { ok: true, pctLabel: '150.0%' } },
    { source: 'saved', dateLabel: '9.20.', qty: 2, priceLabel: '20,000원', preAdLabel: '5,000원', platformLabel: '스마트스토어', breakeven: { ok: false, reason: '총 수입이 0원 이하라 손익분기 ROAS를 계산할 수 없어요.' } }
  ];
  const html = Core.renderLinkModal({ step: 'pick', candidates: candidates });
  assert.match(html, /지금 입력한 값/);
  assert.match(html, /data-mlink-pick="0"/);
  assert.match(html, /data-mlink-pick="1"/);
  assert.match(html, /손익분기 ROAS 150\.0%/);
  assert.match(html, /총 수입이 0원 이하라 손익분기 ROAS를 계산할 수 없어요\./);

  const empty = Core.renderLinkModal({ step: 'pick', candidates: [] });
  assert.match(empty, /저장한 마진 계산 기록이 없어요\./);
  assert.match(empty, /href="#\/tools"/);
});

test('renderLinkModal — label 단계: 안내·경고 문구, 필수 입력, 오류 표시, 저장 중 버튼 잠금', () => {
  const candidate = { dateLabel: '9.20.', qty: 1, priceLabel: '10,000원', breakeven: { ok: true, pctLabel: '150.0%' } };
  const base = { step: 'label', candidates: [candidate], selectedIndex: 0, labelValue: '', labelError: null, saving: false };
  const html = Core.renderLinkModal(base);
  assert.match(html, /상품 구분용 이름/);
  assert.match(html, /상품명처럼 알아볼 수 있는 이름만 적어주세요\./);
  assert.match(html, /실명·연락처 등 개인정보는 적지 마세요\./);
  assert.match(html, /<input type="text" id="mlinkProductLabel" name="productLabel" maxlength="40"[^>]*required>/);
  assert.doesNotMatch(html, /role="alert"/);

  const withError = Core.renderLinkModal(Object.assign({}, base, { labelValue: '가'.repeat(41), labelError: '상품 구분용 이름은 40자 이내로 적어주세요.' }));
  assert.match(withError, /role="alert"/);
  assert.match(withError, /상품 구분용 이름은 40자 이내로 적어주세요\./);

  const saving = Core.renderLinkModal(Object.assign({}, base, { saving: true }));
  assert.match(saving, /연결하는 중…/);
  assert.match(saving, /data-mf="mlink-save" disabled/);
  assert.match(saving, /data-mf="mlink-back" disabled/);
});

test('meta-adsets.js: 확인(window.confirm) 이후에만 저장/삭제가 실행된다(취소 시 쓰기 없음)', () => {
  const saveIdx = DOM_SRC.indexOf('function saveLink(');
  const confirmIdx = DOM_SRC.indexOf('window.confirm(');
  assert.ok(confirmIdx > -1);
  const submitHandlerIdx = DOM_SRC.indexOf("marginLinkBody.addEventListener('submit'");
  const saveCallIdx = DOM_SRC.indexOf('saveLink(storeId, rawId, snap.value)');
  assert.ok(submitHandlerIdx > -1 && saveCallIdx > -1 && confirmIdx > submitHandlerIdx && confirmIdx < saveCallIdx,
    'confirm이 제출 핸들러 안에서 saveLink 호출보다 먼저 나와야 함');
  assert.match(DOM_SRC, /if\(!confirmed\) return; \/\/ 취소 — 쓰기 없음/);

  const disconnectFnIdx = DOM_SRC.indexOf('function disconnectLink(');
  const disconnectConfirmIdx = DOM_SRC.indexOf('window.confirm(', disconnectFnIdx);
  const deleteCallIdx = DOM_SRC.indexOf('deleteLink(storeId, rawId)');
  assert.ok(disconnectFnIdx > -1 && disconnectConfirmIdx > disconnectFnIdx && deleteCallIdx > disconnectConfirmIdx);
  assert.ok(saveIdx > -1);
});

test('meta-adsets.js: 중복 클릭 방지 — 저장 중(saving)·해제 중(linkDisconnectInFlight) 가드가 있다', () => {
  assert.match(DOM_SRC, /if\(linkModalState\.saving\) return; \/\/ 중복 클릭 방지/);
  assert.match(DOM_SRC, /if\(linkDisconnectInFlight\[mk\]\) return; \/\/ 중복 클릭 방지/);
});

test('meta-adsets.js: 이름·상품명 기반 자동 매칭이나 최신 계산 자동 선택 코드가 없다', () => {
  assert.doesNotMatch(DOM_SRC, /adset_name|adsetName\.includes|productLabel ===.*name|\.sort\(/);
  // 선택은 오직 사용자의 data-mlink-pick 클릭으로만 selectedIndex가 정해진다.
  assert.match(DOM_SRC, /linkModalState\.selectedIndex = idx;/);
  assert.equal((DOM_SRC.match(/selectedIndex = /g) || []).length, 2); // 초기화(null)와 pick 클릭, 두 곳뿐
});

test('meta-adsets.js: 예시 모드 값은 후보에 들어가지 않는다(buildCurrentRecord 공개 API를 그대로 신뢰)', () => {
  assert.match(DOM_SRC, /window\.launchdeskMarginCalcUI\.buildCurrentRecord\(\)/);
  // buildCurrentRecord()는 예시 모드일 때 null을 돌려준다(tools.js 계약) —
  // 이 파일은 그 반환값을 그대로 buildCandidateList에 넘기기만 하고,
  // 스스로 예시 모드를 판별하는 로직(예: exampleKey)을 새로 만들지 않는다.
  assert.doesNotMatch(DOM_SRC, /exampleKey/);
});

test('meta-adsets.js: 로그아웃 · 쇼핑몰 변경 시 링크 상태 · 원본 ID 매핑이 완전히 초기화된다', () => {
  assert.match(DOM_SRC, /function resetLinksState\(\)\{/);
  const fnBody = DOM_SRC.slice(DOM_SRC.indexOf('function resetLinksState(){'), DOM_SRC.indexOf('function syncLinksStore'));
  assert.match(fnBody, /linksState\.byId = \{\};/);
  assert.match(fnBody, /linksState\.storeId = null;/);
  assert.match(fnBody, /linksState\.epoch \+= 1;/);
  assert.match(DOM_SRC, /var linksChanged = syncLinksStore\(storeId, authed\);/);
});

test('meta-adsets.js: 다른 쇼핑몰로 늦게 도착한 링크 응답은 무시된다(epoch · storeId 재확인)', () => {
  const idx = DOM_SRC.indexOf('function ensureLinksLoaded(){');
  const body = DOM_SRC.slice(idx, DOM_SRC.indexOf('\n  }\n', idx));
  assert.match(body, /if\(myEpoch !== linksState\.epoch \|\| linksState\.storeId !== storeId\) return;/);
});

test('meta-adsets.js: upsert · delete 응답도 요청 시작 시점의 storeId · epoch를 캡처해 stale이면 상태 · 토스트를 건드리지 않는다', () => {
  // upsert(연결 저장) — submit 핸들러 안에서 saveLink 호출 전에 epoch를 캡처하고,
  // 응답 콜백 첫머리에서 store/세대가 바뀌었는지부터 확인한 뒤에만 모달 상태를 만진다.
  const submitIdx = DOM_SRC.indexOf("marginLinkBody.addEventListener('submit'");
  const saveCallIdx = DOM_SRC.indexOf('saveLink(storeId, rawId, snap.value)', submitIdx);
  const captureIdx = DOM_SRC.indexOf('var myEpoch = linksState.epoch;', submitIdx);
  assert.ok(captureIdx > -1 && captureIdx < saveCallIdx, 'saveLink 호출 전에 epoch를 캡처해야 함');
  const thenIdx = DOM_SRC.indexOf('.then(function(res){', saveCallIdx);
  const thenBody = DOM_SRC.slice(thenIdx, DOM_SRC.indexOf('\n      });', thenIdx));
  assert.match(thenBody, /var stale = \(myEpoch !== linksState\.epoch\) \|\| \(linksState\.storeId !== storeId\);/);
  assert.match(thenBody, /if\(stale\) return;/);
  // stale 판정이 모달 상태(닫힘/다른 세트) 판정보다 먼저 나와야 한다 —
  // store 전환 뒤 같은 카드키(mk)로 새 모달이 열려도 이전 store 응답이
  // "우연히 같은 mk"라는 이유로 통과되지 않도록.
  const modalCheckIdx = thenBody.indexOf('linkModalState.mk !== mk');
  assert.ok(modalCheckIdx > thenBody.indexOf('if(stale) return;'));

  // delete(연결 해제) — disconnectLink 안에서도 동일하게 캡처 · 확인한다.
  const disconnectFnIdx = DOM_SRC.indexOf('function disconnectLink(');
  const deleteCallIdx = DOM_SRC.indexOf('deleteLink(storeId, rawId)', disconnectFnIdx);
  const delCaptureIdx = DOM_SRC.indexOf('var myEpoch = linksState.epoch;', disconnectFnIdx);
  assert.ok(delCaptureIdx > -1 && delCaptureIdx < deleteCallIdx, 'deleteLink 호출 전에 epoch를 캡처해야 함');
  const delThenIdx = DOM_SRC.indexOf('.then(function(res){', deleteCallIdx);
  const delThenBody = DOM_SRC.slice(delThenIdx, DOM_SRC.indexOf('\n    });', delThenIdx));
  assert.match(delThenBody, /var stale = \(myEpoch !== linksState\.epoch\) \|\| \(linksState\.storeId !== storeId\);/);
  assert.match(delThenBody, /if\(stale\) return;/);
  // 실패 토스트든 성공 토스트든 stale이면 둘 다 건너뛰어야 한다 — stale 확인이
  // res.ok 분기보다 먼저 나와야 함.
  const staleIdx = delThenBody.indexOf('if(stale) return;');
  const okBranchIdx = delThenBody.indexOf('if(!res.ok){');
  assert.ok(staleIdx > -1 && okBranchIdx > staleIdx);
});

test('meta-adsets.js: localStorage/sessionStorage를 쓰지 않고, console 호출에 토큰·스냅샷·사용자 입력이 없다', () => {
  assert.doesNotMatch(DOM_SRC, /localStorage|sessionStorage|indexedDB/);
});

test('meta-adsets.js: 홈/#tools에서는 조회하지 않는다 — dashboard 경로 + becameReady 게이트를 ensureLinksLoaded도 그대로 쓴다', () => {
  const idx = DOM_SRC.indexOf('if(becameReady && isDashboardRoute()){');
  assert.ok(idx > -1);
  const block = DOM_SRC.slice(idx, DOM_SRC.indexOf('}', idx));
  assert.match(block, /ctl\.ensureList\(\);/);
  assert.match(block, /ensureLinksLoaded\(\);/);
});

test('meta-adsets.js: 모달 열기/닫기에서 포커스를 저장·복원한다', () => {
  assert.match(DOM_SRC, /linkModalOpenerEl = triggerEl \|\| document\.activeElement;/);
  assert.match(DOM_SRC, /opener\.focus\(\)/);
});

test('meta-adsets.js: ESC · 배경 클릭 · 닫기 버튼으로 모달을 닫을 수 있다', () => {
  assert.match(DOM_SRC, /marginLinkClose\.addEventListener\('click', closeLinkModal\)/);
  assert.match(DOM_SRC, /marginLinkBackdrop\.addEventListener\('click', closeLinkModal\)/);
  assert.match(DOM_SRC, /e\.key === 'Escape' && marginLinkModal/);
});

test('index.html: 손익분기 기준 연결 모달이 존재하고 필수 접근성 속성을 갖는다', () => {
  const start = INDEX.indexOf('id="marginLinkModal"');
  assert.ok(start > -1);
  const modalTag = INDEX.slice(INDEX.lastIndexOf('<div class="modal"', start), start + 400);
  assert.match(modalTag, /role="dialog" aria-modal="true" aria-labelledby="marginLinkTitle"/);
  assert.match(INDEX, /id="marginLinkBackdrop"/);
  assert.match(INDEX, /id="marginLinkClose"/);
  assert.match(INDEX, /id="marginLinkBody"/);
});

test('index.html: meta-margin-core.js가 meta-adsets-core.js 뒤, meta-adsets.js 앞에 로드된다', () => {
  const core = INDEX.indexOf('<script src="meta-adsets-core.js">');
  const marginCore = INDEX.indexOf('<script src="meta-margin-core.js">');
  const dom = INDEX.indexOf('<script src="meta-adsets.js">');
  assert.ok(core > 0 && core < marginCore && marginCore < dom, [core, marginCore, dom].join(','));
});
