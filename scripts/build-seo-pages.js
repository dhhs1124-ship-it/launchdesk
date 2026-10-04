#!/usr/bin/env node
'use strict';
/* 검색용 URL에서도 기존 앱의 계산기/가이드를 그대로 보여준다.
   배포 시 각 URL에 실제 HTML을 만들고, 초기 HTML에 가이드 본문을 넣는다. */
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
    appRoute: '/tools'
  },
  {
    route: '/guides/marketplace-vs-own/',
    slug: 'marketplace-vs-own',
    title: '스마트스토어와 자사몰, 무엇부터 시작할까? | 런치데스크',
    heading: '스마트스토어와 자사몰, 무엇부터 시작할까?',
    description: '의류 쇼핑몰을 시작할 때 오픈마켓과 자사몰 중 어디부터 시작할지 고민된다면, 초기 유입·비용·브랜드 운영 기준으로 선택해보세요.',
    appRoute: '/resources/marketplace-vs-own'
  },
  {
    route: '/guides/supplier-check-checklist/',
    slug: 'supplier-check-checklist',
    title: '도매처·공급처 계약 전 확인할 7가지 | 런치데스크',
    heading: '도매처를 정하기 전, 이 7가지는 확인하세요',
    description: '공급가부터 MOQ, 배송 조건, 반품·교환, 품절 대응과 세금계산서까지. 초보 의류 쇼핑몰 운영자를 위한 도매처 비교 체크리스트입니다.',
    appRoute: '/resources/supplier-check-checklist'
  }
];

function escapeHtml(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderBlock(block){
  const items = () => (block.items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  if(block.t === 'h3') return `<h3 class="res-panel-h3">${escapeHtml(block.text)}</h3>`;
  if(block.t === 'list') return `<ul class="res-panel-list">${items()}</ul>`;
  if(block.t === 'checklist') return `<ul class="res-checklist">${items()}</ul>`;
  if(block.t === 'numbered') return `<ol>${items()}</ol>`;
  if(block.t === 'note') return `<div class="res-note"><p>${escapeHtml(block.text)}</p></div>`;
  if(block.t === 'cta'){
    const href = block.slug ? `/#/resources/${encodeURIComponent(block.slug)}` :
      (block.href && block.href.startsWith('#/') ? `/${block.href}` : block.href);
    if(!href || !href.startsWith('/')) return '';
    return `<p class="ask-inline"><a href="${escapeHtml(href)}">${escapeHtml(block.label)} →</a></p>`;
  }
  throw new Error(`Unsupported SEO guide block: ${block.t}`);
}

function renderPage(page){
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const guide = data.getGuide(page.slug);
  if(!guide) throw new Error(`Missing guide: ${page.slug}`);
  const url = ORIGIN + page.route;
  function replaceOnce(html, before, after){
    if(!html.includes(before)) throw new Error(`Missing HTML anchor: ${before.slice(0, 80)}`);
    return html.replace(before, after);
  }
  let html = source;
  // base를 루트로 둬서 기존 상대 경로 스크립트/이미지와 #/ 내부 링크가
  // /guides/.../ 아래가 아닌 / 아래에서 작동한다.
  html = replaceOnce(html, '<head>', '<head>\n<base href="/">');
  html = replaceOnce(html, '<title>런치데스크 | 의류 쇼핑몰 시작 가이드 · 운영 도구</title>', `<title>${escapeHtml(page.title)}</title>`);
  html = replaceOnce(html,
    '<meta name="description" content="\'의류 쇼핑몰 해 볼까\' 고민 중이라면. 초보 의류 셀러를 위한 준비 로드맵, 마진 계산기, 동대문 도매처 찾기를 런치데스크에서 순서대로 시작하세요.">',
    `<meta name="description" content="${escapeHtml(page.description)}">`);
  html = replaceOnce(html, '<link rel="canonical" href="https://launchdesk.co.kr/">', `<link rel="canonical" href="${url}">`);
  html = replaceOnce(html, '<meta property="og:url" content="https://launchdesk.co.kr/">', `<meta property="og:url" content="${url}">`);
  html = replaceOnce(html, '<meta property="og:title" content="런치데스크 | 의류 쇼핑몰 시작 가이드 · 운영 도구">', `<meta property="og:title" content="${escapeHtml(page.title)}">`);
  html = replaceOnce(html, '<meta property="og:description" content="\'의류 쇼핑몰 해 볼까\' 고민 중이라면. 초보 의류 셀러를 위한 준비 로드맵, 마진 계산기, 동대문 도매처 찾기를 런치데스크에서 순서대로 시작하세요.">', `<meta property="og:description" content="${escapeHtml(page.description)}">`);
  html = replaceOnce(html, '<body>', `<body class="${page.appRoute === '/tools' ? 'tools-view' : 'resources-view'}" data-route="${page.appRoute}">`);
  if(page.appRoute === '/tools'){
    html = replaceOnce(html, '<section class="view" id="view-tools" hidden>', '<section class="view" id="view-tools">');
  } else {
    const resource = data.getResource(page.slug);
    if(!resource) throw new Error(`Missing resource: ${page.slug}`);
    const staticPanel = `<h1 class="res-panel-title">${escapeHtml(resource.title)}</h1>` +
      `<p class="res-panel-intro">${escapeHtml(guide.intro)}</p>` + guide.blocks.map(renderBlock).join('');
    html = replaceOnce(html, '<section class="view" id="view-resources" hidden>', '<section class="view res-reading-view" id="view-resources">');
    html = replaceOnce(html, '<div id="resIndex">', '<div id="resIndex" hidden>');
    html = replaceOnce(html, '<div class="res-panel" id="resGuidePanel" hidden>', '<div class="res-panel" id="resGuidePanel">');
    html = replaceOnce(html, '<div id="resGuidePanelBody"></div>', `<div id="resGuidePanelBody">${staticPanel}</div>`);
  }
  return html;
}

function buildSeoPages(outDir){
  for(const page of PAGES){
    const target = path.join(outDir, page.route.slice(1), 'index.html');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderPage(page), 'utf8');
  }
  return PAGES.length;
}

module.exports = { PAGES, renderPage, buildSeoPages };
