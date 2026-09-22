/* 회원가입/Google OAuth 필수 동의 + 게이트 흐름 — 실행: node --test
   (Node 18+ 내장 test runner, 별도 패키지 없음)

   실제 store.js + policy-consent-core.js + policy-consent.js + app.js
   소스를 vm 샌드박스(최소 DOM 스텁 + 가짜 Supabase + 가짜 타이머)에서
   그대로 실행한다 — step-progress-sync.test.js와 같은 방식(별도 헬퍼가
   아니라 진짜 코드 경로를 지난다). document.getElementById는 미리
   등록하지 않은 id에 대해서도 범용 <div>를 즉석에서 만들어 돌려주므로
   (같은 id는 항상 같은 인스턴스), app.js가 참조하는 수많은 화면 요소를
   일일이 스텁하지 않아도 로드된다 — 실제로 필요한 요소(체크박스/버튼/
   모달)만 이름으로 상태를 조작·확인한다.

   라이브 Supabase/네트워크는 전혀 쓰지 않는다 — from()/auth의 모든 호출은
   이 파일의 가짜 구현이 메모리에서 처리한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'store.js'), 'utf8');
const POLICY_CORE_SRC = fs.readFileSync(path.join(ROOT, 'policy-consent-core.js'), 'utf8');
const POLICY_UI_SRC = fs.readFileSync(path.join(ROOT, 'policy-consent.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const TERMS_VERSION = '2026-09-18';
const PRIVACY_VERSION = 'v1.1';
const USER = { id: 'user-1', email: 'a@example.com' };
const SESSION = { user: USER };

// ---------------------------------------------------------------- DOM 스텁
// step-progress-sync.test.js와 동일한 최소 스텁(범용 <div> 즉석 생성).
function makeEl(tag){
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, classes: new Set(), style: {}, listeners: {},
    hidden: false, textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    offsetWidth: 0, offsetParent: null, parentElement: null, firstElementChild: null,
    getAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v){ this.attrs[n] = String(v); },
    hasAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n); },
    addEventListener(type, fn){ (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn){
      if(!this.listeners[type]) return;
      this.listeners[type] = this.listeners[type].filter(f => f !== fn);
    },
    dispatch(type){
      const ev = { type, target: this, currentTarget: this, defaultPrevented: false, key: this._nextKey, shiftKey: !!this._nextShiftKey, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){} };
      (this.listeners[type] || []).slice().forEach(fn => fn.call(this, ev));
      return ev;
    },
    click(){ return this.dispatch('click'); },
    focus(){}, blur(){}, remove(){}, reset(){}, scrollIntoView(){},
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; }, matches(){ return false; }
  };
  el.classList = {
    add(c){ el.classes.add(c); }, remove(c){ el.classes.delete(c); }, contains(c){ return el.classes.has(c); },
    toggle(c, force){ const on = (force === undefined) ? !el.classes.has(c) : !!force; if(on) el.classes.add(c); else el.classes.delete(c); return on; }
  };
  return el;
}
function makeDocument(){
  const byId = new Map();
  return {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null,
    getElementById(id){ if(!byId.has(id)) byId.set(id, makeEl('div')); return byId.get(id); },
    createElement(tag){ return makeEl(tag); },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}
  };
}
function memStorage(){
  const s = {};
  return { getItem(k){ return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; }, setItem(k, v){ s[k] = String(v); }, removeItem(k){ delete s[k]; } };
}
function makeTimers(){
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn){ seq++; pending.set(seq, fn); return seq; },
    clearTimeout(id){ pending.delete(id); },
    runAll(){ let guard = 0; while(pending.size && guard++ < 50){ const fns = Array.from(pending.values()); pending.clear(); fns.forEach(fn => fn()); } }
  };
}

// ---------------------------------------------------------------- 가짜 Supabase
// user_policy_consents만 실제 유니크 제약(user_id, terms_version,
// privacy_version)을 흉내 낸다 — 그 외 테이블(user_step_progress/profiles
// 등)은 항상 빈 결과를 주는 범용 체인으로 처리해 hydrate()/checkProfileRow()가
// 에러 없이 지나가게 한다.
function makeSupabase(opts){
  opts = opts || {};
  const consentRows = (opts.consentRows || []).slice();
  const consentInserts = [];
  const calls = [];
  const writeCalls = []; // user_policy_consents 외 테이블에 대한 insert/upsert/delete 시도 기록(0이어야 하는 경로 검증용)
  let authCb = null;
  let currentSession = opts.session || null;
  let forceConsentInsertError = !!opts.forceConsentInsertError;
  let forceConsentSelectError = !!opts.forceConsentSelectError;

  function genericChain(table){
    let op = null;
    const q = {};
    q.select = () => q;
    ['eq', 'order', 'limit', 'maybeSingle'].forEach(m => { q[m] = () => q; });
    q.insert = payload => { op = 'insert'; writeCalls.push({ table, op: 'insert', payload }); return q; };
    q.upsert = payload => { op = 'upsert'; writeCalls.push({ table, op: 'upsert', payload }); return q; };
    q.delete = () => { op = 'delete'; writeCalls.push({ table, op: 'delete' }); return q; };
    q.then = (res, rej) => Promise.resolve().then(() => (op ? { data: null, error: null } : { data: [], error: null })).then(res, rej);
    q.catch = rej => q.then(undefined, rej);
    return q;
  }

  function consentChain(){
    const filters = {};
    let op = null;
    let insertPayload = null;
    const q = {};
    q.select = () => q;
    q.eq = (col, val) => { filters[col] = val; return q; };
    q.maybeSingle = () => q;
    q.insert = payload => { op = 'insert'; insertPayload = payload; return q; };
    function result(){
      if(op === 'insert'){
        consentInserts.push(Object.assign({}, insertPayload));
        if(forceConsentInsertError){
          return { data: null, error: { code: '500', message: '강제 삽입 오류(테스트)' } };
        }
        const dupe = consentRows.some(r => r.user_id === insertPayload.user_id && r.terms_version === insertPayload.terms_version && r.privacy_version === insertPayload.privacy_version);
        if(dupe){
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        consentRows.push({
          user_id: insertPayload.user_id,
          terms_version: insertPayload.terms_version,
          privacy_version: insertPayload.privacy_version,
          source: insertPayload.source,
          accepted_at: new Date().toISOString()
        });
        return { data: [{ id: 'c' + consentRows.length }], error: null };
      }
      if(forceConsentSelectError){
        return { data: null, error: { code: '500', message: '강제 조회 오류(테스트)' } };
      }
      const match = consentRows.find(r => r.user_id === filters.user_id && r.terms_version === filters.terms_version && r.privacy_version === filters.privacy_version);
      return { data: match || null, error: null };
    }
    q.then = (res, rej) => Promise.resolve().then(result).then(res, rej);
    q.catch = rej => q.then(undefined, rej);
    return q;
  }

  const sb = {
    from(table){
      calls.push(table);
      return table === 'user_policy_consents' ? consentChain() : genericChain(table);
    },
    auth: {
      getSession(){ return Promise.resolve({ data: { session: currentSession } }); },
      onAuthStateChange(cb){ authCb = cb; },
      signInWithPassword(){ return Promise.resolve({ data: {}, error: null }); },
      signUp(){ return Promise.resolve({ data: { user: { id: 'new-user' }, session: null }, error: null }); },
      signInWithOAuth(){ return Promise.resolve({ data: {}, error: null }); },
      signOut(){
        currentSession = null;
        const cb = authCb;
        if(cb) cb('SIGNED_OUT', null);
        return Promise.resolve({ error: null });
      }
    }
  };
  return {
    sb,
    consentRows, consentInserts, calls, writeCalls,
    setForceConsentInsertError(v){ forceConsentInsertError = v; },
    setForceConsentSelectError(v){ forceConsentSelectError = v; },
    emitAuth(event, session){ currentSession = session; return authCb(event, session); }
  };
}

// ---------------------------------------------------------------- 부팅
async function settle(n){ for(let i = 0; i < (n || 40); i++) await new Promise(r => setImmediate(r)); }
async function boot(opts){
  opts = opts || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const supa = makeSupabase(opts);
  const env = { doc, timers, supa, warns: [] };
  const sandbox = {
    console: { log(){}, info(){}, warn(){ env.warns.push(Array.from(arguments).join(' ')); }, error(){} },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(fn){ fn(0); return 1; }, cancelAnimationFrame(){},
    URLSearchParams, document: doc,
    location: { hash: '', origin: 'http://localhost', pathname: '/', search: opts.locationSearch || '', href: 'http://localhost/' },
    history: { replaceState(){}, back(){}, forward(){} },
    localStorage: memStorage(), sessionStorage: memStorage(),
    matchMedia(){ return { matches: false }; }, scrollTo(){}, addEventListener(){}, removeEventListener(){},
    confirm(){ return true; }, alert(){},
    gtag(){},
    launchdeskSupabase: supa.sb
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // index.html 로드 순서와 동일: store.js → policy-consent-core.js →
  // policy-consent.js → app.js.
  vm.runInContext(STORE_SRC, sandbox, { filename: 'store.js' });
  vm.runInContext(POLICY_CORE_SRC, sandbox, { filename: 'policy-consent-core.js' });
  vm.runInContext(POLICY_UI_SRC, sandbox, { filename: 'policy-consent.js' });
  if(opts.presetPendingSource){
    const c = sandbox.launchdeskPolicyConsentCore;
    sandbox.sessionStorage.setItem(c.PENDING_KEY, c.serializePending(opts.presetPendingSource));
  }
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' });
  env.sandbox = sandbox;
  env.core = sandbox.launchdeskPolicyConsentCore;
  env.store = sandbox.launchdeskStore;
  await settle();
  return env;
}
async function flush(env){ await settle(); env.timers.runAll(); await settle(); }

function setBox(box, checked){ box.checked = checked; box.dispatch('change'); }
function setInput(inp, value){ inp.value = value; inp.dispatch('input'); }
function stashPending(env, source, createdAt){
  env.sandbox.sessionStorage.setItem(env.core.PENDING_KEY, env.core.serializePending(source, createdAt));
}
function hydrateStarted(env){ return env.supa.calls.includes('user_step_progress'); }
function gateOpen(env){ return env.doc.getElementById('consentGateModal').classes.has('open'); }

// ------------------------------------------------------------------ 테스트

test('회원가입 체크박스는 기본값이 미체크(false)', async () => {
  const env = await boot();
  assert.equal(env.doc.getElementById('signupConsentTerms').checked, false);
  assert.equal(env.doc.getElementById('signupConsentPrivacy').checked, false);
});

test('약관·개인정보 링크는 새 탭 + label 밖(체크박스 비토글) + 실제 라우트(#/terms, #/privacy)', () => {
  const signupBlock = INDEX_HTML.slice(INDEX_HTML.indexOf('id="signupConsentBlock"'), INDEX_HTML.indexOf('id="signupConsentBlock"') + 1800);
  assert.match(signupBlock, /<a href="#\/terms" target="_blank" rel="noopener">보기<\/a>/);
  assert.match(signupBlock, /<a href="#\/privacy" target="_blank" rel="noopener">보기<\/a>/);
  // 링크가 label 안이 아니라 label의 형제 요소인지(라벨 클릭 시 체크박스가
  // 토글돼도 링크 클릭이 그 토글에 얹히지 않도록 구조적으로 분리) 확인.
  assert.doesNotMatch(signupBlock, /<label>[^<]*<input[^>]*id="signupConsentTerms"[\s\S]{0,40}<a href="#\/terms"/);
});

test('Kakao 로그인 버튼은 hidden 유지', () => {
  assert.match(INDEX_HTML, /<button type="button" class="oauth-btn oauth-kakao" id="kakaoLoginBtn" hidden>/);
});

test('이메일 회원가입: 하나만 체크하면 signUp 호출 없이 차단', async () => {
  const env = await boot();
  env.sandbox.loginMode = undefined; // 참고용(직접 접근 안 함) — 아래 UI 흐름으로만 모드 전환
  env.doc.getElementById('loginToSignup').dispatch('click');
  setInput(env.doc.getElementById('loginEmail'), 'new@example.com');
  setInput(env.doc.getElementById('loginPw'), 'password123');
  setInput(env.doc.getElementById('loginPwConfirm'), 'password123');
  setBox(env.doc.getElementById('signupConsentTerms'), true); // 개인정보 동의는 미체크
  env.doc.getElementById('loginForm').dispatch('submit');
  await flush(env);
  assert.equal(env.supa.consentInserts.length, 0);
  assert.equal(env.doc.getElementById('signupConsentError').hidden, false);
  assert.equal(env.doc.getElementById('signupConsentBlock').hidden, false, '아직 신호가 없어도 오류를 보여주려면 블록이 드러나 있어야 함');
});

test('이메일 회원가입: 둘 다 체크하면 진행되고 pending이 남는다', async () => {
  const env = await boot();
  env.doc.getElementById('loginToSignup').dispatch('click');
  setInput(env.doc.getElementById('loginEmail'), 'new@example.com');
  setInput(env.doc.getElementById('loginPw'), 'password123');
  setInput(env.doc.getElementById('loginPwConfirm'), 'password123');
  setBox(env.doc.getElementById('signupConsentTerms'), true);
  setBox(env.doc.getElementById('signupConsentPrivacy'), true);
  env.doc.getElementById('loginForm').dispatch('submit');
  await flush(env);
  // signUp()은 session:null을 반환하도록 가짜가 구성돼 있음(이메일 인증 대기) —
  // 요구사항 3에 따라 pending은 즉시 비워져야 한다(다른 계정에 잘못 이어받지 않도록).
  assert.equal(env.sandbox.sessionStorage.getItem(env.core.PENDING_KEY), null);
});

test('기본 login 모드(회원가입으로 전환한 적 없음)에서 Google 클릭 → 동의 UI가 실제로 드러나고, 미동의 시 signInWithOAuth 0회', async () => {
  const env = await boot();
  // 실제 사용자가 "로그인" 링크를 눌러 모달을 여는 것과 동일한 진입점
  // (window.launchdeskOpenLoginModal) — 항상 loginMode='login'으로 연다.
  // loginToSignup은 한 번도 클릭하지 않는다.
  env.sandbox.launchdeskOpenLoginModal();
  assert.equal(env.doc.getElementById('loginModalTitle').textContent, '로그인', '기본 진입은 로그인 모드다(회원가입 아님)');
  assert.equal(env.doc.getElementById('signupConsentBlock').hidden, true, '로그인 모드 기본 상태 — 아직 필요 없으니 숨겨져 있다');

  let oauthCalls = 0;
  env.sandbox.launchdeskSupabase.auth.signInWithOAuth = () => { oauthCalls++; return Promise.resolve({ data: {}, error: null }); };
  env.doc.getElementById('googleLoginBtn').dispatch('click');
  await flush(env);

  // hidden이었던 체크박스를 "검사"하는 게 아니라, 사용자가 실제로 보게 되는
  // 블록이 이 시점에 드러났는지부터 확인한다 — login 모드의 숨은 체크박스를
  // 그대로 어서션 대상으로 삼지 않는다.
  assert.equal(env.doc.getElementById('signupConsentBlock').hidden, false, 'Google 클릭 즉시 동의 UI가 사용자에게 보여야 한다');
  assert.equal(env.doc.getElementById('signupConsentError').hidden, false, '미동의 안내가 함께 보여야 한다');
  assert.equal(env.doc.getElementById('signupConsentError').textContent, '필수 동의 항목을 확인해주세요');
  assert.equal(oauthCalls, 0, '미동의 상태에서는 OAuth 호출이 전혀 나가면 안 된다');
  assert.equal(env.sandbox.sessionStorage.getItem(env.core.PENDING_KEY), null, '취소(미동의)면 pending도 전혀 남지 않는다');

  // 키보드로 체크 가능한지 — 이제 블록이 보이므로 실제 checkbox input에
  // change 이벤트(스페이스바로 토글하는 것과 동일한 DOM 결과)가 반영된다.
  const termsBox = env.doc.getElementById('signupConsentTerms');
  const privacyBox = env.doc.getElementById('signupConsentPrivacy');
  setBox(termsBox, true);
  setBox(privacyBox, true);
  assert.equal(termsBox.checked, true);
  assert.equal(privacyBox.checked, true);

  // 두 항목 모두 체크한 뒤 다시 클릭하면 정확히 1회만 호출돼야 한다.
  env.doc.getElementById('googleLoginBtn').dispatch('click');
  await flush(env);
  assert.equal(oauthCalls, 1, '동의 후 OAuth는 정확히 1회 호출돼야 한다');
  const pending = env.core.parsePending(env.sandbox.sessionStorage.getItem(env.core.PENDING_KEY));
  assert.equal(pending.source, env.core.SOURCES.GOOGLE_OAUTH);

  // 중복 클릭해도 oauthInFlight 가드로 추가 호출은 없다.
  env.doc.getElementById('googleLoginBtn').dispatch('click');
  await flush(env);
  assert.equal(oauthCalls, 1, '진행 중 재클릭은 추가 호출을 만들지 않는다');
});

test('두 항목 실제 checkbox로 마크업돼 있음(login/signup 공용 블록) — 정적 검사', () => {
  const block = INDEX_HTML.slice(INDEX_HTML.indexOf('id="signupConsentBlock"'), INDEX_HTML.indexOf('id="signupConsentBlock"') + 1800);
  assert.match(block, /<input type="checkbox" id="signupConsentTerms">/);
  assert.match(block, /<input type="checkbox" id="signupConsentPrivacy">/);
});

test('Google OAuth: 둘 다 체크하면 시작되고 pending(google_oauth)이 저장된다', async () => {
  const env = await boot();
  let oauthCalled = false;
  env.sandbox.launchdeskSupabase.auth.signInWithOAuth = () => { oauthCalled = true; return Promise.resolve({ data: {}, error: null }); };
  setBox(env.doc.getElementById('signupConsentTerms'), true);
  setBox(env.doc.getElementById('signupConsentPrivacy'), true);
  env.doc.getElementById('googleLoginBtn').dispatch('click');
  await flush(env);
  assert.equal(oauthCalled, true);
  const pending = env.core.parsePending(env.sandbox.sessionStorage.getItem(env.core.PENDING_KEY));
  assert.equal(pending.source, env.core.SOURCES.GOOGLE_OAUTH);
});

test('OAuth 취소/오류로 세션 없이 돌아오면(에러 쿼리스트링) 남은 pending을 즉시 비운다', async () => {
  const env = await boot({ session: null, locationSearch: '?error=access_denied&error_description=user+cancelled', presetPendingSource: 'google_oauth' });
  await flush(env);
  assert.equal(env.sandbox.sessionStorage.getItem(env.core.PENDING_KEY), null, 'SIGNED_IN이 발생하지 않는 취소/오류 경로에서도 pending이 남아있으면 안 된다(다른 로그인 시도가 잘못 이어받을 위험)');
});

test('OAuth 복귀: 유효한 pending → insert 후 재조회로 확인되면 1회만 기록되고 게이트 없이 hydrate 진행', async () => {
  const env = await boot({ session: null });
  stashPending(env, env.core.SOURCES.GOOGLE_OAUTH);
  env.supa.emitAuth('SIGNED_IN', SESSION);
  await flush(env);
  assert.equal(gateOpen(env), false, '유효한 pending이 재확인되면 게이트를 열지 않는다');
  assert.equal(env.supa.consentInserts.length, 1);
  assert.equal(env.supa.consentInserts[0].source, env.core.SOURCES.GOOGLE_OAUTH);
  assert.equal(env.supa.consentRows.length, 1);
  assert.equal(hydrateStarted(env), true, 'pending이 DB로 확인된 뒤에만 hydrate가 진행된다');
});

test('이미 현재 버전 동의가 있는 회원은 게이트 없이 바로 통과하고 중복 insert가 없다', async () => {
  const env = await boot({
    session: SESSION,
    consentRows: [{ user_id: USER.id, terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, source: 'email_signup' }]
  });
  await flush(env);
  assert.equal(gateOpen(env), false);
  assert.equal(env.supa.consentInserts.length, 0, '이미 동의 이력이 있으면 insert를 시도하지 않는다');
  assert.equal(hydrateStarted(env), true);
});

test('개인정보처리방침 v1.0에만 동의한 기존 회원은 v1.1 재동의 대상 — 게이트가 뜨고 hydrate는 보류된다', async () => {
  const env = await boot({
    session: SESSION,
    // 코드의 현재 PRIVACY_VERSION(core.PRIVACY_VERSION)은 v1.1이므로, v1.0에만
    // 동의한 행은 terms_version/privacy_version 둘 다 일치해야 하는 queryHasConsent
    // 조건에 걸려 "동의 없음"으로 판정돼야 한다.
    consentRows: [{ user_id: USER.id, terms_version: TERMS_VERSION, privacy_version: 'v1.0', source: 'email_signup' }]
  });
  await flush(env);
  assert.equal(env.core.PRIVACY_VERSION, 'v1.1', '코드 상수가 v1.1인지 먼저 확인');
  assert.equal(gateOpen(env), true, 'v1.0 동의만 있으면 v1.1 재동의 게이트가 떠야 한다');
  assert.equal(hydrateStarted(env), false, '재동의 전에는 STEP/계획/마진 기록을 불러오지 않는다');
});

test('동의 이력 없는 기존 회원 로그인 → 게이트 표시, 그 전에는 hydrate 금지', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  assert.equal(gateOpen(env), true);
  assert.equal(hydrateStarted(env), false, '게이트를 통과하기 전에는 STEP/계획/마진 기록을 불러오지 않는다');
});

test('게이트: 체크 없이 제출하면 오류만 뜨고 계속 막힌다', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  env.doc.getElementById('gateConsentSubmit').dispatch('click');
  await flush(env);
  assert.equal(env.doc.getElementById('gateConsentError').hidden, false);
  assert.equal(gateOpen(env), true);
  assert.equal(hydrateStarted(env), false);
});

test('게이트: 둘 다 체크하고 제출하면 existing_user_gate로 기록되고 통과한다', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  setBox(env.doc.getElementById('gateConsentTerms'), true);
  setBox(env.doc.getElementById('gateConsentPrivacy'), true);
  env.doc.getElementById('gateConsentSubmit').dispatch('click');
  await flush(env);
  assert.equal(gateOpen(env), false);
  assert.equal(env.supa.consentInserts.length, 1);
  assert.equal(env.supa.consentInserts[0].source, env.core.SOURCES.EXISTING_USER_GATE);
  assert.equal(hydrateStarted(env), true);
});

test('게이트: DB 저장 실패는 동의 완료로 처리하지 않고 재시도 가능 상태로 남긴다', async () => {
  const env = await boot({ session: SESSION, forceConsentInsertError: true });
  await flush(env);
  setBox(env.doc.getElementById('gateConsentTerms'), true);
  setBox(env.doc.getElementById('gateConsentPrivacy'), true);
  env.doc.getElementById('gateConsentSubmit').dispatch('click');
  await flush(env);
  assert.equal(gateOpen(env), true, '저장 실패 시 모달을 닫지 않는다');
  assert.equal(env.doc.getElementById('gateConsentError').hidden, false);
  assert.equal(hydrateStarted(env), false);
  assert.equal(env.supa.consentRows.length, 0);

  // 재시도: 오류를 해제하고 다시 제출하면 통과해야 한다.
  env.supa.setForceConsentInsertError(false);
  env.doc.getElementById('gateConsentSubmit').dispatch('click');
  await flush(env);
  assert.equal(gateOpen(env), false);
  assert.equal(hydrateStarted(env), true);
});

test('게이트: DB 조회 자체가 실패하면 조용히 통과시키지 않고 오류 상태로 게이트를 띄운다', async () => {
  const env = await boot({ session: SESSION, forceConsentSelectError: true });
  await flush(env);
  assert.equal(gateOpen(env), true);
  assert.equal(env.doc.getElementById('gateConsentError').hidden, false);
  assert.equal(hydrateStarted(env), false);
});

test('게이트: 저장 중 중복 클릭해도 동의 이력이 중복 생성되지 않는다', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  setBox(env.doc.getElementById('gateConsentTerms'), true);
  setBox(env.doc.getElementById('gateConsentPrivacy'), true);
  const submit = env.doc.getElementById('gateConsentSubmit');
  submit.dispatch('click');
  submit.dispatch('click'); // 응답 오기 전 즉시 재클릭
  submit.dispatch('click');
  await flush(env);
  assert.equal(env.supa.consentInserts.length, 1, 'submitting 가드가 중복 요청 자체를 막는다');
  assert.equal(env.supa.consentRows.length, 1);
  assert.equal(hydrateStarted(env), true);
});

test('게이트: 동의하지 않고 로그아웃 — signOut 1회만, flushAllPendingSteps/hydrate/서비스 데이터 쓰기·동의 insert 0회', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  let signOutCalls = 0;
  let flushCalls = 0;
  let hydrateCalls = 0;
  const originalSignOut = env.sandbox.launchdeskSupabase.auth.signOut;
  env.sandbox.launchdeskSupabase.auth.signOut = function(){ signOutCalls++; return originalSignOut(); };
  const originalFlush = env.store.flushAllPendingSteps;
  env.store.flushAllPendingSteps = function(){ flushCalls++; return originalFlush(); };
  const originalHydrate = env.store.hydrate;
  env.store.hydrate = function(){ hydrateCalls++; return originalHydrate.apply(env.store, arguments); };

  env.doc.getElementById('gateConsentLogout').dispatch('click');
  await flush(env);

  assert.equal(signOutCalls, 1, 'auth.signOut()는 정확히 1회 호출돼야 한다');
  assert.equal(flushCalls, 0, '동의를 거부한 로그아웃 경로는 flushAllPendingSteps()를 호출하면 안 된다');
  assert.equal(hydrateCalls, 0, '동의를 거부한 로그아웃 경로는 launchdeskStore.hydrate()를 호출하면 안 된다');
  assert.equal(env.supa.consentInserts.length, 0, '동의 이력 insert가 발생하면 안 된다');
  // user_step_progress/tool_records/profiles 등 서비스 데이터 테이블에 대한
  // upsert/insert 자체가 전혀 없어야 한다(select류 호출 흔적만 허용).
  assert.deepEqual(env.supa.writeCalls, [], '서비스 데이터 테이블에 대한 어떤 쓰기(insert/upsert)도 없어야 한다');
  assert.equal(gateOpen(env), false);
  assert.equal(hydrateStarted(env), false);
  assert.equal(env.store.isAuthed(), false);
});

test('게이트: signOut 실패 시 게이트를 유지하고 오류를 보여준다(재시도 가능)', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  env.sandbox.launchdeskSupabase.auth.signOut = function(){ return Promise.reject(new Error('네트워크 오류(테스트)')); };
  env.doc.getElementById('gateConsentLogout').dispatch('click');
  await flush(env);
  assert.equal(gateOpen(env), true, 'signOut 실패 시 게이트를 닫지 않는다');
  assert.equal(env.doc.getElementById('gateConsentError').hidden, false);
  assert.equal(hydrateStarted(env), false);
});

test('single-flight: 같은 사용자에 대해 SIGNED_IN이 겹쳐 발생해도 동의 조회는 1회뿐', async () => {
  const env = await boot({ session: null });
  env.supa.emitAuth('SIGNED_IN', SESSION);
  env.supa.emitAuth('SIGNED_IN', SESSION); // 첫 확인이 끝나기 전에 겹쳐 발생(TOKEN_REFRESHED 등 흉내)
  await flush(env);
  assert.equal(env.supa.calls.filter(t => t === 'user_policy_consents').length, 1, 'from(user_policy_consents) 호출이 1회여야 한다(중복 조회 없음)');
  assert.equal(gateOpen(env), true); // pending 없음 → 게이트로 이어짐(1회만)
});

test('로그아웃 이벤트는 대기 중인 게이트를 정리하고 pending도 비운다', async () => {
  const env = await boot({ session: SESSION });
  await flush(env);
  assert.equal(gateOpen(env), true);
  stashPending(env, env.core.SOURCES.GOOGLE_OAUTH); // 남아있던 pending(있다면) 정리 대상
  env.supa.emitAuth('SIGNED_OUT', null);
  await flush(env);
  assert.equal(gateOpen(env), false);
  assert.equal(env.sandbox.sessionStorage.getItem(env.core.PENDING_KEY), null);
});
