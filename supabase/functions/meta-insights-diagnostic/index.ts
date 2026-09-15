import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import {
  getValidMetaAccessToken,
  metaTokenErrorStatus,
} from "../_shared/meta-token.ts";

// ⚠️ 임시 진단 전용 함수 — docs/plans/meta-insights.md §12(구현 전 검증)를
// 위해 실제 Meta Insights 응답 구조/action_type만 1회 확인하려는 목적.
// 실제 기능이 아니며, 확인이 끝나면 삭제한다(commit하지 않음).
//
// access_token은 절대 응답에 포함하지 않는다 — 아래에서 반환하는 건 Meta가
// 돌려주는 광고 성과 수치(spend/actions/action_values/purchase_roas)와
// 계정 메타데이터(name/currency/timezone_name/account_status)뿐이다.
const GRAPH_API_VERSION = "v21.0";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      // connected_account_id를 입력받지 않는다 — 로그인한 사용자 소유의
      // provider='meta' && status='connected' 행을 RLS로 직접 찾는다.
      // 다른 사용자의 데이터에 접근할 경로 자체가 없다(기존 Meta 함수들과
      // 동일한 ctx.supabase 소유권 확인 패턴).
      const { data: account, error: accountError } = await ctx.supabase
        .from("connected_accounts")
        .select("id, external_account_id, status")
        .eq("provider", "meta")
        .eq("status", "connected")
        .single();

      if (accountError || !account || !account.external_account_id) {
        return Response.json(
          { error: "연결된 Meta 광고계정을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      const tokenResult = await getValidMetaAccessToken(
        ctx.supabaseAdmin,
        account.id
      );

      if (!tokenResult.ok) {
        return Response.json(
          { error: tokenResult.message, code: tokenResult.code },
          { status: metaTokenErrorStatus(tokenResult.code) }
        );
      }

      const externalAccountId = account.external_account_id;

      // 최근 30일 — "오늘"만 보면 구매 데이터가 0건이라 action_type
      // 구조를 확인하기엔 범위가 너무 좁을 수 있다(이 함수는 일회성 진단
      // 전용이라 최종 "오늘/이번 달" 로직과는 무관 — 설계 문서 §5 참고).
      const now = new Date();
      const until = now.toISOString().slice(0, 10);
      const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const metaUrl = new URL(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${externalAccountId}`
      );
      metaUrl.searchParams.set(
        "fields",
        "name,currency,timezone_name,account_status"
      );

      const insightsUrl = new URL(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${externalAccountId}/insights`
      );
      insightsUrl.searchParams.set(
        "fields",
        "spend,actions,action_values,purchase_roas"
      );
      insightsUrl.searchParams.set(
        "time_range",
        JSON.stringify({ since, until })
      );
      insightsUrl.searchParams.set("time_increment", "all_days");
      insightsUrl.searchParams.set("level", "account");

      // access_token은 쿼리 파라미터가 아니라 Authorization 헤더로만.
      const headers = { Authorization: `Bearer ${tokenResult.accessToken}` };

      const [metaRes, insightsRes] = await Promise.all([
        fetch(metaUrl.toString(), { headers }),
        fetch(insightsUrl.toString(), { headers }),
      ]);

      const metaData = await metaRes.json().catch(() => null);
      const insightsData = await insightsRes.json().catch(() => null);

      // 진단 전용이라 Meta 응답을 있는 그대로(구조 확인이 목적) 돌려준다 —
      // 이건 토큰이 아니라 광고 성과 수치/Meta 자체 에러 메시지일 뿐이고,
      // verify_jwt=true라 계정 소유자 본인만 호출할 수 있다.
      return Response.json({
        ok: metaRes.ok && insightsRes.ok,
        account_meta: { status: metaRes.status, data: metaData },
        insights: { status: insightsRes.status, data: insightsData },
        queried_range: { since, until },
      });
    } catch (error) {
      return Response.json(
        {
          error: "진단 중 오류가 발생했습니다.",
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  }),
};
