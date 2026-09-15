(function(){
  // reduceMotion: app.js computes this the same way inside its own scope;
  // recomputed here identically since this file runs in its own top-level scope,
  // not inside app.js's IIFE, so the two can't share the same variable.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* /services/setup — 세팅 대행 3단계 플로우.

     2026-09 업데이트: 신청을 이제 setup_inquiries 테이블에 실제로
     저장한다(관리자가 #/admin에서 조회·상태 관리). 로그인은 여전히
     필수가 아니다 — 로그인 상태면 user_id를 함께 저장하고, 아니면
     null로 저장한다(둘 다 DB의 INSERT 정책이 허용).

     DB 저장이 성공하면 그 순간 "접수 완료"로 취급한다 — 기존의 mailto
     버튼은 더 이상 필수 단계가 아니라 "이메일로 추가 내용 보내기"
     선택적 보조 수단으로 남긴다(applyCompletionCopy 참고). 사용자가
     그 버튼을 안 눌러도 신청은 이미 정상 접수된 상태다.

     DB 저장이 실패하거나(네트워크 오류 등) Supabase 클라이언트 자체가
     없는 경우(CDN 차단 등)에는, 기존과 동일하게 mailto가 유일한 완주
     경로가 되도록 안내 문구를 원래대로 되돌린다 — DB가 어떤 이유로든
     막혀도 신청 자체가 완전히 막히지는 않는다(기존 동작 보존). */
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
        icon: planEl.querySelector('.sp-icon') ? planEl.querySelector('.sp-icon').textContent : '🛠️'
      };
      var goBtn = document.getElementById('setupGoStep2');
      if(goBtn) goBtn.textContent = setupSelectedPlan.name + ' 신청하기 →';
    }
    // 기본 선택값(기본 쇼핑몰 세팅)을 실제 상태로도 반영
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
      if(metaEl) metaEl.textContent = '₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원';
      setupShowStep(2);
    });

    var setupChangePlan = document.getElementById('setupChangePlan');
    if(setupChangePlan) setupChangePlan.addEventListener('click', function(){ setupShowStep(1); });

    var setupBackTo1 = document.getElementById('setupBackTo1');
    if(setupBackTo1) setupBackTo1.addEventListener('click', function(){ setupShowStep(1); });

    // DB 저장 성공/실패에 따라 STEP 3 문구를 바꾼다 — 성공하면 mailto를
    // "선택적 보조 수단"으로, 실패(또는 DB 자체를 못 씀)하면 기존처럼
    // mailto가 유일한 완주 경로임을 안내한다.
    function applyCompletionCopy(dbSaved){
      var titleEl = document.getElementById('setupCompleteTitle');
      var leadEl = document.getElementById('setupCompleteLead');
      var mailBtnEl = document.getElementById('setupMailBtn');
      if(dbSaved){
        if(titleEl) titleEl.textContent = '신청이 접수됐어요';
        if(leadEl) leadEl.textContent = '1영업일 내에 연락드릴게요. 급하게 전달할 내용이 있다면 아래 버튼으로 이메일도 보내주세요 — 안 보내셔도 신청은 이미 접수된 상태예요.';
        if(mailBtnEl) mailBtnEl.textContent = '이메일로 추가 내용 보내기 (선택)';
      } else {
        if(titleEl) titleEl.textContent = '마지막 한 단계예요';
        if(leadEl) leadEl.innerHTML = '아래 버튼을 누르면 신청 내용이 담긴 메일이 자동으로 작성돼요. <strong>보내기</strong>까지 눌러주시면 1영업일 내에 연락드릴게요.';
        if(mailBtnEl) mailBtnEl.textContent = '이메일로 신청 보내기 →';
      }
    }

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
        '■ 신청 플랜: ' + setupSelectedPlan.name + ' (₩' + setupSelectedPlan.price.toLocaleString('ko-KR') + '원)',
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

      var submitBtn = setupForm.querySelector('button[type="submit"]');
      var restoreLabel = submitBtn ? submitBtn.textContent : null;
      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = '접수 중...'; }

      function finalizeSubmit(dbSaved){
        if(submitBtn){ submitBtn.disabled = false; if(restoreLabel != null) submitBtn.textContent = restoreLabel; }
        applyCompletionCopy(dbSaved);
        setupShowStep(3);
        /* GA4 setup_form_complete — fires once step 3 is shown, regardless
           of dbSaved. No name/platform/phone/note here on purpose — those
           are the applicant's personal info(already true before this
           change). db_saved is not personal info, added so we can later
           see how often the mailto fallback path was actually needed. */
        if(typeof gtag === 'function'){
          gtag('event', 'setup_form_complete', {
            plan_key: setupSelectedPlan.key,
            db_saved: dbSaved
          });
        }
      }

      var sb = window.launchdeskSupabase;
      if(!sb){
        // Supabase 클라이언트 자체가 없으면(CDN 차단 등) 기존 동작
        // (mailto만으로 완주 가능)을 그대로 보존한다.
        finalizeSubmit(false);
        return;
      }

      sb.auth.getSession().then(function(res){
        var session = res && res.data && res.data.session;
        var userId = (session && session.user && session.user.id) || null;
        return sb.from('setup_inquiries').insert({
          user_id: userId,
          plan_key: setupSelectedPlan.key,
          plan_name: setupSelectedPlan.name,
          plan_price: setupSelectedPlan.price,
          name: name,
          phone: phone,
          platform: platform || null,
          note: note || null
        });
      }).then(function(res){
        if(res && res.error) console.warn('[launchdesk] 세팅 대행 신청 저장 실패:', res.error.message);
        finalizeSubmit(!(res && res.error));
      }).catch(function(err){
        console.warn('[launchdesk] 세팅 대행 신청 저장 중 오류:', err && err.message);
        finalizeSubmit(false);
      });
    });

    var setupRestart = document.getElementById('setupRestart');
    if(setupRestart) setupRestart.addEventListener('click', function(){
      setupForm.reset();
      var defaultPlan = setupView.querySelector('.setup-plan[data-plan="basic"]');
      if(defaultPlan) setupSelectPlan(defaultPlan);
      setupShowStep(1);
    });

    var setupMailBtn = document.getElementById('setupMailBtn');
    if(setupMailBtn) setupMailBtn.addEventListener('click', function(){
      /* GA4 setup_mail_click — fires alongside the button's own mailto:
         href (set in the submit handler above), which the browser follows
         natively right after this — nothing here blocks or delays that.
         This only means the button was clicked, NOT that the email was
         actually sent from the mail app that opens. No name/phone/note/
         email body here on purpose — those are the applicant's personal info. */
      if(typeof gtag === 'function' && setupSelectedPlan){
        gtag('event', 'setup_mail_click', {
          plan_key: setupSelectedPlan.key
        });
      }
    });
  }
})();