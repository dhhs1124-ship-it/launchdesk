/* 런치데스크(루트)와 LaunchROAS(launchroas/)는 Vercel 프로젝트 루트가 달라 파일을 공유하지 못하고 복사본을 둔다.
   같은 내용이어야 하는 복사본이 한쪽만 고쳐져 두 화면의 계산 · 표시가 어긋나지 않게 지킨다.
   margin-calc.js는 의도적으로 다르다(LaunchROAS는 판매가 0원 허용) — 그 차이만 허용한다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

test('같아야 하는 공유 복사본(루트 · launchroas/)은 내용이 같다', () => {
  for (const f of ['adlog-core.js', 'adlog-meta.js', 'ops-period-core.js', 'policy-consent-core.js']) {
    assert.equal(read('launchroas/' + f), read(f), f + ' — 한쪽만 고쳤다면 다른 쪽도 같이 고쳐 주세요');
  }
});

test('margin-calc.js 복사본은 판매가 0원 허용 한 곳만 다르다', () => {
  const a = read('margin-calc.js').split('\n'), b = read('launchroas/margin-calc.js').split('\n');
  const onlyA = a.filter((l) => !b.includes(l)), onlyB = b.filter((l) => !a.includes(l));
  assert.deepEqual(onlyA.map((l) => l.trim()), ["input.price = req('price', { min: 0.000001, emptyMsg: '판매가를 입력해주세요', rangeMsg: '판매가는 0보다 커야 해요' });"]);
  assert.equal(onlyB.length, 2); assert.ok(onlyB.some((l) => /min: 0, emptyMsg: '판매가를 입력해주세요 \(사은품은 0\)'/.test(l)));
});
