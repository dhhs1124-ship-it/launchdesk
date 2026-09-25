/* Meta 픽셀 동의 · PageView 검증 — 실행: node --test tests/

   analytics-consent(-core).js + meta-pixel(-core).js 실제 소스를 vm 샌드박스
   (최소 DOM 스텁)에서 그대로 실행한다(analytics-consent-guard.test.js와 같은
   방식). 네트워크 요청은 없다 — 삽입된 <script>는 기록만 하고 fbq는 Meta 기본
   코드처럼 queue에 쌓이므로, queue를 보면 "무엇이 전송됐을지"를 알 수 있다.

   배포 소스의 ENABLED는 true(방침 v1.4 게시와 함께 켬). 긴급 중단 스위치가
   여전히 동작하는지는 소스 문자열의 ENABLED만 false로 바꿔 따로 검증한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'meta-pixel-core.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'meta-pixel.js'), 'utf8');
const GA_CORE_SRC = fs.readFileSync(path.join(ROOT, 'analytics-consent-core.js'), 'utf8');
const GA_UI_SRC = fs.readFileSync(path.join(ROOT, 'analytics-consent.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PIXEL_ID = '1921995005433525';
const META_KEY = 'ld-meta-pixel-consent-v1';
const GA_KEY = 'ld-analytics-consent-v1';

const ENABLED_CORE_SRC = CORE_SRC;
const DISABLED_CORE_SRC = CORE_SRC.replace('var ENABLED = true;', 'var ENABLED = false;');

function memStorage(seed){
  const s = Object.assign({}, seed);
  return { getItem(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, setItem(k, v){ s[k] = String(v); }, removeItem(k){ delete s[k]; } };
}
function makeEl(){
  const el = { hidden: true, checked: false, textContent: '', style: {}, offsetHeight: 96, listeners: {} };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.click = () => (el.listeners.click || []).slice().forEach(fn => fn());
  return el;
}

function boot(opts = {}){
  const scripts = [];
  const cookies = {};
  const winListeners = {};
  const ids = ['analyticsConsentBanner', 'analyticsConsentTitle', 'analyticsConsentDesc', 'analyticsConsentStatus', 'analyticsConsentAllow', 'analyticsConsentDeny', 'analyticsSettingsLink',
    'consentChoices', 'consentChoiceGa', 'consentChoiceMeta', 'consentSaveChoices'];
  const els = {};
  ids.forEach(id => { els[id] = makeEl(); });
  els.analyticsConsentTitle.textContent = '서비스 이용 분석 설정';
  els.analyticsConsentDesc.hidden = false;
  els.analyticsConsentAllow.textContent = '분석 허용';
  els.analyticsConsentDeny.textContent = '허용하지 않음';
  els.analyticsSettingsLink.textContent = '분석 설정';
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => ({ async: false, src: '' }),
    head: { appendChild(el){ scripts.push(el); } },
    body: { style: {} }
  };
  Object.defineProperty(doc, 'cookie', {
    get(){ return Object.keys(cookies).map(k => k + '=' + cookies[k]).join('; '); },
    set(v){ const first = String(v).split(';')[0]; const eq = first.indexOf('='); const name = first.slice(0, eq).trim(); const val = first.slice(eq + 1); if(/1970/.test(v) || val === '') delete cookies[name]; else cookies[name] = val; }
  });
  const location = { hash: opts.hash || '#/', search: opts.search || '', hostname: 'launchdesk.co.kr' };
  const storage = memStorage(opts.storage);
  const gaPageViews = [];
  const sandbox = {
    console, localStorage: storage, document: doc, location,
    setTimeout(fn){ fn(); },
    addEventListener(type, fn){ (winListeners[type] = winListeners[type] || []).push(fn); },
    launchdeskSendPageView(){ gaPageViews.push(location.hash); }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GA_CORE_SRC, sandbox);
  vm.runInContext(GA_UI_SRC, sandbox);
  vm.runInContext(opts.disabled ? DISABLED_CORE_SRC : ENABLED_CORE_SRC, sandbox);
  vm.runInContext(UI_SRC, sandbox);

  const metaScripts = () => scripts.filter(s => /connect\.facebook\.net/.test(s.src));
  const gaScripts = () => scripts.filter(s => /googletagmanager/.test(s.src));
  const calls = () => (sandbox.fbq && sandbox.fbq.queue ? sandbox.fbq.queue.map(a => Array.from(a)) : []);
  const pageViews = () => calls().filter(c => c[0] === 'track' && c[1] === 'PageView').length;
  const status = (key) => { const raw = storage.getItem(key); return raw ? JSON.parse(raw).status : null; };
  return {
    sandbox, els, storage, cookies, metaScripts, gaScripts, calls, pageViews, status, gaPageViews,
    navigate(hash){ location.hash = hash; (winListeners.hashchange || []).forEach(fn => fn()); }
  };
}
const granted = () => JSON.stringify({ status: 'granted', version: 1, updatedAt: '2026-09-24T00:00:00.000Z' });
const denied = () => JSON.stringify({ status: 'denied', version: 1, updatedAt: '2026-09-24T00:00:00.000Z' });

test('배포 소스는 ENABLED=true이고 픽셀 ID는 1921995005433525', () => {
  assert.match(CORE_SRC, /var ENABLED = true;/);
  assert.match(CORE_SRC, /var PIXEL_ID = '1921995005433525';/);
  assert.notEqual(DISABLED_CORE_SRC, CORE_SRC, '중단 스위치 검증용 소스가 실제로 바뀌어야 한다');
});

test('긴급 중단 스위치(ENABLED=false) — 안내창은 GA4 전용으로 돌아가고, Meta 저장값이 granted여도 스크립트·fbq가 없다', () => {
  const b = boot({ disabled: true, storage: { [META_KEY]: granted() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, false, 'GA4 미결정이면 기존처럼 안내창 표시');
  assert.equal(b.els.consentChoices.hidden, true);
  assert.equal(b.els.consentSaveChoices.hidden, true);
  assert.equal(b.els.analyticsConsentTitle.textContent, '서비스 이용 분석 설정');
  assert.equal(b.els.analyticsConsentAllow.textContent, '분석 허용');
  b.els.analyticsConsentAllow.click();
  assert.equal(b.metaScripts().length, 0);
  assert.equal(typeof b.sandbox.fbq, 'undefined');
  const b2 = boot({ disabled: true, storage: { [GA_KEY]: granted() } });
  assert.equal(b2.els.analyticsConsentBanner.hidden, true, 'GA4 결정 후 재방문 시 Meta 때문에 안내창이 다시 뜨지 않는다');
});

test('통합 안내창: 한 창에 GA4·Meta 체크박스(기본 해제)와 모두 허용하지 않음 · 선택 저장 · 모두 허용', () => {
  const b = boot();
  assert.equal(b.els.analyticsConsentBanner.hidden, false);
  assert.equal(b.els.consentChoices.hidden, false);
  assert.equal(b.els.consentSaveChoices.hidden, false);
  assert.equal(b.els.analyticsConsentDesc.hidden, true);
  assert.equal(b.els.consentChoiceGa.checked, false);
  assert.equal(b.els.consentChoiceMeta.checked, false);
  assert.equal(b.els.analyticsConsentAllow.textContent, '모두 허용');
  assert.equal(b.els.analyticsConsentDeny.textContent, '모두 허용하지 않음');
  assert.equal(b.els.analyticsSettingsLink.textContent, '분석·광고 설정');
});

test('동의 전: 픽셀 스크립트 로드 0, fbq 미정의, 화면 이동해도 전송 없음', () => {
  const b = boot();
  b.navigate('#/start'); b.navigate('#/tools');
  assert.equal(b.metaScripts().length, 0);
  assert.equal(typeof b.sandbox.fbq, 'undefined');
});

test('모두 허용하지 않음: 둘 다 거부 저장, 로드·전송 없음, 이후 이동에도 없음', () => {
  const b = boot();
  b.els.analyticsConsentDeny.click();
  assert.equal(b.status(GA_KEY), 'denied');
  assert.equal(b.status(META_KEY), 'denied');
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  b.navigate('#/start');
  assert.equal(b.metaScripts().length, 0);
  assert.equal(b.gaScripts().length, 0);
  assert.equal(typeof b.sandbox.fbq, 'undefined');
});

test('선택 저장 — GA4만 허용: GA4만 로드, Meta는 거부·미로드', () => {
  const b = boot();
  b.els.consentChoiceGa.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(GA_KEY), 'granted');
  assert.equal(b.status(META_KEY), 'denied');
  assert.equal(b.gaScripts().length, 1);
  assert.equal(b.metaScripts().length, 0);
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
});

test('선택 저장 — Meta만 허용: Meta만 로드 + 현재 화면 PageView 1, GA4는 거부·미로드', () => {
  const b = boot({ hash: '#/tools' });
  b.els.consentChoiceMeta.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(GA_KEY), 'denied');
  assert.equal(b.status(META_KEY), 'granted');
  assert.equal(b.gaScripts().length, 0);
  assert.equal(b.gaPageViews.length, 0);
  assert.equal(b.metaScripts().length, 1);
  assert.equal(b.pageViews(), 1);
});

test('모두 허용: 스크립트 1회, autoConfig 끔, init에 고급 매칭 값 없음, 현재 화면 PageView 1 — 다시 열어 또 허용해도 재전송 없음', () => {
  const b = boot({ hash: '#/tools' });
  b.els.analyticsConsentAllow.click();
  assert.equal(b.status(GA_KEY), 'granted');
  assert.equal(b.status(META_KEY), 'granted');
  assert.equal(b.metaScripts().length, 1);
  assert.equal(b.metaScripts()[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.equal(b.sandbox.fbq.disablePushState, true, '픽셀의 history 자동 PageView를 꺼야 중복이 안 생긴다');
  const calls = b.calls();
  assert.deepEqual(calls.find(c => c[0] === 'set'), ['set', 'autoConfig', false, PIXEL_ID]);
  assert.deepEqual(calls.find(c => c[0] === 'init'), ['init', PIXEL_ID]);
  assert.equal(b.pageViews(), 1);
  b.els.analyticsSettingsLink.click();
  assert.equal(b.els.consentChoiceGa.checked, true, '다시 열면 저장된 상태가 체크돼 있다');
  assert.equal(b.els.consentChoiceMeta.checked, true);
  b.els.analyticsConsentAllow.click();
  assert.equal(b.pageViews(), 1);
  assert.equal(b.metaScripts().length, 1);
});

test('GA4만 결정된 기존 방문자: Meta 선택을 위해 안내창을 한 번 띄우고, GA4 체크는 저장값대로', () => {
  const b = boot({ storage: { [GA_KEY]: granted() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, false);
  assert.equal(b.els.consentChoiceGa.checked, true);
  assert.equal(b.els.consentChoiceMeta.checked, false);
  assert.match(b.els.analyticsConsentStatus.textContent, /이용 분석 허용됨 · 광고 측정 선택 안 함/);
  // Meta만 거부해도 GA4 허용은 그대로
  b.els.consentSaveChoices.click();
  assert.equal(b.status(GA_KEY), 'granted');
  assert.equal(b.status(META_KEY), 'denied');
});

test('둘 다 결정된 재방문: 안내창 없음', () => {
  const b = boot({ storage: { [GA_KEY]: denied(), [META_KEY]: denied() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  assert.equal(b.metaScripts().length, 0);
});

test('저장된 허용 상태: 첫 화면 1회, 같은 화면 연속 재실행은 무시, 다른 화면 → 돌아오기는 각각 1회', () => {
  const b = boot({ hash: '#/', storage: { [GA_KEY]: granted(), [META_KEY]: granted() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  assert.equal(b.pageViews(), 1);
  b.navigate('#/');
  assert.equal(b.pageViews(), 1);
  b.navigate('#/start');
  b.navigate('#/start');
  assert.equal(b.pageViews(), 2);
  b.navigate('#/');
  assert.equal(b.pageViews(), 3);
});

test('인증 콜백 해시·OAuth 복귀 쿼리가 주소에 있으면 PageView를 보내지 않는다(토큰이 URL과 함께 전송되는 것 방지)', () => {
  const b1 = boot({ hash: '#access_token=abc&refresh_token=def&type=signup', storage: { [GA_KEY]: granted(), [META_KEY]: granted() } });
  assert.equal(b1.pageViews(), 0);
  b1.navigate('#/start');
  assert.equal(b1.pageViews(), 1);
  const b2 = boot({ hash: '#/', search: '?code=xyz', storage: { [GA_KEY]: granted(), [META_KEY]: granted() } });
  assert.equal(b2.pageViews(), 0);
  const b3 = boot({ hash: '#/', search: '?utm_source=meta&utm_campaign=beta', storage: { [GA_KEY]: granted(), [META_KEY]: granted() } });
  assert.equal(b3.pageViews(), 1, 'UTM만 있는 주소는 정상 전송');
});

test('Meta 철회(선택 저장에서 해제): consent revoke, 이후 이동해도 전송 없음, _fbp/_fbc 삭제, GA4는 그대로 · 재허용은 재삽입 없이 grant', () => {
  const b = boot({ hash: '#/', storage: { [GA_KEY]: granted(), [META_KEY]: granted() } });
  b.cookies._fbp = 'fb.1.123'; b.cookies._fbc = 'fb.1.456'; b.cookies._ga = 'keep';
  b.els.analyticsSettingsLink.click();
  b.els.consentChoiceMeta.checked = false;
  b.els.consentSaveChoices.click();
  assert.ok(b.calls().some(c => c[0] === 'consent' && c[1] === 'revoke'));
  assert.equal(b.cookies._fbp, undefined);
  assert.equal(b.cookies._fbc, undefined);
  assert.equal(b.cookies._ga, 'keep', 'GA 쿠키는 Meta 철회로 지우지 않는다');
  assert.equal(b.status(GA_KEY), 'granted');
  b.navigate('#/start');
  assert.equal(b.pageViews(), 1);
  b.els.analyticsSettingsLink.click();
  b.els.consentChoiceMeta.checked = true;
  b.els.consentSaveChoices.click();
  assert.ok(b.calls().some(c => c[0] === 'consent' && c[1] === 'grant'));
  assert.equal(b.metaScripts().length, 1);
  assert.equal(b.pageViews(), 2, '재허용 시 지금 화면(#/start) 1회');
});

test('픽셀로 보내는 호출은 PageView뿐이고 이메일·토큰 같은 값을 싣지 않는다(회원가입 이벤트 없음)', () => {
  const b = boot({ hash: '#/', storage: { [GA_KEY]: granted(), [META_KEY]: granted() } });
  b.navigate('#/account'); b.navigate('#/start');
  const events = b.calls().filter(c => c[0] === 'track' || c[0] === 'trackCustom');
  assert.ok(events.every(c => c[1] === 'PageView' && c.length === 2));
  assert.doesNotMatch(JSON.stringify(b.calls()), /@|token|password/i);
  assert.doesNotMatch(UI_SRC.replace(/\/\*[\s\S]*?\*\//g, ''), /CompleteRegistration|trackCustom|Lead|em:|ph:/);
});

test('index.html: Meta 기본 코드·noscript 추적 이미지를 직접 넣지 않고, 로더는 analytics-consent.js 다음에 로드하며 안내창은 하나다', () => {
  assert.doesNotMatch(INDEX, /<noscript>[\s\S]*facebook\.com\/tr/);
  assert.doesNotMatch(INDEX, /<script[^>]*>[^<]*fbevents\.js/);
  const i = (s) => INDEX.indexOf('<script src="' + s + '"></script>');
  assert.ok(i('analytics-consent.js') > 0 && i('meta-pixel-core.js') > i('analytics-consent.js') && i('meta-pixel.js') > i('meta-pixel-core.js'));
  assert.equal((INDEX.match(/class="consent-banner"/g) || []).length, 1);
  assert.doesNotMatch(INDEX, /metaConsentBanner|metaSettingsLink/);
  assert.match(INDEX, /id="consentChoices" hidden/);
  assert.match(INDEX, /id="consentSaveChoices" hidden/);
  assert.match(INDEX, /<input type="checkbox" id="consentChoiceGa">/, '기본 해제(checked 없음)');
  assert.match(INDEX, /<input type="checkbox" id="consentChoiceMeta">/, '기본 해제(checked 없음)');
  assert.match(INDEX, /허용하지 않아도 모든 기능을 그대로 이용할 수 있어요/);
});

test('core: 저장값 파싱은 형식·버전이 다르면 null, 안전 주소 판정', () => {
  const core = require('../meta-pixel-core.js');
  assert.equal(core.parse(null), null);
  assert.equal(core.parse('{bad'), null);
  assert.equal(core.parse(JSON.stringify({ status: 'granted', version: 2 })), null);
  assert.equal(core.parse(granted()).status, 'granted');
  assert.equal(core.isSafeLocation('#/start', ''), true);
  assert.equal(core.isSafeLocation('', ''), true);
  assert.equal(core.isSafeLocation('#access_token=x', ''), false);
  assert.equal(core.isSafeLocation('#/', '?error=access_denied'), false);
  assert.equal(core.routeOf(''), '/');
  assert.equal(core.PIXEL_ID, PIXEL_ID);
});
