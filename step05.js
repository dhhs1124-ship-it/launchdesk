/* ============================================================================
   step05.js — STEP 05(#/start/orders) 화면 부가 동작 (2026-09 UI 재설계 5차,
   STEP01~04 시각 구조 이식 — 피그마 시안 없음)
   ----------------------------------------------------------------------------
   저장·완료 판정은 건드리지 않는다. 그건 app.js 체크리스트 컨트롤러
   (.checklist-block[data-chapter="/start/orders"] · .cl-row input[type="checkbox"] 4개 ·
   change 이벤트 → setChapterDone / checklistAllChecked · .count 갱신)가 그대로 담당한다.
   여기서는 같은 체크박스의 checked 상태를 "읽기만" 해서
     · 진행 패널(필수 N / 4 · 진행 바 · 그룹별 개수 · 항목별 체크 · 준비 완료 표시)
     · 체크리스트 카드 안의 진행 바 · 완료 안내 · 행 강조(.done)
     · 하단 이전/다음 상태 문구
     · 가이드 탭 CTA → 오픈 전 체크리스트 탭 전환 + 맨 위로
     · 비회원 "로그인하고 저장하기" → 기존 로그인 모달
     · 미완료 상태에서 다음 STEP 이동 시 confirm 한 번(막지 않음)
   만 처리한다(STEP02~04의 step0N.js와 동일한 패턴). 체크박스에 change 리스너를
   하나 더 붙이지만 UI 갱신만 하고 저장 경로(setChapterDone)는 호출하지 않는다 —
   저장·토스트·GA4는 app.js에서 1회. 가이드 탭 안의 "테스트 주문 점검"(.s5-ref-checklist,
   data-chapter 없음)은 이 파일이 건드리지 않는다 — app.js의 전역 checklist counters
   핸들러가 개수만 세고 저장하지 않는다(완료 판정과 무관).
   ============================================================================ */
(function(){
  var root = document.getElementById('step05Root');
  if(!root) return;

  var byId = function(id){ return document.getElementById(id); };
  var block = root.querySelector('.checklist-block[data-chapter="/start/orders"]');
  var boxes = block ? Array.prototype.slice.call(block.querySelectorAll('.cl-row input[type="checkbox"]')) : [];
  var rows = boxes.map(function(b){ return b.closest('.cl-row'); });

  var badge = byId('s5ProgressBadge');
  var fill = byId('s5ProgressFill');
  var itemsEl = byId('s5ProgressItems');
  var doneEl = byId('s5ProgressDone');
  var clFill = byId('s5ClFill');
  var clDone = byId('s5ClDone');
  var navStatus = byId('s5NavStatus');
  var navText = byId('s5NavText');
  var navCount = byId('s5NavCount');
  var nextLink = byId('s5Next');

  function isChecked(i){ return !!(boxes[i] && boxes[i].checked); }
  function checkedCount(){ return boxes.filter(function(b){ return b.checked; }).length; }

  function render(){
    var total = boxes.length;
    var n = checkedCount();
    var complete = total > 0 && n === total;
    var pct = (total ? Math.round(n / total * 100) : 0) + '%';

    if(badge){
      badge.textContent = complete ? '완료' : '필수 ' + n + ' / ' + total;
      badge.classList.toggle('done', complete);
    }
    if(fill){ fill.style.width = pct; fill.classList.toggle('done', complete); }
    if(clFill){ clFill.style.width = pct; }
    if(itemsEl){
      Array.prototype.forEach.call(itemsEl.querySelectorAll('[data-cl-index]'), function(li){
        li.classList.toggle('done', isChecked(Number(li.getAttribute('data-cl-index'))));
      });
      Array.prototype.forEach.call(itemsEl.querySelectorAll('[data-cl-range]'), function(b){
        var range = String(b.getAttribute('data-cl-range')).split('-');
        var from = Number(range[0]), to = Number(range[1]);
        if(isNaN(from) || isNaN(to)) return;
        var done = 0, size = 0;
        for(var i = from; i <= to; i++){ if(i < total){ size++; if(isChecked(i)) done++; } }
        b.textContent = done + ' / ' + size;
        var group = b.closest('li');
        if(group) group.classList.toggle('done', size > 0 && done === size);
      });
    }
    rows.forEach(function(row, i){ if(row) row.classList.toggle('done', isChecked(i)); });
    if(doneEl) doneEl.hidden = !complete;
    if(clDone) clDone.hidden = !complete;
    if(navStatus){
      navStatus.classList.toggle('done', complete);
      if(navText) navText.textContent = complete ? 'STEP 05 준비 완료 — 다음 단계로 이동할 수 있어요.' : '체크 항목 ' + total + '개를 완료하면 STEP 05가 완료돼요.';
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

  // 탭 상태를 루트 data-tab에 반영(우측 열 표시 전환은 CSS). 실제 탭 전환은 기존 .tabs 위임(app.js)이 한다.
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#view-start-orders .s5-tabbar .tab-btn');
    if(!btn) return;
    root.setAttribute('data-tab', btn.getAttribute('data-tab') === 'checklist' ? 'checklist' : 'guide');
  });

  // 가이드 하단 CTA → 오픈 전 체크리스트 탭 + STEP 제목(맨 위)으로. hash는 그대로, 체크 상태는 DOM에 그대로 남는다.
  var goBtn = byId('s5GoChecklist');
  if(goBtn) goBtn.addEventListener('click', function(){
    var tabBtn = root.querySelector('.s5-tabbar .tab-btn[data-tab="checklist"]');
    if(tabBtn) tabBtn.click();
    window.scrollTo(0, 0);
    var title = byId('s5ChecklistTitle');
    if(title && typeof title.focus === 'function'){
      try{ title.focus({ preventScroll: true }); }catch(err){ title.focus(); }
    }
  });

  // 비회원 안내 버튼 → 기존 로그인 모달(가짜 저장 표시 없음)
  var loginBtn = byId('s5GuestLogin');
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
})();
