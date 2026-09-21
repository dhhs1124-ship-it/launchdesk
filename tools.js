(function(){
  // showToast: app.js defines this the same way inside its own scope.
  // Duplicated here identically (same #toastStack element, same markup/timing)
  // since this file runs in its own top-level IIFE, not inside app.js's, so
  // the two can't share the same function — same reasoning as setup.js's
  // local reduceMotion copy.
  var toastStack = document.getElementById('toastStack');
  function showToast(message, type){
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    toastStack.appendChild(el);
    requestAnimationFrame(function(){ el.classList.add('show'); });
    setTimeout(function(){
      el.classList.remove('show');
      setTimeout(function(){ el.remove(); }, 250);
    }, 2600);
  }
  function byId(id){ return document.getElementById(id); }
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }

  /* ===================== 마진 계산기 (#/tools 화면 자체) =====================
     계산은 전부 margin-calc.js(window.launchdeskMarginCalc, 순수 함수)가 하고,
     이 파일은 입력 읽기 → validate/compute → 결과 · 계산 과정 그리기 →
     예시 모드 → 저장/불러오기만 담당한다. 계산 규칙 자체는 margin-calc.js와
     tests/margin-calc.test.js 를 보면 된다.

     "간편 입력 / 상세 입력"은 계산기 두 개가 아니라 같은 폼 · 같은 DOM ·
     같은 mcState를 공유하는 "표시 모드"일 뿐이다. data-mc-mode="detailed"가
     붙은 필드는 상세 입력에서만 보이지만, 숨겨진 동안에도 값은 그대로
     남아있고 mcReadForm()이 항상 전체 필드를 읽으므로 계산에서 빠지지
     않는다 — 모드 전환은 hidden 속성만 바꾸고 입력값·이벤트 핸들러는
     하나만 존재한다.

     저장 레코드 버전: 옛 사이드바 계산기가 남긴 기록은 { cost, price, fee,
     ship, profit, marginPct, date } 형태(calc_version 없음 = v1)이고, 이
     계산기는 { calc_version: 2, input, result, date, ... } 로 저장한다.
     두 형태를 구분해 그리며, v1 기록은 조용히 덮어쓰거나 변환하지 않고
     "이전 계산 방식"으로 읽기 전용 표시만 한다(불러오기는 v2만). */
  var MC = window.launchdeskMarginCalc;
  var mcRoot = document.querySelector('.tools-pane[data-tools-tab="calc"]');
  var mcEls = null;
  var mcState = {
    mode: 'simple',      // 'simple' | 'detailed' — 표시 모드일 뿐, 입력값·계산에는 영향 없음
    adMode: 'none',       // 'none' | 'rate' | 'amount' — margin-calc.js에 그대로 넘어가는 값
    adCustom: false,       // 광고비 "직접 입력" 칩이 활성인지(프리셋과 구분해 하이라이트하기 위함)
    adCustomKind: 'rate',  // 직접 입력일 때 비율/금액 중 무엇을 쓰는지
    targetOpen: false,     // "목표 금액에 맞춰 광고비 계산하기" 펼침 여부
    exampleKey: null,     // 예시 모드일 때 그 예시의 key
    userSnapshot: null,   // 예시 모드에 들어가기 직전 사용자 입력(원본 보존용)
    touched: false,       // 사용자가 무언가 입력하기 전에는 빈 필수값 오류를 띄우지 않는다
    lastCalc: null
  };
  var MC_NUMERIC_FIELDS = ['price','qty','unitCost','sellerDiscount','customerShipping','actualShipping','packaging','otherCost','feeRate','pgRate','shippingFeeRate','adRate','adAmount','targetProfit'];
  // 상세 입력에서만 노출되는 "조건" 필드 — 기본값과 달라지면 간편 입력으로
  // 접었을 때 "상세 조건 적용 중" 요약에 나타난다(광고비는 별도 섹션이라 제외).
  var MC_DETAIL_DEFAULTS = { qty: 1, sellerDiscount: 0, pgRate: 0, shippingFeeMode: 'none', feeVat: 'included', feeBase: 'after_discount', otherCost: 0 };

  function mcRadio(name){
    var el = mcRoot.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function mcSetRadio(name, value){
    var els = mcRoot.querySelectorAll('input[name="' + name + '"]');
    Array.prototype.forEach.call(els, function(r){ r.checked = (r.value === value); });
  }
  function mcReadForm(){
    var raw = {};
    MC_NUMERIC_FIELDS.forEach(function(k){ raw[k] = mcEls[k].value; });
    raw.feeBase = mcRadio('mcFeeBase');
    raw.feeVat = mcRadio('mcFeeVat');
    raw.shippingFeeMode = mcRadio('mcShipFeeMode');
    raw.adMode = mcState.adMode;
    raw.platform = mcEls.platform.value;
    return raw;
  }
  // values: 예시 input / 저장 레코드의 input / 사용자 스냅샷(raw) 어느 것이든 —
  // 숫자든 문자열이든 그대로 input.value 에 넣고, null/undefined 는 빈칸.
  // 모드(mcState.mode)는 건드리지 않는다 — 값을 바꾸는 것과 표시 모드를
  // 바꾸는 것은 별개다(요구사항 3: 모드 전환은 표시 항목만 바꾼다의 역).
  function mcWriteForm(values){
    MC_NUMERIC_FIELDS.forEach(function(k){
      var v = values[k];
      mcEls[k].value = (v === null || v === undefined) ? '' : v;
    });
    mcSetRadio('mcFeeBase', values.feeBase || MC.FEE_BASE.AFTER);
    mcSetRadio('mcFeeVat', values.feeVat || MC.FEE_VAT.INCLUDED);
    mcSetRadio('mcShipFeeMode', values.shippingFeeMode || MC.SHIP_FEE.NONE);
    if(values.platform !== undefined) mcEls.platform.value = values.platform || '';
    mcSyncAdStateFromValues(values);
    mcSyncShipConditionFromValue();
    mcSyncAdUI();
    mcSyncShipFeeUI();
    mcSyncTargetUI();
    mcApplyModeVisibility();
    mcRenderPlatformGuide();
  }
  // 사용자가 의미 있는 값을 넣어둔 상태인지(예시/불러오기로 덮어쓰기 전 확인용)
  function mcHasUserValues(raw){
    return ['price','unitCost','feeRate'].some(function(k){ return MC.toNum(raw[k]) !== null; });
  }

  /* ---- 간편 입력 / 상세 입력 표시 모드 ----------------------------------
     mode는 [data-mc-mode="detailed"] 요소의 hidden 속성만 바꾼다. 입력값 ·
     계산 결과 · 이벤트 리스너는 모드와 무관하게 항상 하나만 존재한다. */
  function mcApplyModeVisibility(){
    var isDetailed = mcState.mode === 'detailed';
    Array.prototype.forEach.call(mcRoot.querySelectorAll('[data-mc-mode="detailed"]'), function(el){ el.hidden = !isDetailed; });
    Array.prototype.forEach.call(mcRoot.querySelectorAll('.mc-mode-btn'), function(btn){
      var active = btn.getAttribute('data-mc-mode-btn') === mcState.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var footer = byId('mcGoDetailed');
    var summary = byId('mcDetailSummary');
    if(isDetailed){
      footer.hidden = true;
      summary.hidden = true;
      return;
    }
    // 간편 입력으로 돌아왔을 때: 상세 조건이 기본값과 다르면 그 내용을
    // 요약해 보여준다(고정 문구가 아니라 실제 값에서 만든다 — 요구사항 3).
    var parts = mcDetailSummaryParts(mcReadForm());
    if(parts.length){
      footer.hidden = true;
      summary.hidden = false;
      byId('mcDetailSummaryText').textContent = parts.join(' · ') + ' 적용 중';
    } else {
      footer.hidden = false;
      summary.hidden = true;
    }
  }
  function mcSetMode(mode){
    mcState.mode = (mode === 'detailed') ? 'detailed' : 'simple';
    mcApplyModeVisibility();
  }
  function mcDetailSummaryParts(raw){
    var parts = [];
    var qty = MC.toNum(raw.qty);
    if(qty !== null && qty !== MC_DETAIL_DEFAULTS.qty) parts.push('수량 ' + qty + '개');
    var disc = MC.toNum(raw.sellerDiscount);
    if(disc) parts.push('할인 ' + MC.fmtWon(disc));
    var pg = MC.toNum(raw.pgRate);
    if(pg) parts.push('별도 결제 수수료 ' + fmtRate(pg));
    if(raw.shippingFeeMode === MC.SHIP_FEE.SAME){
      parts.push('배송비 수수료 상품과 동일');
    } else if(raw.shippingFeeMode === MC.SHIP_FEE.SEPARATE){
      var sfr = MC.toNum(raw.shippingFeeRate);
      parts.push('배송비 수수료 ' + (sfr !== null ? fmtRate(sfr) : '별도 요율'));
    }
    if(raw.feeVat === MC.FEE_VAT.EXCLUDED) parts.push('수수료 부가세 별도');
    if(raw.feeBase === MC.FEE_BASE.BEFORE) parts.push('수수료 기준 할인 전');
    var other = MC.toNum(raw.otherCost);
    if(other) parts.push('기타 비용 ' + MC.fmtWon(other));
    return parts;
  }

  /* ---- 배송 조건(무료배송/고객 부담) — customerShipping 값을 감싸는 UI일 뿐,
     margin-calc.js에는 별도 필드로 넘기지 않는다. 라디오를 사용자가 직접
     "무료배송"으로 바꿀 때만 고객배송비를 0으로 만든다(명시적 조작) —
     모드 전환이나 값 동기화(mcWriteForm)만으로는 값을 바꾸지 않는다. */
  function mcSyncShipConditionFromValue(){
    var cs = MC.toNum(mcEls.customerShipping.value);
    var paid = cs !== null && cs > 0;
    mcSetRadio('mcShipCondition', paid ? 'paid' : 'free');
    byId('mcCustShipWrap').hidden = !paid;
  }

  /* ---- 광고비 칩(사용 안 함 / 6·10·20% / 직접 입력) ----------------------
     "직접 입력"을 고르면 비율(%) · 주문당 금액(원) 중 하나를 다시 고르게
     한다(요구사항 5) — mcState.adCustomKind가 그 선택을, mcState.adMode가
     margin-calc.js에 실제로 넘어가는 값('rate'|'amount'|'none')을 가진다. */
  function mcSyncAdUI(){
    var mode = mcState.adMode;
    var custom = mcState.adCustom;
    Array.prototype.forEach.call(mcRoot.querySelectorAll('#mcAdChips .mc-chip'), function(btn){
      var pr = btn.getAttribute('data-ad-preset');
      var md = btn.getAttribute('data-ad-mode');
      var active = false;
      if(pr !== null) active = (!custom && mode === 'rate' && MC.toNum(mcEls.adRate.value) === Number(pr));
      else if(md === 'custom') active = custom;
      else if(md === 'none') active = (mode === 'none' && !custom);
      btn.classList.toggle('active', active);
    });
    byId('mcAdCustomWrap').hidden = !custom;
    if(custom) mcSetRadio('mcAdCustomKind', mcState.adCustomKind);
    byId('mcAdRateWrap').hidden = !(custom && mcState.adCustomKind === 'rate');
    byId('mcAdAmountWrap').hidden = !(custom && mcState.adCustomKind === 'amount');
  }
  // 예시/저장 레코드를 불러올 때, 그 값의 adMode/adRate로부터 "프리셋인지
  // 직접입력인지"를 되짚어 UI 상태를 복원한다.
  function mcSyncAdStateFromValues(values){
    var mode = (values.adMode === 'rate' || values.adMode === 'amount') ? values.adMode : 'none';
    mcState.adMode = mode;
    if(mode === 'none'){
      mcState.adCustom = false;
    } else if(mode === 'amount'){
      mcState.adCustom = true;
      mcState.adCustomKind = 'amount';
    } else {
      var rate = MC.toNum(values.adRate);
      var isPreset = rate !== null && MC.AD_PRESETS.some(function(p){ return p.rate === rate; });
      mcState.adCustom = !isPreset;
      mcState.adCustomKind = 'rate';
    }
  }
  function mcSyncShipFeeUI(){
    byId('mcShipFeeRateWrap').hidden = mcRadio('mcShipFeeMode') !== MC.SHIP_FEE.SEPARATE;
  }
  function mcSyncTargetUI(){
    var hasVal = MC.toNum(mcEls.targetProfit.value) !== null;
    var open = mcState.targetOpen || hasVal;
    byId('mcTargetProfitWrap').hidden = !open;
    byId('mcTargetToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function fmtRate(n){
    if(n === null || n === undefined) return '';
    return (Math.round(n * 100) / 100) + '%';
  }

  /* 손익분기 ROAS 표시 문구 — margin-calc.js는 계산 불가/없음을 둘 다 null로
     반환하므로(구분하는 boolean을 따로 안 두고, 존재하는 값만으로 원인을
     되짚는다 — 요구사항: 계산할 수 없는 값을 위해 새 입력값/필드를 만들지
     않음), 화면에서만 두 원인을 구분한 문구를 고른다:
     - 총 수입(매출) 자체가 0원이라 계산 자체가 성립하지 않는 경우 → "계산할 수 없음"
     - 매출은 있지만 공헌이익이 0원 이하라 "이익 기준 손익분기점"이 없는 경우 → "없음" */
  function mcPreAdRatioText(r){
    return r.preAdRatio === null ? '계산할 수 없음' : MC.fmtPct(r.preAdRatio);
  }
  function mcBreakevenRoasText(r){
    if(r.breakevenRoas !== null) return MC.fmtPct(r.breakevenRoas);
    return r.totalIncome > 0 ? '없음' : '계산할 수 없음';
  }

  /* 손익분기 ROAS 결과 블록 — 광고 가이드의 "마진 계산기로 손익분기 ROAS
     확인하기" CTA가 그대로 이어지는 곳이라 details로 접지 않고 항상 보이는
     mc-result-facts 영역에 둔다(요구사항: 값을 숨기지 않음). 공헌이익이
     마이너스일 때만 손실 금액 · 계획된 적자 안내를 덧붙인다 — 광고를 금지하는
     문구는 쓰지 않는다. 기존 클래스(mc-result-facts/mc-fact-row/mc-res-room)만
     재사용하고 새 CSS는 추가하지 않는다. */
  function mcBreakevenHtml(input, r){
    var html = '';
    html += '<div class="mc-fact-row"><b>광고비 차감 전 공헌이익:</b> ' + MC.fmtWon(r.preAd) + '</div>';
    html += '<div class="mc-fact-row"><b>광고비 차감 전 공헌이익률:</b> ' + mcPreAdRatioText(r) + '</div>';
    html += '<div class="mc-fact-row"><b>손익분기 ROAS:</b> ' + mcBreakevenRoasText(r) + '</div>';
    if(r.breakevenRoas !== null){
      html += '<div class="mc-fact-row mc-fact-disclaimer">실제 ROAS가 이 기준보다 높아야 광고비를 낸 뒤 이익이 남아요. 세금 · 반품 · 고정비까지 고려하면 실제로 필요한 ROAS는 더 높아질 수 있어요 — 모든 상품에 적용되는 광고 합격선은 아니에요.</div>';
    }
    if(r.preAd < 0){
      html += '<div class="mc-res-room short mc-result-facts">';
      html += '<div class="mc-fact-row">현재 조건에서는 광고비를 쓰기 전부터 주문 1건당 ' + MC.fmtWon(Math.abs(r.preAd)) + ' 손실이 발생해요. 따라서 이 조건에는 이익 기준의 손익분기 ROAS가 없어요.</div>';
      html += '<div class="mc-res-row"><span>주문 1건당 광고 전 손실액</span><b>' + MC.fmtWon(r.preAd) + '</b></div>';
      if(r.postAd < 0){
        html += '<div class="mc-res-row"><span>광고비까지 포함한 최종 예상 손실액</span><b>' + MC.fmtWon(r.postAd) + '</b></div>';
      }
      if(input.qty > 1){
        html += '<div class="mc-fact-row">위 금액은 이 주문에 포함된 판매 수량 ' + input.qty + '개를 모두 반영한 주문 전체 기준이에요.</div>';
      }
      html += '<div class="mc-fact-row"><b>계획된 적자라면:</b> 런칭 · 행사 · 신규고객 확보를 위한 계획된 적자라면 진행할 수 있어요. 다만 총예산, 주문당 허용 손실, 종료 날짜를 먼저 정하세요.</div>';
      html += '</div>';
    }
    return html;
  }

  /* 계산 과정 — 결과 패널(잔액률·계산 과정 details)과 예시 카드가 같은
     HTML을 쓴다. 숫자는 전부 우리 계산 결과(사용자 입력을 문자열로 다시
     넣지 않음)라 escape 할 게 없다. */
  function mcBreakdownHtml(input, r){
    var row = function(label, value, cls){ return '<div class="mc-bd-row' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><span>' + value + '</span></div>'; };
    var vatNote = input.feeVat === MC.FEE_VAT.EXCLUDED ? ' × 1.1 (부가세 별도)' : ' (부가세 포함)';
    var feeBaseLabel = input.feeBase === MC.FEE_BASE.BEFORE ? '할인 전 상품금액' : '할인 후 상품 결제금액';
    var html = '';
    html += '<div class="mc-bd-sec"><b>수입</b>';
    html += row('판매가 ' + MC.fmtWon(input.price) + ' × ' + input.qty + '개', MC.fmtWon(r.grossBeforeDiscount));
    html += row('− 판매자 부담 할인', MC.fmtWon(input.sellerDiscount));
    html += row('= 상품 결제금액', MC.fmtWon(r.productAmount));
    html += row('+ 고객에게 받은 배송비', MC.fmtWon(input.customerShipping));
    html += row('= 총 수입', MC.fmtWon(r.totalIncome), 'total');
    html += '</div>';
    html += '<div class="mc-bd-sec"><b>비용</b>';
    html += row('상품 원가 ' + MC.fmtWon(input.unitCost) + ' × ' + input.qty + '개', MC.fmtWon(r.productCostTotal));
    html += row('실제 지출 배송비', MC.fmtWon(r.actualShipping));
    html += row('포장 · 부자재비', MC.fmtWon(r.packaging));
    html += row('상품 수수료: ' + feeBaseLabel + ' ' + MC.fmtWon(r.productFeeBase) + ' × ' + fmtRate(input.feeRate) + vatNote, MC.fmtWon(r.productFee));
    if(input.shippingFeeMode === MC.SHIP_FEE.NONE){
      html += row('배송비 수수료: 없음', MC.fmtWon(0));
    } else {
      html += row('배송비 수수료: 고객배송비 ' + MC.fmtWon(input.customerShipping) + ' × ' + fmtRate(r.shippingFeeRate) + vatNote, MC.fmtWon(r.shippingFee));
    }
    if(input.pgRate > 0){
      html += row('별도 PG 수수료: 결제 총액 ' + MC.fmtWon(r.totalIncome) + ' × ' + fmtRate(input.pgRate) + vatNote, MC.fmtWon(r.pgFee));
    } else {
      html += row('별도 PG 수수료: 없음(통합 수수료에 포함으로 간주)', MC.fmtWon(0));
    }
    html += row('기타 비용', MC.fmtWon(r.otherCost));
    html += row('= 비용 합계 (광고비 제외)', MC.fmtWon(r.productCostTotal + r.actualShipping + r.packaging + r.feeTotal + r.otherCost), 'total');
    html += '</div>';
    html += '<div class="mc-bd-sec"><b>남는 금액</b>';
    html += row('광고비 차감 전 예상 잔액(공헌이익) = 총 수입 − 비용 합계', MC.fmtWon(r.preAd));
    if(r.adMode === 'rate'){
      html += row('주문당 광고비 배분액 = 상품 결제금액 ' + MC.fmtWon(r.productAmount) + ' × ' + fmtRate(r.adRate), MC.fmtWon(r.adCost));
    } else if(r.adMode === 'amount'){
      html += row('주문당 광고비 (직접 입력)', MC.fmtWon(r.adCost));
    } else {
      html += row('주문당 광고비: 미반영', MC.fmtWon(0));
    }
    html += row('광고비 차감 후 예상 잔액', MC.fmtWon(r.postAd), 'total');
    html += row('총 수입 대비 예상 잔액률', r.ratio === null ? '계산 불가 (총 수입 0원)' : MC.fmtPct(r.ratio));
    html += row('광고비 차감 전 공헌이익률 = 공헌이익 ÷ 총 수입', mcPreAdRatioText(r));
    html += row('손익분기 ROAS = 100 ÷ 공헌이익률', mcBreakevenRoasText(r));
    html += '</div>';
    return html;
  }

  /* 결과 근처의 짧은 "무엇이 반영됐는지" 표시 — details로 숨기지 않는다
     (요구사항 4: 설명을 숨겨야만 제외 비용을 알 수 있는 구조를 피함).
     0원/미선택인 항목은 나열하지 않아 실제 입력 상태를 그대로 반영한다. */
  function mcResultFactsHtml(input, r){
    var parts = ['상품 원가 ' + MC.fmtWon(input.unitCost)];
    if(input.qty > 1) parts.push(input.qty + '개 주문');
    if(input.actualShipping > 0) parts.push('실제 배송비 ' + MC.fmtWon(input.actualShipping));
    if(input.packaging > 0) parts.push('포장비 ' + MC.fmtWon(input.packaging));
    parts.push('판매 수수료 ' + fmtRate(input.feeRate));
    if(input.sellerDiscount > 0) parts.push('할인 ' + MC.fmtWon(input.sellerDiscount));
    if(input.customerShipping > 0) parts.push('고객 배송비 ' + MC.fmtWon(input.customerShipping));
    if(input.shippingFeeMode !== MC.SHIP_FEE.NONE) parts.push('배송비 수수료 ' + fmtRate(r.shippingFeeRate));
    if(input.pgRate > 0) parts.push('별도 결제수수료 ' + fmtRate(input.pgRate));
    if(input.otherCost > 0) parts.push('기타 비용 ' + MC.fmtWon(input.otherCost));
    var adLine = r.adMode === 'none'
      ? '광고비 미반영'
      : '광고비 ' + (r.adMode === 'rate' ? fmtRate(r.adRate) : MC.fmtWon(r.adCost)) + ' 반영 · 광고비까지 뺀 금액이에요';
    return '<div class="mc-fact-row"><b>반영:</b> ' + escapeHtml(parts.join(' · ')) + '</div>' +
      '<div class="mc-fact-row">' + escapeHtml(adLine) + '</div>' +
      '<div class="mc-fact-row mc-fact-disclaimer">부가세 납부액 · 소득세 · 미입력 고정비 반영 전 금액이에요</div>';
  }

  function mcRender(){
    if(!mcEls) return;
    var raw = mcReadForm();
    var calc = MC.calculate(raw);
    mcState.lastCalc = calc;
    var showErrors = mcState.touched && !calc.ok;

    // 필드별 오류 문구 + 테두리
    Array.prototype.forEach.call(mcRoot.querySelectorAll('[data-mc-err]'), function(el){
      var key = el.getAttribute('data-mc-err');
      var msg = showErrors ? (calc.errors[key] || '') : '';
      el.textContent = msg;
      var wrap = el.closest('.mc-field');
      if(wrap) wrap.classList.toggle('mc-invalid', !!msg);
    });
    var errorsEl = byId('mcErrors');
    if(showErrors){
      var msgs = [];
      Object.keys(calc.errors).forEach(function(k){ if(msgs.indexOf(calc.errors[k]) === -1) msgs.push(calc.errors[k]); });
      errorsEl.innerHTML = '입력을 확인해주세요<ul>' + msgs.map(function(m){ return '<li>' + escapeHtml(m) + '</li>'; }).join('') + '</ul>';
      errorsEl.hidden = false;
    } else {
      errorsEl.hidden = true;
    }

    byId('mcResultEmpty').hidden = calc.ok || showErrors;
    byId('mcResultWrap').hidden = !calc.ok;

    if(calc.ok){
      var r = calc.result;
      // 가장 중요한 결과 먼저 — "약 ○○원이 남아요" / 적자면 그 문장으로 대체
      var heroVal = byId('mcResPostAdHero');
      if(r.isDeficit){
        heroVal.textContent = '한 주문당 약 ' + MC.fmtWon(Math.abs(r.postAd)) + ' 적자가 예상돼요';
      } else {
        heroVal.textContent = '약 ' + MC.fmtWon(r.postAd) + '이 남아요';
      }
      var hero = byId('mcResultHero');
      hero.classList.toggle('deficit', r.isDeficit);
      hero.classList.toggle('zero', !r.isDeficit && r.postAd === 0);
      byId('mcResultHeroSub').textContent = r.adMode === 'none' ? '광고비는 반영하지 않았어요' : '광고비까지 뺀 금액이에요';

      byId('mcResultFacts').innerHTML = mcResultFactsHtml(calc.input, r);
      byId('mcResultBreakeven').innerHTML = mcBreakevenHtml(calc.input, r);

      byId('mcResIncome').textContent = MC.fmtWon(r.totalIncome);
      byId('mcResPreAd').textContent = MC.fmtWon(r.preAd);
      var adText = r.adMode === 'none' ? '미반영 (0원)' : MC.fmtWon(r.adCost) + (r.adMode === 'rate' ? ' · ' + fmtRate(r.adRate) : '');
      byId('mcResAdCost').textContent = adText;
      byId('mcResRatio').textContent = MC.fmtPct(r.ratio);

      var roomEl = byId('mcResRoom');
      if(r.targetProfit !== null){
        roomEl.hidden = false;
        if(r.adRoom >= 0){
          roomEl.className = 'mc-res-room';
          roomEl.textContent = '남기고 싶은 금액 ' + MC.fmtWon(r.targetProfit) + '을 지키려면 주문당 광고비는 최대 ' + MC.fmtWon(r.adRoom) + '까지예요 (광고비 차감 전 예상 잔액 − 목표 금액). 이 광고비로 실제 주문이 들어온다는 보장은 아니에요.';
        } else {
          roomEl.className = 'mc-res-room short';
          roomEl.textContent = '광고비를 쓰기 전에도 목표보다 ' + MC.fmtWon(-r.adRoom) + ' 부족해요 — 이 입력값으로는 주문당 ' + MC.fmtWon(r.targetProfit) + '을 남길 수 없어요. 판매가나 비용을 먼저 조정해보세요.';
        }
      } else {
        roomEl.hidden = true;
      }
      byId('mcBreakdownBody').innerHTML = mcBreakdownHtml(calc.input, r);
    }

    // plans.js가 이미 열린 계획 폼과 "지금 계산"이 달라졌는지 알 수 있게
    // 하는 신호. 계산 로직은 이 이벤트와 무관하게 그대로다 — 듣는 쪽이
    // 없어도(plans.js 미로딩 등) 아무 영향 없다.
    document.dispatchEvent(new CustomEvent('launchdesk:margin-calc-changed'));

    // 저장 버튼 — 예시 모드에서는 "결과 저장" 대신 "이 예시를 수정해서 내
    // 상품 계산하기"가 주요 행동이 된다(예시는 자동 저장 금지 · 내 기록과 분리).
    var saveBtn = byId('toolsSaveCalc');
    var planBtn = byId('mcPlanOpen'); // 주 행동: "이 조건으로 계획 만들기"(plans.js가 클릭을 처리)
    var adoptBtn = byId('mcExampleAdopt');
    var hint = byId('mcSaveHint');
    if(mcState.exampleKey !== null){
      // 예시 모드에서는 계획도 계산 기록도 만들 수 없다(예시는 내 기록과 분리)
      saveBtn.hidden = true;
      if(planBtn) planBtn.hidden = true;
      adoptBtn.hidden = false;
      hint.hidden = true;
    } else {
      adoptBtn.hidden = true;
      saveBtn.hidden = false;
      if(planBtn) planBtn.hidden = false;
      if(!calc.ok){
        saveBtn.disabled = true;
        if(planBtn) planBtn.disabled = true;
        hint.textContent = '필수 입력을 채우면 계획을 만들거나 저장할 수 있어요.';
        hint.hidden = false;
      } else {
        saveBtn.disabled = false;
        if(planBtn) planBtn.disabled = false;
        hint.hidden = true;
      }
    }
  }

  /* ---- 예시 모드 — 사용자 입력을 스냅샷으로 보관하고, 나갈 때 그대로 복원 ---- */
  function mcRenderExamples(){
    var grid = byId('mcExampleGrid');
    if(!grid) return;
    grid.innerHTML = MC.EXAMPLES.map(function(ex){
      var calc = MC.calculate(ex.input);
      var r = calc.result;
      var costTotal = r.productCostTotal + r.actualShipping + r.packaging + r.feeTotal + r.otherCost + r.adCost;
      return '<div class="mc-example-card">' +
        '<h4>' + escapeHtml(ex.title) + '</h4>' +
        '<div class="mc-ex-summary">' + escapeHtml(ex.summary) + '</div>' +
        '<div class="mc-ex-nums">' +
          '<span>총 수입</span><b>' + MC.fmtWon(r.totalIncome) + '</b>' +
          '<span>비용 합계 (광고비 포함)</span><b>' + MC.fmtWon(costTotal) + '</b>' +
          '<span class="mc-ex-total">광고비 차감 후 예상 잔액</span><b>' + MC.fmtWon(r.postAd) + '</b>' +
        '</div>' +
        '<details><summary>계산 과정 펼쳐보기</summary>' +
          '<div class="mc-ex-note">' + escapeHtml(ex.note) + '</div>' +
          '<div class="mc-breakdown-body" style="border-top:none; padding:0;">' + mcBreakdownHtml(calc.input, r) + '</div>' +
        '</details>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-mc-example="' + escapeHtml(ex.key) + '">이 예시로 보기</button>' +
      '</div>';
    }).join('');
  }
  function mcEnterExample(key){
    var ex = MC.EXAMPLES.filter(function(e){ return e.key === key; })[0];
    if(!ex) return;
    if(mcState.exampleKey === null) mcState.userSnapshot = mcReadForm(); // 사용자 입력은 여기 보관
    mcState.exampleKey = key;
    mcState.touched = true;
    mcWriteForm(ex.input);
    byId('mcExampleBannerTitle').textContent = ex.title;
    byId('mcExampleBanner').hidden = false;
    mcRender();
    var banner = byId('mcExampleBanner');
    if(banner && banner.scrollIntoView) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function mcExitExample(){
    if(mcState.exampleKey === null) return;
    mcState.exampleKey = null;
    if(mcState.userSnapshot) mcWriteForm(mcState.userSnapshot);
    mcState.userSnapshot = null;
    byId('mcExampleBanner').hidden = true;
    mcRender();
  }
  function mcAdoptExample(){
    if(mcState.exampleKey === null) return;
    var snap = mcState.userSnapshot;
    if(snap && mcHasUserValues(snap) &&
       !window.confirm('예시 값을 내 계산으로 가져오면, 예시를 열기 전에 입력했던 값은 사라져요. 계속할까요?')) return;
    mcState.exampleKey = null;
    mcState.userSnapshot = null;
    byId('mcExampleBanner').hidden = true;
    mcRender();
    showToast('예시 값으로 내 계산을 시작했어요 — 실제 값으로 바꿔가며 확인하세요');
  }

  /* ---- 플랫폼별 수수료 안내 — 요율 자동 입력 없음, 안내만 ---- */
  function mcRenderPlatformGuide(){
    var box = byId('mcPlatformGuide');
    if(!box) return;
    var g = MC.PLATFORM_GUIDE[mcEls.platform.value];
    if(!g){ box.hidden = true; box.innerHTML = ''; return; }
    var list = function(items){ return '<ul>' + items.map(function(t){ return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul>'; };
    var rateHtml;
    if(g.rates && g.verifiedAt){
      rateHtml = '<div class="mc-guide-rate">' + escapeHtml(g.rates) + '</div><div class="mc-guide-meta">확인일: ' + escapeHtml(g.verifiedAt) + ' — 이후 바뀌었을 수 있으니 판매자센터에서 다시 확인하세요.</div>';
    } else {
      rateHtml = '<div class="mc-guide-rate">요율은 <b>판매자센터 · 계약에서 확인한 뒤 위 칸에 직접 입력</b>해주세요. LaunchDesk가 최신 공식 요율을 직접 확인하지 못해 여기서는 숫자를 제시하지 않아요.</div><div class="mc-guide-meta">확인일: 미확인 (LaunchDesk가 검증한 요율 없음)</div>';
    }
    var linksHtml = g.links.length
      ? '<div class="mc-guide-links">' + g.links.map(function(l){ return '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(l.label) + ' ↗</a>'; }).join('') + '</div>'
      : '';
    box.innerHTML =
      '<div class="mc-guide-title">' + escapeHtml(g.name) + ' — 수수료 확인 포인트</div>' +
      '<div class="mc-guide-sec"><b>수수료 구성</b>' + list(g.composition) + '</div>' +
      '<div class="mc-guide-sec"><b>요율이 달라지는 조건</b>' + list(g.conditions) + '</div>' +
      '<div class="mc-guide-sec"><b>입력 전 확인할 것</b>' + list(g.checks) + '</div>' +
      rateHtml + linksHtml;
    box.hidden = false;
  }

  /* ---- 저장 · 불러오기 ---- */
  function mcNowLabel(){
    var now = new Date();
    return (now.getMonth() + 1) + '.' + now.getDate() + '. ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
  }
  function mcBuildRecord(calc){
    var r = calc.result;
    return {
      calc_version: MC.CALC_VERSION,
      date: mcNowLabel(),
      saved_at: new Date().toISOString(),
      platform: mcEls.platform.value || null,
      input: calc.input,
      result: {
        totalIncome: r.totalIncome, productFee: r.productFee, shippingFee: r.shippingFee, pgFee: r.pgFee,
        feeTotal: r.feeTotal, preAd: r.preAd, adMode: r.adMode, adRate: r.adRate, adCost: r.adCost,
        postAd: r.postAd, ratio: r.ratio
      }
    };
  }
  function getSavedCalcs(){
    return window.launchdeskStore ? window.launchdeskStore.getCalcHistory() : [];
  }
  function renderSavedCalcs(){
    var list = byId('savedCalcList');
    if(!list) return;
    var items = getSavedCalcs();
    if(!items.length){
      list.innerHTML = '<div class="empty-state" style="padding:1.6rem 1rem;"><p style="margin:0;">아직 저장한 계산이 없어요.</p></div>';
      return;
    }
    var rows = items.map(function(it, idx){
      if(it && it.calc_version === 2 && it.input && it.result){
        var qty = it.input.qty || 1;
        var ratioText = (it.result.ratio === null || it.result.ratio === undefined) ? '비율 계산 불가' : '잔액률 ' + MC.fmtPct(it.result.ratio);
        return '<div class="saved-calc-row">' +
          '<div><div>판매가 ' + MC.fmtWon(it.input.price) + ' × ' + qty + ' · ' + ratioText + '</div>' +
          '<div class="scr-date">' + escapeHtml(it.date || '') + ' · 광고비 ' + (it.result.adMode === 'none' ? '미반영' : MC.fmtWon(it.result.adCost)) + '</div></div>' +
          '<div style="display:flex; align-items:center; gap:.6rem;"><span class="scr-amount">' + MC.fmtWon(it.result.postAd) + '</span>' +
          '<button type="button" class="scr-load" data-load-idx="' + idx + '">불러오기</button></div>' +
        '</div>';
      }
      // v1(옛 사이드바 계산기) — 계산 방식이 달라 그대로 불러올 수 없으므로 표시만
      var price = MC.toNum(it && it.price), profit = MC.toNum(it && it.profit), pct = MC.toNum(it && it.marginPct);
      return '<div class="saved-calc-row" title="이전 사이드바 계산기(판매가 − 원가 − 배송비 − 판매가×수수료)로 저장된 기록이에요. 지금 계산기와 방식이 달라 불러오기는 지원하지 않아요.">' +
        '<div><div><span class="scr-tag">이전 계산 방식</span>판매가 ' + MC.fmtWon(price) + (pct === null ? '' : ' · 마진 ' + MC.fmtPct(pct)) + '</div>' +
        '<div class="scr-date">' + escapeHtml((it && it.date) || '') + '</div></div>' +
        '<span class="scr-amount">' + MC.fmtWon(profit) + '</span>' +
      '</div>';
    }).join('');
    list.innerHTML = rows + '<button type="button" class="saved-calc-clear" id="savedCalcClear">전체 지우기</button>';
    var clearBtn = byId('savedCalcClear');
    if(clearBtn) clearBtn.addEventListener('click', function(){
      if(!window.confirm('저장한 계산 기록을 전부 지울까요? 되돌릴 수 없어요.')) return;
      if(window.launchdeskStore) window.launchdeskStore.clearCalcHistory();
      renderSavedCalcs();
    });
    Array.prototype.forEach.call(list.querySelectorAll('.scr-load'), function(btn){
      btn.addEventListener('click', function(){
        var it = getSavedCalcs()[Number(btn.getAttribute('data-load-idx'))];
        if(!it || !it.input) return;
        mcLoadRecord(it);
      });
    });
  }
  // 반환값: 실제로 불러왔으면 true, 사용자가 덮어쓰기를 취소했으면 false.
  // (plans.js의 "계산기로 열기"도 이 함수를 그대로 쓴다 — 넘겨받은 객체는
  // 사본이라 여기서 값을 바꿔도 원래 계획 스냅샷은 바뀌지 않는다.)
  function mcLoadRecord(it, toastMessage){
    if(!mcEls) return false;
    var current = mcState.exampleKey !== null ? mcState.userSnapshot : mcReadForm();
    if(current && mcHasUserValues(current) &&
       !window.confirm('지금 입력한 값이 저장 기록의 값으로 바뀌어요. 계속할까요?')) return false;
    // 예시 모드였다면 예시를 닫는다(불러온 기록이 곧 "내 계산"이 된다)
    mcState.exampleKey = null;
    mcState.userSnapshot = null;
    byId('mcExampleBanner').hidden = true;
    var values = Object.assign({}, it.input, { platform: it.platform || '' });
    mcWriteForm(values);
    mcState.touched = true;
    mcRender();
    showToast(toastMessage || '저장한 계산을 불러왔어요');
    return true;
  }

  if(MC && mcRoot){
    mcEls = {
      price: byId('mcPrice'), qty: byId('mcQty'), unitCost: byId('mcUnitCost'), sellerDiscount: byId('mcDiscount'),
      customerShipping: byId('mcCustShip'), actualShipping: byId('mcActualShip'), packaging: byId('mcPackaging'),
      otherCost: byId('mcOtherCost'), feeRate: byId('mcFeeRate'), pgRate: byId('mcPgRate'),
      shippingFeeRate: byId('mcShipFeeRate'), adRate: byId('mcAdRate'), adAmount: byId('mcAdAmount'),
      targetProfit: byId('mcTargetProfit'), platform: byId('mcPlatform')
    };

    MC_NUMERIC_FIELDS.forEach(function(k){
      mcEls[k].addEventListener('input', function(){
        mcState.touched = true;
        mcRender();
      });
    });
    Array.prototype.forEach.call(mcRoot.querySelectorAll('input[name="mcFeeBase"], input[name="mcFeeVat"], input[name="mcShipFeeMode"]'), function(r){
      r.addEventListener('change', function(){
        mcState.touched = true;
        mcSyncShipFeeUI();
        if(r.name === 'mcShipFeeMode' && r.value === MC.SHIP_FEE.SEPARATE && r.checked) mcEls.shippingFeeRate.focus();
        mcRender();
      });
    });
    mcEls.platform.addEventListener('change', mcRenderPlatformGuide); // 입력값은 건드리지 않는다

    // 배송 조건 — "무료배송"을 직접 고를 때만 고객배송비를 0으로 만든다.
    Array.prototype.forEach.call(mcRoot.querySelectorAll('input[name="mcShipCondition"]'), function(r){
      r.addEventListener('change', function(){
        if(!r.checked) return;
        mcState.touched = true;
        if(r.value === 'free') mcEls.customerShipping.value = '0';
        byId('mcCustShipWrap').hidden = (r.value !== 'paid');
        if(r.value === 'paid') mcEls.customerShipping.focus();
        mcRender();
      });
    });

    // 간편/상세 모드 전환 — 상단 탭, "추가 조건까지 입력하기", "수정하기" 전부 같은 스위치.
    document.addEventListener('click', function(e){
      var btn = e.target.closest('[data-mc-mode-btn]');
      if(btn && mcRoot.contains(btn)) mcSetMode(btn.getAttribute('data-mc-mode-btn'));
    });

    // 예시 목록 접기/펼치기
    byId('mcExampleToggle').addEventListener('click', function(){
      var panel = byId('mcExamplesPanel');
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      byId('mcExampleToggle').setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      byId('mcExampleToggle').querySelector('span').textContent = willOpen ? '예시 접기' : '예시로 해보기';
    });

    // "내 수수료 확인 방법" — 플랫폼 선택 + 안내 패널을 펼친다(요율 자동입력 없음)
    byId('mcFeeHelpToggle').addEventListener('click', function(){
      var panel = byId('mcPlatformPanel');
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      byId('mcFeeHelpToggle').setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      byId('mcFeeHelpToggle').textContent = willOpen ? '확인 방법 닫기' : '내 수수료 확인 방법';
    });

    // 광고비 칩
    byId('mcAdChips').addEventListener('click', function(e){
      var btn = e.target.closest('.mc-chip');
      if(!btn) return;
      var preset = btn.getAttribute('data-ad-preset');
      var mode = btn.getAttribute('data-ad-mode');
      mcState.touched = true;
      if(preset !== null){
        mcState.adMode = 'rate';
        mcState.adCustom = false;
        mcEls.adRate.value = preset;
      } else if(mode === 'custom'){
        mcState.adCustom = true;
        mcState.adMode = mcState.adCustomKind;
        if(mcState.adCustomKind === 'rate'){
          var cur = MC.toNum(mcEls.adRate.value);
          if(cur !== null && MC.AD_PRESETS.some(function(p){ return p.rate === cur; })) mcEls.adRate.value = '';
        }
      } else {
        mcState.adMode = 'none';
        mcState.adCustom = false;
      }
      mcSyncAdUI();
      mcRender();
      if(mode === 'custom') (mcState.adCustomKind === 'rate' ? mcEls.adRate : mcEls.adAmount).focus();
    });
    // 직접 입력: 비율 vs 금액
    Array.prototype.forEach.call(mcRoot.querySelectorAll('input[name="mcAdCustomKind"]'), function(r){
      r.addEventListener('change', function(){
        if(!r.checked) return;
        mcState.touched = true;
        mcState.adCustomKind = r.value;
        mcState.adMode = r.value;
        mcSyncAdUI();
        mcRender();
        (r.value === 'rate' ? mcEls.adRate : mcEls.adAmount).focus();
      });
    });

    // "목표 금액에 맞춰 광고비 계산하기"
    byId('mcTargetToggle').addEventListener('click', function(){
      mcState.targetOpen = !mcState.targetOpen;
      mcSyncTargetUI();
      if(!byId('mcTargetProfitWrap').hidden) mcEls.targetProfit.focus();
    });

    byId('mcExampleGrid').addEventListener('click', function(e){
      var btn = e.target.closest('[data-mc-example]');
      if(btn) mcEnterExample(btn.getAttribute('data-mc-example'));
    });
    byId('mcExampleExit').addEventListener('click', mcExitExample);
    byId('mcExampleAdopt').addEventListener('click', mcAdoptExample);

    byId('toolsSaveCalc').addEventListener('click', function(){
      if(mcState.exampleKey !== null){ showToast('예시 값은 저장되지 않아요'); return; }
      mcState.touched = true;
      var calc = MC.calculate(mcReadForm());
      if(!calc.ok){ mcRender(); showToast('필수 입력을 먼저 채워주세요'); return; }
      if(window.launchdeskStore) window.launchdeskStore.addCalcRecord(mcBuildRecord(calc));
      renderSavedCalcs();
      showToast('계산 결과를 저장했어요', 'success');
      /* GA4 margin_calculator_use — only reaches here once a save actually
         happened. No price/cost/fee/result here on purpose — those are
         business-sensitive figures, not needed just to know the tool got used. */
      if(typeof gtag === 'function'){
        gtag('event', 'margin_calculator_use', {
          tool_name: 'tools_margin_calculator'
        });
      }
    });

    /* "마진 계산기" 링크(홈 · 챕터03 등의 data-tools-target="calc")로 들어오면
       #/tools로 이동한다. 2026-09 정보구조 정리(3차) 이후 /tools는 이 계산기
       화면 자체라 탭 활성화가 필요 없다 — hashchange 시 화면 전환·스크롤은
       app.js render()가 항상 처리하므로, 이미 /tools에 있을 때(hashchange가
       일어나지 않는 경우)만 이 자리에서 스크롤을 올려준다. */
    function onToolsRoute(){ return (location.hash.replace(/^#/, '') || '/') === '/tools'; }
    document.addEventListener('click', function(e){
      var a = e.target.closest('a[data-tools-target="calc"]');
      if(a && onToolsRoute()) window.scrollTo(0, 0);
    });
    function mcGoToCalc(){
      if(onToolsRoute()) window.scrollTo(0, 0);
      else location.hash = '#/tools';
    }

    /* plans.js(계획 만들기 · 계산기로 열기)가 쓰는 최소 진입점. 계산 로직·
       저장 로직은 전혀 바뀌지 않고, 이미 있는 함수(mcBuildRecord/
       mcLoadRecord/화면 이동)를 그대로 노출만 한다.
       - buildCurrentRecord(): 지금 입력으로 유효한 계산이 있으면 v2 저장
         레코드(새 객체)를 돌려준다. 예시 모드/미계산/오류면 null — 그 상태에서는
         계획을 만들 수 없다. */
    window.launchdeskMarginCalcUI = {
      buildCurrentRecord: function(){
        if(!mcEls || mcState.exampleKey !== null) return null;
        var calc = MC.calculate(mcReadForm());
        if(!calc.ok) return null;
        return mcBuildRecord(calc);
      },
      // 계획 스냅샷을 계산기에 불러오고 계산기 탭으로 이동한다. 현재 입력
      // 덮어쓰기 확인(mcLoadRecord)에서 취소하면 false.
      openRecord: function(record){
        if(!record || !record.input) return false;
        if(!mcLoadRecord(record, '계획의 계산 조건을 불러왔어요')) return false;
        mcGoToCalc();
        return true;
      },
      goToCalc: mcGoToCalc
    };

    mcRenderExamples();
    mcSyncShipConditionFromValue();
    mcSyncAdUI();
    mcSyncShipFeeUI();
    mcSyncTargetUI();
    mcApplyModeVisibility();
    mcRenderPlatformGuide();
    mcRender();
  }
  renderSavedCalcs();


  /* promo banner countdown — real target (next Sunday 00:00 local time),
     not a random fake number — removed for now since the top banner no
     longer claims a purchase/discount, only that the preview is free. */

  /* 수익 시뮬레이터(예전 /tools "🧮 수익 시뮬레이터" 탭)는 2026-09
     정보구조 정리(3차)로 베타 화면·메뉴에서 제거했다. 이 기능은 애초에
     아무것도 저장하지 않고 매 입력마다 즉석에서 계산만 하던 순수 프론트
     로직이라(#simQty 등 DOM과 함께 있어야만 동작), DOM이 없어지면서 이
     블록도 함께 지웠다 — DB에 지울 데이터가 없고, 다른 기능이 이 코드를
     참조하지 않는다(margin-calc.js/계산기와는 완전히 별개 로직이었다).
     "목표 수익 역산 도구"로 다시 만들 때는 이 커밋 이전 히스토리에서
     계산식(손익분기점 = 광고비 ÷ 개당 판매가-원가 마진, 30·60·100%
     3단계 로드맵)을 참고하면 된다. */

  /* 광고 기록 — 비회원은 launchdeskStore 메모리에만(새로고침하면 사라짐),
     회원은 Supabase(tool_records, tool_type='ad_log')에도 반영된다. 각
     레코드의 id(Date.now())는 store가 DB에 저장할 때 data 안에 그대로
     함께 넣어두므로, 삭제도 같은 id로 요청하면 된다(store 내부 구현). */
  var adlogTbody = document.getElementById('adlogTbody');
  function getAdlogRecords(){
    return window.launchdeskStore ? window.launchdeskStore.getAdlogRecords() : [];
  }
  window.deleteAdlogRecord = function(id){
    if(window.launchdeskStore) window.launchdeskStore.removeAdlogRecord(id);
    renderAdlog();
  };
  var roasClass = function(roas){
    if(roas >= 4) return 'roas-good';
    if(roas >= 2) return 'roas-mid';
    return 'roas-low';
  };
  function renderAdlog(){
    if(!adlogTbody) return;
    var list = getAdlogRecords();
    if(!list.length){
      adlogTbody.innerHTML = '<tr><td colspan="7"><div class="adlog-empty">아직 기록이 없어요 — "+ 기록 추가"로 첫 광고 성과를 남겨보세요.</div></td></tr>';
    } else {
      adlogTbody.innerHTML = list.map(function(r){
        var roas = r.spend > 0 ? (r.revenue / r.spend) : 0;
        var chanColor = {메타:'var(--badge-a)', 네이버:'var(--badge-c)', 카카오:'var(--badge-b)', 인스타:'var(--badge-d)'}[r.channel] || 'var(--ink-faint)';
        return '<tr>' +
          '<td>' + r.date + '</td>' +
          '<td><span class="adlog-channel" style="background:' + chanColor + '">' + r.channel + '</span></td>' +
          '<td>' + r.name + '</td>' +
          '<td class="num">₩' + Math.round(r.spend).toLocaleString('ko-KR') + '</td>' +
          '<td class="num">₩' + Math.round(r.revenue).toLocaleString('ko-KR') + '</td>' +
          '<td class="num ' + roasClass(roas) + '">' + roas.toFixed(1) + 'x</td>' +
          '<td><button type="button" class="adlog-del" data-id="' + r.id + '">✕</button></td>' +
        '</tr>';
      }).join('');
    }
    var totalSpend = list.reduce(function(s, r){ return s + r.spend; }, 0);
    var totalRevenue = list.reduce(function(s, r){ return s + r.revenue; }, 0);
    var avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    var best = list.slice().sort(function(a, b){
      var ra = a.spend > 0 ? a.revenue / a.spend : 0;
      var rb = b.spend > 0 ? b.revenue / b.spend : 0;
      return rb - ra;
    })[0];
    document.getElementById('adlogSumSpend').textContent = '₩' + Math.round(totalSpend).toLocaleString('ko-KR');
    document.getElementById('adlogSumRoas').textContent = avgRoas.toFixed(1) + 'x';
    document.getElementById('adlogSumBest').textContent = best ? best.name : '—';
  }
  if(adlogTbody){
    document.getElementById('adlogForm').addEventListener('submit', function(e){
      e.preventDefault();
      var channelBtn = document.querySelector('.adlog-chan-btn.active');
      var record = {
        id: Date.now(),
        date: document.getElementById('adlogDate').value,
        name: document.getElementById('adlogName').value,
        spend: parseFloat(document.getElementById('adlogSpend').value) || 0,
        revenue: parseFloat(document.getElementById('adlogRevenue').value) || 0,
        channel: channelBtn ? channelBtn.getAttribute('data-channel') : '메타'
      };
      if(window.launchdeskStore) window.launchdeskStore.addAdlogRecord(record);
      renderAdlog();
      e.target.reset();
      document.getElementById('adlogFormWrap').hidden = true;
      showToast('광고 기록이 저장됐어요', 'success');
      /* GA4 ad_record_add — fires right after the record above actually
         persisted. No date/name/spend/revenue/channel here on purpose —
         those are the seller's own business numbers, not needed just to
         know the tool got used. */
      if(typeof gtag === 'function'){
        gtag('event', 'ad_record_add', {
          tool_name: 'ad_log'
        });
      }
    });
    renderAdlog();
  }

  /* launchdeskStore가 로그인/로그아웃으로 데이터를 다시 채우거나 비울 때
     (hydrate/resetToGuest) 이 페이지도 다시 그린다 — 로그인 직후 계정의
     저장된 기록으로 바뀌거나, 로그아웃 직후 화면이 즉시 비회원 상태(빈
     목록)로 초기화되도록. 저장 기록만 다시 그리고, 지금 입력 중인 계산기
     값은 건드리지 않는다. */
  if(window.launchdeskStore){
    window.launchdeskStore.onChange(function(){
      renderSavedCalcs();
      renderAdlog();
    });
  }
})();
