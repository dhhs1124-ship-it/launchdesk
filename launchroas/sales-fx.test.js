/* 판매 화면(sales.js) 환율 저장 — 이전 기록 ID 고정 · 삭제를 기다린 뒤 유효성 재검사 · 삭제 실패 처리. 가짜 DOM · 가짜 DB(로컬 데이터)만 쓴다.
   실행: node --test launchroas/sales-fx.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function node(tag) {
  return { tagName: tag, children: [], value: '', hidden: false, disabled: false, textContent: '', className: '', dataset: {}, events: {},
    classList: { toggle() {}, add() {}, remove() {} },
    get parentElement() { return this._parent || (this._parent = node('parent')); },
    append(...a) { this.children.push(...a); }, appendChild(c) { this.children.push(c); return c; }, replaceChildren(...a) { this.children = a; },
    setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; }, querySelector() { return null; } };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

// fx: 처음 조회할 환율 기록(최신 먼저) · gates: { insert, delete } 각 호출을 막아 둘 deferred · results: 응답
function setup({ fx, deleteError }) {
  const ids = {}, calls = [], setFx = [], gates = { insert: null, delete: null }, subs = [];
  let ctx = { userId: 'u1', storeId: '4', period: { kind: 'today', date: null }, connectionsLoaded: true, cafeAccount: null, stores: [{ id: '4' }], fx: null };
  const from = (table) => {
    const f = { table, op: 'select' };
    const q = {
      select() { return q; }, eq(k, v) { f[k] = v; return q; }, order() { return q; }, limit() { return q; }, single() { return q; },
      in(k, v) { if (f.op === 'delete') f.ids = v; return q; },
      insert(row) { f.op = 'insert'; f.row = row; return q; }, delete() { f.op = 'delete'; return q; },
      then(ok, fail) {
        calls.push(f);
        if (f.op === 'select') return Promise.resolve({ data: (fx || []).map((r) => ({ id: r.id, tool_type: 'ad_fx_rate', data: r.data })), error: null }).then(ok, fail);
        const g = gates[f.op], res = f.op === 'insert' ? { data: { id: 'new-' + calls.length }, error: null } : { data: null, error: deleteError ? { message: '삭제 실패(테스트)' } : null };
        return (g ? g.p : Promise.resolve()).then(() => res).then(ok, fail);
      } };
    return q;
  };
  const client = { from, functions: { invoke: async () => ({ data: null, error: null }) } };
  ctx.client = client;
  const document = { getElementById: (id) => ids[id] || (ids[id] = node(id)), createElement: node, createTextNode: (t) => ({ textContent: t }), querySelector: () => null, querySelectorAll: () => [] };
  const app = { getContext: () => ctx, subscribe: (fn) => { subs.push(fn); fn(ctx); }, setFx: (v) => setFx.push(v), showView() {} };
  const window = { LaunchRoasApp: app, addEventListener() {}, dispatchEvent() {} };
  const sandbox = { window, document, console, Promise, Date, Math, JSON, Intl, setTimeout, clearTimeout, CustomEvent: class { constructor(n, o) { this.detail = o && o.detail; } } };
  sandbox.globalThis = sandbox; vm.createContext(sandbox);
  for (const f of ['ops-period-core.js', 'margin-calc.js', 'sales-core.js', 'sales.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), sandbox, { filename: f });
  const el = document.getElementById;
  const save = async (rate) => { el('salesFxRate').value = String(rate); el('salesFxCurrency').textContent = 'USD'; return el('salesFxSave').events.click.call(el('salesFxSave')); };
  const switchStore = (storeId) => { ctx = Object.assign({}, ctx, { storeId }); subs.forEach((fn) => fn(ctx)); };
  const reload = () => { ctx = Object.assign({}, ctx, { period: { kind: 'yesterday', date: null } }); subs.forEach((fn) => fn(ctx)); };
  return { ids, el, calls, setFx, gates, save, switchStore, reload, deletes: () => calls.filter((c) => c.op === 'delete') };
}
const FX = (id, rate) => ({ id, data: { store_id: '4', currency: 'USD', krw_per_unit: rate, saved_at: '2026-10-01T00:00:00Z' } });

test('정상: 새 환율 저장 뒤 이 쇼핑몰의 이전 환율 기록을 지우고 적용한다', async () => {
  const s = setup({ fx: [FX('old1', 1300)] });
  await settle();
  await s.save(1400); await settle();
  assert.deepEqual([...s.deletes()[0].ids], ['old1']);
  assert.equal(s.el('salesFxNote').textContent, '환율을 저장했어요.');
  assert.equal(s.setFx.at(-1).krw_per_unit, 1400);
});

test('이전 기록 삭제를 기다리는 사이 쇼핑몰을 바꾸면 결과를 화면에 적용하지 않는다(삭제 뒤에도 다시 검사)', async () => {
  const s = setup({ fx: [FX('old1', 1300)] });
  await settle();
  s.gates.delete = deferred();
  const saving = s.save(1400); await settle();
  assert.equal(s.deletes().length, 1, '삭제 요청은 보냈고 응답 전');
  const before = s.setFx.length;
  s.switchStore('9'); await settle();
  s.gates.delete.resolve(); await saving; await settle();
  assert.equal(s.setFx.slice(before).some((v) => v && v.krw_per_unit === 1400), false, '바뀐 쇼핑몰에 이전 쇼핑몰 환율을 적용하지 않는다');
  assert.notEqual(s.el('salesFxNote').textContent, '환율을 저장했어요.');
  assert.equal(s.el('salesFxSave').disabled, false, '버튼은 다시 쓸 수 있다');
});

test('지울 이전 기록 ID는 요청 시작 때 고정한다 — 저장 중 화면이 다시 불러와져도 다른 기록을 지우지 않고, 결과도 적용하지 않는다', async () => {
  const s = setup({ fx: [FX('old1', 1300)] });
  await settle();
  s.gates.insert = deferred();
  const saving = s.save(1400); await settle();
  s.reload(); await settle(); // 다시 불러오기(state 교체)
  s.gates.insert.resolve(); await saving; await settle();
  assert.equal(s.deletes().length, 0, '화면이 바뀐 뒤에는 삭제하지 않는다(다음 저장에서 남은 기록으로 정리)');
  assert.notEqual(s.el('salesFxNote').textContent, '환율을 저장했어요.');
});

test('이전 기록 삭제가 실패하면 알리고, 남은 기록을 다음 저장 때 함께 지운다 · 조회 때 남아 있던 예전 기록도 정리 대상', async () => {
  const s = setup({ fx: [FX('old1', 1300), FX('older0', 1250)], deleteError: true });
  await settle();
  await s.save(1400); await settle();
  assert.deepEqual([...s.deletes()[0].ids], ['old1', 'older0'], '조회 때 남아 있던 예전 기록도 함께');
  assert.match(s.el('salesFxNote').textContent, /이전 환율 기록 정리는 다음 저장 때 다시 시도해요/);
  assert.equal(s.setFx.at(-1).krw_per_unit, 1400, '새 환율은 저장됐으니 적용');
  await s.save(1450); await settle();
  const second = [...s.deletes()[1].ids];
  assert.equal(second.length, 3); assert.ok(second.includes('old1') && second.includes('older0'), '못 지운 기록을 다음 저장 때 다시');
});
