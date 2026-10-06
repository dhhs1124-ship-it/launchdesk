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
  var PROFIT_FORMULA = 'ad-profit-reference-v1: 연결 상품 주문당 광고 전 잔액 × Meta 귀속 구매 수 − 광고비(원화) · 참고 계산';
  var DAY = 864e5;

  function addDays(iso, n){ return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function daysBetween(a, b){ return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) + 1; }
  function num(v){ return typeof v === 'number' && isFinite(v) ? v : null; }

  // 변경 전 · 후 비교 기간 — 같은 길이(days). 변경 후 기간은 시작일부터.
  function periods(startDate, days){
    return { before: { since: addDays(startDate, -days), until: addDays(startDate, -1) }, after: { since: startDate, until: addDays(startDate, days - 1) } };
  }

  // 하루 단위 광고 지표(meta-adset-insights scope=ads의 metrics) 합산. rows: [{date, metrics|null}]
  // 구매 · 구매금액은 하루라도 측정된 날이 있어야 측정으로 본다. 조회 실패한 날은 missing_days.
  function aggregate(rows, since, until){
    var want = daysBetween(since, until), seen = {}, spend = 0, imp = 0, clicks = 0, buy = 0, value = 0, buyObs = false, valObs = false;
    (rows || []).forEach(function(r){
      if(!r || !r.date || r.date < since || r.date > until || seen[r.date]) return;
      seen[r.date] = true;
      var m = r.metrics;
      if(!m) return; // 그날 광고 집행 없음(행 없음) = 0
      spend += num(m.spend) || 0; imp += num(m.impressions) || 0; clicks += num(m.link_clicks) || 0;
      if(m.purchase && m.purchase.observed){ buyObs = true; buy += num(m.purchase.value) || 0; }
      if(m.purchase_value && m.purchase_value.observed){ valObs = true; value += num(m.purchase_value.value) || 0; }
    });
    var got = Object.keys(seen).length;
    return { since: since, until: until, days: want, missing_days: want - got, spend: spend, impressions: imp, link_clicks: clicks,
      purchases: { value: buy, observed: buyObs }, purchase_value: { value: value, observed: valObs },
      link_ctr: imp > 0 ? clicks / imp * 100 : null, link_cpc: clicks > 0 ? spend / clicks : null,
      roas: spend > 0 && valObs ? value / spend : null };
  }

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
    if(i.method === 'new_ad' && !/^\d+$/.test(String(i.newAdId || ''))) e.push('새 광고 ID');
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
  // - status(확인): improved(개선 확인) · worse(악화 확인) · inconclusive(판단 보류) · unknown(비교 불가)
  //   확인은 비교 조건이 맞고(잠정 아님 · 함께 바뀐 조건 없음) 같은 광고비당 구매 비율 차이가 우연 범위(단측 p < 0.05)를 벗어날 때만.
  //   구매가 줄었으면 효율이 좋아져도 개선으로 확인하지 않는다. 광고비만 줄어든 것은 개선이 아니다.
  //   가정: 광고비 1원당 구매가 독립적으로 일어난다고 보는 단순 모형(포아송) — 귀속 변동 · 시즌 영향은 반영하지 못한다.
  function compare(change, after, afterBasis, today, opts){
    var b = change.baseline.metrics, basis = change.basis, w = [], reasons = [], ab = afterBasis || {}, o = opts || {};
    var res = { status: 'unknown', reasons: reasons, warnings: w, provisional: false, separable: !(change.concurrent && change.concurrent.length), blockers: [] };
    if(after.until >= today){ reasons.push('비교 기간이 아직 끝나지 않았어요(' + after.until + '까지)'); res.blockers.push('period_open'); return res; }
    if(after.days !== b.days){ reasons.push('전후 기간 길이가 달라 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    if(after.missing_days || b.missing_days){ reasons.push('지표를 조회하지 못한 날이 있어 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    if(ab.currency && ab.currency !== basis.currency){ reasons.push('광고계정 통화가 바뀌어 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    if(ab.attribution && ab.attribution !== basis.attribution){ reasons.push('귀속 기준이 바뀌어 비교하지 않아요'); res.blockers.push('condition_mismatch'); return res; }
    if(daysBetween(after.until, today) <= 3){ res.provisional = true; res.blockers.push('provisional'); w.push('최근 3일 안의 구매는 귀속 지연으로 늘어날 수 있어 잠정 결과예요'); }
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
    if(res.provisional || !res.separable){
      res.status = 'inconclusive';
      reasons.push(res.provisional ? '귀속 지연 기간이 포함돼 개선 여부를 확정하지 않아요' : '함께 바뀐 조건이 있어 개선 여부를 확정하지 않아요');
      if(after.spend < b.spend) w.push('광고비 감소는 지출 변화로만 기록해요 · 개선 성공이 아니에요');
      return res;
    }
    if(better && buy1.value >= buy0.value){ res.status = 'improved'; reasons.push('같은 광고비당 구매가 늘었고 우연한 변동으로 보기 어려운 차이예요(단측 p=' + res.test.p_better + ')'); }
    else if(worse){ res.status = 'worse'; reasons.push('같은 광고비당 구매가 줄었고 우연한 변동으로 보기 어려운 차이예요(단측 p=' + res.test.p_worse + ')'); }
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
  // - 실행(action_id)별 최신 유효 결과 1건만 센다(판단 불가 결과는 유효 결과가 없을 때만). 이전 결과는 history_results로 남긴다
  // - 확정(개선 확인 · 악화 확인)과 판단 보류 · 판단 불가를 나눠 세고, 보류 이유(잠정 · 효과 분리 불가 · 비교 조건 불일치 · 표본 불확실)를 따로 센다
  // - 지출 변화는 같은 광고 · 겹치는 변경 후 기간이면 가장 최근 실행 1건만 더한다. 이 합계는 전후 관찰값이며 서비스가 만든 절감액이 아니다
  // - 참고 계산 · 계산 보류 이익은 검증된 이익에서 뺀다
  function outcomeSummary(records){
    var changes = {}, results = {};
    (records || []).forEach(function(r){
      if(!r) return;
      if(r.source === 'change' && r.action_id) changes[r.action_id] = r;
      else if(r.source === 'change_result' && r.action_id && r.result) (results[r.action_id] = results[r.action_id] || []).push(r);
    });
    var out = { actions: 0, results_total: 0, history_results: 0,
      confirmed: { improved: 0, worse: 0 }, inconclusive: 0, unknown: 0,
      hold_reasons: { provisional: 0, not_separable: 0, condition_mismatch: 0, sample_uncertain: 0 },
      observed_spend_change_krw: 0, observed_spend_note: '전후 광고비 변화의 관찰 합계 · 서비스가 만든 절감액이 아님',
      spend_overlap_excluded: 0, spend_missing: 0,
      verified_profit_change: 0, verified_profit_count: 0, reference_excluded: 0, withheld: 0 };
    var picked = [];
    Object.keys(results).forEach(function(id){
      var list = results[id].slice().sort(function(a, b){ return String(a.measured_at || '').localeCompare(String(b.measured_at || '')); });
      out.results_total += list.length;
      var valid = list.filter(function(r){ return r.result.status !== 'unknown'; });
      var latest = (valid.length ? valid : list)[(valid.length ? valid : list).length - 1];
      out.history_results += list.length - 1;
      picked.push({ id: id, r: latest, change: changes[id] || null });
    });
    out.actions = picked.length;
    picked.forEach(function(x){
      var s = x.r.result;
      if(s.status === 'improved' || s.status === 'worse') out.confirmed[s.status]++;
      else if(s.status === 'unknown') out.unknown++;
      else out.inconclusive++; // inconclusive · 이전 기준 small 포함
      (s.blockers || []).forEach(function(k){ if(out.hold_reasons[k] !== undefined) out.hold_reasons[k]++; });
      var p = s.profit;
      if(p && p.kind === 'actual'){ out.verified_profit_change += p.diff; out.verified_profit_count++; }
      else if(p && p.kind === 'reference') out.reference_excluded++;
      else out.withheld++;
    });
    // 지출 변화 — 같은 대상 광고 · 겹치는 변경 후 기간은 최근 실행만
    var used = [];
    picked.slice().sort(function(a, b){ return String(b.r.measured_at || '').localeCompare(String(a.r.measured_at || '')); }).forEach(function(x){
      var s = x.r.result, c = x.change;
      if(!s.spend || s.spend.krw_diff === null || s.spend.krw_diff === undefined || !c){ out.spend_missing++; return; }
      var target = c.change && c.change.method === 'new_ad' && c.ad.new_ad_id ? c.ad.new_ad_id : c.ad.ad_id, per = c.compare.after;
      var overlap = used.some(function(u){ return u.target === target && !(per.until < u.since || per.since > u.until); });
      if(overlap){ out.spend_overlap_excluded++; return; }
      used.push({ target: target, since: per.since, until: per.until });
      out.observed_spend_change_krw += s.spend.krw_diff;
    });
    return out;
  }

  var STATUS_TEXT = { improved: '개선 확인', worse: '악화 확인', inconclusive: '판단 보류', small: '차이 작음(이전 기준)', unknown: '판단 불가' };

  function buildResultRecord(change, after, cmp, now, memo){
    var t = now || Date.now();
    return { id: newId(t), source: 'change_result', action_id: change.action_id, store_id: change.store_id, date: new Date(t + 9 * 3600e3).toISOString().slice(0, 10),
      name: (change.ad && change.ad.ad_name || '광고') + ' · 결과 ' + STATUS_TEXT[cmp.status], channel: '메타', measured_at: new Date(t).toISOString(),
      after: after, result: { status: cmp.status, reasons: cmp.reasons, warnings: cmp.warnings, provisional: cmp.provisional, separable: cmp.separable,
        blockers: cmp.blockers || [], observations: cmp.observations || [], test: cmp.test || null,
        spend: cmp.spend || null, purchases: cmp.purchases || null, cpa: cmp.cpa || null, roas: cmp.roas || null, profit: cmp.profit || null,
        margin_change: cmp.marginChange || null, missing_cost: cmp.missingCost || null }, memo: String(memo || '') };
  }

  return { ELEMENTS: ELEMENTS, CONCURRENT: CONCURRENT, PROFIT_FORMULA: PROFIT_FORMULA, STATUS_TEXT: STATUS_TEXT,
    addDays: addDays, periods: periods, aggregate: aggregate, buildChangeRecord: buildChangeRecord, compare: compare, buildResultRecord: buildResultRecord, estProfit: estProfit, outcomeSummary: outcomeSummary };
});
