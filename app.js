(function(){
  document.getElementById('year').textContent = new Date().getFullYear();
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // last chapter path a GA4 chapter_start fired for — see render() below;
  // declared here so it survives across every render() call, not just one
  var lastChapterStartPath = null;
  // same duplicate-prevention idea as lastChapterStartPath above, but for the
  // internal product_events 'dashboard_viewed' event (see render() below) —
  // guards against render() re-running for the same route without the hash
  // actually changing, while still firing again on every real navigation
  // back into /tools (which is what the 7-day revisit metric needs).
  var lastDashboardViewedPath = null;

  /* Views that actually exist. Add a line here the moment a new
     <section class="view" id="view-XXX"> is built — every #/path
     link pointing at it starts working immediately. */
  var BUILT = {
    '/':              'view-home',
    '/dashboard':     'view-dashboard',
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
    '/wholesale':     'view-wholesale',
    '/services/setup': 'view-services-setup',
    '/guide':        'view-guide',
    '/contact':      'view-contact',
    '/account':       'view-account',
    '/admin':         'view-admin',
    '/privacy':       'view-privacy',
    '/terms':         'view-terms'
  };

  /* Display name shown in the topbar crumb, and (for paths not in
     BUILT) on the "coming soon" placeholder. */
  var TITLES = {
    '/':                 '홈',
    '/dashboard':        '운영 현황',
    '/start':            '쇼핑몰 시작하기',
    '/start/intro':      '00 · 오리엔테이션',
    '/tools':            '마진 계산기',
    '/resources':        '자료실',
    '/wholesale':        '도매처 찾기',
    '/services/setup':   '대행 서비스',
    '/login':            '로그인',
    '/contact':          '문의하기',
    '/terms':            '이용약관',
    '/privacy':          '개인정보처리방침',
    '/business-info':    '사업자 정보',
    '/guide':            '이용 안내',
    '/start/prepare':    '01 · 방향 정하기',
    '/start/setup':      '02 · 사업자 · 플랫폼',
    '/start/sourcing':   '03 · 상품 기획',
    '/start/content':    '04 · 촬영 & 상세페이지',
    '/start/marketing-setup': '06 · 마케팅 인프라 세팅',
    '/start/marketing':  '07 · 유입 · 반응 테스트',
    '/start/orders':     '05 · 배송 · CS · 오픈 준비',
    '/start/wrapup':     '08 · 마무리',
    '/account':          '내 쇼핑몰',
    '/admin':            'LaunchDesk Admin'
  };
  /* 상단바 crumb에만 쓰는 표시 라벨(2026-09 UI 재설계 1차) — 사이드바 메뉴
     이름(시작 데스크 / 쇼핑몰 준비)과 맞추기 위한 것. GA4 page_title은
     계속 TITLES를 쓰므로 분석 지표는 바뀌지 않는다. */
  var CRUMB_LABELS = {
    '/':      '시작 데스크',
    '/start': '쇼핑몰 준비'
  };

  function currentPath(){
    var h = location.hash.replace(/^#/, '');
    return h || '/';
  }

  // TITLES엔 /resources/<slug> 형태의 가이드 하나하나를 등록하지 않으므로(위
  // BUILT viewId 처리와 같은 이유), crumb·GA4 page_title이 "준비 중"으로
  // 잘못 떨어지지 않도록 /resources 자체의 제목으로 대신 채운다.
  function titleForPath(path){
    return TITLES[path] || (path.indexOf('/resources/') === 0 ? TITLES['/resources'] : undefined);
  }

  /* GA4로 보낼 page_location을 안전하게 만든다(2026-09-15 감사 반영,
     Google/Kakao 로그인 추가로 쿼리스트링 보호 항목 추가). 왜 필요한가:
     이메일 인증 확인/매직링크 등 Supabase 인증 콜백이 이 페이지로 돌아올
     때 URL 해시에 access_token/refresh_token 등 자격증명이 실려 온다(예:
     '#access_token=...&refresh_token=...&type=signup'). Supabase SDK가
     detectSessionInUrl로 그 해시를 세션에 반영하고 정리하지만, 그 처리는
     비동기이고 이 스크립트는 파일 하단에서 render()를 동기로 1회 호출한다
     (초기 진입) — SDK 정리가 끝나기 전에 이 render()가 먼저 실행돼
     location.href를 그대로 읽어갈 수 있다. 이 앱의 정상 해시 라우트는
     전부 '#/'로 시작하므로(BUILT/TITLES 전부 '/'로 시작하는 경로,
     currentPath() 참고) 해시가 그 형태일 때만 포함하고, 그 외에는(위
     access_token 케이스 포함, 형태를 알 수 없는 무엇이든) 해시를 통째로
     잘라낸다.

     Google/Kakao 로그인 추가로 같은 문제가 쿼리스트링에도 생긴다 —
     Supabase의 기본 OAuth 플로우(PKCE)는 콜백 URL에 '?code=...'(1회용
     인가 코드)를 실어 돌려주고, provider가 오류를 반환하면
     '?error=...&error_description=...'가 실린다. Supabase SDK가 이것도
     내부적으로 처리 후 정리하지만 이 역시 비동기라 같은 타이밍 문제가
     있다 — code/error 자체는 access_token만큼 민감하지는 않지만(code는
     1회성이고 서버 간 교환 없이는 무용지물), 그래도 GA4 같은 제3자
     analytics로 보낼 이유가 전혀 없어 쿼리스트링에서도 이 값들만 제거한다.
     utm_source 등 나머지 쿼리 파라미터는 그대로 남긴다(UTM 회귀 방지 —
     GA4는 UTM을 그대로 봐야 한다).

     Supabase 인증 흐름 자체는 전혀 건드리지 않는다(그 정리 로직은 그대로
     자기 타이밍에 실행된다 — 여기서는 GA4로 나가는 문자열만 방어적으로
     다시 만든다). */
  var OAUTH_CALLBACK_PARAM_NAMES = ['code', 'error', 'error_code', 'error_description', 'state'];
  function safePageLocation(){
    var hash = location.hash;
    var safeHash = (hash.indexOf('#/') === 0) ? hash : '';
    var safeSearch = location.search;
    if(safeSearch){
      try{
        var params = new URLSearchParams(safeSearch);
        var hadOauthParam = false;
        OAUTH_CALLBACK_PARAM_NAMES.forEach(function(name){
          if(params.has(name)){ params.delete(name); hadOauthParam = true; }
        });
        if(hadOauthParam){
          var remaining = params.toString();
          safeSearch = remaining ? '?' + remaining : '';
        }
      }catch(e){ /* URLSearchParams 미지원 등 — 원본 쿼리스트링 그대로 사용 */ }
    }
    return location.origin + location.pathname + safeSearch + safeHash;
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
    // 실사용 테스트 P2#2 — 서랍이 실제로 열려 있었을 때만 배경을 다시 조작
    // 가능하게 하고 햄버거 버튼으로 포커스를 돌린다. render()가 라우트
    // 전환마다 이 함수를 무조건 호출하므로(위 참고), 이 가드가 없으면 서랍을
    // 연 적 없는 일반 네비게이션에서도 포커스를 매번 햄버거 버튼으로
    // 빼앗아 간다.
    var wasOpen = sidebar.classList.contains('open');
    sidebar.classList.remove('open');
    scrim.classList.remove('show');
    navToggle.setAttribute('aria-expanded','false');
    if(appMain){ appMain.inert = false; appMain.removeAttribute('aria-hidden'); }
    if(wasOpen) navToggle.focus();
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

  /* GA4 page_view — hash routes never trigger a real page load, so the
     automatic page_view (disabled via send_page_view:false in the GA4
     tag) is replaced by this one manual event per render(), covering
     both the initial paint and every hashchange. No user input here —
     path/title are always one of the fixed strings in BUILT/TITLES.
     Guarded so a blocked/failed GA4 load never breaks navigation.
     Exposed as window.launchdeskSendPageView so the analytics-consent
     banner can fire exactly one page_view for the current route right
     after the user grants consent mid-session (render() itself won't
     run again then — no hashchange happens on a consent click). */
  function sendPageViewEvent(path){
    if(typeof gtag !== 'function') return;
    gtag('event', 'page_view', {
      page_title: titleForPath(path) || '준비 중',
      page_location: safePageLocation(), // location.href 그대로 쓰지 않음 — 위 safePageLocation() 주석 참고(인증 콜백 토큰 해시 유출 방지)
      page_path: path
    });
  }
  window.launchdeskSendPageView = function(){ sendPageViewEvent(currentPath()); };

  function render(){
    var path = currentPath();
    document.querySelectorAll('.view').forEach(function(v){ v.hidden = true; v.classList.remove('fade-in'); });
    // 자료실 내부 가이드 상세는 #/resources/<slug> 하위 경로로 연다(2026-09
    // 자료실 전면 재설계) — BUILT에 가이드 하나하나를 등록하지 않고, "/resources/로
    // 시작하면 자료실 화면"이라는 규칙만 여기 둔다. 실제 어떤 가이드를 보여줄지는
    // resources.js가 자기 hashchange 리스너로 독립적으로 판단한다(이 파일은
    // 화면 전환 자체만 책임진다) — resources.js 상단 주석 참고.
    var viewId = BUILT[path] || (path.indexOf('/resources/') === 0 ? 'view-resources' : undefined);
    var target = document.getElementById(viewId || 'view-coming-soon');
    if(!viewId){
      document.getElementById('csLabel').textContent = TITLES[path] || '요청하신 페이지';
    }
    target.hidden = false;
    if(!reduceMotion){ target.classList.add('fade-in'); applyStagger(target); }
    document.getElementById('crumbLabel').textContent = CRUMB_LABELS[path] || titleForPath(path) || '준비 중';
    setActiveNav(path);
    window.scrollTo(0, 0);
    closeSidebar();

    /* 로드맵 진행 표시(2026-09 UI 재설계 2차): 홈 "이어서 준비하기" 카드와 /start
       상태·카드 라벨(완료/진행 중/시작 전)은 저장된 data를 읽어 그리므로, 그 두
       화면에 들어올 때 한 번 다시 그려 STEP 화면에서 방금 입력한 부분 진행이 바로
       반영되게 한다. recomputeProgress()는 DOM만 다시 칠하고 저장·완료 판정은
       하지 않는다(setChapterDone/STEP_EVALUATORS와 무관). */
    if(path === '/' || path === '/start') recomputeProgress();

    sendPageViewEvent(path);

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
        /* internal product event: roadmap_started — "사용자가 로드맵을
           처음 실제 시작한 시점"을 STEP01~07(실제 작업 챕터) 중 어느
           것이든 처음 진입하는 순간으로 정의한다(2026-09-15 감사 반영 —
           STEP01만이 아니라 STEP03부터 시작하는 것처럼 STEP을 건너뛴
           진입도 "시작"으로 잡아야 정의가 정확하다). STEP00(/start/intro)과
           STEP08(/start/wrapup)은 게이트 없는 소개/마무리 화면이라
           제외한다 — 이 두 경로만 리터럴로 비교해서, 뒤에서 정의되는
           GATED_STEPS 배열을 여기서 참조하지 않는다(전에는 GATED_STEPS[0]을
           참조했는데, render() 호출이 항상 그 정의 이후라 실제로는
           안전했지만 이 블록만 봐서는 알 수 없는 깨지기 쉬운 구조였다 —
           지금은 이 블록만으로도 안전하다). 이미 이 if(path !==
           lastChapterStartPath) 가드 안이므로 같은 경로 재진입 시 중복
           기록되지 않고, 관리자 집계가 distinct user 기준이라 STEP01~07
           여러 개에 걸쳐 진입해도 사용자당 1명으로만 반영된다. 로그인
           여부 확인은 trackProductEvent가 전담. */
        if(window.launchdeskProductEvents && path !== '/start/intro' && path !== '/start/wrapup'){
          window.launchdeskProductEvents.track('roadmap_started');
        }
      }
    } else {
      lastChapterStartPath = null;
    }

    /* internal product event: dashboard_viewed — "사용자가 실제 운영
       대시보드에 진입했을 때"를 /tools 진입 시점으로 정의한다. /tools는
       상단에 ops-overview.js가 그리는 "쇼핑몰 운영 현황" 패널(연결된
       Cafe24 쇼핑몰의 실제 orders 집계)과 Meta 광고 성과 패널을 항상
       포함하고, 그 아래 마진 계산기가 이어지는 화면이다(2026-09 정보구조
       정리 3차로 예전 탭 바의 수익 시뮬레이터/광고기록/분석 대시보드
       placeholder 탭은 없앴거나 #/dashboard로 옮겼다 — 이벤트 정의·발생
       시점은 그대로 /tools 진입 기준이라 바뀌지 않는다).
       lastDashboardViewedPath 가드로 같은 라우트에서 render()가 반복
       호출돼도 중복 기록하지 않지만(요구사항 6 — render마다 기록 금지),
       /tools를 벗어났다가 다른 날 다시 들어오면(hashchange가 다시 발생)
       정상적으로 새 이벤트로 기록된다 — 7일 재방문 지표가 필요로 하는
       바로 그 동작이다. 로그인 여부 확인/실패 시 무시는 trackProductEvent가
       전담하므로 여기서는 라우트 판별만 한다. */
    if(path === '/tools'){
      if(path !== lastDashboardViewedPath){
        lastDashboardViewedPath = path;
        if(window.launchdeskProductEvents) window.launchdeskProductEvents.track('dashboard_viewed');
      }
    } else {
      lastDashboardViewedPath = null;
    }
  }

  window.addEventListener('hashchange', render);

  /* mobile sidebar drawer */
  var navToggle = document.getElementById('navToggle');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');
  var sidebarClose = document.getElementById('sidebarClose');
  // 서랍이 열려 있는 동안 배경(상단바 + 본문)을 inert로 막는다 — #opsdashRoot
  // 게스트 게이트가 이미 쓰는 것과 같은 패턴(클릭 · Tab · 스크린리더 전부
  // 차단, 네이티브 기능이라 포커스 트랩을 직접 구현할 필요가 없다). 실사용
  // 테스트 P2#2: 서랍이 열려도 Tab이 배경 링크로 계속 새 나갔다.
  var appMain = document.querySelector('.app-main');
  navToggle.addEventListener('click', function(){
    var open = sidebar.classList.toggle('open');
    scrim.classList.toggle('show', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if(appMain){
      if(open){ appMain.inert = true; appMain.setAttribute('aria-hidden', 'true'); }
      else { appMain.inert = false; appMain.removeAttribute('aria-hidden'); }
    }
    if(open && sidebarClose) sidebarClose.focus(); // 서랍 진입 시 포커스를 안으로
  });
  scrim.addEventListener('click', closeSidebar);
  // 2026-09 UI 재설계 1차 — 서랍은 햄버거·스크림 외에 닫기 버튼·Escape·
  // 서랍 안 링크 클릭으로도 닫힌다(같은 경로 링크는 hashchange가 없어
  // render()의 closeSidebar()가 돌지 않으므로 여기서 직접 닫는다).
  if(sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });
  sidebar.addEventListener('click', function(e){
    if(e.target.closest('a[href]')) closeSidebar();
  });
  // 하단 도움말 링크는 클릭 시 해시 경로를 명시적으로 갱신한다.
  // 이미 보고 있는 경로를 다시 눌렀을 때도 화면을 갱신한다.
  var sidebarHelpLinks = sidebar.querySelector('.sidebar-links');
  if(sidebarHelpLinks) sidebarHelpLinks.addEventListener('click', function(e){
    if(e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target.closest('a[href^="#/"]');
    if(!link || !sidebarHelpLinks.contains(link)) return;
    e.preventDefault();
    var href = link.getAttribute('href');
    if(href.slice(1) === currentPath()) render();
    else location.hash = href;
  });
  /* 같은 해시 경로 재클릭(2026-09 UI 재설계 2차) — 사이드바·본문의 내부 링크가
     지금 보고 있는 경로(#/dashboard 등)를 다시 가리키면 hashchange가 발생하지
     않아 render()의 scrollTo(0,0)/closeSidebar()가 돌지 않는다. 그 경우만 여기서
     같은 두 동작을 직접 한다. 범위는 '#/'로 시작하는 해시 라우트 링크뿐이다 —
     로그인 모달 링크(#/login, 아래 전용 위임 핸들러가 preventDefault로 처리)와
     외부/일반 앵커 링크, 새 탭 클릭(수정키·가운데 버튼)은 건드리지 않는다. */
  document.addEventListener('click', function(e){
    if(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target.closest('a[href^="#/"]');
    if(!link || link.getAttribute('target') === '_blank') return;
    var href = link.getAttribute('href');
    if(href === '#/login') return;
    var linkPath = href.replace(/^#/, '') || '/';
    if(linkPath !== currentPath()) return; // 경로가 바뀌면 hashchange → render()가 처리
    window.scrollTo(0, 0);
    closeSidebar();
  });

  /* photo lightbox — event-delegated so it works across every view */
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightboxImg');
  var lightboxCloseBtn = document.getElementById('lightboxClose');
  // 실사용 테스트 P2#3 — .lightbox/.modal은 닫힌 상태에서 opacity:0 +
  // pointer-events:none으로만 숨겨져 있었다(styles.css) — 둘 다 시각 ·
  // 마우스만 막을 뿐 Tab 순서에서는 안 빠지므로, 닫힌 lightboxClose/
  // loginModalClose가 그대로 Tab에 잡혔다. inert를 열림 상태에서만 떼서
  // (#opsdashRoot 게스트 게이트와 동일한 패턴) Tab · 클릭 · 스크린리더 전부
  // 막는다. 여는 요소로 포커스를 저장해뒀다가 닫을 때 그대로 되돌린다.
  var lightboxOpener = null;
  function openLightbox(src, alt){
    lightboxOpener = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.classList.add('open');
    lightbox.inert = false;
    lightbox.removeAttribute('aria-hidden');
    if(lightboxCloseBtn) lightboxCloseBtn.focus();
  }
  function closeLightbox(){
    lightbox.classList.remove('open');
    lightbox.inert = true;
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImg.src = '';
    if(lightboxOpener && typeof lightboxOpener.focus === 'function') lightboxOpener.focus();
    lightboxOpener = null;
  }
  document.addEventListener('click', function(e){
    var chip = e.target.closest('.photo-chip');
    if(chip){ openLightbox(chip.getAttribute('data-img'), chip.getAttribute('data-alt')); return; }
    if(e.target === lightbox || e.target.closest('#lightboxClose')){ closeLightbox(); }
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeLightbox(); });

  /* login modal — every #/login link opens this instead of routing away.
     Supabase Auth(이메일 회원가입/로그인)를 실제로 연결한다. Google/Kakao
     버튼은 이번 단계 범위 밖이라 그대로 "아직 준비 중" 안내로 남겨둔다.
     같은 폼(이메일+비밀번호[+비밀번호 확인])을 loginMode에 따라 로그인/
     회원가입 두 용도로 재사용한다 — 새 페이지나 새 폼을 만들지 않는다. */
  var loginModal = document.getElementById('loginModal');
  var loginFormWrap = document.getElementById('loginFormWrap');
  var loginNotice = document.getElementById('loginNotice');
  var loginNoticeText = document.getElementById('loginNoticeText');
  var loginModalTitle = document.getElementById('loginModalTitle');
  var loginModalLead = document.getElementById('loginModalLead');
  var loginForm = document.getElementById('loginForm');
  var loginSubmitBtn = document.getElementById('loginSubmitBtn');
  var loginFootLead = document.getElementById('loginFootLead');
  var loginToSignup = document.getElementById('loginToSignup');
  var loginPwConfirmField = document.getElementById('loginPwConfirmField');
  var loginPwConfirm = document.getElementById('loginPwConfirm');
  var loginMode = 'login'; // 'login' | 'signup' — 같은 모달/폼을 토글
  /* Supabase SDK는 실제 로그인 제출이 아니어도(예: 탭이 다시 포커스를
     받아 세션을 재검증할 때) 'SIGNED_IN' 이벤트를 다시 쏠 수 있다. 그걸
     "방금 사용자가 로그인 버튼을 눌렀다"로 착각하면, 레거시/게스트 병합
     확인창이 매번 다시 뜨고 hydrate()가 반복 실행되어 입력 중인 화면을
     되돌려버릴 수 있다 — 그래서 이벤트 이름이 아니라, 우리가 직접
     signInWithPassword()를 호출했는지로 "진짜 로그인"을 판별한다. */
  var pendingFreshLogin = false;

  function applyLoginModalMode(){
    // 필수 동의 체크박스는 이메일 회원가입 모드에서 항상 보이고, 로그인
    // 모드에서는 기본 숨김 — 다만 Google 버튼은 모드 구분 없이 항상 동의를
    // 요구하므로(startOAuthLogin 참고) 로그인 모드에서 그 버튼을 누르면
    // revealSignupConsent()로 강제로 드러난다.
    var PC = window.launchdeskPolicyConsent;
    if(loginMode === 'signup'){
      loginModalTitle.textContent = '회원가입';
      loginModalLead.textContent = '이메일과 비밀번호로 몇 초 만에 시작하세요.';
      loginSubmitBtn.textContent = '회원가입';
      loginFootLead.textContent = '이미 계정이 있으신가요?';
      loginToSignup.textContent = '로그인';
      if(loginPwConfirmField) loginPwConfirmField.hidden = false;
      if(PC) PC.setSignupConsentVisible(true);
    } else {
      loginModalTitle.textContent = '로그인';
      loginModalLead.textContent = '로그인하면 진행 상황이 계정에 저장돼요.';
      loginSubmitBtn.textContent = '로그인';
      loginFootLead.textContent = '아직 계정이 없으신가요?';
      loginToSignup.textContent = '회원가입';
      if(loginPwConfirmField) loginPwConfirmField.hidden = true;
      if(loginPwConfirm) loginPwConfirm.value = '';
      if(PC) PC.setSignupConsentVisible(false);
    }
    if(PC) PC.clearSignupConsentError();
  }
  var loginModalOpener = null;
  function openLoginModal(opts){
    loginModalOpener = document.activeElement;
    loginMode = 'login';
    applyLoginModalMode();
    loginFormWrap.hidden = false;
    loginNotice.hidden = true;
    // 선택적 한 줄 안내(예: plans.js — "로그인 후 작성한 내용을 확인하고
    // 저장할 수 있어요."). 문자열이 아니면(이벤트 객체가 그대로 넘어온
    // 경우 포함) 아무 것도 표시하지 않는다. 인증 흐름 자체는 바뀌지 않는다.
    var hintEl = document.getElementById('loginModalHint');
    if(hintEl){
      var hint = (opts && typeof opts.hint === 'string') ? opts.hint : '';
      hintEl.textContent = hint;
      hintEl.hidden = !hint;
    }
    loginModal.classList.add('open');
    loginModal.inert = false;
    loginModal.removeAttribute('aria-hidden');
    document.getElementById('loginEmail').focus();
  }
  // 다른 독립 모듈(wholesalers.js 등)이 "로그인이 필요합니다" 상황에서
  // 로그인 화면 상태(loginMode='login' 초기화 포함)로 정확히 여는 최소
  // 진입점 — 그 모듈들이 이 로직을 복제하지 않고 이 함수를 그대로 재사용
  // 하게 하기 위함. 이 함수 자체의 동작은 위 openLoginModal()과 완전히
  // 동일하다(별도 로직 없음, 그대로 노출만).
  window.launchdeskOpenLoginModal = openLoginModal;
  function closeLoginModal(){
    loginModal.classList.remove('open');
    loginModal.inert = true;
    loginModal.setAttribute('aria-hidden', 'true');
    loginForm.reset();
    // 동의 체크박스는 loginForm 밖에 있어(Google 버튼이 모드 구분 없이
    // 참조해야 하므로) 위 reset()이 닿지 않는다 — 항상 미체크로 다시
    // 열리도록 별도로 초기화한다(요구사항 1).
    if(window.launchdeskPolicyConsent) window.launchdeskPolicyConsent.resetSignupConsent();
    if(loginModalOpener && typeof loginModalOpener.focus === 'function') loginModalOpener.focus();
    loginModalOpener = null;
  }
  function showLoginNotice(message){
    loginNoticeText.textContent = message || '로그인 기능은 아직 준비 중이에요. 조금만 기다려주세요!';
    loginFormWrap.hidden = true;
    loginNotice.hidden = false;
  }
  /* Supabase 오류 메시지(영문)를 그대로 보여주지 않고, 자주 나오는 케이스만
     이해하기 쉬운 한국어 안내로 바꾼다. 나머지는 공통 안내로 뭉뚱그린다. */
  function getAuthErrorMessage(err){
    var msg = (err && err.message) || '';
    if(/invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않아요.';
    if(/email not confirmed/i.test(msg)) return '이메일 인증이 아직 완료되지 않았어요. 받은 편지함을 확인해주세요.';
    if(/already registered|already exists/i.test(msg)) return '이미 가입된 이메일이에요. 로그인해주세요.';
    if(/password.*(least|character)/i.test(msg)) return '비밀번호는 8자 이상으로 입력해주세요.';
    if(/rate limit|too many/i.test(msg)) return '요청이 너무 많아요. 잠시 후 다시 시도해주세요.';
    if(/network|fetch/i.test(msg)) return '네트워크 연결을 확인해주세요.';
    return '문제가 발생했어요. 잠시 후 다시 시도해주세요.';
  }

  // ---------------------------------------------------------------------
  // Google/Kakao 로그인 — Supabase Auth의 공식 signInWithOAuth()만 사용한다
  // (직접 OAuth token exchange 구현 없음, client secret은 프론트에 없음 —
  // Google/Kakao Console/Supabase Dashboard에서만 관리).
  //
  // OAuth는 전체 페이지 리다이렉트를 거친다 — 이 IIFE의 메모리(변수
  // pendingFreshLogin 등)는 리다이렉트 후 완전히 새로 초기화되므로, 이메일
  // 로그인과 똑같은 "방금 로그인했다"(isFreshSignIn) 판정을 OAuth에도
  // 적용하려면 페이지를 넘어 살아남는 저장소가 필요하다. sessionStorage에
  // 최소 마커 하나만 남기고(탭을 닫으면 자동 소멸, access_token 등 세션
  // 자체는 전혀 담지 않음 — 그건 Supabase SDK가 자체 관리한다), 복귀 후
  // SIGNED_IN 이벤트에서 한 번만 소비한다. 이렇게 해야 OAuth로 처음
  // 로그인한 사용자도 기존 이메일 로그인과 동일하게 게스트 스냅샷 병합·
  // 레거시 마이그레이션·"로그인했어요" 토스트가 그대로 적용된다(요구사항
  // 3 — 새 별도 아키텍처가 아니라 기존 canonical flow에 합류).
  var OAUTH_FRESH_LOGIN_KEY = 'ld-oauth-pending-fresh-login';
  function markOAuthFreshLoginPending(){
    try{ sessionStorage.setItem(OAUTH_FRESH_LOGIN_KEY, '1'); }catch(e){}
  }
  function consumeOAuthFreshLoginPending(){
    try{
      if(sessionStorage.getItem(OAUTH_FRESH_LOGIN_KEY)){
        sessionStorage.removeItem(OAUTH_FRESH_LOGIN_KEY);
        return true;
      }
    }catch(e){}
    return false;
  }
  function clearOAuthFreshLoginPending(){
    try{ sessionStorage.removeItem(OAUTH_FRESH_LOGIN_KEY); }catch(e){}
  }

  var googleLoginBtn = document.getElementById('googleLoginBtn');
  var kakaoLoginBtn = document.getElementById('kakaoLoginBtn');
  var oauthInFlight = false; // 두 버튼 중 하나라도 진행 중이면 나머지도 잠근다(중복 클릭 방지)

  function setOAuthButtonsBusy(busy){
    [googleLoginBtn, kakaoLoginBtn].forEach(function(btn){
      if(!btn) return;
      btn.disabled = busy;
    });
  }

  function startOAuthLogin(provider){
    if(oauthInFlight) return;
    var sb = window.launchdeskSupabase;
    if(!sb){ showLoginNotice(); return; }

    // Google OAuth는 로그인/회원가입 모드 구분이 없고(버튼 하나가 최초
    // 로그인 시 자동으로 신규 가입까지 겸함) 리다이렉트 전에는 신규/기존
    // 계정 여부를 구조적으로 알 수 없다 — 그래서 모드와 무관하게 매번
    // 시작 전 필수 동의 두 항목을 확인한다. 이미 동의 이력이 있는 기존
    // 회원은 이 체크를 통과해도 아무 불이익이 없고(어차피 체크 상태만
    // 확인), 복귀 후 handleSession()의 게이트가 중복 행을 만들지 않는다.
    if(provider === 'google'){
      var consentPC = window.launchdeskPolicyConsent;
      if(consentPC && !consentPC.bothSignupConsentChecked()){
        consentPC.revealSignupConsent();
        consentPC.showSignupConsentError('필수 동의 항목을 확인해주세요');
        consentPC.focusFirstUncheckedSignupConsent();
        showToast('필수 동의 항목을 확인해주세요');
        return;
      }
      if(consentPC) consentPC.clearSignupConsentError();
    }

    // OAuth는 전체 페이지 이동이라 메모리에만 있는 작성 내용은 사라진다.
    // plans.js가 "저장을 눌렀지만 이 브라우저에 보관하지 못한 계획 폼"을
    // 갖고 있으면 떠나기 전에 확인받는다(false면 중단). 인증 제공자 설정·
    // 방식은 그대로이고, 이 훅이 없으면(모듈 미로딩) 기존과 동일하게 진행한다.
    var plansGuard = window.launchdeskPlans && window.launchdeskPlans.beforeOAuthRedirect;
    if(typeof plansGuard === 'function'){
      var proceed = true;
      try{ proceed = plansGuard() !== false; }catch(e){ proceed = true; }
      if(!proceed) return;
    }
    oauthInFlight = true;
    setOAuthButtonsBusy(true);
    markOAuthFreshLoginPending();
    // 리다이렉트 전 sessionStorage에 남기는 최소 임시 신호(버전 · source ·
    // 생성시각만 — 이메일/이름 등 개인정보 없음). 이것만으로 동의 완료를
    // 확정하지 않는다 — 복귀 후 handleSession()이 insert 뒤 반드시 DB를
    // 재조회해 실제로 행이 있는지 확인한 경우에만 통과시킨다
    // (policy-consent.js ensureConsent 참고). TTL이 지나거나 시작에
    // 실패/취소되면 아래에서 즉시 지운다.
    if(provider === 'google'){
      var consentCore = window.launchdeskPolicyConsentCore;
      if(consentCore) window.launchdeskPolicyConsent.stashPending(consentCore.SOURCES.GOOGLE_OAUTH);
    }
    // redirectTo는 현재 접속한 origin 그대로 사용한다(하드코딩된 프로덕션
    // 도메인이 아님) — 실제로 어디로 돌아올 수 있는지는 Supabase Auth URL
    // Configuration의 allow list가 최종적으로 결정하므로, 여기서 다른
    // 도메인을 강제한다고 보안이 더 세지지 않는다. 해시 라우트는 포함하지
    // 않는다(로그인 전 있던 경로로 돌아갈 필요가 없고, OAuth 콜백 파라미터가
    // 기존 hash router와 섞이지 않게 하기 위함).
    sb.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: window.location.origin + '/' }
    }).then(function(res){
      if(res.error){
        // 리다이렉트가 시작되지 못한 경우(설정 오류 등)만 여기 도달한다 —
        // 성공하면 브라우저가 곧바로 provider 페이지로 이동해 이 콜백 자체가
        // 사실상 의미 없어진다.
        clearOAuthFreshLoginPending();
        if(window.launchdeskPolicyConsent) window.launchdeskPolicyConsent.clearPending();
        oauthInFlight = false;
        setOAuthButtonsBusy(false);
        console.warn('[launchdesk] OAuth(' + provider + ') 시작 실패:', res.error.message);
        showToast('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
      }
    }).catch(function(err){
      clearOAuthFreshLoginPending();
      if(window.launchdeskPolicyConsent) window.launchdeskPolicyConsent.clearPending();
      oauthInFlight = false;
      setOAuthButtonsBusy(false);
      console.warn('[launchdesk] OAuth(' + provider + ') 호출 중 오류:', err && err.message);
      showToast('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
    });
  }
  if(googleLoginBtn) googleLoginBtn.addEventListener('click', function(){ startOAuthLogin('google'); });
  if(kakaoLoginBtn) kakaoLoginBtn.addEventListener('click', function(){ startOAuthLogin('kakao'); });

  // OAuth 실패(사용자 취소/provider 오류 등)는 Supabase가 이 페이지의
  // redirectTo로 ?error=...&error_description=... 쿼리스트링을 그대로
  // 붙여 돌려보낸다 — raw 오류 문구를 사용자에게 노출하지 않고 정해진
  // 안내만 보여준 뒤, 새로고침해도 같은 토스트가 다시 뜨지 않도록 그
  // 쿼리 파라미터만 제거한다(해시 라우트/UTM 쿼리 파라미터는 건드리지
  // 않는다 — UTM 회귀 방지, 요구사항 12·13).
  (function handleOAuthRedirectError(){
    try{
      var params = new URLSearchParams(location.search);
      if(!params.has('error') && !params.has('error_description')) return;
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      var newSearch = params.toString();
      history.replaceState(null, '', location.pathname + (newSearch ? '?' + newSearch : '') + location.hash);
      showToast('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
      // 취소/오류로 세션 없이 돌아온 경로라 SIGNED_IN이 절대 발생하지 않는다
      // — ensureConsent()가 pending을 소비할 기회 자체가 없으므로 여기서
      // 직접 비운다. 비우지 않으면 같은 탭에서 곧이어 시도하는 다른 로그인
      // (예: 이메일/비밀번호)이 이 pending을 잘못 이어받을 수 있다(요구사항 4).
      if(window.launchdeskPolicyConsent) window.launchdeskPolicyConsent.clearPending();
    }catch(e){}
  })();

  document.getElementById('loginModalClose').addEventListener('click', closeLoginModal);
  document.getElementById('loginModalBackdrop').addEventListener('click', closeLoginModal);
  document.getElementById('loginNoticeClose').addEventListener('click', closeLoginModal);
  loginForm.addEventListener('submit', function(e){
    e.preventDefault();
    var sb = window.launchdeskSupabase;
    if(!sb){ showLoginNotice(); return; }
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPw').value;

    /* 회원가입 보강: 비밀번호 최소 8자 + 비밀번호 확인 일치를 프론트에서
       먼저 검사한다 — 조건을 만족하지 않으면 signUp()을 아예 호출하지
       않는다. 로그인 모드에는 이 검사를 적용하지 않는다(기존 계정 중
       더 짧은 비밀번호가 있을 수 있어, 로그인 자체를 막지 않기 위함). */
    if(loginMode === 'signup'){
      var confirmVal = loginPwConfirm ? loginPwConfirm.value : '';
      if(password.length < 8){ showToast('비밀번호는 8자 이상으로 입력해주세요.'); return; }
      if(password !== confirmVal){ showToast('비밀번호가 일치하지 않아요.'); return; }
      // 필수 동의(이용약관·개인정보 수집·이용) 둘 다 체크해야만 signUp()을
      // 호출한다 — 하나만 체크해도 가입을 막는다(요구사항 1·3).
      var signupConsentPC = window.launchdeskPolicyConsent;
      if(signupConsentPC && !signupConsentPC.bothSignupConsentChecked()){
        signupConsentPC.revealSignupConsent();
        signupConsentPC.showSignupConsentError('필수 동의 항목을 확인해주세요');
        signupConsentPC.focusFirstUncheckedSignupConsent();
        showToast('필수 동의 항목을 확인해주세요');
        return;
      }
      if(signupConsentPC) signupConsentPC.clearSignupConsentError();
    }

    var restoreLabel = loginSubmitBtn.textContent;
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = '처리 중...';
    function reenable(){ loginSubmitBtn.disabled = false; loginSubmitBtn.textContent = restoreLabel; }

    if(loginMode === 'signup'){
      // signUp() 호출 직전에 pending을 남긴다 — Confirm email이 꺼져 있어
      // 세션이 즉시 생기는 설정이면(현재는 켜져 있어 실제로는 아래
      // session이 항상 null이지만, 설정이 바뀌어도 안전하도록) 곧이어
      // 발생하는 SIGNED_IN에서 handleSession()이 이 pending을 소비해
      // source='email_signup'으로 기록한다.
      var signupPCCore = window.launchdeskPolicyConsentCore;
      var signupPC = window.launchdeskPolicyConsent;
      if(signupPC && signupPCCore) signupPC.stashPending(signupPCCore.SOURCES.EMAIL_SIGNUP);
      sb.auth.signUp({ email: email, password: password }).then(function(res){
        reenable();
        if(res.error){
          if(signupPC) signupPC.clearPending();
          showToast(getAuthErrorMessage(res.error));
          return;
        }
        var immediateSession = res.data && res.data.session;
        if(!immediateSession && signupPC){
          // Confirm email이 켜져 있어 세션이 아직 없다 — 이 pending을 다른
          // 계정의 다음 로그인이 잘못 이어받을 위험이 있으므로 여기서 즉시
          // 비운다. 실제 동의 기록은 이메일 인증 후 최초 로그인 시
          // existing_user_gate 화면에서 다시 받는다(요구사항 3).
          signupPC.clearPending();
        }
        // 바로 로그인된 것처럼 처리하지 않고, 이메일 인증부터 안내한다.
        showLoginNotice('인증 이메일을 보냈습니다. 이메일 인증 후 로그인해주세요.');
      }).catch(function(err){
        reenable();
        if(signupPC) signupPC.clearPending();
        showToast(getAuthErrorMessage(err));
      });
    } else {
      pendingFreshLogin = true;
      sb.auth.signInWithPassword({ email: email, password: password }).then(function(res){
        reenable();
        if(res.error){ pendingFreshLogin = false; showToast(getAuthErrorMessage(res.error)); return; }
        // 모달 닫기 · 토스트 · 사이드바/데이터 갱신은 아래 onAuthStateChange가 전담
      }).catch(function(err){ pendingFreshLogin = false; reenable(); showToast(getAuthErrorMessage(err)); });
    }
  });
  loginToSignup.addEventListener('click', function(e){
    e.preventDefault();
    loginMode = (loginMode === 'signup') ? 'login' : 'signup';
    applyLoginModalMode();
    // 모드 전환 시 오래된 pending을 정리한다(요구사항 3) — 정상 흐름에서는
    // 이미 각 실패/완료 경로에서 비워지지만, 방어적으로 한 번 더 비운다.
    if(window.launchdeskPolicyConsent) window.launchdeskPolicyConsent.clearPending();
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && loginModal.classList.contains('open')) closeLoginModal(); });
  document.addEventListener('click', function(e){
    var loginLink = e.target.closest('a[href="#/login"]');
    // 로그인 상태에서도 href="#/login" 자체는 그대로 두되(마크업 최소 변경),
    // 실제 이동은 항상 막고 — 모달은 비로그인일 때만 연다(상단바 "내 계정"
    // 클릭 시 로그인 모달이 다시 뜨지 않도록).
    if(loginLink){ e.preventDefault(); if(!isAuthed) openLoginModal(); }
  });

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

  /* ---- STEP01~07 진행상황 저장소 --------------------------------------
     window.launchdeskStore(store.js, 이 파일보다 먼저 로드)가 회원/비회원
     저장 방식을 실제로 나눈다 — 비회원은 메모리에만, 회원은 Supabase의
     user_step_progress/tool_records에도 반영한다. 아래 함수들은 이름과
     역할을 그대로 유지하면서, 내부 구현만 launchdeskStore를 거치도록
     바뀌었다(예전엔 여기서 직접 localStorage를 읽고 썼다). */
  var CHAPTER_PATHS = ['/start/intro','/start/prepare','/start/setup','/start/sourcing','/start/content','/start/marketing-setup','/start/marketing','/start/orders','/start/wrapup'];
  /* 레거시(로그인 이전 시절) localStorage 키 이름 — 더 이상 쓰지는 않지만,
     로그인 시 "이 브라우저에 옛 진행상황이 있는지" 확인하고 계정으로
     옮기는 마이그레이션에서만 참조한다(아래 마이그레이션 섹션). */
  var COMPLETED_KEY = 'ld-completed-chapters';
  var STORAGE_KEY_OVERRIDES = {
    '/start/prepare':         'ld-worksheet-start-prepare-v2',
    '/start/marketing-setup': 'ld-checklist-start-marketing-setup-v2'
  };

  function checklistAllChecked(path){
    var block = document.querySelector('.checklist-block[data-chapter="' + path + '"]');
    if(!block) return false;
    var boxes = block.querySelectorAll('.cl-row input[type="checkbox"]');
    if(!boxes.length) return false;
    var saved = launchdeskStore.getStepData(path);
    if(!Array.isArray(saved)) return false;
    for(var i = 0; i < boxes.length; i++){ if(saved.indexOf(i) === -1) return false; }
    return true;
  }
  function worksheetAllFilled(path){
    var ws = document.querySelector('.worksheet[data-chapter="' + path + '"]');
    if(!ws) return false;
    var inputs = ws.querySelectorAll('.worksheet-input');
    if(!inputs.length) return false;
    var saved = launchdeskStore.getStepData(path) || {};
    return Array.prototype.every.call(inputs, function(inp, i){ return typeof saved[i] === 'string' && saved[i].trim() !== ''; });
  }
  var STEP_EVALUATORS = {
    '/start/prepare':         function(){ return worksheetAllFilled('/start/prepare'); },
    '/start/setup':           function(){ return checklistAllChecked('/start/setup'); },
    '/start/sourcing':        function(){ return checklistAllChecked('/start/sourcing'); },
    '/start/content':         function(){ return checklistAllChecked('/start/content'); },
    '/start/orders':          function(){ return checklistAllChecked('/start/orders'); },
    '/start/marketing-setup': function(){ return checklistAllChecked('/start/marketing-setup'); },
    '/start/marketing':       function(){ return checklistAllChecked('/start/marketing'); }
  };
  function getCompleted(){
    return launchdeskStore.getCompletedPaths();
  }
  /* 옛 구조와의 호환을 위해 이름/역할을 유지한다 — 실제 저장은 각 STEP의
     evaluate()가 setChapterDone()을 통해 이미 launchdeskStore에 반영했다.
     여기서는 넘겨받은 완료 목록과 store 상태가 어긋난 항목만 보정한다
     (정상 흐름에서는 보정할 것이 없다). */
  function saveCompleted(list){
    Object.keys(STEP_EVALUATORS).forEach(function(path){
      var shouldBeDone = list.indexOf(path) !== -1;
      if(launchdeskStore.isStepCompleted(path) !== shouldBeDone){
        launchdeskStore.setStepState(path, launchdeskStore.getStepData(path), shouldBeDone);
      }
    });
  }
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

  /* STEP01~07 공용 진행률 계산 — 완료 STEP 수 / 전체 STEP 수(7) / % /
     다음 미완료 STEP을 한 번에 계산해 /start 상단 상태와 STEP 카드 배지가
     같은 결과를 나눠 쓰게 한다(오픈 베타 전 단순화 3차로 홈 "이어서
     준비하기" 카드는 제거) (STEP_ROADMAP/GATED_STEPS는 아래 정의). */
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
    // (사이드바 "창업 준비 N%" 미니 진행 바(#progressPct/#progressFillSide)는 2026-09
    //  UI 재설계 2차에서 제거 — 진행 정보는 /start와 홈 카드에서만 보여준다.)

    // /start 상단 상태(2026-09 UI 재설계 2차) — 퍼센트·진행 바·범례 대신
    // "완료 N / 7 · 다음 단계 · 이어서 준비하기"만. 요소가 없어도 조용히 지나간다.
    var ssDone = document.getElementById('startStatusDone');
    if(ssDone) ssDone.textContent = prog.done;
    var ssTotal = document.getElementById('startStatusTotal');
    if(ssTotal) ssTotal.textContent = prog.total;
    var ssNext = document.getElementById('startStatusNext');
    var ssLink = document.getElementById('startStatusLink');
    if(prog.next){
      if(ssNext) ssNext.textContent = 'STEP ' + prog.next.num + ' · ' + prog.next.label;
      if(ssLink){ ssLink.href = '#' + prog.next.route; ssLink.textContent = '이어서 준비하기 →'; }
    } else {
      if(ssNext) ssNext.textContent = 'STEP 01~07을 모두 완료했어요';
      if(ssLink){ ssLink.href = '#/start/wrapup'; ssLink.textContent = '오픈 완료 확인하기 →'; }
    }
    document.querySelectorAll('.guide-card[data-chapter]').forEach(function(card){
      var path = card.getAttribute('data-chapter');
      var isDone = completed.indexOf(path) !== -1;
      var check = card.querySelector('.cc-check');
      if(check) check.hidden = !isDone;
      var link = card.querySelector('.gc-link');
      if(link && isDone && card.getAttribute('data-tier') === 'free'){ link.textContent = '다시 보기 →'; }
      /* 상태 라벨(완료 / 진행 중 / 시작 전) — 게이트가 있는 STEP 01~07만.
         "진행 중"은 저장된 data에 실제 입력(체크된 항목·채운 칸)이 있는지로만
         판정한다(stepEntryHasContent — 게스트 병합과 같은 기준, 새 판정 규칙
         없음). STEP 00·08은 저장 데이터가 없는 안내 화면이라 라벨을 붙이지 않는다. */
      var statusEl = card.querySelector('.cc-status');
      if(statusEl){
        if(!STEP_EVALUATORS[path]){ statusEl.hidden = true; }
        else {
          var hasInput = !isDone && stepEntryHasContent({ data: launchdeskStore.getStepData(path), isCompleted: false });
          var state = isDone ? 'done' : (hasInput ? 'active' : 'todo');
          statusEl.hidden = false;
          statusEl.className = 'cc-status ' + state;
          statusEl.textContent = state === 'done' ? '완료' : (state === 'active' ? '진행 중' : '시작 전');
        }
      }
    });
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
  /* single entry point every completion source (checkbox / worksheet)
     reports through. 항상 launchdeskStore에 최신 data/완료여부를 반영하고
     (memory + 로그인 시 background DB), "지금 막 완료/미완료로 전환된
     순간"에만 토스트·GA4·진행률 재계산을 한다(예전과 동일한 조건). */
  function setChapterDone(path, isDone, data){
    var completed = getCompleted();
    var idx = completed.indexOf(path);
    launchdeskStore.setStepState(path, data, isDone);
    if(isDone && idx === -1){
      recomputeProgress();
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
      /* 2026-09-15 감사 반영 — 여기 있던 내부 product event
         'roadmap_completed' 계측을 제거했다. 로드맵 완료 여부는 이미
         user_step_progress(is_completed)가 canonical하게 갖고 있고
         (STEP01~07 전체 완료 = 그 7개 step_path 모두 is_completed=true),
         이 함수(setChapterDone)를 거치지 않는 완료 경로가 여러 개 있어
         이벤트만으로는 놓치는 사용자가 생긴다 — 게스트로 로드맵을 다
         끝낸 뒤 로그인 시 병합(mergeGuestSnapshotToAccount, 이 함수를
         거치지 않고 user_step_progress에 직접 upsert), reconcileCompleted
         Chapters()의 보정 upsert, 배포 이전에 이미 완료한 사용자, 다른
         기기에서 완료한 사용자 전부 이 이벤트가 찍히지 않는다. 그래서
         admin_beta_behavior_overview()의 roadmap_completed_users는 이제
         product_events가 아니라 user_step_progress를 직접 집계한다
         (20260915300000_admin_beta_behavior.sql 참고) — 상태(canonical
         DB)가 이미 답을 갖고 있는 사실을 행동 이벤트로 다시 만들지
         않는다는 원칙(요구사항 0)을 그대로 따른 것이다. */
    }
    else if(!isDone && idx !== -1){
      recomputeProgress();
    }
  }

  /* ---- STEP01~07 컨트롤러 등록 -----------------------------------------
     각 워크시트/체크리스트는 restore()(store → 화면)와 evaluate()(화면 →
     store, 완료여부 재계산)를 갖는다. stepControllers에 모아두고, 로그인
     (hydrate)/로그아웃(resetToGuest) 직후 launchdeskStore.onChange가
     한 번에 다시 실행해 화면을 store의 최신 상태와 맞춘다. */
  var stepControllers = [];
  function refreshAllStepControllers(){
    stepControllers.forEach(function(c){ c.restore(); c.evaluate(); });
    reconcileCompletedChapters();
    recomputeProgress();
  }

  /* ch01 워크시트 — STEP01은 5개 필드(타겟고객/판매카테고리·상품군/
     초기예산/브랜드·쇼핑몰이름/벤치마킹대상)를 쓴다. 저장은 이제
     launchdeskStore를 통한다: 비회원은 메모리에만, 회원은 Supabase
     user_step_progress에도 반영된다(백그라운드, 화면은 기다리지 않음). */
  document.querySelectorAll('.worksheet[data-chapter]').forEach(function(ws){
    var path = ws.getAttribute('data-chapter');
    var inputs = ws.querySelectorAll('.worksheet-input');
    function restore(){
      var saved = launchdeskStore.getStepData(path);
      inputs.forEach(function(inp, i){
        // 지금 사용자가 타이핑 중인 칸은 건드리지 않는다 — 로그인 직후
        // hydrate()가 store.onChange를 통해 이 restore()를 다시 부를 때,
        // 입력 중인 값을 되돌려버리지 않기 위한 안전장치.
        if(document.activeElement === inp) return;
        inp.value = (saved && typeof saved[i] === 'string') ? saved[i] : '';
      });
    }
    function evaluate(){
      var allFilled = inputs.length > 0 && Array.prototype.every.call(inputs, function(inp){ return inp.value.trim() !== ''; });
      var data = {};
      inputs.forEach(function(inp2, i){ data[i] = inp2.value; });
      setChapterDone(path, allFilled, data);
    }
    inputs.forEach(function(inp){
      inp.addEventListener('input', evaluate);
      // 이 칸에서 포커스가 빠지면(다음 칸으로 이동/다른 곳 클릭 등), 미뤄둔
      // Supabase 저장이 있다면 debounce를 기다리지 않고 바로 반영한다.
      // DOM을 다시 그리거나 포커스에 영향을 주지 않는다 — 저장 요청만 앞당길 뿐이다.
      inp.addEventListener('blur', function(){ launchdeskStore.flushStepNow(path); });
    });
    restore();
    evaluate();
    stepControllers.push({ path: path, restore: restore, evaluate: evaluate });
  });

  /* STEP02~07의 필수 체크리스트 — 전부 체크하면 그 STEP이 완료된다.
     STEP03도 다른 STEP과 동일하게 체크리스트 완료 여부만으로 판단한다
     (마진계산기 사용/저장 여부는 완료 조건과 무관 — 필요하면 쓰는 선택
     도구일 뿐이다). */
  document.querySelectorAll('.checklist-block[data-chapter]').forEach(function(block){
    var path = block.getAttribute('data-chapter');
    var boxes = block.querySelectorAll('.cl-row input[type="checkbox"]');
    var countEl = block.querySelector('.count');
    function restore(){
      var saved = launchdeskStore.getStepData(path);
      var arr = Array.isArray(saved) ? saved : [];
      boxes.forEach(function(b, i){
        if(document.activeElement === b) return; // 지금 조작 중인 체크박스는 건드리지 않는다
        b.checked = arr.indexOf(i) !== -1;
      });
      if(countEl){
        var restoredCount = Array.prototype.filter.call(boxes, function(b){ return b.checked; }).length;
        countEl.textContent = restoredCount + ' / ' + boxes.length;
      }
    }
    function evaluate(){
      var allChecked = boxes.length > 0 && Array.prototype.every.call(boxes, function(b){ return b.checked; });
      var checkedIdx = [];
      boxes.forEach(function(b, i){ if(b.checked) checkedIdx.push(i); });
      setChapterDone(path, allChecked, checkedIdx);
    }
    boxes.forEach(function(b){ b.addEventListener('change', evaluate); });
    restore();
    evaluate();
    stepControllers.push({ path: path, restore: restore, evaluate: evaluate });
  });

  reconcileCompletedChapters();
  recomputeProgress();

  /* ---- 레거시(로그인 이전) localStorage → 계정 이전 --------------------
     비회원 시절 이 브라우저에 남아있던 옛 진행상황을 실제 로그인
     (SIGNED_IN) 직후 딱 한 번 확인한다 — 세션 복원(이미 로그인된 채로
     새로고침)에서는 다시 묻지 않는다(매번 새로고침마다 물으면 성가시고,
     한 번 옮기고 나면 옛 키 자체가 지워져 사라지므로 어차피 다시 뜨지
     않는다). 자동으로 계정 데이터를 덮어쓰지 않고, 사용자가 확인을 눌러야
     이전한다. 이전에 실패하면 옛 localStorage는 그대로 남겨둔다.
     ld-first-visit은 이번 이전 대상이 아니다. */
  var LEGACY_STEP_KEYS = {
    '/start/prepare':         { key: STORAGE_KEY_OVERRIDES['/start/prepare'], kind: 'worksheet' },
    '/start/setup':           { key: 'ld-checklist-start-setup', kind: 'checklist' },
    '/start/sourcing':        { key: 'ld-checklist-start-sourcing', kind: 'checklist' },
    '/start/content':         { key: 'ld-checklist-start-content', kind: 'checklist' },
    '/start/orders':          { key: 'ld-checklist-start-orders', kind: 'checklist' },
    '/start/marketing-setup': { key: STORAGE_KEY_OVERRIDES['/start/marketing-setup'], kind: 'checklist' },
    '/start/marketing':       { key: 'ld-checklist-start-marketing', kind: 'checklist' }
  };
  var LEGACY_MISC_KEYS = [COMPLETED_KEY, 'ld-tools-calc-history', 'ld-adlog-records'];

  function hasAnyLegacyData(){
    var allKeys = Object.keys(LEGACY_STEP_KEYS).map(function(p){ return LEGACY_STEP_KEYS[p].key; }).concat(LEGACY_MISC_KEYS);
    return allKeys.some(function(k){ try{ return localStorage.getItem(k) !== null; }catch(e){ return false; } });
  }
  function legacyChecklistDone(path, key){
    var block = document.querySelector('.checklist-block[data-chapter="' + path + '"]');
    if(!block) return false;
    var boxes = block.querySelectorAll('.cl-row input[type="checkbox"]');
    if(!boxes.length) return false;
    try{
      var saved = JSON.parse(localStorage.getItem(key) || '[]');
      if(!Array.isArray(saved)) return false;
      for(var i = 0; i < boxes.length; i++){ if(saved.indexOf(i) === -1) return false; }
      return true;
    }catch(e){ return false; }
  }
  function legacyWorksheetDone(path, key){
    var ws = document.querySelector('.worksheet[data-chapter="' + path + '"]');
    if(!ws) return false;
    var inputs = ws.querySelectorAll('.worksheet-input');
    if(!inputs.length) return false;
    try{
      var saved = JSON.parse(localStorage.getItem(key) || '{}');
      return Array.prototype.every.call(inputs, function(inp, i){ return typeof saved[i] === 'string' && saved[i].trim() !== ''; });
    }catch(e){ return false; }
  }
  // 이미 완료돼 있던 STEP을 다시 완료 상태로 upsert할 때 최초 완료 시각을
  // 유지한다 — store가 hydrate 때 읽어둔 completed_at을 그대로 돌려주고,
  // 아직 완료가 아니었으면 null(호출한 쪽이 지금 시각을 새로 찍는다).
  function preservedCompletedAt(path){
    return launchdeskStore.isStepCompleted(path) ? launchdeskStore.getStepCompletedAt(path) : null;
  }
  function migrateLegacyToAccount(userId){
    var sb = window.launchdeskSupabase;
    if(!sb) return Promise.resolve(false);
    var writes = [];

    Object.keys(LEGACY_STEP_KEYS).forEach(function(path){
      var info = LEGACY_STEP_KEYS[path];
      var raw;
      try{ raw = localStorage.getItem(info.key); }catch(e){ raw = null; }
      if(raw == null) return; // 이 STEP은 옛 기록이 없음 — 건너뜀
      var data;
      try{ data = JSON.parse(raw); }catch(e){ return; }
      var isDone = (info.kind === 'worksheet')
        ? legacyWorksheetDone(path, info.key)
        : legacyChecklistDone(path, info.key);
      writes.push(sb.from('user_step_progress').upsert({
        user_id: userId,
        step_path: path,
        data: data,
        is_completed: isDone,
        completed_at: isDone ? (preservedCompletedAt(path) || new Date().toISOString()) : null
      }, { onConflict: 'user_id,step_path' }));
    });

    var legacyCalc = [];
    try{ legacyCalc = JSON.parse(localStorage.getItem('ld-tools-calc-history') || '[]'); }catch(e){}
    legacyCalc.forEach(function(item){
      writes.push(sb.from('tool_records').insert({ user_id: userId, tool_type: 'margin_calc', data: item }));
    });

    var legacyAdlog = [];
    try{ legacyAdlog = JSON.parse(localStorage.getItem('ld-adlog-records') || '[]'); }catch(e){}
    legacyAdlog.forEach(function(item){
      writes.push(sb.from('tool_records').insert({ user_id: userId, tool_type: 'ad_log', data: item }));
    });

    if(!writes.length) return Promise.resolve(true); // 실제로 옮길 데이터가 없었음

    return Promise.all(writes).then(function(results){
      var failed = results.filter(function(r){ return r && r.error; });
      if(failed.length){
        console.warn('[launchdesk] 일부 마이그레이션 저장 실패:', failed.map(function(r){ return r.error.message; }));
        return false;
      }
      return true;
    }).catch(function(err){
      console.warn('[launchdesk] 마이그레이션 중 오류:', err && err.message);
      return false;
    });
  }
  function clearLegacyLocalStorage(){
    Object.keys(LEGACY_STEP_KEYS).forEach(function(path){
      try{ localStorage.removeItem(LEGACY_STEP_KEYS[path].key); }catch(e){}
    });
    LEGACY_MISC_KEYS.forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} });
    // ld-first-visit은 의도적으로 제외 — 이번 마이그레이션 대상이 아니다.
  }
  function maybeMigrateLegacy(userId){
    if(!hasAnyLegacyData()) return Promise.resolve();
    var ok = window.confirm('이 브라우저에 저장된 기존 진행상황이 있습니다.\n계정에 저장할까요?');
    if(!ok) return Promise.resolve();
    return migrateLegacyToAccount(userId).then(function(success){
      if(success){
        clearLegacyLocalStorage();
        showToast('이전 진행상황을 계정에 저장했어요', 'success');
        return launchdeskStore.hydrate(userId); // 방금 옮긴 데이터를 반영해 다시 불러옴
      }
      showToast('이전 중 문제가 발생해 기존 데이터는 그대로 뒀어요');
    });
  }

  /* ---- B. 이번 세션의 "게스트 메모리" → 계정 병합 -----------------------
     A(레거시 localStorage)와는 완전히 다른 대상이다 — 이건 로그인하기
     직전, 바로 이 페이지에서 비회원으로 작업한 launchdeskStore의 메모리
     상태를 말한다. hydrate()가 이 메모리를 서버 값으로 덮어쓰기 전에
     handleSession()이 launchdeskStore.getSnapshot()으로 미리 떠 둔 것을
     여기서 넘겨받는다.

     원칙(data와 is_completed의 관계를 절대 깨지 않는다):
     - data = 원본 상태, is_completed = 그 data를 STEP_EVALUATORS로 평가한
       결과/캐시. "data는 그대로 두고 완료 여부만 승격" 같은, data와
       is_completed가 서로 어긋나는 상태를 만들지 않는다.
     - 워크시트: 필드 단위 병합 — 그 필드의 서버 값이 있으면 유지하고,
       서버 값이 비어 있고 게스트 값이 있으면 그 필드만 채운다.
     - 체크리스트: 서버에서 체크된 인덱스 ∪ 게스트에서 체크된 인덱스
       (합집합, 중복 제거) — 서버 데이터를 버리지 않고 게스트 쪽만 더한다.
     - 병합된 data를 기준으로 기존 STEP_EVALUATORS[path]()를 실제로 다시
       실행해 is_completed/completed_at을 계산한다 — OR로 직접 만들지
       않는다. STEP03도 다른 체크리스트 STEP과 동일하게 이 흐름을 그대로
       탄다(체크리스트 완료 여부만 본다 — margin_calc와는 무관).
     - tool_records(마진계산/광고기록)는 게스트가 실제로 남긴 기록만
       추가로 insert한다 — 이 흐름 자체가 로그인 1회당 정확히 한 번만
       실행되므로 중복 insert가 생기지 않는다. */
  function stepEntryHasContent(entry){
    if(!entry) return false;
    if(entry.isCompleted) return true;
    var data = entry.data;
    if(Array.isArray(data)) return data.length > 0;
    if(data && typeof data === 'object'){
      return Object.keys(data).some(function(k){ return typeof data[k] === 'string' && data[k].trim() !== ''; });
    }
    return false;
  }
  function hasSnapshotData(snapshot){
    if(!snapshot) return false;
    var anyStep = Object.keys(snapshot.steps).some(function(p){ return stepEntryHasContent(snapshot.steps[p]); });
    if(anyStep) return true;
    if(snapshot.calcHistory.length > 0) return true;
    if(snapshot.adlogRecords.length > 0) return true;
    return false;
  }
  // 워크시트: 필드 단위 병합 — 서버 값이 있는 필드는 그대로, 서버가
  // 비어 있고 게스트에 값이 있는 필드만 게스트 값으로 채운다.
  function mergeWorksheetFields(serverData, guestData){
    var merged = {};
    var keys = {};
    Object.keys(serverData || {}).forEach(function(k){ keys[k] = true; });
    Object.keys(guestData || {}).forEach(function(k){ keys[k] = true; });
    Object.keys(keys).forEach(function(k){
      var serverVal = serverData ? serverData[k] : undefined;
      var guestVal = guestData ? guestData[k] : undefined;
      if(typeof serverVal === 'string' && serverVal.trim() !== ''){
        merged[k] = serverVal;
      } else if(typeof guestVal === 'string' && guestVal.trim() !== ''){
        merged[k] = guestVal;
      } else {
        merged[k] = serverVal || guestVal || '';
      }
    });
    return merged;
  }
  // 체크리스트: 서버 체크 ∪ 게스트 체크(합집합, 중복 제거, 오름차순)
  function mergeChecklistUnion(serverData, guestData){
    var set = {};
    (Array.isArray(serverData) ? serverData : []).forEach(function(i){ set[i] = true; });
    (Array.isArray(guestData) ? guestData : []).forEach(function(i){ set[i] = true; });
    return Object.keys(set).map(function(k){ return parseInt(k, 10); }).sort(function(a, b){ return a - b; });
  }
  function mergeGuestSnapshotToAccount(userId, snapshot){
    var sb = window.launchdeskSupabase;
    if(!sb) return Promise.resolve(false);

    // 1) 병합된 data만 먼저 계산해둔다(아직 아무 것도 쓰지 않음, 완료여부는
    //    아래 3단계에서 STEP_EVALUATORS로 계산한다).
    var mergedDataByPath = {};
    Object.keys(snapshot.steps).forEach(function(path){
      var guestEntry = snapshot.steps[path];
      if(!stepEntryHasContent(guestEntry)) return; // 실제 내용이 없는 STEP은 건너뜀
      var serverData = launchdeskStore.getStepData(path); // hydrate() 이후이므로 "현재 계정 서버값"
      var kind = LEGACY_STEP_KEYS[path] ? LEGACY_STEP_KEYS[path].kind : 'checklist';
      mergedDataByPath[path] = (kind === 'worksheet')
        ? mergeWorksheetFields(serverData, guestEntry.data)
        : mergeChecklistUnion(serverData, guestEntry.data);
    });

    // 2) margin_calc/ad_log는 STEP 완료 여부와 무관한 별개의 기록이므로
    //    그냥 insert만 한다(STEP03 재평가 같은 특수 처리 없음).
    var toolWrites = [];
    snapshot.calcHistory.forEach(function(record){
      toolWrites.push(sb.from('tool_records').insert({ user_id: userId, tool_type: 'margin_calc', data: record }));
    });
    snapshot.adlogRecords.forEach(function(record){
      toolWrites.push(sb.from('tool_records').insert({ user_id: userId, tool_type: 'ad_log', data: record }));
    });

    return Promise.all(toolWrites).then(function(toolResults){
      var toolFailed = toolResults.some(function(r){ return r && r.error; });
      if(toolFailed) console.warn('[launchdesk] 게스트 도구 기록 병합 중 일부 실패');

      // 3) 병합된 data를 store에 임시 반영(DB 쓰기 없음) → 기존
      //    STEP_EVALUATORS를 실제로 다시 실행해 is_completed를 계산 →
      //    그 결과로 진짜 upsert를 한 번만 쓴다.
      var stepWrites = [];
      Object.keys(mergedDataByPath).forEach(function(path){
        var mergedData = mergedDataByPath[path];
        launchdeskStore.pokeStepData(path, mergedData);
        var isDone = (typeof STEP_EVALUATORS[path] === 'function') ? !!STEP_EVALUATORS[path]() : false;
        stepWrites.push(sb.from('user_step_progress').upsert({
          user_id: userId,
          step_path: path,
          data: mergedData,
          is_completed: isDone,
          completed_at: isDone ? (preservedCompletedAt(path) || new Date().toISOString()) : null
        }, { onConflict: 'user_id,step_path' }));
      });

      if(!stepWrites.length) return !toolFailed;

      return Promise.all(stepWrites).then(function(stepResults){
        var stepFailed = stepResults.some(function(r){ return r && r.error; });
        if(stepFailed) console.warn('[launchdesk] 게스트 STEP 데이터 병합 중 일부 실패');
        return !stepFailed && !toolFailed;
      });
    }).catch(function(err){
      console.warn('[launchdesk] 게스트 데이터 병합 중 오류:', err && err.message);
      return false;
    });
  }
  function maybeMergeGuestSnapshot(userId, snapshot){
    if(!hasSnapshotData(snapshot)) return Promise.resolve();
    var ok = window.confirm('로그인 전에 작성한 진행상황이 있습니다.\n이 내용을 계정에 저장할까요?');
    if(!ok) return Promise.resolve();
    return mergeGuestSnapshotToAccount(userId, snapshot).then(function(success){
      if(success){ showToast('로그인 전 작성한 내용을 계정에 저장했어요', 'success'); }
      else { showToast('일부 내용을 저장하지 못했어요'); }
      return launchdeskStore.hydrate(userId); // 병합 결과를 서버 기준으로 다시 정리해서 반영
    });
  }

  /* ---- 사이드바 프로필 카드 + 상단바 로그인 버튼 ↔ Supabase 인증 상태 ----
     로그인/로그아웃에 따른 화면 데이터 전환의 핵심: 로그인 시
     launchdeskStore.hydrate()로 DB에서 불러와 메모리에 반영하고, 로그아웃
     시 launchdeskStore.resetToGuest()로 메모리를 완전히 비운다. 체크리스트/
     워크시트/도구 UI 갱신은 store의 onChange 구독(refreshAllStepControllers,
     tools.js의 refresh)이 전담하므로 여기서 직접 건드리지 않는다. */
  var profileCard = document.getElementById('profileCard');
  var profileAvatarLetter = document.getElementById('profileAvatarLetter');
  var profileName = document.getElementById('profileName');
  var profileDayEl = document.getElementById('profileDay');
  var topbarLoginBtn = document.getElementById('topbarLoginBtn');
  var isAuthed = false;

  function renderAuthUI(session){
    var user = session && session.user;
    isAuthed = !!user;
    // 2026-09 UI 재설계 1차 — 사이드바 게스트 카드/프로필 카드와 상단바
    // 사용자 배지의 표시 전환은 CSS(body.is-authed)가 담당한다. 인증 흐름과
    // 아래 프로필/로그아웃/"내 계정" 처리는 그대로다.
    document.body.classList.toggle('is-authed', !!user);
    var topbarUserName = document.getElementById('topbarUserName');
    if(user){
      var localPart = (user.email || '').split('@')[0] || '사용자';
      profileAvatarLetter.textContent = localPart.charAt(0).toUpperCase();
      profileName.textContent = localPart;
      if(topbarUserName) topbarUserName.textContent = localPart;
      profileDayEl.innerHTML = '<a href="#" id="profileLogoutBtn">로그아웃</a>';
      document.getElementById('profileLogoutBtn').addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        var sb = window.launchdeskSupabase;
        if(!sb) return;
        // 로그아웃 직전, 마지막 몇 글자가 아직 debounce 대기 중이거나 저장이
        // 진행 중일 수 있으므로, 먼저 밀린 저장을 전부 반영한 뒤에 실제
        // signOut()을 호출한다 — 네트워크가 응답하지 않아도 일정 시간 후엔
        // 그냥 로그아웃이 진행된다(best-effort, 영원히 막히지 않음).
        launchdeskStore.flushAllPendingSteps().then(function(){
          sb.auth.signOut();
        });
      });
      // 상단바: "로그인" 대신 중립적인 "내 계정"만 표시(이메일 노출 안 함).
      // href도 #/account로 바꿔, 클릭 시 로그인 모달 대신 실제 "내 쇼핑몰"
      // 화면으로 이동한다(아래 전역 클릭 위임은 href="#/login"인 링크만
      // 가로채므로, href가 바뀐 이 버튼은 평범한 해시 이동으로 처리된다).
      if(topbarLoginBtn){
        topbarLoginBtn.textContent = '내 계정';
        topbarLoginBtn.setAttribute('href', '#/account');
      }
    } else {
      profileAvatarLetter.textContent = '?';
      profileName.textContent = '로그인을 해주세요';
      if(topbarUserName) topbarUserName.textContent = '게스트';
      profileDayEl.textContent = '진행상황을 저장하고 다른 기기에서도 이어볼 수 있어요.';
      if(topbarLoginBtn){
        topbarLoginBtn.textContent = '로그인';
        topbarLoginBtn.setAttribute('href', '#/login');
      }
    }
  }
  // profiles 테이블에 현재 사용자 행이 있는지만 참고로 확인(콘솔 로그만,
  // 화면에는 영향 없음) — display_name 등 프로필 기능은 다음 단계.
  function checkProfileRow(user){
    var sb = window.launchdeskSupabase;
    if(!sb || !user) return;
    sb.from('profiles').select('id').eq('id', user.id).maybeSingle().then(function(res){
      if(res.error) console.log('[launchdesk] profiles 조회 결과(테이블 미생성이면 에러가 정상):', res.error.message);
      else console.log('[launchdesk] profiles 행 존재 여부:', !!res.data);
    }).catch(function(err){ console.log('[launchdesk] profiles 조회 중 오류:', err && err.message); });
  }
  // 로그인 상태: 카드를 누르면 "내 쇼핑몰"(#/account)로 이동한다. 카드 안의
  // 로그아웃 링크는 자체 클릭 핸들러에서 stopPropagation()하므로 이 핸들러와
  // 충돌하지 않는다.
  if(profileCard){
    profileCard.addEventListener('click', function(){
      if(!isAuthed) openLoginModal();
      else location.hash = '#/account';
    });
    profileCard.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if(!isAuthed) openLoginModal();
      else location.hash = '#/account';
    });
  }
  // launchdeskStore가 로그인(hydrate)/로그아웃(resetToGuest)으로 데이터를
  // 다시 채우거나 비울 때마다, 이 파일이 다루는 화면(체크리스트/워크시트/
  // 진행률)도 함께 새로 그린다. A 사용자 로그아웃 → B 사용자 로그인처럼
  // 같은 브라우저에서 계정이 바뀌어도, 매번 이 한 경로로만 화면이
  // 갱신되므로 이전 사용자의 데이터가 섞여 보일 일이 없다.
  launchdeskStore.onChange(refreshAllStepControllers);
  (function(){
    var sb = window.launchdeskSupabase;
    if(!sb){ renderAuthUI(null); return; }

    // 같은 사용자에 대해 hydrate()를 반복 호출하지 않기 위한 가드 — 예를
    // 들어 getSession()과 onAuthStateChange의 최초 발화가 겹치거나,
    // TOKEN_REFRESHED가 주기적으로 발생해도 이미 그 사용자로 불러온
    // 상태라면 다시 불러오지 않는다(화면이 매번 깜빡이는 것을 막는다).
    var lastHydratedUserId = null;
    function handleSession(session, isFreshSignIn){
      renderAuthUI(session);
      var user = session && session.user;
      if(user){
        checkProfileRow(user);
        // UTM First-Touch Acquisition — auth.uid()가 확정된 이 지점에서만
        // 대기 중인 UTM(있으면)을 record_user_acquisition() RPC로 전송한다.
        // 아래 hydrate 중복 방지 return보다 앞에 둬서, 이미 hydrate된
        // 기존 로그인 사용자에게도(예: 나중에 광고 링크로 재방문 후 세션이
        // 재확인될 때) pending이 있으면 기록되고, RPC 실패 시에도 다음
        // 세션 이벤트에서 자동 재시도된다(utm-acquisition.js 참고).
        if(window.launchdeskUtmAcquisition) window.launchdeskUtmAcquisition.sendPendingIfAny();
        if(!isFreshSignIn && lastHydratedUserId === user.id) return;
        // 게스트 메모리 스냅샷은 반드시 hydrate() 호출 전에 떠야 한다 —
        // hydrate()가 이 메모리를 서버 값으로 덮어쓰기 때문이다. 이미 다른
        // 계정으로 로그인되어 있던 상태에서 또 SIGNED_IN이 발생한 경우
        // (예: 로그아웃 없이 다른 계정으로 재로그인)는 지금 메모리에 있는
        // 게 "게스트가 작업한 것"이 아니라 "이전 계정의 데이터"이므로,
        // isAuthed()가 이미 true라면 스냅샷을 뜨지 않는다(계정 간 데이터
        // 유출 방지).
        var guestSnapshot = (isFreshSignIn && !launchdeskStore.isAuthed()) ? launchdeskStore.getSnapshot() : null;

        // 필수 동의(이용약관 · 개인정보 수집·이용) 게이트 — STEP · 계획 ·
        // 마진/광고 기록(hydrate)은 이 확인을 통과해야만 진행된다. 이
        // 콜백(onAuthStateChange) 자체는 여기서 블로킹하지 않는다 — 아래
        // .then()으로 이어지는 별도 비동기 체인이 처리하고, 이 함수는 곧바로
        // 리턴한다. ensureConsent()는 user_id 기준 single-flight로 묶여
        // 있어 getSession()/onAuthStateChange가 겹쳐 호출돼도 동의 조회·
        // 게이트 모달이 중복 생성되지 않는다(policy-consent.js 참고).
        var PC = window.launchdeskPolicyConsent;
        if(!PC){
          lastHydratedUserId = user.id;
          proceedHydrate(user, isFreshSignIn, guestSnapshot);
          return;
        }
        PC.ensureConsent(user).then(function(ok){
          if(!ok) return; // 게이트 대기 중 취소(로그아웃/계정 전환) 또는 로그아웃 선택 — 하이드레이트 금지
          // 대기하는 동안 다른 사용자로 바뀌었을 수 있으므로 하이드레이트
          // 직전에 현재 세션의 user_id를 다시 확인한다.
          var sb2 = window.launchdeskSupabase;
          return sb2.auth.getSession().then(function(res2){
            var latestUser = res2.data && res2.data.session && res2.data.session.user;
            if(!latestUser || latestUser.id !== user.id) return;
            lastHydratedUserId = user.id;
            proceedHydrate(user, isFreshSignIn, guestSnapshot);
          });
        });
      } else {
        lastHydratedUserId = null;
        launchdeskStore.resetToGuest();
        if(window.launchdeskPolicyConsent) window.launchdeskPolicyConsent.handleSignedOut();
      }
    }
    function proceedHydrate(user, isFreshSignIn, guestSnapshot){
      var hydration = launchdeskStore.hydrate(user.id);
      if(isFreshSignIn){
        // A(과거 legacy localStorage) → B(이번 세션의 게스트 메모리)
        // 순서로 처리한다. 동시에 처리하지 않고 순서대로 이어야, A에서
        // 옮겨진 값이 B의 "서버 값" 판단 기준에도 정확히 반영된다.
        hydration = hydration
          .then(function(){ return maybeMigrateLegacy(user.id); })
          .then(function(){ return maybeMergeGuestSnapshot(user.id, guestSnapshot); });
      }
    }

    sb.auth.getSession().then(function(res){
      var session = res.data && res.data.session;
      handleSession(session, false);
    });
    sb.auth.onAuthStateChange(function(event, session){
      if(event === 'SIGNED_IN'){
        // 이 이벤트가 실제로 우리가 방금 로그인 버튼을 눌러서 발생한 것인지
        // (pendingFreshLogin) 확인한다 — 탭 재포커스 등으로 SDK가 다시 쏘는
        // SIGNED_IN은 "신선한 로그인"으로 취급하지 않는다(중복 hydrate/
        // 마이그레이션 확인창 방지 — STEP01 입력이 갑자기 끊기던 원인).
        // OAuth는 전체 페이지 리다이렉트를 거치므로 pendingFreshLogin(메모리
        // 변수)가 리다이렉트 후 초기화돼 사라진다 — 대신 sessionStorage
        // 마커(consumeOAuthFreshLoginPending)로 같은 판정을 이어받는다.
        var isFreshSignIn = pendingFreshLogin || consumeOAuthFreshLoginPending();
        pendingFreshLogin = false;
        handleSession(session, isFreshSignIn);
        if(isFreshSignIn){
          closeLoginModal();
          showToast('로그인했어요', 'success');
        }
      } else if(event === 'SIGNED_OUT'){
        handleSession(null, false);
        showToast('로그아웃했어요');
      } else {
        handleSession(session, false);
      }
    });
  })();

  /* tab switcher — generic, scoped to the .tabs the clicked button lives in */
  document.addEventListener('click', function(e){
    // STEP02~07 → 자료실 [data-resource-cat] 딥링크는 resources.js가 자기
    // 리스너로 직접 처리한다(2026-09 자료실 전면 재설계) — 이 파일은 더 이상
    // 관여하지 않는다.
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
      // 도매처 찾기(#/wholesale) 필터 — active 클래스 토글은 위에서 이미
      // 공통으로 처리됐으니, 실제 목록 다시 그리기는 wholesalers.js가
      // 자기 컨테이너에 직접 건 리스너에서 한다. 여기서 더 진행하면 바로
      // 아래 #chapterGrid 로직(다른 화면 전용)까지 타버리므로 반드시
      // return한다.
      if(scope === 'wholesale'){ return; }
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
  });

  /* count-up (shared "useCountUp"-equivalent) — animates any
     [data-count] number once, the first time it scrolls into view.
     Works for elements starting inside a hidden view or a hidden tab
     pane: once the layout makes them visible, the observer's next check
     picks them up, no manual re-trigger needed. (The /tools dashboard
     pane's own [data-count] KPIs — its only other former user — were
     removed along with the rest of that pane's example data; .stat-strip
     is the only place left that actually uses this.) */
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
  var countUpEls = document.querySelectorAll('.stat-strip .v[data-count]');
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

  /* checklist counters — one independent count per .checklist-block
     (a page can have more than one). Deliberately NOT persisted — these
     are the "선택/참고용" checklists that never counted toward progress
     (STEP04/05/06/08의 선택 체크, 세팅대행 준비 체크 등), so they still
     reset to 0 on every reload by design, for both guests and members. */
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

  // 스크롤 시 뜨던 플로팅 "세팅 대행" 배너(subBannerFloat)는 제거했다
  // (UI polish pass — 정적 배너와 중복 CTA였음). 정적 배너(subBanner)는
  // 그대로 유지, 다른 플로팅 UI(토스트/모달/라이트박스)는 영향 없음.

  render(); // initial paint
})();
