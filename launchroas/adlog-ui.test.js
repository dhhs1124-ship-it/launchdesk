/* 광고 기록 화면(adlog.js) — 중복 선택 유지 · 실행 기록 저장 스위치 · 결과 비교. 가짜 DOM · 가짜 DB(로컬 테스트 데이터)로만 검증한다.
   실행: node --test launchroas/adlog-ui.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function node(tag){
  return { tagName: tag, children: [], value: '', checked: false, hidden: false, disabled: false, textContent: '', className: '', events: {},
    append(...a){ this.children.push(...a); }, appendChild(c){ this.children.push(c); return c; }, replaceChildren(...a){ this.children = a; },
    setAttribute(k, v){ this[k] = v; }, addEventListener(k, fn){ this.events[k] = fn; }, scrollIntoView(){}, reset(){} };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const all = (n) => [n, ...(n.children || []).flatMap(all)];
const text = (n) => all(n).map((x) => x.textContent || '').join(' ');
const byClass = (n, cls) => all(n).filter((x) => String(x.className || '').split(' ').includes(cls));

function setup({ flag, rows, decisions, failDecisions }){
  const control = { failDecisions: !!failDecisions };
  const db = { ad_log: rows.map((data) => ({ data })), ad_log_decision: (decisions || []).map((data) => ({ data })) }, inserts = [], calls = [];
  const ids = {};
  const document = {
    getElementById: (id) => ids[id] || (ids[id] = node(id)),
    createElement: node, createTextNode: (t) => ({ textContent: t }),
    querySelectorAll(sel){
      const boxes = all(document.getElementById('chgConcurrentBox')).filter((x) => x.name === 'chgConcurrent');
      return sel.includes(':checked') ? boxes.filter((b) => b.checked) : boxes;
    },
  };
  function from(table){
    const f = {};
    const q = { select: () => q, order: () => q, eq: (k, v) => { f[k] = v; return q; },
      insert: (row) => { inserts.push({ table, row }); if(table === 'tool_records') (db[row.tool_type] = db[row.tool_type] || []).unshift({ data: row.data }); return Promise.resolve({ error: null }); },
      then: (ok, fail) => Promise.resolve(table === 'ad_margin_links' ? { data: [{ meta_adset_id: '222', product_label: '니트', pre_ad: 20000, source_saved_at: 's1' }], error: null }
        : f.tool_type === 'ad_log_decision' && control.failDecisions ? { data: null, error: { message: '조회 실패(테스트)' } }
        : { data: (db[f.tool_type] || []).slice(), error: null }).then(ok, fail) };
    return q;
  }
  const client = { from, functions: { invoke: async (name, { body }) => {
    calls.push(body);
    const buy = body.date < '2026-09-01' ? 1 : 2;
    return { data: { ok: true, account: { currency: 'KRW' }, ads: [{ ad_id: '111', metrics: { spend: 10000, impressions: 100000, link_clicks: 1000, purchase: { value: buy, observed: true }, purchase_value: { value: buy * 30000, observed: true } } }] } };
  } } };
  const ctx = { client, userId: 'u1', storeId: '4', stores: [{ id: '4' }], metaAccount: { id: 'm', status: 'connected', external_account_id: 'act_9' }, fx: null };
  const listeners = [], views = [];
  const app = { getContext: () => ctx, subscribe: (fn) => { listeners.push(fn); fn(ctx); }, showView: (v) => views.push(v) };
  const window = { LaunchRoasApp: app, launchdeskAdlogMeta: { buildMetaAdlogRecord(){} }, confirm: () => true };
  if(flag) window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true };
  const sandbox = { window, document, Date, Math, JSON, Number, String, Promise, Object, Array, setTimeout, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for(const f of ['adlog-core.js', 'adlog-change-core.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/adlog.js', 'utf8'), sandbox);
  return { ids, inserts, calls, views, window, db, control };
}

const manual = { id: 1, store_id: '4', date: '2026-10-01', name: '직접 입력 메타', spend: 10000, revenue: 30000, channel: '메타' };
const auto = { id: 2, source: 'meta_auto', meta_auto_key: '4|act_9|2026-10-01', store_id: '4', date: '2026-10-01', name: 'Meta 캠페인 전체 합계', spend: 12000, revenue: 36000, channel: '메타', currency: 'KRW' };

test('중복 가능 기록: 기본은 합계 포함 · 선택하면 ad_log_decision에 덧붙여 저장하고 다시 불러와도 유지된다', async () => {
  const s = setup({ flag: false, rows: [manual, auto] });
  await settle();
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩22,000');
  assert.match(s.ids.adlogTotalNote.textContent, /중복 가능 1건\(₩10,000\) 포함 · 선택 필요/);
  const sel = all(s.ids.adlogRows).find((x) => x.tagName === 'select');
  sel.value = 'exclude'; await sel.events.change(); await settle();
  const dec = s.inserts.find((x) => x.row.tool_type === 'ad_log_decision');
  assert.equal(dec.row.data.record_id, 1); assert.equal(dec.row.data.include, false);
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩12,000');
  await s.window.LaunchRoasAdlog.refresh(); await settle();
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩12,000', '다시 불러와도 선택 유지');
  assert.ok(!s.inserts.some((x) => x.row.tool_type === 'ad_log'), '기존 기록은 수정 · 추가하지 않는다');
});

test('스위치가 꺼져 있으면 실행 기록 양식은 열리지만 공용 DB에 변경 기록을 저장하지 않는다', async () => {
  const s = setup({ flag: false, rows: [] });
  await settle();
  s.window.LaunchRoasAdlog.startChange({ ad: { ad_id: '111', ad_name: '니트 광고', adset_id: '222' }, after: '울 50% 강조', suggestion: { week: '2026-09-29', ad_id: '111', verdict: '개선 필요' } });
  assert.deepEqual(s.views, ['records']);
  assert.equal(s.ids.adlogChangeForm.hidden, false);
  assert.equal(s.ids.chgFlag.hidden, false);
  assert.equal(s.ids.chgSave.disabled, true);
  await s.ids.adlogChangeForm.events.submit({ preventDefault(){} }); await settle();
  assert.equal(s.inserts.length, 0);
  assert.equal(s.calls.length, 0, 'Meta 조회도 하지 않는다');
  assert.match(s.ids.chgStatus.textContent, /저장을 꺼 두었어요/);
});

test('스위치를 켠 로컬 테스트: 변경 전 7일 지표 · 계산 기준과 함께 저장하고, 결과 비교 → 결과 기록을 덧붙인다', async () => {
  const s = setup({ flag: true, rows: [] });
  await settle();
  s.window.LaunchRoasAdlog.startChange({ ad: { ad_id: '111', ad_name: '니트 광고', adset_id: '222' }, before: '가을 신상 10% 할인', after: '울 50% · 가벼운 두께 강조', suggestion: { week: '2026-08-25', ad_id: '111', verdict: '개선 필요', proposed: '첫 줄을 소재 강점으로' } });
  s.ids.chgStart.value = '2026-09-01'; s.ids.chgMethod.value = 'edit';
  all(s.ids.chgConcurrentBox).find((x) => x.value === '할인').checked = true;
  await s.ids.adlogChangeForm.events.submit({ preventDefault(){} }); await settle(); await settle();
  const saved = s.inserts.find((x) => x.row.tool_type === 'ad_log');
  assert.ok(saved, s.ids.chgStatus.textContent);
  const c = saved.row.data;
  assert.equal(c.source, 'change'); assert.equal(c.spend, undefined);
  assert.equal(c.baseline.metrics.days, 7); assert.equal(c.baseline.metrics.purchases.value, 7);
  assert.equal(c.basis.margin.pre_ad, 20000); assert.equal(c.basis.currency, 'KRW');
  assert.equal(JSON.stringify(c.concurrent), '["할인"]');
  assert.deepEqual([...s.calls.map((b) => b.date)], ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31']);
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩0', '변경 기록은 합계에 들어가지 않는다');

  const card = byClass(s.ids.adlogChanges, 'adlog-change')[0];
  const cmpBtn = all(card).find((x) => x.textContent === '결과 비교하기');
  await cmpBtn.events.click(); await settle(); await settle();
  const card2 = byClass(s.ids.adlogChanges, 'adlog-change')[0];
  const t = text(card2);
  assert.match(t, /판단 보류 · 저장 전/);
  assert.match(t, /구매 증가 관찰 · 구매당 광고비 -50% \(효율 개선 관찰\) · 광고비 변화 없음 · 판단 보류/);
  assert.match(t, /함께 바뀐 조건이 있어 개선 여부를 확정하지 않아요/);
  assert.match(t, /구매 7 → 14건/); assert.match(t, /광고비 변화 없음/);
  assert.match(t, /이익\(참고 계산\) \+₩140,000 연결 상품 기준 가정 · 성과 집계 제외/);
  assert.match(t, /비교 근거/); assert.match(t, /함께 바뀐 조건\(할인\)/);
  assert.equal(byClass(card2, 'adlog-basis').length, 1, '세부 근거는 펼침 영역');
  const saveBtn = all(card2).find((x) => x.textContent === '결과 저장');
  await saveBtn.events.click(); await settle();
  const result = s.inserts.filter((x) => x.row.tool_type === 'ad_log')[1].row.data;
  assert.equal(result.source, 'change_result'); assert.equal(result.action_id, c.action_id);
  assert.equal(result.result.profit.kind, 'reference');
  assert.equal(result.result.profit.diff, (20000 * 14 - 70000) - (20000 * 7 - 70000));
  assert.doesNotMatch(text(s.ids.adlogChanges), /저장 전/);
  assert.equal(result.result.status, 'inconclusive');
  assert.match(text(s.ids.adlogChanges), /판단 보류/);
});

test('선택 조회 실패: 저장된 선택이 없던 경우와 구분해 합계 미확정 · 다시 불러오기 → 성공하면 선택을 반영한다', async () => {
  const s = setup({ flag: false, rows: [manual, auto], decisions: [{ record_id: 1, store_id: '4', include: false, decided_at: '2026-10-06T00:00:00Z' }], failDecisions: true });
  await settle();
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩22,000 (미확정)');
  assert.match(s.ids.adlogTotalNote.textContent, /선택을 불러오지 못해 합계 미확정/);
  const retry = all(s.ids.adlogTotalNote).find((x) => x.textContent === '다시 불러오기');
  assert.ok(retry);
  s.control.failDecisions = false;
  await retry.events.click(); await settle();
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩12,000');
  assert.doesNotMatch(s.ids.adlogTotalNote.textContent, /미확정/);
  // 저장된 선택이 원래 없던 경우는 미확정이 아니다
  const n = setup({ flag: false, rows: [manual, auto] });
  await settle();
  assert.equal(n.ids.adlogTotalSpend.textContent, '₩22,000');
});

test('저장된 결과: 최신이 조회 실패뿐이면 갱신 실패 · 이전 결과로, 판정 버전 없는 예전 결과는 이전 판정 기준으로 표시한다', async () => {
  const CH = require('./adlog-change-core.js');
  const day = (d, s, b) => ({ date: d, metrics: { spend: s, impressions: s * 10, link_clicks: s / 100, purchase: { value: b, observed: true }, purchase_value: { value: b * 30000, observed: true } } });
  const span = (st, tot, b) => Array.from({ length: 7 }, (_, i) => day(CH.addDays(st, i), tot / 7, i === 0 ? b : 0));
  const p = CH.periods('2026-09-08', 7);
  const mk = (id) => CH.buildChangeRecord({ storeId: '4', ad: { ad_id: '111', adset_id: '222', ad_name: '광고' + id }, element: '문구', after: 'x', startDate: '2026-09-08', compareDays: 7,
    baseline: { metrics: CH.aggregate(span(p.before.since, 100000, 10), p.before.since, p.before.until) }, basis: { currency: 'KRW', attribution: 'A', margin: null } }, Date.now() + id).record;
  const c1 = mk(1), c2 = mk(2);
  const good = CH.aggregate(span(p.after.since, 100000, 30), p.after.since, p.after.until), bad = CH.aggregate(span(p.after.since, 100000, 30).slice(0, 6), p.after.since, p.after.until);
  const r1 = CH.buildResultRecord(c1, good, CH.compare(c1, good, null, '2026-09-30'), Date.parse('2026-09-30T00:00:00Z'), '');
  const r2 = CH.buildResultRecord(c1, bad, CH.compare(c1, bad, null, '2026-10-03'), Date.parse('2026-10-03T00:00:00Z'), '');
  const legacy = { id: 9, source: 'change_result', action_id: c2.action_id, store_id: '4', measured_at: '2026-09-20T00:00:00Z', after: good, result: { status: 'improved', reasons: ['예전 규칙'], warnings: [] } };
  const s = setup({ flag: false, rows: [c1, r1, r2, c2, legacy] });
  await settle();
  const t = text(s.ids.adlogChanges);
  assert.match(t, /갱신 실패 · 이전 결과 · 구매당 광고비 개선 신호/);
  assert.match(t, /구매당 광고비 개선 신호 · 이전 판정 기준/);
});
