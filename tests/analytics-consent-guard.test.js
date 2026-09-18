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

function boot(){
  const scripts = []; // document.head.appendChild으로 삽입된 <script> 기록
  const cookieJar = makeCookieJar();
  const els = {
    analyticsConsentBanner: makeEl(),
    analyticsConsentStatus: makeEl(),
    analyticsConsentAllow: makeEl(),
    analyticsConsentDeny: makeEl(),
    analyticsSettingsLink: makeEl()
  };
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => ({ async: false, src: '' }),
    head: { appendChild(el){ scripts.push(el); } },
    body: { style: {} }
  };
  Object.defineProperty(doc, 'cookie', { get(){ return cookieJar.value; }, set(v){ cookieJar.value = v; } });

  const pageViewCalls = [];
  const sandbox = {
    console,
    localStorage: memStorage(),
    document: doc,
    addEventListener(){}, // window.addEventListener('resize', ...)
    launchdeskSendPageView(){ pageViewCalls.push(1); }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CORE_SRC, sandbox, { filename: 'analytics-consent-core.js' });
  vm.runInContext(UI_SRC, sandbox, { filename: 'analytics-consent.js' });

  return { sandbox, els, scripts, cookieJar, pageViewCalls };
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
