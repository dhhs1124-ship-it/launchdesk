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
  // "공헌이"가 등장하는 자리는 전부 "공헌이익률"이어야 한다 — 바로 뒤 두 글자가 "익률"이 아니면 잘린 표현
  const matches = content.match(/공헌이(..)/g) || [];
  assert.ok(matches.length > 0, '"공헌이익률" 표현이 resources-data.js에 없음');
  matches.forEach((m) => { assert.equal(m, '공헌이익률'); });
  assert.ok(content.includes('공헌이익률'));
});
