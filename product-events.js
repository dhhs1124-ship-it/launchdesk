/* window.launchdeskProductEvents — Supabase product_events 내부 행동 이벤트
   기록 전용 모듈(20260915280000_product_events.sql의 track_product_event()
   RPC만 호출한다). GA4(gtag)와는 완전히 별개다 — 이 파일은 기존 gtag()
   호출을 하나도 대체하지 않고, app.js/setup.js/tools.js의 gtag() 호출도
   그대로 둔다. GA4는 마케팅/웹 분석, 이 파일은 제품 활성화·재방문·관리자
   집계라는 별도 목적이다.

   store.js와 마찬가지로 최상위 IIFE + window.launchdesk* 전역 노출
   패턴을 따른다. index.html에서 supabase-client.js 다음, store.js/app.js
   보다 먼저 로드해야 한다(app.js의 render()/setChapterDone()이 이 파일의
   trackProductEvent를 호출한다).

   보안/무결성 설계(요구사항 3·5·14, 2026-09-15 감사 반영 그대로):
   - user_id를 이 파일이 직접 만들거나 보내지 않는다 — RPC 내부에서
     auth.uid()로만 강제되므로, 여기서 넘길 수 있는 인자 자체가 없다.
   - 비로그인 사용자는 애초에 RPC를 호출하지 않는다(아래 getSession() 확인).
     설령 호출하더라도 RPC가 AUTH_REQUIRED로 거부하지만, 매 render()마다
     불필요한 네트워크 요청과 서버 로그 노이즈를 만들지 않기 위해 여기서도
     한 번 더 걸러낸다.
   - 이벤트 이름은 ALLOWED_EVENTS(DB의 CHECK 제약과 반드시 같은 목록)에
     없으면 아예 요청을 보내지 않는다 — 클라이언트 실수(오타 등)를 개발
     콘솔에서 바로 알아챌 수 있게 한다.
   - properties(임의 JSON) 인자를 아예 받지 않는다 — 실제로 이 파일이
     기록하는 3개 이벤트(dashboard_viewed/roadmap_started, 그리고 DB
     쪽에만 남아 있는 event_name 여지) 중 어느 것도 부가 메타데이터가
     필요하지 않다. "브라우저가 임의 JSON을 보낼 길 자체가 없으면" PII가
     실수로 섞여 들어갈 방법도 없다 — 가장 단순하고 안전한 구조를
     택한다(요구사항 6). 나중에 정말 필요해지면 이 함수 시그니처와 RPC
     양쪽에 다시 추가한다.
   - 이 파일이 product event RPC를 호출하는 대상은 프로덕션 운영 도메인
     뿐이다(PRODUCTION_HOSTS, 아래) — localhost/127.0.0.1/사설 LAN IP/
     미리보기·스테이징 배포/file:// 등 그 외 모든 호스트에서는 호출 자체를
     생략한다. **이건 보안 장치가 아니라 순수하게 "분석 데이터 오염
     방지" 목적이다** — RPC 자체는 어느 호스트에서 호출해도 auth.uid()/
     allowlist로 안전하게 검증된다. 다만 개발 중 테스트나 모바일 QA(LAN
     IP 접속 등)에서 발생한 이벤트가 실제 Beta 사용자 지표에 섞이는 걸
     막기 위해, 애초에 "알려진 운영 도메인이 아니면 보내지 않는다"는
     allowlist 방식을 쓴다(이전의 localhost 등 denylist 방식은 LAN IP·
     스테이징 도메인처럼 목록에 없는 새 오염원을 놓칠 수 있어 allowlist로
     바꿨다 — 새 운영 도메인이 생기면 이 배열에 추가해야 한다).
   - 기록 실패(네트워크 오류, RPC 오류 등)는 절대 화면 동작을 막지 않는다
     — 전부 콘솔 경고로만 남기고 Promise를 밖으로 던지지 않는다. 호출부
     (app.js)는 이 함수의 반환값을 기다리지 않는다("fire and forget"). */
(function(){
  function client(){ return window.launchdeskSupabase || null; }

  // DB(track_product_event RPC/product_events CHECK 제약)와 반드시 같은
  // 목록을 유지한다 — 한쪽만 바뀌면 "클라이언트는 보냈다고 여기는데 서버가
  // 조용히 거부하는" 상황이 생긴다. 새 이벤트를 추가할 때는 이 배열과
  // 해당 마이그레이션의 allowlist를 함께 수정해야 한다.
  // roadmap_completed는 여기 없다(2026-09-15 감사 반영) — 로드맵 완료
  // 여부는 canonical DB(user_step_progress)로만 판단하고 이벤트로 다시
  // 만들지 않는다. 관리자 집계 쪽 이유는 admin_beta_behavior_overview()
  // 마이그레이션 주석 참고.
  var ALLOWED_EVENTS = ['dashboard_viewed', 'roadmap_started'];

  // 분석 데이터 오염 방지 전용 allowlist(보안 장치 아님 — 위 파일 상단
  // 설명 참고). 새 운영 도메인이 생기면 여기 추가한다.
  var PRODUCTION_HOSTS = ['launchdesk.co.kr', 'www.launchdesk.co.kr'];
  function isProductionHost(){
    return PRODUCTION_HOSTS.indexOf(location.hostname) !== -1;
  }

  // 세션(브라우저 탭) 단위 session_id — sessionStorage에 한 번만 발급해
  // 재사용한다. 새 탭/새 세션이면 sessionStorage가 비어있으므로 자동으로
  // 새 값이 발급된다(요구사항 5 — "새 탭/새 세션이면 새 session_id").
  var SESSION_STORAGE_KEY = 'ld-product-event-session-id';
  function uuidV4Fallback(){
    // crypto.randomUUID가 없는 구형 브라우저/비보안 컨텍스트(http LAN 등)용
    // 폴백(RFC4122 v4).
    var bytes = new Uint8Array(16);
    if(typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'){
      crypto.getRandomValues(bytes);
    } else {
      for(var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function(b){ return ('0' + b.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function newUuid(){
    if(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return uuidV4Fallback();
  }
  function getSessionId(){
    try{
      var existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if(existing) return existing;
      var fresh = newUuid();
      sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
      return fresh;
    }catch(e){
      // 프라이빗 브라우징 등으로 sessionStorage 접근이 막혀 있어도, 이벤트
      // 자체는 session_id 없이 계속 기록한다(치명적이지 않은 보조 정보).
      return null;
    }
  }

  function currentRoute(){
    var hash = location.hash.replace(/^#/, '');
    return hash || '/';
  }

  /* trackProductEvent(name) — name은 ALLOWED_EVENTS 중 하나여야 한다.
     properties 인자는 없다(위 파일 상단 설명 참고 — RPC가 애초에 받지
     않는다). */
  function trackProductEvent(eventName){
    if(ALLOWED_EVENTS.indexOf(eventName) === -1){
      console.warn('[launchdesk] 알 수 없는 product event 이름이라 기록하지 않음:', eventName);
      return;
    }
    if(!isProductionHost()){
      console.info('[launchdesk] 운영 도메인이 아니라 product event 기록을 생략함(분석 데이터 오염 방지 — 보안 목적 아님):', eventName, location.hostname);
      return;
    }
    var sb = client();
    if(!sb) return;

    try{
      sb.auth.getSession().then(function(res){
        var session = res && res.data && res.data.session;
        if(!session || !session.user) return null; // 비로그인 — 기록 대상 아님
        return sb.rpc('track_product_event', {
          p_event_name: eventName,
          p_session_id: getSessionId(),
          p_route: currentRoute()
        });
      }).then(function(res){
        if(res && res.error){
          console.warn('[launchdesk] product event 기록 실패(' + eventName + '):', res.error.message);
        }
      }).catch(function(err){
        console.warn('[launchdesk] product event 기록 중 오류(' + eventName + '):', err && err.message);
      });
    }catch(err){
      // sb.auth 자체가 없는 등 동기적으로 던지는 경우까지 마지막으로 한 번
      // 더 막는다 — 이벤트 기록 실패가 render()/setChapterDone() 호출부로
      // 전파되어 화면 동작을 막는 일은 절대 없어야 한다.
      console.warn('[launchdesk] product event 기록 준비 중 오류(' + eventName + '):', err && err.message);
    }
  }

  window.launchdeskProductEvents = {
    track: trackProductEvent
  };
})();
