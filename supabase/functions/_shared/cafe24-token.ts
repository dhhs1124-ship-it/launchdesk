// Cafe24 Access Token 공통 처리 — cafe24-store-info / cafe24-orders-sync가
// 각자 만료를 판단하던 로직을 여기 하나로 모았다. 두 함수는 이제
// getValidCafe24AccessToken()만 호출하면 되고, "지금 쓸 수 있는
// access_token을 달라"는 요청에 대해:
//   - 아직 충분히 유효하면 저장된 값을 그대로,
//   - 만료됐거나 곧 만료되면(5분 이내) Cafe24 공식 refresh_token 플로우로
//     새로 받아서 DB에 즉시 저장한 뒤 그 값을,
//   - refresh_token 자체도 만료됐거나 Cafe24가 만료 · 폐기(invalid_grant)로 거부하면
//     RECONNECT_REQUIRED를,
//   - 시간 초과 · 네트워크 오류 · 일시적 서버 오류(5xx · 429) · 응답 본문 읽기 실패처럼
//     토큰 만료 근거가 없는 실패는 REFRESH_RETRYABLE(잠시 후 다시 시도)을,
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
// 동시 갱신: Cafe24는 새 토큰을 발급하면 이전 refresh_token을 폐기한다. 그래서 같은
// 계정에 대해 갱신 요청이 두 번 나가면 한쪽은 실패하고, 저장 순서가 엇갈리면 폐기된
// 토큰이 DB에 남아 연결이 끊길 수 있다. 이를 막으려고 Cafe24에 갱신을 요청하기 전에
// integration_credentials.updated_at을 읽은 값과 비교·교체(CAS)해 한 요청만 갱신 권한을
// 갖는다. 나머지 요청은 갱신된 토큰이 저장될 때까지 기다렸다가 그 토큰을 쓴다.
// 시차 요청: 권한을 잡은 요청이 Cafe24 응답을 기다리는 동안 온 요청은 바뀐 updated_at을 읽는다 —
// 그 값으로 CAS하면 다시 성공해 같은 refresh_token으로 중복 갱신된다. 그래서 토큰이 만료됐는데
// updated_at이 CLAIM_LEASE_MS 안의 값이면 '갱신 중'으로 보고 CAS하지 않고 기다린다(임대 시간이
// 지나도 새 토큰이 없으면 권한을 잡은 요청이 끝내지 못한 것으로 보고 다시 잡는다). 갱신 요청은
// REFRESH_TIMEOUT_MS로 끊어 임대 시간 안에 끝나게 한다. 스키마 변경 없음.

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
  updated_at: string | null;
}

const CREDENTIAL_COLUMNS =
  "access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, updated_at";
// 다른 요청이 갱신 권한을 가져갔을 때 새 토큰을 기다리는 시간. 갱신 권한을 가진 요청이
// 중간에 죽었으면(이 시간 동안 토큰이 바뀌지 않으면) 한 번 더 권한을 얻어 직접 갱신한다.
const REFRESH_WAIT_MS = 12000;
const REFRESH_POLL_MS = 400;
// 갱신 권한 임대 시간 — Cafe24 갱신 요청 시간 제한 + 저장 여유보다 길어야 한다.
const CLAIM_LEASE_MS = 30000;
const REFRESH_TIMEOUT_MS = 10000;
// 토큰이 만료됐는데 최근(임대 시간 안)에 updated_at이 바뀌었으면 다른 요청이 갱신 중이다.
const refreshInProgress = (updatedAt: string | null): boolean => {
  if (!updatedAt) return false;
  const at = new Date(updatedAt).getTime();
  return !Number.isNaN(at) && Date.now() - at < CLAIM_LEASE_MS;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      // RECONNECT_REQUIRED : refresh_token이 만료됐거나 Cafe24가 만료 · 폐기(invalid_grant)로 거부함 — 사용자가 다시 연결해야 함
      // CONFIG_ERROR       : CAFE24_CLIENT_ID/SECRET이 없거나 Cafe24가 앱 인증을 거부함(invalid_client — 서버 설정 문제)
      // REFRESH_RETRYABLE  : 시간 초과 · 네트워크 오류 · 일시적 서버 오류 · 본문 읽기 실패 · 다른 요청의 갱신 대기 초과 — 잠시 후 다시 시도
      // REFRESH_FAILED     : 새 토큰을 DB에 저장하지 못함 · 근거를 알 수 없는 거부(그 밖의 4xx)
      code:
        | "CREDENTIAL_NOT_FOUND"
        | "RECONNECT_REQUIRED"
        | "CONFIG_ERROR"
        | "REFRESH_RETRYABLE"
        | "REFRESH_FAILED";
      message: string;
    };

// Cafe24 토큰 응답의 만료 시각(access_token_expires_at, refresh_token_expires_at)은
// 타임존 오프셋 없이 "YYYY-MM-DD HH:mm:ss"(또는 T 구분자) 형태로 온다 — 이 값은
// UTC가 아니라 Cafe24 기준 KST(Asia/Seoul, UTC+9)다. 오프셋 없는 문자열을 그대로
// timestamptz 컬럼에 넣으면 Postgres가 UTC로 해석해 실제보다 9시간 늦게(미래로)
// 저장되고, 그 사이 이미 만료된 access_token을 isStillValid()가 "아직 유효"로
// 오판해 Cafe24 API가 401(access_token time expired)을 반환한다 — 실제로 발생한
// 버그. cafe24-orders-sync의 normalizeCafe24Date()(주문일자용)와 같은 이유의
// 보정을 여기서도 저장 직전에 적용한다.
//
// - 이미 오프셋(+09:00 등)이나 'Z'가 붙어 있으면 그대로 파싱만 한다(중복으로
//   -9시간 보정하지 않기 위함 — Cafe24가 나중에 포맷을 바꿔도 안전).
// - 오프셋이 없으면 KST로 해석해 정확한 UTC 순간의 ISO 문자열로 변환한다.
// - 숫자(초 단위 TTL, 예: expires_in)면 "지금부터 N초 후"로 계산한다(기존 의미 유지
//   — 이 필드는 애초에 타임존과 무관한 상대값이라 보정 대상이 아니다).
export function normalizeCafe24ExpiresAt(
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? new Date(Date.now() + value * 1000).toISOString()
      : null;
  }

  // 오프셋(Z 또는 +hh:mm/-hh:mm)이 이미 있으면 그대로 파싱만 한다.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // "YYYY-MM-DD HH:mm:ss" 또는 "YYYY-MM-DDTHH:mm:ss"(밀리초 optional) — 오프셋
  // 없음 → Cafe24 기준 KST로 해석.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
    const d = new Date(value.replace(" ", "T") + "+09:00");
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // 알 수 없는 형식 — 무리하게 보정하지 않고 있는 그대로 파싱만 시도한다.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
  | { ok: false; code: Cafe24RefreshFailureCode; message: string }
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
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      }
    );
  } catch (err) {
    // 시간 초과(TimeoutError) · 네트워크 오류 — 토큰 만료 근거가 아니므로 재연결로 보내지 않는다.
    console.error("Cafe24 token refresh request failed:", errorName(err));
    return retryable("Cafe24 토큰 갱신 요청이 시간 초과되었거나 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.");
  }

  // 응답 바디(토큰 포함 가능성)는 절대 로그로 남기지 않는다 — status만 기록.
  // deno-lint-ignore no-explicit-any
  let data: any = null;
  try {
    data = await response.json();
  } catch (err) {
    // 본문을 읽다 끊김(시간 초과 · 연결 끊김)은 재시도 가능. JSON이 아닌 본문(SyntaxError)은 아래에서 상태 코드로 판단.
    if (!(err instanceof SyntaxError)) {
      console.error("Cafe24 token refresh body read failed:", response.status, errorName(err));
      return retryable("Cafe24 토큰 갱신 응답을 끝까지 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  if (response.ok && data?.access_token && data?.refresh_token) {
    return { ok: true, data: data as Cafe24TokenRefreshResponse };
  }
  console.error("Cafe24 token refresh rejected:", response.status);
  return classifyCafe24RefreshFailure(response.status, typeof data?.error === "string" ? data.error : null);
}

type Cafe24RefreshFailureCode = "CONFIG_ERROR" | "RECONNECT_REQUIRED" | "REFRESH_RETRYABLE" | "REFRESH_FAILED";
const errorName = (err: unknown) => (err instanceof Error || err instanceof DOMException ? err.name : "network error");
const retryable = (message: string) => ({ ok: false as const, code: "REFRESH_RETRYABLE" as const, message });

// Cafe24 갱신 거부 응답 분류 — 재연결은 토큰 만료 · 폐기 근거(OAuth 오류 invalid_grant: 만료 · 폐기 · 이미 쓴
// refresh_token)가 있을 때만. 근거 없는 실패를 재연결로 보내면 일시 장애에도 사용자가 연결을 다시 해야 한다.
export function classifyCafe24RefreshFailure(
  status: number,
  oauthError: string | null
): { ok: false; code: Cafe24RefreshFailureCode; message: string } {
  if (status >= 400 && status < 500 && oauthError === "invalid_grant") {
    return { ok: false, code: "RECONNECT_REQUIRED", message: "Cafe24 Refresh Token이 만료되었거나 폐기되었습니다." };
  }
  if (oauthError === "invalid_client" || oauthError === "unauthorized_client") {
    return { ok: false, code: "CONFIG_ERROR", message: "Cafe24 앱 인증 설정이 거부되었습니다." };
  }
  // 일시적 서버 오류 · 요청 한도 · 시간 초과 응답, 또는 성공 응답인데 토큰이 없는 경우(근거 없음)
  if (status >= 500 || status === 429 || status === 408 || (status >= 200 && status < 300)) {
    return retryable("Cafe24 토큰 갱신이 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return { ok: false, code: "REFRESH_FAILED", message: "Cafe24 토큰 갱신이 거부되었습니다(만료 근거 없음)." };
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
  const readRow = async (): Promise<IntegrationCredentialRow | null> => {
    const { data, error } = await supabaseAdmin
      .from("integration_credentials")
      .select(CREDENTIAL_COLUMNS)
      .eq("connected_account_id", connectedAccountId)
      .single();
    return error || !data ? null : (data as IntegrationCredentialRow);
  };

  let row = await readRow();
  if (!row) {
    return {
      ok: false,
      code: "CREDENTIAL_NOT_FOUND",
      message: "Cafe24 인증정보를 찾을 수 없습니다.",
    };
  }

  // 1. Access Token이 아직(만료 5분 전보다 더) 유효하면 그대로 반환.
  if (isStillValid(row.access_token_expires_at)) {
    return { ok: true, accessToken: row.access_token };
  }

  // 2. 갱신 권한 선점 — 읽은 updated_at이 그대로일 때만 바꿀 수 있으므로 한 요청만 성공한다.
  //    실패했으면 다른 요청이 갱신 중이거나 이미 갱신했으니 저장될 새 토큰을 기다린다.
  let claimed = false;
  for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
    // 다른 요청이 방금 권한을 잡고 갱신 중이면 CAS하지 않고 새 토큰을 기다린다(시차 요청 중복 갱신 방지).
    if (!refreshInProgress(row.updated_at)) {
      let claim = supabaseAdmin
        .from("integration_credentials")
        .update({ updated_at: new Date().toISOString() })
        .eq("connected_account_id", connectedAccountId);
      claim = row.updated_at ? claim.eq("updated_at", row.updated_at) : claim.is("updated_at", null);
      const { data: won } = await claim.select(CREDENTIAL_COLUMNS).maybeSingle();
      if (won) {
        row = won as IntegrationCredentialRow;
        claimed = true;
        break;
      }
    }
    for (let waited = 0; waited < REFRESH_WAIT_MS; waited += REFRESH_POLL_MS) {
      await sleep(REFRESH_POLL_MS);
      const latest = await readRow();
      if (latest && isStillValid(latest.access_token_expires_at)) {
        return { ok: true, accessToken: latest.access_token };
      }
      if (latest) row = latest;
      // 권한을 잡은 요청이 끝내지 못하고 임대 시간이 지났으면 더 기다리지 않고 다시 권한을 잡으러 간다.
      if (latest && !refreshInProgress(latest.updated_at)) break;
    }
  }
  if (!claimed) {
    return {
      ok: false,
      code: "REFRESH_RETRYABLE",
      message: "다른 요청의 Cafe24 토큰 갱신을 기다리지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  // 권한을 얻은 사이 다른 요청이 이미 갱신을 끝냈으면 그 토큰을 쓴다.
  if (isStillValid(row.access_token_expires_at)) {
    return { ok: true, accessToken: row.access_token };
  }

  // 3. Access Token은 만료/임박했다 — refresh 전에 Refresh Token 자체의
  //    만료부터 확인한다. 만료됐으면 자동 갱신을 시도하지 않는다.
  if (!row.refresh_token || isDefinitelyExpired(row.refresh_token_expires_at)) {
    return {
      ok: false,
      code: "RECONNECT_REQUIRED",
      message: "Cafe24 연결이 만료되어 다시 연결해야 합니다.",
    };
  }

  // 4. Cafe24 공식 refresh_token 플로우로 갱신.
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
      access_token_expires_at: normalizeCafe24ExpiresAt(newTokens.expires_at),
      refresh_token_expires_at: normalizeCafe24ExpiresAt(
        newTokens.refresh_token_expires_at
      ),
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
// RECONNECT_REQUIRED만 401(클라이언트가 재연결 흐름을 타야 함), REFRESH_RETRYABLE은 503(잠시 후
// 다시 시도), 나머지는 서버/설정 쪽 문제라 500.
export function cafe24TokenErrorStatus(
  code: Extract<Cafe24TokenResult, { ok: false }>["code"]
): number {
  if (code === "RECONNECT_REQUIRED") return 401;
  return code === "REFRESH_RETRYABLE" ? 503 : 500;
}
