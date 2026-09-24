/* window.launchdeskPlans — 계획(plans) 화면·저장 모듈.

   "계산 결과 → 계획 저장 → 실행 → 재확인" 흐름의 화면 쪽 전부를 담당한다:
   1) 계산기 결과 아래 "이 조건으로 계획 만들기" → 계획 폼(#mcPlanForm)
   2) 게스트 초안(localStorage) 보존 → 로그인 모달 → 폼 복원 → 사용자가
      직접 저장 확정(자동 insert 없음)
   3) 홈 "내 계획" 패널(#ldPlanPanel): 지난·오늘 → 예정 → 완료(분리)
   4) 상세: 실행 체크 · 메모 저장 · 재확인일 미루기 · 완료 · 삭제 · 계산기로 열기

   순수 로직(날짜·분류·검증·초안 직렬화)은 plans-core.js에 있고 여기서는
   DOM과 Supabase 호출만 한다. 저장소는 public.plans 테이블 하나
   (20260916100000_plans.sql) — tool_records(계산 기록)와 완전히 분리돼 있고,
   계획을 만들어도 계산 기록(addCalcRecord)은 생성하지 않는다.

   보안 경계: 브라우저는 publishable key + 사용자 세션으로만 plans를 읽고
   쓴다(RLS가 본인 행만 허용). user_id는 세션에서 가져온 값만 보낸다.
   스냅샷(calc_snapshot)은 생성 후 DB가 변경을 거부하므로 계산기에서 다시
   불러와 수정해도 계획 쪽 값은 바뀌지 않는다.

   계정 분리: 로그인/로그아웃/계정 전환(launchdeskStore.onChange)마다 seq를
   올려 이전 사용자 요청의 늦은 응답이 새 화면·초안을 건드리지 못하게 한다
   (ops-overview.js와 같은 방식). 열린 상세/폼/초안 UI도 그때 함께 정리한다.

   index.html에서 store.js/app.js/tools.js/home-dashboard.js보다 뒤에 로드한다
   (window.launchdeskMarginCalcUI · launchdeskOpenLoginModal을 쓴다). */
(function(){
  var PC = window.launchdeskPlansCore;
  if(!PC) return;
  function client(){ return window.launchdeskSupabase || null; }
  function byId(id){ return document.getElementById(id); }

  // app.js/tools.js와 동일한 toast(각자 다른 최상위 IIFE라 공유 불가).
  var toastStack = document.getElementById('toastStack');
  function showToast(message, type){
    if(!toastStack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    toastStack.appendChild(el);
    requestAnimationFrame(function(){ el.classList.add('show'); });
    setTimeout(function(){
      el.classList.remove('show');
      setTimeout(function(){ el.remove(); }, 250);
    }, 2600);
  }

  // 사용자 입력은 innerHTML로 넣지 않는다 — 전부 createElement + textContent.
  function el(tag, attrs, children){
    var node = document.createElement(tag);
    if(attrs){
      Object.keys(attrs).forEach(function(k){
        var v = attrs[k];
        if(v === undefined || v === null || v === false) return;
        if(k === 'className') node.className = v;
        else if(k === 'text') node.textContent = v;
        else if(k === 'hidden') node.hidden = !!v;
        else if(k === 'disabled') node.disabled = !!v;
        else if(k === 'checked') node.checked = !!v;
        else if(k === 'value') node.value = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function(c){
      if(c === null || c === undefined || c === false) return;
      if(typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  var PLAN_COLS = 'id, client_request_id, title, action_text, review_date, status, executed, review_note, reviewed_at, done_at, calc_version, calc_snapshot, created_at, updated_at';
  var DRAFT_KEY = 'ld-plan-draft';

  function track(eventName){
    // 분석 실패는 절대 사용자 작업을 막지 않는다 — DB 성공을 확인한 "뒤"에만
    // 호출되고, 여기서 던지는 오류도 전부 삼킨다.
    try{
      if(window.launchdeskProductEvents && typeof window.launchdeskProductEvents.track === 'function'){
        window.launchdeskProductEvents.track(eventName);
      }
    }catch(e){ console.warn('[launchdesk] plan 이벤트 기록 준비 중 오류(무시):', e && e.message); }
  }

  // ------------------------------------------------------------ 초안 저장소
  // localStorage 사용 불가(프라이빗 모드·차단)면 null — 초안 기능만 조용히
  // 꺼지고 나머지는 정상 동작한다. 만료/깨진 값은 읽는 시점에 삭제한다.
  function storage(){
    try{
      var s = window.localStorage;
      s.getItem(DRAFT_KEY);
      return s;
    }catch(e){ return null; }
  }
  function readDraft(){
    var s = storage();
    if(!s) return null;
    var raw = null;
    try{ raw = s.getItem(DRAFT_KEY); }catch(e){ return null; }
    var parsed = PC.parseDraft(raw, Date.now());
    if(!parsed.draft && parsed.reason !== 'none'){
      try{ s.removeItem(DRAFT_KEY); }catch(e){}
    }
    return parsed.draft;
  }
  // 쓰기 성공은 "예외가 없었다"가 아니라 "다시 읽어서 같은 초안이 나온다"로
  // 판정한다 — 용량 초과·프라이빗 모드처럼 setItem이 조용히 실패하거나
  // 즉시 지워지는 환경에서 저장 성공으로 표시하지 않기 위함.
  function writeDraft(draft){
    var s = storage();
    if(!s) return false;
    try{
      s.setItem(DRAFT_KEY, JSON.stringify(draft));
      var back = PC.parseDraft(s.getItem(DRAFT_KEY), Date.now());
      return !!(back.draft && back.draft.client_request_id === draft.client_request_id);
    }catch(e){
      console.warn('[launchdesk] 계획 초안을 이 브라우저에 보관하지 못함:', e && e.message);
      return false;
    }
  }
  // 저장 성공/버리기 뒤 삭제 — 다른 탭이 그 사이 "다른" 초안을 써 뒀다면
  // 그건 지우지 않는다(ID 일치할 때만).
  function removeDraftIfMatches(requestId){
    var s = storage();
    if(!s) return false;
    var cur = readDraft();
    if(!cur || cur.client_request_id !== requestId) return false;
    try{ s.removeItem(DRAFT_KEY); return true; }catch(e){ return false; }
  }
  function visibleDraft(){
    var d = readDraft();
    return PC.draftVisibleFor(d, currentUserId) ? d : null;
  }

  // ------------------------------------------------------------ 상태
  var currentUserId = null;
  var currentUserLabel = '';
  var seq = 0; // 로그인/로그아웃/계정 전환마다 증가 — 늦은 응답 무시용
  var today = PC.kstToday();

  var plans = [];
  var listState = 'guest'; // 'guest' | 'loading' | 'error' | 'ready'
  var openDetailId = null;
  var showAllUpcoming = false;
  var busy = {}; // plan id → 진행 중 요청 여부(중복 클릭 방지)
  var detailScratch = null; // 재렌더 시 상세 영역의 미저장 입력(메모/날짜) 보존

  // saveRequested: 이 폼에서 사용자가 "저장"을 한 번이라도 눌렀는지(게스트
  //   초안 보존은 이 명시적 행동 뒤에만 한다 — 폼을 열기만 한 내용을 몰래
  //   localStorage에 남기지 않는다).
  // persisted: 마지막 보존 시도가 성공했는지. 실패 상태에서 OAuth(페이지
  //   이동)로 나가면 작성 내용이 사라지므로 app.js가 떠나기 전에 확인한다.
  var form = { open: false, snapshot: null, requestId: null, fromDraft: false, ownerUserId: null, saving: false, saveRequested: false, persisted: false };
  var dismissedDraftId = null; // 폼을 닫은 초안은 이 페이지에서 자동으로 다시 열지 않는다(홈 안내로는 열 수 있음)

  var home = {
    panel: byId('ldPlanPanel'), body: byId('ldPlanBody'), draft: byId('ldPlanDraftNotice'), headNote: byId('ldPlanHeadNote')
  };
  var f = {
    wrap: byId('mcPlanForm'), openBtn: byId('mcPlanOpen'), banner: byId('mcPlanBanner'), snapshot: byId('mcPlanSnapshot'),
    title: byId('mcPlanTitle'), action: byId('mcPlanAction'), date: byId('mcPlanDate'), account: byId('mcPlanAccount'),
    error: byId('mcPlanError'), save: byId('mcPlanSave'), discard: byId('mcPlanDiscard'), close: byId('mcPlanClose'),
    ttl: byId('mcPlanTtlNote'), mismatch: byId('mcPlanMismatch'), useCurrent: byId('mcPlanUseCurrent')
  };
  // 운영 현황의 "내 계획" 카드(#ldPlanPanel)와 계산기의 "이 조건으로 계획 만들기"
  // 버튼(#mcPlanOpen)은 현재 화면에서 뺐다 — 저장한 계획을 볼 곳이 없는데 새로
  // 만들게 두면 막힌 동선이 되므로, 버튼이 없으면 폼(초안 자동 복원 포함)도
  // 열지 않는다. 기존 계획 데이터(public.plans)는 지우지 않고, 조회도 하지 않는다.
  var hasForm = !!(f.wrap && f.openBtn && f.title && f.action && f.date && f.save);
  var hasHome = !!(home.panel && home.body);

  function nowIso(){ return new Date().toISOString(); }
  function fieldErr(key){ return f.wrap ? f.wrap.querySelector('[data-plan-err="' + key + '"]') : null; }
  function userLabelOf(user){
    if(!user) return '';
    var email = user.email || '';
    if(email) return email.split('@')[0] || email;
    var meta = user.user_metadata || {};
    return meta.name || meta.full_name || meta.preferred_username || '로그인한 계정';
  }

  // ------------------------------------------------------------ 계획 폼
  function setFormErrors(errors){
    ['title', 'action_text', 'review_date'].forEach(function(k){
      var e = fieldErr(k);
      if(e) e.textContent = (errors && errors[k]) || '';
    });
  }
  function setFormMessage(msg){
    if(!f.error) return;
    f.error.textContent = msg || '';
    f.error.hidden = !msg;
  }
  function refreshFormAccountUi(){
    if(!hasForm) return;
    if(currentUserId){
      f.account.textContent = '현재 계정: ' + currentUserLabel + ' · 이 계정에 저장돼요';
      f.save.textContent = '계획 저장';
    } else {
      f.account.textContent = '로그인 후 작성한 내용을 확인하고 저장할 수 있어요.';
      f.save.textContent = '로그인하고 저장하기';
    }
    f.save.disabled = form.saving;
    if(f.discard) f.discard.hidden = !form.fromDraft;
  }
  function fillForm(values){
    f.title.value = values.title || '';
    f.action.value = values.action_text || '';
    f.date.value = values.review_date || '';
    f.date.min = today;
    f.snapshot.textContent = PC.snapshotSummary(form.snapshot);
    if(f.mismatch) f.mismatch.hidden = true; // 폼을 새로 채우는 시점엔 항상 스냅샷=지금 계산이므로 불일치 없음
    setFormErrors(null);
    setFormMessage('');
  }
  // 계획 폼이 열린 동안 계산기 입력(광고비 포함)이 바뀌어 열었을 때의
  // 스냅샷과 달라졌으면 알려준다. 스냅샷 자체는 여기서 절대 바꾸지
  // 않는다 — 사용자가 "현재 계산으로 새로 시작하기"를 눌러야만 바뀐다.
  function checkSnapshotMismatch(){
    if(!f.mismatch || !form.open || !form.snapshot) return;
    var MCUI = window.launchdeskMarginCalcUI;
    var current = MCUI && typeof MCUI.buildCurrentRecord === 'function' ? MCUI.buildCurrentRecord() : null;
    // 비교할 "지금 계산"이 없으면(예시 모드·미계산) 오탐을 피해 알림을 숨긴다.
    f.mismatch.hidden = !current || PC.snapshotsEqual(current, form.snapshot);
  }
  function showForm(){
    form.open = true;
    f.wrap.hidden = false;
    refreshFormAccountUi();
    checkSnapshotMismatch();
    if(f.ttl) f.ttl.textContent = '저장 전 내용(초안)은 이 브라우저에만 ' + Math.round(PC.DRAFT_TTL_MS / 86400000) + '일 동안 보관돼요. 다른 기기에서는 복원되지 않아요.';
  }
  function resetFormState(){
    form.open = false; form.snapshot = null; form.requestId = null; form.fromDraft = false; form.ownerUserId = null; form.saving = false;
    form.saveRequested = false; form.persisted = false;
  }
  // 열린 폼에 사용자가 실제로 쓴 내용이 있는지(다른 초안으로 덮어쓰기 전 확인용).
  function formHasUserContent(){
    if(!hasForm || !form.open) return false;
    return (f.action.value || '').trim() !== '' || (f.title.value || '').trim() !== '';
  }
  // 닫기 = 초안은 그대로(삭제하지 않음). 화면만 정리한다.
  function closeForm(){
    if(!hasForm) return;
    // 닫은 폼의 요청 ID는 이 페이지에서 자동 복원 대상에서 뺀다 — 초안에서
    // 연 폼뿐 아니라, 계산기에서 열었다가 저장 시도로 초안이 남은 폼도 같다
    // (홈의 "이어서 작성하기"로는 언제든 다시 열 수 있다).
    if(form.requestId) dismissedDraftId = form.requestId;
    resetFormState();
    f.wrap.hidden = true;
    f.title.value = ''; f.action.value = ''; f.date.value = '';
    if(f.banner){ f.banner.hidden = true; f.banner.textContent = ''; }
    if(f.mismatch) f.mismatch.hidden = true;
    setFormErrors(null);
    setFormMessage('');
    renderDraftNotice();
  }
  function openFormFromCalc(){
    if(!hasForm) return;
    var MCUI = window.launchdeskMarginCalcUI;
    var rec = MCUI && typeof MCUI.buildCurrentRecord === 'function' ? MCUI.buildCurrentRecord() : null;
    if(!rec || !PC.isValidSnapshot(rec)){
      showToast('필수 입력을 채우고 결과가 나온 뒤에 계획을 만들 수 있어요');
      return;
    }
    // 이미 내용을 적어 둔 폼(복원한 초안 포함)이 열려 있으면 조용히 덮어쓰지 않는다.
    if(formHasUserContent() &&
       !window.confirm('작성 중인 계획 폼이 있어요. 새 계획으로 바꾸면 지금 입력한 내용은 사라져요' +
         (form.persisted ? '(이 브라우저에 보관된 초안은 남아요)' : '') + '. 계속할까요?')) return;
    // 폼을 여는 순간의 계산을 독립 사본으로 고정한다 — 이후 계산기 입력을
    // 바꿔도 이 스냅샷은 바뀌지 않는다.
    form.snapshot = JSON.parse(JSON.stringify(rec));
    form.requestId = PC.newRequestId(window.crypto);
    form.fromDraft = false;
    form.ownerUserId = null;
    form.saving = false;
    form.saveRequested = false;
    form.persisted = false;
    if(f.banner){ f.banner.hidden = true; f.banner.textContent = ''; }
    fillForm({ title: PC.defaultTitle(form.snapshot), action_text: '', review_date: PC.defaultReviewDate(today) });
    showForm();
    f.title.focus();
    f.title.select();
  }
  function openFormFromDraft(draft){
    if(!hasForm || !draft) return;
    form.snapshot = JSON.parse(JSON.stringify(draft.calc_snapshot));
    form.requestId = draft.client_request_id; // 재시도에서도 같은 ID
    form.fromDraft = true;
    form.ownerUserId = draft.owner_user_id || null;
    form.saving = false;
    form.saveRequested = true; // 초안은 저장을 눌렀을 때만 생기므로, 복원된 폼은 이미 저장 요청된 상태
    form.persisted = true;     // 방금 저장소에서 읽어 왔으니 현재 내용은 보존돼 있다
    fillForm({ title: draft.title, action_text: draft.action_text, review_date: draft.review_date });
    if(f.banner){
      f.banner.textContent = form.ownerUserId
        ? '저장하지 않은 초안을 불러왔어요. 내용을 확인하고 저장을 눌러주세요.'
        : '로그인 전 작성한 초안을 불러왔어요. 내용을 확인하고 저장을 눌러주세요.';
      f.banner.hidden = false;
    }
    // 재확인일이 지난 초안: 값을 몰래 바꾸지 않고 수정만 안내한다.
    var dateErr = PC.validateNewReviewDate(draft.review_date, today);
    if(dateErr) setFormErrors({ review_date: dateErr });
    showForm();
  }
  function readFormFields(){
    return { title: f.title.value, action_text: f.action.value, review_date: f.date.value };
  }
  function persistDraft(values, ownerUserId){
    var draft = PC.makeDraft({
      client_request_id: form.requestId,
      title: values.title, action_text: values.action_text, review_date: values.review_date,
      calc_snapshot: form.snapshot, owner_user_id: ownerUserId || null, saved_at: Date.now()
    });
    form.persisted = writeDraft(draft);
    renderDraftNotice(); // 초안이 생기거나 갱신되면 홈 안내도 곧바로 맞춘다(폼을 닫지 않아도)
    return form.persisted;
  }
  var DRAFT_KEEP_FAILED_MSG = '작성 내용을 이 브라우저에 보관하지 못했어요. 이 창에서 이메일로 로그인하면 지금 내용이 그대로 유지되지만, Google·카카오 로그인은 페이지를 이동하므로 내용이 사라질 수 있어요.';
  // app.js가 Google/Kakao 리다이렉트를 시작하기 직전에 부른다(인증 방식 자체는
  // 그대로 — 떠나기 전 확인만 한다). true면 진행, false면 중단.
  //   - 폼이 없거나 사용자가 저장을 누른 적이 없으면 아무 것도 보존하지 않고
  //     그대로 진행한다(폼만 열어 둔 내용을 몰래 저장하지 않는다).
  //   - 저장을 눌렀던 폼이면 지금 입력 그대로 한 번 더 보존을 시도하고,
  //     실패했을 때만 "떠나면 사라진다"를 확인받는다.
  function beforeOAuthRedirect(){
    if(!hasForm || !form.open || !form.saveRequested || currentUserId) return true;
    var raw = readFormFields();
    persistDraft({ title: raw.title, action_text: raw.action_text, review_date: raw.review_date }, null);
    if(form.persisted) return true;
    setFormMessage(DRAFT_KEEP_FAILED_MSG);
    return window.confirm('작성 중인 계획이 이 브라우저에 보관되지 않았어요.\nGoogle/카카오 로그인은 페이지를 이동해 지금 작성한 내용이 사라져요.\n\n그래도 계속할까요? (취소 후 이 창에서 이메일로 로그인하면 내용이 유지돼요)');
  }

  function onSaveClick(){
    if(!hasForm || !form.open || form.saving) return;
    var v = PC.validatePlanInput(readFormFields(), today);
    setFormErrors(v.errors);
    if(!v.ok){ setFormMessage('입력을 확인해주세요.'); return; }
    setFormMessage('');
    form.saveRequested = true;

    if(!currentUserId){
      // 게스트: 초안 보존 → 기존 로그인 모달. 자동 저장은 없다 — 로그인 후
      // 이 폼으로 돌아와 사용자가 직접 저장을 누른다. 폼과 입력은 보존
      // 성공 여부와 무관하게 메모리에 그대로 남는다(같은 페이지 이메일
      // 로그인이면 그대로 이어서 저장 가능).
      var kept = persistDraft(v.values, null);
      form.fromDraft = kept;
      if(f.discard) f.discard.hidden = !kept;
      if(!kept) setFormMessage(DRAFT_KEEP_FAILED_MSG);
      renderDraftNotice();
      if(typeof window.launchdeskOpenLoginModal === 'function'){
        window.launchdeskOpenLoginModal({
          hint: kept
            ? '로그인 후 작성한 내용을 확인하고 저장할 수 있어요.'
            : '작성 내용을 이 브라우저에 보관하지 못했어요. 이 창에서 이메일로 로그인하면 내용이 유지돼요. Google·카카오 로그인은 페이지를 이동해 내용이 사라질 수 있어요.'
        });
      }
      return;
    }

    // 회원: 최초 저장 시도 시점의 계정에 초안을 귀속시킨 뒤 insert.
    var uid = currentUserId;
    if(form.ownerUserId && form.ownerUserId !== uid){
      setFormMessage('이 초안은 다른 계정에서 저장을 시도한 초안이라 이 계정에는 저장할 수 없어요.');
      return;
    }
    form.ownerUserId = uid;
    persistDraft(v.values, uid); // 실패해도 진행(초안은 보조 장치) — 실패 시 saveFailed가 "페이지를 떠나면 사라짐"을 함께 안내
    var rid = form.requestId;
    var snapshot = form.snapshot;
    var my = seq;
    form.saving = true;
    refreshFormAccountUi();
    f.save.textContent = '저장 중…';

    var sb = client();
    if(!sb){ saveFailed(my, null); return; }
    sb.from('plans').insert({
      user_id: uid, client_request_id: rid,
      title: v.values.title, action_text: v.values.action_text, review_date: v.values.review_date,
      calc_snapshot: snapshot
    }).select(PLAN_COLS).single().then(function(res){
      if(my !== seq) return; // 그 사이 로그아웃/계정 전환 — 이 화면은 이미 정리됨
      if(!res.error && res.data){ savedOk(res.data, true, rid); return; }
      var code = res.error && res.error.code;
      if(code !== '23505') console.warn('[launchdesk] 계획 저장 응답 오류(기존 행 확인 후 처리):', res.error && res.error.message);
      // unique 충돌(중복 클릭/재시도) 또는 응답 유실 — 같은 사용자·같은 요청
      // ID로 기존 행을 조회해 "이미 저장됨"인지 확인한다. 기존 행을 재시도
      // payload로 덮어쓰지 않는다.
      lookupExisting(uid, rid).then(function(row){
        if(my !== seq) return;
        if(row) savedOk(row, false, rid);
        else saveFailed(my, res.error);
      });
    }).catch(function(err){
      if(my !== seq) return;
      lookupExisting(uid, rid).then(function(row){
        if(my !== seq) return;
        if(row) savedOk(row, false, rid);
        else saveFailed(my, err);
      });
    });
  }
  function lookupExisting(uid, rid){
    var sb = client();
    if(!sb) return Promise.resolve(null);
    return sb.from('plans').select(PLAN_COLS).eq('user_id', uid).eq('client_request_id', rid).maybeSingle()
      .then(function(res){
        if(res.error){ console.warn('[launchdesk] 계획 기존 행 확인 실패:', res.error.message); return null; }
        return res.data || null;
      }).catch(function(err){ console.warn('[launchdesk] 계획 기존 행 확인 중 오류:', err && err.message); return null; });
  }
  function savedOk(row, created, rid){
    removeDraftIfMatches(rid);
    resetFormState();
    closeForm();
    // 목록에 반영(같은 id가 이미 있으면 교체)
    var idx = plans.findIndex(function(p){ return p.id === row.id; });
    if(idx === -1) plans.push(row); else plans[idx] = row;
    if(listState === 'ready' || listState === 'error') listState = 'ready';
    renderHome();
    showToast(created ? '계획을 저장했어요. 홈에서 확인할 수 있어요.' : '이미 저장된 계획이에요. 홈에서 확인할 수 있어요.', 'success');
    if(created) track('plan_created'); // 중복 확인은 신규 생성이 아니므로 기록하지 않음
  }
  function saveFailed(my, err){
    if(my !== seq) return;
    form.saving = false;
    refreshFormAccountUi();
    setFormMessage('계획을 저장하지 못했어요. 입력은 그대로 두었으니 잠시 후 다시 시도해주세요.'
      + (form.persisted ? '' : ' (작성 내용을 이 브라우저에 보관하지 못해, 페이지를 떠나면 사라질 수 있어요.)'));
    if(err) console.warn('[launchdesk] 계획 저장 실패:', err.message || err);
  }
  function onDiscardClick(){
    if(!hasForm) return;
    if(!window.confirm('초안을 버릴까요? 되돌릴 수 없어요.')) return;
    var rid = form.requestId;
    removeDraftIfMatches(rid);
    dismissedDraftId = null;
    resetFormState();
    closeForm();
    showToast('초안을 버렸어요');
  }

  // 계산기 탭이 보이는 상태에서 볼 수 있는 초안이 있으면 폼을 자동으로
  // 연다(로그인 복귀 포함). 사용자가 닫은 초안은 다시 열지 않는다.
  function calcPaneVisible(){
    var route = location.hash.replace(/^#/, '') || '/';
    if(route !== '/tools') return false;
    var pane = document.querySelector('.tools-pane[data-tools-tab="calc"]');
    return !!(pane && pane.classList.contains('active'));
  }
  function maybeAutoRestore(){
    if(!hasForm || form.open) return;
    var d = visibleDraft();
    if(!d || d.client_request_id === dismissedDraftId) return;
    if(!calcPaneVisible()) return;
    openFormFromDraft(d);
  }
  // 홈 "이어서 작성하기": 초안을 폼에 복원한 뒤 실제 라우팅(#/tools → app.js
  // render() → tools.js가 hashchange에서 계산기 탭 버튼을 click)으로 이동한다.
  // 이미 다른 내용을 작성 중인 폼이 열려 있으면 확인 없이 덮어쓰지 않는다.
  function continueDraft(){
    var d = visibleDraft();
    if(!d){ renderDraftNotice(); return; }
    if(form.open && form.requestId !== d.client_request_id && formHasUserContent()){
      if(!window.confirm('지금 작성 중인 다른 계획 폼이 있어요. 초안으로 바꾸면 그 내용은 사라져요. 계속할까요?')) return;
    }
    dismissedDraftId = null;
    if(!(form.open && form.requestId === d.client_request_id)) openFormFromDraft(d);
    var MCUI = window.launchdeskMarginCalcUI;
    if(MCUI && typeof MCUI.goToCalc === 'function') MCUI.goToCalc();
    else location.hash = '#/tools';
  }

  // ------------------------------------------------------------ 홈: 초안 안내
  // 초안은 이 브라우저(localStorage)에 있는 정보라 계획 목록 조회 상태와
  // 무관하게 보여준다 — OAuth 리다이렉트 후 홈으로 돌아온 직후에도 바로
  // 보인다. 내용은 매번 통째로 다시 그리므로 세션 이벤트가 여러 번 와도
  // 안내가 중복 생성되지 않는다.
  function renderDraftNotice(){
    if(!hasHome || !home.draft) return;
    var d = visibleDraft();
    home.draft.textContent = '';
    if(!d){ home.draft.hidden = true; return; }
    var when = PC.formatDateLabel(PC.kstToday(d.saved_at));
    var text = currentUserId
      ? '작성 중인 계획이 있어요' + (when ? ' (' + when + ' 작성)' : '') + '. 아직 저장되지 않았어요.'
      : '작성 중인 계획이 있어요' + (when ? ' (' + when + ' 작성)' : '') + '. 로그인 후 저장할 수 있어요.';
    var cont = el('button', { type: 'button', className: 'btn btn-primary btn-sm', text: '이어서 작성하기' });
    cont.addEventListener('click', continueDraft);
    var drop = el('button', { type: 'button', className: 'mc-link-btn', text: '초안 버리기' });
    drop.addEventListener('click', function(){
      if(!window.confirm('초안을 버릴까요? 되돌릴 수 없어요.')) return;
      removeDraftIfMatches(d.client_request_id);
      if(form.open && form.requestId === d.client_request_id){ resetFormState(); closeForm(); }
      renderDraftNotice();
      showToast('초안을 버렸어요');
    });
    home.draft.appendChild(el('span', { className: 'ldplan-draft-text', text: text }));
    home.draft.appendChild(el('span', { className: 'ldplan-draft-actions' }, [cont, drop]));
    home.draft.hidden = false;
  }

  // ------------------------------------------------------------ 홈: 목록
  function captureScratch(){
    if(!openDetailId || !home.body) return;
    var note = home.body.querySelector('[data-plan-note="' + openDetailId + '"]');
    var date = home.body.querySelector('[data-plan-date="' + openDetailId + '"]');
    if(note || date) detailScratch = { id: openDetailId, note: note ? note.value : null, date: date ? date.value : null };
  }
  function renderHome(){
    if(!hasHome) return;
    if(home.panel) home.panel.hidden = false;
    captureScratch();
    home.body.textContent = '';
    if(home.headNote) home.headNote.textContent = '';
    renderDraftNotice();

    if(listState === 'guest'){
      // 이 패널은 이제 #/dashboard(운영 현황) 안에서만 산다 — 비회원은 그
      // 화면의 로그인 게이트가 이미 안내하므로, 여기서 다시 "로그인하면..."을
      // 중복으로 보여주지 않고 패널 자체를 숨긴다(요구사항: 비회원 운영
      // 현황에서는 게이트만 표시하고 계획 패널은 숨김).
      if(home.panel) home.panel.hidden = true;
      return;
    }
    if(listState === 'loading'){
      home.body.appendChild(el('p', { className: 'opsdash-empty-note', text: '계획을 불러오는 중…' }));
      return;
    }
    if(listState === 'error'){
      // DB 미준비/조회 실패를 "계획 없음"으로 보여주지 않는다.
      var retry = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: '다시 시도' });
      retry.addEventListener('click', function(){ if(currentUserId){ listState = 'loading'; renderHome(); fetchPlans(seq); } });
      home.body.appendChild(el('div', { className: 'ldplan-error' }, [
        el('p', { className: 'opsdash-empty-note', text: '계획을 불러오지 못했어요. 저장된 계획이 없다는 뜻은 아니에요 — 잠시 후 다시 시도해주세요.' }),
        retry
      ]));
      return;
    }

    var g = PC.groupPlans(plans, today);
    if(!plans.length){
      home.body.appendChild(el('div', { className: 'ldplan-empty' }, [
        el('p', { className: 'opsdash-empty-note', text: '아직 계획이 없어요. 마진 계산기에서 결과를 계획으로 만들어보세요.' }),
        el('a', { href: '#/tools', 'data-tools-target': 'calc', className: 'btn btn-primary btn-sm', text: '마진 계산기에서 첫 계획 만들기' })
      ]));
      return;
    }
    if(home.headNote){
      var activeCount = g.due.length + g.upcoming.length;
      home.headNote.textContent = activeCount ? '진행 중 ' + activeCount + '개' : '진행 중인 계획 없음';
    }

    if(g.due.length){
      home.body.appendChild(el('div', { className: 'ldplan-section-label', text: '지난 날짜 · 오늘' }));
      home.body.appendChild(renderList(g.due));
    }
    if(g.upcoming.length){
      home.body.appendChild(el('div', { className: 'ldplan-section-label', text: '예정' }));
      var limit = PC.UPCOMING_PREVIEW_COUNT;
      var shown = showAllUpcoming ? g.upcoming : g.upcoming.slice(0, limit);
      home.body.appendChild(renderList(shown));
      if(g.upcoming.length > limit){
        var more = el('button', { type: 'button', className: 'mc-link-btn ldplan-more', text: showAllUpcoming ? '예정 접기' : '예정 ' + (g.upcoming.length - limit) + '개 더 보기' });
        more.addEventListener('click', function(){ showAllUpcoming = !showAllUpcoming; renderHome(); });
        home.body.appendChild(more);
      }
    }
    if(!g.due.length && !g.upcoming.length){
      home.body.appendChild(el('p', { className: 'opsdash-empty-note', text: '진행 중인 계획이 없어요. 완료한 계획은 아래에서 볼 수 있어요.' }));
    }
    if(g.done.length){
      var details = el('details', { className: 'ldplan-done' }, [
        el('summary', { text: '완료한 계획 ' + g.done.length + '개' }),
        renderList(g.done)
      ]);
      if(openDetailId && g.done.some(function(p){ return p.id === openDetailId; })) details.open = true;
      home.body.appendChild(details);
    }
  }
  function renderList(items){
    var list = el('div', { className: 'ldplan-list' });
    items.forEach(function(p){ list.appendChild(renderRow(p)); });
    return list;
  }
  function renderRow(p){
    var info = PC.statusInfo(p, today);
    var isOpen = openDetailId === p.id;
    var row = el('div', { className: 'ldplan-row' + (isOpen ? ' open' : ''), 'data-plan-id': p.id });
    var main = el('button', { type: 'button', className: 'ldplan-row-main', 'aria-expanded': isOpen ? 'true' : 'false' }, [
      el('span', { className: 'ldplan-row-head' }, [
        el('span', { className: 'ldplan-row-title', text: p.title }),
        el('span', { className: 'opsdash-pill ' + info.tone, text: info.label })
      ]),
      el('span', { className: 'ldplan-row-meta' }, [
        el('span', { text: '재확인 ' + PC.formatDateLabel(p.review_date) }),
        p.executed ? el('span', { className: 'ldplan-executed', text: '실행함' }) : null
      ]),
      el('span', { className: 'ldplan-row-action', text: PC.truncate(p.action_text, 70) })
    ]);
    main.addEventListener('click', function(){
      openDetailId = isOpen ? null : p.id;
      if(!isOpen) detailScratch = null;
      renderHome();
    });
    row.appendChild(main);
    if(isOpen) row.appendChild(renderDetail(p));
    return row;
  }
  function renderDetail(p){
    var isBusy = !!busy[p.id];
    var scratch = (detailScratch && detailScratch.id === p.id) ? detailScratch : null;
    var box = el('div', { className: 'ldplan-detail' });
    box.appendChild(el('div', { className: 'ldplan-detail-action', text: p.action_text }));

    // 계산 조건(스냅샷) + 계산기로 열기
    var snapOk = PC.isValidSnapshot(p.calc_snapshot);
    var openBtn = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: '계산기로 열기', disabled: !snapOk });
    openBtn.addEventListener('click', function(){ openInCalc(p); });
    box.appendChild(el('div', { className: 'ldplan-snapshot' }, [
      el('div', { className: 'ldplan-snapshot-label', text: '계획 당시 계산 조건' }),
      el('div', { className: 'ldplan-snapshot-text', text: PC.snapshotSummary(p.calc_snapshot) }),
      snapOk ? null : el('div', { className: 'ldplan-snapshot-note', text: '이전 계산 방식이라 계산기로 불러올 수 없어요.' }),
      openBtn
    ]));

    if(p.status === 'done'){
      box.appendChild(el('div', { className: 'ldplan-done-info' }, [
        el('div', { text: '완료 ' + (p.done_at ? PC.formatDateLabel(PC.kstToday(new Date(p.done_at))) : '') + (p.executed ? ' · 실행함' : ' · 실행하지 않음') }),
        p.review_note ? el('div', { className: 'ldplan-note-view' }, [el('span', { className: 'ldplan-note-label', text: '검토 메모 ' }), el('span', { text: p.review_note })]) : el('div', { className: 'ldplan-note-view muted', text: '검토 메모 없음' })
      ]));
    } else {
      // 실행 여부
      var chk = el('input', { type: 'checkbox', checked: p.executed, disabled: isBusy });
      chk.addEventListener('change', function(){
        var next = chk.checked;
        updatePlan(p, { executed: next }, { toast: next ? '실행했다고 표시했어요' : '실행 표시를 해제했어요' }).then(function(ok){ if(!ok) chk.checked = !next; });
      });
      box.appendChild(el('label', { className: 'ldplan-check' }, [chk, ' 실행했어요']));

      // 재확인일 미루기 — 메모·실행 여부는 건드리지 않는다(review_date만 update)
      var dateInput = el('input', { type: 'date', min: today, value: scratch && scratch.date !== null ? scratch.date : p.review_date, 'data-plan-date': p.id, disabled: isBusy });
      var dateErr = el('div', { className: 'mc-err' });
      var dateBtn = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: '재확인일 변경', disabled: isBusy });
      dateBtn.addEventListener('click', function(){
        var err = PC.validateNewReviewDate(dateInput.value, today);
        dateErr.textContent = err;
        if(err) return;
        if(dateInput.value === p.review_date){ dateErr.textContent = '같은 날짜예요.'; return; }
        updatePlan(p, { review_date: dateInput.value }, { toast: '재확인일을 ' + PC.formatDateLabel(dateInput.value) + '로 변경했어요' });
      });
      box.appendChild(el('div', { className: 'ldplan-field' }, [
        el('label', { text: '재확인일' }),
        el('div', { className: 'ldplan-inline' }, [dateInput, dateBtn]),
        dateErr
      ]));

      // 검토 메모(최신 1건만) → 메모만 저장(active 유지) / 완료로 표시
      var noteInput = el('textarea', { rows: 3, maxlength: PC.LIMITS.note, placeholder: '실행해보니 어땠는지, 다음에 바꿀 점을 적어두세요', 'data-plan-note': p.id, disabled: isBusy });
      noteInput.value = scratch && scratch.note !== null ? scratch.note : (p.review_note || '');
      var noteErr = el('div', { className: 'mc-err' });
      var noteBtn = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', text: '메모 저장', disabled: isBusy });
      noteBtn.addEventListener('click', function(){
        var vn = PC.validateNote(noteInput.value);
        noteErr.textContent = vn.ok ? '' : vn.error;
        if(!vn.ok) return;
        if(vn.value === null && !p.review_note){ noteErr.textContent = '메모를 입력해주세요.'; return; }
        updatePlan(p, { review_note: vn.value, reviewed_at: nowIso() }, { toast: '검토 메모를 저장했어요', event: 'plan_reviewed' });
      });
      var doneBtn = el('button', { type: 'button', className: 'btn btn-primary btn-sm', text: '완료로 표시', disabled: isBusy });
      doneBtn.addEventListener('click', function(){
        var vn = PC.validateNote(noteInput.value);
        noteErr.textContent = vn.ok ? '' : vn.error;
        if(!vn.ok) return;
        var patch = { status: 'done', done_at: nowIso(), reviewed_at: nowIso() };
        if(vn.value !== null) patch.review_note = vn.value; // 비워둔 경우 기존 메모 유지
        updatePlan(p, patch, { toast: '계획을 완료했어요', event: 'plan_reviewed' });
      });
      box.appendChild(el('div', { className: 'ldplan-field' }, [
        el('label', { text: '검토 메모' }),
        noteInput,
        el('div', { className: 'ldplan-note-hint', text: '메모는 최신 내용 하나만 보관돼요. 저장하면 이전 메모를 덮어써요.' + (p.reviewed_at ? ' 마지막 검토 ' + PC.formatDateLabel(PC.kstToday(new Date(p.reviewed_at))) : '') }),
        noteErr,
        el('div', { className: 'ldplan-inline' }, [noteBtn, doneBtn])
      ]));
    }

    var delBtn = el('button', { type: 'button', className: 'mc-link-btn ldplan-delete', text: '삭제', disabled: isBusy });
    delBtn.addEventListener('click', function(){
      if(!window.confirm('이 계획을 삭제할까요? 되돌릴 수 없어요.')) return;
      deletePlan(p);
    });
    box.appendChild(el('div', { className: 'ldplan-detail-foot' }, [delBtn]));
    return box;
  }

  // ------------------------------------------------------------ Supabase
  function fetchPlans(my){
    var sb = client();
    var uid = currentUserId;
    if(!sb || !uid){ listState = 'error'; renderHome(); return; }
    sb.from('plans').select(PLAN_COLS).eq('user_id', uid).order('review_date', { ascending: true }).limit(200)
      .then(function(res){
        if(my !== seq) return;
        if(res.error){
          console.warn('[launchdesk] 계획 조회 실패(테이블/RLS 적용 여부 확인 필요):', res.error.message);
          listState = 'error';
        } else {
          plans = res.data || [];
          listState = 'ready';
        }
        renderHome();
      }).catch(function(err){
        if(my !== seq) return;
        console.warn('[launchdesk] 계획 조회 중 오류:', err && err.message);
        listState = 'error';
        renderHome();
      });
  }
  // 단일 계획 수정 — 성공 시 서버가 돌려준 행으로 교체. 실패 시 화면 입력은
  // 그대로 둔다(재렌더하지 않음). 반환: Promise<boolean>
  function updatePlan(p, patch, opts){
    var sb = client();
    var uid = currentUserId;
    if(!sb || !uid || busy[p.id]) return Promise.resolve(false);
    var my = seq;
    busy[p.id] = true;
    return sb.from('plans').update(patch).eq('id', p.id).eq('user_id', uid).select(PLAN_COLS).single()
      .then(function(res){
        busy[p.id] = false;
        if(my !== seq) return false;
        if(res.error || !res.data){
          console.warn('[launchdesk] 계획 수정 실패:', res.error && res.error.message);
          showToast('저장하지 못했어요. 잠시 후 다시 시도해주세요.', 'error');
          return false;
        }
        var idx = plans.findIndex(function(x){ return x.id === p.id; });
        if(idx !== -1) plans[idx] = res.data; else plans.push(res.data);
        detailScratch = null;
        renderHome();
        if(opts && opts.toast) showToast(opts.toast, 'success');
        if(opts && opts.event) track(opts.event); // DB 성공 뒤에만
        return true;
      }).catch(function(err){
        busy[p.id] = false;
        if(my !== seq) return false;
        console.warn('[launchdesk] 계획 수정 중 오류:', err && err.message);
        showToast('저장하지 못했어요. 잠시 후 다시 시도해주세요.', 'error');
        return false;
      });
  }
  function deletePlan(p){
    var sb = client();
    var uid = currentUserId;
    if(!sb || !uid || busy[p.id]) return;
    var my = seq;
    busy[p.id] = true;
    sb.from('plans').delete().eq('id', p.id).eq('user_id', uid).then(function(res){
      busy[p.id] = false;
      if(my !== seq) return;
      if(res.error){
        console.warn('[launchdesk] 계획 삭제 실패:', res.error.message);
        showToast('삭제하지 못했어요. 잠시 후 다시 시도해주세요.', 'error');
        return;
      }
      plans = plans.filter(function(x){ return x.id !== p.id; });
      if(openDetailId === p.id) openDetailId = null;
      renderHome();
      showToast('계획을 삭제했어요');
    }).catch(function(err){
      busy[p.id] = false;
      if(my !== seq) return;
      console.warn('[launchdesk] 계획 삭제 중 오류:', err && err.message);
      showToast('삭제하지 못했어요. 잠시 후 다시 시도해주세요.', 'error');
    });
  }
  // 스냅샷을 계산기로 — 사본을 넘긴다(계산기가 값을 바꿔도 계획은 그대로).
  // 현재 입력 덮어쓰기 확인은 tools.js의 mcLoadRecord가 담당한다.
  function openInCalc(p){
    var MCUI = window.launchdeskMarginCalcUI;
    if(!MCUI || typeof MCUI.openRecord !== 'function' || !PC.isValidSnapshot(p.calc_snapshot)){
      showToast('이전 계산 방식이라 계산기로 불러올 수 없어요');
      return;
    }
    MCUI.openRecord(JSON.parse(JSON.stringify(p.calc_snapshot)));
  }

  // ------------------------------------------------------------ 인증 상태
  function applyIdentity(userId, label){
    var prev = currentUserId;
    currentUserId = userId;
    currentUserLabel = label || '';
    if(prev !== userId){
      // 이전 계정의 흔적 정리: 목록·열린 상세·진행 중 표시. 폼은 "이전 계정이
      // 작성 중이던 것"(prev가 있었음)일 때만 닫는다 — 게스트가 쓰다 로그인한
      // 경우(prev null)는 그 폼으로 이어서 저장해야 하므로 유지한다.
      plans = []; openDetailId = null; showAllUpcoming = false; busy = {}; detailScratch = null;
      if(prev !== null && form.open){ resetFormState(); closeForm(); }
    }
    if(userId){
      // 같은 사용자로 세션 이벤트가 반복될 때(getSession + SIGNED_IN + 병합
      // 후 재hydrate)는 이미 그린 목록을 유지한 채 조용히 다시 불러온다 —
      // "불러오는 중"으로 되돌리면 홈이 깜빡이고 안내가 반복 생성된 것처럼 보인다.
      if(prev !== userId || listState !== 'ready') listState = 'loading';
      renderHome();
      if(hasHome) fetchPlans(seq); // 목록을 보여줄 카드가 없으면 조회하지 않는다
    } else {
      listState = 'guest';
      renderHome();
    }
    refreshFormAccountUi();
    maybeAutoRestore();
  }
  function hydrateFromSession(){
    seq += 1;
    var my = seq;
    var sb = client();
    if(!sb){ applyIdentity(null, ''); return; }
    sb.auth.getSession().then(function(res){
      if(my !== seq) return;
      var session = res && res.data && res.data.session;
      var user = session && session.user;
      applyIdentity(user ? user.id : null, user ? userLabelOf(user) : '');
    }).catch(function(){
      if(my !== seq) return;
      applyIdentity(null, '');
    });
  }

  // ------------------------------------------------------------ 배선
  if(hasForm){
    if(f.openBtn) f.openBtn.addEventListener('click', openFormFromCalc);
    f.save.addEventListener('click', onSaveClick);
    if(f.close) f.close.addEventListener('click', function(){ closeForm(); });
    if(f.discard) f.discard.addEventListener('click', onDiscardClick);
    if(f.useCurrent) f.useCurrent.addEventListener('click', function(){
      // 명시적 클릭에서만 스냅샷을 바꾼다("조용히 덮어쓰지 않는다") — 이미
      // 입력해 둔 제목·실행할 일·재확인일은 전혀 건드리지 않고 계산 조건만
      // 지금 값으로 교체한다.
      var MCUI = window.launchdeskMarginCalcUI;
      var current = MCUI && typeof MCUI.buildCurrentRecord === 'function' ? MCUI.buildCurrentRecord() : null;
      if(!current){ showToast('지금은 유효한 계산 결과가 없어서 반영할 수 없어요'); return; }
      form.snapshot = JSON.parse(JSON.stringify(current));
      f.snapshot.textContent = PC.snapshotSummary(form.snapshot);
      f.mismatch.hidden = true;
      showToast('계획의 계산 조건을 지금 계산으로 업데이트했어요', 'success');
    });
    document.addEventListener('launchdesk:margin-calc-changed', checkSnapshotMismatch);
    f.date.min = today;
  }
  if(window.launchdeskStore && typeof window.launchdeskStore.onChange === 'function'){
    window.launchdeskStore.onChange(hydrateFromSession);
  }
  renderHome(); // 초기: 게스트 표시(위 onChange가 곧 정확한 상태로 갱신)

  // 계산기 탭 진입 시 초안 자동 복원(app.js의 탭 전환 핸들러가 먼저 돈 뒤 확인)
  window.addEventListener('hashchange', function(){ renderDraftNotice(); setTimeout(maybeAutoRestore, 0); });
  document.addEventListener('click', function(e){
    if(e.target.closest('.tools-tab-btn') || e.target.closest('a[data-tools-target="calc"]')) setTimeout(maybeAutoRestore, 0);
  });
  // 다른 탭에서 초안이 바뀌면 안내만 갱신(열린 폼은 건드리지 않음)
  window.addEventListener('storage', function(e){ if(!e || e.key === null || e.key === DRAFT_KEY) renderDraftNotice(); });

  // 자정이 지난 뒤 재방문/탭 활성화 시 날짜 분류 갱신(재조회 없이 재렌더)
  function refreshTodayIfChanged(){
    var t = PC.kstToday();
    if(t === today) return;
    today = t;
    if(hasForm){ f.date.min = today; }
    renderHome();
  }
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) refreshTodayIfChanged(); });
  window.addEventListener('focus', refreshTodayIfChanged);
  setInterval(refreshTodayIfChanged, 60 * 1000);

  window.launchdeskPlans = {
    // 테스트/디버그용 읽기 전용 상태. 화면 로직은 전부 이 파일 안에서만 바뀐다.
    getState: function(){ return { userId: currentUserId, listState: listState, plans: plans.slice(), formOpen: form.open, requestId: form.requestId, saveRequested: form.saveRequested, persisted: form.persisted, today: today }; },
    refreshToday: refreshTodayIfChanged,
    // app.js startOAuthLogin()이 페이지를 떠나기 직전에 호출 — 위 beforeOAuthRedirect 참고.
    beforeOAuthRedirect: beforeOAuthRedirect
  };
})();
