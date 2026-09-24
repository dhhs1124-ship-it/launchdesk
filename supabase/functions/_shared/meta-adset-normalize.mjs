// Meta 캠페인/광고 세트/광고 레벨 Insights — 순수 정규화 · 계산 · 페이지네이션
// 로직만 모은 모듈. Deno(.mjs 상대 경로 import)와 Node(동적 import()) 양쪽에서
// 그대로 로드할 수 있도록 Deno 전용 구문(Deno.*, jsr: import)이나 Node 전용
// 구문(require/module.exports)을 전혀 쓰지 않는다 — 표준 ESM export만 사용.
//
// meta-insights/index.ts(계정 레벨 합계)의 pickPurchase/classifyMetaApiError와
// 개념은 동일하되, 이 파일은 그 파일을 import하거나 수정하지 않는다(감사·이전
// 단계에서 이미 검증·테스트된 meta-insights.ts를 이번 작업으로 건드리지
// 않기 위한 의도적 선택 — 최종 보고에 근거를 남긴다). 코드가 일부 중복되지만
// 정책(190→RECONNECT_REQUIRED, 200/10→PERMISSION_REQUIRED 등)은 완전히 같다.
//
// [observed 필드의 정확한 의미 — 교정, 반드시 이 뜻으로만 읽을 것]
// observed는 "이번 Meta 응답의 actions/action_values 배열 안에 우선순위
// 후보 action_type 중 하나가 실제로 존재했는가"만 나타낸다. 그 이상도
// 이하도 아니다. observed:false는 다음 중 무엇이 원인인지 이 값만으로는
// 전혀 구분하지 못한다:
//   - 이벤트 추적(픽셀/CAPI)이 애초에 설정되지 않음
//   - 추적은 설정됐지만 조회 기간에 실제로 0건 발생
//   - Meta의 집계·기여 기준상 이번 응답에서 생략됨
//   - 이 캠페인의 목적(objective)이 그 이벤트 자체를 쓰지 않음
// 즉 observed:false를 "추적 미설정"이나 "픽셀 없음"으로 해석하거나, 이
// 값만으로 좋음/나쁨·정상/오류를 판정하는 코드를 이 파일 어디에도 넣지
// 않는다(그런 진단은 이번 단계 범위 밖 — 아직 원본 데이터만 반환한다).

export const GRAPH_API_VERSION = "v21.0";

// 한 페이지당 행 수 — 기존 _shared/meta-token.ts의 fetchMetaAdAccountsPage와
// 동일한 값(100)을 재사용한다.
export const PAGE_LIMIT = 100;

// 베타 규모 판단(근거는 최종 보고에 기재) — 광고계정 목록(MAX_AD_ACCOUNT_PAGES=20,
// _shared/meta-token.ts)보다 약간 낮게 잡는다. 이 두 숫자는 서로 독립적인
// 방어선이다: 정상적으로는 페이지 수 상한에 먼저 걸리지만(10×100=1000),
// 한 페이지가 비정상적으로 많은 행을 담아 오는 경우를 대비해 행 수 상한도
// 별도로 둔다.
export const MAX_INSIGHTS_PAGES = 10;
export const MAX_INSIGHTS_ROWS = 500;

// 광고 세트/광고 조회 기간. last_7d 등 그 외 값은 임의로 계산하지 않고 거부한다.
export const SUPPORTED_PERIODS = ["today", "yesterday", "month", "all", "date"];

// ---- 전환 이벤트 action_type 우선순위 --------------------------------------
// PURCHASE_ACTION_PRIORITY는 meta-insights/index.ts에 이미 있는 배열을
// 그대로 옮긴 것(코드로 확인된 값, 추측 아님).
export const PURCHASE_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
  "purchase",
];

// 아래 세 배열은 PURCHASE_ACTION_PRIORITY와 같은 명명 규칙(오프사이트 픽셀 →
// omni → 일반 이벤트명)을 따른다고 추정한 것이다 — purchase처럼 이 저장소
// 코드로 이미 확인된 값이 아니라 유추한 값이므로, 실제 Meta 계정 응답으로
// 재검증이 필요하다(최종 보고 15번 항목 참고).
export const LANDING_PAGE_VIEW_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_landing_page_view",
  "landing_page_view",
];
export const ADD_TO_CART_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_add_to_cart",
  "omni_add_to_cart",
  "add_to_cart",
];
export const INITIATE_CHECKOUT_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_initiate_checkout",
  "omni_initiated_checkout",
  "initiate_checkout",
];

// ---- Graph API 오류 분류(meta-insights/index.ts의 classifyMetaApiError와 ----
// 정책 동일 — Meta 코드/HTTP status 매핑을 그대로 옮김) ----------------------
export const META_ERROR_MESSAGES = {
  META_NOT_CONNECTED: "Meta 광고 계정을 연결해주세요.",
  META_ACCOUNT_NOT_SELECTED: "분석할 광고계정을 선택해주세요.",
  RECONNECT_REQUIRED: "Meta 연결이 만료되었습니다. 다시 연결해주세요.",
  PERMISSION_REQUIRED:
    "이 광고계정에 대한 접근 권한이 없습니다. 다시 연결해주세요.",
  RATE_LIMITED: "Meta 요청이 많아 잠시 후 다시 시도해주세요.",
  ACCOUNT_UNAVAILABLE: "이 광고계정에 접근할 수 없습니다.",
  TEMPORARY_ERROR: "Meta 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
  FUTURE_DATE: "오늘 이후 날짜는 조회할 수 없습니다.",
  DATE_TOO_OLD: "Meta는 최근 37개월 안의 날짜만 조회할 수 있습니다.",
};

export function classifyMetaApiError(errorBody) {
  const err = errorBody && errorBody.error;
  const code = err && err.code;
  const type = err && err.type;
  if (code === 190 || type === "OAuthException") {
    return { code: "RECONNECT_REQUIRED", status: 401 };
  }
  if (code === 200 || code === 10) {
    return { code: "PERMISSION_REQUIRED", status: 403 };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return { code: "RATE_LIMITED", status: 429 };
  }
  return { code: "TEMPORARY_ERROR", status: 502 };
}

// RECONNECT_REQUIRED(credential 없음 · 로컬 만료 · OAuthException/190)만
// connected_accounts.status를 pending으로 되돌린다 — 직전 단계
// (meta-insights/index.ts)와 정확히 같은 정책.
export function shouldDowngradeToPending(code) {
  return code === "RECONNECT_REQUIRED";
}

// ---- 숫자/날짜 유틸(meta-insights/index.ts와 동일 로직, 그대로 재구현) ------
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidMetaObjectId(id) {
  return /^\d{1,20}$/.test(String(id));
}

export function dateStringInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function monthStartStringInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

// "YYYY-MM-DD"의 하루 전 날짜 문자열. 달력 계산만 하므로 시간대 · DST와 무관하다.
function previousDateString(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// 실제로 존재하는 달력 날짜인지(2026-02-30 같은 값 거부).
export function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// period를 광고계정 시간대 기준 since/until로 바꾼다. 'all'은 광고 시작일을
// 조회하지 않으므로 since를 만들지 않고(null) Meta의 date_preset=maximum(최대
// 37개월, Ad Account Insights 레퍼런스)에 맡긴다 — 시작일을 임의로 정하지
// 않는다. 'date'는 호출부가 미래 · 37개월 밖 날짜를 먼저 거부한다.
export function resolvePeriodRange(period, now, timeZone, date) {
  const todayStr = dateStringInTimeZone(now, timeZone);
  if (period === "today") return { since: todayStr, until: todayStr };
  if (period === "yesterday") {
    const y = previousDateString(todayStr);
    return { since: y, until: y };
  }
  if (period === "date") return { since: date, until: date };
  if (period === "all") return { since: null, until: todayStr, preset: "maximum" };
  const monthStartStr = monthStartStringInTimeZone(now, timeZone);
  return { since: monthStartStr, until: todayStr };
}

export function isFutureDate(date, now, timeZone) {
  return date > dateStringInTimeZone(now, timeZone);
}

// Meta Ad Account Insights 레퍼런스: "The start date of the time range cannot be
// beyond 37 months from the current date." — 경계 당일은 안전하게 제외한다.
export const META_LOOKBACK_MONTHS = 37;
export function isBeyondLookback(date, now, timeZone) {
  const [y, m, d] = dateStringInTimeZone(now, timeZone).split("-").map(Number);
  const earliest = new Date(Date.UTC(y, m - 1 - META_LOOKBACK_MONTHS, d + 1)).toISOString().slice(0, 10);
  return date < earliest;
}

// ---- 전환 이벤트 추출(우선순위 배열의 첫 매치만 사용 — 중복 합산 금지) ------
// count류(랜딩뷰/장바구니/결제시작)는 actions 배열에서만 값을 찾는다.
// observed는 파일 상단 "[observed 필드의 정확한 의미]" 정의를 그대로 따른다
// — 후보 action_type이 이번 actions 배열에 있었는지만 나타내며, 추적 설정
// 여부를 증명하지 않는다.
//
// [실계정 검증 후 추가] basis — 이번 응답에서 실제로 선택된 action_type
// 문자열을 그대로 노출한다(추측·신규 후보 생성 없음). 후보가 하나도 없으면
// null. 실계정 검증에서 landing_rate가 100%를 넘는 값을 반환한 원인을
// 조사하려면 "정확히 어떤 action_type이 선택됐는지"가 응답에 보여야
// 했는데, 이전 버전은 이를 노출하지 않아 원인을 특정할 수 없었다.
export function pickConversionEvent(actions, priorityList) {
  const list = Array.isArray(actions) ? actions : [];
  for (const type of priorityList) {
    const entry = list.find((a) => a && a.action_type === type);
    if (entry) {
      const n = toNumber(entry.value);
      return { value: n === null ? 0 : n, observed: true, basis: type };
    }
  }
  return { value: 0, observed: false, basis: null };
}

// purchase/purchase_value는 같은 basis(action_type) 후보 목록을 공유하되,
// count는 actions 배열에서, value는 action_values 배열에서 "각자 실제로
// 찾았는지"를 독립적으로 반영한다(교차 합산 금지 — 기존 pickPurchase와
// 동일한 제약: count가 어떤 basis로 잡혔든, value는 반드시 그 "같은
// action_type 문자열"을 action_values에서 다시 찾아야만 인정되고, 다른
// 순위의 후보가 action_values에 있어도 대신 쓰지 않는다). observed의
// 의미는 pickConversionEvent와 동일(파일 상단 정의 참고).
//
// [교정] value.basis는 "그 action_type으로 찾아봤다"가 아니라 "실제로
// action_values 배열에서 찾았다"는 뜻이어야 한다 — count.basis가 있어도
// action_values에 같은 action_type 항목이 없으면(value.observed:false)
// value.basis는 반드시 null이다("찾으려 시도한 이름"과 "실제로 찾은
// 이름"을 혼동하면 안 된다는 지적 반영). count의 basis가 필요하면
// purchase.basis로 이미 확인 가능하므로 별도 필드를 추가하지 않는다.
export function pickCountAndValue(actions, actionValues, priorityList) {
  const actionList = Array.isArray(actions) ? actions : [];
  const valueList = Array.isArray(actionValues) ? actionValues : [];
  for (const type of priorityList) {
    const countEntry = actionList.find((a) => a && a.action_type === type);
    if (!countEntry) continue;
    const valueEntry = valueList.find((a) => a && a.action_type === type);
    const countNum = toNumber(countEntry.value);
    const valueNum = valueEntry ? toNumber(valueEntry.value) : null;
    return {
      count: { value: countNum === null ? 0 : countNum, observed: true, basis: type },
      value: {
        value: valueNum === null ? 0 : valueNum,
        observed: !!valueEntry,
        basis: valueEntry ? type : null,
      },
    };
  }
  return {
    count: { value: 0, observed: false, basis: null },
    value: { value: 0, observed: false, basis: null },
  };
}

// ---- 퍼널 비교 가능 여부(실계정 검증 결과 추가) -----------------------------
// 실계정 검증에서 landing_page_view가 link_clicks보다 큰 값으로 반환되는
// 사례가 확인됐다(예: link_clicks=36인데 landing_page_view=1035). 원인은
// 이 서버 코드만으로는 확정할 수 없다(픽셀 중복·기여 설정·재방문 등 여러
// 가능성이 있고, 어느 것도 여기서 단정하지 않는다) — 다만 원인과 무관하게
// "링크 클릭 대비 랜딩페이지 도달률"이라는 해석 자체가 성립하지 않는
// 상태이므로, 그 사실만 구조적으로 표시한다. usable:false는 "이 광고
// 성과가 나쁘다"가 아니라 "이 비교를 지금 데이터로 할 수 없다"는 뜻이다.
export function computeFunnelStatus(landingPageView, linkClicks) {
  if (!landingPageView.observed) {
    return { usable: false, code: "LPV_NOT_OBSERVED" };
  }
  if (linkClicks <= 0) {
    return { usable: false, code: "NO_LINK_CLICKS" };
  }
  if (landingPageView.value > linkClicks) {
    return { usable: false, code: "LPV_EXCEEDS_LINK_CLICKS" };
  }
  return { usable: true, code: null };
}

// ---- 파생 지표 -------------------------------------------------------------
// 규칙: 분모가 0이거나, 분모/분자로 쓰는 이벤트의 action_type이 이번 응답
// actions 배열에 없었으면(observed:false) 항상 null(0으로 위장하지 않음).
// 이 null은 "그 원인이 무엇인지"(추적 미설정/기간 내 0건/집계 생략/목적상
// 미사용)를 구분하지 않는다 — 단지 "이번 응답만으로는 비율을 계산할 근거가
// 없다"는 뜻이다(파일 상단 [observed 필드의 정확한 의미] 참고).
// spend/impressions/clicks/link_clicks 같은 원본 성과 필드는 "observed"
// 개념이 없는 항상-존재하는 숫자로 취급하고 0 여부만 확인한다. actions
// 기반 이벤트(landing_page_view 등)는 observed까지 함께
// 확인한다.
export function normalizeAdsetMetrics(row) {
  const spend = toNumber(row && row.spend) ?? 0;
  const impressions = toNumber(row && row.impressions) ?? 0;
  const reach = toNumber(row && row.reach) ?? 0;
  const frequency = toNumber(row && row.frequency);
  const clicks = toNumber(row && row.clicks) ?? 0;
  const linkClicks = toNumber(row && row.inline_link_clicks) ?? 0;

  const landingPageView = pickConversionEvent(row && row.actions, LANDING_PAGE_VIEW_ACTION_PRIORITY);
  const addToCart = pickConversionEvent(row && row.actions, ADD_TO_CART_ACTION_PRIORITY);
  const initiateCheckout = pickConversionEvent(row && row.actions, INITIATE_CHECKOUT_ACTION_PRIORITY);
  const purchasePair = pickCountAndValue(row && row.actions, row && row.action_values, PURCHASE_ACTION_PRIORITY);

  const linkCtr = impressions > 0 ? (linkClicks / impressions) * 100 : null;
  const linkCpc = linkClicks > 0 ? spend / linkClicks : null;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;

  // [실계정 검증 후 추가] landing_page_view가 link_clicks를 넘는 등 퍼널
  // 비교 자체가 성립하지 않는 상태를 먼저 판정한다. 100% 상한을 씌우거나
  // 분모를 바꾸는 보정은 하지 않는다 — usable:false면 아래에서 관련 비율만
  // null로 반환하고, landing_page_view.value/link_clicks 원본은 그대로 둔다.
  const funnelStatus = computeFunnelStatus(landingPageView, linkClicks);

  // landing_page_view를 분모로 쓰는 비율(landing_rate, add_to_cart_rate,
  // purchase_rate)만 funnelStatus.usable로 추가 차단한다. checkout_rate는
  // 분모가 add_to_cart이므로(landing_page_view가 아님) 영향받지 않는다.
  const landingRate = funnelStatus.usable ? (landingPageView.value / linkClicks) * 100 : null;
  const addToCartRate =
    funnelStatus.usable && landingPageView.value > 0 && addToCart.observed
      ? (addToCart.value / landingPageView.value) * 100
      : null;
  const checkoutRate =
    addToCart.observed && addToCart.value > 0 && initiateCheckout.observed
      ? (initiateCheckout.value / addToCart.value) * 100
      : null;
  const purchaseRate =
    funnelStatus.usable && landingPageView.value > 0 && purchasePair.count.observed
      ? (purchasePair.count.value / landingPageView.value) * 100
      : null;
  const cpa =
    purchasePair.count.observed && purchasePair.count.value > 0
      ? spend / purchasePair.count.value
      : null;
  const roas =
    spend > 0 && purchasePair.value.observed
      ? purchasePair.value.value / spend
      : null;

  return {
    spend,
    impressions,
    reach,
    frequency,
    clicks,
    link_clicks: linkClicks,
    link_ctr: linkCtr,
    link_cpc: linkCpc,
    cpm,
    landing_page_view: landingPageView,
    add_to_cart: addToCart,
    initiate_checkout: initiateCheckout,
    purchase: purchasePair.count,
    purchase_value: purchasePair.value,
    funnel_status: funnelStatus,
    landing_rate: landingRate,
    add_to_cart_rate: addToCartRate,
    checkout_rate: checkoutRate,
    purchase_rate: purchaseRate,
    cpa,
    roas,
  };
}

// ---- 식별 정보 정규화 -------------------------------------------------------
export function normalizeIdentityRow(row, level) {
  const identity = {
    campaign_id: row && row.campaign_id != null ? String(row.campaign_id) : null,
    campaign_name: (row && row.campaign_name) || (row && row.campaign_id) || null,
    objective: (row && row.objective) ?? null,
    adset_id: row && row.adset_id != null ? String(row.adset_id) : null,
    adset_name: (row && row.adset_name) || (row && row.adset_id) || null,
  };
  if (level === "ad") {
    identity.ad_id = row && row.ad_id != null ? String(row.ad_id) : null;
    identity.ad_name = (row && row.ad_name) || (row && row.ad_id) || null;
  }
  identity.metrics = normalizeAdsetMetrics(row);
  return identity;
}

// ---- 캠페인별 그룹화(광고 세트 목록 모드 전용) ------------------------------
export function groupAdsetsByCampaign(normalizedRows) {
  const order = [];
  const byId = new Map();
  for (const row of normalizedRows) {
    const key = row.campaign_id;
    if (!byId.has(key)) {
      const entry = {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        objective: row.objective,
        adsets: [],
      };
      byId.set(key, entry);
      order.push(entry);
    }
    byId.get(key).adsets.push({
      adset_id: row.adset_id,
      adset_name: row.adset_name,
      metrics: row.metrics,
    });
  }
  return order;
}

// ---- 페이지네이션 루프(순수 로직 — 실제 fetch는 주입된 fetchPageFn이 한다) --
// fetchPageFn(after) => Promise<
//   | { ok: true, rows: any[], nextAfter: string|undefined }
//   | { ok: false, network: true }
//   | { ok: false, network: false, status: number, data: any }
// >
// 반환: { ok:true, rows, truncated, pageCount, fetchedRows } | { ok:false, error }
export async function fetchAllInsightsRows(fetchPageFn, limits) {
  const maxPages = (limits && limits.maxPages) || MAX_INSIGHTS_PAGES;
  const maxRows = (limits && limits.maxRows) || MAX_INSIGHTS_ROWS;
  const rows = [];
  const seenCursors = new Set();
  let after;
  let pageCount = 0;
  let truncated = false;

  for (;;) {
    const page = await fetchPageFn(after);
    if (!page.ok) return { ok: false, error: page };
    pageCount++;

    let hitRowLimit = false;
    for (const row of page.rows) {
      if (rows.length >= maxRows) {
        hitRowLimit = true;
        break;
      }
      rows.push(row);
    }
    if (hitRowLimit) {
      truncated = true;
      break;
    }

    if (!page.nextAfter) break; // 정상 종료 — 다음 페이지 없음

    if (pageCount >= maxPages) {
      truncated = true;
      break;
    }

    if (seenCursors.has(page.nextAfter)) {
      // Meta가 같은 cursor를 반복해서 주는 비정상 상황 — 무한 루프 방지.
      truncated = true;
      break;
    }
    seenCursors.add(page.nextAfter);
    after = page.nextAfter;
  }

  return { ok: true, rows, truncated, pageCount, fetchedRows: rows.length };
}

// ---- 요청 입력 검증(순수 함수 — index.ts의 실제 검증 순서와 동일하게 유지) --
// scope/period/adset_id 형식 오류를 토큰 조회 · Meta API 호출 이전에 전부
// 걸러낸다. 반환값을 그대로 index.ts가 Response.json(...)에 쓴다.
export function validateAdsetInsightsRequest(body) {
  const store_id = body && body.store_id;
  const scope = body && body.scope;
  const period = body && body.period;
  const adset_id = body && body.adset_id;

  if (!store_id) {
    return { ok: false, status: 400, error: "store_id가 필요합니다." };
  }
  if (scope !== "adsets" && scope !== "ads") {
    return { ok: false, status: 400, error: "scope는 'adsets' 또는 'ads'만 지원합니다." };
  }
  if (!SUPPORTED_PERIODS.includes(period)) {
    return {
      ok: false,
      status: 400,
      error: "지원하지 않는 조회 기간입니다.",
      code: "UNSUPPORTED_PERIOD",
    };
  }
  const date = body && body.date;
  if (period === "date" && !isValidDateString(date)) {
    return { ok: false, status: 400, error: "조회 날짜는 YYYY-MM-DD 형식이어야 합니다.", code: "INVALID_DATE" };
  }
  if (scope === "ads") {
    if (!adset_id) {
      return { ok: false, status: 400, error: "ads 조회에는 adset_id가 필요합니다." };
    }
    if (!isValidMetaObjectId(adset_id)) {
      return { ok: false, status: 400, error: "올바른 형식의 광고 세트 ID가 아닙니다." };
    }
  }
  return {
    ok: true, store_id, scope, period,
    date: period === "date" ? date : undefined,
    adset_id: scope === "ads" ? adset_id : undefined,
  };
}

// ---- Graph API 요청 URL 빌더 ------------------------------------------------
// level='adset' → 광고 세트 목록(계정 전체). level='ad'이고 filteringAdsetId가
// 있으면 그 광고 세트에 속한 광고만(광고계정 노드를 통해 filtering으로
// 좁힌다 — 다른 광고계정 데이터가 섞여 들어올 수 없다. adset 노드를 직접
// 조회하는 방식도 검토했으나, 이 방식은 "지금 연결된 광고계정 범위 안에서만"
// 이라는 조건을 URL 자체(act_<id>/insights)로 구조적으로 보장하지 못해
// 채택하지 않았다 — 최종 보고 3/4번 항목 참고).
//
// identityFields(campaign_id/name, objective, adset_id/name, ad_id/name)와
// level=adset/ad, perfFields의 reach/frequency/inline_link_clicks는 공식
// facebook-python-business-sdk의 AdsInsights 필드 정의로 실제 지원 여부가
// 확인됐다(교정 — 이전 보고의 "objective 미확인"은 오류였음, 최종 보고 3번
// 참고). filtering 파라미터의 정확한 스키마만 아직 실제 v21 계정으로
// 검증되지 않았다.
export function buildInsightsUrl({ accountId, level, since, until, preset, after, filteringAdsetId, apiVersion }) {
  const version = apiVersion || GRAPH_API_VERSION;
  const url = new URL(`https://graph.facebook.com/${version}/${accountId}/insights`);
  const identityFields =
    level === "ad"
      ? ["campaign_id", "campaign_name", "objective", "adset_id", "adset_name", "ad_id", "ad_name"]
      : ["campaign_id", "campaign_name", "objective", "adset_id", "adset_name"];
  const perfFields = [
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "inline_link_clicks",
    "actions",
    "action_values",
  ];
  url.searchParams.set("level", level);
  url.searchParams.set("fields", identityFields.concat(perfFields).join(","));
  if (preset) url.searchParams.set("date_preset", preset);
  else url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("time_increment", "all_days");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (after) url.searchParams.set("after", after);
  if (filteringAdsetId) {
    url.searchParams.set(
      "filtering",
      JSON.stringify([{ field: "adset.id", operator: "IN", value: [String(filteringAdsetId)] }])
    );
  }
  return url.toString();
}
