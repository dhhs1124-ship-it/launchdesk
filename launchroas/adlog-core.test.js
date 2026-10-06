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

// 기간 합계 광고비 · 구매(첫날에 몰아 둠 — 합계만 비교에 쓰인다)
const span = (start, spendTotal, buys) => Array.from({ length: 7 }, (_, i) => day(CH.addDays(start, i), spendTotal / 7, i === 0 ? buys : 0, i === 0 ? buys * 30000 : 0));
const caseOf = (bs, bb, as, ab, opts = {}) => {
  const c = makeChange(span('2026-09-01', bs, bb), opts);
  return { c, after: CH.aggregate(span('2026-09-08', as, ab), '2026-09-08', '2026-09-14') };
};

test('재현 1: 구매 1→2건 · 광고비 같음 — 증가는 관찰로 보여 주되 개선으로 확정 · 집계하지 않는다', () => {
  const { c, after } = caseOf(70000, 1, 70000, 2);
  const r = CH.compare(c, after, basis(20000), '2026-09-30');
  assert.equal(r.status, 'inconclusive');
  assert.deepEqual([...r.observations], ['구매 증가 관찰', '구매당 광고비 -50% (효율 개선 관찰)', '광고비 변화 없음']);
  assert.match(r.reasons[0], /우연한 변동 범위 안/);
  assert.ok(r.blockers.includes('sample_uncertain'));
  const rr = CH.buildResultRecord(c, after, r, Date.parse('2026-09-30T00:00:00Z'), '');
  const sum = CH.outcomeSummary([c, rr]);
  assert.equal(sum.signals.cpa_better, 0); assert.equal(sum.inconclusive, 1); assert.equal(sum.hold_reasons.sample_uncertain, 1);
});

test('재현 2: 구매 10→20건 · 광고비 100,000→250,000 — 구매 증가와 구매당 광고비 +25%를 각각 표시하고 실제 계산과 다른 설명을 내지 않는다', () => {
  const { c, after } = caseOf(100000, 10, 250000, 20);
  const r = CH.compare(c, after, basis(20000), '2026-09-30');
  assert.equal(Math.round(r.cpa.before), 10000); assert.equal(Math.round(r.cpa.after), 12500); assert.equal(r.cpa.pct, 25);
  assert.deepEqual([...r.observations], ['구매 증가 관찰', '구매당 광고비 +25% (효율 저하 관찰)', '광고비 +150%']);
  assert.ok(!r.reasons.join(' ').includes('10% 미만'));
  assert.equal(r.status, 'inconclusive');
});

test('개선 · 악화 확인은 같은 광고비당 구매 차이가 우연 범위를 벗어날 때만(정확 이항검정 · 단측 0.05)', () => {
  let x = caseOf(100000, 10, 100000, 30);
  const imp = CH.compare(x.c, x.after, basis(20000), '2026-09-30');
  assert.equal(imp.status, 'improved');
  assert.equal(CH.STATUS_TEXT.improved, '구매당 광고비 개선 신호'); assert.equal(CH.STATUS_TEXT.worse, '구매당 광고비 악화 신호');
  assert.match(imp.reasons[0], /^구매당 광고비 개선 신호 — .*매출 · 이익 · 제안의 인과 효과는 확인하지 않음/);
  assert.doesNotMatch(Object.values(CH.STATUS_TEXT).join(' '), /개선 확인|악화 확인/);
  x = caseOf(100000, 30, 100000, 10); assert.equal(CH.compare(x.c, x.after, basis(20000), '2026-09-30').status, 'worse');
  x = caseOf(100000, 20, 20000, 15);
  const r = CH.compare(x.c, x.after, basis(20000), '2026-09-30');
  assert.equal(r.status, 'inconclusive'); assert.match(r.reasons[0], /구매가 줄어 개선으로 확인하지 않아요/);
  assert.ok(r.warnings.some((w) => w.includes('개선 성공이 아니에요')));
});

test('잠정 · 함께 바뀐 조건이 있으면 차이가 커도 확정하지 않고 보류 이유를 남긴다', () => {
  let x = caseOf(100000, 10, 100000, 30, { concurrent: ['할인'] });
  let r = CH.compare(x.c, x.after, basis(20000), '2026-09-30');
  assert.equal(r.status, 'inconclusive'); assert.ok(r.blockers.includes('not_separable'));
  x = caseOf(100000, 10, 100000, 30);
  r = CH.compare(x.c, x.after, basis(20000), '2026-09-16');
  assert.equal(r.status, 'inconclusive'); assert.ok(r.blockers.includes('provisional'));
});

test('비교 불가(기간 미종료 · 조회 실패 · 통화 변경 · 구매 미측정)는 판단 불가 · 관찰 가능한 지출 변화는 보인다', () => {
  const { c, after } = caseOf(70000, 1, 70000, 2);
  assert.equal(CH.compare(c, after, basis(20000), '2026-09-14').status, 'unknown');
  assert.equal(CH.compare(c, CH.aggregate(span('2026-09-08', 70000, 2).slice(0, 6), '2026-09-08', '2026-09-14'), basis(20000), '2026-09-30').status, 'unknown');
  assert.equal(CH.compare(c, after, Object.assign(basis(20000), { currency: 'USD' }), '2026-09-30').blockers[0], 'condition_mismatch');
  const unobs = CH.aggregate(span('2026-09-08', 70000, 2).map((d) => ({ date: d.date, metrics: { ...d.metrics, purchase: { value: 0, observed: false } } })), '2026-09-08', '2026-09-14');
  const u = CH.compare(c, unobs, basis(20000), '2026-09-30');
  assert.equal(u.status, 'unknown'); assert.equal(u.spend.diff, 0);
});

test('이익은 참고 계산 / 계산 보류로만 — 판정에 쓰지 않는다', () => {
  const { c, after } = caseOf(100000, 10, 100000, 30);
  const r = CH.compare(c, after, basis(20000), '2026-09-30');
  assert.equal(r.profit.kind, 'reference'); assert.match(r.profit.basis, /검증된 이익이 아님/);
  const n = caseOf(100000, 10, 100000, 30, { basis: { currency: 'KRW', attribution: 'API 기본(클릭 후 7일 · 조회 후 1일)', margin: null } });
  const r2 = CH.compare(n.c, n.after, null, '2026-09-30');
  assert.equal(r2.status, 'improved'); assert.equal(r2.profit.kind, 'withheld');
});

test('마진이 낮아져도 기본은 상품 마진 변경 — 누락 비용은 사용자 확인 또는 비용 항목 비교로 입증될 때만', () => {
  const { c, after } = caseOf(70000, 1, 70000, 2);
  const lower = Object.assign(basis(15000), { margin: { pre_ad: 15000, source_saved_at: 's2' } });
  let r = CH.compare(c, after, lower, '2026-09-30');
  assert.equal(r.missingCost, null);
  assert.equal(r.marginChange.diff_per_order, -5000); assert.match(r.marginChange.note, /이유 미확인/);
  r = CH.compare(c, after, lower, '2026-09-30', { confirmedMissingCost: { item: '포장비', per_order: 500 } });
  assert.equal(r.missingCost.source, 'user_confirmed'); assert.equal(r.missingCost.per_order, 500);
  assert.equal(CH.compare(c, after, lower, '2026-09-30', { confirmedMissingCost: { item: '', per_order: 500 } }).missingCost, null, '항목 없으면 기록 안 함');
  const ci = makeChange(span('2026-09-01', 70000, 1), { basis: Object.assign(basis(20000), { margin: { pre_ad: 20000, source_saved_at: 's1', cost_items: { 원가: 9000, 포장비: 0 } } }) });
  r = CH.compare(ci, after, Object.assign(basis(19500), { margin: { pre_ad: 19500, source_saved_at: 's2', cost_items: { 원가: 9000, 포장비: 500 } } }), '2026-09-30');
  assert.equal(r.missingCost.source, 'cost_items'); assert.deepEqual(r.missingCost.items.map((x) => x.item), ['포장비']);
});

const at = (iso) => Date.parse(iso + 'T00:00:00Z');
const unknownWith = (blockers) => ({ status: 'unknown', reasons: [], warnings: [], blockers });

test('성과 집계: 최신 결과가 비교 조건 불일치(판단 불가)면 이전 개선 신호는 이력으로만 · 현재 신호에서 제외 · 최신 보류 이유를 센다', () => {
  const x = caseOf(100000, 10, 100000, 30);
  const r1 = CH.buildResultRecord(x.c, x.after, CH.compare(x.c, x.after, basis(20000), '2026-09-30'), at('2026-09-30'), '');
  assert.equal(r1.result.status, 'improved');
  const r2 = CH.buildResultRecord(x.c, x.after, unknownWith(['condition_mismatch']), at('2026-10-02'), '');
  const s = CH.outcomeSummary([x.c, r1, r2]);
  assert.equal(s.signals.cpa_better, 0); assert.equal(s.unknown, 1); assert.equal(s.history_results, 1);
  assert.equal(s.hold_reasons.condition_mismatch, 1);
  assert.equal(s.actions_detail[0].state, 'unknown');
  assert.equal(s.observed_spend_change_krw, 0); assert.equal(s.reference_excluded, 0, '판단 불가 실행은 이익 · 지출 집계에서도 뺀다');
  assert.equal(CH.currentOf([r1, r2]).state, 'unknown');
});

test('성과 집계: 최신 결과가 단순 조회 실패뿐이면 마지막 관찰값을 갱신 실패 · 이전 결과로 보여 주되 신호로 세지 않는다', () => {
  const x = caseOf(100000, 10, 100000, 30);
  const r1 = CH.buildResultRecord(x.c, x.after, CH.compare(x.c, x.after, basis(20000), '2026-09-30'), at('2026-09-30'), '');
  const failedDay = CH.aggregate(span('2026-09-08', 100000, 30).slice(0, 6), '2026-09-08', '2026-09-14');
  const cmp = CH.compare(x.c, failedDay, basis(20000), '2026-10-03');
  assert.deepEqual([...cmp.blockers], ['fetch_failed']);
  const r2 = CH.buildResultRecord(x.c, failedDay, cmp, at('2026-10-03'), '');
  const cur = CH.currentOf([r1, r2]);
  assert.equal(cur.state, 'stale'); assert.equal(cur.record.id, r1.id);
  const s = CH.outcomeSummary([x.c, r1, r2]);
  assert.equal(s.stale_previous, 1); assert.equal(s.signals.cpa_better, 0); assert.equal(s.hold_reasons.fetch_failed, 1);
  assert.equal(s.actions_detail[0].label, '갱신 실패 · 이전 결과');
});

test('성과 집계: 판정 버전이 없는 예전 improved 결과는 새 기준 신호로 세지 않는다(legacy) · 현재 버전 결과만 신호', () => {
  const x = caseOf(100000, 10, 100000, 30);
  const legacy = { id: 1, source: 'change_result', action_id: x.c.action_id, measured_at: '2026-09-20T00:00:00Z', result: { status: 'improved', reasons: ['예전 규칙'], warnings: [], spend: { krw_diff: 0 }, profit: { kind: 'reference', diff: 1 } } };
  let s = CH.outcomeSummary([x.c, legacy]);
  assert.equal(s.signals.cpa_better, 0); assert.equal(s.legacy_results, 1);
  assert.equal(s.actions_detail[0].label, '이전 판정 기준 결과 · 신호로 세지 않음');
  const now = CH.buildResultRecord(x.c, x.after, CH.compare(x.c, x.after, basis(20000), '2026-09-30'), at('2026-09-30'), '');
  assert.equal(now.result.judgement_version, CH.JUDGEMENT_VERSION);
  s = CH.outcomeSummary([x.c, legacy, now]);
  assert.equal(s.signals.cpa_better, 1); assert.equal(s.legacy_results, 0); assert.equal(s.history_results, 1);
  assert.match(s.signal_scope, /인과 효과는 확인하지 않음/);
});

test('성과 집계: 같은 실행의 결과가 여러 번이면 최신 1건 · 이전 결과는 이력 · 겹치는 기간의 같은 광고 지출은 한 번만 · 절감액이라고 하지 않는다', () => {
  const x = caseOf(100000, 10, 100000, 30);
  const r1 = CH.buildResultRecord(x.c, x.after, CH.compare(x.c, x.after, basis(20000), '2026-09-16'), at('2026-09-16'), '');
  const r2 = CH.buildResultRecord(x.c, x.after, CH.compare(x.c, x.after, basis(20000), '2026-09-30'), at('2026-09-30'), '');
  const y = caseOf(100000, 10, 80000, 10); y.c.action_id = 'act_other';
  const ry = CH.buildResultRecord(y.c, y.after, CH.compare(y.c, y.after, basis(20000), '2026-09-30'), at('2026-09-29'), '');
  const s = CH.outcomeSummary([x.c, r1, r2, y.c, ry]);
  assert.equal(s.actions, 2); assert.equal(s.results_total, 3); assert.equal(s.history_results, 1);
  assert.equal(s.signals.cpa_better, 1);
  assert.equal(s.observed_spend_change_krw, 0); assert.equal(s.spend_overlap_excluded, 1);
  assert.match(s.observed_spend_note, /절감액이 아님/);
  assert.equal(s.verified_profit_count, 0); assert.equal(s.reference_excluded, 2);
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
