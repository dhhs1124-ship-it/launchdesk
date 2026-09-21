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
  assert.deepEqual(calls[0], { store_id: 's1', scope: 'adsets', period: 'month' });
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

test('기간 전환: 오늘 1회 호출, 이번 달 복귀는 캐시로 0회', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.setPeriod('today');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].period, 'today');
  await ctl.setPeriod('month');
  assert.equal(calls.length, 2);
  assert.equal(ctl.getView().period, 'month');
  assert.equal(ctl.getView().status, 'ready');
  await ctl.setPeriod('last_7d'); // 지원하지 않는 기간은 무시
  assert.equal(calls.length, 2);
});

test('광고 세트 펼침: ads 1회 · 재펼침 0회 · 다른 세트는 1회, 요청 본문에 세트 값이 실린다', async () => {
  const { ctl, calls } = harness(okHandler);
  ctl.setStore('s1');
  await ctl.ensureList();
  await ctl.toggle('c0-a0');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { store_id: 's1', scope: 'ads', period: 'month', adset_id: '120220000000011' });
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
  await ctl.setPeriod('today');
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
  await ctl.setPeriod('today');
  assert.equal(ctl.setStore('s1'), false); // 같은 값 — 아무 일 없음
  assert.equal(ctl.getView().period, 'today');

  assert.equal(ctl.setStore(null), true); // 로그아웃
  assert.equal(ctl.getStoreId(), null);
  assert.equal(ctl.getView().status, 'idle');
  assert.equal(await ctl.ensureList(), null); // 쇼핑몰 없으면 호출하지 않는다
  const before = calls.length;
  ctl.setStore('s1'); // 다시 로그인
  assert.equal(ctl.getView().period, 'month');
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

test('저장 금지: localStorage · sessionStorage · insert · upsert · DB 조회가 없다', () => {
  for (const [name, src] of [['core', CORE_SRC], ['dom', DOM_SRC]]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, name);
    assert.doesNotMatch(src, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.from\(|\.rpc\(/, name);
  }
  assert.doesNotMatch(CORE_SRC, /document|XMLHttpRequest|fetch\(/);
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
  assert.match(sec, /data-madsets-period="today" aria-pressed="false"/);
  assert.match(sec, /data-madsets-period="month" aria-pressed="true"/);
  assert.match(sec, /id="metaAdsetsStatus" aria-live="polite"/);
  assert.match(sec, /id="metaAdsetsBody" aria-busy="true"/);
  assert.doesNotMatch(sec, /<table/i);
  assert.doesNotMatch(sec, /\p{Extended_Pictographic}/u);
  // 레거시 #/tools Meta 패널은 그대로
  assert.equal((INDEX.match(/id="metaOpsPanel"/g) || []).length, 1);
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
