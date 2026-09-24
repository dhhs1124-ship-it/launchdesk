/* Meta 광고 세트 · 광고별 성과 — 순수 로직 모듈 (DOM · 네트워크 · 저장소 없음).

   meta-adsets.js(화면 연결)와 tests/meta-adsets.test.js(검증)가 같은 함수를
   쓴다. plans-core.js와 같은 방식으로 브라우저에서는
   window.launchdeskMetaAdsetsCore, Node에서는 module.exports로 노출된다.

   여기 있는 것: 통화·비율 포맷, 응답 → 뷰모델 변환(정렬·이름 대체·목적
   라벨), 오류 코드 매핑, 요청 캐시(TTL · 동일 요청 병합 · 늦은 응답 무시)를
   가진 컨트롤러, 화면 HTML 문자열 생성.
   여기 없는 것: 실제 호출(주입된 invoke가 한다), DOM, 브라우저 저장소.

   화면에 올리지 않는 값: 클릭 이후 퍼널 비율과 그 분모 이벤트, 집계 기준
   문자열, Meta 식별자. 변환 함수는 이 값들을 뷰모델에 아예 복사하지 않는다.
   Meta 식별자는 뷰모델과 분리된 idByKey(로컬 인덱스 키 → 내부 값)에만
   두고, HTML 생성기는 그 객체를 받지 않는다. */
(function(root, factory){
  var api = factory();
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; }
  if(root && typeof root === 'object'){ root.launchdeskMetaAdsetsCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(){
  'use strict';

  var DASH = '—';
  var TTL_MS = 5 * 60 * 1000;
  // '전체'는 광고 시작일을 조회하지 않으므로 "시작일부터"라고 표현하지 않는다.
  var PERIOD_LABELS = { today: '오늘', yesterday: '어제', month: '이번 달', all: '조회 가능한 전체 기간', date: '날짜 선택' };
  var DEFAULT_PERIOD = 'today';
  // Meta Ad Account Insights 레퍼런스: date_preset=maximum은 최대 37개월치만
  // 돌려주고, time_range 시작일도 오늘부터 37개월 이전으로는 잡을 수 없다.
  var META_LOOKBACK_MONTHS = 37;
  var NOTE_ALL_RANGE = 'Meta가 제공하는 최근 37개월 안의 성과를 모두 더한 값이에요. 광고를 그보다 먼저 시작했다면 37개월 이전 성과는 빠져 있어요. 광고 시작일은 따로 확인하지 않아요.';

  var OBJECTIVE_LABELS = {
    OUTCOME_AWARENESS: '인지도',
    OUTCOME_TRAFFIC: '트래픽',
    OUTCOME_ENGAGEMENT: '참여',
    OUTCOME_LEADS: '잠재 고객',
    OUTCOME_APP_PROMOTION: '앱 홍보',
    OUTCOME_SALES: '판매'
  };
  var NO_OBJECTIVE = '목적 정보 없음';

  var FALLBACK_NAMES = { campaign: '이름 없는 캠페인', adset: '이름 없는 광고 세트', ad: '이름 없는 광고' };

  var ACCOUNT_LINK = { href: '#/account', text: '내 쇼핑몰 관리로 이동' };
  var ERROR_INFO = {
    RECONNECT_REQUIRED: { message: 'Meta 연결이 만료되었어요. 다시 연결해주세요.', action: 'link' },
    PERMISSION_REQUIRED: { message: '이 광고계정 데이터를 볼 권한이 없습니다.', action: 'link' },
    RATE_LIMITED: { message: 'Meta 요청이 많아 잠시 불러오지 못했어요.', action: 'retry' },
    TEMPORARY_ERROR: { message: 'Meta 데이터를 불러오지 못했습니다.', action: 'retry' },
    ACCOUNT_UNAVAILABLE: { message: '이 광고계정에 접근할 수 없습니다.', action: 'link' },
    META_NOT_CONNECTED: { message: 'Meta 광고 계정을 연결해주세요.', action: 'link' },
    META_ACCOUNT_NOT_SELECTED: { message: '분석할 광고계정을 선택해주세요.', action: 'link' },
    FUTURE_DATE: { message: '오늘 이후 날짜는 조회할 수 없어요. 다른 날짜를 골라주세요.', action: 'none' },
    INVALID_DATE: { message: '조회할 날짜를 다시 골라주세요.', action: 'none' },
    DATE_TOO_OLD: { message: 'Meta는 최근 37개월 안의 날짜만 조회할 수 있어요.', action: 'none' }
  };

  var NOTE_PURCHASE_ABSENT = '이 기간 Meta 응답에 구매 항목이 없어요.';
  var NOTE_PURCHASE_ZERO = '이 기간 구매 0건';
  var NOTE_FUNNEL = 'Meta 집계 기준이 달라 클릭 이후 구간의 비율은 비교하지 않았어요.';
  var NOTE_LIST_PARTIAL = '광고 세트가 많아 일부 데이터만 표시돼요.';
  var NOTE_ADS_PARTIAL = '광고가 많아 일부만 표시돼요.';
  var MSG_EMPTY_LIST = '이 기간에 표시할 광고 성과가 없습니다.';
  var MSG_EMPTY_ADS = '이 기간에 표시할 광고가 없습니다.';

  // ------------------------------------------------------------------ 포맷
  function num(v){
    if(v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function fmtInt(v){
    var n = num(v);
    return n === null ? DASH : Math.round(n).toLocaleString('ko-KR');
  }
  // 통화 기본 소수 자릿수를 그대로 쓴다(자릿수를 강제하지 않음). 통화 코드가
  // 형식에 맞지 않으면 Intl이 예외를 던지므로, 그 경우 숫자와 받은 코드만
  // 영숫자로 걸러 붙인다.
  function fmtMoney(amount, currency){
    var n = num(amount);
    if(n === null) return DASH;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(n);
    } catch(e){
      var code = typeof currency === 'string' ? currency.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() : '';
      var text = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
      return code ? (text + ' ' + code) : text;
    }
  }
  function fmtPercent(v){
    var n = num(v);
    return n === null ? DASH : (n.toFixed(2) + '%');
  }
  // 서버는 ratio(예: 3.379)로 내려준다 — 기존 운영 현황과 같이 ×100 한 % 로 표시.
  function fmtRoas(v){
    var n = num(v);
    return n === null ? DASH : (Math.round(n * 100).toLocaleString('ko-KR') + '%');
  }
  function fmtCount(ev){
    return (ev && ev.observed) ? (fmtInt(ev.value) + '건') : DASH;
  }
  function fmtFrequency(v){
    var n = num(v);
    return n === null ? DASH : n.toFixed(2);
  }

  function objectiveLabel(o){
    if(o === null || o === undefined || o === '') return NO_OBJECTIVE;
    return Object.prototype.hasOwnProperty.call(OBJECTIVE_LABELS, o) ? OBJECTIVE_LABELS[o] : String(o);
  }
  // 서버는 이름이 없으면 식별자 문자열을 이름 자리에 넣어 보낸다. 그 값이
  // 식별자와 같으면 화면에는 대체 문구만 쓴다.
  function displayName(name, id, fallback){
    var n = (name === null || name === undefined) ? '' : String(name).trim();
    if(!n) return fallback;
    if(id !== null && id !== undefined && n === String(id)) return fallback;
    return n;
  }

  function esc(s){
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 값 내림차순 정렬 — 같은 값은 원래(Meta 반환) 순서를 유지한다. 엔진의
  // 정렬 안정성에 기대지 않고 원래 인덱스를 직접 비교한다.
  function sortDesc(items, getVal){
    return items.map(function(item, i){ return { item: item, i: i, v: getVal(item) }; })
      .sort(function(a, b){ return (b.v - a.v) || (a.i - b.i); })
      .map(function(x){ return x.item; });
  }

  // ------------------------------------------------------------- 뷰모델 변환
  // 지표 하나(광고 세트 · 광고 공통)를 표시용 문자열로 바꾼다. 여기서 읽는
  // 필드만 화면에 나갈 수 있다.
  function metricsVm(metrics, currency){
    var m = metrics || {};
    var purchase = m.purchase || {};
    var note = null;
    if(!purchase.observed) note = NOTE_PURCHASE_ABSENT;
    else if(num(purchase.value) === 0) note = NOTE_PURCHASE_ZERO;
    var funnelCode = m.funnel_status && m.funnel_status.code;
    return {
      spend: fmtMoney(m.spend, currency),
      linkCtr: fmtPercent(m.link_ctr),
      purchases: fmtCount(purchase),
      cpa: fmtMoney(m.cpa, currency),
      roas: fmtRoas(m.roas),
      // 손익분기 기준 비교(meta-adsets.js + meta-margin-core.js)에 쓰는 원본
      // ratio 값 — 화면에는 이 숫자를 직접 찍지 않고 항상 roas(포맷된
      // 문자열)만 보여준다. 식별자가 아니라 순수 숫자라 노출 금지 대상이
      // 아니다.
      roasRatio: num(m.roas),
      note: note,
      detail: [
        { label: '노출', value: fmtInt(m.impressions) },
        { label: '도달', value: fmtInt(m.reach) },
        { label: '빈도', value: fmtFrequency(m.frequency) },
        { label: '링크 클릭', value: fmtInt(m.link_clicks) },
        { label: '링크 CPC', value: fmtMoney(m.link_cpc, currency) },
        { label: 'CPM', value: fmtMoney(m.cpm, currency) },
        { label: '장바구니', value: fmtCount(m.add_to_cart) },
        { label: '결제 시작', value: fmtCount(m.initiate_checkout) },
        { label: '구매금액', value: fmtMoney(m.purchase_value && m.purchase_value.observed ? m.purchase_value.value : null, currency) }
      ],
      dataNote: funnelCode === 'LPV_EXCEEDS_LINK_CLICKS' ? NOTE_FUNNEL : null
    };
  }
  function assign(target, src){
    Object.keys(src).forEach(function(k){ target[k] = src[k]; });
    return target;
  }

  // 광고 세트 목록 응답 → { vm, idByKey }. 캠페인은 포함된 광고 세트 광고비
  // 합계, 광고 세트는 광고비 내림차순. 캠페인 헤더에는 가산 가능한 광고비
  // 합계만 만든다(도달 · 빈도 · 비율 지표는 합산하지 않는다).
  function buildListVm(data){
    var account = (data && data.account) || {};
    var currency = account.currency;
    var truncated = !!(data && data.truncated === true);
    var groups = (Array.isArray(data && data.campaigns) ? data.campaigns : []).map(function(c){
      var sets = (Array.isArray(c && c.adsets) ? c.adsets : []).map(function(a){ return a || {}; });
      var total = 0;
      sets.forEach(function(a){ total += num(a.metrics && a.metrics.spend) || 0; });
      return { c: c || {}, sets: sets, total: total };
    });
    groups = sortDesc(groups, function(g){ return g.total; });

    var idByKey = {};
    var campaigns = groups.map(function(g, ci){
      var sets = sortDesc(g.sets, function(a){ return num(a.metrics && a.metrics.spend) || 0; });
      var label = objectiveLabel(g.c.objective);
      return {
        key: 'c' + ci,
        name: displayName(g.c.campaign_name, g.c.campaign_id, FALLBACK_NAMES.campaign),
        objective: label,
        hasObjective: label !== NO_OBJECTIVE,
        adsetCount: sets.length,
        spendLabel: truncated ? '표시된 광고 세트 광고비' : '광고비',
        spendTotal: fmtMoney(g.total, currency),
        adsets: sets.map(function(a, ai){
          var key = 'c' + ci + '-a' + ai;
          var hasId = a.adset_id !== null && a.adset_id !== undefined && a.adset_id !== '';
          if(hasId) idByKey[key] = String(a.adset_id);
          return assign({
            key: key,
            name: displayName(a.adset_name, a.adset_id, FALLBACK_NAMES.adset),
            canExpand: hasId
          }, metricsVm(a.metrics, currency));
        })
      };
    });

    return {
      vm: {
        currency: currency,
        timezone: account.timezone || '',
        range: (data && data.range) ? { since: String(data.range.since || ''), until: String(data.range.until || '') } : null,
        truncated: truncated,
        campaigns: campaigns
      },
      idByKey: idByKey
    };
  }

  // 광고 목록 응답(scope=ads) → 뷰모델. 광고비 내림차순, 같은 값은 원래 순서.
  function buildAdsVm(data){
    var currency = data && data.account && data.account.currency;
    var ads = sortDesc(Array.isArray(data && data.ads) ? data.ads : [], function(a){
      return num(a && a.metrics && a.metrics.spend) || 0;
    });
    return {
      truncated: !!(data && data.truncated === true),
      ads: ads.map(function(a){
        var v = metricsVm(a && a.metrics, currency);
        return {
          name: displayName(a && a.ad_name, a && a.ad_id, FALLBACK_NAMES.ad),
          spend: v.spend, linkCtr: v.linkCtr, purchases: v.purchases, cpa: v.cpa, roas: v.roas
        };
      })
    };
  }

  // -------------------------------------------------------------- 오류 매핑
  function errorInfo(code){
    var known = Object.prototype.hasOwnProperty.call(ERROR_INFO, code);
    var c = known ? code : 'TEMPORARY_ERROR';
    return { code: c, message: ERROR_INFO[c].message, action: ERROR_INFO[c].action, link: ACCOUNT_LINK };
  }
  function codeOf(body){
    var c = body && body.code;
    return Object.prototype.hasOwnProperty.call(ERROR_INFO, c) ? c : 'TEMPORARY_ERROR';
  }
  // supabase-js의 functions.invoke 결과를 { ok, data } | { ok:false, code }로
  // 바꾼다. 2xx가 아니면 res.data는 비고, 서버 바디는 error.context에 있다.
  function normalizeInvokeResult(res){
    var r = res || {};
    if(r.error){
      var ctx = r.error.context;
      if(ctx && typeof ctx.json === 'function'){
        return Promise.resolve(ctx.json()).catch(function(){ return null; }).then(function(body){
          return { ok: false, code: codeOf(body) };
        });
      }
      return Promise.resolve({ ok: false, code: 'TEMPORARY_ERROR' });
    }
    if(!r.data || r.data.ok !== true) return Promise.resolve({ ok: false, code: codeOf(r.data) });
    return Promise.resolve({ ok: true, data: r.data });
  }

  // 'date' 기간은 고른 날짜까지 합쳐야 캐시 · 표시가 섞이지 않는다.
  function periodKey(period, date){ return period === 'date' ? ('date:' + date) : period; }
  function isDateString(v){ return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function periodLabel(period, date){ return period === 'date' ? String(date || '') : (PERIOD_LABELS[period] || ''); }
  // 브라우저 기준 오늘(YYYY-MM-DD). 광고계정 시간대 기준 최종 판단은 서버가 한다.
  function ymd(d){
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function localDateString(ms){ return ymd(new Date(ms)); }
  // 날짜 선택 하한(브라우저 기준 37개월 전 다음 날 — 경계 하루는 안전하게 뺀다).
  function earliestDateString(ms){
    var d = new Date(ms);
    return ymd(new Date(d.getFullYear(), d.getMonth() - META_LOOKBACK_MONTHS, d.getDate() + 1));
  }

  // ---------------------------------------------------------------- 캐시 키
  function cacheKey(storeId, period, adsetId){
    return String(storeId) + '|' + period + (adsetId ? ('|' + adsetId) : '');
  }

  // ------------------------------------------------------------- 컨트롤러
  // opts.invoke(body) → Promise<{ok,data}|{ok:false,code}> (주입),
  // opts.now() → ms, opts.onChange() → 상태가 바뀔 때마다.
  // 자동 재시도는 없다 — 호출은 사용자 조작과 ensureList() 호출부(계정 요약
  // 조회 성공 시점)에서만 일어난다.
  function createController(opts){
    var invoke = opts.invoke;
    var now = opts.now || function(){ return Date.now(); };
    var notify = opts.onChange || function(){};
    var storeId = null;
    var period = DEFAULT_PERIOD;
    var date = null;      // period==='date'일 때만 쓰는 YYYY-MM-DD
    var epoch = 0;        // 초기화/무효화마다 증가 — 이전 세대의 늦은 응답을 버린다
    var cache = {};       // key → { status, at, vm, idByKey, code }
    var inflight = {};    // key → Promise (동일 요청 병합)
    var open = {};        // 내부 광고 세트 값 → true (화면에는 나가지 않음)

    function reset(){ epoch += 1; cache = {}; inflight = {}; open = {}; }
    function fresh(e){ return !!e && e.status === 'ready' && (now() - e.at) < TTL_MS; }
    function pKey(){ return periodKey(period, date); }
    function listKey(){ return cacheKey(storeId, pKey()); }
    function body(extra){
      var b = { store_id: storeId, scope: 'adsets', period: period };
      if(period === 'date') b.date = date;
      return assign(b, extra || {});
    }
    function setStore(id){
      var next = id === undefined || id === null || id === '' ? null : id;
      if(next === storeId) return false;
      storeId = next; period = DEFAULT_PERIOD; date = null; reset(); notify();
      return true;
    }

    function load(key, body, build){
      var hit = cache[key];
      if(fresh(hit)) return Promise.resolve(hit);
      if(inflight[key]) return inflight[key];
      var mine = epoch;
      cache[key] = { status: 'loading' };
      var p = Promise.resolve().then(function(){ return invoke(body); })
        .catch(function(){ return { ok: false, code: 'TEMPORARY_ERROR' }; })
        .then(function(res){
          if(mine !== epoch) return null;
          delete inflight[key];
          var entry;
          try {
            entry = (res && res.ok) ? assign({ status: 'ready', at: now() }, build(res.data))
                                    : { status: 'error', code: codeOf(res) };
          } catch(e){
            entry = { status: 'error', code: 'TEMPORARY_ERROR' };
          }
          cache[key] = entry;
          notify();
          return entry;
        });
      inflight[key] = p;
      notify();
      return p;
    }

    function ensureList(){
      if(!storeId) return Promise.resolve(null);
      return load(listKey(), body(), buildListVm);
    }
    function ensureAds(adsetId){
      return load(cacheKey(storeId, pKey(), adsetId),
        body({ scope: 'ads', adset_id: adsetId }),
        function(d){ return { vm: buildAdsVm(d) }; });
    }
    function adsetIdOf(mk){
      var e = storeId ? cache[listKey()] : null;
      return (e && e.idByKey && e.idByKey[mk]) || null;
    }

    return {
      // 쇼핑몰(또는 로그인 사용자)이 바뀌면 전부 초기화. 같은 값이면 아무 일도 없다.
      setStore: setStore,
      // 계정 요약이 같은 사용자로 다시 불러오는 동안 스냅샷의 쇼핑몰 값이 잠깐
      // null이 된다 — 로그인 상태(authed)이면 그건 변경이 아니므로 유지하고,
      // 다른 쇼핑몰이 오거나 로그아웃(authed=false)일 때만 전부 초기화한다.
      sync: function(id, authed){
        var next = id === undefined || id === null || id === '' ? null : id;
        if(next === null && authed) return false;
        return setStore(next);
      },
      invalidate: function(){ reset(); notify(); },
      refresh: function(){
        var e = storeId ? cache[listKey()] : null;
        if(e && e.status === 'loading') return Promise.resolve(null);
        reset(); notify();
        return ensureList();
      },
      ensureList: ensureList,
      // 'date'는 d(YYYY-MM-DD)가 필요하고 브라우저 기준 오늘 이후 · 37개월
      // 조회 한도 밖이면 거부한다.
      setPeriod: function(p, d){
        if(!PERIOD_LABELS[p] || !storeId) return Promise.resolve(null);
        if(p === 'date'){
          if(!isDateString(d) || d > localDateString(now()) || d < earliestDateString(now())) return Promise.resolve(null);
        } else d = null;
        if(p === period && d === date) return Promise.resolve(null);
        period = p; date = d; open = {}; notify();
        return ensureList();
      },
      toggle: function(mk){
        var id = adsetIdOf(mk);
        if(!id) return Promise.resolve(null);
        if(open[id]){ delete open[id]; notify(); return Promise.resolve(null); }
        open[id] = true; notify();
        return ensureAds(id);
      },
      retryAds: function(mk){
        var id = adsetIdOf(mk);
        return id && open[id] ? ensureAds(id) : Promise.resolve(null);
      },
      getStoreId: function(){ return storeId; },
      // 손익분기 기준 연결(meta-adsets.js)이 로컬 카드키(mk)로 원본 Meta
      // adset_id를 찾을 때만 쓴다 — 뷰모델/HTML에는 이 값이 들어가지
      // 않는다. 목록이 아직 없거나 키가 없으면 null.
      adsetIdOf: adsetIdOf,
      getView: function(){
        var e = storeId ? cache[listKey()] : null;
        var view = {
          period: period,
          date: date,
          status: e ? e.status : 'idle',
          code: e ? e.code : null,
          vm: (e && e.vm) || null,
          open: {},
          ads: {}
        };
        if(e && e.idByKey){
          Object.keys(e.idByKey).forEach(function(mk){
            var id = e.idByKey[mk];
            if(!open[id]) return;
            view.open[mk] = true;
            var a = cache[cacheKey(storeId, pKey(), id)];
            view.ads[mk] = a ? { status: a.status, code: a.code || null, vm: a.vm || null } : { status: 'idle', code: null, vm: null };
          });
        }
        return view;
      }
    };
  }

  // ------------------------------------------------------------- HTML 생성
  function statusText(view){
    if(view.status === 'error') return '';
    if(view.status !== 'ready' || !view.vm) return '광고 세트를 불러오는 중이에요.';
    var count = 0;
    view.vm.campaigns.forEach(function(c){ count += c.adsetCount; });
    if(!count) return '표시할 광고 성과가 없어요.';
    return periodLabel(view.period, view.date) + ' 광고 세트 ' + count + '개를 불러왔어요.';
  }

  function kpi(label, value){
    return '<div class="madsets-kpi"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function renderError(code, focusKey, retryKind, mk){
    var info = errorInfo(code);
    var action = info.action === 'none' ? '' : info.action === 'link'
      ? '<a class="madsets-error-link" href="' + info.link.href + '" data-mf="' + focusKey + '">' + esc(info.link.text) + '</a>'
      : '<button type="button" class="btn btn-ghost btn-sm" data-madsets-retry="' + retryKind + '"' +
        (mk ? ' data-mk="' + mk + '"' : '') + ' data-mf="' + focusKey + '">다시 시도</button>';
    return '<div class="madsets-error" role="alert"><p>' + esc(info.message) + '</p>' + action + '</div>';
  }

  function renderAds(ads, mk){
    if(!ads || ads.status === 'idle' || ads.status === 'loading'){
      return '<p class="madsets-loading">광고를 불러오는 중…</p>';
    }
    if(ads.status === 'error') return renderError(ads.code, 'ads-retry-' + mk, 'ads', mk);
    var vm = ads.vm;
    if(!vm.ads.length) return '<p class="madsets-empty">' + MSG_EMPTY_ADS + '</p>';
    return '<ul class="madsets-ads-list">' + vm.ads.map(function(a){
      return '<li class="madsets-ad"><p class="madsets-ad-name">' + esc(a.name) + '</p>' +
        '<dl class="madsets-ad-kpis">' + kpi('광고비', a.spend) + kpi('링크 클릭률', a.linkCtr) +
        kpi('구매', a.purchases) + kpi('CPA', a.cpa) + kpi('ROAS', a.roas) + '</dl></li>';
    }).join('') + '</ul>' + (vm.truncated ? '<p class="madsets-note">' + NOTE_ADS_PARTIAL + '</p>' : '');
  }

  function renderDetail(a, ads, mk, label){
    var h = '<dl class="madsets-detail-list">' + a.detail.map(function(d){ return kpi(d.label, d.value); }).join('') + '</dl>';
    if(a.dataNote) h += '<p class="madsets-datanote">' + esc(a.dataNote) + '</p>';
    return h + '<div class="madsets-ads"><p class="madsets-ads-title">광고별 성과 · ' + esc(label) + '</p>' + renderAds(ads, mk) + '</div>';
  }

  // 광고 세트 손익분기 기준 연결 상태 — 원본 Meta adset_id는 여기서도
  // 절대 쓰지 않는다(로컬 카드키 mk만 data-mk에 싣는다). link는
  // meta-adsets.js가 미리 계산해 view.links[mk]에 넣어준 표시용 값만
  // 받는다(meta-margin-core.js의 computeBreakeven/compareRoas 결과) —
  // 이 함수는 그 값을 그대로 HTML로 옮기기만 한다("합성"만 한다).
  function renderLinkBlock(a, view){
    var mk = a.key;
    var link = (view.links && view.links[mk]) || null;
    if(!link || !link.connected){
      return '<div class="madsets-link">' +
        '<p class="madsets-link-status">손익분기 기준이 연결되지 않았어요.</p>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-mlink-action="connect" data-mk="' + mk + '"' +
        ' data-mf="mlink-connect-' + mk + '">마진 계산 연결</button></div>';
    }
    var h = '<div class="madsets-link madsets-link-connected">' +
      '<p class="madsets-link-product">' + esc(link.productLabel) + '</p>';
    if(link.breakeven && link.breakeven.ok){
      var hasCurrent = a.roasRatio !== null && a.roasRatio !== undefined;
      if(hasCurrent) h += '<p class="madsets-link-roas">현재 ROAS ' + esc(a.roas) + '</p>';
      h += '<p class="madsets-link-roas">연결한 손익분기 기준 ' + esc(link.breakeven.pctLabel) + '</p>';
      if(link.compare){
        h += '<p class="madsets-link-compare">' + esc(link.compare.text) + '</p>';
        if(view.period === 'today'){
          h += '<p class="madsets-note">오늘 데이터는 집계가 늦어 값이 바뀔 수 있어요.</p>';
        }
      }
    } else if(link.breakeven){
      h += '<p class="madsets-link-roas">' + esc(link.breakeven.reason) + '</p>';
    }
    var disconnecting = !!link.disconnecting;
    h += '<p class="madsets-link-caption">연결한 계산 기준</p>' +
      '<div class="madsets-link-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-mlink-action="change" data-mk="' + mk + '"' +
        ' data-mf="mlink-change-' + mk + '"' + (disconnecting ? ' disabled' : '') + '>기준 변경</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-mlink-action="disconnect" data-mk="' + mk + '"' +
        ' data-mf="mlink-disconnect-' + mk + '"' + (disconnecting ? ' disabled' : '') + '>' +
        (disconnecting ? '해제하는 중…' : '연결 해제') + '</button>' +
      '</div></div>';
    return h;
  }

  function renderAdset(a, view){
    var mk = a.key;
    var isOpen = !!view.open[mk];
    var nameId = 'madsets-' + mk + '-name';
    var detailId = 'madsets-' + mk + '-detail';
    var toggleId = 'madsets-' + mk + '-toggle';
    var h = '<li class="madsets-adset"><div class="madsets-adset-card">' +
      '<h4 class="madsets-adset-name" id="' + nameId + '">' + esc(a.name) + '</h4>' +
      '<dl class="madsets-kpis">' + kpi('광고비', a.spend) + kpi('링크 클릭률', a.linkCtr) +
      kpi('구매', a.purchases) + kpi('CPA', a.cpa) + kpi('ROAS', a.roas) + '</dl>' +
      (a.note ? '<p class="madsets-note">' + esc(a.note) + '</p>' : '');
    if(a.canExpand) h += renderLinkBlock(a, view);
    if(a.canExpand){
      h += '<button type="button" class="madsets-toggle" id="' + toggleId + '" data-mk="' + mk + '" data-mf="toggle-' + mk + '"' +
        ' aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + detailId + '"' +
        ' aria-labelledby="' + toggleId + ' ' + nameId + '">' + (isOpen ? '상세 접기' : '상세 보기') + '</button>' +
        '<div class="madsets-detail" id="' + detailId + '" role="region" aria-labelledby="' + nameId + '"' + (isOpen ? '' : ' hidden') + '>' +
        (isOpen ? renderDetail(a, view.ads[mk], mk, periodLabel(view.period, view.date)) : '') + '</div>';
    }
    return h + '</div></li>';
  }

  function renderCampaign(c, view){
    var titleId = 'madsets-' + c.key + '-title';
    return '<article class="madsets-campaign" aria-labelledby="' + titleId + '">' +
      '<header class="madsets-campaign-head"><h3 class="madsets-campaign-name" id="' + titleId + '">' + esc(c.name) + '</h3>' +
      '<p class="madsets-campaign-meta"><span>' + esc(c.hasObjective ? ('목적 ' + c.objective) : c.objective) + '</span>' +
      '<span>광고 세트 ' + c.adsetCount + '개</span>' +
      '<span>' + esc(c.spendLabel) + ' ' + esc(c.spendTotal) + '</span></p></header>' +
      '<ul class="madsets-adsets">' + c.adsets.map(function(a){ return renderAdset(a, view); }).join('') + '</ul></article>';
  }

  // ------------------------------------------------- 손익분기 기준 연결 모달
  // candidates: meta-margin-core.js buildCandidateList()가 만든 배열에
  // platformLabel(표시용 문자열, 이 파일은 platform 코드→이름 매핑을 모른다)
  // 을 meta-adsets.js가 덧붙인 것. 여기서는 Meta adset_id를 전혀 다루지
  // 않는다 — 후보는 "저장한 계산 기록"일 뿐 광고 세트와 무관한 데이터다.
  function renderLinkPicker(candidates){
    if(!candidates || !candidates.length){
      return '<p class="madsets-link-modal-empty">저장한 마진 계산 기록이 없어요.</p>' +
        '<a class="btn btn-ghost btn-sm" href="#/tools" data-mf="mlink-goto-tools">마진 계산기로 이동</a>';
    }
    return '<ul class="madsets-link-modal-list">' + candidates.map(function(c, i){
      var breakevenText = (c.breakeven && c.breakeven.ok)
        ? ('손익분기 ROAS ' + esc(c.breakeven.pctLabel))
        : esc(c.breakeven ? c.breakeven.reason : '');
      return '<li><button type="button" class="madsets-link-modal-item" data-mlink-pick="' + i + '" data-mf="mlink-pick-' + i + '">' +
        (c.source === 'current' ? '<span class="madsets-link-modal-tag">지금 입력한 값</span>' : '') +
        '<span class="madsets-link-modal-date">' + esc(c.dateLabel) + '</span>' +
        '<span class="madsets-link-modal-summary">' + esc(c.priceLabel) + ' × ' + esc(String(c.qty)) + '</span>' +
        '<span class="madsets-link-modal-pread">광고비 전 남는 금액 ' + esc(c.preAdLabel) + '</span>' +
        '<span class="madsets-link-modal-breakeven">' + breakevenText + '</span>' +
        '<span class="madsets-link-modal-platform">' + esc(c.platformLabel || '플랫폼 미입력') + '</span>' +
        '</button></li>';
    }).join('') + '</ul>';
  }

  function renderLinkLabelForm(candidate, labelValue, labelError, saving){
    var breakevenText = (candidate.breakeven && candidate.breakeven.ok)
      ? ('손익분기 ROAS ' + esc(candidate.breakeven.pctLabel))
      : esc(candidate.breakeven ? candidate.breakeven.reason : '');
    return '<div class="madsets-link-modal-selected">' +
        '<p>' + esc(candidate.dateLabel) + ' · ' + esc(candidate.priceLabel) + ' × ' + esc(String(candidate.qty)) + '</p>' +
        '<p>' + breakevenText + '</p>' +
      '</div>' +
      '<form class="madsets-link-modal-form" data-mlink-form="label">' +
        '<div class="ws-field"><label for="mlinkProductLabel">상품 구분용 이름</label>' +
        '<input type="text" id="mlinkProductLabel" name="productLabel" maxlength="40" value="' + esc(labelValue || '') + '" required></div>' +
        '<p class="madsets-link-modal-hint">상품명처럼 알아볼 수 있는 이름만 적어주세요.</p>' +
        '<p class="madsets-link-modal-warn">실명·연락처 등 개인정보는 적지 마세요.</p>' +
        (labelError ? '<p class="madsets-link-modal-error" role="alert">' + esc(labelError) + '</p>' : '') +
        '<div class="madsets-link-modal-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-mlink-back="1" data-mf="mlink-back"' + (saving ? ' disabled' : '') + '>뒤로</button>' +
          '<button type="submit" class="btn btn-primary btn-sm" data-mf="mlink-save"' + (saving ? ' disabled' : '') + '>' +
          (saving ? '연결하는 중…' : '연결하기') + '</button>' +
        '</div>' +
      '</form>';
  }

  // state: { step:'pick'|'label', candidates, selectedIndex, labelValue, labelError, saving }
  function renderLinkModal(state){
    if(state.step === 'label'){
      var c = state.candidates[state.selectedIndex];
      return c ? renderLinkLabelForm(c, state.labelValue, state.labelError, !!state.saving) : '';
    }
    return renderLinkPicker(state.candidates);
  }

  // 패널 본문(기간 탭 · 새로고침 아래 영역) 전체.
  function renderBody(view){
    if(view.status === 'error') return renderError(view.code, 'list-retry', 'list', null);
    if(view.status !== 'ready' || !view.vm) return '<p class="madsets-loading">불러오는 중…</p>';
    var vm = view.vm;
    var h = '';
    if(vm.range){
      // 카드 · 상세 · 캠페인 합계가 모두 이 한 기간 응답에서 나온다 — 기간 문구도 한 곳.
      var span = view.period === 'all' ? ('~ ' + vm.range.until)
        : (vm.range.since === vm.range.until ? vm.range.since : (vm.range.since + ' ~ ' + vm.range.until));
      var rangeLabel = view.period === 'date' ? '선택한 날짜' : periodLabel(view.period, view.date);
      h += '<p class="madsets-range">' + esc(rangeLabel + ' · ' + span) + ' · 광고계정 시간대 기준' +
        (vm.timezone ? ' (' + esc(vm.timezone) + ')' : '') + '</p>';
      if(view.period === 'all') h += '<p class="madsets-note madsets-partial">' + NOTE_ALL_RANGE + '</p>';
    }
    if(vm.truncated) h += '<p class="madsets-note madsets-partial">' + NOTE_LIST_PARTIAL + '</p>';
    if(!vm.campaigns.length) return h + '<p class="madsets-empty">' + MSG_EMPTY_LIST + '</p>';
    return h + vm.campaigns.map(function(c){ return renderCampaign(c, view); }).join('');
  }

  return {
    TTL_MS: TTL_MS,
    PERIOD_LABELS: PERIOD_LABELS,
    DEFAULT_PERIOD: DEFAULT_PERIOD,
    periodKey: periodKey, localDateString: localDateString, earliestDateString: earliestDateString,
    fmtMoney: fmtMoney, fmtInt: fmtInt, fmtPercent: fmtPercent, fmtRoas: fmtRoas,
    objectiveLabel: objectiveLabel, displayName: displayName,
    buildListVm: buildListVm, buildAdsVm: buildAdsVm,
    errorInfo: errorInfo, normalizeInvokeResult: normalizeInvokeResult,
    cacheKey: cacheKey, createController: createController,
    statusText: statusText, renderBody: renderBody,
    renderLinkModal: renderLinkModal
  };
});
