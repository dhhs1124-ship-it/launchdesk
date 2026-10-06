// 광고 영상 분석 드라이런 — AI를 부르지 않는다.
// 서버 운영자 검증 경로(ai-weekly-review action: "verify_video")와 같은 함수(prepareVideoVerify · finishVideoVerify)로
// 프레임 폴더 → 요청 검사 · 구성 · 비용 추정 → (모의 응답으로) 출력 검증까지 확인한다.
// 사용: node scripts/video-review-dryrun.mjs <frames-dir> [--ad=연결할 Meta 광고ID(선택)] [--metrics=지표.json] [--transcript=전사.txt]
//  - 프레임 파일 이름은 시각(예: 0.0.jpg, 0.5.jpg, 12.0.jpg) — launchroas/video-frames.js가 뽑은 프레임을 그대로 쓴다
//  - 모의 응답 2개(검증 통과 예 · 전사 없이 음성을 언급한 예)는 출력 검증이 동작하는지 보기 위한 것이며 실제 분석 결과가 아니다
import fs from "node:fs";
import path from "node:path";
import { prepareVideoVerify, finishVideoVerify, estimateVideoCost, VIDEO_PROMPT_VERSION } from "../supabase/functions/_shared/ai-video-core.mjs";
import { priceOf } from "../supabase/functions/_shared/ai-weekly-core.mjs";

const args = process.argv.slice(2), opt = (k) => (args.find((a) => a.startsWith("--" + k + "=")) || "").split("=").slice(1).join("=") || null;
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) { console.error("사용: node scripts/video-review-dryrun.mjs <frames-dir> [--ad=ID] [--metrics=file] [--transcript=file]"); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort((a, b) => parseFloat(a) - parseFloat(b));
const frames = files.map((f) => ({ t: parseFloat(f), mediaType: "image/jpeg", base64: fs.readFileSync(path.join(dir, f)).toString("base64") }));
const transcript = opt("transcript") ? fs.readFileSync(opt("transcript"), "utf8") : null;
const body = { meta_ad_id: opt("ad"), file_name: path.basename(dir), frames, transcript, metrics: opt("metrics") ? JSON.parse(fs.readFileSync(opt("metrics"), "utf8")) : null, dry_run: true };

const prep = prepareVideoVerify(body, { model: "claude-sonnet-5-5", price: priceOf("claude-sonnet-5-5") });
if (!prep.ok) { console.log(JSON.stringify({ ok: false, errors: prep.errors }, null, 2)); process.exit(1); }
// JPEG 크기(SOF0/SOF2)
function size(buf) { for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + len; } return { w: 0, h: 0 }; }
const s = size(fs.readFileSync(path.join(dir, files[0])));
const est = estimateVideoCost({ frames: frames.length, width: s.w, height: s.h });

const seen = prep.frames_seen, s3 = seen.filter((x) => x <= 3);
// 모의 응답 — 출력 검증 동작 확인용(실제 분석 결과가 아님)
const mockGood = JSON.stringify({ observed: [{ t: seen[0], modality: "visual", scene: "(모의) 장면", text_on_screen: null }],
  hook: { product_first_seen_t: seen[0], first_text_t: null, evidence_t: s3, summary: "(모의) 첫 3초 프레임" },
  issues: [{ what: "(모의) 첫 자막에 상품 정보가 없음", modality: "on_screen_text", evidence_t: seen.slice(0, 3), span: { from: seen[0], to: seen[2] } }],
  suggestions: [{ kind: "new_caption", target: "첫 장면", evidence_t: [seen[0]], span: null, change: "(모의) 첫 자막을 확인된 소재 정보로", replacement_caption: "(모의)", replacement_scene: null,
    compare_method: "같은 광고 세트에 새 광고 · 동시 집행 비교(균등 배분 아님)", basis: "(모의) 0초 프레임", basis_modality: "visual", is_provisional: true }],
  needs_info: ["소재 혼용률"], limits: ["음성 미확인", "프레임 사이 장면 · 움직임 · 편집 미확인"] });
// 리뷰에서 재현한 위반: 본 적 없는 시각 · 시각 관찰의 음성/움직임 표현 · 긴 구간
const mockBad = JSON.stringify({ ...JSON.parse(mockGood), observed: [{ t: 13.3, modality: "visual", scene: "(모의) 나레이션하며 걷는 장면" }],
  hook: { product_first_seen_t: 9.5, first_text_t: null, evidence_t: [seen[0]], summary: "(모의) 멘트로 시작, 컷 전환이 빠름" },
  issues: [{ what: "(모의)", modality: "visual", evidence_t: [seen[0], seen[seen.length - 1]], span: { from: seen[0], to: seen[seen.length - 1] } }] });

console.log(JSON.stringify({
  prompt_version: VIDEO_PROMPT_VERSION, called_ai: false,
  request: { frames: seen.length, frames_seen: seen, frame_size: s, transcript_provided: prep.transcript_provided, request_bytes: prep.request_bytes },
  cost: { estimated_usd: est.usd, estimated_input_tokens: est.input_tokens, worst_usd_precheck: prep.worst_usd, note: "측정 전 추정값" },
  last_text_block: prep.content[prep.content.length - 1].text,
  source: prep.source,
  validation_mock_good: finishVideoVerify(mockGood, seen, prep.transcript, "end_turn").validation,
  validation_mock_bad: finishVideoVerify(mockBad, seen, prep.transcript, "end_turn").validation,
  validation_mock_truncated: finishVideoVerify(mockGood, seen, prep.transcript, "max_tokens").validation,
}, null, 2));
