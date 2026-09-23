/* /tools 대시보드 탭 — "쇼핑몰 운영 현황" (연결된 Cafe24 쇼핑몰의 실제
   orders 데이터: 오늘 결제금액/주문수 + 이번 달 누적 결제금액/주문수).

   이번 단계에서 다루는 건 딱 이 4개 숫자뿐이다 — 취소/반품/환불을 아직
   정규화하지 않았으므로 "매출"이라 부르지 않고 "결제금액"이라 부른다.
   일별 그래프·전일/전월 대비·주문 목록·ROAS·순이익 같은 건 다음 단계
   몫이라 여기 없다.

   "오늘"과 "이번 달"은 전부 한국 시간(Asia/Seoul) 달력 기준이다(서버가
   UTC로 저장한 ordered_at을 그대로 자정 기준으로 끊으면 날짜가
   밀린다) — 아래 kstBoundary()가 그 변환을 전담한다.

   tools.js(마진계산기/광고기록)와는 완전히 분리된 독립 모듈이다 — 저 둘은
   launchdeskStore(비회원 메모리/회원 tool_records)에 물려 있고, 이 패널은
   stores/connected_accounts/orders라는 전혀 다른 데이터 소스를 쓰기
   때문에 굳이 tools.js에 끼워 넣지 않았다(파일이 커지는 것도 피하고,
   서로 다른 관심사가 뒤섞이는 것도 피함). 대신 stores.js가 이미 검증한
   패턴 — launchdeskStore.onChange()에 편승해 그 시점의 실제 Supabase
   세션을 다시 확인하고, 매 요청에 증가하는 seq로 늦게 도착한 응답을
   걸러내는 방식 — 을 그대로 재사용한다.

   추가로 이 패널은 "운영도구 화면에 진입할 때마다" 연결된 쇼핑몰 목록을
   다시 확인한다(요구사항 9) — 로그인 상태는 그대로인데 사용자가 방금
   "내 쇼핑몰" 화면에서 새로 Cafe24를 연결하고 돌아온 경우까지 반영하기
   위해서다. 그래서 로그인/로그아웃(onChange) 외에 해시 라우팅으로
   #/tools에 들어올 때도 한 번 더 확인한다 — app.js의 라우터 자체는
   건드리지 않고, 이 파일이 독립적으로 hashchange를 구독할 뿐이다.

   보안: 이 파일은 stores/connected_accounts/orders를 전부 로그인 사용자의
   Supabase 세션 + 기존 RLS로만 조회한다. service_role/secret key는
   쓰지 않고, orders는 raw_data를 제외한 필요한 컬럼(store_id, ordered_at,
   payment_amount)만 select한다. */
(function(){
  // 오픈 베타 전 단순화(3차)로 이 파일이 원래 그리던 #/tools의 "쇼핑몰
  // 운영 현황"/"Meta 광고 성과" 패널(#opsOverviewPanel/#metaOpsPanel 등)은
  // index.html에서 제거됐다 — 그 안에만 있던 상세 KPI/디테일 DOM(오늘·이번
  // 달 숫자, Meta 상세 필드, 안내 문구 등)은 다시 만들지 않는다(홈
  // 대시보드가 #opsdashKpis 등 자신의 DOM으로 같은 스냅샷을 이미 그린다).
  // 유일하게 #opsStoreSelect(쇼핑몰 선택기)만 #/dashboard(#opsdash-header)로
  // 그대로 옮겨져 살아있다 — id가 같으므로 아래 조회·선택 로직은 전혀
  // 바꾸지 않았다. 조회·집계·window.launchdeskOpsSnapshot 발행 로직도 한
  // 줄도 바뀌지 않았다 — home-dashboard.js/meta-adsets.js가 이 스냅샷을
  // 그대로 구독한다.
  var storeSelect = document.getElementById('opsStoreSelect');

  function client(){ return window.launchdeskSupabase || null; }

  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  // now(실제 UTC 기준 현재 시각)를 KST 달력으로 봤을 때 "오늘 00:00:00" 또는
  // "이번 달 1일 00:00:00"에 해당하는 실제 UTC 순간을 Date로 반환한다.
  // cafe24-orders-sync Edge Function의 toKstDateString()과 같은 트릭 —
  // now에 9시간을 더한 뒤 UTC 필드를 읽으면 그 값이 곧 "KST 벽시계 값"이
  // 되고, 그 날짜의 자정(KST)에 해당하는 실제 UTC 순간은 그 날짜를 다시
  // UTC 자정으로 만들고 9시간을 빼면 나온다.
  function kstBoundary(now, useFirstOfMonth){
    var kst = new Date(now.getTime() + KST_OFFSET_MS);
    var y = kst.getUTCFullYear();
    var m = kst.getUTCMonth();
    var d = useFirstOfMonth ? 1 : kst.getUTCDate();
    return new Date(Date.UTC(y, m, d, 0, 0, 0) - KST_OFFSET_MS);
  }

  // (예전엔 여기에 formatSyncTime()/formatWon()이 있었다 — #opsLastSynced ·
  // #opsTodayPayment 등 텍스트 전용 포맷 함수였는데, 그 DOM이 #/tools
  // 패널과 함께 삭제되며 죽은 코드가 됐다 — 제거했다. lastSyncedAt · 주문
  // 요약 값 자체는 여전히 스냅샷으로 그대로 내보낸다 — home-dashboard.js가
  // 자기 포맷 함수로 화면에 그린다.)

  // (예전엔 여기에 Meta 포맷 헬퍼 6개(formatMetaMoney 등)가 있었다 —
  // #metaOpsPanel의 상세 필드를 직접 그리는 용도였는데, 그 DOM이 삭제되며
  // 죽은 코드가 됐다 — 제거했다. home-dashboard.js가 같은 스냅샷을 자기
  // 화면에 그릴 때 쓰는 동일 목적의 포맷 함수를 독립적으로 갖고 있다
  // (이 파일 헤더에 적힌 관례 — 각자 다른 최상위 IIFE라 공유 불가).

  // stores.js의 같은 이름 helper와 동일한 이유로 이 IIFE 안에 별도 선언
  // (각자 다른 최상위 IIFE라 공유 불가) — functions.invoke 에러 응답의 JSON
  // body(예: { error, code })를 안전하게 읽는다.
  function readInvokeErrorBody(error){
    if(error && error.context && typeof error.context.json === 'function'){
      return error.context.json().catch(function(){ return null; });
    }
    return Promise.resolve(null);
  }

  // 이 파일 밖(신규 home-dashboard.js)에서 같은 Cafe24/Meta 데이터를 다시
  // 계산하지 않고 재사용할 수 있도록, 이미 계산된 값만 구독 가능하게
  // 내보낸다 — 조회/집계 로직 자체는 이 파일에 그대로 남고 단 한 곳도
  // 바뀌지 않는다(재사용하는 쪽이 새 네트워크 요청이나 새 계산식을 만들지
  // 않게 하기 위함). 파일 맨 아래 window.launchdeskOpsSnapshot 참고.
  // authed(로그인 여부)는 cafe24 상태와 완전히 분리된 별도 필드다 — Cafe24가
  // loading/error/not-connected여도, 혹은 store가 아직 없어도 로그인 사용자를
  // 비회원으로 오인하지 않기 위함(요구사항). window.launchdeskStore.isAuthed()
  // 값을 그대로 옮겨 담을 뿐 새 인증 로직은 아니다 — hydrateFromSession()이
  // 매번 갱신한다.
  var authed = false;
  var currentCafe24State = 'guest'; // showCafe24State()가 매번 갱신 — 'guest'|'loading'|'not-connected'|'error'|'data'
  var currentMetaState = 'not-connected'; // showMetaState()가 매번 갱신 — Cafe24 상태와 독립적
  var lastOrderSummary = null; // renderOrderSummary()가 매번 갱신
  var lastSyncedAt = null; // 선택된 store의 cafe24 connected_accounts.last_synced_at
  var lastMetaPayload = null; // renderMetaData()가 매번 갱신(payload 원본)
  var lastMetaErrorMessage = null; // renderMetaError()가 매번 갱신 — 예전엔 DOM(metaOpsErrorMsg)에서 다시 읽었으나
                                    // 그 DOM(#/tools 레거시 패널)이 삭제돼 항상 null이 되는 버그였다. 이제 변수로 직접 들고 있는다.
  var opsSnapshotListeners = [];
  var latestOpsSnapshot = null;

  function publishOpsSnapshot(){
    var store = myStores.filter(function(s){ return String(s.id) === String(selectedStoreId); })[0] || null;
    latestOpsSnapshot = {
      authed: authed, // 로그인 여부 — cafe24/meta 상태와 무관하게 이 필드만 보고 판단할 것
      storeId: selectedStoreId, // 광고 세트 패널(meta-adsets.js)이 쇼핑몰 변경을 감지 · 조회할 때 쓴다
      cafe24: {
        state: currentCafe24State, // 'guest'|'loading'|'not-connected'|'error'|'data'
        storeName: store ? store.name : null,
        lastSyncedAt: lastSyncedAt,
        today: lastOrderSummary ? { payment: lastOrderSummary.todayPayment, count: lastOrderSummary.todayCount } : null,
        month: lastOrderSummary ? { payment: lastOrderSummary.monthPayment, count: lastOrderSummary.monthCount } : null
      },
      meta: {
        state: currentMetaState, // 'not-connected'|'not-selected'|'reconnect-required'|'loading'|'error'|'data' — cafe24 상태와 무관하게 독립적으로 갱신됨
        currency: (lastMetaPayload && lastMetaPayload.account) ? lastMetaPayload.account.currency : null,
        accountName: (lastMetaPayload && lastMetaPayload.account) ? lastMetaPayload.account.name : null,
        today: lastMetaPayload ? lastMetaPayload.today : null,
        month: lastMetaPayload ? lastMetaPayload.month : null,
        errorMessage: currentMetaState === 'error' ? lastMetaErrorMessage : null
      }
    };
    opsSnapshotListeners.forEach(function(cb){ try{ cb(latestOpsSnapshot); }catch(e){ console.warn('[launchdesk] ops snapshot 구독자 오류:', e && e.message); } });
  }

  // (#metaOpsPanel 삭제로 여기서 DOM을 직접 그리던 부분은 없앴다 — 상태
  // 값만 갱신하고 publishOpsSnapshot()으로 내보낸다. 실제 화면은
  // home-dashboard.js가 이 스냅샷을 구독해 자신의 DOM(#opsdashKpis 등)에
  // 그린다.)
  function showMetaState(state){ // 'not-connected'|'not-selected'|'reconnect-required'|'loading'|'error'|'data'
    currentMetaState = state;
    publishOpsSnapshot();
  }

  function renderMetaData(payload){
    lastMetaPayload = payload;
    lastMetaErrorMessage = null;
    showMetaState('data');
  }

  var META_ERROR_MESSAGES = {
    META_NOT_CONNECTED: 'Meta 광고 계정을 연결해주세요.',
    META_ACCOUNT_NOT_SELECTED: '분석할 광고계정을 선택해주세요.',
    RECONNECT_REQUIRED: 'Meta 연결이 만료되었습니다. 다시 연결해주세요.',
    PERMISSION_REQUIRED: '이 광고계정에 대한 접근 권한이 없습니다. 다시 연결해주세요.',
    RATE_LIMITED: 'Meta 요청이 많아 잠시 후 다시 시도해주세요.',
    ACCOUNT_UNAVAILABLE: '이 광고계정에 접근할 수 없습니다.',
    TEMPORARY_ERROR: 'Meta 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
  };

  function renderMetaError(body, fallbackMessage){
    var code = body && body.code;
    // 예전엔 이 텍스트를 #/tools 레거시 패널의 DOM(metaOpsErrorMsg)에 써두고
    // publishOpsSnapshot()에서 다시 읽어왔는데, 그 DOM이 삭제된 뒤로는 항상
    // null이 되는 버그였다 — 이제 변수(lastMetaErrorMessage)에 직접 담는다.
    lastMetaErrorMessage = (code && META_ERROR_MESSAGES[code]) || (body && body.error) || fallbackMessage || META_ERROR_MESSAGES.TEMPORARY_ERROR;
    showMetaState('error');
  }

  function fetchMetaInsights(connectedAccountId, mySeq){
    var sb = client();
    if(!sb) return;
    sb.functions.invoke('meta-insights', { body: { connected_account_id: connectedAccountId } })
      .then(function(res){
        if(mySeq !== seq) return; // 그 사이 쇼핑몰 선택이 바뀌었으면 버림
        if(res.error){
          return readInvokeErrorBody(res.error).then(function(bodyJson){
            if(mySeq !== seq) return;
            renderMetaError(bodyJson, res.error.message);
          });
        }
        var data = res.data;
        if(!data || data.ok !== true){
          renderMetaError(data, null);
          return;
        }
        renderMetaData(data);
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] meta-insights 호출 중 오류:', err && err.message);
        renderMetaError(null, null);
      });
  }

  // 선택된 Cafe24 쇼핑몰에 연결된 Meta 광고계정을 찾는다 — stores.js의
  // fetchMetaAccounts와 동일하게 provider='meta'만 걸고 RLS로 소유권을
  // 확인하되, 여기서는 이 store_id 하나로 좁혀 단일 행만 조회한다.
  function loadMetaForStore(storeId, mySeq){
    showMetaState('loading');
    var sb = client();
    if(!sb) return;
    sb.from('connected_accounts')
      // external_account_id도 함께 읽는다 — stores.js(#/account)가 이미 쓰는
      // 것과 같은 구분: status!=='connected'인데 이 값이 남아있으면 "이미
      // 광고계정을 선택했던 연결의 인증이 끊긴 것"(재연결 필요)이고, 값이
      // 없으면 "아직 광고계정을 선택한 적이 없는 것"(최초 선택 대기)이다.
      .select('id, status, external_account_id')
      .eq('provider', 'meta')
      .eq('store_id', storeId)
      .maybeSingle()
      .then(function(res){
        if(mySeq !== seq) return;
        if(res.error){
          console.warn('[launchdesk] meta ops: connected_accounts 조회 실패:', res.error.message);
          renderMetaError(null, null);
          return;
        }
        var row = res.data;
        if(!row){ showMetaState('not-connected'); return; }
        if(row.status !== 'connected'){
          showMetaState(row.external_account_id ? 'reconnect-required' : 'not-selected');
          return;
        }
        fetchMetaInsights(row.id, mySeq);
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] meta ops: connected_accounts 조회 중 오류:', err && err.message);
        renderMetaError(null, null);
      });
  }

  // (예전엔 여기에 #metaOpsPanel 전용 재시도 버튼 리스너가 있었다 — 그
  // DOM이 삭제돼 죽은 코드가 됐다 — 제거했다. Meta 조회 실패는 상단
  // "새로고침"(#opsdashRefreshBtn → refresh())으로 다시 시도할 수 있다.)

  // ------------------------------------------------------------------ state
  var currentUserId = null;
  var myStores = []; // [{ id, name }] — user_id/platform=cafe24로 등록한 내 store 전부. cafe24 "연결" 여부와
                      // 무관하게 store 행 자체를 기준으로 삼는다 — Cafe24 연결 해제(cafe24-disconnect)는
                      // connected_accounts/orders/oauth_states만 지우고 stores 행과 Meta 연동은 그대로 두므로
                      // (disconnect_cafe24_integration RPC 주석 참고), "Cafe24만 연결 해제 + Meta는 그대로
                      // 유지"가 실제로 가능한 상태다. 예전에는 이 목록 자체를 cafe24 연결 여부로 걸러서
                      // Cafe24가 해제되면 store가 통째로 사라져 Meta 조회까지 함께 끊기는 버그가 있었다.
  var selectedStoreId = null;
  // 로그인/로그아웃(onChange)마다, 그리고 쇼핑몰 선택이 바뀔 때마다 증가 —
  // 응답이 늦게 와서 순서가 뒤바뀌어도(A 로그아웃 직후 B 로그인, 혹은
  // 드롭다운을 빠르게 두 번 바꾼 경우) 가장 마지막 요청의 결과만 반영한다.
  var seq = 0;

  // cafe24 state: 'guest' | 'loading' | 'not-connected' | 'error' | 'data'
  // ('data'는 오늘/이번 달 값이 0이어도 그대로 'data'다 — "연결됐지만
  // 데이터 0건"은 별도 상태가 아니라 today/month의 숫자가 0인 'data'다.
  // "store를 아예 등록한 적 없음"과 "store는 있지만 cafe24 연결 안 됨"도
  // 화면 문구가 같아서 둘 다 'not-connected'로 합친다.)
  // (#opsGuestNotice/#opsNoStoreNotice/#opsDataWrap은 #/tools 레거시 패널과
  // 함께 삭제됐다 — home-dashboard.js가 같은 상태를 자기 DOM에 그린다.
  // #opsStoreSelect만 살아있는 DOM이라 그 hidden 토글은 그대로 둔다.)
  function showCafe24State(state){
    currentCafe24State = state;
    if(storeSelect) storeSelect.hidden = !(myStores.length > 1);
    publishOpsSnapshot();
  }

  // Cafe24 · Meta 두 상태를 같은 시점에 새로 맞춰야 하는 지점(쇼핑몰 전환
  // 직후, stores 재조회 실패/빈 목록)에서만 쓴다. showMetaState()와
  // showCafe24State()를 따로 두 번 부르면 그 사이에 먼저 publish된 스냅샷에
  // 아직 안 바뀐 쪽의 이전 상태가 새 storeId와 함께 섞여 나간다 — 두 값을
  // 먼저 맞추고 단 한 번만 publish해 그 문제를 없앤다.
  function publishBothStates(cafe24State, metaState){
    currentCafe24State = cafe24State;
    currentMetaState = metaState;
    if(storeSelect) storeSelect.hidden = !(myStores.length > 1);
    publishOpsSnapshot();
  }

  // myStores가 바뀔 때(loadUserStores 성공)만 다시 그린다 — 옵션을 만드는
  // 시점에 selectedStoreId와 같은 id에 opt.selected를 매겨, 조회 중인
  // 쇼핑몰이 선택값에 정확히 반영되게 한다.
  function populateSelect(){
    if(!storeSelect) return;
    storeSelect.innerHTML = '';
    myStores.forEach(function(s){
      var opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      if(String(s.id) === String(selectedStoreId)) opt.selected = true;
      storeSelect.appendChild(opt);
    });
  }

  // (#opsLastSynced 전용 renderLastSynced()/formatSyncTime()은 그 DOM이
  // 삭제되며 죽은 코드가 됐다 — 제거했다. lastSyncedAt 값 자체는 그대로
  // 유지해 스냅샷(cafe24.lastSyncedAt)으로 계속 내보낸다.)

  function renderOrderSummary(summary){
    lastOrderSummary = summary;
  }
  var EMPTY_SUMMARY = { todayPayment: 0, todayCount: 0, monthPayment: 0, monthCount: 0 };

  // 이번 달 1일 00:00:00(KST) ~ 현재 범위를 한 번만 조회한 뒤, 그 결과
  // 안에서 "오늘"(부분집합)과 "이번 달"(전체)을 클라이언트에서 각각
  // 집계한다 — 오늘 범위는 항상 이번 달 범위에 포함되므로 두 번 조회할
  // 필요가 없다(요구사항 7). 조회 자체가 실패하면(주문 0건과 구분해)
  // 'error'로 남기고 가짜 0건 "데이터"로 덮지 않는다.
  function loadOrdersFor(storeId, mySeq){
    var sb = client();
    if(!sb) return;
    var now = new Date();
    var todayStartMs = kstBoundary(now, false).getTime();
    var monthStartIso = kstBoundary(now, true).toISOString();

    sb.from('orders')
      .select('store_id, ordered_at, payment_amount')
      .eq('store_id', storeId)
      .gte('ordered_at', monthStartIso)
      // MVP 안전장치 — 한 쇼핑몰의 이번 달 주문이 이보다 많아지면 다음
      // 단계(페이지네이션/서버 집계)에서 다룬다. 지금은 단순 KPI 네 개라
      // 클라이언트에서 합산하는 게 충분히 빠르다.
      .limit(5000)
      .then(function(res){
        if(mySeq !== seq) return; // 그 사이 계정/선택이 바뀌었으면 버림
        if(res.error){
          console.warn('[launchdesk] ops: orders 조회 실패:', res.error.message);
          renderOrderSummary(EMPTY_SUMMARY);
          showCafe24State('error');
          return;
        }
        var rows = res.data || [];
        var summary = { todayPayment: 0, todayCount: 0, monthPayment: 0, monthCount: 0 };
        rows.forEach(function(r){
          var amount = r.payment_amount || 0;
          summary.monthPayment += amount;
          summary.monthCount += 1;
          // ordered_at은 PostgREST가 문자열로 돌려주므로, 형식 차이에
          // 영향받지 않게 문자열 비교 대신 실제 시각(ms)으로 비교한다.
          var orderedMs = r.ordered_at ? new Date(r.ordered_at).getTime() : NaN;
          if(!isNaN(orderedMs) && orderedMs >= todayStartMs){
            summary.todayPayment += amount;
            summary.todayCount += 1;
          }
        });
        renderOrderSummary(summary);
        showCafe24State('data'); // count가 0이어도 그대로 'data' — "연결됨+0건"은 여기서 자연히 표현된다
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] ops: orders 조회 중 오류:', err && err.message);
        renderOrderSummary(EMPTY_SUMMARY);
        showCafe24State('error');
      });
  }

  // 선택된 store의 cafe24 연결 상태만 독립적으로 확인한다 — Meta 조회
  // (loadMetaForStore)는 이 함수의 결과를 기다리지 않고 selectStore()에서
  // 항상 별도로, 동시에 시작한다(요구사항: Cafe24 미연결이라는 이유로
  // Meta 조회가 막히면 안 됨).
  function loadCafe24ForStore(storeId, mySeq){
    var sb = client();
    if(!sb) return;
    sb.from('connected_accounts')
      .select('status, last_synced_at')
      .eq('provider', 'cafe24')
      .eq('store_id', storeId)
      .maybeSingle()
      .then(function(res){
        if(mySeq !== seq) return;
        if(res.error){
          console.warn('[launchdesk] ops: cafe24 connected_accounts 조회 실패:', res.error.message);
          lastSyncedAt = null;
          showCafe24State('error');
          return;
        }
        var row = res.data;
        if(!row || row.status !== 'connected'){
          lastSyncedAt = null;
          showCafe24State('not-connected');
          return;
        }
        lastSyncedAt = row.last_synced_at;
        loadOrdersFor(storeId, mySeq); // 성공하면 그 안에서 showCafe24State('data')
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] ops: cafe24 connected_accounts 조회 중 오류:', err && err.message);
        lastSyncedAt = null;
        showCafe24State('error');
      });
  }

  // 주문 · Meta · 동기화 값만 지운다(myStores/selectedStoreId는 건드리지
  // 않는다) — 쇼핑몰 전환(selectStore) 및 목록 재조회 실패/빈 목록
  // (loadUserStores)에서 공통으로 쓴다. 이 값들을 지운 "뒤"에 호출자가
  // showCafe24State()/showMetaState()로 새 상태를 publish해야, loading·
  // error·not-connected 스냅샷에 이전 쇼핑몰의 주문·광고 성과·오류 메시지가
  // 단 한 번도 실리지 않는다(요구사항: 쇼핑몰 전환·재조회 실패 시에도
  // 이전 쇼핑몰의 값이 남으면 안 됨). 로그인/로그아웃 전체 리셋은
  // clearAllCachedData()가 이 함수 + myStores/selectedStoreId까지 지운다.
  function clearStoreScopedData(){
    lastOrderSummary = null;
    lastSyncedAt = null;
    lastMetaPayload = null;
    lastMetaErrorMessage = null;
  }

  function selectStore(storeId){
    selectedStoreId = storeId;
    seq += 1;
    var mySeq = seq;
    // 새 쇼핑몰로 바뀌는 동안 이전 쇼핑몰의 주문 · Meta 값이 스냅샷에 한
    // 프레임도 남지 않게, publishBothStates()가 첫 publish를 하기 전에
    // 전부 지운다. Cafe24 · Meta 상태를 각각 showXState()로 따로 부르지
    // 않고 publishBothStates()로 한 번에 맞추는 이유: 따로 부르면 첫 번째
    // 호출의 publish 시점엔 아직 안 바뀐 쪽이 새 storeId와 함께 이전
    // 쇼핑몰의 상태 그대로 나간다.
    clearStoreScopedData();
    renderOrderSummary(EMPTY_SUMMARY);
    publishBothStates('loading', 'loading');
    loadCafe24ForStore(storeId, mySeq);
    loadMetaForStore(storeId, mySeq); // Cafe24 결과를 기다리지 않고 항상 함께 시작(내부에서 showMetaState('loading') 재호출 — 중복이지만 안전)
  }

  // 로그인 사용자가 등록한 cafe24 플랫폼 store를 전부 가져온다(연결 여부와
  // 무관 — 위 myStores 주석 참고). 이전에는 connected_accounts와 교집합을
  // 내 "연결된 store만" 남겼는데, 그러면 Cafe24만 해제한 store가 목록에서
  // 통째로 사라져 그 store에 남아있는 Meta 연동까지 조회하지 못했다.
  function loadUserStores(userId, mySeq){
    var sb = client();
    if(!sb) return;
    sb.from('stores')
      .select('id, name, platform')
      .eq('user_id', userId)
      .eq('platform', 'cafe24')
      .then(function(storesRes){
        if(mySeq !== seq) return;
        if(storesRes.error){
          console.warn('[launchdesk] ops: stores 조회 실패:', storesRes.error.message);
          myStores = [];
          selectedStoreId = null;
          clearStoreScopedData(); // 재조회 실패로 이 화면에 남아있던 이전 쇼핑몰 값이 노출되지 않게
          // 대상 store 자체를 못 찾았으니 meta도 확인할 대상이 없다(에러 아님) —
          // 두 상태를 showCafe24State()/showMetaState()로 따로 부르면 그 사이에
          // 먼저 publish되는 스냅샷에 반대쪽의 이전 상태가 남으므로 한 번에 맞춘다.
          publishBothStates('error', 'not-connected');
          return;
        }
        myStores = storesRes.data || [];
        if(!myStores.length){
          selectedStoreId = null;
          clearStoreScopedData(); // 쇼핑몰이 전부 삭제된 경우도 마찬가지
          publishBothStates('not-connected', 'not-connected');
          return;
        }
        populateSelect();
        // 이전에 선택돼 있던 쇼핑몰이 새 목록에도 여전히 있으면 그대로
        // 유지(사용자가 고른 걸 화면 재진입마다 되돌리지 않기 위해),
        // 없으면(최초이거나 store 자체가 삭제된 경우) 첫 번째를 기본 선택.
        var previousSelectedId = selectedStoreId;
        var stillValid = myStores.some(function(s){ return String(s.id) === String(previousSelectedId); });
        selectStore(stillValid ? previousSelectedId : myStores[0].id);
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] ops: stores 조회 중 오류:', err && err.message);
        myStores = [];
        selectedStoreId = null;
        clearStoreScopedData();
        publishBothStates('error', 'not-connected');
      });
  }

  // 로그아웃(또는 세션 없음 확인) 시 화면 메모리에 남아있던 운영 데이터·
  // 캐시를 전부 지운다 — 그 다음 다른 사용자가 같은 브라우저에서 로그인해도
  // 이전 사용자의 흔적(주문 요약 · Meta 수치 · 선택된 store)이 한 프레임도
  // 재사용되지 않는다(요구사항).
  function clearAllCachedData(){
    myStores = [];
    selectedStoreId = null;
    clearStoreScopedData();
    currentMetaState = 'not-connected';
  }

  // launchdeskStore.onChange가 로그인/로그아웃 확정 시점에 울려주는
  // 이벤트에 편승해, 그 시점의 실제 Supabase 세션을 다시 확인한다 —
  // stores.js의 hydrateFromSession()과 동일한 이유·동일한 방식.
  //
  // authed는 매번 window.launchdeskStore.isAuthed()에서 그대로 읽는다 —
  // 이 파일이 로그인 여부를 독자적으로 판단하지 않고, 앱 전체가 이미 쓰는
  // 그 값 하나만 따른다(요구사항: 인증 로직 새로 구현 금지). cafe24 상태는
  // 이 값과 완전히 분리돼 있어 loading/error/not-connected 어느 쪽이어도
  // authed는 그대로 true로 남는다.
  function hydrateFromSession(){
    var sb = client();
    seq += 1;
    var mySeq = seq;
    authed = !!(window.launchdeskStore && window.launchdeskStore.isAuthed());
    if(!sb || !authed){
      currentUserId = null;
      clearAllCachedData();
      showCafe24State('guest');
      return;
    }
    sb.auth.getSession().then(function(res){
      if(mySeq !== seq) return;
      var session = res.data && res.data.session;
      var user = session && session.user;
      if(user){
        currentUserId = user.id;
        // 이전 사용자(또는 게스트) 화면이 한 프레임도 남지 않도록, 새
        // 데이터가 도착하기 전까지는 이전 캐시를 전부 지운다(요구사항 11:
        // A 로그아웃 → B 로그인 시 A의 흔적이 잠깐이라도 B 화면에 남으면
        // 안 됨 / 재로그인·다른 사용자 로그인 시 이전 상태 재사용 금지).
        clearAllCachedData();
        showCafe24State('loading');
        loadUserStores(user.id, mySeq);
      } else {
        currentUserId = null;
        clearAllCachedData();
        showCafe24State('guest');
      }
    });
  }

  if(window.launchdeskStore){
    window.launchdeskStore.onChange(hydrateFromSession);
  }
  // 초기 렌더 — 로그인 여부가 아직 확정되기 전의 안전한 기본값(비회원과
  // 동일하게 취급, 위 onChange가 곧 정확한 상태로 갱신한다).
  authed = !!(window.launchdeskStore && window.launchdeskStore.isAuthed());
  showCafe24State(authed ? 'loading' : 'guest');

  if(storeSelect){
    storeSelect.addEventListener('change', function(){
      if(storeSelect.value) selectStore(storeSelect.value);
    });
  }

  // "운영도구 화면에 진입할 때"(요구사항 9) 연결된 쇼핑몰 목록을 다시
  // 확인한다 — 로그인 상태 자체는 그대로인데, 그 사이 "내 쇼핑몰"
  // 화면에서 Cafe24를 새로 연결/해제하고 돌아온 경우까지 반영하기
  // 위함. app.js의 라우터는 건드리지 않고, 이 파일이 독립적으로
  // hashchange만 구독한다.
  function isToolsRoute(){
    return (location.hash.replace(/^#/, '') || '/') === '/tools';
  }
  // 운영 현황(#/dashboard, home-dashboard.js가 이 파일의 스냅샷을 구독해 그리는
  // 화면 — 2026-09 UI 재설계 2차로 홈에서 분리)에 들어올 때도 같은 이유로 연결
  // 쇼핑몰 목록을 다시 확인한다. 조회·집계 로직은 그대로이고 진입 경로만 하나 더 본다.
  function isDashboardRoute(){
    return (location.hash.replace(/^#/, '') || '/') === '/dashboard';
  }
  window.addEventListener('hashchange', function(){
    if(!(isToolsRoute() || isDashboardRoute()) || !currentUserId) return;
    seq += 1;
    loadUserStores(currentUserId, seq);
  });

  // 다른 화면(홈 대시보드 리뉴얼, home-dashboard.js)이 이미 계산된 Cafe24/
  // Meta 값을 재조회·재계산 없이 재사용하기 위한 읽기 전용 구독 API.
  // subscribe(cb)는 즉시 현재 값으로 한 번 호출되고, 이후 상태가 바뀔
  // 때마다(showState/showMetaState/renderOrderSummary/renderMetaData 내부의
  // publishOpsSnapshot() 호출 지점) 다시 호출된다. 이 파일의 조회/집계
  // 로직은 이 export 때문에 단 한 줄도 바뀌지 않았다 — 이미 계산된 값만
  // 내보낸다.
  window.launchdeskOpsSnapshot = {
    subscribe: function(cb){
      if(typeof cb !== 'function') return function(){};
      opsSnapshotListeners.push(cb);
      if(latestOpsSnapshot) cb(latestOpsSnapshot);
      return function unsubscribe(){
        var i = opsSnapshotListeners.indexOf(cb);
        if(i > -1) opsSnapshotListeners.splice(i, 1);
      };
    },
    getLatest: function(){ return latestOpsSnapshot; },
    // 홈 대시보드의 "새로고침" 버튼 전용 — 이 파일이 이미 갖고 있는 재조회
    // 함수를 그대로 다시 호출할 뿐, 별도 조회 로직을 새로 만들지 않는다.
    refresh: function(){
      if(!currentUserId) return;
      seq += 1;
      loadUserStores(currentUserId, seq);
    }
  };
})();
