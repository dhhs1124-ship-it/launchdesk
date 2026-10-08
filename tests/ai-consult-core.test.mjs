// AI 컨설턴트 최소 흐름 — 사업 정보 · 판단 입력 · 지난 실행 · 겹침 방지 · 요약(현재 상태 → 할 일 → 이유)
// 실행: node --test tests/ai-consult-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSULT_VERSION, OBJECTIVES, CANNOT_CHANGE, businessProfileOf, decisionInputsFrom, previousActions, actionsForAd,
  guardResults, consultBrief, consultSystemPrompt, conservativeToday,
} from "../supabase/functions/_shared/ai-consult-core.mjs";
import * as core from "../supabase/functions/_shared/ai-consult-core.mjs";
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

test("겹침 방지: 진행 중인 실행이 있는 광고는 새 변경안을 서버가 뺀다(제약 없음)", () => {
  const acts = previousActions([change("A", "1", "2026-10-10")], 4, "2026-10-08");
  const input = { 1: analysis("1"), 2: analysis("2") };
  const out = guardResults(input, acts, null);
  assert.equal(out[1].recommendation, null);
  assert.equal(out[1].next_action, "진행 중인 ‘문구’ 변경의 결과를 먼저 확인");
  assert.deepEqual(out[1].hold_scope, ["진행 중인 실행 기록"]);
  assert.deepEqual(out[1].consult_adjusted, ["진행 중인 실행 기록이 있어 새 변경안을 내지 않음(비교가 깨지지 않게)"]);
  assert.deepEqual(out[1].consult_held, { reason: "in_progress", labels: [] });
  assert.ok(out[2].recommendation, "다른 광고는 그대로(제약이 없으면 조건 선언이 없어도 막지 않는다)");
  assert.deepEqual(out[2].consult_adjusted, []);
  assert.equal(out[2].consult_held, null);
  assert.ok(input[1].recommendation, "입력은 바꾸지 않는다");
});

// ---- 2026-10-08 검토 보완: 사용자 제약을 최종 출력 전체(변경안 · 행동 · 예산 의견 · 요약)에 구조로 강제 ----
const P = (cannot_change) => ({ objective: "판매", target_roas_pct: null, monthly_budget_cap_krw: null, cannot_change, saved_at: null });
const NEED = (budget = "none", discount_price = false, new_shoot = false) => ({ budget, discount_price, new_shoot });
const req = (next_action, recommendation, budget_note = null) => ({ next_action, recommendation, budget_note });

test("증액 금지: recommendation이 없어도 next_action · budget_note의 증액 권고를 막는다(조건 선언 기준)", () => {
  const out = guardResults({ 3: analysis("3", { recommendation: null, next_action: "예산을 20% 늘려 1주 비교", budget_note: "예산 증액 검토",
    requires: req(NEED("increase"), null, "increase") }) }, [], P(["예산 늘리기"]))[3];
  assert.equal(out.recommendation, null);
  assert.equal(out.next_action, "사업 정보 제약(예산 늘리기)에 맞지 않아 이번 주 변경안 없음");
  assert.equal(out.budget_note, null);
  assert.deepEqual(out.consult_held, { reason: "constraint", labels: ["예산 늘리기"] });
  assert.deepEqual(out.consult_adjusted, ["사업 정보 제약(예산 늘리기) — 이번 주 변경안 · 행동 · 예산 의견 보류"]);
});

test("선언과 문장이 어긋나면(증액 문장인데 budget:none) 확인 불가로 보류 — 단어 검색은 선언을 검증하는 보조 장치", () => {
  const out = guardResults({ 3: analysis("3", { recommendation: null, next_action: "하루 예산을 6,000원으로 올려 비교", requires: req(NEED("none"), null) }) }, [], P(["예산 늘리기"]))[3];
  assert.equal(out.next_action, "변경에 필요한 조건을 확인하지 못해 이번 주 변경안 없음");
  assert.deepEqual(out.consult_held, { reason: "unverifiable", labels: ["예산 늘리기"] });
});

test("할인 · 가격 금지 · 새 촬영 금지도 적용 — 필요 없다고 선언한 변경안은 그대로", () => {
  const out = guardResults({
    1: analysis("1", { recommendation: { element: "문구", proposed: "첫 줄에 '이번 주 20% 할인'", example: "니트 20% 할인", test: {} }, requires: req(NEED(), NEED("none", true)) }),
    2: analysis("2", { recommendation: { element: "이미지", proposed: "모델 착용 컷을 새로 촬영", example: "", test: {} }, requires: req(NEED(), NEED("none", false, true)) }),
    4: analysis("4", { recommendation: { element: "이미지", proposed: "지금 있는 3컬러 사진을 한 장에 배치", example: "", test: {} }, requires: req(NEED(), NEED()) }),
  }, [], P(["할인 · 가격", "새 사진 · 영상 촬영"]));
  assert.deepEqual(out[1].consult_held, { reason: "constraint", labels: ["할인 · 가격"] });
  assert.equal(out[1].recommendation, null);
  assert.deepEqual(out[2].consult_held, { reason: "constraint", labels: ["새 사진 · 영상 촬영"] });
  assert.equal(out[4].consult_held, null, "있는 사진으로 하는 변경은 그대로");
  assert.equal(out[4].recommendation.element, "이미지");
});

test("변경 요소가 '기타' · 누락이거나 조건 선언이 없으면 제약이 있을 때 보류한다(제약이 없으면 그대로)", () => {
  const input = {
    1: analysis("1", { recommendation: { element: "기타", proposed: "행사 안내 추가", test: {} } }),
    2: analysis("2", { recommendation: { proposed: "구성 변경", test: {} }, requires: req(NEED(), null) }),
  };
  const held = guardResults(input, [], P(["할인 · 가격"]));
  for (const id of ["1", "2"]) {
    assert.equal(held[id].recommendation, null, id);
    assert.deepEqual(held[id].consult_held, { reason: "unverifiable", labels: ["할인 · 가격"] }, id);
  }
  const free = guardResults(input, [], P([]));
  assert.ok(free[1].recommendation && free[2].recommendation, "제약이 없으면 막을 것도 없다");
});

test("증액 금지는 감액을 막지 않는다 — 예산 변경안은 방향 선언으로 판단, 방향이 '그대로'면 어긋남으로 보류", () => {
  const out = guardResults({
    1: analysis("1", { recommendation: { element: "예산", proposed: "하루 예산 20% 줄이기", test: {} }, next_action: "예산을 줄여 1주 비교",
      budget_note: "구매당 광고비가 높아 감액 검토", requires: req(NEED("decrease"), NEED("decrease"), "decrease") }),
    2: analysis("2", { recommendation: { element: "예산", proposed: "예산 조정", test: {} }, requires: req(NEED(), NEED("none")) }),
  }, [], P(["예산 늘리기"]));
  assert.equal(out[1].consult_held, null);
  assert.equal(out[1].recommendation.element, "예산");
  assert.equal(out[1].budget_note, "구매당 광고비가 높아 감액 검토");
  assert.deepEqual(out[2].consult_held, { reason: "unverifiable", labels: ["예산 늘리기"] });
});

test("예산 의견만 증액이면 그 의견만 뺀다 — 변경안 · 행동은 그대로라 서로 어긋나지 않는다", () => {
  const out = guardResults({ 1: analysis("1", { budget_note: "예산 증액 검토", requires: req(NEED(), NEED(), "increase") }) }, [], P(["예산 늘리기"]))[1];
  assert.equal(out.budget_note, null);
  assert.equal(out.consult_held, null);
  assert.equal(out.recommendation.element, "문구");
  assert.deepEqual(out.consult_adjusted, ["사업 정보 제약(예산 늘리기) — 예산 증액 의견 제외"]);
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

test("요약: 사업 정보 · 실행 기록 연결 전 점검(이전 스냅샷)은 따로 표시", () => {
  const legacy = consultBrief({ ...BASE, consult: null });
  assert.ok(legacy.unknowns.includes("사업 정보 · 실행 기록 연결 전 점검이에요"));
});

test("지시문: 사업 정보 · 지난 실행 규칙을 기존 지시문 뒤에 붙인다(기존 문장은 그대로)", () => {
  const s = consultSystemPrompt(SYSTEM_PROMPT);
  assert.ok(s.startsWith(SYSTEM_PROMPT));
  assert.ok(s.includes(CONSULT_VERSION));
  assert.match(s, /blocks_new_change/);
  assert.match(s, /cannot_change/);
  assert.match(s, /"requires"/, "행동에 필요한 조건을 구조로 선언하게 한다");
  assert.match(s, /증액만 막는다/);
});

test("요약: 제약 · 확인 불가로 보류한 광고는 할 일로 올리지 않고 지금 상태에 이유와 함께 한 줄씩", () => {
  const results = {
    3: { ad_id: "3", consult_held: { reason: "constraint", labels: ["예산 늘리기"] } },
    5: { ad_id: "5", consult_held: { reason: "unverifiable", labels: ["할인 · 가격"] } },
    2: { ad_id: "2", consult_held: null },
  };
  const b = consultBrief({ ...BASE, results, priorities: [
    { ad_id: "3", ad_name: "데님", action: "사업 정보 제약(예산 늘리기)에 맞지 않아 이번 주 변경안 없음", headline: "구매가 늘어 예산을 늘려 볼 만함" },
    { ad_id: "5", ad_name: "셔츠", action: "변경에 필요한 조건을 확인하지 못해 이번 주 변경안 없음", headline: "클릭률 낮음" },
    ...BASE.priorities] });
  assert.deepEqual(b.todos.map((t) => t.what), ["가을 니트: 첫 줄을 바꾼 새 광고 추가", "사업 정보(광고 목표) 입력", "비용 미입력 상품 입력"]);
  assert.ok(b.status.includes("사업 정보 제약으로 변경안을 보류한 광고 1개(예산 늘리기)"));
  assert.ok(b.status.includes("변경 조건을 확인하지 못해 변경안을 보류한 광고 1개"));
});

test("실행 기록 읽기: 짧은 페이지가 나올 때까지 끝까지 읽고, 중복은 한 번만, 상한을 넘거나 실패하면 '완전하지 않음'", async () => {
  const pages = (rows, pageSize) => async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + pageSize)), error: null });
  const rows = Array.from({ length: 450 }, (_, i) => ({ id: i + 1 }));
  const all = await core.collectPages(pages(rows, 200), { page: 200, maxRows: 2000 });
  assert.deepEqual([all.complete, all.error, all.rows.length], [true, null, 450]);
  const dup = await core.collectPages(async (from) => ({ data: from === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }], error: null }), { page: 2, maxRows: 10 });
  assert.deepEqual(dup.rows.map((r) => r.id), [1, 2]);
  const capped = await core.collectPages(pages(Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })), 10), { page: 10, maxRows: 20 });
  assert.equal(capped.complete, false, "상한까지 꽉 찬 페이지만 나왔으면 더 있는지 알 수 없다");
  const broken = await core.collectPages(async (from) => (from === 0 ? { data: [{ id: 1 }, { id: 2 }], error: null } : { data: null, error: { message: "timeout" } }), { page: 2, maxRows: 10 });
  assert.equal(broken.complete, false);
  assert.equal(broken.error.message, "timeout");
});
