/* 광고 기록 계산 규칙(adlog-core.js) — 메인 · 미리보기 공통. 실행: node --test tests/adlog-core.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AC = require('../adlog-core.js');

const manual = (o) => Object.assign({ id: 1, store_id: '4', date: '2026-10-01', name: '직접 입력', spend: 10000, revenue: 30000, channel: '메타' }, o);
const auto = (o) => Object.assign({ id: 2, source: 'meta_auto', meta_auto_key: '4|act|2026-10-01', store_id: '4', date: '2026-10-01', name: 'Meta 캠페인 전체 합계', spend: 12000, revenue: 36000, channel: '메타', currency: 'KRW' }, o);

test('미리보기와 메인이 같은 파일을 쓴다', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'adlog-core.js'));
  const b = fs.readFileSync(path.join(__dirname, '..', 'launchroas', 'adlog-core.js'));
  assert.ok(a.equals(b), 'launchroas/adlog-core.js를 루트 파일과 같게 복사하세요');
});

test('예전 기록만 있으면 합계 · 평균 ROAS는 기존 계산과 같다', () => {
  const s = AC.summarize([manual({ id: 1 }), manual({ id: 3, date: '2026-10-02', spend: 20000, revenue: 40000, channel: '네이버' })]);
  assert.equal(s.totalSpend, 30000);
  assert.equal(s.averageRoas, 70000 / 30000);
  assert.deepEqual(s.excluded, { duplicate: 0, currency: 0, nonAmount: 0 });
});

test('같은 쇼핑몰 · 날짜의 Meta 자동 기록과 채널 메타 직접 입력은 직접 입력을 합계에서 뺀다(목록에는 표시)', () => {
  const rows = [manual(), auto()];
  const s = AC.summarize(rows);
  assert.equal(s.totalSpend, 12000);
  assert.equal(s.excluded.duplicate, 1);
  assert.deepEqual(AC.rowLabel(rows[0], s.duplicates), ['같은 날 Meta 자동 기록과 중복 가능 · 합계 제외']);
  // 다른 날짜 · 다른 채널은 중복이 아니다
  assert.equal(AC.summarize([manual({ date: '2026-10-02' }), auto()]).totalSpend, 22000);
  assert.equal(AC.summarize([manual({ channel: '네이버' }), auto()]).totalSpend, 22000);
});

test('원화가 아닌 기록은 저장 환율이 있을 때만 원화로 합산하고, 없으면 0으로 넣지 않고 제외 개수를 센다', () => {
  const usdFx = manual({ id: 5, channel: '네이버', currency: 'USD', spend: 10, revenue: 30, fx_krw_per_unit: 1400 });
  const usdNoFx = manual({ id: 6, channel: '네이버', currency: 'USD', spend: 10, revenue: 30 });
  const s = AC.summarize([usdFx, usdNoFx]);
  assert.equal(s.totalSpend, 14000);
  assert.equal(s.averageRoas, 3);
  assert.equal(s.excluded.currency, 1);
  assert.equal(AC.moneyText(usdNoFx, usdNoFx.spend), '—');
  assert.equal(AC.moneyText(usdFx, usdFx.spend), '₩14,000');
});

test('변경 · 결과 기록은 금액 합계에서 빠지고, 금액 칸은 —로 표시한다(₩NaN 방지)', () => {
  const change = { id: 10, source: 'change', action_id: 'a1', store_id: '4', date: '2026-10-06', name: '본문 첫 줄 변경', channel: '메타' };
  const result = { id: 11, source: 'change_result', action_id: 'a1', store_id: '4', date: '2026-10-13', measured_at: '2026-10-13T00:00:00Z', name: '결과', channel: '메타' };
  const s = AC.summarize([manual(), change, result]);
  assert.equal(s.totalSpend, 10000);
  assert.equal(s.excluded.nonAmount, 2);
  assert.equal(AC.moneyText(change, change.spend), '—');
});

test('결과 기록은 action_id로 변경 기록에 묶이고, 변경 기록이 지워졌으면 고아 결과로 구분한다', () => {
  const change = { id: 10, source: 'change', action_id: 'a1' };
  const r2 = { id: 12, source: 'change_result', action_id: 'a1', measured_at: '2026-10-20' };
  const r1 = { id: 11, source: 'change_result', action_id: 'a1', measured_at: '2026-10-13' };
  const orphan = { id: 13, source: 'change_result', action_id: 'gone' };
  const L = AC.linkChanges([change, r2, r1, orphan]);
  assert.deepEqual(L.changes.a1.results.map((r) => r.id), [11, 12]);
  assert.equal(L.changes.a1.latest.id, 12);
  assert.deepEqual(L.orphans.map((r) => r.id), [13]);
  assert.deepEqual(AC.rowLabel(change, {}, L), ['변경 기록 · 결과 2건']);
  assert.deepEqual(AC.rowLabel(orphan, {}, L), ['결과 기록 · 연결된 변경 기록 없음']);
});
