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

      // 1. LaunchDesk가 발급한 OAuth state를 원자적으로 "claim"한다(감사 지적 —
      //    Cafe24 OAuth callback TOCTOU). 예전처럼 SELECT로 조건(존재 · 미사용 ·
      //    미만료)을 확인한 뒤 별도 UPDATE로 used_at을 찍는 방식은, 같은 state로
      //    콜백이 동시에 두 번 들어오면(중복 탭, 재전송 등) 둘 다 SELECT 시점에는
      //    "아직 사용 안 됨"을 보고 통과해버릴 수 있었다(TOCTOU race). meta-oauth-
      //    callback과 동일한 방식으로 UPDATE ... WHERE state=? AND provider='cafe24'
      //    AND used_at IS NULL AND expires_at > now() ... RETURNING을 한 번에
      //    실행해 "찾기"와 "사용 처리"를 하나의 원자적 연산으로 합친다. 같은
      //    state에 두 요청이 동시에 이 UPDATE를 실행해도 Postgres가 행 잠금으로
      //    직렬화하므로 먼저 커밋된 요청만 행을 갱신해 결과를 돌려받고(=claim
      //    성공), 나중 요청은 그 시점엔 이미 used_at이 채워져 있어 조건에 안
      //    걸려 0행(= null)을 받는다.
      const nowIso = new Date().toISOString();

      const { data: oauthState, error: claimError } =
        await ctx.supabaseAdmin
          .from("oauth_states")
          .update({ used_at: nowIso })
          .eq("state", state)
          .eq("provider", "cafe24")
          .is("used_at", null)
          .gt("expires_at", nowIso)
          .select("store_id,mall_id")
          .maybeSingle();

      if (claimError) {
        console.error("Cafe24 OAuth state claim error:", claimError.message);
        return goBack("server_error");
      }

      if (!oauthState) {
        // state가 없거나, 이미 사용됐거나, 만료됐거나, provider가 다름 — 원자적
        // claim이라 어느 사유인지 별도로 다시 조회해 구분하지 않는다(meta-oauth-
        // callback과 동일한 이유 — 재조회하면 그 사이 다른 요청이 먼저
        // claim해갈 수 있어 원자성이 깨진다). 이 응답은 정상 사용자 흐름에서는
        // 나오지 않고, 위조/재전송/만료된 리다이렉트에서만 보인다.
        return new Response(
          "Invalid, expired, or already-used OAuth state.",
          { status: 400 }
        );
      }

      // claim에 성공한 이 요청만 아래로 진행한다. 이후 token exchange가
      // 실패해도 state를 다시 쓸 수 있게 되돌리지 않는다 — 사용자는 Cafe24
      // 연결부터 처음부터 다시 시작하면 된다(meta-oauth-callback과 동일한 방침).
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

      // state는 위 1번 claim 시점에 이미 used 처리됐으므로 여기서 다시
      // 건드리지 않는다(meta-oauth-callback과 동일). 토큰은 절대 브라우저로
      // 반환하지 않음.
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