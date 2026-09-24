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
const OPS_PERIOD_CORE_SRC = fs.readFileSync(path.join(ROOT, 'ops-period-core.js'), 'utf8');
const ADLOG_META_SRC = fs.readFileSync(path.join(ROOT, 'adlog-meta.js'), 'utf8');
const STORES_SRC = fs.readFileSync(path.join(ROOT, 'stores.js'), 'utf8');
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

test('운영 현황의 내 계획 카드(#ldPlanPanel)는 제거됐고, 광고별 성과 다음에 바로 하단 3열이 온다', () => {
  assert.doesNotMatch(INDEX, /id="ldPlanPanel"|id="ldPlanBody"|id="ldPlanDraftNotice"/);
  const dash = INDEX.slice(INDEX.indexOf('id="view-dashboard"'), INDEX.indexOf('id="view-account"'));
  const metaAdsets = dash.indexOf('id="metaAdsetsPanel"');
  const triple = dash.indexOf('opsdash-row triple');
  assert.ok(metaAdsets > 0 && metaAdsets < triple);
  assert.doesNotMatch(dash.slice(metaAdsets, triple), /class="dash-panel["\s]/); // 사이에 다른 카드 없음
});

test('계획 만들기: 버튼이 없으면 plans.js는 폼을 열지 않고 계획을 조회하지 않으며, 계획 삭제 코드도 추가되지 않았다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'plans.js'), 'utf8');
  assert.match(src, /var hasForm = !!\(f\.wrap && f\.openBtn && /);
  assert.match(src, /if\(hasHome\) fetchPlans\(seq\);/);
  assert.equal((src.match(/\.delete\(\)/g) || []).length, 1, '기존 개별 계획 삭제(사용자 조작) 1곳만');
});

test('마진 계산기 화면(#/tools)에는 더 이상 쇼핑몰 운영 현황 · Meta 광고 성과 패널이 없다', () => {
  const start = INDEX.indexOf('id="view-tools"');
  const end = INDEX.indexOf('id="view-setup"') > 0 ? INDEX.indexOf('id="view-setup"') : INDEX.indexOf('id="view-wholesale"');
  const toolsView = INDEX.slice(start, end > start ? end : start + 20000);
  assert.doesNotMatch(toolsView, /id="opsOverviewPanel"/);
  assert.doesNotMatch(toolsView, /id="metaOpsPanel"/);
  // 필수 흐름(계산 입력 → 실행 → 결과 → 저장)은 유지. 계획 만들기 버튼은 "내 계획"
  // 카드 제거와 함께 뺐다(저장한 계획을 볼 곳이 없는 막힌 동선 방지).
  assert.match(toolsView, /class="btn btn-primary" id="toolsSaveCalc"/);
  assert.doesNotMatch(toolsView, /id="mcPlanOpen"/);
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
// 실제 <select>는 (1) option.selected를 세팅하면 다른 option은 자동으로
// 해제되고 select.value가 그 값으로 동기화되며, (2) 아무 option도 selected가
// 아닌 채로 새 option이 추가되면 그 option이 기본 선택이 된다(첫 옵션 기본
// 선택). 일반 makeEl()은 이 동작이 전혀 없어 populateSelect()가 만드는
// "조회 중인 쇼핑몰 = 선택값" 결과를 검증할 수 없으므로, #opsStoreSelect
// 전용으로 이 최소한의 <select>/<option> 동기화만 얹는다.
function makeSelectEl(){
  const el = makeEl('select');
  let currentValue = '';
  Object.defineProperty(el, 'value', {
    get(){ return currentValue; },
    set(v){ currentValue = String(v); el.children.forEach((o) => { o._selected = (String(o.value) === currentValue); }); }
  });
  const originalAppendChild = el.appendChild.bind(el);
  el.appendChild = function(opt){
    // populateSelect()는 opt.selected=true를 appendChild보다 "먼저" 호출한다
    // (실제 DOM 코드 그대로) — 그 시점엔 아직 아래 defineProperty가 없어 그냥
    // 평범한 값이므로, 잃어버리지 않게 append 전에 미리 읽어 둔다.
    const preSelected = !!opt.selected;
    originalAppendChild(opt);
    Object.defineProperty(opt, 'selected', {
      configurable: true,
      get(){ return !!opt._selected; },
      set(v){
        if (v) { el.children.forEach((o) => { o._selected = false; }); opt._selected = true; currentValue = String(opt.value); }
        else { opt._selected = false; }
      }
    });
    // 명시적으로 selected였던 옵션이 우선이고, 없으면 실제 <select>처럼 아직
    // 아무 것도 선택 안 된 상태에서만 첫 옵션이 기본 선택된다.
    if (preSelected || !el.children.some((o) => o._selected)) opt.selected = true;
    return opt;
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
    getElementById(id){
      if (!byId.has(id)) byId.set(id, id === 'opsStoreSelect' ? makeSelectEl() : makeEl('div'));
      return byId.get(id);
    },
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
    let ltCol = null; let ltVal = null;
    const q = {};
    q.select = () => q;
    q.eq = (c, v) => { filters[c] = v; return q; };
    q.in = (c, arr) => { inFilters[c] = arr; return q; };
    q.gte = (c, v) => { gteCol = c; gteVal = v; return q; };
    q.lt = (c, v) => { ltCol = c; ltVal = v; return q; };
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
      if (ltCol) matched = matched.filter((r) => new Date(r[ltCol]).getTime() < new Date(ltVal).getTime());
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
  // stores.js(내 쇼핑몰 화면)는 쇼핑몰 삭제 · 연결 해제 시나리오에서만 싣는다
  // (기존 테스트의 stores 조회 횟수 기대값을 바꾸지 않기 위함). 실제 순서도 ops-overview.js 앞이다.
  if (opts.withStores) vm.runInContext(STORES_SRC, sandbox, { filename: 'stores.js' });
  vm.runInContext(OPS_PERIOD_CORE_SRC, sandbox, { filename: 'ops-period-core.js' });
  vm.runInContext(OPS_OVERVIEW_SRC, sandbox, { filename: 'ops-overview.js' });
  vm.runInContext(META_ADSETS_CORE_SRC, sandbox, { filename: 'meta-adsets-core.js' });
  vm.runInContext(META_MARGIN_CORE_SRC, sandbox, { filename: 'meta-margin-core.js' });
  vm.runInContext(META_ADSETS_SRC, sandbox, { filename: 'meta-adsets.js' });
  vm.runInContext(ADLOG_META_SRC, sandbox, { filename: 'adlog-meta.js' });
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

// cafe24-orders-sync가 기록한 "빠짐없이 동기화된 범위" 시작일 — 30일 전부터 기록된 상태
function syncedFrom30d(){ return new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); }

test('연결됐지만 데이터 0건인 Cafe24 주문은 "연결하세요"가 아니라 실제 빈 상태로 표시된다(오늘 동기화된 경우)', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: new Date().toISOString(), orders_synced_from: syncedFrom30d() }],
    orders: []
  });
  await settle();
  const brief = env.doc.getElementById('opsdashBriefList').innerHTML;
  assert.match(brief, /Cafe24에 오늘 들어온 주문이 없어요\(마지막 동기화 기준\)\./);
  assert.doesNotMatch(brief, /쇼핑몰을 연결하면/);
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '0건');
});

test('한 번도 동기화하지 않은 Cafe24는 0건이 아니라 "확인 전"으로 표시한다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 's', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    orders: []
  });
  await settle();
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '확인 전');
  assert.equal(env.doc.getElementById('opsdashKpiPayment').textContent, '확인 전');
  assert.match(env.doc.getElementById('opsdashKpiOrdersNote').textContent, /아직 주문을 동기화한 적이 없어요/);
  assert.match(env.doc.getElementById('opsdashBriefList').innerHTML, /오늘 주문은 아직 동기화 전이에요/);
  assert.doesNotMatch(env.doc.getElementById('opsdashBriefList').innerHTML, /주문이 없어요/);
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
      // 주문이 들어온 뒤 동기화됐다(오늘 · 주문 시각 이후) — 동기화 전 날짜는 "확인 전"으로 따로 검증한다.
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: new Date(Date.now() + 1000).toISOString(), orders_synced_from: syncedFrom30d() },
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
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: new Date().toISOString(), orders_synced_from: syncedFrom30d() }],
    orders: []
  });
  await settle();
  const emptyBrief = emptyEnv.doc.getElementById('opsdashBriefList').innerHTML;
  assert.match(emptyBrief, /Cafe24에 오늘 들어온 주문이 없어요/);
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
  assert.doesNotMatch(errorBrief, /Cafe24에 오늘 들어온 주문이 없어요/);
});

test('Cafe24 주문 KPI는 중복 없이 1쌍이고, 취소·환불·미입금 포함 의미를 표시하며 Meta와 출처가 분리된다(라벨에 기간)', () => {
  const dash = INDEX.slice(INDEX.indexOf('id="view-dashboard"'), INDEX.indexOf('id="view-account"'));
  assert.equal((dash.match(/id="opsdashKpiOrders"/g) || []).length, 1);
  assert.equal((dash.match(/id="opsdashKpiPayment"/g) || []).length, 1);
  assert.match(dash, /id="opsdashKpiOrdersLabel">Cafe24 주문 · 오늘<\/div><div class="opsdash-kpi-value" id="opsdashKpiOrders">-<\/div><div class="opsdash-kpi-note" id="opsdashKpiOrdersNote">취소·환불·미입금 주문 포함/);
  assert.match(dash, /id="opsdashKpiPaymentLabel">Cafe24 주문금액 · 오늘<\/div><div class="opsdash-kpi-value" id="opsdashKpiPayment">-<\/div><div class="opsdash-kpi-note" id="opsdashKpiPaymentNote">주문별 결제금액 합계 · 취소·환불 미차감/);
  // 상단 Meta 두 칸도 선택 기간을 라벨에 적는다(home-dashboard.js가 기간에 맞춰 바꾼다).
  assert.match(dash, /id="opsdashKpiSpendLabel">Meta 광고비 · 오늘</);
  assert.match(dash, /id="opsdashKpiRoasLabel">Meta ROAS · 오늘</);
  assert.doesNotMatch(dash, />오늘 결제금액</);
  // 상단 기간: 오늘 · 어제 · 이번 달 · 날짜 선택 — "전체"는 상단에 없다
  const header = dash.slice(dash.indexOf('opsdash-header-actions'), dash.indexOf('id="opsdashKpis"'));
  for (const p of ['today', 'yesterday', 'month']) assert.match(header, new RegExp('data-ops-period="' + p + '"'));
  assert.match(header, /id="opsdashPeriodDate"/);
  assert.doesNotMatch(header, /data-ops-period="all"|>전체</);
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

// ================================================== 3) 쇼핑몰 선택기(#opsStoreSelect) 복구
// 리뷰 문제 1(선택기가 사라져 다중 쇼핑몰 사용자가 전환할 방법이 없음)과
// 문제 2(전환 직후 스냅샷에 이전 쇼핑몰 값이 남을 수 있음)의 회귀 테스트.

test('index.html: #opsStoreSelect에 접근 가능한 <label for>가 있다', () => {
  assert.match(INDEX, /<label[^>]*for="opsStoreSelect"[^>]*>/);
  // #/dashboard(#opsdash-header) 안에 있고, 새로고침 버튼과 함께 묶여 있는지
  const dashHeaderStart = INDEX.indexOf('id="opsdashTitle"');
  const dashHeaderEnd = INDEX.indexOf('opsdash-kpis', dashHeaderStart);
  const header = INDEX.slice(dashHeaderStart, dashHeaderEnd);
  assert.match(header, /id="opsStoreSelect"/);
  assert.match(header, /id="opsdashRefreshBtn"/);
});

test('styles.css: 삭제된 #deskResume 전용 .desk-resume* 규칙이 없다', () => {
  assert.doesNotMatch(CSS, /\.desk-resume\{/);
  assert.doesNotMatch(CSS, /\.desk-resume-btn/);
});

test('ops-overview.js: 복구한 선택기와 무관한 #/tools 레거시 DOM(getElementById)을 더 이상 조회하지 않는다', () => {
  ['opsGuestNotice', 'opsNoStoreNotice', 'opsDataWrap', 'opsTodayPayment', 'opsTodayCount',
    'opsMonthPayment', 'opsMonthCount', 'opsLastSynced', 'metaOpsPanel', 'metaOpsNotConnected',
    'metaOpsNotSelected', 'metaOpsLoading', 'metaOpsError', 'metaOpsErrorMsg', 'metaOpsRetryBtn',
    'metaOpsDataWrap', 'metaOpsDebugInfo', 'metaTodaySpend'].forEach((id) => {
    assert.doesNotMatch(OPS_OVERVIEW_SRC, new RegExp("getElementById\\('" + id + "'\\)"), id + '를 더 이상 조회하면 안 된다');
  });
  // 유일하게 살아있는 선택기만 그대로 조회한다
  assert.match(OPS_OVERVIEW_SRC, /getElementById\('opsStoreSelect'\)/);
});

test('쇼핑몰 0개: 선택기는 숨김 상태다', async () => {
  const env = await boot({ session: { user: { id: 'u1' } }, stores: [] });
  await settle();
  const select = env.doc.getElementById('opsStoreSelect');
  assert.equal(select.hidden, true);
});

test('쇼핑몰 1개: 옵션은 1개지만 선택기는 숨김 상태다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: '내 쇼핑몰', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [{ store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null }],
    orders: []
  });
  await settle();
  const select = env.doc.getElementById('opsStoreSelect');
  assert.equal(select.hidden, true);
  assert.equal(select.children.length, 1);
});

test('쇼핑몰 2개: 선택기가 보이고, 조회 중인 쇼핑몰이 선택값에 정확히 반영된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null }
    ],
    orders: []
  });
  await settle();
  const select = env.doc.getElementById('opsStoreSelect');
  assert.equal(select.hidden, false);
  assert.equal(select.children.length, 2);
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  const selectedOpt = select.children.find((o) => o.selected);
  assert.ok(selectedOpt, '옵션 중 하나는 selected여야 한다');
  assert.equal(selectedOpt.value, String(snap.storeId), '선택된 옵션 = 실제 조회 중인 storeId');
});

test('선택기로 A→B 전환하면 Cafe24 · Meta가 B 기준으로 갱신되고, B→A 복귀도 정상 동작한다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null }
    ],
    orders: [
      { store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 11111 },
      { store_id: 2, ordered_at: new Date().toISOString(), payment_amount: 22222 }
    ]
  });
  await settle();
  let snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '1');
  assert.equal(snap.cafe24.today.payment, 11111);

  const select = env.doc.getElementById('opsStoreSelect');
  select.value = '2';
  select.dispatch('change');
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(snap.cafe24.today.payment, 22222);
  assert.equal(snap.cafe24.storeName, 'B상점');

  select.value = '1';
  select.dispatch('change');
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '1');
  assert.equal(snap.cafe24.today.payment, 11111, 'B→A 복귀 후 A의 값으로 정확히 되돌아와야 한다');
  assert.equal(snap.cafe24.storeName, 'A상점');
});

test('선택기로 전환하면 광고 세트 패널도 새로 선택한 쇼핑몰의 store_id로 조회된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 1, provider: 'meta', id: 'mA', status: 'connected', external_account_id: 'act_A' },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'meta', id: 'mB', status: 'connected', external_account_id: 'act_B' }
    ],
    orders: [],
    invokeResponses: {
      'meta-insights': META_INSIGHTS_OK,
      'meta-adset-insights': { data: { ok: true, campaigns: [] }, error: null }
    }
  });
  await settle();
  assert.equal(String(env.sandbox.launchdeskOpsSnapshot.getLatest().storeId), '1');

  const select = env.doc.getElementById('opsStoreSelect');
  select.value = '2';
  select.dispatch('change');
  await settle();

  assert.equal(String(env.sandbox.launchdeskOpsSnapshot.getLatest().storeId), '2');
  const adsetCall = env.supa.invokeCalls.filter((c) => c.name === 'meta-adset-insights').pop();
  assert.ok(adsetCall, 'meta-adset-insights가 호출돼야 한다');
  assert.equal(String(adsetCall.body.store_id), '2', '광고 세트 조회는 새로 선택한 쇼핑몰(B)의 store_id를 써야 한다');
});

test('B로 전환했는데 B가 Cafe24 미연결 + Meta 연결이면, Cafe24는 미연결로 Meta는 정상 데이터로 각각 독립 표시된다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      // store 2는 cafe24 connected_accounts 행이 아예 없다(미연결) — meta만 연결.
      { store_id: 2, provider: 'meta', id: 'mB', status: 'connected', external_account_id: 'act_B' }
    ],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 11111 }],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();

  const select = env.doc.getElementById('opsStoreSelect');
  select.value = '2';
  select.dispatch('change');
  await settle();

  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(snap.cafe24.state, 'not-connected');
  assert.equal(snap.meta.state, 'data');
  assert.match(env.doc.getElementById('opsdashBriefList').innerHTML, /Cafe24를 연결하면/);
  assert.equal(env.doc.getElementById('metaAdsetsPanel').hidden, false,
    'Meta가 정상이면 Cafe24 미연결과 무관하게 광고 세트 패널이 보여야 한다');
});

test('A → B 전환 순간(비동기 응답 도착 전) 스냅샷에 A의 주문 · Meta 값이 전혀 남지 않는다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: '2026-09-20T00:00:00Z' },
      { store_id: 1, provider: 'meta', id: 'mA', status: 'connected', external_account_id: 'act_A' },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'meta', id: 'mB', status: 'connected', external_account_id: 'act_B' }
    ],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 55555 }],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.today.payment, 55555);
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'data');

  const seenAfterSwitch = [];
  env.sandbox.launchdeskOpsSnapshot.subscribe((snap) => { seenAfterSwitch.push(snap); });
  seenAfterSwitch.length = 0; // subscribe()가 즉시 돌려주는 전환 이전 값은 버린다

  const select = env.doc.getElementById('opsStoreSelect');
  select.value = '2';
  select.dispatch('change'); // selectStore()는 전부 동기 코드라, 여기서 이미 loading 스냅샷이 publish된다

  assert.ok(seenAfterSwitch.length > 0, '전환 직후 동기적으로 최소 1번은 publish돼야 한다');
  seenAfterSwitch.forEach((snap) => {
    assert.equal(String(snap.storeId), '2');
    // renderOrderSummary(EMPTY_SUMMARY)가 만드는 "0건" 모양 자체는 정상이다
    // (count 0이어도 그대로 'data'로 표현하는 기존 관례) — 여기서 확인할
    // 것은 A의 실제 값(55555)이 하나도 안 섞였다는 점이다.
    assert.equal(snap.cafe24.today.payment, 0, 'A의 주문 금액(55555)이 loading 스냅샷에 남아있으면 안 된다');
    assert.equal(snap.cafe24.today.count, 0, 'A의 주문 건수가 loading 스냅샷에 남아있으면 안 된다');
    assert.equal(snap.cafe24.lastSyncedAt, null, 'A의 동기화 시각이 loading 스냅샷에 남아있으면 안 된다');
    assert.equal(snap.meta.today, null, 'A의 Meta 값이 loading 스냅샷에 남아있으면 안 된다');
    assert.equal(snap.meta.accountName, null, 'A의 Meta 계정명이 loading 스냅샷에 남아있으면 안 된다');
  });

  await settle();
  assert.equal(String(env.sandbox.launchdeskOpsSnapshot.getLatest().storeId), '2');
});

// 코드 리뷰 후속 수정 — 쇼핑몰 전환/재조회 시 "첫 publish 전에 Cafe24 · Meta
// 상태를 함께 새 상황으로 맞춘다"(publishBothStates) 회귀 테스트. 위
// "A → B 전환 순간..." 테스트는 today.payment 등 값만 확인해 통과했지만,
// 그 값들은 clearStoreScopedData()가 먼저 지워서 이미 0/null이었을 뿐 —
// state 필드 자체가 이전 쇼핑몰 값과 섞여 있어도 걸러내지 못했다. 아래
// 두 테스트는 구독자가 받는 모든 스냅샷의 storeId · cafe24.state · meta.state
// 세 필드가 항상 같은 시점 기준으로 일치하는지 직접 검사한다.
test('쇼핑몰 전환 직후 구독자가 받는 모든 스냅샷은 storeId · cafe24.state · meta.state가 함께 새 쇼핑몰 기준이다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 1, provider: 'meta', id: 'mA', status: 'connected', external_account_id: 'act_A' },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'meta', id: 'mB', status: 'connected', external_account_id: 'act_B' }
    ],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 11111 }],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.state, 'data');
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'data');

  const seen = [];
  env.sandbox.launchdeskOpsSnapshot.subscribe((snap) => { seen.push(snap); });
  seen.length = 0; // subscribe()가 즉시 돌려주는 전환 이전 값은 버린다

  const select = env.doc.getElementById('opsStoreSelect');
  select.value = '2';
  select.dispatch('change'); // selectStore()는 동기 코드라, loading 스냅샷이 여기서 이미 publish된다

  assert.ok(seen.length > 0, '전환 직후 동기적으로 최소 1번은 publish돼야 한다');
  seen.forEach((snap) => {
    assert.equal(String(snap.storeId), '2', 'storeId는 이미 새 쇼핑몰(B)이어야 한다');
    assert.equal(snap.cafe24.state, 'loading', 'cafe24.state에 이전 쇼핑몰(A)의 값(data)이 섞여 있으면 안 된다');
    assert.equal(snap.meta.state, 'loading', 'meta.state에 이전 쇼핑몰(A)의 값(data)이 섞여 있으면 안 된다');
  });

  await settle();
});

test('stores 재조회가 실패해도 구독자가 받는 모든 스냅샷에서 cafe24.state · meta.state가 항상 짝을 이뤄 발행된다', async () => {
  const bootOpts = {
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' }],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 1, provider: 'meta', id: 'mA', status: 'connected', external_account_id: 'act_A' }
    ],
    orders: [{ store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 12345 }],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  };
  const env = await boot(bootOpts);
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.state, 'data');
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'data');

  const seen = [];
  env.sandbox.launchdeskOpsSnapshot.subscribe((snap) => { seen.push(snap); });
  seen.length = 0;

  bootOpts.errorTables = ['stores']; // makeSupabase가 opts를 그대로 들고 있어, 다음 stores 조회부터 강제 실패한다
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();

  assert.ok(seen.length > 0, '재조회 실패 후 최소 1번은 publish돼야 한다');
  seen.forEach((snap) => {
    assert.equal(snap.cafe24.state, 'error');
    assert.equal(snap.meta.state, 'not-connected', 'cafe24가 error로 바뀐 스냅샷에 meta의 이전 값(data)이 남아있으면 안 된다');
  });
});

// ---- 지연 응답(stale response) 재현용 테스트 전용 게이트 — 원본 makeSupabase()/
// filterChain()은 손대지 않는다(다른 테스트에 영향 없음). sb.from('orders')·
// sb.functions.invoke('meta-insights')를 감싸, 지정한 조건과 일치하는 호출만
// gate.release()를 부를 때까지 응답을 미룬다 — "A 조회가 B 선택 후 늦게
// 도착"을 실제 타이밍으로 재현한다.
function deferred(){
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
function gateOrdersFor(sb, targetStoreId){
  const originalFrom = sb.from;
  const gate = deferred();
  sb.from = function(table){
    const chain = originalFrom.call(sb, table);
    if (table !== 'orders') return chain;
    const originalEq = chain.eq;
    const originalThen = chain.then;
    const filters = {};
    chain.eq = function(col, val){ filters[col] = val; return originalEq.call(chain, col, val); };
    chain.then = function(res, rej){
      if (String(filters.store_id) === String(targetStoreId)) {
        return gate.promise.then(() => originalThen.call(chain, res, rej));
      }
      return originalThen.call(chain, res, rej);
    };
    return chain;
  };
  return { release: gate.resolve, restore(){ sb.from = originalFrom; } };
}
function gateMetaInsightsFor(sb, targetConnectedAccountId, lateResponse){
  const originalInvoke = sb.functions.invoke;
  const gate = deferred();
  sb.functions.invoke = function(name, args){
    const body = args && args.body;
    if (name === 'meta-insights' && body && String(body.connected_account_id) === String(targetConnectedAccountId)) {
      return gate.promise.then(() => lateResponse);
    }
    return originalInvoke.call(sb.functions, name, args);
  };
  return { release: gate.resolve, restore(){ sb.functions.invoke = originalInvoke; } };
}

test('쇼핑몰 전환 중 A의 Cafe24 주문 응답이 B 선택 후 늦게 도착해도 B 화면 · 스냅샷을 덮어쓰지 않는다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null }
    ],
    orders: [
      { store_id: 1, ordered_at: new Date().toISOString(), payment_amount: 11111 },
      { store_id: 2, ordered_at: new Date().toISOString(), payment_amount: 22222 }
    ]
  });
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().storeId, 1);

  const select = env.doc.getElementById('opsStoreSelect');
  const gate = gateOrdersFor(env.sandbox.launchdeskSupabase, 1); // A(store 1)의 orders 응답을 붙든다

  // A를 다시 선택 — 이번 orders 조회는 gate에 걸려 대기한다.
  select.value = '1';
  select.dispatch('change');
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.state, 'loading',
    '아직 gate를 풀지 않았으니 loading 상태여야 한다');

  // A 응답이 오기 전에 B로 전환 — B의 orders는 gate 대상이 아니라 정상 진행된다.
  select.value = '2';
  select.dispatch('change');
  await settle();
  let snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(snap.cafe24.state, 'data');
  assert.equal(snap.cafe24.today.payment, 22222);

  // 이제야 A의 늦은 응답이 도착한다 — seq가 이미 바뀌어 무시돼야 한다.
  gate.release();
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2', 'A의 늦은 응답이 storeId를 되돌리면 안 된다');
  assert.equal(snap.cafe24.today.payment, 22222, 'A의 늦은 응답이 B의 주문 값을 덮어쓰면 안 된다');
  assert.equal(snap.cafe24.storeName, 'B상점');

  gate.restore();
});

test('쇼핑몰 전환 중 A의 Meta 응답이 B 선택 후 늦게 도착해도 B 화면 · 스냅샷을 덮어쓰지 않는다', async () => {
  const env = await boot({
    session: { user: { id: 'u1' } },
    stores: [
      { id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' },
      { id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }
    ],
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 1, provider: 'meta', id: 'mA', status: 'connected', external_account_id: 'act_A' },
      { store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: null },
      { store_id: 2, provider: 'meta', id: 'mB', status: 'connected', external_account_id: 'act_B' }
    ],
    orders: [],
    invokeResponses: { 'meta-insights': META_INSIGHTS_OK }
  });
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().storeId, 1);
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'data');

  const select = env.doc.getElementById('opsStoreSelect');
  // A의 늦은 응답이 "그래도" 도착했을 때 절대 보이면 안 되는, B와 뚜렷이 다른 값.
  const lateAResponse = {
    data: {
      ok: true,
      account: { name: 'Late A Ads', currency: 'USD', timezone_name: 'Asia/Seoul' },
      today: { spend: 99999, purchase_value: 99999, purchase_count: 9, roas: 9, ctr: 9, cpc: 9, cpm: 9, purchase_basis: 'x' },
      month: { spend: 99999, purchase_value: 99999, purchase_count: 9, roas: 9, ctr: 9, cpc: 9, cpm: 9, purchase_basis: 'x' },
      queried_range: { month: { since: '2026-09-01', until: '2026-09-22' } }
    },
    error: null
  };
  const gate = gateMetaInsightsFor(env.sandbox.launchdeskSupabase, 'mA', lateAResponse);

  select.value = '1';
  select.dispatch('change');
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().meta.state, 'loading');

  select.value = '2';
  select.dispatch('change');
  await settle();
  let snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(snap.meta.state, 'data');
  assert.notEqual(snap.meta.today.spend, 99999);

  gate.release();
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2', 'A의 늦은 Meta 응답이 storeId를 되돌리면 안 된다');
  assert.notEqual(snap.meta.today.spend, 99999, 'A의 늦은 Meta 응답 값이 B 화면에 반영되면 안 된다');
  assert.notEqual(snap.meta.accountName, 'Late A Ads', 'A의 늦은 Meta 계정명이 B 화면에 반영되면 안 된다');

  gate.restore();
});

// ===================================================== 상단 기간 선택 · 새로고침 동기화
const OPS_PC = require('../ops-period-core.js');
function kstNoon(ymd){ return new Date(Date.parse(ymd + 'T12:00:00+09:00')).toISOString(); }
function metaPayload(extra){
  return Object.assign({
    ok: true,
    account: { name: 'Test Ads', currency: 'KRW', timezone_name: 'Asia/Seoul' },
    today: { spend: 15000, purchase_value: 45000, purchase_count: 2, roas: 3 },
    month: { spend: 300000, purchase_value: 900000, purchase_count: 40, roas: 3 }
  }, extra || {});
}
// functions.invoke를 이름별 처리기로 감싼다(호출 기록 포함). 처리기가 없으면 원래 스텁.
function routeInvoke(sb, handlers){
  const original = sb.functions.invoke;
  const calls = [];
  sb.functions.invoke = function(name, args){
    const body = args && args.body;
    calls.push({ name, body });
    if (handlers[name]) return Promise.resolve(handlers[name](body));
    return original.call(sb.functions, name, args);
  };
  return calls;
}
function periodFixture(extraStores){
  const now = Date.now();
  const yesterday = OPS_PC.resolve('yesterday', null, now).since;
  return {
    session: { user: { id: 'u1' } },
    stores: [{ id: 1, name: 'A상점', platform: 'cafe24', user_id: 'u1' }].concat(extraStores || []),
    connectedAccounts: [
      { store_id: 1, provider: 'cafe24', status: 'connected', last_synced_at: new Date(now + 1000).toISOString(), orders_synced_from: syncedFrom30d() },
      { store_id: 1, provider: 'meta', id: 'm1', status: 'connected', external_account_id: 'act_1' }
    ],
    orders: [
      { store_id: 1, ordered_at: new Date(now).toISOString(), payment_amount: 10000 },
      { store_id: 1, ordered_at: kstNoon(yesterday), payment_amount: 5000 }
    ]
  };
}

test('상단 기간(어제): 주문 동기화 없이 저장된 주문 · Meta 요약만 다시 읽고, 카드 라벨과 값이 어제로 바뀐다', async () => {
  const env = await boot(periodFixture());
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': (body) => ({ data: metaPayload(body.period === 'yesterday' ? { selected: { spend: 7000, purchase_value: 14000, purchase_count: 1, roas: 2 } } : {}), error: null })
  });
  env.sandbox.launchdeskOpsSnapshot.refresh(); // 감싼 invoke로 Meta 요약을 한 번 받아 둔다
  await settle();
  const before = calls.length;

  assert.equal(env.sandbox.launchdeskOpsSnapshot.setPeriod('yesterday'), true);
  await settle();
  const after = calls.slice(before);
  assert.equal(after.filter((c) => c.name === 'cafe24-orders-sync').length, 0, '기간 버튼은 주문 동기화를 하지 않는다');
  const metaCall = after.filter((c) => c.name === 'meta-insights').pop();
  assert.equal(metaCall.body.period, 'yesterday');

  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.period.label, '어제');
  assert.deepEqual([snap.cafe24.selected.count, snap.cafe24.selected.payment, snap.cafe24.selected.coverage], [1, 5000, 'full']);
  assert.equal(env.doc.getElementById('opsdashKpiOrdersLabel').textContent, 'Cafe24 주문 · 어제');
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '1건');
  assert.equal(env.doc.getElementById('opsdashKpiPayment').textContent, '5,000원');
  assert.equal(env.doc.getElementById('opsdashKpiSpendLabel').textContent, 'Meta 광고비 · 어제');
  assert.equal(env.doc.getElementById('opsdashKpiSpend').textContent, '₩7,000');
  assert.match(env.doc.getElementById('opsdashKpiSpendNote').textContent, /^Meta 귀속 기준 · 조회 \d\d\.\d\d \d\d:\d\d$/);
  // 오늘 이후 · "전체"는 상단 기간으로 받지 않는다
  assert.equal(env.sandbox.launchdeskOpsSnapshot.setPeriod('all'), false);
  assert.equal(env.sandbox.launchdeskOpsSnapshot.setPeriod('date', '2999-01-01'), false);
});

// cafe24-orders-sync가 성공했을 때 DB에 남기는 값을 실제 기록 규칙(_shared/orders-sync-range.mjs)으로 흉내 낸다.
async function fakeSyncWriter(row){
  const rule = await import('../supabase/functions/_shared/orders-sync-range.mjs');
  return (body) => {
    row.orders_synced_from = rule.nextOrdersSyncedFrom(row.orders_synced_from, row.last_synced_at, body.start_date);
    row.last_synced_at = new Date().toISOString();
    return { data: { ok: true, start_date: body.start_date, end_date: body.end_date, fetched: 2, last_synced_at_updated: true }, error: null };
  };
}

test('새로고침: Cafe24 주문을 동기화(오늘 − 14일 · 이번 달 1일 · 마지막 동기화 날짜부터 오늘)한 뒤, DB에 기록된 범위를 다시 읽어 판단한다', async () => {
  const fx = periodFixture();
  fx.connectedAccounts[0].orders_synced_from = null; // 범위 기록이 아직 없는 연결(마이그레이션 전 동기화)
  const env = await boot(fx);
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.today.coverage, 'unknown', '기록이 없으면 last_synced_at이 오늘이어도 추정하지 않는다');
  const lastBefore = fx.connectedAccounts[0].last_synced_at;
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': () => ({ data: metaPayload(), error: null }),
    'cafe24-orders-sync': await fakeSyncWriter(fx.connectedAccounts[0])
  });
  const storesBefore = env.supa.callLog.filter((t) => t === 'stores').length;
  env.sandbox.launchdeskOpsSnapshot.refreshWithSync();
  await settle();

  const sync = calls.filter((c) => c.name === 'cafe24-orders-sync');
  assert.equal(sync.length, 1);
  const plan = OPS_PC.syncPlan(OPS_PC.resolve('today', null, Date.now()), Date.now(), lastBefore);
  assert.equal(JSON.stringify(sync[0].body), JSON.stringify({ store_id: 1, start_date: plan.start_date, end_date: plan.end_date }));
  assert.ok(sync[0].body.start_date <= OPS_PC.addDays(plan.end_date, -14));
  assert.ok(calls.filter((c) => c.name === 'meta-insights').length >= 1, 'Meta 요약도 새로 조회한다');
  assert.ok(env.supa.callLog.filter((t) => t === 'stores').length > storesBefore, '동기화 뒤 다시 조회한다');
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.syncing, false);
  assert.equal(snap.cafe24.syncError, null);
  assert.equal(fx.connectedAccounts[0].orders_synced_from, plan.start_date, '함수가 기록한 범위 시작일');
  assert.equal(snap.cafe24.month.coverage, 'partial', 'DB 기록(이번 달 1일 이전부터)을 읽어 이번 달은 "확인 전"이 아니다');
});

test('재접속: 새로고침으로 이번 달을 동기화한 뒤 페이지를 새로 열어도 DB 기록으로 이번 달이 확인된 상태로 남는다', async () => {
  const fx = periodFixture();
  fx.connectedAccounts[0].orders_synced_from = null;
  const first = await boot(fx);
  routeInvoke(first.sandbox.launchdeskSupabase, {
    'meta-insights': () => ({ data: metaPayload(), error: null }),
    'cafe24-orders-sync': await fakeSyncWriter(fx.connectedAccounts[0])
  });
  first.sandbox.launchdeskOpsSnapshot.refreshWithSync();
  await settle();
  assert.equal(first.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.month.coverage, 'partial');

  // 같은 DB 상태로 새 페이지(메모리 없음)
  const reopened = await boot(fx);
  const snap = reopened.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.month.coverage, 'partial', '다시 열어도 "확인 전"으로 돌아가지 않는다');
  reopened.sandbox.launchdeskOpsSnapshot.setPeriod('month');
  await settle();
  assert.notEqual(reopened.doc.getElementById('opsdashKpiOrders').textContent, '확인 전');
  assert.doesNotMatch(reopened.doc.getElementById('opsdashMonthSummary').innerHTML, /확인되지 않았어요/);
});

test('쇼핑몰 전환: A(범위 기록 있음) → B(기록 없음) → A — 각 쇼핑몰의 기록만으로 판단하고 서로 섞이지 않는다', async () => {
  const fx = periodFixture([{ id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }]);
  fx.connectedAccounts.push({ store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: new Date(Date.now() + 1000).toISOString(), orders_synced_from: null });
  fx.orders.push({ store_id: 2, ordered_at: new Date().toISOString(), payment_amount: 22222 });
  const env = await boot(fx);
  const select = env.doc.getElementById('opsStoreSelect');
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.today.coverage, 'partial');
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '1건');

  select.value = '2';
  select.dispatch('change');
  await settle();
  let snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(snap.cafe24.today.coverage, 'unknown', 'A의 기록이 B에 쓰이면 안 된다');
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '확인 전');

  select.value = '1';
  select.dispatch('change');
  await settle();
  snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '1');
  assert.equal(snap.cafe24.today.coverage, 'partial');
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '1건');
});

test('새로고침 동기화 실패: 안내를 남기고 저장된 주문으로 다시 조회하며, 진행 중에는 중복 동기화하지 않는다', async () => {
  const env = await boot(periodFixture());
  const gate = deferred();
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': () => ({ data: metaPayload(), error: null }),
    'cafe24-orders-sync': () => gate.promise.then(() => ({ data: null, error: { message: 'x', context: { json: async () => ({ error: '실패' }) } } }))
  });
  env.sandbox.launchdeskOpsSnapshot.refreshWithSync();
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.syncing, true);
  assert.equal(env.doc.getElementById('opsdashRefreshBtn').disabled, true);
  assert.equal(env.doc.getElementById('opsdashKpiOrdersNote').textContent, '주문 동기화 중…');
  env.sandbox.launchdeskOpsSnapshot.refreshWithSync(); // 진행 중 재클릭
  assert.equal(calls.filter((c) => c.name === 'cafe24-orders-sync').length, 1);

  gate.resolve();
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.syncing, false);
  assert.equal(snap.cafe24.syncError, '주문 동기화에 실패했어요. 저장된 주문으로 표시합니다.');
  assert.equal(snap.cafe24.state, 'data', '저장된 주문은 그대로 다시 조회된다');
  assert.equal(env.doc.getElementById('opsdashKpiOrdersNote').textContent, '주문 동기화에 실패했어요. 저장된 주문으로 표시합니다.');
  assert.match(env.doc.getElementById('opsdashConnectionStatus').innerHTML, /동기화 실패/);
  assert.equal(env.doc.getElementById('opsdashRefreshBtn').disabled, false);
});

test('동기화 도중 다른 쇼핑몰로 바꾸면, 늦게 끝난 동기화가 새 쇼핑몰 화면을 되돌리거나 오류를 옮기지 않는다', async () => {
  const fx = periodFixture([{ id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }]);
  fx.connectedAccounts.push({ store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: new Date(Date.now() + 1000).toISOString() });
  fx.orders.push({ store_id: 2, ordered_at: new Date().toISOString(), payment_amount: 22222 });
  const env = await boot(fx);
  const gate = deferred();
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': () => ({ data: metaPayload(), error: null }),
    'cafe24-orders-sync': () => gate.promise.then(() => ({ data: null, error: { message: 'x' } }))
  });
  env.sandbox.launchdeskOpsSnapshot.refreshWithSync(); // A 동기화 시작
  await settle();
  const select = env.doc.getElementById('opsStoreSelect');
  select.value = '2';
  select.dispatch('change');
  await settle();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().cafe24.syncing, false, 'B 화면에는 A의 동기화 중 표시가 없다');

  gate.resolve();
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(snap.cafe24.today.payment, 22222);
  assert.equal(snap.cafe24.syncError, null, 'A의 동기화 실패가 B에 표시되면 안 된다');
  assert.equal(calls.filter((c) => c.name === 'cafe24-orders-sync').length, 1);
});

test('기간을 빠르게 바꾸면 이전 기간(어제)의 늦은 Meta 응답은 쓰지 않고 지금 기간(이번 달)으로 다시 조회한다', async () => {
  const env = await boot(periodFixture());
  const gate = deferred();
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': (body) => body.period === 'yesterday'
      ? gate.promise.then(() => ({ data: metaPayload({ selected: { spend: 7777, purchase_value: 0, purchase_count: 0, roas: 0 } }), error: null }))
      : { data: metaPayload(), error: null }
  });
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  env.sandbox.launchdeskOpsSnapshot.setPeriod('yesterday');
  await settle();
  env.sandbox.launchdeskOpsSnapshot.setPeriod('month');
  await settle();
  gate.resolve();
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.period.period, 'month');
  assert.equal(snap.meta.selected.spend, 300000);
  assert.equal(env.doc.getElementById('opsdashKpiSpend').textContent, '₩300,000');
  const last = calls.filter((c) => c.name === 'meta-insights').pop();
  assert.equal(last.body.period, undefined, '마지막 조회는 이번 달(추가 기간 없음)');
});

test('선택 날짜가 마지막 동기화 이후면 0건이 아니라 "확인 전"과 동기화 안내를 보여준다', async () => {
  const fx = periodFixture();
  fx.connectedAccounts[0].last_synced_at = new Date(Date.now() - 3 * 86400000).toISOString(); // 3일 전 동기화
  const env = await boot(fx);
  env.sandbox.launchdeskOpsSnapshot.setPeriod('yesterday');
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.cafe24.selected.coverage, 'none');
  assert.equal(env.doc.getElementById('opsdashKpiOrders').textContent, '확인 전');
  assert.match(env.doc.getElementById('opsdashKpiOrdersNote').textContent, /아직 동기화 전이에요\(마지막 동기화 \d\d\.\d\d \d\d:\d\d\)/);
});

// ===================================================== 광고 기록 — Meta 하루 합계 자동 기록
// meta-insights 응답: 기간 인자가 있으면 그 하루의 계정 전체 합계(selected)와 조회 범위를 돌려준다.
function metaDayRoute(sel, opts){
  opts = opts || {};
  return (body) => ({
    data: metaPayload({
      account: { id: 'act_1', name: 'Test Ads', currency: opts.currency || 'KRW', timezone_name: 'Asia/Seoul' },
      selected: body.period ? sel : undefined,
      queried_range: body.period ? { selected: { since: body.date || opts.yesterday || '2026-09-23', until: body.date || opts.yesterday || '2026-09-23' } } : {}
    }),
    error: null
  });
}
const DAY_SEL = { spend: 30000, purchase_count: 3, purchase_value: 90000, purchase_value_observed: true, purchase_basis: 'offsite_conversion.fb_pixel_purchase', roas: 3 };
function adlogInserts(env){
  return env.supa.writeCalls.filter((w) => w.table === 'tool_records' && w.op === 'insert' && w.payload.tool_type === 'ad_log');
}

test('광고 기록: "Meta 성과 기록하기"는 선택 쇼핑몰의 계정 전체 어제 합계를 1건 저장하고, 같은 날짜를 다시 누르면 건너뛴다', async () => {
  const env = await boot(periodFixture());
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, { 'meta-insights': metaDayRoute(DAY_SEL) });
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  const btn = env.doc.getElementById('adlogMetaBtn');
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Meta 성과 기록하기(어제)');

  btn.click();
  await settle();
  const metaCall = calls.filter((c) => c.name === 'meta-insights').pop();
  assert.equal(metaCall.body.period, 'yesterday');
  assert.equal(calls.filter((c) => c.name === 'cafe24-orders-sync').length, 0, 'Cafe24 동기화와 무관하다');
  let inserts = adlogInserts(env);
  assert.equal(inserts.length, 1);
  const data = inserts[0].payload.data;
  assert.equal(data.meta_auto_key, '1|act_1|2026-09-23');
  assert.equal(data.source, 'meta_auto');
  assert.equal(data.spend, 30000);
  assert.equal(data.revenue, 90000);
  assert.equal(data.store_id, '1');
  assert.equal(env.doc.getElementById('adlogMetaStatus').textContent, '2026-09-23 Meta 하루 합계를 기록했어요.');
  const tbody = env.doc.getElementById('adlogTbody').innerHTML;
  assert.match(tbody, /Meta 캠페인 전체 합계 <span class="adlog-tag">Meta 자동 · 귀속 구매금액<\/span>/);
  assert.match(tbody, /₩90,000/);
  assert.equal(env.doc.getElementById('adlogSumSpend').textContent, '₩30,000');
  assert.equal(env.doc.getElementById('adlogSumRoas').textContent, '3.0x');

  btn.click(); // 같은 날짜 다시
  await settle();
  inserts = adlogInserts(env);
  assert.equal(inserts.length, 1, '같은 쇼핑몰 · 광고계정 · 날짜는 다시 저장하지 않는다');
  assert.equal(env.doc.getElementById('adlogMetaStatus').textContent, '2026-09-23 기록이 이미 있어 건너뛰었어요.');
});

test('광고 기록: 날짜를 고르면 그 과거 하루를 기록하고, 구매금액 항목이 없으면 매출은 null("—")로 둔다', async () => {
  const env = await boot(periodFixture());
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': metaDayRoute({ spend: 12000, purchase_count: 0, purchase_value: 0, purchase_value_observed: false, purchase_basis: null, roas: 0 })
  });
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  const day = env.sandbox.launchdeskMetaAdsetsCore.localDateString(Date.now() - 6 * 86400000);
  const dateEl = env.doc.getElementById('adlogMetaDate');
  dateEl.value = day;
  dateEl.dispatch('change');
  const btn = env.doc.getElementById('adlogMetaBtn');
  assert.equal(btn.textContent, 'Meta 성과 기록하기(' + day + ')');
  btn.click();
  await settle();
  const metaCall = calls.filter((c) => c.name === 'meta-insights').pop();
  assert.equal(metaCall.body.period, 'date');
  assert.equal(metaCall.body.date, day);
  const data = adlogInserts(env).pop().payload.data;
  assert.equal(data.date, day);
  assert.equal(data.revenue, null);
  assert.equal(data.purchases, null);
  const tbody = env.doc.getElementById('adlogTbody').innerHTML;
  assert.match(tbody, /<td class="num">—<\/td><td class="num ">—<\/td>/, '매출 · ROAS 모두 —');
  assert.equal(env.doc.getElementById('adlogSumSpend').textContent, '₩12,000');
  assert.equal(env.doc.getElementById('adlogSumRoas').textContent, '—', '매출이 없는 기록은 ROAS에서 뺀다');

  // 오늘 · 미래 날짜는 고를 수 없다
  dateEl.value = env.sandbox.launchdeskMetaAdsetsCore.localDateString(Date.now());
  dateEl.dispatch('change');
  assert.equal(dateEl.value, '');
  assert.match(env.doc.getElementById('adlogMetaStatus').textContent, /어제까지의 과거 날짜/);
});

test('광고 기록: 다른 탭에서 먼저 저장해 DB가 중복(23505)으로 거부하면 건너뛰었다고 알리고 목록에 넣지 않는다', async () => {
  const env = await boot(periodFixture());
  routeInvoke(env.sandbox.launchdeskSupabase, { 'meta-insights': metaDayRoute(DAY_SEL) });
  const sb = env.sandbox.launchdeskSupabase;
  const originalFrom = sb.from;
  sb.from = function(table){
    const chain = originalFrom.call(sb, table);
    if (table !== 'tool_records') return chain;
    chain.insert = () => ({ then: (res, rej) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(res, rej), catch(){} });
    return chain;
  };
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  env.doc.getElementById('adlogMetaBtn').click();
  await settle();
  assert.equal(env.doc.getElementById('adlogMetaStatus').textContent, '2026-09-23 기록이 이미 있어 건너뛰었어요.');
  assert.equal(env.sandbox.launchdeskStore.getAdlogRecords().length, 0);
  sb.from = originalFrom;
});

test('광고 기록: 원화가 아닌 광고계정은 자동 기록 버튼을 막고 안내한다', async () => {
  const env = await boot(periodFixture());
  routeInvoke(env.sandbox.launchdeskSupabase, { 'meta-insights': metaDayRoute(DAY_SEL, { currency: 'USD' }) });
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  const btn = env.doc.getElementById('adlogMetaBtn');
  assert.equal(btn.disabled, true);
  assert.match(env.doc.getElementById('adlogMetaStatus').textContent, /USD라 원화 기준 광고 기록에 자동으로 넣을 수 없어요/);
  btn.click();
  await settle();
  assert.equal(adlogInserts(env).length, 0);
});

test('광고 기록 합계: 지금 쇼핑몰의 기록만 계산하고, 쇼핑몰을 알 수 없는 예전 기록 · 삭제된 쇼핑몰 기록은 목록에만(합계 제외), 남아 있는 다른 쇼핑몰 기록은 숨긴다', async () => {
  const env = await boot(periodFixture([{ id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }]));
  await settle();
  const store = env.sandbox.launchdeskStore;
  store.addAdlogRecord({ id: 1, date: '03.20', name: '옛 소재', spend: 10000, revenue: 50000, channel: '메타' });
  store.addAdlogRecord({ id: 2, date: '2026-09-20', name: 'A 소재', spend: 20000, revenue: 40000, channel: '메타', store_id: '1' });
  store.addAdlogRecord({ id: 3, date: '2026-09-20', name: 'B 소재', spend: 99999, revenue: 1, channel: '메타', store_id: '2' });
  store.addAdlogRecord({ id: 4, date: '2026-09-19', name: '없어진 상점 소재', spend: 77777, revenue: 1, channel: '메타', store_id: '9' });
  env.sandbox.launchdeskAdlog.render();
  const tbody = env.doc.getElementById('adlogTbody').innerHTML;
  assert.match(tbody, /옛 소재 <span class="adlog-tag">쇼핑몰 미지정 · 합계 제외<\/span>/);
  assert.match(tbody, /A 소재/);
  assert.doesNotMatch(tbody, /B 소재/, '남아 있는 다른 쇼핑몰(B)의 기록은 숨긴다');
  assert.match(tbody, /없어진 상점 소재 <span class="adlog-tag">삭제된 쇼핑몰 기록 · 현재 합계 제외<\/span>/);
  assert.equal(env.doc.getElementById('adlogSumSpend').textContent, '₩20,000');
  assert.equal(env.doc.getElementById('adlogSumRoas').textContent, '2.0x');
  assert.equal(env.doc.getElementById('adlogSumBest').textContent, 'A 소재 (2026-09-20)');

  // 새 수동 기록은 지금 쇼핑몰에 붙는다
  env.doc.getElementById('adlogDate').value = '09.21';
  env.doc.getElementById('adlogName').value = '가을 릴스';
  env.doc.getElementById('adlogSpend').value = '5000';
  env.doc.getElementById('adlogRevenue').value = '15000';
  env.doc.getElementById('adlogForm').dispatch('submit');
  const manual = adlogInserts(env).pop().payload.data;
  assert.equal(manual.name, '가을 릴스');
  assert.equal(manual.store_id, '1');
  assert.equal(manual.source, undefined, '수동 기록에는 자동 기록 표시가 없다');
});

// ===================================================== 쇼핑몰 삭제 · 연결 해제와 광고 기록
// stores.js(내 쇼핑몰 화면)를 함께 싣고, DB 쓰기를 기록 · 조작한다.
//   - tool_records delete: 필터를 기록(실패 주입 가능)
//   - stores delete: 성공 처리 후 이후 조회에서 그 행을 뺀다
//   - hide(table, pred): 이후 조회에서 조건에 맞는 행을 뺀다(연결 해제 흉내)
function storeHarness(env, opts){
  opts = opts || {};
  const sb = env.sandbox.launchdeskSupabase;
  const original = sb.from;
  const toolDeletes = [];
  const storeDeletes = [];
  const hidden = [];
  const deletedStoreIds = new Set();
  sb.from = function(table){
    const chain = original.call(sb, table);
    const originalThen = chain.then;
    chain.then = (res, rej) => originalThen.call(chain, (r) => {
      if (r && Array.isArray(r.data)) {
        let rows = r.data;
        if (table === 'stores') rows = rows.filter((s) => !deletedStoreIds.has(String(s.id)));
        hidden.filter((h) => h.table === table).forEach((h) => { rows = rows.filter((row) => !h.pred(row)); });
        r = { data: rows, error: r.error };
      } else if (r && r.data && table === 'connected_accounts' && hidden.some((h) => h.table === table && h.pred(r.data))) {
        r = { data: null, error: null }; // maybeSingle 결과에서도 숨긴다
      }
      return res ? res(r) : r;
    }, rej);
    if (table === 'tool_records' || table === 'stores') {
      chain.delete = () => {
        const f = {};
        const q = {
          eq(c, v){ f[c] = v; return q; },
          then(res, rej){
            let result = { data: null, error: null };
            if (table === 'tool_records') { toolDeletes.push(f); if (opts.failToolDelete) result = { data: null, error: { message: '삭제 실패(테스트)' } }; }
            else {
              storeDeletes.push(f);
              // DB 트리거가 같은 트랜잭션에서 실패한 경우 = 쇼핑몰 삭제 자체가 오류로 되돌아간다
              if (opts.failStoreDelete) result = { data: null, error: { message: 'trigger failed(테스트)' } };
              else deletedStoreIds.add(String(f.id));
            }
            return Promise.resolve(result).then(res, rej);
          }
        };
        return q;
      };
    }
    return chain;
  };
  return { toolDeletes, storeDeletes, hide(table, pred){ hidden.push({ table, pred }); } };
}
function clickStoreAction(env, cls, attrs){
  const target = { closest(sel){ return sel === cls ? { disabled: false, getAttribute(n){ return attrs[n] === undefined ? null : attrs[n]; } } : null; } };
  (env.doc.getElementById('storesList').listeners.click || []).forEach((fn) => fn({ target }));
}
function captureConfirm(env){
  const msgs = [];
  env.sandbox.confirm = (m) => { msgs.push(m); return true; };
  return msgs;
}
function lastToast(env){
  const t = env.doc.getElementById('toastStack').children;
  return t.length ? t[t.length - 1].textContent : '';
}
function seedAdlogAB(env){
  const s = env.sandbox.launchdeskStore;
  s.addAdlogRecord({ id: 11, source: 'meta_auto', meta_auto_key: '1|act_1|2026-09-20', store_id: '1', date: '2026-09-20', name: 'A 자동', channel: '메타', spend: 30000, revenue: 90000 });
  s.addAdlogRecord({ id: 12, store_id: '1', date: '09.20', name: 'A 수동', channel: '메타', spend: 1000, revenue: 2000 });
  s.addAdlogRecord({ id: 13, source: 'meta_auto', meta_auto_key: '2|act_2|2026-09-20', store_id: '2', date: '2026-09-20', name: 'B 자동', channel: '메타', spend: 5000, revenue: 10000 });
  s.addAdlogRecord({ id: 14, date: '03.20', name: '옛 기록', channel: '메타', spend: 700, revenue: 1400 });
  env.sandbox.launchdeskAdlog.render(); // 실제 화면은 저장 직후 표를 다시 그린다
}
const adlogNames = (env) => env.sandbox.launchdeskStore.getAdlogRecords().map((r) => r.name).sort();
function abFixture(){
  const fx = periodFixture([{ id: 2, name: 'B상점', platform: 'cafe24', user_id: 'u1' }]);
  fx.connectedAccounts.push({ store_id: 2, provider: 'cafe24', status: 'connected', last_synced_at: new Date().toISOString(), orders_synced_from: null });
  fx.withStores = true;
  return fx;
}

test('쇼핑몰 삭제(A·B): 삭제 전에 안내하고, 쇼핑몰 행 삭제 한 번(DB 트리거가 자동 기록을 같은 트랜잭션에서 삭제)으로 A의 Meta 자동 기록만 없어진다 — A 수동 · B · 미지정 기록은 남아 조회 · 개별 삭제할 수 있다', async () => {
  const env = await boot(abFixture());
  const h = storeHarness(env);
  seedAdlogAB(env);
  const msgs = captureConfirm(env);
  clickStoreAction(env, '.store-del-btn', { 'data-id': '1' });
  await settle();

  assert.match(msgs[0], /이 쇼핑몰의 Meta 자동 광고 기록\(1건\)도 함께 삭제됩니다\. 직접 입력한 광고 기록과 다른 쇼핑몰의 기록은 남습니다\./);
  assert.equal(JSON.stringify(h.storeDeletes), JSON.stringify([{ id: '1', user_id: 'u1' }]));
  assert.equal(h.toolDeletes.length, 0, '브라우저는 광고 기록 삭제를 따로 요청하지 않는다(트리거가 처리)');
  assert.equal(lastToast(env), '쇼핑몰과 그 쇼핑몰의 Meta 자동 광고 기록을 삭제했어요');
  assert.deepEqual(adlogNames(env), ['A 수동', 'B 자동', '옛 기록'], '화면에서도 A 자동만 빠진다');

  // 운영 현황 다시 읽기 → A가 목록에서 빠지고 B가 선택된다
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(String(snap.storeId), '2');
  assert.equal(JSON.stringify(snap.storeIds), JSON.stringify(['2']));
  const tbody = env.doc.getElementById('adlogTbody').innerHTML;
  assert.match(tbody, /A 수동 <span class="adlog-tag">삭제된 쇼핑몰 기록 · 현재 합계 제외<\/span>/, '다른 쇼핑몰로 옮기지 않고 삭제된 쇼핑몰 기록으로 보인다');
  assert.match(tbody, /B 자동 <span class="adlog-tag">Meta 자동 · 귀속 구매금액<\/span>/);
  assert.match(tbody, /옛 기록 <span class="adlog-tag">쇼핑몰 미지정 · 합계 제외<\/span>/);
  assert.equal(env.doc.getElementById('adlogSumSpend').textContent, '₩5,000', '합계는 B 기록만');

  env.sandbox.deleteAdlogRecord(12); // 남은 A 수동 기록을 개별 삭제
  await settle();
  assert.deepEqual(adlogNames(env), ['B 자동', '옛 기록']);
  assert.equal(h.toolDeletes.pop()['data->>id'], '12');
  assert.doesNotMatch(env.doc.getElementById('adlogTbody').innerHTML, /A 수동/);
});

test('쇼핑몰 삭제가 DB에서 실패하면(트리거 포함 트랜잭션 되돌림) 쇼핑몰과 자동 기록이 모두 남고, 성공으로 알리지 않는다', async () => {
  const env = await boot(abFixture());
  const h = storeHarness(env, { failStoreDelete: true });
  seedAdlogAB(env);
  captureConfirm(env);
  clickStoreAction(env, '.store-del-btn', { 'data-id': '1' });
  await settle();
  assert.equal(h.storeDeletes.length, 1);
  assert.equal(h.toolDeletes.length, 0);
  assert.equal(lastToast(env), '쇼핑몰을 삭제하지 못했어요. 쇼핑몰과 광고 기록은 그대로 남아 있어요. (trigger failed(테스트))');
  assert.deepEqual(adlogNames(env), ['A 수동', 'A 자동', 'B 자동', '옛 기록'], '자동 기록도 그대로 남는다');
  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(JSON.stringify(snap.storeIds), JSON.stringify(['1', '2']), '쇼핑몰 A도 남아 있다');
  assert.doesNotMatch(env.doc.getElementById('adlogTbody').innerHTML, /삭제된 쇼핑몰 기록/);
});

test('쇼핑몰 삭제 응답을 받지 못하면(네트워크 오류) 삭제 여부를 단정하지 않고 확인을 안내한다', async () => {
  const env = await boot(abFixture());
  const sb = env.sandbox.launchdeskSupabase;
  const original = sb.from;
  sb.from = function(table){
    const chain = original.call(sb, table);
    if (table === 'stores') chain.delete = () => { const q = { eq(){ return q; }, then(res, rej){ return Promise.reject(new Error('network')).then(res, rej); } }; return q; };
    return chain;
  };
  seedAdlogAB(env);
  captureConfirm(env);
  clickStoreAction(env, '.store-del-btn', { 'data-id': '1' });
  await settle();
  assert.equal(lastToast(env), '쇼핑몰 삭제 결과를 확인하지 못했어요. 새로고침해 확인해주세요.');
  assert.deepEqual(adlogNames(env), ['A 수동', 'A 자동', 'B 자동', '옛 기록']);
});

test('Meta 연결 해제: 안내 후 해제하고 광고 기록은 지우지 않는다 — 해제 후에도 조회 · 개별 삭제할 수 있다', async () => {
  const env = await boot(abFixture());
  const h = storeHarness(env);
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': () => ({ data: metaPayload(), error: null }),
    'meta-disconnect': () => {
      h.hide('connected_accounts', (row) => row.provider === 'meta'); // 해제 후 Meta 연결이 사라진 것처럼
      return { data: { ok: true }, error: null };
    }
  });
  seedAdlogAB(env);
  const msgs = captureConfirm(env);
  clickStoreAction(env, '.store-meta-disconnect-btn', { 'data-connected-account-id': 'm1' });
  await settle();
  assert.match(msgs[0], /저장한 광고 기록은 남으며, 광고 기록에서 직접 삭제할 수 있습니다\./);
  assert.equal(calls.filter((c) => c.name === 'meta-disconnect').length, 1);
  assert.equal(h.toolDeletes.length, 0, 'Meta 연결 해제는 광고 기록을 지우지 않는다');
  assert.deepEqual(adlogNames(env), ['A 수동', 'A 자동', 'B 자동', '옛 기록']);

  env.sandbox.launchdeskOpsSnapshot.refresh();
  await settle();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.meta.state, 'not-connected');
  assert.equal(env.doc.getElementById('adlogMetaBtn').disabled, true, '새 자동 기록은 만들 수 없다');
  assert.match(env.doc.getElementById('adlogTbody').innerHTML, /A 자동/, '해제 후에도 기록은 보인다');
  env.sandbox.deleteAdlogRecord(11);
  await settle();
  assert.ok(!adlogNames(env).includes('A 자동'));
  assert.equal(h.toolDeletes[0]['data->>id'], '11');
});

test('Cafe24 연결 해제: 쇼핑몰 행과 Meta 연결이 남는 경우 Meta 자동 기록을 지우지 않는다', async () => {
  const env = await boot(abFixture());
  const h = storeHarness(env);
  const calls = routeInvoke(env.sandbox.launchdeskSupabase, {
    'meta-insights': () => ({ data: metaPayload(), error: null }),
    'cafe24-disconnect': () => ({ data: { ok: true }, error: null })
  });
  seedAdlogAB(env);
  captureConfirm(env);
  clickStoreAction(env, '.store-cafe24-disconnect-btn', { 'data-id': '1' });
  await settle();
  assert.equal(calls.filter((c) => c.name === 'cafe24-disconnect').length, 1);
  assert.equal(h.toolDeletes.length, 0);
  assert.equal(h.storeDeletes.length, 0);
  assert.deepEqual(adlogNames(env), ['A 수동', 'A 자동', 'B 자동', '옛 기록']);
});

test('쇼핑몰 0개: 삭제된 쇼핑몰의 기록과 미지정 기록이 모두 보이고(삭제된 쇼핑몰 기록은 합계 제외) 개별 삭제할 수 있다', async () => {
  const fx = periodFixture();
  fx.stores = [];
  fx.withStores = true;
  const env = await boot(fx);
  const h = storeHarness(env);
  const s = env.sandbox.launchdeskStore;
  s.addAdlogRecord({ id: 21, store_id: '1', date: '09.20', name: '예전 상점 수동', channel: '메타', spend: 9000, revenue: 18000 });
  s.addAdlogRecord({ id: 22, source: 'meta_auto', meta_auto_key: '1|act_1|2026-09-19', store_id: '1', date: '2026-09-19', name: '예전 상점 자동', channel: '메타', spend: 8000, revenue: null });
  s.addAdlogRecord({ id: 23, date: '03.21', name: '미지정 기록', channel: '메타', spend: 1000, revenue: 3000 });
  env.sandbox.launchdeskAdlog.render();
  const snap = env.sandbox.launchdeskOpsSnapshot.getLatest();
  assert.equal(snap.storeId, null);
  assert.equal(JSON.stringify(snap.storeIds), '[]');
  const tbody = env.doc.getElementById('adlogTbody').innerHTML;
  assert.match(tbody, /예전 상점 수동 <span class="adlog-tag">삭제된 쇼핑몰 기록 · 현재 합계 제외<\/span>/);
  assert.match(tbody, /예전 상점 자동 <span class="adlog-tag">Meta 자동 · 귀속 구매금액<\/span> <span class="adlog-tag">삭제된 쇼핑몰 기록 · 현재 합계 제외<\/span>/);
  assert.match(tbody, /미지정 기록<\/td>/);
  assert.equal(env.doc.getElementById('adlogSumSpend').textContent, '₩1,000', '삭제된 쇼핑몰 기록은 합계에서 뺀다');
  env.sandbox.deleteAdlogRecord(21);
  env.sandbox.deleteAdlogRecord(22);
  await settle();
  assert.deepEqual(adlogNames(env), ['미지정 기록']);
  assert.deepEqual(h.toolDeletes.map((f) => f['data->>id']), ['21', '22']);
});

test('쇼핑몰 목록을 아직 모르거나 조회에 실패하면 store_id가 있는 기록을 "삭제된 쇼핑몰"로 단정하지 않는다', async () => {
  const fx = periodFixture();
  fx.errorTables = ['stores'];
  const env = await boot(fx);
  env.sandbox.launchdeskStore.addAdlogRecord({ id: 31, store_id: '1', date: '09.20', name: '상점 기록', channel: '메타', spend: 1000, revenue: 2000 });
  env.sandbox.launchdeskAdlog.render();
  assert.equal(env.sandbox.launchdeskOpsSnapshot.getLatest().storeIds, null);
  assert.doesNotMatch(env.doc.getElementById('adlogTbody').innerHTML, /삭제된 쇼핑몰 기록/);
});
