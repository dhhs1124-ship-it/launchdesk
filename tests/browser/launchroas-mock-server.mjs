// LaunchROAS 화면을 실제 브라우저에서 '모의 데이터'로 확인하는 로컬 서버 — 운영 DB · Meta · Cafe24 · Anthropic에 접속하지 않는다.
// - 화면: launchroas/ 파일 그대로. index.html만 supabase-js(CDN) 대신 /__mock__/client.js(가짜 클라이언트)를 넣는다.
// - 서버 함수: ai-weekly-review · meta-adset-insights · meta-insights · cafe24-order-items는 실제 index.ts를 Node에서 실행한다
//   (tests/helpers/edge-function-harness.mjs). 외부 API는 이 프로세스 안의 가짜 응답, DB는 메모리(서버를 끄면 사라짐).
// - AI는 이 프로세스 안에서만 켠다(AI_WEEKLY_ENABLED=true · 가짜 키) — 운영 시크릿과 무관하고 모델 응답도 가짜다.
// 실행: node tests/browser/launchroas-mock-server.mjs [포트=5178] [기록 폴더]
//   화면 http://127.0.0.1:5178/ · 주간 점검 초기화 POST /__mock__/reset-review · 전체 초기화 POST /__mock__/reset
//   시나리오 POST /__mock__/control {"failProfileInsert"|"failConsultLoad"|"omitRequires"|"budgetDecrease": true}
//   데이터 추가 POST /__mock__/seed {"oldProfiles": 30} (조회 상한 밖 예전 점검 기준) · {"bulkLogs": 2001} (실행 기록 조회 상한 초과)
//   상태 GET /__mock__/state · 모델 요청 요약 GET /__mock__/anthropic (기록 폴더를 주면 파일로도 남긴다)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadFunction, fakeSupabase, setCtx, setEnv, fakeFetch, jsonResponse } from "../helpers/edge-function-harness.mjs";
import { weekRanges } from "../../supabase/functions/_shared/ai-weekly-core.mjs";
import { CONSULT_VERSION } from "../../supabase/functions/_shared/ai-consult-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(ROOT, "launchroas");
const PORT = Number(process.argv[2] || 5178);
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : null;
const BASE = `http://127.0.0.1:${PORT}`;
const C = createRequire(import.meta.url)("../../launchroas/adlog-change-core.js");

const USER = "u-demo", STORE = 4, CAFE = 6, META = 7, MALL = "demomall", ACT = "act_1", DAY = 864e5;
const W = weekRanges(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const THIS_MONDAY = addDays(W.current.since, 7);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// ---- 가짜 광고 · 주문 (개인정보 없음) ----
const ADS = [
  { id: "111", name: "가을 니트 A · 할인 첫 줄", set: "s111", setName: "니트 · 전환", body: "가을 니트 20% 할인 — 이번 주만", title: "울 50% 니트",
    cur: { spend: 52000, imp: 12000, reach: 9000, clicks: 310, link: 240, lpv: 196, atc: 31, ic: 12, pur: 6, val: 186000 },
    prev: { spend: 47000, imp: 11500, reach: 8800, clicks: 300, link: 236, lpv: 190, atc: 30, ic: 12, pur: 6, val: 180000 } },
  { id: "222", name: "봄 셔츠 B · 신규", set: "s222", setName: "셔츠 · 전환", body: "셔츠 신상 입고", title: "오버핏 셔츠",
    cur: { spend: 41000, imp: 13000, reach: 10400, clicks: 160, link: 117, lpv: 90, atc: 9, ic: 3, pur: 2, val: 58000 }, prev: null },
  { id: "333", name: "데님 팬츠 C", set: "s333", setName: "데님 · 전환", body: "핏 고민 끝, 데님 3컬러", title: "스트레이트 데님",
    cur: { spend: 36000, imp: 9000, reach: 7000, clicks: 250, link: 198, lpv: 170, atc: 25, ic: 10, pur: 5, val: 165000 },
    prev: { spend: 30000, imp: 8000, reach: 6200, clicks: 160, link: 150, lpv: 120, atc: 15, ic: 6, pur: 2, val: 64000 } },
];
const PRODUCTS = { 101: ["울 니트", 59000], 102: ["오버핏 셔츠", 39000], 103: ["스트레이트 데님", 49000] };
const ORDERS = [];
for (let d = W.previous.since, n = 0; d <= kstToday(); d = addDays(d, 1)) {
  const i = Math.round(Date.parse(d) / DAY) % 7, lines = [[101, 1 + (i % 2)]];
  if (i % 3 === 0) lines.push([102, 1]);
  if (i % 4 === 1) lines.push([103, 1]);
  const items = lines.map(([no, q], k) => ({ item_no: k + 1, product_no: no, variant_code: `P${no}A`, product_name: PRODUCTS[no][0], option_value: "FREE",
    quantity: q, claim_quantity: 0, product_price: String(PRODUCTS[no][1]), option_price: "0", order_status: "N40", status_code: "N1", shipping_code: `S${n}${k}` }));
  const total = items.reduce((t, it) => t + Number(it.product_price) * it.quantity, 0);
  ORDERS.push({ order_id: `MOCK-${d}-${++n}`, order_date: `${d}T13:00:00+09:00`, paid: "T", canceled: "F", payment_amount: String(total),
    actual_order_amount: { order_price_amount: String(total), shipping_fee: "0", payment_amount: String(total), total_amount_due: "0" }, items });
}

// ---- 메모리 DB ----
let seq = 1000;
const nowIso = () => new Date().toISOString();
function record(tool_type, data, at = nowIso()) { return { id: ++seq, user_id: USER, tool_type, created_at: at, data }; }
function change(ad, element, after, startDate, days) {
  const r = C.buildChangeRecord({ storeId: STORE, ad: { ad_id: ad.id, adset_id: ad.set, ad_name: ad.name }, element, after, before: "", startDate, compareDays: days,
    baseline: { metrics: { spend: 1, missing_days: 0 } }, basis: { currency: "KRW" }, method: "edit", entry: "ai_suggestion", appliedConfirmed: true }, Date.parse(startDate + "T03:00:00Z"));
  if (!r.ok) throw new Error("모의 실행 기록: " + r.errors.join(", "));
  return r.record;
}
function seed() {
  const far = new Date(Date.now() + 60 * DAY).toISOString(), at = nowIso();
  const inProgress = change(ADS[0], "문구", "첫 줄을 '울 50% · 따갑지 않은 니트'로", THIS_MONDAY, 7);
  const awaiting = change({ id: "999", set: "s999", name: "여름 원피스 D" }, "이미지", "모델 착용 컷으로 교체", addDays(W.previous.since, -14), 7);
  const done = change(ADS[2], "이미지", "3컬러를 한 장에 비교한 이미지", addDays(W.previous.since, -21), 7);
  const result = C.buildResultRecord(done, null, { status: "improved", reasons: [], warnings: [], provisional: false, blockers: [],
    observations: ["구매당 광고비 15,000원 → 9,000원(같은 광고 · 같은 기간 길이)"] }, Date.parse(addDays(W.previous.since, -7) + "T03:00:00Z"));
  return {
    stores: [{ id: STORE, user_id: USER, name: "데모 의류몰(모의)", platform: "cafe24" }],
    connected_accounts: [
      { id: CAFE, user_id: USER, store_id: STORE, provider: "cafe24", status: "connected", external_account_id: MALL, last_synced_at: at, orders_synced_from: W.previous.since, updated_at: at },
      { id: META, user_id: USER, store_id: STORE, provider: "meta", status: "connected", external_account_id: ACT, last_synced_at: at, updated_at: at }],
    integration_credentials: [
      { connected_account_id: CAFE, access_token: "mock-cafe24-token", refresh_token: "mock-refresh", access_token_expires_at: far, refresh_token_expires_at: far, updated_at: at },
      { connected_account_id: META, access_token: "mock-meta-token", access_token_expires_at: far, updated_at: at }],
    tool_records: [
      record("product_margin_link", { store_id: String(STORE), product_no: 101, variant_code: "", product_name: "울 니트", unit_margin: 21000, order_adjust: -3500, saved_at: at }),
      record("product_margin_link", { store_id: String(STORE), product_no: 102, variant_code: "", product_name: "오버핏 셔츠", unit_margin: 12000, order_adjust: -3500, saved_at: at }),
      record("ad_log", done, done.recorded_at), record("ad_log", result, result.measured_at),
      record("ad_log", awaiting, awaiting.recorded_at), record("ad_log", inProgress, inProgress.recorded_at)],
    ai_weekly_reviews: [], ad_margin_links: [],
    orders: ORDERS.map((o) => ({ store_id: STORE, ordered_at: o.order_date, payment_amount: Number(o.payment_amount) })),
  };
}
let DB = seed();
const FLAG_DEFAULTS = { failProfileInsert: false, failConsultLoad: false, omitRequires: false, budgetDecrease: false };
const FLAGS = { ...FLAG_DEFAULTS };

function field(row, col) {
  if (col.includes("->>")) { const [base, key] = col.split("->>"); return row[base] == null ? null : row[base][key] ?? null; }
  return row[col];
}
const same = (a, b) => a != null && b != null && String(a) === String(b);
function cmp(a, b) {
  const da = Date.parse(a), db = Date.parse(b);
  if (typeof a === "string" && typeof b === "string" && !Number.isNaN(da) && !Number.isNaN(db) && /\d{4}-\d{2}-\d{2}/.test(a)) return da - db;
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : String(a).localeCompare(String(b));
}
function match(row, [kind, col, val]) {
  const v = field(row, col);
  if (kind === "eq") return same(v, val);
  if (kind === "neq") return !same(v, val);
  if (kind === "in") return (val || []).some((x) => same(v, x));
  if (kind === "is") return val === null ? v == null : v === val;
  if (v == null) return false;
  if (kind === "gt") return cmp(v, val) > 0;
  if (kind === "gte") return cmp(v, val) >= 0;
  if (kind === "lt") return cmp(v, val) < 0;
  if (kind === "lte") return cmp(v, val) <= 0;
  throw new Error("모의 DB: 지원하지 않는 조건 " + kind);
}
function shape(rows, mode) {
  rows = structuredClone(rows);
  if (mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
  if (mode === "maybeSingle") return rows.length <= 1 ? { data: rows[0] || null, error: null } : { data: null, error: { code: "PGRST116", message: "multiple rows" } };
  return { data: rows, error: null };
}
// browser=true: 화면에서 온 요청 — tool_records는 RLS처럼 본인 행만
function runQuery(q, { browser }) {
  const t = DB[q.table] || (DB[q.table] = []);
  if (q.table === "user_policy_consents" && q.op === "select") return { data: [{ id: 1 }], error: null };
  const rls = browser && q.table === "tool_records";
  // 서버 함수의 사업 정보 · 실행 기록 조회 실패(시나리오) — 화면 자체 조회는 그대로
  if (!browser && FLAGS.failConsultLoad && q.table === "tool_records" && q.op === "select") return { data: null, error: { code: "MOCK", message: "모의 조회 실패(시나리오)" } };
  const hit = () => t.filter((r) => (!rls || r.user_id === USER) && (q.filters || []).every((f) => match(r, f)));
  if (q.op === "insert" || q.op === "upsert") {
    const vals = (Array.isArray(q.values) ? q.values : [q.values]).map((v) => ({ id: v.id ?? ++seq, created_at: nowIso(), ...v }));
    if (rls && vals.some((v) => v.user_id !== USER)) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
    if (FLAGS.failProfileInsert && q.table === "tool_records" && vals.some((v) => v.tool_type === "business_profile")) {
      return { data: null, error: { code: "MOCK", message: "모의 저장 실패(시나리오)" } };
    }
    t.push(...vals);
    return shape(vals, q.mode);
  }
  let rows = hit();
  if (q.op === "update") { for (const r of rows) Object.assign(r, structuredClone(q.values)); return shape(rows, q.mode); }
  if (q.op === "delete") { DB[q.table] = t.filter((r) => !rows.includes(r)); return { data: q.returning ? structuredClone(rows) : null, error: null }; }
  // 정렬: 요청한 순서, 없으면 최신순(tool_records — 실제 함수 코드가 created_at 내림차순으로 요청한다)
  const orders = q.orders && q.orders.length ? q.orders : q.table === "tool_records" ? [["created_at", false], ["id", false]] : [];
  if (orders.length) rows = rows.slice().sort((a, b) => { for (const [col, asc] of orders) { const c = cmp(a[col], b[col]); if (c) return asc ? c : -c; } return 0; });
  if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
  if (q.limit != null) rows = rows.slice(0, q.limit);
  return shape(rows, q.mode);
}
let reservation = 0;
const RPC = {
  ai_month_spent: () => ({ data: 0 }),
  ai_budget_reserve: () => ({ data: [{ ok: true, reservation_id: ++reservation, spent_usd: 0, reason: null }] }),
  ai_budget_settle: () => ({ data: null }),
};
const handlers = new Proxy({}, { get: (_, key) => (String(key).startsWith("rpc:") ? RPC[String(key).slice(4)] : (q) => runQuery(q, { browser: false })) });
setCtx({ supabase: fakeSupabase(handlers), supabaseAdmin: fakeSupabase(handlers), userId: USER });

// ---- 가짜 외부 API(이 프로세스의 fetch 전체) — 목록에 없는 주소는 막는다 ----
const EXTERNAL = [], ANTHROPIC = [];
function presetRange(p) {
  const today = kstToday();
  if (p === "today") return [today, today];
  if (p === "yesterday") return [addDays(today, -1), addDays(today, -1)];
  if (p === "this_month") return [today.slice(0, 8) + "01", today];
  if (p === "last_7d") return [addDays(today, -7), addDays(today, -1)];
  if (p === "last_30d") return [addDays(today, -30), addDays(today, -1)];
  return [W.previous.since, today];
}
function metricsFor(ad, since, until) {
  if (since === W.current.since && until === W.current.until) return ad.cur;
  if (since === W.previous.since && until === W.previous.until) return ad.prev;
  const k = (Math.round((Date.parse(until) - Date.parse(since)) / DAY) + 1) / 7;
  return Object.fromEntries(Object.entries(ad.cur).map(([key, v]) => [key, Math.round(v * k)]));
}
function insightsRow(ad, m, level, since, until) {
  const ids = level === "account" ? {} : { campaign_id: "c1", campaign_name: "가을 신상 · 전환", objective: "OUTCOME_SALES", adset_id: ad.set, adset_name: ad.setName,
    ...(level === "ad" ? { ad_id: ad.id, ad_name: ad.name } : {}) };
  return { ...ids, spend: String(m.spend), impressions: String(m.imp), reach: String(m.reach), frequency: (m.imp / m.reach).toFixed(2), clicks: String(m.clicks),
    inline_link_clicks: String(m.link), optimization_goal: "OFFSITE_CONVERSIONS", date_start: since, date_stop: until,
    actions: [["link_click", m.link], ["landing_page_view", m.lpv], ["add_to_cart", m.atc], ["initiate_checkout", m.ic], ["offsite_conversion.fb_pixel_purchase", m.pur]]
      .map(([action_type, value]) => ({ action_type, value: String(value) })),
    action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: String(m.val) }] };
}
function graph(u) {
  const [, node, edge] = u.pathname.split("/").filter(Boolean);
  if (node === ACT && edge === "insights") {
    const level = u.searchParams.get("level") || "account", tr = u.searchParams.get("time_range");
    const [since, until] = tr ? [JSON.parse(tr).since, JSON.parse(tr).until] : presetRange(u.searchParams.get("date_preset"));
    const only = u.searchParams.get("filtering") ? JSON.parse(u.searchParams.get("filtering"))[0].value.map(String) : null;
    const list = ADS.filter((a) => !only || only.includes(a.set)).map((a) => [a, metricsFor(a, since, until)]).filter(([, m]) => m);
    let data;
    if (level === "account") {
      const sum = {};
      for (const [, m] of list) for (const [k, v] of Object.entries(m)) sum[k] = (sum[k] || 0) + v;
      data = list.length ? [insightsRow(null, sum, "account", since, until)] : [];
    } else data = list.map(([a, m]) => insightsRow(a, m, level, since, until));
    return jsonResponse(200, { data, paging: { cursors: { before: "b", after: "a" } } });
  }
  if (node === ACT && !edge) return jsonResponse(200, { id: ACT, name: "데모 광고계정(모의)", currency: "KRW", timezone_name: "Asia/Seoul", account_status: 1 });
  if (node === "me" && edge === "adaccounts") return jsonResponse(200, { data: [{ id: ACT, name: "데모 광고계정(모의)", account_status: 1, currency: "KRW", timezone_name: "Asia/Seoul" }], paging: {} });
  const set = ADS.find((a) => a.set === node);
  if (set) return jsonResponse(200, { id: node, optimization_goal: "OFFSITE_CONVERSIONS", targeting: { age_min: 25, age_max: 44, geo_locations: { countries: ["KR"] } },
    attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }] });
  const ad = ADS.find((a) => a.id === node);
  if (ad) return jsonResponse(200, { id: ad.id, account_id: "1", name: ad.name, creative: { id: "cr" + ad.id, title: ad.title, body: ad.body, call_to_action_type: "SHOP_NOW",
    object_type: "SHARE", image_url: `${BASE}/__mock__/img/${ad.id}.png`, thumbnail_url: `${BASE}/__mock__/img/${ad.id}.png`, link_url: `https://demo-mall.example/product/${ad.id}` } });
  return jsonResponse(400, { error: { message: "모의 Graph: 모르는 노드 " + node, type: "OAuthException", code: 100 } });
}
function cafe24(u) {
  if (u.pathname === "/api/v2/admin/orders") {
    const s = u.searchParams.get("start_date"), e = u.searchParams.get("end_date"), off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 100);
    return jsonResponse(200, { orders: ORDERS.filter((o) => o.order_date.slice(0, 10) >= s && o.order_date.slice(0, 10) <= e).slice(off, off + lim) });
  }
  if (u.pathname === "/api/v2/admin/orders/coupons") return jsonResponse(200, { coupons: [] });
  if (u.pathname === "/api/v2/admin/store") return jsonResponse(200, { store: { shop_name: "데모 의류몰(모의)", mall_id: MALL } });
  return jsonResponse(404, { error: { code: 404, message: "모의 Cafe24: 없음" } });
}
// 가짜 모델 응답 — 광고마다 고정 판단 + requires(행동에 필요한 조건) 선언.
//   111 문구(조건 없음 — 진행 중 실행으로 막힘) · 222 할인 문구(할인 · 가격 필요) · 333 변경안 없이 '예산 20% 늘리기' 행동 + 증액 의견
//   budgetDecrease: 333을 감액으로 · omitRequires: 선언을 빼서 '확인 불가' 경로
const NONE = { budget: "none", discount_price: false, new_shoot: false };
function modelOut(ad_id) {
  const test = { method: "새 광고", compare_metrics: [], decision_rule: "", sample_note: "" };
  const o = ad_id === "111"
    ? { headline: "클릭률은 비슷하지만 구매당 광고비가 늘었음", next_action: "첫 줄을 바꾼 새 광고 추가", priority: 2, budget_note: null,
        recommendation: { element: "문구", basis: "첫 줄이 할인 안내뿐", current: "가을 니트 20% 할인 — 이번 주만", proposed: "첫 줄에 소재(울 50%)를 먼저", example: "울 50%라 따갑지 않은 니트", test },
        requires: { next_action: NONE, recommendation: NONE, budget_note: null } }
    : ad_id === "222"
    ? { headline: "클릭률이 같은 목적 광고 중앙값보다 낮음", next_action: "첫 줄에 할인 문구를 넣은 새 광고 추가", priority: 1, budget_note: null,
        recommendation: { element: "문구", basis: "문구가 '신상 입고'뿐", current: "셔츠 신상 입고", proposed: "첫 줄에 '이번 주 20% 할인'", example: "오버핏 셔츠 이번 주 20% 할인", test },
        requires: { next_action: { ...NONE, discount_price: true }, recommendation: { ...NONE, discount_price: true }, budget_note: null } }
    : FLAGS.budgetDecrease
    ? { headline: "구매당 광고비가 높아짐", next_action: "예산을 20% 줄여 1주 비교", priority: 3, recommendation: null, budget_note: "구매당 광고비가 높아 감액 검토",
        requires: { next_action: { ...NONE, budget: "decrease" }, recommendation: null, budget_note: "decrease" } }
    : { headline: "구매가 늘어 예산을 늘려 볼 만함", next_action: "예산을 20% 늘려 1주 비교", priority: 3, recommendation: null, budget_note: "구매가 늘어 예산 증액 검토",
        requires: { next_action: { ...NONE, budget: "increase" }, recommendation: null, budget_note: "increase" } };
  const out = { ad_id, verdict: "개선 필요", evidence: [{ metric: "metrics_current.link_ctr_pct", note: "클릭률" }], hypotheses: [], limits: [], ...o };
  if (FLAGS.omitRequires) delete out.requires;
  return out;
}
function summarize(body) {
  const blocks = body.messages[0].content, text = (b) => b.text || "";
  const ctx = JSON.parse(text(blocks[0]).slice(text(blocks[0]).indexOf("\n") + 1));
  const ads = blocks.filter((b) => text(b).startsWith("<ad_data")).map((b) => {
    const j = JSON.parse(text(b).split("\n").slice(1, -1).join("\n"));
    return { ad_id: j.ad_id, previous_actions: j.previous_actions || null };
  });
  return { at: nowIso(), model: body.model, system_has_consult_rules: body.system.includes(CONSULT_VERSION), system_has_policy: body.system.includes("[분석 기준 "),
    decision_inputs: ctx.decision_inputs, ads, images: blocks.filter((b) => b.type === "image").length, reference_cases: blocks.filter((b) => text(b).startsWith("<reference_cases")).length };
}
function anthropic(body) {
  const s = summarize(body);
  ANTHROPIC.push(s);
  if (OUT) fs.writeFileSync(path.join(OUT, "anthropic-requests.json"), JSON.stringify(ANTHROPIC, null, 2));
  const out = s.ads.map(({ ad_id }) => modelOut(ad_id));
  return jsonResponse(200, { content: [{ type: "text", text: JSON.stringify(out) }], usage: { input_tokens: 1200, output_tokens: 600 }, stop_reason: "end_turn" });
}
fakeFetch(async (url, init) => {
  const u = new URL(url);
  EXTERNAL.push(`${(init && init.method) || "GET"} ${u.host}${u.pathname}`);
  if (u.host === "graph.facebook.com") return graph(u);
  if (u.host === `${MALL}.cafe24api.com`) return cafe24(u);
  if (u.host === "api.anthropic.com") return anthropic(JSON.parse(init.body));
  if (u.origin === BASE && u.pathname.startsWith("/__mock__/img/")) return new Response(PNG, { headers: { "content-type": "image/png" } });
  return jsonResponse(599, { error: "모의 서버: 외부 네트워크 차단 — " + u.host });
});

setEnv({ LAUNCHROAS_ANTHROPIC_API_KEY: "mock-not-a-key", AI_WEEKLY_ENABLED: "true", AI_MAX_ADS: "10", AI_MONTHLY_BUDGET_USD: "30" });
const FUNCTIONS = {};
for (const name of ["ai-weekly-review", "meta-adset-insights", "meta-insights", "cafe24-order-items"]) FUNCTIONS[name] = await loadFunction(name);

// ---- HTTP ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { const parts = []; req.on("data", (c) => parts.push(c)); req.on("end", () => ok(Buffer.concat(parts))); });
function state() {
  const tr = DB.tool_records.filter((r) => r.tool_type === "business_profile").map((r) => ({ id: r.id, created_at: r.created_at, data: r.data }));
  const rv = DB.ai_weekly_reviews.map((r) => ({ id: r.id, status: r.status, brief: r.result && r.result.brief, consult: r.result && r.result.consult && { load: r.result.consult.load, profile: r.result.consult.profile },
    ads: r.result && (r.result.ads || []).map((a) => ({ ad_id: a.ad_id, recommendation: a.analysis && a.analysis.recommendation && a.analysis.recommendation.element, next_action: a.analysis && a.analysis.next_action, consult_adjusted: a.analysis && a.analysis.consult_adjusted })),
    policy_version: r.result && r.result.policy_version, reserved_cost_usd: r.reserved_cost_usd, cost_usd: r.cost_usd }));
  const hosts = {};
  for (const e of EXTERNAL) { const h = e.split(" ")[1].split("/")[0]; hosts[h] = (hosts[h] || 0) + 1; }
  return { flags: FLAGS, business_profile: tr, weekly_reviews: rv, fake_external_calls_by_host: hosts, anthropic_requests: ANTHROPIC.length };
}
async function mock(req, res, u) {
  const [, , kind, name] = u.pathname.split("/");
  const json = async () => { const b = (await readBody(req)).toString("utf8"); return b ? JSON.parse(b) : {}; };
  if (kind === "client.js") return send(res, 200, fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "launchroas-mock-client.js")), TYPES[".js"]);
  if (kind === "img") return send(res, 200, PNG, "image/png");
  if (kind === "db") return send(res, 200, runQuery(await json(), { browser: true }));
  if (kind === "rpc") return send(res, 200, RPC[name] ? RPC[name](await json()) : { data: null, error: { message: "모의 RPC 없음" } });
  if (kind === "fn") {
    if (!FUNCTIONS[name]) return send(res, 404, { ok: false, code: "MOCK_NOT_IMPLEMENTED", message: "모의 서버에서 실행하지 않는 함수: " + name });
    const r = await FUNCTIONS[name](new Request("https://fn.local/", { method: "POST", headers: { "content-type": "application/json" }, body: (await readBody(req)).toString("utf8") || "{}" }));
    return send(res, r.status, await r.text());
  }
  if (kind === "control") { if (req.method === "POST") Object.assign(FLAGS, await json()); return send(res, 200, FLAGS); }
  if (kind === "reset-review") { DB.ai_weekly_reviews = []; return send(res, 200, { ok: true }); }
  if (kind === "reset") { DB = seed(); Object.assign(FLAGS, FLAG_DEFAULTS); ANTHROPIC.length = 0; return send(res, 200, { ok: true }); }
  if (kind === "seed") {
    const b = await json(), base = Date.parse(W.previous.since + "T00:00:00Z") - 30 * DAY;
    for (let i = 0; i < (b.oldProfiles || 0); i++) {
      const at = new Date(base + i * 60000).toISOString();
      DB.tool_records.push(record("business_profile", { store_id: String(STORE), objective: "재구매", target_roas_pct: 250, monthly_budget_cap_krw: null, cannot_change: [], saved_at: at }, at));
    }
    for (let i = 0; i < (b.bulkLogs || 0); i++) {
      const at = new Date(base + i * 1000).toISOString();
      DB.tool_records.push(record("ad_log", { source: "change", action_id: "BULK" + i, store_id: String(STORE), date: W.previous.since, ad: { ad_id: "9" + i, adset_id: "s9" + i, ad_name: "예전 광고 " + i },
        change: { element: "문구", after: "예전 변경", method: "edit" }, compare: { days: 7, after: { since: W.previous.since, until: W.previous.until } } }, at));
    }
    return send(res, 200, { business_profile: DB.tool_records.filter((r) => r.tool_type === "business_profile").length, ad_log: DB.tool_records.filter((r) => r.tool_type === "ad_log").length });
  }
  if (kind === "state") { const s = state(); if (OUT) fs.writeFileSync(path.join(OUT, "mock-state.json"), JSON.stringify(s, null, 2)); return send(res, 200, s); }
  if (kind === "anthropic") return send(res, 200, ANTHROPIC);
  return send(res, 404, { error: "모의 경로 없음" });
}
function serveStatic(res, pathname) {
  const p = decodeURIComponent(pathname === "/" ? "/index.html" : pathname), file = path.join(WEB, p);
  if (!file.startsWith(WEB + path.sep)) return send(res, 403, "forbidden", "text/plain");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "not found", "text/plain");
  let body = fs.readFileSync(file);
  if (p === "/index.html") {
    const html = body.toString("utf8"), swapped = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"><\/script>/, '<script src="/__mock__/client.js"></script>');
    if (swapped === html) throw new Error("index.html에서 supabase-js 스크립트를 찾지 못함 — 운영 클라이언트가 실릴 수 있어 중단");
    body = Buffer.from(swapped);
  }
  return send(res, 200, body, TYPES[path.extname(file)] || "application/octet-stream");
}
if (OUT) fs.mkdirSync(OUT, { recursive: true });
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, BASE);
    if (u.pathname.startsWith("/__mock__/")) await mock(req, res, u);
    else serveStatic(res, u.pathname);
  } catch (e) { send(res, 500, { error: String((e && e.stack) || e) }); }
}).listen(PORT, "127.0.0.1", () => console.log(`LaunchROAS 모의 서버 ${BASE}/ — DB 메모리 · 외부 API 가짜 · 지난주 ${W.current.since}~${W.current.until}`));
