// Meta(Facebook) access token 조회 helper — cafe24-token.ts와 같은 이유로
// meta-adaccounts / meta-account-select가 반복하던 "토큰 조회 + 만료 확인"을
// 여기 하나로 모았다.
//
// Cafe24와의 결정적인 차이: Meta는 OAuth2 표준 refresh_token 플로우가 없다.
// meta-oauth-callback이 저장하는 건 "장기(long-lived) user access token"
// 하나뿐이고(보통 발급일로부터 ~60일), 이게 만료되면 자동으로 갱신할 방법이
// 없다 — 사용자가 [Meta 광고 연결]을 다시 눌러 처음부터 로그인해야 한다.
// 그래서 이 helper는 Cafe24 helper처럼 "만료됐으면 자동 refresh"를 시도하지
// 않고, 만료 여부만 확인해 만료됐으면 곧장 RECONNECT_REQUIRED를 반환한다.
//
// 보안: access_token/refresh_token(해당 없음)은 로그 어디에도 남기지 않는다.

// deno-lint-ignore no-explicit-any
type SupabaseAdminClient = any;

export type MetaTokenResult =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      // CREDENTIAL_NOT_FOUND: integration_credentials 행 자체가 없음
      // RECONNECT_REQUIRED : 장기 토큰이 만료됨 — 사용자가 다시 연결해야 함(자동 갱신 불가)
      code: "CREDENTIAL_NOT_FOUND" | "RECONNECT_REQUIRED";
      message: string;
    };

export async function getValidMetaAccessToken(
  supabaseAdmin: SupabaseAdminClient,
  connectedAccountId: number
): Promise<MetaTokenResult> {
  const { data: credential, error } = await supabaseAdmin
    .from("integration_credentials")
    .select("access_token, access_token_expires_at")
    .eq("connected_account_id", connectedAccountId)
    .single();

  if (error || !credential || !credential.access_token) {
    return {
      ok: false,
      code: "CREDENTIAL_NOT_FOUND",
      message: "Meta 인증정보를 찾을 수 없습니다.",
    };
  }

  // access_token_expires_at이 없으면(장기 교환 응답에 expires_in이 없었던
  // 경우) 만료를 판단할 수 없으므로 일단 유효한 것으로 취급한다 — Meta가
  // 401을 주면 그때는 이 함수를 부른 쪽이 Graph API 응답으로 알게 된다.
  if (
    credential.access_token_expires_at &&
    new Date(credential.access_token_expires_at).getTime() <= Date.now()
  ) {
    return {
      ok: false,
      code: "RECONNECT_REQUIRED",
      message: "Meta 연결이 만료되어 다시 연결해야 합니다.",
    };
  }

  return { ok: true, accessToken: credential.access_token };
}

// cafe24-token.ts의 같은 이름 helper와 동일한 이유로 분리 — 실패 code를
// HTTP status로 매핑해 각 index.ts가 같은 switch를 반복하지 않게 한다.
export function metaTokenErrorStatus(
  code: Extract<MetaTokenResult, { ok: false }>["code"]
): number {
  return code === "RECONNECT_REQUIRED" ? 401 : 500;
}
