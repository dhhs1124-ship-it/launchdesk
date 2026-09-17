/* STEP 01(#/start/prepare) 화면 부가 동작 — 2026-09 UI 재설계 2차.

   이 파일은 저장·완료 판정을 하지 않는다. 그건 전부 app.js의 워크시트
   컨트롤러(.worksheet[data-chapter="/start/prepare"] · .worksheet-input 5개 ·
   input/blur 이벤트 → setChapterDone → launchdeskStore)가 기존 그대로 담당한다.
   여기서는 같은 5개 입력칸의 "지금 값"을 읽어 화면만 갱신한다:
   - 진행 상태(필수 N / 5 · 진행 바 · 항목 체크 · 준비 완료 표시) — 완료 기준은
     worksheetAllFilled()와 같은 "trim() 후 비어 있지 않음"이며, 여기서 완료를
     따로 저장하지 않는다.
   - 가이드 하단 "내 쇼핑몰 방향 정리하기" → 기존 .tabs 위임(app.js)으로 탭 전환 +
     맨 위로 스크롤(해시 변경 없음, 입력값 그대로).
   - 탭 전환 시 루트 data-tab 갱신(오른쪽 열/한 열 순서의 표시 전환은 CSS).
   - 게스트 "로그인하고 저장하기" → 기존 로그인 모달(window.launchdeskOpenLoginModal).
   - 미완료 상태에서 "다음"은 confirm으로 한 번 묻고, 확인하면 기존 해시 링크대로
     이동한다(막지 않음). 5/5면 묻지 않는다.

   index.html에서 app.js 뒤에 로드한다(문서 click 위임의 실행 순서: app.js가
   먼저 탭 클래스를 바꾸고, 이 파일이 그 결과를 읽는다). STEP 01 마크업이 없으면
   조용히 끝난다. */
(function(){
  var root = document.getElementById('step01Root');
  if(!root) return;
  var byId = function(id){ return document.getElementById(id); };
  var ws = root.querySelector('.worksheet[data-chapter="/start/prepare"]');
  var inputs = ws ? Array.prototype.slice.call(ws.querySelectorAll('.worksheet-input')) : [];
  var items = ws ? Array.prototype.slice.call(ws.querySelectorAll('.s1-ws-item')) : [];
  var badge = byId('s1ProgressBadge');
  var fill = byId('s1ProgressFill');
  var itemsEl = byId('s1ProgressItems');
  var doneEl = byId('s1ProgressDone');
  var navStatus = byId('s1NavStatus');
  var navText = byId('s1NavText');
  var navCount = byId('s1NavCount');
  var nextLink = byId('s1Next');

  function isFilled(inp){ return !!inp && typeof inp.value === 'string' && inp.value.trim() !== ''; }
  function filledCount(){ return inputs.filter(isFilled).length; }

  function render(){
    var total = inputs.length;
    var n = filledCount();
    var complete = total > 0 && n === total;
    if(badge){
      badge.textContent = complete ? '완료' : '필수 ' + n + ' / ' + total;
      badge.classList.toggle('done', complete);
    }
    if(fill){
      fill.style.width = (total ? Math.round(n / total * 100) : 0) + '%';
      fill.classList.toggle('done', complete);
    }
    if(itemsEl){
      Array.prototype.forEach.call(itemsEl.querySelectorAll('[data-ws-index]'), function(li){
        var i = Number(li.getAttribute('data-ws-index'));
        li.classList.toggle('done', isFilled(inputs[i]));
      });
    }
    items.forEach(function(li, i){ li.classList.toggle('done', isFilled(inputs[i])); });
    if(doneEl) doneEl.hidden = !complete;
    if(navStatus){
      navStatus.classList.toggle('done', complete);
      if(navText) navText.textContent = complete
        ? 'STEP 01 준비 완료 — 다음 단계로 이동할 수 있어요.'
        : '필수 항목 ' + total + '개를 작성하면 STEP 01이 완료돼요.';
      if(navCount){ navCount.textContent = n + ' / ' + total; navCount.hidden = complete; }
    }
    root.classList.toggle('is-complete', complete);
  }

  inputs.forEach(function(inp){ inp.addEventListener('input', render); });
  // 로그인(hydrate)/로그아웃(resetToGuest) 직후 app.js가 먼저 등록한 onChange 리스너가
  // 입력칸을 store 값으로 되돌린 뒤, 이 리스너가 화면을 그 값에 맞춘다.
  if(window.launchdeskStore && typeof window.launchdeskStore.onChange === 'function'){
    window.launchdeskStore.onChange(render);
  }

  // 탭 전환 결과를 루트에 기록(app.js의 .tabs 위임이 먼저 실행된 뒤 읽는다).
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#view-start-prepare .s1-tabbar .tab-btn');
    if(!btn) return;
    root.setAttribute('data-tab', btn.getAttribute('data-tab') === 'worksheet' ? 'worksheet' : 'guide');
  });

  var goBtn = byId('s1GoWorksheet');
  if(goBtn) goBtn.addEventListener('click', function(){
    var tabBtn = root.querySelector('.s1-tabbar .tab-btn[data-tab="worksheet"]');
    if(tabBtn) tabBtn.click(); // 기존 위임 핸들러가 .active를 바꾸고, 위 리스너가 data-tab을 갱신
    window.scrollTo(0, 0);
    var title = byId('s1WorksheetTitle');
    if(title && typeof title.focus === 'function'){ try{ title.focus({ preventScroll: true }); }catch(err){ title.focus(); } }
  });

  var loginBtn = byId('s1GuestLogin');
  if(loginBtn) loginBtn.addEventListener('click', function(){
    if(typeof window.launchdeskOpenLoginModal === 'function'){
      window.launchdeskOpenLoginModal({ hint: '로그인하면 작성한 내용을 계정에 저장하고 다른 기기에서도 이어갈 수 있어요.' });
    }
  });

  if(nextLink) nextLink.addEventListener('click', function(e){
    if(inputs.length && filledCount() < inputs.length){
      if(!window.confirm('아직 작성하지 않은 필수 항목이 있어요. 그래도 다음 단계로 이동할까요?')) e.preventDefault();
    }
  });

  render();
})();
