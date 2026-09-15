/* window.launchdeskUtmAcquisition — UTM First-Touch Acquisition MVP(클라이언트
   쪽). docs/plans/utm-acquisition-design.md 기반, 20260915320000_user_
   acquisition.sql(user_acquisition 테이블 + record_user_acquisition() RPC)을
   전제로 한다.

   역할은 딱 둘로 나뉜다:
   1) 랜딩 시점(비로그인 포함) — URL에 utm_source가 있으면 5개 UTM 필드 +
      landing_path만 골라 localStorage에 "대기(pending)" 상태로 임시 저장.
      이메일 인증을 위해 페이지/브라우저를 벗어날 수 있어 sessionStorage로는
      부족하다(요구사항 3) — 단 영구 보관은 아니고 TTL(PENDING_TTL_MS)이 지나면
      스스로 무효화된다.
   2) 로그인 세션이 확정된 뒤(app.js의 handleSession()이 호출) — 대기 중인
      UTM이 있으면 record_user_acquisition() RPC로 전송하고, 성공(또는 이미
      다른 first-touch가 있어 서버가 조용히 무시한 경우 포함) 시에만 대기 값을
      지운다. 실패(네트워크 오류 등)는 대기 값을 그대로 남겨 다음 로그인
      이벤트에서 자동 재시도되게 한다(요구사항 10).

   GA4(gtag)와 완전히 무관하다 — 이 파일은 URL을 전혀 수정하지 않는다
   (history.replaceState도 쓰지 않음, 요구사항 19). product_events와도
   무관하다(요구사항 12) — user_acquisition은 "최초 마케팅 유입", product_events는
   "사용자 행동"으로 책임을 분리한다.

   index.html에서 supabase-client.js/product-events.js 다음, app.js보다
   먼저 로드한다(app.js의 handleSession()이 이 파일의 sendPendingIfAny()를
   호출한다 — 로드 순서가 바뀌어도 실제 호출은 항상 비동기 콜백 안에서
   일어나므로 깨지지 않지만, 관례상 다른 launchdesk* 전역 모듈과 동일한
   위치에 둔다). */
(function(){
  function client(){ return window.launchdeskSupabase || null; }

  // ---------------------------------------------------------------- 상수
  var PENDING_KEY = 'ld-pending-acquisition';
  // 30일 — 이메일 인증을 미루거나 다른 기기에서 완료하는 경우까지 감안하되
  // (요구사항 3), 영구 보관은 하지 않는다. 이 값이 지나면 랜딩 당시의 UTM은
  // 스스로 무효화되고(직접 삭제) 그 사용자는 이후 "UTM 없음"으로 집계된다.
  var PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  // product-events.js와 동일한 이유로 이 IIFE 안에 별도 선언(각자 다른
  // 최상위 IIFE라 공유 불가) — RPC "전송"만 프로덕션 운영 도메인으로
  // 제한한다(분석 데이터 오염 방지 목적이지 보안 경계가 아니다, 요구사항
  // 18). localStorage "캡처"는 이 제한과 무관하게 어디서나 동작한다 —
  // 개발자가 localhost에서 캡처 로직 자체를 확인할 수 있어야 하기 때문이다.
  var PRODUCTION_HOSTS = ['launchdesk.co.kr', 'www.launchdesk.co.kr'];
  function isProductionHost(){
    return PRODUCTION_HOSTS.indexOf(location.hostname) !== -1;
  }

  // ------------------------------------------------------- landing_path
  // app.js의 safePageLocation()과 동일한 판정 — 정상 해시 라우트는 전부
  // '#/'로 시작한다(TITLES/currentPath() 기준). 이메일 인증/매직링크 등
  // Supabase 인증 콜백이 돌아올 때는 '#access_token=...' 같은 '#/'로
  // 시작하지 않는 해시가 실린다 — 그 경우 및 그 외 알 수 없는 형태는 전부
  // 안전한 기본값('/')으로 대체해, auth 콜백 토큰이 이 컬럼에 절대 들어오지
  // 않게 한다(요구사항 4·20). location.search(쿼리스트링)는 여기 전혀
  // 포함하지 않는다.
  function safeLandingPath(){
    var hash = location.hash;
    if(hash.indexOf('#/') === 0){
      return hash.replace(/^#/, '') || '/';
    }
    return '/';
  }

  // ------------------------------------------------------- pending 저장소
  // 저장 형식: { source, medium, campaign, content, term, landing_path, saved_at }
  // 전체 URL/쿼리스트링 원문, 이메일, 전화번호, 토큰 등은 이 객체 어디에도
  // 없다 — UTM 5개 필드와 landing_path만(요구사항 3·20).
  function readPending(){
    try{
      var raw = localStorage.getItem(PENDING_KEY);
      if(!raw) return null;
      var obj = JSON.parse(raw);
      if(!obj || typeof obj !== 'object' || typeof obj.saved_at !== 'number'){
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      if(Date.now() - obj.saved_at > PENDING_TTL_MS){
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return obj;
    }catch(e){
      // localStorage 접근 불가(프라이빗 브라우징 등) — 조용히 없음으로 취급.
      return null;
    }
  }

  function clearPending(){
    try{ localStorage.removeItem(PENDING_KEY); }catch(e){}
  }

  // ------------------------------------------------------- 1) 랜딩 캡처
  // 이 스크립트가 로드되는 시점(페이지 최초 로드)에 1회만 실행한다.
  // utm_source가 없으면 아무 것도 저장하지 않는다(요구사항 9 — "값이
  // 없으면 direct로 명시 저장"이 아니라 "행 자체가 없으면 unknown/direct
  // 후보"). 이미 유효한(TTL 안의) pending이 있으면 덮어쓰지 않는다 — 이
  // 브라우저가 나중에 다른 UTM 링크로 재방문해도 "이 브라우저가 최초로
  // 목격한" UTM을 그대로 지켜야 진짜 first-touch이기 때문이다(요구사항
  // 2의 취지를 로그인 이전 단계에도 동일하게 적용 — DB의 ON CONFLICT DO
  // NOTHING과 대칭되는 클라이언트 쪽 first-write-wins).
  function captureUtmIfPresent(){
    try{
      var params = new URLSearchParams(location.search);
      var source = params.get('utm_source');
      if(!source) return;

      if(readPending()) return; // 이미 유효한 first-touch 후보가 대기 중 — 덮어쓰지 않음

      var pending = {
        source: source,
        medium: params.get('utm_medium'),
        campaign: params.get('utm_campaign'),
        content: params.get('utm_content'),
        term: params.get('utm_term'),
        landing_path: safeLandingPath(),
        saved_at: Date.now()
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    }catch(e){
      // localStorage 접근 불가 등 — 캡처를 조용히 생략(화면 동작에 영향 없음).
    }
  }

  // ------------------------------------------------------- 2) 로그인 후 전송
  // 동시에 여러 번 호출돼도(예: getSession() 완료와 onAuthStateChange 최초
  // 발화가 겹치는 경우) 중복 요청을 보내지 않도록 간단한 in-flight 가드만
  // 둔다 — 실패 시 재시도는 이 값이 풀린 뒤 다음 handleSession() 호출에서
  // 자연스럽게 일어난다.
  var sendInFlight = false;

  function sendPendingIfAny(){
    if(sendInFlight) return;
    var pending = readPending();
    if(!pending) return; // 대기 중인 UTM이 없으면 아무 것도 하지 않음(흔한 경로 — 매 로그인 이벤트마다 저비용)

    if(!isProductionHost()){
      // 분석 데이터 오염 방지 목적일 뿐 보안 경계는 아니다(요구사항 18) —
      // pending은 지우지 않는다(다른 오리진의 localStorage라 실제로 서로
      // 섞이지는 않지만, 이 세션에서 전송을 생략했다는 사실 자체는 유지).
      console.info('[launchdesk] 운영 도메인이 아니라 user_acquisition 기록을 생략함(분석 데이터 오염 방지 — 보안 목적 아님):', location.hostname);
      return;
    }

    var sb = client();
    if(!sb) return;

    sendInFlight = true;
    sb.rpc('record_user_acquisition', {
      p_source: pending.source,
      p_medium: pending.medium,
      p_campaign: pending.campaign,
      p_content: pending.content,
      p_term: pending.term,
      p_landing_path: pending.landing_path
    }).then(function(res){
      sendInFlight = false;
      if(res.error){
        // 실패 — pending을 지우지 않는다. 다음 SIGNED_IN/TOKEN_REFRESHED 등
        // handleSession() 재호출 시 그대로 재시도된다(요구사항 10).
        console.warn('[launchdesk] user_acquisition 기록 실패(다음 로그인 시 재시도됨):', res.error.message);
        return;
      }
      // 성공 — 이미 다른 first-touch가 있어 서버가 ON CONFLICT DO NOTHING으로
      // 조용히 무시한 경우도 여기 포함된다(에러가 아니므로). 어느 쪽이든
      // 이 브라우저에 더 이상 pending을 남겨둘 이유가 없다.
      clearPending();
    }).catch(function(err){
      sendInFlight = false;
      console.warn('[launchdesk] user_acquisition 기록 중 오류(다음 로그인 시 재시도됨):', err && err.message);
    });
  }

  captureUtmIfPresent();

  window.launchdeskUtmAcquisition = {
    sendPendingIfAny: sendPendingIfAny
  };
})();
