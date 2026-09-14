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

// ---- /me/adaccounts 전체 페이지 조회 (meta-adaccounts / meta-account-select 공용) ----
//
// meta-adaccounts(목록 조회)와 meta-account-select(재검증) 둘 다 각자
// /me/adaccounts를 첫 페이지만 fetch하고 있었다 — Meta는 광고계정이 많은
// 사용자에게 커서 기반 페이지네이션(paging.next/paging.cursors.after)으로
// 나눠 주므로, 첫 페이지만 보면 실제 접근 가능한 광고계정 일부를 목록에서
// 놓치는 것은 물론, meta-account-select의 재검증에서도 뒤 페이지에만 있는
// 정상 계정이 "접근 권한 없음"으로 잘못 거부될 수 있었다(코드리뷰 지적 4).

const GRAPH_API_VERSION = "v21.0";
const AD_ACCOUNT_FIELDS = "id,name,account_status,currency,timezone_name";

// 한 번의 조회에서 따라갈 최대 페이지 수 — Meta가 비정상적인 paging 응답을
// 주더라도(예: 같은 after를 반복) 이 횟수를 넘으면 무조건 멈춘다(무한 루프
// 방지, 요구사항 4). 실제 사용자의 광고계정 수를 감안하면 충분히 큰 값이다.
const MAX_AD_ACCOUNT_PAGES = 20;

export interface MetaAdAccount {
  id: string;
  name: string;
  account_status: number | string | null;
  currency: string | null;
  timezone_name: string | null;
}

// PAGE_LIMIT: MAX_AD_ACCOUNT_PAGES를 다 돌았는데도 다음 페이지가 남아있어
// 목록이 잘렸을 수 있는 경우 — 불완전한 결과를 성공으로 위장해 반환하지
// 않기 위한 명시적 오류(코드리뷰 재지적, Medium 1건).
type MetaAdAccountsError = {
  ok: false;
  status: number;
  message: string;
  code?: "META_ADACCOUNTS_PAGE_LIMIT";
};

export type MetaAdAccountsResult =
  | { ok: true; accounts: MetaAdAccount[] }
  | MetaAdAccountsError;

export type MetaFindAdAccountResult =
  | { ok: true; account: MetaAdAccount | null }
  | MetaAdAccountsError;

type MetaAdAccountsPageResult =
  | { ok: true; accounts: MetaAdAccount[]; nextAfter?: string }
  | MetaAdAccountsError;

// 한 페이지만 조회한다 — fetchAllMetaAdAccounts(전체 수집)와
// findMetaAdAccount(찾는 즉시 종료) 둘 다 이 함수 하나로 페이지를 넘긴다.
async function fetchMetaAdAccountsPage(
  accessToken: string,
  after: string | undefined
): Promise<MetaAdAccountsPageResult> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/adaccounts`
  );
  url.searchParams.set("fields", AD_ACCOUNT_FIELDS);
  url.searchParams.set("limit", "100");
  if (after) url.searchParams.set("after", after);

  // access_token은 쿼리 파라미터가 아니라 Authorization 헤더로 보내
  // 로그 어디에도 남지 않게 한다(meta-adaccounts/meta-account-select가
  // 각자 지키던 규칙을 여기 하나로 모음).
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error(
      "Meta adaccounts API request failed:",
      err instanceof Error ? err.message : "network error"
    );
    return {
      ok: false,
      status: 502,
      message: "Meta 광고계정 목록을 가져오지 못했습니다.",
    };
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    console.error(
      "Meta adaccounts API failed:",
      res.status,
      data?.error?.message
    );
    return {
      ok: false,
      status: res.status || 502,
      message: "Meta 광고계정 목록을 가져오지 못했습니다.",
    };
  }

  const pageAccounts = Array.isArray(data?.data) ? data.data : [];
  const accounts: MetaAdAccount[] = pageAccounts.map((a: any) => ({
    id: a.id,
    name: a.name ?? a.id,
    account_status: a.account_status ?? null,
    currency: a.currency ?? null,
    timezone_name: a.timezone_name ?? null,
  }));

  // paging.next가 없거나, 다음으로 넘어갈 cursor를 못 받으면(형식이 다르거나
  // 진행이 안 되는 경우) "더 없음"으로 취급한다.
  const nextAfter: string | undefined =
    data?.paging?.next && data?.paging?.cursors?.after
      ? data.paging.cursors.after
      : undefined;

  return { ok: true, accounts, nextAfter };
}

// /me/adaccounts 전체를 끝까지 모은다(목록 화면용).
export async function fetchAllMetaAdAccounts(
  accessToken: string
): Promise<MetaAdAccountsResult> {
  const accounts: MetaAdAccount[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_AD_ACCOUNT_PAGES; page++) {
    const pageResult = await fetchMetaAdAccountsPage(accessToken, after);
    if (!pageResult.ok) return pageResult;

    accounts.push(...pageResult.accounts);

    if (!pageResult.nextAfter) {
      return { ok: true, accounts };
    }
    after = pageResult.nextAfter;
  }

  // MAX_AD_ACCOUNT_PAGES(무한 루프 방지용 상한, 요구사항 1)를 다 돌았는데도
  // 마지막 페이지에 다음 페이지가 남아있었다 — 즉 실제 광고계정 목록이
  // 잘렸는데 이걸 성공으로 반환하면 사용자가 일부 계정을 영영 선택할 수
  // 없게 된다(요구사항 2). 그래서 명시적인 오류로 알린다(요구사항 3).
  console.error(
    "Meta adaccounts pagination exceeded page limit:",
    MAX_AD_ACCOUNT_PAGES
  );
  return {
    ok: false,
    status: 502,
    message: "Meta 광고계정이 너무 많아 전체 목록을 확인하지 못했습니다.",
    code: "META_ADACCOUNTS_PAGE_LIMIT",
  };
}

// 특정 ad_account_id 하나가 실제 접근 가능한 목록에 있는지만 확인한다
// (meta-account-select 재검증용). 그 계정을 찾는 즉시 남은 페이지를 더
// 가져오지 않고 종료한다(요구사항 5) — fetchAllMetaAdAccounts처럼 항상
// 전체를 다 모을 필요는 없다.
export async function findMetaAdAccount(
  accessToken: string,
  adAccountId: string
): Promise<MetaFindAdAccountResult> {
  let after: string | undefined;

  for (let page = 0; page < MAX_AD_ACCOUNT_PAGES; page++) {
    const pageResult = await fetchMetaAdAccountsPage(accessToken, after);
    if (!pageResult.ok) return pageResult;

    const match = pageResult.accounts.find((a) => a.id === adAccountId);
    if (match) return { ok: true, account: match };

    if (!pageResult.nextAfter) {
      // 모든 페이지를 다 봤는데도 못 찾았다 — 진짜로 접근 권한이 없는 것.
      return { ok: true, account: null };
    }
    after = pageResult.nextAfter;
  }

  // 20페이지 안에서 못 찾았고 마지막 페이지에도 다음 페이지가 남아있었다 —
  // 이 경우 "권한 없음"이라고 단정할 수 없다(21페이지 이후에 있을 수도
  // 있음). 없는 계정으로 잘못 거부(false negative)하는 대신, 목록 조회와
  // 동일하게 확인 불가 오류를 명시적으로 낸다.
  console.error(
    "Meta adaccounts pagination exceeded page limit (select):",
    MAX_AD_ACCOUNT_PAGES
  );
  return {
    ok: false,
    status: 502,
    message: "Meta 광고계정이 너무 많아 전체 목록을 확인하지 못했습니다.",
    code: "META_ADACCOUNTS_PAGE_LIMIT",
  };
}
