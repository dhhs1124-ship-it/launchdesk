# Meta Insights 구현 설계

> 상태: **정식 구현 완료.** `supabase/functions/meta-insights/index.ts`로 대체되었고, 임시 진단 함수(`meta-insights-diagnostic`)는 삭제되었습니다. 아래 본문은 조사/설계 기록이며, §6·§10은 실제 구현에서 확정된 내용으로 마지막에 갱신했습니다(하단 "구현 완료 체크포인트" 참고).
>
> 이 문서는 세 가지를 합쳐 작성했습니다:
> 1. 외부 Opus가 작성한 초안 설계(실제 코드베이스를 읽지 않은 상태에서 작성됨)
> 2. Backend Agent가 LaunchDesk 코드베이스를 직접 읽고 조사한 결과(재사용 가능 함수, ownership 패턴, KST 계산 방식 등)
> 3. Security Agent가 직접 읽고 검토한 결과(토큰 노출 여부, ownership 검증 충분성, CORS, 에러 노출)
>
> Opus 초안과 실제 코드가 다른 부분은 전부 **실제 코드베이스 기준(2·3번)**을 따랐습니다. RLS는 `stores`/`connected_accounts`/`integration_credentials` 세 테이블 모두 enabled 상태임을 확인하고 전제로 삼았습니다(정책 SQL 자체는 이 저장소에 없어 코드 레벨 조사로는 확인 불가 — DB 쪽에서 별도 확인됨).

---

## 1. 기능 목표

로그인한 사용자가 Meta 광고계정을 연결(이미 구현됨: `meta-oauth-start`/`meta-oauth-callback`/`meta-account-select`)한 뒤, LaunchDesk 화면에서 아래 8개 숫자를 실제 Meta 데이터로 확인할 수 있게 한다.

| 기간 | 지표 |
|---|---|
| 오늘 | 광고비 |
| 오늘 | 구매전환(건수) |
| 오늘 | 광고매출 |
| 오늘 | ROAS |
| 이번 달(1일~오늘) | 광고비 |
| 이번 달(1일~오늘) | 구매전환(건수) |
| 이번 달(1일~오늘) | 광고매출 |
| 이번 달(1일~오늘) | ROAS |

이번 단계는 이 8개 숫자를 **화면에 보여주는 것**까지다. 광고비/전환/매출의 일별 추이, 캠페인별 분해, 자동 알림, 목표 대비 진행률 등은 다음 단계.

---

## 2. 현재 코드에서 재사용할 것

Backend Agent 조사 결과 기준, 실제로 그대로 또는 패턴 그대로 재사용 가능한 것들.

| 재사용 대상 | 위치 | 재사용 방식 |
|---|---|---|
| `getValidMetaAccessToken()` | [`supabase/functions/_shared/meta-token.ts:27-60`](../../supabase/functions/_shared/meta-token.ts) | **그대로 import해서 호출.** `meta-insights`도 다른 Meta 함수와 동일하게 이 함수로만 access token을 확보한다. Meta는 refresh_token이 없으므로 만료 시 `RECONNECT_REQUIRED`를 그대로 반환한다(자동 갱신 시도 없음, 기존 함수들과 동일). |
| `metaTokenErrorStatus()` | [`supabase/functions/_shared/meta-token.ts:64-68`](../../supabase/functions/_shared/meta-token.ts) | **그대로 import.** `RECONNECT_REQUIRED`→401, 그 외→500 매핑을 그대로 따른다. |
| `connected_accounts` ownership 패턴 | [`meta-adaccounts/index.ts:25-30`](../../supabase/functions/meta-adaccounts/index.ts), [`meta-account-select/index.ts:34-39`](../../supabase/functions/meta-account-select/index.ts), [`meta-disconnect/index.ts:33-38`](../../supabase/functions/meta-disconnect/index.ts) | `ctx.supabase`(RLS 적용, 사용자 세션)로 `connected_accounts`를 `id` + `provider='meta'` 조건으로 조회 → 통과한 행의 `id`만 이후 `ctx.supabaseAdmin` 호출(토큰 조회)에 사용. `meta-insights`도 동일 코드 블록을 그대로 복제한다. |
| 기존 Meta error response 패턴 | [`meta-adaccounts/index.ts:60-67`](../../supabase/functions/meta-adaccounts/index.ts), [`meta-account-select/index.ts:73-78`](../../supabase/functions/meta-account-select/index.ts) | 실패 시 `{ error: "고정 한국어 메시지", code: "..." }` + 적절한 HTTP status만 반환하고, Meta 원문 에러(`data?.error?.message`)는 `console.error`(서버 로그)에만 남긴다. `meta-insights`도 이 형식을 그대로 따른다(§10, §11 참고). |
| `ops-overview.js` 구조 | [`ops-overview.js`](../../ops-overview.js) 전체 | 상태 머신(`showState`: `guest`/`no-store`/`loading`/`data`), `launchdeskStore.onChange()`로 세션 재확인, 매 요청마다 증가하는 `seq`로 늦은 응답 버리기, `#/tools` 진입 시(`hashchange`) 재조회, "두 번 조회 + 클라이언트에서 교집합"으로 연결된 store 찾기(`loadEligibleCafe24Stores`) — Meta 패널도 이 아키텍처를 그대로 복제한다(§9). KST 날짜 계산의 브라우저 쪽 구현(`kstBoundary`)도 개념은 동일하게 재사용하되, 이건 Edge Function이 아니라 브라우저 코드라 **Edge Function에는 직접 import 불가**(§3 참고). |

**재사용 불가 / 새로 작성 필요한 것** (Backend Agent 확인):
- `fetchAllMetaAdAccounts()` / `findMetaAdAccount()` — `/me/adaccounts`(내가 접근 가능한 전 계정 목록) 전용이라 `/act_<id>/insights`(단일 계정 지표)에는 쓸 수 없다. 다만 `fetchMetaAdAccountsPage()`의 fetch/에러 처리 스타일은 그대로 참고한다.
- `GRAPH_API_VERSION` — 3개 파일에 각자 독립 선언(`_shared/meta-token.ts:79`, `meta-oauth-start/index.ts:10`, `meta-oauth-callback/index.ts:9`)돼 있고 export되지 않음. `meta-insights`도 로컬로 `"v21.0"`을 재선언해야 한다(기존 값과 반드시 동일하게).
- KST 날짜 계산 — `_shared/`에 공용 유틸이 없다. `cafe24-orders-sync/index.ts:41-48`의 `toKstDateString`/`kstDateDaysBefore` 로직을 참고해 Edge Function 안에 새로 작성한다(§3).

---

## 3. 신규 구성

### 3-1. `supabase/functions/meta-insights/index.ts` (신규 Edge Function)

- `verify_jwt = true` (다른 사용자-트리거 Meta 함수와 동일)
- 입력: `{ connected_account_id }` — **`ad_account_id`는 입력받지 않는다.** DB의 `connected_accounts.external_account_id`(이미 `meta-account-select`가 검증해 저장한 값)를 서버에서 조회해 쓴다(§11).
- 출력 한 번의 호출로 오늘/이번 달 8개 지표 + 계정 메타데이터를 전부 반환한다(클라이언트가 기간별로 따로 호출할 필요 없음 — 라운드트립 최소화, MVP 단순화).
- 내부 흐름:
  1. `ctx.supabase`로 `connected_accounts` ownership 확인(§2 패턴 그대로) — `status`가 `'connected'`가 아니면 `NOT_CONNECTED`(§10).
  2. `getValidMetaAccessToken()`으로 access token 확보 — 실패 시 그대로 매핑(§10).
  3. 광고계정 메타데이터 조회(3-3).
  4. 오늘/이번 달 KST 날짜 계산(3-2).
  5. Meta Insights API 2회 호출(오늘 1회, 이번 달 1회) — (3-4).
  6. 구매전환 basis 결정 + ROAS 계산(§6~§8).
  7. 계정 timezone이 `Asia/Seoul`이 아니면 응답에 경고 플래그만 포함(§5).
  8. 안전한 필드만 응답으로 반환(§11).

### 3-2. KST 날짜 계산 (Edge Function 내부, 신규)

`cafe24-orders-sync/index.ts:41-48`의 `toKstDateString(date)` 로직을 참고해 `meta-insights/index.ts` 안에 지역 함수로 작성한다(공유 모듈로 뽑을 정도의 중복은 아직 아님 — 필요해지면 나중에 `_shared/`로 추출):

```ts
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDateString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function kstMonthStartDateString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
```

- 오늘: `since = until = toKstDateString(now)`
- 이번 달: `since = kstMonthStartDateString(now)`, `until = toKstDateString(now)`

### 3-3. Meta 광고계정 메타데이터 조회 (신규, 가벼운 버전)

`fetchAllMetaAdAccounts`처럼 `/me/adaccounts`를 페이지네이션할 필요가 없다 — 이미 `external_account_id`(정확한 `act_...` id)를 알고 있으므로 그 노드를 직접 조회하면 된다:

```
GET https://graph.facebook.com/v21.0/{external_account_id}
  ?fields=name,currency,timezone_name,account_status
```

응답의 `currency`/`timezone_name`/`account_status`는 **DB에 저장하지 않고**(§4) 매 호출마다 이렇게 즉시 조회해서만 쓴다.

### 3-4. Meta Insights API 호출 (신규)

```
GET https://graph.facebook.com/v21.0/{external_account_id}/insights
  ?fields=spend,actions,action_values
  &time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}
  &time_increment=all_days
  &level=account
```

- `time_increment=all_days`로 지정해 지정한 기간 전체를 합산한 **한 행**만 받는다(기본값인 일별 분해 행을 클라이언트에서 다시 합산할 필요 없음 — 단, 이 파라미터의 실제 동작은 §12에서 실제 응답으로 검증 필요).
- `time_range`의 since/until은 3-2에서 계산한 **Asia/Seoul 기준** 날짜 문자열을 그대로 쓴다 — Meta 광고계정 자체의 reporting timezone과 다를 수 있음을 알면서도 맞추지 않는다(§5, MVP 결정).
- access token은 Authorization 헤더로만 전달(기존 `fetchMetaAdAccountsPage`와 동일한 규칙).

---

## 4. MVP 축소안 (이번 단계에서 하지 않는 것)

- `meta_insights_cache` 테이블 **만들지 않음** — 매 요청마다 Meta API를 직접 호출한다.
- `meta_insights_daily` 같은 일별 적재 테이블 **만들지 않음**.
- 자동 동기화(cron/스케줄러) **만들지 않음** — 사용자가 화면에 진입하거나 새로고침할 때만 조회한다.
- 별도의 rate limit 구현(예: 사용자별 쿨다운, 큐잉) **보류** — Meta 자체 rate limit에 걸리면 §10의 `RATE_LIMITED`로만 표시한다.
- `currency`/`timezone_name`/`account_status`를 위한 **새 DB 컬럼 추가 안 함** — `connected_accounts`/`integration_credentials` 스키마는 그대로 두고, 매 호출 시 Meta에서 직접 조회한다(3-3).
- 광고계정 메타데이터는 DB 캐시 없이 **`meta-insights` 호출 시점에 서버에서 조회**해 응답에 포함한다.

이 항목들은 전부 "나중에 트래픽/사용성이 필요해지면" 추가할 대상이지, 이번 설계에서 자리만 비워두는 것도 아니다 — 필요해지면 이 문서를 개정한다.

---

## 5. 기간 정의

- **오늘**: Asia/Seoul 기준 00:00:00 ~ 현재.
- **이번 달**: Asia/Seoul 기준 이번 달 1일 00:00:00 ~ 현재(누적, "이번 달 1일~오늘").
- 두 기간 모두 §3-2의 KST 계산 함수로 얻은 날짜 문자열을 `time_range`에 그대로 넘긴다.
- Meta 광고계정의 `timezone_name`(§3-3에서 조회)이 `"Asia/Seoul"`이 아니면, **날짜를 다시 계산하거나 맞추지 않고** 응답에 경고 정보만 포함한다(예: `{ timezone_warning: true, account_timezone: "America/Los_Angeles" }`). 프론트는 이 값이 있을 때만 "이 광고계정은 다른 시간대를 사용해 숫자가 정확히 '오늘'과 일치하지 않을 수 있습니다" 같은 안내를 보여준다. 정합성 보정은 다음 단계.

---

## 6. 구매 전환(conversion) basis — 아직 미확정

**지금 단계에서 코드로 확정하지 않는다.** §12에서 실제 Meta Insights 응답을 먼저 받아본 뒤 결정한다.

후보(우선순위 순으로 시도):
1. `offsite_conversion.fb_pixel_purchase` — 웹사이트 픽셀 기반 구매 이벤트. Cafe24 결제와 attribution 방식이 가장 가까울 가능성.
2. `omni_purchase` — 웹/앱/오프라인을 통합한 Meta의 옴니채널 구매 지표. 최신 계정에서 표준으로 밀고 있는 값.
3. `purchase` — 구버전/단순 픽셀 이벤트 이름.

실제 계정 응답에서 `actions` 배열에 어떤 `action_type`들이 실제로 존재하는지 확인한 뒤(§12), 그중 하나를 basis로 고정하고 이 문서를 개정한다. 후보가 여러 개 동시에 존재할 경우, Cafe24 결제금액과 가장 근접하게 맞는 것을 우선한다(중복집계 없는 것 우선).

---

## 7. actions / action_values 사용 규칙

- 구매전환 **건수**는 `actions` 배열에서, 구매전환 **금액(광고매출)**은 `action_values` 배열에서 가져온다.
- 두 배열 모두에서 **반드시 §6에서 확정한 동일한 `action_type` 키**로 찾는다. 건수는 A라는 action_type에서, 금액은 B라는 action_type에서 각각 다르게 가져오면 분자/분모가 어긋난 ROAS가 나올 수 있으므로 절대 섞지 않는다.
- 해당 `action_type`이 배열에 아예 없으면(그 기간에 전환이 0건) → 0으로 취급(§8 "데이터 없음은 에러가 아님").

---

## 8. ROAS 계산

```
ROAS(%) = purchase_value(action_values에서 §6 basis로 찾은 금액) / spend * 100
```

- `spend === 0` 이거나 `purchase_value`를 찾을 수 없는 경우(해당 action_type이 응답에 없음) → 화면에 **`"—"`** 로 표시(0%나 오류가 아니라 "계산 불가"임을 명확히 구분).
- 계산 자체는 **LaunchDesk 서버(`meta-insights`) 또는 프론트 중 어디서 해도 되지만, 이 설계에서는 `meta-insights`가 계산까지 끝내서 완성된 숫자만 내려준다** — Meta가 자체 제공하는 `purchase_roas` 필드는 쓰지 않는다(§6의 basis 확정과 동일한 근거로 분자/분모를 우리가 직접 통제하기 위함).

---

## 9. UI 구조

- **Cafe24 운영현황과 Meta 광고성과는 화면에서 물리적으로 분리된 별도 패널/섹션**으로 보여준다(같은 카드 안에 나란히 숫자만 늘어놓지 않는다).
- 기존 `ops-overview.js`의 Cafe24 패널(오늘/이번 달 **결제금액**, `todayPaymentEl`/`monthPaymentEl` 등)은 그대로 유지한다.
- 새 Meta 패널은 §2에서 정리한 것과 동일한 아키텍처(상태 머신, `onChange`/`hashchange` 재조회, seq 가드)를 따르되, "연결된 쇼핑몰" 대신 "그 쇼핑몰에 연결된 Meta 광고계정(status='connected')"을 기준으로 노출 여부를 판단한다.
- 두 패널 모두에 다음 안내를 명확히 표시한다: **"Cafe24 = 실제 결제금액 / Meta = 광고주가 신고한 광고매출(Meta 자체 집계, 결제와 다를 수 있음)"**. 두 숫자를 같은 스케일의 "매출"로 오해하지 않도록, 각 패널 라벨 자체를 "결제금액"(Cafe24)과 "광고매출(Meta 추정치)"(Meta)로 명확히 구분해 붙인다.
- 구현 위치는 `ops-overview.js` 파일 안에 Meta 전용 하위 섹션으로 추가하는 것을 권장한다(기존 상태 머신/세션 처리/`client()` 헬퍼를 그대로 재사용할 수 있고, "물리적으로 분리"는 DOM/렌더링 상의 분리를 요구하는 것이지 파일 분리를 요구하는 게 아니라고 해석함) — 파일을 분리할지는 실제 구현 시 코드량을 보고 다시 판단해도 된다.

---

## 10. 에러 상태

| code | 의미 | 트리거 | HTTP status(제안) |
|---|---|---|---|
| `NOT_CONNECTED` | 이 store에 연결된 Meta 광고계정이 없거나 아직 `status='pending'`(광고계정 미선택) | ownership 조회 결과 없음 또는 status≠'connected' | 404 |
| `RECONNECT_REQUIRED` | 저장된 access token이 만료됨(Meta는 자동 갱신 불가) | `getValidMetaAccessToken()`이 `RECONNECT_REQUIRED` 반환 | 401 |
| `PERMISSION_REQUIRED` | 토큰은 유효하지만 이 광고계정에 대한 접근 권한(ads_read)이 없어짐(Meta 쪽에서 권한 회수 등) | Meta Insights/메타데이터 API가 permission 계열 오류 반환(§12에서 실제 에러 코드 확인 필요) | 403 |
| `RATE_LIMITED` | Meta API 자체 rate limit에 걸림 | Meta가 rate limit 관련 오류 반환(§12에서 실제 코드 확인 필요, 예: code 17/4/32/613 계열) | 429 |
| `ACCOUNT_UNAVAILABLE` | 광고계정 자체가 비활성/제재/삭제 상태 | 메타데이터 조회 결과 `account_status`가 활성(1)이 아님, 또는 Meta가 계정 접근 불가 오류 반환 | 409 |
| `TEMPORARY_ERROR` | 그 외 일시적 실패(네트워크 오류, 예상치 못한 응답 형식 등) | 위에 해당하지 않는 모든 실패 | 502 |

**데이터 없음은 에러가 아니다** — 그 기간에 광고 집행이 전혀 없어서 `spend=0`, `actions`/`action_values`가 비어있는 경우는 `ok: true`로 응답하고 값만 0으로 채운다(§7).

Meta의 실제 에러 코드(`error.code`/`error.error_subcode`)를 위 6개 카테고리 중 어디로 매핑할지는 §12에서 실제 오류 응답을 받아본 뒤 확정한다 — 지금은 카테고리 정의와 기본값(알 수 없으면 `TEMPORARY_ERROR`)만 정한다.

---

## 11. 보안

Security Agent 조사 결과를 그대로 반영한다.

- **access token은 절대 브라우저에 노출하지 않는다** — 응답 JSON에 `access_token`/`accessToken` 필드를 포함하지 않는다(기존 4개 Meta 함수와 동일한 규칙).
- **`ad_account_id`를 클라이언트 입력으로 신뢰하지 않는다** — `meta-insights`는 애초에 `ad_account_id`를 입력으로 받지 않고, ownership 검증을 통과한 `connected_accounts.external_account_id`(§3-1)만 사용한다. (`meta-account-select`가 이미 이 값을 검증해 저장해뒀으므로 이중 검증도 불필요 — 다만 `status='connected'`인지는 반드시 재확인한다.)
- **Meta 원문 에러를 브라우저에 노출하지 않는다** — `data?.error?.message`는 `console.error`에만 남기고, 응답에는 §10의 고정된 `code` + 한국어 메시지만 내려준다(기존 `meta-adaccounts`/`meta-account-select`와 동일 패턴).
- **`integration_credentials`는 `ctx.supabaseAdmin`(service role)에서만 접근한다** — `ctx.supabase`(RLS, 사용자 세션)로는 이 테이블을 절대 조회하지 않는다. `getValidMetaAccessToken()`을 그대로 재사용하면 이 규칙이 자동으로 지켜진다.
- `connected_accounts` ownership 확인은 반드시 `ctx.supabase`(RLS)로 먼저 하고, 그 결과로 얻은 `id`만 `ctx.supabaseAdmin` 호출에 사용한다(기존 함수들과 동일 — 클라이언트가 보낸 `connected_account_id`를 검증 없이 곧장 service role 호출에 쓰지 않는다).
- **확인 불가로 남은 것(코드 레벨 조사 한계)**: `stores`/`connected_accounts`/`integration_credentials`의 실제 RLS 정책 SQL 세부 조건 — 이번에 RLS가 세 테이블 모두 enabled임은 확인됐으나, 정책 조건 자체(`user_id = auth.uid()`를 정확히 강제하는지 등)는 DB에서 별도 확인된 것으로 전제한다. CORS가 `jsr:@supabase/server`/Supabase 플랫폼 레벨에서 어떻게 처리되는지도 이 저장소 코드만으로는 확인 불가 — 기존 4개 Meta 함수가 이미 프론트(`stores.js`)에서 문제없이 호출되고 있으므로 `meta-insights`도 동일하게 동작할 것으로 전제한다.

---

## 12. 실제 구현 전에 남은 검증

아래는 코드 작성 전에 반드시 확인해야 하는 것들 — 추측으로 코드를 쓰지 않기 위함이다.

1. **실제 연결된 광고계정으로 Meta Insights API를 1회 직접 호출**해 실제 응답 JSON을 확보한다(예: `curl` 또는 Graph API Explorer로, `fields=spend,actions,action_values`, `time_range`, `time_increment=all_days` 조합).
2. 그 응답의 `actions`/`action_values` 배열에 **실제로 어떤 `action_type` 값들이 존재하는지** 확인 — §6의 3개 후보(`offsite_conversion.fb_pixel_purchase`/`omni_purchase`/`purchase`) 중 실제로 나오는 것, 여러 개 나온다면 그중 어떤 걸 basis로 쓸지 결정.
3. `time_increment=all_days`가 의도대로 "기간 전체 합산 한 행"을 주는지, 혹은 예상과 다른 형태(예: 여전히 일별 분해)로 오는지 확인 — 다르면 3-4의 쿼리/파싱 방식을 그 결과에 맞게 다시 설계.
4. 같은 기간 **Meta Ads Manager 화면에 표시되는 광고비/전환/매출 숫자와 API 응답을 직접 대조**해, 우리가 고른 basis(action_type)와 계산 방식(ROAS 공식 등)이 Ads Manager가 보여주는 값과 합리적으로 일치하는지 확인. 대조 방법(안): Ads Manager에서 동일한 `since~until` 커스텀 기간을 걸고 "구매" 지표를 열람 → 이 문서 §6에서 고른 action_type 기준 숫자와 비교.
5. 위 1~4에서 확정된 내용으로 이 문서의 §6(basis)과 §10(실제 에러 코드 매핑)을 개정한 뒤에 코드 작성을 시작한다.

---

## 구현 순서

1. §12 검증(실제 Meta 응답 확인, Ads Manager 대조) → §6/§10 확정, 이 문서 개정
2. `supabase/functions/meta-insights/index.ts` 작성
   - ownership 확인(§2 패턴 그대로 복제)
   - `getValidMetaAccessToken()` 호출
   - 광고계정 메타데이터 조회(§3-3)
   - KST 날짜 계산(§3-2) → 오늘/이번 달 Insights 호출(§3-4) 2회
   - basis 확정된 action_type으로 전환 건수/금액 추출(§7) → ROAS 계산(§8)
   - timezone 경고 플래그(§5) 포함
   - 에러는 §10 표로 매핑, §11 보안 규칙 준수
3. `supabase/config.toml`에 `[functions.meta-insights]` `verify_jwt = true` 추가
4. `ops-overview.js`에 Meta 패널 추가(§9) — 기존 상태 머신/세션 처리 아키텍처 복제, Cafe24 패널과 물리적으로 분리, 라벨 문구로 "결제금액 vs 광고매출" 구분 명시
5. 로컬/스테이징에서 실제 연결된 테스트 계정으로 8개 숫자 전부 확인 + §10의 6개 에러 상태 각각 의도적으로 재현해 확인(예: 연결 해제 후 호출 → `NOT_CONNECTED`, 토큰 강제 만료 → `RECONNECT_REQUIRED` 등)
6. Cafe24 기존 기능(OAuth/동기화) 및 Meta 기존 기능(연결/선택/해제) 회귀 테스트
7. 배포 (`supabase functions deploy meta-insights`)

커밋 및 실제 구현은 사용자 승인 후 진행합니다. 이 문서 자체도 아직 커밋하지 않았습니다.

---

## 현재 작업 체크포인트 (다른 Claude Code 세션이 이어받을 때 먼저 읽을 것)

**완료된 것:**
- Meta Insights 최종 설계 문서(이 문서, `docs/plans/meta-insights.md`) 작성 완료 — Opus 초안 + Backend Agent + Security Agent 조사 결과를 합쳐 사용자 승인까지 받음.
- Backend Agent / Security Agent를 통한 실제 코드베이스 조사 완료 — 재사용 가능 함수(`getValidMetaAccessToken`, `metaTokenErrorStatus`, ownership 패턴, 에러 응답 패턴, `ops-overview.js` 구조), KST 날짜 계산 참고 위치, Graph API version 하드코딩 위치 등을 §2~§3에 반영함.
- Supabase RLS 확인 완료 — `stores`, `connected_accounts`, `integration_credentials` **3개 테이블 모두 RLS enabled** 확인됨(정책 SQL 세부 조건 자체는 저장소에 마이그레이션 파일이 없어 코드 레벨로는 확인 불가하지만, enabled 여부는 DB에서 직접 확인됨).
- `supabase/functions/meta-insights-diagnostic/index.ts` — §12 실제 검증(action_type 확인)을 위한 **임시** 진단 Edge Function 작성 및 배포 완료. `verify_jwt=true`(기존 Meta 함수와 동일한 인증 방식), `connected_accounts` ownership을 RLS로 확인한 뒤 `getValidMetaAccessToken()`으로 토큰을 얻어 Meta `/act_<id>` 메타데이터 + `/act_<id>/insights`(최근 30일, `fields=spend,actions,action_values,purchase_roas`)를 조회해 반환한다. access_token은 응답에 절대 포함하지 않음. `supabase/config.toml`에도 `[functions.meta-insights-diagnostic]` `verify_jwt=true`가 임시로 추가되어 있음.

**아직 안 된 것:**
- diagnostic 함수는 **배포만 됐고 아직 실제 회사 Meta 광고계정으로 실행/테스트되지 않았음.** 실제 광고 집행 이력이 있는 회사 계정에서 한 번 실행해 진짜 응답을 확인해야 함(테스트 계정이나 광고 이력이 없는 계정으로 돌리면 `actions`/`action_values`가 비어 있어 action_type 확인이 안 됨).

**테스트 방법(다음 세션에서 그대로 실행):**
1. LaunchDesk에 로그인(Meta 광고계정이 연결된 그 계정 — 회사 계정)
2. 브라우저 개발자 도구(F12) → Console
3. 아래 한 줄 실행:
   ```js
   window.launchdeskSupabase.functions.invoke('meta-insights-diagnostic').then(r => console.log(JSON.stringify(r.data || r.error, null, 2)))
   ```
4. 출력된 JSON을 Claude에게 붙여넣기(access_token은 포함되지 않음 — 광고 성과 수치이므로 붙여넣는 건 사용자 판단)

**다음 작업(순서대로):** 전부 완료됨 — 아래 "구현 완료 체크포인트" 참고.

---

## 구현 완료 체크포인트 (2026-09-15)

**실제 회사 계정 diagnostic 검증 결과(§12 확정):**
- 최근 30일(2026-08-16~2026-09-15) 실제 응답에서 `offsite_conversion.fb_pixel_purchase` / `omni_purchase` / `purchase` 세 action_type이 **모두** 존재했고 count=8, value=292.42로 완전히 동일했다(같은 구매의 중복 표현 확인됨 — 절대 합산 금지가 실제로 중요했음).
- `time_increment=all_days`는 기간 전체 합산 한 행만 반환하는 것으로 확인되어(빈 배열 = 그 기간 데이터 없음, 에러 아님) 설계 그대로 채택.
- **§6 확정: purchase basis 우선순위 = `offsite_conversion.fb_pixel_purchase` → `omni_purchase` → `purchase`** (요청 지시 그대로, 실제 응답에서 셋 다 존재해 최우선 후보가 그대로 채택됨). count/value 모두 반드시 같은 action_type에서 가져온다.
- ROAS는 Meta의 `purchase_roas` 필드를 쓰지 않고 `purchase_value / spend`로 서버가 직접 계산(§8 그대로).

**§5 timezone 처리 — 설계보다 더 견고하게 구현:**
- 이 문서 §3-2/§5는 "Asia/Seoul 고정 계산 + 다른 timezone이면 경고 플래그"를 제안했지만, 실제 `meta-insights/index.ts`는 **`Intl.DateTimeFormat`에 계정의 실제 `timezone_name`을 그대로 넘겨 today/month 날짜를 계산**한다(고정 오프셋을 더하는 방식이 아님 — DST가 있는 timezone에서도 정확). 그래서 timezone_warning 플래그 자체가 불필요해졌다 — 어떤 timezone 계정이든 항상 그 계정 기준으로 정확하게 계산된다.

**§10 에러 코드 — 실제 구현 기준:**
| code | 트리거 | HTTP |
|---|---|---|
| `META_NOT_CONNECTED` | 이 store에 provider='meta' 행 자체가 없음 | 404 |
| `META_ACCOUNT_NOT_SELECTED` | 행은 있지만 `status !== 'connected'`(광고계정 미선택) | 409 |
| `RECONNECT_REQUIRED` | 토큰 만료/조회 실패(`CREDENTIAL_NOT_FOUND` 포함, 둘 다 "다시 연결"로 안내) 또는 Meta가 `code=190`/`type=OAuthException` 반환 | 401 |
| `PERMISSION_REQUIRED` | Meta가 `code=200`(Permissions error) 또는 `code=10` 반환 | 403 |
| `RATE_LIMITED` | Meta가 `code=4/17/32/613`(표준 rate limit 코드) 반환 | 429 |
| `ACCOUNT_UNAVAILABLE` | 광고계정 메타데이터의 `account_status !== 1`(ACTIVE 아님) | 409 |
| `TEMPORARY_ERROR` | 그 외 전부(불확실한 코드를 억지로 세분하지 않음) | 502 |

실제 Meta 에러 코드는 운영 중 로그(`console.error` — access token은 남기지 않음)로 계속 관찰하며 필요시 이 표를 갱신한다.

**완료된 파일:**
- 신규: `supabase/functions/meta-insights/index.ts`
- 삭제: `supabase/functions/meta-insights-diagnostic/`
- 수정: `supabase/config.toml`(`meta-insights-diagnostic` 블록 제거, `meta-insights` `verify_jwt=true` 추가), `index.html`(`#metaOpsPanel` 추가), `ops-overview.js`(Meta 패널 로직 추가 — 기존 Cafe24 상태 머신/seq 가드 재사용)

**커밋 상태:** 이 문서를 포함해 전부 **아직 커밋되지 않음** — 사용자 승인 후 커밋.
