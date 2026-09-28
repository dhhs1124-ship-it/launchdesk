/* Microsoft Clarity(방문 행동 분석) 동의 상태 — 순수 로직 모듈 (DOM 없음).

   clarity-consent.js(화면·로더)와 tests/clarity-consent.test.js(검증)가 같은
   값을 쓴다. 브라우저에서는 window.launchdeskClarityCore 로, Node에서는
   module.exports 로 노출된다(meta-pixel-core.js와 같은 방식).

   GA4(ld-analytics-consent-v1)·Meta(ld-meta-pixel-consent-v1)와는 저장 키·상태가
   완전히 따로다 — 그 둘의 동의값을 Clarity 동의로 간주하지 않으며, 한쪽을
   바꿔도 다른 쪽은 바뀌지 않는다. 그래서 이미 GA4·Meta를 결정한 기존 방문자도
   Clarity는 "아직 결정 안 함"에서 시작해 안내창을 한 번 더 본다.

   ENABLED: 개인정보처리방침 v1.5와 함께 켠다. false로 바꾸면 안내창의 Clarity
   항목을 숨기고, 저장값이 granted여도 스크립트를 로드하지 않는다(긴급 중단
   스위치 — Clarity만 끈다. Meta 픽셀의 ENABLED와는 서로 독립이다). 공개 절차는
   docs/clarity-rollout.md 참고. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskClarityCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var ENABLED = true;
  var PROJECT_ID = 'yp7ibyta96';
  var STORAGE_KEY = 'ld-clarity-consent-v1';
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
      throw new Error('invalid clarity consent status: ' + status);
    }
    return JSON.stringify({ status: status, version: CURRENT_VERSION, updatedAt: new Date().toISOString() });
  }

  function isGranted(parsed){ return !!parsed && parsed.status === STATUSES.GRANTED; }

  // Clarity는 현재 주소 전체를 화면 기록과 함께 전송한다 — 주소에 인증 토큰·OAuth 복귀 값이 남아
  // 있으면 로드하지 않는다. meta-pixel-core.js의 isSafeLocation과 같은 기준이지만, Meta 긴급 중단·
  // 삭제와 상관없이 동작하도록 따로 둔다(두 구현이 같은 답을 내는지는 tests/clarity-consent.test.js가 확인).
  var UNSAFE_QUERY_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state', 'access_token', 'refresh_token', 'token', 'token_hash', 'type'];
  function isSafeLocation(hash, search){
    hash = hash || '';
    if(hash !== '' && hash !== '#' && hash.indexOf('#/') !== 0) return false;
    if(search){
      var names = String(search).replace(/^\?/, '').split('&').map(function(pair){ return decodeName(pair.split('=')[0]).toLowerCase(); });
      for(var i = 0; i < names.length; i++){
        if(UNSAFE_QUERY_PARAMS.indexOf(names[i]) !== -1) return false;
      }
    }
    return true;
  }
  function decodeName(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }

  return {
    ENABLED: ENABLED,
    PROJECT_ID: PROJECT_ID,
    STORAGE_KEY: STORAGE_KEY,
    CURRENT_VERSION: CURRENT_VERSION,
    STATUSES: STATUSES,
    parse: parse,
    serialize: serialize,
    isGranted: isGranted,
    isSafeLocation: isSafeLocation
  };
});
