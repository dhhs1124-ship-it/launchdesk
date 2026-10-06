/* 광고 기록 계산 · 실행 기록 규칙. 실행: node --test launchroas/adlog-core.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const AC = require('./adlog-core.js');
const CH = require('./adlog-change-core.js');

const manual = (o) => Object.assign({ id: 1, store_id: '4', date: '2026-10-01', name: '직접 입력', spend: 10000, revenue: 30000, channel: '메타' }, o);
const auto = (o) => Object.assign({ id: 2, source: 'meta_auto', meta_auto_key: '4|act_9|2026-10-01', store_id: '4', date: '2026-10-01', name: 'Meta 캠페인 전체 합계', spend: 12000, revenue: 36000, channel: '메타', currency: 'KRW' }, o);

test('예전 기록만 있으면 합계 · 평균 ROAS는 기존 계산과 같다', () => {
  const s = AC.summarize([manual({ id: 1 }), manual({ id: 3, date: '2026-10-02', spend: 20000, revenue: 40000, channel: '네이버' })]);
  assert.equal(s.totalSpend, 30000);
  assert.equal(s.averageRoas, 70000 / 30000);
});

test('같은 날 · 메타라는 이유만으로는 빼지 않는다: 계정 · 금액 근거가 없으면 중복 가능(합계 포함 · 선택 필요)', () => {
  const rows = [manual(), auto()];
  const s = AC.summarize(rows);
  assert.equal(s.totalSpend, 22000);
  assert.deepEqual(s.pending, { count: 1, krw: 10000 });
  assert.equal(s.duplicates['1'].status, 'possible');
  assert.deepEqual(AC.rowLabel(rows[0], s.duplicates), ['중복 가능 · 합계 포함 중 · 선택 필요 (확인 안 된 근거: 광고계정, 집계 범위, 같은 금액)']);
});

test('확정 중복은 광고계정 · 기간 · 집계 범위 · 같은 금액이 모두 맞을 때만, 하나라도 없으면 중복 가능', () => {
  const full = { meta_account_id: 'act_9', scope: 'account_total', spend: 12000 };
  const s0 = AC.summarize([manual(full), auto()]);
  assert.equal(s0.totalSpend, 12000);
  assert.equal(s0.duplicates['1'].status, 'confirmed');
  const cases = [
    [{ meta_account_id: 'act_9', scope: 'account_total' }, '같은 금액'],      // 금액 다름
    [{ spend: 12000 }, '광고계정'],                                          // 같은 금액만
    [{ meta_account_id: 'act_9', spend: 12000 }, '집계 범위'],              // 계정 + 금액, 범위 모름
    [{ meta_account_id: 'act_9', scope: 'partial', spend: 12000 }, '일부 캠페인'],
    [{ scope: 'account_total', spend: 12000 }, '광고계정'],
  ];
  for (const [o, why] of cases) {
    const s = AC.summarize([manual(o), auto()]);
    assert.equal(s.duplicates['1'].status, 'possible', JSON.stringify(o));
    assert.match(s.duplicates['1'].reason, new RegExp(why));
    assert.equal(s.totalSpend, 12000 + (o.spend || 10000), '중복 가능은 합계에 포함');
  }
  const day2 = AC.summarize([manual(Object.assign({ date: '2026-10-02' }, full)), auto()]);
  assert.equal(day2.duplicates['1'], undefined, '다른 날짜는 비교하지 않는다');
  assert.equal(AC.summarize([manual({ meta_account_id: 'act_7' }), auto()]).duplicates['1'], undefined, '다른 광고계정');
  assert.equal(AC.summarize([manual({ meta_account: 'other' }), auto()]).duplicates['1'], undefined, '다른 광고계정으로 입력');
});

test('사용자 선택이 판정보다 우선하고, 같은 기록은 최신 선택만 쓴다(다시 불러와도 같은 결과)', () => {
  const rows = [manual(), auto()];
  const decisions = [
    { record_id: 1, include: false, decided_at: '2026-10-06T01:00:00Z' },
    { record_id: 1, include: true, decided_at: '2026-10-06T02:00:00Z' },
  ];
  assert.equal(AC.summarize(rows, decisions).totalSpend, 22000);
  const flipped = AC.summarize(rows, decisions.concat({ record_id: 1, include: false, decided_at: '2026-10-06T03:00:00Z' }));
  assert.equal(flipped.totalSpend, 12000);
  assert.equal(flipped.excluded.chosen, 1);
  assert.deepEqual(AC.rowLabel(rows[0], flipped.duplicates), ['중복 확인 · 사용자가 합계 제외 선택']);
  // 확정 중복도 사용자가 포함으로 되돌릴 수 있다
  assert.equal(AC.summarize([manual({ meta_account_id: 'act_9', scope: 'account_total', spend: 12000 }), auto()], [{ record_id: 1, include: true, decided_at: 'x' }]).totalSpend, 24000);
});

test('외화: 원본 · 통화 · 적용 환율을 그대로 보여 주고, 환율이 없으면 합계 제외를 표시한다', () => {
  const fx = manual({ id: 5, channel: '네이버', currency: 'USD', spend: 10, revenue: 30, fx_krw_per_unit: 1400 });
  const nofx = manual({ id: 6, channel: '네이버', currency: 'USD', spend: 10, revenue: 30 });
  const s = AC.summarize([fx, nofx]);
  assert.equal(s.totalSpend, 14000);
  assert.equal(s.excluded.currency, 1);
  assert.equal(AC.moneyText(fx, fx.spend), 'USD 10 × 1,400 = ₩14,000');
  assert.equal(AC.moneyText(nofx, nofx.spend), 'USD 10 · 환율 없음');
  assert.deepEqual(AC.rowLabel(nofx, s.duplicates), ['USD 기록 · 적용 환율 없음 · 합계 제외']);
  assert.equal(fx.spend, 10, '원본 값은 바꾸지 않는다');
});

test('변경 · 결과 기록은 합계에서 빠지고 금액 칸은 —, 결과는 action_id로 묶이며 고아 결과는 따로 표시', () => {
  const change = { id: 10, source: 'change', action_id: 'a1', store_id: '4', date: '2026-10-06', name: '변경', channel: '메타' };
  const r1 = { id: 11, source: 'change_result', action_id: 'a1', measured_at: '2026-10-13' };
  const r2 = { id: 12, source: 'change_result', action_id: 'a1', measured_at: '2026-10-20' };
  const orphan = { id: 13, source: 'change_result', action_id: 'gone' };
  const s = AC.summarize([manual(), change, r1]);
  assert.equal(s.totalSpend, 10000);
  assert.equal(AC.moneyText(change, change.spend), '—');
  const L = AC.linkChanges([change, r2, r1, orphan]);
  assert.deepEqual(L.changes.a1.results.map((r) => r.id), [11, 12]);
  assert.deepEqual(AC.rowLabel(orphan, {}, L), ['결과 기록 · 합계 제외 · 연결된 변경 기록 없음']);
});

// ---- 실행 기록 · 결과 비교 ----
const day = (date, spend, buy, value) => ({ date, metrics: { spend, impressions: spend * 10, link_clicks: spend / 100, purchase: { value: buy, observed: true }, purchase_value: { value, observed: true } } });
const week = (start, spend, buy, value) => Array.from({ length: 7 }, (_, i) => day(CH.addDays(start, i), spend, buy, value));
const basis = (pre) => ({ currency: 'KRW', attribution: 'API 기본(클릭 후 7일 · 조회 후 1일)', margin: { product_label: '니트', pre_ad: pre, source_saved_at: 's1' } });

function makeChange(beforeRows, opts = {}) {
  const p = CH.periods('2026-09-08', 7);
  const built = CH.buildChangeRecord({ storeId: '4', ad: { ad_id: '111', adset_id: '222', ad_name: '니트 광고' }, element: '문구', before: '할인 안내', after: '울 50% 강조',
    startDate: '2026-09-08', compareDays: 7, baseline: { metrics: CH.aggregate(beforeRows, p.before.since, p.before.until) }, basis: opts.basis || basis(20000),
    concurrent: opts.concurrent || [], suggestion: { week: '2026-09-01', ad_id: '111', verdict: '개선 필요' } }, Date.parse('2026-09-08T00:00:00Z'));
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return built.record;
}

test('변경 기록: 필수값 검증 · 금액 칸 없음 · 같은 길이 비교 기간', () => {
  assert.deepEqual(CH.buildChangeRecord({}).errors.slice(0, 3), ['쇼핑몰', '대상 광고(광고 · 광고 세트 ID)', '바꾼 요소']);
  const c = makeChange(week('2026-09-01', 10000, 2, 60000));
  assert.equal(c.source, 'change');
  assert.equal(c.spend, undefined);
  assert.deepEqual(c.compare.before, { since: '2026-09-01', until: '2026-09-07' });
  assert.deepEqual(c.compare.after, { since: '2026-09-08', until: '2026-09-14' });
  assert.equal(c.baseline.metrics.spend, 70000);
  assert.equal(AC.summarize([c]).totalSpend, 0);
});

test('결과: 광고비가 줄었어도 구매가 줄면 개선이 아니고, 지출 감소로만 기록 · 이익은 참고 계산으로만', () => {
  const c = makeChange(week('2026-09-01', 10000, 2, 60000));
  const after = CH.aggregate(week('2026-09-08', 6000, 1, 30000), '2026-09-08', '2026-09-14');
  const r = CH.compare(c, after, basis(20000), '2026-09-30');
  assert.equal(r.status, 'worse');
  assert.equal(r.spend.diff, -28000);
  assert.deepEqual({ ...r.purchases }, { before: 14, after: 7, diff: -7 });
  assert.equal(r.profit.kind, 'reference');
  assert.match(r.profit.basis, /참고 계산 .*가정 · 검증된 이익이 아님/);
  assert.ok(r.warnings.some((x) => x.includes('개선 성공이 아니에요')));
});

test('결과: 판정은 구매 · 구매당 광고비로만(참고 이익은 판정에 쓰지 않음) · 함께 바뀐 조건은 효과 분리 불가', () => {
  const c = makeChange(week('2026-09-01', 10000, 1, 30000), { concurrent: ['할인'] });
  const after = CH.aggregate(week('2026-09-08', 10000, 2, 60000), '2026-09-08', '2026-09-14');
  const r = CH.compare(c, after, basis(20000), '2026-09-30');
  assert.equal(r.status, 'improved');
  assert.match(r.reasons[0], /구매당 광고비가 낮아졌어요/);
  assert.equal(Math.round(r.cpa.before), 10000); assert.equal(Math.round(r.cpa.after), 5000);
  assert.equal(r.separable, false);
  // 연결 상품이 없어도 같은 판정 · 이익은 계산 보류
  const r2 = CH.compare(makeChange(week('2026-09-01', 10000, 1, 30000), { basis: { currency: 'KRW', attribution: 'API 기본(클릭 후 7일 · 조회 후 1일)', margin: null } }), after, null, '2026-09-30');
  assert.equal(r2.status, 'improved');
  assert.deepEqual({ ...r2.profit }, { kind: 'withheld', reason: '이익 변화 계산 보류 · 연결 상품 마진 없음' });
});

test('결과: 연결 마진이 낮아지면 비용 누락 발견으로 따로 표시하고 참고 계산에는 당시 마진을 쓴다(합산 안 함)', () => {
  const c = makeChange(week('2026-09-01', 10000, 1, 30000));
  const after = CH.aggregate(week('2026-09-08', 10000, 2, 60000), '2026-09-08', '2026-09-14');
  const r = CH.compare(c, after, Object.assign(basis(15000), { margin: { pre_ad: 15000, source_saved_at: 's2' } }), '2026-09-30');
  assert.equal(r.missingCost.per_order, 5000);
  assert.equal(r.profit.after, 20000 * 14 - 70000, '참고 계산은 변경 당시 마진(20000)');
});

test('결과: 기간 미종료 · 조회 실패 · 통화 변경 · 구매 미측정은 판단 불가 · 표본이 작으면 판정은 하되 주의 표시(고정 기준으로 막지 않음) · 최근 3일은 잠정', () => {
  const c = makeChange(week('2026-09-01', 10000, 1, 30000));
  const full = CH.aggregate(week('2026-09-08', 10000, 2, 60000), '2026-09-08', '2026-09-14');
  assert.equal(CH.compare(c, full, basis(20000), '2026-09-14').status, 'unknown');
  assert.equal(CH.compare(c, CH.aggregate(week('2026-09-08', 10000, 2, 60000).slice(0, 6), '2026-09-08', '2026-09-14'), basis(20000), '2026-09-30').status, 'unknown');
  assert.equal(CH.compare(c, full, Object.assign(basis(20000), { currency: 'USD' }), '2026-09-30').status, 'unknown');
  const tiny = makeChange(week('2026-09-01', 10000, 0, 0));
  const t = CH.compare(tiny, CH.aggregate(week('2026-09-08', 10000, 0, 0).map((d, i) => i === 0 ? day(d.date, 10000, 1, 30000) : d), '2026-09-08', '2026-09-14'), basis(20000), '2026-09-30');
  assert.equal(t.status, 'improved');
  assert.ok(t.warnings.some((x) => x.includes('합쳐 1건') && x.includes('참고 기준')));
  const unobserved = CH.aggregate(week('2026-09-08', 10000, 2, 60000).map((d) => ({ date: d.date, metrics: { ...d.metrics, purchase: { value: 0, observed: false } } })), '2026-09-08', '2026-09-14');
  const u = CH.compare(c, unobserved, basis(20000), '2026-09-30');
  assert.equal(u.status, 'unknown'); assert.equal(u.spend.diff, 0, '이익 · 판정이 없어도 지출 변화는 보인다');
  assert.equal(CH.compare(c, full, basis(20000), '2026-09-16').provisional, true);
});

test('성과 집계: 참고 계산 · 계산 보류는 검증된 이익에서 빼고, 지출 변화만 실제 값으로 더한다', () => {
  const c = makeChange(week('2026-09-01', 10000, 1, 30000));
  const after = CH.aggregate(week('2026-09-08', 8000, 2, 60000), '2026-09-08', '2026-09-14');
  const rr = CH.buildResultRecord(c, after, CH.compare(c, after, basis(20000), '2026-09-30'), Date.now(), '');
  const sum = CH.outcomeSummary([rr, { result: { status: 'unknown', spend: null, profit: { kind: 'withheld' } } }]);
  assert.equal(sum.verified_profit_change, 0); assert.equal(sum.verified_profit_count, 0);
  assert.equal(sum.reference_excluded, 1); assert.equal(sum.withheld, 1);
  assert.equal(sum.spend_change_krw, -14000); assert.equal(sum.spend_change_missing, 1);
});

test('결과 기록은 action_id로 변경 기록을 가리키고 금액 칸이 없다', () => {
  const c = makeChange(week('2026-09-01', 10000, 1, 30000));
  const after = CH.aggregate(week('2026-09-08', 10000, 2, 60000), '2026-09-08', '2026-09-14');
  const rr = CH.buildResultRecord(c, after, CH.compare(c, after, basis(20000), '2026-09-30'), Date.parse('2026-09-30T00:00:00Z'), '메모');
  assert.equal(rr.action_id, c.action_id);
  assert.equal(rr.spend, undefined);
  assert.equal(AC.linkChanges([c, rr]).changes[c.action_id].latest.id, rr.id);
});

test('운영과 같은 기록 세트(tests/open-beta 운영 메인 ₩46,010): 미리보기는 확정 중복 · 선택 제외 · 환율 없는 외화 · 변경 기록을 빼 ₩24,000', () => {
  const rows = [
    { id: 31, store_id: '1', date: '2026-09-20', name: 'A 직접', spend: 10000, revenue: 30000, channel: '메타' },
    { id: 32, store_id: '1', source: 'meta_auto', meta_auto_key: '1|act_1|2026-09-20', date: '2026-09-20', spend: 12000, revenue: 36000, channel: '메타', currency: 'KRW' },
    { id: 33, store_id: '1', date: '2026-09-21', spend: 12000, revenue: 30000, channel: '메타', meta_account_id: 'act_1', scope: 'account_total', currency: 'KRW' },
    { id: 34, store_id: '1', source: 'meta_auto', meta_auto_key: '1|act_1|2026-09-21', date: '2026-09-21', spend: 12000, revenue: 30000, channel: '메타', currency: 'KRW' },
    { id: 35, store_id: '1', date: '2026-09-22', spend: 10, revenue: 30, channel: '인스타', currency: 'USD' },
    { id: 36, store_id: '1', source: 'change', action_id: 'a1', date: '2026-09-22', channel: '메타' },
  ];
  const s = AC.summarize(rows, [{ record_id: 31, include: false, decided_at: '2026-10-06T00:00:00Z' }]);
  assert.equal(s.totalSpend, 24000);
  assert.deepEqual({ ...s.excluded }, { duplicate: 1, chosen: 1, currency: 1, nonAmount: 1 });
  assert.equal(AC.summarize(rows).totalSpend, 34000, '선택 전에는 A(중복 가능)를 포함');
});
