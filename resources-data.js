/* 자료실(#/resources) — 데이터 + 순수 로직 모듈 (DOM 없음).

   resources.js(화면)와 tests/resources-data.test.js(검증)가 같은 함수를
   쓴다. 브라우저에서는 window.launchdeskResourcesData 로, Node에서는
   module.exports 로 노출된다(margin-calc.js/analytics-consent-core.js와
   같은 방식).

   이 파일이 다루는 범위:
   - CATEGORIES/TYPES 정의, RESOURCES(카드 메타데이터), GUIDES(내부 가이드
     본문) — 화면(resources.js)은 이 데이터를 읽기만 하고 만들지 않는다.
   - 옛 6개 카테고리(business/platform/product/sourcing/margin/detail/
     delivery/cs/review/analytics/integration/marketing) → 새 4개
     카테고리(start/product/operation/growth) 매핑(mapLegacyCategory) —
     STEP02~07의 기존 data-resource-cat 딥링크 호환용.
   - 검색 매칭(matchesQuery) — 제목 · 요약 · 태그 · 카테고리명 · 자료유형명 ·
     내부 가이드 본문(있는 경우)을 대상으로, 검색어를 공백 기준 토큰으로
     나눠 모든 토큰이(각각 어디에 있든) 포함되면 매칭되는 AND 검색.
   - GA4 이벤트 payload 생성 순수 함수(buildSearchPayload 등) — 개인정보(검색어
     원문 · 전체 URL 등)를 담지 않는 payload를 화면(resources.js) 대신 여기서
     한 곳에 정의해 테스트로 고정한다.

   2026-09 자료실 전면 재설계: "실무에서 바로 쓰는 외부 링크 모음"에서
   "막힌 일을 고르면 설명→체크리스트→도구 순서로 보여주는 실무 가이드"로
   역할을 바꾼다. 기존에 2개의 큰 아코디언(사업자·플랫폼 / 분석·연동)
   안에 묶여 있던 클릭 단위 스텝은, 이제 각각 독립된 가이드 카드로
   나뉘어 들어 있다(domain-ssl-seo/business-pg-checklist/naver-kakao-setup/
   ga4-pixel-utm) — 내용은 삭제 없이 그대로 옮겼다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskResourcesData = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var CATEGORIES = [
    { id: 'start',     label: '쇼핑몰 시작' },
    { id: 'product',   label: '상품과 수익' },
    { id: 'operation', label: '판매 운영' },
    { id: 'growth',    label: '광고와 성장' }
  ];
  var CATEGORY_LABEL = {};
  CATEGORIES.forEach(function(c){ CATEGORY_LABEL[c.id] = c.label; });

  var TYPES = [
    { id: 'guide',     label: '가이드' },
    { id: 'checklist', label: '체크리스트' },
    { id: 'template',  label: '템플릿' },
    { id: 'tool',      label: 'LaunchDesk 도구' },
    { id: 'external',  label: '외부 도구' }
  ];
  var TYPE_LABEL = {};
  TYPES.forEach(function(t){ TYPE_LABEL[t.id] = t.label; });

  // "지금 무엇이 막혔나요?" 선택 카드 4개 — 문구는 요구사항 원문 그대로.
  // 2026-09 자료실 디자인 정리(참고 시안 반영): 제목은 CATEGORY_LABEL과 같은
  // 짧은 업무명으로, keywords는 그 카테고리에 실제로 들어있는 자료의 태그를
  // 요약한 짧은 문구다(허구 데이터 아님 — RESOURCES의 실제 tags를 사람이
  // 요약해 적어둔 것). "쇼핑몰을 어디서 시작해야 할지 모르겠어요"류의 긴
  // 공감형 문구는 카드 라벨로는 참고 시안과 맞지 않아 keywords로 대체했다.
  var STUCK_CARDS = [
    { category: 'start',     keywords: '플랫폼 · 사업자 · PG' },
    { category: 'product',   keywords: '상품 · 공급처 · 마진' },
    { category: 'operation', keywords: '배송 · CS · 리뷰' },
    { category: 'growth',    keywords: '광고 · 분석 · 추적' }
  ];

  // "처음이라면 여기부터" — 실제 조회수 데이터가 없어 "인기/가장 많이 본"
  // 표현은 쓰지 않는다(요구사항). 고정 추천 4개.
  var FEATURED_SLUGS = ['platform-choice', 'marketplace-vs-own', 'margin-before-selling', 'ad-before-start'];

  // 옛 카테고리 ID → 새 카테고리 ID. STEP02~07의 data-resource-cat 링크가
  // 여전히 옛 값을 보내므로(요구사항 9), 이 표는 화면 쪽이 아니라 여기(데이터
  // 레이어)에서 관리해 화면·테스트가 같은 표를 본다.
  var LEGACY_CATEGORY_MAP = {
    business: 'start', platform: 'start',
    product: 'product', sourcing: 'product', margin: 'product', detail: 'product',
    delivery: 'operation', cs: 'operation', review: 'operation',
    analytics: 'growth', integration: 'growth', marketing: 'growth'
  };
  function mapLegacyCategory(id){
    if(!id) return null;
    if(CATEGORY_LABEL.hasOwnProperty(id)) return id; // 이미 새 카테고리 ID라도 그대로 통과
    return LEGACY_CATEGORY_MAP.hasOwnProperty(id) ? LEGACY_CATEGORY_MAP[id] : null;
  }

  /* ------------------------------------------------------------ RESOURCES
     카드 메타데이터. internal 가이드/체크리스트는 slug로 GUIDES[slug]와
     연결된다(상세는 #/resources/<slug>). template/tool/external은 href로
     바로 이동 — 자체 상세 패널이 없다.
     type 'external'만 "외부 도구" 하단 섹션에 배치된다(요구사항 5) — template도
     외부 URL이지만(구글시트) 자료 유형이 다르므로 메인 그리드에 남는다. */
  var RESOURCES = [
    // ---- start · 쇼핑몰 시작 ----
    { slug: 'platform-choice', title: '카페24 vs 아임웹, 나에게 맞는 플랫폼은?', summary: '입점 채널 · 디자인 자유도 · 운영 방식 기준으로 비교합니다.', category: 'start', type: 'guide', tags: ['카페24', '아임웹', '플랫폼', '쇼핑몰 시작'] },
    { slug: 'marketplace-vs-own', title: '오픈마켓과 자사몰, 무엇부터 시작할까?', summary: '트래픽 · 수수료 · 브랜드 관점에서 먼저 시작할 채널을 고릅니다.', category: 'start', type: 'guide', tags: ['오픈마켓', '자사몰', '스마트스토어', '쇼핑몰 시작'] },
    { slug: 'business-pg-checklist', title: '사업자등록 · 통신판매업 · PG 준비 체크리스트', summary: 'PG 심사 전에 준비돼 있어야 하는 항목을 확인합니다.', category: 'start', type: 'checklist', tags: ['사업자등록', '통신판매업', 'PG', '결제', '체크리스트'] },
    { slug: 'domain-ssl-seo', title: '도메인 · SSL · SEO 기본 설정', summary: '도메인 연결부터 검색 노출 태그까지 클릭 단위로 정리했어요.', category: 'start', type: 'guide', tags: ['도메인', 'SSL', 'SEO', '검색노출'] },
    { slug: 'naver-kakao-setup', title: '네이버페이 · 카카오 기본 연동', summary: '신청부터 4개 키 연동까지 클릭 단위로 정리했어요.', category: 'start', type: 'guide', tags: ['네이버페이', '카카오', '연동', '결제'] },

    // ---- product · 상품과 수익 ----
    { slug: 'product-before-sourcing', title: '상품을 찾기 전에 먼저 정할 것', summary: '공급처를 찾기 전에 대표 상품 · 우선순위부터 정리합니다.', category: 'product', type: 'guide', tags: ['상품기획', '소싱', '대표상품'] },
    { slug: 'margin-before-selling', title: '팔기 전에 먼저 계산해야 하는 마진', summary: '판매가를 정하기 전에 빠지는 비용부터 확인합니다.', category: 'product', type: 'guide', tags: ['마진', '가격', '수수료', '원가'] },
    { slug: 'supplier-check-checklist', title: '공급처 확인 질문 체크리스트', summary: '단가 외에 반드시 확인해야 할 공급 조건을 정리했어요.', category: 'product', type: 'checklist', tags: ['공급처', '소싱', '사입', 'MOQ', '체크리스트'] },
    { slug: 'product-list-sheet', title: '상품리스트 구글시트', summary: '상품 업로드 전 정리용 구글시트', category: 'product', type: 'template', tags: ['상품리스트', '템플릿', '구글시트'], href: 'https://docs.google.com/spreadsheets/d/1UPIM38BJntGWCMSjGTeLFwc8wdyJuFzH/edit?usp=sharing', external: true },
    { slug: 'sample-list-sheet', title: '샘플리스트 구글시트', summary: '샘플 구할 때 작성용 구글시트', category: 'product', type: 'template', tags: ['샘플리스트', '템플릿', '구글시트'], href: 'https://docs.google.com/spreadsheets/d/1cDeCnfxtyonZyI_sXxNIeSemL-sDYpkE/edit?usp=sharing', external: true },
    { slug: 'margin-calculator', title: 'LaunchDesk 마진 계산기', summary: '수수료 · 배송비 · 광고비까지 반영한 실제 예상 잔액을 계산합니다.', category: 'product', type: 'tool', tags: ['마진계산기', '수익', '계산기'], href: '#/tools', toolsTarget: 'calc' },
    { slug: 'detail-page-structure', title: '상세페이지 기획 기본 구조', summary: '전환율을 고려한 상세페이지의 기본 뼈대를 정리했어요.', category: 'product', type: 'guide', tags: ['상세페이지', '기획', '전환율'] },
    { slug: 'sinsangmarket', title: '신상마켓', summary: '동대문 도매 브랜드를 모바일로 확인 · 사입하는 대표 앱', category: 'product', type: 'external', tags: ['사입', '동대문', '패션'], href: 'https://sinsangmarket.kr/' },
    { slug: 'sellerocean', title: '셀러오션', summary: '사입삼촌 구인 · 셀러 커뮤니티', category: 'product', type: 'external', tags: ['사입', '커뮤니티', '패션'], href: 'https://cafe.naver.com/soho' },
    { slug: 'vvic', title: 'VVIC', summary: '중국 다이렉트 사입용 플랫폼', category: 'product', type: 'external', tags: ['해외소싱', '중국', '패션'], href: 'https://www.vvic.com/gz' },
    { slug: 'sinsangstudio', title: '신상스튜디오', summary: '촬영 대행을 구할 수 있는 구인 앱', category: 'product', type: 'external', tags: ['촬영', '상세페이지', '패션'], href: 'https://sinsangstudio.com/' },

    // ---- operation · 판매 운영 ----
    { slug: 'shipping-policy-checklist', title: '배송 정책 준비 체크리스트', summary: '배송비 · 마감시간 · 지연 안내 기준을 미리 정합니다.', category: 'operation', type: 'checklist', tags: ['배송', '배송비', '정책', '체크리스트'] },
    { slug: 'return-exchange-checklist', title: '교환 · 반품 기준 준비', summary: '교환 · 반품 가능 기간과 배송비 부담 기준을 정합니다.', category: 'operation', type: 'checklist', tags: ['교환', '반품', '환불', '체크리스트'] },
    { slug: 'cs-script-examples', title: '자주 쓰는 CS 응대 예시', summary: '배송 · 교환 · 반품 · 품절 문의 답변 예시 모음', category: 'operation', type: 'guide', tags: ['CS', '고객응대', '스크립트'] },
    { slug: 'review-points-basics', title: '리뷰 수집과 적립금 운영 기본', summary: '리뷰 유도와 적립금 지급 기준의 기본 구조를 정리했어요.', category: 'operation', type: 'guide', tags: ['리뷰', '적립금', '재구매'] },
    { slug: 'alphareview', title: '알파리뷰', summary: '리뷰 자동 수집 · 적립', category: 'operation', type: 'external', tags: ['리뷰', '자동화'], href: 'https://alph.kr/' },
    { slug: 'keepgrow', title: '킵그로우', summary: '회원가입 · 리뷰 자동화 통합', category: 'operation', type: 'external', tags: ['리뷰', '회원가입', '자동화'], href: 'https://keepgrow.com/' },
    { slug: 'channeltalk', title: '채널톡', summary: '실시간 문의 · 자동응답', category: 'operation', type: 'external', tags: ['CS', '실시간상담', '챗봇'], href: 'https://channel.io/' },
    { slug: 'easyadmin', title: '이지어드민', summary: '여러 판매처의 주문 · 재고 · 배송 업무를 통합 관리하는 쇼핑몰 운영 도구', category: 'operation', type: 'external', tags: ['주문관리', '재고관리', '멀티채널', '배송'], href: 'https://ezadmin.co.kr/' },

    // ---- growth · 광고와 성장 ----
    { slug: 'ad-before-start', title: '광고비를 쓰기 전 확인할 7가지', summary: '광고를 켜기 전에 마진 · 추적 · 페이지 준비를 먼저 확인합니다.', category: 'growth', type: 'checklist', tags: ['광고', '광고비', '체크리스트'] },
    { slug: 'meta-ads-start', title: 'Meta 광고 처음 시작하기', summary: '화면 위치 대신 바뀌지 않는 운영 원칙을 정리했어요.', category: 'growth', type: 'guide', tags: ['메타광고', '페이스북', '인스타그램', '광고'] },
    { slug: 'naver-shopping-ads-start', title: '네이버 쇼핑광고 처음 시작하기', summary: '상품명 · 이미지 · 가격 경쟁력부터 점검합니다.', category: 'growth', type: 'guide', tags: ['네이버쇼핑광고', '네이버', '광고'] },
    { slug: 'ad-creative-checklist', title: '광고 소재 체크리스트', summary: '소재를 올리기 전에 확인할 7가지 기준', category: 'growth', type: 'checklist', tags: ['광고소재', '크리에이티브', '체크리스트'] },
    { slug: 'ad-metrics', title: '광고 숫자 읽는 법', summary: 'CTR · CPC · CVR · CPA · ROAS 계산식과 읽는 법', category: 'growth', type: 'guide', tags: ['CTR', 'CPC', 'CVR', 'CPA', 'ROAS', '지표'] },
    { slug: 'ad-troubleshoot', title: '광고가 안 될 때 확인 순서', summary: '상황별로 무엇을 먼저 점검할지 순서대로 정리했어요.', category: 'growth', type: 'guide', tags: ['광고', '트러블슈팅', '진단'] },
    { slug: 'ga4-pixel-utm', title: 'GA4 · Meta 픽셀 · UTM 기본', summary: '세 도구가 각각 무엇을 측정하는지부터 구분합니다.', category: 'growth', type: 'guide', tags: ['GA4', '픽셀', 'UTM', '분석'] },
    { slug: 'meta-ads-manager', title: '메타 광고 관리자', summary: 'Facebook · Instagram 광고 운영 도구', category: 'growth', type: 'external', tags: ['메타광고', '광고관리자'], href: 'https://business.meta.com/' },
    { slug: 'meta-ads-library', title: '메타 광고 라이브러리', summary: '타 업체 광고 소재 리서치용', category: 'growth', type: 'external', tags: ['광고소재', '리서치', '메타'], href: 'https://business.facebook.com/ads/library/' },
    { slug: 'ga4-tool', title: 'GA4', summary: '구글 애널리틱스 실시간 통계', category: 'growth', type: 'external', tags: ['GA4', '애널리틱스', '분석'], href: 'https://analytics.google.com/' }
  ];

  var RESOURCE_BY_SLUG = {};
  RESOURCES.forEach(function(r){ RESOURCE_BY_SLUG[r.slug] = r; });

  /* ------------------------------------------------------------ GUIDES
     내부 가이드/체크리스트 본문(#/resources/<slug>에서 보여줄 내용).
     블록 타입: p / h3 / list / numbered / checklist / formula / note / cta,
     그리고 광고 핵심 가이드 3종용 step / table / sources.
     - formula 항목은 term · formula · desc 외에 선택 필드 example(예시) · check
       (먼저 확인할 것)를 가질 수 있다.
     - step: { num, id?, title, fields:[{ label, text?, items?, blocks? }] } —
       fields[].blocks 안에 표 · 공식 · CTA 같은 블록을 중첩할 수 있다.
     - table: { caption, head:[…], rows:[[…]] } — 셀은 문자열이거나 { text, jump }
       (jump = 같은 가이드의 step.id로 스크롤하는 버튼).
     - sources: { checkedAt, items:[{ title, org, url }] } — 참고한 공식 자료.
     - 가이드 객체의 rich:true는 상세 패널에 res-rich 클래스를 붙여 글머리표 · 여백을 넓힌
       읽기 스타일을 적용한다(광고 핵심 가이드 3종만 — 다른 가이드는 기존 스타일 그대로).
     cta.external이 true면 새 탭 + rel=noopener noreferrer로 연다. */
  var GUIDES = {
    'platform-choice': { intro: '어떤 플랫폼이 무조건 좋다는 정답은 없습니다. 아래 기준으로 내 상황에 맞는 쪽을 먼저 좁혀보세요.', blocks: [
      { t: 'h3', text: '카페24가 맞는 경우' },
      { t: 'list', items: ['오픈마켓 · 네이버쇼핑 등 여러 채널에 동시 노출하고 싶다면', '쇼핑몰 전용 기능(할인 · 쿠폰 · 적립금 등)을 세세하게 쓰고 싶다면', '국내 쇼핑몰 사례 · 템플릿 · 개발사가 많아 참고할 자료가 필요하다면'] },
      { t: 'h3', text: '아임웹이 맞는 경우' },
      { t: 'list', items: ['브랜드 디자인을 에디터로 자유롭게 만들고 싶다면', '쇼핑몰 외에 소개 페이지 · 예약 · 멤버십도 함께 운영하고 싶다면', '코드를 직접 다루지 않는 비교적 쉬운 편집 화면을 원한다면'] },
      { t: 'note', text: '두 플랫폼 모두 결제(PG) · 배송 연동 · SEO 기본 기능을 지원합니다. 결정을 미루기보다 위 기준 중 내게 더 중요한 것 1~2가지로 먼저 좁히고, 실제 화면을 체험판으로 확인해보세요.' },
      { t: 'cta', label: '사업자등록 · PG 준비 체크리스트 보기', slug: 'business-pg-checklist' }
    ] },
    'marketplace-vs-own': { intro: '오픈마켓(스마트스토어 · 쿠팡 등)과 자사몰(카페24 · 아임웹 등)은 서로 배타적이지 않습니다. 무엇을 먼저 시작할지 판단하는 기준을 정리했습니다.', blocks: [
      { t: 'h3', text: '오픈마켓 먼저' },
      { t: 'list', items: ['초기 트래픽을 직접 모으기 어렵다면(오픈마켓 자체 검색 유입 활용)', '초기 투자를 최소화하고 반응부터 테스트하고 싶다면', '입점 심사 · 수수료 구조를 감수할 수 있다면'] },
      { t: 'h3', text: '자사몰 먼저' },
      { t: 'list', items: ['브랜드를 처음부터 직접 쌓고 싶다면', '오픈마켓 대비 낮은 수수료 구조로 운영하고 싶다면', '재구매 · 자체 회원 데이터를 쌓고 싶다면'] },
      { t: 'note', text: '많은 판매자가 오픈마켓으로 먼저 반응을 확인한 뒤 자사몰을 함께 운영합니다. 처음부터 여러 채널을 다 열 필요는 없습니다 — 한 채널에서 판매 흐름을 한 번 완성해본 뒤 넓혀가세요.' },
      { t: 'cta', label: '도매처 찾기에서 공급처 후보 보기', href: '#/wholesale' }
    ] },
    'business-pg-checklist': { intro: '결제(PG) 신청을 넣기 전에 아래 서류 · 절차가 준비됐는지 먼저 확인하세요. 순서가 꼬이면 PG 심사가 반려되거나 오래 걸릴 수 있습니다.', blocks: [
      { t: 'checklist', items: ['사업자등록증 발급 완료(개인 · 법인 중 선택)', '통신판매업 신고 완료(사업자등록 이후 신청 가능)', '정산받을 사업자 명의 통장 준비', '쇼핑몰 대표 도메인 확정(PG 심사 시 URL 필요)', '이용약관 · 개인정보처리방침 페이지 게시(PG 심사 필수 항목)', '대표 상품 1개 이상 등록(빈 쇼핑몰은 PG 심사 반려 사유가 될 수 있음)'] },
      { t: 'h3', text: 'PG 신청 진행 순서 (카페24 · KG이니시스 기준 예시)' },
      { t: 'numbered', items: ['카페24 로그인 → 부가서비스 → 기본 운영서비스 → 통합결제(PG)', 'PG 신청하기 → 신청서 작성 후 계약 진행', '사업자등록증 · 통신판매신고번호 · 사이트 정보가 미리 준비돼 있어야 함'] },
      { t: 'note', text: '플랫폼 · PG사에 따라 필요한 서류와 소요 기간이 다를 수 있습니다. 메뉴 위치와 심사 기준은 변경될 수 있으므로 신청 전 공식 안내를 함께 확인해주세요.' }
    ] },
    'domain-ssl-seo': { intro: '카페24 기준 예시입니다. 다른 플랫폼도 메뉴 이름만 다를 뿐 순서는 비슷합니다 — 도메인 연결 → SSL 인증서 → 검색엔진 노출 설정 순으로 진행하세요.', blocks: [
      { t: 'h3', text: '도메인 연결하기' },
      { t: 'numbered', items: ['카페24 로그인 → 설정 → 기본 설정 → 도메인 설정', "'신규 도메인' → 구매하기 클릭", '브랜드명으로 검색 후 원하는 도메인(.com / .kr 등) 구매', '도메인 설정 → 도메인 관리 → 구매한 도메인의 관리 설정 클릭', 'SSL 인증서 발급 진행(HTTPS 보안 주소 적용)'] },
      { t: 'h3', text: 'SEO 기본 세팅' },
      { t: 'numbered', items: ['설정 → 기본 설정 → 검색엔진 최적화(SEO) 진입', '공통 페이지 SEO 태그 — 쇼핑몰 이름 · 설명 · 키워드 입력', '파비콘 설정(16×16 또는 32×32) + SNS 공유 이미지(권장 1200×628px)', '네이버 연관 채널에 블로그 · 인스타 · 유튜브 URL 등록', "고급설정 — 사이트맵 · RSS 피드는 반드시 '사용함'으로(검색 노출에 직결)"] },
      { t: 'note', text: '다른 플랫폼을 쓴다면 메뉴 이름은 다르지만 "도메인 연결 → SSL → SEO 태그 입력 → 사이트맵 제출" 순서는 동일합니다.' },
      { t: 'note', text: '메뉴 위치와 심사 기준은 변경될 수 있으므로 신청 전 공식 안내를 함께 확인해주세요.' }
    ] },
    'naver-kakao-setup': { intro: '카페24 기준 예시입니다. 신청 → 승인 → 키 연동 순서는 대부분의 플랫폼에서 비슷합니다.', blocks: [
      { t: 'h3', text: '네이버페이 연동' },
      { t: 'numbered', items: ['카페24 → 판매채널 → 네이버 → 네이버페이 안내 → 서비스 신청(심사 1~3일)', '승인 후 카페24 → 판매채널 → 네이버 → 네이버페이 설정 화면을 열어둠', '새 탭에서 네이버페이 판매자센터 로그인 → 내 정보 → 가입정보 변경', '공통 인증키 · 페이센터 ID · 가맹점 ID · 버튼 인증키 4가지 복사', '카페24 설정 화면에 붙여넣고 저장'] },
      { t: 'h3', text: '카카오 싱크 · 톡체크아웃 연동' },
      { t: 'numbered', items: ['카카오 비즈니스 채널 관리자 접속 → 사업자 정보 입력 → 채널 개설', "카페24 → 판매채널 → 카카오 → 카카오 비즈니스 → '카카오 로그인 사용함' 체크", '카카오 싱크 간편 설정하기 클릭 → 로그인 + 연동 완료', "톡체크아웃 → '사용함' 설정(카카오페이 바로결제 활성화)"] },
      { t: 'note', text: '메뉴 위치와 심사 기준은 변경될 수 있으므로 신청 전 공식 안내를 함께 확인해주세요.' },
      { t: 'note', text: '메타 픽셀 연동은 광고를 쓸 계획이 있을 때만 필요합니다 — 광고와 성장 카테고리의 "GA4 · Meta 픽셀 · UTM 기본"에서 확인하세요.' },
      { t: 'cta', label: 'GA4 · Meta 픽셀 · UTM 기본 보기', slug: 'ga4-pixel-utm' }
    ] },

    'product-before-sourcing': { intro: '공급처부터 찾기 전에, 무엇을 어떤 기준으로 팔지 먼저 정리하면 탐색이 훨씬 빨라집니다.', blocks: [
      { t: 'list', items: ['대표 상품(또는 우선 판매할 상품 몇 가지)을 먼저 정하고, 모든 옵션을 한 번에 갖추기보다 대표 옵션 하나로 반응부터 확인하세요.', '객단가를 높일 저관여 부가 상품(소모품 · 액세서리 등)을 소량 함께 고려하세요.', '특정 시즌 · 유행을 타지 않는 스테디셀러를 우선순위에 두면 매출을 오래 지탱하기 쉽습니다.', '사용하려는 판매 채널의 입점 심사 기준(최소 등록 상품 수 등)을 미리 확인하세요.'] },
      { t: 'note', text: '상품을 넓게 갖추는 결정은 나중에도 할 수 있습니다. 처음에는 좁고 명확하게 시작하는 편이 안전합니다.' },
      { t: 'cta', label: '도매처 찾기에서 공급처 후보 보기', href: '#/wholesale' }
    ] },
    'margin-before-selling': { intro: '원가의 2배로 팔아도 실제로 남는 돈은 그보다 훨씬 적을 수 있습니다. 판매가를 정하기 전에 아래 비용을 먼저 계산해보세요.', blocks: [
      { t: 'list', items: ['플랫폼 수수료', '결제(PG) 수수료', '배송비 · 포장비', '할인 · 프로모션', '반품 · 교환 처리 비용', '광고비'] },
      { t: 'note', text: '경쟁사 가격만 보고 판매가를 따라 정하지 마세요. 위 비용을 모두 반영한 뒤 실제로 남는 금액을 마진 계산기에서 확인하고 가격을 정하세요.' },
      { t: 'cta', label: 'LaunchDesk 마진 계산기 열기', href: '#/tools', toolsTarget: 'calc' }
    ] },
    'supplier-check-checklist': { intro: '공급처는 한 곳만 보지 말고 최소 2~3곳을 비교하세요. 단가 · 조건이 비슷해 보여도 배송 · 대응 속도에서 차이가 큰 경우가 많습니다.', blocks: [
      { t: 'checklist', items: ['사입가 또는 공급가(부가세 포함 여부까지 확인)', '배송비와 배송 조건(택배사 · 리드타임)', '최소 주문수량(MOQ)', '반품 · 교환 조건', '품절 시 대응 방식(재입고 일정, 대체 상품 여부)', '세금계산서 발행 가능 여부', '상품 정보(이미지 · 상세정보) 제공 범위'] }
    ] },
    'detail-page-structure': { intro: '상세페이지는 고객이 구매를 결정하는 마지막 단계입니다. 아래 순서를 기본 뼈대로 삼아 채워보세요.', blocks: [
      { t: 'numbered', items: ['첫 화면 — 상품이 무엇인지, 누구를 위한 것인지 3초 안에 보이게', '핵심 장점 — 한 문장으로 이해되는 가장 큰 이점부터', '상세 스펙 — 사이즈 · 소재 · 용량 · 사용법 등 구매 판단에 필요한 정보', '신뢰 요소 — 실제 사용 장면, 후기, 제작 · 소싱 과정 등', '구매 조건 — 가격, 배송비, 배송 기간, 교환 · 반품 기준을 명확히', '마무리 CTA — 지금 구매해야 할 이유와 행동 유도 문구'] },
      { t: 'note', text: '사진 품질과 정보량이 부족하면 아무리 좋은 상품도 설득력이 떨어집니다. 순서보다 "고객이 궁금해할 질문에 빠짐없이 답했는가"가 더 중요합니다.' }
    ] },

    'shipping-policy-checklist': { intro: '배송 정책은 상세페이지와 고객센터 안내에 동일하게 표시돼야 합니다. 정책이 바뀌면 두 곳 모두 함께 수정하세요.', blocks: [
      { t: 'checklist', items: ['배송비 기준(무료배송 조건 포함 여부) 정하기', '택배사 · 평균 배송 소요일 확인하기', '도서산간 · 제주 추가 배송비 기준 정하기', '배송 지연 시 안내 방법 정하기', '출고 마감 시간(당일발송 기준) 정하기', '파손 · 분실 시 처리 기준 정하기'] }
    ] },
    'return-exchange-checklist': { intro: '전자상거래법상 기본 청약철회 기간 등 법정 기준을 벗어나는 정책은 만들 수 없습니다. 정확한 법적 기준은 관련 법령이나 플랫폼 공지를 확인하세요.', blocks: [
      { t: 'checklist', items: ['교환 · 반품 가능 기간(수령일 기준 며칠) 정하기', '단순 변심과 상품 하자를 구분하는 기준 정하기', '반품 배송비를 누가 부담하는지(단순 변심 vs 하자) 정하기', '교환 · 반품 불가 상품(위생용품 등)이 있다면 명시하기', '환불 처리 소요일 안내 문구 준비하기'] }
    ] },
    'cs-script-examples': { intro: '자주 오는 문의 유형별로 기본 톤을 잡아두면 응대 속도와 일관성이 좋아집니다. 아래는 참고용 예시이며, 브랜드 톤에 맞게 수정해서 쓰세요.', blocks: [
      { t: 'h3', text: '배송 지연 문의' },
      { t: 'p', text: '"안녕하세요, 고객님. 주문하신 상품은 현재 배송 중이며 예상보다 지연되고 있는 점 양해 부탁드립니다. 정확한 도착 예정일은 확인 후 다시 안내드리겠습니다."' },
      { t: 'h3', text: '사이즈 · 옵션 교환 문의' },
      { t: 'p', text: '"안녕하세요, 고객님. 교환 도와드리겠습니다. 받으신 상품 그대로 미사용 상태에서 앱을 통해 교환 신청해주시면 빠르게 처리해드리겠습니다."' },
      { t: 'h3', text: '단순 변심 반품 문의' },
      { t: 'p', text: '"안녕하세요, 고객님. 반품 도와드리겠습니다. 상품 수령일로부터 7일 이내 반품 신청 부탁드리며, 반품 배송비는 고객 부담으로 안내드립니다."' },
      { t: 'h3', text: '품절 · 재입고 문의' },
      { t: 'p', text: '"안녕하세요, 고객님. 현재 품절 상태이며 재입고 일정은 확정되는 대로 안내드리겠습니다. 재입고 알림을 원하시면 남겨주세요."' },
      { t: 'note', text: '실제 응대에서는 주문번호 · 상품명 등 구체적인 정보를 함께 확인하며 답변하세요.' }
    ] },
    'review-points-basics': { intro: '리뷰와 적립금은 재구매율에 직접 영향을 줍니다. 처음부터 복잡하게 설계하지 말고 기본 구조부터 잡아보세요.', blocks: [
      { t: 'h3', text: '리뷰 수집' },
      { t: 'list', items: ['구매 확정 후 일정 기간 뒤 리뷰 작성 안내(자동 알림 활용 가능)', '포토 · 동영상 리뷰에 적립금을 더 주는 구조로 참여를 유도', '부정적 리뷰도 삭제보다 정중한 답변으로 대응'] },
      { t: 'h3', text: '적립금 운영' },
      { t: 'list', items: ['지급 기준(가입 · 구매 확정 · 리뷰 작성 등)을 명확히 정하기', '적립금 유효기간과 사용 조건(최소 주문 금액 등) 명시하기', '과도한 적립률은 마진을 해칠 수 있으니 마진 계산기로 영향 확인하기'] },
      { t: 'cta', label: '적립금 반영한 마진 확인하기', href: '#/tools', toolsTarget: 'calc' }
    ] },

    'ad-before-start': { rich: true, intro: '광고는 켜는 순간 비용이 나갑니다. 목표·손익·측정 방법을 먼저 정해 두면 결과가 좋지 않을 때 원인을 더 빠르게 찾을 수 있습니다.', blocks: [
      { t: 'h3', text: '결론부터' },
      { t: 'flow', label: '광고 시작 전 준비 3단계', items: [
        { title: '목표와 상품 정하기', desc: '1~3단계' },
        { title: '손익과 예산 정하기', desc: '4·6단계' },
        { title: '측정하고 기록하기', desc: '5·7단계' }
      ] },
      { t: 'note', text: '이 가이드는 광고 설정법이 아니라, 광고를 시작하기 전 준비 상태를 확인하는 체크리스트입니다.' },

      { t: 'step', num: 1, title: '광고 목표 정하기', fields: [
        { label: '왜 확인하나요', text: '목표가 다르면 봐야 할 숫자와 "잘 됐다"의 기준도 달라집니다.' },
        { label: '무엇을 확인하나요', items: [
          '방문자 늘리기 — 광고를 눌러 실제 상품 페이지까지 온 사람을 봅니다.',
          '첫 구매 만들기 — 구매 수와 구매 1건을 만드는 데 쓴 광고비를 봅니다.',
          '재구매 만들기 — 기존 고객의 재구매 주문 수를 따로 봅니다.',
          '한 캠페인에는 목표를 하나만 둡니다. 여러 목표를 함께 기대하면 결과를 봐도 원인을 나눌 수 없습니다.'
        ] },
        { label: '완료 기준', text: '이번 광고의 목표를 위 세 가지 중 하나로 적었고, 그 목표를 판단할 숫자 2~3개를 골랐습니다.' }
      ] },

      { t: 'step', num: 2, title: '누구에게 무엇을 팔지 한 문장으로 정리', fields: [
        { label: '왜 확인하나요', text: '이 문장이 비면 광고 문구와 상품 페이지가 서로 다른 말을 하게 되어, 클릭한 사람이 바로 나가기 쉽습니다.' },
        { label: '무엇을 확인하나요', items: [
          '빈칸 채우기 — "[누구]가 [어떤 문제] 때문에 불편할 때, [상품]은(는) [구매 이유] 때문에 고를 만합니다."',
          '예시(가상) — "좁은 원룸에 살아 수납이 부족한 사람이 불편할 때, 이 접이식 수납함은 쓰지 않을 때 접어 둘 수 있어서 고를 만합니다."',
          '타깃은 "모든 사람"이 아니라 한 장면으로 떠올릴 수 있는 사람으로 적습니다.',
          '구매 이유는 상품 페이지에서 실제로 확인되는 사실만 적습니다.'
        ] },
        { label: '완료 기준', text: '한 문장을 적었고, 그 문장의 "구매 이유"를 상품 페이지 첫 화면에서 찾을 수 있습니다.' }
      ] },

      { t: 'step', num: 3, title: '광고 전에 상품 페이지 점검', fields: [
        { label: '왜 확인하나요', text: '광고는 사람을 상품 페이지까지만 데려옵니다. 페이지에 빠진 정보를 광고를 켠 뒤 발견하면 그 사이 쓴 광고비는 돌려받을 수 없습니다.' },
        { label: '무엇을 확인하나요', items: [
          '가격 — 옵션을 바꿀 때 달라지는 가격까지 보이는가',
          '혜택 — 쿠폰·적립금·사은품의 조건(기간, 최소 금액)이 함께 적혀 있는가',
          '배송비 — 무료배송 기준과 추가 배송비가 결제 전에 보이는가',
          '배송기간 — 출고일과 도착 예상일이 적혀 있는가',
          '교환·반품 — 가능한 기간과 배송비 부담이 적혀 있는가',
          '신뢰 요소 — 실제 사진, 후기, 사업자 정보, 문의 채널이 있는가'
        ], blocks: [
          { t: 'h3', text: '휴대폰에서 직접 구매 테스트' },
          { t: 'numbered', items: [
            '광고 링크를 휴대폰에서 열고 상품·가격·구매 이유가 보이는지 확인',
            '옵션 선택부터 결제 직전까지 이동해 최종 결제 금액과 결제수단 확인',
            '느린 화면, 작은 글자, 작동하지 않는 버튼을 수정한 뒤 다시 확인'
          ] }
        ] },
        { label: '완료 기준', text: '위 6가지가 모두 페이지에서 찾아지고, 휴대폰에서 결제 직전까지 막힘 없이 갔습니다. 막힌 곳은 고친 뒤 다시 확인했습니다.' }
      ] },

      { t: 'step', num: 4, title: '광고 전 공헌이익 계산', fields: [
        { label: '왜 확인하나요', text: '광고비를 빼기 전 남는 돈(전문 용어로 광고 전 공헌이익)을 먼저 알아야, 주문 1건에 쓸 수 있는 광고비 한도를 정할 수 있습니다.' },
        { label: '무엇을 확인하나요', text: '판매가에서 아래 변동비를 빼면 공헌이익이 남습니다. 광고비는 이 계산에 넣지 않고, 계산이 끝난 뒤에 비교합니다.', items: [
          '상품원가', '판매수수료', '실제 배송비', '포장비', '판매자 부담 쿠폰·적립금·사은품 비용'
        ], blocks: [
          { t: 'metric-summary', items: [
            { term: '판매가', desc: '50,000원', role: 'chain' },
            { term: '광고비 제외 변동비', desc: '30,000원', role: 'chain', op: '−' },
            { term: '광고비를 빼기 전 남는 돈', desc: '20,000원', role: 'result', op: '=' },
            { term: '공헌이익률', desc: '40%', role: 'stat' },
            { term: '손익분기 ROAS', desc: '250%', role: 'stat' },
            { term: '주문당 광고비 한도', desc: '20,000원', role: 'stat' }
          ] },
          { t: 'note', text: '세금, 반품·교환 비용, 고정비(월 구독료 등)는 이 계산에 넣지 않았습니다. 내 상품의 실제 숫자로 다시 계산하면 손익분기 ROAS가 이 값보다 높아질 수 있습니다.' },
          { t: 'cta', label: '마진 계산기로 내 상품 계산하기', href: '#/tools', toolsTarget: 'calc' }
        ] },
        { label: '완료 기준', text: '내 상품의 광고 전 공헌이익, 공헌이익률, 손익분기 ROAS, 주문당 광고비 한도를 숫자로 적었습니다.' }
      ] },

      { t: 'step', num: 5, title: '전환 측정 준비', fields: [
        { label: '왜 확인하나요', text: '광고 관리자의 구매 수와 실제 주문이 어긋나면 CPA와 ROAS를 믿고 판단할 수 없습니다.' },
        { label: '무엇을 확인하나요', items: [
          '테스트 주문이 정상적으로 끝까지 완료되는가',
          '구매가 측정 도구에 정확히 1번 기록되는가',
          '주문 금액과 주문번호가 실제 주문과 일치하는가',
          '광고 링크에 UTM이 붙어 있는가'
        ], blocks: [
          { t: 'flow', label: '광고 클릭부터 주문 확인까지 측정 흐름', items: [
            { title: '광고 링크(UTM)' },
            { title: '상품 페이지' },
            { title: '결제' },
            { title: '구매 이벤트' },
            { title: '실제 주문과 대조' }
          ] },
          { t: 'cta', label: 'GA4 · Meta 픽셀 · UTM 기본 보기', slug: 'ga4-pixel-utm' }
        ] },
        { label: '완료 기준', text: '테스트 주문 1건이 측정 도구에 1번만 기록되고, 금액과 주문번호가 실제 주문과 같습니다. 광고 링크에 UTM이 붙어 있습니다.' }
      ] },

      { t: 'step', num: 6, title: '테스트 예산과 기간 결정', fields: [
        { label: '왜 확인하나요', text: '광고 결과는 하루 안에서도 크게 흔들리고, 구매 수가 적을 때는 우연의 영향이 큽니다.' },
        { label: '무엇을 확인하나요', items: [
          '구매가 0건이어도 감당할 수 있는 손실 한도를 총예산으로 정하기',
          '시작 전에 최대 기간과 종료 조건 정하기',
          '하루 결과만으로 성공·실패를 판단하지 않기',
          '한 번에 한 가지 변수만 바꾸기',
          '예시: 테스트 예산이 100,000원이면 100,000 ÷ 20,000 = 5건이 팔려야 광고비와 공헌이익이 같아집니다.'
        ] },
        { label: '완료 기준', text: '테스트 총예산 상한, 시작일과 종료 조건, 손익분기에 필요한 구매 수를 적었습니다.' }
      ] },

      { t: 'step', num: 7, title: '기록표 만들기', fields: [
        { label: '왜 확인하나요', text: '기억이 아니라 숫자로 원인을 좁히려면 같은 항목을 같은 순서로 꾸준히 적어야 합니다.' },
        { label: '무엇을 확인하나요', items: [
          '아래 표의 항목을 스프레드시트나 노트에 만들고, 광고를 켜기 전 기준값(공헌이익률, 손익분기 ROAS, 주문당 광고비 한도)을 첫 줄에 적어 둡니다.',
          'LaunchDesk 광고 기록은 날짜, 채널, 소재명, 지출, 전환 매출을 입력하면 ROAS를 계산해 줍니다. 노출·클릭·장바구니·CPA·메모 입력 칸은 없습니다.'
        ], blocks: [
          { t: 'table', caption: '광고 기록표에 적을 항목', head: ['항목', '적는 값', '어디서 확인하나요'], rows: [
            ['날짜', '기록한 날(기간을 나눴다면 시작일~종료일)', '직접 입력'],
            ['채널', '메타 · 네이버 등 광고를 집행한 곳', '직접 입력'],
            ['소재명', '구분할 소재 또는 캠페인 이름', '직접 입력'],
            ['광고비', '쓴 광고비(원)', '광고 플랫폼'],
            ['전환 매출', '구매로 이어진 매출 합계(원)', '쇼핑몰 주문 목록'],
            ['ROAS', '전환 매출 ÷ 광고비 × 100', 'LaunchDesk 광고 기록이 자동 계산']
          ] },
          { t: 'p', text: '구매 수와 바꾼 내용(소재 교체 시점 등)은 광고 관리자나 별도 메모에서 확인하세요.' },
          { t: 'cta', label: '광고 기록 남기기', href: '#/dashboard' }
        ] },
        { label: '완료 기준', text: '기록표를 만들었고, 첫 줄에 광고를 켜기 전 기준값을 적었습니다.' }
      ] },

      { t: 'h3', text: '광고를 켜기 전 완료 체크리스트' },
      { t: 'checklist', items: [
        '이번 광고의 목표를 하나만 정했다',
        '"누구에게 무엇을 왜 파는지" 한 문장을 적었다',
        '상품 페이지의 가격 · 혜택 · 배송 · 교환 · 반품 · 신뢰 요소를 확인하고, 휴대폰에서 결제 직전까지 직접 해 봤다',
        '광고 전 공헌이익률과 손익분기 ROAS를 계산했다',
        '테스트 주문으로 구매 이벤트가 1번만 기록되는지, UTM이 붙었는지 확인했다',
        '테스트 예산 상한과 기간(또는 종료 조건)을 정했다',
        '기록표를 만들고 광고를 켜기 전 기준값을 적었다'
      ] },
      { t: 'cta', label: '광고 숫자 읽는 법 보기', slug: 'ad-metrics' },
      { t: 'sources', checkedAt: '2026년 9월', items: [
        { title: 'Set up a purchase event', org: 'Google for Developers (Google Analytics)', url: 'https://developers.google.com/analytics/devguides/collection/ga4/set-up-ecommerce' },
        { title: '[GA4] Minimize duplicate key events with transaction IDs', org: 'Google 애널리틱스 고객센터', url: 'https://support.google.com/analytics/answer/12313109' },
        { title: 'URL 작성 도구: 맞춤 URL을 사용한 캠페인 데이터 수집', org: 'Google 애널리틱스 고객센터', url: 'https://support.google.com/analytics/answer/10917952' },
        { title: 'Monitor events in DebugView', org: 'Google 애널리틱스 고객센터', url: 'https://support.google.com/analytics/answer/7201382' },
        { title: '일반적인 타사 보고 불일치 문제 해결', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/511923449323749' },
        { title: '광고 성과의 변동 이해하기', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/1364841787225722' },
        { title: '구매 광고 지출 대비 수익률(ROAS)', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/274294333328345' }
      ] }
    ] },

    'ad-metrics': { rich: true, intro: '광고 숫자는 노출부터 구매까지 사람이 어디에서 줄어드는지 보여줍니다. ROAS만 보지 말고 유입·구매·이익의 순서로 읽어야 실제 문제를 찾을 수 있습니다.', blocks: [
      { t: 'h3', text: '결론부터' },
      { t: 'flow', label: '광고 숫자를 읽는 3단계', items: [
        { title: '유입 확인', desc: '노출 → 클릭 → 랜딩페이지 도착' },
        { title: '구매 확인', desc: '장바구니 → 결제 시작 → 구매' },
        { title: '이익 확인', desc: 'CPA → ROAS → 광고비 차감 후 남는 돈' }
      ] },
      { t: 'note', text: '한 번에 모든 지표를 외울 필요는 없습니다. 아래 핵심 6개만 먼저 보고, 나머지는 필요할 때 펼쳐 보세요.' },

      { t: 'h3', text: '전체 광고 퍼널' },
      { t: 'flow', label: '광고 퍼널 7단계', items: [
        { title: '노출', desc: '광고가 화면에 나타남' },
        { title: '링크 클릭', desc: '광고를 눌러 이동' },
        { title: '랜딩페이지 도착', desc: '실제 페이지가 열림' },
        { title: '장바구니', desc: '구매 의향 표시' },
        { title: '결제 시작', desc: '결제 과정 진입' },
        { title: '구매', desc: '주문 완료' },
        { title: '매출과 이익', desc: '비용을 빼고 남은 금액' }
      ] },

      { t: 'h3', text: '이 가이드의 예시 쇼핑몰' },
      { t: 'p', text: '아래 모든 계산은 같은 가상 쇼핑몰의 숫자를 씁니다.' },
      { t: 'table', caption: '이 가이드의 예시 쇼핑몰(가상 데이터)', head: ['항목', '값'], rows: [
        ['광고비', '100,000원'],
        ['노출수', '20,000회'],
        ['링크 클릭', '200회'],
        ['구매', '8건'],
        ['객단가', '50,000원'],
        ['매출', '400,000원'],
        ['주문 1건당 광고비 제외 변동비', '30,000원'],
        ['주문 1건당 광고 전 공헌이익', '20,000원'],
        ['광고 전 공헌이익률', '40%']
      ] },

      { t: 'h3', text: '초보자가 먼저 볼 핵심 지표' },
      { t: 'p', text: '아래 6개만 먼저 확인해도 광고비를 낸 뒤 돈이 남는지 판단할 수 있습니다.' },
      { t: 'formula', items: [
        { term: '광고비', formula: '이번 기간에 실제로 쓴 금액', desc: '광고를 위해 낸 돈입니다. 모든 계산의 출발점입니다.', check: '정해 둔 테스트 예산 상한과 비교합니다.' },
        { term: '링크 클릭수', formula: '광고 플랫폼이 세는 값', desc: '광고 안의 링크를 눌러 실제로 이동한 횟수입니다.', check: '같은 상품의 이전 기간, 또는 같은 캠페인의 다른 소재와 비교합니다.' },
        { term: '클릭 1회를 만드는 데 든 광고비(CPC)', formula: '광고비 ÷ 링크 클릭수', desc: '클릭이 비싸지면 노출 단가나 클릭률 중 무엇이 변했는지 봅니다.', check: '같은 상품의 이전 기간과 비교합니다.' },
        { term: '구매 수', formula: '결제까지 끝난 주문 수', desc: '광고를 통해 실제로 판매까지 이어진 건수입니다.', check: '쇼핑몰 실제 주문 목록과 대조해 숫자가 같은지 확인합니다.' },
        { term: '구매 1건을 만드는 데 든 광고비(CPA)', formula: '광고비 ÷ 구매 수', desc: '낮을수록 적은 광고비로 많이 판 것입니다.', check: '내 상품의 손익분기점(주문당 광고비 한도)과 비교합니다.' },
        { term: '광고비 대비 발생한 매출 비율(ROAS)과 광고비 차감 후 남는 돈', formula: 'ROAS = 매출 ÷ 광고비 × 100 · 남는 돈 = 광고 전 총 공헌이익 − 광고비', desc: 'ROAS가 높아도 남는 돈은 마이너스일 수 있어 둘을 함께 봐야 합니다.', check: '내 상품의 손익분기 ROAS와 비교합니다.' }
      ] },
      { t: 'metric-summary', items: [
        { term: '광고비', desc: '100,000원', role: 'chain' },
        { term: '클릭', desc: '200회', role: 'chain', op: '→' },
        { term: '구매', desc: '8건', role: 'chain', op: '→' },
        { term: '매출', desc: '400,000원', role: 'result', op: '→' },
        { term: 'CPC', desc: '500원', role: 'stat' },
        { term: 'CPA', desc: '12,500원', role: 'stat' },
        { term: 'ROAS', desc: '400%', role: 'stat' },
        { term: '광고비 차감 후 남는 돈', desc: '60,000원', role: 'stat' }
      ] },

      { t: 'h3', text: '매출과 이익 구분' },
      { t: 'p', text: 'ROAS 400%는 매출 400,000원이 전부 이익이라는 뜻이 아닙니다. 매출 안에는 상품원가 · 수수료 · 배송비 같은 변동비가 이미 들어 있습니다.' },
      { t: 'metric-summary', items: [
        { term: '매출', desc: '400,000원', role: 'chain' },
        { term: '주문 8건의 광고비 제외 변동비', desc: '240,000원', role: 'chain', op: '−' },
        { term: '광고 전 총 공헌이익', desc: '160,000원', role: 'result', op: '=' },
        { term: '광고비', desc: '100,000원', role: 'chain', op: '−' },
        { term: '광고비 차감 후 남는 공헌이익', desc: '60,000원', role: 'result', op: '=' }
      ] },
      { t: 'note', text: '이 예시에는 세금, 반품·교환 비용, 판매자가 나눠 내는 쿠폰 분담금, 월 고정비(구독료 · 임대료 · 인건비 등)를 넣지 않았습니다. 이런 비용이 있으면 실제로 남는 돈은 더 적어질 수 있습니다. 손익분기 ROAS 250%는 이익이 많이 남는 기준이 아니라 손익이 0원이 되는 경계선입니다.' },

      { t: 'h3', text: '지표를 읽는 실제 순서' },
      { t: 'numbered', items: [
        '노출이 발생했는가',
        '노출된 사람이 클릭했는가',
        '클릭한 사람이 실제 페이지에 도착했는가',
        '방문자가 장바구니와 결제로 이동했는가',
        '구매 1건을 만드는 광고비가 얼마인가',
        '내 손익분기 CPA · ROAS보다 나은가',
        '광고비를 빼고 실제로 얼마가 남았는가'
      ] },
      { t: 'cta', label: '광고가 안 될 때 확인 순서 보기', slug: 'ad-troubleshoot' },

      { t: 'p', text: '날짜·채널·소재명·지출·전환 매출을 기록하면 ROAS를 자동으로 계산합니다.' },
      { t: 'cta', label: '광고 기록 남기기', href: '#/dashboard' },

      { t: 'collapse', summary: '전체 18개 광고 지표와 계산식 보기', blocks: [
        { t: 'p', text: '지표마다 뜻 · 계산식 · 확인할 것 순서로 적었습니다. 광고 관리자에서 도달, 빈도, 일부 전환 지표는 추산치로 표시될 수 있습니다.' },
        { t: 'formula', items: [
          { term: '노출수', formula: '광고 플랫폼이 세는 값(직접 계산하지 않음)', desc: '광고가 화면에 보인 횟수입니다. 같은 사람에게 여러 번 보이면 더해집니다.', check: '갑자기 줄었다면 광고 게재 상태(심사 · 결제 · 일정 · 예산)부터 확인합니다.' },
          { term: '도달수', formula: '광고 플랫폼이 세는 값(추산치일 수 있음)', desc: '광고를 한 번 이상 본 사람(계정)의 수입니다. 여러 번 봐도 1명으로 셉니다.', check: '노출수는 늘었는데 도달수가 그대로면 같은 사람에게 반복 노출되고 있다는 뜻이므로 빈도를 함께 봅니다.' },
          { term: '빈도', formula: '노출수 ÷ 도달수', desc: '한 사람이 광고를 본 평균 횟수입니다.', check: '빈도가 오르는데 성과가 나빠지면 광고 피로일 수 있습니다. 소재나 타깃을 바꿔 봅니다(Meta 도움말).' },
          { term: 'CPM', formula: '광고비 ÷ 노출수 × 1,000', desc: '광고가 1,000번 보이는 데 든 비용입니다.', check: 'CPM만으로 판단하지 말고 클릭 · 구매 비용과 함께 봅니다.' },
          { term: '링크 클릭수', formula: '광고 플랫폼이 세는 값', desc: '광고 안의 링크를 눌러 이동한 횟수입니다. "클릭(전체)"와는 다른 지표이니 계산에는 링크 클릭을 씁니다.', check: '클릭에 비해 랜딩페이지 조회가 크게 적으면 페이지가 열리기 전에 이탈했거나 추적에 문제가 있을 수 있습니다.' },
          { term: 'CTR', formula: '링크 클릭수 ÷ 노출수 × 100', desc: '광고가 보인 횟수 중 링크 클릭으로 이어진 비율입니다.', check: '내려갔다면 소재 첫 화면, 문구, 빈도를 확인합니다. 올랐는데 구매가 늘지 않으면 다음 단계인 페이지를 봅니다.' },
          { term: 'CPC', formula: '광고비 ÷ 링크 클릭수', desc: '링크 클릭 1번을 얻는 데 든 광고비입니다.', check: '올랐다면 CPM이 오른 것인지 CTR이 내려간 것인지 나눠 봅니다.' },
          { term: '랜딩페이지 조회', formula: '광고 플랫폼(픽셀)이 세는 값 · 랜딩페이지 조회 ÷ 링크 클릭수 × 100으로 비율을 봄', desc: '광고를 누른 뒤 페이지가 실제로 열린 횟수입니다. 링크 클릭과 항상 같지는 않습니다.', check: '링크 클릭보다 크게 적으면 주소 오류, 느린 로딩, 픽셀 설치 상태를 확인합니다.' },
          { term: '장바구니', formula: '장바구니 담기 횟수 ÷ 랜딩페이지 조회 × 100', desc: '상품을 장바구니에 담은 횟수입니다.', check: '방문에 비해 적으면 가격, 상품 설명, 배송비 표시, 후기를 확인합니다.' },
          { term: '결제 시작', formula: '결제 시작 횟수 ÷ 장바구니 담기 횟수 × 100', desc: '장바구니에서 결제 화면으로 넘어간 횟수입니다.', check: '장바구니에 비해 적으면 배송비가 뒤늦게 붙는지, 회원가입을 강제하는지 확인합니다.' },
          { term: '구매', formula: '구매 이벤트 수 · 쇼핑몰 실제 주문 목록과 대조', desc: '결제까지 끝난 주문 수입니다.', check: '광고 관리자의 구매 수와 쇼핑몰 실제 주문 수를 같은 기간 기준으로 대조합니다.' },
          { term: '구매 전환율', formula: '구매 수 ÷ 링크 클릭수 × 100', desc: '링크를 누른 사람 중 실제로 산 사람의 비율입니다. 이 가이드는 링크 클릭을 분모로 씁니다.', check: '내려갔다면 랜딩페이지 조회 → 장바구니 → 결제 시작 중 어디서 줄었는지 찾습니다.' },
          { term: 'CPA', formula: '광고비 ÷ 구매 수', desc: '구매 1건을 얻는 데 든 광고비입니다.', check: 'CPA는 CPC ÷ 구매 전환율과 같습니다(500 ÷ 0.04 = 12,500). 무엇이 변했는지 나눠 봅니다.' },
          { term: '매출', formula: '구매 수 × 객단가(또는 결제 금액의 합계)', desc: '광고로 발생한 것으로 집계된 구매 금액입니다.', check: '구매 수와 객단가 중 무엇이 변했는지 나눠 봅니다.' },
          { term: 'ROAS', formula: '매출 ÷ 광고비 × 100', desc: '광고비 1원당 매출이 얼마인지 보여 줍니다. 이익이 아니라 매출 기준입니다.', check: '매출과 광고비 중 무엇이 변했는지 보고, 손익분기 ROAS와 함께 비교합니다.' },
          { term: '광고 전 공헌이익', formula: '주문 1건: 판매가 − 광고비를 뺀 변동비 · 전체: 주문 1건당 공헌이익 × 구매 수', desc: '광고비를 쓰기 전에 남는 돈입니다.', check: '가격, 원가, 배송비, 할인이 바뀌면 다시 계산합니다. 이 값이 바뀌면 손익분기 ROAS도 바뀝니다.' },
          { term: '손익분기 ROAS', formula: '100 ÷ 광고 전 공헌이익률(소수)', desc: '광고비까지 넣었을 때 손익이 0원이 되는 ROAS입니다.', check: '내 ROAS가 이 값보다 높은지 봅니다. 공헌이익률이 바뀌면 이 기준선도 움직입니다.' },
          { term: '광고비 차감 후 남는 공헌이익', formula: '광고 전 총 공헌이익 − 광고비', desc: '광고비까지 낸 뒤 실제로 남는 돈입니다. 마이너스면 광고비가 공헌이익보다 컸다는 뜻입니다.', check: '마이너스면 CPA가 주문당 공헌이익보다 큰지, 객단가나 변동비가 예상과 다른지 순서대로 봅니다.' }
        ] },
        { t: 'table', caption: '예시 쇼핑몰 계산 결과', head: ['지표', '계산', '결과'], rows: [
          ['CPM', '100,000 ÷ 20,000 × 1,000', '5,000원'],
          ['CTR', '200 ÷ 20,000 × 100', '1%'],
          ['CPC', '100,000 ÷ 200', '500원'],
          ['구매 전환율', '8 ÷ 200 × 100', '4%'],
          ['CPA', '100,000 ÷ 8', '12,500원'],
          ['매출', '8 × 50,000', '400,000원'],
          ['ROAS', '400,000 ÷ 100,000 × 100', '400%'],
          ['광고 전 공헌이익률', '20,000 ÷ 50,000 × 100', '40%'],
          ['손익분기 ROAS', '100 ÷ 0.4', '250%'],
          ['광고 전 총 공헌이익', '8 × 20,000', '160,000원'],
          ['광고비 차감 후 남는 공헌이익', '160,000 − 100,000', '60,000원'],
          ['주문당 광고비 한도(손익분기 CPA)', '20,000', '20,000원']
        ] }
      ] },

      { t: 'h3', text: '"좋은 숫자"는 어떻게 정하나요' },
      { t: 'p', text: 'CTR, CPC, ROAS에는 모든 상품에 통하는 합격선이 없습니다. 대신 아래 세 가지와 비교하세요.' },
      { t: 'list', items: [
        '같은 상품의 이전 기간 — 기간의 길이와 전환 기준을 맞춘 뒤, 이번 기간이 나아졌는지 나빠졌는지 봅니다.',
        '같은 캠페인의 소재 간 비교 — 같은 기간, 비슷한 예산 조건에서 소재끼리 나란히 놓고 봅니다.',
        '내 손익분기점 — ROAS가 손익분기 ROAS보다 높은지, CPA가 주문당 광고비 한도보다 낮은지 봅니다. 결국 가장 중요한 기준입니다.'
      ] },
      { t: 'cta', label: '내 상품의 손익분기 ROAS 확인하기', href: '#/tools', toolsTarget: 'calc' },
      { t: 'sources', checkedAt: '2026년 9월', items: [
        { title: '노출', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/675615482516035' },
        { title: '도달 지표 정보', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/710746785663278' },
        { title: '빈도', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/1546570362238584' },
        { title: 'CTR(링크 클릭률)', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/877711998984611' },
        { title: 'CPM(1,000회 노출당 비용)', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/753932008002620' },
        { title: 'CPC(링크 클릭당 비용)', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/683065845109838' },
        { title: '랜딩 페이지 조회', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/646884317670110' },
        { title: '링크 클릭과 랜딩 페이지 조회의 차이 이해', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/172641445757289' },
        { title: '구매 광고 지출 대비 수익률(ROAS)', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/274294333328345' },
        { title: '기여 모델 및 기여 설정 정보', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/460276478298895' },
        { title: 'Conversion rate: Definition', org: 'Google Ads 고객센터', url: 'https://support.google.com/google-ads/answer/2684489' },
        { title: 'Understand your conversion tracking data', org: 'Google Ads 고객센터', url: 'https://support.google.com/google-ads/answer/6270625' },
        { title: 'Conversion value per cost: Definition', org: 'Google Ads 고객센터', url: 'https://support.google.com/google-ads/answer/13405059' }
      ] }
    ] },

    'ad-troubleshoot': { rich: true, intro: '"광고가 안 돼요" 싶을 때도 전부 바꾸지 말고, 사람이 줄어드는 첫 지점부터 순서대로 찾아야 원인을 좁힐 수 있습니다. 아래 흐름과 진단표에서 내 증상부터 먼저 골라보세요.', blocks: [
      { t: 'h3', text: '결론부터' },
      { t: 'flow', label: '광고 성과를 읽는 흐름', items: [
        { title: '노출' }, { title: '클릭' }, { title: '상품 페이지 도착' }, { title: '장바구니·결제' }, { title: '구매' }, { title: '이익' }
      ] },
      { t: 'p', text: '증상이 보이는 가장 위쪽 단계부터 확인하세요. 앞 단계가 막혀 있으면 뒤 단계 숫자는 원인이 아니라 결과입니다.' },
      { t: 'note', text: '다만 광고 관리자에는 구매가 없는데 실제 주문은 들어온다면, 성과 부진이 아니라 추적 오류일 수 있습니다. 아래 "측정 오류인지 확인하는 방법" 접기를 먼저 보세요.' },

      { t: 'h3', text: '증상별 빠른 진단' },
      { t: 'p', text: '아래에서 지금 보이는 증상을 고르면 해당 단계로 바로 이동합니다.' },
      { t: 'table', caption: '증상별 빠른 진단', head: ['지금 보이는 증상', '먼저 확인할 것', '이동'], rows: [
        ['노출 자체가 거의 없음', '캠페인 · 광고 세트 · 광고 상태, 심사, 결제수단, 예산, 타깃 범위', { text: '1단계로 이동', jump: 's1' }],
        ['노출은 있는데 클릭이 없음', '소재 첫 화면, 상품과 메시지의 일치, 혜택, 빈도', { text: '2단계로 이동', jump: 's2' }],
        ['클릭은 있는데 상품 페이지 도착이 적음', '잘못된 링크, 모바일 로딩, 페이지 오류, 픽셀', { text: '3단계로 이동', jump: 's3' }],
        ['방문은 있는데 장바구니가 없음', '가격 · 배송비 표시, 상품 설명, 후기, 옵션 복잡도', { text: '4단계로 이동', jump: 's4' }],
        ['결제 도중 이탈하거나 오류가 발생함', '결제 오류, 배송비 · 회원가입 · 쿠폰, 교환 · 반품 안내', { text: '5단계로 이동', jump: 's5' }],
        ['구매는 있지만 이익이 남지 않음', 'CPA, 변동비, 손익분기 ROAS', { text: '6단계로 이동', jump: 's6' }]
      ] },

      { t: 'h3', text: '진단 전에 지킬 원칙' },
      { t: 'list', items: [
        '한 번에 하나만 바꿉니다. 여러 개를 동시에 바꾸면 무엇 때문에 달라졌는지 알 수 없습니다.',
        '바꾸기 전 숫자와 바꾼 시각을 기록해 둡니다. 기준이 없으면 나아졌는지 알 수 없습니다.',
        '구매 수가 적을 때는 우연의 영향이 크므로, 데이터가 쌓이기 전에 성급히 성공이나 실패를 단정하지 않습니다. Meta 도움말도 지출과 성과가 하루 단위로 달라질 수 있다고 안내합니다.',
        '클릭은 있는데 구매로 이어지지 않을 때는 광고 소재만 계속 바꾸지 말고 상품 페이지와 가격도 함께 봅니다.',
        '광고 관리자 숫자와 실제 주문이 다르면, 성과를 판단하기 전에 추적 오류부터 확인합니다.'
      ] },
      { t: 'note', text: 'CTR(클릭이 노출로 이어지는 비율) · CPC(클릭 1회당 광고비) · CPA(구매 1건당 광고비) · ROAS(광고비 대비 매출 비율)에는 모든 상품에 통하는 합격선이 없습니다. 이전 기간, 같은 캠페인의 다른 소재, 내 손익분기점과 비교하세요.' },

      { t: 'step', num: 1, id: 's1', title: '노출 자체가 거의 없음', fields: [
        { label: '이 증상이 뜻하는 것', text: '광고 관리자에서 노출수가 0이거나 시간이 지나도 거의 늘지 않고, 지출도 거의 없습니다. 이 단계가 막혀 있으면 뒤에 나오는 클릭 · 구매 숫자는 아직 볼 필요가 없습니다.' },
        { label: '먼저 확인할 것', items: [
          '캠페인 · 광고 세트 · 광고가 모두 켜져 있는지',
          '심사가 끝났는지, 반려 사유는 없는지',
          '결제수단 오류나 예산 소진 알림이 있는지',
          '시작일 · 종료일과 타깃 범위가 너무 좁지 않은지'
        ] },
        { label: '이번에 바꿀 것', text: '반려 사유가 있다면 그 사유에 해당하는 부분만 고쳐 다시 제출합니다. 사유를 확인하지 않은 채 같은 소재를 반복 제출하지 않습니다.' },
        { label: '확인 완료 기준', text: '노출수가 다시 쌓이고 지출이 발생하면 다음 증상으로 넘어갑니다.' }
      ] },

      { t: 'step', num: 2, id: 's2', title: '노출은 있는데 클릭이 없음', fields: [
        { label: '이 증상이 뜻하는 것', text: '노출수는 쌓이는데 링크 클릭수와 CTR이 이전 기간이나 다른 소재보다 낮습니다. 사람들이 광고를 보고도 누를 이유를 못 찾았다는 뜻입니다.' },
        { label: '먼저 확인할 것', items: [
          'CTR을 이전 기간, 같은 캠페인의 다른 소재와 비교',
          '소재 첫 화면을 3초만 보고 상품 · 대상 · 혜택이 떠오르는지',
          '빈도(같은 사람에게 반복 노출되는 정도)가 올라가고 있는지',
          '광고 문구와 상품 페이지가 같은 약속을 하는지'
        ] },
        { label: '이번에 바꿀 것', text: '첫 화면, 첫 문장, 혜택 표현 중 하나만 다르게 한 소재를 추가하고 기존 소재는 끄지 않은 채 비교합니다.' },
        { label: '확인 완료 기준', text: '클릭이 이전 기간이나 다른 소재와 비교해 나빠 보이지 않으면 다음으로 넘어갑니다.' }
      ] },

      { t: 'step', num: 3, id: 's3', title: '클릭은 있는데 상품 페이지 도착이 적음', fields: [
        { label: '이 증상이 뜻하는 것', text: '링크 클릭수에 비해 랜딩페이지 조회수가 눈에 띄게 적습니다. 광고비를 내고 데려온 사람이 페이지에 닿기도 전에 사라진다는 뜻입니다.' },
        { label: '먼저 확인할 것', items: [
          '광고 링크를 휴대폰 모바일 데이터로 직접 눌러 열리는지',
          '링크가 품절 · 삭제된 페이지로 연결되지는 않는지',
          '모바일에서 로딩이 느리지 않은지',
          '픽셀 이벤트가 정상적으로 들어오는지'
        ] },
        { label: '이번에 바꿀 것', text: 'URL 오타나 연결 페이지를 고치거나, 큰 이미지 · 팝업을 줄여 모바일 로딩을 가볍게 하는 것 중 하나만 합니다.' },
        { label: '확인 완료 기준', text: '모바일에서 직접 눌렀을 때 페이지가 정상적으로 열리고 조회 비율이 이전 수준으로 돌아오면 다음으로 넘어갑니다.' }
      ] },

      { t: 'step', num: 4, id: 's4', title: '방문은 있는데 장바구니가 없음', fields: [
        { label: '이 증상이 뜻하는 것', text: '페이지를 보는 사람은 있는데 장바구니에 담는 횟수가 이전 기간보다 적습니다. 상품은 봤지만 살 마음까지는 안 생겼다는 뜻입니다.' },
        { label: '먼저 확인할 것', items: [
          '휴대폰 첫 화면에서 상품 · 가격 · 배송비 · 구매 이유가 스크롤 없이 보이는지',
          '광고와 페이지 첫 화면이 같은 약속을 하는지',
          '비슷한 상품과 가격 · 배송비를 비교했을 때 경쟁력이 있는지',
          '옵션 선택 단계가 너무 복잡하지 않은지'
        ] },
        { label: '이번에 바꿀 것', text: '배송비 · 배송기간을 상단에 표시하거나 옵션을 단순화하는 것 중 하나만 바꿉니다.' },
        { label: '확인 완료 기준', text: '장바구니 담기가 이전 기간 수준으로 회복되면 다음으로 넘어갑니다.' }
      ] },

      { t: 'step', num: 5, id: 's5', title: '결제 도중 이탈하거나 오류가 발생함', fields: [
        { label: '이 증상이 뜻하는 것', text: '장바구니(또는 결제 시작)에 비해 결제 완료가 적습니다. 살 마음까지는 생겼지만 결제 과정 어딘가에서 막혔다는 뜻입니다.' },
        { label: '먼저 확인할 것', items: [
          '휴대폰으로 담기부터 결제 직전까지 직접 해 보기(가능하면 소액 실제 주문)',
          '결제 오류 — 특정 결제수단이나 기기에서 결제가 실패하지 않는지',
          '회원가입을 강제하지 않는지, 쿠폰이 정상 적용되는지',
          '교환 · 반품 조건이 결제 화면 가까이에 보이는지'
        ] },
        { label: '이번에 바꿀 것', text: '배송비를 상품 페이지에서 미리 보여 주거나 비회원 주문을 허용하는 것 중 하나만 바꿉니다.' },
        { label: '확인 완료 기준', text: '테스트 주문이 처음부터 끝까지 성공하고 결제 완료 비율이 이전 수준으로 돌아오면 다음으로 넘어갑니다.' }
      ] },

      { t: 'step', num: 6, id: 's6', title: '구매는 있지만 이익이 남지 않음', fields: [
        { label: '이 증상이 뜻하는 것', text: '구매는 나오는데 광고비 차감 후 남는 공헌이익이 마이너스이거나 0원이거나, ROAS가 손익분기 ROAS보다 낮습니다. 앞 단계는 다 정상인데 정작 돈이 남지 않는 상태입니다.' },
        { label: '먼저 확인할 것', items: [
          'CPA가 주문 1건당 광고 전 공헌이익보다 크지 않은지',
          '배송비 · 수수료 · 반품 같은 변동비가 처음 계산보다 늘지 않았는지',
          '실제 판매가 · 변동비로 손익분기 ROAS를 다시 계산했을 때 지금 ROAS와 비교'
        ] },
        { label: '이번에 바꿀 것', text: '변동비가 늘었다면 가격 · 배송비 정책 · 쿠폰 조건 중 하나만 바꾸고, 원인이 클릭 이후 단계라면 그 단계부터 다시 개선합니다.' },
        { label: '확인 완료 기준', text: '실제 변동비로 다시 계산한 손익분기 ROAS와 광고비 차감 후 남는 공헌이익을 기록으로 비교할 수 있으면 완료입니다.' }
      ] },

      { t: 'collapse', summary: '측정 오류인지 확인하는 방법(광고 관리자 숫자와 실제 주문이 다를 때)', blocks: [
        { t: 'p', text: '광고 플랫폼, GA4, 쇼핑몰 주문 목록은 기여 기간 · 시간대 · 집계 기준이 서로 달라 숫자가 다를 수 있습니다.' },
        { t: 'list', items: [
          '같은 기간 · 같은 시간대 기준으로 광고 관리자 · GA4 · 쇼핑몰 실제 주문을 나란히 대조합니다.',
          '실제 주문(결제 완료)을 기준값으로 삼고, 테스트 · 취소 주문은 뺍니다.',
          '테스트 주문으로 구매 이벤트가 한 주문당 1번만 기록되는지 확인합니다.',
          'UTM 값의 대소문자와 철자가 일관되는지 확인합니다.'
        ] },
        { t: 'p', text: '차이의 이유를 설명할 수 있으면(기준 차이) 이익 판단은 실제 주문으로 하고, 설명되지 않는 큰 차이가 계속되면 성과를 판단하기 전에 이 설정부터 고칩니다.' }
      ] },

      { t: 'collapse', summary: '이익 단계 진단 계산 예시(가상)', blocks: [
        { t: 'table', caption: '변동비가 5,000원 늘어난 경우(가상 예시)', head: ['항목', '원래 예시', '변동비 +5,000원'], rows: [
          ['주문 1건당 광고비 제외 변동비', '30,000원', '35,000원'],
          ['주문 1건당 광고 전 공헌이익', '20,000원', '15,000원'],
          ['광고 전 공헌이익률', '40%', '30%'],
          ['손익분기 ROAS', '250%', '333.3%'],
          ['ROAS', '400%', '400%'],
          ['광고비 차감 후 남는 공헌이익', '60,000원', '20,000원']
        ] },
        { t: 'note', text: 'ROAS는 400%로 그대로여도 변동비가 늘면 남는 돈이 크게 줄어듭니다. ROAS만 보지 말고 손익분기 ROAS와 광고비 차감 후 남는 공헌이익을 함께 확인하세요.' }
      ] },

      { t: 'cta', label: '광고 숫자 읽는 법 보기', slug: 'ad-metrics' },
      { t: 'p', text: '날짜 · 채널 · 소재명 · 지출 · 전환 매출을 기록하면 ROAS를 자동으로 계산합니다.' },
      { t: 'cta', label: '광고 기록 남기기', href: '#/dashboard' },
      { t: 'sources', checkedAt: '2026년 9월', items: [
        { title: 'Meta 광고 관리자에서 광고 게재 문제 해결하기', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/236201204528536' },
        { title: '광고 성과 문제 해결하기', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/945693298836131' },
        { title: '광고 성과의 변동 이해하기', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/1364841787225722' },
        { title: '랜딩 페이지 조회', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/646884317670110' },
        { title: '링크 클릭과 랜딩 페이지 조회의 차이 이해', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/172641445757289' },
        { title: '일반적인 타사 보고 불일치 문제 해결', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/511923449323749' },
        { title: '기여 모델 및 기여 설정 정보', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/460276478298895' },
        { title: '빈도', org: 'Meta 비즈니스 지원 센터', url: 'https://www.facebook.com/business/help/1546570362238584' },
        { title: '[GA4] Minimize duplicate key events with transaction IDs', org: 'Google 애널리틱스 고객센터', url: 'https://support.google.com/analytics/answer/12313109' },
        { title: 'Monitor events in DebugView', org: 'Google 애널리틱스 고객센터', url: 'https://support.google.com/analytics/answer/7201382' },
        { title: 'URL 작성 도구: 맞춤 URL을 사용한 캠페인 데이터 수집', org: 'Google 애널리틱스 고객센터', url: 'https://support.google.com/analytics/answer/10917952' }
      ] }
    ] },
    'ad-creative-checklist': { intro: '소재를 올리기 전에 아래 7가지를 확인하세요.', blocks: [
      { t: 'checklist', items: ['첫 화면에서 상품이 바로 보이는가', '누구를 위한 상품인지 보이는가', '장점이 한 문장으로 이해되는가', '가격 또는 구매 이유가 명확한가', '실제 사용 장면이나 증거가 있는가', '모바일에서도 글자가 읽히는가', '행동 유도 문구가 있는가'] }
    ] },
    'meta-ads-start': { intro: '광고 관리자의 메뉴 위치나 화면 구성은 자주 바뀝니다. 이 가이드는 화면 위치 대신 바뀌지 않는 운영 원칙을 다룹니다.', blocks: [
      { t: 'list', items: ['전환 추적(픽셀 · 전환 API) 준비를 먼저 끝내기', '명확한 판매 목표(전환 · 트래픽 등) 하나를 선택하기', '첫 테스트에서 변수(소재 · 타깃 · 문구)를 한 번에 너무 많이 나누지 않기', '소재별로 결과를 구분해서 확인하기', '데이터가 충분히 쌓이기 전에 성급하게 예산을 늘리거나 중단하지 않기', '소재 · 예산 · 결과를 광고 기록에 남기기'] },
      { t: 'note', text: '광고 관리자의 메뉴 위치와 심사 기준은 변경될 수 있으므로, 진행 전 Meta 공식 고객센터 · 광고 관리자 도움말을 함께 확인해주세요.' },
      { t: 'cta', label: '광고 기록 남기기', href: '#/dashboard' }
    ] },
    'naver-shopping-ads-start': { intro: '클릭률만 보지 말고 실제 주문과 이익까지 함께 확인하세요.', blocks: [
      { t: 'list', items: ['상품명과 카테고리가 정확한지 확인하기', '대표 이미지와 가격 경쟁력 확인하기', '배송비까지 포함한 최종 가격 기준으로 비교하기', '상품 정보 품질(옵션 · 상세정보 누락 여부) 확인하기', '클릭 후 연결되는 상세페이지가 정확한지 확인하기'] },
      { t: 'note', text: '클릭이 많아도 주문 · 이익으로 이어지지 않으면 소재가 아니라 상품 페이지나 가격을 먼저 점검해야 할 수 있습니다.' },
      { t: 'note', text: '등록 기준과 심사 정책은 변경될 수 있으므로, 진행 전 네이버 쇼핑광고 공식 안내를 함께 확인해주세요.' },
      { t: 'cta', label: '마진 확인하기', href: '#/tools', toolsTarget: 'calc' }
    ] },
    'ga4-pixel-utm': { intro: '세 가지는 서로 다른 것을 측정하는 도구입니다. 무엇이 무엇을 재는지부터 구분하세요.', blocks: [
      { t: 'list', items: ['GA4 — 내 쇼핑몰 방문자의 행동(페이지 조회 · 구매 등)을 측정', 'Meta 픽셀 — Meta(페이스북 · 인스타그램) 광고를 통해 들어온 방문자의 행동과 전환을 측정', 'UTM — 어떤 링크 · 채널을 통해 유입됐는지 구분하는 URL 꼬리표'] },
      { t: 'note', text: '설치는 한 번만 하면 되지만 해석은 매번 같은 기간 · 같은 전환 기준으로 비교해야 정확합니다. GA4 · 광고 관리자 · 쇼핑몰 자체 주문 수가 서로 완전히 같은 숫자로 일치하지 않을 수 있습니다 — 집계 방식과 시점 차이 때문이며 정상적인 범위의 오차입니다. 채널별 성과를 비교할 때는 UTM으로 유입 경로를 구분해두어야 나중에 어떤 채널이 효과적인지 알 수 있습니다.' },
      { t: 'h3', text: '보조 가이드 · 메타 픽셀 연동(카페24 기준 예시)' },
      { t: 'numbered', items: ['인스타그램 앱 → 프로필 편집 → 페이지 → 페이스북 페이지 연결', '메타 비즈니스 스위트 → 비즈니스 설정 → 계정 → 광고 계정 새로 생성(이름 · 시간대 · 통화 원화)', '비즈니스 설정 → 데이터 소스 → 데이터 세트 → 픽셀 생성', '카페24 → 설정 → 기본 설정 → 고급설정 → 코드 직접 입력(PC · 모바일 쇼핑몰 모두)', '카페24 → 판매채널 → 페이스북 → 채널 탭 → 설정하기 → 불러와진 항목 승인'] },
      { t: 'note', text: '메뉴 위치와 심사 기준은 변경될 수 있으므로 신청 전 공식 안내를 함께 확인해주세요.' },
      { t: 'cta', label: '광고 기록 · 성과 확인하기', href: '#/dashboard' }
    ] }
  };

  function getResource(slug){ return RESOURCE_BY_SLUG[slug] || null; }
  function getGuide(slug){ return GUIDES[slug] || null; }
  function titleForSlug(slug){
    var r = getResource(slug);
    return r ? r.title : null;
  }

  // 가이드/체크리스트 본문(있는 경우)에서 검색 가능한 텍스트만 뽑아 이어붙인다.
  // GUIDES 블록 구조(t: p/h3/list/numbered/checklist/formula/note/cta/step/table/
  // sources)를 그대로 따라가며 사람이 읽는 문자열만 모은다 — href · slug · url · id
  // 같은 식별자는 검색 대상이 아니므로 담지 않는다. step 필드 안에 중첩된 blocks도
  // 끝까지 따라간다.
  function collectBlockText(b, parts){
    ['text', 'label', 'title', 'caption'].forEach(function(k){ if(b[k]) parts.push(b[k]); });
    (b.items || []).forEach(function(item){
      if(typeof item === 'string'){ parts.push(item); return; }
      if(item && typeof item === 'object'){
        ['term', 'formula', 'desc', 'example', 'check', 'title', 'org'].forEach(function(k){ if(item[k]) parts.push(item[k]); });
      }
    });
    (b.fields || []).forEach(function(f){
      parts.push(f.label);
      if(f.text) parts.push(f.text);
      (f.items || []).forEach(function(i){ parts.push(i); });
      (f.blocks || []).forEach(function(nb){ collectBlockText(nb, parts); });
    });
    (b.head || []).forEach(function(h){ parts.push(h); });
    (b.rows || []).forEach(function(r){
      r.forEach(function(c){ parts.push(typeof c === 'string' ? c : c.text); });
    });
    // collapse(접기) 블록 — 접혀 있어도 검색 대상에서는 빠지면 안 되므로 안의
    // blocks도 끝까지 따라간다(step의 fields[].blocks와 같은 이유).
    (b.blocks || []).forEach(function(nb){ collectBlockText(nb, parts); });
  }
  function guideSearchText(slug){
    var guide = GUIDES[slug];
    if(!guide) return '';
    var parts = [guide.intro || ''];
    (guide.blocks || []).forEach(function(b){ collectBlockText(b, parts); });
    return parts.join(' ');
  }

  // 검색 대상: 제목 · 요약 · 태그 · 카테고리명 · 자료유형명 · 내부 가이드
  // 본문(요구사항). 검색어를 공백 기준으로 토큰화해, 토큰이 전부(각각
  // 어디에 있든) 포함돼야 매칭되는 AND 검색 — "반품 정책"처럼 한 자료 안에
  // 두 단어가 서로 다른 위치(제목 vs 본문)에 있어도 찾아낸다. 영문은
  // toLowerCase()로 대소문자를 구분하지 않고, 연속 공백·앞뒤 공백은
  // split(/\s+/)와 trim()이 함께 처리한다.
  function queryTokens(query){
    return (query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function matchesQuery(resource, query){
    var tokens = queryTokens(query);
    if(tokens.length === 0) return true;
    var haystack = [
      resource.title,
      resource.summary,
      CATEGORY_LABEL[resource.category] || '',
      TYPE_LABEL[resource.type] || ''
    ].concat(resource.tags || [], [guideSearchText(resource.slug)]).join(' ').toLowerCase();
    return tokens.every(function(t){ return haystack.indexOf(t) !== -1; });
  }

  /* ------------------------------------------------------------ GA4 payload
     이 4개 함수가 실제로 gtag('event', name, ...)에 들어갈 payload 전체를
     만든다 — resources.js는 이 함수들을 호출하기만 하고 필드를 직접
     조립하지 않는다(개인정보 누락 방지를 한 곳에서 강제). 검색어 원문 ·
     제목 원문 · 전체 URL · 쿼리스트링은 그 어떤 payload에도 넣지 않는다. */
  function buildSearchPayload(query, resultCount, selectedCategory){
    return {
      query_length: (query || '').trim().length,
      result_count: resultCount,
      selected_category: selectedCategory
    };
  }
  function buildFilterPayload(category){
    return { category: category };
  }
  function buildOpenPayload(resourceSlug, resourceType, resourceCategory){
    return {
      resource_slug: resourceSlug,
      resource_type: resourceType,
      resource_category: resourceCategory
    };
  }
  function buildExternalClickPayload(resourceSlug, destinationHost){
    return {
      resource_slug: resourceSlug,
      destination_host: destinationHost
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    CATEGORY_LABEL: CATEGORY_LABEL,
    TYPES: TYPES,
    TYPE_LABEL: TYPE_LABEL,
    STUCK_CARDS: STUCK_CARDS,
    FEATURED_SLUGS: FEATURED_SLUGS,
    LEGACY_CATEGORY_MAP: LEGACY_CATEGORY_MAP,
    RESOURCES: RESOURCES,
    GUIDES: GUIDES,
    mapLegacyCategory: mapLegacyCategory,
    getResource: getResource,
    getGuide: getGuide,
    guideSearchText: guideSearchText,
    titleForSlug: titleForSlug,
    matchesQuery: matchesQuery,
    buildSearchPayload: buildSearchPayload,
    buildFilterPayload: buildFilterPayload,
    buildOpenPayload: buildOpenPayload,
    buildExternalClickPayload: buildExternalClickPayload
  };
});
