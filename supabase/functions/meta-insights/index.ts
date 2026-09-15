import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import {
  getValidMetaAccessToken,
} from "../_shared/meta-token.ts";

// Meta 광고 성과(Insights) 정식 조회 — docs/plans/meta-insights.md 기준.
//
// 다른 4개 Meta 함수(meta-adaccounts/meta-account-select/meta-disconnect)와
// 동일한 규칙을 그대로 따른다:
// - access token은 절대 응답에 포함하지 않는다.
// - connected_account_id는 ctx.supabase(RLS)로 ownership을 먼저 확인한 뒤에만
//   ctx.supabaseAdmin(service role)/Meta API 호출에 쓴다.
// - integration_credentials는 getValidMetaAccessToken()을 통해서만 접근한다.
// - Meta 원문 에러 메시지는 console.error에만 남기고, 응답에는 고정된
//   code + 한국어 메시지만 내려준다.
const GRAPH_API_VERSION = "v21.0";

// 구매 전환 action_type 우선순위 — 세 후보가 같은 구매의 중복 표현이므로
// 절대 합산하지 않는다. count(actions)와 value(action_values) 양쪽에서
// 반드시 같은 action_type을 사용한다(교차 사용 금지).
const PURCHASE_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
  "purchase",
];

interface MetaActionEntry {
  action_type?: string;
  value?: string;
}

// ctx.supabase는 Database 제네릭 없이 생성돼 있어(기존 4개 Meta 함수와
// 동일 — 이번 작업 범위 밖) select() 결과가 기본적으로 `never`로 추론된다.
// 이 함수 안에서만 실제 쿼리 컬럼과 정확히 일치하는 최소 타입을 명시해
// `.returns<>()`로 결과 타입을 안전하게 지정한다(런타임 동작에는 영향 없음
// — 컴파일 타임 타입 힌트일 뿐이다).
interface ConnectedAccountRow {
  id: number;
  status: string | null;
  external_account_id: string | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickPurchase(
  actions: MetaActionEntry[] | undefined,
  actionValues: MetaActionEntry[] | undefined
): { purchase_count: number; purchase_value: number; purchase_basis: string | null } {
  const actionList = Array.isArray(actions) ? actions : [];
  const valueList = Array.isArray(actionValues) ? actionValues : [];

  for (const basis of PURCHASE_ACTION_PRIORITY) {
    const countEntry = actionList.find((a) => a.action_type === basis);
    if (!countEntry) continue;

    const valueEntry = valueList.find((a) => a.action_type === basis);
    return {
      purchase_count: toNumber(countEntry.value) ?? 0,
      purchase_value: valueEntry ? toNumber(valueEntry.value) ?? 0 : 0,
      purchase_basis: basis,
    };
  }

  // 그 기간에 세 후보 중 어느 것도 없으면 = 구매전환 0건(에러 아님).
  return { purchase_count: 0, purchase_value: 0, purchase_basis: null };
}

// 광고계정 timezone 기준 날짜 계산 — Asia/Seoul을 하드코딩하지 않고
// Intl.DateTimeFormat에 실제 계정 timezone_name을 넘겨 계산한다. 고정
// 오프셋을 더하는 방식(KST +9h 트릭)과 달리 DST가 있는 timezone에서도
// 안전하다.
function dateStringInTimeZone(date: Date, timeZone: string): string {
  // en-CA 로케일은 Intl.DateTimeFormat#format이 "YYYY-MM-DD"를 그대로 낸다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function monthStartStringInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}-01`;
}

type ErrorCode =
  | "META_NOT_CONNECTED"
  | "META_ACCOUNT_NOT_SELECTED"
  | "RECONNECT_REQUIRED"
  | "PERMISSION_REQUIRED"
  | "RATE_LIMITED"
  | "ACCOUNT_UNAVAILABLE"
  | "TEMPORARY_ERROR";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  META_NOT_CONNECTED: "Meta 광고 계정을 연결해주세요.",
  META_ACCOUNT_NOT_SELECTED: "분석할 광고계정을 선택해주세요.",
  RECONNECT_REQUIRED: "Meta 연결이 만료되었습니다. 다시 연결해주세요.",
  PERMISSION_REQUIRED:
    "이 광고계정에 대한 접근 권한이 없습니다. 다시 연결해주세요.",
  RATE_LIMITED: "Meta 요청이 많아 잠시 후 다시 시도해주세요.",
  ACCOUNT_UNAVAILABLE: "이 광고계정에 접근할 수 없습니다.",
  TEMPORARY_ERROR: "Meta 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
};

function errorResponse(code: ErrorCode, status: number) {
  return Response.json({ error: ERROR_MESSAGES[code], code }, { status });
}

// Meta 자체 에러(error.code/type)를 위 6개 카테고리로 매핑한다. 불확실한
// 코드를 억지로 세분하지 않고, 근거가 분명한 것만 매핑하고 나머지는 전부
// TEMPORARY_ERROR로 떨어뜨린다(설계 문서 §10 원칙 — 모르면 임시 오류).
function classifyMetaApiError(errorBody: unknown): {
  code: ErrorCode;
  status: number;
} {
  // deno-lint-ignore no-explicit-any
  const err = (errorBody as any)?.error;
  const code = err?.code;
  const type = err?.type;

  // 190 = OAuthException(만료/무효 토큰) — Meta 문서 기준 표준 코드.
  if (code === 190 || type === "OAuthException") {
    return { code: "RECONNECT_REQUIRED", status: 401 };
  }
  // 200 = Permissions error, 10 = 앱이 이 동작에 대한 권한 없음.
  if (code === 200 || code === 10) {
    return { code: "PERMISSION_REQUIRED", status: 403 };
  }
  // 4/17/32/613 = Meta 표준 rate limit 코드.
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return { code: "RATE_LIMITED", status: 429 };
  }
  return { code: "TEMPORARY_ERROR", status: 502 };
}

type MetaFetchResult =
  | { ok: true; data: any }
  | { ok: false; network: true }
  | { ok: false; network: false; status: number; data: any };

async function fetchMetaJson(
  url: string,
  accessToken: string
): Promise<MetaFetchResult> {
  let res: Response;
  try {
    // access_token은 쿼리 파라미터가 아니라 Authorization 헤더로만 전달 —
    // 로그 어디에도 남지 않는다(기존 4개 Meta 함수와 동일한 규칙).
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error(
      "Meta API request failed:",
      err instanceof Error ? err.message : "network error"
    );
    return { ok: false, network: true };
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    return { ok: false, network: false, status: res.status || 502, data };
  }

  return { ok: true, data };
}

function buildInsightsUrl(
  externalAccountId: string,
  since: string,
  until: string
): string {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${externalAccountId}/insights`
  );
  url.searchParams.set("fields", "spend,impressions,clicks,actions,action_values");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  // 기간 전체를 합산한 한 행만 받는다(일별로 쪼개 클라이언트에서 다시
  // 합산할 필요 없음 — 실제 회사 계정으로 이미 검증된 동작).
  url.searchParams.set("time_increment", "all_days");
  url.searchParams.set("level", "account");
  return url.toString();
}

interface NormalizedPeriod {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  purchase_count: number;
  purchase_value: number;
  roas: number | null;
  purchase_basis: string | null;
}

// deno-lint-ignore no-explicit-any
function normalizePeriod(row: any): NormalizedPeriod {
  const spend = toNumber(row?.spend) ?? 0;
  const impressions = toNumber(row?.impressions) ?? 0;
  const clicks = toNumber(row?.clicks) ?? 0;
  const { purchase_count, purchase_value, purchase_basis } = pickPurchase(
    row?.actions,
    row?.action_values
  );

  return {
    spend,
    impressions,
    clicks,
    // 0 분모는 계산 불가로 처리(0%가 아니라 "—") — null을 내려주고 UI가
    // "—"로 표시한다.
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    purchase_count,
    purchase_value,
    // ROAS는 Meta의 purchase_roas 필드를 쓰지 않고 서버가 직접 계산한다
    // (분자/분모를 §6에서 고른 basis로 우리가 직접 통제하기 위함).
    roas: spend > 0 ? purchase_value / spend : null,
    purchase_basis,
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const body = await req.json().catch(() => ({}));
      const connected_account_id = body?.connected_account_id;

      if (!connected_account_id) {
        return Response.json(
          { error: "connected_account_id가 필요합니다." },
          { status: 400 }
        );
      }

      // 1. ownership 확인 — 기존 Meta 함수들과 동일한 패턴. ctx.supabase는
      //    RLS가 적용되므로 다른 사용자의 connected_account_id는 여기서
      //    이미 걸러진다.
      const { data: account, error: accountError } = await ctx.supabase
        .from("connected_accounts")
        .select("id, status, external_account_id")
        .eq("id", connected_account_id)
        .eq("provider", "meta")
        .returns<ConnectedAccountRow[]>()
        .single();

      if (accountError || !account) {
        return errorResponse("META_NOT_CONNECTED", 404);
      }

      // 광고계정이 아직 선택되지 않은 경우(status='pending' 등) — 이건
      // "연결 자체가 없음"과 구분되는 별도 상태.
      if (account.status !== "connected" || !account.external_account_id) {
        return errorResponse("META_ACCOUNT_NOT_SELECTED", 409);
      }

      // 2. access token 확보 — CREDENTIAL_NOT_FOUND(정합성이 깨진 상태:
      //    status는 connected인데 credential이 없음)도 RECONNECT_REQUIRED와
      //    동일하게 "다시 연결해주세요"로 안내한다 — 사용자가 취할 수 있는
      //    조치가 어차피 같다(재연결).
      const tokenResult = await getValidMetaAccessToken(
        ctx.supabaseAdmin,
        account.id
      );

      if (!tokenResult.ok) {
        return errorResponse("RECONNECT_REQUIRED", 401);
      }

      const externalAccountId = account.external_account_id;
      const accessToken = tokenResult.accessToken;

      // 3. 광고계정 메타데이터(통화/시간대/상태) 조회 — DB에는 캐시하지
      //    않고 매 호출마다 Meta에서 직접 가져온다(MVP, 트래픽 늘면 재검토).
      const metaUrl = new URL(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${externalAccountId}`
      );
      metaUrl.searchParams.set(
        "fields",
        "name,currency,timezone_name,account_status"
      );

      const metaResult = await fetchMetaJson(metaUrl.toString(), accessToken);

      if (!metaResult.ok) {
        if (metaResult.network) return errorResponse("TEMPORARY_ERROR", 502);
        console.error(
          "Meta account meta fetch failed:",
          metaResult.status,
          metaResult.data?.error?.message
        );
        const cls = classifyMetaApiError(metaResult.data);
        return errorResponse(cls.code, cls.status);
      }

      const accountMeta = metaResult.data;
      const timezoneName: string = accountMeta?.timezone_name || "UTC";
      const currency: string = accountMeta?.currency || "USD";
      const accountStatus = accountMeta?.account_status;

      // Meta account_status enum(공식 문서 기준): 1=ACTIVE. 그 외(2=DISABLED,
      // 3=UNSETTLED, 7=PENDING_RISK_REVIEW, 8=PENDING_SETTLEMENT,
      // 9=IN_GRACE_PERIOD, 100=PENDING_CLOSURE, 101=CLOSED)는 광고 집행
      // 자체가 불가능한 상태 — 별도 오류로 분리한다(요구사항 5).
      if (typeof accountStatus === "number" && accountStatus !== 1) {
        return errorResponse("ACCOUNT_UNAVAILABLE", 409);
      }

      // 4. today/month 기간 계산 — 반드시 이 광고계정의 timezone 기준(서버
      //    UTC 자정으로 자르지 않음). 현재 실제 계정은 Asia/Seoul이지만,
      //    다른 timezone 계정도 깨지지 않도록 timezone_name을 그대로 쓴다.
      const now = new Date();
      const todayStr = dateStringInTimeZone(now, timezoneName);
      const monthStartStr = monthStartStringInTimeZone(now, timezoneName);

      const [todayResult, monthResult] = await Promise.all([
        fetchMetaJson(
          buildInsightsUrl(externalAccountId, todayStr, todayStr),
          accessToken
        ),
        fetchMetaJson(
          buildInsightsUrl(externalAccountId, monthStartStr, todayStr),
          accessToken
        ),
      ]);

      for (const result of [todayResult, monthResult]) {
        if (!result.ok) {
          if (result.network) return errorResponse("TEMPORARY_ERROR", 502);
          console.error(
            "Meta insights fetch failed:",
            result.status,
            result.data?.error?.message
          );
          const cls = classifyMetaApiError(result.data);
          return errorResponse(cls.code, cls.status);
        }
      }

      // time_increment=all_days면 기간 전체 합산 한 행만 온다(실제 계정으로
      // 검증됨). 그 기간에 집행이 전혀 없으면 data가 빈 배열일 수 있음 —
      // 에러가 아니라 0 상태로 처리한다(요구사항 13-3).
      const todayRow = (todayResult as { ok: true; data: any }).data?.data?.[0] ?? null;
      const monthRow = (monthResult as { ok: true; data: any }).data?.data?.[0] ?? null;

      return Response.json({
        ok: true,
        account: {
          id: externalAccountId,
          name: accountMeta?.name ?? externalAccountId,
          currency,
          timezone_name: timezoneName,
        },
        today: normalizePeriod(todayRow),
        month: normalizePeriod(monthRow),
        queried_range: {
          today: { since: todayStr, until: todayStr },
          month: { since: monthStartStr, until: todayStr },
        },
      });
    } catch (error) {
      console.error(
        "Meta insights error:",
        error instanceof Error ? error.message : error
      );
      return errorResponse("TEMPORARY_ERROR", 502);
    }
  }),
};
