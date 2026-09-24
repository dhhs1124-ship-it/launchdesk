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
   쓰지 않는다. index.html에서 ops-overview.js · meta-adsets-core.js ·
   meta-margin-core.js 뒤에 로드해야 한다.

   ------------------------------------------------------------------------
   광고 세트 손익분기 기준 연결(ad_margin_links) — 이 파일이 유일하게 DB에
   쓰는 부분이다. 광고 성과 자체(광고비 · ROAS · 구매 등)는 여전히 저장하지
   않는다 — 저장하는 것은 사용자가 명시적으로 선택·확인한 마진 계산
   스냅샷(product_label, calc_version, currency, total_income, pre_ad,
   source_saved_at)뿐이다(meta-margin-core.js buildSnapshotForSave의
   schema allowlist).

   원본 Meta adset_id는 이 파일의 지역 변수(linksState.byId, 로컬 카드키
   mk → 원본 id는 ctl.adsetIdOf(mk))에만 있다. HTML/DOM 속성에는 항상 mk만
   싣고, console에도 store_id/adset_id/스냅샷 값/사용자 입력을 남기지
   않는다(오류 로그는 err.message 같은 일반 문자열만).

   이름 기반 자동 매칭 · 최신 계산 자동 선택은 없다 — 사용자가 모달에서
   기록을 직접 눌러야만 연결이 만들어진다. */
(function(){
  var Core = window.launchdeskMetaAdsetsCore;
  var MarginCore = window.launchdeskMetaMarginCore;
  var panel = document.getElementById('metaAdsetsPanel');
  var bodyEl = document.getElementById('metaAdsetsBody');
  var statusEl = document.getElementById('metaAdsetsStatus');
  var refreshBtn = document.getElementById('metaAdsetsRefresh');
  var globalRefreshBtn = document.getElementById('opsdashRefreshBtn');
  var periodBtns = panel ? panel.querySelectorAll('[data-madsets-period]') : [];
  var dateInput = document.getElementById('metaAdsetsDate');
  if(!Core || !MarginCore || !panel || !bodyEl || !window.launchdeskOpsSnapshot){ return; }

  var toastStack = document.getElementById('toastStack');
  function showToast(message, type){
    if(!toastStack) return;
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

  // ---------------------------------------------------------------------
  // 광고 세트 손익분기 기준 연결 — DB 상태(원본 adset_id 기준, 이 클로저
  // 밖으로 절대 나가지 않는다).
  // ---------------------------------------------------------------------
  var linksState = { storeId: null, epoch: 0, loading: false, loadedFor: null, byId: {} };
  var linkDisconnectInFlight = {}; // mk → true

  function resetLinksState(){
    linksState.epoch += 1;
    linksState.storeId = null;
    linksState.loading = false;
    linksState.loadedFor = null;
    linksState.byId = {};
    linkDisconnectInFlight = {};
  }
  // ctl.sync와 같은 규칙 — 같은 로그인 사용자의 재조회 중 잠깐 null이 되는
  // 경우는 유지하고, 진짜 다른 쇼핑몰이거나 로그아웃일 때만 초기화한다.
  function syncLinksStore(storeId, authed){
    var next = (storeId === undefined || storeId === null || storeId === '') ? null : storeId;
    if(next === null && authed) return false;
    if(next === linksState.storeId) return false;
    resetLinksState();
    linksState.storeId = next;
    return true;
  }

  function fetchLinks(storeId){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, rows: [] });
    return sb.from('ad_margin_links')
      .select('meta_adset_id, product_label, calc_version, currency, total_income, pre_ad, source_saved_at, confirmed_at')
      .eq('store_id', storeId)
      .then(function(res){
        if(res.error) return { ok: false, rows: [] };
        return { ok: true, rows: res.data || [] };
      })
      .catch(function(){ return { ok: false, rows: [] }; });
  }
  function ensureLinksLoaded(){
    var storeId = linksState.storeId;
    if(!storeId || linksState.loading || linksState.loadedFor === storeId) return;
    linksState.loading = true;
    var myEpoch = linksState.epoch;
    fetchLinks(storeId).then(function(res){
      if(myEpoch !== linksState.epoch || linksState.storeId !== storeId) return; // stale(쇼핑몰 변경/로그아웃)
      linksState.loading = false;
      if(res.ok){
        var map = {};
        res.rows.forEach(function(row){ map[String(row.meta_adset_id)] = row; });
        linksState.byId = map;
        linksState.loadedFor = storeId;
      }
      render();
    });
  }

  function saveLink(storeId, adsetId, snapshotValue){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    var payload = Object.assign({ store_id: storeId, meta_adset_id: adsetId }, snapshotValue);
    return sb.from('ad_margin_links')
      .upsert(payload, { onConflict: 'store_id,meta_adset_id' })
      .select('meta_adset_id, product_label, calc_version, currency, total_income, pre_ad, source_saved_at, confirmed_at')
      .single()
      .then(function(res){
        if(res.error || !res.data) return { ok: false };
        return { ok: true, row: res.data };
      })
      .catch(function(){ return { ok: false }; });
  }
  function deleteLink(storeId, adsetId){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    return sb.from('ad_margin_links').delete()
      .eq('store_id', storeId).eq('meta_adset_id', adsetId)
      .then(function(res){ return { ok: !res.error }; })
      .catch(function(){ return { ok: false }; });
  }

  function findAdsetByKey(view, mk){
    if(!view || !view.vm) return null;
    for(var ci = 0; ci < view.vm.campaigns.length; ci++){
      var adsets = view.vm.campaigns[ci].adsets;
      for(var ai = 0; ai < adsets.length; ai++){
        if(adsets[ai].key === mk) return adsets[ai];
      }
    }
    return null;
  }

  // view.vm(뷰모델) + linksState(DB, 원본 id 기준) → view.links(mk 기준
  // 표시용 값). meta-adsets-core.js의 renderAdset은 이 결과만 읽는다 —
  // 원본 id는 이 함수 밖으로 나가지 않는다.
  function buildLinksView(view){
    var links = {};
    if(!view || !view.vm) return links;
    view.vm.campaigns.forEach(function(c){
      c.adsets.forEach(function(a){
        var mk = a.key;
        var rawId = ctl.adsetIdOf(mk);
        var row = rawId ? linksState.byId[String(rawId)] : null;
        if(!row){ links[mk] = { connected: false }; return; }
        var breakeven = MarginCore.computeBreakeven(row.total_income, row.pre_ad);
        var hasCurrent = a.roasRatio !== null && a.roasRatio !== undefined;
        var compare = (breakeven.ok && hasCurrent) ? MarginCore.compareRoas(a.roasRatio, breakeven.ratio) : null;
        links[mk] = {
          connected: true,
          productLabel: row.product_label,
          breakeven: breakeven,
          compare: compare,
          disconnecting: !!linkDisconnectInFlight[mk]
        };
      });
    });
    return links;
  }

  function platformLabelOf(code){
    var MC = window.launchdeskMarginCalc;
    var g = (code && MC && MC.PLATFORM_GUIDE) ? MC.PLATFORM_GUIDE[code] : null;
    return g ? g.name : (code || '플랫폼 미입력');
  }

  var lastHtml = null;
  var lastStatus = null;
  function render(){
    var view = ctl.getView();
    view.links = buildLinksView(view);

    Array.prototype.forEach.call(periodBtns, function(btn){
      btn.setAttribute('aria-pressed', btn.getAttribute('data-madsets-period') === view.period ? 'true' : 'false');
    });
    if(dateInput){
      // 쇼핑몰 전환 등으로 기간이 초기화되면 입력칸도 비운다(이전 날짜가 남지 않게).
      var picked = view.period === 'date' ? view.date : '';
      if(dateInput.value !== picked) dateInput.value = picked;
      dateInput.classList.toggle('is-active', view.period === 'date');
    }
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

  // ---------------------------------------------------------------------
  // 손익분기 기준 연결 모달 — 정적 마크업은 index.html의 #marginLinkModal.
  // 선택 → 상품 구분용 이름 입력 두 단계만 있고, 최종 확인은 window.confirm
  // (기존 앱의 연결 해제 · 삭제 확인과 같은 방식)이다.
  // ---------------------------------------------------------------------
  var marginLinkModal = document.getElementById('marginLinkModal');
  var marginLinkBody = document.getElementById('marginLinkBody');
  var marginLinkClose = document.getElementById('marginLinkClose');
  var marginLinkBackdrop = document.getElementById('marginLinkBackdrop');
  var linkModalState = null; // null = 닫힘
  var linkModalOpenerEl = null; // 포커스 복원 대상(연 버튼)

  function renderLinkModalDom(){
    if(!linkModalState || !marginLinkBody) return;
    marginLinkBody.innerHTML = Core.renderLinkModal(linkModalState);
    if(linkModalState.step === 'label'){
      var input = marginLinkBody.querySelector('#mlinkProductLabel');
      if(input) input.focus();
    } else {
      var first = marginLinkBody.querySelector('.madsets-link-modal-item, .btn');
      if(first) first.focus();
    }
  }
  function closeLinkModal(){
    if(marginLinkModal) marginLinkModal.classList.remove('open');
    linkModalState = null;
    if(marginLinkBody) marginLinkBody.innerHTML = '';
    var opener = linkModalOpenerEl;
    linkModalOpenerEl = null;
    if(opener && typeof opener.focus === 'function' && document.body.contains(opener)) opener.focus();
  }
  function openLinkModal(mk, triggerEl){
    if(!marginLinkModal || !marginLinkBody) return;
    var view = ctl.getView();
    var a = findAdsetByKey(view, mk);
    var rawId = ctl.adsetIdOf(mk);
    if(!a || !rawId) return;
    linkModalOpenerEl = triggerEl || document.activeElement;
    var saved = window.launchdeskStore ? window.launchdeskStore.getCalcHistory() : [];
    var current = window.launchdeskMarginCalcUI ? window.launchdeskMarginCalcUI.buildCurrentRecord() : null;
    var candidates = MarginCore.buildCandidateList(saved, current).map(function(c){
      return Object.assign({}, c, { platformLabel: platformLabelOf(c.platform) });
    });
    linkModalState = {
      mk: mk, adsetName: a.name,
      step: 'pick', candidates: candidates, selectedIndex: null,
      labelValue: '', labelError: null, saving: false
    };
    marginLinkModal.classList.add('open');
    renderLinkModalDom();
  }

  if(marginLinkClose) marginLinkClose.addEventListener('click', closeLinkModal);
  if(marginLinkBackdrop) marginLinkBackdrop.addEventListener('click', closeLinkModal);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && marginLinkModal && marginLinkModal.classList.contains('open')) closeLinkModal();
  });

  if(marginLinkBody){
    marginLinkBody.addEventListener('click', function(e){
      if(!linkModalState) return;
      var pickBtn = e.target.closest ? e.target.closest('[data-mlink-pick]') : null;
      if(pickBtn){
        var idx = Number(pickBtn.getAttribute('data-mlink-pick'));
        if(!(idx >= 0)) return;
        linkModalState.step = 'label';
        linkModalState.selectedIndex = idx;
        linkModalState.labelValue = '';
        linkModalState.labelError = null;
        renderLinkModalDom();
        return;
      }
      var backBtn = e.target.closest ? e.target.closest('[data-mlink-back]') : null;
      if(backBtn){
        linkModalState.step = 'pick';
        linkModalState.selectedIndex = null;
        linkModalState.labelError = null;
        renderLinkModalDom();
      }
    });
    marginLinkBody.addEventListener('submit', function(e){
      var form = e.target.closest ? e.target.closest('[data-mlink-form="label"]') : null;
      if(!form || !linkModalState) return;
      e.preventDefault();
      if(linkModalState.saving) return; // 중복 클릭 방지
      var candidate = linkModalState.candidates[linkModalState.selectedIndex];
      if(!candidate) return;
      var input = form.querySelector('#mlinkProductLabel');
      var rawLabel = input ? input.value : '';
      var snap = MarginCore.buildSnapshotForSave(candidate.record, rawLabel);
      if(!snap.ok){
        linkModalState.labelValue = rawLabel;
        linkModalState.labelError = snap.error;
        renderLinkModalDom();
        return;
      }
      var confirmed = window.confirm(
        '이 계산 기준을 \'' + linkModalState.adsetName + '\'에 연결할까요?\n' +
        '이 광고 세트가 다른 상품을 광고하면 비교 결과가 맞지 않을 수 있어요.'
      );
      if(!confirmed) return; // 취소 — 쓰기 없음, 상태 그대로

      var mk = linkModalState.mk;
      var rawId = ctl.adsetIdOf(mk);
      var storeId = ctl.getStoreId();
      if(!rawId || !storeId) return;
      var myEpoch = linksState.epoch; // 요청 시작 시점의 store/세대 캡처(아래 stale 판정용)
      linkModalState.saving = true;
      renderLinkModalDom();
      saveLink(storeId, rawId, snap.value).then(function(res){
        var stale = (myEpoch !== linksState.epoch) || (linksState.storeId !== storeId);
        if(stale) return; // 그 사이 쇼핑몰이 바뀌거나 로그아웃 — 모달·상태·토스트 전부 건드리지 않음
        if(!linkModalState || linkModalState.mk !== mk) return; // 같은 store 안에서 모달이 닫히거나 다른 세트로 바뀜
        linkModalState.saving = false;
        if(!res.ok){
          linkModalState.labelError = '연결에 실패했어요. 잠시 후 다시 시도해주세요.';
          renderLinkModalDom();
          return;
        }
        linksState.byId[String(rawId)] = res.row;
        closeLinkModal();
        showToast('손익분기 기준을 연결했어요.', 'success');
        render();
      });
    });
  }

  function disconnectLink(mk){
    if(linkDisconnectInFlight[mk]) return; // 중복 클릭 방지
    var confirmed = window.confirm('손익분기 기준 연결을 해제할까요? 연결 정보만 삭제되고 쇼핑몰 정보와 마진 계산 기록은 그대로 남아요.');
    if(!confirmed) return;
    var rawId = ctl.adsetIdOf(mk);
    var storeId = ctl.getStoreId();
    if(!rawId || !storeId) return;
    var myEpoch = linksState.epoch; // 요청 시작 시점의 store/세대 캡처(아래 stale 판정용)
    linkDisconnectInFlight[mk] = true;
    render();
    deleteLink(storeId, rawId).then(function(res){
      delete linkDisconnectInFlight[mk];
      var stale = (myEpoch !== linksState.epoch) || (linksState.storeId !== storeId);
      if(stale) return; // 그 사이 쇼핑몰이 바뀌거나 로그아웃 — 화면·토스트·상태 전부 건드리지 않음
      if(!res.ok){
        render();
        showToast('연결 해제에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
        return;
      }
      delete linksState.byId[String(rawId)];
      render();
      showToast('손익분기 기준 연결을 해제했어요.', 'success');
    });
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
    var linksChanged = syncLinksStore(storeId, authed);
    if(linksChanged) closeLinkModal(); // 다른 쇼핑몰의 광고 세트를 대상으로 열려 있던 모달을 남기지 않는다
    panel.hidden = !ready;
    var becameReady = ready && !wasReady;
    wasReady = ready;
    if(becameReady && isDashboardRoute()){
      ctl.ensureList();
      ensureLinksLoaded();
    }
    render();
  }

  Array.prototype.forEach.call(periodBtns, function(btn){
    btn.addEventListener('click', function(){ ctl.setPeriod(btn.getAttribute('data-madsets-period')); });
  });
  if(dateInput){
    function syncDateBounds(){
      dateInput.max = Core.localDateString(Date.now());
      dateInput.min = Core.earliestDateString(Date.now());
    }
    syncDateBounds();
    dateInput.addEventListener('focus', syncDateBounds); // 자정을 넘겨 열어 둔 화면 대비
    dateInput.addEventListener('change', function(){
      var v = dateInput.value;
      if(!v) return;
      if(v > dateInput.max || v < dateInput.min){
        // 직접 입력으로 범위를 벗어난 경우 — 조회하지 않고 이유를 알린다.
        showToast(v > dateInput.max ? '오늘 이후 날짜는 조회할 수 없어요.' : 'Meta는 최근 37개월 안의 날짜만 조회할 수 있어요.', 'error');
        render();
        return;
      }
      ctl.setPeriod('date', v);
    });
  }
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
    var mlinkBtn = e.target && e.target.closest ? e.target.closest('[data-mlink-action]') : null;
    if(mlinkBtn && bodyEl.contains(mlinkBtn)){
      var action = mlinkBtn.getAttribute('data-mlink-action');
      var mk = mlinkBtn.getAttribute('data-mk');
      if((action === 'connect' || action === 'change')) openLinkModal(mk, mlinkBtn);
      else if(action === 'disconnect' && !mlinkBtn.disabled) disconnectLink(mk);
      return;
    }
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
