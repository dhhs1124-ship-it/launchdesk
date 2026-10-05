import test from "node:test";
import assert from "node:assert/strict";
import { parseOutput, lookup, validatePayload } from "../supabase/functions/_shared/ai-insights-core.mjs";

const payload = { current: { sales: { profit: 19622, partial: true }, adsets: [{ name: "전환 캠페인", link_ctr: 1.8, roas: 5.44 }] }, previous: null };

test("근거 지표 경로는 보낸 데이터에 실제로 있어야 한다 — 없는 경로는 버리고 개수를 남긴다", () => {
  const raw = JSON.stringify({ status: "일부 상품 기준 남은 금액 19,622원", action: "첫 화면 문구 테스트",
    evidence: [{ metric: "current.adsets[0].link_ctr", value: "1.8%", meaning: "클릭률" }, { metric: "current.adsets[0].cvr", value: "9%", meaning: "지어낸 값" }],
    hypothesis: "상세페이지 첫 화면 가설", test: { method: "A/B", duration: "1주", compare_metrics: ["purchase_rate"] }, comparison: "비교 데이터 없음", cautions: [] });
  const r = parseOutput("설명\n" + raw, payload);
  assert.equal(r.evidence.length, 1); assert.equal(r.evidence[0].actual, 1.8); assert.deepEqual(r.dropped, ["current.adsets[0].cvr"]);
});

test("실제 지표 근거가 하나도 없거나 JSON이 아니면 AI 분석으로 인정하지 않는다", () => {
  assert.equal(parseOutput("분석 결과: 좋아요", payload), null);
  assert.equal(parseOutput(JSON.stringify({ status: "a", action: "b", evidence: [{ metric: "x.y", value: "1" }] }), payload), null);
});

test("경로 조회와 입력 검증", () => {
  assert.equal(lookup(payload, "current.sales.partial"), true);
  assert.equal(lookup(payload, "current.adsets[1].roas"), undefined);
  assert.equal(validatePayload({}), "payload가 필요합니다.");
  assert.equal(validatePayload({ payload: { current: {} } }), null);
});
