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
  assert.deepEqual([...store.getAdlogRecords().map((r) => r.id)], [7], '실패하면 목록에서 빠진다');
  assert.equal(await store.removeAdlogRecord(7), false);
  assert.deepEqual([...store.getAdlogRecords().map((r) => r.id)], [7], '삭제 실패면 다시 보인다');
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

// ---- 2차: 세션 구분 복원 · rejection 경로 · 계산 기록 5개 유지 · 응답 순서 ----
// respond(call) → { result, gate } — 호출마다 응답과 지연을 정한다(call: table · op · tool_type · row)
function controllableSupabase(respond) {
  const calls = [];
  const from = (table) => {
    const f = { table, op: 'select' };
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k, v) { if (k === 'tool_type') f.tool_type = v; return q; },
      insert(row) { f.op = 'insert'; f.row = row; return q; }, upsert(row) { f.op = 'upsert'; f.row = row; return q; }, delete() { f.op = 'delete'; return q; },
      then(ok, fail) { calls.push(f); const r = respond(f) || {}; const res = r.result || { data: [], error: null };
        return (r.reject ? Promise.reject(new Error('네트워크 오류(테스트)')) : (r.gate || Promise.resolve()).then(() => res)).then(ok, fail); },
    };
    return q;
  };
  return { client: { from }, calls };
}
const gateOf = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const FAIL = { data: null, error: { message: '실패(테스트)' } };
const rowsOf = (list) => ({ data: list.map((d) => ({ data: d })), error: null });

test('광고 기록 삭제 실패 복원: 로그아웃 뒤에는 게스트 상태에 복원하지 않는다', async () => {
  const g = gateOf();
  const sb = controllableSupabase((c) => c.op === 'delete' ? { gate: g.p, result: FAIL } : c.tool_type === 'ad_log' ? { result: rowsOf([{ id: 7, name: 'A 기록' }]) } : null);
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  const removing = store.removeAdlogRecord(7);
  store.resetToGuest();
  g.open(); assert.equal(await removing, false); await settle();
  assert.deepEqual([...store.getAdlogRecords()], [], '로그아웃한 사용자의 기록을 게스트 화면에 되살리지 않는다');
});

test('광고 기록 삭제 실패 복원: A→로그아웃→A 재로그인도 다른 세션 — 이전 세션의 기록을 새 세션 목록에 넣지 않는다', async () => {
  const g = gateOf(); let login = 0;
  const sb = controllableSupabase((c) => {
    if (c.op === 'delete') return { gate: g.p, result: FAIL };
    if (c.tool_type === 'ad_log') { login++; return { result: rowsOf(login === 1 ? [{ id: 7, name: '첫 세션' }] : [{ id: 8, name: '새 세션' }]) }; }
    return null;
  });
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  const removing = store.removeAdlogRecord(7);
  store.resetToGuest(); await store.hydrate('user-a'); await settle();
  g.open(); await removing; await settle();
  assert.deepEqual([...store.getAdlogRecords().map((r) => r.id)], [8], '같은 계정이어도 이전 세션 복원을 새 목록에 섞지 않는다');
});

test('계산 기록 전체 삭제 실패 복원: 계정 전환 뒤에는 이전 계정 기록을 되살리지 않고, 같은 세션이면 새로 저장한 기록과 함께 되살린다', async () => {
  const g = gateOf();
  const sb = controllableSupabase((c) => c.op === 'delete' ? { gate: g.p, result: FAIL } : c.tool_type === 'margin_calc' ? { result: rowsOf(c.row ? [] : [{ name: 'A 계산' }]) } : null);
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  const clearing = store.clearCalcHistory();
  await store.hydrate('user-b'); await settle(); // 계정 전환(같은 응답이지만 다른 세션)
  const bList = store.getCalcHistory().map((r) => r.name);
  g.open(); await clearing; await settle();
  assert.deepEqual([...store.getCalcHistory().map((r) => r.name)], bList, 'B 화면에 A 복원을 섞지 않는다');
  // 같은 세션: 삭제 실패 중 새로 저장한 기록은 살리고, 지우지 못한 기존 기록을 뒤에 되돌린다
  const g2 = gateOf();
  const sb2 = controllableSupabase((c) => c.op === 'delete' ? { gate: g2.p, result: FAIL } : c.op === 'insert' ? { result: { data: null, error: null } } : c.tool_type === 'margin_calc' ? { result: rowsOf([{ name: 'a' }, { name: 'b' }]) } : null);
  const s2 = boot(sb2);
  await s2.hydrate('user-a'); await settle();
  const clearing2 = s2.clearCalcHistory();
  await s2.addCalcRecord({ name: '새 계산' });
  g2.open(); await clearing2; await settle();
  assert.deepEqual([...s2.getCalcHistory().map((r) => r.name)], ['새 계산', 'a', 'b']);
});

test('로그인 데이터 조회가 예외(rejection)로 끝나도 진행상황 조회 실패로 보고 진행 저장을 막는다', async () => {
  const sb = controllableSupabase((c) => c.op === 'select' && c.table === 'user_step_progress' ? { reject: true } : null);
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  store.setStepState('/step02', [1], true); store.flushStepNow('/step02'); await settle();
  assert.equal(sb.calls.filter((c) => c.table === 'user_step_progress' && c.op === 'upsert').length, 0);
});

test('계산 기록이 5개일 때 새 저장이 실패해도 기존 5개가 그대로 남는다', async () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name }));
  const sb = controllableSupabase((c) => c.op === 'insert' ? { result: FAIL } : c.tool_type === 'margin_calc' ? { result: rowsOf(five) } : null);
  const store = boot(sb);
  await store.hydrate('user-a'); await settle();
  const saving = store.addCalcRecord({ name: 'X' });
  assert.deepEqual([...store.getCalcHistory().map((r) => r.name)], ['X', 'a', 'b', 'c', 'd'], '저장 요청 중에는 새 기록이 맨 앞(화면 5개)');
  assert.equal(await saving, false);
  assert.deepEqual([...store.getCalcHistory().map((r) => r.name)], ['a', 'b', 'c', 'd', 'e'], '실패하면 밀려났던 e까지 그대로');
});

test('연속 계산 저장의 응답 순서가 바뀌어도 서로의 결과를 덮어쓰지 않는다', async () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name }));
  for (const failName of ['X', 'Y']) {
    const gates = { X: gateOf(), Y: gateOf() };
    const sb = controllableSupabase((c) => c.op === 'insert' ? { gate: gates[c.row.data.name].p, result: c.row.data.name === failName ? FAIL : { data: null, error: null } } : c.tool_type === 'margin_calc' ? { result: rowsOf(five) } : null);
    const store = boot(sb);
    await store.hydrate('user-a'); await settle();
    const x = store.addCalcRecord({ name: 'X' }), y = store.addCalcRecord({ name: 'Y' });
    gates.Y.open(); await y; gates.X.open(); await x; await settle(); // 나중 저장이 먼저 응답
    const ok = failName === 'X' ? 'Y' : 'X';
    assert.deepEqual([...store.getCalcHistory().map((r) => r.name)], [ok, 'a', 'b', 'c', 'd'], failName + ' 실패');
  }
});
