/* 자료실(#/resources) 화면 — wholesalers.js/ops-overview.js와 같은 스타일의
   독립 모듈(최상위 IIFE, 자기 화면의 DOM을 직접 쿼리/렌더링, app.js
   라우터는 BUILT 등록 한 줄만 건드리고 그 이상은 건드리지 않음). 데이터는
   전부 resources-data.js(window.launchdeskResourcesData)에서 읽는다 — 이
   파일은 렌더링과 상호작용만 담당한다.

   라우팅: 이 파일이 app.js의 render()를 기다리지 않고 스스로 현재
   location.hash를 읽어 최초 1회 그리고, 그 뒤로는 자기 hashchange
   리스너로 계속 동기화한다(wholesalers.js의 loadWholesalers() 패턴과
   동일) — app.js는 BUILT['/resources']에 더해 "/resources/로 시작하는
   경로도 view-resources를 보여준다"는 1줄만 알면 된다(app.js 참고).
   이렇게 하면 스크립트 로드 순서(이 파일이 app.js보다 나중에 실행됨)에
   영향받지 않고, #/resources/<slug> 직접 진입 · 새로고침 · 뒤로가기가
   전부 자연스러운 해시 라우팅만으로 동작한다(별도 history 처리 불필요).

   옛 딥링크 호환: STEP02~07의 [data-resource-cat] 링크는 예전 6개
   카테고리 ID를 그대로 보낸다. 이 파일이 문서 전체에 자기 클릭 리스너를
   하나 더 달아 그 값을 기억해뒀다가, /resources(또는 /resources/*)에
   도착하는 순간 mapLegacyCategory()로 새 카테고리로 바꿔 적용한다 —
   app.js의 옛 pendingResourceFilter 변수는 더 이상 쓰지 않는다(제거됨,
   app.js 주석 참고). */
(function(){
  var DATA = window.launchdeskResourcesData;
  if(!DATA) return; // resources-data.js가 없으면 조용히 빠진다(방어적 가드)

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = document.getElementById('view-resources');
  var indexEl = document.getElementById('resIndex');
  var panelEl = document.getElementById('resGuidePanel');
  var searchInput = document.getElementById('resSearch');
  var stuckGrid = document.getElementById('resStuckGrid');
  var featuredWrap = document.getElementById('resFeaturedWrap');
  var featuredGrid = document.getElementById('resFeaturedGrid');
  var catTabsEl = document.getElementById('resCatTabs');
  var gridEl = document.getElementById('resGrid');
  var externalWrap = document.getElementById('resExternalWrap');
  var externalGrid = document.getElementById('resExternalGrid');
  var emptyStateEl = document.getElementById('resEmptyState');
  var emptyResetBtn = document.getElementById('resEmptyReset');
  var panelBody = document.getElementById('resGuidePanelBody');
  var panelClose = document.getElementById('resGuidePanelClose');
  var panelBack = document.getElementById('resGuidePanelBack');
  var resultStatusEl = document.getElementById('resResultStatus');
  if(!root || !indexEl || !panelEl || !gridEl || !catTabsEl){ return; }

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }

  // 카테고리별 아이콘 — 새 이미지 에셋을 만들지 않고, 이 앱에 이미 있는
  // 인라인 SVG 아이콘 스타일(stroke 1.5, viewBox 0 0 18 18)을 그대로
  // 재사용한다. start/product/growth 3개는 각각 기존 s3-service-icon(도매처
  // 찾기의 시장 아이콘)·마진 계산기 CTA 아이콘·차트 아이콘 path를 그대로
  // 가져왔고, operation(배송) 하나만 같은 스타일로 새로 그렸다.
  var CATEGORY_ICON_PATHS = {
    start: '<path d="M2 7h14M2 7l1.5-4h11L16 7M2 7v8h14V7"/><path d="M6 15v-4h6v4"/><path d="M2 7a3 3 0 0 0 6 0M8 7a3 3 0 0 0 6 0"/>',
    product: '<rect x="3" y="2" width="12" height="14" rx="2"/><rect x="5.5" y="4" width="7" height="3" rx="0.5"/><circle cx="5.5" cy="10" r="0.7" fill="currentColor" stroke="none"/><circle cx="9" cy="10" r="0.7" fill="currentColor" stroke="none"/><circle cx="12.5" cy="10" r="0.7" fill="currentColor" stroke="none"/><circle cx="5.5" cy="13" r="0.7" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="0.7" fill="currentColor" stroke="none"/><circle cx="12.5" cy="13" r="0.7" fill="currentColor" stroke="none"/>',
    operation: '<rect x="1.5" y="5.5" width="8" height="6.5" rx="1"/><path d="M9.5 8.5h3.1L15 10.6V12h-5.5V8.5Z"/><circle cx="4.5" cy="14" r="1.4"/><circle cx="12.5" cy="14" r="1.4"/><line x1="6" y1="14" x2="11" y2="14"/>',
    growth: '<rect x="2" y="3" width="14" height="10" rx="1.5"/><polyline points="5,10 8,7 10.5,9.5 13,6"/><line x1="7" y1="16" x2="11" y2="16"/>'
  };
  function categoryIcon(cat, cls){
    var path = CATEGORY_ICON_PATHS[cat];
    if(!path) return '';
    return '<svg class="' + cls + '" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  // payload는 이 파일이 직접 조립하지 않는다 — resources-data.js의
  // buildSearchPayload/buildFilterPayload/buildOpenPayload/
  // buildExternalClickPayload가 4개 이벤트의 최종 payload를 전부 만들고,
  // 그 필드 구성(개인정보 미포함 포함)은 tests/resources-data.test.js가
  // 고정한다 — 이 파일은 만들어진 payload를 gtag에 넘기기만 한다.
  function gaEvent(name, params){
    // 기존 app.js/tools.js와 동일한 가드 — analytics-consent.js가 동의 전엔
    // window.gtag 자체를 정의하지 않으므로, 동의 전에는 이 호출이 전부
    // 조용히 no-op된다(우회 없음).
    if(typeof gtag === 'function'){ gtag('event', name, params || {}); }
  }

  // ------------------------------------------------------------- 상태
  var state = { category: 'all', query: '' };
  var pendingLegacyCategory = null; // STEP02~07 딥링크가 남겨둔 옛 카테고리(변환 전)

  function currentPath(){
    return location.hash.replace(/^#/, '') || '/';
  }
  function isResourcesRoute(path){
    return path === '/resources' || path.indexOf('/resources/') === 0;
  }
  function slugFromPath(path){
    return path.indexOf('/resources/') === 0 ? path.slice('/resources/'.length) : null;
  }

  // ------------------------------------------------------------- 카테고리 탭(정적 마크업, 클릭만 위임)
  catTabsEl.addEventListener('click', function(e){
    var btn = e.target.closest('.res-cat-tab');
    if(!btn) return;
    setCategory(btn.getAttribute('data-cat'), true);
  });

  function setCategory(cat, userInitiated){
    state.category = cat;
    catTabsEl.querySelectorAll('.res-cat-tab').forEach(function(b){
      var isActive = b.getAttribute('data-cat') === cat;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false'); // 시각(active) 외에 상태 속성도 유지
    });
    renderGrid();
    if(userInitiated) gaEvent('resource_filter', DATA.buildFilterPayload(cat));
  }

  // ------------------------------------------------------------- "지금 무엇이 막혔나요?"
  if(stuckGrid){
    stuckGrid.innerHTML = DATA.STUCK_CARDS.map(function(c){
      var label = DATA.CATEGORY_LABEL[c.category] || c.category;
      return '<button type="button" class="res-stuck-card" data-cat="' + escapeHtml(c.category) + '">' +
        '<span class="res-stuck-icon">' + categoryIcon(c.category, 'res-stuck-icon-svg') + '</span>' +
        '<span class="res-stuck-text"><span class="res-stuck-title">' + escapeHtml(label) + '</span>' +
        (c.keywords ? '<span class="res-stuck-keywords">' + escapeHtml(c.keywords) + '</span>' : '') +
        '</span>' +
        '<svg class="res-stuck-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="8" x2="13" y2="8"/><polyline points="9,4 13,8 9,12"/></svg>' +
        '</button>';
    }).join('');
    stuckGrid.addEventListener('click', function(e){
      var btn = e.target.closest('.res-stuck-card');
      if(!btn) return;
      var cat = btn.getAttribute('data-cat');
      searchInput.value = '';
      state.query = '';
      setCategory(cat, true);
      gridEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }

  // ------------------------------------------------------------- "처음이라면 여기부터"
  if(featuredGrid){
    featuredGrid.innerHTML = DATA.FEATURED_SLUGS.map(function(slug){
      var r = DATA.getResource(slug);
      if(!r) return '';
      return cardHtml(r);
    }).join('');
  }

  // ------------------------------------------------------------- 카드 렌더링
  function typeBadge(type){
    return '<span class="res-badge res-badge-' + escapeHtml(type) + '">' + escapeHtml(DATA.TYPE_LABEL[type] || type) + '</span>';
  }

  // 카드 전체를 하나의 <a>로 만든다(요구사항: 카드 전체가 클릭 가능해야
  // 함) — 안에 별도 링크를 두 번 넣는 대신(중첩 링크는 접근성 위반) 카드
  // 자체가 유일한 포커스 대상이자 유일한 링크가 되도록 한다. 어디로
  // 이동하는지(내부 가이드/도구/외부 사이트)에 따른 href·target·rel·
  // data-res-open/data-res-external 부여 로직은 기존과 동일 — 태그만
  // div→a로 바뀌었을 뿐, click 위임(e.target.closest(...))은 그대로 잡는다.
  function cardHtml(r){
    var isExternalNav = r.type === 'external' || r.type === 'template';
    var attrs = ' class="res-card" data-cat="' + escapeHtml(r.category) + '"';
    var actionLabel, actionGlyph;
    if(r.type === 'guide' || r.type === 'checklist'){
      attrs += ' href="#/resources/' + encodeURIComponent(r.slug) + '" data-res-open="' + escapeHtml(r.slug) + '"';
      actionLabel = '가이드 보기'; actionGlyph = '→';
    } else if(isExternalNav){
      attrs += ' href="' + escapeHtml(r.href) + '" target="_blank" rel="noopener noreferrer" data-res-external="' + escapeHtml(r.slug) + '"';
      actionLabel = '바로가기'; actionGlyph = '↗';
    } else { // tool
      attrs += ' href="' + escapeHtml(r.href) + '"' + (r.toolsTarget ? ' data-tools-target="' + escapeHtml(r.toolsTarget) + '"' : '') + ' data-res-open="' + escapeHtml(r.slug) + '"';
      actionLabel = '계산기 열기'; actionGlyph = '→';
    }
    return '<a' + attrs + '>' +
      '<div class="res-card-top">' + typeBadge(r.type) + categoryIcon(r.category, 'res-card-icon') + '</div>' +
      '<h3>' + escapeHtml(r.title) + '</h3>' +
      '<p>' + escapeHtml(r.summary) + '</p>' +
      '<span class="res-card-action">' + escapeHtml(actionLabel) + ' ' + actionGlyph + '</span>' +
      '</a>';
  }

  function filteredResources(){
    return DATA.RESOURCES.filter(function(r){
      var catOk = state.category === 'all' || r.category === state.category;
      return catOk && DATA.matchesQuery(r, state.query);
    });
  }

  function renderGrid(){
    var isSearching = state.query.trim() !== '';
    if(stuckGrid) stuckGrid.closest('.res-stuck-section').hidden = isSearching;
    if(featuredWrap) featuredWrap.hidden = isSearching;

    var items = filteredResources();
    var internalItems = items.filter(function(r){ return r.type !== 'external'; });
    var externalItems = items.filter(function(r){ return r.type === 'external'; });

    gridEl.innerHTML = internalItems.map(cardHtml).join('');
    gridEl.hidden = internalItems.length === 0;

    if(externalWrap){
      externalWrap.hidden = externalItems.length === 0;
      externalGrid.innerHTML = externalItems.map(cardHtml).join('');
    }

    var totalCount = internalItems.length + externalItems.length;
    var anyResult = totalCount > 0;
    if(emptyStateEl) emptyStateEl.hidden = anyResult;
    // 화면에 보이는 빈 상태 문구와 별개로, 검색·필터가 바뀔 때마다 결과
    // 개수를 스크린리더에도 알린다(요구사항) — 시각적으로는 숨겨진
    // role="status" 영역이라 레이아웃에는 영향이 없다.
    if(resultStatusEl){
      resultStatusEl.textContent = anyResult ? (totalCount + '개 자료가 있어요.') : '조건에 맞는 자료가 없어요.';
    }
  }

  // ------------------------------------------------------------- 검색
  // resource_search에는 검색어 원문을 절대 담지 않는다 — query_length(길이)·
  // result_count·selected_category만 보낸다. 500ms 디바운스로 타이핑
  // 중 매 키 입력마다 이벤트가 쌓이지 않게 하고, 입력을 전부 지운
  // 상태(빈 검색어)는 "검색 시도"로 보지 않아 이벤트를 보내지 않는다.
  var searchDebounce = null;
  if(searchInput){
    searchInput.addEventListener('input', function(){
      state.query = searchInput.value;
      renderGrid();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function(){
        if(!state.query.trim()) return;
        gaEvent('resource_search', DATA.buildSearchPayload(state.query, filteredResources().length, state.category));
      }, 500);
      // 검색어가 있으면 카테고리 스코프를 유지한 채로도 전체 자료를
      // 훑을 수 있게, "전체" 탭으로 강제 전환하지는 않는다 — 카테고리 +
      // 검색어는 함께 적용된다(둘 다 AND 조건, filteredResources() 참고).
    });
  }
  if(emptyResetBtn){
    emptyResetBtn.addEventListener('click', function(){
      state.query = '';
      if(searchInput) searchInput.value = '';
      setCategory('all', false);
    });
  }

  // ------------------------------------------------------------- 옛 카테고리 딥링크(data-resource-cat)
  document.addEventListener('click', function(e){
    var link = e.target.closest('[data-resource-cat]');
    if(!link) return;
    pendingLegacyCategory = link.getAttribute('data-resource-cat');
  });

  // ------------------------------------------------------------- 가이드 상세 패널
  // "항목명 — 설명" 형태의 목록 항목은 항목명만 굵게 해 항목별로 눈에 띄게 한다(문장은 그대로).
  function itemLeadHtml(text){
    var k = text.indexOf(' — ');
    if(k <= 0 || k > 30) return escapeHtml(text);
    return '<strong class="res-item-lead">' + escapeHtml(text.slice(0, k)) + '</strong> — ' + escapeHtml(text.slice(k + 3));
  }
  function blockHtml(b){
    switch(b.t){
      case 'p': return '<p class="res-panel-p">' + escapeHtml(b.text) + '</p>';
      case 'h3': return '<h3 class="res-panel-h3">' + escapeHtml(b.text) + '</h3>';
      case 'list': return '<ul class="res-panel-list">' + b.items.map(function(i){ return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>';
      case 'numbered': return '<ol class="res-panel-numbered">' + b.items.map(function(i){ return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ol>';
      case 'checklist': return '<ul class="res-checklist">' + b.items.map(function(i, idx){
        return '<li><button type="button" class="res-check-item" data-check-idx="' + idx + '"><span class="res-check-box" aria-hidden="true"></span><span>' + escapeHtml(i) + '</span></button></li>';
      }).join('') + '</ul>';
      // 시각 흐름(flow) — 순서가 있는 준비/측정 단계를 화면에 3~5개 이어지는 카드로 보여준다.
      // <ol>을 써서 스크린리더가 항목 개수·순서를 그대로 읽는다(시각 번호는 CSS counter로만 그림).
      case 'flow': return '<ol class="res-flow"' + (b.label ? ' aria-label="' + escapeHtml(b.label) + '"' : '') + '>' + b.items.map(function(i){
        return '<li class="res-flow-step"><span class="res-flow-title">' + escapeHtml(i.title) + '</span>' +
          (i.desc ? '<span class="res-flow-desc">' + escapeHtml(i.desc) + '</span>' : '') + '</li>';
      }).join('') + '</ol>';
      // 숫자 요약(metric-summary) — 공헌이익 계산을 "판매가 − 변동비 = 남는 돈" 흐름 카드 +
      // 핵심 결과(공헌이익률 · 손익분기 ROAS · 주문당 광고비 한도) 통계 카드로 보여준다.
      case 'metric-summary':
        var msChain = b.items.filter(function(i){ return i.role === 'chain' || i.role === 'result'; });
        var msStats = b.items.filter(function(i){ return i.role === 'stat'; });
        return '<div class="res-metric-summary">' +
          '<div class="res-metric-chain">' + msChain.map(function(i, idx){
            return (idx > 0 ? '<span class="res-metric-op" aria-hidden="true">' + escapeHtml(i.op || '') + '</span>' : '') +
              '<div class="res-metric-chip' + (i.role === 'result' ? ' res-metric-chip-result' : '') + '">' +
              '<span class="res-metric-term">' + escapeHtml(i.term) + '</span>' +
              '<span class="res-metric-value">' + escapeHtml(i.desc) + '</span></div>';
          }).join('') + '</div>' +
          '<div class="res-metric-stats">' + msStats.map(function(i){
            return '<div class="res-metric-stat"><span class="res-metric-term">' + escapeHtml(i.term) + '</span>' +
              '<span class="res-metric-value">' + escapeHtml(i.desc) + '</span></div>';
          }).join('') + '</div></div>';
      case 'formula': return '<div class="res-formula-list">' + b.items.map(function(i){
        return '<div class="res-formula-row"><div class="res-formula-term">' + escapeHtml(i.term) + '</div>' +
          (i.formula ? '<div class="res-formula-expr">' + escapeHtml(i.formula) + '</div>' : '') +
          '<div class="res-formula-desc">' + escapeHtml(i.desc) + '</div>' +
          (i.example ? '<div class="res-formula-line"><span class="res-formula-tag">예시</span>' + escapeHtml(i.example) + '</div>' : '') +
          (i.check ? '<div class="res-formula-line"><span class="res-formula-tag">먼저 확인</span>' + escapeHtml(i.check) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
      // 단계 카드 — fields[].blocks에 표 · 공식 · CTA 같은 블록을 중첩할 수 있다.
      // id가 있으면 표의 jump 버튼이 이 카드로 스크롤한다(해시를 바꾸지 않는다).
      case 'step': return '<section class="res-step"' + (b.id ? ' id="res-anchor-' + escapeHtml(b.id) + '" tabindex="-1"' : '') + '>' +
        '<div class="res-step-head">' + (b.num ? '<span class="res-step-num">' + escapeHtml(b.num) + '</span>' : '') +
        '<h3 class="res-step-title">' + escapeHtml(b.title) + '</h3></div>' +
        '<dl class="res-step-fields">' + b.fields.map(function(f){
          return '<div class="res-step-field"><dt>' + escapeHtml(f.label) + '</dt><dd>' +
            (f.text ? '<p class="res-panel-p">' + escapeHtml(f.text) + '</p>' : '') +
            (f.items ? '<ul class="res-panel-list">' + f.items.map(function(i){ return '<li>' + itemLeadHtml(i) + '</li>'; }).join('') + '</ul>' : '') +
            (f.blocks ? f.blocks.map(blockHtml).join('') : '') +
            '</dd></div>';
        }).join('') + '</dl></section>';
      // 표 — 첫 열은 행 머리글(th scope=row), 나머지 셀에 data-label을 달아 좁은 화면에서
      // "열 이름: 값" 카드로 바꿔 보여준다(가로 스크롤 없이). 셀이 { text, jump }면
      // 같은 가이드의 step으로 이동하는 버튼이다.
      case 'table': return '<div class="res-table-wrap"><table class="res-table">' +
        (b.caption ? '<caption>' + escapeHtml(b.caption) + '</caption>' : '') +
        '<thead><tr>' + b.head.map(function(h){ return '<th scope="col">' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        b.rows.map(function(r){
          return '<tr>' + r.map(function(c, ci){
            var inner = (c && typeof c === 'object' && c.jump)
              ? '<button type="button" class="res-jump" data-res-jump="' + escapeHtml(c.jump) + '">' + escapeHtml(c.text) + '</button>'
              : escapeHtml(c && typeof c === 'object' ? c.text : c);
            return ci === 0 ? '<th scope="row">' + inner + '</th>' : '<td data-label="' + escapeHtml(b.head[ci]) + '">' + inner + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
      // 참고한 공식 자료 — 일반 외부 링크다. 카드의 data-res-external과 달리 GA4 이벤트를
      // 만들지 않는다(resource_external_click은 자료실 카드 전용 그대로). 링크가 여러 개라
      // 본문 아래가 길어 보이지 않도록 네이티브 details/summary로 접어 둔다(기본 닫힘,
      // 키보드 Enter/Space로 여닫기는 브라우저가 기본 제공 — 별도 JS 불필요).
      case 'sources': return '<details class="res-sources"><summary class="res-sources-summary">참고한 공식 자료 ' +
        b.items.length + '개 · ' + escapeHtml(b.checkedAt) + ' 확인</summary>' +
        '<ul class="res-sources-list">' + b.items.map(function(i){
          return '<li><a class="res-source-link" href="' + escapeHtml(i.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(i.title) + '</a>' +
            '<span class="res-source-org">' + escapeHtml(i.org) + '</span>' +
            '<span class="res-source-url">' + escapeHtml(i.url) + '</span></li>';
        }).join('') + '</ul></details>';
      case 'note': return '<div class="res-note"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5 1.5 14h13L8 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><line x1="8" y1="6.5" x2="8" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="12" r="0.65" fill="currentColor"/></svg><p>' + escapeHtml(b.text) + '</p></div>';
      case 'cta':
        if(b.slug){
          return '<a class="res-cta" href="#/resources/' + encodeURIComponent(b.slug) + '">' + escapeHtml(b.label) + ' →</a>';
        }
        var attrs = b.toolsTarget ? ' data-tools-target="' + escapeHtml(b.toolsTarget) + '"' : '';
        return '<a class="res-cta" href="' + escapeHtml(b.href) + '"' + attrs + '>' + escapeHtml(b.label) + ' →</a>';
      default: return '';
    }
  }

  function renderGuidePanel(slug){
    var resource = DATA.getResource(slug);
    var guide = DATA.getGuide(slug);
    if(!resource || !guide){ return null; }

    // rich 가이드(광고 핵심 3종)만 읽기 쉬운 목록 · 여백 스타일(CSS의 .res-rich)을 쓴다.
    panelBody.classList.toggle('res-rich', !!guide.rich);
    var html = '<div class="res-panel-meta">' + typeBadge(resource.type) +
      '<span class="res-panel-cat">' + escapeHtml(DATA.CATEGORY_LABEL[resource.category] || '') + '</span></div>' +
      '<h2 class="res-panel-title" tabindex="-1">' + escapeHtml(resource.title) + '</h2>' +
      (guide.intro ? '<p class="res-panel-intro">' + escapeHtml(guide.intro) + '</p>' : '') +
      guide.blocks.map(blockHtml).join('');
    panelBody.innerHTML = html;

    var titleEl = panelBody.querySelector('.res-panel-title');
    if(titleEl){
      titleEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      titleEl.focus({ preventScroll: true });
    }
    return resource;
  }

  function showIndex(){
    panelEl.hidden = true;
    indexEl.hidden = false;
  }
  function showGuide(slug){
    var resource = renderGuidePanel(slug);
    if(!resource){ showIndex(); return; }
    indexEl.hidden = true;
    panelEl.hidden = false;
    gaEvent('resource_open', DATA.buildOpenPayload(slug, resource.type, resource.category));
  }

  if(panelClose) panelClose.addEventListener('click', function(){ location.hash = '/resources'; });
  if(panelBack) panelBack.addEventListener('click', function(){ location.hash = '/resources'; });

  // 체크리스트 항목 클릭 → 시각적 체크 토글만(저장하지 않음 — 새로고침하면
  // 초기화된다. 서버/localStorage 저장은 이번 범위 밖).
  panelBody && panelBody.addEventListener('click', function(e){
    var item = e.target.closest('.res-check-item');
    if(item){ item.classList.toggle('checked'); return; }
    // 표 안의 "N단계로 이동" 버튼 — 해시(#/resources/<slug>)를 건드리지 않고 같은
    // 가이드의 step 카드로 스크롤 + 포커스한다(해시를 바꾸면 라우터가 화면을 벗어난다).
    var jump = e.target.closest('[data-res-jump]');
    if(jump){
      var target = panelBody.querySelector('#res-anchor-' + jump.getAttribute('data-res-jump'));
      if(target){
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
      }
    }
  });

  // 패널 안의 내부 가이드 링크(다른 가이드로 이동)/도구 링크(#/tools 등)는
  // 일반 <a href> 그대로 두면 hashchange가 알아서 처리한다 — 여기서는
  // "가이드 열기"를 GA4 resource_open으로 잡기 위한 위임만 추가한다.
  document.addEventListener('click', function(e){
    var extLink = e.target.closest('#view-resources [data-res-external]');
    if(extLink){
      var slug = extLink.getAttribute('data-res-external');
      // hostname만 보낸다 — 전체 URL·쿼리스트링은 절대 담지 않는다(요구사항).
      // new URL(...).hostname은 쿼리스트링/해시를 포함하지 않는다.
      var host = '';
      try{ host = new URL(extLink.href).hostname; }catch(err){ /* ignore */ }
      gaEvent('resource_external_click', DATA.buildExternalClickPayload(slug, host));
      return;
    }
    // tool 카드(마진 계산기)는 #/tools로 이동해 resources 라우트를 벗어나므로
    // sync()의 showGuide()가 resource_open을 보낼 기회가 없다 — 여기서 직접
    // 잡는다(가이드/체크리스트는 showGuide()가 이미 처리하므로 제외).
    var openLink = e.target.closest('#view-resources [data-res-open]');
    if(openLink){
      var oslug = openLink.getAttribute('data-res-open');
      var ores = DATA.getResource(oslug);
      if(ores && ores.type === 'tool'){
        gaEvent('resource_open', DATA.buildOpenPayload(oslug, 'tool', ores.category));
      }
    }
  });

  // ------------------------------------------------------------- 라우팅 동기화
  function sync(){
    var path = currentPath();
    if(!isResourcesRoute(path)) return; // 다른 화면일 땐 아무것도 하지 않는다(상태 유지)

    if(pendingLegacyCategory){
      var mapped = DATA.mapLegacyCategory(pendingLegacyCategory);
      pendingLegacyCategory = null;
      if(mapped) setCategory(mapped, false);
    }

    var slug = slugFromPath(path);
    if(slug) showGuide(slug);
    else showIndex();
  }

  setCategory('all', false); // 초기 렌더(그리드 채우기)
  sync();
  window.addEventListener('hashchange', sync);
})();
