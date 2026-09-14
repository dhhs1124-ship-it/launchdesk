import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { normalizeCafe24ExpiresAt } from "../_shared/cafe24-token.ts";

const REDIRECT_URI =
  "https://zzhvckikonnalqnyatgn.supabase.co/functions/v1/cafe24-oauth-callback";

const APP_URL = "https://launchdesk.co.kr";

function goBack(status: string) {
  return Response.redirect(
    `${APP_URL}/?cafe24=${encodeURIComponent(status)}#/account`,
    302
  );
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    try {
      const url = new URL(req.url);

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");

      // 사용자가 Cafe24 권한 승인을 취소한 경우
      if (oauthError) {
        return goBack("denied");
      }

      if (!code || !state) {
        return new Response("Missing OAuth code or state.", {
          status: 400,
        });
      }

      // 1. LaunchDesk가 발급한 OAuth state인지 확인
      const { data: oauthState, error: stateError } =
        await ctx.supabaseAdmin
          .from("oauth_states")
          .select(
            "state,user_id,store_id,mall_id,expires_at,used_at"
          )
          .eq("state", state)
          .eq("provider", "cafe24")
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

      const mallId = oauthState.mall_id;

      // mall_id가 외부 임의 호스트를 만들지 못하도록 제한
      if (!/^[a-zA-Z0-9_-]+$/.test(mallId)) {
        return new Response("Invalid mall id.", {
          status: 400,
        });
      }

      const clientId = Deno.env.get("CAFE24_CLIENT_ID");
      const clientSecret = Deno.env.get("CAFE24_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        console.error("Cafe24 credentials are not configured.");
        return goBack("server_error");
      }

      // 2. Cafe24 Authorization Code → Token 교환
      const basicAuth = btoa(`${clientId}:${clientSecret}`);

      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      });

      const tokenResponse = await fetch(
        `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: tokenBody.toString(),
        }
      );

      const tokenData = await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !tokenData.access_token ||
        !tokenData.refresh_token
      ) {
        console.error(
          "Cafe24 token exchange failed:",
          tokenResponse.status
        );

        return goBack("token_error");
      }

      // 3. 기존 Cafe24 연결이 있는지 확인
      const { data: existingAccounts, error: existingError } =
        await ctx.supabaseAdmin
          .from("connected_accounts")
          .select("id")
          .eq("store_id", oauthState.store_id)
          .eq("provider", "cafe24")
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
            external_account_id: mallId,
            display_name: mallId,
            status: "connected",
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", connectedAccountId);

        if (error) throw error;
      } else {
        const { data, error } = await ctx.supabaseAdmin
          .from("connected_accounts")
          .insert({
            store_id: oauthState.store_id,
            provider: "cafe24",
            external_account_id: mallId,
            display_name: mallId,
            status: "connected",
            connected_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (error || !data) {
          throw error ?? new Error("Connected account creation failed.");
        }

        connectedAccountId = data.id;
      }

      // 4. Access / Refresh Token을 서버 전용 테이블에 저장
      const { error: credentialError } =
        await ctx.supabaseAdmin
          .from("integration_credentials")
          .upsert(
            {
              connected_account_id: connectedAccountId,
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              access_token_expires_at: normalizeCafe24ExpiresAt(
                tokenData.expires_at
              ),
              refresh_token_expires_at: normalizeCafe24ExpiresAt(
                tokenData.refresh_token_expires_at
              ),
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "connected_account_id",
            }
          );

      if (credentialError) {
        throw credentialError;
      }

      // 5. stores에도 Cafe24 mall_id 기록
      const { error: storeError } = await ctx.supabaseAdmin
        .from("stores")
        .update({
          external_store_id: mallId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", oauthState.store_id);

      if (storeError) {
        throw storeError;
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

      // 토큰은 절대 브라우저로 반환하지 않음
      return goBack("connected");
    } catch (error) {
      console.error(
        "Cafe24 OAuth callback error:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return goBack("server_error");
    }
  }),
};