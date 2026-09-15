/* "도매처 찾기"(#/wholesale) — 데이터 레이어 + 화면(DOM)을 함께 담당하는
   독립 모듈. stores.js/ops-overview.js와 같은 스타일(최상위 IIFE, 자기
   화면의 DOM을 직접 쿼리/렌더링, app.js 라우터는 BUILT/TITLES 등록 두 줄만
   건드리고 그 이상은 건드리지 않음)을 그대로 따른다.

   이 파일이 다루는 범위:
   - CATEGORIES 등 카테고리 정의 (index.html의 필터 탭 data-filter 값과
     반드시 일치해야 한다)
   - 공개 목록 조회(fetchPublishedWholesalers) 및 #wholesaleGrid 렌더링,
     카테고리 필터 클릭 처리(#wholesaleFilterTabs — 목록은 최초 1회만
     불러오고 이후 필터는 캐시에서 클라이언트 사이드로 다시 그린다)
   - 등록 문의 제출(submitWholesalerInquiry) 및 #wholesaleInquiryModal
     열기/닫기/제출 처리

   window.launchdeskWholesalers 라는 이름으로 데이터 함수만 계속 노출한다
   (다른 파일에서 재사용할 가능성을 남겨둠) — 화면 쪽 함수/상태는 이 파일의
   클로저 안에만 있고 밖으로 내보내지 않는다.

   보안: published 목록 조회는 로그인 여부와 무관하게(anon도) 동작해야
   하고, 문의 등록은 로그인 사용자만 가능해야 한다 — 실제 강제는 DB의 RLS
   (supabase/migrations/20260915094200_wholesalers.sql)가 담당하고, 이
   파일은 그 앞단에서 사용자에게 더 친절한 실패 사유(NOT_AUTHENTICATED 등)를
   먼저 돌려주는 역할만 한다. user_id는 이 파일이 임의로 만들어 보내지
   않고, 매번 sb.auth.getSession()으로 얻은 서버 세션의 user.id만 쓴다
   (+ 어차피 DB의 insert 정책이 user_id = auth.uid()가 아니면 거부한다).
   화면 렌더링은 innerHTML을 쓰되 사용자 입력(사이트명·설명·취급상품 등)은
   전부 escapeHtml()을 거치고, url은 safeHref()로 http(s) 스킴인지 확인한
   뒤에만 href에 꽂는다(stores.js의 store_url 처리와 동일한 방식). */
(function(){
  function client(){ return window.launchdeskSupabase || null; }

  // stores.js와 동일한 방식(각자 다른 최상위 IIFE라 함수 공유 불가) —
  // innerHTML에 꽂기 전 사용자 입력을 이스케이프한다.
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  // wholesalers.url은 제출 시 http(s) 형식을 검증하지만, 운영자가 Studio에서
  // 직접 입력한 값까지 이 페이지가 신뢰하고 그대로 href에 꽂진 않는다 —
  // http(s) 스킴이 아니면(javascript: 등) 링크로 만들지 않고 텍스트로만 보여준다.
  function safeHref(url){
    return /^https?:\/\//i.test(url || '') ? url : null;
  }

  // ------------------------------------------------------------------ 카테고리
  // DB(wholesalers.category / wholesaler_inquiries.category)의 CHECK
  // 제약과 정확히 같은 값 목록. "전체"는 DB 값이 아니라 UI 필터 전용이라
  // 여기 넣지 않는다 — 화면 쪽에서 "전체" 탭은 category 파라미터를 아예
  // 넘기지 않는 방식(= 필터 없음)으로 구현하면 된다.
  var CATEGORIES = [
    { value: 'clothing',             label: '의류' },
    { value: 'fashion_accessories',  label: '패션잡화' },
    { value: 'living',               label: '생활용품' },
    { value: 'beauty',               label: '뷰티' },
    { value: 'food',                 label: '식품' },
    { value: 'pet',                  label: '반려동물' },
    { value: 'furniture_interior',   label: '가구/인테리어' },
    { value: 'packaging',            label: '포장/부자재' }
  ];
  var CATEGORY_LABEL_BY_VALUE = {};
  CATEGORIES.forEach(function(c){ CATEGORY_LABEL_BY_VALUE[c.value] = c.label; });

  function isValidCategory(value){
    return CATEGORY_LABEL_BY_VALUE.hasOwnProperty(value);
  }

  function categoryLabel(value){
    return CATEGORY_LABEL_BY_VALUE[value] || value;
  }

  // ------------------------------------------------------------------ 유틸
  function trimOrEmpty(v){
    return (typeof v === 'string') ? v.trim() : '';
  }

  // 형식만 가볍게 검증한다(실제 접속 가능 여부까지는 확인하지 않음) —
  // http(s):// 로 시작하고 그 뒤에 뭔가 있으면 통과.
  function isValidUrl(v){
    return /^https?:\/\/.+/i.test(v);
  }

  // URL 입력 UX 개선 — 초보 사용자가 "somfre.com"처럼 스킴 없이 입력해도
  // 되게 한다. 규칙:
  //   1) 앞뒤 공백 제거
  //   2) 이미 http:// 또는 https://로 시작하면 그대로 유지
  //   3) 그 외에 "단어:"로 시작하는 다른 스킴(javascript:, data:, file: 등)이
  //      있으면 절대 살리지 않고 거부(null) — http(s)로 자동 승격시키지 않는다
  //   4) 스킴 자체가 없으면 https://를 붙인다
  // 반환값은 문자열(정규화된 URL) | ''(빈 입력) | null(허용 안 되는 스킴).
  // 최종적으로 http(s):// + 뭔가 있는지는 여전히 isValidUrl()이 판단한다 —
  // 여기서 그 검증을 중복하지 않는다.
  //
  // 알려진 한계: "example.com:8080"처럼 포트가 붙은 입력은 "example.com"을
  // 스킴으로 오인해 거부될 수 있다 — 도매처 사이트 URL에는 사실상 나오지
  // 않는 형태라 이번 범위에서는 다루지 않는다.
  function normalizeUrl(raw){
    var v = trimOrEmpty(raw);
    if(!v) return '';
    var schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
    if(schemeMatch){
      var scheme = schemeMatch[1].toLowerCase();
      return (scheme === 'http' || scheme === 'https') ? v : null;
    }
    return 'https://' + v;
  }

  function isValidEmail(v){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  // ------------------------------------------------------------------ 목록 조회
  // 로그인 여부와 무관하게 호출 가능(RLS가 published만 돌려주므로 anon
  // 세션이어도 안전). category를 생략하면 전체(published 전부)를 반환한다.
  //
  // 반환: Promise<{ ok: true, data: [...] } | { ok: false, error: string }>
  function fetchPublishedWholesalers(category){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    if(category != null && !isValidCategory(category)){
      return Promise.resolve({ ok: false, error: 'INVALID_CATEGORY' });
    }

    var query = sb.from('wholesalers')
      .select('id, slug, name, url, category, summary, main_products, min_order_condition, requires_business_membership, allows_small_quantity, allows_dropshipping, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if(category != null) query = query.eq('category', category);

    return query.then(function(res){
      if(res.error) return { ok: false, error: res.error.message };
      return { ok: true, data: res.data || [] };
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  // ------------------------------------------------------------------ 문의 등록
  // payload는 화면(나중에 만들 폼)에서 그대로 받은 사용자 입력이라고
  // 가정한다 — 여기서 trim/필수값/형식을 검증하고, 로그인 세션에서 얻은
  // user_id만 사용해 insert한다(payload.user_id가 있어도 절대 쓰지
  // 않는다 — 클라이언트가 남의 user_id를 끼워 넣을 수 없게 하기 위함).
  //
  // 반환: Promise<
  //   { ok: true, data: 생성된 행 } |
  //   { ok: false, error: 'NOT_AUTHENTICATED' } |
  //   { ok: false, error: 'VALIDATION_ERROR', fields: string[] } |
  //   { ok: false, error: string }
  // >
  function submitWholesalerInquiry(payload){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    payload = payload || {};

    return sb.auth.getSession().then(function(sessionRes){
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      var user = session && session.user;
      if(!user) return { ok: false, error: 'NOT_AUTHENTICATED' };

      var record = {
        contact_email: trimOrEmpty(payload.contact_email),
        name: trimOrEmpty(payload.name),
        // normalizeUrl()이 스킴 없는 입력엔 https://를 붙이고, http(s)
        // 외의 스킴(javascript:/data:/file: 등)은 null로 거부한다 — null도
        // 빈 문자열처럼 falsy라 바로 아래 missing 체크에서 자연스럽게
        // 'url' 누락으로 처리된다(isValidUrl 쪽 검증과 중복 없음).
        url: normalizeUrl(payload.url),
        category: trimOrEmpty(payload.category),
        summary: trimOrEmpty(payload.summary),
        main_products: trimOrEmpty(payload.main_products) || null,
        min_order_condition: trimOrEmpty(payload.min_order_condition) || null,
        requires_business_membership: !!payload.requires_business_membership,
        allows_small_quantity: !!payload.allows_small_quantity,
        allows_dropshipping: !!payload.allows_dropshipping,
        memo: trimOrEmpty(payload.memo) || null
      };

      var missing = [];
      if(!record.contact_email || !isValidEmail(record.contact_email)) missing.push('contact_email');
      if(!record.name) missing.push('name');
      if(!record.url || !isValidUrl(record.url)) missing.push('url');
      if(!record.category || !isValidCategory(record.category)) missing.push('category');
      if(!record.summary) missing.push('summary');
      if(missing.length) return { ok: false, error: 'VALIDATION_ERROR', fields: missing };

      // user_id는 오직 서버 세션에서만 가져온다 — payload에 무엇이 들어
      // 있었든 여기서 덮어써서, 다른 사람 id로 문의를 남기는 걸 막는다.
      // (DB의 wholesaler_inquiries_insert_own 정책도 동일 조건을 한 번 더
      // 강제하므로, 설령 이 줄이 실수로 지워져도 다른 사용자 명의로는
      // insert 자체가 거부된다.)
      record.user_id = user.id;

      return sb.from('wholesaler_inquiries')
        .insert(record)
        .select()
        .single()
        .then(function(res){
          if(res.error) return { ok: false, error: res.error.message };
          return { ok: true, data: res.data };
        });
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  // ------------------------------------------------------------------ 내 문의 조회
  // 로그인 사용자가 본인이 남긴 문의 목록/상태를 확인할 때 쓴다(RLS가
  // user_id = auth.uid() 행만 돌려주므로, 여기서도 추가 필터링은 하지
  // 않는다 — 기존 stores.js의 connected_accounts 조회와 같은 방식).
  function fetchMyInquiries(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });

    return sb.auth.getSession().then(function(sessionRes){
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if(!session || !session.user) return { ok: false, error: 'NOT_AUTHENTICATED' };

      return sb.from('wholesaler_inquiries')
        .select('id, name, url, category, status, admin_note, resolved_wholesaler_id, created_at')
        .order('created_at', { ascending: false })
        .then(function(res){
          if(res.error) return { ok: false, error: res.error.message };
          return { ok: true, data: res.data || [] };
        });
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  window.launchdeskWholesalers = {
    CATEGORIES: CATEGORIES,
    categoryLabel: categoryLabel,
    isValidCategory: isValidCategory,
    fetchPublishedWholesalers: fetchPublishedWholesalers,
    submitWholesalerInquiry: submitWholesalerInquiry,
    fetchMyInquiries: fetchMyInquiries
  };

  // =========================================================================
  // 화면(#/wholesale) — 목록 · 필터 · 등록 문의 모달
  // 필요한 DOM이 없으면(= 이 화면이 아직 index.html에 없는 상태) 아무것도
  // 하지 않고 조용히 빠진다 — ops-overview.js와 같은 가드 방식.
  // =========================================================================
  var grid = document.getElementById('wholesaleGrid');
  var filterTabsEl = document.getElementById('wholesaleFilterTabs');
  var loadingEl = document.getElementById('wholesaleLoadingState');
  var errorEl = document.getElementById('wholesaleErrorState');
  var emptyEl = document.getElementById('wholesaleEmptyState');
  var filterEmptyEl = document.getElementById('wholesaleFilterEmptyState');
  var retryBtn = document.getElementById('wholesaleRetryBtn');
  if(!grid || !filterTabsEl || !loadingEl || !errorEl || !emptyEl || !filterEmptyEl){ return; }

  // showToast: app.js/tools.js/stores.js와 동일한 방식으로 이 파일 안에서
  // 따로 둔다(각자 다른 최상위 IIFE라 함수를 공유할 수 없음).
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

  // ------------------------------------------------------------------ 목록 상태
  var allItems = null;       // null = 아직 못 불러옴, [] = 불러왔는데 0건
  var currentCategory = null; // null = 전체
  var loadSeq = 0;

  function setState(state){
    // 'loading' | 'error' | 'empty' | 'filtered-empty' | 'data'
    loadingEl.hidden = state !== 'loading';
    errorEl.hidden = state !== 'error';
    emptyEl.hidden = state !== 'empty';
    filterEmptyEl.hidden = state !== 'filtered-empty';
    grid.hidden = state !== 'data';
  }

  function cardHtml(w){
    var parts = [];
    parts.push('<h4>' + escapeHtml(w.name) + ' <span class="tag">' + escapeHtml(categoryLabel(w.category)) + '</span></h4>');
    parts.push('<p>' + escapeHtml(w.summary) + '</p>');
    // main_products/min_order_condition은 nullable — 값이 있을 때만 줄을 만든다
    // (요구사항: 불필요한 정보가 없는 경우 빈 라벨을 표시하지 않음).
    if(w.main_products) parts.push('<p style="font-size:.82rem;">주요 취급상품 — ' + escapeHtml(w.main_products) + '</p>');
    if(w.min_order_condition) parts.push('<p style="font-size:.82rem;">최소 주문 조건 — ' + escapeHtml(w.min_order_condition) + '</p>');
    var flags = [];
    if(w.requires_business_membership) flags.push('사업자 회원 필요');
    if(w.allows_small_quantity) flags.push('소량 주문 가능');
    if(w.allows_dropshipping) flags.push('위탁배송 가능');
    if(flags.length){
      parts.push('<ul>' + flags.map(function(f){ return '<li class="good">' + escapeHtml(f) + '</li>'; }).join('') + '</ul>');
    }
    var href = safeHref(w.url);
    parts.push(href
      ? '<a class="rc-action" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">사이트 방문 ↗</a>'
      : '<span class="rc-action" style="cursor:default; color:var(--ink-faint);">' + escapeHtml(w.url) + '</span>');
    return '<div class="info-card">' + parts.join('') + '</div>';
  }

  function renderFiltered(){
    if(allItems == null){ setState('error'); return; }
    if(allItems.length === 0){ setState('empty'); return; }
    var filtered = currentCategory
      ? allItems.filter(function(w){ return w.category === currentCategory; })
      : allItems;
    if(filtered.length === 0){ setState('filtered-empty'); return; }
    grid.innerHTML = filtered.map(cardHtml).join('');
    setState('data');
  }

  // 카테고리별로 매번 다시 쿼리하지 않고, published 전체를 한 번만 불러와
  // 캐시한 뒤 필터는 클라이언트에서 처리한다(요구사항: 필터 클릭 시 새
  // 페이지 로드 없이 목록만 변경) — 데이터 규모가 작은 초기 단계에 맞는
  // 선택이며, 나중에 항목이 많아지면 서버 사이드 필터로 바꿀 수 있다.
  function loadWholesalers(){
    loadSeq += 1;
    var seq = loadSeq;
    setState('loading');
    fetchPublishedWholesalers().then(function(res){
      if(seq !== loadSeq) return; // 그 사이 새 요청이 시작됐으면 이 응답은 버림
      if(!res.ok){
        // 0건(정상)과 조회 실패(에러)를 반드시 구분한다 — 에러를 빈
        // 목록처럼 보여주지 않는다.
        allItems = null;
        setState('error');
        return;
      }
      allItems = res.data;
      renderFiltered();
    });
  }

  if(retryBtn) retryBtn.addEventListener('click', loadWholesalers);

  filterTabsEl.addEventListener('click', function(e){
    var btn = e.target.closest('.filter-tab');
    if(!btn) return;
    // active 클래스 토글 자체는 app.js의 공통 delegated 핸들러가 이미
    // 처리한다(scope="wholesale"은 거기서 active 토글까지만 하고 return함)
    // — 여기서는 실제로 무엇을 보여줄지만 다시 계산한다.
    var fkey = btn.getAttribute('data-filter');
    currentCategory = (fkey === 'all') ? null : fkey;
    renderFiltered();
  });

  // 이 화면에 처음 진입했을 때뿐 아니라, 다른 화면에 있다가 다시 #/wholesale로
  // 돌아올 때도 최신 목록을 다시 불러온다(그 사이 운영자가 새로 발행했을 수
  // 있으므로) — app.js 라우터는 건드리지 않고 이 파일이 독립적으로
  // hashchange만 구독한다(ops-overview.js와 동일한 방식).
  function isWholesaleRoute(){
    return (location.hash.replace(/^#/, '') || '/') === '/wholesale';
  }
  loadWholesalers(); // 최초 로드 — view-wholesale이 아직 숨겨져 있어도 미리 채워둠
  window.addEventListener('hashchange', function(){
    if(!isWholesaleRoute()) return;
    loadWholesalers();
  });

  // ------------------------------------------------------------------ 등록 문의 모달
  var inquiryOpenBtn = document.getElementById('wholesaleInquiryBtn');
  var inquiryModal = document.getElementById('wholesaleInquiryModal');
  var inquiryBackdrop = document.getElementById('wholesaleInquiryBackdrop');
  var inquiryClose = document.getElementById('wholesaleInquiryClose');
  var inquiryFormWrap = document.getElementById('wholesaleInquiryFormWrap');
  var inquirySuccess = document.getElementById('wholesaleInquirySuccess');
  var inquirySuccessClose = document.getElementById('wholesaleInquirySuccessClose');
  var inquiryForm = document.getElementById('wholesaleInquiryForm');
  var inquirySubmitBtn = document.getElementById('wholesaleInquirySubmit');
  var categorySelect = document.getElementById('whInqCategory');

  if(categorySelect){
    CATEGORIES.forEach(function(c){
      var opt = document.createElement('option');
      opt.value = c.value;
      opt.textContent = c.label;
      categorySelect.appendChild(opt);
    });
  }

  // 기존 로그인 모달을 그대로 연다 — DOM을 직접 만지지 않고, app.js가
  // window.launchdeskOpenLoginModal로 노출해둔 자기 자신의 openLoginModal()을
  // 그대로 호출한다. loginMode='login' 초기화를 포함해 로그인/회원가입
  // 상태를 처음부터 다시 만드는 로직은 전부 app.js 쪽에 있고, 이 파일은
  // 복제하지 않는다.
  function openExistingLoginModal(){
    if(typeof window.launchdeskOpenLoginModal === 'function') window.launchdeskOpenLoginModal();
  }

  function openInquiryModal(){
    if(!inquiryModal) return;
    inquiryFormWrap.hidden = false;
    inquirySuccess.hidden = true;
    inquiryModal.classList.add('open');
  }
  function closeInquiryModal(){
    if(!inquiryModal) return;
    inquiryModal.classList.remove('open');
    if(inquiryForm) inquiryForm.reset();
  }

  if(inquiryOpenBtn){
    inquiryOpenBtn.addEventListener('click', function(){
      var sb = client();
      if(!sb){ showToast('일시적인 오류로 문의를 열 수 없어요.'); return; }
      // 로그인 여부를 먼저 확인한다 — 비로그인이면 여러 항목짜리 폼을
      // 열었다가 제출 시점에야 막지 않고, 여기서 바로 안내 + 로그인
      // 흐름으로 보낸다(요구사항 7).
      sb.auth.getSession().then(function(res){
        var session = res && res.data && res.data.session;
        if(!session || !session.user){
          showToast('도매처 등록 문의는 로그인 후 이용할 수 있어요.');
          openExistingLoginModal();
          return;
        }
        openInquiryModal();
      }).catch(function(){
        showToast('일시적인 오류로 문의를 열 수 없어요.');
      });
    });
  }
  if(inquiryClose) inquiryClose.addEventListener('click', closeInquiryModal);
  if(inquiryBackdrop) inquiryBackdrop.addEventListener('click', closeInquiryModal);
  if(inquirySuccessClose) inquirySuccessClose.addEventListener('click', closeInquiryModal);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && inquiryModal && inquiryModal.classList.contains('open')) closeInquiryModal();
  });

  if(inquiryForm){
    inquiryForm.addEventListener('submit', function(e){
      e.preventDefault();
      // user_id는 여기서 만들지 않는다 — submitWholesalerInquiry()가 매번
      // sb.auth.getSession()으로 얻은 서버 세션의 user.id만 사용한다.
      var payload = {
        name: document.getElementById('whInqName').value,
        url: document.getElementById('whInqUrl').value,
        category: categorySelect ? categorySelect.value : '',
        summary: document.getElementById('whInqSummary').value,
        main_products: document.getElementById('whInqMainProducts').value,
        min_order_condition: document.getElementById('whInqMinOrder').value,
        requires_business_membership: document.getElementById('whInqRequiresBiz').checked,
        allows_small_quantity: document.getElementById('whInqAllowsSmallQty').checked,
        allows_dropshipping: document.getElementById('whInqAllowsDropship').checked,
        contact_email: document.getElementById('whInqEmail').value,
        memo: document.getElementById('whInqMemo').value
      };

      var restoreLabel = inquirySubmitBtn.textContent;
      inquirySubmitBtn.disabled = true;
      inquirySubmitBtn.textContent = '제출 중...';
      function reenable(){ inquirySubmitBtn.disabled = false; inquirySubmitBtn.textContent = restoreLabel; }

      submitWholesalerInquiry(payload).then(function(res){
        reenable();
        if(res.ok){
          inquiryFormWrap.hidden = true;
          inquirySuccess.hidden = false;
          return;
        }
        if(res.error === 'NOT_AUTHENTICATED'){
          // 폼을 여는 시점에 이미 한 번 확인하지만, 그 사이 세션이 끊겼을
          // 수도 있으므로(RLS도 어차피 이 경우 insert를 거부한다) 여기서도
          // 같은 방식으로 안내한다.
          showToast('로그인이 필요해요. 다시 로그인해주세요.');
          closeInquiryModal();
          openExistingLoginModal();
          return;
        }
        if(res.error === 'VALIDATION_ERROR'){
          showToast('필수 항목을 모두 올바르게 입력해주세요.');
          return;
        }
        showToast('문의 접수에 실패했어요. 잠시 후 다시 시도해주세요.');
      }).catch(function(){
        reenable();
        showToast('문의 접수에 실패했어요. 잠시 후 다시 시도해주세요.');
      });
    });
  }
})();
