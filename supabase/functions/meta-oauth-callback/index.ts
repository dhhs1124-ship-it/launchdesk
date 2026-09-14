import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const REDIRECT_URI =
  "https://zzhvckikonnalqnyatgn.supabase.co/functions/v1/meta-oauth-callback";

const APP_URL = "https://launchdesk.co.kr";

const GRAPH_API_VERSION = "v21.0";

function goBack(status: string) {
  return Response.redirect(
    `${APP_URL}/?meta=${encodeURIComponent(status)}#/account`,
    302
  );
}

export default {
  // 외부(Meta)가 직접 호출하는 callback이라 Cafe24 callback과 동일한
  // 이유로 JWT Verify를 꺼야 한다(로그인 사용자의 브라우저 세션이 아니라
  // Meta 서버가 리다이렉트로 호출).
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    try {
      const url = new URL(req.url);

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");

      // 사용자가 Meta 권한 승인을 취소한 경우
      if (oauthError) {
        return goBack("denied");
      }

      if (!code || !state) {
        return new Response("Missing OAuth code or state.", {
          status: 400,
        });
      }

      // 1. LaunchDesk가 발급한 OAuth state인지 확인(Cafe24와 동일한
      //    oauth_states 테이블, provider만 'meta')
      const { data: oauthState, error: stateError } =
        await ctx.supabaseAdmin
          .from("oauth_states")
          .select("state,user_id,store_id,provider,expires_at,used_at")
          .eq("state", state)
          .eq("provider", "meta")
          .maybeSingle();

      if (stateError || !oauthState) {
        return new Response("Invalid OAuth state.", {
          status: 400,
        });
      }

      if (oauthState.used_at) {
        return new Response("OAuth state already used.", {
          status: 400,
        });
      }

      if (
        new Date(oauthState.expires_at).getTime() <= Date.now()
      ) {
        return new Response("OAuth state expired.", {
          status: 400,
        });
      }

      const appId = Deno.env.get("META_APP_ID");
      const appSecret = Deno.env.get("META_APP_SECRET");

      if (!appId || !appSecret) {
        console.error("Meta credentials are not configured.");
        return goBack("server_error");
      }

      // 2. Authorization Code → 단기(short-lived) access token 교환
      const shortLivedUrl = new URL(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`
      );
      shortLivedUrl.searchParams.set("client_id", appId);
      shortLivedUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      shortLivedUrl.searchParams.set("client_secret", appSecret);
      shortLivedUrl.searchParams.set("code", code);

      const shortLivedResponse = await fetch(shortLivedUrl.toString());
      const shortLivedData = await shortLivedResponse.json();

      if (!shortLivedResponse.ok || !shortLivedData?.access_token) {
        console.error(
          "Meta short-lived token exchange failed:",
          shortLivedResponse.status
        );
        return goBack("token_error");
      }

      // 3. 단기 → 장기(long-lived, 보통 ~60일) user access token 교환.
      //    Meta는 OAuth2 refresh_token이 없으므로, 만료되면 사용자가
      //    다시 로그인하는 것 외에는 갱신 방법이 없다(요구사항 7).
      const longLivedUrl = new URL(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`
      );
      longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
      longLivedUrl.searchParams.set("client_id", appId);
      longLivedUrl.searchParams.set("client_secret", appSecret);
      longLivedUrl.searchParams.set(
        "fb_exchange_token",
        shortLivedData.access_token
      );

      const longLivedResponse = await fetch(longLivedUrl.toString());
      const longLivedData = await longLivedResponse.json();

      if (!longLivedResponse.ok || !longLivedData?.access_token) {
        console.error(
          "Meta long-lived token exchange failed:",
          longLivedResponse.status
        );
        return goBack("token_error");
      }

      const accessToken = longLivedData.access_token as string;
      const expiresInSec =
        typeof longLivedData.expires_in === "number"
          ? longLivedData.expires_in
          : null;
      const accessTokenExpiresAt = expiresInSec
        ? new Date(Date.now() + expiresInSec * 1000).toISOString()
        : null;

      // 4. 기존 Meta 연결이 있는지 확인 — 있으면 재인증으로 취급해
      //    'pending'으로 되돌린다(이전에 고른 광고계정이 이번 로그인
      //    권한 범위에도 여전히 포함되는지 보장할 수 없으므로, 다시
      //    선택하게 한다). external_account_id/display_name도 함께
      //    비운다.
      const { data: existingAccounts, error: existingError } =
        await ctx.supabaseAdmin
          .from("connected_accounts")
          .select("id")
          .eq("store_id", oauthState.store_id)
          .eq("provider", "meta")
          .limit(1);

      if (existingError) {
        throw existingError;
      }

      let connectedAccountId: number;

      if (existingAccounts && existingAccounts.length > 0) {
        connectedAccountId = existingAccounts[0].id;

        const { error } = await ctx.supabaseAdmin
          .from("connected_accounts")
          .update({
            status: "pending",
            external_account_id: null,
            display_name: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", connectedAccountId);

        if (error) throw error;
      } else {
        const { data, error } = await ctx.supabaseAdmin
          .from("connected_accounts")
          .insert({
            store_id: oauthState.store_id,
            provider: "meta",
            status: "pending",
          })
          .select("id")
          .single();

        if (error || !data) {
          throw error ?? new Error("Connected account creation failed.");
        }

        connectedAccountId = data.id;
      }

      // 5. Access Token을 서버 전용 테이블에 저장. Meta는 refresh_token
      //    개념이 없으므로 그 컬럼들은 NULL로 남긴다(Cafe24와의 스키마
      //    공유 지점 — integration_credentials.refresh_token이 NOT NULL
      //    이면 이 upsert가 실패한다. 완료 보고의 DB 확인 사항 참고).
      const { error: credentialError } =
        await ctx.supabaseAdmin
          .from("integration_credentials")
          .upsert(
            {
              connected_account_id: connectedAccountId,
              access_token: accessToken,
              refresh_token: null,
              access_token_expires_at: accessTokenExpiresAt,
              refresh_token_expires_at: null,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "connected_account_id",
            }
          );

      if (credentialError) {
        throw credentialError;
      }

      // 6. state 재사용 방지
      const { error: usedError } = await ctx.supabaseAdmin
        .from("oauth_states")
        .update({
          used_at: new Date().toISOString(),
        })
        .eq("state", state);

      if (usedError) {
        throw usedError;
      }

      // 광고계정은 아직 선택되지 않았다(status='pending') — 실제 선택은
      // LaunchDesk 화면에서 meta-adaccounts/meta-account-select를 통해
      // 이어서 진행된다. 토큰은 절대 브라우저로 반환하지 않음.
      return goBack("connected");
    } catch (error) {
      console.error(
        "Meta OAuth callback error:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return goBack("server_error");
    }
  }),
};
