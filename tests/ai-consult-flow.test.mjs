// AI 컨설턴트 최소 흐름 — 실제 ai-weekly-review/index.ts를 Node에서 실행한다(Deno 전용 import만 가짜, tests/helpers 참고).
// 실행: node --test tests/ai-consult-flow.test.mjs
// Supabase · Meta · Anthropic은 모두 가짜이며 네트워크에 나가지 않는다(유료 호출 없음).
// 확인: 사업 정보 · 지난 실행 기록이 AI 입력에 들어가고, 진행 중인 실행 · 사용자 제약에 걸리는 변경안은 서버가 빼며,
//       결과에 사장님용 요약이 남는다. 기존 비용 예약(예약 → 호출 → 정산)과 주 1회 기록은 그대로다.
//       사업 정보 · 실행 기록을 확인하지 못하면(조회 실패 · 상한 초과) AI를 부르지 않는다.
// 가짜 tool_records는 쿼리 조건 · 정렬 · 상한 · 범위를 실제처럼 적용한다 — '상한 밖 기록 누락'을 재현하기 위해.
import test from "node:test";
import assert from "node:assert/strict";
import { loadFunction, jsonRequest, fakeSupabase, setCtx, setEnv, fakeFetch, jsonResponse } from "./helpers/edge-function-harness.mjs";
import { weekRanges } from "../supabase/functions/_shared/ai-weekly-core.mjs";
import * as consult from "../supabase/functions/_shared/ai-consult-core.mjs";
import { POLICY_VERSION, PLAYBOOK_VERSION } from "../supabase/functions/_shared/ai-policy.mjs";

const { CONSULT_VERSION } = consult;
const ENV = { LAUNCHROAS_ANTHROPIC_API_KEY: "sk-test", AI_WEEKLY_ENABLED: "true", AI_MAX_ADS: "5", AI_MONTHLY_BUDGET_USD: "30" };
setEnv(ENV);
const aiWeekly = await loadFunction("ai-weekly-review");
// 정책을 켠 같은 함수(시크릿 AI_POLICY_VERSION은 모듈을 불러올 때 읽는다) — 운영 시크릿과 무관한 테스트 환경 값
setEnv({ ...ENV, AI_POLICY_VERSION: POLICY_VERSION });
const aiWeeklyPolicy = await loadFunction("ai-weekly-review", "policy-on");
setEnv(ENV);
const weeks = weekRanges(new Date());
const FUTURE = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

let seq = 0;
const row = (tool_type, data, created_at) => ({ id: ++seq, user_id: "user-1", tool_type, created_at, data });
const profileRow = (store, at = "2026-10-07T00:00:00Z") => row("business_profile",
  { store_id: String(store), objective: "판매", target_roas_pct: 300, monthly_budget_cap_krw: null, cannot_change: ["예산 늘리기"], saved_at: at }, at);
const changeData = (action, ad, name, until, store = "4") => ({ source: "change", action_id: action, store_id: store, date: "2026-09-20",
  ad: { ad_id: ad, adset_id: "s" + ad, ad_name: name, new_ad_id: null }, entry: "ai_suggestion",
  change: { element: "문구", before: "예전", after: "새 문구", method: "edit", applied_confirmed: true },
  compare: { days: 7, before: { since: "2026-09-13", until: "2026-09-19" }, after: { since: "2026-09-20", until } } });
const RECORDS = () => [profileRow(4),
  row("ad_log", changeData("A1", "111", "가을 니트 A", FUTURE), "2026-10-01T00:00:00Z"),
  row("ad_log", changeData("A9", "999", "여름 원피스", "2026-09-26"), "2026-10-01T00:00:01Z")];

// 실제 PostgREST처럼: 조건(eq · neq · in, data->>키 포함) → 정렬 → 범위 → 상한
const get = (r, col) => (col.includes("->>") ? (r[col.split("->>")[0]] || {})[col.split("->>")[1]] : r[col]);
const cmp = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));
function applyQuery(rows, q) {
  let out = rows.filter((r) => q.filters.every(([k, col, v]) => (k === "eq" ? String(get(r, col)) === String(v)
    : k === "neq" ? String(get(r, col)) !== String(v) : k === "in" ? v.map(String).includes(String(get(r, col))) : true)));
  const orders = q.orders || [];
  out = out.slice().sort((a, b) => { for (const [col, asc] of orders) { const c = cmp(a[col], b[col]); if (c) return asc ? c : -c; } return 0; });
  if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
  if (q.limit != null) out = out.slice(0, q.limit);
  return out;
}

// 가짜 모델: 광고마다 같은 판단. requires(행동에 필요한 조건)를 구조로 선언한다 — 증액 · 할인 · 촬영 모두 필요 없음
const NONE = { budget: "none", discount_price: false, new_shoot: false };
const DEFAULT_OUT = (id) => ({ ad_id: id, verdict: "개선 필요", headline: "클릭률이 같은 목적 광고보다 낮음", next_action: "첫 줄을 바꾼 새 광고 추가", priority: 1,
  evidence: [{ metric: "metrics_current.link_ctr_pct", note: "클릭률" }], hypotheses: [], limits: [],
  recommendation: { element: "문구", basis: "첫 줄이 할인 안내뿐", current: "가을 니트 할인", proposed: "첫 줄을 소재 강점으로", example: "울 50% 니트", test: { method: "새 광고", compare_metrics: [], decision_rule: "", sample_note: "" } },
  budget_note: null, requires: { next_action: NONE, recommendation: NONE, budget_note: null } });

function setup({ toolRecordsError = null, records = RECORDS(), out = DEFAULT_OUT } = {}) {
  const seqLog = [], graphCalls = [];
  const rowState = { current: null };
  const user = fakeSupabase({
    stores: () => ({ data: { id: 4 } }),
    connected_accounts: () => ({ data: { id: 7, status: "connected", external_account_id: "act_1" } }),
    tool_records: (q) => (toolRecordsError ? { error: toolRecordsError } : { data: applyQuery(records, q) }),
  });
  const admin = fakeSupabase({
    ai_weekly_reviews: (q) => {
      if (q.op === "select") return { data: rowState.current };
      if (q.op === "insert") { rowState.current = { id: 11, retry_count: 0, usage: {}, cost_usd: 0, reserved_cost_usd: 0, batches: [], result: null, ...q.values }; return { data: rowState.current }; }
      if (q.op === "update") { rowState.current = { ...rowState.current, ...q.values }; return { data: rowState.current }; }
      return { data: null };
    },
    integration_credentials: () => ({ data: { access_token: "meta-token", access_token_expires_at: new Date(Date.now() + 864e5).toISOString() } }),
    "rpc:ai_month_spent": () => ({ data: 0 }),
    "rpc:ai_budget_reserve": () => { seqLog.push("reserve"); return { data: [{ ok: true, reservation_id: 99, spent_usd: 0, reason: null }] }; },
    "rpc:ai_budget_settle": () => { seqLog.push("settle"); return { data: null }; },
  });
  setCtx({ supabase: user, supabaseAdmin: admin });
  const anthropic = [];
  fakeFetch((url, init) => {
    if (url.includes("api.anthropic.com")) {
      seqLog.push("anthropic");
      const body = JSON.parse(init.body);
      anthropic.push(body);
      const id = /ad_id: (\d+)\)/.exec(body.messages[0].content.at(-1).text)[1];
      return jsonResponse(200, { content: [{ type: "text", text: JSON.stringify([out(id)]) }], usage: { input_tokens: 1000, output_tokens: 500 }, stop_reason: "end_turn" });
    }
    if (url.includes("graph.facebook.com")) {
      graphCalls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("/act_1/insights")) {
        const since = JSON.parse(u.searchParams.get("time_range")).since;
        return jsonResponse(200, { data: since === weeks.current.since ? [insightRow("111", 50000, 2), insightRow("222", 40000, 1)] : [insightRow("111", 45000, 2)] });
      }
      if (u.pathname.endsWith("/act_1")) return jsonResponse(200, { currency: "KRW", timezone_name: "Asia/Seoul" });
      const id = u.pathname.split("/").pop();
      if (id.startsWith("s")) return jsonResponse(200, { optimization_goal: "OFFSITE_CONVERSIONS", attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }], targeting: {} });
      return jsonResponse(200, { creative: { body: "가을 니트 할인", call_to_action_type: "SHOP_NOW", image_url: "https://img.test/" + id + ".jpg" } });
    }
    if (url.startsWith("https://img.test/")) return new Response("not an image", { status: 200, headers: { "content-type": "text/plain" } });
    throw new Error("unexpected fetch " + url);
  });
  return { seq: seqLog, anthropic, admin, row: rowState, user, graphCalls };
}
const insightRow = (ad, spend, ctr) => ({ ad_id: ad, ad_name: "광고 " + ad, adset_id: "s" + ad, adset_name: "세트 " + ad, campaign_name: "전환", objective: "OUTCOME_SALES",
  spend: String(spend), impressions: "10000", reach: "8000", frequency: "1.25", clicks: String(ctr * 100), inline_link_clicks: String(ctr * 100),
  actions: [{ action_type: "landing_page_view", value: String(ctr * 80) }, { action_type: "offsite_conversion.fb_pixel_purchase", value: "5" }],
  action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: String(spend * 3) }] });
const SALES = { current: { gross_sales_krw: 900000, sold_qty: 20, linked_qty: 20, margin_total_krw: 300000, partial: false, estimated_orders: 0 }, previous: null };
const run = (fn = aiWeekly) => fn(jsonRequest({ store_id: 4, action: "run", sales: SALES, fx_krw_per_unit: null }));
const forAd = (s, id) => s.anthropic.map((r) => r.messages[0].content.map((c) => c.text || "").join("\n")).find((t) => t.includes(`<ad_data ad_id="${id}">`));

test("실행: 사업 정보 · 지난 실행 기록을 AI 입력에 넣고, 예약 → 호출 → 정산 순서는 그대로", async () => {
  const s = setup();
  const res = await run();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true, JSON.stringify(body).slice(0, 300));
  assert.equal(body.status, "completed");
  assert.equal(s.anthropic.length, 2, "광고 2개 = 호출 2회");
  assert.deepEqual(s.seq, ["reserve", "anthropic", "anthropic", "settle"], "그룹 예약 → 호출 → 정산");
  for (const req of s.anthropic) {
    assert.ok(req.system.includes(CONSULT_VERSION), "지시문에 사업 정보 · 지난 실행 규칙");
    const ctx = req.messages[0].content[0].text;
    assert.match(ctx, /"objective":"판매"/);
    assert.match(ctx, /"target_roas_pct":300/);
    assert.match(ctx, /"cannot_change":\["예산 늘리기"\]/);
  }
  assert.match(forAd(s, "111"), /"previous_actions":\[\{"element":"문구"[^\]]*"blocks_new_change":true/);
  assert.doesNotMatch(forAd(s, "222"), /previous_actions/, "실행 기록이 없는 광고에는 넣지 않는다(기존 입력 그대로)");
  // 사용자 권한(RLS) 클라이언트로 본인 · 이 쇼핑몰 기록만 — 실행 기록은 변경 · 결과만(일반 광고 기록 제외)
  const reads = s.user.calls.filter((q) => q.table === "tool_records");
  for (const q of reads) {
    assert.ok(q.op === "select" && q.filters.some((f) => f[0] === "eq" && f[1] === "user_id" && f[2] === "user-1"), JSON.stringify(q.filters));
    assert.ok(q.filters.some((f) => f[0] === "eq" && f[1] === "data->>store_id" && f[2] === "4"), "쇼핑몰은 쿼리에서 먼저 거른다");
  }
  assert.deepEqual(reads.find((q) => q.filters.some((f) => f[2] === "ad_log")).filters.find((f) => f[0] === "in"), ["in", "data->>source", ["change", "change_result"]]);
});

test("실행 결과: 진행 중인 실행이 있는 광고는 새 변경안을 빼고, 요약은 결과 확인 → AI 우선 확인 순서", async () => {
  setup();
  const body = await (await run()).json();
  const r = body.result;
  const ad = (id) => r.ads.find((a) => a.ad_id === id).analysis;
  assert.equal(ad("111").recommendation, null);
  assert.equal(ad("111").next_action, "진행 중인 ‘문구’ 변경의 결과를 먼저 확인");
  assert.deepEqual(ad("111").consult_adjusted, ["진행 중인 실행 기록이 있어 새 변경안을 내지 않음(비교가 깨지지 않게)"]);
  assert.equal(ad("222").recommendation.element, "문구", "조건을 구조로 선언했고 제약에 걸리지 않으면 그대로");
  assert.equal(r.brief.version, CONSULT_VERSION);
  assert.deepEqual(r.brief.todos.map((t) => t.what), ["‘여름 원피스 · 문구 변경’ 결과 비교하기", "광고 222: 첫 줄을 바꾼 새 광고 추가"]);
  assert.equal(r.brief.status[0], "지난주 광고비 차감 후 예상 이익 210,000원");
  assert.equal(r.consult.load, "ok");
  assert.deepEqual(r.consult.profile.cannot_change, ["예산 늘리기"]);
  assert.equal(r.snapshot, undefined, "사용자 응답에는 스냅샷을 내리지 않는다");
});

// ---- 2026-10-08 검토 보완: 조회 실패 · 상한 초과 · 상한 밖 누락 ----
test("사업 정보 · 실행 기록 조회가 실패하면 빈 입력으로 진행하지 않는다 — AI · 예약 · Meta 호출 없이 실패로 끝내고 이용 횟수는 그대로", async () => {
  const s = setup({ toolRecordsError: { message: "timeout" } });
  const body = await (await run()).json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "failed");
  assert.match(body.error, /사업 정보 · 실행 기록을 불러오지 못해 점검하지 않았어요/);
  assert.match(body.error, /이용 횟수는 차감되지 않았어요/);
  assert.equal(s.anthropic.length, 0, "유료 호출 없음");
  assert.deepEqual(s.seq, [], "비용 예약도 없음");
  assert.equal(s.graphCalls.length, 0, "제약을 확인하기 전에는 Meta도 부르지 않는다");
  assert.equal(body.quota.can_run, true, "실패는 이용 횟수에 넣지 않는다(다시 시도 가능)");
});

test("사업 정보는 쿼리에서 이 쇼핑몰을 먼저 거른다 — 다른 쇼핑몰 기록이 많아도 이 쇼핑몰 목표 · 제약을 쓴다", async () => {
  const others = Array.from({ length: 30 }, (_, i) => profileRow(9, `2026-10-08T00:00:${String(i).padStart(2, "0")}Z`)); // 더 최근 · 다른 쇼핑몰
  const s = setup({ records: [...others, ...RECORDS()] });
  const body = await (await run()).json();
  assert.equal(body.status, "completed", JSON.stringify(body).slice(0, 200));
  assert.match(s.anthropic[0].messages[0].content[0].text, /"objective":"판매"/);
  assert.deepEqual(body.result.consult.profile.cannot_change, ["예산 늘리기"]);
});

test("실행 기록도 쇼핑몰로 거르고 끝까지 읽는다 — 다른 쇼핑몰 기록이 예전 상한(500)을 넘어도 진행 중 실행을 놓치지 않는다", async () => {
  const others = Array.from({ length: 600 }, (_, i) => row("ad_log", changeData("X" + i, "8" + i, "다른 쇼핑몰", FUTURE, "9"), `2026-10-05T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`));
  const s = setup({ records: [...others, ...RECORDS()] });
  const body = await (await run()).json();
  assert.equal(body.status, "completed");
  assert.match(forAd(s, "111"), /"blocks_new_change":true/, "상한 밖으로 밀린 진행 중 실행도 AI 입력에 들어간다");
  assert.equal(body.result.ads.find((a) => a.ad_id === "111").analysis.recommendation, null);
});

test("실행 기록이 조회 상한을 넘어 완전성을 확인할 수 없으면 점검하지 않는다 — AI · 예약 없음, 이유 표시", async () => {
  const many = Array.from({ length: consult.CONSULT_MAX_ROWS + 1 }, (_, i) => row("ad_log", { ...changeData("M" + i, "7" + i, "광고", "2026-09-26"), store_id: "4" }, "2026-09-30T00:00:00Z"));
  const s = setup({ records: [profileRow(4), ...many] });
  const body = await (await run()).json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "failed");
  assert.match(body.error, /실행 기록이 조회 한도를 넘어 모두 확인하지 못해 점검하지 않았어요/);
  assert.equal(s.anthropic.length, 0);
  assert.deepEqual(s.seq, []);
});

test("사용자 제약: recommendation이 null이어도 next_action · budget_note의 증액 권고를 막고, 요약 할 일과 맞춘다", async () => {
  const out = (id) => id === "222"
    ? { ...DEFAULT_OUT(id), recommendation: null, next_action: "예산을 20% 늘려 1주 비교", budget_note: "구매가 늘어 예산 증액을 검토",
        requires: { next_action: { budget: "increase", discount_price: false, new_shoot: false }, recommendation: null, budget_note: "increase" } }
    : DEFAULT_OUT(id);
  setup({ out });
  const r = (await (await run()).json()).result;
  const a = r.ads.find((x) => x.ad_id === "222").analysis;
  assert.equal(a.recommendation, null);
  assert.equal(a.next_action, "사업 정보 제약(예산 늘리기)에 맞지 않아 이번 주 변경안 없음");
  assert.equal(a.budget_note, null);
  assert.deepEqual(a.consult_held, { reason: "constraint", labels: ["예산 늘리기"] });
  assert.ok(!r.brief.todos.some((t) => /예산|222/.test(t.what)), JSON.stringify(r.brief.todos));
  assert.ok(r.brief.status.includes("사업 정보 제약으로 변경안을 보류한 광고 1개(예산 늘리기)"));
});

// 정책 · 플레이북(docs/ai → ai-policy.mjs 압축본)은 문서가 있다고 쓰이는 게 아니다 — 시크릿이 POLICY_VERSION과 같을 때만 실제 모델 요청에 들어간다
test("정책 꺼짐(기본): 모델 요청에 분석 기준 · 참고 사례가 없고, 결과에 정책 버전 없음", async () => {
  const s = setup();
  const body = await (await run()).json();
  assert.equal(body.status, "completed");
  for (const req of s.anthropic) {
    assert.ok(!req.system.includes("[분석 기준 "), "정책 지시문 없음");
    assert.ok(req.system.includes(CONSULT_VERSION), "사업 정보 · 지난 실행 규칙은 정책과 무관하게 붙는다");
    assert.ok(!req.messages[0].content.some((c) => (c.text || "").includes("<reference_cases")), "참고 사례 없음");
  }
  assert.equal(body.result.policy_version, null);
  assert.equal(body.result.playbook_version, null);
});

test("정책 켜짐: 모델 요청에 분석 기준(버전 포함) · 서버가 고른 참고 사례가 들어가고, 결과에 정책 · 플레이북 버전이 남는다", async () => {
  const s = setup();
  const body = await (await run(aiWeeklyPolicy)).json();
  assert.equal(body.status, "completed");
  for (const req of s.anthropic) {
    assert.ok(req.system.includes(`[분석 기준 ${POLICY_VERSION}]`), "정책 지시문");
    assert.ok(req.system.includes(CONSULT_VERSION), "사업 정보 · 지난 실행 규칙도 함께");
  }
  const texts = s.anthropic.map((r) => r.messages[0].content.map((c) => c.text || "").join("\n"));
  assert.ok(texts.some((t) => t.includes('<reference_cases ad_id="222">')), "클릭률이 낮은 광고에 참고 사례");
  assert.equal(body.result.policy_version, POLICY_VERSION);
  assert.equal(body.result.playbook_version, PLAYBOOK_VERSION);
});
