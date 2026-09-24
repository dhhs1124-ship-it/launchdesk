#!/usr/bin/env node
'use strict';
/* v1.2 개인정보처리방침 배포 전 게이트 — index.html에 [게시 예정일]·
   [공개 전 확정 필요] 자리표시자가 아직 남아 있으면 배포를 막는다.
   원격 실행·게시·배포 자체는 하지 않는다(순수 로컬 정적 검사) — 실제
   배포는 언제나 사람이 수동으로 한다. 이 스크립트는 "지금 게시해도
   되는 상태인가"만 exit code로 알려준다.

   지금(로컬 준비 단계)은 반드시 실패(exit 1)해야 정상이다 — 게시일과
   Resend·Cloudflare 법적 분류가 의도적으로 아직 미확정 상태이기
   때문이다. 실제 게시 직전, 그 값들을 전부 확정한 뒤에만 통과(exit 0)
   해야 한다.

   node --test로 도는 일반 테스트 스위트(tests/*.test.js)에는 포함하지
   않는다 — 포함하면 평상시 개발 중에도 늘 실패해 스위트 전체가 상시
   빨간불이 된다. 배포 직전에만 수동으로 실행한다:

     node scripts/predeploy-privacy-v1_2-gate.js
*/
const fs = require('node:fs');
const path = require('node:path');

// 테스트용으로만 override 가능(실제 배포 시에는 절대 설정하지 않음) —
// 실제 index.html을 건드리지 않고 스크립트 자체 검사 로직을 검증할 때 씀.
const ROOT = process.env.PREDEPLOY_GATE_ROOT || path.join(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

const PLACEHOLDER_PATTERNS = [
  { label: '게시일 자리표시자', re: /\[게시 예정일\]/g },
  { label: '법적 분류/처리국가 미확정 표시', re: /\[공개 전 확정 필요[^\]]*\]/g }
];

function lineOf(source, index){
  return source.slice(0, index).split('\n').length;
}

// 주석 안의 언급은 실제 게시 문구가 아니므로 위치(길이)는 그대로 두고
// 내용만 공백으로 비운다 — 그래야 이후 index가 원본 html과 그대로
// 맞아떨어져 줄 번호 계산이 어긋나지 않는다.
function blankComments(source){
  return source.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
}

const visible = blankComments(html);
const blocking = [];
const advisory = [];

for (const { label, re } of PLACEHOLDER_PATTERNS) {
  const blockingLines = new Set();
  let m;
  const reVisible = new RegExp(re.source, re.flags);
  while ((m = reVisible.exec(visible))) {
    const line = lineOf(html, m.index);
    blocking.push({ label, text: m[0], line });
    blockingLines.add(line);
  }
  const reAll = new RegExp(re.source, re.flags);
  while ((m = reAll.exec(html))) {
    const line = lineOf(html, m.index);
    if (!blockingLines.has(line)) advisory.push({ label, text: m[0], line });
  }
}

if (blocking.length === 0 && advisory.length === 0) {
  console.log('OK: index.html에 [게시 예정일]/[공개 전 확정 필요] 자리표시자가 남아 있지 않습니다 — 게시 가능.');
  process.exit(0);
}

if (blocking.length > 0) {
  console.error(`BLOCK: index.html 본문(사용자에게 실제로 보이는 부분)에 게시 전 확정이 필요한 자리표시자가 ${blocking.length}건 남아 있습니다:`);
  for (const b of blocking) console.error(`  - ${b.line}행: ${b.label} — "${b.text}"`);
}
if (advisory.length > 0) {
  console.error(`참고(차단 아님): HTML 주석 안에만 남은 언급 ${advisory.length}건 — 사용자에게는 보이지 않지만 정리를 권장합니다:`);
  for (const a of advisory) console.error(`  - ${a.line}행: ${a.label} — "${a.text}"`);
}

process.exit(blocking.length > 0 ? 1 : 0);
