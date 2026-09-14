/* /account — "내 쇼핑몰" (Supabase stores 테이블 CRUD + Cafe24 OAuth 연결 시작).

   stores CRUD 외에, platform === 'cafe24'인 카드에서 "Cafe24 연결"을 누르면
   Edge Function(cafe24-oauth-start)을 호출해 Cafe24 인증 화면으로
   이동시키는 것까지만 한다 — 실제 토큰 발급/갱신/저장은 전부 서버(Edge
   Function)가 처리하고, 이 파일은 Client ID/Secret/access_token/
   refresh_token을 절대 다루지 않는다. 연결 해제·토큰 갱신·실제 주문 API
   호출은 다음 단계.

   connected_accounts는 (provider='cafe24', status='connected') 여부만
   조회해서 카드 상태 문구를 바꾸는 데 쓴다 — 여기서 새로 만들거나 지우지
   않는다(그건 Edge Function의 콜백 몫).

   이 파일은 launchdeskStore(store.js)의 STEP/도구 기록과는 완전히 별도로
   동작한다 — stores는 그 파일의 관심사가 아니고, debounce가 필요한
   데이터도 아니라서(버튼을 눌러야만 쓰기가 발생) 굳이 얹지 않았다. 대신
   로그인/로그아웃 타이밍은 launchdeskStore가 이미 정확히 판별해 쏴주는
   onChange 이벤트에 편승한다 — app.js의 handleSession()이 hydrate()/
   resetToGuest() 이후에만 그 이벤트를 울리므로, 이 파일이 그 시점에
   sb.auth.getSession()을 다시 물어보면 "지금 로그인된 사용자가 누구인지"를
   항상 최신 상태로 안전하게 알 수 있다.

   보안 원칙(요청사항 그대로):
   - user_id는 화면 입력값을 절대 신뢰하지 않는다 — 매 요청마다
     Supabase Auth 세션에서 막 확인한 currentUserId만 사용한다.
   - 모든 쓰기(update/delete)에 .eq('user_id', currentUserId)를 한 번 더
     걸어둔다 — RLS가 이미 막아주지만, 클라이언트 쪽에서도 실수로 다른
     사용자의 행을 건드리는 요청 자체를 만들지 않기 위한 이중 방어.
   - service_role/secret key/API token은 쓰지 않는다(publishable key +
     로그인 세션 + RLS만 사용). localStorage에 stores를 복제하지 않는다
     (아래 state는 메모리에만 있고, 새로고침하면 다시 서버에서 불러온다). */
(function(){
  var guestNotice = document.getElementById('storesGuestNotice');
  var panel = document.getElementById('storesPanel');
  var emptyEl = document.getElementById('storesEmpty');
  var listEl = document.getElementById('storesList');
  var addBtn = document.getElementById('storeAddBtn');
  if(!listEl || !panel){ return; } // view-account 마크업이 없으면(구버전 캐시 등) 조용히 종료

  var modal = document.getElementById('storeFormModal');
  var modalBackdrop = document.getElementById('storeFormBackdrop');
  var modalClose = document.getElementById('storeFormClose');
  var modalTitle = document.getElementById('storeFormTitle');
  var form = document.getElementById('storeForm');
  var submitBtn = document.getElementById('storeFormSubmit');
  var nameInput = document.getElementById('storeName');
  var platformSelect = document.getElementById('storePlatform');
  var urlInput = document.getElementById('storeUrl');

  var cafe24Modal = document.getElementById('cafe24ConnectModal');
  var cafe24Backdrop = document.getElementById('cafe24ConnectBackdrop');
  var cafe24Close = document.getElementById('cafe24ConnectClose');
  var cafe24Form = document.getElementById('cafe24ConnectForm');
  var cafe24MallIdInput = document.getElementById('cafe24MallId');
  var cafe24SubmitBtn = document.getElementById('cafe24ConnectSubmit');

  // showToast: app.js/tools.js와 동일한 방식으로 이 파일 안에서 따로
  // 둔다(각자 다른 최상위 IIFE라 함수를 공유할 수 없음 — tools.js의 같은
  // 주석 참고).
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

  var PLATFORM_LABELS = { cafe24: 'Cafe24', smartstore: '스마트스토어', other: '기타' };
  function platformLabel(value){ return PLATFORM_LABELS[value] || value; }

  // connected_accounts.last_synced_at(UTC 타임스탬프)을 "2026. 09. 14. 14:30"
  // 형태로 — 사용자에게는 항상 한국 시간(Asia/Seoul) 기준으로 보여준다.
  function formatSyncTime(isoString){
    if(!isoString) return null;
    var d = new Date(isoString);
    if(isNaN(d.getTime())) return null;
    var parts = {};
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).forEach(function(p){ parts[p.type] = p.value; });
    var hour = parts.hour === '24' ? '00' : parts.hour; // 일부 브라우저는 자정을 "24"로 줌
    return parts.year + '. ' + parts.month + '. ' + parts.day + '. ' + hour + ':' + parts.minute;
  }

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  // store_url은 사용자가 자유 입력한 값이라, href에 그대로 꽂기 전에
  // http(s) 스킴인지만 확인한다(예: javascript: 등은 링크로 만들지 않고
  // 그냥 텍스트로만 보여준다).
  function safeHref(url){
    return /^https?:\/\//i.test(url || '') ? url : null;
  }
  // store_url이 정확히 "*.cafe24.com" 서브도메인일 때만 mall_id를 뽑아
  // 기본값으로 제안한다 — 커스텀 도메인(예: www.myshop.com)일 수 있으므로,
  // 확실하지 않으면 빈 값을 반환해 사용자가 직접 입력하게 한다(자동으로
  // 추정해서 바로 연결하지 않는다).
  function suggestMallId(storeUrl){
    var m = /^https?:\/\/([a-z0-9-]+)\.cafe24\.com(?:[/:?#]|$)/i.exec(storeUrl || '');
    return m ? m[1] : '';
  }

  function client(){ return window.launchdeskSupabase || null; }

  // ------------------------------------------------------------------ state
  var currentUserId = null;
  var stores = [];
  var editingId = null; // null = 추가 모드, 아니면 그 store id를 수정 중
  var cafe24ConnectStoreId = null; // 지금 연결 모달이 대상으로 하는 store id
  // provider='cafe24' && status='connected'인 connected_accounts 행의
  // store_id 모음 — Set(store.id) 형태로, 카드 상태 문구 판단에만 쓴다.
  var connectedCafe24StoreIds = {};
  // 같은 connected_accounts 조회에서 함께 받아온 last_synced_at — store_id별
  // "최근 동기화" 문구 표시에만 쓴다(null이면 "아직 없음").
  var cafe24LastSyncedAtByStoreId = {};
  // 지금 주문 동기화 요청이 나가 있는 store.id 모음 — 쇼핑몰별로 버튼을
  // 따로 잠그기 위함(A 동기화 중이라고 B 버튼까지 잠기면 안 됨).
  var cafe24SyncInFlightStoreIds = {};
  // hydrateFromSession()이 울릴 때마다 증가 — 응답이 늦게 와서 순서가
  // 뒤바뀌어도(예: A 로그아웃 직후 바로 B 로그인) 가장 마지막 요청의
  // 결과만 반영하기 위한 가드.
  var requestSeq = 0;

  // ---- Cafe24 OAuth 콜백 후 돌아왔을 때 안내 토스트 ------------------------
  // 서버가 성공/실패와 무관하게 항상 https://.../?cafe24=<상태>#/account 로
  // 돌려보낸다. 페이지 로드 시 한 번만 확인하고, 새로고침해도 토스트가
  // 반복되지 않도록 쿼리 파라미터를 즉시 지운다(해시 라우팅 경로는 그대로
  // 둔다 — #/account 자체는 라우터가 정상 처리).
  (function handleCafe24OAuthReturn(){
    var params = new URLSearchParams(window.location.search);
    var status = params.get('cafe24');
    if(!status) return;
    var MESSAGES = {
      connected:   ['Cafe24 연결이 완료되었습니다.', 'success'],
      denied:      ['Cafe24 연결이 취소되었습니다.', null],
      token_error: ['Cafe24 인증 처리에 실패했습니다.', 'error'],
      server_error:['Cafe24 연결 중 오류가 발생했습니다.', 'error']
    };
    var m = MESSAGES[status];
    if(m) showToast(m[0], m[1]);
    params.delete('cafe24');
    var qs = params.toString();
    var cleanedUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', cleanedUrl);
  })();

  function render(){
    var authed = !!currentUserId;
    guestNotice.hidden = authed;
    panel.hidden = !authed;
    if(!authed){
      listEl.innerHTML = ''; // 로그아웃 직후 DOM에 이전 사용자의 목록이 남아있지 않게 확실히 비운다
      return;
    }

    if(!stores.length){
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = stores.map(function(s){
      var href = safeHref(s.store_url);
      var urlHtml = href
        ? '<a class="store-url" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.store_url) + '</a>'
        : '<span class="store-url">' + escapeHtml(s.store_url) + '</span>';
      var isCafe24 = s.platform === 'cafe24';
      var isConnected = isCafe24 && !!connectedCafe24StoreIds[String(s.id)];
      var statusHtml = '<div class="store-status' + (isConnected ? ' connected' : '') + '">' +
        (isConnected ? 'Cafe24 연결됨' : 'API 연결 전') + '</div>';
      // "Cafe24 연결" 버튼은 아직 연결 전인 쇼핑몰에만 — 연결 해제/재연결은
      // 이번 작업 범위 밖이라, 이미 연결된 카드에는 다시 보여주지 않는다.
      var cafe24BtnHtml = (isCafe24 && !isConnected)
        ? '<button type="button" class="btn btn-ghost btn-sm store-cafe24-connect-btn" data-id="' + escapeHtml(s.id) + '">Cafe24 연결</button>'
        : '';
      // "최근 동기화" 표시 + "주문 동기화" 버튼은 연결된 쇼핑몰에만.
      var lastSyncedHtml = '';
      var syncBtnHtml = '';
      if(isConnected){
        var lastSyncedText = formatSyncTime(cafe24LastSyncedAtByStoreId[String(s.id)]) || '아직 없음';
        lastSyncedHtml = '<div class="store-sync-meta">최근 동기화: ' + escapeHtml(lastSyncedText) + '</div>';
        var isSyncing = !!cafe24SyncInFlightStoreIds[String(s.id)];
        syncBtnHtml = '<button type="button" class="btn btn-ghost btn-sm store-cafe24-sync-btn" data-id="' + escapeHtml(s.id) + '"' +
          (isSyncing ? ' disabled' : '') + '>' + (isSyncing ? '동기화 중...' : '주문 동기화') + '</button>';
      }
      return (
        '<div class="store-card" data-id="' + escapeHtml(s.id) + '">' +
          '<div class="store-card-main">' +
            '<div class="store-card-head">' +
              '<span class="store-name">' + escapeHtml(s.name) + '</span>' +
              '<span class="store-platform-badge">' + escapeHtml(platformLabel(s.platform)) + '</span>' +
            '</div>' +
            urlHtml +
            statusHtml +
            lastSyncedHtml +
          '</div>' +
          '<div class="store-card-actions">' +
            cafe24BtnHtml +
            syncBtnHtml +
            '<button type="button" class="btn btn-ghost btn-sm store-edit-btn" data-id="' + escapeHtml(s.id) + '">수정</button>' +
            '<button type="button" class="btn btn-ghost btn-sm store-del-btn" data-id="' + escapeHtml(s.id) + '">삭제</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function fetchStores(userId, seq){
    var sb = client();
    if(!sb) return;
    sb.from('stores')
      .select('id, name, platform, store_url, is_active, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(function(res){
        if(seq !== requestSeq) return; // 그 사이 다른 사용자로 바뀌었으면 버림
        if(res.error){
          console.warn('[launchdesk] stores 조회 실패:', res.error.message);
          stores = [];
        } else {
          stores = res.data || [];
        }
        render();
      })
      .catch(function(err){
        if(seq !== requestSeq) return;
        console.warn('[launchdesk] stores 조회 중 오류:', err && err.message);
        stores = [];
        render();
      });
  }

  // provider='cafe24' && status='connected'인 connected_accounts만 확인한다
  // (요청사항 그대로) — RLS가 이미 로그인한 사용자 본인 몫만 돌려주므로
  // 여기서 user_id로 추가 필터링하지 않는다. 테이블이 아직 비어있거나
  // (이번 단계 목표) 스키마가 다르면 에러를 콘솔에만 남기고 화면은 항상
  // "API 연결 전"으로 안전하게 폴백한다.
  function fetchConnectedAccounts(seq){
    var sb = client();
    if(!sb) return;
    sb.from('connected_accounts')
      .select('store_id, provider, status, last_synced_at')
      .eq('provider', 'cafe24')
      .eq('status', 'connected')
      .then(function(res){
        if(seq !== requestSeq) return;
        if(res.error){
          console.warn('[launchdesk] connected_accounts 조회 실패:', res.error.message);
          return;
        }
        var ids = {};
        var lastSyncedAt = {};
        (res.data || []).forEach(function(row){
          ids[String(row.store_id)] = true;
          lastSyncedAt[String(row.store_id)] = row.last_synced_at;
        });
        connectedCafe24StoreIds = ids;
        cafe24LastSyncedAtByStoreId = lastSyncedAt;
        render();
      })
      .catch(function(err){
        if(seq !== requestSeq) return;
        console.warn('[launchdesk] connected_accounts 조회 중 오류:', err && err.message);
      });
  }

  // launchdeskStore.onChange가 로그인/로그아웃 확정 시점에 울려주는 이벤트에
  // 편승해, 그 시점의 실제 Supabase 세션을 다시 확인한다 — 화면 입력이나
  // 다른 전역 변수가 아니라 세션 그 자체를 user_id의 유일한 출처로 쓴다.
  function hydrateFromSession(){
    var sb = client();
    requestSeq += 1;
    var seq = requestSeq;
    if(!sb){
      currentUserId = null;
      stores = [];
      connectedCafe24StoreIds = {};
      cafe24LastSyncedAtByStoreId = {};
      cafe24SyncInFlightStoreIds = {};
      render();
      return;
    }
    sb.auth.getSession().then(function(res){
      if(seq !== requestSeq) return;
      var session = res.data && res.data.session;
      var user = session && session.user;
      if(user){
        currentUserId = user.id;
        stores = []; // 새 사용자 몫을 불러오는 동안 이전 목록이 잠깐이라도 보이지 않게
        connectedCafe24StoreIds = {};
        cafe24LastSyncedAtByStoreId = {};
        cafe24SyncInFlightStoreIds = {}; // 이전 사용자 몫으로 걸려있던 "동기화 중" 잠금도 함께 정리
        render();
        fetchStores(user.id, seq);
        fetchConnectedAccounts(seq);
      } else {
        currentUserId = null;
        stores = [];
        connectedCafe24StoreIds = {};
        cafe24LastSyncedAtByStoreId = {};
        cafe24SyncInFlightStoreIds = {};
        render();
      }
    });
  }

  if(window.launchdeskStore){
    window.launchdeskStore.onChange(hydrateFromSession);
  }
  // 초기 렌더 — 아직 로그인 여부를 모르는 상태이므로 일단 비회원 화면으로
  // 그려두고, 위 onChange가 실제 세션 확인 후 다시 그린다(깜빡임 최소화를
  // 위해 launchdeskStore가 처음 hydrate/resetToGuest를 한 번은 반드시
  // 호출하므로 곧 정확한 상태로 갱신된다).
  render();

  // -------------------------------------------------------------- 모달 제어
  function openModal(mode, storeRow){
    editingId = mode === 'edit' ? storeRow.id : null;
    modalTitle.textContent = editingId ? '쇼핑몰 수정' : '쇼핑몰 추가';
    submitBtn.textContent = editingId ? '저장하기' : '추가하기';
    nameInput.value = editingId ? storeRow.name : '';
    platformSelect.value = editingId ? storeRow.platform : 'cafe24';
    urlInput.value = editingId ? storeRow.store_url : '';
    modal.classList.add('open');
    nameInput.focus();
  }
  function closeModal(){
    modal.classList.remove('open');
    form.reset();
    editingId = null;
  }
  if(addBtn) addBtn.addEventListener('click', function(){ openModal('add'); });
  if(modalClose) modalClose.addEventListener('click', closeModal);
  if(modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    if(e.key === 'Escape' && cafe24Modal && cafe24Modal.classList.contains('open')) closeCafe24Modal();
  });

  // ---------------------------------------------------- Cafe24 연결 모달 제어
  // mall_id는 store_url에서 확실히 뽑히는 경우에만 "제안값"으로 채워둘 뿐,
  // 사용자가 직접 확인/수정하고 눌러야만 연결이 시작된다(자동 추정 후
  // 즉시 연결 금지).
  function openCafe24Modal(storeRow){
    cafe24ConnectStoreId = storeRow.id;
    cafe24MallIdInput.value = suggestMallId(storeRow.store_url);
    cafe24Modal.classList.add('open');
    cafe24MallIdInput.focus();
  }
  function closeCafe24Modal(){
    cafe24Modal.classList.remove('open');
    cafe24Form.reset();
    cafe24ConnectStoreId = null;
  }
  if(cafe24Close) cafe24Close.addEventListener('click', closeCafe24Modal);
  if(cafe24Backdrop) cafe24Backdrop.addEventListener('click', closeCafe24Modal);

  // 목록의 수정/삭제/Cafe24 연결 버튼 — 이벤트 위임(목록이 매번 innerHTML로
  // 새로 그려지므로, 각 버튼에 매번 리스너를 다는 대신 listEl 하나에만 건다).
  listEl.addEventListener('click', function(e){
    var editBtn = e.target.closest('.store-edit-btn');
    if(editBtn){
      var row = stores.filter(function(s){ return String(s.id) === editBtn.getAttribute('data-id'); })[0];
      if(row) openModal('edit', row);
      return;
    }
    var delBtn = e.target.closest('.store-del-btn');
    if(delBtn){
      var id = delBtn.getAttribute('data-id');
      var target = stores.filter(function(s){ return String(s.id) === id; })[0];
      var label = target ? target.name : '이 쇼핑몰';
      if(!window.confirm('"' + label + '"을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
      deleteStore(id);
      return;
    }
    var cafe24Btn = e.target.closest('.store-cafe24-connect-btn');
    if(cafe24Btn){
      var cafe24Row = stores.filter(function(s){ return String(s.id) === cafe24Btn.getAttribute('data-id'); })[0];
      if(cafe24Row) openCafe24Modal(cafe24Row);
      return;
    }
    var syncBtn = e.target.closest('.store-cafe24-sync-btn');
    if(syncBtn && !syncBtn.disabled){
      syncCafe24Orders(syncBtn.getAttribute('data-id'));
    }
  });

  // ---------------------------------------------------------- 주문 동기화
  // start_date/end_date는 프론트에서 보내지 않는다 — Edge Function이
  // connected_accounts.last_synced_at을 기준으로 "최초 90일 / 이후 14일
  // overlap"을 알아서 판단한다(이미 구현된 cafe24-orders-sync 그대로).

  // supabase-js는 Edge Function이 2xx가 아닌 응답(400/401/502/500 등)을
  // 주면 res.data를 채우지 않고 res.error(FunctionsHttpError)만 채운다 —
  // 우리 함수가 실제로 반환한 JSON 바디({ error, code })는 그 원본
  // Response인 error.context에 남아있다. code==='RECONNECT_REQUIRED' 안내를
  // 놓치지 않으려면(401로 오므로) 이 바디까지 읽어야 한다. 못 읽으면(구조가
  // 다르거나 이미 소비됨) null로 취급해 일반 오류 메시지로 폴백한다.
  function readInvokeErrorBody(error){
    if(error && error.context && typeof error.context.json === 'function'){
      return error.context.json().catch(function(){ return null; });
    }
    return Promise.resolve(null);
  }
  function showSyncFailureToast(body, fallbackMessage){
    if(body && body.code === 'RECONNECT_REQUIRED'){
      // access_token/refresh_token은 이 응답에 애초에 담겨오지 않는다
      // (Edge Function이 절대 반환하지 않음) — 화면/로그 어디에도 노출할
      // 게 없다. 이번 단계에서는 재연결 모달을 자동으로 열지 않는다.
      showToast('Cafe24 인증이 만료되었습니다. 다시 연결해주세요.', 'error');
      return;
    }
    showToast((body && body.error) || fallbackMessage || '주문 동기화에 실패했어요', 'error');
  }

  function syncCafe24Orders(storeId){
    if(!storeId || cafe24SyncInFlightStoreIds[storeId]) return; // 이미 진행 중이면 무시(방어적 가드 — 버튼 자체도 disabled됨)
    var sb = client();
    if(!sb || !currentUserId) return;

    // 응답이 왔을 때 "그 사이 로그아웃했거나 다른 계정으로 바뀌지 않았는지"
    // 재확인하는 기준 — launchdeskStore.onChange가 로그인/로그아웃마다
    // requestSeq를 올려주므로, 응답 처리 직전에 이 값이 그대로인지만
    // 확인하면 A 계정의 늦은 응답이 B 계정 화면에 반영되는 사고를 막는다.
    var seqAtStart = requestSeq;

    cafe24SyncInFlightStoreIds[storeId] = true;
    render();

    sb.functions.invoke('cafe24-orders-sync', {
      body: { store_id: storeId }
    }).then(function(res){
      if(seqAtStart !== requestSeq) return; // 그 사이 계정이 바뀜 — 이 응답은 버린다
      delete cafe24SyncInFlightStoreIds[storeId];

      if(res.error){
        return readInvokeErrorBody(res.error).then(function(body){
          if(seqAtStart !== requestSeq) return; // context.json() 대기 중에도 계정이 바뀌었을 수 있음
          render();
          showSyncFailureToast(body, res.error.message);
        });
      }

      var data = res.data;
      if(!data || data.ok !== true){
        render();
        showSyncFailureToast(data, null);
        return;
      }

      render(); // 버튼부터 즉시 다시 활성화
      var fetched = typeof data.fetched === 'number' ? data.fetched : null;
      showToast(
        fetched !== null
          ? '주문 동기화가 완료되었습니다. ' + fetched + '건을 확인했습니다.'
          : '주문 동기화가 완료되었습니다.',
        'success'
      );

      // last_synced_at을 화면에 최신으로 반영 — 전체 새로고침 없이
      // connected_accounts만 다시 조회한다(기존 fetchConnectedAccounts를
      // 그대로 재사용, 같은 seq 가드가 여기서도 그대로 적용된다).
      fetchConnectedAccounts(seqAtStart);
    }).catch(function(err){
      if(seqAtStart !== requestSeq) return;
      delete cafe24SyncInFlightStoreIds[storeId];
      render();
      showToast('주문 동기화 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] cafe24-orders-sync 호출 중 오류:', err && err.message);
    });
  }

  if(cafe24Form) cafe24Form.addEventListener('submit', function(e){
    e.preventDefault();
    if(!cafe24ConnectStoreId || !currentUserId){ closeCafe24Modal(); return; }
    var sb = client();
    if(!sb) return;

    var mallId = cafe24MallIdInput.value.trim();
    // Cafe24 mall_id는 영문 소문자/숫자/하이픈 조합의 서브도메인 한 조각 —
    // 형식만 가볍게 확인한다(실제 존재 여부는 Edge Function/Cafe24가 판단).
    if(!mallId || !/^[a-z0-9-]+$/i.test(mallId)){
      showToast('mall_id 형식을 확인해주세요 (예: myshop)', 'error');
      return;
    }

    cafe24SubmitBtn.disabled = true;
    sb.functions.invoke('cafe24-oauth-start', {
      body: { store_id: cafe24ConnectStoreId, mall_id: mallId }
    }).then(function(res){
      if(res.error){
        cafe24SubmitBtn.disabled = false;
        showToast('Cafe24 연결을 시작하지 못했어요: ' + res.error.message, 'error');
        return;
      }
      var authorizationUrl = res.data && res.data.authorization_url;
      if(!authorizationUrl){
        cafe24SubmitBtn.disabled = false;
        showToast('Cafe24 인증 주소를 받지 못했어요', 'error');
        return;
      }
      // 이 페이지를 완전히 떠나 Cafe24 인증 화면으로 이동한다 — 성공/실패와
      // 무관하게 서버가 다시 #/account로 돌려보내고, 그때 위 콜백 안내
      // 토스트 로직이 결과를 보여준다.
      window.location.assign(authorizationUrl);
    }).catch(function(err){
      cafe24SubmitBtn.disabled = false;
      showToast('Cafe24 연결 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] cafe24-oauth-start 호출 중 오류:', err && err.message);
    });
  });

  function deleteStore(id){
    var sb = client();
    if(!sb || !currentUserId) return;
    sb.from('stores').delete()
      .eq('id', id)
      .eq('user_id', currentUserId) // RLS로 이미 막히지만, 클라이언트에서도 스스로 범위를 좁혀둔다
      .then(function(res){
        if(res.error){
          showToast('삭제에 실패했어요: ' + res.error.message, 'error');
          return;
        }
        stores = stores.filter(function(s){ return String(s.id) !== String(id); });
        render();
        showToast('쇼핑몰을 삭제했어요');
      })
      .catch(function(err){
        showToast('삭제 중 오류가 발생했어요', 'error');
        console.warn('[launchdesk] store 삭제 중 오류:', err && err.message);
      });
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(!currentUserId){ closeModal(); return; } // 세션이 그 사이 끊긴 경우의 방어
    var sb = client();
    if(!sb) return;

    var name = nameInput.value.trim();
    var platform = platformSelect.value;
    var storeUrl = urlInput.value.trim();
    if(!name || !storeUrl) return; // required 속성이 이미 막아주지만 한 번 더 방어

    submitBtn.disabled = true;

    if(editingId){
      // 수정: id/user_id/external_store_id는 절대 건드리지 않는다.
      sb.from('stores')
        .update({ name: name, platform: platform, store_url: storeUrl })
        .eq('id', editingId)
        .eq('user_id', currentUserId)
        .select('id, name, platform, store_url, is_active, created_at')
        .then(function(res){
          submitBtn.disabled = false;
          if(res.error || !res.data || !res.data.length){
            showToast('수정에 실패했어요' + (res.error ? ': ' + res.error.message : ''), 'error');
            return;
          }
          var updated = res.data[0];
          stores = stores.map(function(s){ return String(s.id) === String(updated.id) ? updated : s; });
          render();
          closeModal();
          showToast('쇼핑몰 정보를 수정했어요', 'success');
        })
        .catch(function(err){
          submitBtn.disabled = false;
          showToast('수정 중 오류가 발생했어요', 'error');
          console.warn('[launchdesk] store 수정 중 오류:', err && err.message);
        });
    } else {
      // 추가: user_id는 화면 입력이 아니라 이 시점의 currentUserId(로그인
      // 세션에서 확인한 값)만 사용한다. external_store_id는 이번 단계에서
      // 입력받지 않으므로 보내지 않고(DB default/NULL), is_active만 명시적
      // 으로 true를 준다.
      sb.from('stores')
        .insert({ user_id: currentUserId, name: name, platform: platform, store_url: storeUrl, is_active: true })
        .select('id, name, platform, store_url, is_active, created_at')
        .then(function(res){
          submitBtn.disabled = false;
          if(res.error || !res.data || !res.data.length){
            showToast('추가에 실패했어요' + (res.error ? ': ' + res.error.message : ''), 'error');
            return;
          }
          stores.unshift(res.data[0]);
          render();
          closeModal();
          showToast('쇼핑몰을 추가했어요', 'success');
        })
        .catch(function(err){
          submitBtn.disabled = false;
          showToast('추가 중 오류가 발생했어요', 'error');
          console.warn('[launchdesk] store 추가 중 오류:', err && err.message);
        });
    }
  });
})();
