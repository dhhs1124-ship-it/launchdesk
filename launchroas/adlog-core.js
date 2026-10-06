/* 광고 기록(tool_records · tool_type='ad_log') 계산 규칙 — 메인(tools.js)과 LaunchROAS 미리보기(launchroas/adlog.js)가
   같은 파일을 쓴다(launchroas/adlog-core.js는 이 파일과 바이트 단위로 같아야 한다 · tests/adlog-core.test.js).

   기록 종류(data.source)
   - 금액 기록: 직접 입력(source 없음) · Meta 하루 합계(source='meta_auto') — 광고비 · 매출을 합계에 넣는다
   - 변경 기록(source='change') · 결과 기록(source='change_result') — 금액이 없다. 합계에 넣지 않고,
     결과 기록은 action_id로 변경 기록에 묶는다. 기존 기록은 수정하지 않고 덧붙인다(tool_records는 입력 · 삭제만 가능).

   합계 규칙
   - 같은 쇼핑몰 · 같은 날짜에 Meta 하루 합계와 채널 '메타' 직접 입력이 함께 있으면 직접 입력을 '중복 가능'으로 표시하고
     합계에서 뺀다(자동 수집 우선). 목록에는 남긴다.
   - 통화: 기록 통화가 없으면 원화(예전 직접 입력은 '광고비 (원)' 입력칸). 원화가 아니면 기록에 저장된 환율
     (fx_krw_per_unit)이 있을 때만 원화로 바꿔 합계에 넣고, 없으면 합계에서 빼고 개수를 알려 준다(0원으로 넣지 않음). */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskAdlogCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var CHANGE = 'change', RESULT = 'change_result', AUTO = 'meta_auto';
  function kind(r){ var s = r && r.source; return s === CHANGE ? CHANGE : s === RESULT ? RESULT : 'amount'; }
  function isAmount(r){ return kind(r) === 'amount'; }
  function num(v){ return typeof v === 'number' && isFinite(v) ? v : null; }
  function currencyOf(r){ return String((r && r.currency) || 'KRW').toUpperCase(); }

  // 기록 한 건의 원화 금액 — 바꿀 수 없으면 null(합계에서 뺀다)
  function toKrw(r, v){
    if(num(v) === null) return null;
    if(currencyOf(r) === 'KRW') return v;
    var fx = num(r.fx_krw_per_unit);
    return fx && fx > 0 ? Math.round(v * fx) : null;
  }

  // 같은 쇼핑몰 · 날짜의 Meta 하루 합계가 있는 직접 입력(채널 메타)
  function duplicateIds(records){
    var autoDays = {}, out = {};
    records.forEach(function(r){ if(isAmount(r) && r.source === AUTO) autoDays[String(r.store_id) + '|' + r.date] = true; });
    records.forEach(function(r){
      if(isAmount(r) && r.source !== AUTO && r.channel === '메타' && autoDays[String(r.store_id) + '|' + r.date]) out[String(r.id)] = true;
    });
    return out;
  }

  // 합계 — records는 이미 '지금 쇼핑몰' 범위로 고른 기록
  function summarize(records){
    var list = (records || []).filter(Boolean), dup = duplicateIds(list);
    var used = [], excluded = { duplicate: 0, currency: 0, nonAmount: 0 };
    list.forEach(function(r){
      if(!isAmount(r)){ excluded.nonAmount++; return; }
      if(dup[String(r.id)]){ excluded.duplicate++; return; }
      var spend = toKrw(r, num(r.spend));
      if(spend === null){ excluded.currency++; return; }
      used.push({ record: r, spend: spend, revenue: toKrw(r, num(r.revenue)) });
    });
    var totalSpend = used.reduce(function(s, x){ return s + x.spend; }, 0);
    var measured = used.filter(function(x){ return x.revenue !== null && x.spend > 0; });
    var revSpend = measured.reduce(function(s, x){ return s + x.spend; }, 0);
    var revenue = measured.reduce(function(s, x){ return s + x.revenue; }, 0);
    var best = measured.slice().sort(function(a, b){ return b.revenue / b.spend - a.revenue / a.spend; })[0];
    return { totalSpend: totalSpend, averageRoas: revSpend > 0 ? revenue / revSpend : null, best: best ? best.record : null,
      excluded: excluded, duplicates: dup };
  }

  // 변경 기록 → 결과 기록 연결(action_id). 결과는 시간순, 변경 기록이 지워졌으면 고아 결과로 따로 돌려준다.
  function linkChanges(records){
    var changes = {}, orphans = [];
    (records || []).forEach(function(r){ if(kind(r) === CHANGE && r.action_id) changes[String(r.action_id)] = { change: r, results: [] }; });
    (records || []).forEach(function(r){
      if(kind(r) !== RESULT) return;
      var g = changes[String(r.action_id)];
      if(g) g.results.push(r); else orphans.push(r);
    });
    Object.keys(changes).forEach(function(k){
      changes[k].results.sort(function(a, b){ return String(a.measured_at || a.date || '').localeCompare(String(b.measured_at || b.date || '')); });
      changes[k].latest = changes[k].results[changes[k].results.length - 1] || null;
    });
    return { changes: changes, orphans: orphans };
  }

  // 목록 한 줄 표시용 — 금액 칸이 없는 기록은 '—'(₩NaN 방지)
  function rowLabel(r, dup, links){
    var k = kind(r), tags = [];
    if(k === CHANGE){
      var g = links && links.changes[String(r.action_id)];
      tags.push('변경 기록' + (g && g.results.length ? ' · 결과 ' + g.results.length + '건' : ' · 결과 대기'));
    } else if(k === RESULT){
      tags.push(links && links.changes[String(r.action_id)] ? '결과 기록' : '결과 기록 · 연결된 변경 기록 없음');
    } else {
      if(r.source === AUTO) tags.push('Meta 자동 · 귀속 구매금액');
      if(dup && dup[String(r.id)]) tags.push('같은 날 Meta 자동 기록과 중복 가능 · 합계 제외');
      if(currencyOf(r) !== 'KRW') tags.push(currencyOf(r) + (num(r.fx_krw_per_unit) ? ' · 저장 환율로 원화 환산' : ' · 환율 없음 · 합계 제외'));
    }
    return tags;
  }
  function moneyText(r, v){
    var krw = isAmount(r) ? toKrw(r, num(v)) : null;
    return krw === null ? '—' : '₩' + Math.round(krw).toLocaleString('ko-KR');
  }

  return { kind: kind, isAmount: isAmount, currencyOf: currencyOf, toKrw: toKrw, duplicateIds: duplicateIds,
    summarize: summarize, linkChanges: linkChanges, rowLabel: rowLabel, moneyText: moneyText };
});
