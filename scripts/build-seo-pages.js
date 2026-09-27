#!/usr/bin/env node
'use strict';
/* 공개 자료실 데이터에서 검색 가능한 정적 페이지를 만든다. 해시 앱은 유지한다. */
const fs = require('node:fs');
const path = require('node:path');
const data = require('../resources-data.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://launchdesk.co.kr';
const PAGES = [
  {
    route: '/tools/margin-calculator/',
    slug: 'margin-before-selling',
    title: '쇼핑몰 마진 계산기 | 수수료·배송비·광고비까지 확인',
    heading: '내 상품은 얼마가 남을까?',
    description: '판매가만 보고 가격을 정하기 전에 원가·수수료·배송비·광고비를 확인하세요. 비용 체크리스트를 읽고 무료 마진 계산기로 직접 계산해보세요.',
    action: '무료 마진 계산기 열기',
    actionHref: '/#/tools'
  },
  {
    route: '/guides/marketplace-vs-own/',
    slug: 'marketplace-vs-own',
    title: '스마트스토어와 자사몰, 무엇부터 시작할까? | 런치데스크',
    heading: '스마트스토어와 자사몰, 무엇부터 시작할까?',
    description: '온라인 쇼핑몰을 시작할 때 오픈마켓과 자사몰 중 어디부터 시작할지 고민된다면, 초기 유입·비용·브랜드 운영 기준으로 선택해보세요.',
    action: '쇼핑몰 준비 단계 보기',
    actionHref: '/#/start'
  },
  {
    route: '/guides/supplier-check-checklist/',
    slug: 'supplier-check-checklist',
    title: '도매처·공급처 계약 전 확인할 7가지 | 런치데스크',
    heading: '도매처를 정하기 전, 이 7가지는 확인하세요',
    description: '공급가부터 MOQ, 배송 조건, 반품·교환, 품절 대응과 세금계산서까지. 초보 쇼핑몰 운영자를 위한 공급처 비교 체크리스트입니다.',
    action: '도매처 후보 살펴보기',
    actionHref: '/#/wholesale'
  }
];

function escapeHtml(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderBlock(block){
  const items = () => (block.items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  if(block.t === 'h3') return `<h2>${escapeHtml(block.text)}</h2>`;
  if(block.t === 'list') return `<ul>${items()}</ul>`;
  if(block.t === 'checklist') return `<ul class="checklist">${items()}</ul>`;
  if(block.t === 'numbered') return `<ol>${items()}</ol>`;
  if(block.t === 'note') return `<p class="note">${escapeHtml(block.text)}</p>`;
  if(block.t === 'cta'){
    const href = block.slug ? `/#/resources/${encodeURIComponent(block.slug)}` :
      (block.href && block.href.startsWith('#/') ? `/${block.href}` : block.href);
    if(!href || !href.startsWith('/')) return '';
    return `<p class="inline-action"><a href="${escapeHtml(href)}">${escapeHtml(block.label)} →</a></p>`;
  }
  throw new Error(`Unsupported SEO guide block: ${block.t}`);
}

function renderPage(page){
  const guide = data.getGuide(page.slug);
  if(!guide) throw new Error(`Missing guide: ${page.slug}`);
  const related = PAGES.filter(item => item.route !== page.route)
    .map(item => `<a href="${item.route}">${escapeHtml(item.heading)} <span aria-hidden="true">↗</span></a>`).join('');
  const url = ORIGIN + page.route;
  const blocks = guide.blocks.map(renderBlock).join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/assets/og-share.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/seo-pages.css">
</head>
<body>
<header class="top"><a class="brand" href="/">▦ <strong>LaunchDesk</strong></a><nav aria-label="주 메뉴"><a href="/#/start">쇼핑몰 준비</a><a href="/#/tools">운영 도구</a><a href="/#/resources">자료실</a></nav></header>
<main><div class="breadcrumb"><a href="/">홈</a><span aria-hidden="true">/</span><a href="/#/resources">실무 가이드</a></div>
<article><span class="eyebrow">LAUNCHDESK · 실무 가이드</span><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(guide.intro)}</p>
<div class="article-body">${blocks}</div>
<div class="action"><p>이제 내 상황에 맞춰 직접 확인해보세요.</p><a href="${page.actionHref}">${escapeHtml(page.action)} <span aria-hidden="true">→</span></a></div>
</article><aside class="related" aria-label="함께 볼 자료"><h2>다음으로 읽기</h2>${related}</aside></main>
<footer><span>© LaunchDesk</span><span><a href="/#/privacy">개인정보처리방침</a> · <a href="/#/terms">이용약관</a> · <a href="/">홈</a></span></footer>
</body></html>\n`;
}

function buildSeoPages(outDir){
  fs.copyFileSync(path.join(ROOT, 'seo-pages.css'), path.join(outDir, 'seo-pages.css'));
  for(const page of PAGES){
    const target = path.join(outDir, page.route.slice(1), 'index.html');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderPage(page), 'utf8');
  }
  return PAGES.length;
}

module.exports = { PAGES, renderPage, buildSeoPages };
