/* Microsoft Clarity 동의 · 로드 · 철회 검증 — 실행: node --test tests/

   analytics-consent(-core).js + meta-pixel(-core).js + clarity-consent(-core).js 실제 소스를
   vm 샌드박스(최소 DOM 스텁)에서 그대로 실행한다(meta-pixel.test.js와 같은 방식). 네트워크
   요청은 없다 — 삽입된 <script>는 기록만 하고, window.clarity는 Clarity 설치 스니펫처럼
   호출을 q에 쌓는 스텁이라 q를 보면 "Clarity에 무엇을 시켰는지"를 알 수 있다.

   실제 Clarity 런타임이 clarity('stop') 뒤에 정말 전송을 멈추는지는 이 테스트로 알 수 없다 —
   브라우저에서 확인한 방법과 결과는 docs/clarity-rollout.md에 있다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CLARITY_CORE_SRC = read('clarity-consent-core.js');
const CLARITY_UI_SRC = read('clarity-consent.js');
const META_CORE_SRC = read('meta-pixel-core.js');
const META_UI_SRC = read('meta-pixel.js');
const GA_CORE_SRC = read('analytics-consent-core.js');
const GA_UI_SRC = read('analytics-consent.js');
const INDEX = read('index.html');
const PROJECT_ID = 'yp7ibyta96';
const TAG_URL = 'https://www.clarity.ms/tag/' + PROJECT_ID;
const KEYS = { ga: 'ld-analytics-consent-v1', meta: 'ld-meta-pixel-consent-v2', clarity: 'ld-clarity-consent-v1' };

const PRIVACY_START = INDEX.indexOf('<!-- ============ VIEW: 개인정보처리방침 ============ -->');
const TERMS_START = INDEX.indexOf('<section class="view" id="view-terms"');
assert.ok(PRIVACY_START !== -1 && TERMS_START > PRIVACY_START, '테스트 전제(뷰 마커 위치)가 깨졌습니다');
const PRIVACY_HTML = INDEX.slice(PRIVACY_START, TERMS_START);

function memStorage(seed){
  const s = Object.assign({}, seed);
  return { getItem(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, setItem(k, v){ s[k] = String(v); }, removeItem(k){ delete s[k]; } };
}
function makeEl(){
  const el = { hidden: true, checked: false, textContent: '', style: {}, offsetHeight: 96, listeners: {}, parentNode: { hidden: false } };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.click = () => (el.listeners.click || []).slice().forEach(fn => fn());
  return el;
}

function boot(opts = {}){
  const scripts = [];
  const cookies = {};
  const cookieWrites = [];
  const winListeners = {};
  const ids = ['analyticsConsentBanner', 'analyticsConsentTitle', 'analyticsConsentDesc', 'analyticsConsentStatus', 'analyticsConsentAllow', 'analyticsConsentDeny', 'analyticsSettingsLink',
    'consentChoices', 'consentChoiceGa', 'consentChoiceMeta', 'consentChoiceClarity', 'consentSaveChoices'];
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
    set(v){
      cookieWrites.push(String(v));
      const first = String(v).split(';')[0]; const eq = first.indexOf('=');
      const name = first.slice(0, eq).trim(); const val = first.slice(eq + 1);
      if(/1970/.test(v) || val === '') delete cookies[name]; else cookies[name] = val;
    }
  });
  const location = { hash: opts.hash || '#/', search: opts.search || '', hostname: opts.hostname || 'www.launchdesk.co.kr' };
  const storage = memStorage(opts.storage);
  const session = memStorage(opts.session);
  const winListeners_ = winListeners;
  const sandbox = {
    console, localStorage: storage, sessionStorage: session, document: doc, location,
    setTimeout(fn){ fn(); },
    addEventListener(type, fn){ (winListeners_[type] = winListeners_[type] || []).push(fn); },
    launchdeskSendPageView(){}
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GA_CORE_SRC, sandbox);
  vm.runInContext(GA_UI_SRC, sandbox);
  if(!opts.noMeta){ // noMeta: Meta 파일을 아예 싣지 않은 배포(스크립트 태그 삭제)를 흉내 낸다
    vm.runInContext(opts.metaDisabled ? META_CORE_SRC.replace('var ENABLED = true;', 'var ENABLED = false;') : META_CORE_SRC, sandbox);
    vm.runInContext(META_UI_SRC, sandbox);
  }
  vm.runInContext(opts.clarityDisabled ? CLARITY_CORE_SRC.replace('var ENABLED = true;', 'var ENABLED = false;') : CLARITY_CORE_SRC, sandbox);
  vm.runInContext(CLARITY_UI_SRC, sandbox);

  const clarityScripts = () => scripts.filter(s => /clarity\.ms/.test(s.src));
  const calls = () => (sandbox.clarity && sandbox.clarity.q ? sandbox.clarity.q.map(a => Array.from(a)) : []);
  const status = (key) => { const raw = storage.getItem(key); return raw ? JSON.parse(raw).status : null; };
  return {
    sandbox, els, storage, session, cookies, cookieWrites, scripts, clarityScripts, calls, status,
    navigate(hash){ location.hash = hash; (winListeners.hashchange || []).forEach(fn => fn()); }
  };
}
const granted = () => JSON.stringify({ status: 'granted', version: 1, updatedAt: '2026-09-28T00:00:00.000Z' });
const denied = () => JSON.stringify({ status: 'denied', version: 1, updatedAt: '2026-09-28T00:00:00.000Z' });
const metaGranted = () => JSON.stringify({ status: 'granted', version: 2 });
const metaDenied = () => JSON.stringify({ status: 'denied', version: 2 });

test('배포 소스: ENABLED=true, 프로젝트 ID yp7ibyta96, 저장 키는 GA4·Meta와 다르다', () => {
  const core = require('../clarity-consent-core.js');
  assert.equal(core.ENABLED, true);
  assert.equal(core.PROJECT_ID, PROJECT_ID);
  assert.equal(core.STORAGE_KEY, 'ld-clarity-consent-v1');
  assert.notEqual(core.STORAGE_KEY, KEYS.ga);
  assert.notEqual(core.STORAGE_KEY, KEYS.meta);
  assert.equal(core.parse(null), null);
  assert.equal(core.parse('{bad'), null);
  assert.equal(core.parse(JSON.stringify({ status: 'granted', version: 2 })), null);
  assert.equal(core.parse(granted()).status, 'granted');
  assert.throws(() => core.serialize('maybe'));
});

test('동의 전(신규 방문자): 안내창에 Clarity 항목이 기본 해제로 있고, 스크립트 0 · window.clarity 미정의 · 화면 이동해도 없음', () => {
  const b = boot();
  assert.equal(b.els.analyticsConsentBanner.hidden, false);
  assert.equal(b.els.consentChoiceClarity.checked, false);
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(typeof b.sandbox.clarity, 'undefined');
  b.navigate('#/start'); b.navigate('#/tools');
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(typeof b.sandbox.clarity, 'undefined');
  assert.equal(b.status(KEYS.clarity), null, '아무 것도 누르지 않으면 저장되지 않는다');
});

test('기존 방문자가 GA4·Meta를 이미 허용했어도 Clarity는 "선택 안 함"으로 시작 — 안내창이 다시 뜨고, 스크립트는 없다', () => {
  const b = boot({ storage: { [KEYS.ga]: granted(), [KEYS.meta]: metaGranted() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, false, 'Clarity 결정을 받기 위해 한 번 다시 띄운다');
  assert.equal(b.els.consentChoiceGa.checked, true);
  assert.equal(b.els.consentChoiceMeta.checked, true);
  assert.equal(b.els.consentChoiceClarity.checked, false, 'GA4·Meta 동의를 Clarity 동의로 간주하지 않는다');
  assert.match(b.els.analyticsConsentStatus.textContent, /이용 분석 허용됨 · 광고 측정 허용됨 · 방문 행동 분석 선택 안 함/);
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(typeof b.sandbox.clarity, 'undefined');
  assert.equal(b.status(KEYS.clarity), null);
  // 그 상태에서 "선택 저장"을 눌러도 Clarity는 체크한 만큼(안 함)만 저장되고 GA4·Meta는 그대로
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.clarity), 'denied');
  assert.equal(b.status(KEYS.ga), 'granted');
  assert.equal(b.status(KEYS.meta), 'granted');
  assert.equal(b.clarityScripts().length, 0);
});

test('GA4·Meta·Clarity 모두 결정된 재방문: 안내창 없음, denied면 스크립트 없음', () => {
  const b = boot({ storage: { [KEYS.ga]: denied(), [KEYS.meta]: metaDenied(), [KEYS.clarity]: denied() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(typeof b.sandbox.clarity, 'undefined');
});

test('모두 허용하지 않음: Clarity도 거부 저장 · 로드 없음 · 이후 이동에도 없음', () => {
  const b = boot();
  b.els.analyticsConsentDeny.click();
  assert.equal(b.status(KEYS.clarity), 'denied');
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  b.navigate('#/start');
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(typeof b.sandbox.clarity, 'undefined');
});

test('선택 저장 — GA4·Meta만 허용: Clarity는 거부 · 미로드', () => {
  const b = boot();
  b.els.consentChoiceGa.checked = true;
  b.els.consentChoiceMeta.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.ga), 'granted');
  assert.equal(b.status(KEYS.meta), 'granted');
  assert.equal(b.status(KEYS.clarity), 'denied');
  assert.equal(b.clarityScripts().length, 0);
});

test('선택 저장 — Clarity만 허용: Clarity만 1회 로드(공식 태그 주소), 광고 저장소 거부 신호, GA4·Meta는 거부·미로드', () => {
  const b = boot();
  b.els.consentChoiceClarity.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.clarity), 'granted');
  assert.equal(b.status(KEYS.ga), 'denied');
  assert.equal(b.status(KEYS.meta), 'denied');
  assert.equal(b.clarityScripts().length, 1);
  assert.equal(b.clarityScripts()[0].src, TAG_URL);
  assert.equal(b.clarityScripts()[0].async, true);
  // vm 샌드박스의 객체는 프로토타입이 달라 deepEqual 대신 직렬화해 비교한다
  assert.equal(JSON.stringify(b.calls()), JSON.stringify([['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]]));
  assert.equal(b.scripts.filter(s => /googletagmanager|connect\.facebook\.net/.test(s.src)).length, 0);
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
});

test('모두 허용: 셋 다 허용 · Clarity 스크립트 1회 — 다시 열어 또 허용해도 재삽입 없음', () => {
  const b = boot();
  b.els.analyticsConsentAllow.click();
  assert.equal(b.status(KEYS.clarity), 'granted');
  assert.equal(b.clarityScripts().length, 1);
  b.els.analyticsSettingsLink.click();
  assert.equal(b.els.consentChoiceClarity.checked, true, '다시 열면 저장된 상태가 체크돼 있다');
  assert.match(b.els.analyticsConsentStatus.textContent, /방문 행동 분석 허용됨/);
  b.els.analyticsConsentAllow.click();
  assert.equal(b.clarityScripts().length, 1);
  b.els.consentSaveChoices.click();
  assert.equal(b.clarityScripts().length, 1);
});

test('저장된 허용: 첫 화면에서 바로 로드, 이후 이동·hashchange에도 재삽입 없음', () => {
  const b = boot({ storage: { [KEYS.ga]: denied(), [KEYS.meta]: metaDenied(), [KEYS.clarity]: granted() } });
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  assert.equal(b.clarityScripts().length, 1);
  b.navigate('#/start'); b.navigate('#/');
  assert.equal(b.clarityScripts().length, 1);
});

test('철회(선택 저장에서 해제): clarity stop, 거부 신호(consentv2 denied)는 보내지 않음, Clarity 쿠키·세션값 삭제, GA4·다른 쿠키는 그대로', () => {
  const b = boot({ storage: { [KEYS.ga]: granted(), [KEYS.meta]: metaDenied(), [KEYS.clarity]: granted() }, session: { _cltk: 'abc' } });
  b.cookies._clck = 'u|2|x'; b.cookies._clsk = 's|1'; b.cookies._ga = 'keep';
  assert.equal(b.clarityScripts().length, 1);
  b.els.analyticsSettingsLink.click();
  b.els.consentChoiceClarity.checked = false;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.clarity), 'denied');
  assert.equal(b.status(KEYS.ga), 'granted', 'Clarity 철회가 GA4 동의를 바꾸지 않는다');
  const calls = b.calls();
  assert.ok(calls.some(c => c[0] === 'stop'), 'clarity(\'stop\')으로 수집 모듈을 멈춘다');
  assert.ok(!calls.some(c => c[0] === 'consentv2' && c[1] && c[1].analytics_Storage === 'denied'), 'consentv2 denied는 Clarity를 "동의 없음 모드"로 재시작시켜 전송이 계속되므로 보내지 않는다');
  assert.ok(!calls.some(c => c[0] === 'consent'), '레거시 consent(false)도 같은 이유로 쓰지 않는다');
  assert.equal(b.cookies._clck, undefined);
  assert.equal(b.cookies._clsk, undefined);
  assert.equal(b.cookies._ga, 'keep');
  assert.equal(b.session.getItem('_cltk'), null);
  // Clarity가 쿠키를 쓰는 등록 가능한 상위 도메인(.launchdesk.co.kr)까지 지운다
  assert.ok(b.cookieWrites.some(w => /^_clck=;/.test(w) && /domain=\.launchdesk\.co\.kr$/.test(w)));
  assert.ok(b.cookieWrites.some(w => /^_clsk=;/.test(w) && /domain=\.launchdesk\.co\.kr$/.test(w)));
});

test('철회 뒤 같은 화면에서 재허용: 태그를 새로 불러오고, 그 사이 이동에는 로드가 없다', () => {
  const b = boot({ storage: { [KEYS.clarity]: granted(), [KEYS.ga]: denied(), [KEYS.meta]: metaDenied() } });
  assert.equal(b.clarityScripts().length, 1);
  b.els.analyticsSettingsLink.click();
  b.els.consentChoiceClarity.checked = false;
  b.els.consentSaveChoices.click();
  b.navigate('#/start');
  assert.equal(b.clarityScripts().length, 1, '철회 뒤에는 이동해도 다시 붙지 않는다');
  b.els.analyticsSettingsLink.click();
  b.els.consentChoiceClarity.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.clarity), 'granted');
  assert.equal(b.clarityScripts().length, 2);
});

test('모두 허용하지 않음으로 철회: Clarity도 멈추고 쿠키 삭제', () => {
  const b = boot({ storage: { [KEYS.ga]: granted(), [KEYS.meta]: metaGranted(), [KEYS.clarity]: granted() } });
  b.cookies._clck = 'u'; b.cookies._clsk = 's';
  b.els.analyticsSettingsLink.click();
  b.els.analyticsConsentDeny.click();
  assert.equal(b.status(KEYS.clarity), 'denied');
  assert.ok(b.calls().some(c => c[0] === 'stop'));
  assert.equal(b.cookies._clck, undefined);
  assert.equal(b.cookies._clsk, undefined);
});

test('로드 전에 거부한 경우 stop 호출은 없다(불러온 적 없으므로)', () => {
  const b = boot();
  b.els.analyticsConsentDeny.click();
  assert.deepEqual(b.calls(), []);
});

test('인증 콜백 해시·OAuth 복귀 쿼리가 주소에 있으면 로드하지 않고, 안전한 화면으로 이동하면 그때 로드한다(토큰이 URL과 함께 전송되는 것 방지)', () => {
  const b1 = boot({ hash: '#access_token=abc&refresh_token=def&type=signup', storage: { [KEYS.clarity]: granted(), [KEYS.ga]: denied(), [KEYS.meta]: metaDenied() } });
  assert.equal(b1.clarityScripts().length, 0);
  b1.navigate('#/start');
  assert.equal(b1.clarityScripts().length, 1);
  const b2 = boot({ hash: '#/', search: '?code=xyz', storage: { [KEYS.clarity]: granted(), [KEYS.ga]: denied(), [KEYS.meta]: metaDenied() } });
  assert.equal(b2.clarityScripts().length, 0);
  const b3 = boot({ hash: '#/', search: '?utm_source=meta&utm_campaign=beta', storage: { [KEYS.clarity]: granted(), [KEYS.ga]: denied(), [KEYS.meta]: metaDenied() } });
  assert.equal(b3.clarityScripts().length, 1, 'UTM만 있는 주소는 정상 로드');
});

test('Clarity 긴급 중단 스위치(ENABLED=false): 항목이 숨겨지고, 저장값이 granted여도 로드하지 않는다', () => {
  const b = boot({ clarityDisabled: true, storage: { [KEYS.clarity]: granted() } });
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(typeof b.sandbox.clarity, 'undefined');
  assert.equal(b.els.consentChoiceClarity.parentNode.hidden, true);
});

test('Meta 긴급 중단(ENABLED=false)이어도 Clarity는 독립 동작 — 안내창을 GA4 + Clarity 두 항목으로 열고, Meta 항목은 숨기며, 저장된 허용은 그대로 로드한다', () => {
  const b = boot({ metaDisabled: true });
  assert.equal(b.els.analyticsConsentBanner.hidden, false);
  assert.equal(b.els.consentChoices.hidden, false);
  assert.equal(b.els.consentSaveChoices.hidden, false);
  assert.equal(b.els.consentChoiceMeta.parentNode.hidden, true, 'Meta 항목은 숨긴다');
  assert.equal(b.els.consentChoiceClarity.parentNode.hidden, false);
  assert.equal(b.els.consentChoiceClarity.checked, false);
  assert.equal(b.els.analyticsConsentAllow.textContent, '모두 허용');
  assert.equal(b.els.analyticsConsentDeny.textContent, '모두 허용하지 않음');
  assert.equal(b.els.analyticsSettingsLink.textContent, '분석·광고 설정', '방침이 안내하는 푸터 이름과 같다');
  assert.equal(b.clarityScripts().length, 0);
  // 선택 저장: GA4 해제 + Clarity 허용 — GA4 저장도 이 경로에서 처리된다
  b.els.consentChoiceClarity.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.ga), 'denied');
  assert.equal(b.status(KEYS.clarity), 'granted');
  assert.equal(b.status(KEYS.meta), null, 'Meta는 꺼져 있으므로 저장하지 않는다');
  assert.equal(b.clarityScripts().length, 1);
  assert.equal(b.els.analyticsConsentBanner.hidden, true);
  // 다시 열면 저장된 상태로 체크, 상태 줄에는 광고 측정이 없다
  b.els.analyticsSettingsLink.click();
  assert.equal(b.els.consentChoiceClarity.checked, true);
  assert.equal(b.els.consentChoiceGa.checked, false);
  assert.match(b.els.analyticsConsentStatus.textContent, /^현재 상태: 이용 분석 허용 안 함 · 방문 행동 분석 허용됨$/);
  // GA4만 허용으로 바꾸고 Clarity를 철회
  b.els.consentChoiceGa.checked = true;
  b.els.consentChoiceClarity.checked = false;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.ga), 'granted');
  assert.equal(b.status(KEYS.clarity), 'denied');
  assert.ok(b.calls().some(c => c[0] === 'stop'));
  // 저장된 허용은 다음 방문에서 Meta 없이도 로드된다
  const b2 = boot({ metaDisabled: true, storage: { [KEYS.clarity]: granted(), [KEYS.ga]: denied() } });
  assert.equal(b2.els.analyticsConsentBanner.hidden, true);
  assert.equal(b2.clarityScripts().length, 1);
  // 모두 허용 / 모두 허용하지 않음
  const b3 = boot({ metaDisabled: true });
  b3.els.analyticsConsentAllow.click();
  assert.equal(b3.status(KEYS.ga), 'granted');
  assert.equal(b3.status(KEYS.clarity), 'granted');
  assert.equal(b3.clarityScripts().length, 1);
  const b4 = boot({ metaDisabled: true });
  b4.els.analyticsConsentDeny.click();
  assert.equal(b4.status(KEYS.clarity), 'denied');
  assert.equal(b4.clarityScripts().length, 0);
});

test('Meta 스크립트를 아예 싣지 않아도(noMeta) Clarity가 동작한다 — Meta 코어·UI에 의존하지 않는다', () => {
  const b = boot({ noMeta: true });
  assert.equal(b.els.consentChoices.hidden, false);
  b.els.consentChoiceClarity.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.clarity), 'granted');
  assert.equal(b.clarityScripts().length, 1);
  assert.equal(b.sandbox.launchdeskMetaPixelCore, undefined);
  // 안전하지 않은 주소 판정도 Meta 코어 없이 동작
  const b2 = boot({ noMeta: true, hash: '#access_token=abc', storage: { [KEYS.clarity]: granted() } });
  assert.equal(b2.clarityScripts().length, 0);
  b2.navigate('#/start');
  assert.equal(b2.clarityScripts().length, 1);
});

test('Meta 켜짐 + Clarity 긴급 중단: Meta 통합 안내창은 그대로(GA4·Meta 저장·철회), Clarity 항목만 숨고 로드 없음', () => {
  const b = boot({ clarityDisabled: true, storage: { [KEYS.clarity]: granted() } });
  assert.equal(b.els.consentChoices.hidden, false);
  assert.equal(b.els.consentChoiceClarity.parentNode.hidden, true);
  b.els.consentChoiceGa.checked = true;
  b.els.consentChoiceMeta.checked = true;
  b.els.consentSaveChoices.click();
  assert.equal(b.status(KEYS.ga), 'granted');
  assert.equal(b.status(KEYS.meta), 'granted');
  assert.equal(b.scripts.filter(s => /connect\.facebook\.net/.test(s.src)).length, 1);
  assert.equal(b.clarityScripts().length, 0);
  assert.doesNotMatch(b.els.analyticsConsentStatus.textContent, /방문 행동 분석/);
});

test('둘 다 긴급 중단: 안내창은 GA4 전용 그대로(선택 목록 숨김), Clarity 없음', () => {
  const b = boot({ metaDisabled: true, clarityDisabled: true });
  assert.equal(b.els.consentChoices.hidden, true);
  assert.equal(b.els.consentSaveChoices.hidden, true);
  assert.equal(b.els.analyticsConsentAllow.textContent, '분석 허용');
  b.els.analyticsConsentAllow.click();
  assert.equal(b.clarityScripts().length, 0);
  assert.equal(b.status(KEYS.clarity), null);
});

test('isSafeLocation: Clarity 사본이 Meta 코어와 모든 경우에 같은 답을 낸다(복사본이 어긋나지 않게)', () => {
  const clarity = require('../clarity-consent-core.js');
  const meta = require('../meta-pixel-core.js');
  const hashes = ['', '#', '#/', '#/start', '#/tools?x=1', '#access_token=abc', '#error=denied', '#foo', '#/#token=1'];
  const searches = ['', '?', '?utm_source=meta', '?code=1', '?CODE=1', '?state=x&utm=1', '?a=1&refresh_token=z', '?%63ode=1', '?type=signup', '?token_hash=q', '?ok=1'];
  let n = 0;
  hashes.forEach((h) => searches.forEach((s) => {
    assert.equal(clarity.isSafeLocation(h, s), meta.isSafeLocation(h, s), 'hash=' + JSON.stringify(h) + ' search=' + JSON.stringify(s));
    n++;
  }));
  assert.ok(n > 90);
});

test('Clarity 호출은 동의 신호와 stop뿐 — 식별자·이메일·사용자 지정 태그를 싣지 않는다', () => {
  const b = boot();
  b.els.analyticsConsentAllow.click();
  b.navigate('#/account');
  assert.ok(b.calls().every(c => c[0] === 'consentv2' || c[0] === 'stop'));
  const code = CLARITY_UI_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /clarity\(\s*['"](identify|set|event|upgrade)['"]/);
});

test('index.html: Clarity 스니펫을 넣지 않고(clarity.ms는 로더만 안다), 로더는 meta-pixel.js 다음, 안내창은 하나, 항목은 기본 해제', () => {
  assert.doesNotMatch(INDEX, /clarity\.ms/, 'index.html에는 clarity.ms 주소가 없어야 한다(동의 전 요청 방지)');
  assert.doesNotMatch(INDEX, /<script[^>]*>[^<]*clarity/i);
  const i = (s) => INDEX.indexOf('<script src="' + s + '"></script>');
  assert.ok(i('meta-pixel.js') > 0 && i('clarity-consent-core.js') > i('meta-pixel.js') && i('clarity-consent.js') > i('clarity-consent-core.js'));
  assert.equal((INDEX.match(/class="consent-banner"/g) || []).length, 1);
  assert.match(INDEX, /<input type="checkbox" id="consentChoiceClarity">/, '기본 해제(checked 없음)');
  const choice = INDEX.match(/<input type="checkbox" id="consentChoiceClarity">[\s\S]*?<\/label>/)[0];
  for (const s of ['방문 행동 분석 (Microsoft Clarity)', 'Microsoft Corporation', '화면 주소', '클릭·스크롤·마우스 이동', 'IP 주소', '브라우저 식별값(쿠키)', '입력창 내용은 가려서 전송', '30일 보관']) {
    assert.ok(choice.includes(s), '안내창 Clarity 항목에 없음: ' + s);
  }
  assert.match(INDEX, /허용하지 않아도 모든 기능을 그대로 이용할 수 있어요/);
  // GA4 · Meta 항목은 그대로
  assert.match(INDEX, /<input type="checkbox" id="consentChoiceGa">/);
  assert.match(INDEX, /<input type="checkbox" id="consentChoiceMeta">/);
});

test('로그인 후 화면 마스킹: 개인 데이터가 나오는 컨테이너에 data-clarity-mask가 정적으로 붙어 있고(동적 토글 아님), 방침 11번 문구와 일치한다', () => {
  const tagOf = (id) => { const m = INDEX.match(new RegExp('<(?:section|div|span)[^>]*id="' + id + '"[^>]*>')); assert.ok(m, id + ' 요소를 찾지 못함'); return m[0]; };
  // 화면 전체: 운영 현황(주문·광고계정·쇼핑몰 이름) · 내 계정(이메일·쇼핑몰 목록) · 관리자(문의자 이름·연락처)
  ['view-dashboard', 'view-account', 'view-admin'].forEach((id) => assert.match(tagOf(id), /data-clarity-mask="true"/, id));
  // 사이드바 프로필 · 상단 사용자 배지 · 알림
  ['profileCard', 'topbarUserBadge', 'toastStack', 'mcPlanAccount'].forEach((id) => assert.match(tagOf(id), /data-clarity-mask="true"/, id));
  // 로그인 · 쇼핑몰 · 연동 · 광고 세트 연결 · 도매처 문의 창
  ['loginModal', 'storeFormModal', 'cafe24ConnectModal', 'metaAdAccountModal', 'marginLinkModal', 'wholesaleInquiryModal'].forEach((id) => assert.match(tagOf(id), /data-clarity-mask="true"/, id));
  // 마진 계산기의 "최근 저장한 계산" 목록(계산에 붙인 이름)
  assert.match(INDEX, /<div class="dash-panel" data-clarity-mask="true">\s*<div class="dash-panel-head">최근 저장한 계산<\/div>\s*<div id="savedCalcList"/);
  // 관리자 화면이 body에 직접 붙이는 오버레이(문의 상세 · 도매처 수정 등)는 view 밖이라 각각 가린다
  const adminSrc = read('admin.js');
  const overlays = adminSrc.match(/overlay\.className = 'modal open';/g) || [];
  const maskedOverlays = adminSrc.match(/overlay\.className = 'modal open';\r?\n\s*overlay\.setAttribute\('data-clarity-mask', 'true'\)/g) || [];
  assert.equal(overlays.length, 5);
  assert.equal(maskedOverlays.length, overlays.length, 'admin.js 오버레이를 새로 만들면 data-clarity-mask도 함께 붙여야 한다');
  // 동적 토글에 기대지 않는다 — Clarity는 노드가 생길 때 마스킹을 정하므로 로그인 후에 속성을 붙이면 이미 기록된 노드는 가려지지 않는다
  assert.doesNotMatch(read('app.js') + read('clarity-consent.js').replace(/\/\*[\s\S]*?\*\//g, ''), /setAttribute\(\s*['"]data-clarity-mask|dataset\.clarityMask|toggleAttribute\(\s*['"]data-clarity-mask/);
  // 방침 11번이 실제 마스킹 범위를 그대로 말한다(대시보드 Masking 설정을 약속하지 않는다)
  const has = (s) => assert.ok(PRIVACY_HTML.includes(s), '방침에서 찾지 못함: ' + s);
  has('이용자가 입력창에 입력한 내용은 Clarity가 모든 마스킹 설정에서 가려 전송하지 않으며');
  has('로그인 후 화면(운영 현황, 내 계정과 쇼핑몰 정보, 관리자 화면, 저장한 계산 기록, 로그인·연동 창, 안내 알림, 프로필 표시)의 글자와 값을 Clarity가 수집하지 않도록 따로 가립니다');
  has('로그인 전 안내 화면의 고정 문구는 가려지지 않을 수 있습니다');
  assert.doesNotMatch(PRIVACY_HTML, /기본 설정 이상으로 마스킹을 유지/, 'Clarity 대시보드의 Masking 설정은 코드로 확인할 수 없으므로 방침이 약속하지 않는다');
});

test('빌드: clarity 로더 두 파일이 배포 출력에 포함된다', () => {
  const { staticFilesFor } = require('../scripts/build-static-output.js');
  const files = staticFilesFor(INDEX);
  assert.ok(files.includes('clarity-consent-core.js') && files.includes('clarity-consent.js'));
});

test('개인정보처리방침 v1.5: Clarity 사업자 · 목적 · 항목 · 보유 · 동의·철회 방법이 코드와 일치하게 적혀 있다', () => {
  const has = (s) => assert.ok(PRIVACY_HTML.includes(s), '방침에서 찾지 못함: ' + s);
  // 코드와 일치: 프로젝트 ID · 저장 키 · 푸터 링크 이름 · 쿠키
  has('Microsoft Clarity(프로젝트 ID: ' + PROJECT_ID + ')');
  has('<td>ld-clarity-consent-v1</td>');
  assert.ok(CLARITY_CORE_SRC.includes("STORAGE_KEY = 'ld-clarity-consent-v1'"));
  assert.ok(CLARITY_CORE_SRC.includes("PROJECT_ID = '" + PROJECT_ID + "'"));
  assert.ok(META_UI_SRC.includes("settingsLink.textContent = '분석·광고 설정'"));
  has('푸터의 <strong>분석·광고 설정</strong>');
  has('Clarity 쿠키(_clck, _clsk)');
  // 2번 목적 · 3번 수집 항목 · 4번 보유
  has('방문 행동 분석 — 이용자가 방문 행동 분석(Microsoft Clarity)에 별도로 동의한 경우에만');
  assert.match(PRIVACY_HTML, /<tr><td>방문 행동 분석 정보\(Microsoft Clarity\)<\/td><td>[^<]*방문한 화면 주소\(URL\)[^<]*클릭·스크롤·마우스 이동[^<]*입력창에 입력한 내용은 가려서 전송하지 않음[^<]*IP 주소[^<]*<\/td><td>[^<]*동의한 경우에만[^<]*<\/td><\/tr>/);
  has('Microsoft Clarity는 녹화 데이터를 녹화 시점부터 30일간 보관하며');
  has('최대 9개월까지 보관될 수 있습니다');
  // 5번 · 7번: 회사가 넘기는 것이 아니라 Microsoft가 직접 수집 — 분류를 단정하지 않는다
  has('회사가 보유한 개인정보를 Microsoft에 넘기는 방식이 아니라 이 웹사이트에 설치된 Clarity 스크립트를 통해 Microsoft Corporation이 이용자의 브라우저에서 방문·이용 정보를 직접 수집하며');
  const pv7 = PRIVACY_HTML.slice(PRIVACY_HTML.indexOf('<section id="pv-7"'), PRIVACY_HTML.indexOf('<section id="pv-8"'));
  assert.ok(!/<td>Microsoft/.test(pv7), '7번 표에 Microsoft 행을 두지 않는다');
  assert.doesNotMatch(PRIVACY_HTML, /Microsoft[\s\S]{0,80}(위탁|제3자 제공|국외 이전)에 해당/);
  // 11번: 동의 전 미로드 · 별도 선택 · 기존 동의 미간주 · 철회 즉시 중지 · 쿠키 삭제 · 제3자 쿠키는 삭제 불가
  has('동의하기 전에는 관련 스크립트가 불러와지지 않고 어떤 정보도 Microsoft로 전송되지 않습니다');
  has('이미 다른 항목에 동의하거나 거부한 이용자에게도 방문 행동 분석은 따로 물어봅니다');
  has('철회하면 그 즉시 Clarity의 수집을 중지시키며, 철회 이후 새로 발생하는 정보는 전송되지 않습니다.');
  // 실제 Clarity 런타임은 stop 시 대기 중이던 기록을 마지막으로 1회 전송한다(브라우저 확인) — 없는 것처럼 쓰지 않는다
  has('철회 시점까지 이미 수집돼 브라우저에 대기 중이던 기록은 Clarity가 종료 처리 과정에서 마지막으로 한 번 전송할 수 있습니다');
  has('이 사이트에 남아 있는 Clarity 쿠키(_clck, _clsk)와 Clarity가 브라우저 세션에 저장한 값을 함께 삭제하고');
  has('이 쿠키는 회사가 삭제할 수 없으므로 브라우저 설정에서 직접 삭제하실 수 있습니다');
  const thirdPartyTable = PRIVACY_HTML.match(/<caption class="sr-only">제3자가 수집해가는 행태정보<\/caption>[\s\S]*?<\/table>/);
  assert.ok(thirdPartyTable);
  assert.ok(thirdPartyTable[0].includes('<td>Microsoft Clarity(프로젝트 ID: ' + PROJECT_ID + ')</td><td>Microsoft Corporation('));
  assert.ok(thirdPartyTable[0].includes('안내창에서 선택하지 않기(기본 해제), 푸터 “분석·광고 설정”에서 동의 철회, 브라우저에서 쿠키 차단·삭제'));
  assert.equal((thirdPartyTable[0].match(/<tr><td>/g) || []).length, 2, '행태정보 표는 Meta 행과 Clarity 행 두 줄');
  // 안내창 문구와 방침이 같은 보유기간(30일)을 말한다
  assert.ok(INDEX.includes('Clarity 녹화 데이터 30일 보관'));
  // 확인하지 못한 쿠키 만료 일수를 지어내지 않는다
  PRIVACY_HTML.split('\n').filter((l) => /_clck|_clsk/.test(l)).forEach((l) => {
    assert.ok(!/(_clck|_clsk)[^<]{0,120}[0-9]+\s*(일|개월|days)/.test(l), '확인하지 않은 쿠키 만료 기간을 적지 않는다: ' + l.trim().slice(0, 80));
  });
});
