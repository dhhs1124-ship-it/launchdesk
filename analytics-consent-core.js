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

  // ── 인증 복귀 주소(2026-10-12) ─────────────────────────────────────────────
  // Supabase 로그인 · 이메일 인증에서 돌아온 주소에는 토큰(#access_token=…&refresh_token=…)이나
  // 인증 코드 · 오류(?code=… · ?error=…)가 실린다. GA4 자동 수집은 그때의 주소를 함께 보내므로
  // (양식 이벤트의 form_destination에는 # 뒤까지 — 로컬 관찰) analytics-consent.js는 이 값이 주소에서
  // 지워진 뒤에만 gtag.js를 불러오고, 이전 페이지 주소(page_referrer)에서도 이 값만 뺀다.
  // 이름 목록은 clarity-consent-core.js · meta-pixel-core.js의 UNSAFE_QUERY_PARAMS에 SDK가 해시로 받는
  // 토큰 이름(provider_token 등)을 더한 것이다.
  var AUTH_PARAMS = ['code', 'state', 'error', 'error_code', 'error_description', 'access_token', 'refresh_token',
    'provider_token', 'provider_refresh_token', 'token', 'token_hash', 'type', 'expires_in', 'expires_at', 'token_type'];
  function decodeName(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }
  function isAuthPair(pair){ return AUTH_PARAMS.indexOf(decodeName(pair.split('=')[0]).toLowerCase()) !== -1; }
  function pairsOf(part){ return String(part || '').replace(/^[?#]/, '').split('&').filter(Boolean); }
  function isRouteHash(hash){ return !hash || hash === '#' || hash.indexOf('#/') === 0; }
  function isAuthHash(hash){ return !isRouteHash(hash) && pairsOf(hash).some(isAuthPair); }

  // 주소에 인증 값이 남아 있는지 — 쿼리의 인증 이름, 또는 화면 경로(#/…)가 아닌 해시의 인증 이름
  function hasAuthParams(search, hash){ return pairsOf(search).some(isAuthPair) || isAuthHash(hash); }
  // 인증 값을 뺀 search · hash — 쿼리는 인증 이름만 빼고(utm 등은 남김), 인증 해시는 통째로 뺀다(화면 경로 해시는 그대로)
  function withoutAuthParams(search, hash){
    var kept = pairsOf(search).filter(function(pair){ return !isAuthPair(pair); });
    return { search: kept.length ? '?' + kept.join('&') : '', hash: isAuthHash(hash) ? '' : (hash || '') };
  }
  // page_referrer — 이전 페이지 주소에서 인증 값만 뺀다(출처 · 경로 · utm은 남겨 유입 분석 유지). 해시는 보내지 않는다.
  function safeReferrer(ref){
    if(!ref) return '';
    var m = /^([^?#]*)(\?[^#]*)?/.exec(String(ref));
    return m[1] + withoutAuthParams(m[2] || '', '').search;
  }

  function isGranted(parsed){ return !!parsed && parsed.status === STATUSES.GRANTED; }
  function isDenied(parsed){ return !!parsed && parsed.status === STATUSES.DENIED; }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CURRENT_VERSION: CURRENT_VERSION,
    STATUSES: STATUSES,
    parse: parse,
    serialize: serialize,
    hasAuthParams: hasAuthParams,
    withoutAuthParams: withoutAuthParams,
    safeReferrer: safeReferrer,
    isGranted: isGranted,
    isDenied: isDenied
  };
});
