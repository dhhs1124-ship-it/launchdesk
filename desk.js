/* window.launchdeskDesk — 시작 데스크(#/) 상황 선택 (2026-09 UI 재설계 1차).

   "지금 어디까지 준비하셨나요?"의 라디오(A~D)를 고르면 추천 시작점 카드
   (#deskRec)와 "이번 단계에서 정할 것" 목록(#deskDecideList)을 그린다.
   그리는 내용은 전부 이 파일 안의 고정 데이터이고 사용자 입력 문자열은
   없지만, 다른 모듈(plans.js 등)과 같은 관례로 innerHTML을 쓰지 않고
   createElement/textContent만 쓴다.

   저장하지 않는다 — 선택값은 DB/localStorage 어디에도 남기지 않는다(이번
   버전 범위). 추천 링크는 기존 해시 라우트(#/start/…, #/tools 등 app.js
   BUILT에 이미 있는 경로만)로 이동하고, 그 뒤의 진행 저장은 각 STEP 화면(app.js/
   store.js)이 기존 방식대로 담당한다. 기존 9단계 로드맵 데이터
   (STEP_ROADMAP, user_step_progress)는 읽지도 쓰지도 않는다.

   index.html에서 home-dashboard.js 다음에 로드한다. 다른 전역에 의존하지
   않고, 홈 마크업(#deskSituation 등)이 없으면 조용히 끝난다. */
(function(){
  var group = document.getElementById('deskSituation');
  var recEl = document.getElementById('deskRec');
  var listEl = document.getElementById('deskDecideList');
  var tagEl = document.getElementById('deskDecideTag');
  if(!group || !recEl || !listEl) return;

  // step/label은 화면 표시용 텍스트일 뿐 — 실제 STEP 번호·라벨의 기준은
  // app.js STEP_ROADMAP이고, 여기 값은 그 경로(route)에 맞춰 적은 것이다.
  // cta는 카드의 유일한 버튼 문구, desc는 "왜 이걸 먼저 하는지" 한 줄.
  // toolsTarget은 사이드바 마진 계산기 링크와 같은 data-tools-target을 붙일
  // 때만 둔다. 연결 화면은 전부 비회원도 열 수 있는 기존 라우트이며, 여기서
  // 로그인 게이트를 새로 만들지 않는다.
  var RECS = {
    A: {
      step: 'STEP 01', label: '방향 정하기', href: '#/start/prepare',
      title: '상품·고객·예산 정하기',
      desc: '무엇을 누구에게 얼마로 팔지 먼저 정해야 공급처와 판매가를 고를 수 있어요.',
      cta: 'STEP 01 시작하기',
      items: [
        ['판매할 고객', '어떤 고객을 대상으로 할까요?'],
        ['상품 종류', '어떤 상품이 좋을까요?'],
        ['초기 예산', '예산과 판매 가격은 어떻게 할까요?']
      ]
    },
    B: {
      step: '마진 계산기', label: '상품과 가격 준비', href: '#/tools', toolsTarget: 'calc',
      title: '예상 판매가와 남는 돈 확인하기',
      desc: '상품을 정했다면 원가·배송비·수수료를 넣어 한 개 팔 때 얼마가 남는지부터 확인해요.',
      cta: '마진 계산기 열기',
      items: [
        ['공급처와 원가', '어디서 얼마에 공급받나요?'],
        ['배송비와 수수료', '추가 비용을 확인해요.'],
        ['판매가격', '적정 판매가격을 계산해요.']
      ]
    },
    C: {
      step: 'STEP 02', label: '쇼핑몰과 판매 설정', href: '#/start/setup',
      title: '쇼핑몰 설정 단계 이어서 보기',
      desc: '설정 순서와 오픈 체크리스트로 어디서 막혔는지 하나씩 짚어볼 수 있어요.',
      cta: 'STEP 02 설정 단계 보기',
      items: [
        ['사용 중인 플랫폼', '어떤 쇼핑몰을 사용하고 있나요?'],
        ['완료한 설정', '어디까지 설정했나요?'],
        ['막힌 설정', '어느 부분이 어렵나요?']
      ]
    },
    D: {
      step: 'STEP 05', label: '판매 전 점검', href: '#/start/orders',
      title: '주문·배송·결제 테스트하기',
      desc: '첫 주문 전에 테스트 주문으로 결제부터 배송·CS까지 한 번 따라가 보면 실수를 줄일 수 있어요.',
      cta: 'STEP 05 점검 시작하기',
      items: [
        ['상품·배송 안내', '안내 정보가 충분한가요?'],
        ['주문·결제 과정', '결제 흐름을 확인해요.'],
        ['고객 문의 경로', '문의를 받을 방법을 준비해요.']
      ]
    }
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function el(tag, className, text){
    var node = document.createElement(tag);
    if(className) node.className = className;
    if(text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function svg(viewBox, paths, extraAttrs){
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', extraAttrs && extraAttrs.strokeWidth ? extraAttrs.strokeWidth : '1.5');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    paths.forEach(function(p){
      var node = document.createElementNS(SVG_NS, p[0]);
      Object.keys(p[1]).forEach(function(k){ node.setAttribute(k, p[1][k]); });
      s.appendChild(node);
    });
    return s;
  }
  function bulbSvg(){
    return svg('0 0 18 18', [
      ['path', { d: 'M9 2a5 5 0 0 1 3.5 8.5L12 13H6l-.5-2.5A5 5 0 0 1 9 2Z' }],
      ['line', { x1: '6.5', y1: '15', x2: '11.5', y2: '15' }],
      ['line', { x1: '7.5', y1: '17', x2: '10.5', y2: '17' }]
    ]);
  }
  function checkSvg(){
    return svg('0 0 16 16', [['polyline', { points: '3,8 6.5,12 13,4' }]]);
  }
  function arrowSvg(){
    return svg('0 0 16 16', [
      ['line', { x1: '3', y1: '8', x2: '13', y2: '8' }],
      ['polyline', { points: '9,4 13,8 9,12' }]
    ]);
  }

  function renderRec(key){
    var rec = RECS[key];
    if(!rec) return;

    recEl.textContent = '';
    var card = el('div', 'desk-rec-card desk-fade');
    var icon = el('span', 'desk-rec-icon');
    icon.appendChild(bulbSvg());
    var body = el('div', 'desk-rec-body');
    var eyebrow = el('p', 'desk-rec-eyebrow', '지금 할 일');
    eyebrow.appendChild(el('span', 'desk-rec-step', rec.step));
    body.appendChild(eyebrow);
    body.appendChild(el('h3', 'desk-rec-title', rec.title));
    body.appendChild(el('p', 'desk-rec-desc', rec.desc));
    var cta = el('a', 'btn btn-primary desk-rec-cta', rec.cta);
    cta.setAttribute('href', rec.href);
    if(rec.toolsTarget) cta.setAttribute('data-tools-target', rec.toolsTarget);
    cta.appendChild(arrowSvg());
    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(cta);
    recEl.appendChild(card);

    listEl.textContent = '';
    listEl.classList.add('desk-fade');
    rec.items.forEach(function(pair){
      var row = el('div', 'desk-decide-row');
      var ico = el('span', 'desk-decide-icon');
      ico.appendChild(checkSvg());
      var txt = el('span', 'desk-decide-text');
      txt.appendChild(el('b', null, pair[0]));
      txt.appendChild(el('small', null, pair[1]));
      row.appendChild(ico);
      row.appendChild(txt);
      listEl.appendChild(row);
    });
    if(tagEl){ tagEl.textContent = rec.label; tagEl.hidden = false; }
  }

  group.addEventListener('change', function(e){
    var input = e.target;
    if(!input || input.name !== 'deskSituation') return;
    renderRec(input.value);
  });

  // 초기 상태는 "선택 없음"(힌트 문구) — A를 강제로 고르지 않는다. 다만
  // 브라우저 뒤로가기 폼 복원으로 이미 체크된 라디오가 있으면 그 값만 반영한다.
  var restored = group.querySelector('input[name="deskSituation"]:checked');
  if(restored) renderRec(restored.value);

  window.launchdeskDesk = {
    getSelected: function(){
      var c = group.querySelector('input[name="deskSituation"]:checked');
      return c ? c.value : null;
    }
  };
})();
