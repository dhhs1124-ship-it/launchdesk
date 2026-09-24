#!/usr/bin/env node
'use strict';
/* 배포용 출력 폴더(dist/)를 만든다 — index.html이 실제로 <script src="...">로
   참조하는 로컬 JS 파일만 허용목록으로 복사한다(하드코딩 목록이 아니라
   index.html을 직접 파싱 — 스크립트 태그를 추가·삭제해도 이 파일을 손대지
   않아도 항상 최신 상태를 유지한다). supabase/, docs/, tests/, scripts/,
   *.sql, *.patch, *.md 같은 비공개 자료는 허용목록에 없으므로 자동으로
   빠진다. 참조하는 파일이 실제로 없으면 fs.cpSync가 그대로 에러를 던져
   빌드가 실패한다(의도된 동작).

   실행: node scripts/build-static-output.js (predeploy 게이트·테스트를
   통과한 뒤에만 vercel.json buildCommand가 이 스크립트를 호출한다) */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const localScripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1])
  .filter((src) => !/^https?:\/\//.test(src));

const STATIC_FILES = [
  'index.html',
  'styles.css',
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'robots.txt',
  'sitemap.xml',
  ...localScripts
];
const STATIC_DIRS = ['assets'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const file of STATIC_FILES) {
  fs.cpSync(path.join(ROOT, file), path.join(OUT, file));
}
for (const dir of STATIC_DIRS) {
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
}

console.log(`OK: 파일 ${STATIC_FILES.length}개 + 디렉터리 ${STATIC_DIRS.length}개를 ${path.relative(ROOT, OUT)}/ 로 복사했습니다.`);
