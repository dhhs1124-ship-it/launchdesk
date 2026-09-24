/* 초보 셀러 첫 방문 동선 — 실행: node --test tests/

   홈 상황 선택(desk.js) → 추천 카드 1개, 홈 운영 현황 안내 문구, 도매처 0건
   빈 상태를 검증한다. desk.js는 최소 DOM 스텁 위 vm 샌드박스에서 실제 소스를
   그대로 실행한다(네트워크·Supabase 호출 없음). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const resourcesData = require('../resources-data.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DESK_SRC = fs.readFileSync(path.join(ROOT, 'desk.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const WHOLESALERS_SRC = fs.readFileSync(path.join(ROOT, 'wholesalers.js'), 'utf8');

// ------------------------------------------------------------ 최소 DOM 스텁
function makeNode(tag){
  const node = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, className: '', hidden: false,
    _text: '', listeners: {},
    classList: { add(c){ node.className = (node.className + ' ' + c).trim(); } },
    appendChild(child){ node.children.push(child); return child; },
    setAttribute(k, v){ node.attrs[k] = String(v); },
    getAttribute(k){ return Object.prototype.hasOwnProperty.call(node.attrs, k) ? node.attrs[k] : null; },
    addEventListener(type, fn){ (node.listeners[type] = node.listeners[type] || []).push(fn); },
    querySelector(){ return null; },
    get textContent(){ return node._text + node.children.map((c) => c.textContent || '').join(''); },
    set textContent(v){ node._text = String(v); node.children = []; }
  };
  return node;
}
function all(node, pred, out = []){
  node.children.forEach((c) => { if(pred(c)) out.push(c); all(c, pred, out); });
  return out;
}

function loadDesk(){
  const els = {
    deskSituation: makeNode('fieldset'),
    deskRec: makeNode('div'),
    deskDecideList: makeNode('div'),
    deskDecideTag: makeNode('span')
  };
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: (t) => makeNode(t),
    createElementNS: (_ns, t) => makeNode(t)
  };
  const window = {};
  vm.runInNewContext(DESK_SRC, { document, window });
  function select(value){
    els.deskSituation.listeners.change.forEach((fn) => fn({ target: { name: 'deskSituation', value } }));
  }
  return { els, select, window };
}

const BUILT_BLOCK = APP_SRC.slice(APP_SRC.indexOf('var BUILT = {'), APP_SRC.indexOf('};', APP_SRC.indexOf('var BUILT = {')));

const EXPECTED = {
  A: { href: '#/start/prepare', text: /STEP 01/ },
  B: { href: '#/tools', text: /마진 계산기/, toolsTarget: 'calc' },
  C: { href: '#/start/setup', text: /설정/ },
  D: { href: '#/start/orders', text: /STEP 05/ }
};

test('상황 A~D를 고르면 추천 카드 1개와 버튼 1개가 기존 화면으로 연결된다', () => {
  const { els, select } = loadDesk();
  Object.keys(EXPECTED).forEach((key) => {
    select(key);
    const cards = all(els.deskRec, (n) => /desk-rec-card/.test(n.className));
    assert.equal(cards.length, 1, key + ': 카드는 하나');
    const links = all(cards[0], (n) => n.tagName === 'A');
    assert.equal(links.length, 1, key + ': 버튼은 하나');
    const exp = EXPECTED[key];
    assert.equal(links[0].getAttribute('href'), exp.href, key + ' href');
    assert.match(links[0].textContent, exp.text, key + ' 버튼 문구');
    assert.equal(links[0].getAttribute('data-tools-target'), exp.toolsTarget || null, key + ' data-tools-target');
    const route = exp.href.replace(/^#/, '');
    assert.ok(BUILT_BLOCK.includes("'" + route + "'"), route + '는 app.js BUILT에 있는 실제 화면');
    const desc = all(cards[0], (n) => /desk-rec-desc/.test(n.className));
    assert.equal(desc.length, 1, key + ': 추천 이유 설명');
    assert.ok(desc[0].textContent.length > 10);
  });
});

test('A는 STEP 01 상품·고객·예산, B는 예상 판매가·남는 돈을 안내한다', () => {
  const { els, select } = loadDesk();
  select('A');
  assert.match(els.deskRec.textContent, /상품·고객·예산/);
  select('B');
  assert.match(els.deskRec.textContent, /판매가/);
  assert.match(els.deskRec.textContent, /남는/);
});

test('상황 선택은 기존 radio + label 구조 그대로다(키보드 선택 유지)', () => {
  ['A', 'B', 'C', 'D'].forEach((v) => {
    assert.match(INDEX, new RegExp('<input type="radio"[^>]*name="deskSituation"[^>]*value="' + v + '"'));
    assert.match(INDEX, new RegExp('<label class="desk-sit" for="deskSit' + v + '"'));
  });
  assert.match(INDEX, /id="deskRec" aria-live="polite"/);
});

test('홈 운영 현황 안내는 "운영 시작 뒤 연결 · 지금은 준비부터"를 전달하고 링크는 그대로다', () => {
  const start = INDEX.indexOf('class="desk-ops-card"');
  const card = INDEX.slice(start, INDEX.indexOf('</section>', start));
  assert.match(card, /Cafe24 주문/);
  assert.match(card, /Meta 광고 성과/);
  assert.match(card, /준비 단계부터 시작/);
  assert.match(card, /href="#\/dashboard"/);
});

test('도매처 0건: 제휴 도매처 모집 중 + 자료실 공급처 체크리스트 버튼, 업체 예시 없음', () => {
  const start = INDEX.indexOf('id="wholesaleEmptyState"');
  const block = INDEX.slice(start, INDEX.indexOf('</div>', start));
  assert.match(block, /제휴 도매처 모집 중/);
  assert.match(block, /href="#\/resources\/supplier-check-checklist"/);
  assert.ok(resourcesData.RESOURCES.some((r) => r.slug === 'supplier-check-checklist' && r.title === '공급처 확인 질문 체크리스트'));
  assert.ok(resourcesData.getGuide('supplier-check-checklist'), '자료실에 실제 상세 내용이 있다');
  // 등록된 도매처가 있을 때의 목록 동작(0건 → empty, 있으면 grid)은 그대로
  assert.match(WHOLESALERS_SRC, /if\(allItems\.length === 0\)\{ setState\('empty'\); return; \}/);
  assert.match(WHOLESALERS_SRC, /grid\.innerHTML = filtered\.map\(cardHtml\)\.join\(''\);/);
});
