/* Supabase client 초기화 전용 파일.
   index.html이 이 파일보다 먼저 Supabase JS(UMD) 라이브러리를 로드하고,
   이 파일은 app.js보다 먼저 로드된다(순서는 index.html 하단 <script>
   나열 순서를 그대로 따름 — 전부 동기 스크립트라 문서 순서대로 실행됨).

   client는 window.launchdeskSupabase 라는 이름으로만 노출한다 — 라이브러리
   자체의 전역 이름(window.supabase)이나 app.js/tools.js/setup.js의 기존
   전역 변수 어느 것과도 겹치지 않게 하기 위함.

   보안 주의: 아래 키는 반드시 Publishable(anon) key만 사용한다. 이 파일은
   브라우저에 그대로 노출되는 정적 파일이므로 service_role/secret key는
   여기(혹은 어떤 클라이언트 파일)에도 절대 넣지 않는다. */
(function(){
  // TODO: 실제 프로젝트 값으로 교체하세요 (Supabase 대시보드 > Project Settings > API)
  var SUPABASE_URL = 'https://zzhvckikonnalqnyatgn.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hu9XkhXJKyoWVL7zMQD8_g_iMmDymMK';

  if(typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function'){
    console.error('[launchdesk] Supabase JS 라이브러리를 찾을 수 없어요. index.html의 <script> 순서를 확인하세요 (Supabase CDN → supabase-client.js → app.js).');
    return;
  }
  if(SUPABASE_URL.indexOf('YOUR-PROJECT-REF') !== -1 || SUPABASE_PUBLISHABLE_KEY.indexOf('YOUR-PUBLISHABLE-KEY') !== -1){
    console.warn('[launchdesk] supabase-client.js에 실제 Project URL / Publishable key를 아직 넣지 않았어요. 로그인/회원가입이 동작하지 않습니다.');
  }

  window.launchdeskSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
})();
