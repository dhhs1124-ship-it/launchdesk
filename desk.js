/* window.launchdeskDesk — 시작 데스크(#/) 상황 선택 (2026-09 UI 재설계 1차).

   "지금 어디까지 준비하셨나요?"의 라디오(A~D)를 고르면 추천 시작점 카드
   (#deskRec)와 "이번 단계에서 정할 것" 목록(#deskDecideList)을 그린다.
   그리는 내용은 전부 이 파일 안의 고정 데이터이고 사용자 입력 문자열은
   없지만, 다른 모듈(plans.js 등)과 같은 관례로 innerHTML을 쓰지 않고
   createElement/textContent만 쓴다.

   저장하지 않는다 — 선택값은 DB/localStorage 어디에도 남기지 않는다(이번
   버전 범위). 추천 링크는 기존 해시 라우트(#/start/…, app.js BUILT에 이미
   있는 경로만)로 이동하고, 그 뒤의 진행 저장은 각 STEP 화면(app.js/
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
  var RECS = {
    A: {
      step: 'STEP 01', label: '방향 정하기', href: '#/start/prepare',
      title: '무엇을, 누구에게 팔지 정하기',
      desc: '판매할 상품과 고객을 정리하면 다음 준비가 쉬워져요.',
      items: [
        ['판매할 고객', '어떤 고객을 대상으로 할까요?'],
        ['상품 종류', '어떤 상품이 좋을까요?'],
        ['초기 예산', '예산과 판매 가격은 어떻게 할까요?']
      ]
    },
    B: {
      step: 'STEP 03', label: '상품과 가격 준비', href: '#/start/sourcing',
      title: '공급처·원가·판매가 정하기',
      desc: '원가와 배송비, 수수료를 확인하고 판매가격을 준비해요.',
      items: [
        ['공급처와 원가', '어디서 얼마에 공급받나요?'],
        ['배송비와 수수료', '추가 비용을 확인해요.'],
        ['판매가격', '적정 판매가격을 계산해요.']
      ]
    },
    C: {
      step: 'STEP 02', label: '쇼핑몰과 판매 설정', href: '#/start/setup',
      title: '사업자·플랫폼·결제 환경 준비하기',
      desc: '완료한 설정과 아직 어려운 부분을 나눠 확인해요.',
      items: [
        ['사용 중인 플랫폼', '어떤 쇼핑몰을 사용하고 있나요?'],
        ['완료한 설정', '어디까지 설정했나요?'],
        ['막힌 설정', '어느 부분이 어렵나요?']
      ]
    },
    D: {
      step: 'STEP 05', label: '판매 전 점검', href: '#/start/orders',
      title: '주문·배송·CS 준비 상태 점검하기',
      desc: '상품과 배송 안내, 주문·결제 과정을 확인해요.',
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
    var eyebrow = el('p', 'desk-rec-eyebrow', '추천 시작점');
    eyebrow.appendChild(el('span', 'desk-rec-step', rec.step));
    body.appendChild(eyebrow);
    body.appendChild(el('h3', 'desk-rec-title', rec.title));
    body.appendChild(el('p', 'desk-rec-desc', rec.desc));
    var cta = el('a', 'btn btn-primary desk-rec-cta', '이 단계 시작하기');
    cta.setAttribute('href', rec.href);
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
