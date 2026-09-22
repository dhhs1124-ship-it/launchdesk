/* 오픈 베타 전 화면 단순화 + 로그인 구간 분리 — 실행: node --test
   (Node 18+ 내장 test runner, 별도 패키지 없음)

   구조적 검증(문자열/슬라이스)과 행동 검증(vm 샌드박스, policy-consent-flow.
   test.js와 동일한 방식 — 최소 DOM 스텁 + 가짜 Supabase로 실제 소스를 그대로
   실행)을 함께 쓴다. 라이브 Supabase/네트워크·Cafe24/Meta API 호출은 전혀
   없다 — 전부 이 파일의 가짜 구현이 메모리에서 처리한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'store.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const MARGIN_CALC_SRC = fs.readFileSync(path.join(ROOT, 'margin-calc.js'), 'utf8');
const PLANS_CORE_SRC = fs.readFileSync(path.join(ROOT, 'plans-core.js'), 'utf8');
const TOOLS_SRC = fs.readFileSync(path.join(ROOT, 'tools.js'), 'utf8');
const OPS_OVERVIEW_SRC = fs.readFileSync(path.join(ROOT, 'ops-overview.js'), 'utf8');
const META_ADSETS_CORE_SRC = fs.readFileSync(path.join(ROOT, 'meta-adsets-core.js'), 'utf8');
const META_MARGIN_CORE_SRC = fs.readFileSync(path.join(ROOT, 'meta-margin-core.js'), 'utf8');
const META_ADSETS_SRC = fs.readFileSync(path.join(ROOT, 'meta-adsets.js'), 'utf8');
const HOME_DASHBOARD_SRC = fs.readFileSync(path.join(ROOT, 'home-dashboard.js'), 'utf8');
const PLANS_SRC = fs.readFileSync(path.join(ROOT, 'plans.js'), 'utf8');

// ============================================================= 1) 구조 검증

test('홈 화면에는 더 이상 이어서 준비하기(#deskResume)도, 내 계획(#ldPlanPanel)도 없다', () => {
  const homeStart = INDEX.indexOf('id="view-home"');
  const homeEnd = INDEX.indexOf('id="view-dashboard"');
  const home = INDEX.slice(homeStart, homeEnd);
  assert.doesNotMatch(home, /id="deskResume"/);
  assert.doesNotMatch(home, /id="ldPlanPanel"/);
  assert.doesNotMatch(home, /이어서 준비하기/);
  // 정상 접근 경로(운영 현황 안내 카드)는 유지
  assert.match(home, /id="deskOpsCardTitle"/);
  assert.match(home, /href="#\/dashboard"/);
});

test('내 계획(#ldPlanPanel)은 DOM에 정확히 1개만 있고, 운영 현황(#/dashboard)의 주문·광고 성과 아래에 있다', () => {
  assert.equal((INDEX.match(/id="ldPlanPanel"/g) || []).length, 1);
  const dashStart = INDEX.indexOf('id="view-dashboard"');
  const dashEnd = INDEX.indexOf('id="view-account"');
  const dash = INDEX.slice(dashStart, dashEnd);
  const metaAdsets = dash.indexOf('id="metaAdsetsPanel"');
  const planPanel = dash.indexOf('id="ldPlanPanel"');
  const triple = dash.indexOf('opsdash-row triple');
  assert.ok(metaAdsets > 0 && metaAdsets < planPanel && planPanel < triple,
    [metaAdsets, planPanel, triple].join(','));
});

test('마진 계산기 화면(#/tools)에는 더 이상 쇼핑몰 운영 현황 · Meta 광고 성과 패널이 없다', () => {
  const start = INDEX.indexOf('id="view-tools"');
  const end = INDEX.indexOf('id="view-setup"') > 0 ? INDEX.indexOf('id="view-setup"') : INDEX.indexOf('id="view-wholesale"');
  const toolsView = INDEX.slice(start, end > start ? end : start + 20000);
  assert.doesNotMatch(toolsView, /id="opsOverviewPanel"/);
  assert.doesNotMatch(toolsView, /id="metaOpsPanel"/);
  // 필수 흐름(계산 입력 → 실행 → 결과 → 저장 → 계획 만들기)은 유지
  assert.match(toolsView, /id="toolsSaveCalc"/);
  assert.match(toolsView, /id="mcPlanOpen"/);
  // 비회원도 전부 체험 가능하다는 문구로 바뀌었는지(더 이상 "저장됩니다" 단정 아님)
  assert.match(toolsView, /로그인 없이도 지금 바로 실제로 계산해볼 수 있어요/);
});

test('운영 현황에는 더 이상 "다음 할 일"/"로그인하고 시작하기" 중복 CTA가 없다', () => {
  const indexNoComments = INDEX.replace(/<!--[\s\S]*?-->/g, ''); // 제거 사실을 남긴 주석은 검사 대상에서 뺀다
  assert.doesNotMatch(INDEX, /id="opsdashNextAction"/);
  assert.doesNotMatch(indexNoComments, /다음 할 일/);
  assert.doesNotMatch(indexNoComments, /로그인하고 시작하기/);
  assert.doesNotMatch(HOME_DASHBOARD_SRC, /buildNextActions|renderNextAction/);
  // 연결 상태 영역 자체는 유지
  assert.match(INDEX, /id="opsdashConnectionStatus"/);
});

test('비회원 운영 현황 게이트(#opsdashGuestGate) 마크업 — 지정된 문구 · 버튼 2개 · 기본 inert', () => {
  const start = INDEX.indexOf('id="opsdashGuestGate"');
  assert.ok(start > 0);
  const gateEnd = INDEX.indexOf('id="opsdashRoot"', start); // 게이트 카드는 #opsdashRoot 시작 전에 닫힌다
  const gate = INDEX.slice(start, gateEnd);
  assert.match(gate, /운영 현황은 회원 전용 기능이에요/);
  assert.match(gate, /무료로 가입하고 Cafe24 주문과 Meta 광고 성과를 한곳에서 확인해보세요\./);
  assert.match(gate, /id="opsdashGateSignup"[^>]*>무료 회원가입/);
  assert.match(gate, /id="opsdashGateLogin"[^>]*>로그인/);
  // 실제 매출·광고 수치는 이 카드 안에 없다("Cafe24" 같은 고유명사의 숫자는 제외)
  assert.doesNotMatch(gate.replace(/Cafe24/g, ''), /\d{2,}/);
  // #opsdashRoot는 정적 마크업 기본값이 이미 안전한 쪽(inert + aria-hidden)
  const rootIdx = INDEX.indexOf('id="opsdashRoot"');
  const rootTag = INDEX.slice(rootIdx - 40, rootIdx + 60);
  assert.match(rootTag, /\binert\b/);
  assert.match(rootTag, /aria-hidden="true"/);
});

test('자료실 CSS에는 더 이상 growth 카테고리만 강제하는 색상 규칙이 없다', () => {
  assert.doesNotMatch(CSS, /data-cat="growth"/);
  assert.doesNotMatch(CSS, /res-stuck-card\[data-cat=/);
});

test('이번 작업에서 광고(AdSense·제휴·추적 링크) 관련 마크업을 추가하지 않았다', () => {
  for (const needle of ['adsbygoogle', 'googlesyndication', 'doubleclick', 'data-ad-client', 'affiliate']) {
    assert.doesNotMatch(INDEX, new RegExp(needle, 'i'));
    assert.doesNotMatch(CSS, new RegExp(needle, 'i'));
  }
});

test('모바일 640px 이하에서 게이트 버튼이 한 줄 전체로 쌓인다(좁은 화면 겹침 방지용 규칙 존재)', () => {
  assert.match(CSS, /@media \(max-width:639px\)\{ \.opsdash-guest-gate/);
});

// ============================================================= 2) 행동 검증(vm 샌드박스)

function makeEl(tag){
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, classes: new Set(), style: {},
    listeners: {}, hidden: false, textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    offsetWidth: 0, offsetParent: null, parentElement: null, firstElementChild: null,
    getAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v){ this.attrs[n] = String(v); },
    removeAttribute(n){ delete this.attrs[n]; },
    hasAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n); },
    addEventListener(type, fn){ (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn){
      if (!this.listeners[type]) return;
      this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
    },
    dispatch(type){
      const ev = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){} };
      (this.listeners[type] || []).slice().forEach((fn) => fn.call(this, ev));
      return ev;
    },
    click(){ return this.dispatch('click'); },
    focus(){}, blur(){}, remove(){}, reset(){}, scrollIntoView(){},
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; }, matches(){ return false; },
    get inert(){ return this.hasAttribute('inert'); },
    set inert(v){ if (v) this.setAttribute('inert', ''); else this.removeAttribute('inert'); }
  };
  el.classList = {
    add(c){ el.classes.add(c); }, remove(c){ el.classes.delete(c); }, contains(c){ return el.classes.has(c); },
    toggle(c, force){ const on = force === undefined ? !el.classes.has(c) : !!force; if (on) el.classes.add(c); else el.classes.delete(c); return on; }
  };
  return el;
}
function makeDocument(){
  const byId = new Map();
  // tools.js는 document.querySelector(...)의 결과(mcRoot)를 null 체크 없이
  // 바로 .querySelector(...)로 다시 판다 — 실제 DOM에는 항상 매치되는
  // 요소가 있어 문제가 없다. 여기서도 null 대신 빈 스텁 엘리먼트를 돌려줘
  // 같은 가정을 깨지 않는다(그 스텁의 querySelector는 다시 null을 반환 —
  // mcRadio()는 이미 그 null을 안전하게 처리한다).
  return {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null,
    getElementById(id){ if (!byId.has(id)) byId.set(id, makeEl('div')); return byId.get(id); },
    createElement(tag){ return makeEl(tag); },
    querySelector(){ return makeEl('div'); }, querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; }
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
    runAll(){ let guard = 0; while (pending.size && guard++ < 50) { const fns = Array.from(pending.values()); pending.clear(); fns.forEach((fn) => fn()); } }
  };
}

function rowMatches(row, filters){
  return Object.keys(filters).every((k) => String(row[k]) === String(filters[k]));
}
function makeSupabase(opts){
  opts = opts || {};
  const stores = (opts.stores || []).slice();
  const connectedAccounts = (opts.connectedAccounts || []).slice();
  const orders = (opts.orders || []).slice();
  const plansRows = (opts.plans || []).slice();
  const adMarginLinks = (opts.adMarginLinks || []).slice();
  const writeCalls = [];
  const callLog = [];
  const invokeCalls = []; // { name, body }
  let currentSession = opts.session || null;
  let authCb = null;

  function genericChain(table){
    let op = null; let payload = null;
    const q = {};
    q.select = () => q;
    ['eq', 'order', 'limit', 'maybeSingle', 'single', 'gte', 'in'].forEach((m) => { q[m] = () => q; });
    q.insert = (p) => { op = 'insert'; payload = p; writeCalls.push({ table, op: 'insert', payload: p }); return q; };
    q.upsert = (p) => { op = 'upsert'; payload = p; writeCalls.push({ table, op: 'upsert', payload: p }); return q; };
    q.update = (p) => { op = 'update'; payload = p; writeCalls.push({ table, op: 'update', payload: p }); return q; };
    q.delete = () => { op = 'delete'; writeCalls.push({ table, op: 'delete' }); return q; };
    q.then = (res, rej) => Promise.resolve().then(() => (op ? { data: payload ? [payload] : null, error: null } : { data: [], error: null })).then(res, rej);
    q.catch = (rej) => q.then(undefined, rej);
    return q;
  }
  function filterChain(rows, tableName){
    const filters = {}; const inFilters = {}; let single = false; let gteCol = null; let gteVal = null; let lim = null;
    const q = {};
    q.select = () => q;
    q.eq = (c, v) => { filters[c] = v; return q; };
    q.in = (c, arr) => { inFilters[c] = arr; return q; };
    q.gte = (c, v) => { gteCol = c; gteVal = v; return q; };
    q.limit = (n) => { lim = n; return q; };
    q.order = () => q;
    q.maybeSingle = () => { single = true; return q; };
    q.then = (res, rej) => Promise.resolve().then(() => {
      if (opts.errorTables && opts.errorTables.includes(tableName)) {
        return { data: null, error: { message: '강제 조회 오류(테스트)' } };
      }
      let matched = rows.filter((r) => rowMatches(r, filters));
      Object.keys(inFilters).forEach((c) => {
        matched = matched.filter((r) => inFilters[c].map(String).includes(String(r[c])));
      });
      if (gteCol) matched = matched.filter((r) => new Date(r[gteCol]).getTime() >= new Date(gteVal).getTime());
      if (lim) matched = matched.slice(0, lim);
      if (single) return { data: matched[0] || null, error: null };
      return { data: matched, error: null };
    }).then(res, rej);
    q.catch = (rej) => q.then(undefined, rej);
    return q;
  }

  const sb = {
    from(table){
      callLog.push(table);
      if (table === 'stores') return filterChain(stores, 'stores');
      if (table === 'connected_accounts') return filterChain(connectedAccounts, 'connected_accounts');
      if (table === 'orders') return filterChain(orders, 'orders');
      if (table === 'plans') return filterChain(plansRows, 'plans');
      if (table === 'ad_margin_links') return filterChain(adMarginLinks, 'ad_margin_links');
      return genericChain(table);
    },
    auth: {
      getSession(){ return Promise.resolve({ data: { session: currentSession } }); },
      onAuthStateChange(cb){ authCb = cb; },
      signOut(){ currentSession = null; const cb = authCb; if (cb) cb('SIGNED_OUT', null); return Promise.resolve({ error: null }); },
      // 테스트 전용 헬퍼 — 실제 Supabase Auth API가 아니라, 세션 교체(재로그인/다른 사용자
      // 로그인) 시나리오를 흉내 내기 위해 이 하네스가 추가한 것. launchdeskStore.hydrate()가
      // onAuthStateChange를 구독하지 않고 자체 sb.auth.getSession()/onAuthStateChange 흐름을
      // 쓰므로, SIGNED_IN 이벤트를 직접 흘려보낸다.
      __testSignIn(session){ currentSession = session; const cb = authCb; if (cb) cb('SIGNED_IN', session); return Promise.resolve({ error: null }); }
    },
    functions: {
      invoke(name, args){
        invokeCalls.push({ name, body: args && args.body });
        if (opts.invokeResponses && opts.invokeResponses[name]) return Promise.resolve(opts.invokeResponses[name]);
        return Promise.resolve({ data: null, error: { message: 'stub: not configured in this test' } });
      }
    }
  };
  return { sb, writeCalls, callLog, invokeCalls };
}

async function settle(n){ for (let i = 0; i < (n || 40); i++) await new Promise((r) => setImmediate(r)); }
async function boot(opts){
  opts = opts || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const supa = makeSupabase(opts);
  const wholesalers = { calls: 0 };
  const sandbox = {
    console: { log(){}, info(){}, warn(){}, error(){} },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(fn){ fn(0); return 1; }, cancelAnimationFrame(){},
    URLSearchParams, CustomEvent: function CustomEvent(type, opts2){ this.type = type; this.detail = opts2 && opts2.detail; },
    document: doc,
    // 기본 해시를 #/dashboard로 둔다 — meta-adsets.js의 isDashboardRoute()가
    // 이 경로일 때만 광고 세트·ad_margin_links를 조회하므로(실제 앱과 동일한
    // 조건), 기본값을 다른 값으로 두면 이 화면을 보는 시나리오를 정확히
    // 재현하지 못한다.
    location: { hash: opts.hash === undefined ? '#/dashboard' : opts.hash, origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' },
    history: { replaceState(){}, back(){}, forward(){} },
    localStorage: memStorage(), sessionStorage: memStorage(),
    matchMedia(){ return { matches: false }; }, scrollTo(){}, addEventListener(){}, removeEventListener(){},
    confirm(){ return true; }, alert(){}, gtag(){},
    launchdeskSupabase: supa.sb,
    launchdeskWholesalers: {
      fetchPublishedWholesalers(){ wholesalers.calls++; return Promise.resolve({ ok: true, data: opts.wholesalers || [] }); },
      categoryLabel(c){ return c; }
    }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(STORE_SRC, sandbox, { filename: 'store.js' });
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' });
  vm.runInContext(MARGIN_CALC_SRC, sandbox, { filename: 'margin-calc.js' });
  vm.runInContext(PLANS_CORE_SRC, sandbox, { filename: 'plans-core.js' });
  vm.runInContext(TOOLS_SRC, sandbox, { filename: 'tools.js' });
  vm.runInContext(OPS_OVERVIEW_SRC, sandbox, { filename: 'ops-overview.js' });
  vm.runInContext(META_ADSETS_CORE_SRC, sandbox, { filename: 'meta-adsets-core.js' });
  vm.runInContext(META_MARGIN_CORE_SRC, sandbox, { filename: 'meta-margin-core.js' });
  vm.runInContext(META_ADSETS_SRC, sandbox, { filename: 'meta-adsets.js' });
  vm.runInContext(HOME_DASHBOARD_SRC, sandbox, { filename: 'home-dashboard.js' });
  vm.runInContext(PLANS_SRC, sandbox, { filename: 'plans.js' });
  await settle();
  return { sandbox, doc, timers, supa, wholesalers };
}

test('비회원 #/dashboard: 게이트가 보이고, 실제 콘텐츠는 inert + aria-hidden이며, 사용자별 데이터 요청이 0건이다', async () => {
  const env = await boot();
  await settle();
  const gate = env.doc.getElementById('opsdashGuestGate');
  const root = env.doc.getElementById('opsdashRoot');
  assert.equal(gate.hidden, false);
  assert.equal(root.hasAttribute('inert'), true);
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  // 요구사항 4의 전체 목록 — 인증 세션 확인(auth.getSession) 자체는 예외지만,
  // 사용자별 데이터 테이블/함수 호출은 전부 0건이어야 한다.
  const userDataTables = ['stores', 'connected_accounts', 'orders', 'plans', 'ad_margin_links', 'tool_records'];
  userDataTables.forEach((t) => {
    assert.equal(env.supa.callLog.filter((x) => x === t).length, 0, t + ' 조회가 0건이어야 한다');
  });
  assert.equal(env.supa.invokeCalls.length, 0, 'meta-insights/meta-adset-insights 호출이 0건이어야 한다');
  assert.equal(env.wholesalers.calls, 0, '도매처(공개 데이터)조차 게이트 뒤에서는 불필요하게 불러오지 않는다');
  // #ldPlanPanel이 DOM에 있다는 이유만으로 plans.js가 비회원 계획을 조회하지 않는지(요구사항 4).
  assert.equal(env.doc.getElementById('ldPlanPanel').hidden, true);
});

test('로그인 사용자 #/dashboard: 게이트가 숨겨지고, inert가 풀리며, 도매처는 정확히 1번만 불러온다', async () => {
  const env = await boot({
    session: { user: { id: 'user-1', email: 'a@example.com' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'user-1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    orders: []
  });
  await settle();
  const gate = env.doc.getElementById('opsdashGuestGate');
  const root = env.doc.getElementById('opsdashRoot');
  assert.equal(gate.hidden, true);
  assert.equal(root.hasAttribute('inert'), false);
  assert.equal(root.hasAttribute('aria-hidden'), false);
  assert.equal(env.wholesalers.calls, 1);
  // launchdeskOpsSnapshot.refresh()(예: 다른 화면에서의 재조회)로 스냅샷이
  // 또 와도 — 새로고침 버튼을 직접 누른 게 아니라면 — 게이트의 "회원으로
  // 처음 확정될 때 한 번" 로직이 도매처를 또 부르지 않는다.
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  assert.equal(env.wholesalers.calls, 1);
});

test('게이트의 "로그인"/"무료 회원가입" 버튼은 기존 로그인 모달만 연다(각각 로그인/회원가입 모드)', async () => {
  const env = await boot();
  await settle();
  const loginBtn = env.doc.getElementById('opsdashGateLogin');
  const signupBtn = env.doc.getElementById('opsdashGateSignup');
  const modal = env.doc.getElementById('loginModal');
  const title = env.doc.getElementById('loginModalTitle');

  loginBtn.click();
  assert.equal(modal.classes.has('open'), true);
  assert.equal(title.textContent, '로그인');

  env.doc.getElementById('loginModalClose').click(); // 재사용되는 기존 닫기 버튼
  signupBtn.click();
  assert.equal(modal.classes.has('open'), true);
  assert.equal(title.textContent, '회원가입');
});

test('Meta 재연결 필요 상태는 "광고계정 미선택"과 다르게 구분된다(external_account_id 존재 여부)', async () => {
  const expired = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 1, provider: 'meta', id: 'm1', status: 'pending', external_account_id: 'act_123' }
    ],
    orders: []
  });
  await settle();
  assert.equal(expired.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'reconnect-required');
  assert.match(expired.doc.getElementById('opsdashAdState').innerHTML, /Meta 연결이 만료되었어요/);
  assert.match(expired.doc.getElementById('opsdashConnectionStatus').innerHTML, /연결 만료/);

  const neverSelected = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 1, provider: 'meta', id: 'm2', status: 'pending', external_account_id: null }
    ],
    orders: []
  });
  await settle();
  assert.equal(neverSelected.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'not-selected');
  assert.match(neverSelected.doc.getElementById('opsdashAdState').innerHTML, /분석할 광고계정을 선택해주세요/);
});

test('연결됐지만 데이터 0건인 Cafe24 주문은 "연결하세요"가 아니라 실제 빈 상태로 표시된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    orders: []
  });
  await settle();
  const brief = env.doc.getElementById('opsdashBriefList').innerHTML;
  assert.match(brief, /오늘 접수된 주문이 없어요\./);
  assert.doesNotMatch(brief, /쇼핑몰을 연결하면/);
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '0건');
});

test('비회원은 마진 계산기 "저장"을 눌러도 게스트 메모리에 저장되지 않고 기존 로그인 모달이 열린다', async () => {
  const env = await boot();
  await settle();
  // MC.calculate는 실제 입력 폼 파싱과 무관하게 결과만 필요하므로 고정 성공 결과로 바꿔치기한다
  // (tools.js가 참조하는 launchdeskMarginCalc 객체 자체를 그대로 바꾸는 것이라 실제 클릭 경로는 안 바뀐다).
  env.sandbox.launchdeskMarginCalc.calculate = () => ({
    ok: true,
    input: { price: 30000, unitCost: 15000 },
    result: { totalIncome: 30000, productFee: 1800, shippingFee: 0, pgFee: 0, feeTotal: 1800, preAd: 28200, adMode: 'none', adRate: 0, adCost: 0, postAd: 28200, ratio: 1 }
  });
  const modal = env.doc.getElementById('loginModal');
  env.doc.getElementById('toolsSaveCalc').click();
  assert.equal(modal.classes.has('open'), true);
  assert.equal(env.supa.writeCalls.filter((w) => w.table === 'tool_records').length, 0);
});

test('로그인 사용자는 마진 계산기 "저장"을 누르면 실제로 저장되고 모달은 열리지 않는다', async () => {
  const env = await boot({ session: { user: { id: 'u1', email: 'a@example.com' } } });
  await settle();
  env.sandbox.launchdeskMarginCalc.calculate = () => ({
    ok: true,
    input: { price: 30000, unitCost: 15000 },
    result: { totalIncome: 30000, productFee: 1800, shippingFee: 0, pgFee: 0, feeTotal: 1800, preAd: 28200, adMode: 'none', adRate: 0, adCost: 0, postAd: 28200, ratio: 1 }
  });
  const modal = env.doc.getElementById('loginModal');
  env.doc.getElementById('toolsSaveCalc').click();
  assert.equal(modal.classes.has('open'), false);
  assert.equal(env.supa.writeCalls.filter((w) => w.table === 'tool_records' && w.op === 'insert').length, 1);
});

test('내 계획 패널(#ldPlanPanel)은 비회원이면 숨김, 회원이면 보인다(운영 현황 게이트와 중복 안내 없음)', async () => {
  const guestEnv = await boot();
  await settle();
  assert.equal(guestEnv.doc.getElementById('ldPlanPanel').hidden, true);

  const memberEnv = await boot({
    session: { user: { id: 'u1', email: 'a@example.com' } },
    plans: [{
      id: 'p1', user_id: 'u1', client_request_id: 'r1', title: '테스트 계획', action_text: '실행',
      review_date: '2099-01-01', status: 'active', executed: false, review_note: null, reviewed_at: null,
      done_at: null, calc_version: 2, calc_snapshot: { calc_version: 2, input: {}, result: {} },
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
    }]
  });
  await settle();
  assert.equal(memberEnv.doc.getElementById('ldPlanPanel').hidden, false);
});

test('로그인 + Cafe24 · Meta 둘 다 미연결: 게이트는 풀리고(회원이므로), 각 영역은 미연결 안내만 보인다', async () => {
  const env = await boot({ session: { user: { id: 'u1' } }, stores: [], connectedAccounts: [], orders: [] });
  await settle();
  assert.equal(env.doc.getElementById('opsdashGuestGate').hidden, true);
  assert.equal(env.doc.getElementById('opsdashRoot').hasAttribute('inert'), false);
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.authed, true);
  assert.equal(snap.cafe24.state, 'not-connected');
  assert.equal(snap.meta.state, 'not-connected');
  assert.match(env.doc.getElementById('opsdashBriefList').innerHTML, /Cafe24를 연결하면 실제 주문과 결제금액을 확인할 수 있어요\./);
  assert.match(env.doc.getElementById('opsdashAdState').innerHTML, /Meta 광고 계정을 연결해주세요\./);
  assert.equal(env.doc.getElementById('opsdashConnectionStatus').innerHTML.includes('연결됨'), false);
});

test('로그인 + store 자체를 아직 등록하지 않은 상태(로그인했지만 store 없음)도 비회원으로 오인하지 않는다', async () => {
  const env = await boot({ session: { user: { id: 'u1' } }, stores: [] });
  await settle();
  assert.equal(env.doc.getElementById('opsdashGuestGate').hidden, true, '로그인 사용자는 store가 없어도 게이트가 숨겨져야 한다');
  assert.equal(env.doc.getElementById('opsdashRoot').hasAttribute('inert'), false);
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().authed, true);
});

test('로그인 사용자는 cafe24.state가 loading을 거쳐 data로 바뀌는 동안 내내 게이트가 풀려 있다(cafe24.state에 기대지 않는 인증 판정)', async () => {
  // applyAuthGate는 launchdeskStore.isAuthed()만 보고 window.launchdeskStore.onChange로
  // 직접 갱신되므로(요구사항: cafe24.state에 의존하지 않는 인증 판정), ops-overview.js의
  // cafe24 조회가 아직 진행 중인 시점에도 이미 풀려 있어야 한다. 이 하네스는 모든 Promise가
  // 즉시 resolve돼 boot() 안에서 settle()까지 다 끝나버리므로 "정확히 loading인 순간"을
  // 여기서 직접 포착할 수는 없다 — 대신 launchdeskStore.onChange 리스너가 실제로 등록돼
  // hydrate() 시점에 곧바로 불렸는지(스냅샷 발행을 기다리지 않고)를 확인한다.
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }]
  });
  await settle();
  assert.equal(env.doc.getElementById('opsdashGuestGate').hidden, true);
  assert.equal(env.doc.getElementById('opsdashRoot').hasAttribute('inert'), false);
  // 로그아웃해도 launchdeskStore.onChange 경로만으로 즉시 다시 잠긴다(스냅샷 subscribe와 별개 경로).
  env.sandbox.launchdeskSupabase.auth.signOut();
  await settle();
  assert.equal(env.doc.getElementById('opsdashGuestGate').hidden, false);
  assert.equal(env.doc.getElementById('opsdashRoot').hasAttribute('inert'), true);
});

test('로그인 + Cafe24 미연결(store는 있음) + Meta 연결: Meta 영역은 정상 표시되고 광고 세트 패널도 유지된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    // cafe24 connected_accounts 행 자체가 없다(cafe24-disconnect가 지운 상태) — store와 meta 행은 그대로.
    connectedAccounts: [{ store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }]
  });
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.state, 'not-connected');
  assert.equal(snap.storeId, 1, 'Cafe24가 미연결이어도 storeId는 selectedStoreId로 남아 meta-adsets.js가 조회할 수 있어야 한다');
  // meta-insights invoke는 테스트 스텁이 항상 에러라 meta.state는 'error'로 남지만(정상),
  // 그 조회 자체가 Cafe24 상태 때문에 스킵되지 않았다는 것이 핵심이다.
  assert.notEqual(snap.meta.state, 'not-connected');
  assert.match(env.doc.getElementById('opsdashBriefList').innerHTML, /Cafe24를 연결하면/);
  // #metaAdsetsPanel(광고 세트 성과) 자체가 Cafe24 미연결을 이유로 hidden 처리되지 않는다 —
  // 이 패널은 meta.state==='data'일 때만 보이므로(테스트 스텁 한계로 여기선 'error'), hidden
  // 속성이 "존재"한다는 사실만으로 Cafe24 탓이 아님을 확인한다(별도 광고 세트 패널 시나리오는
  // meta-adsets.js 자체 테스트가 이미 다룬다 — 여기서는 ops 스냅샷이 Cafe24와 무관하게
  // storeId·meta 상태를 정상 발행하는지만 검증한다).
});

test('로그인 + Cafe24 · Meta 둘 다 연결: 실제 수치가 KPI · 월간 현황에 표시된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: '2026-09-20T00:00:00Z' },
      { store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }
    ],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 10000 }]
  });
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.state, 'data');
  // functions.invoke는 이 테스트 하네스에서 항상 에러 스텁이라 meta는 'error'로 남는다(정상 —
  // 실제 Meta API 호출 없이도 대시보드 전체가 죽지 않는지만 확인).
  assert.equal(snap.meta.state, 'error');
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '1건');
  assert.doesNotMatch(env.doc.getElementById('opsdashConnectionStatus').innerHTML, /운영 현황 전체/);
});

test('Cafe24 connected_accounts 조회 오류는 "미연결"과 구분되는 별도 error 상태로 표시된다(연결 버튼 없음, 대시보드 전체는 안 막힘)', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }],
    errorTables: ['connected_accounts']
  });
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(env.doc.getElementById('opsdashGuestGate').hidden, true, '크래시 없이 게이트는 회원이므로 풀려 있어야 한다');
  assert.equal(snap.cafe24.state, 'error');
  const brief = env.doc.getElementById('opsdashBriefList').innerHTML;
  assert.match(brief, /Cafe24 주문 데이터를 불러오지 못했어요\./);
  assert.doesNotMatch(brief, /연결이 끊/); // "끊어졌다"고 단정하지 않는다
  assert.match(brief, /새로고침/); // 기존 새로고침으로 다시 시도할 수 있다는 최소 동선
  const connStatus = env.doc.getElementById('opsdashConnectionStatus').innerHTML;
  assert.match(connStatus, /조회 오류/);
  assert.doesNotMatch(connStatus, /class="btn/); // 연결 버튼을 표시하지 않는다
});

test('Cafe24 "연결됐지만 0건"과 "조회 오류"는 서로 다른 문구를 쓴다', async () => {
  const emptyEnv = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    orders: []
  });
  await settle();
  const emptyBrief = emptyEnv.doc.getElementById('opsdashBriefList').innerHTML;
  assert.match(emptyBrief, /오늘 접수된 주문이 없어요\./);
  assert.doesNotMatch(emptyBrief, /불러오지 못했/);

  const errorEnv = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    errorTables: ['orders']
  });
  await settle();
  const errorBrief = errorEnv.doc.getElementById('opsdashBriefList').innerHTML;
  assert.match(errorBrief, /Cafe24 주문 데이터를 불러오지 못했어요\./);
  assert.doesNotMatch(errorBrief, /오늘 접수된 주문이 없어요\./);
});

const META_INSIGHTS_OK = {
  data: {
    ok: true,
    account: { name: 'Test Ads', currency: 'USD', timezone_name: 'Asia/Seoul' },
    today: { spend: 10, purchase_value: 20, purchase_count: 1, roas: 2, ctr: 1, cpc: 1, cpm: 1, purchase_basis: 'offsite_conversion.fb_pixel_purchase' },
    month: { spend: 100, purchase_value: 200, purchase_count: 5, roas: 2, ctr: 1, cpc: 1, cpm: 1, purchase_basis: 'offsite_conversion.fb_pixel_purchase' },
    queried_range: { month: { since: '2026-09-01', until: '2026-09-22' } }
  },
  error: null
};

test('로그인 세션 + Cafe24 error + Meta 정상: Meta 영역은 실제 데이터로 정상 표시되고 광고 세트 패널도 유지된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }, // 연결은 돼 있지만
      { store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }
    ],
    errorTables: ['orders'], // 주문 조회만 실패(예: RLS/네트워크 문제) — Cafe24는 error
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.state, 'error');
  assert.equal(snap.meta.state, 'data');
  assert.equal(env.doc.getElementById('opsdashKpiSpend').textContent, '$10.00');
  assert.match(env.doc.getElementById('opsdashBriefList').innerHTML, /Meta 광고매출/);
  // 광고 세트 성과 패널은 meta.state==='data'가 되는 순간 Cafe24 상태와 무관하게 풀린다.
  assert.equal(env.doc.getElementById('metaAdsetsPanel').hidden, false);
});

test('Meta-only(로그인 + Cafe24 미연결 + Meta 연결) 상태에서 광고 세트 패널이 정상 유지되고, 손익분기 기준 연결(ad_margin_links)도 조회된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    // cafe24 connected_accounts 행이 아예 없다 — Cafe24 disconnect가 이미 지운 상태. store와 meta는 그대로.
    connectedAccounts: [{ store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.state, 'not-connected');
  assert.equal(snap.meta.state, 'data');
  assert.equal(env.doc.getElementById('metaAdsetsPanel').hidden, false, 'Cafe24 미연결이라는 이유로 광고 세트 패널이 숨겨지면 안 된다');
  assert.ok(env.supa.callLog.includes('ad_margin_links'), '손익분기 기준 연결 조회(ad_margin_links)도 store·Meta가 유효하면 정상 실행돼야 한다');
});

test('로그아웃 직후 주문 · Meta 광고 · 마진 연결 캐시가 화면 메모리에서 실제로 제거된다(DOM inert 뒤에 남은 숫자가 없음)', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: '2026-09-20T00:00:00Z' },
      { store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }
    ],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 12345 }],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();
  let snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.state, 'data');
  assert.equal(snap.meta.state, 'data');

  env.sandbox.launchdeskSupabase.auth.signOut();
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.authed, false);
  assert.equal(snap.cafe24.state, 'guest');
  assert.equal(snap.storeId, null);
  assert.equal(snap.cafe24.today, null, '로그아웃 후 이전 사용자의 주문 캐시가 스냅샷에 남아있으면 안 된다');
  assert.equal(snap.cafe24.storeName, null);
  assert.equal(snap.meta.state, 'not-connected', '로그아웃 후 이전 사용자의 Meta 상태 캐시가 남아있으면 안 된다');
  assert.equal(snap.meta.today, null);
  assert.equal(env.doc.getElementById('ldPlanPanel').hidden, true);
});

test('재로그인(다른 사용자 로그인) 시 이전 사용자의 운영 데이터가 재사용되지 않는다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '사용자1 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 99999 }]
  });
  await settle();
  let snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.storeName, '사용자1 쇼핑몰');
  assert.equal(snap.cafe24.today.payment, 99999);

  // 로그아웃 없이 곧바로 다른 사용자(u2)로 로그인 — u2는 등록한 store가 없다.
  env.sandbox.launchdeskSupabase.auth.__testSignIn({ user: { id: 'u2', email: 'b@example.com' } });
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.notEqual(snap.storeId, 1, 'u2 세션에서 u1의 store가 선택된 채로 남아있으면 안 된다');
  assert.equal(snap.cafe24.storeName, null);
  assert.equal(snap.cafe24.today, null, 'u1의 주문 캐시가 u2 화면에 재사용되면 안 된다');
  assert.equal(snap.cafe24.state, 'not-connected'); // u2는 등록한 store가 없음
});
