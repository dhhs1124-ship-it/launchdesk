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

  var metaModal = document.getElementById('metaAdAccountModal');
  var metaBackdrop = document.getElementById('metaAdAccountBackdrop');
  var metaClose = document.getElementById('metaAdAccountClose');
  var metaLoading = document.getElementById('metaAdAccountLoading');
  var metaEmpty = document.getElementById('metaAdAccountEmpty');
  var metaForm = document.getElementById('metaAdAccountForm');
  var metaSelect = document.getElementById('metaAdAccountSelect');
  var metaCurrencyEl = document.getElementById('metaAdAccountCurrency');
  var metaTimezoneEl = document.getElementById('metaAdAccountTimezone');
  var metaSubmitBtn = document.getElementById('metaAdAccountSubmit');

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
  // URL 입력 UX 개선 — 초보 사용자가 "myshop.co.kr"처럼 스킴 없이 입력해도
  // 등록되게 한다. wholesalers.js의 normalizeUrl()과 규칙이 완전히 동일한
  // 중복 구현이다(TODO: 두 기능이 안정화된 뒤, 별도 공용 유틸 파일로
  // 합치는 걸 리팩터링 대상으로 남겨둔다 — 지금은 각자 다른 최상위 IIFE라
  // 함수를 그냥 공유할 수 없고, 이번 작업 범위도 stores.js 단독 수정이라
  // 새 파일을 만들지 않았다).
  //   1) 앞뒤 공백 제거
  //   2) 이미 http:// 또는 https://면 그대로 유지
  //   3) 그 외 "단어:" 스킴(javascript:, data:, file: 등)이 있으면 거부(null)
  //   4) 스킴이 아예 없으면 https://를 붙인다
  // 반환값: 정규화된 URL 문자열 | ''(빈 입력) | null(허용 안 되는 스킴).
  function normalizeStoreUrl(raw){
    var v = String(raw == null ? '' : raw).trim();
    if(!v) return '';
    var schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
    if(schemeMatch){
      var scheme = schemeMatch[1].toLowerCase();
      return (scheme === 'http' || scheme === 'https') ? v : null;
    }
    return 'https://' + v;
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
  // 지금 Cafe24 연결 해제 요청이 나가 있는 store.id 모음 — Meta의
  // metaDisconnectInFlightIds와 같은 목적(카드별 버튼 잠금·중복 클릭 방지).
  var cafe24DisconnectInFlightStoreIds = {};
  // provider='meta'인 connected_accounts 행을 store_id별로 — { id,
  // status('pending'|'connected'), external_account_id, display_name }.
  // Cafe24와 달리 status가 'connected'가 아닌 값(pending)도 화면에서
  // 의미가 있으므로(광고계정 선택 UI를 보여줘야 함) status로 필터링하지
  // 않고 store_id별 최신 행 전체를 들고 있는다.
  var metaAccountsByStoreId = {};
  var metaModalConnectedAccountId = null; // 지금 광고계정 선택 모달이 대상으로 하는 connected_accounts.id
  var metaAdAccountsCache = []; // 모달이 마지막으로 조회한 광고계정 목록(선택 변경 시 통화/시간대 갱신용)
  // Meta 광고계정 모달 전용 세대(generation) — 전역 requestSeq와 별도로 둔다.
  // 모달을 열 때마다(openMetaModal) +1, 닫을 때(closeMetaModal)도 +1 해서
  // 그 시점까지 나가 있던 목록 조회/제출 요청의 응답을 전부 무효화한다.
  // "A 매장 모달을 열고 요청이 나간 사이 모달을 닫고 B 매장 모달을 열면,
  // A의 늦은 응답이 B 모달을 덮어쓸 수 있다"는 문제를 막기 위함 — 응답을
  // 적용하기 직전에 그 요청을 시작할 때 캡처해둔 세대가 지금 세대와 같은지,
  // 그리고 그 요청이 겨냥했던 connected_account_id가 지금 모달의 대상과
  // 같은지 둘 다 확인한다. hydrateFromSession()의 세션 변경 처리도
  // closeMetaModal()을 호출해 같은 방식으로 무효화한다(로그아웃/계정 전환 시
  // 이전 사용자의 광고계정 목록이 한 프레임도 보이지 않도록).
  var metaModalGeneration = 0;
  // 지금 해제 요청이 나가 있는 connected_accounts.id(Meta) 모음 — 카드별로
  // [연결 해제] 버튼을 따로 잠그고 중복 클릭을 막기 위함.
  var metaDisconnectInFlightIds = {};
  // hydrateFromSession()이 울릴 때마다 증가 — 응답이 늦게 와서 순서가
  // 뒤바뀌어도(예: A 로그아웃 직후 바로 B 로그인) 가장 마지막 요청의
  // 결과만 반영하기 위한 가드.
  var requestSeq = 0;

  // ---- OAuth 콜백 후 돌아왔을 때 안내 토스트(Cafe24/Meta 공통) ------------
  // 두 서버 콜백 모두 성공/실패와 무관하게 항상
  // https://.../?cafe24=<상태>#/account 또는 ?meta=<상태>#/account 로
  // 돌려보낸다(둘이 동시에 붙을 일은 없지만, 혹시를 대비해 각각 확인).
  // 페이지 로드 시 한 번만 확인하고, 새로고침해도 토스트가 반복되지
  // 않도록 확인한 쿼리 파라미터만 지운다(해시 라우팅 경로는 그대로 둔다
  // — #/account 자체는 라우터가 정상 처리).
  (function handleOAuthReturn(){
    var params = new URLSearchParams(window.location.search);
    var cafe24Status = params.get('cafe24');
    var metaStatus = params.get('meta');
    if(!cafe24Status && !metaStatus) return;

    var CAFE24_MESSAGES = {
      connected:   ['Cafe24 연결이 완료되었습니다.', 'success'],
      denied:      ['Cafe24 연결이 취소되었습니다.', null],
      token_error: ['Cafe24 인증 처리에 실패했습니다.', 'error'],
      server_error:['Cafe24 연결 중 오류가 발생했습니다.', 'error']
    };
    var META_MESSAGES = {
      connected:   ['Meta 계정 연동에 성공했습니다. 아래에서 광고계정을 선택해주세요.', 'success'],
      denied:      ['Meta 연동이 취소되었습니다.', null],
      token_error: ['Meta 인증 처리에 실패했습니다.', 'error'],
      server_error:['Meta 연동 중 오류가 발생했습니다.', 'error']
    };

    if(cafe24Status){
      var cm = CAFE24_MESSAGES[cafe24Status];
      if(cm) showToast(cm[0], cm[1]);
      params.delete('cafe24');
    }
    if(metaStatus){
      var mm = META_MESSAGES[metaStatus];
      if(mm) showToast(mm[0], mm[1]);
      params.delete('meta');
    }

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
      // "Cafe24 연결" 버튼은 아직 연결 전인 쇼핑몰에만 — 이미 연결된
      // 카드에는 대신 아래 cafe24DisconnectBtnHtml(연결 해제)을 보여준다.
      var cafe24BtnHtml = (isCafe24 && !isConnected)
        ? '<button type="button" class="btn btn-ghost btn-sm store-cafe24-connect-btn" data-id="' + escapeHtml(s.id) + '">Cafe24 연결</button>'
        : '';
      // "최근 동기화" 표시 + "주문 동기화"/"연결 해제" 버튼은 연결된 쇼핑몰에만.
      var lastSyncedHtml = '';
      var syncBtnHtml = '';
      var cafe24DisconnectBtnHtml = '';
      if(isConnected){
        var lastSyncedText = formatSyncTime(cafe24LastSyncedAtByStoreId[String(s.id)]) || '아직 없음';
        lastSyncedHtml = '<div class="store-sync-meta">최근 동기화: ' + escapeHtml(lastSyncedText) + '</div>';
        var isSyncing = !!cafe24SyncInFlightStoreIds[String(s.id)];
        syncBtnHtml = '<button type="button" class="btn btn-ghost btn-sm store-cafe24-sync-btn" data-id="' + escapeHtml(s.id) + '"' +
          (isSyncing ? ' disabled' : '') + '>' + (isSyncing ? '동기화 중...' : '주문 동기화') + '</button>';
        var isCafe24Disconnecting = !!cafe24DisconnectInFlightStoreIds[String(s.id)];
        cafe24DisconnectBtnHtml = '<button type="button" class="btn btn-ghost btn-sm store-cafe24-disconnect-btn" data-id="' + escapeHtml(s.id) + '"' +
          (isCafe24Disconnecting ? ' disabled' : '') + '>' + (isCafe24Disconnecting ? '해제 중...' : '연결 해제') + '</button>';
      }
      // Meta 광고 연결 — Cafe24 쇼핑몰 카드에만 붙인다(요구사항 그대로).
      // 아직 연결 안 됨 → 버튼 하나. 선택 완료(status='connected') →
      // 광고계정 이름 + "연결됨" + 해제. status='pending'에는 서로 다른
      // 두 상황이 섞여 있어 external_account_id로 구분한다(아래 참고).
      var metaHtml = '';
      if(isCafe24){
        var metaRow = metaAccountsByStoreId[String(s.id)];
        if(!metaRow){
          metaHtml = '<div class="store-meta-block">' +
            '<div class="store-meta-label">Meta 광고</div>' +
            '<button type="button" class="btn btn-ghost btn-sm store-meta-connect-btn" data-id="' + escapeHtml(s.id) + '">Meta 광고 연결</button>' +
          '</div>';
        } else {
          var isMetaDisconnecting = !!metaDisconnectInFlightIds[String(metaRow.id)];
          var metaDisconnectBtnHtml = '<button type="button" class="btn btn-ghost btn-sm store-meta-disconnect-btn" data-connected-account-id="' + escapeHtml(metaRow.id) + '"' +
            (isMetaDisconnecting ? ' disabled' : '') + '>' + (isMetaDisconnecting ? '해제 중...' : '연결 해제') + '</button>';

          if(metaRow.status === 'connected'){
            metaHtml = '<div class="store-meta-block">' +
              '<div class="store-meta-label">Meta 광고</div>' +
              '<div class="store-name" style="font-size:.88rem;">' + escapeHtml(metaRow.display_name || '연결된 광고계정') + '</div>' +
              '<div class="store-status connected">연결됨</div>' +
              '<div class="store-card-actions" style="margin-top:.5rem;">' + metaDisconnectBtnHtml + '</div>' +
            '</div>';
          } else if(metaRow.external_account_id){
            // pending인데 external_account_id가 남아있음 — meta-oauth-callback은
            // 최초 연결·재연결(OAuth 재로그인) 둘 다 pending으로 바꿀 때
            // external_account_id/display_name을 항상 함께 비운다(코드 확인,
            // meta-oauth-callback.ts). 반면 meta-insights의 자동 되돌림(인증
            // 무효화 감지)은 status만 pending으로 바꾸고 이 값은 그대로 둔다
            // (meta-insights/index.ts의 downgradeToPendingIfStale 참고) — 즉
            // 이 값이 남아있다는 건 "광고계정을 이미 선택한 적이 있는 기존
            // 연결의 인증이 끊어졌다"는 뜻이지, "아직 선택 전"이 아니다. 그래서
            // 광고계정 선택 화면이 아니라 Meta 재연결(OAuth 재시작)로 보낸다.
            metaHtml = '<div class="store-meta-block">' +
              '<div class="store-meta-label">Meta 광고</div>' +
              '<div class="store-name" style="font-size:.88rem;">Meta 연결이 만료되었어요. 다시 연결해주세요.</div>' +
              '<div class="store-card-actions" style="margin-top:.5rem;">' +
                '<button type="button" class="btn btn-primary btn-sm store-meta-connect-btn" data-id="' + escapeHtml(s.id) + '">다시 연결하기</button>' +
                metaDisconnectBtnHtml +
              '</div>' +
            '</div>';
          } else {
            // pending + external_account_id 없음 — OAuth는 끝났지만 광고계정을
            // 아직 한 번도 선택한 적이 없음. 잘못 연결했을 수도 있으므로 선택
            // 전에도 해제할 수 있게 한다(요구사항 1).
            metaHtml = '<div class="store-meta-block">' +
              '<div class="store-meta-label">Meta 광고</div>' +
              '<div class="store-name" style="font-size:.88rem;">광고계정 선택 대기 중</div>' +
              '<div class="store-card-actions" style="margin-top:.5rem;">' +
                '<button type="button" class="btn btn-primary btn-sm store-meta-select-btn" data-id="' + escapeHtml(s.id) + '" data-connected-account-id="' + escapeHtml(metaRow.id) + '">광고계정 선택하기</button>' +
                metaDisconnectBtnHtml +
              '</div>' +
            '</div>';
          }
        }
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
            metaHtml +
          '</div>' +
          '<div class="store-card-actions">' +
            cafe24BtnHtml +
            syncBtnHtml +
            cafe24DisconnectBtnHtml +
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

  // provider='meta'인 connected_accounts 전부(상태 무관 — 'pending'도
  // 화면에 필요) — 이것도 RLS로 이미 본인 store 몫만 돌아온다.
  function fetchMetaAccounts(seq){
    var sb = client();
    if(!sb) return;
    sb.from('connected_accounts')
      .select('id, store_id, provider, status, external_account_id, display_name')
      .eq('provider', 'meta')
      .then(function(res){
        if(seq !== requestSeq) return;
        if(res.error){
          console.warn('[launchdesk] meta connected_accounts 조회 실패:', res.error.message);
          return;
        }
        var map = {};
        (res.data || []).forEach(function(row){ map[String(row.store_id)] = row; });
        metaAccountsByStoreId = map;
        render();
      })
      .catch(function(err){
        if(seq !== requestSeq) return;
        console.warn('[launchdesk] meta connected_accounts 조회 중 오류:', err && err.message);
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
      cafe24DisconnectInFlightStoreIds = {};
      metaAccountsByStoreId = {};
      metaDisconnectInFlightIds = {};
      closeMetaModal(); // 열려 있던 Meta 모달/대상/캐시/제출 상태까지 전부 정리(요구사항 3)
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
        cafe24DisconnectInFlightStoreIds = {};
        metaAccountsByStoreId = {};
        metaDisconnectInFlightIds = {};
        closeMetaModal(); // A 사용자의 열린 모달/광고계정 목록이 B 사용자에게 한 프레임도 보이지 않게
        render();
        fetchStores(user.id, seq);
        fetchConnectedAccounts(seq);
        fetchMetaAccounts(seq);
      } else {
        currentUserId = null;
        stores = [];
        connectedCafe24StoreIds = {};
        cafe24LastSyncedAtByStoreId = {};
        cafe24SyncInFlightStoreIds = {};
        cafe24DisconnectInFlightStoreIds = {};
        metaAccountsByStoreId = {};
        metaDisconnectInFlightIds = {};
        closeMetaModal(); // 로그아웃 시에도 동일하게 정리
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
    if(e.key === 'Escape' && metaModal && metaModal.classList.contains('open')) closeMetaModal();
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
      return;
    }
    var cafe24DisconnectBtn = e.target.closest('.store-cafe24-disconnect-btn');
    if(cafe24DisconnectBtn && !cafe24DisconnectBtn.disabled){
      disconnectCafe24(cafe24DisconnectBtn.getAttribute('data-id'));
      return;
    }
    var metaConnectBtn = e.target.closest('.store-meta-connect-btn');
    if(metaConnectBtn){
      connectMeta(metaConnectBtn.getAttribute('data-id'));
      return;
    }
    var metaSelectBtn = e.target.closest('.store-meta-select-btn');
    if(metaSelectBtn){
      openMetaModal(metaSelectBtn.getAttribute('data-connected-account-id'));
      return;
    }
    var metaDisconnectBtn = e.target.closest('.store-meta-disconnect-btn');
    if(metaDisconnectBtn && !metaDisconnectBtn.disabled){
      disconnectMeta(metaDisconnectBtn.getAttribute('data-connected-account-id'));
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

  // ---------------------------------------------------------------- Cafe24 연결 해제
  // LaunchDesk 내부에 저장된 Cafe24 연결 정보(access/refresh token 포함)와
  // 불러온 주문 데이터를 지운다(Cafe24 서버 측 앱 권한 revoke는 이번 범위
  // 밖 — disconnectMeta와 같은 방침). 실제 삭제는 cafe24-disconnect Edge
  // Function → disconnect_cafe24_integration RPC(단일 트랜잭션)가 담당한다.
  function disconnectCafe24(storeId){
    if(!storeId || !currentUserId) return;
    if(cafe24DisconnectInFlightStoreIds[storeId]) return; // 중복 클릭 방지(버튼도 disabled되지만 한 번 더 방어)
    if(!window.confirm('Cafe24 연결을 해제하면 저장된 연결 정보와 불러온 주문 데이터가 삭제됩니다. 쇼핑몰 정보와 마진 계산 기록은 유지됩니다.')) return;

    var sb = client();
    if(!sb) return;

    var seqAtStart = requestSeq;
    cafe24DisconnectInFlightStoreIds[storeId] = true;
    render();

    sb.functions.invoke('cafe24-disconnect', {
      body: { store_id: storeId }
    }).then(function(res){
      if(seqAtStart !== requestSeq) return;
      delete cafe24DisconnectInFlightStoreIds[storeId];
      render(); // 버튼부터 즉시 원래 상태로

      if(res.error){
        return readInvokeErrorBody(res.error).then(function(body){
          if(seqAtStart !== requestSeq) return;
          showToast((body && body.error) || res.error.message || 'Cafe24 연결 해제에 실패했어요', 'error');
        });
      }

      var data = res.data;
      if(!data || data.ok !== true){
        showToast((data && data.error) || 'Cafe24 연결 해제에 실패했어요', 'error');
        return;
      }

      showToast('Cafe24 연결이 해제되었습니다.', 'success');
      // 카드를 즉시 "API 연결 전" 상태로 되돌리기 — 전체 새로고침 없이
      // connected_accounts만 다시 조회한다(기존 fetchConnectedAccounts 재사용).
      fetchConnectedAccounts(seqAtStart);
    }).catch(function(err){
      if(seqAtStart !== requestSeq) return;
      delete cafe24DisconnectInFlightStoreIds[storeId];
      render();
      showToast('Cafe24 연결 해제 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] cafe24-disconnect 호출 중 오류:', err && err.message);
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

  // ------------------------------------------------------------ Meta 광고 연결
  // Cafe24와 달리 연결 시작 전에 사용자에게 물어볼 입력값이 없으므로(그냥
  // 자기 Meta 계정으로 로그인하는 것뿐), 별도 모달 없이 버튼을 누르면
  // 바로 meta-oauth-start를 호출해 Meta 로그인 화면으로 이동한다.
  function connectMeta(storeId){
    if(!storeId || !currentUserId) return;
    var sb = client();
    if(!sb) return;

    sb.functions.invoke('meta-oauth-start', {
      body: { store_id: storeId }
    }).then(function(res){
      if(res.error){
        showToast('Meta 광고 연결을 시작하지 못했어요: ' + res.error.message, 'error');
        return;
      }
      var authorizationUrl = res.data && res.data.authorization_url;
      if(!authorizationUrl){
        showToast('Meta 인증 주소를 받지 못했어요', 'error');
        return;
      }
      // 이 페이지를 완전히 떠나 Meta 로그인 화면으로 이동한다 — 성공/실패와
      // 무관하게 서버가 다시 #/account로 돌려보내고, 위 콜백 안내 토스트
      // 로직이 결과를 보여준다. 이후 상태가 'pending'으로 바뀌면 카드에
      // "광고계정 선택하기" 버튼이 나타난다.
      window.location.assign(authorizationUrl);
    }).catch(function(err){
      showToast('Meta 연결 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] meta-oauth-start 호출 중 오류:', err && err.message);
    });
  }

  // ---------------------------------------------------- Meta 광고계정 선택 모달
  function showMetaFailureToast(body, fallbackMessage){
    if(body && body.code === 'RECONNECT_REQUIRED'){
      // Meta는 Cafe24와 달리 만료된 토큰을 자동 갱신할 방법이 없다 —
      // 다시 [Meta 광고 연결]부터 눌러야 한다. access_token은 이 응답에
      // 애초에 담겨오지 않는다.
      showToast('Meta 인증이 만료되었습니다. 다시 연결해주세요.', 'error');
      return;
    }
    showToast((body && body.error) || fallbackMessage || '광고계정 정보를 가져오지 못했어요', 'error');
  }

  function setMetaModalStep(step){ // 'loading' | 'empty' | 'form'
    metaLoading.hidden = step !== 'loading';
    metaEmpty.hidden = step !== 'empty';
    metaForm.hidden = step !== 'form';
  }

  function updateMetaAccountDetail(){
    var match = metaAdAccountsCache.filter(function(a){ return String(a.id) === metaSelect.value; })[0];
    metaCurrencyEl.textContent = (match && match.currency) || '-';
    metaTimezoneEl.textContent = (match && match.timezone_name) || '-';
  }

  function openMetaModal(connectedAccountId){
    if(!connectedAccountId) return;
    metaModalGeneration += 1; // 새 세대 발급 — 이전에 열려 있던(또는 닫힌) 모달의 응답은 이제부터 전부 무효
    var myGeneration = metaModalGeneration;
    metaModalConnectedAccountId = connectedAccountId;
    metaAdAccountsCache = [];
    metaSelect.innerHTML = '';
    setMetaModalStep('loading');
    metaModal.classList.add('open');

    var sb = client();
    if(!sb) return;

    // 응답을 반영하기 직전에 세대와 대상 connected_account_id를 둘 다
    // 확인한다 — 그 사이 모달이 닫히거나(세대 증가) 다른 매장으로 다시
    // 열렸으면(세대가 같아 보여도 대상이 다를 수 있는 극단적 경우까지 방어)
    // 이 응답은 버린다. A 매장의 늦은 응답이 B 매장 모달을 덮어쓰는 것과,
    // 세션이 바뀐 뒤(closeMetaModal이 세대를 올림) 이전 사용자의 응답이
    // 새 사용자 화면에 반영되는 것을 둘 다 막는다.
    function isStale(){
      return myGeneration !== metaModalGeneration || connectedAccountId !== metaModalConnectedAccountId;
    }

    sb.functions.invoke('meta-adaccounts', {
      body: { connected_account_id: connectedAccountId }
    }).then(function(res){
      if(isStale()) return;

      if(res.error){
        return readInvokeErrorBody(res.error).then(function(body){
          if(isStale()) return;
          closeMetaModal();
          showMetaFailureToast(body, res.error.message);
        });
      }

      var data = res.data;
      if(!data || data.ok !== true){
        closeMetaModal();
        showMetaFailureToast(data, null);
        return;
      }

      var adAccounts = Array.isArray(data.ad_accounts) ? data.ad_accounts : [];
      if(!adAccounts.length){
        setMetaModalStep('empty');
        return;
      }

      metaAdAccountsCache = adAccounts;
      metaSelect.innerHTML = '';
      adAccounts.forEach(function(a){
        var opt = document.createElement('option');
        opt.value = String(a.id);
        opt.textContent = a.name || a.id;
        metaSelect.appendChild(opt);
      });
      updateMetaAccountDetail();
      setMetaModalStep('form');
    }).catch(function(err){
      if(isStale()) return;
      closeMetaModal();
      showToast('Meta 광고계정 조회 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] meta-adaccounts 호출 중 오류:', err && err.message);
    });
  }
  function closeMetaModal(){
    metaModalGeneration += 1; // 지금까지 나가 있던 목록 조회/제출 응답을 전부 무효화
    metaModal.classList.remove('open');
    metaForm.reset();
    metaSelect.innerHTML = ''; // reset()은 <select>의 동적 옵션 자체는 지우지 않음 — 선택값 잔재 제거
    metaSubmitBtn.disabled = false; // 다음에 모달을 열 때 항상 정상 상태로 시작
    metaModalConnectedAccountId = null;
    metaAdAccountsCache = [];
  }
  if(metaClose) metaClose.addEventListener('click', closeMetaModal);
  if(metaBackdrop) metaBackdrop.addEventListener('click', closeMetaModal);
  if(metaSelect) metaSelect.addEventListener('change', updateMetaAccountDetail);

  if(metaForm) metaForm.addEventListener('submit', function(e){
    e.preventDefault();
    if(!metaModalConnectedAccountId || !currentUserId) return;
    var adAccountId = metaSelect.value;
    if(!adAccountId) return;
    var sb = client();
    if(!sb) return;

    // 목록 조회와 동일하게 모달 세대 + 대상 connected_account_id로 가드
    // 한다(요구사항 2, 3) — 제출 중에 모달이 닫히거나(세대 증가) 세션이
    // 바뀌면(closeMetaModal이 세대를 올림) 이 응답을 무시한다.
    var myGeneration = metaModalGeneration;
    var targetConnectedAccountId = metaModalConnectedAccountId;
    function isStale(){
      return myGeneration !== metaModalGeneration || targetConnectedAccountId !== metaModalConnectedAccountId;
    }

    metaSubmitBtn.disabled = true;

    sb.functions.invoke('meta-account-select', {
      body: { connected_account_id: targetConnectedAccountId, ad_account_id: adAccountId }
    }).then(function(res){
      if(isStale()) return;
      metaSubmitBtn.disabled = false;

      if(res.error){
        return readInvokeErrorBody(res.error).then(function(body){
          if(isStale()) return;
          showMetaFailureToast(body, res.error.message);
        });
      }

      var data = res.data;
      if(!data || data.ok !== true){
        showMetaFailureToast(data, null);
        return;
      }

      closeMetaModal();
      showToast('Meta 광고계정이 연결되었습니다.', 'success');
      // 카드의 "Meta 광고" 표시를 최신 상태로 반영 — 전체 새로고침 없이
      // connected_accounts만 다시 조회한다(기존 fetchMetaAccounts 재사용).
      // 여기 도달했다는 것 자체가 세션이 안 바뀌었다는 뜻이므로(바뀌었다면
      // isStale()이 위에서 이미 걸렀다) 지금 시점의 requestSeq를 그대로 쓴다.
      fetchMetaAccounts(requestSeq);
    }).catch(function(err){
      if(isStale()) return;
      metaSubmitBtn.disabled = false;
      showToast('광고계정 연결 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] meta-account-select 호출 중 오류:', err && err.message);
    });
  });

  // ------------------------------------------------------------ Meta 연결 해제
  // LaunchDesk 내부에 저장된 Meta 연결/토큰만 지운다(Meta 서버 측 앱 권한
  // revoke는 이번 범위 밖). pending/connected 둘 다 해제 가능 — 서버가
  // status를 가리지 않고 provider='meta' 소유권만 확인한다.
  function disconnectMeta(connectedAccountId){
    if(!connectedAccountId || !currentUserId) return;
    if(metaDisconnectInFlightIds[connectedAccountId]) return; // 중복 클릭 방지(버튼도 disabled되지만 한 번 더 방어)
    if(!window.confirm('Meta 광고 연결을 해제할까요?\n저장된 Meta 인증 정보가 삭제됩니다.')) return;

    var sb = client();
    if(!sb) return;

    var seqAtStart = requestSeq;
    metaDisconnectInFlightIds[connectedAccountId] = true;
    render();

    sb.functions.invoke('meta-disconnect', {
      body: { connected_account_id: connectedAccountId }
    }).then(function(res){
      if(seqAtStart !== requestSeq) return;
      delete metaDisconnectInFlightIds[connectedAccountId];
      render(); // 버튼부터 즉시 원래 상태로

      if(res.error){
        return readInvokeErrorBody(res.error).then(function(body){
          if(seqAtStart !== requestSeq) return;
          showToast((body && body.error) || res.error.message || 'Meta 연결 해제에 실패했어요', 'error');
        });
      }

      var data = res.data;
      if(!data || data.ok !== true){
        showToast((data && data.error) || 'Meta 연결 해제에 실패했어요', 'error');
        return;
      }

      showToast('Meta 광고 연결이 해제되었습니다.', 'success');
      // 카드를 즉시 "Meta 광고 연결" 상태로 되돌리기 — 전체 새로고침 없이
      // connected_accounts만 다시 조회한다(기존 fetchMetaAccounts 재사용).
      fetchMetaAccounts(seqAtStart);
    }).catch(function(err){
      if(seqAtStart !== requestSeq) return;
      delete metaDisconnectInFlightIds[connectedAccountId];
      render();
      showToast('Meta 연결 해제 중 오류가 발생했어요', 'error');
      console.warn('[launchdesk] meta-disconnect 호출 중 오류:', err && err.message);
    });
  }

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
    // normalizeStoreUrl()이 스킴 없는 입력엔 https://를 붙이고, http(s) 외의
    // 스킴(javascript:/data:/file: 등)은 null로 거부한다 — 저장되는 값은
    // 항상 이 정규화된 값이다(입력창의 실제 value는 건드리지 않는다).
    var storeUrl = normalizeStoreUrl(urlInput.value);
    if(!name) return; // required 속성이 이미 막아주지만 한 번 더 방어
    if(!storeUrl){
      showToast('올바른 쇼핑몰 URL을 입력해주세요.', 'error');
      return;
    }

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
