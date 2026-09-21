/* 자료실 데이터 레이어 검증 — 실행: node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../resources-data.js');

function matchingSlugs(query){
  return data.RESOURCES.filter((r) => data.matchesQuery(r, query)).map((r) => r.slug);
}

test('옛 카테고리 ID는 새 4개 카테고리로 매핑된다', () => {
  assert.equal(data.mapLegacyCategory('business'), 'start');
  assert.equal(data.mapLegacyCategory('platform'), 'start');
  assert.equal(data.mapLegacyCategory('sourcing'), 'product');
  assert.equal(data.mapLegacyCategory('margin'), 'product');
  assert.equal(data.mapLegacyCategory('detail'), 'product');
  assert.equal(data.mapLegacyCategory('delivery'), 'operation');
  assert.equal(data.mapLegacyCategory('cs'), 'operation');
  assert.equal(data.mapLegacyCategory('review'), 'operation');
  assert.equal(data.mapLegacyCategory('integration'), 'growth');
  assert.equal(data.mapLegacyCategory('analytics'), 'growth');
  assert.equal(data.mapLegacyCategory('marketing'), 'growth');
});

test('이미 새 카테고리 ID면 그대로 통과한다', () => {
  assert.equal(data.mapLegacyCategory('start'), 'start');
  assert.equal(data.mapLegacyCategory('growth'), 'growth');
});

test('알 수 없는 카테고리 ID는 null', () => {
  assert.equal(data.mapLegacyCategory('unknown'), null);
  assert.equal(data.mapLegacyCategory(''), null);
  assert.equal(data.mapLegacyCategory(null), null);
});

test('모든 RESOURCES.category 값은 CATEGORY_LABEL에 존재한다', () => {
  data.RESOURCES.forEach((r) => {
    assert.ok(data.CATEGORY_LABEL.hasOwnProperty(r.category), r.slug + '의 category "' + r.category + '"가 정의되지 않음');
  });
});

test('모든 RESOURCES.type 값은 TYPE_LABEL에 존재한다', () => {
  data.RESOURCES.forEach((r) => {
    assert.ok(data.TYPE_LABEL.hasOwnProperty(r.type), r.slug + '의 type "' + r.type + '"이 정의되지 않음');
  });
});

test('slug는 중복 없이 고유하다', () => {
  const seen = new Set();
  data.RESOURCES.forEach((r) => {
    assert.ok(!seen.has(r.slug), '중복된 slug: ' + r.slug);
    seen.add(r.slug);
  });
});

test('type이 guide/checklist인 자료는 전부 GUIDES 본문을 갖는다', () => {
  data.RESOURCES.filter((r) => r.type === 'guide' || r.type === 'checklist').forEach((r) => {
    assert.ok(data.getGuide(r.slug), r.slug + '의 GUIDES 본문이 없음');
  });
});

test('type이 external/template/tool인 자료는 전부 href를 갖는다', () => {
  data.RESOURCES.filter((r) => r.type === 'external' || r.type === 'template' || r.type === 'tool').forEach((r) => {
    assert.ok(r.href, r.slug + '의 href가 없음');
  });
});

test('FEATURED_SLUGS는 전부 실제 존재하는 자료를 가리킨다', () => {
  data.FEATURED_SLUGS.forEach((slug) => {
    assert.ok(data.getResource(slug), '존재하지 않는 추천 slug: ' + slug);
  });
});

test('STUCK_CARDS의 category는 전부 유효한 카테고리다', () => {
  data.STUCK_CARDS.forEach((c) => {
    assert.ok(data.CATEGORY_LABEL.hasOwnProperty(c.category));
  });
});

test('가이드 cta 블록 중 slug를 가리키는 것은 실제 존재하는 자료여야 한다', () => {
  Object.keys(data.GUIDES).forEach((slug) => {
    data.GUIDES[slug].blocks.forEach((b) => {
      if(b.t === 'cta' && b.slug){
        assert.ok(data.getResource(b.slug), slug + ' 가이드의 cta가 존재하지 않는 slug를 가리킴: ' + b.slug);
      }
    });
  });
});

test('matchesQuery: 빈 검색어는 항상 true', () => {
  const r = data.getResource('platform-choice');
  assert.equal(data.matchesQuery(r, ''), true);
  assert.equal(data.matchesQuery(r, '   '), true);
});

test('matchesQuery: 제목에 포함된 단어로 찾는다', () => {
  const r = data.getResource('platform-choice');
  assert.equal(data.matchesQuery(r, '카페24'), true);
  assert.equal(data.matchesQuery(r, '전혀관련없는단어'), false);
});

test('matchesQuery: 대소문자를 구분하지 않는다', () => {
  const r = data.getResource('ga4-tool');
  assert.equal(data.matchesQuery(r, 'ga4'), true);
  assert.equal(data.matchesQuery(r, 'GA4'), true);
});

test('matchesQuery: 태그로도 찾는다', () => {
  const r = data.getResource('ad-metrics');
  assert.equal(data.matchesQuery(r, 'ROAS'), true);
});

test('matchesQuery: 카테고리명 · 자료유형명으로도 찾는다', () => {
  const guide = data.getResource('platform-choice'); // category: start(쇼핑몰 시작), type: guide(가이드)
  assert.equal(data.matchesQuery(guide, '쇼핑몰 시작'), true);
  assert.equal(data.matchesQuery(guide, '가이드'), true);
  const checklist = data.getResource('ad-before-start');
  assert.equal(data.matchesQuery(checklist, '체크리스트'), true);
});

test('titleForSlug: 존재/미존재 slug', () => {
  assert.equal(data.titleForSlug('ad-metrics'), '광고 숫자 읽는 법');
  assert.equal(data.titleForSlug('no-such-slug'), null);
});

/* --------------------------------------------------------- 검색: 토큰 AND */
test('"반품 정책" — 제목과 가이드 본문에 각각 나뉘어 있어도 찾는다', () => {
  const slugs = matchingSlugs('반품 정책');
  assert.ok(slugs.length > 0, '"반품 정책" 검색 결과가 0건');
  assert.ok(slugs.includes('return-exchange-checklist'));
});

test('"메타 광고" — 관련 자료를 찾는다', () => {
  const slugs = matchingSlugs('메타 광고');
  assert.ok(slugs.length > 0);
  assert.ok(slugs.includes('meta-ads-start'));
  assert.ok(slugs.includes('meta-ads-manager'));
  assert.ok(slugs.includes('meta-ads-library'));
});

test('"마진 계산" — 마진 관련 가이드와 LaunchDesk 도구를 찾는다', () => {
  const slugs = matchingSlugs('마진 계산');
  assert.ok(slugs.includes('margin-before-selling')); // 가이드
  assert.ok(slugs.includes('margin-calculator'));      // LaunchDesk 도구
});

test('연속 공백 · 앞뒤 공백은 무시된다', () => {
  assert.deepEqual(matchingSlugs('  마진    계산  '), matchingSlugs('마진 계산'));
});

test('영문 검색은 대소문자를 구분하지 않는다', () => {
  assert.deepEqual(matchingSlugs('ga4'), matchingSlugs('GA4'));
  assert.ok(matchingSlugs('ga4').length > 0);
});

test('존재하지 않는 검색어는 빈 결과', () => {
  assert.deepEqual(matchingSlugs('존재하지않는임의문자열xyz123'), []);
});

test('빈 검색어는 전체 자료를 반환한다', () => {
  assert.deepEqual(matchingSlugs(''), data.RESOURCES.map((r) => r.slug));
});

test('토큰 중 하나라도 없으면 매칭되지 않는다(AND, OR 아님)', () => {
  // "반품"은 있지만 "쿠폰"은 없는 자료만 있는 조합 — 전체가 매칭되면 안 된다
  const r = data.getResource('return-exchange-checklist');
  assert.equal(data.matchesQuery(r, '반품 존재하지않는토큰'), false);
});

/* --------------------------------------------------------- GA4 payload */
test('buildSearchPayload: query_length · result_count · selected_category만, 원문 없음', () => {
  const p = data.buildSearchPayload('반품 정책', 3, 'operation');
  assert.deepEqual(Object.keys(p).sort(), ['query_length', 'result_count', 'selected_category']);
  assert.equal(p.query_length, 5);
  assert.equal(p.result_count, 3);
  assert.equal(p.selected_category, 'operation');
  assert.equal(JSON.stringify(p).includes('반품'), false, 'payload에 검색어 원문이 남아있음');
});

test('buildFilterPayload: category만', () => {
  const p = data.buildFilterPayload('growth');
  assert.deepEqual(Object.keys(p), ['category']);
  assert.equal(p.category, 'growth');
});

test('buildOpenPayload: resource_slug · resource_type · resource_category만(정확한 필드명)', () => {
  const p = data.buildOpenPayload('ad-metrics', 'guide', 'growth');
  assert.deepEqual(Object.keys(p).sort(), ['resource_category', 'resource_slug', 'resource_type']);
  assert.equal(p.resource_slug, 'ad-metrics');
  assert.equal(p.resource_type, 'guide');
  assert.equal(p.resource_category, 'growth');
  assert.ok(!('resourcce_category' in p), 'resourcce_category 오타 필드가 남아있음');
});

test('buildExternalClickPayload: resource_slug · destination_host만, 전체 URL 없음', () => {
  const p = data.buildExternalClickPayload('easyadmin', 'ezadmin.co.kr');
  assert.deepEqual(Object.keys(p).sort(), ['destination_host', 'resource_slug']);
  assert.equal(p.resource_slug, 'easyadmin');
  assert.equal(p.destination_host, 'ezadmin.co.kr');
  assert.equal(JSON.stringify(p).includes('https://'), false, 'payload에 전체 URL이 남아있음');
  assert.equal(JSON.stringify(p).includes('?'), false, 'payload에 쿼리스트링이 남아있음');
});

test('이지어드민 카드의 실제 href는 ezadmin.co.kr', () => {
  const r = data.getResource('easyadmin');
  assert.ok(r);
  assert.equal(new URL(r.href).hostname, 'ezadmin.co.kr');
});

/* --------------------------------------------------------- 오타 회귀 방지 */
test('소스 코드 전체에 resourcce_category(이중 c) 오타가 없다', () => {
  ['resources-data.js', 'resources.js', 'app.js'].forEach((file) => {
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(content.includes('resourcce'), false, file + '에 resourcce 오타가 있음');
  });
});

test('손익분기 ROAS 설명에 "공헌이옵니다/공헌이(단독)/이옵니다" 같은 잘린 표현이 없다', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'resources-data.js'), 'utf8');
  assert.equal(content.includes('공헌이옵니다'), false);
  assert.equal(content.includes('이옵니다'), false);
  // "공헌이"가 등장하는 자리는 전부 "공헌이익…"이어야 한다 — 바로 뒤 글자가 "익"이 아니면 잘린 표현.
  // (예전에는 "공헌이익률"만 허용했지만, 광고 가이드가 "광고 전 공헌이익"·"공헌이익을" 같은
  // 온전한 표현도 쓰게 되어 "익"까지만 확인한다 — 잘린 표현을 잡는다는 목적은 그대로다.)
  const truncated = content.match(/공헌이(?!익)/g) || [];
  assert.equal(truncated.length, 0, '"공헌이" 뒤에 "익"이 없는 잘린 표현이 있음');
  assert.ok(content.includes('공헌이익률'), '"공헌이익률" 표현이 resources-data.js에 없음');
});

/* ===================================================================
   광고 핵심 가이드 3종(ad-before-start · ad-metrics · ad-troubleshoot) 심화 콘텐츠
   =================================================================== */
const AD_SLUGS = ['ad-before-start', 'ad-metrics', 'ad-troubleshoot'];
const resourcesJs = fs.readFileSync(path.join(__dirname, '..', 'resources.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// 가이드의 모든 블록(step 필드 안 · collapse 안에 중첩된 blocks 포함)
function allBlocks(slug){
  const out = [];
  (function walk(blocks){
    (blocks || []).forEach((b) => {
      out.push(b);
      if(b.t === 'step') (b.fields || []).forEach((f) => walk(f.blocks));
      if(b.t === 'collapse') walk(b.blocks);
    });
  })(data.getGuide(slug).blocks);
  return out;
}
function tableByCaption(slug, caption){
  const t = allBlocks(slug).find((b) => b.t === 'table' && b.caption === caption);
  assert.ok(t, slug + '에 caption "' + caption + '" 표가 없음');
  return t;
}
function steps(slug){ return allBlocks(slug).filter((b) => b.t === 'step'); }
function cellText(c){ return typeof c === 'string' ? c : c.text; }
function rowByName(table, name){
  const row = table.rows.find((r) => cellText(r[0]) === name);
  assert.ok(row, '"' + table.caption + '" 표에 "' + name + '" 행이 없음');
  return row;
}
function num(text){ return Number(String(text).replace(/[^0-9.\-]/g, '')); }
// 표의 "계산" 칸(예: "100,000 ÷ 20,000 × 1,000")을 실제로 계산한다 — 테스트 전용, 이 저장소의 고정 문자열만 넣는다.
function evalExpr(expr){
  const js = expr.replace(/,/g, '').replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-');
  assert.ok(/^[0-9.+\-*/() ]+$/.test(js), '계산식에 허용되지 않은 문자: ' + expr);
  return Function('"use strict"; return (' + js + ');')();
}
function near(a, b, msg){ assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' — 기대 ' + b + ', 실제 ' + a); }

// 화면에 사람이 읽는 문자열을 전부 모은다(식별자·URL 제외) — guideSearchText가 빠뜨리면 안 되는 목록.
function humanStrings(slug){
  const g = data.getGuide(slug);
  const out = [g.intro || ''];
  (function walk(blocks){
    blocks.forEach((b) => {
      ['text', 'label', 'title', 'caption'].forEach((k) => { if(b[k]) out.push(b[k]); });
      (b.items || []).forEach((i) => {
        if(typeof i === 'string') out.push(i);
        else ['term', 'formula', 'desc', 'example', 'check', 'title', 'org'].forEach((k) => { if(i[k]) out.push(i[k]); });
      });
      (b.fields || []).forEach((f) => { out.push(f.label); if(f.text) out.push(f.text); (f.items || []).forEach((i) => out.push(i)); if(f.blocks) walk(f.blocks); });
      (b.head || []).forEach((h) => out.push(h));
      (b.rows || []).forEach((r) => r.forEach((c) => out.push(cellText(c))));
      if(b.blocks) walk(b.blocks); // collapse — 접혀 있어도 검색 대상이어야 함
    });
  })(g.blocks);
  return out.filter(Boolean);
}

test('광고 3종: 기존 slug · 카드 제목 · 요약 · 분류 · 태그가 그대로다', () => {
  const expected = {
    'ad-before-start': { title: '광고비를 쓰기 전 확인할 7가지', summary: '광고를 켜기 전에 마진 · 추적 · 페이지 준비를 먼저 확인합니다.', type: 'checklist', tags: ['광고', '광고비', '체크리스트'] },
    'ad-metrics': { title: '광고 숫자 읽는 법', summary: 'CTR · CPC · CVR · CPA · ROAS 계산식과 읽는 법', type: 'guide', tags: ['CTR', 'CPC', 'CVR', 'CPA', 'ROAS', '지표'] },
    'ad-troubleshoot': { title: '광고가 안 될 때 확인 순서', summary: '상황별로 무엇을 먼저 점검할지 순서대로 정리했어요.', type: 'guide', tags: ['광고', '트러블슈팅', '진단'] }
  };
  Object.keys(expected).forEach((slug) => {
    const r = data.getResource(slug);
    assert.ok(r, slug + ' 카드가 없음');
    assert.equal(r.title, expected[slug].title);
    assert.equal(r.summary, expected[slug].summary);
    assert.equal(r.category, 'growth');
    assert.equal(r.type, expected[slug].type);
    assert.deepEqual(r.tags, expected[slug].tags);
  });
});

/* ---------------------------------------------------------- 가이드 1 */
test('광고비 쓰기 전 가이드: 점검 단계가 정확히 7개(1~7번)이고 제목이 요구 순서와 같다', () => {
  const s = steps('ad-before-start');
  assert.equal(s.length, 7);
  assert.deepEqual(s.map((b) => b.num), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(s.map((b) => b.title), [
    '광고 목표 정하기', '누구에게 무엇을 팔지 한 문장으로 정리', '광고 전에 상품 페이지 점검', '광고 전 공헌이익 계산',
    '전환 측정 준비', '테스트 예산과 기간 결정', '기록표 만들기'
  ]);
});

test('광고비 쓰기 전 가이드: 각 단계는 "왜 확인하나요 · 무엇을 확인하나요 · 완료 기준"을 갖는다', () => {
  steps('ad-before-start').forEach((b) => {
    assert.deepEqual(b.fields.map((f) => f.label), ['왜 확인하나요', '무엇을 확인하나요', '완료 기준'], b.title);
    b.fields.forEach((f) => assert.ok((f.text && f.text.length > 10) || (f.items && f.items.length > 0), b.title + ' / ' + f.label + '가 비어 있음'));
  });
});

test('광고비 쓰기 전 가이드: 사용자가 직접 체크하는 완료 체크리스트는 정확히 7개다', () => {
  const lists = allBlocks('ad-before-start').filter((b) => b.t === 'checklist');
  assert.equal(lists.length, 1, '체크리스트 블록이 1개가 아님');
  assert.equal(lists[0].items.length, 7);
  lists[0].items.forEach((i) => assert.equal(typeof i, 'string'));
});

test('광고비 쓰기 전 가이드: 이미지 · 이미지 placeholder가 없다', () => {
  assert.ok(allBlocks('ad-before-start').every((b) => b.t !== 'image' && b.t !== 'img'));
  assert.equal(/image\/|<img|placeholder/i.test(JSON.stringify(data.getGuide('ad-before-start'))), false);
});

test('광고비 쓰기 전 가이드: 공헌이익 숫자 요약이 수학적으로 맞는다(변동비 30,000 · 공헌이익 20,000 · 40% · 손익분기 250%)', () => {
  const blocks = allBlocks('ad-before-start');
  const summary = blocks.find((b) => b.t === 'metric-summary');
  assert.ok(summary, '공헌이익 숫자 요약(metric-summary) 블록이 없음');
  const v = (term) => {
    const item = summary.items.find((i) => i.term === term);
    assert.ok(item, '"' + term + '" 항목이 숫자 요약에 없음');
    return num(item.desc);
  };
  const price = v('판매가');
  const varCost = v('광고비 제외 변동비');
  const contrib = v('광고비를 빼기 전 남는 돈');
  assert.equal(price, 50000);
  assert.equal(varCost, 30000);
  assert.equal(contrib, price - varCost);
  assert.equal(contrib, 20000);
  near(v('공헌이익률'), contrib / price * 100, '공헌이익률');
  assert.equal(v('공헌이익률'), 40);
  near(v('손익분기 ROAS'), 100 / (contrib / price), '손익분기 ROAS');
  assert.equal(v('손익분기 ROAS'), 250);
  assert.equal(v('주문당 광고비 한도'), contrib);
  // 변동비에 포함할 항목은 금액 없이 짧은 목록으로만 남는다(반복 표 제거).
  const step4 = steps('ad-before-start')[3];
  const items = step4.fields.find((f) => f.label === '무엇을 확인하나요').items;
  ['상품원가', '판매수수료', '실제 배송비', '포장비', '판매자 부담 쿠폰·적립금·사은품 비용'].forEach((name) => {
    assert.ok(items.includes(name), '변동비 항목 목록에 "' + name + '"가 없음');
  });
});

test('광고비 쓰기 전 가이드: 손익분기 ROAS 공식과 광고 기록 CTA(#/dashboard)가 있다', () => {
  const blocks = allBlocks('ad-before-start');
  assert.ok(blocks.some((b) => b.t === 'cta' && b.href === '#/dashboard'), '광고 기록 CTA가 없음');
  const text = data.guideSearchText('ad-before-start');
  assert.ok(text.includes('손익분기 ROAS'));
  assert.ok(text.includes('공헌이익률'));
});

test('광고비 쓰기 전 가이드: 기록표는 LaunchDesk가 실제로 받는 핵심 항목만 남기고, 나머지는 정직하게 안내한다', () => {
  const t = tableByCaption('ad-before-start', '광고 기록표에 적을 항목');
  const names = t.rows.map((r) => cellText(r[0]));
  // 긴 11행 표 대신 핵심 6항목만 남는다(초보자 부담 감소 + LaunchDesk에 없는 입력칸 나열 금지).
  assert.deepEqual(names, ['날짜', '채널', '소재명', '광고비', '전환 매출', 'ROAS']);
  ['노출', '클릭', '랜딩페이지 조회', '장바구니', '구매', 'CPA', '메모'].forEach((n) => {
    assert.equal(names.includes(n), false, '기록표에 LaunchDesk에 없는 입력 항목 "' + n + '"이 남아 있음');
  });
  const text = data.guideSearchText('ad-before-start');
  assert.ok(text.includes('소재명'), 'LaunchDesk 광고 기록이 받는 항목(소재명 · 지출 · 전환 매출)을 설명하지 않음');
  assert.ok(text.includes('ROAS를 계산'), 'LaunchDesk가 ROAS를 계산해 준다는 안내가 없음');
  assert.ok(text.includes('구매 수') && (text.includes('관리자') || text.includes('메모')), '구매 수 · 변경사항은 관리자/메모에서 확인하라는 안내가 없음');
});

/* ---------------------------------------------------------- 가이드 2 */
test('광고 숫자 가이드: 흐름 설명 순서와 예시 데이터가 요구와 같다', () => {
  const funnel = allBlocks('ad-metrics').find((b) => b.t === 'flow' && b.items.length === 7);
  assert.ok(funnel, '7단계 광고 퍼널 flow 블록이 없음');
  assert.deepEqual(funnel.items.map((it) => it.title), ['노출', '링크 클릭', '랜딩페이지 도착', '장바구니', '결제 시작', '구매', '매출과 이익']);
  const ex = tableByCaption('ad-metrics', '이 가이드의 예시 쇼핑몰(가상 데이터)');
  const v = (name) => num(rowByName(ex, name)[1]);
  assert.equal(v('광고비'), 100000);
  assert.equal(v('노출수'), 20000);
  assert.equal(v('링크 클릭'), 200);
  assert.equal(v('구매'), 8);
  assert.equal(v('객단가'), 50000);
  assert.equal(v('매출'), 400000);
  assert.equal(v('주문 1건당 광고비 제외 변동비'), 30000);
  assert.equal(v('주문 1건당 광고 전 공헌이익'), 20000);
  assert.equal(v('광고 전 공헌이익률'), 40);
});

test('광고 숫자 가이드: 18개 지표가 모두 뜻 · 계산식 · 먼저 확인할 것을 갖는다', () => {
  const formula = allBlocks('ad-metrics').find((b) => b.t === 'formula' && b.items.length >= 18);
  assert.ok(formula, '지표 formula 블록이 없음');
  const required = ['노출수', '도달수', '빈도', 'CPM', '링크 클릭수', 'CTR', 'CPC', '랜딩페이지 조회', '장바구니', '결제 시작', '구매', '구매 전환율', 'CPA', '매출', 'ROAS', '광고 전 공헌이익', '손익분기 ROAS', '광고비 차감 후 남는 공헌이익'];
  required.forEach((name) => {
    const item = formula.items.find((i) => i.term === name || i.term.indexOf(name + ' ') === 0 || i.term.indexOf(name + '(') === 0);
    assert.ok(item, '지표 "' + name + '"가 없음');
    ['desc', 'formula', 'check'].forEach((k) => assert.ok(item[k] && item[k].length > 4, name + '의 ' + k + '가 비어 있음'));
  });
});

test('광고 숫자 가이드: 예시 데이터로 계산한 결과가 전부 일치한다', () => {
  // 요구사항의 예시 데이터를 여기서 독립적으로 다시 계산해 가이드 표와 대조한다.
  const spend = 100000, impressions = 20000, clicks = 200, purchases = 8, aov = 50000, varCost = 30000;
  const revenue = purchases * aov;
  const contrib = aov - varCost;
  const margin = contrib / aov;
  const expected = {
    'CPM': spend / impressions * 1000,
    'CTR': clicks / impressions * 100,
    'CPC': spend / clicks,
    '구매 전환율': purchases / clicks * 100,
    'CPA': spend / purchases,
    '매출': revenue,
    'ROAS': revenue / spend * 100,
    '광고 전 공헌이익률': margin * 100,
    '손익분기 ROAS': aov / contrib * 100,
    '광고 전 총 공헌이익': purchases * contrib,
    '광고비 차감 후 남는 공헌이익': purchases * contrib - spend,
    '주문당 광고비 한도(손익분기 CPA)': contrib
  };
  // 요구사항이 못 박은 값
  assert.equal(expected['CTR'], 1);
  assert.equal(expected['CPC'], 500);
  assert.equal(expected['구매 전환율'], 4);
  assert.equal(expected['CPA'], 12500);
  assert.equal(expected['ROAS'], 400);
  assert.equal(expected['손익분기 ROAS'], 250);
  assert.equal(expected['광고 전 총 공헌이익'], 160000);
  assert.equal(expected['광고비 차감 후 남는 공헌이익'], 60000);

  const t = tableByCaption('ad-metrics', '예시 쇼핑몰 계산 결과');
  assert.deepEqual(t.head, ['지표', '계산', '결과']);
  Object.keys(expected).forEach((name) => {
    const row = rowByName(t, name);
    near(num(row[2]), expected[name], name + ' 결과 칸');
    near(evalExpr(row[1]), expected[name], name + ' 계산 칸(' + row[1] + ')');
  });
});

test('광고 숫자 가이드: 손익분기 ROAS 250%는 광고비까지 넣은 손익 0원 경계이고, CPA는 CPC ÷ 구매 전환율과 같다', () => {
  near(100000 / 8, 500 / 0.04, 'CPA = CPC ÷ CVR');
  near(100 / 0.4, 250);
  near(8 * 20000 - 100000, 8 * (20000 - 12500), '남는 공헌이익 = 주문 수 × (주문당 공헌이익 − CPA)');
  const text = data.guideSearchText('ad-metrics');
  assert.ok(text.includes('손익이 0원'), '손익분기 ROAS가 손익 0원 경계라는 설명이 없음');
});

test('광고 숫자 가이드: "ROAS 400% = 매출 400,000원 전부 이익"이 아니라는 점과 예시에 없는 비용 안내가 있다', () => {
  const text = data.guideSearchText('ad-metrics');
  assert.ok(text.includes('ROAS 400%는 매출 400,000원이 전부 이익이라는 뜻이 아닙니다'));
  ['세금', '반품', '쿠폰', '고정비'].forEach((w) => assert.ok(text.includes(w), '"' + w + '" 안내가 없음'));
  const summary = allBlocks('ad-metrics').find((b) => b.t === 'metric-summary' && b.items.some((i) => i.term === '주문 8건의 광고비 제외 변동비'));
  assert.ok(summary, '매출 → 이익 금액 흐름 숫자 요약(metric-summary) 블록이 없음');
  const v = (term) => {
    const item = summary.items.find((i) => i.term === term);
    assert.ok(item, '"' + term + '" 항목이 숫자 요약에 없음');
    return num(item.desc);
  };
  assert.equal(v('매출'), 400000);
  assert.equal(v('주문 8건의 광고비 제외 변동비'), 8 * 30000);
  assert.equal(v('광고 전 총 공헌이익'), 400000 - 8 * 30000);
  assert.equal(v('광고비 차감 후 남는 공헌이익'), 400000 - 240000 - 100000);
});

test('광고 숫자 가이드: 합격선 대신 이전 기간 · 소재 간 비교 · 손익분기점을 기준으로 삼으라고 안내한다', () => {
  const text = data.guideSearchText('ad-metrics');
  ['같은 상품의 이전 기간', '같은 캠페인의 소재', '손익분기'].forEach((p) => assert.ok(text.includes(p), '"' + p + '" 기준 안내가 없음'));
});

/* ---------------------------------------------------------- 가이드 3 */
test('광고가 안 될 때 가이드: 진단 단계 7개가 요구 순서와 같고 각 단계가 5개 항목을 갖는다', () => {
  const s = steps('ad-troubleshoot');
  assert.equal(s.length, 7);
  assert.deepEqual(s.map((b) => b.title), [
    '광고가 집행되지 않거나 노출이 거의 없음', '노출은 있는데 클릭이 적음', '클릭은 있는데 랜딩페이지 조회가 적음',
    '방문은 있는데 장바구니가 적음', '장바구니는 있는데 구매가 적음', '구매는 발생하지만 이익이 남지 않음', '광고 관리자 숫자와 실제 주문이 다름'
  ]);
  assert.deepEqual(s.map((b) => b.id), ['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
  s.forEach((b) => {
    assert.deepEqual(b.fields.map((f) => f.label), ['보이는 증상', '가능한 원인', '먼저 확인할 것', '바로 할 수 있는 조치', '다음 단계로 넘어가는 기준'], b.title);
  });
});

test('광고가 안 될 때 가이드: 원칙 5가지와 추적 오류 vs 실제 부진 구분 안내가 있다', () => {
  const text = data.guideSearchText('ad-troubleshoot');
  ['한 번에 한 가지', '변경 전', '변경 시각', '성급히', '추적 오류'].forEach((p) => assert.ok(text.includes(p), '"' + p + '" 원칙 안내가 없음'));
});

test('광고가 안 될 때 가이드: 마지막 진단 요약표의 이동 링크는 전부 실제 단계 id를 가리킨다', () => {
  const s = steps('ad-troubleshoot');
  const ids = s.map((b) => b.id);
  const blocks = allBlocks('ad-troubleshoot');
  const summaryIdx = blocks.findIndex((b) => b.t === 'table' && b.caption === '증상별 진단 요약');
  assert.ok(summaryIdx > -1, '진단 요약표가 없음');
  assert.ok(summaryIdx > blocks.lastIndexOf(s[s.length - 1]), '진단 요약표가 7단계 뒤(마지막 쪽)에 있지 않음');
  const t = blocks[summaryIdx];
  assert.ok(t.rows.length >= 7);
  const jumps = [];
  t.rows.forEach((r) => r.forEach((c) => { if(typeof c === 'object' && c.jump){ jumps.push(c.jump); } }));
  assert.equal(jumps.length, t.rows.length, '모든 행에 이동 링크가 있어야 함');
  jumps.forEach((j) => assert.ok(ids.includes(j), '존재하지 않는 단계로 이동: ' + j));
  assert.deepEqual([...new Set(jumps)].sort(), ids.slice().sort(), '7개 단계가 모두 요약표에서 연결돼야 함');
});

test('광고가 안 될 때 가이드: 이익 단계의 변동비 +5,000원 예시가 수학적으로 맞는다', () => {
  const t = tableByCaption('ad-troubleshoot', '변동비가 5,000원 늘어난 경우(가상 예시)');
  const before = (n) => num(rowByName(t, n)[1]);
  const after = (n) => num(rowByName(t, n)[2]);
  assert.equal(after('주문 1건당 광고비 제외 변동비'), before('주문 1건당 광고비 제외 변동비') + 5000);
  assert.equal(after('주문 1건당 광고 전 공헌이익'), 50000 - 35000);
  near(after('광고 전 공헌이익률'), 30);
  near(after('손익분기 ROAS'), Math.round(100 / 0.3 * 10) / 10);
  assert.equal(before('ROAS'), 400);
  assert.equal(after('ROAS'), 400);
  assert.equal(before('광고비 차감 후 남는 공헌이익'), 60000);
  assert.equal(after('광고비 차감 후 남는 공헌이익'), 8 * 15000 - 100000);
});

/* ---------------------------------------------------------- 공통: 출처 · 표현 · 검색 · 렌더러 */
test('광고 3종: 각 가이드 마지막에 "참고한 공식 자료"(자료명 · 제공 기관 · HTTPS 링크 · 확인 시점 2026년 9월)가 있다', () => {
  const allowedHosts = ['www.facebook.com', 'support.google.com', 'developers.google.com'];
  AD_SLUGS.forEach((slug) => {
    const blocks = data.getGuide(slug).blocks;
    const sources = blocks.filter((b) => b.t === 'sources');
    assert.equal(sources.length, 1, slug + '의 sources 블록이 1개가 아님');
    assert.equal(blocks[blocks.length - 1], sources[0], slug + '의 참고 자료가 마지막 블록이 아님');
    assert.equal(sources[0].checkedAt, '2026년 9월');
    assert.ok(sources[0].items.length >= 3);
    const seen = new Set();
    sources[0].items.forEach((i) => {
      assert.ok(i.title && i.org, slug + ' 출처에 자료명/제공 기관이 없음');
      const u = new URL(i.url);
      assert.equal(u.protocol, 'https:', i.url + '가 HTTPS가 아님');
      assert.ok(allowedHosts.includes(u.hostname), '공식 1차 자료 도메인이 아님: ' + u.hostname);
      assert.equal(seen.has(i.url), false, '중복 링크: ' + i.url);
      seen.add(i.url);
    });
  });
});

test('광고 3종: 단정 표현 · 근거 없는 업계 평균/합격선 문구가 없다', () => {
  const banned = [
    /무조건|반드시|보장|확실히/,
    /업(계|종)\s*평균/,
    /평균\s*(CTR|CPC|ROAS|CVR|CPA|클릭률|전환율)/,
    /(CTR|CPC|ROAS|CVR|CPA|클릭률|전환율)[^.\n]{0,15}\d[\d.,]*\s*(%|원|배)\s*(이상|이하|미만|초과)/,
    /(좋은|나쁜|정상|합격|적정)\s*(CTR|CPC|ROAS|CVR|CPA|클릭률|전환율)/
  ];
  AD_SLUGS.forEach((slug) => {
    const text = data.guideSearchText(slug);
    banned.forEach((re) => assert.equal(re.test(text), false, slug + '에 금지 표현: ' + re));
  });
});

test('guideSearchText: 새 본문의 사람이 읽는 문자열이 하나도 빠지지 않는다(URL · 식별자 제외)', () => {
  AD_SLUGS.forEach((slug) => {
    const text = data.guideSearchText(slug);
    humanStrings(slug).forEach((s) => assert.ok(text.includes(s), slug + ' 검색 텍스트에서 누락: ' + s));
    // 식별자는 검색 대상이 아니다
    data.getGuide(slug).blocks.filter((b) => b.t === 'sources').forEach((b) => b.items.forEach((i) => assert.equal(text.includes(i.url), false)));
  });
});

test('검색: 요구한 6개 검색어가 관련 가이드를 찾는다', () => {
  const expectations = {
    '손익분기 ROAS': ['ad-metrics', 'ad-before-start', 'ad-troubleshoot'],
    '공헌이익': ['ad-metrics', 'ad-before-start', 'ad-troubleshoot'],
    '클릭은 있는데 구매': ['ad-troubleshoot'],
    '장바구니 구매': ['ad-metrics', 'ad-troubleshoot'],
    'UTM': ['ad-before-start', 'ad-troubleshoot', 'ga4-pixel-utm'],
    '결제 오류': ['ad-troubleshoot']
  };
  Object.keys(expectations).forEach((q) => {
    const slugs = matchingSlugs(q);
    expectations[q].forEach((s) => assert.ok(slugs.includes(s), '"' + q + '" 검색에서 ' + s + '가 안 나옴 — 결과: ' + slugs.join(', ')));
  });
});

test('렌더러(resources.js)는 광고 3종이 쓰는 모든 블록 유형을 지원한다', () => {
  const supported = new Set((resourcesJs.match(/case '([a-z0-9-]+)':/g) || []).map((m) => m.slice(6, -2)));
  AD_SLUGS.forEach((slug) => {
    allBlocks(slug).forEach((b) => assert.ok(supported.has(b.t), slug + '의 블록 유형 "' + b.t + '"를 resources.js가 렌더링하지 못함'));
  });
});

test('모바일: 표는 카드형으로 바뀌고 표 · 공식 · 출처 링크의 긴 문자열은 줄바꿈된다(가로 넘침 방지)', () => {
  // 중첩 중괄호를 세어 @media (max-width:639px){ ... } 본문을 전부 꺼낸다.
  function mediaBodies(css, header){
    const out = []; let from = 0;
    for(;;){
      const start = css.indexOf(header, from);
      if(start === -1) break;
      let depth = 1, i = start + header.length;
      while(i < css.length && depth > 0){ if(css[i] === '{') depth++; else if(css[i] === '}') depth--; i++; }
      out.push(css.slice(start + header.length, i - 1));
      from = i;
    }
    return out;
  }
  const mobile = mediaBodies(stylesCss, '@media (max-width:639px){').join('\n');
  assert.ok(/#view-resources \.res-table[^{}]*\{[^}]*display:block/.test(mobile), '≤639px에서 표가 block(카드형)으로 바뀌지 않음');
  assert.ok(/attr\(data-label\)/.test(mobile), '카드형 셀에 열 이름(data-label)이 표시되지 않음');
  // block 표 안의 table-caption은 폭이 16px로 줄어 캡션이 글자 단위로 세로로 깨진다(실제 브라우저에서 발견)
  assert.ok(/\.res-table caption\{[^}]*display:block/.test(mobile), '카드형 표의 caption이 block이 아님');
  const rule = (sel) => { const m = stylesCss.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : ''; };
  // 전역 table{min-width:460px}가 카드형 표를 460px로 밀어내던 회귀(실제 390px 브라우저 확인에서 발견) 방지
  assert.ok(/min-width:\s*0(?![0-9])/.test(rule('#view-resources .res-table')), '.res-table이 전역 table min-width를 무효화하지 않음');
  ['#view-resources .res-formula-expr', '#view-resources .res-table td', '#view-resources .res-source-url'].forEach((sel) => {
    assert.ok(/overflow-wrap:\s*anywhere/.test(rule(sel)), sel + '에 overflow-wrap:anywhere가 없음');
  });
});

test('GA4: 이벤트 이름 4개와 payload 필드는 그대로이고, 출처 링크는 GA 이벤트를 만들지 않는다', () => {
  const names = new Set((resourcesJs.match(/gaEvent\('([a-z_]+)'/g) || []).map((m) => m.slice(9, -1)));
  assert.deepEqual([...names].sort(), ['resource_external_click', 'resource_filter', 'resource_open', 'resource_search']);
  assert.equal((resourcesJs.match(/gtag\(/g) || []).length, 1, 'gtag 호출이 gaEvent 안 한 곳 외에 늘어남');
  AD_SLUGS.forEach((slug) => {
    const r = data.getResource(slug);
    assert.deepEqual(data.buildOpenPayload(slug, r.type, r.category), { resource_slug: slug, resource_type: r.type, resource_category: 'growth' });
  });
  assert.deepEqual(data.buildFilterPayload('growth'), { category: 'growth' });
  assert.deepEqual(data.buildSearchPayload('손익분기 ROAS', 3, 'growth'), { query_length: '손익분기 ROAS'.length, result_count: 3, selected_category: 'growth' });
  assert.deepEqual(data.buildExternalClickPayload('easyadmin', 'ezadmin.co.kr'), { resource_slug: 'easyadmin', destination_host: 'ezadmin.co.kr' });
  const m = resourcesJs.match(/case 'sources':([\s\S]*?)(?=\n\s*case '|\n\s*default:)/);
  assert.ok(m, "resources.js에 case 'sources'가 없음");
  assert.equal(/data-res-external|gtag|gaEvent/.test(m[1]), false, '출처 링크가 GA 이벤트 경로를 탐');
});

test('cta는 있는 자료 · 기존 라우트(광고 기록 #/dashboard, 마진 계산기 #/tools)만 가리킨다', () => {
  AD_SLUGS.forEach((slug) => {
    allBlocks(slug).filter((b) => b.t === 'cta').forEach((b) => {
      if(b.slug) assert.ok(data.getResource(b.slug), b.slug);
      else assert.ok(b.href === '#/dashboard' || b.href === '#/tools' || b.href.indexOf('#/resources/') === 0, '알 수 없는 CTA 경로: ' + b.href);
    });
  });
});

/* ---------------------------------------------------------- 가독성 정리(결론부터 · 단계 카드 · CSS 범위) */
test('가독성: 광고 3종 어디에도 ①②③ 같은 문단 속 번호 나열이 없다', () => {
  AD_SLUGS.forEach((slug) => {
    const text = data.guideSearchText(slug);
    assert.equal(/[①②③④⑤]/.test(text), false, slug + '에 ①②③ 번호 나열이 남아 있음');
  });
});

test('가독성: 광고비 쓰기 전 가이드의 결론부터는 "짧은 도입 → 준비 3단계 시각 흐름 → 준비 상태 안내" 순서다', () => {
  const guide = data.getGuide('ad-before-start');
  assert.equal(guide.intro, '광고는 켜는 순간 비용이 나갑니다. 목표·손익·측정 방법을 먼저 정해 두면 결과가 좋지 않을 때 원인을 더 빠르게 찾을 수 있습니다.');
  const blocks = guide.blocks;
  const i = blocks.findIndex((b) => b.t === 'h3' && b.text === '결론부터');
  assert.equal(i, 0);
  assert.equal(blocks[i + 1].t, 'flow');
  assert.deepEqual(blocks[i + 1].items.map((it) => it.title), ['목표와 상품 정하기', '손익과 예산 정하기', '측정하고 기록하기']);
  assert.deepEqual(blocks[i + 1].items.map((it) => it.desc), ['1~3단계', '4·6단계', '5·7단계']);
  assert.equal(blocks[i + 2].t, 'note');
  assert.equal(blocks[i + 2].text, '이 가이드는 광고 설정법이 아니라, 광고를 시작하기 전 준비 상태를 확인하는 체크리스트입니다.');
});

test('가독성: 광고 숫자 가이드의 결론부터는 3단계 시각 흐름(flow)으로 세로 분리돼 있다', () => {
  const blocks = data.getGuide('ad-metrics').blocks;
  assert.equal(blocks[0].t, 'h3');
  assert.equal(blocks[0].text, '결론부터');
  assert.equal(blocks[1].t, 'flow');
  assert.equal(blocks[1].items.length, 3);
  assert.deepEqual(blocks[1].items.map((it) => it.title), ['유입 확인', '구매 확인', '이익 확인']);
  assert.ok(blocks[1].items[2].desc.includes('CPA') && blocks[1].items[2].desc.includes('ROAS'));
  assert.equal(blocks[2].t, 'note');
});

test('가독성: 광고가 안 될 때 가이드의 결론부터는 원칙 문단과 예외(추적 문제) 문단으로 나뉜다', () => {
  const blocks = data.getGuide('ad-troubleshoot').blocks;
  assert.equal(blocks[0].text, '결론부터');
  assert.equal(blocks[1].t, 'p');
  assert.equal(blocks[2].t, 'p');
  assert.ok(blocks[2].text.indexOf('다만') === 0 && blocks[2].text.includes('7단계'));
});

test('가독성: 단계 카드의 여러 항목은 문단이 아니라 items(목록)로 들어 있다', () => {
  ['ad-before-start', 'ad-troubleshoot'].forEach((slug) => {
    steps(slug).forEach((b) => {
      b.fields.forEach((f) => {
        if(f.label === '무엇을 확인하나요' || f.label === '가능한 원인' || f.label === '먼저 확인할 것' || f.label === '바로 할 수 있는 조치'){
          assert.ok(Array.isArray(f.items) && f.items.length >= 2, slug + ' / ' + b.title + ' / ' + f.label + '가 목록이 아님');
        }
      });
    });
  });
});

test('가독성 범위: rich 스타일은 광고 3종에만 붙고, 다른 가이드의 기본 목록 CSS는 그대로다', () => {
  Object.keys(data.GUIDES).forEach((slug) => {
    assert.equal(!!data.getGuide(slug).rich, AD_SLUGS.includes(slug), slug + '의 rich 플래그가 잘못됨');
  });
  assert.ok(/classList\.toggle\('res-rich', !!guide\.rich\)/.test(resourcesJs), 'resources.js가 guide.rich로 res-rich를 토글하지 않음');
  // 기존(다른 가이드) 목록 규칙이 바뀌지 않았다
  assert.ok(stylesCss.includes('#view-resources .res-panel-list, #view-resources .res-panel-numbered{margin:0 0 14px; padding-left:20px; display:flex; flex-direction:column; gap:8px;}'));
  assert.ok(stylesCss.includes('#view-resources .res-panel-p{font-size:13.5px; color:var(--ld-text); line-height:1.75; margin:0 0 12px; word-break:keep-all;}'));
});

test('가독성 CSS: 글머리표 · 항목 간격 6~10px · 필드 간격 18~24px · 줄 간격 1.65~1.75가 #view-resources .res-rich 안에서만 적용된다', () => {
  const rule = (sel) => { const m = stylesCss.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : ''; };
  const px = (decl, prop) => { const m = decl.match(new RegExp(prop + ':\\s*([0-9.]+)px')); return m ? Number(m[1]) : NaN; };
  // 글머리표(전역 ul{list-style:none} 때문에 직접 그린다)
  assert.ok(/content:''/.test(rule('#view-resources .res-rich .res-panel-list > li::before')), 'rich 목록에 글머리표(::before)가 없음');
  // 항목 사이 간격
  const listGap = px(rule('#view-resources .res-rich .res-panel-list, #view-resources .res-rich .res-panel-numbered'), 'gap');
  assert.ok(listGap >= 6 && listGap <= 10, '목록 항목 간격 ' + listGap);
  // 필드(왜 / 무엇 / 완료 기준) 사이 간격
  const fieldGap = px(rule('#view-resources .res-step-fields'), 'gap');
  assert.ok(fieldGap >= 18 && fieldGap <= 24, '필드 간격 ' + fieldGap);
  // 본문 줄 간격
  const lh = (decl) => { const m = decl.match(/line-height:\s*([0-9.]+)/); return m ? Number(m[1]) : NaN; };
  [rule('#view-resources .res-rich .res-panel-p'), rule('#view-resources .res-rich .res-panel-list > li, #view-resources .res-rich .res-panel-numbered > li')].forEach((decl) => {
    assert.ok(lh(decl) >= 1.65 && lh(decl) <= 1.75, '본문 줄 간격 ' + lh(decl));
  });
  // 제목(dt)과 본문 사이 간격이 명확하다(이전 4px → 8px 이상)
  assert.ok(/margin:\s*0 0 (8|9|10)px/.test(rule('#view-resources .res-step-field dt')), '필드 제목 아래 간격이 부족');
});
