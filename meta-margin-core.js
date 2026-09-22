/* 광고 세트 손익분기 기준 연결 — 순수 로직 모듈 (DOM · 네트워크 · 저장소 없음).

   meta-adsets.js(화면 연결)와 tests/meta-margin-core.test.js(검증)가 같은
   함수를 쓴다. margin-calc.js/plans-core.js와 같은 방식으로 브라우저에서는
   window.launchdeskMetaMarginCore, Node에서는 module.exports로 노출된다.

   여기 있는 것:
   - 저장한 마진 계산 기록(store.js getCalcHistory / tools.js
     buildCurrentRecord가 돌려주는 v2 레코드)을 연결 모달에 보여줄 후보
     객체로 정규화.
   - ad_margin_links에 저장할 스냅샷 정규화 · 검증(허용 필드만, currency는
     현재 스키마대로 KRW 고정).
   - 손익분기 ROAS 계산(유효/불가 사유 문구 포함) — pre_ad/total_income만
     본다. 광고비 자체는 이 계산에 전혀 관여하지 않는다.
   - 현재 ROAS(비율)와 손익분기 ROAS(비율)의 비교 — 반올림 전 ratio끼리
     비교하고, 화면에 보여줄 %p만 반올림한다.
   - product_label 검증(trim 후 1~40자).
   - 통화 비교 가능 여부(현재 KRW만).

   여기 없는 것: DOM, Supabase 호출, localStorage/sessionStorage, 이름·
   상품명 기반 자동 매칭, 최신 계산 자동 선택. 이 파일은 어떤 값도 스스로
   "선택"하지 않는다 — 전부 호출부(사용자의 명시적 선택)가 넘겨준 값만
   가공한다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskMetaMarginCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var CALC_VERSION = 2;
  var CURRENCY = 'KRW'; // ad_margin_links_currency_krw CHECK 제약과 동일 — 이 상수 하나만 바꿔서는
                         // DB 제약이 넓어지지 않는다(스키마 변경 없이는 다른 통화를 저장할 수 없음).

  function isFiniteNum(n){ return typeof n === 'number' && isFinite(n); }
  function toNum(v){
    if(v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // margin-calc.js의 fmtWon과 동일한 규칙(부호 유지, 원 단위 반올림, 천단위
  // 구분) — 이 모듈이 margin-calc.js를 require/참조하지 않고 완전히
  // 독립적으로 남기 위해 작게 그대로 복제한다(tools.js의 showToast 복제와
  // 같은 이유).
  function fmtWon(n){
    if(n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    return sign + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
  }

  // ------------------------------------------------------- 손익분기 계산
  var REASON_PRE_AD_ZERO = '광고비 전 남는 금액이 0원이라 손익분기 ROAS가 없어요.';
  var REASON_PRE_AD_NEGATIVE = '광고비 전부터 주문당 적자라 손익분기 ROAS가 없어요.';
  var REASON_TOTAL_INCOME_NOT_POSITIVE = '총 수입이 0원 이하라 손익분기 ROAS를 계산할 수 없어요.';

  /* computeBreakeven(totalIncome, preAd) → { ok, ratio, pctLabel, preAdAmount, reason }
     - 유효: total_income > 0 && pre_ad > 0 → ratio = total_income/pre_ad,
       pctLabel은 소수 1자리(예: "250.0%").
     - 무효 사유는 순서대로 확인한다(pre_ad === 0 → pre_ad < 0 → total_income
       <= 0) — pre_ad 자체가 손익분기의 분모이므로 그 이상 유무를 먼저 본다.
     - preAdAmount는 항상 원래 pre_ad 값을 그대로 담는다(음수여도 감추지
       않고 화면에 표시할 수 있게). NaN/Infinity 입력은 total_income <= 0과
       같은 값 없음 취급으로 떨어진다(둘 다 유효 조건 total_income>0을
       만족하지 못함) — 화면에 NaN·Infinity 문자열이 나갈 일이 없다. */
  function computeBreakeven(totalIncome, preAd){
    var ti = toNum(totalIncome);
    var pa = toNum(preAd);
    var preAdAmount = (pa === null) ? null : pa;

    if(pa === 0){
      return { ok: false, reason: REASON_PRE_AD_ZERO, preAdAmount: preAdAmount, ratio: null, pctLabel: null };
    }
    if(pa !== null && pa < 0){
      return { ok: false, reason: REASON_PRE_AD_NEGATIVE, preAdAmount: preAdAmount, ratio: null, pctLabel: null };
    }
    if(ti === null || ti <= 0){
      return { ok: false, reason: REASON_TOTAL_INCOME_NOT_POSITIVE, preAdAmount: preAdAmount, ratio: null, pctLabel: null };
    }
    if(pa === null){
      return { ok: false, reason: REASON_TOTAL_INCOME_NOT_POSITIVE, preAdAmount: preAdAmount, ratio: null, pctLabel: null };
    }
    var ratio = ti / pa;
    if(!isFiniteNum(ratio)){
      return { ok: false, reason: REASON_TOTAL_INCOME_NOT_POSITIVE, preAdAmount: preAdAmount, ratio: null, pctLabel: null };
    }
    return {
      ok: true,
      reason: null,
      preAdAmount: preAdAmount,
      ratio: ratio,
      pctLabel: (ratio * 100).toFixed(1) + '%'
    };
  }

  // ------------------------------------------------------------ ROAS 비교
  /* compareRoas(currentRatio, breakevenRatio) → { text, direction } | null
     null: 비교할 수 없거나(둘 중 하나가 유효한 유한수가 아님) 두 ratio가
     정확히 같은 경우("차이가 있으면"만 문구를 만든다 — 요구사항).
     direction: 'above'(현재가 더 높음) | 'below'(현재가 더 낮음).
     반올림 전 ratio끼리 뺄셈으로 방향을 정하고, 표시할 %p 크기만 소수
     1자리로 반올림한다 — 좋음/나쁨/성공/위험 같은 확정 표현은 전혀 쓰지
     않는다(중립 문구만). */
  function compareRoas(currentRatio, breakevenRatio){
    if(!isFiniteNum(currentRatio) || !isFiniteNum(breakevenRatio)) return null;
    if(currentRatio === breakevenRatio) return null;
    var diffPct = (currentRatio - breakevenRatio) * 100;
    var magnitude = Math.round(Math.abs(diffPct) * 10) / 10;
    var direction = diffPct > 0 ? 'above' : 'below';
    var text = '연결한 기준보다 ' + magnitude.toFixed(1) + '%p ' + (direction === 'above' ? '높아요' : '낮아요') + '.';
    return { text: text, direction: direction };
  }

  // -------------------------------------------------------------- 통화
  // 지금 스키마(ad_margin_links_currency_krw CHECK)는 KRW 스냅샷만 허용한다.
  // ROAS는 무차원 비율이라 계정 통화와 무관하게 항상 비교 가능하다 —
  // 이 함수는 "금액(광고비 · CPA · 공헌이익)을 서로 비교해도 되는가"만
  // 답한다. 이 모듈 어디에도 금액 비교를 만드는 함수가 없으므로, 호출부가
  // 이 함수를 무시하고 금액을 비교하는 코드를 새로 만들지 않는 한 통화가
  // 다른 금액이 같은 줄에 섞여 나갈 일이 없다.
  function isAmountComparable(accountCurrency){
    return accountCurrency === CURRENCY;
  }

  // ------------------------------------------------------ 저장 기록 → 후보
  /* normalizeCandidate(record, source) → 연결 모달에 보여줄 후보 하나.
     record는 store.js getCalcHistory()/tools.js buildCurrentRecord()가
     돌려주는 v2 레코드({ calc_version, date, saved_at, platform, input,
     result })다. v2가 아니거나 input/result가 없으면 null(옛 v1 기록은
     선택 후보에 넣지 않는다 — 요구사항: 불러오기는 v2만).
     source: 'saved' | 'current' — 화면에서 "저장한 기록"과 "지금 입력한
     값"을 구분해 보여주기 위한 표시용 값일 뿐, 저장 스냅샷에는 들어가지
     않는다. */
  function normalizeCandidate(record, source, index){
    if(!record || record.calc_version !== CALC_VERSION || !record.input || !record.result) return null;
    var r = record.result;
    var totalIncome = toNum(r.totalIncome);
    var preAd = toNum(r.preAd);
    var breakeven = computeBreakeven(totalIncome, preAd);
    var qty = toNum(record.input.qty) || 1;
    return {
      index: index,
      source: source === 'current' ? 'current' : 'saved',
      dateLabel: typeof record.date === 'string' ? record.date : '',
      savedAt: typeof record.saved_at === 'string' ? record.saved_at : null,
      platform: record.platform || null,
      priceLabel: fmtWon(toNum(record.input.price)),
      qty: qty,
      preAdLabel: fmtWon(preAd),
      breakeven: breakeven,
      // buildSnapshotForSave가 그대로 다시 쓸 수 있도록 원본 record를 들고
      // 있는다(선택 시점에 이 값을 그대로 스냅샷 재료로 넘긴다).
      record: record
    };
  }
  // savedRecords: getCalcHistory() 결과(최대 5개, v1 섞여 있을 수 있음).
  // currentRecord: buildCurrentRecord() 결과(없으면 null/undefined).
  function buildCandidateList(savedRecords, currentRecord){
    var list = [];
    var current = normalizeCandidate(currentRecord, 'current', -1);
    if(current) list.push(current);
    (Array.isArray(savedRecords) ? savedRecords : []).forEach(function(rec, i){
      var c = normalizeCandidate(rec, 'saved', i);
      if(c) list.push(c);
    });
    return list;
  }

  // ---------------------------------------------------- product_label 검증
  var LABEL_MIN = 1, LABEL_MAX = 40;
  /* validateProductLabel(raw) → { ok, value, error }
     trim 후 1~40자만 허용. 개인정보(실명·연락처 등) 여부는 형식으로 걸러낼
     수 없으므로 검증하지 않는다 — 화면 경고 문구로만 안내한다(요구사항). */
  function validateProductLabel(raw){
    var v = (raw === null || raw === undefined) ? '' : String(raw).trim();
    if(v.length < LABEL_MIN) return { ok: false, value: v, error: '상품 구분용 이름을 입력해주세요.' };
    if(v.length > LABEL_MAX) return { ok: false, value: v, error: '상품 구분용 이름은 40자 이내로 적어주세요.' };
    return { ok: true, value: v, error: null };
  }

  // -------------------------------------------------------- 저장 스냅샷
  /* buildSnapshotForSave(record, productLabel) → { ok, value, error }
     value는 ad_margin_links의 schema allowlist에 있는 컬럼만 담은 평범한
     객체다(store_id/meta_adset_id는 호출부가 소유하고 있는 값이라 여기서
     넣지 않는다 — 이 함수는 그 두 값을 아예 인자로 받지 않는다). record는
     normalizeCandidate()가 감싸고 있던 원본 v2 레코드(또는 그와 같은 모양)
     여야 한다. */
  function buildSnapshotForSave(record, productLabel){
    var label = validateProductLabel(productLabel);
    if(!label.ok) return { ok: false, error: label.error, value: null };
    if(!record || record.calc_version !== CALC_VERSION || !record.result){
      return { ok: false, error: '선택한 계산 기록을 찾을 수 없어요.', value: null };
    }
    var totalIncome = toNum(record.result.totalIncome);
    var preAd = toNum(record.result.preAd);
    if(totalIncome === null || preAd === null){
      return { ok: false, error: '선택한 계산 기록의 금액을 읽을 수 없어요.', value: null };
    }
    var sourceSavedAt = typeof record.saved_at === 'string' && record.saved_at ? record.saved_at : new Date().toISOString();
    return {
      ok: true,
      error: null,
      value: {
        product_label: label.value,
        calc_version: CALC_VERSION,
        currency: CURRENCY,
        total_income: totalIncome,
        pre_ad: preAd,
        source_saved_at: sourceSavedAt
      }
    };
  }

  return {
    CALC_VERSION: CALC_VERSION,
    CURRENCY: CURRENCY,
    fmtWon: fmtWon,
    computeBreakeven: computeBreakeven,
    compareRoas: compareRoas,
    isAmountComparable: isAmountComparable,
    normalizeCandidate: normalizeCandidate,
    buildCandidateList: buildCandidateList,
    validateProductLabel: validateProductLabel,
    buildSnapshotForSave: buildSnapshotForSave
  };
});
