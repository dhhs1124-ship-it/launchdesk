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
      const { connected_account_id, ad_account_id } = await req.json();

      if (!connected_account_id || !ad_account_id) {
        return Response.json(
          { error: "connected_account_id와 ad_account_id가 필요합니다." },
          { status: 400 }
        );
      }

      // Meta 광고계정 id는 항상 "act_<숫자>" 형태 — 임의 문자열이 그대로
      // DB에 저장되거나(다음 단계에서 API 호출에 쓰일 external_account_id)
      // 이 요청 로직에 섞여 들어가지 않도록 형식부터 방어한다.
      if (!/^act_\d+$/.test(String(ad_account_id))) {
        return Response.json(
          { error: "올바른 형식의 광고계정 ID가 아닙니다." },
          { status: 400 }
        );
      }

      // 1. 이 connected_account가 로그인 사용자 소유인지 확인 —
      //    ctx.supabase는 RLS가 적용되므로, 다른 사용자의
      //    connected_account_id는 여기서 이미 걸러진다.
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

      // 2. 클라이언트가 보낸 ad_account_id를 그대로 믿지 않고, Meta API로
      //    이 사용자가 실제로 접근 가능한 광고계정 목록을 다시 조회해
      //    그 안에 포함돼 있는지 재검증한다 — 이래야 다른 사람의
      //    광고계정 ID를 임의로 넣어 연결하는 걸 막을 수 있다.
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
          { error: "Meta 광고계정 목록을 확인하지 못했습니다." },
          { status: 502 }
        );
      }

      const rawAccounts = Array.isArray(metaData?.data) ? metaData.data : [];
      const match = rawAccounts.find(
        (a: any) => a.id === ad_account_id
      );

      if (!match) {
        return Response.json(
          { error: "이 광고계정에 대한 접근 권한을 확인할 수 없습니다." },
          { status: 403 }
        );
      }

      // 3. 검증된 광고계정만 connected_accounts에 확정 저장.
      const { error: updateError } = await ctx.supabaseAdmin
        .from("connected_accounts")
        .update({
          external_account_id: match.id,
          display_name: match.name ?? match.id,
          status: "connected",
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      if (updateError) {
        throw updateError;
      }

      return Response.json({
        ok: true,
        ad_account: {
          id: match.id,
          name: match.name ?? match.id,
          currency: match.currency ?? null,
          timezone_name: match.timezone_name ?? null,
        },
      });
    } catch (error) {
      console.error(
        "Meta account select error:",
        error instanceof Error ? error.message : error
      );

      return Response.json(
        { error: "광고계정 연결 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
  }),
};
