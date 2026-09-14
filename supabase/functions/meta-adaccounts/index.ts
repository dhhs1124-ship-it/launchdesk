import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import {
  getValidMetaAccessToken,
  metaTokenErrorStatus,
} from "../_shared/meta-token.ts";

const GRAPH_API_VERSION = "v21.0";
const FIELDS = "id,name,account_status,currency,timezone_name";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const { connected_account_id } = await req.json();

      if (!connected_account_id) {
        return Response.json(
          { error: "connected_account_id가 필요합니다." },
          { status: 400 }
        );
      }

      // 이 connected_account가 로그인 사용자 소유인지 확인 — ctx.supabase는
      // 현재 사용자의 RLS를 그대로 적용하므로, 다른 사용자의
      // connected_account_id를 넘기면 이 select 자체가 아무 것도
      // 돌려주지 않는다(Cafe24 함수들과 동일한 소유권 확인 패턴).
      const { data: account, error: accountError } = await ctx.supabase
        .from("connected_accounts")
        .select("id, store_id, provider")
        .eq("id", connected_account_id)
        .eq("provider", "meta")
        .single();

      if (accountError || !account) {
        return Response.json(
          { error: "Meta 연결을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 서버 전용 테이블에서 Access Token 확보(만료됐으면 재연결 필요 —
      // Meta는 Cafe24와 달리 자동 refresh가 불가능하다).
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

      // Meta 실제 API 호출 — 이 사용자가 접근 가능한 광고계정 목록.
      // access_token은 쿼리 파라미터가 아니라 Authorization 헤더로 보내
      // (서버↔Meta 간 호출이라도) 어떤 로그에도 남지 않게 한다.
      const adAccountsUrl = new URL(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/me/adaccounts`
      );
      adAccountsUrl.searchParams.set("fields", FIELDS);

      const metaResponse = await fetch(adAccountsUrl.toString(), {
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
        },
      });

      const metaData = await metaResponse.json();

      if (!metaResponse.ok) {
        console.error(
          "Meta adaccounts API failed:",
          metaResponse.status,
          metaData?.error?.message
        );

        return Response.json(
          { error: "Meta 광고계정 목록을 가져오지 못했습니다." },
          { status: 502 }
        );
      }

      const rawAccounts = Array.isArray(metaData?.data) ? metaData.data : [];

      // 안전한 메타데이터만 추려서 반환 — access_token은 절대 포함하지 않음.
      const adAccounts = rawAccounts.map((a: any) => ({
        id: a.id,
        name: a.name ?? a.id,
        account_status: a.account_status ?? null,
        currency: a.currency ?? null,
        timezone_name: a.timezone_name ?? null,
      }));

      return Response.json({ ok: true, ad_accounts: adAccounts });
    } catch (error) {
      console.error(
        "Meta adaccounts error:",
        error instanceof Error ? error.message : error
      );

      return Response.json(
        { error: "Meta 광고계정 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
  }),
};
