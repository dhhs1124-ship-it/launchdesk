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

// integration_credentials에 Meta access token을 upsert — "재연결(기존 행
// 있음)"과 "최초 연결(새 행)" 두 분기가 동일하게 쓴다(코드리뷰 지적 5).
// deno-lint-ignore no-explicit-any
async function saveMetaCredential(
  supabaseAdmin: any,
  connectedAccountId: number,
  accessToken: string,
  accessTokenExpiresAt: string | null
) {
  // Meta는 refresh_token 개념이 없으므로 그 컬럼들은 NULL로 남긴다(Cafe24와의
  // 스키마 공유 지점 — integration_credentials.refresh_token이 NOT NULL이면
  // 이 upsert가 실패한다. 첫 번째 완료 보고의 DB 확인 사항 참고).
  return await supabaseAdmin.from("integration_credentials").upsert(
    {
      connected_account_id: connectedAccountId,
      access_token: accessToken,
      refresh_token: null,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connected_account_id" }
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

      // 1. LaunchDesk가 발급한 OAuth state를 원자적으로 "claim"한다(코드리뷰
      //    지적 1). 예전처럼 SELECT로 조회해 조건을 확인한 뒤 나중에
      //    UPDATE로 used_at을 찍는 방식은, 같은 state로 콜백이 동시에 두 번
      //    들어오면(중복 탭, 재전송 등) 둘 다 "아직 사용 안 됨" 상태를 보고
      //    검증을 통과해버릴 수 있다(TOCTOU race). 대신 UPDATE ... WHERE
      //    provider='meta' AND used_at IS NULL AND expires_at > now() ...
      //    RETURNING을 한 번에 실행해, 조건을 만족하는 행을 "찾는 것"과
      //    "사용 처리하는 것"을 하나의 원자적 연산으로 합친다. 같은 state에
      //    대해 두 요청이 동시에 이 UPDATE를 실행해도 Postgres가 행 잠금으로
      //    둘을 직렬화하므로, 먼저 커밋된 요청만 실제로 행을 갱신해 결과를
      //    돌려받고(=이 요청만 claim 성공), 나중 요청은 그 시점엔 이미
      //    used_at이 채워져 있어 조건에 안 걸려 0행(= null)을 받는다 — 두
      //    요청이 동시에 통과할 수 없다.
      const nowIso = new Date().toISOString();

      const { data: oauthState, error: claimError } =
        await ctx.supabaseAdmin
          .from("oauth_states")
          .update({ used_at: nowIso })
          .eq("state", state)
          .eq("provider", "meta")
          .is("used_at", null)
          .gt("expires_at", nowIso)
          .select("store_id")
          .maybeSingle();

      if (claimError) {
        console.error("Meta OAuth state claim error:", claimError.message);
        return goBack("server_error");
      }

      if (!oauthState) {
        // state가 없거나, 이미 사용됐거나, 만료됐거나, provider가 다름 —
        // 원자적 claim이라 어느 사유인지 별도로 다시 조회해 구분하지 않는다
        // (그러려면 이 판단 이후에 다시 SELECT해야 하는데, 그 사이 다른
        // 요청이 먼저 claim해갈 수 있어 의미가 없다). 이 응답은 정상 사용자
        // 흐름에서는 나오지 않고, 위조/재전송/만료된 리다이렉트에서만 보인다.
        return new Response(
          "Invalid, expired, or already-used OAuth state.",
          { status: 400 }
        );
      }

      // claim에 성공한 이 요청만 아래로 진행한다. 이후 token exchange가
      // 실패해도 state를 다시 쓸 수 있게 되돌리지 않는다 — 사용자는 [Meta
      // 광고 연결]부터 처음부터 다시 시작하면 된다(요구사항 1).
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

      // 4. 기존 Meta 연결이 있는지 확인.
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
        // 재연결 — 기존에 정상 동작하던 연결(status='connected',
        // external_account_id/display_name)이 있을 수 있다. 새 token
        // 저장을 먼저 성공시킨 뒤에만 그 행을 pending으로 전환한다
        // (코드리뷰 지적 5). 순서를 반대로 하면(먼저 pending으로 바꾸고
        // 나중에 credential을 저장) credential 저장이 실패했을 때 이미 잘
        // 동작하던 기존 연결까지 함께 망가진다 — connected_account_id는
        // 이미 알고 있으므로(기존 행) FK 문제 없이 이 순서로 저장 가능.
        connectedAccountId = existingAccounts[0].id;

        const { error: credentialError } = await saveMetaCredential(
          ctx.supabaseAdmin,
          connectedAccountId,
          accessToken,
          accessTokenExpiresAt
        );

        if (credentialError) {
          // 새 token 저장에 실패했다 — 기존 connected_accounts 행은 전혀
          // 건드리지 않았으므로, 기존 연결은 그대로 살아있다.
          throw credentialError;
        }

        // token 저장이 성공한 뒤에만 'pending'으로 전환한다(이전에 고른
        // 광고계정이 이번 로그인 권한 범위에도 여전히 포함되는지 보장할 수
        // 없으므로, 다시 선택하게 한다). external_account_id/display_name도
        // 함께 비운다.
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
        // 최초 연결 — 보호할 기존 상태가 없으므로 순서가 안전에 영향을
        // 주지 않는다. integration_credentials.connected_account_id는 FK라
        // connected_accounts 행을 먼저 만들어 id를 확보해야 한다.
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

        const { error: credentialError } = await saveMetaCredential(
          ctx.supabaseAdmin,
          connectedAccountId,
          accessToken,
          accessTokenExpiresAt
        );

        if (credentialError) {
          throw credentialError;
        }
      }

      // 광고계정은 아직 선택되지 않았다(status='pending') — 실제 선택은
      // LaunchDesk 화면에서 meta-adaccounts/meta-account-select를 통해
      // 이어서 진행된다. 토큰은 절대 브라우저로 반환하지 않음. state는 위
      // 1번 claim 시점에 이미 used 처리됐으므로 여기서 다시 건드리지 않는다.
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
