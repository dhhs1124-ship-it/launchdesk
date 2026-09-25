/* Meta 픽셀 — 동의 후에만 로드하는 로더 + 분석·광고 측정 통합 안내창의 Meta 쪽 동작.

   원칙(analytics-consent.js와 같은 Basic Consent):
   - 동의(granted)가 저장돼 있기 전에는 connect.facebook.net 스크립트를
     붙이지 않고 fbq도 정의하지 않는다 — 어떤 이벤트도 나가지 않는다.
     noscript 추적 이미지도 두지 않는다.
   - GA4 분석 동의와는 저장 키가 따로다(ld-meta-pixel-consent-v1). 안내창은
     하나(#analyticsConsentBanner)지만 두 항목을 체크박스로 각각 고른다:
       "모두 허용하지 않음" → GA4·Meta 둘 다 거부
       "선택 저장"         → 체크한 항목만 허용, 나머지는 거부
       "모두 허용"         → 둘 다 허용
     GA4 쪽 저장·적용은 analytics-consent.js가 그대로 맡고(버튼 리스너 +
     launchdeskAnalyticsConsentControl), 이 파일은 Meta 쪽만 저장·적용한다.
   - meta-pixel-core.js의 ENABLED가 false면 아무 것도 하지 않는다 — 안내창은
     기존 GA4 전용 모습 그대로다(개인정보처리방침 게시 전 안전장치,
     docs/meta-pixel-rollout.md).

   PageView:
   - 해시 라우팅이라 실제 페이지 로드가 없으므로, 첫 화면 1회 + hashchange마다
     직접 보낸다. 픽셀의 SPA 자동 PageView(history 감지)는 disablePushState로
     끄고, 픽셀 자체의 중복 억제 대신 core.createPageViewTracker()로 "같은
     화면 연속 기록 금지"를 판정한다(allowDuplicatePageViews는 A → B → A의
     두 번째 A가 픽셀 쪽에서 버려지지 않게 하기 위함).
   - 동의 버튼을 누른 순간에는 hashchange가 없으므로 그때 현재 화면을 1회
     보낸다(이미 보낸 화면이면 보내지 않음).
   - 주소에 인증 토큰·OAuth 복귀 값이 남아 있으면 보내지 않는다
     (core.isSafeLocation) — 픽셀은 현재 URL 전체를 함께 전송하기 때문이다.
   - 자동 이벤트 설정(버튼 클릭·페이지 메타데이터 수집)은 autoConfig false로
     끄고, 고급 매칭(이메일 등) 값은 init에 넘기지 않는다.
   - 회원가입(CompleteRegistration) 등 PageView 외 이벤트는 보내지 않는다. */
(function(){
  'use strict';
  var core = window.launchdeskMetaPixelCore;
  if(!core || !core.ENABLED) return;

  var gaCtl = window.launchdeskAnalyticsConsentControl || null;
  var banner = document.getElementById('analyticsConsentBanner');
  var titleEl = document.getElementById('analyticsConsentTitle');
  var descEl = document.getElementById('analyticsConsentDesc');
  var statusEl = document.getElementById('analyticsConsentStatus');
  var choicesEl = document.getElementById('consentChoices');
  var choiceGa = document.getElementById('consentChoiceGa');
  var choiceMeta = document.getElementById('consentChoiceMeta');
  var saveBtn = document.getElementById('consentSaveChoices');
  var allowBtn = document.getElementById('analyticsConsentAllow');
  var denyBtn = document.getElementById('analyticsConsentDeny');
  var settingsLink = document.getElementById('analyticsSettingsLink');

  var currentStatus = null; // 'granted' | 'denied' | null
  var loaded = false;
  var tracker = core.createPageViewTracker();

  function readConsent(){
    var raw = null;
    try{ raw = localStorage.getItem(core.STORAGE_KEY); }catch(e){}
    return core.parse(raw);
  }
  function saveConsent(status){
    try{ localStorage.setItem(core.STORAGE_KEY, core.serialize(status)); }catch(e){}
  }

  // Meta 기본 코드와 같은 fbq 큐 스텁 — 스크립트 로드 전 호출은 큐에 쌓였다가
  // fbevents.js가 로드되면 처리된다. 평생 1회만 실행한다.
  function loadPixel(){
    if(loaded) return;
    loaded = true;
    var n = window.fbq = function(){
      if(n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments);
    };
    if(!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    n.disablePushState = true;
    n.allowDuplicatePageViews = true;
    window.fbq('set', 'autoConfig', false, core.PIXEL_ID);
    window.fbq('init', core.PIXEL_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }

  function trackCurrentPage(){
    if(currentStatus !== 'granted' || !loaded || typeof window.fbq !== 'function') return;
    if(!core.isSafeLocation(location.hash, location.search)) return;
    if(!tracker.shouldSend(core.routeOf(location.hash))) return;
    window.fbq('track', 'PageView');
  }

  function applyGranted(){
    var wasLoaded = loaded;
    currentStatus = 'granted';
    if(wasLoaded) window.fbq('consent', 'grant'); else loadPixel();
    trackCurrentPage();
  }

  function applyDenied(){
    if(loaded && typeof window.fbq === 'function') window.fbq('consent', 'revoke');
    currentStatus = 'denied';
    deleteMetaCookies();
  }

  function deleteMetaCookies(){
    try{
      document.cookie.split(';').forEach(function(pair){
        var name = pair.split('=')[0].trim();
        if(name === '_fbp' || name === '_fbc'){
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname.replace(/^www\./, '');
        }
      });
    }catch(e){}
  }

  function setMeta(status){
    saveConsent(status);
    if(status === core.STATUSES.GRANTED) applyGranted(); else applyDenied();
  }

  // ---------------------------------------------------------------- 통합 안내창
  function gaStatus(){ return gaCtl ? gaCtl.getStatus() : null; }
  function label(status){ return status === 'granted' ? '허용됨' : (status === 'denied' ? '허용 안 함' : '선택 안 함'); }

  // 안내창을 열 때마다 체크박스를 저장된 상태로 맞춘다(결정 전에는 둘 다 해제).
  function syncChoices(){
    if(choiceGa) choiceGa.checked = gaStatus() === 'granted';
    if(choiceMeta) choiceMeta.checked = currentStatus === 'granted';
    if(statusEl){
      if(gaStatus() || currentStatus){
        statusEl.hidden = false;
        statusEl.textContent = '현재 상태: 이용 분석 ' + label(gaStatus()) + ' · 광고 측정 ' + label(currentStatus);
      }else{
        statusEl.hidden = true;
        statusEl.textContent = '';
      }
    }
  }

  if(banner){
    if(titleEl) titleEl.textContent = '분석·광고 측정 설정';
    if(descEl) descEl.hidden = true;
    if(choicesEl) choicesEl.hidden = false;
    if(saveBtn) saveBtn.hidden = false;
    if(allowBtn) allowBtn.textContent = '모두 허용';
    if(denyBtn) denyBtn.textContent = '모두 허용하지 않음';
    if(settingsLink) settingsLink.textContent = '분석·광고 설정';
  }

  // "모두 허용"/"모두 허용하지 않음" — GA4 쪽은 analytics-consent.js의 기존 리스너가
  // 먼저 처리하고(등록 순서), 여기서는 Meta만 같은 결정으로 저장한다.
  if(allowBtn) allowBtn.addEventListener('click', function(){ setMeta(core.STATUSES.GRANTED); });
  if(denyBtn) denyBtn.addEventListener('click', function(){ setMeta(core.STATUSES.DENIED); });
  if(saveBtn){
    saveBtn.addEventListener('click', function(){
      if(gaCtl){
        if(choiceGa && choiceGa.checked) gaCtl.grant(); else gaCtl.deny();
      }
      setMeta(choiceMeta && choiceMeta.checked ? core.STATUSES.GRANTED : core.STATUSES.DENIED);
      if(gaCtl) gaCtl.hideBanner();
    });
  }
  // 푸터 링크로 다시 열 때 — analytics-consent.js가 먼저 안내창을 띄우고, 여기서 체크 상태를 맞춘다.
  if(settingsLink) settingsLink.addEventListener('click', syncChoices);

  window.addEventListener('hashchange', trackCurrentPage);

  var initial = readConsent();
  currentStatus = initial ? initial.status : null;
  if(core.isGranted(initial)) applyGranted(); // 첫 화면 PageView 1회
  // GA4는 이미 결정했지만 Meta는 아직인 경우(기존 방문자)에도 안내창을 한 번 띄운다.
  if(!initial && gaCtl && banner && banner.hidden) gaCtl.showBanner();
  syncChoices();

  window.launchdeskMetaPixel = {
    getStatus: function(){ return currentStatus; }
  };
})();
