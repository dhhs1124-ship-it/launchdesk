/* 광고 세트 손익분기 기준 연결 — 순수 함수 검증 (meta-margin-core.js)
   실행: node --test tests/meta-margin-core.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../meta-margin-core.js');

// ============================================================ 손익분기 계산
test('유효: total_income>0 && pre_ad>0 → ratio와 소수 1자리 %', () => {
  const r = Core.computeBreakeven(25000, 10000);
  assert.equal(r.ok, true);
  assert.equal(r.ratio, 2.5);
  assert.equal(r.pctLabel, '250.0%');
  assert.equal(r.reason, null);
  assert.equal(r.preAdAmount, 10000);
});

test('pre_ad === 0 → 전용 사유, ratio/pctLabel 없음', () => {
  const r = Core.computeBreakeven(25000, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, '광고비 전 남는 금액이 0원이라 손익분기 ROAS가 없어요.');
  assert.equal(r.ratio, null);
  assert.equal(r.pctLabel, null);
  assert.equal(r.preAdAmount, 0);
});

test('pre_ad < 0 → 적자 사유, 음수 금액은 그대로 preAdAmount에 남는다', () => {
  const r = Core.computeBreakeven(25000, -3000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, '광고비 전부터 주문당 적자라 손익분기 ROAS가 없어요.');
  assert.equal(r.preAdAmount, -3000);
  assert.equal(Core.fmtWon(r.preAdAmount), '-3,000원');
});

test('total_income <= 0 → 전용 사유(pre_ad는 양수여도)', () => {
  const zero = Core.computeBreakeven(0, 10000);
  assert.equal(zero.ok, false);
  assert.equal(zero.reason, '총 수입이 0원 이하라 손익분기 ROAS를 계산할 수 없어요.');
  const neg = Core.computeBreakeven(-5000, 10000);
  assert.equal(neg.ok, false);
  assert.equal(neg.reason, '총 수입이 0원 이하라 손익분기 ROAS를 계산할 수 없어요.');
});

test('우선순위: pre_ad===0/음수가 total_income<=0보다 먼저 판정된다', () => {
  const bothZero = Core.computeBreakeven(0, 0);
  assert.equal(bothZero.reason, '광고비 전 남는 금액이 0원이라 손익분기 ROAS가 없어요.');
  const negPreAdZeroIncome = Core.computeBreakeven(0, -1000);
  assert.equal(negPreAdZeroIncome.reason, '광고비 전부터 주문당 적자라 손익분기 ROAS가 없어요.');
});

test('NaN/Infinity 입력 → 유효 취급하지 않고, 결과 문자열에 NaN·Infinity가 없다', () => {
  const cases = [
    Core.computeBreakeven(NaN, 10000),
    Core.computeBreakeven(25000, NaN),
    Core.computeBreakeven(Infinity, 10000),
    Core.computeBreakeven(25000, Infinity),
    Core.computeBreakeven(null, undefined),
    Core.computeBreakeven('', '')
  ];
  for (const r of cases) {
    assert.equal(r.ok, false);
    assert.doesNotMatch(JSON.stringify(r), /NaN|Infinity/);
  }
});

test('ratio 2.5는 표시 250.0%와 정확히 단위가 일치한다(×100, 소수 1자리)', () => {
  assert.equal(Core.computeBreakeven(12345, 4938).ratio.toFixed(10), (12345 / 4938).toFixed(10));
  assert.equal(Core.computeBreakeven(50000, 20000).pctLabel, '250.0%');
  assert.equal(Core.computeBreakeven(33333, 10000).pctLabel, '333.3%');
});

// =================================================================== 비교
test('compareRoas: 반올림 전 ratio로 방향을 정하고 표시 %p만 반올림', () => {
  const below = Core.compareRoas(2.44, 2.5);
  assert.equal(below.direction, 'below');
  assert.equal(below.text, '연결한 기준보다 6.0%p 낮아요.');

  const above = Core.compareRoas(2.62, 2.5);
  assert.equal(above.direction, 'above');
  assert.equal(above.text, '연결한 기준보다 12.0%p 높아요.');
});

test('compareRoas: 두 ratio가 정확히 같으면 null(차이 없음)', () => {
  assert.equal(Core.compareRoas(2.5, 2.5), null);
});

test('compareRoas: 반올림 경계 — 반올림 후 같은 값이 나와도 원본이 다르면 여전히 방향이 있다', () => {
  // 2.5005 vs 2.5 → 차이 0.0005 * 100 = 0.05%p → 반올림하면 0.1%p (반내림 아님)로 표시되지만
  // 방향(above)은 반올림 전 값으로 정확히 정해진다.
  const r = Core.compareRoas(2.5005, 2.5);
  assert.equal(r.direction, 'above');
  assert.match(r.text, /높아요\.$/);
});

test('compareRoas: 둘 중 하나라도 유한수가 아니면 null', () => {
  assert.equal(Core.compareRoas(null, 2.5), null);
  assert.equal(Core.compareRoas(2.5, null), null);
  assert.equal(Core.compareRoas(NaN, 2.5), null);
  assert.equal(Core.compareRoas(2.5, Infinity), null);
  assert.equal(Core.compareRoas(undefined, undefined), null);
});

test('compareRoas 텍스트에 좋음/나쁨/성공/위험/중단 등 확정 표현이 없다', () => {
  for (const r of [Core.compareRoas(2.44, 2.5), Core.compareRoas(2.62, 2.5)]) {
    assert.doesNotMatch(r.text, /좋|나쁨|성공|위험|중단|양호|주의|경고/);
  }
});

// =================================================================== 통화
test('isAmountComparable: KRW만 금액 비교 가능, 그 외는 불가', () => {
  assert.equal(Core.isAmountComparable('KRW'), true);
  assert.equal(Core.isAmountComparable('USD'), false);
  assert.equal(Core.isAmountComparable('JPY'), false);
  assert.equal(Core.isAmountComparable(null), false);
  assert.equal(Core.isAmountComparable(undefined), false);
});

// ========================================================== product_label
test('validateProductLabel: 필수 · trim · 1~40자', () => {
  assert.equal(Core.validateProductLabel('  ').ok, false);
  assert.equal(Core.validateProductLabel('').ok, false);
  assert.equal(Core.validateProductLabel(null).ok, false);
  assert.equal(Core.validateProductLabel(undefined).ok, false);
  const trimmed = Core.validateProductLabel('  여름 원피스  ');
  assert.equal(trimmed.ok, true);
  assert.equal(trimmed.value, '여름 원피스');
  assert.equal(Core.validateProductLabel('가'.repeat(40)).ok, true);
  assert.equal(Core.validateProductLabel('가'.repeat(41)).ok, false);
  assert.match(Core.validateProductLabel('가'.repeat(41)).error, /40자/);
});

// ===================================================== 후보 정규화(모달용)
const v2Record = (over) => Object.assign({
  calc_version: 2,
  date: '9.22. 14:30',
  saved_at: '2026-09-22T05:30:00.000Z',
  platform: 'cafe24',
  input: { price: 32000, qty: 2 },
  result: { totalIncome: 64000, preAd: 25600, postAd: 20600, ratio: 32.19, adMode: 'none', adCost: 0 }
}, over || {});

test('normalizeCandidate: v2 레코드만 후보가 되고, v1/필드 누락은 거부(null)', () => {
  const ok = Core.normalizeCandidate(v2Record(), 'saved', 0);
  assert.ok(ok);
  assert.equal(ok.source, 'saved');
  assert.equal(ok.dateLabel, '9.22. 14:30');
  assert.equal(ok.qty, 2);
  assert.equal(ok.priceLabel, '32,000원');
  assert.equal(ok.preAdLabel, '25,600원');
  assert.equal(ok.breakeven.ok, true);
  assert.equal(ok.breakeven.pctLabel, '250.0%');

  assert.equal(Core.normalizeCandidate({ cost: 1, price: 2 }, 'saved', 0), null); // v1(옛 사이드바) 기록
  assert.equal(Core.normalizeCandidate(v2Record({ calc_version: undefined }), 'saved', 0), null);
  assert.equal(Core.normalizeCandidate(v2Record({ input: null }), 'saved', 0), null);
  assert.equal(Core.normalizeCandidate(v2Record({ result: null }), 'saved', 0), null);
  assert.equal(Core.normalizeCandidate(null, 'saved', 0), null);
  assert.equal(Core.normalizeCandidate(undefined, 'current', -1), null);
});

test('normalizeCandidate: 계산 불가 사유가 있는 기록도 후보에는 들어가되 breakeven.ok=false', () => {
  const c = Core.normalizeCandidate(v2Record({ result: { totalIncome: 10000, preAd: 0 } }), 'saved', 1);
  assert.ok(c);
  assert.equal(c.breakeven.ok, false);
  assert.equal(c.breakeven.reason, '광고비 전 남는 금액이 0원이라 손익분기 ROAS가 없어요.');
});

test('buildCandidateList: "지금 계산기 값"이 있으면 맨 앞, 없으면 저장 기록만', () => {
  const saved = [v2Record({ date: '저장1' }), v2Record({ date: '저장2' })];
  const withCurrent = Core.buildCandidateList(saved, v2Record({ date: '현재입력' }));
  assert.equal(withCurrent.length, 3);
  assert.equal(withCurrent[0].source, 'current');
  assert.equal(withCurrent[0].dateLabel, '현재입력');
  assert.deepEqual(withCurrent.slice(1).map((c) => c.dateLabel), ['저장1', '저장2']);

  const withoutCurrent = Core.buildCandidateList(saved, null);
  assert.equal(withoutCurrent.length, 2);
  assert.ok(withoutCurrent.every((c) => c.source === 'saved'));

  // 예시 모드 등으로 buildCurrentRecord()가 null을 돌려주면(공개 API 계약)
  // "지금 입력한 값" 후보 자체가 생기지 않는다 — 선택 불가를 목록에서
  // 원천적으로 보장한다.
  assert.equal(Core.buildCandidateList([], undefined).length, 0);
  // v1 기록이 섞여 있어도 조용히 걸러진다.
  assert.equal(Core.buildCandidateList([{ price: 1 }, v2Record()], null).length, 1);
});

// ========================================================= 저장 스냅샷
test('buildSnapshotForSave: 정상 저장 값(schema allowlist만, KRW 고정, store_id/meta_adset_id 없음)', () => {
  const r = Core.buildSnapshotForSave(v2Record(), '여름 원피스');
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['calc_version', 'currency', 'pre_ad', 'product_label', 'source_saved_at', 'total_income'].sort());
  assert.equal(r.value.product_label, '여름 원피스');
  assert.equal(r.value.calc_version, 2);
  assert.equal(r.value.currency, 'KRW');
  assert.equal(r.value.total_income, 64000);
  assert.equal(r.value.pre_ad, 25600);
  assert.equal(r.value.source_saved_at, '2026-09-22T05:30:00.000Z');
  assert.doesNotMatch(JSON.stringify(r.value), /store_id|meta_adset_id|adset/i);
});

test('buildSnapshotForSave: product_label이 비었거나 40자를 넘으면 거부하고 쓰지 않는다', () => {
  const empty = Core.buildSnapshotForSave(v2Record(), '   ');
  assert.equal(empty.ok, false);
  assert.equal(empty.value, null);
  const tooLong = Core.buildSnapshotForSave(v2Record(), '가'.repeat(41));
  assert.equal(tooLong.ok, false);
});

test('buildSnapshotForSave: v1/누락 레코드는 거부', () => {
  assert.equal(Core.buildSnapshotForSave({ price: 1 }, '이름').ok, false);
  assert.equal(Core.buildSnapshotForSave(null, '이름').ok, false);
  assert.equal(Core.buildSnapshotForSave(v2Record({ result: { totalIncome: null, preAd: 1000 } }), '이름').ok, false);
});

test('source_saved_at이 없거나 형식이 이상하면 현재 시각으로 안전하게 대체된다', () => {
  const r = Core.buildSnapshotForSave(v2Record({ saved_at: undefined }), '이름');
  assert.equal(r.ok, true);
  assert.match(r.value.source_saved_at, /^\d{4}-\d{2}-\d{2}T/);
});

// =============================================================== 순수성
test('DOM · 네트워크 · 브라우저 저장소를 전혀 쓰지 않는다(코드 자체 — 설명 주석은 제외)', () => {
  const fs = require('node:fs');
  const raw = fs.readFileSync(require('node:path').join(__dirname, '..', 'meta-margin-core.js'), 'utf8');
  // 이 파일 자신의 설명 주석에 "localStorage/sessionStorage를 쓰지 않는다"는
  // 문구가 있어 그대로 매칭하면 오탐한다 — 블록/줄 주석을 걷어낸 코드만 본다.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|document\.cookie|document\.|window\.fetch|XMLHttpRequest/);
  assert.doesNotMatch(code, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.from\(|\.rpc\(/);
});
