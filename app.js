(function(){
  document.getElementById('year').textContent = new Date().getFullYear();
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    var scrollSetup = e.target.closest('#scrollToSetupGuide');
    if(scrollSetup){
      var setupFilterTab = document.querySelector('.filter-tabs[data-scope="resources"] .filter-tab[data-filter="setup"]');
      if(setupFilterTab) setupFilterTab.click(); // reveals the accordion (hidden under other filters)
      var target = document.getElementById('setupAccordion');
      if(target) target.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'});
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

  /* "창업 준비" progress — driven ONLY by the explicit "이 챕터, 다
     확인했어요" checkbox at the end of each of the 9 guide chapters
     (00~08), never by merely opening the page. The checkbox is the
     single source of truth; the sidebar mini-bar, the home dashboard
     row-bar, the /start detail bar, and each guide-card's checkmark
     all just read it back. Checking/unchecking any one of the 9
     updates every one of those displays immediately.
     The 16-item setup checklists (ch02/05) stay separate, deliberately
     non-persisted setup-task trackers (see the checklist-counter code
     above) — NOT part of this percentage. */
  var CHAPTER_PATHS = ['/start/intro','/start/prepare','/start/setup','/start/sourcing','/start/content','/start/marketing-setup','/start/marketing','/start/orders','/start/wrapup'];
  var COMPLETED_KEY = 'ld-completed-chapters';
  var progressFillEls = document.querySelectorAll('#progressFillSide, #progressFillRow');
  var progressPctEls = document.querySelectorAll('#progressPct');
  function getCompleted(){
    try{ return JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]'); }catch(e){ return []; }
  }
  function saveCompleted(list){
    try{ localStorage.setItem(COMPLETED_KEY, JSON.stringify(list)); }catch(e){}
  }
  function recomputeProgress(){
    var completed = getCompleted();
    var total = CHAPTER_PATHS.length;
    var done = completed.length;
    var pct = Math.round(done / total * 100);
    progressFillEls.forEach(function(el){ el.style.width = pct + '%'; });
    progressPctEls.forEach(function(el){ el.textContent = pct + '%'; });

    // /start index page extras: stat row, detail bar, per-card checkmarks
    var ssProgress = document.getElementById('ssProgress');
    if(ssProgress) ssProgress.textContent = done + '/' + total + ' 완료';
    var pdPct = document.getElementById('pdPct');
    if(pdPct) pdPct.textContent = pct + '%';
    var pdFill = document.getElementById('pdFill');
    if(pdFill) pdFill.style.width = pct + '%';
    var pdDone = document.getElementById('pdDone');
    if(pdDone) pdDone.textContent = done;
    var pdLeft = document.getElementById('pdLeft');
    if(pdLeft) pdLeft.textContent = total - done;
    document.querySelectorAll('.guide-card[data-chapter]').forEach(function(card){
      var isDone = completed.indexOf(card.getAttribute('data-chapter')) !== -1;
      var check = card.querySelector('.cc-check');
      if(check) check.hidden = !isDone;
      var link = card.querySelector('.gc-link');
      if(link && isDone && card.getAttribute('data-tier') === 'free'){ link.textContent = '다시 보기 →'; }
    });

    // keep every chapter's own checkbox in sync with the saved state
    // (setting .checked here doesn't fire 'change', so this can't loop)
    document.querySelectorAll('.chapter-check-input').forEach(function(input){
      var row = input.closest('[data-chapter]');
      if(row) input.checked = completed.indexOf(row.getAttribute('data-chapter')) !== -1;
    });

    // home page's compact guide-preview rows (same completed[] source)
    document.querySelectorAll('.gp-row[data-chapter]').forEach(function(row){
      var isDone = completed.indexOf(row.getAttribute('data-chapter')) !== -1;
      row.querySelector('.gp-check').classList.toggle('done', isDone);
    });

    updateResumeBanner(completed);
  }

  /* home "이어서 하기" banner — 5 milestones grouped from the same
     completed[] chapter list (ch02 covers two milestones since our
     content doesn't split registration/platform-choice into separate
     chapters). "다음 단계" always points at the first not-yet-completed
     chapter in CHAPTER_PATHS order — real resume-where-you-left-off,
     not a fixed link. */
  var MILESTONES = [
    {key:'biz',       chapter:'/start/setup'},
    {key:'platform',  chapter:'/start/setup'},
    {key:'sourcing',  chapter:'/start/sourcing'},
    {key:'content',   chapter:'/start/content'},
    {key:'payment',   chapter:'/start/marketing-setup'}
  ];
  var RESUME_RING_CIRC = 175.9;
  function updateResumeBanner(completed){
    var stepsWrap = document.getElementById('rbSteps');
    if(!stepsWrap) return;
    var doneCount = 0;
    MILESTONES.forEach(function(m){
      var isDone = completed.indexOf(m.chapter) !== -1;
      if(isDone) doneCount++;
      var el = stepsWrap.querySelector('[data-milestone="' + m.key + '"]');
      if(el) el.classList.toggle('done', isDone);
    });
    var pct = Math.round(doneCount / MILESTONES.length * 100);
    var pctEl = document.getElementById('rbPct');
    if(pctEl) pctEl.textContent = pct + '%';
    var arc = document.getElementById('rbRingArc');
    if(arc) arc.style.strokeDashoffset = (RESUME_RING_CIRC * (1 - pct / 100)).toFixed(1);
    var subEl = document.getElementById('resumeSub');
    if(subEl) subEl.textContent = doneCount + '/' + MILESTONES.length + '단계 완료 · 지금 바로 이어가세요';

    var next = null;
    for(var i = 0; i < CHAPTER_PATHS.length; i++){
      if(completed.indexOf(CHAPTER_PATHS[i]) === -1){ next = CHAPTER_PATHS[i]; break; }
    }
    var titleEl = document.getElementById('resumeTitle');
    var linkEl = document.getElementById('resumeLink');
    if(next){
      var label = (TITLES[next] || next).replace(/^\d+\s*·\s*/, '');
      if(titleEl) titleEl.textContent = '다음 단계: ' + label;
      if(linkEl){ linkEl.href = '#' + next; linkEl.textContent = '계속하기 →'; }
    } else {
      if(titleEl) titleEl.textContent = '9개 챕터를 모두 완료했어요 🎉';
      if(linkEl){ linkEl.href = '#/start'; linkEl.textContent = '다시 둘러보기 →'; }
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
  document.addEventListener('change', function(e){
    var input = e.target.closest('.chapter-check-input');
    if(!input) return;
    var row = input.closest('[data-chapter]');
    if(row) setChapterDone(row.getAttribute('data-chapter'), input.checked);
  });

  /* ch01 worksheet — 6 free-text fields (target, shooting strategy,
     budget, naming, slogan, benchmarks). Filling in all 6 marks the
     chapter complete; clearing any one un-marks it. Saved per-field so
     it survives a reload, same as everything else here (no login yet,
     so it's this browser only — see the note under the fields). */
  document.querySelectorAll('.worksheet[data-chapter]').forEach(function(ws){
    var path = ws.getAttribute('data-chapter');
    var key = 'ld-worksheet' + path.replace(/\//g, '-');
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

  /* ch02 / ch05 setup checklists — these double as that chapter's
     completion signal: check every item and the chapter itself is
     marked done. Unlike a plain "mark complete" checkbox, the check
     states themselves are saved here too (this is the one place in
     the file where that used to say "resets on reload" — now that a
     chapter's progress depends on it, it needs to persist same as
     everything else). */
  document.querySelectorAll('.checklist-block[data-chapter]').forEach(function(block){
    var path = block.getAttribute('data-chapter');
    var key = 'ld-checklist' + path.replace(/\//g, '-');
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
      setChapterDone(path, allChecked);
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