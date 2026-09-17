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
  var panel = document.getElementById('opsOverviewPanel');
  var storeSelect = document.getElementById('opsStoreSelect');
  var guestNotice = document.getElementById('opsGuestNotice');
  var noStoreNotice = document.getElementById('opsNoStoreNotice');
  var dataWrap = document.getElementById('opsDataWrap');
  var todayPaymentEl = document.getElementById('opsTodayPayment');
  var todayCountEl = document.getElementById('opsTodayCount');
  var monthPaymentEl = document.getElementById('opsMonthPayment');
  var monthCountEl = document.getElementById('opsMonthCount');
  var lastSyncedEl = document.getElementById('opsLastSynced');
  if(!panel || !storeSelect || !guestNotice || !noStoreNotice || !dataWrap){ return; }

  // ---- Meta 광고 성과 패널 — 위 Cafe24 패널에서 선택된 쇼핑몰에 연결된
  // Meta 광고계정의 실제 Insights(supabase/functions/meta-insights). 이 DOM이
  // 없어도(예: 예전 캐시된 index.html) Cafe24 패널은 그대로 동작해야 하므로
  // 별도 얼리 리턴 없이 아래에서 각 참조를 매번 null 체크한다.
  var metaPanel = document.getElementById('metaOpsPanel');
  var metaOpsNotConnected = document.getElementById('metaOpsNotConnected');
  var metaOpsNotSelected = document.getElementById('metaOpsNotSelected');
  var metaOpsLoading = document.getElementById('metaOpsLoading');
  var metaOpsError = document.getElementById('metaOpsError');
  var metaOpsErrorMsg = document.getElementById('metaOpsErrorMsg');
  var metaOpsRetryBtn = document.getElementById('metaOpsRetryBtn');
  var metaOpsDataWrap = document.getElementById('metaOpsDataWrap');
  var metaOpsDebugInfo = document.getElementById('metaOpsDebugInfo');
  var metaEls = {
    todaySpend: document.getElementById('metaTodaySpend'),
    todayRevenue: document.getElementById('metaTodayRevenue'),
    todayPurchases: document.getElementById('metaTodayPurchases'),
    todayRoas: document.getElementById('metaTodayRoas'),
    todayRoasNote: document.getElementById('metaTodayRoasNote'),
    todayCtr: document.getElementById('metaTodayCtr'),
    todayCpc: document.getElementById('metaTodayCpc'),
    todayCpm: document.getElementById('metaTodayCpm'),
    monthSpend: document.getElementById('metaMonthSpend'),
    monthRevenue: document.getElementById('metaMonthRevenue'),
    monthPurchases: document.getElementById('metaMonthPurchases'),
    monthRoas: document.getElementById('metaMonthRoas'),
    monthRoasNote: document.getElementById('metaMonthRoasNote'),
    monthCtr: document.getElementById('metaMonthCtr'),
    monthCpc: document.getElementById('metaMonthCpc'),
    monthCpm: document.getElementById('metaMonthCpm')
  };

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

  // stores.js의 같은 이름 함수와 동일한 방식(각자 다른 최상위 IIFE라 공유
  // 불가) — connected_accounts.last_synced_at을 항상 한국 시간(KST)
  // 기준 "2026. 09. 14. 14:30" 형태로.
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
    var hour = parts.hour === '24' ? '00' : parts.hour;
    return parts.year + '. ' + parts.month + '. ' + parts.day + '. ' + hour + ':' + parts.minute;
  }
  function formatWon(n){ return Math.round(n).toLocaleString('ko-KR') + '원'; }

  // ---------------------------------------------------------- Meta 포맷 헬퍼
  // 환율 변환은 절대 하지 않는다 — 광고계정 실제 currency로만 표시(요구사항
  // 9). Intl이 지원하지 않는/알 수 없는 통화 코드라도 catch에서 ISO 코드
  // 자체가 보이는 형태로 fallback한다.
  function formatMetaMoney(amount, currency){
    var n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(n);
    } catch(e){
      return (currency ? currency + ' ' : '') + n.toLocaleString('en-US');
    }
  }
  // ROAS 보조 설명의 "광고비 1당" 부분 전용 — 소수점 없이(예: "$1", "₩1").
  function formatMetaMoneyRounded(amount, currency){
    var n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n);
    } catch(e){
      return (currency ? currency + ' ' : '') + Math.round(n).toLocaleString('en-US');
    }
  }
  // 0 분모라 계산 불가인 지표(서버가 null로 내려줌)는 0이 아니라 "—"로
  // 구분해서 보여준다 — 데이터 없음(0)과 계산 불가는 다른 의미다.
  //
  // 서버는 ROAS를 ratio(purchase_value/spend, 예: 3.379073...)로 내려준다 —
  // 이 계산/응답은 그대로 두고(백엔드 수정 금지), 한국 쇼핑몰 운영자에게
  // 익숙한 퍼센트 표시로 UI에서만 변환한다(예: 3.379073 → "338%").
  function formatMetaRoas(x){ return (x === null || x === undefined) ? '—' : (Math.round(Number(x) * 100).toLocaleString('ko-KR') + '%'); }
  // 보조 설명 — 원래 ratio를 "광고비 1당 약 얼마의 매출"로 풀어서 보여준다.
  // roas === null(=spend 0 등 계산 불가)이면 표시할 게 없으므로 빈 문자열.
  function formatMetaRoasNote(x, currency){
    if(x === null || x === undefined) return '';
    var perUnit = formatMetaMoneyRounded(1, currency);
    var yieldAmount = formatMetaMoney(x, currency);
    return '광고비 ' + perUnit + '당 약 ' + yieldAmount + '의 Meta 광고매출';
  }
  function formatMetaPercent(x){ return (x === null || x === undefined) ? '—' : (Number(x).toFixed(2) + '%'); }
  function formatMetaMoneyOrDash(x, currency){ return (x === null || x === undefined) ? '—' : formatMetaMoney(x, currency); }
  function formatMetaCount(n){ return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '건'; }

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
  var currentTopState = 'guest'; // showState()가 매번 갱신
  var currentMetaState = 'not-connected'; // showMetaState()가 매번 갱신
  var lastOrderSummary = null; // renderOrderSummary()가 매번 갱신
  var lastMetaPayload = null; // renderMetaData()가 매번 갱신(payload 원본)
  var opsSnapshotListeners = [];
  var latestOpsSnapshot = null;

  function publishOpsSnapshot(){
    var store = eligibleStores.filter(function(s){ return String(s.id) === String(selectedStoreId); })[0] || null;
    latestOpsSnapshot = {
      cafe24: {
        state: currentTopState, // 'guest'|'no-store'|'loading'|'data'
        storeName: store ? store.name : null,
        lastSyncedAt: store ? store.last_synced_at : null,
        today: lastOrderSummary ? { payment: lastOrderSummary.todayPayment, count: lastOrderSummary.todayCount } : null,
        month: lastOrderSummary ? { payment: lastOrderSummary.monthPayment, count: lastOrderSummary.monthCount } : null
      },
      meta: {
        state: currentMetaState, // 'not-connected'|'not-selected'|'loading'|'error'|'data'(cafe24 state!=='data'면 의미 없음)
        currency: (lastMetaPayload && lastMetaPayload.account) ? lastMetaPayload.account.currency : null,
        accountName: (lastMetaPayload && lastMetaPayload.account) ? lastMetaPayload.account.name : null,
        today: lastMetaPayload ? lastMetaPayload.today : null,
        month: lastMetaPayload ? lastMetaPayload.month : null,
        errorMessage: (currentMetaState === 'error' && metaOpsErrorMsg) ? metaOpsErrorMsg.textContent : null
      }
    };
    opsSnapshotListeners.forEach(function(cb){ try{ cb(latestOpsSnapshot); }catch(e){ console.warn('[launchdesk] ops snapshot 구독자 오류:', e && e.message); } });
  }

  function showMetaState(state){ // 'not-connected'|'not-selected'|'loading'|'error'|'data'
    currentMetaState = state;
    if(!metaPanel){ publishOpsSnapshot(); return; }
    if(metaOpsNotConnected) metaOpsNotConnected.hidden = state !== 'not-connected';
    if(metaOpsNotSelected) metaOpsNotSelected.hidden = state !== 'not-selected';
    if(metaOpsLoading) metaOpsLoading.hidden = state !== 'loading';
    if(metaOpsError) metaOpsError.hidden = state !== 'error';
    if(metaOpsDataWrap) metaOpsDataWrap.hidden = state !== 'data';
    publishOpsSnapshot();
  }

  function renderMetaData(payload){
    lastMetaPayload = payload;
    var currency = payload.account && payload.account.currency;
    var today = payload.today || {};
    var month = payload.month || {};

    if(metaEls.todaySpend) metaEls.todaySpend.textContent = formatMetaMoney(today.spend, currency);
    if(metaEls.todayRevenue) metaEls.todayRevenue.textContent = formatMetaMoney(today.purchase_value, currency);
    if(metaEls.todayPurchases) metaEls.todayPurchases.textContent = formatMetaCount(today.purchase_count);
    if(metaEls.todayRoas) metaEls.todayRoas.textContent = formatMetaRoas(today.roas);
    if(metaEls.todayRoasNote) metaEls.todayRoasNote.textContent = formatMetaRoasNote(today.roas, currency);
    if(metaEls.todayCtr) metaEls.todayCtr.textContent = formatMetaPercent(today.ctr);
    if(metaEls.todayCpc) metaEls.todayCpc.textContent = formatMetaMoneyOrDash(today.cpc, currency);
    if(metaEls.todayCpm) metaEls.todayCpm.textContent = formatMetaMoneyOrDash(today.cpm, currency);

    if(metaEls.monthSpend) metaEls.monthSpend.textContent = formatMetaMoney(month.spend, currency);
    if(metaEls.monthRevenue) metaEls.monthRevenue.textContent = formatMetaMoney(month.purchase_value, currency);
    if(metaEls.monthPurchases) metaEls.monthPurchases.textContent = formatMetaCount(month.purchase_count);
    if(metaEls.monthRoas) metaEls.monthRoas.textContent = formatMetaRoas(month.roas);
    if(metaEls.monthRoasNote) metaEls.monthRoasNote.textContent = formatMetaRoasNote(month.roas, currency);
    if(metaEls.monthCtr) metaEls.monthCtr.textContent = formatMetaPercent(month.ctr);
    if(metaEls.monthCpc) metaEls.monthCpc.textContent = formatMetaMoneyOrDash(month.cpc, currency);
    if(metaEls.monthCpm) metaEls.monthCpm.textContent = formatMetaMoneyOrDash(month.cpm, currency);

    // Ads Manager 대조용(요구사항 14) — 일반 사용자에겐 작은 보조 텍스트로만.
    if(metaOpsDebugInfo && payload.account && payload.queried_range){
      metaOpsDebugInfo.textContent = '기준: ' + payload.account.timezone_name + ' · ' + payload.account.currency +
        ' · 구매전환: ' + (today.purchase_basis || month.purchase_basis || '데이터 없음') +
        ' · 이번 달 조회기간: ' + payload.queried_range.month.since + ' ~ ' + payload.queried_range.month.until;
    }

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
    if(metaOpsErrorMsg){
      metaOpsErrorMsg.textContent = (code && META_ERROR_MESSAGES[code]) || (body && body.error) || fallbackMessage || META_ERROR_MESSAGES.TEMPORARY_ERROR;
    }
    showMetaState('error');
  }

  var metaLastStoreId = null; // 재시도 버튼이 다시 쓸 마지막 storeId

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
    if(!metaPanel) return;
    metaLastStoreId = storeId;
    showMetaState('loading');
    var sb = client();
    if(!sb) return;
    sb.from('connected_accounts')
      .select('id, status')
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
        if(row.status !== 'connected'){ showMetaState('not-selected'); return; }
        fetchMetaInsights(row.id, mySeq);
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] meta ops: connected_accounts 조회 중 오류:', err && err.message);
        renderMetaError(null, null);
      });
  }

  if(metaOpsRetryBtn){
    metaOpsRetryBtn.addEventListener('click', function(){
      if(!metaLastStoreId) return;
      seq += 1;
      loadMetaForStore(metaLastStoreId, seq);
    });
  }

  // ------------------------------------------------------------------ state
  var currentUserId = null;
  var eligibleStores = []; // [{ id, name, last_synced_at }] — platform=cafe24 & connected_accounts(provider=cafe24,status=connected) 교집합
  var selectedStoreId = null;
  // 로그인/로그아웃(onChange)마다, 그리고 쇼핑몰 선택이 바뀔 때마다 증가 —
  // 응답이 늦게 와서 순서가 뒤바뀌어도(A 로그아웃 직후 B 로그인, 혹은
  // 드롭다운을 빠르게 두 번 바꾼 경우) 가장 마지막 요청의 결과만 반영한다.
  var seq = 0;

  // state: 'guest' | 'no-store' | 'data' | 'loading'(= 셋 다 숨김, 패널
  // 헤더만 남음 — 로그인/로그아웃 직후 새 데이터가 오기 전까지 이전
  // 사용자의 흔적이 잠깐이라도 보이지 않게 하는 중간 상태)
  function showState(state){
    currentTopState = state;
    guestNotice.hidden = state !== 'guest';
    noStoreNotice.hidden = state !== 'no-store';
    dataWrap.hidden = state !== 'data';
    storeSelect.hidden = !(state === 'data' && eligibleStores.length > 1);
    // Meta 패널은 Cafe24 쇼핑몰이 실제로 선택된 경우에만 의미가 있다 —
    // guest/no-store/loading일 때는 위 Cafe24 안내가 이미 상황을 설명하므로
    // 통째로 숨긴다(요구사항 13과 별개로, "쇼핑몰이 없는데 Meta 상태만
    // 보이는" 혼란을 막기 위함).
    if(metaPanel) metaPanel.hidden = state !== 'data';
    publishOpsSnapshot();
  }

  function populateSelect(){
    storeSelect.innerHTML = '';
    eligibleStores.forEach(function(s){
      var opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      if(String(s.id) === String(selectedStoreId)) opt.selected = true;
      storeSelect.appendChild(opt);
    });
  }

  function renderLastSynced(){
    var store = eligibleStores.filter(function(s){ return String(s.id) === String(selectedStoreId); })[0];
    lastSyncedEl.textContent = (store && formatSyncTime(store.last_synced_at)) || '아직 없음';
  }

  function renderOrderSummary(summary){
    lastOrderSummary = summary;
    todayPaymentEl.textContent = formatWon(summary.todayPayment);
    todayCountEl.textContent = summary.todayCount + '건';
    monthPaymentEl.textContent = formatWon(summary.monthPayment);
    monthCountEl.textContent = summary.monthCount + '건';
    publishOpsSnapshot();
  }
  var EMPTY_SUMMARY = { todayPayment: 0, todayCount: 0, monthPayment: 0, monthCount: 0 };

  // 이번 달 1일 00:00:00(KST) ~ 현재 범위를 한 번만 조회한 뒤, 그 결과
  // 안에서 "오늘"(부분집합)과 "이번 달"(전체)을 클라이언트에서 각각
  // 집계한다 — 오늘 범위는 항상 이번 달 범위에 포함되므로 두 번 조회할
  // 필요가 없다(요구사항 7).
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
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] ops: orders 조회 중 오류:', err && err.message);
        renderOrderSummary(EMPTY_SUMMARY);
      });
  }

  function selectStore(storeId){
    selectedStoreId = storeId;
    renderLastSynced();
    seq += 1;
    var mySeq = seq;
    renderOrderSummary(EMPTY_SUMMARY); // 새 쇼핑몰로 바뀌는 동안 이전 값이 잠깐이라도 남지 않게 즉시 리셋
    loadOrdersFor(storeId, mySeq);
    loadMetaForStore(storeId, mySeq);
  }

  // platform='cafe24'인 내 stores와, provider='cafe24' && status='connected'인
  // connected_accounts를 각각 조회한 뒤 클라이언트에서 교집합을 낸다 —
  // PostgREST embed 문법에 기대는 대신 stores.js가 이미 쓰고 있는 "두 번
  // 조회 + 직접 매칭" 방식을 그대로 재사용한다(검증된 패턴, 실패 지점이
  // 단순함).
  function loadEligibleCafe24Stores(userId, mySeq){
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
          eligibleStores = [];
          showState('no-store');
          return;
        }
        var cafe24Stores = storesRes.data || [];
        if(!cafe24Stores.length){
          eligibleStores = [];
          showState('no-store');
          return;
        }
        var storeIds = cafe24Stores.map(function(s){ return s.id; });
        sb.from('connected_accounts')
          .select('store_id, provider, status, last_synced_at')
          .eq('provider', 'cafe24')
          .eq('status', 'connected')
          .in('store_id', storeIds)
          .then(function(caRes){
            if(mySeq !== seq) return;
            if(caRes.error){
              console.warn('[launchdesk] ops: connected_accounts 조회 실패:', caRes.error.message);
              eligibleStores = [];
              showState('no-store');
              return;
            }
            var lastSyncedByStoreId = {};
            (caRes.data || []).forEach(function(row){
              lastSyncedByStoreId[String(row.store_id)] = row.last_synced_at;
            });
            var previousSelectedId = selectedStoreId;
            eligibleStores = cafe24Stores
              .filter(function(s){ return Object.prototype.hasOwnProperty.call(lastSyncedByStoreId, String(s.id)); })
              .map(function(s){ return { id: s.id, name: s.name, last_synced_at: lastSyncedByStoreId[String(s.id)] }; });

            if(!eligibleStores.length){
              selectedStoreId = null;
              showState('no-store');
              return;
            }

            populateSelect();
            showState('data');
            // 이전에 선택돼 있던 쇼핑몰이 새 목록에도 여전히 있으면 그대로
            // 유지(사용자가 고른 걸 화면 재진입마다 되돌리지 않기 위해),
            // 없으면(최초이거나 연결 해제된 경우) 첫 번째를 기본 선택.
            var stillValid = eligibleStores.some(function(s){ return String(s.id) === String(previousSelectedId); });
            selectStore(stillValid ? previousSelectedId : eligibleStores[0].id);
          })
          .catch(function(err){
            if(mySeq !== seq) return;
            console.warn('[launchdesk] ops: connected_accounts 조회 중 오류:', err && err.message);
            eligibleStores = [];
            showState('no-store');
          });
      })
      .catch(function(err){
        if(mySeq !== seq) return;
        console.warn('[launchdesk] ops: stores 조회 중 오류:', err && err.message);
        eligibleStores = [];
        showState('no-store');
      });
  }

  // launchdeskStore.onChange가 로그인/로그아웃 확정 시점에 울려주는
  // 이벤트에 편승해, 그 시점의 실제 Supabase 세션을 다시 확인한다 —
  // stores.js의 hydrateFromSession()과 동일한 이유·동일한 방식.
  function hydrateFromSession(){
    var sb = client();
    seq += 1;
    var mySeq = seq;
    if(!sb){
      currentUserId = null;
      eligibleStores = [];
      selectedStoreId = null;
      showState('guest');
      return;
    }
    sb.auth.getSession().then(function(res){
      if(mySeq !== seq) return;
      var session = res.data && res.data.session;
      var user = session && session.user;
      if(user){
        currentUserId = user.id;
        // 이전 사용자(또는 게스트) 화면이 한 프레임도 남지 않도록, 새
        // 데이터가 도착하기 전까지는 셋 중 아무 상태도 보여주지 않는다
        // (요구사항 11: A 로그아웃 → B 로그인 시 A의 흔적이 잠깐이라도
        // B 화면에 남으면 안 됨).
        eligibleStores = [];
        selectedStoreId = null;
        showState('loading');
        loadEligibleCafe24Stores(user.id, mySeq);
      } else {
        currentUserId = null;
        eligibleStores = [];
        selectedStoreId = null;
        showState('guest');
      }
    });
  }

  if(window.launchdeskStore){
    window.launchdeskStore.onChange(hydrateFromSession);
  }
  showState('guest'); // 초기 렌더 — 로그인 여부가 아직 확정되기 전의 기본값(위 onChange가 곧 정확한 상태로 갱신)

  storeSelect.addEventListener('change', function(){
    if(storeSelect.value) selectStore(storeSelect.value);
  });

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
    loadEligibleCafe24Stores(currentUserId, seq);
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
      loadEligibleCafe24Stores(currentUserId, seq);
    }
  };
})();
