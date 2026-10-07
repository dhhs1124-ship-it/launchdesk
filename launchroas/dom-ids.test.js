// 화면 스크립트가 찾는 요소 ID가 index.html에 모두 있는지 — 없으면 그 스크립트가 중간에 멈춘다(2026-10-06 광고비 카드 미표시 원인).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const CREATED_IN_CODE=new Set(['fxToast']); // motion.js가 직접 만든다
test('스크립트가 찾는 요소 ID는 index.html에 있다',()=>{
  const html=fs.readFileSync(__dirname+'/index.html','utf8');
  const missing=[];
  for(const f of ['app.js','sales.js','insights.js','ad-performance.js','adlog.js','calculator.js','connections.js','tour.js']){
    const src=fs.readFileSync(__dirname+'/'+f,'utf8');
    for(const m of src.matchAll(/(?:byId|getElementById)\('([A-Za-z][\w-]*)'\)/g)){
      if(!CREATED_IN_CODE.has(m[1])&&!html.includes('id="'+m[1]+'"'))missing.push(f+': '+m[1]);
    }
  }
  assert.deepEqual(missing,[]);
});

test('운영 결과물에 테스트 파일 · 내부 문서가 올라가지 않는다(.vercelignore) · 검수 자료는 이 폴더 밖', () => {
  const fs = require('node:fs');
  const ig = fs.readFileSync(__dirname + '/.vercelignore', 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const p of ['*.test.js', '*.test.mjs', 'README.md']) assert.ok(ig.includes(p), p);
  const files = fs.readdirSync(__dirname);
  assert.ok(files.filter((f) => /\.test\.m?js$/.test(f)).length > 0);
  assert.deepEqual(files.filter((f) => /mock|review|\.jpg$|\.png$/i.test(f) && f !== 'apple-touch-icon.png'), [], '검수 자료(모의 화면 · 캡처)는 docs/review에만');
});
