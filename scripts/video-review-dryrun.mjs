// 광고 영상 분석 요청 미리보기(드라이런) — AI를 부르지 않는다. 프레임 JPG 폴더 + 지표 JSON으로 요청 본문 크기 · 토큰 · 비용 추정을 출력한다.
// 사용: node scripts/video-review-dryrun.mjs <frames-dir> [metrics.json] [--duration=초]
//  - 프레임 파일 이름에 시각을 넣는다(예: 0.0.jpg, 0.5.jpg, 12.0.jpg). 이름에서 시각을 읽지 못하면 순번으로 둔다.
//  - 실제 호출은 운영자 승인 후 별도 단계에서 한다(이 스크립트에는 호출 코드가 없다).
import fs from "node:fs";
import path from "node:path";
import { buildVideoContent, estimateVideoCost, VIDEO_SYSTEM_PROMPT, VIDEO_PROMPT_VERSION } from "../supabase/functions/_shared/ai-video-core.mjs";

const [dir, metricsFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dir) { console.error("사용: node scripts/video-review-dryrun.mjs <frames-dir> [metrics.json]"); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort((a, b) => parseFloat(a) - parseFloat(b));
const frames = files.map((f, i) => ({ t: Number.isFinite(parseFloat(f)) ? parseFloat(f) : i, mediaType: "image/jpeg", base64: fs.readFileSync(path.join(dir, f)).toString("base64") }));
const metrics = metricsFile ? JSON.parse(fs.readFileSync(metricsFile, "utf8")) : null;
const content = buildVideoContent({ ad: { ad_id: "dry-run", ad_name: path.basename(dir) }, metrics, frames });
// JPEG 크기(SOF0/SOF2)에서 가로 · 세로 읽기
function size(buf) { for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + len; } return { w: 0, h: 0 }; }
const s = files.length ? size(fs.readFileSync(path.join(dir, files[0]))) : { w: 0, h: 0 };
const est = estimateVideoCost({ frames: frames.length, width: s.w, height: s.h, promptTokens: Math.ceil(VIDEO_SYSTEM_PROMPT.length / 2) + 600 });
const bytes = Buffer.byteLength(JSON.stringify({ system: VIDEO_SYSTEM_PROMPT, messages: [{ role: "user", content }] }));
console.log(JSON.stringify({ prompt_version: VIDEO_PROMPT_VERSION, frames: frames.length, frame_size: s, request_bytes: bytes, estimate: est, called_ai: false }, null, 2));
