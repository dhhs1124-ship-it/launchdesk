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

  /* /tools margin calculator — the one real, working part of the
     dashboard. Everything else on that page (KPIs, charts, order
     list) is static example markup, clearly labeled as such. */
  var toolsGaugeArc = document.getElementById('toolsGaugeArc');
  function updateGauge(pct){
    if(!toolsGaugeArc) return 'good';
    var clamped = Math.max(0, Math.min(100, pct));
    var arcLen = 188.5;
    toolsGaugeArc.setAttribute('stroke-dasharray', (clamped/100*arcLen).toFixed(1) + ' ' + arcLen);
    var tier = clamped >= 30 ? 'good' : (clamped >= 15 ? 'mid' : 'low');
    toolsGaugeArc.style.stroke = tier === 'good' ? 'var(--badge-c)' : (tier === 'mid' ? 'var(--badge-b)' : 'var(--badge-a)');
    return tier;
  }
  function computeToolsCalc(){
    var costEl = document.getElementById('toolsCost');
    if(!costEl) return null;
    var cost = parseFloat(costEl.value) || 0;
    var price = parseFloat(document.getElementById('toolsPrice').value) || 0;
    var fee = parseFloat(document.getElementById('toolsFee').value) || 0;
    var ship = parseFloat(document.getElementById('toolsShip').value) || 0;
    var valueEl = document.getElementById('toolsGaugeValue');
    var subEl = document.getElementById('toolsGaugeSub');
    var tagEl = document.getElementById('toolsGaugeTag');
    if(!price || price <= 0){
      valueEl.textContent = '—';
      subEl.textContent = '판매가를 입력해주세요';
      tagEl.hidden = true;
      updateGauge(0);
      return null;
    }
    var feeAmount = price * (fee / 100);
    var profit = price - cost - ship - feeAmount;
    var marginPct = (profit / price) * 100;
    var tier = updateGauge(marginPct);
    valueEl.textContent = marginPct.toFixed(1) + '%';
    subEl.textContent = '순이익 ' + Math.round(profit).toLocaleString('ko-KR') + '원';
    tagEl.hidden = false;
    tagEl.className = 'gauge-tag ' + tier;
    tagEl.textContent = tier === 'good' ? '✅ 권장 마진(30%) 달성' : (tier === 'mid' ? '표준 마진 구간' : '⚠️ 마진이 낮아요');
    return {cost: cost, price: price, fee: fee, ship: ship, profit: Math.round(profit), marginPct: marginPct};
  }
  ['toolsCost', 'toolsPrice', 'toolsFee', 'toolsShip'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('input', computeToolsCalc);
  });
  computeToolsCalc();

  /* saved calculations — this browser only, capped at the 5 most
     recent (no login yet, so nowhere else to put them). */
  var SAVED_CALC_KEY = 'ld-tools-calc-history';
  function getSavedCalcs(){
    try{ return JSON.parse(localStorage.getItem(SAVED_CALC_KEY) || '[]'); }catch(e){ return []; }
  }
  function renderSavedCalcs(){
    var list = document.getElementById('savedCalcList');
    if(!list) return;
    var items = getSavedCalcs();
    if(!items.length){
      list.innerHTML = '<div class="empty-state" style="padding:1.6rem 1rem;"><p style="margin:0;">아직 저장한 계산이 없어요.</p></div>';
      return;
    }
    var rows = items.map(function(it){
      return '<div class="saved-calc-row"><div><div>판매가 ' + it.price.toLocaleString('ko-KR') + '원 · 마진 ' + it.marginPct.toFixed(1) + '%</div><div class="scr-date">' + it.date + '</div></div>' +
        '<div style="font-family:var(--f-mono); font-weight:700;">' + it.profit.toLocaleString('ko-KR') + '원</div></div>';
    }).join('');
    list.innerHTML = rows + '<button type="button" class="saved-calc-clear" id="savedCalcClear">전체 지우기</button>';
    var clearBtn = document.getElementById('savedCalcClear');
    if(clearBtn) clearBtn.addEventListener('click', function(){
      try{ localStorage.removeItem(SAVED_CALC_KEY); }catch(e){}
      renderSavedCalcs();
    });
  }
  var toolsSaveBtn = document.getElementById('toolsSaveCalc');
  if(toolsSaveBtn){
    toolsSaveBtn.addEventListener('click', function(){
      var result = computeToolsCalc();
      if(!result){ showToast('판매가를 먼저 입력해주세요'); return; }
      var items = getSavedCalcs();
      var now = new Date();
      result.date = (now.getMonth() + 1) + '.' + now.getDate() + '. ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
      items.unshift(result);
      items = items.slice(0, 5);
      try{ localStorage.setItem(SAVED_CALC_KEY, JSON.stringify(items)); }catch(e){}
      renderSavedCalcs();
      showToast('계산 결과를 저장했어요', 'success');
    });
  }
  renderSavedCalcs();

  /* /services/setup — 세팅 대행 3단계 플로우. 신청 데이터를 실제로
     받을 서버가 없어서, 완료 화면은 "다 됐어요" 가짜 화면이 아니라
     사용자가 직접 [보내기]를 눌러야 완성되는 진짜 mailto: 메일로
     연결합니다. CONTACT_EMAIL을 아직 못 정해서 비워뒀어요 — 실제
     수신 이메일이 정해지면 이 한 줄만 채우면 됩니다. */
  var CONTACT_EMAIL = ''; // TODO: 실제 수신 이메일 주소로 교체
  var setupView = document.getElementById('view-services-setup');
  if(setupView){
    var setupSelectedPlan = null;
    var setupSteps = setupView.querySelectorAll('.setup-step[data-step]');
    var setupStepItems = setupView.querySelectorAll('.setup-step-item[data-step-indicator]');

    function setupShowStep(n){
      setupSteps.forEach(function(s){ s.hidden = (s.getAttribute('data-step') !== String(n)); });
      setupStepItems.forEach(function(item){
        var i = parseInt(item.getAttribute('data-step-indicator'), 10);
        item.classList.toggle('active', i === n);
        item.classList.toggle('done', i < n);
      });
      var contentEl = setupView.closest('.content') || setupView;
      contentEl.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'});
    }

    function setupSelectPlan(planEl){
      setupView.querySelectorAll('.setup-plan').forEach(function(p){ p.classList.toggle('selected', p === planEl); });
      setupSelectedPlan = {
        key: planEl.getAttribute('data-plan'),
        name: planEl.getAttribute('data-name'),
        price: parseInt(planEl.getAttribute('data-price'), 10),
        days: planEl.getAttribute('data-days'),
        icon: planEl.querySelector('.sp-icon') ? planEl.querySelector('.sp-icon').textContent : '🛠️'
      };
      var goBtn = document.getElementById('setupGoStep2');
      if(goBtn) goBtn.textContent = setupSelectedPlan.name + ' 신청하기 →';
    }
    // 기본 선택값(스탠다드)을 실제 상태로도 반영
    var initialPlan = setupView.querySelector('.setup-plan.selected') || setupView.querySelector('.setup-plan');
    if(initialPlan) setupSelectPlan(initialPlan);

    setupView.querySelectorAll('.setup-plan').forEach(function(planEl){
      planEl.addEventListener('click', function(){ setupSelectPlan(planEl); });
    });

    var setupGoStep2 = document.getElementById('setupGoStep2');
    if(setupGoStep2) setupGoStep2.addEventListener('click', function(){
      if(!setupSelectedPlan) return;
      var iconEl = document.getElementById('setupSummaryIcon');
      var nameEl = document.getElementById('setupSummaryName');
      var metaEl = document.getElementById('setupSummaryMeta');
      if(iconEl) iconEl.textContent = setupSelectedPlan.icon;
      if(nameEl) nameEl.textContent = setupSelectedPlan.name;
      if(metaEl) metaEl.textContent = '₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원 · ' + setupSelectedPlan.days;
      setupShowStep(2);
    });

    var setupChangePlan = document.getElementById('setupChangePlan');
    if(setupChangePlan) setupChangePlan.addEventListener('click', function(){ setupShowStep(1); });

    var setupBackTo1 = document.getElementById('setupBackTo1');
    if(setupBackTo1) setupBackTo1.addEventListener('click', function(){ setupShowStep(1); });

    var setupForm = document.getElementById('setupForm');
    if(setupForm) setupForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(!setupSelectedPlan) return;
      var name = document.getElementById('setupName').value.trim();
      var platform = document.getElementById('setupPlatform').value.trim();
      var phone = document.getElementById('setupPhone').value.trim();
      var note = document.getElementById('setupNote').value.trim();

      var resultPlan = document.getElementById('setupResultPlan');
      var resultPrice = document.getElementById('setupResultPrice');
      var resultName = document.getElementById('setupResultName');
      var resultPhone = document.getElementById('setupResultPhone');
      if(resultPlan) resultPlan.textContent = setupSelectedPlan.name;
      if(resultPrice) resultPrice.textContent = '₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원';
      if(resultName) resultName.textContent = name || '-';
      if(resultPhone) resultPhone.textContent = phone || '-';

      var subject = '[런치데스크] ' + setupSelectedPlan.name + ' 세팅 대행 신청 — ' + (name || '이름 미입력');
      var bodyLines = [
        '■ 신청 플랜: ' + setupSelectedPlan.name + ' (₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원, ' + setupSelectedPlan.days + ')',
        '■ 성함: ' + (name || '-'),
        '■ 쇼핑몰 플랫폼: ' + (platform || '-'),
        '■ 연락처: ' + (phone || '-'),
        '■ 세팅 요청 사항:',
        note || '(작성 안 함)'
      ];
      var body = bodyLines.join('\n');
      var fallbackEmail = document.getElementById('setupFallbackEmail');
      if(fallbackEmail) fallbackEmail.textContent = CONTACT_EMAIL || '[이메일 주소]';
      var mailBtn = document.getElementById('setupMailBtn');
      if(mailBtn) mailBtn.href = 'mailto:' + encodeURIComponent(CONTACT_EMAIL) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);

      setupShowStep(3);
    });

    var setupRestart = document.getElementById('setupRestart');
    if(setupRestart) setupRestart.addEventListener('click', function(){
      setupForm.reset();
      var standardPlan = setupView.querySelector('.setup-plan[data-plan="standard"]');
      if(standardPlan) setupSelectPlan(standardPlan);
      setupShowStep(1);
    });
  }

  /* promo banner countdown — real target (next Sunday 00:00 local time),
     not a random fake number — removed for now since the top banner no
     longer claims a purchase/discount, only that the preview is free. */

  /* 수익 시뮬레이터 — genuinely computed from the 4 inputs, not fake.
     손익분기점 = 광고비를 회수하는 데 필요한 판매량
     (광고비 ÷ 개당 판매가-원가 마진), 로드맵은 목표 판매량/광고비의
     30%·60%·100% 지점으로 3단계를 나눈다. */
  var simInputs = ['simQty','simPrice','simCostRate','simAdRate'].map(function(id){ return document.getElementById(id); });
  if(simInputs[0]){
    var fmtWon = function(n){ return '₩' + Math.round(n).toLocaleString('ko-KR'); };
    var computeSimulator = function(){
      var qty = parseFloat(document.getElementById('simQty').value) || 0;
      var price = parseFloat(document.getElementById('simPrice').value) || 0;
      var costRate = parseFloat(document.getElementById('simCostRate').value) || 0;
      var adRate = parseFloat(document.getElementById('simAdRate').value) || 0;

      var revenue = qty * price;
      var costTotal = revenue * costRate / 100;
      var adCost = revenue * adRate / 100;
      var profit = revenue - costTotal - adCost;
      var marginRate = revenue > 0 ? Math.round(profit / revenue * 100) : 0;
      var unitMargin = price - (price * costRate / 100);
      var breakeven = unitMargin > 0 ? Math.ceil(adCost / unitMargin) : 0;

      document.getElementById('simRevenue').textContent = fmtWon(revenue);
      document.getElementById('simAdCost').textContent = fmtWon(adCost);
      document.getElementById('simCostTotal').textContent = fmtWon(costTotal);
      document.getElementById('simBreakeven').textContent = breakeven + '개';
      document.getElementById('simProfit').textContent = fmtWon(profit);
      document.getElementById('simMarginRate').textContent = '마진율 ' + marginRate + '%';

      var stageFractions = [.3, .6, 1];
      for(var i = 0; i < 3; i++){
        var goal = Math.max(1, Math.round(qty * stageFractions[i]));
        var budget = adCost * stageFractions[i];
        document.getElementById('simRoad' + (i + 1) + 'Goal').textContent = goal + '개 판매';
        document.getElementById('simRoad' + (i + 1) + 'Budget').textContent = '광고예산 ' + fmtWon(budget);
      }
    };
    simInputs.forEach(function(el){ el.addEventListener('input', computeSimulator); });
    computeSimulator();
  }

  /* 광고 기록 — real localStorage log the user builds up over time
     (unlike the checklist/setup trackers, there's no "looks like
     someone else's completed work" concern here — it's just numbers
     the seller typed in, same category as the saved margin calcs). */
  var ADLOG_KEY = 'ld-adlog-records';
  var adlogTbody = document.getElementById('adlogTbody');
  if(adlogTbody){
    var getAdlogRecords = function(){
      try{ return JSON.parse(localStorage.getItem(ADLOG_KEY) || '[]'); }catch(e){ return []; }
    };
    var saveAdlogRecords = function(list){
      try{ localStorage.setItem(ADLOG_KEY, JSON.stringify(list)); }catch(e){}
    };
    var roasClass = function(roas){
      if(roas >= 4) return 'roas-good';
      if(roas >= 2) return 'roas-mid';
      return 'roas-low';
    };
    window.deleteAdlogRecord = function(id){
      var list = getAdlogRecords().filter(function(r){ return String(r.id) !== String(id); });
      saveAdlogRecords(list);
      renderAdlog();
    };
    var renderAdlog = function(){
      var list = getAdlogRecords();
      if(!list.length){
        adlogTbody.innerHTML = '<tr><td colspan="7"><div class="adlog-empty">아직 기록이 없어요 — "+ 기록 추가"로 첫 광고 성과를 남겨보세요.</div></td></tr>';
      } else {
        adlogTbody.innerHTML = list.map(function(r){
          var roas = r.spend > 0 ? (r.revenue / r.spend) : 0;
          var chanColor = {메타:'var(--badge-a)', 네이버:'var(--badge-c)', 카카오:'var(--badge-b)', 인스타:'var(--badge-d)'}[r.channel] || 'var(--ink-faint)';
          return '<tr>' +
            '<td>' + r.date + '</td>' +
            '<td><span class="adlog-channel" style="background:' + chanColor + '">' + r.channel + '</span></td>' +
            '<td>' + r.name + '</td>' +
            '<td class="num">₩' + Math.round(r.spend).toLocaleString('ko-KR') + '</td>' +
            '<td class="num">₩' + Math.round(r.revenue).toLocaleString('ko-KR') + '</td>' +
            '<td class="num ' + roasClass(roas) + '">' + roas.toFixed(1) + 'x</td>' +
            '<td><button type="button" class="adlog-del" data-id="' + r.id + '">✕</button></td>' +
          '</tr>';
        }).join('');
      }
      var totalSpend = list.reduce(function(s, r){ return s + r.spend; }, 0);
      var totalRevenue = list.reduce(function(s, r){ return s + r.revenue; }, 0);
      var avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
      var best = list.slice().sort(function(a, b){
        var ra = a.spend > 0 ? a.revenue / a.spend : 0;
        var rb = b.spend > 0 ? b.revenue / b.spend : 0;
        return rb - ra;
      })[0];
      document.getElementById('adlogSumSpend').textContent = '₩' + Math.round(totalSpend).toLocaleString('ko-KR');
      document.getElementById('adlogSumRoas').textContent = avgRoas.toFixed(1) + 'x';
      document.getElementById('adlogSumBest').textContent = best ? best.name : '—';
    };
    document.getElementById('adlogForm').addEventListener('submit', function(e){
      e.preventDefault();
      var channelBtn = document.querySelector('.adlog-chan-btn.active');
      var list = getAdlogRecords();
      list.unshift({
        id: Date.now(),
        date: document.getElementById('adlogDate').value,
        name: document.getElementById('adlogName').value,
        spend: parseFloat(document.getElementById('adlogSpend').value) || 0,
        revenue: parseFloat(document.getElementById('adlogRevenue').value) || 0,
        channel: channelBtn ? channelBtn.getAttribute('data-channel') : '메타'
      });
      saveAdlogRecords(list);
      renderAdlog();
      e.target.reset();
      document.getElementById('adlogFormWrap').hidden = true;
      showToast('광고 기록이 저장됐어요', 'success');
    });
    renderAdlog();
  }

  render(); // initial paint
})();