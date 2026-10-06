/* 광고 기록(tool_records · tool_type='ad_log') 계산 규칙 — LaunchROAS 미리보기 전용.
   (운영 메인 tools.js는 별도의 최소 호환 수정만 한다 — docs/ai/ad-improvement-loop-design.md 5-6)

   기록 종류(data.source)
   - 금액 기록: 직접 입력(source 없음) · Meta 하루 합계(source='meta_auto')
   - 변경 기록(source='change') · 결과 기록(source='change_result'): 금액이 없다. 합계에 넣지 않고,
     결과 기록은 action_id로 변경 기록에 묶는다. tool_records는 입력 · 삭제만 가능하므로 결과 · 메모는 덧붙인다.

   같은 날 중복(직접 입력 ↔ Meta 하루 합계) — 같은 쇼핑몰 · 같은 날짜 · 채널 '메타'만으로는 중복으로 보지 않는다.
   - 확정 중복: 같은 광고계정(직접 입력에 계정을 고른 경우)이거나, 계정 정보가 없어도 원화 금액이 같음
   - 다른 계정: 직접 입력의 계정이 Meta 하루 합계 계정과 다름 → 중복 아님
   - 중복 가능: 위로 판단할 수 없음(예전 기록 · 금액 다름) → 기본은 합계에 포함하고 '선택 필요'로 표시
   사용자가 고른 포함 · 제외(tool_type='ad_log_decision', 기록별 최신 1건)가 있으면 그 선택이 우선한다.

   통화 — 통화가 없는 기록은 원화: 예전 입력칸이 원화로만 받음(메인 index.html '지출 (원)' · '전환 매출 (원)',
   미리보기 launchroas/index.html '광고비 (원)'), Meta 하루 합계는 원화 계정만 저장(adlog-meta.js).
   원화가 아니면 원본 금액 · 통화 · 기록에 저장된 환율(fx_krw_per_unit)을 그대로 두고, 환율이 있을 때만
   원화로 바꿔 합산한다. 환율이 없으면 합계에서 빼고 그 사실을 표시한다(0원으로 넣지 않음). */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskAdlogCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var CHANGE = 'change', RESULT = 'change_result', AUTO = 'meta_auto';
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  function kind(r){ var s = r && r.source; return s === CHANGE ? CHANGE : s === RESULT ? RESULT : 'amount'; }
  function isAmount(r){ return kind(r) === 'amount'; }
  function num(v){ return typeof v === 'number' && isFinite(v) ? v : null; }
  function currencyOf(r){ return String((r && r.currency) || 'KRW').toUpperCase(); }
  function autoAccount(r){
    if(r.meta_account_id) return String(r.meta_account_id);
    var p = String(r.meta_auto_key || '').split('|');
    return p.length === 3 ? p[1] : null;
  }

  // 기록 한 건의 원화 금액 — 바꿀 수 없으면 null(합계에서 뺀다)
  function toKrw(r, v){
    if(num(v) === null) return null;
    if(currencyOf(r) === 'KRW') return v;
    var fx = num(r.fx_krw_per_unit);
    return fx && fx > 0 ? Math.round(v * fx) : null;
  }

  // 직접 입력 1건의 중복 판정 → {status:'none'|'other_account'|'confirmed'|'possible', reason, autoId}
  function classify(r, autos){
    if(!isAmount(r) || r.source === AUTO || r.channel !== '메타') return { status: 'none' };
    if(!ISO.test(String(r.date || ''))) return { status: 'none', reason: '날짜 형식을 알 수 없어 비교하지 않음' };
    var same = autos.filter(function(a){ return String(a.store_id) === String(r.store_id) && a.date === r.date; });
    if(!same.length) return { status: 'none' };
    if(r.meta_account_id){
      var hit = same.filter(function(a){ return autoAccount(a) === String(r.meta_account_id); })[0];
      if(hit) return { status: 'confirmed', autoId: hit.id, reason: '같은 광고계정 · 같은 날짜의 Meta 하루 합계에 이미 포함' };
      return { status: 'other_account', reason: '다른 광고계정 기록 · 중복 아님' };
    }
    var spend = toKrw(r, num(r.spend));
    var eq = spend !== null && same.filter(function(a){ var s = toKrw(a, num(a.spend)); return s !== null && Math.abs(s - spend) < 1; })[0];
    if(eq) return { status: 'confirmed', autoId: eq.id, reason: '같은 날짜 · 같은 금액의 Meta 하루 합계가 있음' };
    return { status: 'possible', autoId: same[0].id, reason: '같은 날 Meta 하루 합계가 있음 · 광고계정 · 집계 범위를 알 수 없음' };
  }

  // 기록별 최신 선택만 남긴다 — decisions: tool_type='ad_log_decision'의 data 배열
  function latestDecisions(decisions){
    var out = {};
    (decisions || []).forEach(function(d){
      if(!d || d.record_id == null || typeof d.include !== 'boolean') return;
      var k = String(d.record_id), prev = out[k];
      if(!prev || String(d.decided_at || '') >= String(prev.decided_at || '')) out[k] = d;
    });
    return out;
  }

  // 합계 — records는 이미 '지금 쇼핑몰' 범위로 고른 기록
  function summarize(records, decisions){
    var list = (records || []).filter(Boolean), autos = list.filter(function(r){ return isAmount(r) && r.source === AUTO; });
    var chosen = latestDecisions(decisions), dup = {}, used = [];
    var excluded = { duplicate: 0, chosen: 0, currency: 0, nonAmount: 0 }, pending = { count: 0, krw: 0 };
    list.forEach(function(r){
      if(!isAmount(r)){ excluded.nonAmount++; return; }
      var c = classify(r, autos), d = chosen[String(r.id)];
      if(c.status === 'confirmed' || c.status === 'possible') dup[String(r.id)] = { status: c.status, reason: c.reason, autoId: c.autoId, decision: d ? d.include : null };
      var spend = toKrw(r, num(r.spend));
      if(spend === null){ excluded.currency++; return; }
      var include = d ? d.include : c.status !== 'confirmed';
      if(!include){ if(d) excluded.chosen++; else excluded.duplicate++; return; }
      if(c.status === 'possible' && !d){ pending.count++; pending.krw += spend; }
      used.push({ record: r, spend: spend, revenue: toKrw(r, num(r.revenue)) });
    });
    var totalSpend = used.reduce(function(s, x){ return s + x.spend; }, 0);
    var measured = used.filter(function(x){ return x.revenue !== null && x.spend > 0; });
    var revSpend = measured.reduce(function(s, x){ return s + x.spend; }, 0);
    var revenue = measured.reduce(function(s, x){ return s + x.revenue; }, 0);
    var best = measured.slice().sort(function(a, b){ return b.revenue / b.spend - a.revenue / a.spend; })[0];
    return { totalSpend: totalSpend, averageRoas: revSpend > 0 ? revenue / revSpend : null, best: best ? best.record : null,
      excluded: excluded, pending: pending, duplicates: dup };
  }

  // 변경 기록 → 결과 기록 연결(action_id). 결과는 측정 시각순, 변경 기록이 지워졌으면 고아 결과로 따로 돌려준다.
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

  function fmt(n, cur){
    return cur === 'KRW' ? '₩' + Math.round(n).toLocaleString('ko-KR') : cur + ' ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  // 금액 칸 — 금액 없는 기록은 '—'(₩NaN 방지), 외화는 원본 · 환율 · 원화를 함께
  function moneyText(r, v){
    if(!isAmount(r) || num(v) === null) return '—';
    var cur = currencyOf(r);
    if(cur === 'KRW') return fmt(v, 'KRW');
    var krw = toKrw(r, v);
    return krw === null ? fmt(v, cur) + ' · 환율 없음' : fmt(v, cur) + ' × ' + Number(r.fx_krw_per_unit).toLocaleString('ko-KR') + ' = ' + fmt(krw, 'KRW');
  }

  // 표 태그
  function rowLabel(r, dup, links){
    var k = kind(r), tags = [];
    if(k === CHANGE){
      var g = links && links.changes[String(r.action_id)];
      tags.push('변경 기록' + (g && g.results.length ? ' · 결과 ' + g.results.length + '건' : ' · 결과 대기'));
    } else if(k === RESULT){
      tags.push(links && links.changes[String(r.action_id)] ? '결과 기록' : '결과 기록 · 연결된 변경 기록 없음');
    } else {
      if(r.source === AUTO) tags.push('Meta 자동 · 귀속 구매금액');
      var d = dup && dup[String(r.id)];
      if(d){
        if(d.decision === true) tags.push('중복 확인 · 사용자가 합계 포함 선택');
        else if(d.decision === false) tags.push('중복 확인 · 사용자가 합계 제외 선택');
        else if(d.status === 'confirmed') tags.push('확정 중복 · 합계 제외 (' + d.reason + ')');
        else tags.push('중복 가능 · 합계 포함 중 · 선택 필요');
      }
      if(currencyOf(r) !== 'KRW' && toKrw(r, num(r.spend)) === null) tags.push(currencyOf(r) + ' 기록 · 적용 환율 없음 · 합계 제외');
    }
    return tags;
  }

  return { kind: kind, isAmount: isAmount, currencyOf: currencyOf, toKrw: toKrw, classify: classify, latestDecisions: latestDecisions,
    summarize: summarize, linkChanges: linkChanges, rowLabel: rowLabel, moneyText: moneyText };
});
