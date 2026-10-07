// 서버 오류 code별 화면 안내 — core.js(readFunctionError · functionErrorNotice)와, 그것을 쓰는 실제 화면 스크립트
// (app.js · connections.js · sales.js · calculator.js · ad-performance.js)를 가짜 DOM · 가짜 Supabase로 실행한다.
// 실행: node --test launchroas/function-errors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('./core.js');

// supabase.functions.invoke가 2xx가 아닐 때 주는 모양: data 없음 · error.context = 함수 응답(Response)
const httpError = (status, body) => ({ data: null, error: { name: 'FunctionsHttpError', context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) } });
const networkError = () => ({ data: null, error: { name: 'FunctionsFetchError', context: new TypeError('fetch failed') } });
const notice = async (provider, result, fallback) => core.functionErrorNotice(provider, await core.readFunctionError(result), fallback);

const META = {
  reconnect: 'Meta 연결이 만료됐어요. 연결 관리에서 Meta를 다시 연결해 주세요.',
  permission: '필요한 권한이 없어요. Meta 연결 설정(광고계정 권한)을 확인해 주세요.',
  rate: 'Meta 요청이 많아 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.',
  temporary: '잠시 Meta 데이터를 불러오지 못했어요. 다시 시도해 주세요.',
  internal: '일시적인 서버 오류로 Meta 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
};
const CAFE = {
  reconnect: 'Cafe24 연결이 만료됐어요. 연결 관리에서 Cafe24를 다시 연결해 주세요.',
  api: 'Cafe24에서 앱 권한이 해제됐거나 인증이 만료됐어요. 연결 관리에서 Cafe24를 다시 연결해 주세요.',
  temporary: '잠시 Cafe24 데이터를 불러오지 못했어요. 다시 시도해 주세요.',
  cursor: '주문은 저장했지만 동기화 기록을 저장하지 못했어요. 잠시 후 다시 동기화해 주세요.',
  internal: '일시적인 서버 오류로 Cafe24 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
};

// ---------------------------------------------------------------- core.js
test('Meta 오류 code별 안내: 재연결 · 권한 · 요청 한도 · 일시 오류 · 서버 오류', async () => {
  const cases = [
    [httpError(401, { code: 'RECONNECT_REQUIRED' }), 'reconnect', META.reconnect],
    [httpError(403, { code: 'PERMISSION_REQUIRED' }), 'permission', META.permission],
    [httpError(429, { code: 'RATE_LIMITED' }), 'rate_limited', META.rate],
    [httpError(502, { code: 'TEMPORARY_ERROR' }), 'temporary', META.temporary],
    [httpError(500, { code: 'INTERNAL_ERROR' }), 'internal', META.internal],
    [httpError(500, { code: 'CREDENTIAL_LOOKUP_FAILED' }), 'internal', META.internal],
    [httpError(500, { code: 'CREDENTIAL_NOT_FOUND' }), 'reconnect', META.reconnect],
    [networkError(), 'temporary', META.temporary],
    [httpError(504, '<html>Gateway Timeout</html>'), 'temporary', META.temporary],
    [httpError(500, { error: '서버 오류' }), 'internal', META.internal],
  ];
  for (const [result, kind, message] of cases) {
    assert.deepEqual(await notice('meta', result), { kind, message }, JSON.stringify(kind));
  }
});

test('재연결이 필요한 경우가 아니면 안내 문구에 재연결을 넣지 않는다', async () => {
  for (const code of ['PERMISSION_REQUIRED', 'RATE_LIMITED', 'TEMPORARY_ERROR', 'INTERNAL_ERROR', 'CREDENTIAL_LOOKUP_FAILED']) {
    const n = await notice('meta', httpError(500, { code }));
    assert.doesNotMatch(n.message, /다시 연결/, code);
  }
  for (const code of ['REFRESH_RETRYABLE', 'CONFIG_ERROR', 'REFRESH_FAILED', 'SYNC_CURSOR_SAVE_FAILED']) {
    assert.doesNotMatch((await notice('cafe24', httpError(503, { code }))).message, /다시 연결/, code);
  }
});

test('Cafe24: 토큰 만료 재연결 · 앱 권한 해제(API 401) · 일시 오류 · 동기화 기록 실패 · 서버 오류', async () => {
  assert.deepEqual(await notice('cafe24', httpError(401, { code: 'RECONNECT_REQUIRED' })), { kind: 'reconnect', message: CAFE.reconnect });
  assert.deepEqual(await notice('cafe24', httpError(401, { code: 'RECONNECT_REQUIRED', reason: 'CAFE24_API_UNAUTHORIZED' })), { kind: 'reconnect', message: CAFE.api });
  assert.deepEqual(await notice('cafe24', httpError(503, { code: 'REFRESH_RETRYABLE' })), { kind: 'temporary', message: CAFE.temporary });
  assert.deepEqual(await notice('cafe24', httpError(502, { error: 'Cafe24 주문을 가져오지 못했습니다.', status: 500 })), { kind: 'temporary', message: CAFE.temporary });
  assert.deepEqual(await notice('cafe24', httpError(503, { code: 'SYNC_CURSOR_SAVE_FAILED' })), { kind: 'temporary', message: CAFE.cursor });
  assert.deepEqual(await notice('cafe24', httpError(500, { code: 'CONFIG_ERROR' })), { kind: 'internal', message: CAFE.internal });
  assert.deepEqual(await notice('cafe24', httpError(500, { error: 'Cafe24 주문 동기화 중 오류가 발생했습니다.' })), { kind: 'internal', message: CAFE.internal });
});

test('그 밖의 code · code 없는 4xx는 서버가 준 고정 안내 문구를 쓰고, 없으면 화면 문구', async () => {
  assert.deepEqual(await notice('meta', httpError(409, { code: 'ACCOUNT_UNAVAILABLE', error: '이 광고계정에 접근할 수 없습니다.' })), { kind: 'other', message: '이 광고계정에 접근할 수 없습니다.' });
  assert.deepEqual(await notice('meta', httpError(403, { error: '이 광고계정에 대한 접근 권한을 확인할 수 없습니다.' })), { kind: 'other', message: '이 광고계정에 대한 접근 권한을 확인할 수 없습니다.' });
  assert.deepEqual(await notice('meta', httpError(400, { code: 'SOMETHING_NEW' }), '화면 문구'), { kind: 'other', message: '화면 문구' });
});

test('readFunctionError: 본문을 못 읽어도(형식 오류 · 이미 읽음) 멈추지 않는다', async () => {
  assert.deepEqual(await core.readFunctionError(httpError(502, 'not json')), { status: 502, body: null });
  const used = httpError(401, { code: 'RECONNECT_REQUIRED' });
  await used.error.context.json();
  assert.deepEqual(await core.readFunctionError(used), { status: 401, body: null });
  assert.deepEqual(await core.readFunctionError({ data: { ok: false, code: 'RATE_LIMITED' }, error: null }), { status: null, body: { ok: false, code: 'RATE_LIMITED' } });
  assert.deepEqual(await core.readFunctionError(null), { status: null, body: null });
});

// ---------------------------------------------------------------- app.js + connections.js
function el(tag) {
  const n = { tag, children: [], hidden: false, textContent: '', dataset: {}, disabled: false, _value: '', events: {}, className: '',
    addEventListener(type, fn) { this.events[type] = fn; }, append(...c) { this.children.push(...c); },
    appendChild(c) { if (tag === 'select' && !this.children.some((o) => o.selected)) c.selected = true; this.children.push(c); },
    replaceChildren(...c) { this.children = c; }, setAttribute() {}, focus() {}, reset() {}, closest() { return null; },
    querySelector() { return el('button'); }, cloneNode() { return el(tag); }, classList: { toggle() {} } };
  Object.defineProperty(n, 'options', { get() { return this.children; } });
  Object.defineProperty(n, 'value', {
    get() { if (tag !== 'select') return this._value; const o = this.children.find((c) => c.selected); return o ? String(o.value) : ''; },
    set(v) { if (tag !== 'select') { this._value = v; return; } this.children.forEach((c) => { c.selected = String(c.value) === String(v); }); },
  });
  return n;
}
function query(rows) { const q = {}; ['select', 'eq', 'in', 'gte', 'lt', 'limit', 'order'].forEach((k) => { q[k] = () => q; }); q.then = (ok, fail) => Promise.resolve({ data: rows, error: null }).then(ok, fail); return q; }
async function settle() { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5)); }

// accounts: connected_accounts 행 · invoke(name, body) → 응답
async function bootApp({ accounts, invoke }) {
  const nodes = {}, invoked = [];
  const document = { getElementById(id) { if (!nodes[id]) nodes[id] = el(/Select$|Store$|Choice$/.test(id) ? 'select' : 'div'); return nodes[id]; },
    createElement: el, querySelectorAll() { return []; }, querySelector() { return el('button'); } };
  const client = {
    auth: { onAuthStateChange(cb) { setTimeout(() => cb('SIGNED_IN', { user: { id: 'u1', email: 'a@example.com' } }), 0); }, signOut: async () => ({}), getUser: async () => ({ data: {} }) },
    from(table) { return query({ user_policy_consents: [{ id: 1 }], stores: [{ id: 4, name: '운영 쇼핑몰', platform: 'cafe24' }], connected_accounts: accounts, orders: [] }[table] || []); },
    functions: { invoke: async (name, opt) => { invoked.push(name); return invoke(name, opt && opt.body); } },
  };
  const sandbox = { document, URLSearchParams, URL, Intl, Date, Math, Number, String, JSON, Promise, Object, Array, Error, setTimeout, console,
    location: { search: '', pathname: '/', hash: '', origin: 'https://launchroas.vercel.app', assign() {} },
    history: { replaceState() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, CustomEvent: function () {}, dispatchEvent() {}, scrollTo() {}, supabase: { createClient: () => client } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['policy-consent-core.js', 'core.js', 'ops-period-core.js', 'app.js', 'connections.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), sandbox, { filename: f });
  await settle();
  return { nodes, invoked, get ctx() { return sandbox.LaunchRoasApp.getContext(); } };
}
const CAFE_ROW = { id: 1, store_id: 4, provider: 'cafe24', status: 'connected', last_synced_at: '2026-10-07T00:00:00Z', orders_synced_from: '2026-07-10' };
const META_PENDING = { id: 2, store_id: 4, provider: 'meta', status: 'pending', external_account_id: null };
const META_CONNECTED = { id: 2, store_id: 4, provider: 'meta', status: 'connected', external_account_id: 'act_1' };

test('연결 관리: 광고계정 목록 오류는 재연결이 필요할 때만 재연결을 안내한다', async () => {
  let r = await bootApp({ accounts: [META_PENDING], invoke: () => httpError(401, { code: 'RECONNECT_REQUIRED' }) });
  assert.ok(r.invoked.includes('meta-adaccounts'));
  assert.equal(r.nodes.connectionMessage.textContent, META.reconnect);

  r = await bootApp({ accounts: [META_PENDING], invoke: () => httpError(429, { code: 'RATE_LIMITED' }) });
  assert.equal(r.nodes.connectionMessage.textContent, META.rate);

  r = await bootApp({ accounts: [META_PENDING], invoke: () => httpError(500, { code: 'CREDENTIAL_LOOKUP_FAILED', error: '...' }) });
  assert.equal(r.nodes.connectionMessage.textContent, META.internal);
});

test('연결 관리: 광고계정 선택 실패는 서버 안내(권한 확인 불가)를 그대로 보여준다', async () => {
  const r = await bootApp({ accounts: [META_PENDING], invoke: (name) => name === 'meta-adaccounts'
    ? { data: { ok: true, ad_accounts: [{ id: 'act_1', name: '광고계정' }] }, error: null }
    : httpError(403, { error: '이 광고계정에 대한 접근 권한을 확인할 수 없습니다.' }) });
  r.nodes.metaAccountChoice.value = 'act_1';
  await r.nodes.chooseMetaAccount.events.click.call(r.nodes.chooseMetaAccount);
  await settle();
  assert.equal(r.nodes.connectionMessage.textContent, '이 광고계정에 대한 접근 권한을 확인할 수 없습니다.');
});

test('운영 현황: Meta 성과 조회 실패의 종류를 화면 상태에 함께 넘긴다', async () => {
  const r = await bootApp({ accounts: [META_CONNECTED], invoke: () => httpError(429, { code: 'RATE_LIMITED' }) });
  assert.ok(r.invoked.includes('meta-insights'));
  assert.equal(r.ctx.metaData.error, true);
  assert.deepEqual({ ...r.ctx.metaData.notice }, { kind: 'rate_limited', message: META.rate });
});

test('운영 현황 주문 동기화: 앱 권한 해제 · 동기화 기록 저장 실패 · 서버 오류를 나눠 안내한다', async () => {
  const cases = [
    [httpError(401, { code: 'RECONNECT_REQUIRED', reason: 'CAFE24_API_UNAUTHORIZED' }), CAFE.api],
    [httpError(401, { code: 'RECONNECT_REQUIRED' }), CAFE.reconnect],
    [httpError(503, { ok: false, code: 'SYNC_CURSOR_SAVE_FAILED' }), CAFE.cursor],
    [httpError(500, { error: 'Cafe24 주문 동기화 중 오류가 발생했습니다.' }), CAFE.internal],
  ];
  for (const [response, expected] of cases) {
    const r = await bootApp({ accounts: [CAFE_ROW], invoke: (name) => (name === 'cafe24-orders-sync' ? response : { data: null, error: null }) });
    await r.nodes.refresh.events.click.call(r.nodes.refresh);
    await settle();
    assert.ok(r.invoked.includes('cafe24-orders-sync'));
    assert.equal(r.nodes.pageMessage.textContent, expected);
  }
});

// ---------------------------------------------------------------- sales.js
function node(tag) {
  return { tagName: tag, children: [], value: '', hidden: false, disabled: false, textContent: '', className: '', dataset: {}, events: {},
    classList: { toggle() {}, add() {}, remove() {} },
    get parentElement() { return this._parent || (this._parent = node('parent')); },
    append(...a) { this.children.push(...a); }, appendChild(c) { this.children.push(c); return c; }, replaceChildren(...a) { this.children = a; },
    setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; }, querySelector() { return null; } };
}
const texts = (n) => [n.textContent, ...(n.children || []).flatMap(texts)].filter(Boolean);
async function bootSales({ invoke, metaAccount = null, metaData = null }) {
  const ids = {};
  const q = { select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, then(ok, fail) { return Promise.resolve({ data: [], error: null }).then(ok, fail); } };
  const ctx = { userId: 'u1', storeId: '4', period: { kind: 'today', date: null }, connectionsLoaded: true, stores: [{ id: '4' }], fx: null,
    cafeAccount: { status: 'connected' }, metaAccount, metaData, client: { from: () => q, functions: { invoke: async () => invoke() } } };
  const document = { getElementById: (id) => ids[id] || (ids[id] = node(id)), createElement: node, createTextNode: (t) => ({ textContent: t }), querySelector: () => null, querySelectorAll: () => [] };
  const app = { getContext: () => ctx, subscribe: (fn) => fn(ctx), setFx() {}, showView() {} };
  const window = { LaunchRoasApp: app, LaunchRoasCore: core, addEventListener() {}, dispatchEvent() {} };
  const sandbox = { window, document, console, Promise, Date, Math, JSON, Intl, setTimeout, clearTimeout, CustomEvent: class { constructor(n, o) { this.detail = o && o.detail; } } };
  sandbox.globalThis = sandbox; vm.createContext(sandbox);
  for (const f of ['ops-period-core.js', 'margin-calc.js', 'sales-core.js', 'sales.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), sandbox, { filename: f });
  await settle();
  return ids;
}

test('실제 판매: Cafe24 주문 상품 조회 실패의 종류를 안내하고, 수량을 0으로 보지 말라는 안내는 유지한다', async () => {
  let ids = await bootSales({ invoke: () => httpError(401, { code: 'RECONNECT_REQUIRED', reason: 'CAFE24_API_UNAUTHORIZED' }) });
  assert.ok(texts(ids.salesFigures).includes(CAFE.api + ' 판매 수량을 0개로 보지 마세요.'), texts(ids.salesFigures).join(' | '));
  ids = await bootSales({ invoke: () => httpError(503, { code: 'REFRESH_RETRYABLE' }) });
  assert.ok(texts(ids.salesFigures).includes(CAFE.temporary + ' 판매 수량을 0개로 보지 마세요.'));
});

test('광고비 카드: Meta 조회 실패 안내에 오류 종류 문구를 쓰고 "0건이 아닙니다"는 유지한다', async () => {
  const ids = await bootSales({ invoke: () => ({ data: { ok: true, orders: [] }, error: null }),
    metaAccount: { status: 'connected' }, metaData: { error: true, notice: { kind: 'permission', message: META.permission } } });
  assert.equal(ids.adSpend.textContent, '조회 실패');
  assert.match(ids.adNote.textContent, new RegExp(META.permission.replace(/[()]/g, '\\$&') + ' 0건이 아닙니다\\.'));
});

// ---------------------------------------------------------------- calculator.js
test('상품별 마진 설정: Cafe24 상품 조회 실패의 종류를 안내한다', async () => {
  const nodes = {};
  const q = { select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, then(ok, fail) { return Promise.resolve({ data: [], error: null }).then(ok, fail); } };
  const ctx = { client: { from: () => q, functions: { invoke: async () => httpError(401, { code: 'RECONNECT_REQUIRED' }) } }, userId: 'u', storeId: '4', cafeAccount: { status: 'connected' } };
  const document = { getElementById(id) { if (!nodes[id]) { nodes[id] = el('x'); } return nodes[id]; }, createElement: el, querySelectorAll() { return []; } };
  const sandbox = { document, Intl, Date, Math, Number, String, JSON, Promise, Object, Array, setTimeout, console, addEventListener() {}, dispatchEvent() {}, CustomEvent: function () {} };
  sandbox.window = sandbox;
  sandbox.LaunchRoasApp = { subscribe(fn) { fn(ctx); }, getContext() { return ctx; } };
  sandbox.LaunchRoasCore = core;
  vm.createContext(sandbox);
  for (const f of ['margin-calc.js', 'ops-period-core.js', 'sales-core.js', 'calculator.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), sandbox, { filename: f });
  await settle();
  nodes.pmPick.events.click(); await settle();
  assert.equal(nodes.pmList.textContent, CAFE.reconnect);
});

// ---------------------------------------------------------------- ad-performance.js
async function bootAdPerformance(invoke) {
  const list = node('div'), message = node('p'), more = node('button');
  const ctx = { client: { from: () => ({ select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, then(ok) { return Promise.resolve({ data: [], error: null }).then(ok); } }), functions: { invoke: async (name, o) => invoke(o.body) } },
    userId: 'user', storeId: 'store', metaAccount: { id: 'meta', status: 'connected' }, period: { kind: 'today', date: null } };
  const document = { getElementById(id) { return id === 'adPerformanceList' ? list : id === 'adPerformanceMore' ? more : message; }, createElement: node };
  vm.runInNewContext(fs.readFileSync(__dirname + '/ad-performance.js', 'utf8'), { window: { LaunchRoasApp: { subscribe(fn) { fn(ctx); }, getContext() { return ctx; } }, LaunchRoasCore: core, addEventListener() {}, dispatchEvent() {}, LaunchRoasSales: require('./sales-core.js') },
    document, Intl, Number, Date, Math, String, Promise, CustomEvent: function () {} });
  await settle();
  return { list, message };
}
const find = (n, cls) => (String(n.className || '').split(' ').includes(cls) ? n : (n.children || []).map((c) => find(c, cls)).find(Boolean));

test('광고별 성과: 광고 세트 목록 오류는 종류별로 안내하고, 요청 한도 · 서버 오류에 재연결을 권하지 않는다', async () => {
  for (const [response, expected] of [
    [httpError(429, { code: 'RATE_LIMITED' }), META.rate],
    [httpError(500, { code: 'INTERNAL_ERROR' }), META.internal],
    [httpError(401, { code: 'RECONNECT_REQUIRED' }), META.reconnect],
    [networkError(), META.temporary],
  ]) {
    const r = await bootAdPerformance(() => response);
    assert.equal(r.message.textContent, expected);
  }
});

test('광고별 성과: 광고 보기(개별 광고) 오류도 종류별로 안내한다', async () => {
  const r = await bootAdPerformance((body) => (body.scope === 'adsets'
    ? { data: { ok: true, account: { currency: 'KRW' }, campaigns: [{ campaign_name: 'C', adsets: [{ adset_id: '1', adset_name: 'A', metrics: { spend: 1000 } }] }] }, error: null }
    : httpError(403, { code: 'PERMISSION_REQUIRED' })));
  const row = r.list.children[0];
  await find(row, 'adset-toggle').events.click();
  assert.equal(find(row, 'adset-details').textContent, META.permission);
});
