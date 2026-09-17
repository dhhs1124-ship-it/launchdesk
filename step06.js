/* ============================================================================
   step06.js — STEP 06(#/start/marketing-setup) 화면 부가 동작 (2026-09 UI 재설계 6차,
   STEP01~05 시각 구조 이식 — 피그마 시안 없음)
   ----------------------------------------------------------------------------
   저장·완료 판정은 건드리지 않는다. 그건 app.js 체크리스트 컨트롤러
   (.checklist-block[data-chapter="/start/marketing-setup"] · .cl-row input[type="checkbox"] 1개 ·
   change 이벤트 → setChapterDone / checklistAllChecked · .count 갱신)가 그대로 담당한다.
   여기서는 같은 체크박스의 checked 상태를 "읽기만" 해서
     · 필수 진행 패널(0/1 · 진행 바 · 준비 완료 표시)
     · 체크리스트 카드 안의 완료 안내 · 행 강조(.done)
     · 하단 이전/다음 상태 문구
     · 가이드 탭 CTA → 연결 체크리스트 탭 전환 + 맨 위로
     · 비회원 "로그인하고 저장하기" → 기존 로그인 모달
     · 미완료 상태에서 다음 STEP 이동 시 confirm 한 번(막지 않음)
   만 처리한다(STEP02~05의 step0N.js와 동일한 패턴). 체크박스에 change 리스너를
   하나 더 붙이지만 UI 갱신만 하고 저장 경로(setChapterDone)는 호출하지 않는다 —
   저장·토스트·GA4는 app.js에서 1회. 우측 "선택 연결" 패널은 .s6-ref-checklist
   (data-chapter 없음, app.js의 전역 checklist counters 핸들러가 개수만 세고
   저장하지 않음)의 체크 개수를 읽기만 해서 배지에 반영한다 — 완료 판정과 무관하고
   저장 로직을 중복 구현하지 않는다.
   ============================================================================ */
(function(){
  var root = document.getElementById('step06Root');
  if(!root) return;

  var byId = function(id){ return document.getElementById(id); };
  var block = root.querySelector('.checklist-block[data-chapter="/start/marketing-setup"]');
  var boxes = block ? Array.prototype.slice.call(block.querySelectorAll('.cl-row input[type="checkbox"]')) : [];
  var rows = boxes.map(function(b){ return b.closest('.cl-row'); });

  var badge = byId('s6ProgressBadge');
  var fill = byId('s6ProgressFill');
  var progressText = byId('s6ProgressText');
  var doneEl = byId('s6ProgressDone');
  var clDone = byId('s6ClDone');
  var navStatus = byId('s6NavStatus');
  var navText = byId('s6NavText');
  var navCount = byId('s6NavCount');
  var nextLink = byId('s6Next');

  function isChecked(i){ return !!(boxes[i] && boxes[i].checked); }
  function checkedCount(){ return boxes.filter(function(b){ return b.checked; }).length; }

  function render(){
    var total = boxes.length;
    var n = checkedCount();
    var complete = total > 0 && n === total;
    var pct = (total ? Math.round(n / total * 100) : 0) + '%';

    if(badge){
      badge.textContent = n + ' / ' + total;
      badge.classList.toggle('done', complete);
    }
    if(fill){ fill.style.width = pct; fill.classList.toggle('done', complete); }
    if(progressText) progressText.textContent = complete ? '기본 방문 · 전환 확인 수단을 연결했어요.' : '기본 방문 · 전환 확인 수단을 최소 1개 연결하면 완료돼요.';
    rows.forEach(function(row, i){ if(row) row.classList.toggle('done', isChecked(i)); });
    if(doneEl) doneEl.hidden = !complete;
    if(clDone) clDone.hidden = !complete;
    if(navStatus){
      navStatus.classList.toggle('done', complete);
      if(navText) navText.textContent = complete ? 'STEP 06 준비 완료 — 다음 단계로 이동할 수 있어요.' : '필수 항목을 완료하면 STEP 06이 완료돼요.';
      if(navCount){ navCount.textContent = n + ' / ' + total; navCount.hidden = complete; }
    }
    root.classList.toggle('is-complete', complete);
  }

  // 체크 즉시 UI 반영 — app.js의 change 리스너(저장·완료 판정)와 같은 요소, 등록 순서대로 실행된다.
  boxes.forEach(function(b){ b.addEventListener('change', render); });
  // 회원 hydrate / 로그아웃 초기화 뒤에는 app.js 컨트롤러 restore()가 먼저 checked를 되돌리고(등록 순서),
  // 그 다음 이 콜백이 UI를 다시 그린다.
  if(window.launchdeskStore && typeof window.launchdeskStore.onChange === 'function'){
    window.launchdeskStore.onChange(render);
  }

  // 선택 연결(참고용, data-chapter 없음) — 개수만 읽어서 우측 배지에 반영. 저장하지 않는다.
  var refBlock = root.querySelector('.s6-ref-checklist');
  var refBoxes = refBlock ? Array.prototype.slice.call(refBlock.querySelectorAll('.cl-row input[type="checkbox"]')) : [];
  var optBadge = byId('s6OptBadge');
  function renderOptional(){
    if(!optBadge) return;
    var n = refBoxes.filter(function(b){ return b.checked; }).length;
    optBadge.textContent = n + ' / ' + refBoxes.length + ' · 참고용';
  }
  refBoxes.forEach(function(b){ b.addEventListener('change', renderOptional); });

  // 탭 상태를 루트 data-tab에 반영(우측 열 표시 전환은 CSS). 실제 탭 전환은 기존 .tabs 위임(app.js)이 한다.
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#view-start-marketing-setup .s6-tabbar .tab-btn');
    if(!btn) return;
    root.setAttribute('data-tab', btn.getAttribute('data-tab') === 'checklist' ? 'checklist' : 'guide');
  });

  // 가이드 하단 CTA → 연결 체크리스트 탭 + STEP 제목(맨 위)으로. hash는 그대로, 체크 상태는 DOM에 그대로 남는다.
  var goBtn = byId('s6GoChecklist');
  if(goBtn) goBtn.addEventListener('click', function(){
    var tabBtn = root.querySelector('.s6-tabbar .tab-btn[data-tab="checklist"]');
    if(tabBtn) tabBtn.click();
    window.scrollTo(0, 0);
    var title = byId('s6ChecklistTitle');
    if(title && typeof title.focus === 'function'){
      try{ title.focus({ preventScroll: true }); }catch(err){ title.focus(); }
    }
  });

  // 비회원 안내 버튼 → 기존 로그인 모달(가짜 저장 표시 없음)
  var loginBtn = byId('s6GuestLogin');
  if(loginBtn) loginBtn.addEventListener('click', function(){
    if(typeof window.launchdeskOpenLoginModal === 'function'){
      window.launchdeskOpenLoginModal({ hint: '로그인하면 체크한 준비 상태를 계정에 저장하고 다른 기기에서도 이어갈 수 있어요.' });
    }
  });

  // 미완료 상태에서 다음 STEP → confirm 한 번. 취소하면 이동하지 않는다(해시 링크라 뒤로가기도 그대로).
  if(nextLink) nextLink.addEventListener('click', function(e){
    if(boxes.length && checkedCount() < boxes.length){
      if(!window.confirm('아직 확인하지 않은 필수 항목이 있어요. 그래도 다음 단계로 이동할까요?')) e.preventDefault();
    }
  });

  render();
  renderOptional();
})();
