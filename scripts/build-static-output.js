#!/usr/bin/env node
'use strict';
/* 배포용 출력 폴더(dist/)를 만든다 — index.html이 실제로 참조하는 로컬
   JS와 CSS 파일을 복사한다(하드코딩 목록이 아니라 index.html을 파싱).
   supabase/, docs/, tests/, scripts/,
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

function staticFilesFor(source){
  const scripts = [...source.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map((m) => m[1]);
  const stylesheets = [...source.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)]
    .map((m) => m[1]);
  const local = [...scripts, ...stylesheets]
    .filter((src) => !/^https?:\/\//.test(src));
  return [...new Set([
    'index.html', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png',
    'robots.txt', 'sitemap.xml', ...local
  ])];
}
const STATIC_FILES = staticFilesFor(html);
const STATIC_DIRS = ['assets'];
const { buildSeoPages } = require('./build-seo-pages.js');

if(require.main === module){
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const file of STATIC_FILES) {
    fs.cpSync(path.join(ROOT, file), path.join(OUT, file));
  }
  for (const dir of STATIC_DIRS) {
    fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
  }

  const seoPageCount = buildSeoPages(OUT);

  console.log(`OK: 파일 ${STATIC_FILES.length}개 + 디렉터리 ${STATIC_DIRS.length}개 + 검색 페이지 ${seoPageCount}개를 ${path.relative(ROOT, OUT)}/ 로 복사했습니다.`);
}
module.exports = { staticFilesFor };
