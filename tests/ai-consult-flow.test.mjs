// AI 컨설턴트 최소 흐름 — 실제 ai-weekly-review/index.ts를 Node에서 실행한다(Deno 전용 import만 가짜, tests/helpers 참고).
// 실행: node --test tests/ai-consult-flow.test.mjs
// Supabase · Meta · Anthropic은 모두 가짜이며 네트워크에 나가지 않는다(유료 호출 없음).
// 확인: 사업 정보 · 지난 실행 기록이 AI 입력에 들어가고, 진행 중인 실행이 있는 광고의 새 변경안은 서버가 빼며,
//       결과에 사장님용 요약이 남는다. 기존 비용 예약(예약 → 호출 → 정산)과 주 1회 기록은 그대로다.
import test from "node:test";
import assert from "node:assert/strict";
import { loadFunction, jsonRequest, fakeSupabase, setCtx, setEnv, fakeFetch, jsonResponse } from "./helpers/edge-function-harness.mjs";
import { weekRanges } from "../supabase/functions/_shared/ai-weekly-core.mjs";
import { CONSULT_VERSION } from "../supabase/functions/_shared/ai-consult-core.mjs";
import { POLICY_VERSION, PLAYBOOK_VERSION } from "../supabase/functions/_shared/ai-policy.mjs";

const ENV = { LAUNCHROAS_ANTHROPIC_API_KEY: "sk-test", AI_WEEKLY_ENABLED: "true", AI_MAX_ADS: "5", AI_MONTHLY_BUDGET_USD: "30" };
setEnv(ENV);
const aiWeekly = await loadFunction("ai-weekly-review");
// 정책을 켠 같은 함수(시크릿 AI_POLICY_VERSION은 모듈을 불러올 때 읽는다) — 운영 시크릿과 무관한 테스트 환경 값
setEnv({ ...ENV, AI_POLICY_VERSION: POLICY_VERSION });
const aiWeeklyPolicy = await loadFunction("ai-weekly-review", "policy-on");
setEnv(ENV);
const weeks = weekRanges(new Date());
const FUTURE = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

const PROFILE = { tool_type: "business_profile", created_at: "2026-10-07T00:00:00Z",
  data: { store_id: "4", objective: "판매", target_roas_pct: 300, monthly_budget_cap_krw: null, cannot_change: ["예산 늘리기"], saved_at: "2026-10-07T00:00:00Z" } };
const changeRec = (action, ad, name, until) => ({ tool_type: "ad_log", created_at: "2026-10-01T00:00:00Z", data: { source: "change", action_id: action, store_id: "4", date: "2026-09-20",
  ad: { ad_id: ad, adset_id: "s" + ad, ad_name: name, new_ad_id: null }, entry: "ai_suggestion",
  change: { element: "문구", before: "예전", after: "새 문구", method: "edit", applied_confirmed: true },
  compare: { days: 7, before: { since: "2026-09-13", until: "2026-09-19" }, after: { since: "2026-09-20", until } } } });
const AD_LOG = [changeRec("A1", "111", "가을 니트 A", FUTURE), changeRec("A9", "999", "여름 원피스", "2026-09-26")];

const insightRow = (ad, spend, ctr) => ({ ad_id: ad, ad_name: "광고 " + ad, adset_id: "s" + ad, adset_name: "세트 " + ad, campaign_name: "전환", objective: "OUTCOME_SALES",
  spend: String(spend), impressions: "10000", reach: "8000", frequency: "1.25", clicks: String(ctr * 100), inline_link_clicks: String(ctr * 100),
  actions: [{ action_type: "landing_page_view", value: String(ctr * 80) }, { action_type: "offsite_conversion.fb_pixel_purchase", value: "5" }],
  action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: String(spend * 3) }] });

function setup({ toolRecordsError = null } = {}) {
  const seq = [];
  const row = { current: null };
  const user = fakeSupabase({
    stores: () => ({ data: { id: 4 } }),
    connected_accounts: () => ({ data: { id: 7, status: "connected", external_account_id: "act_1" } }),
    tool_records: (q) => {
      if (toolRecordsError) return { error: toolRecordsError };
      const type = (q.filters.find((f) => f[0] === "eq" && f[1] === "tool_type") || [])[2];
      return { data: type === "business_profile" ? [PROFILE] : type === "ad_log" ? AD_LOG : [] };
    },
  });
  const admin = fakeSupabase({
    ai_weekly_reviews: (q) => {
      if (q.op === "select") return { data: row.current };
      if (q.op === "insert") { row.current = { id: 11, retry_count: 0, usage: {}, cost_usd: 0, reserved_cost_usd: 0, batches: [], result: null, ...q.values }; return { data: row.current }; }
      if (q.op === "update") { row.current = { ...row.current, ...q.values }; return { data: row.current }; }
      return { data: null };
    },
    integration_credentials: () => ({ data: { access_token: "meta-token", access_token_expires_at: new Date(Date.now() + 864e5).toISOString() } }),
    "rpc:ai_month_spent": () => ({ data: 0 }),
    "rpc:ai_budget_reserve": () => { seq.push("reserve"); return { data: [{ ok: true, reservation_id: 99, spent_usd: 0, reason: null }] }; },
    "rpc:ai_budget_settle": () => { seq.push("settle"); return { data: null }; },
  });
  setCtx({ supabase: user, supabaseAdmin: admin });
  const anthropic = [];
  fakeFetch((url, init) => {
    if (url.includes("api.anthropic.com")) {
      seq.push("anthropic");
      const body = JSON.parse(init.body);
      anthropic.push(body);
      const id = /ad_id: (\d+)\)/.exec(body.messages[0].content.at(-1).text)[1];
      const out = [{ ad_id: id, verdict: "개선 필요", headline: "클릭률이 같은 목적 광고보다 낮음", next_action: "첫 줄을 바꾼 새 광고 추가", priority: 1,
        evidence: [{ metric: "metrics_current.link_ctr_pct", note: "클릭률" }], hypotheses: [], limits: [],
        recommendation: { element: "문구", basis: "첫 줄이 할인 안내뿐", current: "가을 니트 할인", proposed: "첫 줄을 소재 강점으로", example: "울 50% 니트", test: { method: "새 광고", compare_metrics: [], decision_rule: "", sample_note: "" } } }];
      return jsonResponse(200, { content: [{ type: "text", text: JSON.stringify(out) }], usage: { input_tokens: 1000, output_tokens: 500 }, stop_reason: "end_turn" });
    }
    if (url.includes("graph.facebook.com")) {
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
  return { seq, anthropic, admin, row, user };
}
const SALES = { current: { gross_sales_krw: 900000, sold_qty: 20, linked_qty: 20, margin_total_krw: 300000, partial: false, estimated_orders: 0 }, previous: null };
const run = (fn = aiWeekly) => fn(jsonRequest({ store_id: 4, action: "run", sales: SALES, fx_krw_per_unit: null }));

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
  const forAd = (id) => s.anthropic.map((r) => r.messages[0].content.map((c) => c.text || "").join("\n")).find((t) => t.includes(`<ad_data ad_id="${id}">`));
  assert.match(forAd("111"), /"previous_actions":\[\{"element":"문구"[^\]]*"blocks_new_change":true/);
  assert.doesNotMatch(forAd("222"), /previous_actions/, "실행 기록이 없는 광고에는 넣지 않는다(기존 입력 그대로)");
  // 사용자 권한(RLS) 클라이언트로 본인 기록만 — 실행 기록은 변경 · 결과만(일반 광고 기록 제외)
  const reads = s.user.calls.filter((q) => q.table === "tool_records");
  assert.equal(reads.length, 2);
  for (const q of reads) assert.ok(q.op === "select" && q.filters.some((f) => f[0] === "eq" && f[1] === "user_id" && f[2] === "user-1"), JSON.stringify(q.filters));
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
  assert.equal(ad("222").recommendation.element, "문구");
  assert.equal(r.brief.version, CONSULT_VERSION);
  assert.deepEqual(r.brief.todos.map((t) => t.what), ["‘여름 원피스 · 문구 변경’ 결과 비교하기", "광고 222: 첫 줄을 바꾼 새 광고 추가"]);
  assert.equal(r.brief.status[0], "지난주 광고비 차감 후 예상 이익 210,000원");
  assert.equal(r.consult.load, "ok");
  assert.deepEqual(r.consult.profile.cannot_change, ["예산 늘리기"]);
  assert.equal(r.snapshot, undefined, "사용자 응답에는 스냅샷을 내리지 않는다");
});

test("사업 정보 · 실행 기록을 못 불러와도 점검은 진행하고, '없음'이 아니라 '불러오지 못함'으로 남긴다", async () => {
  const s = setup({ toolRecordsError: { message: "timeout" } });
  const body = await (await run()).json();
  assert.equal(body.status, "completed");
  const ctx = s.anthropic[0].messages[0].content[0].text;
  assert.match(ctx, /사업 정보를 불러오지 못했어요/);
  assert.ok(body.result.brief.unknowns.includes("사업 정보 · 실행 기록을 불러오지 못해 이번 점검에 반영하지 않았어요"));
  assert.ok(body.result.notes.some((n) => n.includes("사업 정보 · 실행 기록을 불러오지 못했어요")));
  assert.equal(body.result.consult.load, "failed");
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
