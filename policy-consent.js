/* 회원가입 필수 동의(이용약관 · 개인정보 수집·이용) — DOM/Supabase 연결.
   policy-consent-core.js(순수 로직)가 없으면 안전하게 아무 것도 하지
   않는다(analytics-consent.js와 같은 원칙).

   이 파일이 노출하는 window.launchdeskPolicyConsent가 app.js와 만나는
   유일한 접점이다:
     - loginForm 제출(회원가입 모드)과 startOAuthLogin('google')이
       bothSignupConsentChecked()/revealSignupConsent() 등을 호출해
       "체크 안 하면 진행 안 됨"을 강제한다.
     - handleSession()이 launchdeskStore.hydrate() 호출 "직전"에
       ensureConsent(user)를 호출한다 — 그 Promise가 true로 풀려야만
       하이드레이트가 진행된다(app.js 쪽 수정은 최소 훅 지점만).

   설계 원칙(요구사항 반영):
     1) pending(sessionStorage)은 절대 "동의 완료 증거"가 아니다. insert를
        시도했든 안 했든, 최종 판정은 항상 DB 재조회(queryHasConsent)로만
        내린다 — 23505(중복)도 무조건 성공 취급하지 않는다.
     2) 같은 user_id에 대해 동시에 여러 확인이 시작되지 않도록
        single-flight(flight)로 묶고, "이 확인이 아직 유효한가"를
        epoch로 판별한다 — 로그아웃/다른 계정 전환이 끼어들면 epoch가
        바뀌어 이전 체인은 자동으로 무효(aborted) 처리된다.
     3) 인증 이벤트 콜백(onAuthStateChange) 자체는 이 흐름을 시작만
        시키고 곧바로 리턴한다 — 실제 확인/게이트 대기는 별도로 이어지는
        Promise 체인이 담당한다(app.js handleSession 참고). */
(function(){
  'use strict';
  var core = window.launchdeskPolicyConsentCore;
  if(!core) return;

  // ---------------------------------------------------------------- 동의 블록(체크박스 2개)
  function makeConsentBlock(ids){
    var termsEl = document.getElementById(ids.termsId);
    var privacyEl = document.getElementById(ids.privacyId);
    var errorEl = document.getElementById(ids.errorId);
    var blockEl = ids.blockId ? document.getElementById(ids.blockId) : null;
    return {
      bothChecked: function(){ return !!(termsEl && termsEl.checked && privacyEl && privacyEl.checked); },
      focusFirst: function(){ if(termsEl) termsEl.focus(); },
      focusFirstUnchecked: function(){
        if(termsEl && !termsEl.checked){ termsEl.focus(); return; }
        if(privacyEl && !privacyEl.checked){ privacyEl.focus(); return; }
      },
      showError: function(msg){ if(errorEl){ errorEl.textContent = msg; errorEl.hidden = false; } },
      clearError: function(){ if(errorEl){ errorEl.textContent = ''; errorEl.hidden = true; } },
      reveal: function(){ if(blockEl) blockEl.hidden = false; },
      hide: function(){ if(blockEl) blockEl.hidden = true; },
      reset: function(){
        if(termsEl) termsEl.checked = false;
        if(privacyEl) privacyEl.checked = false;
        this.clearError();
      }
    };
  }

  var signupBlock = makeConsentBlock({ termsId: 'signupConsentTerms', privacyId: 'signupConsentPrivacy', errorId: 'signupConsentError', blockId: 'signupConsentBlock' });
  var gateBlock = makeConsentBlock({ termsId: 'gateConsentTerms', privacyId: 'gateConsentPrivacy', errorId: 'gateConsentError', blockId: null });

  // ---------------------------------------------------------------- pending(sessionStorage)
  // 개인정보(이메일/이름 등)는 절대 담지 않는다 — 버전 · source · 생성시각뿐.
  function readPendingRaw(){
    try{ return sessionStorage.getItem(core.PENDING_KEY); }catch(e){ return null; }
  }
  function removePending(){
    try{ sessionStorage.removeItem(core.PENDING_KEY); }catch(e){}
  }
  function stashPending(source){
    try{ sessionStorage.setItem(core.PENDING_KEY, core.serializePending(source)); }catch(e){}
  }
  // 읽는 즉시 지운다 — 유효하든 아니든 1회성. 다른 계정의 다음 로그인이
  // 이전 시도의 pending을 잘못 이어받는 일을 막는다(요구사항 3).
  function consumeValidPending(){
    var raw = readPendingRaw();
    removePending();
    return core.parsePending(raw);
  }

  // ---------------------------------------------------------------- DB 접근
  // insert 자체의 성공/실패는 판정에 쓰지 않는다 — 항상 queryHasConsent로
  // 재확인한다(요구사항 2). 여기서는 실패를 콘솔에만 남긴다(이메일/토큰/
  // 비밀번호는 로그에 남기지 않는다 — user_id/오류 메시지만).
  function queryHasConsent(userId){
    var sb = window.launchdeskSupabase;
    if(!sb) return Promise.resolve({ ok: false, dbError: true });
    return sb.from('user_policy_consents')
      .select('id')
      .eq('user_id', userId)
      .eq('terms_version', core.TERMS_VERSION)
      .eq('privacy_version', core.PRIVACY_VERSION)
      .maybeSingle()
      .then(function(res){
        if(res.error){
          console.warn('[launchdesk] 동의 이력 확인 실패:', res.error.message);
          return { ok: false, dbError: true };
        }
        return { ok: !!res.data };
      })
      .catch(function(err){
        console.warn('[launchdesk] 동의 이력 확인 중 오류:', err && err.message);
        return { ok: false, dbError: true };
      });
  }

  function insertConsent(userId, source){
    var sb = window.launchdeskSupabase;
    if(!sb) return Promise.resolve();
    return sb.from('user_policy_consents').insert({
      user_id: userId,
      terms_version: core.TERMS_VERSION,
      privacy_version: core.PRIVACY_VERSION,
      source: source
    }).then(function(res){
      if(res.error && !core.isDuplicateInsertError(res.error)){
        console.warn('[launchdesk] 동의 이력 저장 실패(재조회로 재확인 예정):', res.error.message);
      }
    }).catch(function(err){
      console.warn('[launchdesk] 동의 이력 저장 중 오류(재조회로 재확인 예정):', err && err.message);
    });
  }

  // insert를 시도한 뒤(성공/실패/중복 무관) 항상 재조회로 최종 판정한다.
  function attemptInsertThenVerify(userId, source){
    return insertConsent(userId, source).then(function(){
      return queryHasConsent(userId);
    });
  }

  // ---------------------------------------------------------------- 포커스 트랩(게이트 전용)
  function getFocusable(container){
    var sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(container.querySelectorAll(sel), function(el){
      return !!(el.offsetWidth || el.offsetHeight || el === document.activeElement);
    });
  }
  var trapHandler = null;
  function installFocusTrap(container){
    trapHandler = function(e){
      if(e.key !== 'Tab') return;
      var items = getFocusable(container);
      if(!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', trapHandler);
  }
  function removeFocusTrap(container){
    if(trapHandler) container.removeEventListener('keydown', trapHandler);
    trapHandler = null;
  }

  // ---------------------------------------------------------------- 게이트 모달
  var gateModal = document.getElementById('consentGateModal');
  var gateSubmitBtn = document.getElementById('gateConsentSubmit');
  var gateLogoutBtn = document.getElementById('gateConsentLogout');
  var gateState = null;     // { userId, aborted, resolve } — 현재 열린 게이트가 기다리는 대상
  var submitting = false;   // 저장 요청 중 중복 클릭 방지
  var logoutBusy = false;   // 로그아웃 처리 중 중복 클릭 방지
  var previousFocus = null;

  function setGateSubmitBusy(busy){
    if(!gateSubmitBtn) return;
    gateSubmitBtn.disabled = busy;
    gateSubmitBtn.textContent = busy ? '처리 중...' : '동의하고 계속하기';
  }
  function setGateLogoutBusy(busy){
    if(!gateLogoutBtn) return;
    gateLogoutBtn.disabled = busy;
  }

  function showGate(opts){
    if(!gateModal) return;
    gateBlock.reset(); // 재시도 때도 항상 미체크로 시작(요구사항 1)
    if(opts && opts.dbError){
      gateBlock.showError('동의 정보를 확인할 수 없어요. 잠시 후 다시 시도해주세요.');
    }
    submitting = false;
    logoutBusy = false;
    setGateSubmitBusy(false);
    setGateLogoutBusy(false);
    previousFocus = document.activeElement;
    gateModal.classList.add('open');
    installFocusTrap(gateModal);
    gateBlock.focusFirst();
  }
  function hideGate(){
    if(!gateModal) return;
    gateModal.classList.remove('open');
    removeFocusTrap(gateModal);
    if(previousFocus && typeof previousFocus.focus === 'function'){
      try{ previousFocus.focus(); }catch(e){}
    }
    previousFocus = null;
  }

  function openGateAndWait(userId, aborted, opts){
    return new Promise(function(resolve){
      if(aborted()){ resolve(false); return; }
      gateState = { userId: userId, aborted: aborted, resolve: resolve };
      showGate(opts);
    });
  }

  if(gateSubmitBtn){
    gateSubmitBtn.addEventListener('click', function(){
      if(!gateState || submitting) return;
      var state = gateState;
      if(state.aborted()){
        if(gateState === state) gateState = null;
        hideGate();
        state.resolve(false);
        return;
      }
      if(!gateBlock.bothChecked()){
        gateBlock.showError('필수 동의 항목을 확인해주세요');
        gateBlock.focusFirstUnchecked();
        return;
      }
      submitting = true;
      setGateSubmitBusy(true);
      gateBlock.clearError();
      attemptInsertThenVerify(state.userId, core.SOURCES.EXISTING_USER_GATE).then(function(res){
        submitting = false;
        setGateSubmitBusy(false);
        if(state.aborted()){
          if(gateState === state) gateState = null;
          hideGate();
          state.resolve(false);
          return;
        }
        if(res.ok){
          if(gateState === state) gateState = null;
          hideGate();
          state.resolve(true);
          return;
        }
        // 저장 실패 — 동의 완료로 처리하지 않는다. 모달을 닫지 않고 재시도
        // 가능하게 남겨둔다(요구사항 7).
        gateBlock.showError('문제가 발생했어요. 잠시 후 다시 시도해주세요.');
      });
    });
  }

  if(gateLogoutBtn){
    gateLogoutBtn.addEventListener('click', function(){
      if(!gateState || logoutBusy) return;
      var state = gateState;
      var sb = window.launchdeskSupabase;
      logoutBusy = true;
      setGateLogoutBusy(true);
      function finish(){
        logoutBusy = false;
        setGateLogoutBusy(false);
        if(gateState === state) gateState = null;
        hideGate();
        state.resolve(false); // 로그아웃 선택 — hydrate로 이어지지 않는다
      }
      if(!sb){ finish(); return; }
      // flushAllPendingSteps()를 호출하지 않는다 — 이 게이트가 열려 있는
      // 동안은 launchdeskStore.hydrate()가 아직 실행되지 않아 항상
      // state.authed === false이므로(store.js) 실제로는 no-op이었지만,
      // "동의를 거부한 사용자의 로그아웃 경로에서 STEP 저장 관련 함수를
      // 아예 호출하지 않는다"를 코드 자체가 보장하도록 호출을 없앤다 —
      // 이후 다른 코드가 바뀌어도 이 경로에서 STEP/계획/마진 기록 쓰기가
      // 발생할 길을 원천적으로 남기지 않는다. sb.auth.signOut()만
      // 수행한다 — 세션 종료 외에는 어떤 쓰기도 하지 않는다.
      sb.auth.signOut()
        .then(finish)
        .catch(function(err){
          console.warn('[launchdesk] 동의 게이트 로그아웃 실패:', err && err.message);
          logoutBusy = false;
          setGateLogoutBusy(false);
          gateBlock.showError('로그아웃에 실패했어요. 잠시 후 다시 시도해주세요.');
        });
    });
  }

  // ---------------------------------------------------------------- single-flight + epoch
  var epoch = 0;
  var flight = null; // { userId, promise }

  function ensureConsent(user){
    if(!user || !user.id) return Promise.resolve(false);
    if(flight && flight.userId === user.id) return flight.promise;

    var userId = user.id;
    var myEpoch = ++epoch;
    function aborted(){ return myEpoch !== epoch; }

    var promise = queryHasConsent(userId).then(function(existing){
      if(aborted()) return false;
      if(existing.ok) return true;
      if(existing.dbError){
        return openGateAndWait(userId, aborted, { dbError: true });
      }
      var pending = consumeValidPending();
      if(!pending){
        return openGateAndWait(userId, aborted, {});
      }
      return attemptInsertThenVerify(userId, pending.source).then(function(res){
        if(aborted()) return false;
        if(res.ok) return true;
        return openGateAndWait(userId, aborted, { dbError: !!res.dbError });
      });
    });

    flight = { userId: userId, promise: promise };
    promise.then(function(){
      if(flight && flight.userId === userId) flight = null;
    });
    return promise;
  }

  function handleSignedOut(){
    epoch++; // 대기 중이던 모든 이전 체인을 무효화
    flight = null;
    removePending();
    if(gateState){
      var state = gateState;
      gateState = null;
      hideGate();
      state.resolve(false);
    }
  }

  // ---------------------------------------------------------------- app.js 공개 API
  window.launchdeskPolicyConsent = {
    ensureConsent: ensureConsent,
    handleSignedOut: handleSignedOut,
    stashPending: stashPending,
    clearPending: removePending,
    bothSignupConsentChecked: function(){ return signupBlock.bothChecked(); },
    revealSignupConsent: function(){ signupBlock.reveal(); },
    setSignupConsentVisible: function(visible){ if(visible) signupBlock.reveal(); else signupBlock.hide(); },
    showSignupConsentError: function(msg){ signupBlock.showError(msg); },
    clearSignupConsentError: function(){ signupBlock.clearError(); },
    focusFirstUncheckedSignupConsent: function(){ signupBlock.focusFirstUnchecked(); },
    resetSignupConsent: function(){ signupBlock.reset(); }
  };
})();
