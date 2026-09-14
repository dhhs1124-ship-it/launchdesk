import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const REDIRECT_URI =
  "https://zzhvckikonnalqnyatgn.supabase.co/functions/v1/meta-oauth-callback";

// Meta Graph API 버전 — Meta가 주기적으로 구버전을 폐기하므로(대략 2년
// 주기) 나중에 여기 한 곳만 올리면 된다(cafe24-orders-sync의 API_VERSION과
// 같은 이유).
const GRAPH_API_VERSION = "v21.0";

// MVP 최소 권한 — 광고계정 정보/성과 "읽기"만. 광고 생성·수정 권한
// (ads_management)은 요청하지 않는다(요구사항 3).
const SCOPES = ["ads_read"];

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const { store_id } = await req.json();

      if (!store_id) {
        return Response.json(
          { error: "store_id가 필요합니다." },
          { status: 400 }
        );
      }

      const appId = Deno.env.get("META_APP_ID");

      if (!appId) {
        return Response.json(
          { error: "Meta App ID가 설정되지 않았습니다." },
          { status: 500 }
        );
      }

      // 로그인 사용자가 소유한 쇼핑몰인지 확인 — Cafe24와 동일하게
      // ctx.supabase(RLS 적용)로 조회한다. 다른 사용자의 store_id를
      // 넘기면 이 select 자체가 아무 것도 돌려주지 않는다.
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

      // OAuth state 생성 — Cafe24와 같은 oauth_states 테이블을 provider만
      // 다르게(= 'meta') 재사용한다. mall_id는 Cafe24 전용 컬럼이라 여기선
      // 채우지 않는다(nullable이어야 함 — 완료 보고의 DB 확인 사항 참고).
      const { data: oauthState, error: stateError } =
        await ctx.supabaseAdmin
          .from("oauth_states")
          .insert({
            user_id: store.user_id,
            store_id: store.id,
            provider: "meta",
          })
          .select("state")
          .single();

      if (stateError || !oauthState) {
        console.error("Meta OAuth state creation failed:", stateError);

        return Response.json(
          { error: "OAuth 요청을 생성하지 못했습니다." },
          { status: 500 }
        );
      }

      // Meta 로그인(OAuth) 다이얼로그 URL 생성 — Graph API Explorer용
      // 임시 토큰이 아니라, 이 사용자 자신의 실제 Facebook Login 플로우.
      const authUrl = new URL(
        `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`
      );

      authUrl.searchParams.set("client_id", appId);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("state", oauthState.state);
      authUrl.searchParams.set("scope", SCOPES.join(","));
      authUrl.searchParams.set("response_type", "code");

      return Response.json({
        authorization_url: authUrl.toString(),
      });
    } catch (error) {
      console.error("Meta OAuth start error:", error);

      return Response.json(
        { error: "Meta 광고 연결을 시작하지 못했습니다." },
        { status: 500 }
      );
    }
  }),
};
