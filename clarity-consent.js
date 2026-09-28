/* Microsoft Clarity — 동의 후에만 로드하는 로더 + 통합 안내창의 "방문 행동 분석" 항목.

   원칙(analytics-consent.js · meta-pixel.js와 같은 Basic Consent):
   - 동의(granted)가 저장돼 있기 전에는 clarity.ms 스크립트를 붙이지 않고
     window.clarity도 정의하지 않는다 — index.html <head>에 Clarity 설치 스니펫을
     직접 넣지 않는다(스니펫은 로드 즉시 clarity.ms를 호출한다).
   - 저장 키는 GA4·Meta와 따로다(ld-clarity-consent-v1). 그 둘의 동의값을 Clarity
     동의로 간주하지 않는다. 안내창은 하나(#analyticsConsentBanner)이고, GA4·Meta
     항목과 함께 체크박스(#consentChoiceClarity, 기본 해제)로 따로 고른다:
       "모두 허용하지 않음" → 전부 거부 / "선택 저장" → 체크한 항목만 허용 /
       "모두 허용" → 전부 허용 / 푸터 "분석·광고 설정"으로 언제든 변경·철회.
     GA4·Meta 쪽 저장·적용은 각자의 스크립트가 그대로 맡고, 이 파일은 Clarity만 저장·적용한다.

   Meta 픽셀과의 관계(서로 독립):
   - 통합 안내창(선택 목록·"선택 저장"·버튼 문구)은 평소 meta-pixel.js가 연다. Meta가
     긴급 중단(meta-pixel-core.js ENABLED=false)이면 그 창이 열리지 않으므로, 이 파일이 같은 창을
     GA4 + Clarity 두 항목으로 직접 연다(Meta 항목은 숨김, "선택 저장"의 GA4 저장도 여기서 처리).
   - Clarity만 끄려면 clarity-consent-core.js의 ENABLED=false — Clarity 항목만 숨기고 로드하지 않는다.

   철회(가장 중요):
   - Clarity 공식 동의 API(consentv2 denied / consent false)는 전송을 멈추지 않는다 —
     쿠키만 지우고 "동의 없음 모드"로 다시 시작해 방문마다 임시 ID로 계속 전송한다
     (learn.microsoft.com/clarity/setup-and-installation/clarity-consent-api-v2).
     그래서 거부 신호를 보내지 않고, 런타임의 clarity('stop')으로 수집 모듈을 모두 멈춘다
     (stop 뒤 window.clarity는 호출을 큐에만 쌓는 빈 껍데기가 된다). 이어서 이 사이트에
     남은 Clarity 쿠키(_clck, _clsk)와 세션 저장값(_cltk)을 지운다. 같은 화면에서 다시
     허용하면 태그를 새로 불러온다.
   - stop은 종료 처리로 "철회 시점까지 이미 수집돼 대기 중이던 기록"을 마지막으로 1회
     전송한다(런타임 코드와 브라우저 확인 결과, docs/clarity-rollout.md). 그 이후 새로
     발생하는 정보는 전송되지 않는다. 이 1회를 막을 공개 방법은 없어 방침 11번에 그대로 적었다.
   - 이미 Clarity 서버로 전송된 데이터와 clarity.ms·bing.com 도메인의 제3자 쿠키
     (CLID, MUID 등)는 이 사이트에서 지울 수 없다 — 방침 11번 항목에 그대로 안내한다.

   URL:
   - Clarity는 현재 주소 전체를 화면 기록과 함께 전송하므로, 주소에 인증 토큰·OAuth
     복귀 값이 남아 있으면 로드하지 않고 hashchange로 안전한 주소가 되면 그때 로드한다
     (clarity-consent-core.js의 isSafeLocation).

   화면 녹화 마스킹은 이 파일이 아니라 index.html의 data-clarity-mask 속성이 맡는다
   (로그인 후 화면·모달·프로필·토스트). Clarity 대시보드의 Masking 설정은 코드에서 확인할 수 없다. */
(function(){
  'use strict';
  var core = window.launchdeskClarityCore;
  var gaCtl = window.launchdeskAnalyticsConsentControl || null;
  var metaUi = window.launchdeskMetaPixel || null; // null이면 Meta 긴급 중단(또는 미로드) — 통합 안내창을 이 파일이 연다
  var choiceClarity = document.getElementById('consentChoiceClarity');
  if(!core || !gaCtl) return; // analytics-consent.js가 없으면 안내창 동의를 받을 수 없다 → 로드 안 함
  if(!core.ENABLED){
    if(choiceClarity && choiceClarity.parentNode) choiceClarity.parentNode.hidden = true;
    return;
  }

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
  var running = false;      // 태그를 불러와 수집 중인지(철회하면 false)

  function readConsent(){
    var raw = null;
    try{ raw = localStorage.getItem(core.STORAGE_KEY); }catch(e){}
    return core.parse(raw);
  }
  function saveConsent(status){
    try{ localStorage.setItem(core.STORAGE_KEY, core.serialize(status)); }catch(e){}
  }

  function isSafeNow(){ return core.isSafeLocation(location.hash, location.search); }

  // Clarity 공식 설치 스니펫과 같은 큐 스텁 + 태그 삽입. 동의 후에만 호출한다.
  function startClarity(){
    if(running || currentStatus !== 'granted' || !isSafeNow()) return;
    running = true;
    window.clarity = window.clarity || function(){ (window.clarity.q = window.clarity.q || []).push(arguments); };
    // 광고 저장소(ad_Storage)는 쓰지 않는다 — 방문 행동 분석 목적만 동의받았다.
    window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.clarity.ms/tag/' + core.PROJECT_ID;
    document.head.appendChild(s);
  }

  function deleteClarityCookies(){
    try{
      var parts = location.hostname.split('.');
      ['_clck', '_clsk'].forEach(function(name){
        var gone = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        document.cookie = gone;
        // Clarity는 쿠키를 등록 가능한 상위 도메인(.example.co.kr)에 쓴다 — 도메인 후보를 짧은 쪽부터 모두 시도한다.
        for(var i = parts.length - 1; i >= 0; i--){
          document.cookie = gone + '; domain=.' + parts.slice(i).join('.');
        }
      });
      sessionStorage.removeItem('_cltk');
    }catch(e){}
  }

  function stopClarity(){
    if(running && typeof window.clarity === 'function') window.clarity('stop');
    running = false;
    deleteClarityCookies();
  }

  function setClarity(status){
    saveConsent(status);
    currentStatus = status;
    if(status === core.STATUSES.GRANTED) startClarity(); else stopClarity();
  }

  // ---------------------------------------------------------------- 통합 안내창
  function label(status){ return status === 'granted' ? '허용됨' : (status === 'denied' ? '허용 안 함' : '선택 안 함'); }

  // Meta 긴급 중단: meta-pixel.js가 열어 주지 않는 통합 안내창을 GA4 + Clarity 두 항목으로 연다.
  // 문구·푸터 이름은 Meta가 켜졌을 때와 같게 둔다(방침이 "분석·광고 설정"으로 안내하므로).
  if(!metaUi && banner){
    if(titleEl) titleEl.textContent = '분석·광고 측정 설정';
    if(descEl) descEl.hidden = true;
    if(choicesEl) choicesEl.hidden = false;
    if(saveBtn) saveBtn.hidden = false;
    if(choiceMeta && choiceMeta.parentNode) choiceMeta.parentNode.hidden = true;
    if(allowBtn) allowBtn.textContent = '모두 허용';
    if(denyBtn) denyBtn.textContent = '모두 허용하지 않음';
    if(settingsLink) settingsLink.textContent = '분석·광고 설정';
  }

  // Meta가 켜져 있으면 meta-pixel.js의 syncChoices(이용 분석 · 광고 측정)가 먼저 돌고, 여기서 Clarity
  // 항목까지 넣어 상태 줄을 다시 쓴다(이 스크립트가 나중에 로드되므로 마지막 값이 남는다).
  function syncChoices(){
    if(choiceClarity) choiceClarity.checked = currentStatus === 'granted';
    if(!metaUi && choiceGa) choiceGa.checked = gaCtl.getStatus() === 'granted';
    if(statusEl){
      var ga = gaCtl.getStatus(), meta = metaUi ? metaUi.getStatus() : null;
      if(ga || meta || currentStatus){
        statusEl.hidden = false;
        statusEl.textContent = '현재 상태: 이용 분석 ' + label(ga) + (metaUi ? ' · 광고 측정 ' + label(meta) : '') + ' · 방문 행동 분석 ' + label(currentStatus);
      }else{
        statusEl.hidden = true;
        statusEl.textContent = '';
      }
    }
  }

  // "모두 허용"/"모두 허용하지 않음"/"선택 저장" — GA4는 analytics-consent.js가, Meta는 meta-pixel.js가 먼저 처리한다(등록 순서).
  if(allowBtn) allowBtn.addEventListener('click', function(){ setClarity(core.STATUSES.GRANTED); });
  if(denyBtn) denyBtn.addEventListener('click', function(){ setClarity(core.STATUSES.DENIED); });
  if(saveBtn){
    saveBtn.addEventListener('click', function(){
      if(!metaUi){ // Meta가 없으면 "선택 저장"의 GA4 저장·창 닫기도 여기서 한다
        if(choiceGa && choiceGa.checked) gaCtl.grant(); else gaCtl.deny();
        gaCtl.hideBanner();
      }
      setClarity(choiceClarity && choiceClarity.checked ? core.STATUSES.GRANTED : core.STATUSES.DENIED);
    });
  }
  // 푸터 링크로 다시 열 때 — 안내창을 띄우고(analytics-consent.js) 체크 상태를 맞춘다(meta-pixel.js → 여기).
  if(settingsLink) settingsLink.addEventListener('click', syncChoices);

  // 허용이 저장돼 있어도 주소가 안전하지 않아 로드를 미뤘다면, 안전한 화면으로 이동한 뒤 로드한다.
  window.addEventListener('hashchange', startClarity);

  var initial = readConsent();
  currentStatus = initial ? initial.status : null;
  if(core.isGranted(initial)) startClarity();
  // GA4·Meta는 이미 결정했지만 Clarity는 아직인 기존 방문자에게도 안내창을 한 번 띄운다.
  if(!initial && banner && banner.hidden) gaCtl.showBanner();
  syncChoices();

  window.launchdeskClarity = {
    getStatus: function(){ return currentStatus; }
  };
})();
