/* 회원가입 필수 동의(이용약관 · 개인정보 수집·이용) — 순수 로직 모듈
   (DOM/Supabase 없음). analytics-consent-core.js와 같은 방식으로
   policy-consent.js(화면)와 tests/policy-consent-core.test.js(검증)가
   같은 함수를 쓴다. 브라우저에서는 window.launchdeskPolicyConsentCore로,
   Node에서는 module.exports로 노출된다.

   정책 버전 상수는 이 파일 한 곳에서만 정의한다(요구사항 — 여러 파일에
   중복 작성 금지). DB 마이그레이션은 이 값을 알지 못하고 문자열을 그대로
   저장만 한다.

   pending consent(sessionStorage)는 "동의를 완료했다는 증거"가 아니라
   OAuth 왕복/이메일 인증 대기처럼 저장 시점과 user_id 확정 시점이 갈라지는
   구간을 잇는 임시 신호일 뿐이다 — 실제 동의 확정은 항상 DB insert 후
   재조회로만 판정한다(policy-consent.js 참고). 그래서 여기서 하는 일은
   "이 pending이 지금도 유효한 신호인가"(버전 일치 · 허용된 source ·
   TTL 이내)만 판정하는 것으로 좁게 제한된다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskPolicyConsentCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var TERMS_VERSION = '2026-09-18';   // 이용약관 시행일
  var PRIVACY_VERSION = 'v1.1';       // 개인정보처리방침 버전(시행일 2026-09-22 — Cafe24/Meta 연동·ad_margin_links 반영)
  var PENDING_KEY = 'ld-pending-policy-consent';
  // OAuth 왕복(구글 동의 화면 포함)이 비정상적으로 오래 걸리는 경우까지
  // 감안한 여유값. 이보다 오래된 pending은 다른 로그인 시도의 잔재일 수
  // 있어 신뢰하지 않는다(요구사항 4 — TTL 검증).
  var PENDING_TTL_MS = 15 * 60 * 1000;
  var SOURCES = { EMAIL_SIGNUP: 'email_signup', GOOGLE_OAUTH: 'google_oauth', EXISTING_USER_GATE: 'existing_user_gate' };
  var SOURCE_VALUES = [SOURCES.EMAIL_SIGNUP, SOURCES.GOOGLE_OAUTH, SOURCES.EXISTING_USER_GATE];

  function isAllowedSource(source){ return SOURCE_VALUES.indexOf(source) !== -1; }

  function serializePending(source, nowMs){
    if(!isAllowedSource(source)) throw new Error('invalid pending consent source: ' + source);
    return JSON.stringify({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      source: source,
      createdAt: (typeof nowMs === 'number') ? nowMs : Date.now()
    });
  }

  // raw: sessionStorage.getItem()이 돌려주는 값(문자열 또는 null). 형식이
  // 안 맞거나, 지금 정책 버전과 다르거나, 허용되지 않은 source거나, TTL이
  // 지났으면 전부 "유효하지 않음"(null)으로 통일한다 — 호출부는 null이면
  // pending을 아예 없던 것으로 다룬다(analytics-consent-core.js와 같은
  // "저장값 없음" 원칙).
  function parsePending(raw, nowMs){
    if(typeof raw !== 'string' || raw === '') return null;
    var data;
    try{ data = JSON.parse(raw); }catch(e){ return null; }
    if(!data || typeof data !== 'object') return null;
    if(data.termsVersion !== TERMS_VERSION || data.privacyVersion !== PRIVACY_VERSION) return null;
    if(!isAllowedSource(data.source)) return null;
    if(typeof data.createdAt !== 'number' || !isFinite(data.createdAt)) return null;
    var now = (typeof nowMs === 'number') ? nowMs : Date.now();
    if(now - data.createdAt > PENDING_TTL_MS || data.createdAt > now) return null;
    return { source: data.source, createdAt: data.createdAt };
  }

  // insert 응답의 error.code가 'unique_violation'(23505)인지만 판별한다.
  // 이 값 자체를 "동의 완료"로 취급하지 않는다 — 호출부는 이 결과와
  // 무관하게 항상 재조회로 실제 행 존재를 확인한다(요구사항 2).
  function isDuplicateInsertError(error){
    return !!error && error.code === '23505';
  }

  return {
    TERMS_VERSION: TERMS_VERSION,
    PRIVACY_VERSION: PRIVACY_VERSION,
    PENDING_KEY: PENDING_KEY,
    PENDING_TTL_MS: PENDING_TTL_MS,
    SOURCES: SOURCES,
    isAllowedSource: isAllowedSource,
    serializePending: serializePending,
    parsePending: parsePending,
    isDuplicateInsertError: isDuplicateInsertError
  };
});
