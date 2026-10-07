(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.LaunchRoasCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function kstToday(now){
    var parts = {};
    new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'})
      .formatToParts(new Date(now)).forEach(function(p){ parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  function kstStartIso(now){
    return new Date(kstToday(now) + 'T00:00:00+09:00').toISOString();
  }
  function summarizeOrders(rows){
    return (rows || []).reduce(function(out, row){
      out.count += 1;
      out.amount += Number(row.payment_amount) || 0;
      return out;
    }, {count:0, amount:0});
  }
  function hasTodayCoverage(lastSync, now){
    var ms = Date.parse(lastSync || '');
    return Number.isFinite(ms) && ms >= Date.parse(kstStartIso(now));
  }

  // ---- Edge Function 오류 → 사용자가 다음에 할 일을 알 수 있는 안내 ----
  // supabase.functions.invoke는 2xx가 아니면 data 없이 error만 주고, 함수가 돌려준 JSON
  // ({ code, reason, error })은 error.context(Response)에 남는다. 본문을 못 읽으면 body는 null.
  function readFunctionError(result){
    if(result && result.data && typeof result.data === 'object' && result.data.ok === false){
      return Promise.resolve({status:null, body:result.data});
    }
    var res = result && result.error && result.error.context;
    var status = res && typeof res.status === 'number' ? res.status : null;
    if(!res || typeof res.json !== 'function') return Promise.resolve({status:status, body:null});
    return res.json().then(function(body){
      return {status:status, body:body && typeof body === 'object' ? body : null};
    }, function(){ return {status:status, body:null}; });
  }
  var NOTICE = {
    meta: {
      reconnect: 'Meta 연결이 만료됐어요. 연결 관리에서 Meta를 다시 연결해 주세요.',
      permission: '필요한 권한이 없어요. Meta 연결 설정(광고계정 권한)을 확인해 주세요.',
      rate_limited: 'Meta 요청이 많아 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.',
      temporary: '잠시 Meta 데이터를 불러오지 못했어요. 다시 시도해 주세요.',
      internal: '일시적인 서버 오류로 Meta 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    },
    cafe24: {
      reconnect: 'Cafe24 연결이 만료됐어요. 연결 관리에서 Cafe24를 다시 연결해 주세요.',
      api_unauthorized: 'Cafe24에서 앱 권한이 해제됐거나 인증이 만료됐어요. 연결 관리에서 Cafe24를 다시 연결해 주세요.',
      temporary: '잠시 Cafe24 데이터를 불러오지 못했어요. 다시 시도해 주세요.',
      cursor: '주문은 저장했지만 동기화 기록을 저장하지 못했어요. 잠시 후 다시 동기화해 주세요.',
      internal: '일시적인 서버 오류로 Cafe24 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    }
  };
  var KIND_BY_CODE = {
    RECONNECT_REQUIRED:'reconnect', CREDENTIAL_NOT_FOUND:'reconnect',
    PERMISSION_REQUIRED:'permission', RATE_LIMITED:'rate_limited',
    TEMPORARY_ERROR:'temporary', REFRESH_RETRYABLE:'temporary',
    INTERNAL_ERROR:'internal', CREDENTIAL_LOOKUP_FAILED:'internal', CONFIG_ERROR:'internal', REFRESH_FAILED:'internal', DB_ERROR:'internal'
  };
  // provider: 'meta' | 'cafe24', err: readFunctionError 결과, fallback: 서버 안내 문구가 없는 그 밖의 code일 때 쓸 화면 문구.
  // 반환 {kind, message} — kind: reconnect · permission · rate_limited · temporary · internal · other
  function functionErrorNotice(provider, err, fallback){
    var texts = NOTICE[provider] || NOTICE.meta;
    var body = err && err.body, status = err && err.status, code = body && body.code;
    if(code === 'SYNC_CURSOR_SAVE_FAILED') return {kind:'temporary', message:texts.cursor || texts.temporary};
    var kind = code ? KIND_BY_CODE[code] : null;
    if(kind){
      var message = kind === 'reconnect' && body.reason === 'CAFE24_API_UNAUTHORIZED' && texts.api_unauthorized ? texts.api_unauthorized : texts[kind];
      // Cafe24에는 권한 · 요청 한도 code가 없다 — 오면 일시 오류로 안내한다
      return {kind:texts[kind] ? kind : 'temporary', message:message || texts.temporary};
    }
    if(code){
      // 기간 · 계정 상태 같은 그 밖의 code는 서버가 준 고정 안내 문구를 그대로 쓴다
      return {kind:'other', message:(typeof body.error === 'string' && body.error) || fallback || texts.internal};
    }
    // code가 없으면 상태로만 판단한다 — 응답 없음(네트워크 · 시간 초과) · 502~504 · 429는 일시 오류,
    // 그 밖(500 등)은 일반 오류. 둘 다 재연결로 안내하지 않는다.
    if(status == null || status === 429 || status >= 502) return {kind:'temporary', message:texts.temporary};
    // 4xx에 서버가 고정 안내 문구를 준 경우(예: 광고계정 접근 권한 확인 불가)는 그 문구를 쓴다
    if(status >= 400 && status < 500 && body && typeof body.error === 'string' && body.error) return {kind:'other', message:body.error};
    return {kind:'internal', message:texts.internal};
  }
  return {kstToday:kstToday, kstStartIso:kstStartIso, summarizeOrders:summarizeOrders, hasTodayCoverage:hasTodayCoverage,
    readFunctionError:readFunctionError, functionErrorNotice:functionErrorNotice};
});
