/* 회원 전용 문의: 메일 앱 대신 사이트 안에서 작성·전송한다. 메일 서비스 비밀 키는
   브라우저에 두지 않고 contact-inquiry Edge Function에만 보관한다.
   비회원에게는 폼 대신 로그인 안내(#contactGuestNotice)를 보여준다 — 다만 이
   화면 전환은 편의일 뿐이고, 실제 회원 확인은 Edge Function이 요청의 로그인
   토큰으로 다시 한다(이 파일의 판단을 믿지 않는다). */
(function(){
  'use strict';
  var form = document.getElementById('contactForm');
  if(!form) return;

  var guestNotice = document.getElementById('contactGuestNotice');
  var category = document.getElementById('contactCategory');
  var email = document.getElementById('contactEmail');
  var phone = document.getElementById('contactPhone');
  var subject = document.getElementById('contactSubject');
  var message = document.getElementById('contactMessage');
  var consent = document.getElementById('contactConsent');
  var website = document.getElementById('contactWebsite');
  var status = document.getElementById('contactFormStatus');
  var submit = document.getElementById('contactSubmit');
  var defaults = {
    beginner: '쇼핑몰 시작 질문',
    service: '사이트 이용·오류 문의',
    partner: '택배·도매 제휴 문의'
  };
  var sending = false;
  var member = null;       // 현재 로그인 사용자(없으면 null)
  var prefilledEmail = ''; // 계정 이메일로 자동 채운 값 — 사용자가 직접 고쳤는지 구분용
  // 같은 "문의 내용"을 재시도하는 동안(발송 실패·응답 유실)에는 같은 key를
  // 재사용해 서버·Resend가 중복 발송을 막을 수 있게 하고, 성공하거나 사용자가
  // 입력을 고쳐 다시 제출하면(다른 내용) 새 key로 바꾼다 — 그래야 서버가
  // "이미 처리된 요청"으로 착각해 고친 내용은 실제로 보내지 않고 예전 응답만
  // 돌려주는 일이 없다(서버도 idempotencyKey+내용 해시 조합으로 같은 방식
  // 이중 확인한다 — supabase/functions/contact-inquiry/index.ts 참고).
  // 페이지를 새로고침하면 자연히 새 key가 생긴다(그 경우까지 재사용 판단은
  // 못 한다 — 알려진 한계, docs/contact-inquiry-rollout.md 참고).
  var idempotencyKey = '';
  var idempotencyFingerprint = '';
  function makeUuid(){
    if(window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    // 아주 오래된 브라우저용 최소 대체 — 이 값은 비밀값이 아니라 중복 발송
    // 방지용 식별자일 뿐이라 암호학적 난수일 필요는 없다.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function contentFingerprint(){
    // 실제 값 자체를 저장하지 않고 이번 실행에서만 비교하는 용도라 해시할
    // 필요 없이 구분자로 이어붙인 문자열이면 충분하다(서버가 최종 판단).
    return [category.value, email.value.trim(), phone.value.trim(), subject.value.trim(), message.value.trim()].join('\u0000');
  }
  function ensureIdempotencyKey(fingerprint){
    if(idempotencyKey && idempotencyFingerprint === fingerprint) return idempotencyKey;
    idempotencyKey = makeUuid();
    idempotencyFingerprint = fingerprint;
    return idempotencyKey;
  }
  function readInvokeErrorBody(error){
    // stores.js/ops-overview.js와 동일한 이유로 이 파일 안에 별도 선언
    // (각자 다른 최상위 IIFE라 공유 불가) — functions.invoke 에러 응답의
    // JSON body(예: { error: 'QUOTA_REACHED' })를 안전하게 읽는다.
    if(error && error.context && typeof error.context.json === 'function'){
      return error.context.json().catch(function(){ return null; });
    }
    return Promise.resolve(null);
  }

  subject.value = defaults[category.value];

  // 화면 곳곳의 "질문하기"(a[data-ask-subject], href="#/contact")에서 왔을 때
  // 어느 화면인지 문의 유형 · 제목 기본값에 반영한다. 값은 링크의 data 속성 →
  // 이 메모리 변수로만 옮긴다(URL · 브라우저 저장소에 싣지 않음). 이용자가
  // 제목을 직접 고쳤거나 문의 내용을 쓰기 시작했다면 아무것도 바꾸지 않는다.
  var autoSubject = subject.value;
  function subjectIsDefault(){
    var v = subject.value.trim();
    return !v || v === autoSubject || Object.keys(defaults).some(function(key){ return v === defaults[key]; });
  }
  document.addEventListener('click', function(e){
    var link = e.target.closest ? e.target.closest('a[data-ask-subject]') : null;
    if(!link || message.value.trim() || !subjectIsDefault()) return;
    var cat = link.getAttribute('data-ask-category');
    if(Object.prototype.hasOwnProperty.call(defaults, cat)) category.value = cat;
    subject.value = autoSubject = link.getAttribute('data-ask-subject').slice(0, 100);
  });

  function showStatus(text, isError){
    status.textContent = text;
    status.hidden = false;
    status.classList.toggle('is-error', !!isError);
  }

  function readyToSubmit(){
    submit.disabled = sending || !member;
  }

  // 답장받을 이메일은 로그인 계정 이메일을 기본값으로 채운다. 사용자가 다른
  // 주소로 고쳤다면 덮어쓰지 않는다(계정이 바뀌었을 때 이전 계정 이메일이
  // 남지 않도록, 자동으로 채운 값 그대로일 때만 교체·삭제한다).
  function prefillEmail(accountEmail){
    var current = email.value.trim();
    if(!current || current === prefilledEmail) email.value = accountEmail;
    prefilledEmail = accountEmail;
  }

  function applySession(session){
    var user = session && session.user;
    member = user || null;
    if(guestNotice) guestNotice.hidden = !!member;
    form.hidden = !member;
    prefillEmail(member && typeof member.email === 'string' ? member.email : '');
    readyToSubmit();
  }

  category.addEventListener('change', function(){
    var oldValue = subject.value;
    if(!oldValue.trim() || Object.keys(defaults).some(function(key){ return oldValue === defaults[key]; })){
      subject.value = defaults[category.value];
    }
  });

  form.addEventListener('input', function(){
    if(status.classList.contains('is-error')) status.hidden = true;
  });

  form.addEventListener('submit', async function(event){
    event.preventDefault();
    if(sending || !member) return;
    if(!form.reportValidity()) return;
    if(!consent.checked){ showStatus('개인정보 수집·이용에 동의해 주세요.', true); consent.focus(); return; }
    var payload = {
      category: category.value,
      email: email.value.trim(),
      phone: phone.value.trim(),
      subject: subject.value.trim(),
      message: message.value.trim(),
      consent: consent.checked,
      website: website.value,
      idempotencyKey: ensureIdempotencyKey(contentFingerprint())
    };
    if(payload.subject.length < 4 || payload.message.length < 20){
      showStatus('제목은 4자 이상, 문의 내용은 20자 이상 적어주세요.', true);
      return;
    }
    if(!window.launchdeskSupabase || !window.launchdeskSupabase.functions){
      showStatus('문의 기능에 연결하지 못했어요. 아래 이메일로 직접 보내주세요.', true);
      return;
    }
    sending = true;
    readyToSubmit();
    showStatus('문의를 보내고 있어요. 잠시만 기다려 주세요.', false);
    try {
      // 로그인 상태에서 functions.invoke는 현재 세션의 access token을
      // Authorization 헤더로 함께 보낸다 — 서버는 이 토큰으로 회원을 확인한다.
      var result = await window.launchdeskSupabase.functions.invoke('contact-inquiry', { body: payload });
      if(result.error){
        var body = await readInvokeErrorBody(result.error);
        var code = body && body.error;
        // 429 중에서도 "오늘 쓸 수 있는 횟수를 다 썼다"는 다른 실패(일시적
        // 오류 등, 다시 시도하면 될 수 있는 경우)와 구분해서 알려준다 —
        // 재시도해도 소용없다는 걸 분명히 해야 한다.
        if(code === 'LOGIN_REQUIRED'){
          showStatus('로그인이 필요해요. 다시 로그인한 뒤 보내주세요. 입력한 내용은 그대로 남아 있습니다.', true);
        } else if(code === 'QUOTA_REACHED'){
          showStatus('오늘 문의 가능 횟수를 모두 사용했어요. 내일 다시 시도하시거나 아래 이메일로 직접 보내주세요.', true);
        } else if(code === 'ATTEMPT_LIMIT'){
          showStatus('지금은 문의를 보낼 수 없어요. 잠시 후 다시 시도하시거나 아래 이메일로 직접 보내주세요.', true);
        } else {
          showStatus('전송에 실패했어요. 입력한 내용은 그대로 남아 있습니다. 잠시 후 다시 시도해 주세요.', true);
        }
        return; // idempotencyKey를 비우지 않는다 — 같은 문의를 재시도할 때 재사용
      }
      if(!result.data || result.data.ok !== true) throw new Error('SEND_FAILED');
      form.reset();
      subject.value = defaults.beginner;
      email.value = prefilledEmail; // 다음 문의도 계정 이메일을 기본값으로
      idempotencyKey = ''; // 다음 문의는 새 key로 시작
      idempotencyFingerprint = '';
      showStatus('문의가 접수됐어요. 입력하신 이메일로 답변드릴게요.', false);
    } catch(_error){
      // functions.invoke 자체가 던진 경우(네트워크 오류 등) — 서버가 실제로
      // 처리했는지 알 수 없다. idempotencyKey를 유지한 채 재시도하면 서버가
      // 이미 처리된 요청인지 스스로 판단해 중복 발송하지 않는다.
      showStatus('전송에 실패했어요. 입력한 내용은 그대로 남아 있습니다. 잠시 후 다시 시도해 주세요.', true);
    } finally {
      sending = false;
      readyToSubmit();
    }
  });

  var sb = window.launchdeskSupabase;
  if(sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function'){
    // 구독 즉시 현재 세션(INITIAL_SESSION)으로 한 번 호출되고, 이후 로그인·
    // 로그아웃·토큰 갱신 때마다 다시 호출된다.
    sb.auth.onAuthStateChange(function(_event, session){ applySession(session); });
  } else {
    applySession(null);
  }
})();
