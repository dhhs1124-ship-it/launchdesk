// AI 컨설턴트 최소 흐름 — 사업 정보 · 판단 입력 · 지난 실행 · 겹침 방지 · 요약(현재 상태 → 할 일 → 이유)
// 실행: node --test tests/ai-consult-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSULT_VERSION, OBJECTIVES, CANNOT_CHANGE, businessProfileOf, decisionInputsFrom, previousActions, actionsForAd,
  guardResults, consultBrief, consultSystemPrompt, conservativeToday,
} from "../supabase/functions/_shared/ai-consult-core.mjs";
import { DECISION_INPUTS, SYSTEM_PROMPT } from "../supabase/functions/_shared/ai-weekly-core.mjs";

const profileRow = (store, data, at = "2026-10-07T00:00:00Z") => ({ tool_type: "business_profile", created_at: at, data: { store_id: String(store), saved_at: at, ...data } });

test("사업 정보: 이 쇼핑몰의 가장 최근 기록만 쓰고, 허용 값이 아니면 버린다(빈 기록은 없음으로)", () => {
  const rows = [
    profileRow(9, { objective: "판매", target_roas_pct: 250 }, "2026-10-08T00:00:00Z"), // 다른 쇼핑몰
    profileRow(4, { objective: "아무거나", target_roas_pct: 20, monthly_budget_cap_krw: 5000, cannot_change: ["예산 늘리기", "없는 항목", "예산 늘리기"] }, "2026-10-07T00:00:00Z"),
    profileRow(4, { objective: "재구매", target_roas_pct: 300 }, "2026-10-01T00:00:00Z"), // 예전 기록 — 쓰지 않는다
    { tool_type: "ad_log", data: { store_id: "4", source: "change" } },
  ];
  assert.deepEqual(businessProfileOf(rows, 4), { objective: null, target_roas_pct: null, monthly_budget_cap_krw: null, cannot_change: ["예산 늘리기"], saved_at: "2026-10-07T00:00:00Z" });
  assert.deepEqual(businessProfileOf([profileRow(4, { objective: "판매", target_roas_pct: "320", monthly_budget_cap_krw: 1500000 })], "4"),
    { objective: "판매", target_roas_pct: 320, monthly_budget_cap_krw: 1500000, cannot_change: [], saved_at: "2026-10-07T00:00:00Z" });
  assert.equal(businessProfileOf([profileRow(4, { objective: "?", target_roas_pct: -1 })], 4), null, "남는 값이 없으면 사업 정보 없음");
  assert.equal(businessProfileOf([], 4), null);
  assert.deepEqual(OBJECTIVES, ["판매", "신규 고객", "재구매", "브랜드 인지"]);
  assert.deepEqual(CANNOT_CHANGE, ["예산 늘리기", "할인 · 가격", "새 사진 · 영상 촬영"]);
});

test("판단 입력: 사업 정보가 없으면 기존 값 그대로, 있으면 목표 · 제약만 채우고 광고별 손익 근거는 계속 없음", () => {
  assert.equal(decisionInputsFrom(null), DECISION_INPUTS, "없으면 기존 상수 그대로(지시문 · 입력 변화 없음)");
  const failed = decisionInputsFrom(null, "failed");
  assert.equal(failed.goal, null); assert.equal(failed.user_constraints, null); assert.equal(failed.ad_profit_basis, null);
  assert.match(failed.note, /불러오지 못/);
  const di = decisionInputsFrom({ objective: "판매", target_roas_pct: 300, monthly_budget_cap_krw: null, cannot_change: [], saved_at: null });
  assert.deepEqual(di.goal, { objective: "판매", target_roas_pct: 300, basis: "목표 ROAS는 Meta 귀속 구매금액 ÷ 광고비 기준 — Cafe24 실제 매출 기준이 아님" });
  assert.equal(di.ad_profit_basis, null);
  assert.equal(di.user_constraints, null);
  assert.match(di.note, /광고별 손익 근거/);
  const withLimits = decisionInputsFrom({ objective: null, target_roas_pct: null, monthly_budget_cap_krw: 1000000, cannot_change: ["할인 · 가격"], saved_at: null });
  assert.equal(withLimits.goal, null, "목표 없이 제약만 있으면 목표는 없음");
  assert.deepEqual(withLimits.user_constraints, { monthly_budget_cap_krw: 1000000, cannot_change: ["할인 · 가격"] });
});

// 광고 기록(tool_records ad_log)의 실행 기록 · 결과 기록 — launchroas/adlog-change-core.js 형식
const change = (id, ad, until, extra = {}) => ({ source: "change", action_id: id, store_id: "4", date: "2026-09-20", name: ad + " · 문구 변경",
  ad: { ad_id: ad, adset_id: "s" + ad, ad_name: "광고 " + ad, new_ad_id: extra.new_ad_id || null }, entry: "ai_suggestion",
  change: { element: "문구", before: "예전 문구", after: "새 문구 — 울 50%", method: extra.new_ad_id ? "new_ad" : "edit", applied_confirmed: true },
  compare: { days: 7, before: { since: "2026-09-13", until: "2026-09-19" }, after: { since: "2026-09-20", until } } });
const resultOf = (id, status, at, extra = {}) => ({ source: "change_result", action_id: id, store_id: "4", measured_at: at,
  result: { judgement_version: "v", status, provisional: false, blockers: [], observations: ["구매 증가 관찰"], ...extra } });

test("지난 실행: 비교 기간 · 결과로 단계를 정하고, 끝나지 않았거나 판단 불가 · 잠정이면 새 변경을 막는다", () => {
  const today = "2026-10-08";
  const rows = [
    change("A", "1", "2026-10-10"),                          // 비교 기간 진행 중
    change("B", "2", "2026-10-01"),                          // 끝났는데 결과 없음
    change("C", "3", "2026-09-26"), resultOf("C", "improved", "2026-10-05T00:00:00Z"),
    change("D", "4", "2026-09-26"), resultOf("D", "inconclusive", "2026-10-02T00:00:00Z"),
    resultOf("D", "unknown", "2026-10-06T00:00:00Z", { blockers: ["fetch_failed"] }), // 조회 실패뿐 → 이전 결과(갱신 실패)
    change("E", "5", "2026-09-26"), resultOf("E", "unknown", "2026-10-03T00:00:00Z", { blockers: ["condition_mismatch"] }),
    change("F", "6", "2026-09-30"), resultOf("F", "inconclusive", "2026-10-03T00:00:00Z", { provisional: true, blockers: ["provisional"] }),
    { ...change("G", "7", "2026-09-26"), store_id: "9" },    // 다른 쇼핑몰
    resultOf("Z", "improved", "2026-10-01T00:00:00Z"),       // 실행 기록 없는 결과
  ];
  const acts = previousActions(rows, 4, today);
  const by = Object.fromEntries(acts.map((a) => [a.action_id, a]));
  assert.deepEqual(Object.keys(by).sort(), ["A", "B", "C", "D", "E", "F"]);
  assert.deepEqual([by.A.stage, by.A.blocks_new_change], ["in_progress", true]);
  assert.deepEqual([by.B.stage, by.B.blocks_new_change], ["awaiting_result", true]);
  assert.deepEqual([by.C.stage, by.C.blocks_new_change, by.C.result.status_text], ["concluded", false, "구매당 광고비 개선 신호"]);
  assert.deepEqual([by.D.stage, by.D.blocks_new_change, by.D.result.status, by.D.result.stale], ["concluded", false, "inconclusive", true]);
  assert.deepEqual([by.E.stage, by.E.blocks_new_change], ["undetermined", true]);
  assert.deepEqual([by.F.stage, by.F.blocks_new_change], ["provisional", true]);
  assert.equal(by.A.ad_name, "광고 1");
  assert.equal(conservativeToday(Date.parse("2026-10-08T15:30:00Z")), "2026-10-08", "한국 날짜 − 1일(어느 광고계정 시간대보다 늦지 않게)");
});

test("광고별 지난 실행(AI 입력): 대상 광고 · 새 광고 ID로 찾고 사실만 짧게", () => {
  const acts = previousActions([change("A", "1", "2026-10-10", { new_ad_id: "77" }), change("C", "3", "2026-09-26"), resultOf("C", "worse", "2026-10-05T00:00:00Z")], 4, "2026-10-08");
  assert.equal(actionsForAd(acts, "2").length, 0);
  const forNew = actionsForAd(acts, "77");
  assert.equal(forNew.length, 1);
  assert.deepEqual(forNew[0], { element: "문구", method: "new_ad", start: "2026-09-20", compare_after: { since: "2026-09-20", until: "2026-10-10" },
    changed_to: "새 문구 — 울 50%", stage_text: "비교 기간 진행 중", result_text: null, blocks_new_change: true });
  assert.equal(actionsForAd(acts, "3")[0].result_text, "구매당 광고비 악화 신호");
  assert.equal(actionsForAd(acts, "1").length, 1, "원래 광고로도 찾는다");
});

const analysis = (id, extra = {}) => ({ ad_id: id, verdict: "개선 필요", headline: "클릭률 하락", next_action: "첫 줄을 바꾼 새 광고 추가", priority: 1,
  hold_scope: [], recommendation: { scope: "change", element: "문구", proposed: "첫 줄 변경", example: "울 50%", test: {} }, budget_note: null, ...extra });

test("겹침 방지: 진행 중인 실행이 있는 광고는 새 변경안을 서버가 빼고, 예산을 못 늘리면 예산 변경안도 뺀다", () => {
  const acts = previousActions([change("A", "1", "2026-10-10")], 4, "2026-10-08");
  const input = { 1: analysis("1"), 2: analysis("2"), 3: analysis("3", { recommendation: { scope: "change", element: "예산", proposed: "예산 20% 증액", test: {} } }) };
  const out = guardResults(input, acts, { objective: "판매", target_roas_pct: null, monthly_budget_cap_krw: null, cannot_change: ["예산 늘리기"], saved_at: null });
  assert.equal(out[1].recommendation, null);
  assert.equal(out[1].next_action, "진행 중인 ‘문구’ 변경의 결과를 먼저 확인");
  assert.deepEqual(out[1].hold_scope, ["진행 중인 실행 기록"]);
  assert.deepEqual(out[1].consult_adjusted, ["진행 중인 실행 기록이 있어 새 변경안을 내지 않음(비교가 깨지지 않게)"]);
  assert.ok(out[2].recommendation, "다른 광고는 그대로");
  assert.deepEqual(out[2].consult_adjusted, []);
  assert.equal(out[3].recommendation, null);
  assert.deepEqual(out[3].consult_adjusted, ["사업 정보: 예산을 늘릴 수 없음 — 예산 변경안 제외"]);
  assert.ok(input[1].recommendation, "입력은 바꾸지 않는다");
});

const BASE = {
  sales: { current: { gross_sales_krw: 1200000, sold_qty: 30, linked_qty: 24, margin_total_krw: 187101, partial: true, estimated_orders: 0 }, previous: null },
  meta: { current: { spend: 191236, roas: 3.87, purchases: 6 }, currency: "KRW", fx_krw_per_unit: null },
  expected_profit: { current: -4135, partial: true },
  priorities: [{ ad_id: "2", ad_name: "가을 니트", action: "첫 줄을 바꾼 새 광고 추가", headline: "클릭률 1.8% → 1.1%" }],
  consult: { load: "ok", profile: null, decision_inputs: DECISION_INPUTS, actions: [] },
  coverage: { analyzed: 2 },
};

test("요약: 현재 상태는 확인한 숫자와 기준, 할 일은 결과 확인 → AI 우선 확인 → 데이터 보완 순서(최대 3개), 판단하지 않은 것은 따로", () => {
  const acts = previousActions([change("B", "1", "2026-10-01")], 4, "2026-10-08");
  const b = consultBrief({ ...BASE, consult: { ...BASE.consult, actions: acts } });
  assert.equal(b.version, CONSULT_VERSION);
  assert.deepEqual(b.status, [
    "지난주 광고비 차감 후 예상 이익 −4,135원 (일부 상품 기준)",
    "Meta ROAS 387% · 목표 미입력 (Meta 귀속 기준 — Cafe24 실제 매출과 다름)",
    "결과 비교를 기다리는 실행 기록 1건",
  ]);
  assert.deepEqual(b.todos.map((t) => [t.what, t.source]), [
    ["‘광고 1 · 문구 변경’ 결과 비교하기", "실행 기록"],
    ["가을 니트: 첫 줄을 바꾼 새 광고 추가", "AI 점검"],
    ["사업 정보(광고 목표) 입력", "데이터"],
  ]);
  assert.match(b.todos[0].why, /2026-09-20~2026-10-01/);
  assert.equal(b.todos[1].why, "클릭률 1.8% → 1.1%");
  assert.ok(b.unknowns.includes("광고별 이익은 판단하지 않았어요 — 광고별 주문 연결이 없어요"));
  assert.ok(b.unknowns.includes("목표 달성 여부는 판단하지 않았어요 — 광고 목표 미입력"));
});

test("요약: 목표가 있으면 Meta ROAS와 나란히 · 환율이 없으면 이익 계산 불가와 환율 입력, 할 일이 없으면 '바꿀 것 없음'", () => {
  const profile = { objective: "판매", target_roas_pct: 300, monthly_budget_cap_krw: null, cannot_change: [], saved_at: null };
  const usd = consultBrief({ ...BASE, sales: { current: { ...BASE.sales.current, partial: false }, previous: null },
    meta: { current: { spend: 137, roas: 2.1, purchases: 3 }, currency: "USD", fx_krw_per_unit: null }, expected_profit: { current: null, partial: false },
    priorities: [], consult: { ...BASE.consult, profile, decision_inputs: decisionInputsFrom(profile) } });
  assert.deepEqual(usd.status, [
    "지난주 예상 이익 계산 불가 — 광고비 환율이 없어 원화로 바꾸지 못함",
    "Meta ROAS 210% · 목표 ROAS 300% (둘 다 Meta 귀속 기준 — Cafe24 실제 매출과 다름)",
  ]);
  assert.deepEqual(usd.todos.map((t) => t.what), ["광고비 환율 입력"]);
  const quiet = consultBrief({ ...BASE, sales: { current: { ...BASE.sales.current, partial: false }, previous: null }, priorities: [],
    consult: { ...BASE.consult, profile, decision_inputs: decisionInputsFrom(profile) } });
  assert.deepEqual(quiet.todos, [{ what: "이번 주 바꿀 것 없음 · 데이터 더 쌓기", why: "우선 확인할 광고가 없어요", source: "AI 점검" }]);
  const noSales = consultBrief({ ...BASE, sales: { current: null, previous: null }, expected_profit: { current: null, partial: false } });
  assert.equal(noSales.status[0], "지난주 예상 이익 계산 불가 — Cafe24 판매 집계를 받지 못함");
});

test("요약: 사업 정보 · 실행 기록을 못 불러왔으면 '없음'이 아니라 '확인 불가'로, 이전 방식 점검(입력 없음)도 구분", () => {
  const failed = consultBrief({ ...BASE, consult: { load: "failed", profile: null, decision_inputs: decisionInputsFrom(null, "failed"), actions: [] } });
  assert.ok(failed.unknowns.includes("사업 정보 · 실행 기록을 불러오지 못해 이번 점검에 반영하지 않았어요"));
  assert.ok(!failed.todos.some((t) => t.what === "사업 정보(광고 목표) 입력"), "불러오기 실패를 '미입력'으로 보지 않는다");
  const legacy = consultBrief({ ...BASE, consult: null });
  assert.ok(legacy.unknowns.includes("사업 정보 · 실행 기록 연결 전 점검이에요"));
});

test("지시문: 사업 정보 · 지난 실행 규칙을 기존 지시문 뒤에 붙인다(기존 문장은 그대로)", () => {
  const s = consultSystemPrompt(SYSTEM_PROMPT);
  assert.ok(s.startsWith(SYSTEM_PROMPT));
  assert.ok(s.includes(CONSULT_VERSION));
  assert.match(s, /blocks_new_change/);
  assert.match(s, /cannot_change/);
});
