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
