/* 운영 현황(#/dashboard) 상단 기간 선택 — 순수 로직 모듈(DOM · 네트워크 없음).

   ops-overview.js(조회)와 home-dashboard.js(표시)가 같은 규칙을 쓰고,
   tests/ops-period-core.test.js가 값으로 검증한다. 브라우저에서는
   window.launchdeskOpsPeriodCore, Node에서는 module.exports.

   날짜는 전부 한국시간(KST) 달력 기준이다 — Cafe24 주문 동기화
   (cafe24-orders-sync)와 ops-overview.js의 집계가 KST로 날짜를 자르기
   때문이다. Meta 수치는 서버가 광고계정 시간대로 따로 계산한다.

   Cafe24 주문이 어디까지 채워졌는지는 cafe24-orders-sync가 기록한
   connected_accounts.orders_synced_from(이 날짜부터 last_synced_at까지 빠짐없이
   동기화됨)만 근거로 삼는다. 기록이 없거나 그보다 이른 날짜는 last_synced_at만
   보고 채워졌다고 추정하지 않고 "0건"이 아니라 "확인 전"으로 다룬다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskOpsPeriodCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  // cafe24-orders-sync의 INCREMENTAL_OVERLAP_DAYS와 같은 값이어야 한다.
  var SYNC_OVERLAP_DAYS = 14;
  // cafe24-orders-sync는 한 번에 최대 3개월 범위만 받는다(rangeIsWithinThreeMonths).
  // 달마다 길이가 달라 "3개월"의 최소 길이(89일)보다 하루 짧게 잡는다.
  var SYNC_MAX_DAYS_BACK = 88;
  var LABELS = { today: '오늘', yesterday: '어제', month: '이번 달' };

  function kstDate(ms){ return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10); }
  function addDays(ymd, n){
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function monthStart(ymd){ return ymd.slice(0, 8) + '01'; }
  function isDateString(v){
    if(typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var p = v.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  // KST 자정의 실제 순간(ISO) — orders.ordered_at 범위 조회용.
  function kstMidnightIso(ymd){ return new Date(Date.parse(ymd + 'T00:00:00+09:00')).toISOString(); }

  // 기간 → KST 날짜 범위. 날짜 선택은 하루, 오늘 이후는 거부(null).
  function resolve(period, date, nowMs){
    var today = kstDate(nowMs);
    if(period === 'today') return { period: period, date: null, since: today, until: today, label: LABELS.today };
    if(period === 'yesterday'){
      var y = addDays(today, -1);
      return { period: period, date: null, since: y, until: y, label: LABELS.yesterday };
    }
    if(period === 'month') return { period: period, date: null, since: monthStart(today), until: today, label: LABELS.month };
    if(period === 'date' && isDateString(date) && date <= today) return { period: period, date: date, since: date, until: date, label: date };
    return null;
  }

  function queryBounds(range){
    return { gte: kstMidnightIso(range.since), lt: kstMidnightIso(addDays(range.until, 1)) };
  }

  // 새로고침 때 동기화할 범위(끝은 항상 오늘). 시작일은 다음 중 가장 이른 날:
  //   - 오늘 − 14일(최근 주문의 취소 · 환불 등 상태 변경을 다시 받기 위함)
  //   - 이번 달 1일(이번 달 요약) · 선택 기간 시작일
  //   - 마지막 동기화 날짜(기존 기록과 이어 붙여 기록 범위가 끊기지 않게)
  // 서버 3개월 상한 밖(오늘 − 88일보다 이전)인 날짜는 넣지 않는다 — 선택 기간이
  // 그 밖이면 outside로 알린다.
  function syncPlan(range, nowMs, lastSyncedAt){
    var today = kstDate(nowMs);
    var floor = addDays(today, -SYNC_MAX_DAYS_BACK);
    var start = addDays(today, -SYNC_OVERLAP_DAYS);
    function consider(d){ if(isDateString(d) && d >= floor && d < start) start = d; }
    consider(monthStart(today));
    var outside = !!range && range.since < floor;
    if(range && !outside) consider(range.since);
    var lastMs = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
    if(!isNaN(lastMs)) consider(kstDate(lastMs));
    return { start_date: start, end_date: today, outside: outside };
  }

  // syncedFrom = connected_accounts.orders_synced_from(기록된 연속 동기화 시작일)
  // 'full'    — 기간 전체가 기록 범위 안
  // 'partial' — 마지막 동기화 시각까지만(그 이후 주문은 아직 없음)
  // 'none'    — 기간 전체가 마지막 동기화 이후(또는 동기화한 적 없음)
  // 'unknown' — 기록이 없거나, 기간 일부가 기록 시작일보다 이전
  function coverage(range, lastSyncedAt, syncedFrom){
    if(!range) return 'unknown';
    var lastMs = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
    if(isNaN(lastMs)) return 'none';
    var lastDay = kstDate(lastMs);
    if(range.since > lastDay) return 'none';
    if(!isDateString(syncedFrom) || range.since < syncedFrom) return 'unknown';
    if(range.until >= lastDay) return 'partial';
    return 'full';
  }

  return {
    SYNC_OVERLAP_DAYS: SYNC_OVERLAP_DAYS,
    SYNC_MAX_DAYS_BACK: SYNC_MAX_DAYS_BACK,
    LABELS: LABELS,
    kstDate: kstDate, addDays: addDays, isDateString: isDateString,
    resolve: resolve, queryBounds: queryBounds, syncPlan: syncPlan, coverage: coverage
  };
});
