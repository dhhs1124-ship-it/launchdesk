/* 첫단추 마진 계산기 — 화면. 계산은 chutdanchu-core.js, 저장 · 전송 없음. */
(function(){
  'use strict';
  var C = window.chutdanchuMargin;
  var $ = function(id){ return document.getElementById(id); };
  var inputs = C.FIELDS.concat(C.PAID_FIELDS).map($);
  var paid = function(){ return $('shipToggle').getAttribute('aria-expanded') === 'true'; };

  function digits(s){ return s.replace(/[^\d]/g, ''); }
  // 금액 칸: 입력 중 천 단위 콤마. 커서는 앞쪽 숫자 개수 기준으로 되돌린다.
  function formatMoney(el){
    var before = digits(el.value.slice(0, el.selectionStart || 0)).length;
    if(/[^\d,]/.test(el.value)) return; // 잘못된 문자는 그대로 두고 오류로 안내
    var d = digits(el.value).replace(/^0+(?=\d)/, '');
    el.value = d ? Number(d).toLocaleString('ko-KR') : '';
    var pos = 0, seen = 0;
    while(pos < el.value.length && seen < before){ if(/\d/.test(el.value[pos])) seen++; pos++; }
    if(document.activeElement === el) el.setSelectionRange(pos, pos);
  }
  // 간단 입력 ↔ 유료배송 상세 입력. 각 칸의 값은 그대로 두고, 화면에 보이는 쪽만 계산한다.
  function setShipMode(open){
    $('shipToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('shipSimple').hidden = open;
    $('shipPaid').hidden = !open;
    $('feeHint').textContent = open ? '할인 후 판매금액 + 받은 배송비에 적용' : '할인 후 판매금액에 적용';
  }
  function setValues(v){
    setShipMode(false);
    inputs.forEach(function(el){
      var n = v[el.id];
      el.value = n == null ? '' : (el.hasAttribute('data-money') ? Number(n).toLocaleString('ko-KR') : String(n));
    });
    render();
  }
  function raw(){ var v = { shippingMode: paid() ? 'paid' : 'simple' }; inputs.forEach(function(el){ v[el.id] = el.value; }); return v; }
  // 할인율만 바꿔도 예시 표시는 유지(할인 없음 / 있음 비교용). 다른 칸을 바꾸면 내 값이다.
  function isExample(v){
    return v.shippingMode !== 'paid' && C.FIELDS.every(function(f){ return f === 'discountRate' || C.toNum(v[f]) === C.EXAMPLE[f]; });
  }
  function won(n){ return C.fmtWon(n); }
  function pct(n){ return C.fmtPct(n); }
  function text(id, s, deficit){ var e = $(id); e.textContent = s; if(deficit !== undefined) e.classList.toggle('deficit', !!deficit); }

  function render(){
    var v = raw(), r = C.calculate(v), touched = inputs.some(function(el){ return el.value !== ''; });
    $('exampleBadge').hidden = !isExample(v);
    inputs.forEach(function(el){
      var f = el.id, msg = touched && r.errors[f] ? r.errors[f] : '';
      $(f + '-msg').textContent = msg;
      $(f).setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    $('errSummary').hidden = r.ok || !touched;
    if(!r.ok){
      ['profit', 'ratio', 'sale', 'bSale', 'aSale', 'bProfit', 'aProfit', 'bRatio', 'aRatio', 'dockProfit', 'dockRatio'].forEach(function(id){ text(id, '—', false); });
      $('diff').textContent = touched ? '' : '판매가와 사입 원가를 넣으면 계산돼요';
      $('costs').replaceChildren();
      return;
    }
    var a = r.after, b = r.before;
    text('profit', won(a.profit), a.isDeficit);
    text('ratio', pct(a.ratio), a.isDeficit);
    text('sale', won(a.sale));
    text('bSale', won(b.sale)); text('aSale', won(a.sale));
    text('bProfit', won(b.profit), b.isDeficit); text('aProfit', won(a.profit), a.isDeficit);
    text('bRatio', pct(b.ratio)); text('aRatio', pct(a.ratio));
    text('dockProfit', won(a.profit), a.isDeficit); text('dockRatio', pct(a.ratio));
    var gap = b.profit - a.profit;
    $('diff').textContent = r.discount ? '할인으로 1개당 ' + won(gap) + ' 덜 남아요' + (a.isDeficit ? ' · 적자예요' : '')
      : (a.isDeficit ? '이 조건이면 1개 팔 때마다 적자예요' : '할인율을 넣으면 전후가 비교돼요');
    var ship = v.shippingMode === 'paid' ? [['받은 배송비', a.received, '+'], ['실제 택배비', a.shipping]] : [['배송비', a.shipping]];
    var rows = [['사입 원가', a.cost], ['수수료', a.fee], ['포장비', a.packaging]].concat(ship, [['광고비', a.ad]]);
    $('costs').replaceChildren.apply($('costs'), rows.reduce(function(out, row){
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = row[0]; dd.textContent = (row[2] || '−') + won(row[1]);
      out.push(dt, dd); return out;
    }, []));
  }

  inputs.forEach(function(el){
    el.addEventListener('input', function(){ if(el.hasAttribute('data-money')) formatMoney(el); render(); });
  });
  $('shipToggle').addEventListener('click', function(){
    var open = !paid();
    // 처음 펼칠 때: 실제 택배비 = 간단 입력값, 받은 배송비 0 → 펼치기만으로 결과가 바뀌지 않는다.
    if(open && $('customerShipping').value === '' && $('actualShipping').value === '') $('actualShipping').value = $('shipping').value;
    setShipMode(open);
    render();
  });
  $('fillExample').addEventListener('click', function(){ setValues(C.EXAMPLE); });
  $('clearAll').addEventListener('click', function(){ setValues({}); $('price').focus(); });
  $('form').addEventListener('submit', function(e){ e.preventDefault(); });

  // 결과 카드가 화면 밖이면 아래에 남는 금액 요약 고정
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){ $('dock').hidden = es[0].isIntersecting; }).observe($('result'));
  }

  setValues(C.EXAMPLE);
})();
