(function(){
  // reduceMotion: app.js computes this the same way inside its own scope;
  // recomputed here identically since this file runs in its own top-level scope,
  // not inside app.js's IIFE, so the two can't share the same variable.
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* /services/setup — 세팅 대행 3단계 플로우.

     2026-09 업데이트: 신청을 setup_inquiries 테이블에 직접 insert하던
     방식을 걷어내고, public.submit_setup_inquiry() RPC 호출로 바꿨다
     (supabase/migrations/20260918120000_setup_inquiries_consent_rpc.sql).
     이제 DB 저장이 "선택적 보조 경로"가 아니라 유일한 접수 경로다 —
     RPC 호출이 실패하면(동의 누락, 입력값 오류, 네트워크 오류, Supabase
     클라이언트 자체가 없는 경우 등 무엇이든) STEP3(신청 완료)으로 절대
     넘어가지 않는다. 과거처럼 "DB 실패 시 mailto만으로 완주"하는 우회
     경로는 이제 존재하지 않는다 — 직접 INSERT 자체가 DB 권한에서 막혀
     있어 더 이상 대체 경로가 될 수 없기 때문이다.

     STEP3의 이메일 버튼(setupMailBtn)은 이제 "접수가 이미 완료된 신청에
     추가로 전달할 내용이 있을 때"만 쓰는 선택적 보조 수단이다 — 안 눌러도
     신청은 이미 정상 접수된 상태다.

     필수 개인정보 수집·이용 동의(setupConsentPrivacy)는 기본 미선택이며,
     체크하지 않으면 RPC 자체를 호출하지 않는다(클라이언트 선검증) —
     설령 우회해서 호출하더라도 RPC가 CONSENT_REQUIRED로 다시 거부한다
     (서버가 최종 방어선).

     [2026-09-18 보안 수정] 동의 "버전" 문자열은 이 파일이 결정하지 않는다
     — 실제로 DB에 저장되는 값은 여전히 RPC 함수 안의 서버 상수
     (v_consent_version)뿐이고, 클라이언트가 보내는 값은 저장에 절대
     쓰이지 않는다(클라이언트가 임의의 버전 문자열을 보내 동의 증빙을
     조작할 수 없게 하기 위한 원래 설계를 그대로 유지).

     [2026-09-23 버전 불일치 차단 추가] 다만 웹 배포(policy-consent-core.js의
     PRIVACY_VERSION)와 RPC 배포(서버 상수)가 서로 다른 시점에 롤아웃되면,
     "실제로 화면에 보인 방침 버전과 DB에 기록되는 버전이 다른" 상황이
     생길 수 있다(예: RPC만 먼저 v1.2로 올라가고 브라우저 캐시가 아직
     v1.1 화면을 보여주는 동안 접수하면, 서버는 여전히 v1.2로 저장해버림).
     이를 막기 위해 이 화면이 지금 무슨 버전을 보여주고 있다고 믿는지
     (p_expected_privacy_version)를 함께 보낸다 — RPC는 이 값을 저장에
     쓰지 않고, 자신의 서버 상수와 정확히 같은지만 검사해서 다르면
     PRIVACY_VERSION_MISMATCH로 접수 자체를 거부한다(저장 자체가 아예
     안 됨). 그래도 "개인정보처리방침을 개정할 때는 이 파일이 참조하는
     PRIVACY_VERSION 상수와 RPC 안의 서버 상수를 같은 배포에서 함께
     올려야 한다"는 원칙은 그대로다 — 이 값은 자동 동기화가 아니라
     "어긋났을 때 잘못된 기록 대신 접수를 거부"하는 안전장치일 뿐이다. */
  var CONTACT_EMAIL = 'dhhs1124@gmail.com';
  var setupPolicyCore = window.launchdeskPolicyConsentCore;
  var setupView = document.getElementById('view-services-setup');
  if(setupView){
    var setupSelectedPlan = null;
    var setupSteps = setupView.querySelectorAll('.setup-step[data-step]');
    var setupStepItems = setupView.querySelectorAll('.setup-step-item[data-step-indicator]');
    var setupConsentPrivacy = document.getElementById('setupConsentPrivacy');
    var setupConsentError = document.getElementById('setupConsentError');
    var setupSubmitError = document.getElementById('setupSubmitError');

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

    function showConsentError(msg){
      if(!setupConsentError) return;
      setupConsentError.textContent = msg;
      setupConsentError.hidden = false;
    }
    function clearConsentError(){
      if(!setupConsentError) return;
      setupConsentError.textContent = '';
      setupConsentError.hidden = true;
    }
    function showSubmitError(msg){
      if(!setupSubmitError) return;
      setupSubmitError.textContent = msg;
      setupSubmitError.hidden = false;
    }
    function clearSubmitError(){
      if(!setupSubmitError) return;
      setupSubmitError.textContent = '';
      setupSubmitError.hidden = true;
    }

    // role="radio" 카드형 플랜 3개 — 실사용 테스트 P2#1: 마우스 click 리스너만 있고
    // 키보드로는 선택 자체가 불가능했다. 네이티브 라디오 그룹과 동일한 규약(roving
    // tabindex: 선택된 카드만 tabindex=0, 나머지는 -1 · aria-checked로 선택 상태를
    // 스크린리더에도 전달)으로 맞춘다 — 화면 표시(.selected)는 그대로 두고 그 위에
    // 얹는다.
    function setupSelectPlan(planEl, focusIt){
      setupView.querySelectorAll('.setup-plan').forEach(function(p){
        var isSel = (p === planEl);
        p.classList.toggle('selected', isSel);
        p.setAttribute('aria-checked', isSel ? 'true' : 'false');
        p.setAttribute('tabindex', isSel ? '0' : '-1');
      });
      if(focusIt) planEl.focus();
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
    if(initialPlan) setupSelectPlan(initialPlan, false);

    var setupPlanEls = setupView.querySelectorAll('.setup-plan');
    setupPlanEls.forEach(function(planEl){
      planEl.addEventListener('click', function(){ setupSelectPlan(planEl, false); });
      // Enter/Space로 현재 포커스된 카드를 선택(네이티브 버튼과 동일한 활성화 키).
      planEl.addEventListener('keydown', function(ev){
        if(ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar'){
          ev.preventDefault(); // Space의 페이지 스크롤 방지
          setupSelectPlan(planEl, false);
          return;
        }
        // 방향키 — 네이티브 라디오 그룹처럼 이동과 동시에 선택되고 포커스도 따라간다.
        var idx = Array.prototype.indexOf.call(setupPlanEls, planEl);
        var nextIdx = null;
        if(ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nextIdx = (idx + 1) % setupPlanEls.length;
        else if(ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nextIdx = (idx - 1 + setupPlanEls.length) % setupPlanEls.length;
        if(nextIdx !== null){
          ev.preventDefault();
          setupSelectPlan(setupPlanEls[nextIdx], true);
        }
      });
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
      clearConsentError();
      clearSubmitError();
      setupShowStep(2);
    });

    var setupChangePlan = document.getElementById('setupChangePlan');
    if(setupChangePlan) setupChangePlan.addEventListener('click', function(){ setupShowStep(1); });

    var setupBackTo1 = document.getElementById('setupBackTo1');
    if(setupBackTo1) setupBackTo1.addEventListener('click', function(){ setupShowStep(1); });

    // RPC 에러 코드(submit_setup_inquiry가 raise exception으로 보내는 짧은
    // 코드 문자열)만 사용자가 이해할 수 있는 문구로 바꾼다 — 그 외(예상 못
    // 한) 에러 원문은 화면에 그대로 노출하지 않고 일반 문구로 대체한다.
    function friendlySubmitError(code){
      if(code === 'CONSENT_REQUIRED') return '개인정보 수집·이용에 동의해야 접수할 수 있어요.';
      if(code === 'INVALID_PLAN') return '선택한 플랜 정보를 확인할 수 없어요. 처음부터 다시 시도해주세요.';
      if(code === 'INVALID_NAME') return '성함을 다시 확인해주세요.';
      if(code === 'INVALID_PHONE') return '연락처를 다시 확인해주세요.';
      if(code === 'INVALID_PLATFORM') return '쇼핑몰 플랫폼 값을 다시 확인해주세요.';
      if(code === 'INVALID_NOTE') return '요청 사항이 너무 길어요. 조금 줄여서 다시 시도해주세요.';
      if(code === 'PRIVACY_VERSION_MISMATCH') return '페이지가 최신 상태가 아니에요. 새로고침한 뒤 다시 시도해주세요.';
      if(code === 'SUPABASE_UNAVAILABLE') return '지금은 접수할 수 없어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.';
      return '접수에 실패했어요. 잠시 후 다시 시도해주세요.';
    }

    var setupForm = document.getElementById('setupForm');
    if(setupForm) setupForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(!setupSelectedPlan) return;
      clearConsentError();
      clearSubmitError();

      if(!setupConsentPrivacy || !setupConsentPrivacy.checked){
        showConsentError('개인정보 수집·이용에 동의해야 세팅 대행 신청을 접수할 수 있어요.');
        if(setupConsentPrivacy) setupConsentPrivacy.focus();
        return;
      }

      var name = document.getElementById('setupName').value.trim();
      var platform = document.getElementById('setupPlatform').value.trim();
      var phone = document.getElementById('setupPhone').value.trim();
      var note = document.getElementById('setupNote').value.trim();

      var submitBtn = setupForm.querySelector('button[type="submit"]');
      var restoreLabel = submitBtn ? submitBtn.textContent : null;
      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = '접수 중...'; }

      function reenableSubmit(){
        if(submitBtn){ submitBtn.disabled = false; if(restoreLabel != null) submitBtn.textContent = restoreLabel; }
      }

      function finalizeSuccess(){
        reenableSubmit();

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

        setupShowStep(3);
        /* GA4 setup_form_complete — DB 저장이 성공적으로 끝난 뒤에만 1회
           호출된다(실패 시엔 STEP3 자체에 도달하지 않으므로 이 이벤트도
           안 뜬다 — db_saved 플래그가 더 이상 필요 없다). 이름/연락처/
           요청사항 등 개인정보는 담지 않는다. */
        if(typeof gtag === 'function'){
          gtag('event', 'setup_form_complete', { plan_key: setupSelectedPlan.key });
        }
      }

      function finalizeFailure(code){
        reenableSubmit();
        showSubmitError(friendlySubmitError(code));
      }

      var sb = window.launchdeskSupabase;
      if(!sb){
        // 직접 INSERT 경로가 없어졌으므로 Supabase 클라이언트 자체가 없는
        // 경우(CDN 차단 등)도 이제는 명백한 실패다 — STEP3로 넘어가지 않는다.
        finalizeFailure('SUPABASE_UNAVAILABLE');
        return;
      }

      sb.rpc('submit_setup_inquiry', {
        p_plan_id: setupSelectedPlan.key,
        p_name: name,
        p_phone: phone,
        p_platform: platform || null,
        p_note: note || null,
        p_privacy_consent: true,
        // 저장에는 쓰이지 않는다(서버 상수만 저장) — RPC가 자신의 버전과
        // 다르면 거부하는 데만 쓰는 echo-back 값. 코어 모듈이 어떤 이유로든
        // 로드되지 않았다면 null을 보내고, RPC는 null도 불일치로 취급해
        // 거부한다(안전한 쪽으로 실패).
        p_expected_privacy_version: setupPolicyCore ? setupPolicyCore.PRIVACY_VERSION : null
      }).then(function(res){
        if(res.error){
          console.warn('[launchdesk] 세팅 대행 신청 접수 실패:', res.error.message);
          finalizeFailure(res.error.message);
          return;
        }
        finalizeSuccess();
      }).catch(function(err){
        console.warn('[launchdesk] 세팅 대행 신청 접수 중 오류:', err && err.message);
        finalizeFailure(err && err.message);
      });
    });

    var setupRestart = document.getElementById('setupRestart');
    if(setupRestart) setupRestart.addEventListener('click', function(){
      setupForm.reset(); // 폼 내부 요소인 setupConsentPrivacy 체크박스도 함께 미체크로 초기화된다
      clearConsentError();
      clearSubmitError();
      var defaultPlan = setupView.querySelector('.setup-plan[data-plan="basic"]');
      if(defaultPlan) setupSelectPlan(defaultPlan);
      setupShowStep(1);
    });

    var setupMailBtn = document.getElementById('setupMailBtn');
    if(setupMailBtn) setupMailBtn.addEventListener('click', function(){
      /* GA4 setup_mail_click — fires alongside the button's own mailto:
         href (set in finalizeSuccess above), which the browser follows
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
