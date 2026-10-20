/* 첫단추 마진 계산기 검증 — 실행: node --test chutdanchu-margin/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MC = require('./margin-calc.js');
const C = require('./chutdanchu-core.js');

const BASE = { price: '30000', unitCost: '15000', discountRate: '', feeRate: '6', packaging: '1200', shipping: '3000', adCost: '' };
const run = (o) => C.calculate(Object.assign({}, BASE, o));

test('margin-calc.js는 LaunchROAS 운영 계산 모듈과 내용이 같다(별도 복사본)', () => {
  const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(norm(path.join(__dirname, 'margin-calc.js')), norm(path.join(__dirname, '..', 'launchroas', 'margin-calc.js')));
});

test('기존 계산기 기준 사례와 같은 결과: 남는 금액 9,000원 · 30.0%', () => {
  const r = run();
  const old = MC.calculate({ price: 30000, qty: 1, unitCost: 15000, sellerDiscount: 0, feeRate: 6, feeBase: 'after_discount', feeVat: 'included',
    customerShipping: 0, actualShipping: 3000, packaging: 1200, shippingFeeMode: 'none', pgRate: 0, otherCost: 0, adMode: 'none' }).result;
  assert.equal(r.after.profit, 9000);
  assert.equal(r.after.profit, old.postAd);
  assert.equal(r.after.ratio, old.ratio);
  assert.equal(r.after.fee, 1800);
});

test('할인율 = 기존 계산기의 판매자 부담 할인액, 수수료는 할인 후 금액 기준', () => {
  const r = run({ discountRate: '10', adCost: '2000' });
  const old = MC.calculate({ price: 30000, qty: 1, unitCost: 15000, sellerDiscount: 3000, feeRate: 6, actualShipping: 3000, packaging: 1200,
    adMode: 'amount', adAmount: 2000 }).result;
  assert.equal(r.discount, 3000);
  assert.equal(r.after.sale, 27000);
  assert.equal(r.after.fee, 1620);
  assert.equal(r.after.profit, old.postAd);
  assert.equal(r.after.profit, 27000 - 15000 - 1620 - 1200 - 3000 - 2000);
  assert.equal(r.after.ratio, old.ratio);
  // 할인 전 비교는 같은 조건에서 할인만 0
  assert.equal(r.before.sale, 30000);
  assert.equal(r.before.profit, 30000 - 15000 - 1800 - 1200 - 3000 - 2000);
});

test('배송비: 고객 배송비를 뺀 순부담액을 넣으면 기존 계산기(고객 3,000 받고 3,300 지출)와 남는 금액이 같다', () => {
  const r = run({ shipping: '300' });
  const old = MC.calculate({ price: 30000, qty: 1, unitCost: 15000, feeRate: 6, customerShipping: 3000, actualShipping: 3300, packaging: 1200, shippingFeeMode: 'none' }).result;
  assert.equal(r.after.profit, old.postAd);
  // 마진율 분모는 다르다: 첫단추 = 할인 후 판매금액, 기존 = 판매금액 + 고객 배송비
  assert.equal(r.after.ratio, r.after.profit / 30000 * 100);
  assert.equal(old.ratio, old.postAd / 33000 * 100);
});

test('할인 없음: 전후 결과가 같다', () => {
  const r = run();
  assert.deepEqual(r.after, r.before);
});

test('광고비 빈칸 = 0원, 광고비만큼 남는 금액이 준다', () => {
  assert.equal(run().after.ad, 0);
  assert.equal(run({ adCost: '0' }).after.profit, 9000);
  assert.equal(run({ adCost: '1,500' }).after.profit, 7500);
});

test('적자: 남는 금액 음수, isDeficit', () => {
  const r = run({ unitCost: '28000' });
  assert.equal(r.after.profit, -4000);
  assert.equal(r.after.isDeficit, true);
  assert.ok(r.after.ratio < 0);
});

test('판매금액 0: 할인 100% · 판매가 0원이면 마진율은 계산 불가(null)', () => {
  const full = run({ discountRate: '100' });
  assert.equal(full.ok, true);
  assert.equal(full.after.sale, 0);
  assert.equal(full.after.fee, 0);
  assert.equal(full.after.ratio, null);
  assert.equal(C.fmtPct(full.after.ratio), '계산 불가');
  assert.ok(Number.isFinite(full.before.ratio));
  const zero = run({ price: '0' });
  assert.equal(zero.ok, true);
  assert.equal(zero.after.ratio, null);
  assert.equal(zero.after.profit, -(15000 + 1200 + 3000));
});

test('빈칸 · 음수 · 잘못된 입력은 오류, 결과 없음', () => {
  assert.equal(run({ price: '' }).errors.price, '판매가를 입력해주세요');
  assert.ok(run({ unitCost: '' }).errors.unitCost);
  assert.ok(run({ shipping: '-1' }).errors.shipping);
  assert.ok(run({ price: '-100' }).errors.price);
  assert.ok(run({ feeRate: 'abc' }).errors.feeRate);
  assert.ok(run({ packaging: '1e' }).errors.packaging);
  assert.ok(run({ discountRate: '101' }).errors.discountRate);
  assert.ok(run({ feeRate: '150' }).errors.feeRate);
  const bad = run({ price: '' });
  assert.equal(bad.ok, false);
  assert.equal(bad.after, null);
});

test('선택 항목 빈칸은 0으로 계산(할인 · 수수료 · 포장 · 배송 · 광고)', () => {
  const r = C.calculate({ price: '10000', unitCost: '4000' });
  assert.equal(r.ok, true);
  assert.equal(r.after.profit, 6000);
  assert.equal(r.after.ratio, 60);
});

test('콘텐츠 예시(가정한 값): 할인 없음 9,000원 · 18%, 10% 할인 4,150원 · 약 9.22%', () => {
  const ex = Object.assign({}, C.EXAMPLE);
  const none = C.calculate(Object.assign({}, ex, { discountRate: '' }));
  assert.equal(none.after.sale, 50000);
  assert.equal(none.after.fee, 1500);
  assert.equal(none.after.profit, 9000);
  assert.equal(none.after.ratio.toFixed(2), '18.00');
  const disc = C.calculate(ex); // 예시 기본값 = 10% 할인
  assert.equal(disc.after.sale, 45000);
  assert.equal(disc.after.fee, 1350);
  assert.equal(disc.after.profit, 4150);
  assert.equal(disc.after.ratio.toFixed(2), '9.22');
  assert.deepEqual(disc.before, none.after);
});

test('배송비 차액(받은 배송비 > 실제 택배비)은 현재 한 칸 입력으로 반영할 수 없다', () => {
  // 고객 3,500원 받고 실제 3,000원 지출 → 판매자 순부담 -500원(500원 이득)
  const r = run({ shipping: '-500' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.shipping);
  // 0으로 넣으면 차액 500원이 빠진 값 — 기존 계산기(받은 3,500 · 실제 3,000)보다 500원 적게 나온다
  const old = MC.calculate({ price: 30000, qty: 1, unitCost: 15000, feeRate: 6, customerShipping: 3500, actualShipping: 3000, packaging: 1200, shippingFeeMode: 'none' }).result;
  assert.equal(run({ shipping: '0' }).after.profit + 500, old.postAd);
});

/* 유료배송 상세 입력 — LaunchROAS 계산기 '고객 배송비 + 배송비 수수료 상품과 동일'과 같은 결과 */
const ex = (o) => C.calculate(Object.assign({}, C.EXAMPLE, o));
const roas = (o) => MC.calculate(Object.assign({ price: 50000, qty: 1, unitCost: 30000, sellerDiscount: 0, feeRate: 3, feeBase: 'after_discount', feeVat: 'included',
  packaging: 500, shippingFeeMode: 'same', pgRate: 0, otherCost: 0, adMode: 'amount', adAmount: 6000 }, o)).result;

test('유료배송: 받은 배송비 < · = · > 실제 택배비 모두 LaunchROAS와 남는 금액 · 마진율 · 수수료가 같다', () => {
  for (const [got, paidOut] of [[2500, 3000], [3000, 3000], [3500, 3000]]) {
    for (const disc of [0, 10]) {
      const r = ex({ discountRate: String(disc), shippingMode: 'paid', customerShipping: String(got), actualShipping: String(paidOut) });
      const o = roas({ sellerDiscount: 50000 * disc / 100, customerShipping: got, actualShipping: paidOut });
      assert.equal(r.ok, true);
      assert.equal(r.after.profit, o.postAd);
      assert.equal(r.after.ratio, o.ratio);
      assert.equal(r.after.fee, o.feeTotal);
      assert.equal(r.after.income, o.totalIncome);
    }
  }
});

test('유료배송: 수수료 기준 = 할인 후 판매금액 + 받은 배송비, 분모도 같다, 택배비는 한 번만 차감', () => {
  const r = ex({ discountRate: '', shippingMode: 'paid', customerShipping: '3,500', actualShipping: '3,000' });
  assert.equal(r.after.fee, 1500 + 105);                 // 50,000 × 3% + 3,500 × 3%
  assert.equal(r.after.received, 3500);
  assert.equal(r.after.shipping, 3000);
  assert.equal(r.after.profit, 53500 - 30000 - 1605 - 500 - 3000 - 6000); // 12,395
  assert.equal(r.after.ratio, r.after.profit / 53500 * 100);
  // 받은 배송비가 더 많으면 차액 500원만큼(수수료 105원 제외) 무료배송 0원 입력보다 더 남는다
  const free0 = ex({ discountRate: '', shipping: '0' });
  assert.equal(r.after.profit - free0.after.profit, 500 - 105);
});

test('유료배송: 간단 입력 칸 값은 무시, 숨은 칸 오류도 계산을 막지 않는다 (반대도 같다)', () => {
  const a = ex({ shippingMode: 'paid', shipping: '-999', customerShipping: '3000', actualShipping: '3000' });
  const b = ex({ shippingMode: 'paid', shipping: '99999', customerShipping: '3000', actualShipping: '3000' });
  assert.equal(a.ok, true);
  assert.deepEqual(a.after, b.after);
  const s = ex({ customerShipping: '-1', actualShipping: 'abc' }); // 간단 입력 모드
  assert.equal(s.ok, true);
  assert.equal(s.after.profit, 4150);
});

test('유료배송: 빈칸은 0, 음수 · 문자는 오류', () => {
  assert.equal(ex({ shippingMode: 'paid' }).after.shipping, 0);
  assert.ok(ex({ shippingMode: 'paid', customerShipping: '-1' }).errors.customerShipping);
  assert.ok(ex({ shippingMode: 'paid', actualShipping: 'x' }).errors.actualShipping);
});

test('펼칠 때 받은 배송비 0 · 실제 택배비 = 간단 입력값이면 결과가 그대로다', () => {
  const simple = ex({});
  const paid = ex({ shippingMode: 'paid', customerShipping: '0', actualShipping: '3000' });
  assert.deepEqual(paid.after, simple.after);
  assert.deepEqual(paid.before, simple.before);
});
