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

  /* saved calculations — this browser only, capped at the 5 most
     recent (no login yet, so nowhere else to put them). */
  var SAVED_CALC_KEY = 'ld-tools-calc-history';
  function getSavedCalcs(){
    try{ return JSON.parse(localStorage.getItem(SAVED_CALC_KEY) || '[]'); }catch(e){ return []; }
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
      try{ localStorage.removeItem(SAVED_CALC_KEY); }catch(e){}
      renderSavedCalcs();
    });
  }
  var toolsSaveBtn = document.getElementById('toolsSaveCalc');
  if(toolsSaveBtn){
    toolsSaveBtn.addEventListener('click', function(){
      var result = computeToolsCalc();
      if(!result){ showToast('판매가를 먼저 입력해주세요'); return; }
      var items = getSavedCalcs();
      var now = new Date();
      result.date = (now.getMonth() + 1) + '.' + now.getDate() + '. ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
      items.unshift(result);
      items = items.slice(0, 5);
      try{ localStorage.setItem(SAVED_CALC_KEY, JSON.stringify(items)); }catch(e){}
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
  }

  /* 광고 기록 — real localStorage log the user builds up over time
     (unlike the checklist/setup trackers, there's no "looks like
     someone else's completed work" concern here — it's just numbers
     the seller typed in, same category as the saved margin calcs). */
  var ADLOG_KEY = 'ld-adlog-records';
  var adlogTbody = document.getElementById('adlogTbody');
  if(adlogTbody){
    var getAdlogRecords = function(){
      try{ return JSON.parse(localStorage.getItem(ADLOG_KEY) || '[]'); }catch(e){ return []; }
    };
    var saveAdlogRecords = function(list){
      try{ localStorage.setItem(ADLOG_KEY, JSON.stringify(list)); }catch(e){}
    };
    var roasClass = function(roas){
      if(roas >= 4) return 'roas-good';
      if(roas >= 2) return 'roas-mid';
      return 'roas-low';
    };
    window.deleteAdlogRecord = function(id){
      var list = getAdlogRecords().filter(function(r){ return String(r.id) !== String(id); });
      saveAdlogRecords(list);
      renderAdlog();
    };
    var renderAdlog = function(){
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
    };
    document.getElementById('adlogForm').addEventListener('submit', function(e){
      e.preventDefault();
      var channelBtn = document.querySelector('.adlog-chan-btn.active');
      var list = getAdlogRecords();
      list.unshift({
        id: Date.now(),
        date: document.getElementById('adlogDate').value,
        name: document.getElementById('adlogName').value,
        spend: parseFloat(document.getElementById('adlogSpend').value) || 0,
        revenue: parseFloat(document.getElementById('adlogRevenue').value) || 0,
        channel: channelBtn ? channelBtn.getAttribute('data-channel') : '메타'
      });
      saveAdlogRecords(list);
      renderAdlog();
      e.target.reset();
      document.getElementById('adlogFormWrap').hidden = true;
      showToast('광고 기록이 저장됐어요', 'success');
      /* GA4 ad_record_add — fires right after saveAdlogRecords() above
         actually persisted the record. No date/name/spend/revenue/channel
         here on purpose — those are the seller's own business numbers,
         not needed just to know the tool got used. */
      if(typeof gtag === 'function'){
        gtag('event', 'ad_record_add', {
          tool_name: 'ad_log'
        });
      }
    });
    renderAdlog();
  }
})();
