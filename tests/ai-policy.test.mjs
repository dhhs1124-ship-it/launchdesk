// 분석 기준 · 사례 연결(ai-policy.mjs) — 기본 꺼짐, 켜졌을 때만 사례 전달 · 결과에 사례 ID. AI 호출 없음.
import test from "node:test";
import assert from "node:assert/strict";
import { POLICY_VERSION, POLICY_ADDENDUM, CASES, policyOn, caseSignals, selectCases, casesBlock } from "../supabase/functions/_shared/ai-policy.mjs";
import { batchContent, parseBatch, peerGroups } from "../supabase/functions/_shared/ai-weekly-core.mjs";

const ad = (id, ctr, fmt, extra = {}) => ({ ad_id: id, ad_name: id, objective: "OUTCOME_SALES", optimization_goal: "OFFSITE_CONVERSIONS",
  current: { spend: 100000, link_ctr_pct: ctr, link_clicks: 300, purchases: 2, purchase_rate_pct: 0.5, roas: 1.2, ...extra }, previous: null, creative: { format: fmt } });

test("기본은 꺼짐: AI_POLICY_VERSION이 정확히 같을 때만 켜진다", () => {
  assert.equal(policyOn(() => ""), false);
  assert.equal(policyOn(() => "policy-old"), false);
  assert.equal(policyOn(() => POLICY_VERSION), true);
});

test("사례는 관찰과 가설을 구분하고, 영상 관찰 사례는 모두 음성 미확인 · 성과 미확인을 단다", () => {
  for (const c of CASES) {
    assert.ok(["observed", "hypothesis"].includes(c.kind), c.id);
    if (c.evidence === "video_frames") assert.match(c.limits, /음성 미확인/);
    if (c.kind === "observed") assert.match(c.limits, /성과 미확인/);
  }
  assert.match(POLICY_ADDENDUM, /성공 사례가 아니다/);
  assert.match(POLICY_ADDENDUM, /노출 규칙은 확인되지 않았/);
});

test("사례 선택: 규칙 신호가 없으면 고르지 않고, 신호 · 형식이 맞는 관찰 사례를 최대 2개 고른다", () => {
  const ads = [ad("1", 0.5, "video"), ad("2", 1.5, "video"), ad("3", 1.6, "single_image")];
  const peers = peerGroups(ads);
  assert.deepEqual(caseSignals(ads[0], peers), ["hook"]);
  const picked = selectCases(ads[0], peers);
  assert.equal(picked.length, 2);
  assert.ok(picked.every((id) => CASES.find((c) => c.id === id).format === "video"));
  assert.ok(picked.every((id) => id.startsWith("V-")), "관찰 사례 우선");
  assert.deepEqual(selectCases(ads[1], peers), [], "신호 없음");
  assert.ok(selectCases(ad("4", 0.3, "carousel"), peerGroups([ad("4", 0.3, "carousel"), ad("5", 2, "carousel")])).every((id) => !id.startsWith("V-")), "이미지 광고에 영상 사례를 주지 않는다");
});

test("요청 본문: 사례를 넘길 때만 <reference_cases>를 붙이고 관찰/가설 표시를 함께 보낸다", () => {
  const ads = [ad("1", 0.5, "video")], byId = { 1: ads[0] }, peers = peerGroups(ads), b = { ad_ids: ["1"] };
  const off = batchContent(b, byId, peers, {}, {});
  assert.ok(!off.some((x) => x.text && x.text.includes("reference_cases")));
  const on = batchContent(b, byId, peers, {}, {}, { 1: ["V-3441855369308050", "H-first3s"] });
  const blk = on.find((x) => x.text && x.text.includes("reference_cases"));
  assert.match(blk.text, /관찰 사례/); assert.match(blk.text, /일반 가설/);
  assert.deepEqual(casesBlock("1", ["없는사례"]).text.includes("[]"), true);
});

test("출력 검증: '추가 확인'은 개선안 · 예산을 지우고, 결과에 서버가 고른 사례 ID를 남긴다", () => {
  const a = ad("1", 0.5, "video"), byId = { 1: a }, peers = peerGroups([a]);
  const raw = JSON.stringify([{ ad_id: "1", verdict: "추가 확인", evidence: [{ metric: "metrics_current.link_ctr_pct", note: "x" }], budget_note: "증액 검토", recommendation: { element: "문구", proposed: "바꾸기" } }]);
  const r = parseBatch(raw, { ad_ids: ["1"] }, byId, peers, { 1: ["V-3441855369308050"] })["1"];
  assert.equal(r.verdict, "추가 확인");
  assert.equal(r.recommendation, null);
  assert.equal(r.budget_note, null);
  assert.deepEqual(r.case_ids, ["V-3441855369308050"]);
  const old = parseBatch(raw.replace("추가 확인", "유지"), { ad_ids: ["1"] }, byId, peers)["1"];
  assert.deepEqual(old.case_ids, [], "사례를 넘기지 않으면 빈 목록");
});

import { SYSTEM_PROMPT } from "../supabase/functions/_shared/ai-weekly-core.mjs";
import { policySystemPrompt } from "../supabase/functions/_shared/ai-policy.mjs";

test("정책 지시문: 기존 고정 표본 기준 · '유지'일 때만 테스트 문장을 바꿔 끼우고 모순을 남기지 않는다", () => {
  const sys = policySystemPrompt(SYSTEM_PROMPT);
  assert.doesNotMatch(sys, /구매 3건 미만/);
  assert.doesNotMatch(sys, /노출 수천 회 미만/);
  assert.match(sys, /표본 크기에 고정 기준을 쓰지 마라/);
  assert.match(sys, /동시 집행 비교, 균등 배분 아님/);
  assert.match(sys, /A\/B 테스트가 아니다/);
  assert.match(sys, /전주보다 나빠지지 않았다는 이유만으로 "유지"라고 하지 않는다/);
  assert.match(sys, /hold_scope/);
  assert.match(SYSTEM_PROMPT, /구매 3건 미만/, "기본(정책 꺼짐) 지시문은 바꾸지 않는다");
});

test("출력 검증: '추가 확인'이어도 확인한 소재 근거의 선택적 테스트(creative_test)는 남기고, 보류 범위를 기록한다", () => {
  const a = ad("1", 0.5, "single_image"), byId = { 1: a }, peers = peerGroups([a]);
  const raw = JSON.stringify([{ ad_id: "1", verdict: "추가 확인", hold_scope: ["랜딩 · 구매 전환 구간", "예산"], evidence: [{ metric: "metrics_current.link_ctr_pct", note: "x" }], budget_note: "증액",
    recommendation: { scope: "creative_test", element: "문구", proposed: "첫 줄 비교", test: { method: "동시 집행 비교(균등 배분 아님)" } } }]);
  const r = parseBatch(raw, { ad_ids: ["1"] }, byId, peers)["1"];
  assert.equal(r.recommendation.scope, "creative_test");
  assert.deepEqual([...r.hold_scope], ["랜딩 · 구매 전환 구간", "예산"]);
  assert.equal(r.budget_note, null);
});

import { policyVariants, casesForAds } from "../supabase/functions/_shared/ai-policy.mjs";
import { pinnedWeeks } from "../supabase/functions/_shared/ai-weekly-core.mjs";
test("정책 비교: 같은 입력에 이전/새 지시문 두 가지 · 새 지시문에만 사례 · 시크릿과 무관", () => {
  const v = policyVariants(SYSTEM_PROMPT);
  assert.deepEqual(v.map((x) => x.key), ["policy_off", "policy_on"]);
  assert.equal(v[0].system, SYSTEM_PROMPT); assert.equal(v[0].withCases, false); assert.equal(v[0].meta.policy_version, null);
  assert.match(v[1].system, /분석 기준 policy-2026-10-06\.3/); assert.equal(v[1].withCases, true);
  const ads = [ad("1", 0.5, "video"), ad("2", 1.5, "video")];
  assert.equal(casesForAds(ads, peerGroups(ads))["1"].length, 2);
});
test("기간 고정: 7일씩 연속 · 끝난 주만 허용", () => {
  const base = { quotaWeek: "2026-10-05", current: { since: "2026-09-28", until: "2026-10-04" }, previous: { since: "2026-09-21", until: "2026-09-27" } };
  assert.equal(pinnedWeeks({ current: { since: "2026-09-28", until: "2026-10-04" }, previous: { since: "2026-09-21", until: "2026-09-27" } }, base).ok, true);
  assert.equal(pinnedWeeks({ current: { since: "2026-10-05", until: "2026-10-11" }, previous: { since: "2026-09-28", until: "2026-10-04" } }, base).error, "끝나지 않은 주는 고정할 수 없음");
  assert.equal(pinnedWeeks({ current: { since: "2026-09-28", until: "2026-10-03" }, previous: { since: "2026-09-21", until: "2026-09-27" } }, base).error, "각 기간은 7일");
  assert.equal(pinnedWeeks({ current: { since: "2026-09-28", until: "2026-10-04" }, previous: { since: "2026-09-14", until: "2026-09-20" } }, base).error, "그 전주는 분석 주 바로 앞 7일");
  assert.equal(pinnedWeeks(null, base).ok, false);
  assert.equal(pinnedWeeks({ current: { since: "2026-09-21", until: "2026-09-27" }, previous: { since: "2026-09-14", until: "2026-09-20" } }, base).weeks.quotaWeek, "2026-10-05", "이용 주(quotaWeek)는 바꾸지 않는다");
});

import { POLICY_FORBIDDEN, forcedCases } from "../supabase/functions/_shared/ai-policy.mjs";
import { SYSTEM_PROMPT as BASE_PROMPT, DECISION_INPUTS } from "../supabase/functions/_shared/ai-weekly-core.mjs";
test("정책을 켠 최종 지시문: 충돌 문장 없음 · 출력 스키마에 추가 확인 · keep_basis · assessments · scope", () => {
  const p = policySystemPrompt(BASE_PROMPT);
  assert.deepEqual(POLICY_FORBIDDEN.filter((f) => p.includes(f)), []);
  for (const k of ['"verdict":"개선 필요|판단 보류|유지|추가 확인"', '"keep_basis"', '"assessments"', '"hold_scope"', '"scope":"creative_test|change"', "decision_inputs"]) assert.ok(p.includes(k), k);
  assert.ok(!BASE_PROMPT.includes("decision_inputs"), "기존 지시문은 그대로");
});
test("서버 검증(정책 켜짐): 근거 없는 유지 · 예산 의견 · 목표/손익 판단을 고치고, 소재 테스트는 남긴다", () => {
  const a = ad("1", 0.8, "single_image", { link_ctr_pct: 0.8 }), adsById = { 1: a }, peers = peerGroups([a]), batch = { ad_ids: ["1"] };
  const out = JSON.stringify([{ ad_id: "1", verdict: "유지", keep_basis: "profit", assessments: { change: "구매 2→7", goal: "목표 달성", profit: "흑자" },
    evidence: [{ metric: "metrics_current.link_ctr_pct", note: "x" }], budget_note: "예산 20% 증액 검토",
    recommendation: { scope: "creative_test", element: "문구", basis: "본문 첫 줄", current: "a", proposed: "b", test: {} } }]);
  const r = parseBatch(out, batch, adsById, peers, null, { policy: true, decisionInputs: DECISION_INPUTS })["1"];
  assert.equal(r.verdict, "판단 보류");
  assert.equal(r.hold_scope[0], "목표·손익 근거 없음");
  assert.equal(r.budget_note, null);
  assert.equal(r.assessments.goal, "판단 불가(목표 입력 없음)");
  assert.equal(r.assessments.profit, "판단 불가(광고별 손익 근거 없음)");
  assert.equal(r.assessments.change, "구매 2→7", "현재 입력으로 판단 가능한 성과 변화는 그대로");
  assert.equal(r.recommendation.scope, "creative_test", "목표 · 마진이 없어도 소재 테스트는 막지 않음");
  assert.ok(r.server_adjusted.length >= 3);
  const change = JSON.parse(out); change[0].recommendation.scope = "change";
  assert.equal(parseBatch(JSON.stringify(change), batch, adsById, peers, null, { policy: true })["1"].recommendation, null, "근거 없는 유지의 변경안은 제외");
  const withGoal = parseBatch(out, batch, adsById, peers, null, { policy: true, decisionInputs: { goal: "ROAS 300%", ad_profit_basis: null, user_constraints: null } })["1"];
  assert.equal(withGoal.verdict, "판단 보류", "keep_basis=profit인데 손익 근거 없음");
  const off = parseBatch(out, batch, adsById, peers, null)["1"];
  assert.equal(off.verdict, "유지", "정책 꺼짐(기존 동작)은 그대로"); assert.equal(off.budget_note, "예산 20% 증액 검토");
});
test("운영자 사례 지정: 허용 ID만 · 최대 2개", () => {
  assert.deepEqual(forcedCases(["H-first3s", "V-28300268669664652"]), { ok: true, ids: ["H-first3s", "V-28300268669664652"] });
  assert.equal(forcedCases(["X-1"]).ok, false);
  assert.equal(forcedCases(["H-first3s", "H-price-in-creative", "V-28300268669664652"]).ok, false);
  assert.equal(forcedCases([]).ok, false);
});
