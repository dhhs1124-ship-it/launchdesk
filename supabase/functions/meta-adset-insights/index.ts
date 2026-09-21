import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { getValidMetaAccessToken } from "../_shared/meta-token.ts";
import {
  GRAPH_API_VERSION,
  MAX_INSIGHTS_PAGES,
  MAX_INSIGHTS_ROWS,
  META_ERROR_MESSAGES,
  classifyMetaApiError,
  shouldDowngradeToPending,
  validateAdsetInsightsRequest,
  resolvePeriodRange,
  normalizeIdentityRow,
  groupAdsetsByCampaign,
  fetchAllInsightsRows,
  buildInsightsUrl,
} from "../_shared/meta-adset-normalize.mjs";

// Meta 캠페인/광고 세트/광고 레벨 Insights — 진단 1단계(원본 성과 조회·정규화만).
// 자동 진단 문구·추천 기준값·DB 저장·프런트 화면은 이번 단계 범위 밖이다.
//
// 기존 meta-insights/index.ts(계정 레벨 합계)와 동일한 보안 규칙을 그대로
// 따른다(이 파일은 meta-insights/index.ts를 전혀 수정하지 않는다 — 감사 ·
// 재연결 단계에서 이미 검증된 그 파일의 동작을 이번 작업으로 건드리지 않기
// 위해, 아래 오류 분류 · pending 되돌림 로직은 _shared/meta-adset-normalize.mjs
// 에 새로 옮겨 재사용한다. meta-insights.ts 자신은 여전히 자기 안에 있는
// 사본을 그대로 쓴다 — 최종 보고 참고):
// - access token은 절대 응답에 포함하지 않는다.
// - store_id/connected_account_id는 ctx.supabase(RLS)로 소유권을 먼저
//   확인한 뒤에만 ctx.supabaseAdmin(service role)/Meta API 호출에 쓴다.
// - integration_credentials는 getValidMetaAccessToken()을 통해서만 접근한다.
// - Meta 원문 에러 메시지는 console.error에만 남기고, 응답에는 고정된
//   code + 한국어 메시지만 내려준다.

type Scope = "adsets" | "ads";
type Period = "today" | "month";

interface ConnectedAccountRow {
  id: number;
  status: string | null;
  external_account_id: string | null;
  updated_at: string | null;
}

type MetaFetchResult =
  | { ok: true; data: any }
  | { ok: false; network: true }
  | { ok: false; network: false; status: number; data: any };

async function fetchMetaJson(url: string, accessToken: string): Promise<MetaFetchResult> {
  let res: Response;
  try {
    // access_token은 쿼리 파라미터가 아니라 Authorization 헤더로만 전달 —
    // 로그 어디에도 남지 않는다(meta-insights.ts와 동일한 규칙).
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    console.error(
      "Meta adset insights API request failed:",
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

function errorResponse(code: keyof typeof META_ERROR_MESSAGES, status: number) {
  return Response.json({ error: META_ERROR_MESSAGES[code], code }, { status });
}

// service_role에서만 실행하는 best-effort 상태 되돌림 — meta-insights.ts의
// downgradeToPendingIfStale과 정확히 같은 compare-and-set 조건(id · provider
// ='meta' · status='connected' · updated_at 일치)이다. Deno 전용
// (ctx.supabaseAdmin) 호출이라 이 파일 안에 그대로 둔다(로직 자체의 판단
// 규칙(shouldDowngradeToPending)만 공유 모듈에서 가져와 쓴다).
// deno-lint-ignore no-explicit-any
async function downgradeToPendingIfStale(
  supabaseAdmin: any,
  account: { id: number; updated_at: string | null }
): Promise<void> {
  try {
    let query = supabaseAdmin
      .from("connected_accounts")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", account.id)
      .eq("provider", "meta")
      .eq("status", "connected");

    query = account.updated_at
      ? query.eq("updated_at", account.updated_at)
      : query.is("updated_at", null);

    const { error } = await query;
    if (error) {
      console.error("Meta connected_accounts pending 전환 실패:", error.message);
    }
  } catch (err) {
    console.error(
      "Meta connected_accounts pending 전환 중 예외:",
      err instanceof Error ? err.message : "unknown error"
    );
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const body = await req.json().catch(() => ({}));
      // scope/period/adset_id 형식 검증은 공유 순수 함수 하나로 처리한다
      // (last_7d/last_14d/last_30d는 광고계정 timezone 기준 설계를 다음 UI
      // 단계에서 확정한 뒤 추가할 예정이라 이번에는 today/month만 허용하고
      // 그 외는 임의로 계산하지 않고 명시적으로 거부한다).
      const validated = validateAdsetInsightsRequest(body);
      if (!validated.ok) {
        return Response.json(
          validated.code ? { error: validated.error, code: validated.code } : { error: validated.error },
          { status: validated.status }
        );
      }
      const { store_id, scope, period, adset_id } = validated as {
        store_id: string;
        scope: Scope;
        period: Period;
        adset_id: string | undefined;
      };

      // 1. store_id 소유권 확인 — ctx.supabase는 RLS가 적용되므로 다른
      //    사용자의 store_id는 여기서 이미 걸러진다(meta-oauth-start.ts와
      //    동일한 패턴).
      const { data: store, error: storeError } = await ctx.supabase
        .from("stores")
        .select("id")
        .eq("id", store_id)
        .single();

      if (storeError || !store) {
        return Response.json({ error: "쇼핑몰을 찾을 수 없습니다." }, { status: 404 });
      }

      // 2. 이 store에 연결된 Meta 계정 확인(ops-overview.js의
      //    loadMetaForStore와 동일한 조회 — store_id로 단일 행을 찾는다).
      const { data: account, error: accountError } = await ctx.supabase
        .from("connected_accounts")
        .select("id, status, external_account_id, updated_at")
        .eq("provider", "meta")
        .eq("store_id", store_id)
        .returns<ConnectedAccountRow[]>()
        .maybeSingle();

      if (accountError || !account) {
        return errorResponse("META_NOT_CONNECTED", 404);
      }
      if (account.status !== "connected" || !account.external_account_id) {
        return errorResponse("META_ACCOUNT_NOT_SELECTED", 409);
      }

      // 3. access token 확보 — 실패(credential 없음 · 로컬 만료)는 실제
      //    인증이 끊어졌다는 뜻이므로 pending으로 되돌린다(meta-insights.ts와
      //    동일한 정책).
      const tokenResult = await getValidMetaAccessToken(ctx.supabaseAdmin, account.id);
      if (!tokenResult.ok) {
        await downgradeToPendingIfStale(ctx.supabaseAdmin, account);
        return errorResponse("RECONNECT_REQUIRED", 401);
      }

      const externalAccountId = account.external_account_id;
      const accessToken = tokenResult.accessToken;

      // 4. 광고계정 메타데이터(통화/시간대/상태) — meta-insights.ts와 동일한
      //    요청. timezone은 기간 계산에, currency는 응답 표시에 필요하다.
      const metaUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${externalAccountId}`);
      metaUrl.searchParams.set("fields", "name,currency,timezone_name,account_status");
      const metaResult = await fetchMetaJson(metaUrl.toString(), accessToken);

      if (!metaResult.ok) {
        if (metaResult.network) return errorResponse("TEMPORARY_ERROR", 502);
        console.error("Meta account meta fetch failed:", metaResult.status, metaResult.data?.error?.message);
        const cls = classifyMetaApiError(metaResult.data);
        if (shouldDowngradeToPending(cls.code)) {
          await downgradeToPendingIfStale(ctx.supabaseAdmin, account);
        }
        return errorResponse(cls.code as keyof typeof META_ERROR_MESSAGES, cls.status);
      }

      const accountMeta = metaResult.data;
      const timezoneName: string = accountMeta?.timezone_name || "UTC";
      const currency: string = accountMeta?.currency || "USD";
      const accountStatus = accountMeta?.account_status;

      // Meta account_status enum: 1=ACTIVE만 통과(meta-insights.ts와 동일).
      if (typeof accountStatus === "number" && accountStatus !== 1) {
        return errorResponse("ACCOUNT_UNAVAILABLE", 409);
      }

      const { since, until } = resolvePeriodRange(period, new Date(), timezoneName);
      const level = scope === "ads" ? "ad" : "adset";

      // 5. 실제 Graph API 페이지네이션 조회 — 순수 루프(fetchAllInsightsRows)에
      //    실제 fetch를 감싼 함수만 주입한다.
      const fetchPage = async (after: string | undefined) => {
        const url = buildInsightsUrl({
          accountId: externalAccountId,
          level,
          since,
          until,
          after,
          filteringAdsetId: scope === "ads" ? adset_id : undefined,
        });
        const result = await fetchMetaJson(url, accessToken);
        if (!result.ok) return result;
        const rows = Array.isArray(result.data?.data) ? result.data.data : [];
        const nextAfter: string | undefined =
          result.data?.paging?.next && result.data?.paging?.cursors?.after
            ? result.data.paging.cursors.after
            : undefined;
        return { ok: true as const, rows, nextAfter };
      };

      const pageResult = await fetchAllInsightsRows(fetchPage, {
        maxPages: MAX_INSIGHTS_PAGES,
        maxRows: MAX_INSIGHTS_ROWS,
      });

      if (!pageResult.ok) {
        const err = pageResult.error;
        if (err.network) return errorResponse("TEMPORARY_ERROR", 502);
        console.error("Meta adset/ad insights fetch failed:", err.status, err.data?.error?.message);
        const cls = classifyMetaApiError(err.data);
        if (shouldDowngradeToPending(cls.code)) {
          await downgradeToPendingIfStale(ctx.supabaseAdmin, account);
        }
        return errorResponse(cls.code as keyof typeof META_ERROR_MESSAGES, cls.status);
      }

      const normalizedRows = pageResult.rows.map((row: any) => normalizeIdentityRow(row, level));

      const accountPayload = {
        id: externalAccountId,
        name: accountMeta?.name ?? externalAccountId,
        currency,
        timezone: timezoneName,
      };
      const rangePayload = { period, since, until };
      const pagingPayload = {
        truncated: pageResult.truncated,
        fetched_rows: pageResult.fetchedRows,
        page_count: pageResult.pageCount,
      };

      if (scope === "adsets") {
        return Response.json({
          ok: true,
          account: accountPayload,
          range: rangePayload,
          campaigns: groupAdsetsByCampaign(normalizedRows),
          ...pagingPayload,
        });
      }

      // scope === 'ads' — 이미 하나의 adset으로 좁혀 조회했으므로 campaigns/
      // adsets 중첩 없이 그 adset 식별 정보 + 광고 목록만 반환한다(요구사항
      // 7 — "정확한 키 이름은 조정할 수 있다"에 따른 선택, 근거는 최종 보고).
      const first = normalizedRows[0];
      return Response.json({
        ok: true,
        account: accountPayload,
        range: rangePayload,
        adset: first
          ? {
              campaign_id: first.campaign_id,
              campaign_name: first.campaign_name,
              objective: first.objective,
              adset_id: first.adset_id,
              adset_name: first.adset_name,
            }
          : { campaign_id: null, campaign_name: null, objective: null, adset_id, adset_name: null },
        ads: normalizedRows.map((row: any) => ({
          ad_id: row.ad_id,
          ad_name: row.ad_name,
          metrics: row.metrics,
        })),
        ...pagingPayload,
      });
    } catch (error) {
      console.error(
        "Meta adset insights error:",
        error instanceof Error ? error.message : error
      );
      return errorResponse("TEMPORARY_ERROR", 502);
    }
  }),
};
