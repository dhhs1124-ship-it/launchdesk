/* 분석(GA4) 동의 상태 — 순수 로직 모듈 (DOM 없음).

   analytics-consent.js(화면)와 tests/analytics-consent-core.test.js(검증)가
   같은 함수를 쓴다. 브라우저에서는 window.launchdeskAnalyticsConsent 로,
   Node에서는 module.exports 로 노출된다(margin-calc.js와 같은 방식).

   저장 형식은 문자열 하나가 아니라 JSON — { status, version, updatedAt }.
   저장값이 없거나, JSON 파싱에 실패하거나, version이 CURRENT_VERSION과
   다르거나, status가 granted/denied가 아니면 전부 "저장값 없음"과 동일하게
   취급한다 — 그래야 스키마가 바뀌어도 이전 값을 안전하게 무시하고 새로
   물어볼 수 있다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskAnalyticsConsent = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var STORAGE_KEY = 'ld-analytics-consent-v1';
  var CURRENT_VERSION = 1;
  var STATUSES = { GRANTED: 'granted', DENIED: 'denied' };

  // raw: localStorage.getItem()이 돌려주는 값(문자열 또는 null). 유효하지
  // 않은 모든 경우를 null로 통일 — 호출부는 null이면 "아직 결정 안 함"으로
  // 다룬다(요구사항 3의 "저장값 없음" 규칙).
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
      throw new Error('invalid consent status: ' + status);
    }
    return JSON.stringify({ status: status, version: CURRENT_VERSION, updatedAt: new Date().toISOString() });
  }

  function isGranted(parsed){ return !!parsed && parsed.status === STATUSES.GRANTED; }
  function isDenied(parsed){ return !!parsed && parsed.status === STATUSES.DENIED; }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CURRENT_VERSION: CURRENT_VERSION,
    STATUSES: STATUSES,
    parse: parse,
    serialize: serialize,
    isGranted: isGranted,
    isDenied: isDenied
  };
});
