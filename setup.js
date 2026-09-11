(function(){
  // reduceMotion: app.js computes this the same way inside its own scope;
  // recomputed here identically since this file runs in its own top-level scope,
  // not inside app.js's IIFE, so the two can't share the same variable.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* /services/setup — 세팅 대행 3단계 플로우. 신청 데이터를 실제로
     받을 서버가 없어서, 완료 화면은 "다 됐어요" 가짜 화면이 아니라
     사용자가 직접 [보내기]를 눌러야 완성되는 진짜 mailto: 메일로
     연결합니다. CONTACT_EMAIL을 아직 못 정해서 비워뒀어요 — 실제
     수신 이메일이 정해지면 이 한 줄만 채우면 됩니다. */
  var CONTACT_EMAIL = 'dhhs1124@gmail.com';
  var setupView = document.getElementById('view-services-setup');
  if(setupView){
    var setupSelectedPlan = null;
    var setupSteps = setupView.querySelectorAll('.setup-step[data-step]');
    var setupStepItems = setupView.querySelectorAll('.setup-step-item[data-step-indicator]');

    function setupShowStep(n){
      setupSteps.forEach(function(s){ s.hidden = (s.getAttribute('data-step') !== String(n)); });
      setupStepItems.forEach(function(item){
        var i = parseInt(item.getAttribute('data-step-indicator'), 10);
        item.classList.toggle('active', i === n);
        item.classList.toggle('done', i < n);
      });
      var contentEl = setupView.closest('.content') || setupView;
      contentEl.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'start'});
    }

    function setupSelectPlan(planEl){
      setupView.querySelectorAll('.setup-plan').forEach(function(p){ p.classList.toggle('selected', p === planEl); });
      setupSelectedPlan = {
        key: planEl.getAttribute('data-plan'),
        name: planEl.getAttribute('data-name'),
        price: parseInt(planEl.getAttribute('data-price'), 10),
        days: planEl.getAttribute('data-days'),
        icon: planEl.querySelector('.sp-icon') ? planEl.querySelector('.sp-icon').textContent : '🛠️'
      };
      var goBtn = document.getElementById('setupGoStep2');
      if(goBtn) goBtn.textContent = setupSelectedPlan.name + ' 신청하기 →';
    }
    // 기본 선택값(스탠다드)을 실제 상태로도 반영
    var initialPlan = setupView.querySelector('.setup-plan.selected') || setupView.querySelector('.setup-plan');
    if(initialPlan) setupSelectPlan(initialPlan);

    setupView.querySelectorAll('.setup-plan').forEach(function(planEl){
      planEl.addEventListener('click', function(){ setupSelectPlan(planEl); });
    });

    var setupGoStep2 = document.getElementById('setupGoStep2');
    if(setupGoStep2) setupGoStep2.addEventListener('click', function(){
      if(!setupSelectedPlan) return;
      var iconEl = document.getElementById('setupSummaryIcon');
      var nameEl = document.getElementById('setupSummaryName');
      var metaEl = document.getElementById('setupSummaryMeta');
      if(iconEl) iconEl.textContent = setupSelectedPlan.icon;
      if(nameEl) nameEl.textContent = setupSelectedPlan.name;
      if(metaEl) metaEl.textContent = '₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원 · ' + setupSelectedPlan.days;
      setupShowStep(2);
    });

    var setupChangePlan = document.getElementById('setupChangePlan');
    if(setupChangePlan) setupChangePlan.addEventListener('click', function(){ setupShowStep(1); });

    var setupBackTo1 = document.getElementById('setupBackTo1');
    if(setupBackTo1) setupBackTo1.addEventListener('click', function(){ setupShowStep(1); });

    var setupForm = document.getElementById('setupForm');
    if(setupForm) setupForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(!setupSelectedPlan) return;
      var name = document.getElementById('setupName').value.trim();
      var platform = document.getElementById('setupPlatform').value.trim();
      var phone = document.getElementById('setupPhone').value.trim();
      var note = document.getElementById('setupNote').value.trim();

      var resultPlan = document.getElementById('setupResultPlan');
      var resultPrice = document.getElementById('setupResultPrice');
      var resultName = document.getElementById('setupResultName');
      var resultPhone = document.getElementById('setupResultPhone');
      if(resultPlan) resultPlan.textContent = setupSelectedPlan.name;
      if(resultPrice) resultPrice.textContent = '₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원';
      if(resultName) resultName.textContent = name || '-';
      if(resultPhone) resultPhone.textContent = phone || '-';

      var subject = '[런치데스크] ' + setupSelectedPlan.name + ' 세팅 대행 신청 — ' + (name || '이름 미입력');
      var bodyLines = [
        '■ 신청 플랜: ' + setupSelectedPlan.name + ' (₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원, ' + setupSelectedPlan.days + ')',
        '■ 성함: ' + (name || '-'),
        '■ 쇼핑몰 플랫폼: ' + (platform || '-'),
        '■ 연락처: ' + (phone || '-'),
        '■ 세팅 요청 사항:',
        note || '(작성 안 함)'
      ];
      var body = bodyLines.join('\n');
      var fallbackEmail = document.getElementById('setupFallbackEmail');
      if(fallbackEmail) fallbackEmail.textContent = CONTACT_EMAIL || '[이메일 주소]';
      var mailBtn = document.getElementById('setupMailBtn');
      if(mailBtn) mailBtn.href = 'mailto:' + encodeURIComponent(CONTACT_EMAIL) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);

      setupShowStep(3);
    });

    var setupRestart = document.getElementById('setupRestart');
    if(setupRestart) setupRestart.addEventListener('click', function(){
      setupForm.reset();
      var standardPlan = setupView.querySelector('.setup-plan[data-plan="standard"]');
      if(standardPlan) setupSelectPlan(standardPlan);
      setupShowStep(1);
    });
  }
})();