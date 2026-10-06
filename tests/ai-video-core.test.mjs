// 광고 영상 분석 준비(순수 함수) — 유료 호출 없음. 실행: node --test tests/ai-video-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { planFrameTimes, estimateVideoCost, buildVideoContent, validateVideoOutput } from "../supabase/functions/_shared/ai-video-core.mjs";

test("프레임 계획: 첫 3초는 0.5초 간격, 이후 간격을 넓혀 최대 장수를 지키고 마지막 프레임을 넣는다", () => {
  const t = planFrameTimes(81.4);
  assert.deepEqual(t.slice(0, 7), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  assert.ok(t.length <= 24);
  assert.equal(t[t.length - 1], 81.2);
  assert.deepEqual(planFrameTimes(13.1).slice(-2), [12, 12.9]);
  assert.deepEqual(planFrameTimes(0), []);
});

test("비용 추정은 추정값으로 표시한다(360×640 프레임 24장)", () => {
  const c = estimateVideoCost({ frames: 24, width: 360, height: 640 });
  assert.equal(c.per_frame_tokens, 308);
  assert.equal(c.estimated, true);
  assert.equal(c.usd, Math.round(((24 * 308 + 3000) * 2 + 2500 * 10) / 1e6 * 10000) / 10000);
});

test("요청 본문: 본 프레임 시각과 전사 유무를 함께 보내고, 전사가 없으면 음성 미확인을 명시", () => {
  const c = buildVideoContent({ ad: { ad_id: "1", ad_name: "니트" }, frames: [{ t: 0, base64: "AA" }, { t: 0.5, base64: "BB" }] });
  assert.match(c[0].text, /"frames_seen":\[0,0.5\]/);
  assert.equal(c.filter((x) => x.type === "image").length, 2);
  assert.match(c[c.length - 1].text, /음성은 미확인/);
});

test("출력 검증: 본 프레임 밖 시간대 · 근거 없는 문제 · 전사 없는 음성 언급 · 음성 한계 누락을 거른다", () => {
  const seen = [0, 0.5, 1, 1.5, 2, 2.5, 3, 5, 7];
  const good = { suggestions: [{ t_from: 0, t_to: 1, target: "첫 장면", change: "첫 자막을 소재 정보로", compare_method: "같은 광고 세트에 새 광고", basis: "0~1초 상품명만 보임" }],
    issues: [{ t_from: 0, t_to: 2, what: "첫 자막이 상품명뿐", evidence_t: [0, 1] }], limits: ["음성 미확인", "표본 프레임만 확인"] };
  assert.deepEqual(validateVideoOutput(good, seen, false), { ok: true, errors: [] });
  const bad = { suggestions: [{ t_from: 40, t_to: 42, change: "내레이션을 빠르게", compare_method: "x", basis: "y" }], issues: [{ what: "BGM이 약함", evidence_t: [] }], limits: [] };
  const r = validateVideoOutput(bad, seen, false);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("본 프레임 밖")));
  assert.ok(r.errors.some((e) => e.includes("전사 없이 음성 언급")));
  assert.ok(r.errors.some((e) => e.includes("근거 프레임 없음")));
  assert.ok(r.errors.includes("limits에 음성 미확인 없음"));
  assert.equal(validateVideoOutput(bad.suggestions && { ...good, suggestions: [{ ...good.suggestions[0], change: "내레이션 첫 문장을 바꿈" }] }, seen, true).ok, true, "전사가 있으면 음성 언급 허용");
});
