/* Meta 픽셀 광고 추적 동의 · PageView 판정 — 순수 로직 모듈 (DOM 없음).

   meta-pixel.js(화면·로더)와 tests/meta-pixel.test.js(검증)가 같은 함수를
   쓴다. 브라우저에서는 window.launchdeskMetaPixelCore 로, Node에서는
   module.exports 로 노출된다(analytics-consent-core.js와 같은 방식).

   GA4 분석 동의(ld-analytics-consent-v1)와는 저장 키·상태가 완전히 따로다 —
   한쪽을 허용/거부해도 다른 쪽은 바뀌지 않는다.

   ENABLED: 개인정보처리방침 v1.4(2026년 9월 25일 시행, Meta 픽셀 선택 동의 반영)와
   함께 true로 켰다. false로 바꾸면 안내창은 GA4 전용으로 돌아가고, 저장값이
   granted여도 스크립트를 로드하지 않는다(긴급 중단 스위치).
   공개 절차는 docs/meta-pixel-rollout.md 참고. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskMetaPixelCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var ENABLED = true;
  var PIXEL_ID = '1921995005433525';
  var STORAGE_KEY = 'ld-meta-pixel-consent-v1';
  var CURRENT_VERSION = 1;
  var STATUSES = { GRANTED: 'granted', DENIED: 'denied' };

  // 저장값이 없거나 형식·버전이 다르면 전부 null("아직 결정 안 함").
  function parse(raw){
    if(typeof raw !== 'string' || raw === '') return null;
    var data;
    try{ data = JSON.parse(raw); }catch(e){ return null; }
    if(!data || typeof data !== 'object') return null;
    if(data.version !== CURRENT_VERSION) return null;
    if(data.status !== STATUSES.GRANTED && data.status !== STATUSES.DENIED) return null;
    return { status: data.status, version: data.version, updatedAt: data.updatedAt };
  }

  function serialize(status){
    if(status !== STATUSES.GRANTED && status !== STATUSES.DENIED){
      throw new Error('invalid meta pixel consent status: ' + status);
    }
    return JSON.stringify({ status: status, version: CURRENT_VERSION, updatedAt: new Date().toISOString() });
  }

  function isGranted(parsed){ return !!parsed && parsed.status === STATUSES.GRANTED; }

  // 픽셀은 PageView에 현재 주소(location.href) 전체를 싣는다 — 전송 URL을
  // 우리가 고쳐 보낼 방법이 없으므로, 주소 자체가 안전할 때만 보낸다.
  // 이 앱의 정상 라우트는 해시가 없거나 '#/'로 시작한다. 인증 콜백
  // ('#access_token=...' 등)이나 OAuth 복귀 쿼리(?code= 등)가 남아 있는
  // 동안에는 보내지 않는다(app.js safePageLocation()과 같은 기준).
  var UNSAFE_QUERY_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state', 'access_token', 'refresh_token', 'token', 'token_hash', 'type'];
  function isSafeLocation(hash, search){
    hash = hash || '';
    if(hash !== '' && hash !== '#' && hash.indexOf('#/') !== 0) return false;
    if(search){
      var q = String(search).replace(/^\?/, '');
      var names = q.split('&').map(function(pair){ return decodeURIComponentSafe(pair.split('=')[0]).toLowerCase(); });
      for(var i = 0; i < names.length; i++){
        if(UNSAFE_QUERY_PARAMS.indexOf(names[i]) !== -1) return false;
      }
    }
    return true;
  }
  function decodeURIComponentSafe(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }

  function routeOf(hash){
    var h = (hash || '').replace(/^#/, '');
    return h || '/';
  }

  // 같은 화면을 연달아 두 번 기록하지 않는다(A → A 재실행, 동의 직후 +
  // 곧이은 hashchange 등). 다른 화면을 들렀다 돌아오면(A → B → A) 새 조회로
  // 본다 — app.js의 GA4 page_view와 같은 기준.
  function createPageViewTracker(){
    var lastRoute = null;
    return {
      shouldSend: function(route){
        if(route === lastRoute) return false;
        lastRoute = route;
        return true;
      },
      reset: function(){ lastRoute = null; }
    };
  }

  return {
    ENABLED: ENABLED,
    PIXEL_ID: PIXEL_ID,
    STORAGE_KEY: STORAGE_KEY,
    CURRENT_VERSION: CURRENT_VERSION,
    STATUSES: STATUSES,
    parse: parse,
    serialize: serialize,
    isGranted: isGranted,
    isSafeLocation: isSafeLocation,
    routeOf: routeOf,
    createPageViewTracker: createPageViewTracker
  };
});
