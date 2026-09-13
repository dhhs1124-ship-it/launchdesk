(function(){
  document.getElementById('year').textContent = new Date().getFullYear();
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // last chapter path a GA4 chapter_start fired for — see render() below;
  // declared here so it survives across every render() call, not just one
  var lastChapterStartPath = null;
  // STEP03's checklist evaluate() (set once its wiring runs, below) — re-run
  // from render() every time /start/sourcing is entered, since a saved
  // margin-calculator result made on /tools won't otherwise be noticed
  var reevaluateSourcing = null;
  // set by a click on any [data-resource-cat] link (STEP02~07 → 자료실
  // links); consumed once by render() the moment /resources is reached,
  // so that STEP's relevant category filter is pre-selected automatically
  var pendingResourceFilter = null;

  /* Views that actually exist. Add a line here the moment a new
     <section class="view" id="view-XXX"> is built — every #/path
     link pointing at it starts working immediately. */
  var BUILT = {
    '/':              'view-home',
    '/tools':         'view-tools',
    '/start':         'view-start',
    '/start/intro':   'view-start-intro',
    '/start/prepare': 'view-start-prepare',
    '/start/setup':   'view-start-setup',
    '/start/sourcing': 'view-start-sourcing',
    '/start/content': 'view-start-content',
    '/start/marketing-setup': 'view-start-marketing-setup',
    '/start/marketing': 'view-start-marketing',
    '/start/orders':  'view-start-orders',
    '/start/wrapup':  'view-start-wrapup',
    '/resources':     'view-resources',
    '/services/setup': 'view-services-setup'
  };

  /* Display name shown in the topbar crumb, and (for paths not in
     BUILT) on the "coming soon" placeholder. */
  var TITLES = {
    '/':                 '홈',
    '/start':            '쇼핑몰 시작하기',
    '/start/intro':      '챕터 00 · 시작하기 전에',
    '/tools':            '운영 도구',
    '/resources':        '자료실',
    '/services/setup':   '대행 서비스',
    '/login':            '로그인',
    '/contact':          '문의하기',
    '/terms':            '이용약관',
    '/privacy':          '개인정보처리방침',
    '/business-info':    '사업자 정보',
    '/guide':            '이용 안내',
    '/start/prepare':    '01 · 시작 전 준비',
    '/start/setup':      '02 · 사업자 · 플랫폼 기본',
    '/start/sourcing':   '03 · 상품 기획',
    '/start/content':    '04 · 촬영 & 상세페이지',
    '/start/marketing-setup': '05 · 마케팅 인프라 세팅',
    '/start/marketing':  '06 · 마케팅 & SNS',
    '/start/orders':     '07 · 주문 · CS 관리',
    '/start/wrapup':     '08 · 마무리'
  };

  function currentPath(){
    var h = location.hash.replace(/^#/, '');
    return h || '/';
  }

  function setActiveNav(path){
    document.querySelectorAll('.side-nav a').forEach(function(a){
      var m = a.getAttribute('data-match');
      var exact = a.hasAttribute('data-exact');
      var active = exact ? path === m : (!!m && m !== '/' && path.indexOf(m) === 0);
      a.classList.toggle('nav-current', active);
    });
  }

  function closeSidebar(){
    sidebar.classList.remove('open');
    scrim.classList.remove('show');
    navToggle.setAttribute('aria-expanded','false');
  }

  /* staggered entrance — 50ms per item, restarting the count inside
     each grid/list container separately (a second grid on the same
     view doesn't inherit the first grid's item count). */
  function applyStagger(root){
    root.querySelectorAll('.card-grid, .dash-panel, .info-grid').forEach(function(container){
      var items = Array.prototype.filter.call(container.children, function(el){
        return el.matches('.guide-card, .info-card');
      });
      items.forEach(function(el, i){
        el.style.setProperty('--stagger-i', i);
        el.classList.remove('stagger-in');
        void el.offsetWidth; // restart the animation on repeat visits
        el.classList.add('stagger-in');
      });
    });
  }

  function render(){
    var path = currentPath();
    document.querySelectorAll('.view').forEach(function(v){ v.hidden = true; v.classList.remove('fade-in'); });
    var viewId = BUILT[path];
    var target = document.getElementById(viewId || 'view-coming-soon');
    if(!viewId){
      document.getElementById('csLabel').textContent = TITLES[path] || '요청하신 페이지';
    }
    target.hidden = false;
    if(!reduceMotion){ target.classList.add('fade-in'); applyStagger(target); }
    document.getElementById('crumbLabel').textContent = TITLES[path] || '준비 중';
    setActiveNav(path);
    window.scrollTo(0, 0);
    closeSidebar();

    /* STEP03은 /tools에서 마진계산기를 저장한 뒤 돌아왔을 때 완료조건이
       달라질 수 있으므로, 이 경로로 들어올 때마다 다시 평가한다.
       reevaluateSourcing은 아래 체크리스트 wiring이 지정하며, 이 경로도
       결국 setChapterDone()을 타므로 GA4/토스트는 여전히 "진짜로 새로
       완료되는 순간"에만 정확히 한 번 발생한다. */
    if(path === '/start/sourcing' && typeof reevaluateSourcing === 'function'){
      reevaluateSourcing();
    }

    /* STEP02~07의 "OO 관련 자료 보기" 링크가 남겨둔 카테고리를 자료실
       도착 시 한 번만 적용 — 새 라우팅을 추가하지 않고, 자료실 자체의
       필터 탭 클릭 메커니즘을 그대로 재사용한다(아래 filter-tab 클릭
       위임 로직과 동일). */
    if(path === '/resources' && pendingResourceFilter){
      var pendingTab = document.querySelector('.filter-tabs[data-scope="resources"] .filter-tab[data-filter="' + pendingResourceFilter + '"]');
      if(pendingTab) pendingTab.click();
      pendingResourceFilter = null;
    }

    /* GA4 page_view — hash routes never trigger a real page load, so the
       automatic page_view (disabled via send_page_view:false in the GA4
       tag) is replaced by this one manual event per render(), covering
       both the initial paint and every hashchange. No user input here —
       path/title are always one of the fixed strings in BUILT/TITLES.
       Guarded so a blocked/failed GA4 load never breaks navigation. */
    if(typeof gtag === 'function'){
      gtag('event', 'page_view', {
        page_title: TITLES[path] || '준비 중',
        page_location: location.href,
        page_path: path
      });
    }

    /* GA4 setup_page_view — a dedicated arrival signal for the setup-
       service page specifically, on top of (not instead of) the page_view
       above. path is a fixed literal, no user input. Guarded the same way
       so a blocked/failed GA4 load never breaks navigation. */
    if(path === '/services/setup' && typeof gtag === 'function'){
      gtag('event', 'setup_page_view', {
        page_name: 'services_setup'
      });
    }

    /* GA4 chapter_start — fires when path lands on one of the 9
       CHAPTER_PATHS. lastChapterStartPath guards against firing twice in a
       row for the *same* chapter (e.g. if render() ever re-ran without the
       hash actually changing) — but is cleared the moment path leaves
       chapter territory, so navigating to another chapter (or any other
       view) and then back still counts as a new start, same as page_view
       already does. path/title are fixed strings from CHAPTER_PATHS/
       TITLES, no user input. */
    if(CHAPTER_PATHS.indexOf(path) !== -1){
      if(path !== lastChapterStartPath){
        lastChapterStartPath = path;
        if(typeof gtag === 'function'){
          gtag('event', 'chapter_start', {
            chapter_path: path,
            chapter_title: TITLES[path] || path
          });
        }
      }
    } else {
      lastChapterStartPath = null;
    }
  }

  window.addEventListener('hashchange', render);

  /* mobile sidebar drawer */
  var navToggle = document.getElementById('navToggle');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');
  navToggle.addEventListener('click', function(){
    var open = sidebar.classList.toggle('open');
    scrim.classList.toggle('show', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  scrim.addEventListener('click', closeSidebar);

  /* photo lightbox — event-delegated so it works across every view */
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightboxImg');
  function openLightbox(src, alt){
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.classList.add('open');
  }
  function closeLightbox(){
    lightbox.classList.remove('open');
    lightboxImg.src = '';
  }
  document.addEventListener('click', function(e){
    var chip = e.target.closest('.photo-chip');
    if(chip){ openLightbox(chip.getAttribute('data-img'), chip.getAttribute('data-alt')); return; }
    if(e.target === lightbox || e.target.closest('#lightboxClose')){ closeLightbox(); }
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeLightbox(); });

  /* login modal — every #/login link opens this instead of routing
     away, so "로그인"/"구독 시작하기" never leaves whatever the user
     was doing. No real auth yet, so submitting (email form or either
     social button) just swaps to an honest "still coming" notice. */
  var loginModal = document.getElementById('loginModal');
  var loginFormWrap = document.getElementById('loginFormWrap');
  var loginNotice = document.getElementById('loginNotice');
  function openLoginModal(){
    loginFormWrap.hidden = false;
    loginNotice.hidden = true;
    loginModal.classList.add('open');
    document.getElementById('loginEmail').focus();
  }
  function closeLoginModal(){
    loginModal.classList.remove('open');
    document.getElementById('loginForm').reset();
  }
  function showLoginNotice(){
    loginFormWrap.hidden = true;
    loginNotice.hidden = false;
  }
  document.getElementById('loginModalClose').addEventListener('click', closeLoginModal);
  document.getElementById('loginModalBackdrop').addEventListener('click', closeLoginModal);
  document.getElementById('loginNoticeClose').addEventListener('click', closeLoginModal);
  document.getElementById('loginForm').addEventListener('submit', function(e){ e.preventDefault(); showLoginNotice(); });
  document.querySelectorAll('.login-social').forEach(function(b){ b.addEventListener('click', showLoginNotice); });
  document.getElementById('loginToSignup').addEventListener('click', function(e){ e.preventDefault(); showLoginNotice(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && loginModal.classList.contains('open')) closeLoginModal(); });
  document.addEventListener('click', function(e){
    var loginLink = e.target.closest('a[href="#/login"]');
    if(loginLink){ e.preventDefault(); openLoginModal(); }
  });

  /* tab switcher — generic, scoped to the .tabs the clicked button lives in */
  document.addEventListener('click', function(e){
    // STEP02~07 → 자료실 deep-link: just remember which category to
    // pre-select once /resources actually renders (see render() above);
    // the <a>'s own href="#/resources" navigation is left to run normally.
    var resourceCatLink = e.target.closest('[data-resource-cat]');
    if(resourceCatLink){
      pendingResourceFilter = resourceCatLink.getAttribute('data-resource-cat');
      return;
    }
    var tabBtn = e.target.closest('.tab-btn');
    if(tabBtn){
      var tabs = tabBtn.closest('.tabs');
      var key = tabBtn.getAttribute('data-tab');
      tabs.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active', b === tabBtn); });
      tabs.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.getAttribute('data-tab') === key); });
      return;
    }
    var diagBtn = e.target.closest('.diag-btn');
    if(diagBtn){
      var diag = diagBtn.closest('.diag');
      var dkey = diagBtn.getAttribute('data-result');
      diag.querySelectorAll('.diag-btn').forEach(function(b){ b.classList.toggle('active', b === diagBtn); });
      diag.querySelectorAll('.diag-result').forEach(function(r){ r.classList.toggle('show', r.getAttribute('data-result') === dkey); });
      return;
    }
    var accHead = e.target.closest('.acc-head');
    if(accHead){
      accHead.closest('.acc-item').classList.toggle('open');
      return;
    }
    var gcHead = e.target.closest('.gc-head');
    if(gcHead){
      var card = gcHead.closest('.guide-card');
      var wasOpen = card.classList.contains('open');
      document.querySelectorAll('.guide-card.open').forEach(function(c){ if(c !== card) c.classList.remove('open'); });
      card.classList.toggle('open', !wasOpen);
      return;
    }
    var toolsTabBtn = e.target.closest('.tools-tab-btn');
    if(toolsTabBtn){
      var ttKey = toolsTabBtn.getAttribute('data-tools-tab');
      toolsTabBtn.parentElement.querySelectorAll('.tools-tab-btn').forEach(function(b){ b.classList.toggle('active', b === toolsTabBtn); });
      document.querySelectorAll('.tools-pane').forEach(function(p){ p.classList.toggle('active', p.getAttribute('data-tools-tab') === ttKey); });
      return;
    }
    var chanBtn = e.target.closest('.adlog-chan-btn');
    if(chanBtn){
      chanBtn.parentElement.querySelectorAll('.adlog-chan-btn').forEach(function(b){ b.classList.toggle('active', b === chanBtn); });
      return;
    }
    if(e.target.closest('#adlogAddBtn')){
      var formWrap = document.getElementById('adlogFormWrap');
      if(formWrap) formWrap.hidden = !formWrap.hidden;
      return;
    }
    if(e.target.closest('#adlogCancelBtn')){
      var fw = document.getElementById('adlogFormWrap');
      if(fw) fw.hidden = true;
      var f = document.getElementById('adlogForm');
      if(f) f.reset();
      return;
    }
    var adlogDelBtn = e.target.closest('.adlog-del');
    if(adlogDelBtn){
      var delId = adlogDelBtn.getAttribute('data-id');
      deleteAdlogRecord(delId);
      return;
    }
    var filterTab = e.target.closest('.filter-tab');
    if(filterTab){
      var scope = filterTab.closest('.filter-tabs').getAttribute('data-scope');
      var fkey = filterTab.getAttribute('data-filter');
      filterTab.parentElement.querySelectorAll('.filter-tab').forEach(function(b){ b.classList.toggle('active', b === filterTab); });
      if(scope === 'resources'){
        var anyVisibleR = false;
        document.querySelectorAll('#resourceGrid .resource-card').forEach(function(card){
          var cat = card.getAttribute('data-cat');
          var show = (fkey === 'all' || fkey === cat);
          card.style.display = show ? '' : 'none';
          if(show) anyVisibleR = true;
        });
        var resourceGrid = document.getElementById('resourceGrid');
        var resourceEmpty = document.getElementById('resourceEmptyState');
        if(resourceGrid) resourceGrid.hidden = !anyVisibleR;
        if(resourceEmpty) resourceEmpty.hidden = anyVisibleR;
        // sections living outside the card grid (the setup accordion) —
        // unlike the cards, these only show once their exact category is
        // picked, never under "전체" (keeps the default view to just the grid)
        document.querySelectorAll('.resource-section[data-cat]').forEach(function(sec){
          sec.style.display = (fkey === sec.getAttribute('data-cat')) ? '' : 'none';
        });
        return;
      }
      var anyVisible = false;
      document.querySelectorAll('#chapterGrid .guide-card').forEach(function(card){
        var tier = card.getAttribute('data-tier');
        var show = (fkey === 'all' || fkey === tier);
        card.style.display = show ? '' : 'none';
        if(show) anyVisible = true;
      });
      var chapterGrid = document.getElementById('chapterGrid');
      var emptyState = document.getElementById('chapterEmptyState');
      if(chapterGrid) chapterGrid.hidden = !anyVisible;
      if(emptyState) emptyState.hidden = anyVisible;
      return;
    }
    var emptyReset = e.target.closest('#chapterEmptyReset');
    if(emptyReset){
      var allTab = document.querySelector('.filter-tabs[data-scope="chapters"] .filter-tab[data-filter="all"]');
      if(allTab) allTab.click();
      return;
    }
    var resourceReset = e.target.closest('#resourceEmptyReset');
    if(resourceReset){
      var allResTab = document.querySelector('.filter-tabs[data-scope="resources"] .filter-tab[data-filter="all"]');
      if(allResTab) allResTab.click();
      return;
    }
    // generic "N개 가이드 보기" button on a resource-card — reveals the
    // matching category's accordion (data-filter) and scrolls to it
    // (data-target). Replaces the old single hardcoded #scrollToSetupGuide
    // button now that there are two such cards (사업자·플랫폼 / 분석·연동).
    var guideLink = e.target.closest('.rc-guide-link');
    if(guideLink){
      var glFilterTab = document.querySelector('.filter-tabs[data-scope="resources"] .filter-tab[data-filter="' + guideLink.getAttribute('data-filter') + '"]');
      if(glFilterTab) glFilterTab.click(); // reveals the accordion (hidden under other filters)
      var glTarget = document.getElementById(guideLink.getAttribute('data-target'));
      if(glTarget) glTarget.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'});
    }
  });

  /* count-up (shared "useCountUp"-equivalent) — animates any
     [data-count] number once, the first time it scrolls into view.
     Works for elements starting inside a hidden view or a hidden tab
     pane (e.g. the /tools dashboard pane): once the layout makes them
     visible, the observer's next check picks them up, no manual
     re-trigger needed. */
  function runCountUp(el){
    var raw = el.getAttribute('data-count') || '0';
    var target = parseFloat(raw) || 0;
    // preserve decimal places from the source value (e.g. "3.2" ROAS)
    // instead of always rounding to a whole number — otherwise a
    // decimal target like 3.2x lands on "3x" once the animation ends.
    var decimals = (raw.split('.')[1] || '').length;
    var fmt = function(n){ return n.toLocaleString('ko-KR', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}); };
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    if(reduceMotion){ el.textContent = prefix + fmt(target) + suffix; return; }
    var start = null, duration = 850;
    function step(ts){
      if(start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + fmt(target * eased) + suffix;
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var countUpEls = document.querySelectorAll('.stat-strip .v[data-count], .kpi-value[data-count]');
  if(countUpEls.length){
    var countUpObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          runCountUp(entry.target);
          countUpObserver.unobserve(entry.target);
        }
      });
    }, {threshold:.4});
    countUpEls.forEach(function(el){ countUpObserver.observe(el); });
  }

  /* 2x-margin calculator (ch03) — pure client-side, nothing stored */
  var calcCost = document.getElementById('calcCost');
  if(calcCost){
    var calcPrice = document.getElementById('calcPrice');
    var calcMargin = document.getElementById('calcMargin');
    var calcRate = document.getElementById('calcRate');
    var fmt = function(n){ return Math.round(n).toLocaleString('ko-KR') + '원'; };
    calcCost.addEventListener('input', function(){
      var cost = parseFloat(calcCost.value);
      if(!cost || cost <= 0){
        calcPrice.textContent = '—'; calcMargin.textContent = '—'; calcRate.textContent = '—';
        calcPrice.classList.add('muted'); calcMargin.classList.add('muted'); calcRate.classList.add('muted');
        return;
      }
      var price = cost * 2;
      calcPrice.textContent = fmt(price);
      calcMargin.textContent = fmt(price - cost);
      calcRate.textContent = '50%';
      calcPrice.classList.remove('muted'); calcMargin.classList.remove('muted'); calcRate.classList.remove('muted');
    });
  }

  /* checklist counters — one independent count per .checklist-block
     (a page can have more than one). Deliberately NOT persisted (no
     login yet, so localStorage would leak between different people
     on the same browser) — resets to 0 on every reload by design. */
  document.querySelectorAll('.checklist-block').forEach(function(block){
    var boxes = block.querySelectorAll('.cl-row input[type="checkbox"]');
    var countEl = block.querySelector('.count');
    if(!boxes.length || !countEl) return;
    var update = function(){
      var checked = block.querySelectorAll('.cl-row input:checked').length;
      countEl.textContent = checked + ' / ' + boxes.length;
    };
    boxes.forEach(function(b){ b.addEventListener('change', update); });
    update();
  });

  /* STEP01~07 진행률 — STEP00/08은 게이트 없는 전환 화면이라 분모에서
     제외된다(항상 7 기준). ld-completed-chapters는 이제 "영구 원장"이
     아니라 각 STEP의 실제 완료조건(워크시트/체크리스트/운영도구 저장
     이력)을 마지막으로 훑은 결과를 담는 캐시로 취급한다 — 진짜 원천은
     STEP_EVALUATORS가 읽는 개별 localStorage 키들이고,
     reconcileCompletedChapters()가 로드마다 이 캐시를 그 원천과 다시
     맞춘다. 사이드바 미니바 · 홈 대시보드 · /start 상세 진행률은 모두
     이 하나의 캐시 + 하나의 계산(computeStepProgress)만 읽으므로 서로
     다른 숫자를 보여줄 수 없다. */
  var CHAPTER_PATHS = ['/start/intro','/start/prepare','/start/setup','/start/sourcing','/start/content','/start/marketing-setup','/start/marketing','/start/orders','/start/wrapup'];
  var COMPLETED_KEY = 'ld-completed-chapters';
  /* 저장 구조(필드/체크 항목 구성)의 의미 자체가 바뀐 STEP만 새 키를
     쓴다. 옛 키(v1)와 그 데이터는 절대 지우지 않고, 그냥 더 이상 읽지
     않는다 — 그래야 과거 값이 새 필드/체크박스에 잘못 복원되지 않는다. */
  var STORAGE_KEY_OVERRIDES = {
    '/start/prepare':         'ld-worksheet-start-prepare-v2',
    '/start/marketing-setup': 'ld-checklist-start-marketing-setup-v2'
  };
  var progressFillEls = document.querySelectorAll('#progressFillSide, #progressFillRow');
  var progressPctEls = document.querySelectorAll('#progressPct');
  function getCompleted(){
    try{ return JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]'); }catch(e){ return []; }
  }
  function saveCompleted(list){
    try{ localStorage.setItem(COMPLETED_KEY, JSON.stringify(list)); }catch(e){}
  }

  /* ---- STEP01~07 read-only evaluators ----------------------------------
     Each answers "is this STEP actually done right now?" straight from
     localStorage/DOM structure, independent of whatever
     ld-completed-chapters currently says. Used to reconcile the cache
     below; the live worksheet/checklist wiring further down still owns
     day-to-day completion via setChapterDone(). STEP00/08 have no
     evaluator — no completion gate, excluded from progress entirely. */
  function hasSavedMarginCalc(){
    // tools.js's own save history (separate script/IIFE) — read only, never written here
    try{ return JSON.parse(localStorage.getItem('ld-tools-calc-history') || '[]').length > 0; }catch(e){ return false; }
  }
  function checklistAllChecked(path, overrideKey){
    var block = document.querySelector('.checklist-block[data-chapter="' + path + '"]');
    if(!block) return false;
    var boxes = block.querySelectorAll('.cl-row input[type="checkbox"]');
    if(!boxes.length) return false;
    try{
      var key = overrideKey || ('ld-checklist' + path.replace(/\//g, '-'));
      var saved = JSON.parse(localStorage.getItem(key) || '[]');
      if(!Array.isArray(saved)) return false;
      for(var i = 0; i < boxes.length; i++){ if(saved.indexOf(i) === -1) return false; }
      return true;
    }catch(e){ return false; }
  }
  function worksheetAllFilled(path, overrideKey){
    var ws = document.querySelector('.worksheet[data-chapter="' + path + '"]');
    if(!ws) return false;
    var inputs = ws.querySelectorAll('.worksheet-input');
    if(!inputs.length) return false;
    try{
      var key = overrideKey || ('ld-worksheet' + path.replace(/\//g, '-'));
      var saved = JSON.parse(localStorage.getItem(key) || '{}');
      return Array.prototype.every.call(inputs, function(inp, i){ return typeof saved[i] === 'string' && saved[i].trim() !== ''; });
    }catch(e){ return false; }
  }
  var STEP_EVALUATORS = {
    '/start/prepare':         function(){ return worksheetAllFilled('/start/prepare', STORAGE_KEY_OVERRIDES['/start/prepare']); },
    '/start/setup':           function(){ return checklistAllChecked('/start/setup'); },
    '/start/sourcing':        function(){ return checklistAllChecked('/start/sourcing') && hasSavedMarginCalc(); },
    '/start/content':         function(){ return checklistAllChecked('/start/content'); },
    '/start/orders':          function(){ return checklistAllChecked('/start/orders'); },
    '/start/marketing-setup': function(){ return checklistAllChecked('/start/marketing-setup', STORAGE_KEY_OVERRIDES['/start/marketing-setup']); },
    '/start/marketing':       function(){ return checklistAllChecked('/start/marketing'); }
  };

  /* ld-completed-chapters를 위 실제 조건과 맞춘다. setChapterDone()을
     거치지 않고 saveCompleted()로 배열만 직접 고쳐쓰므로 토스트도 GA4
     chapter_complete도 절대 발화하지 않는다 — "지금 막 완료했다"가
     아니라 "원래 상태를 다시 확인했다"이기 때문이다. 옛 "다 읽었어요"
     체크로 남은 STEP03~07의 잔여 기록, 필드 구성이 바뀐 STEP01/06의
     v1 잔여 기록은 여기서 조건에 안 맞으면 자연히 빠진다. 워크시트/
     체크리스트 원본 데이터, STEP00/08의 과거 기록은 건드리지 않는다. */
  function reconcileCompletedChapters(){
    var completed = getCompleted();
    var changed = false;
    Object.keys(STEP_EVALUATORS).forEach(function(path){
      var actual = STEP_EVALUATORS[path]();
      var idx = completed.indexOf(path);
      if(actual && idx === -1){ completed.push(path); changed = true; }
      else if(!actual && idx !== -1){ completed.splice(idx, 1); changed = true; }
    });
    if(changed) saveCompleted(completed);
  }
  reconcileCompletedChapters();

  /* STEP01~07 공용 진행률 계산 — 완료 STEP 수 / 전체 STEP 수(7) / % /
     다음 미완료 STEP을 한 번에 계산해 사이드바 · 홈 · /start가 모두
     같은 결과를 나눠 쓰게 한다 (STEP_ROADMAP/GATED_STEPS는 아래 정의). */
  function computeStepProgress(completed){
    var total = GATED_STEPS.length;
    var done = GATED_STEPS.filter(function(s){ return completed.indexOf(s.route) !== -1; }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    var next = null;
    for(var i = 0; i < GATED_STEPS.length; i++){
      if(completed.indexOf(GATED_STEPS[i].route) === -1){ next = GATED_STEPS[i]; break; }
    }
    return {total: total, done: done, pct: pct, next: next};
  }

  function recomputeProgress(){
    var completed = getCompleted();
    var prog = computeStepProgress(completed);
    var pct = prog.pct;
    progressFillEls.forEach(function(el){ el.style.width = pct + '%'; });
    progressPctEls.forEach(function(el){ el.textContent = pct + '%'; });

    // /start index page extras: stat row, detail bar, per-card checkmarks
    var ssProgress = document.getElementById('ssProgress');
    if(ssProgress) ssProgress.textContent = prog.done + '/' + prog.total + ' 완료';
    var pdPct = document.getElementById('pdPct');
    if(pdPct) pdPct.textContent = pct + '%';
    var pdFill = document.getElementById('pdFill');
    if(pdFill) pdFill.style.width = pct + '%';
    var pdDone = document.getElementById('pdDone');
    if(pdDone) pdDone.textContent = prog.done;
    var pdLeft = document.getElementById('pdLeft');
    if(pdLeft) pdLeft.textContent = prog.total - prog.done;
    document.querySelectorAll('.guide-card[data-chapter]').forEach(function(card){
      var isDone = completed.indexOf(card.getAttribute('data-chapter')) !== -1;
      var check = card.querySelector('.cc-check');
      if(check) check.hidden = !isDone;
      var link = card.querySelector('.gc-link');
      if(link && isDone && card.getAttribute('data-tier') === 'free'){ link.textContent = '다시 보기 →'; }
    });

    // home page's compact guide-preview rows (same completed[] source)
    document.querySelectorAll('.gp-row[data-chapter]').forEach(function(row){
      var isDone = completed.indexOf(row.getAttribute('data-chapter')) !== -1;
      row.querySelector('.gp-check').classList.toggle('done', isDone);
    });

    renderHomeDashboard(completed, prog);
    renderWrapupState(completed, prog);
  }

  /* ---- STEP_ROADMAP — single roadmap shared by every progress display --
     Originally built for the home dashboard only (HOME_STEPS); promoted
     here to a file-wide list so the sidebar mini-bar, the /start detail
     bar and the home dashboard all read the exact same order/labels and
     the exact same computeStepProgress() result — they cannot show
     different numbers anymore. STEP00/08 are gate-free transition
     screens (gated:false) and are excluded from every total/percentage;
     STEP01~07 (gated:true) are the 7 STEPs progress is measured against. */
  var STEP_ROADMAP = [
    {num:'00', route:'/start/intro',           label:'오픈 로드맵 확인하기',             gated:false},
    {num:'01', route:'/start/prepare',         label:'무엇을, 누구에게 팔지 정하기',      gated:true},
    {num:'02', route:'/start/setup',           label:'사업자 등록하고 쇼핑몰 플랫폼 만들기', gated:true},
    {num:'03', route:'/start/sourcing',        label:'판매할 상품과 공급처, 가격 확정하기', gated:true},
    {num:'04', route:'/start/content',         label:'상품 상세페이지 완성하기',          gated:true},
    {num:'05', route:'/start/orders',          label:'배송·CS 정책 정하고 오픈 준비 마치기', gated:true},
    {num:'06', route:'/start/marketing-setup', label:'마케팅 인프라 연결하기',            gated:true},
    {num:'07', route:'/start/marketing',       label:'첫 유입 만들고 반응 테스트하기',     gated:true},
    {num:'08', route:'/start/wrapup',          label:'오픈 완료, 운영 시작하기',          gated:false}
  ];
  var GATED_STEPS = STEP_ROADMAP.filter(function(s){ return s.gated; });
  var RESUME_RING_CIRC = 175.9;
  function renderHomeDashboard(completed, prog){
    var titleEl = document.getElementById('resumeTitle');
    if(!titleEl) return; // home markup not present on this build

    prog = prog || computeStepProgress(completed);
    var pct = prog.pct;

    var pctEl = document.getElementById('rbPct');
    if(pctEl) pctEl.textContent = pct + '%';
    var arc = document.getElementById('rbRingArc');
    if(arc) arc.style.strokeDashoffset = (RESUME_RING_CIRC * (1 - pct / 100)).toFixed(1);
    var barEl = document.getElementById('rbBarFill');
    if(barEl) barEl.style.width = pct + '%';
    var subEl = document.getElementById('resumeSub');
    if(subEl) subEl.textContent = prog.total + '단계 중 ' + prog.done + '단계 완료';

    var linkEl = document.getElementById('resumeLink');
    if(prog.next){
      titleEl.textContent = 'STEP ' + prog.next.num + ' · ' + prog.next.label;
      if(linkEl){ linkEl.href = '#' + prog.next.route; linkEl.textContent = '이어서 하기 →'; }
    } else {
      titleEl.textContent = prog.total + '단계를 모두 완료했어요 🎉';
      if(linkEl){ linkEl.href = '#/start/wrapup'; linkEl.textContent = '오픈 완료 확인하기 →'; }
    }
  }

  /* ---- STEP08 운영 전환 화면 — computeStepProgress()의 결과를 그대로
     읽기만 한다(별도 완료 계산 없음, ld-completed-chapters 직접 참조도
     없음). 7/7이면 기존 "오픈 완료" 콘텐츠 그대로, 아니면 남은 STEP
     안내로 바뀐다. STEP08 자체는 gated:false라 이 화면엔 완료 게이트가
     없고, GA4 이벤트도 새로 추가하지 않는다(기존 page_view만 그대로). */
  function renderWrapupState(completed, prog){
    var titleEl = document.getElementById('wrapupTitle');
    if(!titleEl) return; // wrapup markup not present on this build

    var leadEl = document.getElementById('wrapupLead');
    var bannerEl = document.getElementById('wrapupStatusBanner');
    var doneBlock = document.getElementById('wrapupDoneBlock');
    var incompleteBlock = document.getElementById('wrapupIncompleteBlock');

    if(prog.done >= prog.total){
      titleEl.textContent = '쇼핑몰 오픈 준비가 끝났습니다';
      if(leadEl) leadEl.textContent = '오픈은 끝이 아니라 운영의 시작입니다. 이제부터는 상품, 주문, 광고, 고객 반응을 확인하며 조금씩 개선해가면 됩니다.';
      if(bannerEl) bannerEl.textContent = prog.total + '단계 중 ' + prog.done + '단계 모두 완료했어요 🎉';
      if(doneBlock) doneBlock.hidden = false;
      if(incompleteBlock) incompleteBlock.hidden = true;
      return;
    }

    titleEl.textContent = '아직 오픈 준비가 남아있습니다';
    if(leadEl) leadEl.textContent = 'STEP01~07을 마저 완료하면 오픈 완료 화면과 운영도구로 넘어갈 수 있어요.';
    if(bannerEl) bannerEl.textContent = prog.total + '단계 중 ' + prog.done + '단계 완료 · ' + (prog.total - prog.done) + '단계 남음';
    if(doneBlock) doneBlock.hidden = true;
    if(incompleteBlock) incompleteBlock.hidden = false;

    var listEl = document.getElementById('wrapupRemainingList');
    if(listEl){
      var remaining = GATED_STEPS.filter(function(s){ return completed.indexOf(s.route) === -1; });
      listEl.innerHTML = remaining.map(function(s){
        return '<a class="quick-row" href="#' + s.route + '">' +
          '<span class="qr-icon tone-b">' + s.num + '</span>' +
          '<span class="qr-text"><span class="qr-title">STEP ' + s.num + ' · ' + s.label + '</span></span>' +
          '<svg class="qr-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>' +
          '</a>';
      }).join('');
    }

    var ctaEl = document.getElementById('wrapupResumeCta');
    if(ctaEl && prog.next){
      ctaEl.href = '#' + prog.next.route;
      ctaEl.textContent = 'STEP ' + prog.next.num + ' · ' + prog.next.label + ' → 이어서 하기';
    }
  }
  /* toast — used only for things that genuinely just happened locally
     (a chapter getting marked complete). Never wired to actions that
     don't actually do anything yet (subscribe, download, apply) —
     those still say so honestly via the "coming soon" view / modal. */
  var toastStack = document.getElementById('toastStack');
  function showToast(message, type){
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

  /* single entry point every completion source (checkbox / worksheet /
     checklist) reports through, so they all stay consistent */
  function setChapterDone(path, isDone){
    var completed = getCompleted();
    var idx = completed.indexOf(path);
    if(isDone && idx === -1){
      completed.push(path); saveCompleted(completed); recomputeProgress();
      showToast('챕터를 완료했어요 🎉', 'success');
      /* GA4 chapter_complete — this branch only runs once per chapter
         (the idx === -1 guard above is the same one the toast already
         relies on to avoid re-firing while re-evaluating an already-
         completed worksheet/checklist). No user input — path/title are
         fixed strings from CHAPTER_PATHS/TITLES. */
      if(typeof gtag === 'function'){
        gtag('event', 'chapter_complete', {
          chapter_path: path,
          chapter_title: TITLES[path] || path
        });
      }
    }
    else if(!isDone && idx !== -1){
      completed.splice(idx, 1); saveCompleted(completed); recomputeProgress();
    }
  }

  /* ch01 worksheet — STEP01은 5개 필드(타겟고객/판매카테고리·상품군/
     초기예산/브랜드·쇼핑몰이름/벤치마킹대상)를 쓴다. 필드 구성이 이전
     (6필드, 촬영전략 포함)과 달라져 STORAGE_KEY_OVERRIDES의 v2 키를
     쓴다 — 옛 키의 값이 의미가 달라진 새 필드에 잘못 복원되는 것을
     막기 위함(옛 키/데이터는 삭제하지 않고 그냥 더 이상 읽지 않음).
     5개 모두 채우면 챕터 완료, 하나라도 비우면 완료 해제. 필드별로
     저장해 새로고침 후에도 유지된다(로그인 전이라 이 브라우저 한정 —
     필드 아래 안내 참고). */
  document.querySelectorAll('.worksheet[data-chapter]').forEach(function(ws){
    var path = ws.getAttribute('data-chapter');
    var key = STORAGE_KEY_OVERRIDES[path] || ('ld-worksheet' + path.replace(/\//g, '-'));
    var inputs = ws.querySelectorAll('.worksheet-input');
    try{
      var saved = JSON.parse(localStorage.getItem(key) || '{}');
      inputs.forEach(function(inp, i){ if(saved[i]) inp.value = saved[i]; });
    }catch(e){}
    function evaluate(){
      var allFilled = inputs.length > 0 && Array.prototype.every.call(inputs, function(inp){ return inp.value.trim() !== ''; });
      setChapterDone(path, allFilled);
    }
    inputs.forEach(function(inp){
      inp.addEventListener('input', function(){
        try{
          var data = {};
          inputs.forEach(function(inp2, i){ data[i] = inp2.value; });
          localStorage.setItem(key, JSON.stringify(data));
        }catch(e){}
        evaluate();
      });
    });
    evaluate();
  });

  /* STEP02~07의 필수 체크리스트 — 전부 체크하면 그 STEP이 완료된다.
     체크 상태 자체도 여기서 저장한다(챕터 진행이 여기 달려 있으므로
     새로고침 후에도 유지). STEP06은 필드 개수가 9→1로 의미가 바뀌어
     STORAGE_KEY_OVERRIDES의 v2 키를 쓴다. STEP03은 체크리스트 완료에
     더해 운영도구 마진계산기 저장 이력이 있어야 완료된다(evaluate()의
     '/start/sourcing' 분기) — tools.js는 전혀 수정하지 않고 그 결과
     키(ld-tools-calc-history)만 읽는다. */
  document.querySelectorAll('.checklist-block[data-chapter]').forEach(function(block){
    var path = block.getAttribute('data-chapter');
    var key = STORAGE_KEY_OVERRIDES[path] || ('ld-checklist' + path.replace(/\//g, '-'));
    var boxes = block.querySelectorAll('.cl-row input[type="checkbox"]');
    try{
      var saved = JSON.parse(localStorage.getItem(key) || '[]');
      boxes.forEach(function(b, i){ if(saved.indexOf(i) !== -1) b.checked = true; });
    }catch(e){}
    // the generic .checklist-block counter above already ran its one-time
    // update() before this restored any checked state — refresh its
    // count text directly so a restored checklist doesn't show "0 / N"
    var countEl = block.querySelector('.count');
    if(countEl){
      var restoredCount = Array.prototype.filter.call(boxes, function(b){ return b.checked; }).length;
      countEl.textContent = restoredCount + ' / ' + boxes.length;
    }
    function evaluate(){
      var allChecked = boxes.length > 0 && Array.prototype.every.call(boxes, function(b){ return b.checked; });
      var done = allChecked;
      if(path === '/start/sourcing'){ done = allChecked && hasSavedMarginCalc(); }
      setChapterDone(path, done);
    }
    boxes.forEach(function(b, i){
      b.addEventListener('change', function(){
        try{
          var checkedIdx = [];
          boxes.forEach(function(b2, j){ if(b2.checked) checkedIdx.push(j); });
          localStorage.setItem(key, JSON.stringify(checkedIdx));
        }catch(e){}
        evaluate();
      });
    });
    evaluate();
    // STEP03은 /tools에서 마진계산기 결과를 저장하고 돌아왔을 때도 다시
    // 평가되어야 하므로, render()가 재호출할 수 있게 참조를 남긴다.
    if(path === '/start/sourcing'){ reevaluateSourcing = evaluate; }
  });

  recomputeProgress();

  /* D+ counter — real elapsed days since this browser's first visit,
     stored in localStorage. Not a real account (no login yet), so it
     resets if the user clears site data or opens a different browser —
     same caveat as everything else pre-login in this file. */
  var dayEl = document.getElementById('profileDay');
  if(dayEl){
    try{
      var FV_KEY = 'ld-first-visit';
      var first = localStorage.getItem(FV_KEY);
      if(!first){ first = String(Date.now()); localStorage.setItem(FV_KEY, first); }
      var days = Math.floor((Date.now() - parseInt(first, 10)) / 86400000);
      dayEl.textContent = 'D+' + days;
    }catch(e){ dayEl.textContent = 'D+0'; }
  }

  /* floating subscribe banner — shows fixed at the bottom of the
     viewport while browsing the chapter list, and hides itself the
     moment the real banner (at its natural end-of-page position)
     scrolls into view, so it "docks" instead of floating over the
     content below it. Only active while /start is the visible view. */
  var subBanner = document.getElementById('subBanner');
  var subBannerFloat = document.getElementById('subBannerFloat');
  if(subBanner && subBannerFloat && 'IntersectionObserver' in window){
    var subBannerObserver = new IntersectionObserver(function(entries){
      var entry = entries[0];
      var onStartView = !document.getElementById('view-start').hidden;
      subBannerFloat.classList.toggle('show', onStartView && !entry.isIntersecting);
    }, {threshold: 0});
    subBannerObserver.observe(subBanner);
    window.addEventListener('hashchange', function(){
      // right after navigating, scrollTo(0,0) has just run — if we're
      // on /start the real banner (near page bottom) can't be visible
      // yet, so show the float immediately rather than waiting on the
      // observer's next callback; leaving /start always hides it.
      var onStartView = !document.getElementById('view-start').hidden;
      subBannerFloat.classList.toggle('show', onStartView);
    });
  }

  render(); // initial paint
})();