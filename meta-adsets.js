/* 운영 현황(#/dashboard) — Meta 광고 세트 · 광고별 성과 패널 연결 파일.

   계산·포맷·HTML 생성은 전부 meta-adsets-core.js(순수 모듈)가 하고, 이
   파일은 (1) ops-overview.js가 내보내는 launchdeskOpsSnapshot을 구독해
   "언제 조회할지"를 정하고, (2) supabase functions.invoke를 core에 주입하고,
   (3) 결과 HTML을 #metaAdsetsBody에 그리고 클릭을 core에 넘기는 일만 한다.

   호출 조건: 운영 현황 경로이고, 쇼핑몰(storeId)이 선택돼 있고, 기존 계정
   요약(meta-insights)이 성공해 meta.state==='data'가 된 "그 시점". 계정
   요약이 다시 불러오는 중이었다가 성공으로 돌아올 때마다(진입·새로고침)
   그때 한 번만 확인하고, 캐시가 신선하면 호출하지 않는다.

   광고 데이터는 메모리(core 컨트롤러)에만 있다 — DB · 브라우저 저장소에
   쓰지 않는다. index.html에서 ops-overview.js · meta-adsets-core.js 뒤에
   로드해야 한다. */
(function(){
  var Core = window.launchdeskMetaAdsetsCore;
  var panel = document.getElementById('metaAdsetsPanel');
  var bodyEl = document.getElementById('metaAdsetsBody');
  var statusEl = document.getElementById('metaAdsetsStatus');
  var refreshBtn = document.getElementById('metaAdsetsRefresh');
  var globalRefreshBtn = document.getElementById('opsdashRefreshBtn');
  var periodBtns = panel ? panel.querySelectorAll('[data-madsets-period]') : [];
  if(!Core || !panel || !bodyEl || !window.launchdeskOpsSnapshot){ return; }

  function client(){ return window.launchdeskSupabase || null; }

  function invoke(body){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, code: 'TEMPORARY_ERROR' });
    return sb.functions.invoke('meta-adset-insights', { body: body }).then(Core.normalizeInvokeResult);
  }

  var ctl = Core.createController({ invoke: invoke, onChange: render });

  function isDashboardRoute(){
    return (location.hash.replace(/^#/, '') || '/') === '/dashboard';
  }

  var lastHtml = null;
  var lastStatus = null;
  function render(){
    var view = ctl.getView();

    Array.prototype.forEach.call(periodBtns, function(btn){
      btn.setAttribute('aria-pressed', btn.getAttribute('data-madsets-period') === view.period ? 'true' : 'false');
    });
    bodyEl.setAttribute('aria-busy', (view.status === 'ready' || view.status === 'error') ? 'false' : 'true');
    if(statusEl){
      var text = Core.statusText(view);
      if(text !== lastStatus){ statusEl.textContent = text; lastStatus = text; }
    }

    var html = Core.renderBody(view);
    if(html === lastHtml) return; // 같은 내용이면 DOM을 건드리지 않는다(포커스 · 스크린리더 안정)
    var active = document.activeElement;
    var focusKey = (active && bodyEl.contains(active)) ? active.getAttribute('data-mf') : null;
    bodyEl.innerHTML = html;
    lastHtml = html;
    if(focusKey){
      var again = bodyEl.querySelector('[data-mf="' + focusKey + '"]');
      if(again) again.focus();
    }
  }

  // 조회 시점 판단 — 계정 요약이 성공 상태로 "들어오는" 순간에만 확인한다.
  var wasReady = false;
  function onSnapshot(snapshot){
    var storeId = (snapshot && snapshot.storeId) || null;
    var metaState = snapshot && snapshot.meta ? snapshot.meta.state : null;
    var ready = !!storeId && metaState === 'data';

    // 쇼핑몰이 바뀌거나 로그아웃하면 전부 초기화. 같은 로그인 사용자의 재조회 중
    // 잠깐 null이 되는 경우는 초기화하지 않는다(core sync 참고).
    var authed = !!(window.launchdeskStore && window.launchdeskStore.isAuthed());
    ctl.sync(storeId, authed);
    panel.hidden = !ready;
    var becameReady = ready && !wasReady;
    wasReady = ready;
    if(becameReady && isDashboardRoute()) ctl.ensureList();
    render();
  }

  Array.prototype.forEach.call(periodBtns, function(btn){
    btn.addEventListener('click', function(){ ctl.setPeriod(btn.getAttribute('data-madsets-period')); });
  });
  if(refreshBtn){
    refreshBtn.addEventListener('click', function(){ ctl.refresh(); });
  }
  // 운영 현황 상단의 전역 새로고침 — 이 파일은 그 버튼 자체를 바꾸지 않고
  // 클릭만 구독해 캐시를 비운다. 이어서 계정 요약이 다시 성공하면 위 흐름이
  // 새로 조회한다.
  if(globalRefreshBtn){
    globalRefreshBtn.addEventListener('click', function(){ ctl.invalidate(); });
  }

  bodyEl.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if(!btn || !bodyEl.contains(btn)) return;
    if(btn.classList.contains('madsets-toggle')){
      ctl.toggle(btn.getAttribute('data-mk'));
    } else if(btn.getAttribute('data-madsets-retry') === 'ads'){
      ctl.retryAds(btn.getAttribute('data-mk'));
    } else if(btn.getAttribute('data-madsets-retry') === 'list'){
      ctl.ensureList();
    }
  });

  window.launchdeskOpsSnapshot.subscribe(onSnapshot);
})();
