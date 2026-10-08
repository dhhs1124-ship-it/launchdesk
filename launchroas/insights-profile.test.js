/* 주간 AI 점검 칸의 점검 기준(사업 정보) 불러오기 · 저장 · 지우기 — 가짜 DOM · 가짜 DB(조건 · 정렬 · 상한을 실제처럼 적용)로 검증한다.
   실행: node --test launchroas/insights-profile.test.js
   2026-10-08 검토 보완: 조회 상한(20건) 밖 기록 때문에 이 쇼핑몰 기준을 못 찾거나, 지우기 · 저장 뒤 예전 기록이 다시 나타나지 않게. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function node(tag){
  return { tagName: String(tag).toUpperCase(), children: [], value: '', checked: false, hidden: false, disabled: false, open: false, textContent: '', className: '', events: {},
    append(...a){ this.children.push(...a); }, appendChild(c){ this.children.push(c); return c; }, replaceChildren(...a){ this.children = a; },
    setAttribute(k, v){ this[k] = v; }, addEventListener(k, fn){ this.events[k] = fn; } };
}
const settle = async () => { for(let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const all = (n) => [n, ...((n && n.children) || []).flatMap(all)];
const find = (root, pred) => all(root).find((n) => n && pred(n));

// 가짜 DB — PostgREST처럼 조건(eq · neq · in, data->>키 포함) → 정렬 → 상한
const get = (r, col) => (col.includes('->>') ? (r[col.split('->>')[0]] || {})[col.split('->>')[1]] : r[col]);
function exec(db, q){
  const rows = db.tool_records;
  const hit = rows.filter((r) => q.filters.every(([k, col, v]) => k === 'eq' ? String(get(r, col)) === String(v)
    : k === 'neq' ? String(get(r, col)) !== String(v) : k === 'in' ? v.map(String).includes(String(get(r, col)))
    : k === 'lt' ? String(get(r, col)) < String(v) : k === 'gt' ? String(get(r, col)) > String(v) : true));
  if(q.op === 'insert'){
    const row = { id: ++db.seq, created_at: new Date(Date.parse('2026-10-08T00:00:00Z') + db.seq).toISOString(), ...q.values };
    rows.push(row);
    return { data: q.mode === 'single' ? { id: row.id, created_at: row.created_at } : [row], error: null };
  }
  if(q.op === 'delete'){
    if(db.failDelete) return { data: null, error: { message: '모의 삭제 실패' } };
    db.tool_records = db.tool_records.filter((r) => !hit.includes(r)); return { data: null, error: null };
  }
  let out = hit.slice().sort((a, b) => { for(const [col, asc] of q.orders){ const c = String(a[col]).localeCompare(String(b[col])); if(c) return asc ? c : -c; } return 0; });
  if(q.limit != null) out = out.slice(0, q.limit);
  return { data: out, error: null };
}
function client(db, invoke){
  return {
    from(table){
      const q = { table, op: 'select', filters: [], orders: [], limit: null, values: null, mode: 'many' };
      const run = async () => exec(db, q);
      const f = (k) => (col, val) => { q.filters.push([k, col, val]); return b; };
      // supabase-js처럼: from() 다음에는 select · insert · delete만, 조건은 그 뒤에만 붙는다(순서가 틀리면 실제 화면에서 오류)
      const b = { select(){ return b; }, eq: f('eq'), neq: f('neq'), in: f('in'), lt: f('lt'), gt: f('gt'), order(col, opt){ q.orders.push([col, !(opt && opt.ascending === false)]); return b; },
        limit(n){ q.limit = n; return b; }, single(){ q.mode = 'single'; return run(); }, then(ok, bad){ return run().then(ok, bad); } };
      return { select(){ return b; }, insert(v){ q.op = 'insert'; q.values = v; return b; }, delete(){ q.op = 'delete'; return b; } };
    },
    // invoke(name, body)가 값을 돌려주면 그 응답을, 아니면 기본값(상태 조회 · 주문 조회 실패)을 쓴다
    functions: { invoke: async (name, opt) => (invoke && invoke(name, (opt && opt.body) || {})) || (name === 'ai-weekly-review'
      ? { data: { ok: true, enabled: true, quota: { can_run: true, used: false }, status: null, result: null } } : { data: { ok: false } }) },
  };
}
const profile = (id, store, objective, at) => ({ id, user_id: 'u1', tool_type: 'business_profile', created_at: at,
  data: { store_id: String(store), objective, target_roas_pct: 300, monthly_budget_cap_krw: null, cannot_change: [], saved_at: at } });
const stamp = (i) => new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60000).toISOString();

// insights.js 전체(순수 함수 + 화면)를 가짜 브라우저에서 실행하고, 매출 상태 이벤트로 주간 칸 · 점검 기준을 불러온다
async function open(db, storeId = '4', invoke){
  const ids = {}, listeners = {};
  const sandbox = { console, setTimeout, Promise, JSON, Date, Math, Number, String, Object, Array, Set, Map, Error,
    document: { getElementById: (id) => ids[id] || (ids[id] = node('div')), createElement: node },
    Option: function(text, value){ const o = node('option'); o.textContent = text; o.value = value; return o; },
    addEventListener: (t, fn) => (listeners[t] = listeners[t] || []).push(fn),
    LaunchRoasApp: { getContext: () => ({ storeId, userId: 'u1', client: client(db, invoke) }) }, LaunchRoasSales: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/insights.js', 'utf8'), sandbox);
  listeners['launchroas:sales-state'].forEach((fn) => fn({ detail: { ready: true, links: [], summary: {} } }));
  await settle();
  const body = ids.insightsBody;
  return {
    summary: () => (find(body, (n) => n.tagName === 'SUMMARY' && /점검 기준/.test(n.textContent)) || {}).textContent,
    hidden: () => ids.insights.hidden,
    text: () => all(body).map((n) => (n && n.textContent) || '').join(' '),
    click: async (label) => { find(body, (n) => n.tagName === 'BUTTON' && n.textContent === label).events.click(); await settle(); },
    press: (label) => find(body, (n) => n.tagName === 'BUTTON' && n.textContent === label).events.click(), // 기다리지 않음(동시 요청 재현)
    choose: (value) => { const s = find(body, (n) => n.tagName === 'SELECT'); s.value = value; s.events.change(); },
  };
}
const mine = (db, store) => db.tool_records.filter((r) => r.tool_type === 'business_profile' && r.data.store_id === store);

test('불러오기: 다른 쇼핑몰 기록이 조회 상한(20건)을 넘게 더 최근이어도 이 쇼핑몰 점검 기준을 찾는다(쇼핑몰을 쿼리에서 먼저 거름)', async () => {
  const db = { seq: 100, tool_records: [profile(1, '4', '판매', stamp(0)), ...Array.from({ length: 25 }, (_, i) => profile(10 + i, '5', '재구매', stamp(100 + i)))] };
  const ui = await open(db);
  assert.equal(ui.summary(), '점검 기준 · 사업 정보 (저장됨 · 판매 · 목표 ROAS 300%)');
});

test('지우기: 조회 상한 밖 예전 기록까지 이 쇼핑몰 것은 모두 지운다 — 다시 열어도 나타나지 않고 다른 쇼핑몰 기록은 그대로', async () => {
  const db = { seq: 100, tool_records: [...Array.from({ length: 30 }, (_, i) => profile(10 + i, '4', i === 29 ? '판매' : '재구매', stamp(i))),
    profile(90, '5', '판매', stamp(200)), profile(91, '5', '판매', stamp(201))] };
  const ui = await open(db);
  assert.match(ui.summary(), /저장됨 · 판매/);
  await ui.click('점검 기준 지우기');
  assert.equal(mine(db, '4').length, 0, '30건 모두 삭제(예전 방식은 불러온 20건만 지워 10건이 남았다)');
  assert.equal(mine(db, '5').length, 2);
  assert.equal((await open(db)).summary(), '점검 기준 · 사업 정보 (미입력 · 목표 기준 판단 안 함)');
});

test('저장: 새 기록 하나만 남기고 이 쇼핑몰의 예전 기록은 조회 상한 밖까지 지운다', async () => {
  const db = { seq: 100, tool_records: [...Array.from({ length: 30 }, (_, i) => profile(10 + i, '4', '재구매', stamp(i))), profile(90, '5', '판매', stamp(200))] };
  const ui = await open(db);
  ui.choose('브랜드 인지');
  await ui.click('점검 기준 저장');
  assert.deepEqual(mine(db, '4').map((r) => r.data.objective), ['브랜드 인지']);
  assert.equal(mine(db, '5').length, 1);
  assert.match((await open(db)).summary(), /저장됨 · 브랜드 인지/);
});

test('점검을 멈춘 이유가 보인다 — 사업 정보 · 실행 기록 확인 실패(서버가 점검하지 않음)여도 주간 칸을 숨기지 않고 서버 안내를 보여 준다', async () => {
  const db = { seq: 100, tool_records: [profile(1, '4', '판매', stamp(0))] };
  const ui = await open(db, '4', (name, body) => name === 'ai-weekly-review' && body.action === 'run'
    ? { data: { ok: false, status: 'failed', error: '사업 정보 · 실행 기록을 불러오지 못해 점검하지 않았어요. 이용 횟수는 차감되지 않았어요.', quota: { can_run: true, used: false }, result: null } }
    : null);
  await ui.click('이번 주 점검하기 →');
  assert.equal(ui.hidden(), false, '주간 칸이 보여야 이유를 안다');
  assert.match(ui.text(), /사업 정보 · 실행 기록을 불러오지 못해 점검하지 않았어요/);
  assert.match(ui.text(), /이번 주 점검하기/, '다시 시도할 수 있다(이용 횟수 차감 없음)');
});

// ---- 2026-10-08 4차 보완: 두 탭 동시 저장 · 정리 실패 안내 ----
test('두 탭 동시 저장: 서로의 새 기록을 지우지 않는다 — 더 늦게 저장한 기록이 남고, 조회 상한 밖 예전 기록은 정리', async () => {
  const db = { seq: 100, tool_records: Array.from({ length: 25 }, (_, i) => profile(10 + i, '4', '재구매', stamp(i))) };
  const a = await open(db), b = await open(db);
  a.choose('판매'); b.choose('브랜드 인지');
  a.press('점검 기준 저장'); b.press('점검 기준 저장'); // 두 저장이 겹친다: 삽입 A · 삽입 B → 정리 A · 정리 B
  await settle();
  const left = mine(db, '4');
  assert.equal(left.length, 1, '0건이 되면 안 된다(예전에는 서로의 새 기록을 지워 0건): ' + JSON.stringify(left.map((r) => r.data.objective)));
  assert.equal(left[0].data.objective, '브랜드 인지', '더 늦게 저장한 기록이 남는다');
});

test('저장 뒤 예전 기록 정리가 실패하면 알린다 — 새 기록은 저장됐고 다음 저장 때 다시 정리', async () => {
  const db = { seq: 100, failDelete: true, tool_records: [profile(10, '4', '재구매', stamp(0))] };
  const ui = await open(db);
  ui.choose('판매');
  await ui.click('점검 기준 저장');
  assert.match(ui.text(), /저장했어요 · 예전 기록 정리는 실패했어요/);
  assert.equal(mine(db, '4').length, 2, '새 기록 + 정리 못 한 예전 기록');
  assert.match(ui.summary(), /저장됨 · 판매/);
});
