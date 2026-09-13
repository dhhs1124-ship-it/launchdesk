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

  /* /tools margin calculator — the one real, working part of the
     dashboard. Everything else on that page (KPIs, charts, order
     list) is static example markup, clearly labeled as such. */
  var toolsGaugeArc = document.getElementById('toolsGaugeArc');
  function updateGauge(pct){
    if(!toolsGaugeArc) return 'good';
    var clamped = Math.max(0, Math.min(100, pct));
    var arcLen = 188.5;
    toolsGaugeArc.setAttribute('stroke-dasharray', (clamped/100*arcLen).toFixed(1) + ' ' + arcLen);
    var tier = clamped >= 30 ? 'good' : (clamped >= 15 ? 'mid' : 'low');
    toolsGaugeArc.style.stroke = tier === 'good' ? 'var(--badge-c)' : (tier === 'mid' ? 'var(--badge-b)' : 'var(--badge-a)');
    return tier;
  }
  function computeToolsCalc(){
    var costEl = document.getElementById('toolsCost');
    if(!costEl) return null;
    var cost = parseFloat(costEl.value) || 0;
    var price = parseFloat(document.getElementById('toolsPrice').value) || 0;
    var fee = parseFloat(document.getElementById('toolsFee').value) || 0;
    var ship = parseFloat(document.getElementById('toolsShip').value) || 0;
    var valueEl = document.getElementById('toolsGaugeValue');
    var subEl = document.getElementById('toolsGaugeSub');
    var tagEl = document.getElementById('toolsGaugeTag');
    if(!price || price <= 0){
      valueEl.textContent = '—';
      subEl.textContent = '판매가를 입력해주세요';
      tagEl.hidden = true;
      updateGauge(0);
      return null;
    }
    var feeAmount = price * (fee / 100);
    var profit = price - cost - ship - feeAmount;
    var marginPct = (profit / price) * 100;
    var tier = updateGauge(marginPct);
    valueEl.textContent = marginPct.toFixed(1) + '%';
    subEl.textContent = '순이익 ' + Math.round(profit).toLocaleString('ko-KR') + '원';
    tagEl.hidden = false;
    tagEl.className = 'gauge-tag ' + tier;
    tagEl.textContent = tier === 'good' ? '✅ 권장 마진(30%) 달성' : (tier === 'mid' ? '표준 마진 구간' : '⚠️ 마진이 낮아요');
    return {cost: cost, price: price, fee: fee, ship: ship, profit: Math.round(profit), marginPct: marginPct};
  }
  ['toolsCost', 'toolsPrice', 'toolsFee', 'toolsShip'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('input', computeToolsCalc);
  });
  computeToolsCalc();

  /* saved calculations — 비회원은 launchdeskStore의 메모리에만(새로고침하면
     사라짐), 회원은 Supabase(tool_records, tool_type='margin_calc')에도
     반영된다 — 어느 쪽이든 window.launchdeskStore가 알아서 나눠 처리하므로
     이 파일은 회원/비회원을 직접 구분하지 않는다. 화면엔 항상 최근 5개만. */
  function getSavedCalcs(){
    return window.launchdeskStore ? window.launchdeskStore.getCalcHistory() : [];
  }
  function renderSavedCalcs(){
    var list = document.getElementById('savedCalcList');
    if(!list) return;
    var items = getSavedCalcs();
    if(!items.length){
      list.innerHTML = '<div class="empty-state" style="padding:1.6rem 1rem;"><p style="margin:0;">아직 저장한 계산이 없어요.</p></div>';
      return;
    }
    var rows = items.map(function(it){
      return '<div class="saved-calc-row"><div><div>판매가 ' + it.price.toLocaleString('ko-KR') + '원 · 마진 ' + it.marginPct.toFixed(1) + '%</div><div class="scr-date">' + it.date + '</div></div>' +
        '<div style="font-family:var(--f-mono); font-weight:700;">' + it.profit.toLocaleString('ko-KR') + '원</div></div>';
    }).join('');
    list.innerHTML = rows + '<button type="button" class="saved-calc-clear" id="savedCalcClear">전체 지우기</button>';
    var clearBtn = document.getElementById('savedCalcClear');
    if(clearBtn) clearBtn.addEventListener('click', function(){
      if(window.launchdeskStore) window.launchdeskStore.clearCalcHistory();
      renderSavedCalcs();
    });
  }
  var toolsSaveBtn = document.getElementById('toolsSaveCalc');
  if(toolsSaveBtn){
    toolsSaveBtn.addEventListener('click', function(){
      var result = computeToolsCalc();
      if(!result){ showToast('판매가를 먼저 입력해주세요'); return; }
      var now = new Date();
      result.date = (now.getMonth() + 1) + '.' + now.getDate() + '. ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
      if(window.launchdeskStore) window.launchdeskStore.addCalcRecord(result);
      renderSavedCalcs();
      showToast('계산 결과를 저장했어요', 'success');
      /* GA4 margin_calculator_use — only reaches here once a save actually
         happened (the empty-price early-return above already stopped
         anything else). No cost/price/profit here on purpose — those are
         business-sensitive figures, not needed just to know the tool got used. */
      if(typeof gtag === 'function'){
        gtag('event', 'margin_calculator_use', {
          tool_name: 'tools_margin_calculator'
        });
      }
    });
  }
  renderSavedCalcs();

  /* promo banner countdown — real target (next Sunday 00:00 local time),
     not a random fake number — removed for now since the top banner no
     longer claims a purchase/discount, only that the preview is free. */

  /* 수익 시뮬레이터 — genuinely computed from the 4 inputs, not fake.
     손익분기점 = 광고비를 회수하는 데 필요한 판매량
     (광고비 ÷ 개당 판매가-원가 마진), 로드맵은 목표 판매량/광고비의
     30%·60%·100% 지점으로 3단계를 나눈다. */
  var simInputs = ['simQty','simPrice','simCostRate','simAdRate'].map(function(id){ return document.getElementById(id); });
  if(simInputs[0]){
    var fmtWon = function(n){ return '₩' + Math.round(n).toLocaleString('ko-KR'); };
    var computeSimulator = function(){
      var qty = parseFloat(document.getElementById('simQty').value) || 0;
      var price = parseFloat(document.getElementById('simPrice').value) || 0;
      var costRate = parseFloat(document.getElementById('simCostRate').value) || 0;
      var adRate = parseFloat(document.getElementById('simAdRate').value) || 0;

      var revenue = qty * price;
      var costTotal = revenue * costRate / 100;
      var adCost = revenue * adRate / 100;
      var profit = revenue - costTotal - adCost;
      var marginRate = revenue > 0 ? Math.round(profit / revenue * 100) : 0;
      var unitMargin = price - (price * costRate / 100);
      var breakeven = unitMargin > 0 ? Math.ceil(adCost / unitMargin) : 0;

      document.getElementById('simRevenue').textContent = fmtWon(revenue);
      document.getElementById('simAdCost').textContent = fmtWon(adCost);
      document.getElementById('simCostTotal').textContent = fmtWon(costTotal);
      document.getElementById('simBreakeven').textContent = breakeven + '개';
      document.getElementById('simProfit').textContent = fmtWon(profit);
      document.getElementById('simMarginRate').textContent = '마진율 ' + marginRate + '%';

      var stageFractions = [.3, .6, 1];
      for(var i = 0; i < 3; i++){
        var goal = Math.max(1, Math.round(qty * stageFractions[i]));
        var budget = adCost * stageFractions[i];
        document.getElementById('simRoad' + (i + 1) + 'Goal').textContent = goal + '개 판매';
        document.getElementById('simRoad' + (i + 1) + 'Budget').textContent = '광고예산 ' + fmtWon(budget);
      }
    };
    simInputs.forEach(function(el){ el.addEventListener('input', computeSimulator); });
    computeSimulator();

    /* GA4 profit_simulator_use — debounced separately from computeSimulator
       above (that one still fires on every keystroke for the live display;
       this one waits 1.5s after the last input before firing, once, so
       typing doesn't spam GA4). Only fires once 판매 수량/판매가 — the two
       inputs a meaningful result actually depends on — are both filled in.
       No revenue/cost/ad-spend/profit/margin numbers here on purpose —
       those are the seller's own business figures, not needed just to know
       the tool got used. */
    var simTrackTimer = null;
    function trackSimulatorUse(){
      var qty = parseFloat(document.getElementById('simQty').value) || 0;
      var price = parseFloat(document.getElementById('simPrice').value) || 0;
      if(qty <= 0 || price <= 0) return;
      if(typeof gtag === 'function'){
        gtag('event', 'profit_simulator_use', { tool_name: 'profit_simulator' });
      }
    }
    simInputs.forEach(function(el){
      el.addEventListener('input', function(){
        clearTimeout(simTrackTimer);
        simTrackTimer = setTimeout(trackSimulatorUse, 1500);
      });
    });
  }

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
     목록)로 초기화되도록. */
  if(window.launchdeskStore){
    window.launchdeskStore.onChange(function(){
      renderSavedCalcs();
      renderAdlog();
    });
  }
})();
