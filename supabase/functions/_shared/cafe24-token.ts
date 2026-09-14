// Cafe24 Access Token 공통 처리 — cafe24-store-info / cafe24-orders-sync가
// 각자 만료를 판단하던 로직을 여기 하나로 모았다. 두 함수는 이제
// getValidCafe24AccessToken()만 호출하면 되고, "지금 쓸 수 있는
// access_token을 달라"는 요청에 대해:
//   - 아직 충분히 유효하면 저장된 값을 그대로,
//   - 만료됐거나 곧 만료되면(5분 이내) Cafe24 공식 refresh_token 플로우로
//     새로 받아서 DB에 즉시 저장한 뒤 그 값을,
//   - refresh_token 자체도 만료됐거나 Cafe24가 refresh를 거부하면
//     RECONNECT_REQUIRED를,
// 돌려준다.
//
// 보안 주의:
// - CAFE24_CLIENT_ID/SECRET은 Deno.env.get()으로만 읽는다(Supabase
//   Secrets) — 이 값도, access_token/refresh_token도 절대 콘솔에 찍거나
//   호출한 함수의 응답(Response)에 그대로 실어 보내지 않는다. 에러 로그에는
//   HTTP status 등 메타데이터만 남긴다.
// - OAuth 시작/콜백(state 발급, 최초 토큰 발급, connected_accounts 생성)
//   로직은 여기서 건드리지 않는다 — 이미 발급된 토큰을 "유효하게 유지"하는
//   것까지만 이 모듈의 역할이다.
//
// 알려진 한계: 같은 connected_account_id에 대해 거의 동시에 요청 두 개가
// 들어와 access_token이 동시에 만료 상태로 판정되면, refresh 요청이 두 번
// 나갈 수 있다. Cafe24는 refresh 시 이전 refresh_token을 폐기하므로 이
// 경우 먼저 끝난 쪽이 저장한 토큰을 나중 응답이 덮어써도 최종 상태 자체는
// 여전히 유효한 최신 토큰이라 서비스에는 영향이 없지만, 완벽한 동시성
// 제어(행 잠금 등)는 이번 단계 범위 밖이라 다루지 않았다.

// supabaseAdmin의 정확한 타입은 "jsr:@supabase/server" 내부 타입이라 여기서
// 다시 끌어오지 않고, 이 모듈이 실제로 쓰는 모양(.from(...).select/update)만
// 느슨하게 허용한다 — index.ts들이 이미 ctx.supabaseAdmin을 타입 없이 쓰는
// 것과 동일한 방식.
// deno-lint-ignore no-explicit-any
type SupabaseAdminClient = any;

// Access Token 만료 5분 전부터는 "이미 만료된 것"처럼 취급해 미리 갱신한다
// (요청 처리 도중 만료되어 Cafe24 API가 401을 주는 상황을 피하기 위함).
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface IntegrationCredentialRow {
  access_token: string;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
}

interface Cafe24TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_token_expires_at: string;
}

export type Cafe24TokenResult =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      // CREDENTIAL_NOT_FOUND: integration_credentials 행 자체가 없음
      // RECONNECT_REQUIRED : refresh_token이 만료됐거나 Cafe24가 refresh를 거부함 — 사용자가 다시 연결해야 함
      // CONFIG_ERROR       : CAFE24_CLIENT_ID/SECRET이 설정되지 않음(서버 설정 문제)
      // REFRESH_FAILED     : Cafe24 refresh는 성공했지만 새 토큰을 DB에 저장하지 못함
      code:
        | "CREDENTIAL_NOT_FOUND"
        | "RECONNECT_REQUIRED"
        | "CONFIG_ERROR"
        | "REFRESH_FAILED";
      message: string;
    };

function isStillValid(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return false;
  return expiresAtMs - Date.now() > EXPIRY_BUFFER_MS;
}

function isDefinitelyExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true; // 값이 없으면 안전하게 "만료"로 취급
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs <= Date.now();
}

// Cafe24 공식 OAuth refresh_token 플로우.
// POST https://{mall_id}.cafe24api.com/api/v2/oauth/token
// Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
async function requestCafe24TokenRefresh(
  mallId: string,
  refreshToken: string
): Promise<
  | { ok: true; data: Cafe24TokenRefreshResponse }
  | { ok: false; code: "CONFIG_ERROR" | "RECONNECT_REQUIRED"; message: string }
> {
  const clientId = Deno.env.get("CAFE24_CLIENT_ID");
  const clientSecret = Deno.env.get("CAFE24_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message: "Cafe24 Client 설정이 없습니다.",
    };
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await fetch(
      `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
  } catch (err) {
    console.error(
      "Cafe24 token refresh request failed:",
      err instanceof Error ? err.message : "network error"
    );
    return {
      ok: false,
      code: "RECONNECT_REQUIRED",
      message: "Cafe24 Refresh Token 갱신 요청에 실패했습니다.",
    };
  }

  // 응답 바디(토큰 포함 가능성)는 절대 로그로 남기지 않는다 — status만 기록.
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    // Cafe24는 만료/폐기된 refresh_token에 보통 400을 반환한다 — 이 경우
    // 자동 재시도하지 않고 재연결이 필요하다는 신호로 취급한다.
    console.error("Cafe24 token refresh rejected:", response.status);
    return {
      ok: false,
      code: "RECONNECT_REQUIRED",
      message: "Cafe24 Refresh Token이 만료되었거나 거부되었습니다.",
    };
  }

  return { ok: true, data: data as Cafe24TokenRefreshResponse };
}

/**
 * 지금 Cafe24 API 호출에 쓸 수 있는 access_token을 반환한다.
 * 필요하면 refresh_token으로 자동 갱신하고, 그 결과(새 토큰 전부)를
 * integration_credentials에 즉시 저장한다.
 *
 * @param supabaseAdmin  ctx.supabaseAdmin (service role — RLS 우회, 서버 전용)
 * @param connectedAccountId  integration_credentials.connected_account_id
 * @param mallId  Cafe24 쇼핑몰 ID(서브도메인) — refresh 요청 URL 구성용
 */
export async function getValidCafe24AccessToken(
  supabaseAdmin: SupabaseAdminClient,
  connectedAccountId: number,
  mallId: string
): Promise<Cafe24TokenResult> {
  const { data: credential, error } = await supabaseAdmin
    .from("integration_credentials")
    .select(
      "access_token, refresh_token, access_token_expires_at, refresh_token_expires_at"
    )
    .eq("connected_account_id", connectedAccountId)
    .single();

  if (error || !credential) {
    return {
      ok: false,
      code: "CREDENTIAL_NOT_FOUND",
      message: "Cafe24 인증정보를 찾을 수 없습니다.",
    };
  }

  const row = credential as IntegrationCredentialRow;

  // 1. Access Token이 아직(만료 5분 전보다 더) 유효하면 그대로 반환.
  if (isStillValid(row.access_token_expires_at)) {
    return { ok: true, accessToken: row.access_token };
  }

  // 2. Access Token은 만료/임박했다 — refresh 전에 Refresh Token 자체의
  //    만료부터 확인한다. 만료됐으면 자동 갱신을 시도하지 않는다.
  if (!row.refresh_token || isDefinitelyExpired(row.refresh_token_expires_at)) {
    return {
      ok: false,
      code: "RECONNECT_REQUIRED",
      message: "Cafe24 연결이 만료되어 다시 연결해야 합니다.",
    };
  }

  // 3. Cafe24 공식 refresh_token 플로우로 갱신.
  const refreshed = await requestCafe24TokenRefresh(mallId, row.refresh_token);
  if (!refreshed.ok) {
    return refreshed;
  }

  const newTokens = refreshed.data;

  // 4. Cafe24는 refresh 시 기존 refresh_token을 폐기하므로, 새
  //    refresh_token을 반드시 함께 저장해야 한다 — access_token만 갱신하면
  //    다음 번 refresh가 실패한다.
  const { error: updateError } = await supabaseAdmin
    .from("integration_credentials")
    .update({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      access_token_expires_at: newTokens.expires_at,
      refresh_token_expires_at: newTokens.refresh_token_expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("connected_account_id", connectedAccountId);

  if (updateError) {
    console.error(
      "Cafe24 credential update after refresh failed:",
      updateError.message
    );
    return {
      ok: false,
      code: "REFRESH_FAILED",
      message: "갱신된 Cafe24 토큰을 저장하지 못했습니다.",
    };
  }

  return { ok: true, accessToken: newTokens.access_token };
}

// getValidCafe24AccessToken()의 실패 code를 호출부(index.ts)의
// Response.json({ ... }, { status }) 상태코드로 매핑 — 두 함수(store-info,
// orders-sync)가 각자 같은 switch를 반복하지 않도록 여기 하나로 모았다.
// RECONNECT_REQUIRED만 401(클라이언트가 재연결 흐름을 타야 함)이고, 나머지는
// 전부 서버/설정 쪽 문제라 500.
export function cafe24TokenErrorStatus(
  code: Extract<Cafe24TokenResult, { ok: false }>["code"]
): number {
  return code === "RECONNECT_REQUIRED" ? 401 : 500;
}
