/* 첫단추 마진 계산기 — 입력 변환 모듈 (DOM 없음).

   계산 자체는 margin-calc.js(launchroas/margin-calc.js의 변경 없는 복사본)가
   한다. 이 파일은 첫단추 화면의 단순 입력을 그 모듈의 입력으로 바꾸고,
   같은 조건에서 할인만 0으로 둔 결과를 함께 돌려 전후를 비교한다.

   입력 대응(중복 차감 방지):
   - 할인율(%) → sellerDiscount = round(판매가 × 할인율)
   - 판매자 실제 부담 배송비 → actualShipping. 고객에게 받은 배송비는 이미
     빼고 넣는 값이므로 customerShipping = 0, 배송비 수수료 없음.
   - 수수료율 → feeRate, 기준은 할인 후 판매금액, 입력한 요율 그대로(부가세 포함).
   - 주문당 광고비(선택) → adMode 'amount'. 빈칸이면 광고비 없음.
   - 마진율 분모 = 할인 후 판매금액(customerShipping=0이라 totalIncome과 같다).
     판매금액이 0이면 마진율은 null(계산 불가).

   유료배송 상세 입력(shippingMode 'paid') — LaunchROAS 계산기의 '배송비 수수료:
   상품과 동일' 조건과 같다. 이때 간단 입력(shipping)은 계산에 쓰지 않는다.
   - customerShipping = 고객에게 받은 배송비, actualShipping = 실제 택배비.
   - 수수료 기준 = 할인 후 판매금액 + 받은 배송비(같은 요율).
   - 마진율 분모 = 할인 후 판매금액 + 받은 배송비(totalIncome).
   - 받은 배송비가 더 많아도 정상(차액만큼 남는 금액이 는다). 택배비는 한 번만 뺀다. */
(function(root, factory){
  var api = factory(root && root.launchdeskMarginCalc ? root.launchdeskMarginCalc : (typeof require === 'function' ? require('./margin-calc.js') : null));
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.chutdanchuMargin = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(MC){
  'use strict';

  var FIELDS = ['price', 'unitCost', 'discountRate', 'feeRate', 'packaging', 'shipping', 'adCost'];
  var PAID_FIELDS = ['customerShipping', 'actualShipping'];
  var REQUIRED = { price: '판매가를 입력해주세요', unitCost: '사입 원가를 입력해주세요 (없으면 0)' };
  var PERCENT = { discountRate: '할인율', feeRate: '수수료율' };

  var EXAMPLE = { price: 50000, unitCost: 30000, discountRate: 10, feeRate: 3, packaging: 500, shipping: 3000, adCost: 6000 };

  function calculate(raw){
    raw = raw || {};
    var errors = {}, v = {}, paid = raw.shippingMode === 'paid';
    // 화면에 보이는 배송비 입력만 검사 · 계산한다(두 방식 동시 반영 금지).
    FIELDS.filter(function(f){ return !(paid && f === 'shipping'); }).concat(paid ? PAID_FIELDS : []).forEach(function(f){
      var s = raw[f] == null ? '' : String(raw[f]).trim();
      var n = MC.toNum(s);
      if(s === ''){ if(REQUIRED[f]) errors[f] = REQUIRED[f]; v[f] = null; return; }
      if(n === null){ errors[f] = '숫자만 입력해주세요'; return; }
      if(n < 0){ errors[f] = '0 이상으로 입력해주세요'; return; }
      if(PERCENT[f] && n > 100){ errors[f] = PERCENT[f] + '은 0~100% 사이여야 해요'; return; }
      v[f] = n;
    });
    if(Object.keys(errors).length) return { ok: false, errors: errors, after: null, before: null };

    var discount = Math.round(v.price * (v.discountRate || 0) / 100);
    function run(sellerDiscount){
      return MC.calculate({
        price: v.price, qty: 1, unitCost: v.unitCost, sellerDiscount: sellerDiscount,
        feeRate: v.feeRate || 0, feeBase: MC.FEE_BASE.AFTER, feeVat: MC.FEE_VAT.INCLUDED,
        customerShipping: paid ? (v.customerShipping || 0) : 0,
        actualShipping: (paid ? v.actualShipping : v.shipping) || 0,
        shippingFeeMode: paid ? MC.SHIP_FEE.SAME : MC.SHIP_FEE.NONE,
        packaging: v.packaging || 0, pgRate: 0, otherCost: 0,
        adMode: v.adCost ? MC.AD_MODE.AMOUNT : MC.AD_MODE.NONE, adAmount: v.adCost || null
      });
    }
    var a = run(discount), b = run(0);
    if(!a.ok || !b.ok) return { ok: false, errors: Object.assign({}, a.errors, b.errors), after: null, before: null };
    return { ok: true, errors: {}, discount: discount, after: summary(a.result), before: summary(b.result) };
  }

  function summary(r){
    return {
      sale: r.productAmount, received: r.totalIncome - r.productAmount, income: r.totalIncome, cost: r.productCostTotal, fee: r.feeTotal, packaging: r.packaging,
      shipping: r.actualShipping, ad: r.adCost, profit: r.postAd, ratio: r.ratio, isDeficit: r.isDeficit
    };
  }

  return { FIELDS: FIELDS, PAID_FIELDS: PAID_FIELDS, EXAMPLE: EXAMPLE, calculate: calculate, fmtWon: MC.fmtWon, fmtPct: MC.fmtPct, toNum: MC.toNum };
});
