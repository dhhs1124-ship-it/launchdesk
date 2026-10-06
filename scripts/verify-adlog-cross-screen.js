// 운영 메인(compat 브랜치 작업 폴더) ↔ LaunchROAS 미리보기 광고 기록 — 같은 메모리 DB를 공유하는 로컬 모의 검증.
// 공용 DB에 쓰지 않는다. 운영 메인은 실제 store.js · adlog-core.js · tools.js를, 미리보기는 실제 adlog-core.js · adlog-change-core.js · adlog.js를 실행한다.
// 사용: node scripts/verify-adlog-cross-screen.js <운영 메인 compat 작업 폴더>
//   운영 메인 쪽 화면 하네스(boot · 가짜 DOM · 가짜 Supabase)는 그 폴더의 tests/open-beta-simplification.test.js에서 함수 원본을 잘라 와 쓴다.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const MAIN = path.resolve(process.argv[2] || '');
const PREVIEW = path.join(__dirname, '..', 'launchroas');
if (!fs.existsSync(path.join(MAIN, 'tools.js'))) { console.error('운영 메인 작업 폴더를 지정하세요'); process.exit(2); }

// ---- 운영 메인 하네스 원본 잘라 오기 ----
const src = fs.readFileSync(path.join(MAIN, 'tests', 'open-beta-simplification.test.js'), 'utf8').replace(/\r\n/g, '\n');
// 테스트 파일 전체를 불러오되 test() 등록은 무시한다(보조 함수 · 상수를 그대로 쓰기 위함)
const TEST_REQUIRE = "require('node:test')";
if (!src.includes(TEST_REQUIRE)) throw new Error('node:test require를 찾지 못함');
const harness = src.replace(TEST_REQUIRE, '(Object.assign(function(){}, { skip(){}, only(){}, todo(){} }))') + '\nmodule.exports = { boot, settle, periodFixture };\n';
const harnessPath = path.join(MAIN, 'tests', '__xscreen_harness.tmp.js');
fs.writeFileSync(harnessPath, harness);
let H;
try { H = require(harnessPath); } finally { fs.unlinkSync(harnessPath); }

// ---- 공유 메모리 DB(user u1 · 쇼핑몰 1) ----
const shared = { rows: [], failDecisions: false };

// ---- 미리보기 화면(가짜 DOM) ----
function node(tag){
  return { tagName: tag, children: [], value: '', checked: false, hidden: false, disabled: false, textContent: '', className: '', events: {},
    append(...a){ this.children.push(...a); }, appendChild(c){ this.children.push(c); return c; }, replaceChildren(...a){ this.children = a; },
    setAttribute(k, v){ this[k] = v; }, addEventListener(k, fn){ this.events[k] = fn; }, scrollIntoView(){}, reset(){} };
}
const all = (n) => [n, ...(n.children || []).flatMap(all)];
function bootPreview(flag){
  const ids = {};
  const document = { getElementById: (id) => ids[id] || (ids[id] = node(id)), createElement: node, createTextNode: (t) => ({ textContent: t }),
    querySelectorAll(sel){ const b = all(document.getElementById('chgConcurrentBox')).filter((x) => x.name === 'chgConcurrent'); return sel.includes(':checked') ? b.filter((x) => x.checked) : b; } };
  function from(table){
    const f = {};
    const q = { select: () => q, order: () => q, eq: (k, v) => { f[k] = v; return q; },
      insert: (row) => { shared.rows.push({ user_id: row.user_id, tool_type: row.tool_type, data: row.data }); return Promise.resolve({ error: null }); },
      then: (ok, fail) => Promise.resolve(table === 'ad_margin_links' ? { data: [], error: null }
        : f.tool_type === 'ad_log_decision' && shared.failDecisions ? { data: null, error: { message: '선택 조회 실패(모의)' } }
        : { data: shared.rows.filter((r) => r.user_id === f.user_id && r.tool_type === f.tool_type).slice().reverse(), error: null }).then(ok, fail) };
    return q;
  }
  const ctx = { client: { from, functions: { invoke: async () => ({ data: { ok: false } }) } }, userId: 'u1', storeId: '1', stores: [{ id: '1' }], metaAccount: { id: 'm1', status: 'connected', external_account_id: 'act_1' }, fx: null };
  const window = { LaunchRoasApp: { getContext: () => ctx, subscribe: (fn) => fn(ctx), showView(){} }, launchdeskAdlogMeta: { buildMetaAdlogRecord(){ return { ok: false }; } }, confirm: () => true };
  if (flag) window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true };
  const sb = { window, document, Date, Math, JSON, Number, String, Promise, Object, Array, setTimeout, console };
  sb.globalThis = sb; vm.createContext(sb);
  for (const f of ['adlog-core.js', 'adlog-change-core.js', 'adlog.js']) vm.runInContext(fs.readFileSync(path.join(PREVIEW, f), 'utf8'), sb, { filename: f });
  return { ids, window, $: (id) => document.getElementById(id) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- 운영 메인 화면 ----
async function bootMain(){
  const fx = H.periodFixture();
  fx.toolRecords = shared.rows; // 같은 배열을 그대로 읽는다(실시간)
  Object.defineProperty(fx, 'failDecisions', { get: () => shared.failDecisions });
  const env = await H.boot(fx); await H.settle();
  env.sandbox.launchdeskAdlog.render();
  return env;
}
const mainTotal = (env) => env.doc.getElementById('adlogSumSpend').textContent;
const mainNote = (env) => env.doc.getElementById('adlogSumNote').textContent;

// ---- 검증 ----
const results = [];
function check(name, ok, detail){ results.push({ name, ok: !!ok, detail }); }

(async () => {
  // 1) 저장: 미리보기에서 직접 입력(메타 · 계정 모름) + Meta 하루 합계(모의로 공유 DB에 직접 넣음 — 실제로는 원화 계정만 가능)
  let pv = bootPreview(false); await tick();
  pv.$('adlogDate').value = '2026-09-20'; pv.$('adlogName').value = '직접 입력 메타'; pv.$('adlogSpend').value = '10000'; pv.$('adlogRevenue').value = '30000'; pv.$('adlogChannel').value = '메타';
  pv.$('adlogAccount').value = ''; pv.$('adlogScope').value = '';
  await pv.$('adlogForm').events.submit.call(pv.$('adlogForm'), { preventDefault(){} }); await tick();
  shared.rows.push({ user_id: 'u1', tool_type: 'ad_log', data: { id: 2, source: 'meta_auto', meta_auto_key: '1|act_1|2026-09-20', store_id: '1', date: '2026-09-20', name: 'Meta 캠페인 전체 합계', spend: 12000, revenue: 36000, channel: '메타', currency: 'KRW' } });
  shared.rows.push({ user_id: 'u1', tool_type: 'ad_log', data: { id: 3, store_id: '1', date: '2026-09-22', name: '외화 기록', spend: 10, revenue: 30, channel: '인스타', currency: 'USD' } });
  await pv.window.LaunchRoasAdlog.refresh(); await tick();
  let mn = await bootMain();
  check('저장 후 두 화면 합계 일치(선택 전 · 중복 가능 포함 · 외화 환율 없음 제외)', pv.$('adlogTotalSpend').textContent === '₩22,000' && mainTotal(mn) === '₩22,000', { preview: pv.$('adlogTotalSpend').textContent, main: mainTotal(mn) });
  check('두 화면 모두 미결 중복 · 외화 제외 상태 표시', /중복 가능 1건/.test(pv.$('adlogTotalNote').textContent) && /중복 가능 1건/.test(mainNote(mn)) && /환율 없는 외화 1건/.test(mainNote(mn)), { preview: pv.$('adlogTotalNote').textContent, main: mainNote(mn) });

  // 2) 사용자 선택 저장(미리보기) → 운영 메인 재조회
  const manualId = shared.rows.find((r) => r.data.name === '직접 입력 메타').data.id;
  const sel = all(pv.$('adlogRows')).find((x) => x.tagName === 'select');
  sel.value = 'exclude'; await sel.events.change(); await tick();
  await mn.sandbox.launchdeskStore.reloadAdlogDecisions(); await H.settle(); mn.sandbox.launchdeskAdlog.render();
  check('선택 저장 후 두 화면 합계 일치(₩12,000)', pv.$('adlogTotalSpend').textContent === '₩12,000' && mainTotal(mn) === '₩12,000', { preview: pv.$('adlogTotalSpend').textContent, main: mainTotal(mn), decisions: shared.rows.filter((r) => r.tool_type === 'ad_log_decision').length });

  // 3) 재조회: 두 화면을 새로 띄워도 같은 결과
  pv = bootPreview(false); await tick(); mn = await bootMain();
  check('새로 띄운 뒤에도 선택 유지(두 화면 ₩12,000)', pv.$('adlogTotalSpend').textContent === '₩12,000' && mainTotal(mn) === '₩12,000', { preview: pv.$('adlogTotalSpend').textContent, main: mainTotal(mn) });

  // 4) 사용자 선택 조회 실패 → 두 화면 모두 미확정
  shared.failDecisions = true;
  pv = bootPreview(false); await tick(); mn = await bootMain();
  check('선택 조회 실패 시 두 화면 모두 합계 미확정 · 기본 판정 ₩22,000', pv.$('adlogTotalSpend').textContent === '₩22,000 (미확정)' && mainTotal(mn) === '₩22,000 (미확정)' && /미확정/.test(pv.$('adlogTotalNote').textContent) && /미확정/.test(mainNote(mn)), { preview: pv.$('adlogTotalSpend').textContent, main: mainTotal(mn) });
  const pvRetry = all(pv.$('adlogTotalNote')).find((x) => x.textContent === '다시 불러오기');
  const mnNote = mn.doc.getElementById('adlogSumNote'), mnRetry = (mnNote.children || []).find((x) => x && x.textContent === '다시 불러오기');
  check('두 화면 모두 다시 불러오기 버튼 표시', !!pvRetry && !!mnRetry, {});

  // 5) 재시도 성공
  shared.failDecisions = false;
  await pvRetry.events.click(); await tick();
  mnRetry.click(); await H.settle(); mn.sandbox.launchdeskAdlog.render();
  check('재시도 성공 후 두 화면 합계 ₩12,000 · 미확정 해제', pv.$('adlogTotalSpend').textContent === '₩12,000' && mainTotal(mn) === '₩12,000' && !/미확정/.test(mainNote(mn)), { preview: pv.$('adlogTotalSpend').textContent, main: mainTotal(mn) });

  // 6) 변경 기록(저장 스위치는 이 모의 검증에서만 켬) → 운영 메인 표 · 합계에 영향 없음
  pv = bootPreview(true); await tick();
  shared.rows.push({ user_id: 'u1', tool_type: 'ad_log', data: { id: 9, source: 'change', action_id: 'act_x', store_id: '1', date: '2026-09-23', name: '광고 · 문구 변경', channel: '메타',
    ad: { ad_id: '111', adset_id: '222', ad_name: '광고' }, change: { element: '문구', before: '', after: 'x', method: 'edit' }, compare: { days: 7, before: { since: '2026-09-16', until: '2026-09-22' }, after: { since: '2026-09-23', until: '2026-09-29' } },
    baseline: { metrics: { days: 7, missing_days: 0, spend: 70000, purchases: { value: 2, observed: true }, purchase_value: { value: 60000, observed: true }, roas: 0.86, link_ctr: 1 } }, basis: { currency: 'KRW', attribution: 'A', margin: null }, concurrent: [], memo: '' } });
  await pv.window.LaunchRoasAdlog.refresh(); await tick(); mn = await bootMain();
  const tbody = mn.doc.getElementById('adlogTbody').innerHTML;
  check('변경 기록: 운영 메인 ₩NaN 없음 · 합계 제외 태그 · 합계 그대로', !/NaN/.test(tbody) && /변경 기록 · 합계 제외/.test(tbody) && mainTotal(mn) === '₩12,000' && pv.$('adlogTotalSpend').textContent === '₩12,000', { main: mainTotal(mn) });

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log((r.ok ? '통과' : '실패') + ' · ' + r.name + (r.ok ? '' : ' · ' + JSON.stringify(r.detail))));
  console.log(JSON.stringify({ checks: results.length, failed: failed.length, shared_rows: shared.rows.length, public_db_writes: 0 }));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
