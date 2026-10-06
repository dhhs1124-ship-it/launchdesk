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

test("요청 본문: 출처(사용자 제공 영상) · 본 프레임 시각 · 전사 유무를 보내고, 전사가 없으면 음성 미확인을 명시", () => {
  const c = buildVideoContent({ frames: [{ t: 0, base64: "AA" }, { t: 0.5, base64: "BB" }] });
  assert.match(c[0].text, /"frames_seen":\[0,0.5\]/);
  assert.match(c[0].text, /사용자가 제공한 영상/);
  assert.equal(c.filter((x) => x.type === "image").length, 2);
  assert.match(c[c.length - 1].text, /음성은 미확인/);
});

const SEEN = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 6];
const GOOD = {
  observed: [{ t: 0, modality: "visual", scene: "모델이 니트를 입고 정면에 섬", text_on_screen: null }, { t: 1, modality: "on_screen_text", scene: "상단 자막", text_on_screen: "가을 니트" }],
  hook: { product_first_seen_t: 0, first_text_t: 1, evidence_t: [0, 0.5, 1], summary: "0초에 상품 착용, 1초에 상품명 자막" },
  issues: [{ what: "첫 1초 자막이 상품명뿐", modality: "on_screen_text", evidence_t: [0, 0.5, 1], span: { from: 0, to: 1 } }],
  suggestions: [{ kind: "new_caption", target: "첫 장면", evidence_t: [1], span: null, change: "첫 자막을 소재 정보로", replacement_caption: "소리 켜고 보세요 · 울 50%", replacement_scene: "모델이 말하며 소매를 늘려 보여 줌",
    compare_method: "같은 광고 세트에 새 광고 · 동시 집행 비교(균등 배분 아님)", basis: "1초 자막에 상품명만 보임", basis_modality: "on_screen_text", is_provisional: true }],
  needs_info: ["소재 혼용률"], limits: ["음성 미확인", "프레임 사이 장면 · 움직임 · 편집 미확인"],
};

test("출력 검증: 정상 출력 통과 — 새로 만들 자막 · 장면 제안의 음성 · 움직임 표현은 막지 않는다", () => {
  assert.deepEqual(validateVideoOutput(GOOD, SEEN, null), { ok: true, errors: [] });
});

test("출력 검증 회귀(리뷰 재현): 본 적 없는 13초 장면 · 시각 관찰의 나레이션 · 멘트 · 컷 전환 · 노래 근거 · 4~30초 구간을 모두 거른다", () => {
  const bad = { ...GOOD,
    observed: [{ t: 13, modality: "visual", scene: "모델이 나레이션하며 걷는 장면" }],
    hook: { product_first_seen_t: 9.5, first_text_t: 11, evidence_t: [0], summary: "멘트로 시작, 컷 전환이 빠름" },
    suggestions: [{ ...GOOD.suggestions[0], evidence_t: [4, 6], span: { from: 4, to: 30 }, basis: "노래가 약함", basis_modality: "visual" }],
    needs_info: ["효과음 확인"], limits: ["음성 미확인", "프레임 사이 미확인"] };
  const r = validateVideoOutput(bad, SEEN, null);
  assert.equal(r.ok, false);
  for (const e of ["observed[0] 본 프레임 밖 시각", "observed[0] 시각 관찰에 음성 표현", "hook.product_first_seen_t 본 프레임 밖 시각", "hook.first_text_t 본 프레임 밖 시각",
    "hook 시각 관찰에 음성 표현", "hook 프레임으로 확인할 수 없는 움직임 · 편집 표현", "suggestions[0] 구간 시각이 본 프레임이 아님", "suggestions[0].basis 시각 관찰에 음성 표현"]) assert.ok(r.errors.includes(e), e + " / " + r.errors.join(" | "));
});

test("출력 검증: 구간은 그 안의 본 프레임을 모두 근거로 들어야 한다(긴 구간 전체 관찰 불가)", () => {
  const gap = { ...GOOD, issues: [{ what: "자막이 작음", modality: "on_screen_text", evidence_t: [0, 6], span: { from: 0, to: 6 } }] };
  assert.ok(validateVideoOutput(gap, SEEN, null).errors.includes("issues[0] 구간 안 본 프레임을 모두 근거로 들지 않음(구간 전체 관찰 불가)"));
});

test("출력 검증: 음성 관찰은 전사가 있고 전사 문장을 인용할 때만 · 움직임 modality는 관찰 불가", () => {
  const audio = { ...GOOD, observed: [{ t: 0, modality: "audio", scene: "첫 문장", transcript_quote: "이 니트 하나로 세 가지" }] };
  assert.ok(validateVideoOutput(audio, SEEN, null).errors.includes("observed[0] 음성 관찰에 전사 인용 없음(전사 없음)"));
  assert.equal(validateVideoOutput(audio, SEEN, "  이 니트 하나로   세 가지 코디가 돼요 ").ok, true, "전사 인용(공백 정규화)");
  assert.ok(validateVideoOutput({ ...audio }, SEEN, "다른 문장").errors.includes("observed[0] 음성 관찰에 전사 인용 없음"));
  const motion = { ...GOOD, observed: [{ t: 0, modality: "motion_edit", scene: "빠른 컷 전환" }] };
  assert.ok(validateVideoOutput(motion, SEEN, null).errors.some((e) => e.includes("움직임 · 편집은 관찰 불가")));
  const noFrameLimit = { ...GOOD, limits: ["음성 미확인"] };
  assert.ok(validateVideoOutput(noFrameLimit, SEEN, null).errors.includes("limits에 프레임 사이 미확인 없음"));
});

import { prepareVideoVerify, finishVideoVerify, VIDEO_LIMITS } from "../supabase/functions/_shared/ai-video-core.mjs";
const PRICE = { inPerM: 2, outPerM: 10 };
const frame = (t) => ({ t, mediaType: "image/jpeg", base64: "QUJD" });

test("운영자 영상 검증 요청 검사: 가격 · 광고 ID(선택) · 프레임 형식 · 오름차순 · 장수 · 전사 길이, 최악 비용은 선택 모델 가격", () => {
  assert.deepEqual(prepareVideoVerify({ meta_ad_id: "x", frames: [] }).errors, ["모델 가격 없음", "meta_ad_id", "frames 없음"]);
  assert.ok(prepareVideoVerify({ frames: [frame(1), frame(0.5)] }, { price: PRICE }).errors.includes("frames 시각은 오름차순 · 중복 없이"));
  assert.ok(prepareVideoVerify({ frames: [{ t: 0, mediaType: "text/html", base64: "QUJD" }] }, { price: PRICE }).errors.includes("frames[0] 형식"));
  assert.ok(prepareVideoVerify({ frames: Array.from({ length: VIDEO_LIMITS.maxFrames + 1 }, (_, i) => frame(i)) }, { price: PRICE }).errors.some((e) => e.startsWith("frames 최대")));
  assert.ok(prepareVideoVerify({ frames: [frame(0)], transcript: "가".repeat(VIDEO_LIMITS.maxTranscript + 1) }, { price: PRICE }).errors.some((e) => e.startsWith("transcript 최대")));
  const ok = prepareVideoVerify({ frames: [frame(0), frame(0.5), frame(3)], file_name: "니트.mp4" }, { model: "claude-sonnet-5-5", price: PRICE });
  assert.equal(ok.ok, true); assert.deepEqual(ok.frames_seen, [0, 0.5, 3]); assert.equal(ok.transcript_provided, false);
  assert.deepEqual([ok.source.kind, ok.source.meta_ad_check, ok.source.file_name], ["user_upload", "not_linked", "니트.mp4"]);
  const opus = prepareVideoVerify({ frames: [frame(0), frame(0.5), frame(3)] }, { price: { inPerM: 5, outPerM: 25 } });
  assert.ok(opus.worst_usd > ok.worst_usd * 2, "선택 모델 가격으로 최악 비용");
  assert.ok(ok.worst_usd > 0 && ok.worst_usd < 0.5);
  assert.equal(prepareVideoVerify({ frames: [frame(0)], meta_ad_id: "120000000000001" }, { price: PRICE }).source.meta_ad_check, "pending", "광고 연결은 서버 확인 전 pending");
});

test("전사는 서버에서 trim — 공백뿐이면 없음(리뷰 재현)", () => {
  const p = prepareVideoVerify({ frames: [frame(0)], transcript: "   \n " }, { price: PRICE });
  assert.equal(p.transcript_provided, false); assert.equal(p.transcript, null);
  assert.match(p.content[p.content.length - 1].text, /음성은 미확인/);
  assert.equal(prepareVideoVerify({ frames: [frame(0)], transcript: "  안녕하세요  " }, { price: PRICE }).transcript, "안녕하세요");
});

test("운영자 영상 검증 응답 처리: 잘림은 해석하지 않고 실패 · JSON 아님 · 검증 실패", () => {
  const good = JSON.stringify(GOOD);
  const cut = finishVideoVerify(good, SEEN, null, "max_tokens");
  assert.equal(cut.ok, false); assert.equal(cut.truncated, true); assert.equal(cut.output, null);
  assert.equal(finishVideoVerify("설명만 있음", SEEN, null, "end_turn").ok, false);
  assert.equal(finishVideoVerify("결과:\n" + good, SEEN, null, "end_turn").ok, true);
  assert.equal(finishVideoVerify(good.replace('"t":0,"modality":"visual"', '"t":13,"modality":"visual"'), SEEN, null, "end_turn").ok, false);
});

import { createRequire } from "node:module";
test("브라우저 프레임 계획(video-frames.js)과 서버 계획(ai-video-core.mjs)이 같은 시각을 만든다", () => {
  const require = createRequire(import.meta.url);
  const VF = require("../launchroas/video-frames.js") && globalThis.LaunchRoasVideoFrames;
  for (const d of [0, 2.4, 13.1, 20.2, 26.9, 70.3, 81.4, 180]) assert.deepEqual(VF.planFrameTimes(d), planFrameTimes(d), "길이 " + d);
});
