/* 계획(plans) — 순수 로직 모듈 (DOM · 네트워크 없음).

   plans.js(화면·저장)와 tests/plans-core.test.js(검증)가 같은 함수를 쓴다.
   margin-calc.js와 같은 방식으로 브라우저에서는 window.launchdeskPlansCore,
   Node에서는 module.exports로 노출된다.

   여기 있는 것: KST 날짜 문자열 처리, 계획 분류/정렬, 입력 검증, 계산
   스냅샷 검사·요약, 초안(draft) 직렬화/만료, 요청 ID 생성.
   여기 없는 것: Supabase 호출, localStorage 접근, DOM. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskPlansCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var SUPPORTED_CALC_VERSION = 2;
  var DRAFT_VERSION = 1;
  // 초안 보관 기간 — 이메일 인증을 미루는 경우까지 감안하되 영구 보관은 하지
  // 않는다. 지나면 읽는 쪽에서 스스로 삭제하고 "초안 없음"으로 취급한다.
  var DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var DEFAULT_REVIEW_OFFSET_DAYS = 7;
  var UPCOMING_PREVIEW_COUNT = 5;
  var LIMITS = { title: 80, action: 300, note: 500 };
  var DAY_MS = 24 * 60 * 60 * 1000;
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // ------------------------------------------------------------ 날짜
  // KST "오늘"을 YYYY-MM-DD로 조립한다. 브라우저 현지 시간대와 무관하게
  // Intl.formatToParts로 연·월·일을 각각 꺼내 직접 붙인다(로케일별 구분자/
  // 순서 차이에 기대지 않기 위함).
  function kstToday(now){
    var d = (now instanceof Date) ? now : new Date(now === undefined ? Date.now() : now);
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    var y = '', m = '', dd = '';
    parts.forEach(function(p){
      if(p.type === 'year') y = p.value;
      else if(p.type === 'month') m = p.value;
      else if(p.type === 'day') dd = p.value;
    });
    return y + '-' + m + '-' + dd;
  }

  // 'YYYY-MM-DD' 형태이고 실제로 존재하는 날짜인지(2026-02-30 같은 값 거부).
  function isValidDate(str){
    if(typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    var y = Number(str.slice(0, 4)), m = Number(str.slice(5, 7)), d = Number(str.slice(8, 10));
    if(m < 1 || m > 12 || d < 1 || d > 31) return false;
    var t = Date.UTC(y, m - 1, d);
    var back = new Date(t);
    return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
  }
  function toUtcMs(str){
    return Date.UTC(Number(str.slice(0, 4)), Number(str.slice(5, 7)) - 1, Number(str.slice(8, 10)));
  }
  function fromUtcMs(ms){
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  // 날짜 덧셈/차이 — 전부 UTC 자정 기준 정수 연산이라 현지 시간대·DST의
  // 영향을 받지 않는다.
  function addDays(str, n){
    if(!isValidDate(str)) return null;
    return fromUtcMs(toUtcMs(str) + n * DAY_MS);
  }
  function diffDays(a, b){ // a − b (일)
    if(!isValidDate(a) || !isValidDate(b)) return null;
    return Math.round((toUtcMs(a) - toUtcMs(b)) / DAY_MS);
  }
  function formatDateLabel(str){
    if(!isValidDate(str)) return '';
    var d = new Date(toUtcMs(str));
    return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 (' + WEEKDAYS[d.getUTCDay()] + ')';
  }

  // ------------------------------------------------------------ 분류/정렬
  // 'done' | 'overdue' | 'today' | 'upcoming'
  function classify(plan, today){
    if(!plan) return 'upcoming';
    if(plan.status === 'done') return 'done';
    var diff = diffDays(plan.review_date, today);
    if(diff === null) return 'upcoming';
    if(diff < 0) return 'overdue';
    if(diff === 0) return 'today';
    return 'upcoming';
  }
  function statusInfo(plan, today){
    var kind = classify(plan, today);
    if(kind === 'done') return { kind: kind, label: '완료', tone: 'neutral' };
    var diff = diffDays(plan.review_date, today);
    if(kind === 'overdue') return { kind: kind, label: (-diff) + '일 지남', tone: 'warn' };
    if(kind === 'today') return { kind: kind, label: '오늘 확인', tone: 'good' };
    return { kind: kind, label: diff + '일 후', tone: 'neutral' };
  }
  function byReviewDateAsc(a, b){
    if(a.review_date !== b.review_date) return a.review_date < b.review_date ? -1 : 1;
    return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1;
  }
  function byDoneAtDesc(a, b){
    var x = String(a.done_at || ''), y = String(b.done_at || '');
    if(x !== y) return x > y ? -1 : 1;
    return 0;
  }
  // 홈 목록 순서: 지난 날짜 → 오늘 → 예정(날짜 오름차순), 완료는 따로.
  function groupPlans(plans, today){
    var due = [], upcoming = [], done = [];
    (plans || []).forEach(function(p){
      var kind = classify(p, today);
      if(kind === 'done') done.push(p);
      else if(kind === 'upcoming') upcoming.push(p);
      else due.push(p);
    });
    due.sort(byReviewDateAsc);
    upcoming.sort(byReviewDateAsc);
    done.sort(byDoneAtDesc);
    return { due: due, upcoming: upcoming, done: done };
  }

  // ------------------------------------------------------------ 스냅샷
  // 계획 폼이 열려 있는 동안 계산기 입력(광고비 포함)이 바뀌어 스냅샷과
  // 달라졌는지 비교한다. date/saved_at/platform은 "조건"이 아니라 저장
  // 시점 메타데이터라 비교에서 뺀다 — 그것만 다르면 값이 같아도 매번
  // "달라요"로 오탐하게 된다.
  function snapshotsEqual(a, b){
    if(!isValidSnapshot(a) || !isValidSnapshot(b)) return false;
    return JSON.stringify({ v: a.calc_version, i: a.input, r: a.result })
        === JSON.stringify({ v: b.calc_version, i: b.input, r: b.result });
  }

  function isValidSnapshot(rec){
    if(!rec || typeof rec !== 'object') return false;
    if(rec.calc_version !== SUPPORTED_CALC_VERSION) return false;
    if(!rec.input || typeof rec.input !== 'object') return false;
    if(!rec.result || typeof rec.result !== 'object') return false;
    return typeof rec.result.postAd === 'number' && isFinite(rec.result.postAd);
  }
  function won(n){
    if(n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    return sign + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
  }
  function num(v){
    var n = (typeof v === 'number') ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    return isFinite(n) ? n : null;
  }
  function truncate(str, n){
    var s = String(str == null ? '' : str);
    if(s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + '…';
  }
  // 계획 폼/상세에 보여줄 "계획에 저장할 계산 조건" 한 줄.
  function snapshotSummary(rec){
    if(!isValidSnapshot(rec)) return '이전 계산 방식이라 조건을 표시할 수 없어요';
    var i = rec.input, r = rec.result;
    var qty = num(i.qty) || 1;
    var parts = [];
    parts.push('판매가 ' + won(num(i.price)) + (qty > 1 ? ' × ' + qty : ''));
    parts.push('원가 ' + won(num(i.unitCost)));
    var feeRate = num(i.feeRate);
    if(feeRate !== null) parts.push('수수료 ' + feeRate + '%');
    if(r.adMode === 'none' || !r.adMode) parts.push('광고비 미반영');
    else parts.push('광고비 ' + won(num(r.adCost)));
    var post = num(r.postAd);
    var tail = (post !== null && post < 0) ? '주문당 약 ' + won(-post) + ' 적자' : '주문당 약 ' + won(post) + ' 남음';
    return parts.join(' · ') + ' → ' + tail;
  }
  // 자동 제목 — 짧게, 사용자가 바로 고칠 수 있는 형태.
  function defaultTitle(rec){
    if(!isValidSnapshot(rec)) return '';
    var price = num(rec.input.price), post = num(rec.result.postAd);
    var t;
    if(post !== null && post < 0) t = '판매가 ' + won(price) + ' · 적자 조건 개선';
    else t = '판매가 ' + won(price) + ' · 약 ' + won(post) + ' 남기기';
    return truncate(t, LIMITS.title);
  }
  function defaultReviewDate(today){ return addDays(today, DEFAULT_REVIEW_OFFSET_DAYS); }

  // ------------------------------------------------------------ 입력 검증
  // 새 계획/미루기: 오늘 이전 날짜 금지. 기존 계획의 지난 날짜는 조회/검토에
  // 그대로 쓰이므로 이 함수는 "새로 정하는 값"에만 쓴다.
  function validatePlanInput(fields, today){
    var errors = {};
    var title = String(fields && fields.title != null ? fields.title : '').trim();
    var action = String(fields && fields.action_text != null ? fields.action_text : '').trim();
    var date = String(fields && fields.review_date != null ? fields.review_date : '').trim();
    if(!title) errors.title = '계획 이름을 입력해주세요.';
    else if(title.length > LIMITS.title) errors.title = '계획 이름은 ' + LIMITS.title + '자까지예요.';
    if(!action) errors.action_text = '실행할 일을 입력해주세요.';
    else if(action.length > LIMITS.action) errors.action_text = '실행할 일은 ' + LIMITS.action + '자까지예요.';
    var dateErr = validateNewReviewDate(date, today);
    if(dateErr) errors.review_date = dateErr;
    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      values: { title: title, action_text: action, review_date: date }
    };
  }
  function validateNewReviewDate(date, today){
    if(!isValidDate(date)) return '재확인일을 선택해주세요.';
    if(diffDays(date, today) < 0) return '재확인일이 지났어요. 오늘 이후 날짜로 수정해주세요.';
    return '';
  }
  function validateNote(raw){
    var s = String(raw == null ? '' : raw).trim();
    if(!s) return { ok: true, value: null };
    if(s.length > LIMITS.note) return { ok: false, value: null, error: '메모는 ' + LIMITS.note + '자까지예요.' };
    return { ok: true, value: s };
  }

  // ------------------------------------------------------------ 초안(draft)
  // 저장 형식(localStorage 한 키): { v, client_request_id, title, action_text,
  // review_date, calc_snapshot, owner_user_id, saved_at }
  //   - owner_user_id: 최초 저장 "시도"를 한 계정. null이면 아직 어떤 계정에도
  //     귀속되지 않은 게스트 초안. 한 번 정해지면 다른 계정에는 노출하지 않는다.
  //   - saved_at: ms. TTL 계산 기준(갱신될 때마다 다시 찍힌다).
  function makeDraft(fields){
    return {
      v: DRAFT_VERSION,
      client_request_id: fields.client_request_id,
      title: String(fields.title == null ? '' : fields.title),
      action_text: String(fields.action_text == null ? '' : fields.action_text),
      review_date: String(fields.review_date == null ? '' : fields.review_date),
      calc_snapshot: fields.calc_snapshot,
      owner_user_id: fields.owner_user_id || null,
      saved_at: typeof fields.saved_at === 'number' ? fields.saved_at : Date.now()
    };
  }
  function isUuid(s){
    return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }
  // 원문 → 초안 객체. 깨진 JSON/형식 불일치/만료는 전부 { draft:null, reason }.
  // reason: 'none' | 'invalid' | 'expired'
  function parseDraft(raw, nowMs){
    if(raw === null || raw === undefined || raw === '') return { draft: null, reason: 'none' };
    var obj;
    try{ obj = JSON.parse(raw); }catch(e){ return { draft: null, reason: 'invalid' }; }
    if(!obj || typeof obj !== 'object' || obj.v !== DRAFT_VERSION) return { draft: null, reason: 'invalid' };
    if(!isUuid(obj.client_request_id)) return { draft: null, reason: 'invalid' };
    if(typeof obj.saved_at !== 'number' || !isFinite(obj.saved_at)) return { draft: null, reason: 'invalid' };
    if(!isValidSnapshot(obj.calc_snapshot)) return { draft: null, reason: 'invalid' };
    if(obj.owner_user_id !== null && obj.owner_user_id !== undefined && typeof obj.owner_user_id !== 'string') return { draft: null, reason: 'invalid' };
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    if(now - obj.saved_at > DRAFT_TTL_MS || obj.saved_at - now > DAY_MS) return { draft: null, reason: 'expired' };
    return { draft: makeDraft(obj), reason: 'ok' };
  }
  // 현재 사용자(또는 게스트 null)에게 이 초안을 보여줘도 되는가.
  //   - 게스트 초안(owner null): 누구에게나(로그인하면 그 계정에 저장하겠다고
  //     화면에서 명시적으로 확인받는다)
  //   - 귀속된 초안: 그 계정에만. 게스트 상태나 다른 계정에는 노출하지 않는다.
  function draftVisibleFor(draft, userId){
    if(!draft) return false;
    if(!draft.owner_user_id) return true;
    return !!userId && draft.owner_user_id === userId;
  }

  // ------------------------------------------------------------ 요청 ID
  function newRequestId(cryptoObj){
    var c = cryptoObj || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if(c && typeof c.randomUUID === 'function') return c.randomUUID();
    var bytes = new Array(16);
    if(c && typeof c.getRandomValues === 'function'){
      var arr = new Uint8Array(16);
      c.getRandomValues(arr);
      for(var i = 0; i < 16; i++) bytes[i] = arr[i];
    } else {
      for(var j = 0; j < 16; j++) bytes[j] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = bytes.map(function(b){ return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  return {
    SUPPORTED_CALC_VERSION: SUPPORTED_CALC_VERSION,
    DRAFT_VERSION: DRAFT_VERSION,
    DRAFT_TTL_MS: DRAFT_TTL_MS,
    DEFAULT_REVIEW_OFFSET_DAYS: DEFAULT_REVIEW_OFFSET_DAYS,
    UPCOMING_PREVIEW_COUNT: UPCOMING_PREVIEW_COUNT,
    LIMITS: LIMITS,
    kstToday: kstToday, isValidDate: isValidDate, addDays: addDays, diffDays: diffDays, formatDateLabel: formatDateLabel,
    classify: classify, statusInfo: statusInfo, groupPlans: groupPlans,
    isValidSnapshot: isValidSnapshot, snapshotsEqual: snapshotsEqual, snapshotSummary: snapshotSummary, defaultTitle: defaultTitle, defaultReviewDate: defaultReviewDate,
    validatePlanInput: validatePlanInput, validateNewReviewDate: validateNewReviewDate, validateNote: validateNote,
    makeDraft: makeDraft, parseDraft: parseDraft, draftVisibleFor: draftVisibleFor, isUuid: isUuid,
    newRequestId: newRequestId, truncate: truncate, won: won
  };
});
