/* 운영 현황 "광고 기록" — Meta 하루 합계 자동 기록.

   선택된 쇼핑몰에 연결된 Meta 광고계정의 캠페인 전체 합계(meta-insights,
   level=account)를 날짜당 1건 광고 기록(tool_records, tool_type='ad_log')에
   남긴다. 기본은 광고계정 시간대 기준 어제, 날짜를 고르면 그 과거 하루.

   - 광고비: Meta spend. 매출: Meta 귀속 구매금액(action_values 원본) — 응답에
     구매금액 항목이 없으면 null(화면 "—"), 실제 0이면 0. ROAS로 매출을
     역산하지 않는다. Cafe24 주문금액과 합치지 않는다.
   - 원화(KRW) 계정만 — 광고 기록 표가 원화 고정이라 다른 통화는 저장하지 않는다.
   - 쇼핑몰 · Meta 광고계정 · 날짜당 1건(meta_auto_key). 이미 있으면 건너뛴다
     (store.js addAutoAdlogRecord + DB 유니크 인덱스 20260924150000). 기존 기록을
     수정하지 않는다.

   buildMetaAdlogRecord()는 순수 함수라 Node 테스트에서도 쓴다
   (tests/adlog-meta.test.js). index.html에서 tools.js · store.js ·
   ops-overview.js · meta-adsets-core.js 뒤에 로드한다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskAdlogMeta = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var RECORD_NAME = 'Meta 캠페인 전체 합계';

  // meta-insights 응답(data) → 광고 기록 한 건. 저장하면 안 되는 경우 { ok:false, message }.
  function buildMetaAdlogRecord(storeId, data, nowMs){
    var account = data && data.account;
    var sel = data && data.selected;
    var range = data && data.queried_range && data.queried_range.selected;
    if(!storeId || !account || !account.id || !sel || !range || !range.since){
      return { ok: false, message: 'Meta 하루 합계를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' };
    }
    if(account.currency !== 'KRW'){
      return { ok: false, message: '이 광고계정 통화는 ' + String(account.currency || '알 수 없음') + '라 원화 기준 광고 기록에 자동으로 넣지 않았어요.' };
    }
    // 구매금액 항목이 실제로 있었는지 알려주지 않는 예전 서버 응답이면 —와 0을 구분할 수 없다.
    if(typeof sel.purchase_value_observed !== 'boolean'){
      return { ok: false, message: 'Meta 요약에 구매금액 확인 정보가 없어 기록하지 않았어요.' };
    }
    return {
      ok: true,
      record: {
        id: nowMs,
        source: 'meta_auto',
        meta_auto_key: String(storeId) + '|' + String(account.id) + '|' + range.since,
        store_id: String(storeId),
        date: range.since,
        name: RECORD_NAME,
        channel: '메타',
        spend: Number(sel.spend) || 0,
        revenue: sel.purchase_value_observed ? Number(sel.purchase_value) : null,
        purchases: sel.purchase_basis ? Number(sel.purchase_count) : null,
        currency: 'KRW',
        fetched_at: new Date(nowMs).toISOString()
      }
    };
  }

  var api = { RECORD_NAME: RECORD_NAME, buildMetaAdlogRecord: buildMetaAdlogRecord };
  if(typeof document === 'undefined') return api;

  // ------------------------------------------------------------ 화면 연결
  var btn = document.getElementById('adlogMetaBtn');
  var dateEl = document.getElementById('adlogMetaDate');
  var statusEl = document.getElementById('adlogMetaStatus');
  var Ops = window.launchdeskOpsSnapshot;
  var Store = window.launchdeskStore;
  var AdsCore = window.launchdeskMetaAdsetsCore;
  if(!btn || !dateEl || !Ops || !Store) return api;

  var busy = false;
  var lastSnapshot = null;
  function setStatus(text){ if(statusEl) statusEl.textContent = text || ''; }
  function rerenderTable(){ if(window.launchdeskAdlog) window.launchdeskAdlog.render(); }
  // 날짜 입력: 오늘은 아직 끝나지 않은 날이라 고를 수 없게 어제까지, Meta 37개월 조회 한도 안.
  function syncBounds(){
    if(!AdsCore) return;
    dateEl.max = AdsCore.localDateString(Date.now() - 24 * 60 * 60 * 1000);
    dateEl.min = AdsCore.earliestDateString(Date.now());
  }
  function update(snapshot){
    lastSnapshot = snapshot || lastSnapshot;
    var s = lastSnapshot;
    var ready = !!(s && s.authed && s.storeId && s.meta && s.meta.state === 'data');
    var nonKrw = ready && s.meta.currency && s.meta.currency !== 'KRW';
    btn.disabled = busy || !ready || !!nonKrw;
    btn.textContent = 'Meta 성과 기록하기(' + (dateEl.value || '어제') + ')';
    if(nonKrw) setStatus('이 광고계정 통화는 ' + s.meta.currency + '라 원화 기준 광고 기록에 자동으로 넣을 수 없어요.');
  }

  syncBounds();
  dateEl.addEventListener('focus', syncBounds);
  dateEl.addEventListener('change', function(){
    var v = dateEl.value;
    if(v && ((dateEl.max && v > dateEl.max) || (dateEl.min && v < dateEl.min))){
      dateEl.value = '';
      setStatus('어제까지의 과거 날짜(최근 37개월 안)만 기록할 수 있어요.');
    } else {
      setStatus('');
    }
    update();
  });

  btn.addEventListener('click', function(){
    if(busy || btn.disabled) return;
    var picked = dateEl.value;
    busy = true;
    update();
    setStatus('Meta 하루 합계를 불러오는 중…');
    var request = picked ? Ops.fetchMetaDay('date', picked) : Ops.fetchMetaDay('yesterday');
    request.then(function(res){
      if(!res.ok) return { message: res.message };
      var built = buildMetaAdlogRecord(res.storeId, res.data, Date.now());
      if(!built.ok) return { message: built.message };
      var date = built.record.date;
      return Store.addAutoAdlogRecord(built.record).then(function(saved){
        if(saved.ok) return { message: date + ' Meta 하루 합계를 기록했어요.', saved: true };
        if(saved.reason === 'duplicate') return { message: date + ' 기록이 이미 있어 건너뛰었어요.' };
        if(saved.reason === 'stale') return { message: '' };
        return { message: '기록을 저장하지 못했어요. 잠시 후 다시 시도해주세요.' };
      });
    }).then(function(out){
      busy = false;
      setStatus(out.message);
      if(out.saved) rerenderTable();
      update();
    });
  });

  // 쇼핑몰 전환 · 쇼핑몰 목록 변화(삭제) · Meta 연결 상태에 맞춰 버튼과 표(쇼핑몰별
  // 합계 · 삭제된 쇼핑몰 기록 표시)를 다시 맞춘다.
  function storesKey(s){ return s ? (String(s.storeId) + '|' + (s.storeIds ? s.storeIds.join(',') : '?')) : ''; }
  Ops.subscribe(function(snapshot){
    var storeChanged = !lastSnapshot || String(lastSnapshot.storeId) !== String(snapshot.storeId);
    var listChanged = storesKey(lastSnapshot) !== storesKey(snapshot);
    if(storeChanged && !busy) setStatus('');
    update(snapshot);
    if(listChanged) rerenderTable();
  });

  return api;
});
