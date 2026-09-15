/* #/admin — LaunchDesk 관리자 페이지 1단계.

   이 파일이 하는 일:
   - #/admin 진입 시 로그인 세션을 확인하고, admin_users 조회로 관리자
     여부를 확인한다.
   - 관리자로 확인되기 전에는 실제 관리자 콘텐츠(메뉴/대시보드)를 DOM에
     아예 만들지 않는다 — "먼저 그려두고 숨기기"가 아니라 "확인 후에만
     그리기" 방식(#adminAppRoot는 관리자 확인 성공 시에만 innerHTML이
     채워진다).
   - 확인되면 관리자 셸(좌측 메뉴 + 우측 패널)을 #adminAppRoot 안에 직접
     구성하고, 메뉴 클릭에 따라 패널 내용만 클라이언트에서 전환한다 — 이번
     단계는 새 URL 서브라우트를 만들지 않는, 탭 전환 수준의 메뉴다.

   보안:
   - 관리자 여부는 반드시 DB(admin_users, RLS로 "본인 행만" 조회 가능)로
     확인한다 — 이메일 문자열 비교나 UI 숨김으로 대체하지 않는다.
   - service_role/secret key는 쓰지 않는다(다른 모든 독립 모듈과 동일한
     원칙 — publishable key + 로그인 세션 + RLS만 사용).
   - 사이드바의 "관리자" 링크(index.html의 #adminSidebarLink, 기본
     hidden)는 이 파일이 admin_users 조회 결과에 따라 보이거나 숨길
     뿐인 UX 편의 기능이다 — #/admin 자체의 접근 제어(아래 refreshAdminAwareness)와
     완전히 같은 판별 결과를 재사용하며, 별도의(더 느슨한) 판별 로직을
     새로 만들지 않는다. 이 링크가 숨겨져 있어도 URL을 직접 입력하면
     여전히 같은 DB 확인을 거치므로, 메뉴 노출 여부가 보안 경계가 되지
     않는다(관리자가 아니면 admin_users 조회 결과가 항상 빈 값이라
     콘텐츠 자체가 그려지지 않는다).

   2단계(이번 변경): "도매처 등록 문의" 섹션을 실제 기능으로 교체했다.
   - 목록/필터: wholesaler_inquiries를 상태별로 조회한다(관리자는 RLS의
     wholesaler_inquiries_select_admin 정책으로 전체를 볼 수 있다).
   - 승인/반려: 브라우저는 wholesalers INSERT나 wholesaler_inquiries UPDATE
     권한을 전혀 갖지 않는다 — approve_wholesaler_inquiry / rpc만 호출하고,
     실제 쓰기는 SECURITY DEFINER 함수 내부에서 관리자 재확인 후 원자적으로
     일어난다(20260915160000_admin_wholesaler_inquiries.sql 참고).
   - 대시보드의 "도매처 등록 문의 대기" 카드만 pending 개수로 실제 연결했다
     (다른 카드는 여전히 "—"/"준비 중").

   각 섹션의 렌더 함수는 이제 (container, section) => void 형태다 — 문자열을
   반환하기만 하던 1단계와 달리, 자기 상태(목록/필터/모달)를 직접 들고
   있어야 하는 섹션(wholesaler-inquiries 등)도 같은 구조로 등록할 수 있게
   하기 위한 최소 확장이다. 다음으로 실제 기능을 붙일 섹션(예: 세팅 대행
   문의)도 SECTION_RENDERERS에 같은 시그니처의 함수를 등록하기만 하면 된다.

   3단계(이번 변경): "도매처" 섹션을 실제 기능으로 교체했다 — 전체 목록
   조회(관리자는 RLS의 wholesalers_select_admin 정책으로 상태 무관 전체를
   본다), 수정/공개상태 전환/영구 삭제. 브라우저는 wholesalers UPDATE나
   DELETE 권한이 전혀 없고, update_wholesaler / set_wholesaler_published /
   delete_wholesaler 세 RPC를 통해서만(그것도 함수 내부에서 관리자 재확인
   후에만) 그 쓰기가 일어난다(20260915180000_admin_wholesaler_management.sql
   참고). "공개상태"는 published <-> unpublished 두 값만 오가며,
   unpublished는 이 마이그레이션에서 status CHECK에 새로 추가한 값이다. */
(function(){
  function client(){ return window.launchdeskSupabase || null; }

  var checkingEl = document.getElementById('adminCheckingState');
  var loginRequiredEl = document.getElementById('adminLoginRequiredState');
  var noAccessEl = document.getElementById('adminNoAccessState');
  var appRoot = document.getElementById('adminAppRoot');
  var loginBtn = document.getElementById('adminLoginBtn');
  if(!checkingEl || !loginRequiredEl || !noAccessEl || !appRoot){ return; }

  // stores.js/wholesalers.js와 동일한 방식(각자 다른 최상위 IIFE라 함수
  // 공유 불가) — innerHTML에 꽂기 전 사용자 표시용 라벨을 이스케이프한다
  // (지금은 전부 고정 문자열이라 실질적 위험은 없지만, 이 파일이 나중에
  // 실제 회원/문의 데이터를 그릴 때도 그대로 재사용하기 위해 미리 갖춰둔다).
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  // wholesalers.js/stores.js와 동일한 방식(각자 다른 최상위 IIFE라 함수
  // 공유 불가) — http(s) 스킴이 아니면 링크로 만들지 않고 텍스트로만 보여준다.
  function safeHref(url){
    return /^https?:\/\//i.test(url || '') ? url : null;
  }
  // 카테고리 한글 라벨은 wholesalers.js가 이미 공개해둔 값을 그대로 쓴다
  // (window.launchdeskWholesalers.categoryLabel) — 이 파일에 같은 8개
  // 카테고리 목록을 또 만들지 않는다. wholesalers.js가 어떤 이유로 아직
  // 없다면 원래 값을 그대로 보여준다(빈 화면보다 낫다).
  function categoryLabelFor(value){
    var api = window.launchdeskWholesalers;
    return (api && typeof api.categoryLabel === 'function') ? api.categoryLabel(value) : value;
  }
  function formatDate(iso){
    if(!iso) return '-';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  // 회원 섹션 전용 — "최근 로그인 시각"처럼 날짜만으로는 부족한 값에
  // 시:분까지 함께 보여준다(formatDate는 날짜만 반환하므로 재사용하지
  // 않고 별도로 둔다).
  function formatDateTime(iso){
    if(!iso) return '-';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
  }

  // showToast: app.js/tools.js/stores.js/wholesalers.js와 동일한 방식으로
  // 이 파일 안에서 따로 둔다(각자 다른 최상위 IIFE라 함수를 공유할 수 없음).
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
  // 관리자 RPC(approve/reject_wholesaler_inquiry, update_wholesaler,
  // set_wholesaler_published, delete_wholesaler)가 raise exception으로
  // 보내는 짧은 코드 문자열만 운영자가 이해할 수 있는 문구로 바꾼다 — 그
  // 외의(예상 못 한) DB 에러 원문은 화면에 그대로 노출하지 않고 null을
  // 반환해, 호출부가 일반적인 실패 문구로 대체하게 한다.
  function friendlyAdminActionError(rawMessage){
    if(rawMessage === 'ADMIN_REQUIRED') return '관리자 권한이 없습니다.';
    if(rawMessage === 'INQUIRY_NOT_FOUND') return '문의를 찾을 수 없습니다.';
    if(rawMessage === 'INQUIRY_ALREADY_PROCESSED') return '이미 처리된 문의입니다.';
    if(rawMessage === 'WHOLESALER_NOT_FOUND') return '도매처를 찾을 수 없습니다.';
    if(rawMessage === 'INVALID_STATUS') return '올바르지 않은 상태 값입니다.';
    return null;
  }
  // URL 입력 UX 개선 — wholesalers.js/stores.js의 normalizeUrl()과 규칙이
  // 완전히 동일한 의도적 중복이다(각자 다른 최상위 IIFE라 공유 불가 —
  // 이미 두 파일 사이에 같은 이유로 중복돼 있고, 그때와 같은 TODO를
  // 남긴다: 세 기능이 안정화된 뒤 별도 공용 유틸로 합칠 것).
  //   1) 앞뒤 공백 제거
  //   2) 이미 http:// 또는 https://면 그대로 유지
  //   3) 그 외 "단어:" 스킴(javascript:, data:, file: 등)이 있으면 거부(null)
  //   4) 스킴이 아예 없으면 https://를 붙인다
  function normalizeUrl(raw){
    var v = String(raw == null ? '' : raw).trim();
    if(!v) return '';
    var schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
    if(schemeMatch){
      var scheme = schemeMatch[1].toLowerCase();
      return (scheme === 'http' || scheme === 'https') ? v : null;
    }
    return 'https://' + v;
  }

  function setState(state){
    // 'checking' | 'login-required' | 'no-access' | 'admin'
    checkingEl.hidden = state !== 'checking';
    loginRequiredEl.hidden = state !== 'login-required';
    noAccessEl.hidden = state !== 'no-access';
    appRoot.hidden = state !== 'admin';
    if(state !== 'admin'){
      // 관리자로 확정되지 않은 모든 상태에서는 이전에 그려졌을 수 있는
      // 콘텐츠를 확실히 비운다 — 관리자 A가 보던 화면 조각이 그 다음
      // 확인(다른 계정, 또는 권한 없음)에서 한 프레임도 남지 않게 한다.
      appRoot.innerHTML = '';
    }
  }

  if(loginBtn){
    loginBtn.addEventListener('click', function(){
      if(typeof window.launchdeskOpenLoginModal === 'function') window.launchdeskOpenLoginModal();
    });
  }

  // ------------------------------------------------------------------ 메뉴/섹션 정의
  var SECTIONS = [
    { key: 'dashboard',             label: '대시보드' },
    { key: 'members',               label: '회원' },
    { key: 'stores',                label: '쇼핑몰' },
    { key: 'wholesalers',           label: '도매처' },
    { key: 'wholesaler-inquiries',  label: '도매처 등록 문의' },
    { key: 'setup-inquiries',       label: '세팅 대행 문의' },
    { key: 'content',               label: '콘텐츠' },
    { key: 'beta',                  label: 'Beta 사용자 현황' },
    { key: 'billing',               label: '결제 / 구독' },
    { key: 'logs',                  label: '시스템 로그' }
  ];

  // 6단계(회원 관리)에서 "전체 회원"도 실제 데이터로 연결했다 — 이제
  // 카드 6개 전부 실제 데이터를 쓴다("준비 중" placeholder는 남지 않음).
  var DASHBOARD_CARD_LABELS = [
    '전체 회원', '등록 쇼핑몰', 'Cafe24 연결', 'Meta 연결', '도매처 등록 문의 대기', '세팅 대행 문의'
  ];
  // label -> 개수를 반환하는 fetch 함수. 새로 실연결할 카드가 생기면 여기
  // 한 줄만 추가하면 된다(각 fetch 함수는 이 파일 안 다른 곳에 정의된
  // function 선언이라 호이스팅되어 여기서 참조해도 문제없다).
  var DASHBOARD_LIVE_CARDS = [
    { label: '전체 회원', fetchCount: function(){ return fetchMemberCount(); } },
    { label: '등록 쇼핑몰', fetchCount: function(){ return fetchStoreCount(); } },
    { label: 'Cafe24 연결', fetchCount: function(){ return fetchConnectedCountByProvider('cafe24'); } },
    { label: 'Meta 연결', fetchCount: function(){ return fetchConnectedCountByProvider('meta'); } },
    { label: '도매처 등록 문의 대기', fetchCount: function(){ return fetchPendingInquiryCount(); } },
    { label: '세팅 대행 문의', fetchCount: function(){ return fetchPendingSetupInquiryCount(); } }
  ];

  // KPI 숫자는 Realtime subscription이 아니라 "조회 시점의 현재 DB 상태"다
  // — 카드 sub 라벨에 그 사실을 정확히 반영한다("실시간"이라는 오해 소지
  // 있는 표현 대신 "현재 기준"만 쓴다). 대시보드 상단에 "최근 조회" 시각과
  // 수동 새로고침 버튼을 두어, 사용자가 언제 조회된 값인지 스스로 판단하고
  // 필요할 때 다시 조회할 수 있게 한다. Realtime은 이번 단계에서 의도적으로
  // 붙이지 않는다(요구사항 4) — "진입 시 조회 / 새로고침 클릭 시 재조회"
  // 방식만 유지한다.
  var dashboardLastFetchedAt = null; // 마지막으로 KPI 조회가 모두 끝난 시각(Date) — 다음 render에도 남아있어야 하므로 모듈 스코프
  var dashboardRefreshInFlight = false; // 새로고침 중복 클릭 방지(요구사항 3)

  // "최근 조회" 표시 전용 — formatDate/formatDateTime과 달리 Asia/Seoul로
  // 고정하지 않는다(요구사항 2: 브라우저 로컬 시간 사용). 초 단위는 표시하지
  // 않는다. 결과 형식: "2026.09.15 15:20".
  function formatKpiRefreshedAt(date){
    if(!date) return null;
    function pad(n){ return n < 10 ? '0' + n : String(n); }
    return date.getFullYear() + '.' + pad(date.getMonth() + 1) + '.' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function updateDashboardRefreshedAtLabel(container){
    var el = container.querySelector('#adminDashboardRefreshedAt');
    if(!el) return;
    el.textContent = dashboardLastFetchedAt ? ('최근 조회: ' + formatKpiRefreshedAt(dashboardLastFetchedAt)) : '';
  }

  // KPI 카드 6개를 전부 (다시) 조회한다 — 대시보드 최초 진입과 새로고침
  // 버튼 클릭이 동일하게 이 함수 하나를 쓴다(요구사항 5: fetch 로직 복제
  // 금지, DASHBOARD_LIVE_CARDS를 그대로 재사용). 카드별 fetchCount()는
  // 이미 내부적으로 실패를 { ok:false }로 흡수하므로(reject하지 않음),
  // Promise.all은 일부 카드가 실패해도 항상 끝까지 완료된다 — 그래서
  // "조회 시도 완료 시각"은 일부 실패와 무관하게 항상 갱신할 수 있다
  // (요구사항 2의 마지막 규칙).
  function loadDashboardStats(container){
    if(dashboardRefreshInFlight) return; // 중복 클릭 방지
    dashboardRefreshInFlight = true;

    var refreshBtn = container.querySelector('#adminDashboardRefreshBtn');
    if(refreshBtn){
      refreshBtn.disabled = true;
      refreshBtn.textContent = '새로고침 중…';
    }

    var fetches = DASHBOARD_LIVE_CARDS.map(function(cardDef){
      var card = container.querySelector('.kpi-card[data-kpi-label="' + cardDef.label + '"]');
      return cardDef.fetchCount().then(function(res){
        if(!container.isConnected || !card) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
        if(!res.ok) return; // 실패 시 이전 값 그대로 유지 — 가짜 값으로 채우지 않는다
        card.querySelector('.kpi-value').textContent = String(res.count);
        card.querySelector('.admin-kpi-sub').textContent = '현재 기준';
      });
    });

    Promise.all(fetches).then(function(){
      dashboardRefreshInFlight = false;
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 버튼/시각을 건드리지 않음
      dashboardLastFetchedAt = new Date();
      updateDashboardRefreshedAtLabel(container);
      if(refreshBtn){
        refreshBtn.disabled = false;
        refreshBtn.textContent = '새로고침';
      }
    });
  }

  // 렌더 함수 시그니처: (container, section) => void. 문자열을 반환하는 게
  // 아니라 container.innerHTML을 직접 채우고 필요하면 자기 리스너/후속
  // 데이터 로딩까지 스스로 처리한다 — placeholder처럼 그릴 것만 있는
  // 섹션도, wholesaler-inquiries처럼 목록/필터/모달 상태를 들고 있는
  // 섹션도 같은 방식으로 등록할 수 있게 하기 위함이다.
  function renderDashboardSection(container){
    container.innerHTML = '<div class="admin-panel-head">대시보드</div>' +
      '<div class="admin-panel-body">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; gap:.8rem; flex-wrap:wrap;">' +
          '<div id="adminDashboardRefreshedAt" style="font-size:.78rem; color:var(--ink-faint);"></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminDashboardRefreshBtn">새로고침</button>' +
        '</div>' +
        '<div class="kpi-grid">' +
          DASHBOARD_CARD_LABELS.map(function(label){
            return '<div class="kpi-card" data-kpi-label="' + escapeHtml(label) + '"><div class="kpi-head"><span>' + escapeHtml(label) + '</span></div>' +
              '<div class="kpi-value">—</div><div class="admin-kpi-sub">준비 중</div></div>';
          }).join('') +
        '</div>' +
      '</div>';

    updateDashboardRefreshedAtLabel(container); // 이전에 조회한 적 있으면(다른 메뉴 갔다 돌아온 경우) 즉시 보여준다
    container.querySelector('#adminDashboardRefreshBtn').addEventListener('click', function(){
      loadDashboardStats(container);
    });
    loadDashboardStats(container);
  }

  function renderPlaceholderSection(container, section){
    container.innerHTML = '<div class="admin-panel-head">' + escapeHtml(section.label) + '</div>' +
      '<div class="admin-panel-body"><div class="empty-state" style="padding:2.4rem 1rem;"><p>관리 기능 준비 중</p></div></div>';
  }

  // key -> 렌더 함수. dashboard/wholesaler-inquiries만 실제 함수가 있고
  // 나머지는 전부 renderPlaceholderSection을 공유한다. 다음으로 실제
  // 기능을 붙일 섹션(예: 세팅 대행 문의)도 여기에 같은 시그니처
  // ((container, section) => void)의 함수를 등록하기만 하면 된다.
  var SECTION_RENDERERS = {
    dashboard: renderDashboardSection,
    members: renderMembersSection,
    stores: renderStoresSection,
    wholesalers: renderWholesalersSection,
    'wholesaler-inquiries': renderWholesalerInquiriesSection,
    'setup-inquiries': renderSetupInquiriesSection,
    beta: renderBetaOverviewSection
  };
  function renderSectionInto(container, section){
    var renderer = SECTION_RENDERERS[section.key];
    if(renderer) renderer(container, section);
    else renderPlaceholderSection(container, section);
  }

  var currentSectionKey = 'dashboard';

  function renderAdminShell(){
    appRoot.innerHTML =
      '<span class="eyebrow">LAUNCHDESK ADMIN</span>' +
      '<div class="page-head"><h1>관리자</h1><p class="page-lead">운영 데이터를 확인하고 관리하는 내부 전용 화면이에요.</p></div>' +
      '<div class="admin-layout">' +
        '<nav class="admin-nav" id="adminNav">' +
          SECTIONS.map(function(s){
            return '<button type="button" class="admin-nav-item' + (s.key === currentSectionKey ? ' active' : '') +
              '" data-section="' + s.key + '">' + escapeHtml(s.label) + '</button>';
          }).join('') +
        '</nav>' +
        '<div class="admin-panel" id="adminPanel"></div>' +
      '</div>';

    renderSectionInto(document.getElementById('adminPanel'), SECTIONS[0]);

    document.getElementById('adminNav').addEventListener('click', function(e){
      var btn = e.target.closest('.admin-nav-item');
      if(!btn) return;
      var key = btn.getAttribute('data-section');
      if(key === currentSectionKey) return;
      currentSectionKey = key;
      document.querySelectorAll('#adminNav .admin-nav-item').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      var section = SECTIONS.filter(function(s){ return s.key === key; })[0];
      renderSectionInto(document.getElementById('adminPanel'), section);
    });
  }

  // =========================================================================
  // "도매처 등록 문의" — 목록/필터/상세/승인·반려
  // =========================================================================
  var INQUIRY_FILTERS = [
    { key: 'pending',  label: '검토중' },
    { key: 'approved', label: '등록 완료' },
    { key: 'rejected', label: '등록 보류' },
    { key: 'all',      label: '전체' }
  ];
  var INQUIRY_STATUS_LABELS = { pending: '검토중', approved: '등록 완료', rejected: '등록 보류' };

  var inquiryFilter = 'pending'; // 기본값: 검토중
  var inquiryItems = null;       // 현재 필터로 불러온 목록(null = 아직 없음)
  var inquiryLoadSeq = 0;

  // 로그인 여부와 무관하게 호출 가능한 wholesalers.js의 공개 목록 조회와
  // 달리, 이건 관리자 전용 조회다 — RLS의 wholesaler_inquiries_select_admin
  // 정책(is_admin())이 관리자에게만 전체 행을 보여주고, 일반 사용자가 같은
  // 코드를 실행해도(콘솔에서 직접 호출해도) 본인 행 0~n건 이상은 볼 수 없다.
  function fetchInquiries(statusFilter){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    var q = sb.from('wholesaler_inquiries')
      .select('id, name, url, category, summary, main_products, min_order_condition, requires_business_membership, allows_small_quantity, allows_dropshipping, contact_email, memo, status, admin_note, resolved_wholesaler_id, created_at')
      .order('created_at', { ascending: false });
    if(statusFilter && statusFilter !== 'all') q = q.eq('status', statusFilter);
    return q.then(function(res){
      if(res.error) return { ok: false, error: res.error.message };
      return { ok: true, data: res.data || [] };
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  function fetchPendingInquiryCount(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    return sb.from('wholesaler_inquiries').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, count: res.count || 0 };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  // 승인/반려 둘 다: 브라우저는 wholesalers INSERT나 wholesaler_inquiries
  // UPDATE 권한이 없다 — 이 RPC 호출만이 유일한 쓰기 경로이고, 실제 쓰기는
  // 함수 내부(SECURITY DEFINER, 관리자 재확인 포함)에서 원자적으로 일어난다.
  function approveInquiry(id, note){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('approve_wholesaler_inquiry', { p_inquiry_id: id, p_admin_note: note || null })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, wholesalerId: res.data };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }
  function rejectInquiry(id, note){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('reject_wholesaler_inquiry', { p_inquiry_id: id, p_admin_note: note || null })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function renderWholesalerInquiriesSection(container){
    container.innerHTML =
      '<div class="admin-panel-head">도매처 등록 문의</div>' +
      '<div class="admin-panel-body">' +
        '<div class="admin-filter-tab-row" id="adminInqFilterTabs">' +
          INQUIRY_FILTERS.map(function(f){
            return '<button type="button" class="admin-filter-tab' + (f.key === inquiryFilter ? ' active' : '') +
              '" data-filter="' + f.key + '">' + escapeHtml(f.label) + '</button>';
          }).join('') +
        '</div>' +
        '<div id="adminInqListWrap"></div>' +
      '</div>';

    container.querySelector('#adminInqFilterTabs').addEventListener('click', function(e){
      var btn = e.target.closest('.admin-filter-tab');
      if(!btn) return;
      var key = btn.getAttribute('data-filter');
      if(key === inquiryFilter) return;
      inquiryFilter = key;
      container.querySelectorAll('#adminInqFilterTabs .admin-filter-tab').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      loadInquiryList(container);
    });

    loadInquiryList(container);
  }

  function loadInquiryList(container){
    var listWrap = container.querySelector('#adminInqListWrap');
    if(!listWrap) return;
    listWrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++inquiryLoadSeq;
    fetchInquiries(inquiryFilter).then(function(res){
      if(seq !== inquiryLoadSeq) return; // 그 사이 필터가 바뀌었으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      if(!res.ok){
        // 0건(정상)과 조회 실패(에러)를 반드시 구분한다 — 에러를 빈
        // 목록처럼 보여주지 않는다.
        listWrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;">' +
          '<p>문의 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminInqRetryBtn">다시 시도</button></div>';
        var retryBtn = listWrap.querySelector('#adminInqRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadInquiryList(container); });
        return;
      }
      inquiryItems = res.data;
      renderInquiryTable(container, listWrap);
    });
  }

  function renderInquiryTable(container, listWrap){
    if(inquiryItems.length === 0){
      var emptyText = inquiryFilter === 'pending' ? '검토 대기 중인 문의가 없습니다.'
        : inquiryFilter === 'approved' ? '등록 완료된 문의가 없습니다.'
        : inquiryFilter === 'rejected' ? '등록 보류된 문의가 없습니다.'
        : '등록된 문의가 없습니다.';
      listWrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>' + escapeHtml(emptyText) + '</p></div>';
      return;
    }

    listWrap.innerHTML = '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>사이트명</th><th>카테고리</th><th>담당 이메일</th><th>문의일</th><th>상태</th><th></th></tr></thead>' +
      '<tbody>' +
        inquiryItems.map(function(item){
          return '<tr>' +
            '<td><strong>' + escapeHtml(item.name) + '</strong></td>' +
            '<td>' + escapeHtml(categoryLabelFor(item.category)) + '</td>' +
            '<td>' + escapeHtml(item.contact_email) + '</td>' +
            '<td>' + escapeHtml(formatDate(item.created_at)) + '</td>' +
            '<td>' + escapeHtml(INQUIRY_STATUS_LABELS[item.status] || item.status) + '</td>' +
            '<td><button type="button" class="btn btn-ghost btn-sm admin-inq-detail-btn" data-id="' + escapeHtml(item.id) + '">상세보기</button></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';

    listWrap.querySelectorAll('.admin-inq-detail-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-id');
        var item = inquiryItems.filter(function(it){ return String(it.id) === id; })[0];
        if(item) openInquiryDetailModal(item, container);
      });
    });
  }

  // 상세 모달은 index.html에 미리 만들어두지 않고, stores.js의 Cafe24/Meta
  // 모달들과 달리 이 파일이 필요할 때 직접 DOM에 붙였다가 닫을 때 제거한다
  // (index.html을 건드리지 않기 위함) — 기존 .modal/.modal-backdrop/
  // .modal-panel 클래스는 그대로 재사용해 스타일만 이어받는다.
  function closeInquiryDetailModal(){
    var el = document.getElementById('adminInqDetailModal');
    if(el) el.remove();
    document.removeEventListener('keydown', handleInquiryModalEscape);
  }
  function handleInquiryModalEscape(e){
    if(e.key === 'Escape') closeInquiryDetailModal();
  }

  function openInquiryDetailModal(item, sectionContainer){
    closeInquiryDetailModal(); // 혹시 이전에 열려있던 게 있으면 먼저 정리

    function row(label, valueHtml){
      return '<div style="margin-bottom:.9rem;">' +
        '<div style="font-size:.78rem; font-weight:700; color:var(--ink-soft); margin-bottom:.25rem;">' + escapeHtml(label) + '</div>' +
        '<div style="font-size:.9rem; color:var(--ink); word-break:break-word;">' + valueHtml + '</div>' +
      '</div>';
    }

    var href = safeHref(item.url);
    var urlHtml = href
      ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.url) + '</a>'
      : escapeHtml(item.url);

    var isPending = item.status === 'pending';
    var actionsHtml = '';
    if(isPending){
      actionsHtml =
        '<div id="adminInqActionsWrap" style="display:flex; gap:.6rem; margin-top:1.2rem;">' +
          '<button type="button" class="btn btn-primary" id="adminInqApproveBtn" style="flex:1; justify-content:center;">승인 후 게시</button>' +
          '<button type="button" class="btn btn-ghost" id="adminInqRejectBtn" style="flex:1; justify-content:center;">등록 보류</button>' +
        '</div>' +
        '<div id="adminInqRejectNoteWrap" hidden style="margin-top:1rem;">' +
          '<div class="ws-field" style="margin-bottom:.7rem;"><label for="adminInqRejectNote">보류 사유(선택, 신청자에게 참고로 남습니다)</label><textarea id="adminInqRejectNote" rows="3"></textarea></div>' +
          '<div style="display:flex; gap:.6rem;">' +
            '<button type="button" class="btn btn-primary" id="adminInqRejectConfirmBtn" style="flex:1; justify-content:center;">보류 확정</button>' +
            '<button type="button" class="btn btn-ghost" id="adminInqRejectCancelBtn" style="flex:1; justify-content:center;">취소</button>' +
          '</div>' +
        '</div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'adminInqDetailModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="modal-backdrop" id="adminInqDetailBackdrop"></div>' +
      '<div class="modal-panel" style="max-width:480px; text-align:left; max-height:85vh; overflow-y:auto;">' +
        '<button class="modal-close" type="button" id="adminInqDetailClose" aria-label="닫기">✕</button>' +
        '<div class="modal-head" style="text-align:left;"><h2>' + escapeHtml(item.name) + '</h2></div>' +
        row('사이트 URL', urlHtml) +
        row('카테고리', escapeHtml(categoryLabelFor(item.category))) +
        row('한 줄 소개', escapeHtml(item.summary)) +
        (item.main_products ? row('주요 취급상품', escapeHtml(item.main_products)) : '') +
        (item.min_order_condition ? row('최소 주문 조건', escapeHtml(item.min_order_condition)) : '') +
        row('사업자 회원 필요', item.requires_business_membership ? '예' : '아니요') +
        row('소량 주문 가능', item.allows_small_quantity ? '예' : '아니요') +
        row('위탁배송 가능', item.allows_dropshipping ? '예' : '아니요') +
        row('담당 이메일', escapeHtml(item.contact_email)) +
        (item.memo ? row('추가 설명', escapeHtml(item.memo)) : '') +
        row('문의일', escapeHtml(formatDate(item.created_at))) +
        row('현재 상태', escapeHtml(INQUIRY_STATUS_LABELS[item.status] || item.status)) +
        (item.admin_note ? row('관리자 안내', escapeHtml(item.admin_note)) : '') +
        actionsHtml +
      '</div>';

    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleInquiryModalEscape);
    document.getElementById('adminInqDetailBackdrop').addEventListener('click', closeInquiryDetailModal);
    document.getElementById('adminInqDetailClose').addEventListener('click', closeInquiryDetailModal);

    if(!isPending) return;

    var approveBtn = document.getElementById('adminInqApproveBtn');
    var rejectBtn = document.getElementById('adminInqRejectBtn');
    var rejectWrap = document.getElementById('adminInqRejectNoteWrap');

    approveBtn.addEventListener('click', function(){
      if(!window.confirm('이 도매처를 승인하고 게시하시겠어요?')) return;
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      approveInquiry(item.id, null).then(function(res){
        if(res.ok){
          showToast('도매처가 게시되었습니다.', 'success');
          closeInquiryDetailModal();
          loadInquiryList(sectionContainer);
          return;
        }
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        showToast(friendlyAdminActionError(res.error) || '승인에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
      });
    });

    rejectBtn.addEventListener('click', function(){
      rejectWrap.hidden = false;
      document.getElementById('adminInqActionsWrap').hidden = true;
    });
    document.getElementById('adminInqRejectCancelBtn').addEventListener('click', function(){
      rejectWrap.hidden = true;
      document.getElementById('adminInqActionsWrap').hidden = false;
    });
    document.getElementById('adminInqRejectConfirmBtn').addEventListener('click', function(){
      var confirmBtn = document.getElementById('adminInqRejectConfirmBtn');
      var cancelBtn = document.getElementById('adminInqRejectCancelBtn');
      var note = document.getElementById('adminInqRejectNote').value.trim();
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      rejectInquiry(item.id, note || null).then(function(res){
        if(res.ok){
          showToast('등록 보류 처리되었습니다.', 'success');
          closeInquiryDetailModal();
          loadInquiryList(sectionContainer);
          return;
        }
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        showToast(friendlyAdminActionError(res.error) || '등록 보류 처리에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
      });
    });
  }

  // =========================================================================
  // "도매처" — 전체 목록/수정/공개상태/영구 삭제
  // =========================================================================
  // 상태 라벨: pending/rejected는 문의 승인 흐름(2단계) 쪽 의미를 그대로
  // 보여주기 위한 것이고, 이 화면의 "공개상태 변경" 토글은 published <->
  // unpublished만 오간다(20260915180000 마이그레이션 참고).
  var WHOLESALER_STATUS_LABELS = { pending: '검토중', published: '공개', rejected: '반려', unpublished: '비공개' };

  var wholesalerItems = null; // 전체 목록(null = 아직 없음) — 필터 없음(요구사항에 없음)
  var wholesalerLoadSeq = 0;

  // 일반 사용자는 published만 보는 wholesalers.js의 공개 조회와 달리, 이건
  // 관리자 전용 조회다 — RLS의 wholesalers_select_admin 정책(is_admin())이
  // 관리자에게만 모든 상태의 행을 보여준다.
  function fetchAllWholesalersForAdmin(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.from('wholesalers')
      .select('id, name, url, category, summary, main_products, min_order_condition, requires_business_membership, allows_small_quantity, allows_dropshipping, status, source_inquiry_id, created_at')
      .order('created_at', { ascending: false })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, data: res.data || [] };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  // 아래 세 함수 전부: 브라우저는 wholesalers에 대한 UPDATE/DELETE 권한이
  // 없다 — 이 RPC 호출만이 유일한 쓰기 경로이고, 실제 쓰기는 함수 내부
  // (SECURITY DEFINER, 관리자 재확인 포함)에서 일어난다.
  function updateWholesaler(id, payload){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('update_wholesaler', {
      p_wholesaler_id: id,
      p_name: payload.name,
      p_url: payload.url,
      p_category: payload.category,
      p_summary: payload.summary,
      p_main_products: payload.main_products,
      p_min_order_condition: payload.min_order_condition,
      p_requires_business_membership: payload.requires_business_membership,
      p_allows_small_quantity: payload.allows_small_quantity,
      p_allows_dropshipping: payload.allows_dropshipping
    }).then(function(res){
      if(res.error) return { ok: false, error: res.error.message };
      return { ok: true };
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }
  function setWholesalerPublished(id, published){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('set_wholesaler_published', { p_wholesaler_id: id, p_published: published })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }
  function deleteWholesaler(id){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('delete_wholesaler', { p_wholesaler_id: id })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function renderWholesalersSection(container){
    container.innerHTML =
      '<div class="admin-panel-head">도매처</div>' +
      '<div class="admin-panel-body"><div id="adminWhListWrap"></div></div>';
    loadWholesalerList(container);
  }

  function loadWholesalerList(container){
    var wrap = container.querySelector('#adminWhListWrap');
    if(!wrap) return;
    wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++wholesalerLoadSeq;
    fetchAllWholesalersForAdmin().then(function(res){
      if(seq !== wholesalerLoadSeq) return; // 그 사이 다른 요청이 시작됐으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      if(!res.ok){
        // 0건(정상)과 조회 실패(에러)를 반드시 구분한다.
        wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;">' +
          '<p>도매처 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminWhRetryBtn">다시 시도</button></div>';
        var retryBtn = wrap.querySelector('#adminWhRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadWholesalerList(container); });
        return;
      }
      wholesalerItems = res.data;
      renderWholesalerTable(container, wrap);
    });
  }

  function renderWholesalerTable(container, wrap){
    if(wholesalerItems.length === 0){
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>등록된 도매처가 없습니다.</p></div>';
      return;
    }

    wrap.innerHTML = '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>이름</th><th>카테고리</th><th>URL</th><th>등록일</th><th>상태</th><th>출처</th><th></th></tr></thead>' +
      '<tbody>' +
        wholesalerItems.map(function(w){
          var href = safeHref(w.url);
          var urlHtml = href
            ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">바로가기 ↗</a>'
            : escapeHtml(w.url);
          var toggleLabel = w.status === 'published' ? '비공개로 전환' : '공개로 전환';
          return '<tr>' +
            '<td><strong>' + escapeHtml(w.name) + '</strong></td>' +
            '<td>' + escapeHtml(categoryLabelFor(w.category)) + '</td>' +
            '<td>' + urlHtml + '</td>' +
            '<td>' + escapeHtml(formatDate(w.created_at)) + '</td>' +
            '<td>' + escapeHtml(WHOLESALER_STATUS_LABELS[w.status] || w.status) + '</td>' +
            '<td>' + (w.source_inquiry_id ? '문의 등록' : '직접 등록') + '</td>' +
            '<td style="white-space:nowrap;">' +
              '<button type="button" class="btn btn-ghost btn-sm admin-wh-edit-btn" data-id="' + escapeHtml(w.id) + '">수정</button> ' +
              '<button type="button" class="btn btn-ghost btn-sm admin-wh-toggle-btn" data-id="' + escapeHtml(w.id) + '">' + escapeHtml(toggleLabel) + '</button> ' +
              '<button type="button" class="btn btn-ghost btn-sm admin-wh-delete-btn" data-id="' + escapeHtml(w.id) + '">삭제</button>' +
            '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';

    wrap.querySelectorAll('.admin-wh-edit-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var item = wholesalerItems.filter(function(w){ return String(w.id) === btn.getAttribute('data-id'); })[0];
        if(item) openWholesalerEditModal(item, container);
      });
    });

    wrap.querySelectorAll('.admin-wh-toggle-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var item = wholesalerItems.filter(function(w){ return String(w.id) === btn.getAttribute('data-id'); })[0];
        if(!item) return;
        var nextPublished = item.status !== 'published';
        btn.disabled = true;
        setWholesalerPublished(item.id, nextPublished).then(function(res){
          if(res.ok){
            showToast(nextPublished ? '게시되었습니다.' : '비공개로 전환되었습니다.', 'success');
            loadWholesalerList(container);
            return;
          }
          btn.disabled = false;
          showToast(friendlyAdminActionError(res.error) || '처리에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
        });
      });
    });

    wrap.querySelectorAll('.admin-wh-delete-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var item = wholesalerItems.filter(function(w){ return String(w.id) === btn.getAttribute('data-id'); })[0];
        if(!item) return;
        // 삭제 전 confirm — 되돌릴 수 없는 작업임을 명시한다. 연결된
        // wholesaler_inquiries.resolved_wholesaler_id는 on delete set null이라
        // 문의 자체는 지워지지 않고 그 참조만 비워진다(마이그레이션 참고).
        if(!window.confirm('"' + item.name + '"을(를) 영구 삭제하시겠어요?\n이 작업은 되돌릴 수 없습니다. (연결된 문의 기록은 삭제되지 않습니다)')) return;
        btn.disabled = true;
        deleteWholesaler(item.id).then(function(res){
          if(res.ok){
            showToast('삭제되었습니다.', 'success');
            loadWholesalerList(container);
            return;
          }
          btn.disabled = false;
          showToast(friendlyAdminActionError(res.error) || '삭제에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
        });
      });
    });
  }

  // 수정 모달도 문의 상세 모달과 같은 방식(index.html에 미리 두지 않고
  // 필요할 때 document.body에 붙였다 닫을 때 제거)으로 만든다.
  function closeWholesalerEditModal(){
    var el = document.getElementById('adminWhEditModal');
    if(el) el.remove();
    document.removeEventListener('keydown', handleWholesalerModalEscape);
  }
  function handleWholesalerModalEscape(e){
    if(e.key === 'Escape') closeWholesalerEditModal();
  }

  function openWholesalerEditModal(item, sectionContainer){
    closeWholesalerEditModal();

    var categories = (window.launchdeskWholesalers && window.launchdeskWholesalers.CATEGORIES) || [];
    var selectOptions = categories.map(function(c){
      return '<option value="' + escapeHtml(c.value) + '"' + (c.value === item.category ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'adminWhEditModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="modal-backdrop" id="adminWhEditBackdrop"></div>' +
      '<div class="modal-panel" style="max-width:480px; text-align:left; max-height:85vh; overflow-y:auto;">' +
        '<button class="modal-close" type="button" id="adminWhEditClose" aria-label="닫기">✕</button>' +
        '<div class="modal-head" style="text-align:left;"><h2>도매처 수정</h2></div>' +
        '<form id="adminWhEditForm">' +
          '<div class="ws-field" style="margin-bottom:.9rem;"><label for="adminWhName">이름 *</label><input id="adminWhName" type="text" required maxlength="80" value="' + escapeHtml(item.name) + '"></div>' +
          '<div class="ws-field" style="margin-bottom:.9rem;"><label for="adminWhUrl">사이트 주소 *</label><input id="adminWhUrl" type="text" required value="' + escapeHtml(item.url) + '"></div>' +
          '<div class="ws-field" style="margin-bottom:.9rem;"><label for="adminWhCategory">카테고리 *</label>' +
            '<select id="adminWhCategory" required style="border:1px solid var(--border-strong); border-radius:8px; background:var(--bg); padding:.6rem .8rem; font-family:var(--f-body); font-size:.88rem; color:var(--ink); width:100%;">' + selectOptions + '</select>' +
          '</div>' +
          '<div class="ws-field" style="margin-bottom:.9rem;"><label for="adminWhSummary">한 줄 소개 *</label><input id="adminWhSummary" type="text" required maxlength="120" value="' + escapeHtml(item.summary) + '"></div>' +
          '<div class="ws-field" style="margin-bottom:.9rem;"><label for="adminWhMainProducts">주요 취급상품</label><input id="adminWhMainProducts" type="text" value="' + escapeHtml(item.main_products || '') + '"></div>' +
          '<div class="ws-field" style="margin-bottom:.9rem;"><label for="adminWhMinOrder">최소 주문 조건</label><input id="adminWhMinOrder" type="text" value="' + escapeHtml(item.min_order_condition || '') + '"></div>' +
          '<div style="display:flex; flex-direction:column; gap:.5rem; margin-bottom:1rem;">' +
            '<label style="display:flex; align-items:center; gap:.55rem; font-size:.86rem; color:var(--ink-soft); cursor:pointer;"><input id="adminWhRequiresBiz" type="checkbox"' + (item.requires_business_membership ? ' checked' : '') + ' style="accent-color:var(--accent); width:16px; height:16px;">사업자 회원 필요</label>' +
            '<label style="display:flex; align-items:center; gap:.55rem; font-size:.86rem; color:var(--ink-soft); cursor:pointer;"><input id="adminWhAllowsSmallQty" type="checkbox"' + (item.allows_small_quantity ? ' checked' : '') + ' style="accent-color:var(--accent); width:16px; height:16px;">소량 주문 가능</label>' +
            '<label style="display:flex; align-items:center; gap:.55rem; font-size:.86rem; color:var(--ink-soft); cursor:pointer;"><input id="adminWhAllowsDropship" type="checkbox"' + (item.allows_dropshipping ? ' checked' : '') + ' style="accent-color:var(--accent); width:16px; height:16px;">위탁배송 가능</label>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary" id="adminWhEditSubmit" style="justify-content:center; width:100%;">저장</button>' +
        '</form>' +
      '</div>';

    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleWholesalerModalEscape);
    document.getElementById('adminWhEditBackdrop').addEventListener('click', closeWholesalerEditModal);
    document.getElementById('adminWhEditClose').addEventListener('click', closeWholesalerEditModal);

    document.getElementById('adminWhEditForm').addEventListener('submit', function(e){
      e.preventDefault();

      var name = document.getElementById('adminWhName').value.trim();
      var normalizedUrl = normalizeUrl(document.getElementById('adminWhUrl').value);
      var category = document.getElementById('adminWhCategory').value;
      var summary = document.getElementById('adminWhSummary').value.trim();
      var isValidCategory = window.launchdeskWholesalers && window.launchdeskWholesalers.isValidCategory;

      if(!name || !summary || !category || (isValidCategory && !isValidCategory(category))){
        showToast('필수 항목을 모두 올바르게 입력해주세요.', 'error');
        return;
      }
      if(!normalizedUrl){
        showToast('올바른 사이트 주소를 입력해주세요.', 'error');
        return;
      }

      var payload = {
        name: name,
        url: normalizedUrl,
        category: category,
        summary: summary,
        main_products: document.getElementById('adminWhMainProducts').value.trim() || null,
        min_order_condition: document.getElementById('adminWhMinOrder').value.trim() || null,
        requires_business_membership: document.getElementById('adminWhRequiresBiz').checked,
        allows_small_quantity: document.getElementById('adminWhAllowsSmallQty').checked,
        allows_dropshipping: document.getElementById('adminWhAllowsDropship').checked
      };

      var submitBtn = document.getElementById('adminWhEditSubmit');
      submitBtn.disabled = true;
      updateWholesaler(item.id, payload).then(function(res){
        if(res.ok){
          showToast('수정되었습니다.', 'success');
          closeWholesalerEditModal();
          loadWholesalerList(sectionContainer);
          return;
        }
        submitBtn.disabled = false;
        showToast(friendlyAdminActionError(res.error) || '수정에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
      });
    });
  }

  // =========================================================================
  // "세팅 대행 문의" — 목록/필터/상세/상태 변경
  // =========================================================================
  // 기존 세팅 대행 신청 폼(setup.js)에는 이메일 필드가 없다 — "연락처"는
  // 전화번호(phone)다. 관리자 목록/상세에도 실제 존재하는 필드만 보여준다
  // (없는 필드를 억지로 만들지 않음).
  var SETUP_INQUIRY_FILTERS = [
    { key: 'pending',     label: '접수' },
    { key: 'in_progress', label: '진행중' },
    { key: 'completed',   label: '완료' },
    { key: 'rejected',    label: '보류' },
    { key: 'all',         label: '전체' }
  ];
  var SETUP_INQUIRY_STATUS_LABELS = { pending: '접수', in_progress: '진행중', completed: '완료', rejected: '보류' };

  var setupInquiryFilter = 'pending'; // 기본값: 접수
  var setupInquiryItems = null;
  var setupInquiryLoadSeq = 0;

  // 일반 사용자는 본인이 로그인 상태로 제출한 행만 보는 것과 달리, 이건
  // 관리자 전용 조회다 — RLS의 setup_inquiries_select_admin 정책
  // (is_admin())이 관리자에게만 전체(비로그인 제출 포함)를 보여준다.
  function fetchSetupInquiries(statusFilter){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    var q = sb.from('setup_inquiries')
      .select('id, user_id, plan_key, plan_name, plan_price, name, phone, platform, note, status, admin_note, created_at')
      .order('created_at', { ascending: false });
    if(statusFilter && statusFilter !== 'all') q = q.eq('status', statusFilter);
    return q.then(function(res){
      if(res.error) return { ok: false, error: res.error.message };
      return { ok: true, data: res.data || [] };
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  function fetchPendingSetupInquiryCount(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    return sb.from('setup_inquiries').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, count: res.count || 0 };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  // 브라우저는 setup_inquiries에 대한 UPDATE 권한이 없다 — 이 RPC
  // 호출만이 유일한 상태 변경 경로이고, 실제 쓰기는 함수 내부(SECURITY
  // DEFINER, 관리자 재확인 포함)에서 일어난다.
  function setSetupInquiryStatus(id, status, note){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('set_setup_inquiry_status', { p_inquiry_id: id, p_status: status, p_admin_note: note || null })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function renderSetupInquiriesSection(container){
    container.innerHTML =
      '<div class="admin-panel-head">세팅 대행 문의</div>' +
      '<div class="admin-panel-body">' +
        '<div class="admin-filter-tab-row" id="adminSetupInqFilterTabs">' +
          SETUP_INQUIRY_FILTERS.map(function(f){
            return '<button type="button" class="admin-filter-tab' + (f.key === setupInquiryFilter ? ' active' : '') +
              '" data-filter="' + f.key + '">' + escapeHtml(f.label) + '</button>';
          }).join('') +
        '</div>' +
        '<div id="adminSetupInqListWrap"></div>' +
      '</div>';

    container.querySelector('#adminSetupInqFilterTabs').addEventListener('click', function(e){
      var btn = e.target.closest('.admin-filter-tab');
      if(!btn) return;
      var key = btn.getAttribute('data-filter');
      if(key === setupInquiryFilter) return;
      setupInquiryFilter = key;
      container.querySelectorAll('#adminSetupInqFilterTabs .admin-filter-tab').forEach(function(b){
        b.classList.toggle('active', b === btn);
      });
      loadSetupInquiryList(container);
    });

    loadSetupInquiryList(container);
  }

  function loadSetupInquiryList(container){
    var listWrap = container.querySelector('#adminSetupInqListWrap');
    if(!listWrap) return;
    listWrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++setupInquiryLoadSeq;
    fetchSetupInquiries(setupInquiryFilter).then(function(res){
      if(seq !== setupInquiryLoadSeq) return; // 그 사이 필터가 바뀌었으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      if(!res.ok){
        listWrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;">' +
          '<p>문의 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminSetupInqRetryBtn">다시 시도</button></div>';
        var retryBtn = listWrap.querySelector('#adminSetupInqRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadSetupInquiryList(container); });
        return;
      }
      setupInquiryItems = res.data;
      renderSetupInquiryTable(container, listWrap);
    });
  }

  function renderSetupInquiryTable(container, listWrap){
    if(setupInquiryItems.length === 0){
      var emptyText = setupInquiryFilter === 'pending' ? '접수 대기 중인 문의가 없습니다.'
        : setupInquiryFilter === 'in_progress' ? '진행중인 문의가 없습니다.'
        : setupInquiryFilter === 'completed' ? '완료된 문의가 없습니다.'
        : setupInquiryFilter === 'rejected' ? '보류된 문의가 없습니다.'
        : '등록된 문의가 없습니다.';
      listWrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>' + escapeHtml(emptyText) + '</p></div>';
      return;
    }

    listWrap.innerHTML = '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>신청자</th><th>연락처</th><th>신청 플랜</th><th>신청일</th><th>상태</th><th></th></tr></thead>' +
      '<tbody>' +
        setupInquiryItems.map(function(item){
          return '<tr>' +
            '<td><strong>' + escapeHtml(item.name) + '</strong></td>' +
            '<td>' + escapeHtml(item.phone) + '</td>' +
            '<td>' + escapeHtml(item.plan_name) + '</td>' +
            '<td>' + escapeHtml(formatDate(item.created_at)) + '</td>' +
            '<td>' + escapeHtml(SETUP_INQUIRY_STATUS_LABELS[item.status] || item.status) + '</td>' +
            '<td><button type="button" class="btn btn-ghost btn-sm admin-setup-inq-detail-btn" data-id="' + escapeHtml(item.id) + '">상세보기</button></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';

    listWrap.querySelectorAll('.admin-setup-inq-detail-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-id');
        var item = setupInquiryItems.filter(function(it){ return String(it.id) === id; })[0];
        if(item) openSetupInquiryDetailModal(item, container);
      });
    });
  }

  function closeSetupInquiryDetailModal(){
    var el = document.getElementById('adminSetupInqDetailModal');
    if(el) el.remove();
    document.removeEventListener('keydown', handleSetupInquiryModalEscape);
  }
  function handleSetupInquiryModalEscape(e){
    if(e.key === 'Escape') closeSetupInquiryDetailModal();
  }

  function openSetupInquiryDetailModal(item, sectionContainer){
    closeSetupInquiryDetailModal();

    function row(label, valueHtml){
      return '<div style="margin-bottom:.9rem;">' +
        '<div style="font-size:.78rem; font-weight:700; color:var(--ink-soft); margin-bottom:.25rem;">' + escapeHtml(label) + '</div>' +
        '<div style="font-size:.9rem; color:var(--ink); word-break:break-word;">' + valueHtml + '</div>' +
      '</div>';
    }

    var statusOptions = SETUP_INQUIRY_FILTERS.filter(function(f){ return f.key !== 'all'; }).map(function(f){
      return '<option value="' + f.key + '"' + (f.key === item.status ? ' selected' : '') + '>' + escapeHtml(f.label) + '</option>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'adminSetupInqDetailModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="modal-backdrop" id="adminSetupInqDetailBackdrop"></div>' +
      '<div class="modal-panel" style="max-width:480px; text-align:left; max-height:85vh; overflow-y:auto;">' +
        '<button class="modal-close" type="button" id="adminSetupInqDetailClose" aria-label="닫기">✕</button>' +
        '<div class="modal-head" style="text-align:left;"><h2>' + escapeHtml(item.name) + '</h2></div>' +
        row('신청 플랜', escapeHtml(item.plan_name) + ' (₩' + Number(item.plan_price || 0).toLocaleString('ko-KR') + '원)') +
        row('연락처', escapeHtml(item.phone)) +
        (item.platform ? row('쇼핑몰 플랫폼', escapeHtml(item.platform)) : '') +
        (item.note ? row('세팅 요청 사항', escapeHtml(item.note)) : '') +
        row('신청 경로', item.user_id ? '로그인 상태로 신청' : '비로그인으로 신청') +
        row('신청일', escapeHtml(formatDate(item.created_at))) +
        row('현재 상태', escapeHtml(SETUP_INQUIRY_STATUS_LABELS[item.status] || item.status)) +
        '<div style="margin-top:1.2rem; padding-top:1.1rem; border-top:1px solid var(--border);">' +
          '<div class="ws-field" style="margin-bottom:.8rem;"><label for="adminSetupInqStatusSelect">상태 변경</label>' +
            '<select id="adminSetupInqStatusSelect" style="border:1px solid var(--border-strong); border-radius:8px; background:var(--bg); padding:.6rem .8rem; font-family:var(--f-body); font-size:.88rem; color:var(--ink); width:100%;">' + statusOptions + '</select>' +
          '</div>' +
          '<div class="ws-field" style="margin-bottom:.8rem;"><label for="adminSetupInqAdminNote">관리자 메모(내부용, 신청자에게 보이지 않음)</label>' +
            '<textarea id="adminSetupInqAdminNote" rows="3" placeholder="예: 전화 완료 / 견적 전달 / 고객 회신 대기">' + escapeHtml(item.admin_note || '') + '</textarea>' +
          '</div>' +
          '<button type="button" class="btn btn-primary" id="adminSetupInqSaveBtn" style="justify-content:center; width:100%;">저장</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleSetupInquiryModalEscape);
    document.getElementById('adminSetupInqDetailBackdrop').addEventListener('click', closeSetupInquiryDetailModal);
    document.getElementById('adminSetupInqDetailClose').addEventListener('click', closeSetupInquiryDetailModal);

    document.getElementById('adminSetupInqSaveBtn').addEventListener('click', function(){
      var saveBtn = document.getElementById('adminSetupInqSaveBtn');
      var status = document.getElementById('adminSetupInqStatusSelect').value;
      // 메모칸이 비어 있으면 null을 보낸다 — RPC가 null은 "기존 메모
      // 유지"로 처리하므로(coalesce), 빈칸으로 뒀다고 기존 메모가
      // 지워지지 않는다. 메모를 실제로 남기고 싶으면 내용을 입력한다.
      var note = document.getElementById('adminSetupInqAdminNote').value.trim() || null;
      saveBtn.disabled = true;
      setSetupInquiryStatus(item.id, status, note).then(function(res){
        if(res.ok){
          showToast('저장되었습니다.', 'success');
          closeSetupInquiryDetailModal();
          loadSetupInquiryList(sectionContainer);
          return;
        }
        saveBtn.disabled = false;
        showToast(friendlyAdminActionError(res.error) || '저장에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
      });
    });
  }

  // =========================================================================
  // "회원" — auth.users + admin_users + stores/connected_accounts 집계
  // 현황(읽기 전용). 브라우저는 auth.users를 직접 조회할 수 없으므로,
  // 목록/개수 모두 SECURITY DEFINER RPC(admin_list_members / admin_member_count,
  // 20260915240000_admin_members.sql)를 통해서만 가져온다 — 이 파일은
  // 그 RPC가 반환하는 안전한 컬럼(이메일/가입일/최근 로그인/집계값)만
  // 다룰 뿐, auth.users의 원래 컬럼 이름이나 비밀번호/토큰류는 여기
  // 어디에도 없다. profiles는 실존 여부 자체가 불확실해(파일 상단 조사
  // 결과 참고) 이번 단계에서도 전혀 참조하지 않는다.
  // =========================================================================
  var MEMBER_FILTERS = [
    { key: 'all',     label: '전체' },
    { key: 'stores',  label: '쇼핑몰 등록' },
    { key: 'cafe24',  label: 'Cafe24 연결' },
    { key: 'meta',    label: 'Meta 연결' },
    { key: 'admin',   label: '관리자' }
  ];

  var memberAdminItems = null; // admin_list_members() 결과 전체(관리자 RLS 아님 — RPC 자체가 관리자 재확인)
  var memberAdminLoadSeq = 0;
  var memberAdminFilter = 'all';
  var memberAdminSearchTerm = '';

  // admin_member_count()는 대시보드 KPI 전용 — 목록을 전부 내려받지 않고
  // 정수 하나만 받는다(다른 KPI 카드가 count:'exact', head:true로 가볍게
  // 세는 것과 같은 의도, auth.users는 PostgREST 대상이 아니라서 RPC로
  // 대신한다).
  function fetchMemberCount(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    return sb.rpc('admin_member_count')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, count: Number(res.data) || 0 };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  // 회원 섹션 목록 전용 — 이메일/가입일/최근 로그인/관리자 여부/쇼핑몰·
  // Cafe24·Meta 집계까지 RPC 한 번으로 전부 받는다(N+1 없음). Beta 규모
  // (회원 100~1000명)에서는 검색/필터를 서버 파라미터로 나누지 않고,
  // 이 결과를 한 번만 받아 클라이언트 메모리에서 처리한다 — 쇼핑몰
  // 섹션(fetchAllStoresForAdmin)과 동일한 판단.
  function fetchAllMembersForAdmin(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('admin_list_members')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, data: res.data || [] };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function renderMembersSection(container){
    container.innerHTML =
      '<div class="admin-panel-head">회원</div>' +
      '<div class="admin-panel-body">' +
        '<input type="text" id="adminMemberSearchInput" placeholder="이메일 검색" ' +
          'style="width:100%; box-sizing:border-box; margin-bottom:1rem; border:1px solid var(--border-strong); border-radius:8px; background:var(--bg); padding:.6rem .8rem; font-family:var(--f-body); font-size:.86rem; color:var(--ink);">' +
        '<div class="admin-filter-tab-row" id="adminMemberFilterTabs">' +
          MEMBER_FILTERS.map(function(f){
            return '<button type="button" class="admin-filter-tab' + (f.key === memberAdminFilter ? ' active' : '') + '" data-filter="' + f.key + '">' + escapeHtml(f.label) + '</button>';
          }).join('') +
        '</div>' +
        '<div id="adminMemberListWrap"></div>' +
      '</div>';

    container.querySelector('#adminMemberFilterTabs').addEventListener('click', function(e){
      var btn = e.target.closest('.admin-filter-tab');
      if(!btn) return;
      memberAdminFilter = btn.getAttribute('data-filter');
      container.querySelectorAll('#adminMemberFilterTabs .admin-filter-tab').forEach(function(b){ b.classList.toggle('active', b === btn); });
      renderMemberAdminTable(container, container.querySelector('#adminMemberListWrap'));
    });
    var searchInput = container.querySelector('#adminMemberSearchInput');
    var searchDebounceTimer = null;
    searchInput.addEventListener('input', function(){
      clearTimeout(searchDebounceTimer);
      var value = searchInput.value;
      searchDebounceTimer = setTimeout(function(){
        memberAdminSearchTerm = value.trim();
        renderMemberAdminTable(container, container.querySelector('#adminMemberListWrap'));
      }, 200);
    });

    loadMemberAdminData(container);
  }

  function loadMemberAdminData(container){
    var wrap = container.querySelector('#adminMemberListWrap');
    if(!wrap) return;
    wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++memberAdminLoadSeq;
    fetchAllMembersForAdmin().then(function(res){
      if(seq !== memberAdminLoadSeq) return; // 그 사이 새 요청이 시작됐으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      if(!res.ok){
        // 0건(정상)과 조회 실패(에러)를 반드시 구분한다.
        wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;">' +
          '<p>회원 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminMemberRetryBtn">다시 시도</button></div>';
        var retryBtn = wrap.querySelector('#adminMemberRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadMemberAdminData(container); });
        return;
      }
      memberAdminItems = res.data;
      renderMemberAdminTable(container, wrap);
    }).catch(function(err){
      if(seq !== memberAdminLoadSeq) return;
      console.warn('[launchdesk] 관리자 회원 목록 조회 중 오류:', err && err.message);
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>회원 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p></div>';
    });
  }

  function renderMemberAdminTable(container, wrap){
    if(!wrap || memberAdminItems == null) return;

    if(memberAdminItems.length === 0){
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>가입한 회원이 없습니다.</p></div>';
      return;
    }

    var term = memberAdminSearchTerm.toLowerCase();
    var filtered = memberAdminItems.filter(function(m){
      if(memberAdminFilter === 'stores' && !(Number(m.store_count) > 0)) return false;
      if(memberAdminFilter === 'cafe24' && !(Number(m.cafe24_count) > 0)) return false;
      if(memberAdminFilter === 'meta' && !(Number(m.meta_count) > 0)) return false;
      if(memberAdminFilter === 'admin' && !m.is_admin) return false;
      if(term){
        var hay = String(m.email || '').toLowerCase();
        if(hay.indexOf(term) === -1) return false;
      }
      return true;
    });

    if(filtered.length === 0){
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>검색/필터 결과가 없습니다.</p></div>';
      return;
    }

    wrap.innerHTML = '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>이메일</th><th>가입일</th><th>최근 로그인</th><th>쇼핑몰</th><th>Cafe24</th><th>Meta</th><th>관리자</th><th></th></tr></thead>' +
      '<tbody>' +
        filtered.map(function(m){
          return '<tr>' +
            '<td>' + escapeHtml(m.email || '-') + '</td>' +
            '<td>' + escapeHtml(formatDate(m.created_at)) + '</td>' +
            '<td>' + escapeHtml(formatDateTime(m.last_sign_in_at)) + '</td>' +
            '<td>' + Number(m.store_count || 0) + '</td>' +
            '<td>' + Number(m.cafe24_count || 0) + '</td>' +
            '<td>' + Number(m.meta_count || 0) + '</td>' +
            '<td>' + (m.is_admin ? '예' : '-') + '</td>' +
            '<td><button type="button" class="btn btn-ghost btn-sm admin-member-detail-btn" data-id="' + escapeHtml(m.user_id) + '">상세보기</button></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';

    wrap.querySelectorAll('.admin-member-detail-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var member = memberAdminItems.filter(function(m){ return String(m.user_id) === btn.getAttribute('data-id'); })[0];
        if(member) openMemberDetailModal(member);
      });
    });
  }

  function closeMemberDetailModal(){
    var el = document.getElementById('adminMemberDetailModal');
    if(el) el.remove();
    document.removeEventListener('keydown', handleMemberModalEscape);
  }
  function handleMemberModalEscape(e){
    if(e.key === 'Escape') closeMemberDetailModal();
  }

  // 회원 상세는 이 회원의 stores/connected_accounts까지 조회해 플랫폼/URL과
  // 연동 상태를 보여준다 — 관리자는 stores_select_admin/connected_accounts_select_admin
  // RLS 정책(is_admin())으로 전체 회원의 행을 볼 수 있으므로, 목록 RPC를
  // 다시 부르지 않고 이 두 테이블만 user_id로 좁혀서 조회한다(상세보기를
  // 누를 때만, 목록에는 없던 요청이라 N+1이 아니다). integration_credentials는
  // 여기서도 조회하지 않는다 — 토큰/시크릿은 이 화면의 범위 밖이다.
  function fetchStoresForMember(userId){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.from('stores')
      .select('id, name, platform, store_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, data: res.data || [] };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }
  function fetchConnectedAccountsForStoreIds(storeIds){
    var sb = client();
    if(!sb || !storeIds.length) return Promise.resolve({ ok: true, data: [] });
    return sb.from('connected_accounts')
      .select('id, store_id, provider, status, external_account_id, display_name, last_synced_at')
      .in('store_id', storeIds)
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, data: res.data || [] };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function openMemberDetailModal(member){
    closeMemberDetailModal();

    function row(label, valueHtml){
      return '<div style="margin-bottom:.9rem;">' +
        '<div style="font-size:.78rem; font-weight:700; color:var(--ink-soft); margin-bottom:.25rem;">' + escapeHtml(label) + '</div>' +
        '<div style="font-size:.9rem; color:var(--ink); word-break:break-word;">' + valueHtml + '</div>' +
      '</div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'adminMemberDetailModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="modal-backdrop" id="adminMemberDetailBackdrop"></div>' +
      '<div class="modal-panel" style="max-width:520px; text-align:left; max-height:85vh; overflow-y:auto;">' +
        '<button class="modal-close" type="button" id="adminMemberDetailClose" aria-label="닫기">✕</button>' +
        '<div class="modal-head" style="text-align:left;"><h2>' + escapeHtml(member.email || '-') + '</h2></div>' +
        row('user_id', escapeHtml(member.user_id || '-')) +
        row('가입일', escapeHtml(formatDateTime(member.created_at))) +
        row('최근 로그인', escapeHtml(formatDateTime(member.last_sign_in_at))) +
        row('관리자 여부', member.is_admin ? '예' : '아니요') +
        '<div style="margin-bottom:.9rem;">' +
          '<div style="font-size:.78rem; font-weight:700; color:var(--ink-soft); margin-bottom:.4rem;">등록 쇼핑몰</div>' +
          '<div id="adminMemberStoresWrap" style="font-size:.86rem; color:var(--ink-soft);">불러오는 중…</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleMemberModalEscape);
    document.getElementById('adminMemberDetailBackdrop').addEventListener('click', closeMemberDetailModal);
    document.getElementById('adminMemberDetailClose').addEventListener('click', closeMemberDetailModal);

    var storesWrap = document.getElementById('adminMemberStoresWrap');
    fetchStoresForMember(member.user_id).then(function(storesRes){
      if(!storesWrap || !storesWrap.isConnected) return; // 그 사이 모달이 닫혔으면 반영하지 않음
      if(!storesRes.ok){
        storesWrap.textContent = '쇼핑몰 목록을 불러오지 못했습니다.';
        return;
      }
      var stores = storesRes.data;
      if(stores.length === 0){
        storesWrap.textContent = '등록된 쇼핑몰이 없습니다.';
        return;
      }
      return fetchConnectedAccountsForStoreIds(stores.map(function(s){ return s.id; })).then(function(connRes){
        if(!storesWrap || !storesWrap.isConnected) return;
        var connMap = {};
        if(connRes.ok){
          connRes.data.forEach(function(r){
            var sid = String(r.store_id);
            if(!connMap[sid]) connMap[sid] = {};
            connMap[sid][r.provider] = r;
          });
        }
        storesWrap.innerHTML = stores.map(function(s){
          var conn = connMap[String(s.id)] || {};
          var cafe24 = connectionStatusFor(conn, 'cafe24');
          var meta = connectionStatusFor(conn, 'meta');
          var href = safeHref(s.store_url);
          var urlHtml = href
            ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.store_url) + '</a>'
            : escapeHtml(s.store_url);
          return '<div style="padding:.6rem 0; border-bottom:1px solid var(--border);">' +
            '<div style="color:var(--ink); font-weight:600;">' + escapeHtml(s.name) + ' <span style="font-weight:400; color:var(--ink-soft);">(' + escapeHtml(platformLabelFor(s.platform)) + ')</span></div>' +
            '<div style="margin-top:.2rem;">' + urlHtml + '</div>' +
            '<div style="margin-top:.2rem; color:var(--ink-soft);">Cafe24 ' + escapeHtml(cafe24.label) + ' · Meta ' + escapeHtml(meta.label) + '</div>' +
          '</div>';
        }).join('');
      });
    }).catch(function(err){
      if(!storesWrap || !storesWrap.isConnected) return;
      console.warn('[launchdesk] 회원 상세 쇼핑몰 조회 중 오류:', err && err.message);
      storesWrap.textContent = '쇼핑몰 목록을 불러오지 못했습니다.';
    });
  }

  // =========================================================================
  // "쇼핑몰" — 전체 stores + connected_accounts 운영 현황(읽기 전용)
  // =========================================================================
  // stores.js와 동일한 값(각자 다른 최상위 IIFE라 공유 불가, 의도적 중복 —
  // 이미 확립된 패턴). storeFormModal의 <option>과도 일치한다.
  var STORE_PLATFORM_LABELS = { cafe24: 'Cafe24', smartstore: '스마트스토어', other: '기타' };
  function platformLabelFor(value){ return STORE_PLATFORM_LABELS[value] || value; }

  // user_id 전체를 목록에 그대로 늘어놓지 않고 축약해서 보여준다 — 값
  // 자체를 숨겨야 할 만큼 민감하진 않지만(그냥 uuid), 목록 가독성을 위해.
  // 상세보기에서는 전체 값을 그대로 보여준다.
  function shortId(id){
    var s = String(id == null ? '' : id);
    return s.length > 8 ? s.slice(0, 8) + '…' : (s || '-');
  }

  // connected_accounts.status로 실제 코드에 저장되는 값은 'connected'와
  // 'pending'(Meta의 광고계정 선택 대기) 두 가지뿐이다 — 'error' 같은
  // 세 번째 상태는 DB에 저장되지 않는다(조사 결과, 마이그레이션 파일
  // 상단 주석 참고). 그래서 "오류" 라벨은 만들지 않는다 — 모르는 상태
  // 값이 나오면 있는 그대로(raw) 보여줄 뿐, 추측한 라벨을 지어내지 않는다.
  function connectionStatusFor(connByProvider, provider){
    var row = connByProvider && connByProvider[provider];
    if(!row) return { key: 'none', label: '연결 안 됨', row: null };
    if(row.status === 'connected') return { key: 'connected', label: '연결됨', row: row };
    if(row.status === 'pending') return { key: 'pending', label: '연결 진행중', row: row };
    return { key: row.status, label: row.status, row: row };
  }

  var storeAdminItems = null;    // stores 전체(관리자 RLS로 조회)
  var storeAdminConnMap = null;  // { [store_id]: { cafe24: row|null, meta: row|null } }
  var storeAdminLoadSeq = 0;
  var storeAdminPlatformFilter = 'all';
  var storeAdminConnectionFilter = 'all';
  var storeAdminSearchTerm = '';

  // 일반 사용자는 본인 소유 stores/connected_accounts만 보는 것과 달리,
  // 이건 관리자 전용 조회다 — RLS의 *_select_admin 정책(is_admin())이
  // 관리자에게만 전체를 보여준다. integration_credentials는 여기서도,
  // 다른 어디서도 조회하지 않는다.
  function fetchAllStoresForAdmin(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.from('stores')
      .select('id, user_id, name, platform, store_url, is_active, created_at')
      .order('created_at', { ascending: false })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, data: res.data || [] };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }
  function fetchAllConnectedAccountsForAdmin(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.from('connected_accounts')
      .select('id, store_id, provider, status, external_account_id, display_name, last_synced_at')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, data: res.data || [] };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }
  function fetchStoreCount(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    return sb.from('stores').select('id', { count: 'exact', head: true })
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, count: res.count || 0 };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }
  function fetchConnectedCountByProvider(provider){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false });
    return sb.from('connected_accounts').select('id', { count: 'exact', head: true })
      .eq('provider', provider).eq('status', 'connected')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        return { ok: true, count: res.count || 0 };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  var STORE_PLATFORM_FILTERS = [
    { key: 'all', label: '전체' }, { key: 'cafe24', label: 'Cafe24' },
    { key: 'smartstore', label: '스마트스토어' }, { key: 'other', label: '기타' }
  ];
  var STORE_CONNECTION_FILTERS = [
    { key: 'all', label: '전체' }, { key: 'cafe24_connected', label: 'Cafe24 연결' },
    { key: 'meta_connected', label: 'Meta 연결' }, { key: 'none', label: '연동 없음' }
  ];

  function renderStoresSection(container){
    container.innerHTML =
      '<div class="admin-panel-head">쇼핑몰</div>' +
      '<div class="admin-panel-body">' +
        '<input type="text" id="adminStoreSearchInput" placeholder="쇼핑몰명 또는 URL 검색" ' +
          'style="width:100%; box-sizing:border-box; margin-bottom:1rem; border:1px solid var(--border-strong); border-radius:8px; background:var(--bg); padding:.6rem .8rem; font-family:var(--f-body); font-size:.86rem; color:var(--ink);">' +
        '<div class="admin-filter-tab-row" id="adminStorePlatformTabs" style="margin-bottom:.6rem;">' +
          STORE_PLATFORM_FILTERS.map(function(f){
            return '<button type="button" class="admin-filter-tab' + (f.key === storeAdminPlatformFilter ? ' active' : '') + '" data-filter="' + f.key + '">' + escapeHtml(f.label) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="admin-filter-tab-row" id="adminStoreConnTabs">' +
          STORE_CONNECTION_FILTERS.map(function(f){
            return '<button type="button" class="admin-filter-tab' + (f.key === storeAdminConnectionFilter ? ' active' : '') + '" data-filter="' + f.key + '">' + escapeHtml(f.label) + '</button>';
          }).join('') +
        '</div>' +
        '<div id="adminStoreListWrap"></div>' +
      '</div>';

    container.querySelector('#adminStorePlatformTabs').addEventListener('click', function(e){
      var btn = e.target.closest('.admin-filter-tab');
      if(!btn) return;
      storeAdminPlatformFilter = btn.getAttribute('data-filter');
      container.querySelectorAll('#adminStorePlatformTabs .admin-filter-tab').forEach(function(b){ b.classList.toggle('active', b === btn); });
      renderStoreAdminTable(container, container.querySelector('#adminStoreListWrap'));
    });
    container.querySelector('#adminStoreConnTabs').addEventListener('click', function(e){
      var btn = e.target.closest('.admin-filter-tab');
      if(!btn) return;
      storeAdminConnectionFilter = btn.getAttribute('data-filter');
      container.querySelectorAll('#adminStoreConnTabs .admin-filter-tab').forEach(function(b){ b.classList.toggle('active', b === btn); });
      renderStoreAdminTable(container, container.querySelector('#adminStoreListWrap'));
    });
    var searchInput = container.querySelector('#adminStoreSearchInput');
    var searchDebounceTimer = null;
    searchInput.addEventListener('input', function(){
      clearTimeout(searchDebounceTimer);
      var value = searchInput.value;
      searchDebounceTimer = setTimeout(function(){
        storeAdminSearchTerm = value.trim();
        renderStoreAdminTable(container, container.querySelector('#adminStoreListWrap'));
      }, 200);
    });

    loadStoreAdminData(container);
  }

  function loadStoreAdminData(container){
    var wrap = container.querySelector('#adminStoreListWrap');
    if(!wrap) return;
    wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++storeAdminLoadSeq;
    Promise.all([fetchAllStoresForAdmin(), fetchAllConnectedAccountsForAdmin()]).then(function(results){
      if(seq !== storeAdminLoadSeq) return; // 그 사이 새 요청이 시작됐으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      var storesRes = results[0], connRes = results[1];
      if(!storesRes.ok || !connRes.ok){
        // 0건(정상)과 조회 실패(에러)를 반드시 구분한다.
        wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;">' +
          '<p>쇼핑몰 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminStoreRetryBtn">다시 시도</button></div>';
        var retryBtn = wrap.querySelector('#adminStoreRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadStoreAdminData(container); });
        return;
      }
      storeAdminItems = storesRes.data;
      storeAdminConnMap = {};
      connRes.data.forEach(function(row){
        var sid = String(row.store_id);
        if(!storeAdminConnMap[sid]) storeAdminConnMap[sid] = {};
        storeAdminConnMap[sid][row.provider] = row;
      });
      renderStoreAdminTable(container, wrap);
    }).catch(function(err){
      if(seq !== storeAdminLoadSeq) return;
      console.warn('[launchdesk] 관리자 쇼핑몰 목록 조회 중 오류:', err && err.message);
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>쇼핑몰 목록을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p></div>';
    });
  }

  function renderStoreAdminTable(container, wrap){
    if(!wrap || storeAdminItems == null) return;

    if(storeAdminItems.length === 0){
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>등록된 쇼핑몰이 없습니다.</p></div>';
      return;
    }

    var term = storeAdminSearchTerm.toLowerCase();
    var filtered = storeAdminItems.filter(function(s){
      if(storeAdminPlatformFilter !== 'all' && s.platform !== storeAdminPlatformFilter) return false;
      var conn = storeAdminConnMap[String(s.id)] || {};
      var cafe24Connected = !!(conn.cafe24 && conn.cafe24.status === 'connected');
      var metaConnected = !!(conn.meta && conn.meta.status === 'connected');
      if(storeAdminConnectionFilter === 'cafe24_connected' && !cafe24Connected) return false;
      if(storeAdminConnectionFilter === 'meta_connected' && !metaConnected) return false;
      if(storeAdminConnectionFilter === 'none' && (cafe24Connected || metaConnected)) return false;
      if(term){
        var hay = (String(s.name || '') + ' ' + String(s.store_url || '')).toLowerCase();
        if(hay.indexOf(term) === -1) return false;
      }
      return true;
    });

    if(filtered.length === 0){
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>검색/필터 결과가 없습니다.</p></div>';
      return;
    }

    wrap.innerHTML = '<div class="tbl-wrap"><table>' +
      '<thead><tr><th>쇼핑몰명</th><th>플랫폼</th><th>URL</th><th>소유자</th><th>Cafe24</th><th>Meta</th><th>등록일</th><th></th></tr></thead>' +
      '<tbody>' +
        filtered.map(function(s){
          var conn = storeAdminConnMap[String(s.id)] || {};
          var cafe24 = connectionStatusFor(conn, 'cafe24');
          var meta = connectionStatusFor(conn, 'meta');
          var href = safeHref(s.store_url);
          var urlHtml = href
            ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">바로가기 ↗</a>'
            : escapeHtml(s.store_url);
          return '<tr>' +
            '<td><strong>' + escapeHtml(s.name) + '</strong></td>' +
            '<td>' + escapeHtml(platformLabelFor(s.platform)) + '</td>' +
            '<td>' + urlHtml + '</td>' +
            '<td>' + escapeHtml(shortId(s.user_id)) + '</td>' +
            '<td>' + escapeHtml(cafe24.label) + '</td>' +
            '<td>' + escapeHtml(meta.label) + '</td>' +
            '<td>' + escapeHtml(formatDate(s.created_at)) + '</td>' +
            '<td><button type="button" class="btn btn-ghost btn-sm admin-store-detail-btn" data-id="' + escapeHtml(s.id) + '">상세보기</button></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';

    wrap.querySelectorAll('.admin-store-detail-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var store = storeAdminItems.filter(function(s){ return String(s.id) === btn.getAttribute('data-id'); })[0];
        if(store) openStoreDetailModal(store);
      });
    });
  }

  function closeStoreDetailModal(){
    var el = document.getElementById('adminStoreDetailModal');
    if(el) el.remove();
    document.removeEventListener('keydown', handleStoreModalEscape);
  }
  function handleStoreModalEscape(e){
    if(e.key === 'Escape') closeStoreDetailModal();
  }

  // 읽기 전용 상세 — 이번 단계에서는 수정/삭제/강제 재연결 버튼을 두지
  // 않는다(요구사항 10). access_token/refresh_token/app secret/OAuth
  // state/integration_credentials 내용은 애초에 이 파일이 조회하는 범위
  // 밖이라 표시할 수도 없다 — external_account_id/display_name/
  // last_synced_at 같은 안전한 메타데이터만 보여준다.
  function openStoreDetailModal(store){
    closeStoreDetailModal();

    var conn = storeAdminConnMap[String(store.id)] || {};
    var cafe24 = connectionStatusFor(conn, 'cafe24');
    var meta = connectionStatusFor(conn, 'meta');

    function row(label, valueHtml){
      return '<div style="margin-bottom:.9rem;">' +
        '<div style="font-size:.78rem; font-weight:700; color:var(--ink-soft); margin-bottom:.25rem;">' + escapeHtml(label) + '</div>' +
        '<div style="font-size:.9rem; color:var(--ink); word-break:break-word;">' + valueHtml + '</div>' +
      '</div>';
    }

    var href = safeHref(store.store_url);
    var urlHtml = href
      ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(store.store_url) + '</a>'
      : escapeHtml(store.store_url);

    var cafe24Detail = cafe24.label;
    if(cafe24.row && cafe24.row.last_synced_at) cafe24Detail += ' · 최근 동기화 ' + formatDate(cafe24.row.last_synced_at);
    var metaDetail = meta.label;
    if(meta.row && meta.row.display_name) metaDetail += ' · ' + meta.row.display_name;
    if(meta.row && meta.row.external_account_id) metaDetail += ' (' + meta.row.external_account_id + ')';

    var overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'adminStoreDetailModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="modal-backdrop" id="adminStoreDetailBackdrop"></div>' +
      '<div class="modal-panel" style="max-width:480px; text-align:left; max-height:85vh; overflow-y:auto;">' +
        '<button class="modal-close" type="button" id="adminStoreDetailClose" aria-label="닫기">✕</button>' +
        '<div class="modal-head" style="text-align:left;"><h2>' + escapeHtml(store.name) + '</h2></div>' +
        row('플랫폼', escapeHtml(platformLabelFor(store.platform))) +
        row('URL', urlHtml) +
        row('등록일', escapeHtml(formatDate(store.created_at))) +
        row('소유자(user_id)', escapeHtml(store.user_id || '-')) +
        row('Cafe24 연결', escapeHtml(cafe24Detail)) +
        row('Meta 연결', escapeHtml(metaDetail)) +
      '</div>';

    document.body.appendChild(overlay);
    document.addEventListener('keydown', handleStoreModalEscape);
    document.getElementById('adminStoreDetailBackdrop').addEventListener('click', closeStoreDetailModal);
    document.getElementById('adminStoreDetailClose').addEventListener('click', closeStoreDetailModal);
  }

  // =========================================================================
  // "Beta 사용자 현황" — 회원가입 → 쇼핑몰 등록 → Cafe24 연결 → Meta 연결
  // 퍼널(읽기 전용, 1차 범위). SECURITY DEFINER RPC(admin_beta_overview(),
  // 20260915260000_admin_beta_overview.sql) 하나로 지표 5개를 한 번에
  // 받는다 — auth.users/stores/connected_accounts를 브라우저에서 여러 번
  // 내려받아 직접 집계하지 않는다. 기존 관리자 대시보드 KPI
  // (DASHBOARD_LIVE_CARDS/loadDashboardStats)는 이 섹션과 완전히 무관하게
  // 그대로 유지되고, 이 섹션은 그 로직을 재사용하거나 중복하지 않는다 —
  // 별도 RPC/별도 상태를 쓰는 상세 분석 화면이다.
  //
  // 아직 구현하지 않은 지표 — 7일 재방문/dashboard_viewed/
  // meta_insights_viewed/roadmap_started·completed/UTM 전환율 — 은 이
  // 저장소 어디에도 저장하는 행동 이벤트 테이블이 없어서(GA4 gtag() 이벤트는
  // 브라우저에서 Google로만 전송되고 Supabase DB에 저장되지 않는다 —
  // docs/plans/beta-30-day-validation.md도 "실행 계획 문서, 코드는 아직
  // 이걸로 안 바뀜"이라고 스스로 명시) 화면에 만들지 않는다 — 가짜 0 대신
  // 안내 문구만 보여준다(아래 렌더 함수 마지막 블록).
  // =========================================================================
  var betaLoadSeq = 0;

  // 전체 회원 대비/직전 단계 대비 비율 — 분모가 0이면 NaN 대신 안전하게 0%.
  // 정수면 소수점을 붙이지 않고(예: "60%"), 아니면 소수 첫째 자리까지만
  // (예: "58.3%") — 요구사항 예시 표기와 동일한 형식.
  function formatBetaPercent(numerator, denominator){
    if(!denominator) return '0%';
    var rounded = Math.round((numerator / denominator) * 1000) / 10;
    return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + '%';
  }

  function fetchBetaOverview(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('admin_beta_overview')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if(!row) return { ok: false, error: 'EMPTY_RESULT' };
        return { ok: true, data: {
          totalUsers: Number(row.total_users) || 0,
          usersWithStore: Number(row.users_with_store) || 0,
          usersWithCafe24: Number(row.users_with_cafe24) || 0,
          // 순차 퍼널의 마지막 단계 — 정의상 usersWithCafe24의 부분집합
          // (같은 user_id가 Cafe24 status='connected'이면서 동시에 Meta
          // status='connected'). 이 보장 덕분에 "직전 단계 대비" 전환율이
          // 100%를 넘지 않는다.
          usersWithCafe24AndMeta: Number(row.users_with_cafe24_and_meta) || 0,
          // 순차 퍼널에는 쓰지 않는 독립 참고 지표 — Cafe24 연결 여부와
          // 무관하게 Meta를 연결한 모든 사용자(usersWithCafe24의 부분집합이
          // 아닐 수 있음).
          usersWithMeta: Number(row.users_with_meta) || 0,
          usersWithOrders: Number(row.users_with_orders) || 0
        } };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function renderBetaOverviewSection(container){
    container.innerHTML = '<div class="admin-panel-head">Beta 사용자 현황</div>' +
      '<div class="admin-panel-body">' +
        '<p style="margin:0 0 1.4rem; font-size:.86rem; color:var(--ink-soft);">현재까지의 사용자 활성화 단계입니다. 관리자 계정을 포함한 전체 회원 기준입니다(아래 "최근 사용 현황"은 관리자 계정을 제외합니다 — 모수가 서로 다릅니다).</p>' +
        '<div id="adminBetaWrap"></div>' +
        '<div style="margin-top:1.8rem; padding-top:1.6rem; border-top:1px solid var(--border);">' +
          '<div style="font-size:.92rem; font-weight:700; color:var(--ink); margin-bottom:.3rem;">최근 사용 현황</div>' +
          '<p style="margin:0 0 1.1rem; font-size:.8rem; color:var(--ink-faint);">행동 데이터는 추적 기능 적용 이후부터 집계됩니다 — 아래 숫자는 LaunchDesk 출시 이후 전체 기간이 아니라 이 기능이 배포된 시점부터의 데이터입니다.</p>' +
          '<div id="adminBetaBehaviorWrap"></div>' +
        '</div>' +
      '</div>';
    loadBetaOverview(container);
    loadBetaBehaviorOverview(container);
  }

  function loadBetaOverview(container){
    var wrap = container.querySelector('#adminBetaWrap');
    if(!wrap) return;
    wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++betaLoadSeq;
    fetchBetaOverview().then(function(res){
      if(seq !== betaLoadSeq) return; // 그 사이 새 요청이 시작됐으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      if(!res.ok){
        wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;">' +
          '<p>Beta 사용자 현황을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminBetaRetryBtn">다시 시도</button></div>';
        var retryBtn = wrap.querySelector('#adminBetaRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadBetaOverview(container); });
        return;
      }
      renderBetaFunnel(wrap, res.data);
    }).catch(function(err){
      if(seq !== betaLoadSeq) return;
      console.warn('[launchdesk] Beta 사용자 현황 조회 중 오류:', err && err.message);
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>Beta 사용자 현황을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p></div>';
    });
  }

  function renderBetaFunnel(wrap, d){
    if(d.totalUsers === 0){
      wrap.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;"><p>아직 가입한 회원이 없습니다.</p></div>';
      return;
    }

    // 직전 단계 대비 전환율의 분모(prevCount)는 바로 앞 단계의 count다.
    // 회원가입은 퍼널의 시작점이라 직전 단계가 없다(prevCount: null).
    // 마지막 단계는 usersWithMeta가 아니라 usersWithCafe24AndMeta를 쓴다 —
    // usersWithMeta는 usersWithCafe24의 부분집합이라는 보장이 없어서(Cafe24
    // 없이 Meta만 연결한 사용자도 포함될 수 있음) 순차 퍼널에 그대로
    // 이어붙이면 "직전 단계 대비" 비율이 100%를 넘을 수 있다. usersWithMeta는
    // 아래 "참고 지표"에 독립적으로 남긴다.
    var stages = [
      { label: '회원가입',        count: d.totalUsers,           prevCount: null },
      { label: '쇼핑몰 등록',     count: d.usersWithStore,       prevCount: d.totalUsers },
      { label: 'Cafe24 연결',     count: d.usersWithCafe24,      prevCount: d.usersWithStore },
      { label: 'Cafe24 + Meta 연결', count: d.usersWithCafe24AndMeta, prevCount: d.usersWithCafe24 }
    ];

    var rowsHtml = stages.map(function(stage, i){
      var overallPct = formatBetaPercent(stage.count, d.totalUsers);
      var barWidth = Math.min(100, Math.round((d.totalUsers ? (stage.count / d.totalUsers) * 100 : 0) * 10) / 10);
      var prevHtml = stage.prevCount != null
        ? '<div style="margin-top:.3rem; font-size:.76rem; color:var(--ink-faint);">직전 단계 대비 ' + formatBetaPercent(stage.count, stage.prevCount) + '</div>'
        : '';
      var arrowHtml = i > 0
        ? '<div style="text-align:center; color:var(--ink-faint); font-size:.86rem; margin:.5rem 0;">↓</div>'
        : '';
      return arrowHtml +
        '<div>' +
          '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:.6rem; margin-bottom:.35rem; flex-wrap:wrap;">' +
            '<span style="font-size:.9rem; font-weight:700; color:var(--ink);">' + escapeHtml(stage.label) + '</span>' +
            '<span style="font-size:.86rem; color:var(--ink-soft);">' +
              '<b style="font-family:var(--f-mono); color:var(--ink);">' + Number(stage.count) + '명</b> · 전체 회원 대비 ' + overallPct +
            '</span>' +
          '</div>' +
          '<div style="height:8px; border-radius:99px; background:var(--border); overflow:hidden;">' +
            '<div style="height:100%; width:' + barWidth + '%; background:var(--accent); border-radius:99px;"></div>' +
          '</div>' +
          prevHtml +
        '</div>';
    }).join('');

    var ordersOverallPct = formatBetaPercent(d.usersWithOrders, d.totalUsers);
    var metaOverallPct = formatBetaPercent(d.usersWithMeta, d.totalUsers);

    wrap.innerHTML = rowsHtml +
      // "참고 지표" — 위 4단계 퍼널과 분리해서 보여준다(순차 퍼널의 부분집합
      // 보장이 없는 값들이라, 전환율 계산에는 쓰지 않고 전체 회원 대비
      // 숫자만 보여준다). Activation 수치가 아니라는 점을 문구로 명확히
      // 한다(요구사항 6 — 현재 DB로는 "실제 주문 데이터 확인"과 "orders
      // 존재"를 구분할 수 없어, Activation을 억지로 확정하지 않았다. 작업
      // 보고서 참고).
      '<div style="margin-top:1.8rem; padding-top:1.4rem; border-top:1px solid var(--border);">' +
        '<div style="font-size:.78rem; font-weight:700; color:var(--ink-soft); margin-bottom:.5rem;">참고 지표</div>' +
        '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:.6rem; flex-wrap:wrap;">' +
          '<span style="font-size:.88rem; color:var(--ink);">Meta 연결 사용자</span>' +
          '<span style="font-size:.86rem; color:var(--ink-soft);"><b style="font-family:var(--f-mono); color:var(--ink);">' + Number(d.usersWithMeta) + '명</b> · 전체 회원 대비 ' + metaOverallPct + '</span>' +
        '</div>' +
        '<p style="margin:.5rem 0 0; font-size:.76rem; color:var(--ink-faint);">Cafe24 연결 여부와 무관하게 Meta를 연결한 모든 사용자입니다 — 위 퍼널의 "Cafe24 + Meta 연결"(교집합)과는 다른 숫자입니다.</p>' +
        '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:.6rem; flex-wrap:wrap; margin-top:1rem;">' +
          '<span style="font-size:.88rem; color:var(--ink);">Cafe24 주문 데이터 동기화됨</span>' +
          '<span style="font-size:.86rem; color:var(--ink-soft);"><b style="font-family:var(--f-mono); color:var(--ink);">' + Number(d.usersWithOrders) + '명</b> · 전체 회원 대비 ' + ordersOverallPct + '</span>' +
        '</div>' +
        '<p style="margin:.5rem 0 0; font-size:.76rem; color:var(--ink-faint);">Cafe24 연결 여부와 무관하게, 해당 사용자의 쇼핑몰에 주문 데이터가 한 번이라도 동기화된 적이 있는지만 봅니다. "Activation" 지표는 아닙니다 — 사용자가 이 데이터를 실제로 확인했는지는 현재 데이터베이스 구조로는 판단할 수 없습니다.</p>' +
      '</div>';
  }

  // =========================================================================
  // "최근 사용 현황" — product_events(20260915280000_product_events.sql)
  // 기반 행동 지표. 위 renderBetaFunnel()의 캐노니컬 퍼널(가입/쇼핑몰/
  // Cafe24/Meta)과 완전히 분리된 별도 RPC(admin_beta_behavior_overview(),
  // 20260915300000_admin_beta_behavior.sql)·별도 상태를 쓴다 — 한쪽 조회가
  // 실패해도 다른 쪽 표시에 영향을 주지 않는다(그래서 두 로드 함수와 두
  // 재시도 버튼을 독립적으로 둔다).
  //
  // "최근 7일 대시보드 방문/반복 방문"은 dashboard_viewed 기준, "로드맵
  // 시작/완료"는 기간 제한 없는 누적 distinct 사용자 수다(요구사항 8·9).
  // 반복 방문율은 admin_beta_overview()와 동일하게 formatBetaPercent()로
  // 클라이언트에서 계산한다(반올림/표기 규칙을 한 곳에만 둔다).
  // =========================================================================
  var betaBehaviorLoadSeq = 0;

  function fetchBetaBehaviorOverview(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    return sb.rpc('admin_beta_behavior_overview')
      .then(function(res){
        if(res.error) return { ok: false, error: res.error.message };
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if(!row) return { ok: false, error: 'EMPTY_RESULT' };
        return { ok: true, data: {
          dashboardUsers7d: Number(row.dashboard_users_7d) || 0,
          dashboardReturningUsers7d: Number(row.dashboard_returning_users_7d) || 0,
          roadmapStartedUsers: Number(row.roadmap_started_users) || 0,
          roadmapCompletedUsers: Number(row.roadmap_completed_users) || 0
        } };
      }).catch(function(err){
        return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
      });
  }

  function loadBetaBehaviorOverview(container){
    var wrap = container.querySelector('#adminBetaBehaviorWrap');
    if(!wrap) return;
    wrap.innerHTML = '<div class="empty-state" style="padding:1.6rem 1rem;"><p>불러오는 중…</p></div>';
    var seq = ++betaBehaviorLoadSeq;
    fetchBetaBehaviorOverview().then(function(res){
      if(seq !== betaBehaviorLoadSeq) return; // 그 사이 새 요청이 시작됐으면 이 응답은 버림
      if(!container.isConnected) return; // 그 사이 다른 메뉴로 전환했으면 반영하지 않음
      if(!res.ok){
        wrap.innerHTML = '<div class="empty-state" style="padding:1.6rem 1rem;">' +
          '<p>최근 사용 현황을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="adminBetaBehaviorRetryBtn">다시 시도</button></div>';
        var retryBtn = wrap.querySelector('#adminBetaBehaviorRetryBtn');
        if(retryBtn) retryBtn.addEventListener('click', function(){ loadBetaBehaviorOverview(container); });
        return;
      }
      renderBetaBehaviorRows(wrap, res.data);
    }).catch(function(err){
      if(seq !== betaBehaviorLoadSeq) return;
      console.warn('[launchdesk] 최근 사용 현황 조회 중 오류:', err && err.message);
      wrap.innerHTML = '<div class="empty-state" style="padding:1.6rem 1rem;"><p>최근 사용 현황을 불러오지 못했습니다.<br>잠시 후 다시 시도해주세요.</p></div>';
    });
  }

  function renderBetaBehaviorRows(wrap, d){
    var returnRate = formatBetaPercent(d.dashboardReturningUsers7d, d.dashboardUsers7d);
    var rows = [
      { label: '최근 7일 대시보드 방문', value: d.dashboardUsers7d + '명' },
      { label: '최근 7일 반복 방문', value: d.dashboardReturningUsers7d + '명' },
      { label: '반복 방문율', value: returnRate },
      { label: '로드맵 시작', value: d.roadmapStartedUsers + '명' },
      { label: '로드맵 완료', value: d.roadmapCompletedUsers + '명' }
    ];
    wrap.innerHTML = rows.map(function(row, i){
      return '<div style="display:flex; align-items:baseline; justify-content:space-between; gap:.6rem; flex-wrap:wrap;' +
          (i > 0 ? ' margin-top:.85rem; padding-top:.85rem; border-top:1px solid var(--border);' : '') + '">' +
        '<span style="font-size:.88rem; color:var(--ink);">' + escapeHtml(row.label) + '</span>' +
        '<span style="font-family:var(--f-mono); font-size:.94rem; font-weight:700; color:var(--ink);">' + escapeHtml(row.value) + '</span>' +
      '</div>';
    }).join('') +
      '<p style="margin:1.1rem 0 0; font-size:.76rem; color:var(--ink-faint);">"대시보드 방문"은 운영 도구(/tools) 화면 진입 기준이며, 쇼핑몰·Cafe24 연결 여부와 무관합니다. "반복 방문"은 최근 7일 동안 서로 다른 날짜(한국 시간 기준)에 대시보드를 2일 이상 확인한 사용자입니다 — 가입 후 정확히 7일째 재방문했는지를 보는 코호트 지표(D7 retention)와는 다릅니다. "로드맵 시작/완료"는 기간 제한 없는 누적 인원입니다. 위 5개 지표 모두 관리자 계정은 제외됩니다.</p>';
  }

  // ------------------------------------------------------------------ 관리자 여부 판별(공유)
  // 사이드바 링크 노출 여부와 #/admin 페이지 접근 제어가 정확히 같은
  // 판별 결과를 쓰도록, "지금 로그인된 사용자가 관리자인가"를 한 곳에서만
  // 계산한다. 같은 user_id에 대해서는 admin_users를 다시 조회하지 않고
  // 캐시된 Promise를 재사용한다(사이드바 갱신과 #/admin 페이지 갱신이
  // 같은 타이밍(로그인 직후 등)에 겹쳐도 조회가 중복되지 않는다).
  var adminStatusUserId = null; // 이 결과가 어느 user_id에 대한 것인지
  var adminStatusPromise = null;
  function getIsAdminForUser(userId){
    if(!userId) return Promise.resolve(false);
    if(adminStatusUserId === userId && adminStatusPromise) return adminStatusPromise;
    adminStatusUserId = userId;
    var sb = client();
    if(!sb){ adminStatusPromise = Promise.resolve(false); return adminStatusPromise; }
    // 관리자 여부는 이메일 비교가 아니라 admin_users 테이블 조회 결과
    // (RLS: 본인 행만 조회 가능)로만 판단한다. 행이 있으면 관리자,
    // 없으면(또는 조회 자체가 실패하면) 관리자 아님으로 취급한다 —
    // 애매한 경우 관리자 쪽으로 fail-open하지 않는다.
    adminStatusPromise = sb.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle()
      .then(function(res){
        if(res.error){
          console.warn('[launchdesk] 관리자 권한 확인 실패:', res.error.message);
          return false;
        }
        return !!res.data;
      })
      .catch(function(err){
        console.warn('[launchdesk] 관리자 권한 확인 중 오류:', err && err.message);
        return false;
      });
    return adminStatusPromise;
  }

  function isAdminRoute(){
    return (location.hash.replace(/^#/, '') || '/') === '/admin';
  }

  var sidebarLink = document.getElementById('adminSidebarLink');
  function setSidebarLinkVisible(visible){
    if(sidebarLink) sidebarLink.hidden = !visible;
  }

  // seq: 로그인/로그아웃이 빠르게 이어지거나 hashchange가 겹쳐도, 가장
  // 마지막 확인 요청의 결과만 반영한다(stores.js/wholesalers.js와 동일한
  // 경합 방지 패턴). 사이드바 노출과 #/admin 페이지 상태를 이 함수 하나가
  // 함께 갱신한다 — 둘이 서로 다른 판별 로직을 갖지 않게 하기 위함이다.
  var checkSeq = 0;
  function refreshAdminAwareness(){
    checkSeq += 1;
    var seq = checkSeq;
    if(isAdminRoute()) setState('checking');

    var sb = client();
    if(!sb){
      setSidebarLinkVisible(false);
      if(isAdminRoute()) setState('login-required');
      return;
    }

    sb.auth.getSession().then(function(res){
      if(seq !== checkSeq) return;
      var session = res && res.data && res.data.session;
      var user = session && session.user;
      if(!user){
        // 로그아웃 시 캐시도 함께 비운다 — 같은 브라우저에서 다시 로그인할
        // 때(같은 계정이더라도) admin_users를 새로 조회하게 하기 위함
        // ("로그인 상태가 변경되면 관리자 여부를 다시 확인"을 캐시로 건너
        // 뛰지 않는다).
        adminStatusUserId = null;
        adminStatusPromise = null;
        setSidebarLinkVisible(false); // 미로그인 → 관리자 메뉴 표시 안 함
        if(isAdminRoute()) setState('login-required');
        return;
      }
      return getIsAdminForUser(user.id).then(function(isAdmin){
        if(seq !== checkSeq) return;
        setSidebarLinkVisible(isAdmin); // 일반 로그인 사용자 → 숨김, 관리자 → 표시
        if(!isAdminRoute()) return;
        if(!isAdmin){ setState('no-access'); return; }
        currentSectionKey = 'dashboard';
        renderAdminShell();
        setState('admin');
      });
    }).catch(function(err){
      if(seq !== checkSeq) return;
      console.warn('[launchdesk] 관리자 접근 확인 중 오류:', err && err.message);
      setSidebarLinkVisible(false);
      if(isAdminRoute()) setState('no-access');
    });
  }

  // 최초 로드 시 한 번(사이드바 노출 여부를 어느 화면에서 시작하든 바로
  // 정확하게 반영하기 위해 — #/admin 페이지 상태 갱신은 refreshAdminAwareness
  // 내부에서 isAdminRoute()로 알아서 걸러진다).
  refreshAdminAwareness();

  // 이 파일은 app.js 라우터를 건드리지 않고 독립적으로 hashchange를
  // 구독한다(ops-overview.js/wholesalers.js와 동일한 방식) — #/admin으로
  // 들어올 때 페이지 상태를 다시 계산하기 위함이다(캐시 덕분에 admin_users를
  // 다시 조회하지는 않는다).
  window.addEventListener('hashchange', function(){
    if(isAdminRoute()) refreshAdminAwareness();
  });

  // 로그인/로그아웃(launchdeskStore.onChange)이 확정될 때마다 다시
  // 확인한다 — 어느 화면에 있든(사이드바는 항상 보이므로) 관리자 메뉴
  // 노출 여부를 즉시 갱신하고, 마침 #/admin에 있다면 그 페이지 상태도
  // 함께 갱신한다.
  if(window.launchdeskStore){
    window.launchdeskStore.onChange(refreshAdminAwareness);
  }

  window.launchdeskAdmin = {
    SECTIONS: SECTIONS
  };
})();
