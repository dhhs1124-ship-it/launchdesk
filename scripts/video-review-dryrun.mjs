// 광고 영상 분석 드라이런 — AI를 부르지 않는다.
// 서버 운영자 검증 경로(ai-weekly-review action: "verify_video")와 같은 함수(prepareVideoVerify · finishVideoVerify)로
// 프레임 폴더 → 요청 검사 · 구성 · 비용 추정 → (모의 응답으로) 출력 검증까지 확인한다.
// 사용: node scripts/video-review-dryrun.mjs <frames-dir> [--ad=광고ID] [--metrics=지표.json] [--transcript=전사.txt]
//  - 프레임 파일 이름은 시각(예: 0.0.jpg, 0.5.jpg, 12.0.jpg) — launchroas/video-frames.js가 뽑은 프레임을 그대로 쓴다
//  - 모의 응답 2개(검증 통과 예 · 전사 없이 음성을 언급한 예)는 출력 검증이 동작하는지 보기 위한 것이며 실제 분석 결과가 아니다
import fs from "node:fs";
import path from "node:path";
import { prepareVideoVerify, finishVideoVerify, estimateVideoCost, VIDEO_PROMPT_VERSION } from "../supabase/functions/_shared/ai-video-core.mjs";

const args = process.argv.slice(2), opt = (k) => (args.find((a) => a.startsWith("--" + k + "=")) || "").split("=").slice(1).join("=") || null;
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) { console.error("사용: node scripts/video-review-dryrun.mjs <frames-dir> [--ad=ID] [--metrics=file] [--transcript=file]"); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort((a, b) => parseFloat(a) - parseFloat(b));
const frames = files.map((f) => ({ t: parseFloat(f), mediaType: "image/jpeg", base64: fs.readFileSync(path.join(dir, f)).toString("base64") }));
const transcript = opt("transcript") ? fs.readFileSync(opt("transcript"), "utf8") : null;
const body = { ad_id: opt("ad") || "100000000000000", ad_name: "드라이런", frames, transcript, metrics: opt("metrics") ? JSON.parse(fs.readFileSync(opt("metrics"), "utf8")) : null, dry_run: true };

const prep = prepareVideoVerify(body, { model: "claude-sonnet-5-5" });
if (!prep.ok) { console.log(JSON.stringify({ ok: false, errors: prep.errors }, null, 2)); process.exit(1); }
// JPEG 크기(SOF0/SOF2)
function size(buf) { for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + len; } return { w: 0, h: 0 }; }
const s = size(fs.readFileSync(path.join(dir, files[0])));
const est = estimateVideoCost({ frames: frames.length, width: s.w, height: s.h });

const seen = prep.frames_seen;
const mockGood = JSON.stringify({ observed: seen.slice(0, 3).map((t) => ({ t, scene: "(모의) 장면", text_on_screen: null })), hook: { product_first_seen_t: 0, first_text_t: seen[1], summary: "(모의)" },
  issues: [{ t_from: seen[0], t_to: seen[2], what: "(모의) 첫 자막에 상품 정보가 없음", evidence_t: [seen[0], seen[2]] }],
  suggestions: [{ t_from: seen[0], t_to: seen[2], target: "첫 장면", change: "(모의) 첫 자막을 확인된 소재 정보로", replacement_caption: "(모의)", replacement_scene: null, compare_method: "같은 광고 세트에 새 광고 · 동시 집행 비교(균등 배분 아님)", basis: "(모의) 0~1초 프레임", is_provisional: true }],
  needs_info: ["소재 혼용률"], limits: ["음성 미확인", "시간대별 프레임만 확인 · 프레임 사이 움직임 · 편집 미확인"] });
const mockBad = mockGood.replace("(모의) 첫 자막을 확인된 소재 정보로", "(모의) 내레이션을 빠르게").replace('"음성 미확인",', "").replace(`"t_from":${seen[0]},"t_to":${seen[2]},"target"`, `"t_from":999,"t_to":1000,"target"`);

console.log(JSON.stringify({
  prompt_version: VIDEO_PROMPT_VERSION, called_ai: false,
  request: { frames: seen.length, frames_seen: seen, frame_size: s, transcript_provided: prep.transcript_provided, request_bytes: prep.request_bytes },
  cost: { estimated_usd: est.usd, estimated_input_tokens: est.input_tokens, worst_usd_precheck: prep.worst_usd, note: "측정 전 추정값" },
  last_text_block: prep.content[prep.content.length - 1].text,
  validation_mock_good: finishVideoVerify(mockGood, seen, prep.transcript_provided).validation,
  validation_mock_bad: finishVideoVerify(mockBad, seen, prep.transcript_provided).validation,
}, null, 2));
