/* 광고 기록 확장 — AI 개선안 → 실행 기록(변경 기록) → 결과 비교. 순수 함수만 둔다(화면 · DB는 adlog.js).
   - 변경 기록: tool_records(tool_type='ad_log') data.source='change'. 금액 칸(spend · revenue)이 없어 합계에 들어가지 않는다.
   - 결과 기록: data.source='change_result', action_id로 변경 기록을 가리킨다. 기존 기록은 고치지 않고 덧붙인다.
   - 결과는 세 가지를 따로 계산하고 서로 더하지 않는다.
     ① 실제 지출 변화(같은 길이 · 같은 통화)  ② 이익 변화 — 실제 주문 기준(현재 광고별 주문 연결 없음 → 없음) / 연결 상품 기준 참고 계산 / 계산 보류
     ③ 상품 마진 변경은 '변경'으로만 기록하고, 누락 비용 발견은 사용자가 항목 · 금액을 확인했거나 비용 항목 비교로 입증된 경우만(절약액 아님)
     참고 계산 · 계산 보류는 검증된 이익 · 절감 집계(outcomeSummary)에서 뺀다. 쇼핑몰 전체 이익 변화를 특정 광고 효과로 돌리지 않는다.
   - 관찰(실제 수치 변화)과 확인(개선 · 악화 판정)을 나눈다. 광고비가 줄었어도 구매가 함께 줄면 개선이 아니다. 전후 비교는 인과를 증명하지 않는다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.LaunchRoasAdlogChange = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var ELEMENTS = ['문구', '이미지', '영상 첫 장면', '영상 자막', '타깃', '예산', '랜딩 페이지', '기타'];
  var CONCURRENT = ['예산', '할인', '상품', '타깃', '게재 위치', '기타'];
  // 결과 판정 버전 — 이 버전의 신호(improved · worse)만 '구매당 광고비 신호'로 집계한다. 버전이 없는 예전 결과는 이전 기준
  var JUDGEMENT_VERSION = 'adlog-compare-v3: 정확 이항검정(단측 0.05) · 광고비당 구매 · 전후 같은 시점 재조회 · 같은 광고만 · 귀속 창 동안 잠정';
  var PROFIT_FORMULA = 'ad-profit-reference-v1: 연결 상품 주문당 광고 전 잔액 × Meta 귀속 구매 수 − 광고비(원화) · 참고 계산';
  var DAY = 864e5;

  function addDays(iso, n){ return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function daysBetween(a, b){ return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) + 1; }
  function num(v){ return typeof v === 'number' && isFinite(v) ? v : null; }

  // 변경 전 · 후 비교 기간 — 같은 길이(days). 변경 후 기간은 시작일부터.
  function periods(startDate, days){
    return { before: { since: addDays(startDate, -days), until: addDays(startDate, -1) }, after: { since: startDate, until: addDays(startDate, days - 1) } };
  }

  // 하루 단위 광고 지표(meta-adset-insights scope=ads의 metrics) 합산. rows: [{date, metrics|null, state}]
  // state: 'ok'(행 있음) · 'absent'(정상 · 전체 페이지 조회에서 광고 행 없음 = 그날 집행 0) · 'failed'(조회 실패) · 'truncated'(페이지 누락 — 광고가 빠졌을 수 있음)
  // 조회 실패 · 페이지 누락은 missing_days(불완전 — 비교 · 기준값으로 쓰지 않음). state가 없는 예전 행은 metrics 유무로 ok/absent.
  // 구매 · 구매금액은 하루라도 측정된 날이 있어야 측정으로 본다.
  function aggregate(rows, since, until){
    var want = daysBetween(since, until), seen = {}, spend = 0, imp = 0, clicks = 0, buy = 0, value = 0, buyObs = false, valObs = false, absent = 0, failed = 0, truncated = 0;
    (rows || []).forEach(function(r){
      if(!r || !r.date || r.date < since || r.date > until || seen[r.date]) return;
      var st = r.state || (r.metrics ? 'ok' : 'absent');
      if(st === 'failed'){ failed++; return; }
      if(st === 'truncated'){ truncated++; return; }
      seen[r.date] = true;
      var m = r.metrics;
      if(!m){ absent++; return; } // 정상 조회에서 광고 행 없음 = 그날 집행 0
      spend += num(m.spend) || 0; imp += num(m.impressions) || 0; clicks += num(m.link_clicks) || 0;
      if(m.purchase && m.purchase.observed){ buyObs = true; buy += num(m.purchase.value) || 0; }
      if(m.purchase_value && m.purchase_value.observed){ valObs = true; value += num(m.purchase_value.value) || 0; }
    });
    var got = Object.keys(seen).length;
    return { since: since, until: until, days: want, missing_days: want - got, failed_days: failed, truncated_days: truncated, absent_days: absent, spend: spend, impressions: imp, link_clicks: clicks,
      purchases: { value: buy, observed: buyObs }, purchase_value: { value: value, observed: valObs },
      link_ctr: imp > 0 ? clicks / imp * 100 : null, link_cpc: clicks > 0 ? spend / clicks : null,
      roas: spend > 0 && valObs ? value / spend : null };
  }

  // 귀속 기준 — meta-adset-insights가 요청에 실제로 넣은 값을 응답으로 돌려준 것({source:'request', windows, action_report_time})만 확인된 기준으로 본다.
  // 예전 기록의 문자열 · 응답에 기준이 없는 경우는 확인 불가(null).
  // 잠정 기간 = 귀속 창(클릭 · 조회 중 긴 쪽). 근거: 보고 기준이 노출일(action_report_time=impression)이면 비교 기간 마지막 날 노출에서 생긴 구매가
  // 귀속 창이 끝날 때까지 그 날짜로 더해진다. 전환일 기준(conversion)이면 지난 날짜에 더해지지 않는다(0일).
  function attributionWindowDays(a){
    if(!a || typeof a !== 'object' || a.source !== 'request' || !Array.isArray(a.windows) || !a.windows.length) return null;
    if(a.action_report_time === 'conversion') return 0;
    if(a.action_report_time !== 'impression') return null;
    var d = a.windows.map(function(w){ var m = /^(\d+)d_(click|view)$/.exec(String(w)); return m ? Number(m[1]) : NaN; });
    return d.some(isNaN) ? null : Math.max.apply(null, d);
  }
  function sameAttribution(a, b){ return JSON.stringify(a || null) === JSON.stringify(b || null); }

  function newId(now){ return Math.floor(now) * 1000 + Math.floor(Math.random() * 1000); }

  // 변경 기록 만들기 — 필수값이 빠지면 errors
  function buildChangeRecord(input, now){
    var e = [], i = input || {}, ad = i.ad || {};
    if(!i.storeId) e.push('쇼핑몰');
    if(!ad.ad_id || !ad.adset_id) e.push('대상 광고(광고 · 광고 세트 ID)');
    if(ELEMENTS.indexOf(i.element) < 0) e.push('바꾼 요소');
    if(!String(i.after || '').trim()) e.push('바꾼 내용');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(i.startDate || ''))) e.push('시작일');
    var days = Number(i.compareDays);
    if(!(days >= 3 && days <= 28)) e.push('비교 기간(3~28일)');
    if(!i.baseline || !i.baseline.metrics) e.push('변경 전 지표');
    if(!i.basis || !i.basis.currency) e.push('당시 계산 기준');
    if(i.method !== 'edit' && i.method !== 'new_ad') e.push('변경 방식(기존 광고 수정 · 새 광고 추가)');
    if(i.method === 'new_ad' && !/^\d+$/.test(String(i.newAdId || ''))) e.push('새 광고 ID');
    if(i.baseline && i.baseline.metrics && i.baseline.metrics.missing_days) e.push('변경 전 지표 일부를 불러오지 못함(조회 실패 · 페이지 누락 ' + i.baseline.metrics.missing_days + '일)');
    if(e.length) return { ok: false, errors: e };
    var t = now || Date.now(), p = periods(i.startDate, days), concurrent = (i.concurrent || []).filter(function(c){ return CONCURRENT.indexOf(c) >= 0; });
    return { ok: true, record: {
      id: newId(t), action_id: 'act_' + newId(t).toString(36), source: 'change', store_id: String(i.storeId), date: i.startDate,
      name: String(ad.ad_name || '광고') + ' · ' + i.element + ' 변경', channel: '메타',
      ad: { ad_id: String(ad.ad_id), adset_id: String(ad.adset_id), ad_name: ad.ad_name || null, new_ad_id: i.method === 'new_ad' ? String(i.newAdId) : null },
      suggestion: i.suggestion || null,
      change: { element: i.element, before: String(i.before || ''), after: String(i.after), method: i.method === 'new_ad' ? 'new_ad' : 'edit' },
      compare: { days: days, before: p.before, after: p.after, metrics: ['spend', 'purchases', 'purchase_value', 'roas', 'link_ctr', 'est_profit'] },
      baseline: i.baseline, basis: Object.assign({ profit_formula: PROFIT_FORMULA }, i.basis),
      creative_snapshot: i.creative || null,
      concurrent: concurrent, concurrent_note: String(i.concurrentNote || ''), memo: String(i.memo || ''),
      recorded_at: new Date(t).toISOString()
    } };
  }

  // 같은 계산 범위의 예상 이익 — 변경 기록 당시 마진 · 환율로 전후 모두 계산
  function estProfit(m, basis){
    var margin = basis && basis.margin, fx = basis.currency === 'KRW' ? 1 : num(basis.fx_krw_per_unit);
    if(!margin || num(margin.pre_ad) === null || !fx || !m.purchases.observed) return null;
    return Math.round(margin.pre_ad * m.purchases.value - m.spend * fx);
  }

  // 이익 계산 범위
  // - actual: 실제 주문 상품 · 비용으로 이 광고의 주문을 계산할 수 있을 때(광고별 주문 연결이 없어 현재는 없음)
  // - reference: 연결 상품 마진을 가정한 참고 계산 — Meta 귀속 구매가 모두 연결 상품이라는 근거가 없으므로 검증된 이익이 아님
  // - withheld: 연결 상품 · 구매 측정 · 환율이 없어 계산 보류
  function profitView(b, after, basis){
    var p0 = estProfit(b, basis), p1 = estProfit(after, basis);
    if(p0 === null || p1 === null){
      var why = !basis.margin ? '연결 상품 마진 없음' : !b.purchases.observed || !after.purchases.observed ? '구매 미측정' : '광고비 환율 없음';
      return { kind: 'withheld', reason: '이익 변화 계산 보류 · ' + why };
    }
    return { kind: 'reference', before: p0, after: p1, diff: p1 - p0,
      basis: '연결 상품 기준 참고 계산 — 귀속 구매가 모두 연결 상품(주문당 ' + basis.margin.pre_ad + '원)이라고 가정 · 검증된 이익이 아님' };
  }

  // 정확 이항 꼬리확률 P(X >= k) · P(X <= k), X ~ Binomial(n, p) — 로그 공간에서 합산
  function lgamma(x){ // Lanczos 근사
    var g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if(x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1; var a = c[0], t = x + g + 0.5;
    for(var i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function binomPmf(n, k, p){
    if(p <= 0) return k === 0 ? 1 : 0; if(p >= 1) return k === n ? 1 : 0;
    return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  function binomTails(n, k, p){
    var ge = 0, le = 0;
    for(var i = 0; i <= n; i++){ var v = binomPmf(n, i, p); if(i >= k) ge += v; if(i <= k) le += v; }
    return { ge: Math.min(1, ge), le: Math.min(1, le) };
  }

  var ALPHA = 0.05; // 관례적 유의수준(단측). 표본 건수 기준이 아니라 '같은 광고비당 구매 비율이 그대로라면 이 정도 차이가 나올 확률'로 본다
  function pct(a, b){ return b ? Math.round((a - b) / b * 1000) / 10 : null; }

  // 관찰(실제 수치)과 확인(개선 · 악화 판정)을 나눈다.
  // - observations: 구매 · 광고비 · 구매당 광고비의 전후와 방향 — 항상 계산 가능한 만큼 보여 준다
  // - status(확인): improved(구매당 광고비 개선 신호) · worse(구매당 광고비 악화 신호) · inconclusive(판단 보류) · unknown(비교 불가)
  //   확인은 비교 조건이 맞고(전후를 비교 시점에 함께 재조회 · 귀속 기준 확인 · 귀속 창 지남 · 같은 광고 · 함께 바뀐 조건 없음) 같은 광고비당 구매 비율 차이가 우연 범위(단측 p < 0.05)를 벗어날 때만.
  //   구매가 줄었으면 효율이 좋아져도 개선으로 확인하지 않는다. 광고비만 줄어든 것은 개선이 아니다.
  //   가정: 광고비 1원당 구매가 독립적으로 일어난다고 보는 단순 모형(포아송) — 귀속 변동 · 시즌 영향은 반영하지 못한다.
  // opts.before: 결과 비교 시점에 다시 조회한 변경 전 지표(같은 시점 · 같은 귀속 기준) — 있으면 이것으로 비교하고 저장 당시 기준값은 이력으로만 둔다
  // opts.attribution: 다시 조회할 때 확인한 귀속 기준(전후 공통)
  function compare(change, after, afterBasis, today, opts){
    var basis = change.basis, w = [], reasons = [], ab = afterBasis || {}, o = opts || {}, fresh = !!o.before;
    var b = fresh ? o.before : change.baseline.metrics, newAd = change.change && change.change.method === 'new_ad';
    var res = { status: 'unknown', reasons: reasons, warnings: w, provisional: false, separable: !(change.concurrent && change.concurrent.length), blockers: [],
      baseline_source: fresh ? 'refetched' : 'saved', comparison: newAd ? 'new_ad_vs_existing' : 'same_ad_before_after' };
    if(fresh && change.baseline && change.baseline.metrics) res.saved_baseline = { spend: change.baseline.metrics.spend, purchases: change.baseline.metrics.purchases, fetched_at: change.baseline.fetched_at || null };
    if(after.until >= today){ reasons.push('비교 기간이 아직 끝나지 않았어요(' + after.until + '까지)'); res.blockers.push('period_open'); return res; }
    var per = change.compare || {}, off = function(m, p){ return p && m.since && (m.since !== p.since || m.until !== p.until); };
    if(off(after, per.after) || (fresh && off(b, per.before))){ reasons.push('조회한 기간이 기록된 비교 기간과 달라 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    if(after.days !== b.days){ reasons.push('전후 기간 길이가 달라 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    if(after.missing_days || b.missing_days){ reasons.push('지표를 조회하지 못했거나 일부 페이지가 빠진 날이 있어 비교하지 않아요(조회 실패 · 페이지 누락)'); res.blockers.push('fetch_failed'); return res; }
    if(ab.currency && ab.currency !== basis.currency){ reasons.push('광고계정 통화가 바뀌어 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    var attr = fresh ? (o.attribution || null) : basis.attribution;
    if(!fresh && ab.attribution && !sameAttribution(ab.attribution, basis.attribution)){ reasons.push('귀속 기준이 바뀌어 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    res.attribution = attr || null;
    var win = attributionWindowDays(attr);
    if(win === null){ res.provisional = true; res.blockers.push('attribution_unverified'); w.push('귀속 기준(기간 · 보고 시점)을 응답에서 확인하지 못해 개선 · 악화를 확정하지 않아요'); }
    else if(daysBetween(after.until, today) - 1 <= win){ res.provisional = true; res.blockers.push('provisional'); w.push('귀속 창(' + win + '일, 노출일 기준 보고) 안이라 구매가 더 늘어날 수 있어 잠정 결과예요 — ' + addDays(after.until, win + 1) + '부터 확정 판단'); }
    // 저장 당시 기준값은 이후 귀속으로 늘어난 구매가 빠져 있어 변경 후와 같은 시점 값이 아니다 — 관찰만, 신호로 판정하지 않는다
    if(!fresh){ res.blockers.push('baseline_not_refetched'); w.push('변경 전 지표가 기록 당시 값이라(비교 시점 재조회 아님) 늦게 귀속된 구매가 빠져 있을 수 있어 개선 · 악화를 확정하지 않아요'); }
    if(newAd){ res.blockers.push('different_ads'); w.push('새 광고의 변경 후 기간과 기존 광고의 변경 전 기간 비교 — 서로 다른 광고 · 기간이라 관찰값만 보여 주고 효율 신호로 판정하지 않아요'); }
    if(!res.separable){ res.blockers.push('not_separable'); w.push('같은 기간에 함께 바뀐 조건(' + change.concurrent.join(' · ') + ')이 있어 이 변경의 효과만 따로 볼 수 없어요'); }
    w.push('전후 비교라 다른 요인(계절 · 행사 · 경쟁 · 노출 배분 등)의 영향을 배제하지 못해요');

    // 관찰 — 이익을 계산하지 못해도 항상 보여 준다
    var fx = basis.currency === 'KRW' ? 1 : num(basis.fx_krw_per_unit);
    res.spend = { before: b.spend, after: after.spend, diff: after.spend - b.spend, pct: pct(after.spend, b.spend), currency: basis.currency,
      krw_diff: fx ? Math.round((after.spend - b.spend) * fx) : null };
    var buy0 = b.purchases, buy1 = after.purchases;
    res.purchases = buy0.observed && buy1.observed ? { before: buy0.value, after: buy1.value, diff: buy1.value - buy0.value } : null;
    res.cpa = res.purchases ? { before: buy0.value > 0 ? b.spend / buy0.value : null, after: buy1.value > 0 ? after.spend / buy1.value : null, currency: basis.currency } : null;
    if(res.cpa && res.cpa.before !== null && res.cpa.after !== null) res.cpa.pct = pct(res.cpa.after, res.cpa.before);
    res.roas = { before: b.roas, after: after.roas };
    res.profit = profitView(b, after, basis);
    res.observations = observe(res);

    // 상품 마진 변경 — 기본은 '변경'으로만 기록. 누락 비용 발견은 사용자가 항목 · 금액을 확인했거나 비용 항목 비교로 입증된 경우만
    var m0 = basis.margin, m1 = ab.margin;
    if(m0 && m1 && num(m0.pre_ad) !== null && num(m1.pre_ad) !== null && (m1.pre_ad !== m0.pre_ad || m0.source_saved_at !== m1.source_saved_at)){
      res.marginChange = { before_per_order: m0.pre_ad, now_per_order: m1.pre_ad, diff_per_order: m1.pre_ad - m0.pre_ad, note: '상품 마진 변경 · 이유 미확인 · 참고 계산은 변경 기록 당시 마진으로 했어요' };
    }
    res.missingCost = missingCost(m0, m1, o.confirmedMissingCost);

    if(!res.purchases){ reasons.push('구매가 측정되지 않은 기간이 있어 개선 여부를 판단하지 않아요'); return res; }
    if(buy0.value + buy1.value === 0){ reasons.push('전후 모두 구매가 없어 구매 기준으로 판단할 수 없어요'); return res; }
    if(!(b.spend > 0 && after.spend > 0)){ res.status = 'inconclusive'; reasons.push('한쪽 기간에 광고비가 없어 같은 광고비당 구매를 비교할 수 없어요'); return res; }
    // 같은 광고비당 구매 비율이 그대로라면, 전후 구매 합계 중 변경 후 몫은 광고비 비율을 따른다
    var n = buy0.value + buy1.value, share = after.spend / (b.spend + after.spend), t = binomTails(n, buy1.value, share);
    res.test = { method: '정확 이항검정(단측) · 같은 광고비당 구매 비율 가정', n: n, expected_after: Math.round(n * share * 10) / 10, p_better: Math.round(t.ge * 1000) / 1000, p_worse: Math.round(t.le * 1000) / 1000, alpha: ALPHA };
    var better = t.ge < ALPHA, worse = t.le < ALPHA;
    if(!better && !worse){ res.blockers.push('sample_uncertain'); }
    if(newAd || !fresh || res.provisional || !res.separable){
      res.status = 'inconclusive';
      reasons.push(newAd ? '새 광고와 기존 광고의 다른 기간 비교라 관찰값만 기록해요(효율 신호 아님)'
        : !fresh ? '변경 전 지표를 비교 시점에 다시 조회하지 않아 개선 여부를 확정하지 않아요'
        : res.blockers.indexOf('attribution_unverified') >= 0 ? '귀속 기준을 확인하지 못해 개선 여부를 확정하지 않아요'
        : res.provisional ? '귀속 창이 끝나지 않아 개선 여부를 확정하지 않아요' : '함께 바뀐 조건이 있어 개선 여부를 확정하지 않아요');
      if(after.spend < b.spend) w.push('광고비 감소는 지출 변화로만 기록해요 · 개선 성공이 아니에요');
      return res;
    }
    // 신호의 범위: 광고비당 구매(구매당 광고비)뿐 — 매출 · 이익 증가나 AI 제안의 인과 효과를 확인한 것이 아니다
    if(better && buy1.value >= buy0.value){ res.status = 'improved'; reasons.push('구매당 광고비 개선 신호 — 같은 광고비당 구매가 우연한 변동으로 보기 어려울 만큼 늘었어요(단측 p=' + res.test.p_better + ' · 매출 · 이익 · 제안의 인과 효과는 확인하지 않음)'); }
    else if(worse){ res.status = 'worse'; reasons.push('구매당 광고비 악화 신호 — 같은 광고비당 구매가 우연한 변동으로 보기 어려울 만큼 줄었어요(단측 p=' + res.test.p_worse + ' · 매출 · 이익 · 원인은 확인하지 않음)'); }
    else if(better){ res.status = 'inconclusive'; reasons.push('구매당 광고비는 낮아졌지만 구매가 줄어 개선으로 확인하지 않아요'); }
    else { res.status = 'inconclusive'; reasons.push('관찰된 차이가 우연한 변동 범위 안이에요(변경 후 예상 ' + res.test.expected_after + '건 · 실제 ' + buy1.value + '건)'); }
    if(after.spend < b.spend && res.status !== 'improved') w.push('광고비 감소는 지출 변화로만 기록해요 · 개선 성공이 아니에요');
    return res;
  }

  // 관찰 문구 — 실제 계산값에서만 만든다
  function observe(res){
    var out = [], p = res.purchases, c = res.cpa, s = res.spend;
    if(p) out.push(p.diff > 0 ? '구매 증가 관찰' : p.diff < 0 ? '구매 감소 관찰' : '구매 변화 없음');
    if(c && c.pct !== undefined && c.pct !== null) out.push(c.pct > 0 ? '구매당 광고비 +' + c.pct + '% (효율 저하 관찰)' : c.pct < 0 ? '구매당 광고비 ' + c.pct + '% (효율 개선 관찰)' : '구매당 광고비 변화 없음');
    if(s && s.pct !== null) out.push(s.pct === 0 ? '광고비 변화 없음' : '광고비 ' + (s.pct > 0 ? '+' : '') + s.pct + '%');
    return out;
  }

  // 누락 비용 발견 — ① 사용자가 항목 · 주문당 금액을 확인했거나 ② 두 마진에 비용 항목(cost_items)이 있고, 전에 없던 항목이 생긴 경우만
  function missingCost(m0, m1, confirmed){
    if(confirmed && String(confirmed.item || '').trim() && num(Number(confirmed.per_order)) !== null && Number(confirmed.per_order) > 0)
      return { source: 'user_confirmed', items: [{ item: String(confirmed.item).trim(), per_order: Number(confirmed.per_order) }], per_order: Number(confirmed.per_order), note: '사용자가 확인한 누락 비용 · 절약액이 아니며 다른 값과 더하지 않아요' };
    var a = m0 && m0.cost_items, z = m1 && m1.cost_items;
    if(!a || !z) return null;
    var items = Object.keys(z).filter(function(k){ return num(z[k]) > 0 && !(num(a[k]) > 0); }).map(function(k){ return { item: k, per_order: z[k] }; });
    if(!items.length) return null;
    return { source: 'cost_items', items: items, per_order: items.reduce(function(t, x){ return t + x.per_order; }, 0), note: '비용 항목 비교로 확인한 누락 비용 · 절약액이 아니며 다른 값과 더하지 않아요' };
  }

  // 성과 집계(운영 · 홍보 근거용) — records: ad_log 기록(변경 · 결과 섞여도 됨)
  // - 실행(action_id)의 현재 상태는 '최신 결과' 기준. 이전 결과는 history_results로만 남긴다
  //   · 최신이 판단 불가이고 이유가 조회 실패(fetch_failed)뿐이면: 마지막 유효 결과를 '갱신 실패 · 이전 결과'(stale)로 보여 주되 신호로 세지 않는다
  //   · 최신이 비교 조건 불일치 · 기간 미종료 등 판단 불가면: 현재 상태는 판단 불가 · 이전 신호는 이력으로만
  // - 신호(구매당 광고비 개선 · 악화)는 현재 판정 버전(JUDGEMENT_VERSION)으로 저장된 결과만. 버전 없는 예전 결과는 legacy로 따로
  // - 지출 변화는 같은 광고 · 겹치는 변경 후 기간이면 가장 최근 실행 1건만. 전후 관찰 합계이며 서비스가 만든 절감액이 아니다
  // - 참고 계산 · 계산 보류 이익은 검증된 이익에서 뺀다
  function currentOf(list){
    var sorted = list.slice().sort(function(a, b){ return String(a.measured_at || '').localeCompare(String(b.measured_at || '')); });
    var latest = sorted[sorted.length - 1], s = latest.result;
    var onlyFetch = s.status === 'unknown' && (s.blockers || []).length > 0 && (s.blockers || []).every(function(k){ return k === 'fetch_failed'; });
    if(onlyFetch){
      var prev = sorted.slice(0, -1).filter(function(r){ return r.result.status !== 'unknown'; }).pop();
      if(prev) return { record: prev, state: 'stale', latest: latest, history: sorted.length - 1 };
    }
    return { record: latest, state: s.status === 'unknown' ? 'unknown' : 'current', latest: latest, history: sorted.length - 1 };
  }
  function outcomeSummary(records){
    var changes = {}, results = {};
    (records || []).forEach(function(r){
      if(!r) return;
      if(r.source === 'change' && r.action_id) changes[r.action_id] = r;
      else if(r.source === 'change_result' && r.action_id && r.result) (results[r.action_id] = results[r.action_id] || []).push(r);
    });
    var out = { actions: 0, results_total: 0, history_results: 0, judgement_version: JUDGEMENT_VERSION,
      signals: { cpa_better: 0, cpa_worse: 0 }, signal_scope: '광고비당 구매(구매당 광고비) 변화 신호 · 매출 · 이익 · 제안의 인과 효과는 확인하지 않음',
      inconclusive: 0, unknown: 0, stale_previous: 0, legacy_results: 0,
      hold_reasons: { provisional: 0, not_separable: 0, condition_mismatch: 0, sample_uncertain: 0, fetch_failed: 0, period_open: 0, attribution_unverified: 0, different_ads: 0, baseline_not_refetched: 0 },
      observed_only_new_ad: 0,
      observed_spend_change_krw: 0, observed_spend_note: '전후 광고비 변화의 관찰 합계 · 서비스가 만든 절감액이 아님',
      spend_overlap_excluded: 0, spend_missing: 0,
      verified_profit_change: 0, verified_profit_count: 0, reference_excluded: 0, withheld: 0, actions_detail: [] };
    var picked = [];
    Object.keys(results).forEach(function(id){
      var cur = currentOf(results[id]);
      out.results_total += results[id].length; out.history_results += cur.history;
      picked.push({ id: id, cur: cur, change: changes[id] || null });
    });
    out.actions = picked.length;
    picked.forEach(function(x){
      var s = x.cur.record.result, latest = x.cur.latest.result;
      (latest.blockers || []).forEach(function(k){ if(out.hold_reasons[k] !== undefined) out.hold_reasons[k]++; }); // 보류 이유는 최신 결과 기준
      var detail = { action_id: x.id, state: x.cur.state, status: s.status, judgement_version: s.judgement_version || null };
      var isNewAd = !!(x.change && x.change.change && x.change.change.method === 'new_ad') || s.comparison === 'new_ad_vs_existing';
      if(isNewAd){ out.observed_only_new_ad++; detail.label = '새 광고 비교 · 관찰값만 · 신호 집계 제외'; out.actions_detail.push(detail); return; }
      if(x.cur.state === 'stale'){ out.stale_previous++; detail.label = '갱신 실패 · 이전 결과'; }
      else if(x.cur.state === 'unknown') out.unknown++;
      else if(s.status === 'improved' || s.status === 'worse'){
        if(s.judgement_version === JUDGEMENT_VERSION) out.signals[s.status === 'improved' ? 'cpa_better' : 'cpa_worse']++;
        else { out.legacy_results++; detail.label = '이전 판정 기준 결과 · 신호로 세지 않음'; }
      }
      else out.inconclusive++; // inconclusive · 이전 기준 small 포함
      out.actions_detail.push(detail);
      if(x.cur.state !== 'current') return; // 갱신 실패 · 판단 불가는 이익 · 지출 집계에서도 뺀다
      var p = s.profit;
      if(p && p.kind === 'actual'){ out.verified_profit_change += p.diff; out.verified_profit_count++; }
      else if(p && p.kind === 'reference') out.reference_excluded++;
      else out.withheld++;
    });
    // 지출 변화 — 현재 상태가 유효한 실행만, 같은 대상 광고 · 겹치는 변경 후 기간은 최근 실행만
    var used = [];
    picked.filter(function(x){ return x.cur.state === 'current' && !(x.change && x.change.change && x.change.change.method === 'new_ad') && x.cur.record.result.comparison !== 'new_ad_vs_existing'; }).sort(function(a, b){ return String(b.cur.record.measured_at || '').localeCompare(String(a.cur.record.measured_at || '')); }).forEach(function(x){
      var s = x.cur.record.result, c = x.change;
      if(!s.spend || s.spend.krw_diff === null || s.spend.krw_diff === undefined || !c){ out.spend_missing++; return; }
      var target = c.change && c.change.method === 'new_ad' && c.ad.new_ad_id ? c.ad.new_ad_id : c.ad.ad_id, per = c.compare.after;
      var overlap = used.some(function(u){ return u.target === target && !(per.until < u.since || per.since > u.until); });
      if(overlap){ out.spend_overlap_excluded++; return; }
      used.push({ target: target, since: per.since, until: per.until });
      out.observed_spend_change_krw += s.spend.krw_diff;
    });
    return out;
  }

  var STATUS_TEXT = { improved: '구매당 광고비 개선 신호', worse: '구매당 광고비 악화 신호', inconclusive: '판단 보류', small: '차이 작음(이전 기준)', unknown: '판단 불가' };

  function buildResultRecord(change, after, cmp, now, memo, before){
    var t = now || Date.now();
    return { id: newId(t), source: 'change_result', action_id: change.action_id, store_id: change.store_id, date: new Date(t + 9 * 3600e3).toISOString().slice(0, 10),
      name: (change.ad && change.ad.ad_name || '광고') + ' · 결과 ' + STATUS_TEXT[cmp.status], channel: '메타', measured_at: new Date(t).toISOString(),
      after: after, before: before || null, result: { judgement_version: JUDGEMENT_VERSION, status: cmp.status, comparison: cmp.comparison || null, baseline_source: cmp.baseline_source || 'saved',
        saved_baseline: cmp.saved_baseline || null, attribution: cmp.attribution || null, reasons: cmp.reasons, warnings: cmp.warnings, provisional: cmp.provisional, separable: cmp.separable,
        blockers: cmp.blockers || [], observations: cmp.observations || [], test: cmp.test || null,
        spend: cmp.spend || null, purchases: cmp.purchases || null, cpa: cmp.cpa || null, roas: cmp.roas || null, profit: cmp.profit || null,
        margin_change: cmp.marginChange || null, missing_cost: cmp.missingCost || null }, memo: String(memo || '') };
  }

  return { ELEMENTS: ELEMENTS, CONCURRENT: CONCURRENT, PROFIT_FORMULA: PROFIT_FORMULA, STATUS_TEXT: STATUS_TEXT,
    addDays: addDays, periods: periods, attributionWindowDays: attributionWindowDays, aggregate: aggregate, buildChangeRecord: buildChangeRecord, compare: compare, buildResultRecord: buildResultRecord, estProfit: estProfit, outcomeSummary: outcomeSummary, currentOf: currentOf, JUDGEMENT_VERSION: JUDGEMENT_VERSION };
});
