/* GA4 동의 철회(revoke)/재허용 정밀 동작 검증 — 실행: node --test tests/
   (Node 18+ 내장 test runner, 별도 패키지 없음)

   analytics-consent-core.js + analytics-consent.js 실제 소스를 vm
   샌드박스(최소 DOM 스텁)에서 그대로 실행한다 — 별도 헬퍼가 아니라 진짜
   코드 경로(guardedGtag, applyGranted/applyDenied, 쿠키 삭제)를 지난다.
   패턴은 tests/step-progress-sync.test.js와 동일. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'analytics-consent-core.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'analytics-consent.js'), 'utf8');
const GA_ID = 'G-H3D0EDRZL5';

function memStorage(){
  const s = {};
  return { getItem(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, setItem(k, v){ s[k] = String(v); }, removeItem(k){ delete s[k]; } };
}

function makeEl(){
  const el = { hidden: true, textContent: '', style: {}, offsetHeight: 96, listeners: {} };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.click = () => (el.listeners.click || []).slice().forEach(fn => fn());
  return el;
}

// document.cookie를 진짜 브라우저처럼 "여러 번 대입 = 여러 쿠키 upsert/삭제"로
// 흉내낸다 — deleteGaCookies()가 실제로 지우는지 검증하려면 필요하다.
function makeCookieJar(){
  let jar = {};
  return {
    get value(){ return Object.keys(jar).map(k => k + '=' + jar[k]).join('; '); },
    set value(assignment){
      const first = String(assignment).split(';')[0];
      const eq = first.indexOf('=');
      const name = first.slice(0, eq).trim();
      const val = first.slice(eq + 1);
      const expired = /expires=Thu, 01 Jan 1970/.test(assignment);
      if(expired || val === ''){ delete jar[name]; } else { jar[name] = val; }
    },
    seed(name, val){ jar[name] = val; },
    has(name){ return Object.prototype.hasOwnProperty.call(jar, name); }
  };
}

function boot(opts){
  opts = opts || {}; // 2026-10-12 핫픽스: 저장된 선택 · 주소 · 이전 페이지 주소 · Supabase 클라이언트를 넣을 수 있게
  const scripts = []; // document.head.appendChild으로 삽입된 <script> 기록
  const cookieJar = makeCookieJar();
  const els = {
    analyticsConsentBanner: makeEl(),
    analyticsConsentStatus: makeEl(),
    analyticsConsentAllow: makeEl(),
    analyticsConsentDeny: makeEl(),
    analyticsSettingsLink: makeEl()
  };
  const order = []; // 주소 정리(replaceState)와 스크립트 삽입의 순서 기록
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => ({ async: false, src: '' }),
    head: { appendChild(el){ scripts.push(el); order.push('script'); } },
    body: { style: {} },
    referrer: opts.referrer || ''
  };
  // 주소 · history — replaceState는 진짜 브라우저처럼 location의 search · hash를 바꾼다
  const location = Object.assign({ pathname: '/', search: '', hash: '' }, opts.location || {});
  const replaced = [];
  const history = {
    state: null,
    replaceState(state, title, url){
      replaced.push(url); order.push('replaceState');
      const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
      location.pathname = m[1]; location.search = m[2] || ''; location.hash = m[3] || '';
    }
  };
  Object.defineProperty(doc, 'cookie', { get(){ return cookieJar.value; }, set(v){ cookieJar.value = v; } });

  const pageViewCalls = [];
  const storage = memStorage();
  if(opts.stored) storage.setItem('ld-analytics-consent-v1', opts.stored); // 재방문(저장된 선택)
  const sandbox = {
    console,
    localStorage: storage,
    document: doc,
    addEventListener(){}, // window.addEventListener('resize', ...)
    launchdeskSendPageView(){ pageViewCalls.push(1); },
    location,
    history
  };
  if(opts.supabase) sandbox.launchdeskSupabase = opts.supabase; // supabase-client.js가 만든 클라이언트 자리
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CORE_SRC, sandbox, { filename: 'analytics-consent-core.js' });
  vm.runInContext(UI_SRC, sandbox, { filename: 'analytics-consent.js' });

  return { sandbox, els, scripts, cookieJar, pageViewCalls, location, replaced, order };
}

function dataLayerEvents(sandbox, name){
  return (sandbox.dataLayer || []).filter(a => a[0] === 'event' && a[1] === name);
}
function consentUpdates(sandbox){
  // 샌드박스 realm 객체는 이 파일의 Object.prototype과 달라 deepEqual이
  // "구조는 같은데 참조가 다르다"고 실패한다 — JSON 왕복으로 평범한
  // 객체로 복사한다(step-progress-sync.test.js와 동일한 방식).
  return (sandbox.dataLayer || []).filter(a => a[0] === 'consent' && a[1] === 'update').map(a => JSON.parse(JSON.stringify(a[2])));
}
function gaScriptCount(scripts){
  return scripts.filter(s => typeof s.src === 'string' && s.src.indexOf('googletagmanager.com/gtag/js?id=' + GA_ID) !== -1).length;
}

test('최초 진입: 배너 노출, gtag 미정의, 스크립트 삽입 없음', () => {
  const { sandbox, els, scripts } = boot();
  assert.equal(els.analyticsConsentBanner.hidden, false);
  assert.equal(typeof sandbox.gtag, 'undefined');
  assert.equal(scripts.length, 0);
});

test('허용 클릭: 스크립트 1회 삽입, 현재 route page_view 1회, gtag 함수로 노출', () => {
  const { sandbox, els, scripts, pageViewCalls } = boot();
  els.analyticsConsentAllow.click();
  assert.equal(gaScriptCount(scripts), 1);
  assert.equal(typeof sandbox.gtag, 'function');
  assert.equal(pageViewCalls.length, 1);
  assert.equal(JSON.parse(localStorage_get(sandbox)).status, 'granted');
});

test('granted → denied: consent update(denied) 전송 + ga-disable 플래그 on', () => {
  const { sandbox, els } = boot();
  els.analyticsConsentAllow.click();
  els.analyticsConsentDeny.click();
  const updates = consentUpdates(sandbox);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'
  });
  assert.equal(sandbox['ga-disable-' + GA_ID], true);
});

test('granted → denied 후 route 변경(page_view) 재호출 시 전송되지 않는다', () => {
  const { sandbox } = boot();
  document_click(sandbox, 'analyticsConsentAllow');
  document_click(sandbox, 'analyticsConsentDeny');
  const beforeCall = (sandbox.dataLayer || []).length; // consent update(denied) 1건이 이미 쌓인 시점
  sandbox.gtag('event', 'page_view', { page_path: '/tools' }); // app.js render()가 route 이동 시 보내는 것과 동일한 형태
  assert.equal(dataLayerEvents(sandbox, 'page_view').length, 0);
  assert.equal((sandbox.dataLayer || []).length, beforeCall); // page_view 호출이 dataLayer에 아무것도 추가하지 않음
});

test('denied 상태에서 일반 이벤트(chapter_start 등)도 전송되지 않는다', () => {
  const { sandbox } = boot();
  document_click(sandbox, 'analyticsConsentAllow');
  document_click(sandbox, 'analyticsConsentDeny');
  const before = (sandbox.dataLayer || []).length;
  sandbox.gtag('event', 'chapter_start', { chapter_path: '/start/prepare' });
  sandbox.gtag('event', 'page_view', { page_path: '/start/prepare' });
  assert.equal((sandbox.dataLayer || []).length, before); // 둘 다 dataLayer에 올라가지 않음
});

test('denied 상태에서도 window.gtag 자체는 파괴되지 않고 함수로 남아있다', () => {
  const { sandbox } = boot();
  document_click(sandbox, 'analyticsConsentAllow');
  const afterGrant = sandbox.gtag;
  document_click(sandbox, 'analyticsConsentDeny');
  assert.equal(sandbox.gtag, afterGrant); // 재할당되지 않음(같은 함수 참조)
  assert.equal(typeof sandbox.gtag, 'function');
});

test('denied → granted(재허용): consent update(granted) 전송, ga-disable 해제, 스크립트 중복 삽입 없음', () => {
  const { sandbox, scripts } = boot();
  document_click(sandbox, 'analyticsConsentAllow');
  document_click(sandbox, 'analyticsConsentDeny');
  const gtagBeforeRegrant = sandbox.gtag;
  document_click(sandbox, 'analyticsConsentAllow');
  assert.equal(gaScriptCount(scripts), 1); // 재삽입 없음
  assert.equal(sandbox.gtag, gtagBeforeRegrant); // 여전히 같은 함수 참조
  assert.equal(sandbox['ga-disable-' + GA_ID], false);
  const updates = consentUpdates(sandbox);
  assert.deepEqual(updates[updates.length - 1], {
    analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted'
  });
});

test('재허용 후 이벤트 전송이 정상 복구되고, route 이동마다 1회씩만 쌓인다(중복 없음)', () => {
  const { sandbox, pageViewCalls } = boot();
  document_click(sandbox, 'analyticsConsentAllow'); // 최초 허용 → page_view 훅 1회
  document_click(sandbox, 'analyticsConsentDeny');
  document_click(sandbox, 'analyticsConsentAllow'); // 재허용 → page_view 훅 1회 더(정확히 1회)
  assert.equal(pageViewCalls.length, 2);
  // 재허용 이후 실제 route 이동을 흉내낸 gtag 호출은 정상적으로 dataLayer에 올라간다
  sandbox.gtag('event', 'page_view', { page_path: '/dashboard' });
  sandbox.gtag('event', 'page_view', { page_path: '/tools' });
  assert.equal(dataLayerEvents(sandbox, 'page_view').length, 2);
});

test('이미 granted인데 허용을 다시 눌러도 page_view 훅은 중복 호출되지 않는다', () => {
  const { sandbox, pageViewCalls } = boot();
  document_click(sandbox, 'analyticsConsentAllow');
  document_click(sandbox, 'analyticsConsentAllow'); // 상태 변화 없음
  assert.equal(pageViewCalls.length, 1);
});

test('거부 시 _ga/_ga_* 쿠키가 삭제된다', () => {
  const { sandbox, cookieJar } = boot();
  document_click(sandbox, 'analyticsConsentAllow');
  cookieJar.seed('_ga', 'GA1.2.111.222');
  cookieJar.seed('_ga_ABCDE12345', 'GS1.1.1.1');
  cookieJar.seed('unrelated', 'keep-me');
  document_click(sandbox, 'analyticsConsentDeny');
  assert.equal(cookieJar.has('_ga'), false);
  assert.equal(cookieJar.has('_ga_ABCDE12345'), false);
  assert.equal(cookieJar.has('unrelated'), true);
});

function document_click(sandbox, id){
  sandbox.document.getElementById(id).click();
}
function localStorage_get(sandbox){
  return sandbox.localStorage.getItem(sandbox.launchdeskAnalyticsConsent.STORAGE_KEY);
}

// ------------------------------------------------------------------ 2026-10-12 핫픽스: 인증 복귀 주소에서 GA4 지연 로드
// Supabase 로그인 · 이메일 인증에서 돌아온 주소에는 토큰(#access_token=…)이나 인증 코드(?code=…)가 있다. GA4 자동 수집은
// 그때의 주소를 함께 보낸다(양식 이벤트의 form_destination에는 # 뒤까지 — 운영 gtag.js 로컬 관찰). 그래서 Supabase가 주소를
// 처리한 뒤(auth.initialize 완료 — 성공 · 실패 모두) 남은 인증 값을 지우고 나서만 gtag.js를 불러온다. 처리 전에는 주소를 건드리지 않는다.
const GRANTED_V1 = JSON.stringify({ status: 'granted', version: 1 }); // 운영 중인 GA4 동의 저장값(버전 1)
const TOKEN_HASH = '#access_token=FAKEACCESS&expires_in=3600&refresh_token=FAKEREFRESH&token_type=bearer';
function fakeSupabase(){
  let resolve, reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  const auth = { calls: 0, initialize(){ auth.calls++; return p; } };
  return { client: { auth }, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));
function configParams(sandbox){
  const c = (sandbox.dataLayer || []).find((a) => a[0] === 'config');
  return c ? JSON.parse(JSON.stringify(c[2])) : null;
}

test('인증 복귀(토큰 해시) · 처리 중: 저장된 허용이어도 Supabase 처리가 끝나기 전에는 gtag.js를 불러오지 않고 주소도 건드리지 않는다', async () => {
  const sb = fakeSupabase();
  const { sandbox, scripts, replaced } = boot({ stored: GRANTED_V1, location: { hash: TOKEN_HASH }, supabase: sb.client });
  await tick();
  assert.equal(gaScriptCount(scripts), 0, '처리 전에는 GA4 미로드');
  assert.equal(sb.client.auth.calls, 1, 'Supabase의 처리 완료(initialize)를 기다린다');
  assert.deepEqual(replaced, [], '처리 전에는 주소를 지우지 않는다(로그인을 깨지 않게)');
  assert.equal(typeof sandbox.gtag, 'function', '앱이 보내는 이벤트는 대기열에만 쌓인다(전송 없음)');
});

test('인증 복귀 · 처리 성공: SDK가 해시를 지운 뒤 처리가 끝나면 그때 gtag.js를 1회 불러온다(주소는 이미 깨끗해 다시 바꾸지 않음)', async () => {
  const sb = fakeSupabase();
  const { scripts, replaced, location } = boot({ stored: GRANTED_V1, location: { hash: TOKEN_HASH }, supabase: sb.client });
  location.hash = ''; // SDK: 사용자 확인 뒤 window.location.hash = ''
  sb.resolve({ error: null });
  await tick();
  assert.equal(gaScriptCount(scripts), 1);
  assert.deepEqual(replaced, []);
});

test('인증 복귀 · 처리 실패: SDK가 남긴 토큰 해시를 처리가 끝난 뒤 지우고, 그다음에 gtag.js를 불러온다', async () => {
  const sb = fakeSupabase();
  const { scripts, replaced, location, order } = boot({ stored: GRANTED_V1, location: { hash: TOKEN_HASH }, supabase: sb.client });
  sb.resolve({ error: { message: 'invalid JWT' } }); // 실패여도 initialize는 결과를 돌려준다(해시는 남아 있음)
  await tick();
  assert.deepEqual(replaced, ['/']);
  assert.equal(location.hash, '');
  assert.equal(gaScriptCount(scripts), 1);
  assert.deepEqual(order, ['replaceState', 'script'], '주소를 먼저 지운 뒤에 불러온다');
});

test('인증 복귀 · 처리 예외(initialize rejection)도 처리 끝으로 보고 정리한 뒤 불러온다', async () => {
  const sb = fakeSupabase();
  const { scripts, replaced } = boot({ stored: GRANTED_V1, location: { hash: TOKEN_HASH }, supabase: sb.client });
  sb.reject(new Error('network'));
  await tick();
  assert.deepEqual(replaced, ['/']);
  assert.equal(gaScriptCount(scripts), 1);
});

test('?code= 복귀: 처리가 끝나면 인증 코드 · state만 지우고 utm과 화면 경로는 남긴다(유입 분석 유지) → 그다음 불러온다', async () => {
  const sb = fakeSupabase();
  const { scripts, replaced, location } = boot({ stored: GRANTED_V1, location: { search: '?code=FAKECODE&state=FAKESTATE&utm_source=meta&utm_campaign=beta', hash: '#/' }, supabase: sb.client });
  await tick();
  assert.equal(gaScriptCount(scripts), 0);
  sb.resolve({ error: null });
  await tick();
  assert.deepEqual(replaced, ['/?utm_source=meta&utm_campaign=beta#/']);
  assert.equal(location.search, '?utm_source=meta&utm_campaign=beta');
  assert.equal(gaScriptCount(scripts), 1);
});

test('Supabase 클라이언트가 없으면 인증 값을 처리할 주체가 없으므로 이 문서에서는 GA4를 불러오지 않고 주소도 건드리지 않는다', async () => {
  const { scripts, replaced } = boot({ stored: GRANTED_V1, location: { hash: TOKEN_HASH } });
  await tick(); await tick();
  assert.equal(gaScriptCount(scripts), 0);
  assert.deepEqual(replaced, []);
});

test('일반 주소(인증 값 없음)는 지금처럼 바로 불러온다 — utm · 화면 경로 그대로, Supabase를 기다리지 않음', () => {
  const sb = fakeSupabase();
  const { scripts, replaced } = boot({ stored: GRANTED_V1, location: { search: '?utm_source=meta&utm_campaign=beta', hash: '#/tools' }, supabase: sb.client });
  assert.equal(gaScriptCount(scripts), 1);
  assert.equal(sb.client.auth.calls, 0);
  assert.deepEqual(replaced, []);
});

test('처음 방문자가 인증 복귀 처리 중에 분석을 허용하면 허용은 저장하되 불러오기는 처리 · 정리 뒤로 미룬다', async () => {
  const sb = fakeSupabase();
  const { els, scripts, pageViewCalls } = boot({ location: { hash: TOKEN_HASH }, supabase: sb.client });
  els.analyticsConsentAllow.click();
  assert.equal(gaScriptCount(scripts), 0);
  assert.equal(pageViewCalls.length, 1, '현재 화면 page_view는 대기열로(안전한 주소 · 경로는 app.js가 만든다)');
  sb.resolve({ error: null });
  await tick();
  assert.equal(gaScriptCount(scripts), 1);
});

test('처리 중에 허용했다가 거부하면 처리가 끝나도 불러오지 않고, 다시 허용하면 그때 1회 불러온다', async () => {
  const sb = fakeSupabase();
  const { els, scripts } = boot({ location: { hash: TOKEN_HASH }, supabase: sb.client });
  els.analyticsConsentAllow.click();
  els.analyticsConsentDeny.click();
  sb.resolve({ error: null });
  await tick();
  assert.equal(gaScriptCount(scripts), 0);
  els.analyticsSettingsLink.click();
  els.analyticsConsentAllow.click();
  assert.equal(gaScriptCount(scripts), 1);
  els.analyticsConsentAllow.click();
  assert.equal(gaScriptCount(scripts), 1, '중복 삽입 없음');
});

test('page_referrer: 이전 페이지 주소에 인증 값이 있으면 그 값만 뺀 주소를 설정에 넣는다(이후 모든 요청의 page_referrer)', () => {
  const { sandbox } = boot({ stored: GRANTED_V1, referrer: 'https://launchdesk.co.kr/?code=REFCODE&state=s&utm_source=ref' });
  assert.equal(configParams(sandbox).page_referrer, 'https://launchdesk.co.kr/?utm_source=ref');
  assert.equal(configParams(sandbox).send_page_view, false);
});

test('page_referrer: 인증 값이 없는 이전 페이지 주소는 그대로 둔다(설정에 넣지 않음 — gtag 기본값 = document.referrer)', () => {
  const { sandbox } = boot({ stored: GRANTED_V1, referrer: 'https://l.instagram.com/' });
  assert.equal('page_referrer' in configParams(sandbox), false);
});

// 2026-10-12 핫픽스 보완(GPT 검토) — 처리 중에 대기열에 쌓인 이벤트는 나중에 실제 주소를 정리해도 값이 그대로다.
// 그래서 대기열(dataLayer)에 넣는 순간 주소 값(page_location · page_referrer · page_path · link_url)의 인증 값을 같은 규칙으로 뺀다.
test('대기열에 넣는 순간 주소 값의 인증 값을 뺀다(이름 대소문자 무관) — 주소를 정리한 뒤에도 이미 쌓인 이벤트에 값이 남지 않는다', async () => {
  const sb = fakeSupabase();
  const { sandbox, scripts } = boot({ stored: GRANTED_V1, location: { search: '?access_token=QA&Code=QC&utm_source=meta', hash: '' }, supabase: sb.client });
  const params = { page_title: '홈', page_location: 'http://localhost/?access_token=QA&refresh_token=QR&token_hash=QH&type=signup&Code=QC&utm_source=meta#/tools',
    page_referrer: 'https://ref.example/cb?code=RC&utm_source=ref', page_path: '/' };
  sandbox.gtag('event', 'page_view', params);
  sandbox.gtag('event', 'chapter_start', { chapter_path: '/start', chapter_title: '쇼핑몰 준비' });
  const events = sandbox.dataLayer.filter((a) => a[0] === 'event').map((a) => JSON.parse(JSON.stringify(Array.from(a))));
  assert.equal(events[0][2].page_location, 'http://localhost/?utm_source=meta#/tools', 'utm · 화면 경로는 남는다');
  assert.equal(events[0][2].page_referrer, 'https://ref.example/cb?utm_source=ref');
  assert.equal(events[0][2].page_path, '/');
  assert.deepEqual(events[1][2], { chapter_path: '/start', chapter_title: '쇼핑몰 준비' }, '주소가 아닌 값은 그대로');
  assert.equal(params.page_location.indexOf('access_token') !== -1, true, '호출한 쪽 객체는 바꾸지 않는다');
  sb.resolve({ error: null });
  await tick();
  assert.equal(gaScriptCount(scripts), 1);
  assert.doesNotMatch(JSON.stringify(sandbox.dataLayer.map((a) => Array.from(a))), /QA|QR|QH|QC|RC/, '불러온 뒤 처리될 대기열 어디에도 인증 값이 없다');
});
