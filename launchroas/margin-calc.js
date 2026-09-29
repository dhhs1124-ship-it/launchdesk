/* 마진 계산기 — 순수 계산 모듈 (DOM 없음).

   tools.js(화면)와 tests/margin-calc.test.js(검증)가 같은 함수를 쓴다.
   브라우저에서는 window.launchdeskMarginCalc 로, Node 에서는
   module.exports 로 노출된다.

   계산 단위는 "주문 1건". 판매 수량이 늘어도 배송비·포장비·기타 비용은
   주문당 1회만 든다고 보고 수량을 곱하지 않는다(요구사항 2).

   결과 명칭 주의: "순이익", "세후 최종마진"이라는 말은 쓰지 않는다. 여기서
   계산하는 건 부가세 납부액 · 소득세 · 미입력 고정비를 반영하기 전의
   "예상 잔액"이며, 판매가·원가·배송비·포장비는 부가세 포함 금액을 그대로
   넣는 현금 지출 기준이다(요구사항 4). 수수료의 부가세는 별도 설정으로만
   처리하고, 모든 비용을 무조건 11로 나누어 매입세액을 추정하지 않는다.

   반올림 기준: 내부 계산은 실수로 하되, 수수료·광고비 등 "줄 단위" 금액은
   각각 원 단위로 반올림(Math.round)한 뒤 합산한다 — 화면에 보이는 줄들의
   합이 총액과 항상 일치하도록. 플랫폼별 실제 정산의 절사/반올림 규칙까지
   재현하지는 못하므로 결과는 추정값이다. 비율은 실수 그대로 두고 화면에서
   소수 1자리로만 표시한다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskMarginCalc = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var CALC_VERSION = 2;

  // 빈 문자열/null/undefined/숫자 아님 → null. "0"은 숫자 0(빈 값과 구분).
  function toNum(v){
    if(v === null || v === undefined) return null;
    if(typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/,/g, '').trim();
    if(s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function roundWon(n){ return Math.round(n); }

  var FEE_BASE = { AFTER: 'after_discount', BEFORE: 'before_discount' };
  var FEE_VAT = { INCLUDED: 'included', EXCLUDED: 'excluded' };
  var SHIP_FEE = { NONE: 'none', SAME: 'same', SEPARATE: 'separate' };
  var AD_MODE = { NONE: 'none', RATE: 'rate', AMOUNT: 'amount' };
  var VAT_RATE = 0.10; // 수수료가 부가세 별도로 고지된 경우, 실제 차감액은 요율 × 1.1

  // 광고비 비율 참고 버튼 — LaunchDesk 운영자의 경험에 기반한 "비교 예시"이지,
  // 업계 평균이나 반드시 지출해야 할 금액이 아니다. 어느 것도 기본 선택되지
  // 않으며(사용자 선택 전 자동 적용 금지), 입력 상한도 두지 않는다.
  var AD_PRESETS = [
    { rate: 6,  label: '6%',  desc: '안정화 후 효율 관리 참고안' },
    { rate: 10, label: '10%', desc: '평소 운영 계획 참고안' },
    { rate: 20, label: '20%', desc: '초기 유입 · 반응 테스트 참고안' }
  ];

  function defaults(){
    return {
      price: null, qty: 1, sellerDiscount: 0, unitCost: null,
      customerShipping: 0, actualShipping: 0, packaging: 0,
      feeRate: null, feeBase: FEE_BASE.AFTER, feeVat: FEE_VAT.INCLUDED,
      shippingFeeMode: SHIP_FEE.NONE, shippingFeeRate: null,
      pgRate: 0, otherCost: 0,
      adMode: AD_MODE.NONE, adRate: null, adAmount: null,
      targetProfit: null
    };
  }

  /* validate(raw) → { ok, errors:{field:msg}, input }
     - 필수: price(>0), qty(1 이상 정수), unitCost(0 이상), feeRate(0~100)
       — 빈 값은 오류, 실제 0원은 유효(빈 필수 입력과 0원을 구분).
     - 선택(빈 값 → 0): sellerDiscount, customerShipping, actualShipping,
       packaging, otherCost, pgRate. targetProfit은 빈 값 → null(미사용).
     - 모드 의존: shippingFeeMode='separate'면 shippingFeeRate 필수,
       adMode='rate'면 adRate 필수(0 이상, 상한 없음), adMode='amount'면
       adAmount 필수(0 이상). */
  function validate(raw){
    raw = raw || {};
    var errors = {};
    var input = {};

    function req(field, opts){
      var n = toNum(raw[field]);
      if(n === null){ errors[field] = opts.emptyMsg; return null; }
      if(opts.min !== undefined && n < opts.min){ errors[field] = opts.rangeMsg; return null; }
      if(opts.max !== undefined && n > opts.max){ errors[field] = opts.rangeMsg; return null; }
      if(opts.integer && n !== Math.floor(n)){ errors[field] = opts.rangeMsg; return null; }
      return n;
    }
    function opt(field, opts){
      var n = toNum(raw[field]);
      if(n === null) return 0;
      if(n < 0){ errors[field] = opts.negMsg; return 0; }
      if(opts.max !== undefined && n > opts.max){ errors[field] = opts.rangeMsg; return 0; }
      return n;
    }

    input.price = req('price', { min: 0.000001, emptyMsg: '판매가를 입력해주세요', rangeMsg: '판매가는 0보다 커야 해요' });
    input.qty = req('qty', { min: 1, integer: true, emptyMsg: '판매 수량을 입력해주세요', rangeMsg: '판매 수량은 1 이상의 정수여야 해요' });
    input.unitCost = req('unitCost', { min: 0, emptyMsg: '개당 구입원가를 입력해주세요 (없으면 0)', rangeMsg: '구입원가는 0 이상이어야 해요' });
    input.feeRate = req('feeRate', { min: 0, max: 100, emptyMsg: '판매 수수료율을 입력해주세요 (없으면 0)', rangeMsg: '수수료율은 0~100% 사이여야 해요' });

    input.sellerDiscount = opt('sellerDiscount', { negMsg: '할인액은 0 이상이어야 해요' });
    input.customerShipping = opt('customerShipping', { negMsg: '고객 배송비는 0 이상이어야 해요' });
    input.actualShipping = opt('actualShipping', { negMsg: '실제 배송비는 0 이상이어야 해요' });
    input.packaging = opt('packaging', { negMsg: '포장 · 부자재비는 0 이상이어야 해요' });
    input.otherCost = opt('otherCost', { negMsg: '기타 비용은 0 이상이어야 해요' });
    input.pgRate = opt('pgRate', { negMsg: 'PG 수수료율은 0 이상이어야 해요', max: 100, rangeMsg: 'PG 수수료율은 0~100% 사이여야 해요' });

    input.feeBase = raw.feeBase === FEE_BASE.BEFORE ? FEE_BASE.BEFORE : FEE_BASE.AFTER;
    input.feeVat = raw.feeVat === FEE_VAT.EXCLUDED ? FEE_VAT.EXCLUDED : FEE_VAT.INCLUDED;

    input.shippingFeeMode = (raw.shippingFeeMode === SHIP_FEE.SAME || raw.shippingFeeMode === SHIP_FEE.SEPARATE) ? raw.shippingFeeMode : SHIP_FEE.NONE;
    if(input.shippingFeeMode === SHIP_FEE.SEPARATE){
      input.shippingFeeRate = req('shippingFeeRate', { min: 0, max: 100, emptyMsg: '배송비 수수료율을 입력해주세요', rangeMsg: '배송비 수수료율은 0~100% 사이여야 해요' });
    } else {
      input.shippingFeeRate = null;
    }

    input.adMode = (raw.adMode === AD_MODE.RATE || raw.adMode === AD_MODE.AMOUNT) ? raw.adMode : AD_MODE.NONE;
    input.adRate = null; input.adAmount = null;
    if(input.adMode === AD_MODE.RATE){
      input.adRate = req('adRate', { min: 0, emptyMsg: '광고비 비율을 선택하거나 입력해주세요', rangeMsg: '광고비 비율은 0 이상이어야 해요' });
    } else if(input.adMode === AD_MODE.AMOUNT){
      input.adAmount = req('adAmount', { min: 0, emptyMsg: '주문당 광고비 금액을 입력해주세요', rangeMsg: '광고비 금액은 0 이상이어야 해요' });
    }

    var tp = toNum(raw.targetProfit);
    if(tp === null){ input.targetProfit = null; }
    else if(tp < 0){ errors.targetProfit = '남기고 싶은 금액은 0 이상이어야 해요'; input.targetProfit = null; }
    else { input.targetProfit = tp; }

    // 할인액 초과 — 상품 결제금액이 음수가 되면 안 된다
    if(input.price !== null && input.qty !== null && input.sellerDiscount > input.price * input.qty){
      errors.sellerDiscount = '판매자 부담 할인액이 상품금액(판매가 × 수량)을 넘을 수 없어요';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors, input: input };
  }

  /* compute(input) — validate()를 통과한 input만 넣는다. 모든 금액은 원 단위 정수. */
  function compute(input){
    var grossBeforeDiscount = input.price * input.qty;              // 할인 전 상품금액
    var productAmount = grossBeforeDiscount - input.sellerDiscount;  // 상품 결제금액(할인 후)
    var totalIncome = productAmount + input.customerShipping;       // 총 수입
    var productCostTotal = input.unitCost * input.qty;              // 상품 원가 합계

    var feeMultiplier = input.feeVat === FEE_VAT.EXCLUDED ? (1 + VAT_RATE) : 1;
    var productFeeBase = input.feeBase === FEE_BASE.BEFORE ? grossBeforeDiscount : productAmount;
    var productFee = roundWon(productFeeBase * (input.feeRate / 100) * feeMultiplier);

    var shippingFeeRate = 0;
    if(input.shippingFeeMode === SHIP_FEE.SAME) shippingFeeRate = input.feeRate;
    else if(input.shippingFeeMode === SHIP_FEE.SEPARATE) shippingFeeRate = input.shippingFeeRate || 0;
    var shippingFee = roundWon(input.customerShipping * (shippingFeeRate / 100) * feeMultiplier);

    // 별도 PG 수수료 — 통합 수수료에 PG가 이미 포함됐다면 0으로 둔다(중복 차감 금지).
    // 결제 총액(상품 결제금액 + 고객배송비)에 적용하며, 부가세 설정은 위 수수료와 같이 따른다.
    var pgFee = input.pgRate > 0 ? roundWon(totalIncome * (input.pgRate / 100) * feeMultiplier) : 0;

    var feeTotal = productFee + shippingFee + pgFee;

    var preAd = roundWon(totalIncome) - roundWon(productCostTotal) - roundWon(input.actualShipping)
      - roundWon(input.packaging) - feeTotal - roundWon(input.otherCost);

    var adCost = 0;
    if(input.adMode === AD_MODE.RATE) adCost = roundWon(productAmount * ((input.adRate || 0) / 100)); // 기준: 배송비 제외 · 할인 후 상품 결제금액
    else if(input.adMode === AD_MODE.AMOUNT) adCost = roundWon(input.adAmount || 0);

    var postAd = preAd - adCost;
    var ratio = totalIncome > 0 ? (postAd / totalIncome) * 100 : null; // 분모 0 → 계산 불가
    var adRoom = input.targetProfit === null ? null : preAd - roundWon(input.targetProfit);

    // 광고비 차감 전 공헌이익률 · 손익분기 ROAS — 둘 다 preAd/totalIncome만으로
    // 계산해서 adCost와 완전히 무관하다(광고비 입력을 바꿔도 이 값들은 그대로여야
    // 한다는 요구사항을 계산식 자체로 보장한다. adCost는 이미 preAd 계산 이후에만
    // 등장하므로 여기서 참조하지 않는다).
    // preAd <= 0이면 "이익 기준 손익분기점"이 존재하지 않으므로 null(화면에서
    // Infinity·NaN·음수 ROAS를 표시하지 않기 위함) — totalIncome <= 0인 경우도
    // 마찬가지로 null.
    var preAdRatio = totalIncome > 0 ? (preAd / totalIncome) * 100 : null;
    var breakevenRoas = (totalIncome > 0 && preAd > 0) ? (totalIncome / preAd) * 100 : null;

    return {
      calcVersion: CALC_VERSION,
      grossBeforeDiscount: roundWon(grossBeforeDiscount),
      productAmount: roundWon(productAmount),
      totalIncome: roundWon(totalIncome),
      productCostTotal: roundWon(productCostTotal),
      actualShipping: roundWon(input.actualShipping),
      packaging: roundWon(input.packaging),
      otherCost: roundWon(input.otherCost),
      productFeeBase: roundWon(productFeeBase),
      productFee: productFee,
      shippingFee: shippingFee,
      shippingFeeRate: shippingFeeRate,
      pgFee: pgFee,
      feeMultiplier: feeMultiplier,
      feeTotal: feeTotal,
      preAd: preAd,
      adCost: adCost,
      adMode: input.adMode,
      adRate: input.adMode === AD_MODE.RATE ? input.adRate : null,
      postAd: postAd,
      ratio: ratio,
      preAdRatio: preAdRatio,
      breakevenRoas: breakevenRoas,
      isDeficit: postAd < 0,
      targetProfit: input.targetProfit,
      adRoom: adRoom
    };
  }

  // 편의: raw → validate → compute 한 번에. ok=false면 result=null.
  function calculate(raw){
    var v = validate(raw);
    return { ok: v.ok, errors: v.errors, input: v.input, result: v.ok ? compute(v.input) : null };
  }

  /* 초보자용 예시 — 전부 가상 가격 · 가상 수수료. 실제 플랫폼 요율이 아니다. */
  var EXAMPLES = [
    {
      key: 'shipping-paid',
      title: '고객이 배송비를 내는 일반 상품',
      summary: '판매가 32,000원 상품 1개, 고객이 배송비 3,000원을 따로 낸 주문',
      note: '고객에게 받은 배송비 3,000원은 총 수입에 더해지고, 택배사에 실제로 낸 3,300원은 비용으로 빠져요. 배송비 수수료를 "상품과 동일"로 두면 고객배송비에도 같은 요율이 붙습니다.',
      input: { price: 32000, qty: 1, sellerDiscount: 0, unitCost: 14000, customerShipping: 3000, actualShipping: 3300, packaging: 800, feeRate: 5.5, feeBase: 'after_discount', feeVat: 'included', shippingFeeMode: 'same', shippingFeeRate: null, pgRate: 0, otherCost: 0, adMode: 'none', adRate: null, adAmount: null, targetProfit: null }
    },
    {
      key: 'free-shipping',
      title: '무료배송 상품',
      summary: '판매가 29,000원, 판매자 부담 쿠폰 2,000원, 배송비는 판매자가 부담한 주문',
      note: '무료배송이라 고객배송비는 0원이지만 택배비 3,000원은 그대로 나가요. 판매자 부담 할인액 2,000원은 상품 결제금액에서 빠지고, 광고비 10%도 이 할인 후 금액을 기준으로 계산됩니다.',
      input: { price: 29000, qty: 1, sellerDiscount: 2000, unitCost: 12000, customerShipping: 0, actualShipping: 3000, packaging: 900, feeRate: 5.5, feeBase: 'after_discount', feeVat: 'included', shippingFeeMode: 'none', shippingFeeRate: null, pgRate: 0, otherCost: 0, adMode: 'rate', adRate: 10, adAmount: null, targetProfit: null }
    },
    {
      key: 'bundle',
      title: '묶음 · 세트 상품',
      summary: '3개입 세트(45,000원) 2세트를 한 주문에 판매, 수수료는 부가세 별도 6%',
      note: '세트라면 "개당 구입원가"에 세트 1개의 전체 원가(21,000원)를 넣고, 수량에는 세트 수(2)를 넣어요. 세트 안의 낱개 수(3개)를 다시 곱하면 원가가 3배로 부풀려지니 주의하세요. 수수료가 부가세 별도로 고지되면 실제 차감액은 6% × 1.1 = 6.6%가 됩니다.',
      input: { price: 45000, qty: 2, sellerDiscount: 0, unitCost: 21000, customerShipping: 0, actualShipping: 3500, packaging: 1500, feeRate: 6, feeBase: 'after_discount', feeVat: 'excluded', shippingFeeMode: 'none', shippingFeeRate: null, pgRate: 0, otherCost: 0, adMode: 'rate', adRate: 6, adAmount: null, targetProfit: null }
    }
  ];

  /* 플랫폼별 수수료 안내 — 플랫폼 선택은 "무엇을 확인해야 하는지" 안내만
     하고, 실제 요율 입력은 사용자가 직접 한다(선택이 입력값을 덮어쓰지
     않는다). 구체적인 요율(%)은 최신 공식 자료를 직접 확인한 경우에만
     rates에 적고 verifiedAt에 그 확인일을 적는다 — 확인하지 못했으면 둘 다
     null로 두고, 화면은 "판매자센터 · 계약에서 확인 후 입력"으로 안내한다.
     확인하지 않은 날짜를 확인일로 적지 않는다. */
  var PLATFORM_GUIDE = {
    cafe24: {
      name: '카페24',
      composition: [
        '카페24 자체는 "판매 수수료"가 아니라 쇼핑몰 호스팅(플랜 이용료) 구조예요.',
        '주문 1건마다 실제로 빠지는 건 PG(결제대행) 수수료 — 카드 · 간편결제 · 계좌이체 등 결제수단별로 요율이 달라요.',
        '마켓통합(스마트스토어 · 쿠팡 등에 연동 판매)이나 유료 앱을 쓰면 그쪽 수수료가 따로 붙어요.'
      ],
      conditions: ['계약한 PG사 · 결제수단', '이용 중인 호스팅 플랜', '연동 판매 채널 사용 여부'],
      checks: ['PG 수수료 요율이 부가세 포함인지 별도인지', '고객배송비에도 PG 수수료가 붙는지(보통 결제 총액 기준)', '스마트스토어와는 수수료 구조가 완전히 다르니 따로 확인'],
      links: [{ label: '카페24 판매자 어드민', url: 'https://eclogin.cafe24.com/Shop/' }, { label: '카페24 고객센터', url: 'https://support.cafe24.com/' }],
      rates: null, verifiedAt: null
    },
    smartstore: {
      name: '스마트스토어',
      composition: [
        '결제수수료(결제수단별) + 네이버쇼핑 매출연동수수료(네이버쇼핑을 통해 유입된 주문에만) 두 갈래로 나뉘어요.',
        '이 계산기의 "판매 수수료율"에는 두 수수료를 합친 요율을 넣거나, 상품 수수료(연동)와 PG(결제)를 나눠 넣을 수 있어요 — 둘 중 하나만 써서 중복 차감을 피하세요.'
      ],
      conditions: ['결제수단(카드 · 계좌이체 · 네이버페이 등)', '네이버쇼핑 유입 여부', '판매자 등급 · 사업자 유형에 따른 요율 차이 여부'],
      checks: ['고지된 요율이 부가세 포함인지 별도인지', '배송비에도 결제수수료가 붙는지', '카페24와 한 수수료로 묶어 계산하지 않기'],
      links: [{ label: '스마트스토어센터', url: 'https://sell.smartstore.naver.com/' }, { label: '스마트스토어 판매자 도움말', url: 'https://help.sell.smartstore.naver.com/' }],
      rates: null, verifiedAt: null
    },
    coupang: {
      name: '쿠팡',
      composition: [
        '카테고리별 판매 수수료가 기본이고, 결제 · 배송 관련 항목이 별도 정책으로 붙을 수 있어요.',
        '로켓배송(공급) 계약과 마켓플레이스(판매자 배송) 계약은 정산 구조 자체가 달라요.'
      ],
      conditions: ['상품 카테고리', '판매자 배송 vs 로켓배송(공급) 계약 형태', '프로모션 · 쿠폰 참여 여부'],
      checks: ['수수료율이 부가세 포함인지 별도인지', '고객배송비 · 도서산간 추가 배송비에도 수수료가 붙는지', '정산 시 절사 · 반올림 규칙'],
      links: [{ label: '쿠팡 WING 판매자센터', url: 'https://wing.coupang.com/' }, { label: '쿠팡 마켓플레이스 판매자 안내', url: 'https://marketplace.coupangcorp.com/' }],
      rates: null, verifiedAt: null
    },
    other: {
      name: '기타 플랫폼 · 자사몰',
      composition: ['플랫폼마다 판매 수수료 · 결제(PG) 수수료 · 광고 · 프로모션 수수료가 다르게 구성돼요.'],
      conditions: ['계약서 · 판매자센터의 수수료 정책', '결제수단별 PG 요율'],
      checks: ['부가세 포함 여부', '배송비 수수료 여부', '정산 주기와 절사 규칙'],
      links: [],
      rates: null, verifiedAt: null
    }
  };

  function fmtWon(n){
    if(n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    return sign + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
  }
  function fmtPct(n, digits){
    if(n === null || n === undefined || !isFinite(n)) return '계산 불가';
    var d = digits === undefined ? 1 : digits;
    return n.toFixed(d) + '%';
  }

  return {
    CALC_VERSION: CALC_VERSION,
    FEE_BASE: FEE_BASE, FEE_VAT: FEE_VAT, SHIP_FEE: SHIP_FEE, AD_MODE: AD_MODE,
    AD_PRESETS: AD_PRESETS, EXAMPLES: EXAMPLES, PLATFORM_GUIDE: PLATFORM_GUIDE,
    defaults: defaults, toNum: toNum, roundWon: roundWon,
    validate: validate, compute: compute, calculate: calculate,
    fmtWon: fmtWon, fmtPct: fmtPct
  };
});
