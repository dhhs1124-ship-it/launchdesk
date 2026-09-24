/* scripts/predeploy-privacy-v1_2-gate.js 자체의 판정 로직 검증.

   주의: index.html이 지금 실제로 [게시 예정일]/[공개 전 확정 필요]를
   포함하는지는 여기서 검사하지 않는다(로컬 준비 단계에는 의도적으로
   남아있어야 하므로 — 그 사실 자체를 단정하면 게시 시점에 이 테스트가
   깨진다). 대신 PREDEPLOY_GATE_ROOT로 임시 픽스처 디렉터리를 가리켜,
   "자리표시자가 있으면 막고 없으면 통과한다"는 판정 로직만 독립적으로
   확인한다. 실행: node --test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GATE_SCRIPT = path.join(ROOT, 'scripts', 'predeploy-privacy-v1_2-gate.js');

function runGateAgainst(indexHtmlContent){
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-predeploy-gate-'));
  fs.writeFileSync(path.join(fixtureDir, 'index.html'), indexHtmlContent, 'utf8');
  try {
    return spawnSync(process.execPath, [GATE_SCRIPT], {
      env: Object.assign({}, process.env, { PREDEPLOY_GATE_ROOT: fixtureDir }),
      encoding: 'utf8'
    });
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

test('게이트 스크립트 파일이 존재한다', () => {
  assert.ok(fs.existsSync(GATE_SCRIPT), 'scripts/predeploy-privacy-v1_2-gate.js가 없음');
});

test('본문에 [게시 예정일]이 남아 있으면 exit 1(BLOCK)이고, 어느 줄인지 알려준다', () => {
  const res = runGateAgainst('<p class="privacy-meta">시행일 [게시 예정일] · v1.2</p>\n');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /BLOCK/);
  assert.match(res.stderr, /1행/);
  assert.match(res.stderr, /게시일 자리표시자/);
});

test('본문에 [공개 전 확정 필요]가 남아 있으면 exit 1(BLOCK)이다', () => {
  const res = runGateAgainst('<td>[공개 전 확정 필요: 국가 미정]</td>\n');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /BLOCK/);
  assert.match(res.stderr, /법적 분류\/처리국가 미확정 표시/);
});

test('두 자리표시자 모두 없으면 exit 0(OK)이다', () => {
  const res = runGateAgainst('<p class="privacy-meta">시행일 2026년 10월 1일 · v1.2</p>\n<td>국외(미국)</td>\n');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /OK/);
});

test('HTML 주석 안에만 있는 자리표시자는 차단하지 않고(exit 0) 참고 문구로만 안내한다', () => {
  const res = runGateAgainst('<!-- [공개 전 확정 필요] 나중에 채울 것 -->\n<p>본문에는 없음</p>\n');
  assert.equal(res.status, 0, '주석 안에만 있는 언급은 게시를 막으면 안 된다(사용자에게 보이지 않으므로)');
  assert.match(res.stderr, /참고\(차단 아님\)/);
});

test('같은 줄에 본문 자리표시자와 주석이 섞여 있으면 그 줄은 차단(BLOCK) 쪽으로 판정한다', () => {
  const res = runGateAgainst('<p>시행일 [게시 예정일]</p><!-- 나중에 채울 것 -->\n');
  assert.equal(res.status, 1);
});
