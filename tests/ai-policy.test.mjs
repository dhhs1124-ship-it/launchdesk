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
