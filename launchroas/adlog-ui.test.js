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

// 서버 응답: 요청한 설정값(requested)과 광고 행별로 실제 보인 요청 창(attribution_windows_seen)
const REQ = { windows: ['7d_click', '1d_view'], action_report_time: 'impression' };
// 화면이 만든 귀속 기준 — 두 기간 모두 대상 광고 행에서 요청 창을 봤을 때만 response_evidence
const ATTR = { source: 'request', ...REQ, applied: { windows: 'response_evidence', windows_seen: REQ.windows, action_report_time: 'unconfirmed', metric_basis: 'response_evidence' } };
// basisConfirmed: 서버가 구매 수 계산 기준(value)이 요청 창 기준이라는 근거를 준다고 가정(판정 경로 검사용 — 실제 서버는 아직 항상 unconfirmed)
function setup({ flag, rows, decisions, failDecisions, failRecords, now, timezone, basisConfirmed }){
  // failDates: 조회 실패할 날짜 · truncDates: 페이지 누락(광고 없음) 날짜 · noAttribution: 재배포 전 서버(귀속 기준 응답 없음) · noEvidence: 요청값은 오지만 광고 행에 창별 값이 없음
  // now: 화면의 현재 시각 고정(ms · 없으면 실제 시각) · timezone: 응답 광고계정 시간대
  const control = { failDecisions: !!failDecisions, failRecords: !!failRecords, failDates: [], truncDates: [], noAttribution: false, noEvidence: false, basisConfirmed: !!basisConfirmed, noClick7: false };
  const account = { currency: 'KRW', ...(timezone ? { timezone } : {}) };
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
        : f.tool_type === 'ad_log' && control.failRecords ? { data: null, error: { message: '조회 실패(테스트)' } }
        : { data: (db[f.tool_type] || []).slice(), error: null }).then(ok, fail) };
    return q;
  }
  const client = { from, functions: { invoke: async (name, { body }) => {
    calls.push(body);
    if (control.failDates.includes(body.date)) return { data: null, error: { message: '조회 실패(테스트)' } };
    const attribution = body.attribution_mode === 'explicit' && !control.noAttribution ? { attribution: { source: 'request', requested: REQ, windows_seen: control.noEvidence ? [] : REQ.windows, action_report_time_applied: 'unconfirmed',
      metric_basis: { field: 'value', windows_summed: false, matches_requested_windows: control.basisConfirmed ? 'response_evidence' : 'unconfirmed' } } } : {};
    if (control.truncDates.includes(body.date)) return { data: { ok: true, account, ads: [], truncated: true, ...attribution } };
    const buy = body.date < '2026-09-01' ? 1 : 2;
    return { data: { ok: true, account, ...attribution, ads: [{ ad_id: '111', ...(attribution.attribution ? { attribution_windows_seen: control.noEvidence ? [] : REQ.windows,
      attribution_purchase: { action_type: 'offsite_conversion.fb_pixel_purchase', count: { value: buy, windows: control.noEvidence ? { '7d_click': null, '1d_view': null } : { '7d_click': control.noClick7 ? null : buy, '1d_view': 0 } }, purchase_value: null } } : {}), metrics: { spend: 10000, impressions: 100000, link_clicks: 1000, purchase: { value: buy, observed: true }, purchase_value: { value: buy * 30000, observed: true } } }] } };
  } } };
  const ctx = { client, userId: 'u1', storeId: '4', stores: [{ id: '4' }], metaAccount: { id: 'm', status: 'connected', external_account_id: 'act_9' }, fx: null };
  const listeners = [], views = [];
  const app = { getContext: () => ctx, subscribe: (fn) => { listeners.push(fn); fn(ctx); }, showView: (v) => views.push(v) };
  const window = { LaunchRoasApp: app, launchdeskAdlogMeta: { buildMetaAdlogRecord(){} }, confirm: () => true };
  if(flag) window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true };
  const FixedDate = now == null ? Date : class extends Date { constructor(...a){ super(...(a.length ? a : [now])); } static now(){ return now; } };
  const sandbox = { window, document, Date: FixedDate, Math, JSON, Number, String, Promise, Object, Array, setTimeout, console };
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
  const s = setup({ flag: true, rows: [], basisConfirmed: true });
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
  // 비교 시점에 변경 전 · 후를 같은 명시 귀속으로 함께 다시 조회했다
  const cmpCalls = s.calls.slice(7);
  assert.deepEqual([...cmpCalls.map((b) => b.date)], ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31',
    '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
  assert.ok(s.calls.every((b) => b.attribution_mode === 'explicit'));
  const core = (a) => { const { observed, calculation, ...rest } = JSON.parse(JSON.stringify(a)); return rest; };
  assert.deepEqual(core(c.basis.attribution), ATTR, '기록 당시 귀속 기준은 응답 값');
  // 관찰값(같은 구매 항목의 value · 창별 값 — 창마다 날짜별로만 더함, 창끼리 더하지 않음)과 계산 기준을 따로 남긴다
  assert.deepEqual(JSON.parse(JSON.stringify(c.basis.attribution.observed.purchase_count)), { days: 7, value: 7, windows: { '7d_click': 7, '1d_view': 0 } });
  assert.deepEqual(JSON.parse(JSON.stringify(c.basis.attribution.calculation)), { field: 'value', windows_summed: false });
  assert.equal(result.result.baseline_source, 'refetched'); assert.equal(result.before.purchases.value, 7);
  assert.deepEqual(core(result.result.attribution), ATTR);
  assert.equal(result.result.attribution.observed.after.purchase_count.value, 14);
  const t2 = text(s.ids.adlogChanges);
  assert.match(t2, /변경 전 지표\(비교 시점 재조회\) 광고비 ₩70,000 · 구매 7건/, '통화가 null로 바뀌지 않는다');
  assert.match(t2, /귀속 기준 요청한 설정 · 7d_click, 1d_view · 보고 기준 노출일 \/ 응답 관찰 · 귀속 창별 값 있음 · 보고 기준 미확인\(응답에 드러나지 않음\) \/ 계산 기준 · 구매 수는 Meta 기본 값\(value\) · 창별 값 합산 안 함 · 요청 창 기준 확인/);
  assert.match(t2, /주간 분석과 기준 주간 분석 · 광고 세트 귀속 설정 기준/);
  assert.equal(result.result.attribution_vs_weekly.same, false, '저장 기록에 주간 분석과의 기준 차이');
});

test('실행 기록: 변경 방식 기본값 없음 · 변경 전 조회 실패(누락)가 있으면 저장하지 않는다', async () => {
  const s = setup({ flag: true, rows: [], basisConfirmed: true });
  await settle();
  s.window.LaunchRoasAdlog.startChange({ ad: { ad_id: '111', ad_name: '니트 광고', adset_id: '222' }, after: '울 50% 강조' });
  assert.equal(s.ids.chgMethod.value, '', '기존 광고 수정 · 새 광고 추가 중 기본 선택 없음');
  s.ids.chgStart.value = '2026-09-01';
  await s.ids.adlogChangeForm.events.submit({ preventDefault(){} }); await settle(); await settle();
  assert.match(s.ids.chgStatus.textContent, /변경 방식\(기존 광고 수정 · 새 광고 추가\)/);
  s.ids.chgMethod.value = 'edit'; s.control.failDates = ['2026-08-27'];
  s.window.LaunchRoasAdlog.startChange({ ad: { ad_id: '111', ad_name: '니트 광고', adset_id: '222' }, after: '울 50% 강조' });
  s.ids.chgStart.value = '2026-09-01'; s.ids.chgMethod.value = 'edit';
  await s.ids.adlogChangeForm.events.submit({ preventDefault(){} }); await settle(); await settle();
  assert.match(s.ids.chgStatus.textContent, /변경 전 지표 일부를 불러오지 못함\(조회 실패 · 페이지 누락 1일\)/);
  assert.equal(s.inserts.length, 0);
});

test('결과 비교: 페이지 누락은 비교하지 않고 · 귀속 기준 응답이 없으면(재배포 전 서버) 확정하지 않는다', async () => {
  const CH = require('./adlog-change-core.js');
  const p = CH.periods('2026-09-01', 7);
  const day = (d) => ({ date: d, metrics: { spend: 10000, impressions: 100000, link_clicks: 1000, purchase: { value: 1, observed: true }, purchase_value: { value: 30000, observed: true } } });
  const c = CH.buildChangeRecord({ storeId: '4', ad: { ad_id: '111', adset_id: '222', ad_name: '니트 광고' }, element: '문구', after: 'x', method: 'edit', startDate: '2026-09-01', compareDays: 7,
    baseline: { metrics: CH.aggregate(Array.from({ length: 7 }, (_, i) => day(CH.addDays(p.before.since, i))), p.before.since, p.before.until) }, basis: { currency: 'KRW', attribution: ATTR, margin: null } }, Date.now()).record;
  const s = setup({ flag: false, rows: [c], basisConfirmed: true });
  await settle();
  const press = async () => { await all(byClass(s.ids.adlogChanges, 'adlog-change')[0]).find((x) => x.textContent === '결과 비교하기').events.click(); await settle(); await settle(); return text(byClass(s.ids.adlogChanges, 'adlog-change')[0]); };
  s.control.truncDates = ['2026-09-03'];
  assert.match(await press(), /판단 불가 · 저장 전.*일부 페이지가 빠진 날이 있어 비교하지 않아요/);
  s.control.truncDates = []; s.control.noAttribution = true;
  const t = await press();
  assert.match(t, /귀속 기준을 확인하지 못해 개선 여부를 확정하지 않아요/);
  assert.match(t, /귀속 기준 미확인\(응답에 귀속 기준 없음\)/);
  // 요청값은 돌아오지만 Meta 응답 항목에 창별 값이 없으면 — 요청값만으로 확인하지 않는다
  s.control.noAttribution = false; s.control.noEvidence = true;
  const e = await press();
  assert.match(e, /귀속 기준을 확인하지 못해 개선 여부를 확정하지 않아요/);
  assert.match(e, /응답 관찰 · 귀속 창별 값 미확인\(응답 근거 없음\)/);
  // 현재 실제 서버(value 계산 기준 미확인) + 광고 행의 같은 구매 항목에 7d_click이 전후 모든 날 있으면 — 7일 클릭 기준으로 비교
  s.control.noEvidence = false; s.control.basisConfirmed = false;
  const k = await press();
  assert.match(k, /구매 7 → 14건 7일 클릭 기준/);
  assert.match(k, /같은 구매 항목의 7일 클릭 값\(offsite_conversion\.fb_pixel_purchase\)으로 비교해요/);
  assert.doesNotMatch(k, /귀속 기준을 확인하지 못해/);
  assert.match(k, /주간 분석은 광고 세트 귀속 설정 기준이고/);
  // 광고 행의 구매 항목에 7d_click이 없으면(광고 단위 응답에서 확인 못 함) — 판단 보류 · value 기준 관찰값만
  s.control.noClick7 = true;
  const m = await press();
  assert.match(m, /판단 보류/); assert.doesNotMatch(m, /개선 신호/);
  assert.match(m, /귀속 기준을 확인하지 못해 개선 여부를 확정하지 않아요/);
  assert.match(m, /구매 수가 그 기준으로 계산됐는지 확인되지 않고, 전후 모두 같은 구매 항목의 7일 클릭 값도 없어/);
  assert.match(m, /구매 7 → 14건 Meta 기본 값\(value\)/);
  assert.match(m, /응답 관찰 · 귀속 창별 값 있음 .* 요청 창 기준인지 미확인/);
});

test('광고 기록 조회 실패: 기록 없음(₩0)과 구분해 합계 — · 불러오지 못함 · 다시 불러오기', async () => {
  const s = setup({ flag: false, rows: [manual], failRecords: true });
  await settle();
  assert.equal(s.ids.adlogTotalSpend.textContent, '—');
  assert.match(s.ids.adlogTotalNote.textContent, /광고 기록을 불러오지 못했어요/);
  assert.match(text(s.ids.adlogRows), /불러오지 못했어요\(기록이 없는 것이 아니에요\)/);
  assert.doesNotMatch(text(s.ids.adlogChanges), /아직 실행 기록이 없어요/);
  s.control.failRecords = false;
  await all(s.ids.adlogTotalNote).find((x) => x.textContent === '다시 불러오기').events.click(); await settle();
  assert.equal(s.ids.adlogTotalSpend.textContent, '₩10,000');
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
  const mk = (id) => CH.buildChangeRecord({ storeId: '4', ad: { ad_id: '111', adset_id: '222', ad_name: '광고' + id }, element: '문구', after: 'x', method: 'edit', startDate: '2026-09-08', compareDays: 7,
    baseline: { metrics: CH.aggregate(span(p.before.since, 100000, 10), p.before.since, p.before.until) }, basis: { currency: 'KRW', attribution: 'A', margin: null } }, Date.now() + id).record;
  const c1 = mk(1), c2 = mk(2);
  const good = CH.aggregate(span(p.after.since, 100000, 30), p.after.since, p.after.until), bad = CH.aggregate(span(p.after.since, 100000, 30).slice(0, 6), p.after.since, p.after.until);
  const again = { before: c1.baseline.metrics, attribution: ATTR }; // 비교 시점 재조회(화면과 같은 입력)
  const r1 = CH.buildResultRecord(c1, good, CH.compare(c1, good, null, '2026-09-30', again), Date.parse('2026-09-30T00:00:00Z'), '', again.before);
  const r2 = CH.buildResultRecord(c1, bad, CH.compare(c1, bad, null, '2026-10-03', again), Date.parse('2026-10-03T00:00:00Z'), '', again.before);
  const legacy = { id: 9, source: 'change_result', action_id: c2.action_id, store_id: '4', measured_at: '2026-09-20T00:00:00Z', after: good, result: { status: 'improved', reasons: ['예전 규칙'], warnings: [] } };
  const s = setup({ flag: false, rows: [c1, r1, r2, c2, legacy] });
  await settle();
  const t = text(s.ids.adlogChanges);
  assert.match(t, /갱신 실패 · 이전 결과 · 구매당 광고비 개선 신호/);
  assert.match(t, /구매당 광고비 개선 신호 · 이전 판정 기준/);
});

test('확정 판단일 안내 · 잠정 판정 날짜가 화면에서도 같다(시각 고정) — 판정은 광고계정 시간대 날짜', async () => {
  const CH = require('./adlog-change-core.js');
  const p = CH.periods('2026-09-01', 7); // 변경 후 마지막 날 2026-09-07 → 2026-09-15부터 확정
  const day = (d) => ({ date: d, metrics: { spend: 10000, impressions: 100000, link_clicks: 1000, purchase: { value: 1, observed: true }, purchase_value: { value: 30000, observed: true } } });
  const c = CH.buildChangeRecord({ storeId: '4', ad: { ad_id: '111', adset_id: '222', ad_name: '니트 광고' }, element: '문구', after: 'x', method: 'edit', startDate: '2026-09-01', compareDays: 7,
    baseline: { metrics: CH.aggregate(Array.from({ length: 7 }, (_, i) => day(CH.addDays(p.before.since, i))), p.before.since, p.before.until) }, basis: { currency: 'KRW', attribution: ATTR, margin: null } }, Date.parse('2026-09-01T00:00:00Z')).record;
  const card = (s) => byClass(s.ids.adlogChanges, 'adlog-change')[0];
  const button = (s) => all(card(s)).find((x) => x.tagName === 'button' && /비교/.test(x.textContent));
  const compareAt = async (iso, timezone) => {
    const s = setup({ flag: false, rows: [c], now: Date.parse(iso), timezone, basisConfirmed: true });
    await settle();
    return s;
  };
  // 비교 기간 중(한국 9/7 12:00): 비교 불가 · 확정일 안내
  let s = await compareAt('2026-09-07T03:00:00Z', 'Asia/Seoul');
  assert.equal(button(s).textContent, '비교 기간이 2026-09-07에 끝나요'); assert.equal(button(s).disabled, true);
  assert.match(text(card(s)), /귀속 창\(7일\) 동안은 잠정이고 2026-09-15부터 확정 판단\(광고계정 시간대 날짜 기준\)/);
  // 확정일 전날(한국 9/14): 비교는 되지만 잠정 — 버튼 · 결과 모두 같은 날짜
  s = await compareAt('2026-09-14T03:00:00Z', 'Asia/Seoul');
  assert.equal(button(s).textContent, '결과 비교하기(잠정 · 2026-09-15부터 확정)');
  await button(s).events.click(); await settle(); await settle();
  assert.match(text(card(s)), /잠정\(2026-09-15부터 확정\)/);
  assert.match(text(card(s)), /2026-09-15부터 확정 판단/);
  // 확정일(한국 9/15 01:30) · 계정 시간대 서울 → 확정
  s = await compareAt('2026-09-14T16:30:00Z', 'Asia/Seoul');
  // 기록에 시간대가 없으면 비교 전 버튼은 보수적 기준(한국 날짜 − 1일 = 9/14) — 판정과 같은 기준이라 아직 잠정으로 표시
  assert.equal(button(s).textContent, '결과 비교하기(잠정 · 2026-09-15부터 확정)');
  await button(s).events.click(); await settle(); await settle();
  assert.doesNotMatch(text(card(s)), /잠정/);
  assert.equal(button(s).textContent, '결과 비교하기', '비교로 받은 계정 시간대(서울)로 버튼도 판정과 같아진다');
  // 같은 시각이라도 계정 시간대가 로스앤젤레스(9/14 09:30)면 아직 귀속 창 안 → 잠정(한국 날짜로 앞당기지 않음)
  s = await compareAt('2026-09-14T16:30:00Z', 'America/Los_Angeles');
  await button(s).events.click(); await settle(); await settle();
  assert.match(text(card(s)), /잠정\(2026-09-15부터 확정\)/);
  // 응답에 시간대가 없으면 한국 날짜 − 1일(9/14) → 잠정
  s = await compareAt('2026-09-14T16:30:00Z', null);
  await button(s).events.click(); await settle(); await settle();
  assert.match(text(card(s)), /잠정\(2026-09-15부터 확정\)/);
});

test('비교 버튼 표시 = 실제 판정과 같은 광고계정 날짜 — 기록 시간대 · 모를 때 보수적 기준', async () => {
  const CH = require('./adlog-change-core.js');
  const p = CH.periods('2026-09-01', 7); // 변경 후 마지막 날 9/7 → 9/15부터 확정
  const day = (d) => ({ date: d, metrics: { spend: 10000, impressions: 100000, link_clicks: 1000, purchase: { value: 1, observed: true }, purchase_value: { value: 30000, observed: true } } });
  const rec = (timezone) => CH.buildChangeRecord({ storeId: '4', ad: { ad_id: '111', adset_id: '222', ad_name: '니트 광고' }, element: '문구', after: 'x', method: 'edit', startDate: '2026-09-01', compareDays: 7,
    baseline: { metrics: CH.aggregate(Array.from({ length: 7 }, (_, i) => day(CH.addDays(p.before.since, i))), p.before.since, p.before.until) },
    basis: { currency: 'KRW', timezone, attribution: ATTR, margin: null } }, Date.parse('2026-09-01T00:00:00Z')).record;
  const button = (s) => all(byClass(s.ids.adlogChanges, 'adlog-change')[0]).find((x) => x.tagName === 'button' && /비교/.test(x.textContent));
  const at = async (iso, timezone, respTz) => { const s = setup({ flag: false, rows: [rec(timezone)], now: Date.parse(iso), timezone: respTz, basisConfirmed: true }); await settle(); return s; };
  // 한국 9/8 01:30(UTC 9/7 16:30): 서울 계정은 기간 끝 · LA(9/7 09:30)와 시간대 모름(9/7)은 아직 기간 중 — 한국 날짜로 먼저 열지 않는다
  assert.equal(button(await at('2026-09-07T16:30:00Z', 'Asia/Seoul')).textContent, '결과 비교하기(잠정 · 2026-09-15부터 확정)');
  let s = await at('2026-09-07T16:30:00Z', 'America/Los_Angeles');
  assert.equal(button(s).textContent, '비교 기간이 2026-09-07에 끝나요'); assert.equal(button(s).disabled, true);
  s = await at('2026-09-07T16:30:00Z', null);
  assert.equal(button(s).textContent, '비교 기간이 2026-09-07에 끝나요', '시간대를 모르면 한국 날짜 − 1일'); assert.equal(button(s).disabled, true);
  // 한국 9/15 01:30: 서울은 확정 · LA(9/14)와 모름(9/14)은 잠정 표시 — 판정과 같은 날짜
  assert.equal(button(await at('2026-09-14T16:30:00Z', 'Asia/Seoul')).textContent, '결과 비교하기');
  assert.equal(button(await at('2026-09-14T16:30:00Z', 'America/Los_Angeles')).textContent, '결과 비교하기(잠정 · 2026-09-15부터 확정)');
  assert.equal(button(await at('2026-09-14T16:30:00Z', null)).textContent, '결과 비교하기(잠정 · 2026-09-15부터 확정)');
  // 버튼과 판정이 같다: LA 기록 · LA 응답 — 버튼 잠정 → 비교 결과도 잠정
  s = await at('2026-09-14T16:30:00Z', 'America/Los_Angeles', 'America/Los_Angeles');
  await button(s).events.click(); await settle(); await settle();
  assert.match(text(byClass(s.ids.adlogChanges, 'adlog-change')[0]), /잠정\(2026-09-15부터 확정\)/);
  assert.equal(button(s).textContent, '결과 비교하기(잠정 · 2026-09-15부터 확정)');
  // 기록 시간대 서울 · 응답 시간대 서울 — 버튼 확정 → 판정도 확정
  s = await at('2026-09-14T16:30:00Z', 'Asia/Seoul', 'Asia/Seoul');
  await button(s).events.click(); await settle(); await settle();
  assert.doesNotMatch(text(byClass(s.ids.adlogChanges, 'adlog-change')[0]), /잠정/);
});

test('실행 기록 저장 시 광고계정 시간대를 당시 기준(basis.timezone)에 남긴다', async () => {
  const s = setup({ flag: true, rows: [], timezone: 'America/Los_Angeles' });
  await settle();
  s.window.LaunchRoasAdlog.startChange({ ad: { ad_id: '111', ad_name: '니트 광고', adset_id: '222' }, after: '울 50% 강조' });
  s.ids.chgStart.value = '2026-09-01'; s.ids.chgMethod.value = 'edit';
  await s.ids.adlogChangeForm.events.submit({ preventDefault(){} }); await settle(); await settle();
  const saved = s.inserts.find((x) => x.row.tool_type === 'ad_log').row.data;
  assert.equal(saved.basis.timezone, 'America/Los_Angeles');
});
