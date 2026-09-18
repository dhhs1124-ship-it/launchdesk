/* STEP 진행 저장(user_step_progress) 동기화 회귀 테스트 — 실행: node --test tests/
   (Node 18+ 내장 test runner, 별도 패키지 없음)

   재현하는 버그: 로그인·새로고침·세션 복원(hydrate)만으로 app.js 컨트롤러가
   restore()→evaluate()→setChapterDone()→store.setStepState()를 다시 타면서
   STEP01~07 row 7건이 그대로 다시 upsert되고(손대지 않은 STEP엔 빈 row가
   생기고) completed_at이 로그인 시각으로 덮어써지던 문제.

   실제 store.js + app.js 소스를 vm 샌드박스(최소 DOM 스텁 + 가짜 Supabase +
   가짜 타이머)에서 그대로 실행한다 — 별도 헬퍼가 아니라 진짜 코드 경로
   (컨트롤러 이벤트 리스너, setChapterDone, hydrate, 게스트 병합)를 지난다.
   체크리스트/워크시트 개수는 index.html에서 읽어 실제 DOM 구조와 맞춘다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'store.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const STEP_PATHS = ['/start/prepare', '/start/setup', '/start/sourcing', '/start/content', '/start/orders', '/start/marketing-setup', '/start/marketing'];
const WORKSHEET_PATH = '/start/prepare';
const SESSION = { user: { id: 'u1', email: 'tester@example.com' } };
const DONE_TOAST = '챕터를 완료했어요 🎉';

// ---------------------------------------------------------------- DOM 스텁
function makeEl(tag){
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, classes: new Set(), style: {}, listeners: {},
    hidden: false, textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    offsetWidth: 0, offsetParent: null, parentElement: null, firstElementChild: null,
    getAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v){ this.attrs[n] = String(v); },
    hasAttribute(n){ return Object.prototype.hasOwnProperty.call(this.attrs, n); },
    addEventListener(type, fn){ (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(){},
    dispatch(type){
      const ev = { type, target: this, currentTarget: this, defaultPrevented: false, button: 0, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){} };
      (this.listeners[type] || []).slice().forEach(fn => fn.call(this, ev));
      return ev;
    },
    click(){ return this.dispatch('click'); },
    focus(){}, blur(){}, remove(){}, reset(){}, scrollIntoView(){},
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; }, matches(){ return false; },
    getBoundingClientRect(){ return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
  el.classList = {
    add(c){ el.classes.add(c); }, remove(c){ el.classes.delete(c); }, contains(c){ return el.classes.has(c); },
    toggle(c, force){ const on = (force === undefined) ? !el.classes.has(c) : !!force; if(on) el.classes.add(c); else el.classes.delete(c); return on; }
  };
  return el;
}
function makeChecklistBlock(stepPath, count){
  const block = makeEl('div');
  block.attrs['data-chapter'] = stepPath;
  block.classes.add('checklist-block');
  const countEl = makeEl('span');
  const boxes = [];
  for(let i = 0; i < count; i++){
    const row = makeEl('label'); row.classes.add('cl-row');
    const box = makeEl('input'); box.type = 'checkbox'; box.parentElement = row;
    box.closest = sel => (sel === '.cl-row' ? row : null);
    boxes.push(box);
  }
  block.querySelectorAll = sel => {
    if(sel === '.cl-row input[type="checkbox"]') return boxes.slice();
    if(sel === '.cl-row input:checked') return boxes.filter(b => b.checked);
    return [];
  };
  block.querySelector = sel => (sel === '.count' ? countEl : null);
  return { block, boxes, countEl };
}
function makeWorksheet(stepPath, count){
  const ws = makeEl('div');
  ws.attrs['data-chapter'] = stepPath;
  const inputs = [];
  for(let i = 0; i < count; i++) inputs.push(makeEl('input'));
  ws.querySelectorAll = sel => (sel === '.worksheet-input' ? inputs.slice() : []);
  return { ws, inputs };
}
// index.html의 실제 필수 체크리스트/워크시트 구조(data-chapter 블록 안의 체크박스 수,
// .worksheet-input 수)를 읽어 픽스처를 만든다 — 개수가 바뀌면 이 테스트도 같이 알아챈다.
function buildFixture(){
  const blocks = {};
  const re = /<div class="checklist-block[^"]*" data-chapter="([^"]+)">/g;
  let m;
  while((m = re.exec(INDEX_HTML))){
    const next = INDEX_HTML.indexOf('<div class="checklist-block', m.index + 10);
    const chunk = INDEX_HTML.slice(m.index, next < 0 ? INDEX_HTML.length : next);
    blocks[m[1]] = makeChecklistBlock(m[1], (chunk.match(/<input type="checkbox"/g) || []).length);
  }
  const wsStart = INDEX_HTML.search(/class="worksheet[^"]*"[^>]*data-chapter="\/start\/prepare"/);
  const wsEnd = INDEX_HTML.indexOf('<section class="view"', wsStart);
  const wsChunk = INDEX_HTML.slice(wsStart, wsEnd < 0 ? INDEX_HTML.length : wsEnd);
  const worksheets = {};
  worksheets[WORKSHEET_PATH] = makeWorksheet(WORKSHEET_PATH, (wsChunk.match(/class="worksheet-input[^"]*"/g) || []).length);
  return { blocks, worksheets };
}
function makeDocument(fixture){
  const byId = new Map();
  return {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null,
    getElementById(id){ if(!byId.has(id)) byId.set(id, makeEl('div')); return byId.get(id); },
    createElement(tag){ return makeEl(tag); },
    querySelector(sel){
      let mm;
      if((mm = sel.match(/^\.checklist-block\[data-chapter="([^"]+)"\]$/))) return fixture.blocks[mm[1]] ? fixture.blocks[mm[1]].block : null;
      if((mm = sel.match(/^\.worksheet\[data-chapter="([^"]+)"\]$/))) return fixture.worksheets[mm[1]] ? fixture.worksheets[mm[1]].ws : null;
      return null;
    },
    querySelectorAll(sel){
      if(sel === '.worksheet[data-chapter]') return Object.keys(fixture.worksheets).map(k => fixture.worksheets[k].ws);
      if(sel === '.checklist-block[data-chapter]' || sel === '.checklist-block') return Object.keys(fixture.blocks).map(k => fixture.blocks[k].block);
      return [];
    },
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
    runAll(){ let guard = 0; while(pending.size && guard++ < 50){ const fns = Array.from(pending.values()); pending.clear(); fns.forEach(fn => fn()); } },
    get size(){ return pending.size; }
  };
}

// ---------------------------------------------------------- 가짜 Supabase
// 실제 네트워크 없음. user_step_progress는 step_path별 row 맵으로 들고,
// upsert는 기록과 동시에 그 맵에 반영해 뒤이은 hydrate가 최신 row를 읽게 한다.
function makeSupabase(initialRows, session){
  const db = { rows: new Map(), upserts: [], inserts: [], selects: [], calls: [] };
  initialRows.forEach(r => db.rows.set(r.step_path, Object.assign({ user_id: 'u1' }, r)));
  let authCb = null;
  function chain(table){
    let op = null;
    const q = {};
    q.select = cols => { db.selects.push({ table, cols }); return q; };
    ['eq', 'order', 'limit', 'maybeSingle'].forEach(mth => { q[mth] = () => q; });
    q.upsert = (payload, opts) => {
      op = 'upsert';
      const copy = JSON.parse(JSON.stringify(payload));
      db.upserts.push({ table, payload: copy, opts });
      if(table === 'user_step_progress') db.rows.set(copy.step_path, Object.assign({}, db.rows.get(copy.step_path) || {}, copy));
      return q;
    };
    q.insert = payload => { op = 'insert'; db.inserts.push({ table, payload }); return q; };
    q.delete = () => { op = 'delete'; return q; };
    function result(){
      if(op) return { data: null, error: null };
      if(table === 'user_step_progress'){
        return { data: Array.from(db.rows.values()).map(r => ({ step_path: r.step_path, data: r.data, is_completed: r.is_completed, completed_at: r.completed_at === undefined ? null : r.completed_at })), error: null };
      }
      return { data: [], error: null };
    }
    q.then = (res, rej) => Promise.resolve().then(result).then(res, rej);
    q.catch = rej => q.then(undefined, rej);
    return q;
  }
  const sb = {
    from(table){ db.calls.push(table); return chain(table); },
    auth: {
      getSession(){ return Promise.resolve({ data: { session: session || null } }); },
      onAuthStateChange(cb){ authCb = cb; },
      signInWithPassword(){ return Promise.resolve({ data: {}, error: null }); },
      signOut(){ return Promise.resolve({}); }
    }
  };
  return { sb, db, emitAuth(event, sess){ return authCb(event, sess); } };
}

// ---------------------------------------------------------------- 부팅
async function settle(n){ for(let i = 0; i < (n || 40); i++) await new Promise(r => setImmediate(r)); }
async function boot(opts){
  opts = opts || {};
  const fixture = buildFixture();
  const rows = typeof opts.rows === 'function' ? opts.rows(fixture) : (opts.rows || []);
  const doc = makeDocument(fixture);
  const timers = makeTimers();
  const supa = makeSupabase(rows, opts.session || null);
  const env = { fixture, doc, timers, supa, db: supa.db, warns: [], errors: [], ga: [], confirms: [], confirmAnswer: true };
  const sandbox = {
    console: { log(){}, info(){}, warn(){ env.warns.push(Array.from(arguments).join(' ')); }, error(){ env.errors.push(Array.from(arguments).join(' ')); } },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(fn){ fn(0); return 1; }, cancelAnimationFrame(){},
    URLSearchParams, document: doc,
    location: { hash: '', origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' },
    history: { replaceState(){}, back(){}, forward(){} },
    localStorage: memStorage(), sessionStorage: memStorage(),
    matchMedia(){ return { matches: false }; }, scrollTo(){}, addEventListener(){}, removeEventListener(){},
    confirm(msg){ env.confirms.push(msg); return env.confirmAnswer; }, alert(){},
    gtag(){ env.ga.push(Array.from(arguments)); },
    launchdeskSupabase: supa.sb
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(STORE_SRC, sandbox, { filename: 'store.js' }); // index.html 로드 순서와 동일: store.js → app.js
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' });
  env.sandbox = sandbox;
  env.store = sandbox.launchdeskStore;
  env.toastStack = doc.getElementById('toastStack');
  await settle();
  return env;
}
async function flush(env){ await settle(); env.timers.runAll(); await settle(); }
function stepUpserts(env){ return env.db.upserts.filter(u => u.table === 'user_step_progress').map(u => u.payload); }
function toastCount(env, text){ return env.toastStack.children.filter(c => c.textContent === text).length; }
function chapterCompletes(env){ return env.ga.filter(a => a[0] === 'event' && a[1] === 'chapter_complete').map(a => a[2].chapter_path); }
async function sessionRestore(env){ env.supa.emitAuth('SIGNED_IN', SESSION); await flush(env); }
async function freshLogin(env){
  env.doc.getElementById('loginForm').dispatch('submit'); // app.js가 pendingFreshLogin을 세우는 실제 경로
  await settle();
  env.supa.emitAuth('SIGNED_IN', SESSION);
  await flush(env);
}
function setInput(inp, value){ inp.value = value; inp.dispatch('input'); }
function setBox(box, checked){ box.checked = checked; box.dispatch('change'); }
function indices(n){ const a = []; for(let i = 0; i < n; i++) a.push(i); return a; }
function completedRows(fixture, at){
  const rows = STEP_PATHS.map(p => p === WORKSHEET_PATH
    ? { step_path: p, data: { 0: 'a', 1: 'b', 2: 'c', 3: 'd', 4: 'e' }, is_completed: true, completed_at: at }
    : { step_path: p, data: indices(fixture.blocks[p].boxes.length), is_completed: true, completed_at: at });
  return rows;
}

// ------------------------------------------------------------------ 테스트
test('픽스처가 index.html의 실제 필수 항목 수와 일치한다 (01:5 워크시트, 02:7 03:6 04:5 05:4 06:1 07:2)', () => {
  const fx = buildFixture();
  assert.equal(fx.worksheets[WORKSHEET_PATH].inputs.length, 5);
  assert.deepEqual(STEP_PATHS.filter(p => p !== WORKSHEET_PATH).map(p => fx.blocks[p].boxes.length), [7, 6, 5, 4, 1, 2]);
});

test('게스트: 체크·입력해도 원격 DB 호출이 전혀 없다', async () => {
  const env = await boot();
  const setup = env.fixture.blocks['/start/setup'];
  setup.boxes.forEach(b => setBox(b, true));
  setInput(env.fixture.worksheets[WORKSHEET_PATH].inputs[0], '게스트 입력');
  await flush(env);
  assert.equal(env.store.isAuthed(), false);
  assert.equal(env.store.isStepCompleted('/start/setup'), true);
  assert.equal(stepUpserts(env).length, 0);
  assert.equal(env.db.calls.includes('user_step_progress'), false);
  assert.equal(toastCount(env, DONE_TOAST), 1);
});

test('A. STEP01~07 완료 row가 있는 회원의 세션 복원(새로고침) → upsert 0건, completed_at 유지', async () => {
  const T0 = '2026-08-01T09:00:00.000Z';
  const env = await boot({ rows: fx => completedRows(fx, T0), session: SESSION });
  await flush(env);
  assert.equal(env.store.isAuthed(), true);
  assert.equal(env.store.getCompletedPaths().length, 7);
  assert.equal(env.fixture.blocks['/start/setup'].boxes.every(b => b.checked), true, '서버 값이 화면에 복원된다');
  assert.deepEqual(stepUpserts(env), [], 'hydrate 뒤 컨트롤러 재평가만으로는 쓰지 않는다');
  STEP_PATHS.forEach(p => { assert.equal(env.db.rows.get(p).completed_at, T0); assert.equal(env.store.getStepCompletedAt(p), T0); });
  assert.match(env.db.selects.find(s => s.table === 'user_step_progress').cols, /completed_at/, 'hydrate가 completed_at을 읽어 둔다');
  assert.equal(toastCount(env, DONE_TOAST), 0);
  assert.deepEqual(chapterCompletes(env), []);
});

test('A-2. 게스트 데이터 없이 로그인(SIGNED_IN, fresh) → 마이그레이션·병합 프롬프트 없음, upsert 0건', async () => {
  const T0 = '2026-08-01T09:00:00.000Z';
  const env = await boot({ rows: fx => completedRows(fx, T0) });
  await freshLogin(env);
  assert.equal(env.store.isAuthed(), true);
  assert.deepEqual(env.confirms, []);
  assert.deepEqual(stepUpserts(env), []);
  STEP_PATHS.forEach(p => assert.equal(env.db.rows.get(p).completed_at, T0));
});

test('B. 일부 STEP row만 있는 회원 → 없는 STEP에 빈 row 생성 0건, 같은 row 재upsert 0건 (옛 저장 순서·누락 키도 "같은 내용")', async () => {
  const T0 = '2026-08-01T09:00:00.000Z';
  const env = await boot({
    rows: [
      { step_path: '/start/setup', data: [6, 0, 3, 1, 5, 2, 4], is_completed: true, completed_at: T0 }, // 순서만 다른 옛 배열
      { step_path: WORKSHEET_PATH, data: { 0: '타겟', 1: '상품' }, is_completed: false, completed_at: null },  // 누락 키가 있는 옛 워크시트
      { step_path: '/start/sourcing', data: [2, 0], is_completed: false, completed_at: null }
    ],
    session: SESSION
  });
  await flush(env);
  assert.deepEqual(stepUpserts(env), []);
  assert.deepEqual(Array.from(env.db.rows.keys()).sort(), ['/start/prepare', '/start/setup', '/start/sourcing']);
  assert.equal(env.store.isStepCompleted('/start/setup'), true);
  assert.equal(env.store.isStepCompleted('/start/content'), false);
  assert.deepEqual(Array.from(env.store.getStepData('/start/content')), [], '메모리는 화면 기준으로 채워지되 DB row는 만들지 않는다'); // 샌드박스 realm 배열이라 Array.from으로 비교
  assert.equal(env.fixture.worksheets[WORKSHEET_PATH].inputs[1].value, '상품');
});

test('C. STEP04 구버전 row(data [0,1,2,3], 완료) → 현재 5개 기준 미완료로 재평가, 그 row에만 정정 upsert 1건', async () => {
  const T0 = '2026-08-01T09:00:00.000Z';
  const env = await boot({
    rows: fx => completedRows(fx, T0).map(r => r.step_path === '/start/content' ? Object.assign(r, { data: [0, 1, 2, 3] }) : r),
    session: SESSION
  });
  await flush(env);
  const ups = stepUpserts(env);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].step_path, '/start/content');
  assert.equal(ups[0].is_completed, false);
  assert.equal(ups[0].completed_at, null);
  assert.deepEqual(ups[0].data, [0, 1, 2, 3], '저장값 자체는 그대로 두고 완료 여부만 정정한다');
  assert.equal(env.fixture.blocks['/start/content'].boxes.filter(b => b.checked).length, 4);
  assert.equal(env.store.isStepCompleted('/start/content'), false);
  assert.equal(env.store.getCompletedPaths().length, 6);
  STEP_PATHS.filter(p => p !== '/start/content').forEach(p => assert.equal(env.db.rows.get(p).completed_at, T0, p + '은 손대지 않는다'));
  assert.deepEqual(chapterCompletes(env), []);
});

test('D. 로그인 회원이 체크박스 1개 변경 → 해당 STEP만 upsert, 다른 STEP write 0건', async () => {
  const T0 = '2026-08-01T09:00:00.000Z';
  const env = await boot({ rows: fx => completedRows(fx, T0), session: SESSION });
  await flush(env);
  const sourcing = env.fixture.blocks['/start/sourcing'];
  setBox(sourcing.boxes[0], false);
  await flush(env);
  let ups = stepUpserts(env);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].step_path, '/start/sourcing');
  assert.equal(ups[0].is_completed, false);
  assert.equal(ups[0].completed_at, null);
  assert.deepEqual(ups[0].data, [1, 2, 3, 4, 5]);
  setBox(sourcing.boxes[0], true);
  await flush(env);
  ups = stepUpserts(env);
  assert.equal(ups.length, 2);
  assert.equal(ups[1].step_path, '/start/sourcing');
  assert.equal(ups[1].is_completed, true);
  assert.ok(ups[1].completed_at && ups[1].completed_at !== T0, '미완료를 거쳐 다시 완료되면 새 완료 시각');
  assert.deepEqual(ups.map(u => u.step_path), ['/start/sourcing', '/start/sourcing']);
  STEP_PATHS.filter(p => p !== '/start/sourcing').forEach(p => assert.equal(env.db.rows.get(p).completed_at, T0));
  assert.deepEqual(chapterCompletes(env), ['/start/sourcing'], '기존 정책: 해제 후 다시 완료하면 완료 이벤트가 다시 난다');
  assert.equal(toastCount(env, DONE_TOAST), 1);
});

test('E/F. 워크시트: 최초 완료 때만 completed_at 생성, 완료 유지 중 수정은 시각 보존, blur 즉시 저장 유지, 완료→미완료→완료', async () => {
  const env = await boot({
    rows: [{ step_path: WORKSHEET_PATH, data: { 0: 'a', 1: 'b', 2: 'c', 3: 'd', 4: '' }, is_completed: false, completed_at: null }],
    session: SESSION
  });
  await flush(env);
  assert.deepEqual(stepUpserts(env), [], '미완료 row 복원만으로는 쓰지 않는다');
  const inputs = env.fixture.worksheets[WORKSHEET_PATH].inputs;

  // E-1 미완료 → 완료: completed_at 생성, 토스트·chapter_complete 1회
  setInput(inputs[4], 'e');
  await flush(env);
  let ups = stepUpserts(env);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].is_completed, true);
  const T1 = ups[0].completed_at;
  assert.ok(T1, '최초 완료 시각이 기록된다');
  assert.equal(toastCount(env, DONE_TOAST), 1);
  assert.deepEqual(chapterCompletes(env), [WORKSHEET_PATH]);

  // E-2 완료 상태에서 내용만 수정: 저장은 되지만 completed_at은 그대로
  setInput(inputs[1], 'bb');
  await flush(env);
  ups = stepUpserts(env);
  assert.equal(ups.length, 2);
  assert.equal(ups[1].is_completed, true);
  assert.equal(ups[1].completed_at, T1, '완료가 이어지는 동안 최초 완료 시각을 덮어쓰지 않는다');
  assert.equal(ups[1].data[1], 'bb');
  assert.equal(toastCount(env, DONE_TOAST), 1);
  assert.equal(chapterCompletes(env).length, 1);

  // E-3 바뀐 게 없는 blur: 쓰지 않는다
  inputs[1].dispatch('blur');
  await settle();
  assert.equal(stepUpserts(env).length, 2);

  // E-4 입력 직후 blur: debounce를 기다리지 않고 즉시 저장(기존 동작), 시각 보존
  setInput(inputs[2], 'cc');
  inputs[2].dispatch('blur');
  await settle();
  ups = stepUpserts(env);
  assert.equal(ups.length, 3, 'blur가 예약된 저장을 즉시 실행한다');
  assert.equal(ups[2].completed_at, T1);
  assert.equal(env.timers.size, 0, '예약 타이머가 남지 않는다');

  // F 완료 → 미완료 → 다시 완료
  setInput(inputs[0], '');
  await flush(env);
  ups = stepUpserts(env);
  assert.equal(ups.length, 4);
  assert.equal(ups[3].is_completed, false);
  assert.equal(ups[3].completed_at, null, '완료→미완료면 null');
  assert.equal(env.store.isStepCompleted(WORKSHEET_PATH), false);
  setInput(inputs[0], 'a2');
  await flush(env);
  ups = stepUpserts(env);
  assert.equal(ups.length, 5);
  assert.equal(ups[4].is_completed, true);
  assert.ok(ups[4].completed_at && ups[4].completed_at >= T1, '다시 완료되면 새 완료 시각을 찍는다');
  assert.equal(toastCount(env, DONE_TOAST), 2, '기존 정책: 다시 완료되면 토스트가 다시 뜬다');
  assert.deepEqual(chapterCompletes(env), [WORKSHEET_PATH, WORKSHEET_PATH], '기존 정책: chapter_complete도 다시 난다');
  assert.equal(ups.every(u => u.step_path === WORKSHEET_PATH), true, '다른 STEP write 0건');
});

test('G. 게스트 입력 후 로그인 병합 → 선택한 병합 결과만 저장, 빈 STEP row 추가 생성 없음', async () => {
  const env = await boot();
  const setup = env.fixture.blocks['/start/setup'];
  [0, 1, 2].forEach(i => setBox(setup.boxes[i], true));
  await flush(env);
  assert.equal(stepUpserts(env).length, 0);
  await freshLogin(env);
  assert.equal(env.confirms.length, 1, '병합 확인 1회(레거시 localStorage 없음)');
  const ups = stepUpserts(env);
  assert.equal(ups.length, 1, '병합 upsert 1건 뒤 재hydrate·재평가로 추가 write가 없다');
  assert.equal(ups[0].step_path, '/start/setup');
  assert.deepEqual(ups[0].data, [0, 1, 2]);
  assert.equal(ups[0].is_completed, false);
  assert.equal(ups[0].completed_at, null);
  assert.deepEqual(Array.from(env.db.rows.keys()), ['/start/setup']);
  assert.equal(env.store.isAuthed(), true);
  assert.deepEqual(env.store.getStepData('/start/setup'), [0, 1, 2]);
  assert.equal(toastCount(env, '로그인 전 작성한 내용을 계정에 저장했어요'), 1);
});

test('G-2. 서버에 이미 완료된 STEP과 게스트 체크를 병합해도 최초 completed_at을 유지한다', async () => {
  const T0 = '2026-08-01T09:00:00.000Z';
  const env = await boot({ rows: fx => [{ step_path: '/start/setup', data: indices(fx.blocks['/start/setup'].boxes.length), is_completed: true, completed_at: T0 }] });
  [0, 1, 2].forEach(i => setBox(env.fixture.blocks['/start/setup'].boxes[i], true));
  await freshLogin(env);
  const ups = stepUpserts(env);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].step_path, '/start/setup');
  assert.equal(ups[0].is_completed, true);
  assert.equal(ups[0].completed_at, T0);
  assert.equal(env.db.rows.get('/start/setup').completed_at, T0);
});

test('G-3. 병합을 거절하면 write 0건이고 빈 row도 생기지 않는다', async () => {
  const env = await boot();
  env.confirmAnswer = false;
  [0, 1].forEach(i => setBox(env.fixture.blocks['/start/setup'].boxes[i], true));
  await freshLogin(env);
  assert.equal(env.confirms.length, 1);
  assert.deepEqual(stepUpserts(env), []);
  assert.equal(env.db.rows.size, 0);
  assert.equal(env.store.isAuthed(), true);
  assert.equal(env.fixture.blocks['/start/setup'].boxes.some(b => b.checked), false, '거절하면 계정(빈) 상태로 화면이 맞춰진다');
});
