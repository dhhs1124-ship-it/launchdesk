/* 마진 계산기 순수 계산 모듈 검증 — 실행: node --test tests/
   (Node 18+ 내장 test runner, 별도 패키지 없음) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../margin-calc.js');

// 요구사항 8의 기준 사례
const BASE = {
  price: 30000, qty: 1, sellerDiscount: 0,
  unitCost: 15000, customerShipping: 0,
  actualShipping: 3000, packaging: 1200,
  feeRate: 6, feeBase: 'after_discount', feeVat: 'included',
  shippingFeeMode: 'none', pgRate: 0, otherCost: 0,
  adMode: 'none'
};
function run(overrides){
  const r = calc.calculate(Object.assign({}, BASE, overrides || {}));
  assert.equal(r.ok, true, '유효성 오류: ' + JSON.stringify(r.errors));
  return r.result;
}

test('기준 사례: 수수료 1,800원 · 광고 전 잔액 9,000원', () => {
  const r = run();
  assert.equal(r.productAmount, 30000);
  assert.equal(r.totalIncome, 30000);
  assert.equal(r.productFee, 1800);
  assert.equal(r.shippingFee, 0);
  assert.equal(r.pgFee, 0);
  assert.equal(r.feeTotal, 1800);
  assert.equal(r.preAd, 9000);
  assert.equal(r.adCost, 0);
  assert.equal(r.postAd, 9000);
  assert.equal(Number(r.ratio.toFixed(1)), 30.0);
});

test('광고비 6% / 10% / 20% 배분액과 광고 후 잔액', () => {
  const cases = [[6, 1800, 7200], [10, 3000, 6000], [20, 6000, 3000]];
  for (const [rate, ad, post] of cases) {
    const r = run({ adMode: 'rate', adRate: rate });
    assert.equal(r.adCost, ad, `광고비 ${rate}%`);
    assert.equal(r.postAd, post, `광고 후 잔액 ${rate}%`);
    assert.equal(r.preAd, 9000);
  }
});

test('광고비 비율 기준은 배송비 제외 · 할인 후 상품 결제금액', () => {
  // 고객배송비 3,000 · 할인 2,000 → 비율 기준은 28,000이지 31,000이 아니다
  const r = run({ customerShipping: 3000, sellerDiscount: 2000, adMode: 'rate', adRate: 10 });
  assert.equal(r.productAmount, 28000);
  assert.equal(r.totalIncome, 31000);
  assert.equal(r.adCost, 2800);
});

test('직접 금액 모드는 비율을 무시하고 하나만 적용(중복 차감 없음)', () => {
  const r = run({ adMode: 'amount', adAmount: 2500, adRate: 20 });
  assert.equal(r.adCost, 2500);
  assert.equal(r.postAd, 6500);
  const none = run({ adMode: 'none', adRate: 20, adAmount: 9999 });
  assert.equal(none.adCost, 0);
});

test('배송비 수수료: 없음 / 상품과 동일 / 별도 요율', () => {
  const ship = { customerShipping: 3000, actualShipping: 3000 };
  const none = run(Object.assign({}, ship, { shippingFeeMode: 'none' }));
  assert.equal(none.shippingFee, 0);
  const same = run(Object.assign({}, ship, { shippingFeeMode: 'same' }));
  assert.equal(same.shippingFee, 180); // 3,000 × 6%
  const sep = run(Object.assign({}, ship, { shippingFeeMode: 'separate', shippingFeeRate: 3 }));
  assert.equal(sep.shippingFee, 90);   // 3,000 × 3%
  // 총 수입은 고객배송비를 포함, 실제 배송비는 비용
  assert.equal(none.totalIncome, 33000);
  assert.equal(none.preAd, 33000 - 15000 - 3000 - 1200 - 1800);
});

test('배송비 수수료 "별도"인데 요율이 비면 유효성 오류', () => {
  const r = calc.calculate(Object.assign({}, BASE, { customerShipping: 3000, shippingFeeMode: 'separate', shippingFeeRate: '' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.shippingFeeRate);
});

test('수수료 부가세 포함 / 별도(10% 추가 차감)', () => {
  const incl = run({ feeVat: 'included' });
  const excl = run({ feeVat: 'excluded' });
  assert.equal(incl.productFee, 1800);
  assert.equal(excl.productFee, 1980); // 1,800 × 1.1
  assert.equal(excl.preAd, 8820);
  // 배송비 수수료 · PG 수수료에도 같은 배수가 적용된다
  const exclShip = run({ feeVat: 'excluded', customerShipping: 3000, shippingFeeMode: 'same', pgRate: 2 });
  assert.equal(exclShip.shippingFee, 198);       // 3,000 × 6% × 1.1
  assert.equal(exclShip.pgFee, 726);             // 33,000 × 2% × 1.1
});

test('별도 PG 수수료는 결제 총액(상품 결제금액 + 고객배송비) 기준', () => {
  const r = run({ customerShipping: 3000, pgRate: 3.5 });
  assert.equal(r.pgFee, 1155); // 33,000 × 3.5%
  const zero = run({ pgRate: 0 });
  assert.equal(zero.pgFee, 0);
});

test('수량이 늘어도 주문당 배송비 · 포장비 · 기타 비용은 그대로', () => {
  const r = run({ qty: 3, otherCost: 500 });
  assert.equal(r.grossBeforeDiscount, 90000);
  assert.equal(r.productCostTotal, 45000);
  assert.equal(r.actualShipping, 3000);
  assert.equal(r.packaging, 1200);
  assert.equal(r.otherCost, 500);
  assert.equal(r.productFee, 5400);
  assert.equal(r.preAd, 90000 - 45000 - 3000 - 1200 - 5400 - 500);
});

test('수수료 기준: 할인 후(기본) / 할인 전', () => {
  const after = run({ sellerDiscount: 5000, feeBase: 'after_discount' });
  const before = run({ sellerDiscount: 5000, feeBase: 'before_discount' });
  assert.equal(after.productFee, 1500);  // 25,000 × 6%
  assert.equal(before.productFee, 1800); // 30,000 × 6%
  assert.equal(after.productAmount, 25000);
  assert.equal(before.productAmount, 25000);
});

test('손익 0원은 0원 · 0%로 표시', () => {
  // 30,000 − 15,000 − 3,000 − 1,200 − 1,800 = 9,000 → 기타 비용 9,000이면 0
  const r = run({ otherCost: 9000 });
  assert.equal(r.preAd, 0);
  assert.equal(r.postAd, 0);
  assert.equal(r.ratio, 0);
  assert.equal(r.isDeficit, false);
  assert.equal(calc.fmtWon(0), '0원');
  assert.equal(calc.fmtPct(0), '0.0%');
});

test('분모(총 수입) 0원이면 비율은 계산 불가(null)', () => {
  // 할인액 = 상품금액 → 결제금액 0, 고객배송비 0 → 총 수입 0
  const r = run({ sellerDiscount: 30000, customerShipping: 0 });
  assert.equal(r.totalIncome, 0);
  assert.equal(r.ratio, null);
  assert.equal(calc.fmtPct(r.ratio), '계산 불가');
});

test('음수 잔액은 그대로 표시되고 isDeficit=true', () => {
  const r = run({ unitCost: 26000, adMode: 'rate', adRate: 10 });
  assert.equal(r.preAd, -2000);
  assert.equal(r.postAd, -5000);
  assert.equal(r.isDeficit, true);
  assert.equal(calc.fmtWon(r.postAd), '-5,000원');
  assert.ok(r.ratio < 0);
});

test('빈 필수 입력과 실제 0원을 구분', () => {
  const empty = calc.calculate(Object.assign({}, BASE, { unitCost: '' }));
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.unitCost);
  const zero = calc.calculate(Object.assign({}, BASE, { unitCost: 0 }));
  assert.equal(zero.ok, true);
  assert.equal(zero.result.productCostTotal, 0);
  const feeEmpty = calc.calculate(Object.assign({}, BASE, { feeRate: '' }));
  assert.equal(feeEmpty.ok, false);
  const feeZero = calc.calculate(Object.assign({}, BASE, { feeRate: 0 }));
  assert.equal(feeZero.ok, true);
  assert.equal(feeZero.result.productFee, 0);
  // 선택 항목은 빈 값 → 0
  const optEmpty = calc.calculate(Object.assign({}, BASE, { packaging: '', actualShipping: '' }));
  assert.equal(optEmpty.ok, true);
  assert.equal(optEmpty.result.packaging, 0);
});

test('할인액 초과 · 잘못된 수량 · 잘못된 요율 유효성 검사', () => {
  assert.ok(calc.calculate(Object.assign({}, BASE, { sellerDiscount: 30001 })).errors.sellerDiscount);
  assert.ok(calc.calculate(Object.assign({}, BASE, { qty: 0 })).errors.qty);
  assert.ok(calc.calculate(Object.assign({}, BASE, { qty: 1.5 })).errors.qty);
  assert.ok(calc.calculate(Object.assign({}, BASE, { qty: '' })).errors.qty);
  assert.ok(calc.calculate(Object.assign({}, BASE, { feeRate: 101 })).errors.feeRate);
  assert.ok(calc.calculate(Object.assign({}, BASE, { feeRate: -1 })).errors.feeRate);
  assert.ok(calc.calculate(Object.assign({}, BASE, { price: 0 })).errors.price);
  assert.ok(calc.calculate(Object.assign({}, BASE, { price: -100 })).errors.price);
  assert.ok(calc.calculate(Object.assign({}, BASE, { packaging: -1 })).errors.packaging);
  assert.ok(calc.calculate(Object.assign({}, BASE, { adMode: 'rate', adRate: '' })).errors.adRate);
  assert.ok(calc.calculate(Object.assign({}, BASE, { adMode: 'amount', adAmount: '' })).errors.adAmount);
  // 광고비 비율은 20%가 상한이 아니다
  assert.equal(calc.calculate(Object.assign({}, BASE, { adMode: 'rate', adRate: 35 })).ok, true);
});

test('주문당 남기고 싶은 금액 → 광고비 여유', () => {
  const ok = run({ targetProfit: 5000 });
  assert.equal(ok.adRoom, 4000);
  const short = run({ targetProfit: 12000 });
  assert.equal(short.adRoom, -3000);
  const unset = run({ targetProfit: '' });
  assert.equal(unset.adRoom, null);
});

test('반올림: 줄 단위 원 반올림 후 합산 — 줄의 합이 총액과 일치', () => {
  // 3.5% × 59,000 = 2,065 (정수). 4.35% × 12,345 = 537.0075 → 537
  const r = run({ price: 12345, feeRate: 4.35, customerShipping: 2500, shippingFeeMode: 'same', pgRate: 1.23 });
  assert.equal(r.productFee, Math.round(12345 * 0.0435));
  assert.equal(r.shippingFee, Math.round(2500 * 0.0435));
  assert.equal(r.pgFee, Math.round(14845 * 0.0123));
  assert.equal(r.feeTotal, r.productFee + r.shippingFee + r.pgFee);
  assert.equal(r.preAd, r.totalIncome - r.productCostTotal - r.actualShipping - r.packaging - r.feeTotal - r.otherCost);
  assert.equal(Number.isInteger(r.preAd), true);
});

test('예시 3개는 모두 유효하고 세트 예시는 세트 원가 × 세트 수만 곱한다', () => {
  for (const ex of calc.EXAMPLES) {
    const r = calc.calculate(ex.input);
    assert.equal(r.ok, true, ex.title + ': ' + JSON.stringify(r.errors));
  }
  const bundle = calc.EXAMPLES.find(e => e.key === 'bundle');
  const r = calc.calculate(bundle.input).result;
  assert.equal(r.productCostTotal, 21000 * 2); // 낱개 3개를 다시 곱하지 않음
  assert.equal(r.productFee, Math.round(90000 * 0.06 * 1.1));
});

test('플랫폼 안내에는 확인되지 않은 요율 · 확인일이 들어있지 않다', () => {
  for (const key of Object.keys(calc.PLATFORM_GUIDE)) {
    const g = calc.PLATFORM_GUIDE[key];
    if (g.rates !== null) assert.ok(g.verifiedAt, key + ': 요율이 있으면 확인일도 있어야 한다');
    if (g.verifiedAt === null) assert.equal(g.rates, null, key + ': 확인일 없이 요율을 적지 않는다');
  }
  assert.notDeepEqual(calc.PLATFORM_GUIDE.cafe24.composition, calc.PLATFORM_GUIDE.smartstore.composition);
});

test('저장 레코드 버전 상수', () => {
  assert.equal(calc.CALC_VERSION, 2);
});
