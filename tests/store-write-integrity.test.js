/* store.js 데이터 정합성 — 늦은 응답 · 조회 실패 · 저장/삭제 실패를 가짜 Supabase로 재현한다.
   실행: node --test tests/store-write-integrity.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// 표 · 동작별 응답을 정하고, 쓰기 호출을 기록한다. gate: 응답을 늦출 Promise
function fakeSupabase(o) {
  const calls = [];
  const from = (table) => {
    const f = { table, op: 'select' };
    const result = () => {
      const key = table + ':' + f.op + (f.tool_type ? ':' + f.tool_type : '');
      const r = (o.results && o.results[key]) || { data: [], error: null };
      return (o.gate || Promise.resolve()).then(() => r);
    };
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k, v) { if (k === 'tool_type') f.tool_type = v; return q; },
      insert(row) { f.op = 'insert'; calls.push({ table, op: 'insert', row }); return q; },
      upsert(row) { f.op = 'upsert'; calls.push({ table, op: 'upsert', row }); return q; },
      delete() { f.op = 'delete'; calls.push({ table, op: 'delete' }); return q; },
      then(ok, fail) { return result().then(ok, fail); },
    };
    return q;
  };
  return { client: { from }, calls };
}
function boot(sb) {
  const window = { launchdeskSupabase: sb.client };
  const sandbox = { window, console: { warn() {}, log() {} }, setTimeout, clearTimeout, Promise, Date, JSON };
  vm.createContext(sandbox);
  vm.runInContext(STORE_SRC, sandbox, { filename: 'store.js' });
  return window.launchdeskStore;
}

test('로그인 데이터를 불러오는 사이 로그아웃하면 늦게 온 이전 사용자 데이터를 넣지 않는다', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const sb = fakeSupabase({ gate, results: { 'tool_records:select:ad_log': { data: [{ data: { id: 1, name: 'A의 기록' } }], error: null } } });
  const store = boot(sb);
  const loading = store.hydrate('user-a');
  store.resetToGuest();
  open(); await loading; await settle();
  assert.equal(store.isAuthed(), false, '로그아웃 상태 유지');
  assert.equal(store.getAdlogRecords().length, 0, 'A의 기록이 게스트 화면에 들어오지 않는다');
});

test('진행상황 조회가 실패하면 이번 세션의 진행 저장을 막아 서버 기록을 덮어쓰지 않는다', async () => {
  const sb = fakeSupabase({ results: { 'user_step_progress:select': { data: null, error: { message: '조회 실패(테스트)' } } } });
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  store.setStepState('/step01', [0], false);
  store.flushStepNow('/step01'); await settle();
  assert.equal(sb.calls.filter((c) => c.table === 'user_step_progress').length, 0, '빈 상태로 서버 진행을 덮어쓰지 않는다');
  // 다시 로그인해 정상 조회되면 저장된다
  const ok = fakeSupabase({});
  const store2 = boot(ok);
  await store2.hydrate('user-a'); await settle();
  store2.setStepState('/step01', [0], false); store2.flushStepNow('/step01'); await settle();
  assert.equal(ok.calls.filter((c) => c.table === 'user_step_progress' && c.op === 'upsert').length, 1);
});

test('광고 기록 · 계산 기록 저장/삭제가 실패하면 false를 돌려주고 화면 상태를 되돌린다(성공처럼 남기지 않음)', async () => {
  const fail = { data: null, error: { message: '쓰기 실패(테스트)' } };
  const sb = fakeSupabase({ results: { 'tool_records:insert': fail, 'tool_records:delete:ad_log': fail, 'tool_records:delete:margin_calc': fail,
    'tool_records:select:ad_log': { data: [{ data: { id: 7, name: '기존 기록' } }], error: null } } });
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  const added = store.addAdlogRecord({ id: 8, name: '새 기록' });
  assert.equal(store.getAdlogRecords().length, 2, '저장 요청 중에는 바로 보인다');
  assert.equal(await added, false);
  assert.deepEqual(store.getAdlogRecords().map((r) => r.id), [7], '실패하면 목록에서 빠진다');
  assert.equal(await store.removeAdlogRecord(7), false);
  assert.deepEqual(store.getAdlogRecords().map((r) => r.id), [7], '삭제 실패면 다시 보인다');
  assert.equal(await store.addCalcRecord({ name: '계산' }), false);
  assert.equal(store.getCalcHistory().length, 0);
  // 게스트는 서버에 쓰지 않고 true
  const guest = boot(fakeSupabase({}));
  assert.equal(await guest.addAdlogRecord({ id: 1 }), true);
  assert.equal(guest.getAdlogRecords().length, 1);
});

test('예전 브라우저 기록 이전은 종류별 한 번의 insert로 하고, 성공한 종류만 바로 지운다(재시도 중복 방지)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(src, /insert\(legacyCalc\.map\(/); assert.match(src, /insert\(legacyAdlog\.map\(/);
  assert.match(src, /then\(clearOnOk\('ld-tools-calc-history'\)\)/); assert.match(src, /then\(clearOnOk\('ld-adlog-records'\)\)/);
  assert.doesNotMatch(src, /legacyCalc\.forEach\(/); assert.doesNotMatch(src, /checkProfileRow/);
});
