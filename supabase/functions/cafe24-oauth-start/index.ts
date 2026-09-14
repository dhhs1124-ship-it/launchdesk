import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const REDIRECT_URI =
  "https://zzhvckikonnalqnyatgn.supabase.co/functions/v1/cafe24-oauth-callback";

const SCOPES = [
  "mall.read_product",
  "mall.read_order",
  "mall.read_store",
];

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const { store_id, mall_id } = await req.json();

      if (!store_id || !mall_id) {
        return Response.json(
          { error: "store_id와 mall_id가 필요합니다." },
          { status: 400 }
        );
      }

      const mallId = String(mall_id).trim();

      if (!/^[a-zA-Z0-9_-]+$/.test(mallId)) {
        return Response.json(
          { error: "올바른 Cafe24 쇼핑몰 ID를 입력해주세요." },
          { status: 400 }
        );
      }

      const clientId = Deno.env.get("CAFE24_CLIENT_ID");

      if (!clientId) {
        return Response.json(
          { error: "Cafe24 Client ID가 설정되지 않았습니다." },
          { status: 500 }
        );
      }

      // 로그인 사용자가 소유한 쇼핑몰인지 확인
      // ctx.supabase는 현재 사용자의 RLS를 그대로 적용함
      const { data: store, error: storeError } = await ctx.supabase
        .from("stores")
        .select("id,user_id")
        .eq("id", store_id)
        .single();

      if (storeError || !store) {
        return Response.json(
          { error: "쇼핑몰을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // OAuth state 생성
      const { data: oauthState, error: stateError } =
        await ctx.supabaseAdmin
          .from("oauth_states")
          .insert({
            user_id: store.user_id,
            store_id: store.id,
            provider: "cafe24",
            mall_id: mallId,
          })
          .select("state")
          .single();

      if (stateError || !oauthState) {
        console.error("OAuth state creation failed:", stateError);

        return Response.json(
          { error: "OAuth 요청을 생성하지 못했습니다." },
          { status: 500 }
        );
      }

      // Cafe24 인증 URL 생성
      const authUrl = new URL(
        `https://${mallId}.cafe24api.com/api/v2/oauth/authorize`
      );

      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("state", oauthState.state);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("scope", SCOPES.join(" "));

      return Response.json({
        authorization_url: authUrl.toString(),
      });
    } catch (error) {
      console.error("Cafe24 OAuth start error:", error);

      return Response.json(
        { error: "Cafe24 연결을 시작하지 못했습니다." },
        { status: 500 }
      );
    }
  }),
};