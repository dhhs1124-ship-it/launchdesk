/* 광고 기록 확장 — AI 개선안 → 실행 기록(변경 기록) → 결과 비교. 순수 함수만 둔다(화면 · DB는 adlog.js).
   - 변경 기록: tool_records(tool_type='ad_log') data.source='change'. 금액 칸(spend · revenue)이 없어 합계에 들어가지 않는다.
   - 결과 기록: data.source='change_result', action_id로 변경 기록을 가리킨다. 기존 기록은 고치지 않고 덧붙인다.
   - 결과는 세 가지를 따로 계산하고 서로 더하지 않는다.
     ① 실제 지출 변화(같은 길이 · 같은 통화)  ② 같은 계산 범위의 예상 이익 변화(변경 기록 당시 상품 마진 · 환율 기준)
     ③ 계산에서 발견한 비용 누락(연결 마진이 그 뒤 낮아진 경우 — 절약액이 아니라 계산 정정)
   - 광고비가 줄었어도 구매 · 매출 · 예상 이익이 함께 줄면 개선으로 표시하지 않는다. 전후 비교는 인과를 증명하지 않는다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.LaunchRoasAdlogChange = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var ELEMENTS = ['문구', '이미지', '영상 첫 장면', '영상 자막', '타깃', '예산', '랜딩 페이지', '기타'];
  var CONCURRENT = ['예산', '할인', '상품', '타깃', '게재 위치', '기타'];
  var PROFIT_FORMULA = 'ad-profit-v1: 주문당 광고 전 잔액 × 구매 수 − 광고비(원화)';
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

  // 결과 비교. after: aggregate() 결과, afterBasis: 지금의 계산 기준, today: 'YYYY-MM-DD'(한국 날짜)
  function compare(change, after, afterBasis, today){
    var b = change.baseline.metrics, basis = change.basis, w = [], reasons = [], ab = afterBasis || {};
    var res = { status: 'unknown', reasons: reasons, warnings: w, provisional: false, separable: !(change.concurrent && change.concurrent.length) };
    if(after.until >= today){ reasons.push('비교 기간이 아직 끝나지 않았어요(' + after.until + '까지)'); return res; }
    if(after.days !== b.days){ reasons.push('전후 기간 길이가 달라 비교하지 않아요'); return res; }
    if(after.missing_days || b.missing_days){ reasons.push('지표를 조회하지 못한 날이 있어 비교하지 않아요'); return res; }
    if(ab.currency && ab.currency !== basis.currency){ reasons.push('광고계정 통화가 바뀌어 비교하지 않아요'); return res; }
    if(ab.attribution && ab.attribution !== basis.attribution){ reasons.push('귀속 기준이 바뀌어 비교하지 않아요'); return res; }
    if(daysBetween(after.until, today) <= 3) { res.provisional = true; w.push('최근 3일 안의 구매는 귀속 지연으로 늘어날 수 있어 잠정 결과예요'); }
    if(!res.separable) w.push('같은 기간에 함께 바뀐 조건(' + change.concurrent.join(' · ') + ')이 있어 이 변경의 효과만 따로 볼 수 없어요');
    w.push('전후 비교라 다른 요인(계절 · 행사 · 경쟁 등)의 영향을 배제하지 못해요');

    // ① 실제 지출 변화
    var fx = basis.currency === 'KRW' ? 1 : num(basis.fx_krw_per_unit);
    res.spend = { before: b.spend, after: after.spend, diff: after.spend - b.spend, currency: basis.currency,
      krw_diff: fx ? Math.round((after.spend - b.spend) * fx) : null };
    // ② 같은 계산 범위의 예상 이익
    var p0 = estProfit(b, basis), p1 = estProfit(after, basis);
    res.profit = p0 === null || p1 === null ? null : { before: p0, after: p1, diff: p1 - p0, basis: '변경 기록 당시 상품 마진 · 환율 기준' };
    // ③ 비용 누락 발견 — 연결 마진이 낮아졌으면 계산 정정(절약액 아님)
    var m0 = basis.margin, m1 = ab.margin;
    res.missingCost = m0 && m1 && num(m0.pre_ad) !== null && num(m1.pre_ad) !== null && m1.pre_ad < m0.pre_ad
      ? { before_per_order: m0.pre_ad, now_per_order: m1.pre_ad, per_order: m0.pre_ad - m1.pre_ad, note: '빠졌던 비용을 계산에 넣은 것 · 절약액이 아니며 ①②와 더하지 않아요' } : null;
    if(m0 && m1 && m0.source_saved_at !== m1.source_saved_at && !res.missingCost) w.push('변경 뒤 상품 마진이 바뀌었어요 · 이익 비교는 변경 기록 당시 마진으로 계산했어요');

    // 판정 — 구매가 측정되지 않았거나 표본이 작으면 판단 불가
    var buy0 = b.purchases, buy1 = after.purchases;
    if(!buy0.observed || !buy1.observed){ reasons.push('구매가 측정되지 않은 기간이 있어 판단하지 않아요'); return res; }
    if(buy0.value + buy1.value < 3){ reasons.push('전후 구매가 합쳐 ' + (buy0.value + buy1.value) + '건이라 표본이 작아요'); return res; }
    var buyDown = buy1.value < buy0.value, spendDown = after.spend < b.spend;
    var valueDown = b.purchase_value.observed && after.purchase_value.observed && after.purchase_value.value < b.purchase_value.value;
    if(res.profit){
      var rel = Math.abs(res.profit.diff) / Math.max(1, Math.abs(res.profit.before));
      if(res.profit.diff > 0 && !buyDown && rel >= 0.05){ res.status = 'improved'; reasons.push('같은 계산 범위의 예상 이익이 늘었고 구매도 줄지 않았어요'); }
      else if(res.profit.diff < 0 && rel >= 0.05){ res.status = 'worse'; reasons.push('같은 계산 범위의 예상 이익이 줄었어요'); }
      else { res.status = 'small'; reasons.push(res.profit.diff > 0 && buyDown ? '예상 이익은 늘었지만 구매가 줄어 개선으로 보지 않아요' : '예상 이익 차이가 작아요(5% 미만)'); }
    } else if(b.roas !== null && after.roas !== null){
      var r = (after.roas - b.roas) / Math.max(0.0001, b.roas);
      if(r >= 0.1 && !buyDown){ res.status = 'improved'; reasons.push('ROAS가 올랐고 구매도 줄지 않았어요 · 상품 마진이 연결되지 않아 이익은 계산하지 않았어요'); }
      else if(r <= -0.1){ res.status = 'worse'; reasons.push('ROAS가 낮아졌어요'); }
      else { res.status = 'small'; reasons.push('ROAS 차이가 작거나 구매가 줄었어요'); }
    } else { reasons.push('구매금액 · 상품 마진이 없어 효율을 비교할 수 없어요'); return res; }
    if(spendDown && (buyDown || valueDown) && res.status === 'improved'){ res.status = 'small'; reasons.push('광고비와 함께 구매 · 매출도 줄어 개선으로 보지 않아요'); }
    if(spendDown && res.status !== 'improved') w.push('광고비 감소는 ①지출 변화로만 기록해요 · 개선 성공이 아니에요');
    return res;
  }

  var STATUS_TEXT = { improved: '개선', worse: '악화', small: '차이 작음', unknown: '판단 불가' };

  function buildResultRecord(change, after, cmp, now, memo){
    var t = now || Date.now();
    return { id: newId(t), source: 'change_result', action_id: change.action_id, store_id: change.store_id, date: new Date(t + 9 * 3600e3).toISOString().slice(0, 10),
      name: (change.ad && change.ad.ad_name || '광고') + ' · 결과 ' + STATUS_TEXT[cmp.status], channel: '메타', measured_at: new Date(t).toISOString(),
      after: after, result: { status: cmp.status, reasons: cmp.reasons, warnings: cmp.warnings, provisional: cmp.provisional, separable: cmp.separable,
        spend: cmp.spend || null, profit: cmp.profit || null, missing_cost: cmp.missingCost || null }, memo: String(memo || '') };
  }

  return { ELEMENTS: ELEMENTS, CONCURRENT: CONCURRENT, PROFIT_FORMULA: PROFIT_FORMULA, STATUS_TEXT: STATUS_TEXT,
    addDays: addDays, periods: periods, aggregate: aggregate, buildChangeRecord: buildChangeRecord, compare: compare, buildResultRecord: buildResultRecord, estProfit: estProfit };
});
