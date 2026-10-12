/* GA4 Basic Consent 로더 + 동의 배너 UI.

   원칙: 동의(granted)가 저장돼 있기 전에는 googletagmanager.com/
   google-analytics.com로 어떤 요청도 나가지 않는다 — Consent Mode의
   denied 신호를 보내는 방식이 아니라, 스크립트 자체를 아예 붙이지 않는다
   (최초 동의 전의 Basic Consent는 그대로 유지).

   app.js/setup.js/tools.js의 모든 GA4 이벤트 호출은 이미
   `typeof gtag === 'function'` 가드를 쓰고 있으므로(2026-09-15 감사 반영),
   이 파일이 gtag를 정의하지 않는 한 그 호출들은 전부 조용히 no-op된다 —
   그래서 이 파일은 그 파일들을 전혀 건드리지 않는다.

   페이지 최초 진입 시 이미 granted가 저장돼 있으면, 이 스크립트는
   app.js보다 먼저 실행되므로(index.html의 script 순서) applyGranted()가
   render()보다 먼저 gtag를 준비해 둔다 — render()의 기존 page_view
   호출이 그대로 1회 발생한다(중복 전송 없음). 반대로 배너 버튼 클릭으로
   "지금" 동의가 바뀌는 경우는 hashchange가 없어 render()가 다시 돌지
   않으므로, 그때만 window.launchdeskSendPageView()로 수동 1회 전송한다.

   ── 허용 → 거부(철회) 처리는 Google 공식 Consent Mode 가이드의 "Change
   user consent choices / Revoking consent"를 따른다
   (https://developers.google.com/tag-platform/security/guides/consent):
   이미 로드된 GA4 런타임에는 window.gtag를 no-op으로 바꾸는 것만으로
   내부 리스너(향상된 측정: 스크롤·이탈 클릭 등)와 자동 전송까지
   멈춘다고 보장할 수 없다. 그래서
     1) gtag('consent','update',{...denied})로 GA4 런타임 자체에 중단을
        정식으로 알리고,
     2) window['ga-disable-<측정ID>']=true로 gtag.js가 이 측정 ID의
        모든 히트 전송 전에 항상 확인하는 킬스위치를 추가로 켜고,
     3) 우리 자신이 만드는 이벤트(page_view 등)는 guardedGtag가
        currentStatus를 최종 게이트로 다시 한번 확인해 아예 dataLayer에
        올리지도 않는다.
   window.gtag 자체는 절대 destroy/재할당하지 않는다 — 그래야 같은
   페이지에서 재허용했을 때 되살릴 방법이 남는다(요구사항).

   ── 인증 복귀 주소(2026-10-12 핫픽스): Supabase 로그인 · 이메일 인증에서 돌아온 주소에는 토큰
   (#access_token=…)이나 인증 코드(?code=…)가 실린다. GA4 자동 수집은 그때의 주소를 함께 보낸다 — 운영
   gtag.js를 로컬에서 실행해 보니 양식 이벤트의 form_destination에 # 뒤 토큰까지, 스크롤 등의 페이지
   주소에 ?code=가 실렸다. 그래서 이런 주소로 열린 문서에서는 Supabase가 주소를 처리한 뒤
   (auth.initialize 완료 — 성공 · 실패 모두) 남은 인증 값을 주소에서 지우고 나서만 gtag.js를 불러온다.
   처리 전에는 주소를 건드리지 않는다(로그인을 깨지 않게). 성공이면 SDK가 이미 지웠고, 실패면 SDK가
   남겨 둔 값을 여기서 지운다. Supabase 클라이언트가 없으면 처리할 주체가 없으므로 이 문서에서는 불러오지
   않는다. 그동안 앱이 보낸 이벤트(page_view는 app.js가 안전한 주소 · 경로로 만든다)는 dataLayer
   대기열에만 있고, 불러온 뒤 깨끗한 주소 기준으로 전송된다. 이전 페이지 주소(page_referrer)에 인증
   값이 있으면 그 값만 뺀 주소를 config에 넣는다(이후 모든 요청). */
(function(){
  'use strict';
  var core = window.launchdeskAnalyticsConsent;
  if(!core) return; // analytics-consent-core.js가 없으면 아무 것도 하지 않는다(안전한 no-op)

  var GA_ID = 'G-H3D0EDRZL5';
  var GA_DISABLE_KEY = 'ga-disable-' + GA_ID;
  var gaReady = false;        // dataLayer/gtag 정의 + config까지 끝났는지(평생 1회만 true로)
  var scriptLoaded = false;   // gtag.js 삽입 여부 — 주소가 깨끗해진 뒤에만(아래 whenAddressReady)
  var realGtag = null;        // dataLayer.push 스텁 — GA4 런타임과 실제로 통신하는 유일한 통로
  var currentStatus = null;   // 'granted' | 'denied' | null — guardedGtag의 최종 게이트가 읽는 실시간 상태

  // window.gtag로 영구히 고정되는 함수. 'consent'/'js'/'config'는 GA4
  // 런타임과의 기반 통신이라 항상 통과시켜야 revoke/재허용 신호 자체가
  // 막히지 않는다. 그 외(예: 'event')는 currentStatus가 granted일 때만
  // dataLayer에 올린다 — denied 동안은 앱이 아무리 호출해도 조용히 버려져
  // dataLayer도, 그로 인한 네트워크 요청도 발생하지 않는다.
  function guardedGtag(){
    var command = arguments[0];
    if(command === 'consent' || command === 'js' || command === 'config' || currentStatus === 'granted'){
      realGtag.apply(null, arguments);
    }
  }

  function readConsent(){
    var raw = null;
    try{ raw = localStorage.getItem(core.STORAGE_KEY); }catch(e){ /* 프라이빗 모드 등 저장소 접근 불가 — 저장값 없음으로 취급 */ }
    return core.parse(raw);
  }

  function saveConsent(status){
    try{ localStorage.setItem(core.STORAGE_KEY, core.serialize(status)); }catch(e){ /* 저장 실패해도 이번 세션 동작은 계속 — 다음 방문에 다시 물어보게 됨 */ }
  }

  // ── 인증 복귀 주소 — 위 설명. 주소가 깨끗해질 때까지 gtag.js 삽입만 미룬다.
  var addressReady = !core.hasAuthParams(location.search, location.hash);
  var afterAddress = [];
  function whenAddressReady(fn){ if(addressReady) fn(); else afterAddress.push(fn); }
  if(!addressReady){
    var auth = window.launchdeskSupabase && window.launchdeskSupabase.auth;
    if(auth && typeof auth.initialize === 'function'){
      var finishAddress = function(){
        var clean = core.withoutAuthParams(location.search, location.hash);
        if(clean.search !== location.search || clean.hash !== location.hash){
          try{ history.replaceState(history.state, '', location.pathname + clean.search + clean.hash); }
          catch(e){ return; } // 지우지 못하면 이 문서에서는 불러오지 않는다
        }
        addressReady = true;
        afterAddress.splice(0).forEach(function(fn){ fn(); });
      };
      // initialize()는 SDK가 생성 때 시작한 처리의 같은 promise를 돌려준다(새로 처리하지 않음)
      Promise.resolve().then(function(){ return auth.initialize(); }).then(finishAddress, finishAddress);
    }
  }

  function loadScript(){
    whenAddressReady(function(){
      if(scriptLoaded || currentStatus !== 'granted') return; // 기다리는 사이 거부했으면 불러오지 않는다
      scriptLoaded = true;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
      // 로드 실패해도 gtag는 이미 dataLayer.push 스텁이라 계속 조용히 쌓이기만 할 뿐,
      // 서비스 기능에는 아무 영향이 없다.
      document.head.appendChild(s);
    });
  }

  // 최초 허용이든(스크립트 없음) 거부 뒤 재허용이든(스크립트 이미 있음)
  // 이 한 함수로 처리한다 — 재허용 시 스크립트를 중복 삽입하지 않는다.
  function applyGranted(){
    if(gaReady){
      window[GA_DISABLE_KEY] = false;
      currentStatus = 'granted';
      window.gtag('consent', 'update', {
        analytics_storage: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
      loadScript(); // 인증 복귀 처리 중에 거부했다가 다시 허용한 경우 — 아직 안 불렀으면 불러온다
      return;
    }
    currentStatus = 'granted';
    window.dataLayer = window.dataLayer || [];
    realGtag = function(){ window.dataLayer.push(arguments); };
    window.gtag = guardedGtag; // 이후 다시는 재할당하지 않는다
    realGtag('js', new Date());
    var config = { send_page_view: false }; // app.js render()가 hash 라우팅에 맞춰 수동으로 page_view를 보냄
    var referrer = document.referrer || '';
    var safeRef = core.safeReferrer(referrer);
    if(safeRef !== referrer) config.page_referrer = safeRef; // 인증 값이 있을 때만 — 없으면 gtag 기본값(document.referrer)
    realGtag('config', GA_ID, config);
    gaReady = true;
    loadScript();
  }

  function applyDenied(){
    if(gaReady){
      // 유효한 gtag 참조를 잃기 전에(사실 이 구조에서는 절대 잃지 않는다)
      // 공식 consent update부터 먼저 보낸다 — guardedGtag가 'consent'
      // 명령은 currentStatus와 무관하게 항상 통과시키므로 여기서 막히지
      // 않는다.
      window.gtag('consent', 'update', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied'
      });
      window[GA_DISABLE_KEY] = true; // gtag.js가 이 측정 ID의 모든 전송 전에 확인하는 추가 킬스위치
    }
    currentStatus = 'denied'; // 이후 앱이 gtag('event', ...)를 호출해도 guardedGtag가 조용히 버린다
  }

  function deleteGaCookies(){
    try{
      document.cookie.split(';').forEach(function(pair){
        var name = pair.split('=')[0].trim();
        if(/^_ga(_.*)?$/.test(name)){
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        }
      });
    }catch(e){ /* 쿠키 접근 불가 환경 — 무시 */ }
  }

  var banner = document.getElementById('analyticsConsentBanner');
  var statusEl = document.getElementById('analyticsConsentStatus');
  var allowBtn = document.getElementById('analyticsConsentAllow');
  var denyBtn = document.getElementById('analyticsConsentDeny');
  var settingsLink = document.getElementById('analyticsSettingsLink');

  // 배너가 position:fixed로 화면 하단에 붙기 때문에, 그 높이만큼 body 아래에
  // 여백을 만들어 두지 않으면 짧은 페이지에서는 푸터(개인정보처리방침·분석
  // 설정 링크 포함)를 가려버린다. 배너를 띄울 때만 실제 높이를 재서 body에
  // 반영하고, 폭이 바뀌어 배너가 줄바꿈되는 경우(예: 세로 모드 회전)에도
  // 다시 재도록 resize에 맞춰 갱신한다.
  function syncBodyPadding(){
    if(banner && !banner.hidden){
      document.body.style.paddingBottom = banner.offsetHeight + 'px';
    }
  }
  window.addEventListener('resize', syncBodyPadding);

  function showBanner(parsed){
    if(!banner) return;
    if(statusEl){
      if(parsed){
        statusEl.hidden = false;
        statusEl.textContent = '현재 상태: ' + (core.isGranted(parsed) ? '허용됨' : '허용 안 함');
      }else{
        statusEl.hidden = true;
        statusEl.textContent = '';
      }
    }
    banner.hidden = false;
    syncBodyPadding();
  }
  function hideBanner(){
    if(!banner) return;
    banner.hidden = true;
    document.body.style.paddingBottom = '';
  }

  function grantByUser(){
    var wasGranted = currentStatus === 'granted';
    saveConsent(core.STATUSES.GRANTED);
    applyGranted();
    // 이미 granted였는데 배너를 다시 열어 또 "허용"을 누른 경우(상태 변화 없음)는
    // 중복 전송 금지 원칙에 따라 page_view를 다시 보내지 않는다.
    if(!wasGranted && typeof window.launchdeskSendPageView === 'function'){
      window.launchdeskSendPageView();
    }
  }
  function denyByUser(){
    saveConsent(core.STATUSES.DENIED);
    applyDenied();
    deleteGaCookies();
  }

  if(allowBtn){
    allowBtn.addEventListener('click', function(){ grantByUser(); hideBanner(); });
  }
  if(denyBtn){
    denyBtn.addEventListener('click', function(){ denyByUser(); hideBanner(); });
  }
  if(settingsLink){
    settingsLink.addEventListener('click', function(){
      showBanner(currentStatus ? { status: currentStatus } : null);
    });
  }

  var initial = readConsent();
  currentStatus = initial ? initial.status : null;
  if(core.isGranted(initial)){
    applyGranted(); // app.js render()보다 먼저 실행되어 자연스러운 초회 page_view를 만든다
  }else if(!initial){
    showBanner(null); // 저장값 없음(잘못된 JSON·버전 포함) → 배너 표시
  }
  // denied면 아무 것도 하지 않는다 — 배너 숨김 유지, gtag 미정의 유지.

  // 같은 안내창에서 GA4와 Meta 광고 측정을 각각 고르는 "선택 저장"(meta-pixel.js)이
  // GA4 쪽 결정을 버튼 클릭과 똑같은 경로로 저장할 수 있게 여는 최소 접점.
  window.launchdeskAnalyticsConsentControl = {
    getStatus: function(){ return currentStatus; },
    grant: grantByUser,
    deny: denyByUser,
    showBanner: function(){ showBanner(currentStatus ? { status: currentStatus } : null); },
    hideBanner: hideBanner
  };
})();
