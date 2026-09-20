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
     블록 타입: p / h3 / list / numbered / checklist / formula / note / cta.
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

    'ad-before-start': { intro: '광고를 켜기 전에 아래 7가지를 먼저 확인하세요. 광고는 상품 · 페이지 · 추적이 준비된 뒤에 효과가 있습니다.', blocks: [
      { t: 'checklist', items: ['상품별 실제 마진 확인', '감당 가능한 주문당 광고비 확인', '구매 전환 추적 확인', '모바일 상품 페이지 확인', '가격 · 배송비 · 교환 조건 표시 확인', '재고 · 배송 처리 가능 여부 확인', '이번 광고에서 확인할 목표 하나 결정'] },
      { t: 'cta', label: '마진부터 확인하기', href: '#/tools', toolsTarget: 'calc' }
    ] },
    'ad-metrics': { intro: '광고 지표는 서로 연결되어 있습니다. 하나만 보고 좋다 · 나쁘다 판단하지 말고 순서대로 확인하세요.', blocks: [
      { t: 'formula', items: [
        { term: 'CTR (클릭률)', formula: '클릭수 ÷ 노출수 × 100', desc: '소재가 눈에 띄는지 보여주는 지표' },
        { term: 'CPC (클릭당비용)', formula: '광고비 ÷ 클릭수', desc: '클릭 하나를 얻는 데 든 비용' },
        { term: 'CVR (전환율)', formula: '주문수 ÷ 클릭수 × 100', desc: '들어온 사람이 실제 구매로 이어지는 비율' },
        { term: 'CPA (전환당비용)', formula: '광고비 ÷ 주문수', desc: '주문 하나를 만드는 데 든 광고비' },
        { term: 'ROAS (광고수익률)', formula: '광고 매출 ÷ 광고비 × 100', desc: '광고비 대비 매출 비율' },
        { term: '광고 전 공헌이익률', formula: '(판매가 − 상품원가 − 판매수수료 − 실제 배송비 − 포장비 − 할인 등 광고비를 제외한 변동비) ÷ 판매가', desc: '광고비를 쓰기 전, 상품 1개를 팔았을 때 남는 비율' },
        { term: '손익분기 ROAS', formula: '100 ÷ 광고 전 공헌이익률(소수) · 예: 공헌이익률 0.4 → 100 ÷ 0.4 = 250%', desc: '광고비까지 포함했을 때 손익이 0원이 되는 경계선' }
      ] },
      { t: 'note', text: 'ROAS만 높다고 이익이 난다는 뜻은 아닙니다. ROAS는 "매출" 기준이라 원가 · 수수료 · 배송비 · 반품비를 반영하지 않습니다. 실제 이익은 ROAS가 손익분기 ROAS를 넘는지로 판단하세요 — 손익분기 ROAS는 공헌이익률에 따라 상품마다 다릅니다.' },
      { t: 'note', text: '위 예시의 손익분기 ROAS 250%는 이익이 많이 남는 기준이 아니라, 광고비까지 포함했을 때 손익이 정확히 0원이 되는 경계라는 뜻입니다. 공헌이익률을 퍼센트 숫자로 계산할 때는 10,000 ÷ 공헌이익률(%)로 구해도 같은 값이 나옵니다 — 예: 40 → 10,000 ÷ 40 = 250%. 세금, 반품, 쿠폰 분담금, 예상하지 못한 비용이 있다면 실제로 필요한 ROAS는 이 기준보다 더 높아질 수 있습니다.' },
      { t: 'cta', label: '내 상품의 손익분기 ROAS 확인하기', href: '#/tools', toolsTarget: 'calc' }
    ] },
    'ad-troubleshoot': { intro: '지금 상황과 가장 가까운 항목부터 순서대로 점검하세요.', blocks: [
      { t: 'formula', items: [
        { term: '노출이 부족함', formula: '', desc: '예산 · 승인 · 타깃 · 게재 상태 확인' },
        { term: 'CTR이 낮음', formula: '', desc: '소재 첫 화면 · 상품 장점 · 문구 확인' },
        { term: 'CPC가 높음', formula: '', desc: '소재 반응과 타깃 범위 확인' },
        { term: '클릭은 나오지만 주문이 없음', formula: '', desc: '상품 페이지 · 가격 · 신뢰 요소 · 배송 조건 확인' },
        { term: 'ROAS는 높지만 이익이 없음', formula: '', desc: '원가 · 수수료 · 배송비 · 할인 · 반품비 확인' }
      ] },
      { t: 'note', text: '고정된 업계 평균 수치는 이 가이드에서 다루지 않습니다. 상품 · 업종마다 기준이 크게 달라 "몇 퍼센트면 무조건 좋다"는 기준은 없습니다.' },
      { t: 'cta', label: '광고 기록에서 소재별 결과 비교하기', href: '#/dashboard' }
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
  // GUIDES 블록 구조(t: p/h3/list/numbered/checklist/formula/note/cta)를 그대로
  // 따라가며 사람이 읽는 문자열만 모은다 — href · slug 같은 식별자는 검색
  // 대상이 아니므로 담지 않는다.
  function guideSearchText(slug){
    var guide = GUIDES[slug];
    if(!guide) return '';
    var parts = [guide.intro || ''];
    (guide.blocks || []).forEach(function(b){
      if(b.text) parts.push(b.text);
      if(b.label) parts.push(b.label);
      if(b.items){
        b.items.forEach(function(item){
          if(typeof item === 'string'){ parts.push(item); return; }
          if(item && typeof item === 'object'){
            if(item.term) parts.push(item.term);
            if(item.formula) parts.push(item.formula);
            if(item.desc) parts.push(item.desc);
          }
        });
      }
    });
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
    titleForSlug: titleForSlug,
    matchesQuery: matchesQuery,
    buildSearchPayload: buildSearchPayload,
    buildFilterPayload: buildFilterPayload,
    buildOpenPayload: buildOpenPayload,
    buildExternalClickPayload: buildExternalClickPayload
  };
});
