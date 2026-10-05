# LaunchROAS OAuth 복귀 주소 적용 기록

대상: 공용 Supabase 프로젝트 `launchdesk` (ref `zzhvckikonnalqnyatgn`). 런치데스크와 런치로아스가 함께 쓴다.

## 2026-10-04 원격 적용 (사용자 승인 범위: DB 칸 1개 + OAuth 함수 4개)

적용 전 상태(인증된 CLI로 직접 확인): `oauth_states.return_origin` 없음, 함수 4개는 커밋 `cc57ea9^` 코드와 동일(복귀 주소 기능 없음).

### DB
- `supabase/migrations/20260929164500_launchroas_oauth_return_origin.sql` 적용 — `oauth_states.return_origin text` (NULL 허용, 기본값 없음, 설명 주석 포함).
- 원격에는 `supabase_migrations.schema_migrations` 표가 없다. 지금까지 migration은 수동 적용 방식이며, 이번에도 `supabase db query --linked -f`로 적용했다.

### 함수 (적용 순서대로)
| 함수 | 이전 → 이후 | JWT 검사 |
|---|---|---|
| cafe24-oauth-callback | v8 → v9 | 끔 (`--no-verify-jwt` 명시) |
| meta-oauth-callback | v5 → v6 | 끔 (`--no-verify-jwt` 명시) |
| cafe24-oauth-start | v6 → v7 | 켬 |
| meta-oauth-start | v4 → v5 | 켬 |

- 배포 후 원격 코드를 다시 내려받아 저장소 파일과 비교: 4개 함수 + `_shared/return-origin.ts`, `_shared/cafe24-token.ts` 모두 차이 0줄.
- **배포된 코드는 아직 커밋되지 않은 작업 폴더 상태다.** 다음 배포 전에 커밋 여부를 정해야 한다.
- `config.toml`에 cafe24-oauth-start/callback 항목이 없다. 그대로 배포하면 cafe24-oauth-callback의 JWT 검사가 켜져 Cafe24 연결이 중단되므로, 콜백은 항상 `--no-verify-jwt`로 배포한다.

### 복귀 주소 허용 목록 (`supabase/functions/_shared/return-origin.ts`)
정확히 일치하는 Origin만 허용한다. 이전의 `launchroas-…-launchdesk.vercel.app` 이름 패턴은 다른 계정도 비슷한 주소를 만들 수 있어 없앴다.
- `https://launchroas.vercel.app` — 화면 HTML이 master `launchroas/index.html`과 동일
- `https://launchroas-git-preview-launchroas-apple-launchdesk.vercel.app` — 현재 브랜치 미리보기(Vercel 팀 로그인 보호)
- `https://launchroas-88oq4pa5f-launchdesk.vercel.app` — 이 저장소의 GitHub 배포 기록에 있는 미리보기
- 추가로 Supabase secret `LAUNCHROAS_RETURN_ORIGIN`과 정확히 같은 값(현재 미설정)
- `launchroas.co.kr`은 소유 확인 전이라 제외. 연결 후 목록에 추가하고 다시 배포한다.
- 복귀 주소를 보내지 않는 런치데스크 흐름은 NULL로 저장되어 기존처럼 `https://launchdesk.co.kr/#/account`로 돌아간다.
- state 검증은 그대로다: 서버 생성 UUID, 10분 만료, 콜백에서 `provider` 일치 + `used_at is null` + `expires_at > now()` 조건으로 한 번만 사용 처리.
- 테스트: `tests/return-origin.test.mjs`(허용·거부 목록, 공용 모듈 사용, state 조건).

### 백업·되돌리기
- 적용 전 원본 코드·버전·JWT 설정: `G:\launchroas-backups\oauth-functions-2026-10-04` (저장소 밖, 비밀 값 없음). 복구 명령은 같은 폴더의 `RESTORE.md`.
- DB 칸은 이전 함수와 충돌하지 않으므로 보통 그대로 둔다. 지워야 하면 함수를 먼저 되돌린 뒤 `alter table public.oauth_states drop column if exists return_origin;`.

## 실제 복귀 시험 — 보류 (2026-10-04)
- Meta가 동의 화면 없이 바로 코드를 돌려주면 콜백이 그 쇼핑몰의 기존 Meta 연결을 `pending`으로 바꾸고 광고계정 선택을 비운다(`meta-oauth-callback` 재연결 분기). 운영 쇼핑몰로는 시험하지 않는다.
- 현재 프로젝트 전체에 쇼핑몰은 1곳뿐이고, 그 쇼핑몰이 Meta에 연결되어 있다. 안전한 시험 대상이 없어 보류했다.
- 안전한 대상: Meta 연결이 없는 **별도 테스트 쇼핑몰**. 시험 OAuth 기록과(코드가 돌아오면) 그 쇼핑몰의 `pending` 연결만 생긴다. 쇼핑몰을 지우면 연결·자격증명·OAuth 기록·주문·마진 연결이 함께 지워진다(FK CASCADE).
- 시험 전 기준 스냅샷 (2026-10-04T10:52Z, 행 해시만 기록):
  - connected_accounts 2행 (cafe24:connected 1, meta:connected 1), fingerprint `c84a4f2f3bdc536522a4726962406d4d`
  - integration_credentials 2행, fingerprint `828e2bbee211da099c5468266aab28c1`
  - oauth_states 16행 (미사용 12, return_origin 있음 0)

## 실제 복귀 시험 결과 (2026-10-04 11:11~11:17 UTC, 미리보기 브랜치 주소)
- 방식: 운영 계정에 테스트 쇼핑몰 **ID 5 `[TEST] 복귀 시험 – 삭제 예정`**(https://example.com)을 추가했다. 화면 선택값과 DB가 모두 ID 5이고 연결 0건인 것을 확인한 뒤 Meta 연결을 시작했다.
- Meta 화면은 "이전 설정으로 계속" 화면(계속 / 설정 수정)이었고 취소 버튼이 없었다. 사용자 승인으로 "계속"만 눌렀다. **취소(denied) 경로는 미확인.**
- 복귀: 미리보기 연결 관리 화면으로 돌아와 "Meta 인증을 마쳤어요. 광고계정을 선택해 주세요."가 표시됐다. OAuth 기록은 store_id 5, 복귀 주소 = 미리보기 브랜치 주소, 사용 처리됨.
- 테스트 쇼핑몰 5: Meta `pending`, 광고계정 미선택, 연결 정보 1건. 광고계정 선택은 하지 않았다.
- 운영 쇼핑몰 4: 연결 해시 `c84a4f2f…`와 연결 정보 해시 `828e2bbe…`가 시험 전과 동일하다. 복귀 후 재조회에서 Meta 성과 조회가 성공했다(광고 세트 1개). 기존 토큰이 계속 유효하다.
- 발견한 문제: 복귀 후 화면이 OAuth를 시작한 쇼핑몰(5)이 아니라 첫 쇼핑몰(4)을 선택한다. 그래서 "광고계정을 선택해 주세요" 안내와 표시 중인 쇼핑몰이 어긋난다.
  - 2026-10-04 화면 코드에서 수정(로컬만, 미배포·미커밋): 시작 시 탭의 sessionStorage `launchroas.oauthTarget`에 {provider, storeId, userId, at}을 저장한다. 복귀 때 한 번 읽고 지운다. 같은 사용자·제공자·15분 이내이고 현재 사용자의 쇼핑몰일 때만 그 쇼핑몰을 선택한다. 아니면 선택을 비우고 다시 고르게 한다. 테스트: `launchroas/oauth-return.test.js`.
- 남은 테스트 데이터(사용자 지시로 보존): 쇼핑몰 5와 그 Meta pending 연결·연결 정보(실제 Meta 토큰 포함)·OAuth 기록 1건. 쇼핑몰 5를 삭제하면 FK CASCADE로 함께 정리된다. 별도 미인증 테스트 계정 1개(11:03 생성, 쇼핑몰 0개)도 그대로 있다.

## 알려진 테스트 실패 (기능 영향 없음)
(2026-10-04 테스트가 파일을 읽을 때 CRLF를 LF로 맞추도록 수정해 해결. SQL 파일은 바꾸지 않았다. CRLF·LF 모두 30/30 통과.)
`tests/cafe24-disconnect.test.js`의 12번·14번은 HEAD에서도 실패했다. migration 파일 `20260922120000_cafe24_disconnect.sql`이 CRLF 줄바꿈으로 커밋되어 있는데, 테스트 정규식이 `\n`을 바로 기대해서 생기는 문제다. 줄바꿈을 LF로 맞추면 두 검사 모두 통과한다. 원격 함수 `disconnect_cafe24_integration`에도 provider='cafe24' 조건 4개와 stores의 external_store_id만 NULL로 비우는 동작이 그대로 있다.

## 2026-10-05 실제 판매 기준 손익 (미리보기 브랜치)

### 원격 변경 (추가만, 기존 함수·표는 그대로)
- 새 Edge Function `cafe24-order-items` 배포(verify_jwt=true). 선택 기간(한국 시간, 최대 31일)의 Cafe24 `GET /api/v2/admin/orders?embed=items` 응답에서 상품·수량·상태만 돌려준다. DB에는 저장하지 않는다. 구매자·수령인·계좌 등 개인정보는 응답에서 뺀다(`_shared/cafe24-order-items.mjs`). LaunchDesk가 쓰는 `cafe24-orders-sync`는 바꾸지 않았다.
- 새 DB 표는 없다. 상품↔마진 연결(`tool_type='product_margin_link'`)과 광고비 환율(`tool_type='ad_fx_rate'`)은 사용자 본인 RLS가 걸린 `tool_records`에 저장한다.

### 근거로 삼은 공식 문서·실제 응답
- 공식 문서(apidocs.cafe24.com, API 2026-09-01 번들): `embed`는 items·receivers·buyer·return·cancellation·exchange 중에서 고른다. `limit`는 최대 1000이다. item에는 `quantity`, `claim_quantity`, `order_status`(N00~N50·C00~C49·R00~R43·E00~), `status_code`(N1 정상·N2 교환상품·C1 입금전취소·C2 배송전취소·C3 반품·E1 교환)가 있다.
- 실제 응답(운영 쇼핑몰, 2026-07-04~10-04): N1|N20·N40·N50, N2|N40, C2|C40, C1|C47·C48, E1|E40을 확인했다. 반품(C3/R*)과 `claim_quantity`>0인 부분 클레임은 이 기간에 없어 실제 응답으로는 확인하지 못했다(코드는 반품·부분 클레임을 판매에서 뺀다).
- 교환은 원 상품(E1)과 교환 상품(N2)이 따로 오므로, N2만 세어 중복을 막는다.
- 공식 OAuth 가이드: "Previous Refresh Token is automatically revoked when a new token is issued." 같은 몰을 테스트 쇼핑몰에 다시 연결하면 운영 쇼핑몰의 Cafe24 토큰이 폐기될 수 있다. 그래서 Cafe24 연결 복귀 실연동 시험은 운영 몰로 하지 않는다(별도 Cafe24 테스트 몰 필요).

### 계산 규칙 (`launchroas/sales-core.js`)
- 판매 수량은 status_code N1·N2의 수량에서 진행 중 클레임 수량을 뺀 값이다. order_status N00(입금 전)과 C1·C2·C3·E1, 모르는 코드는 제외 사유별로 따로 표시한다.
- 저장한 마진 계산(주문 1건 · 수량 qty 기준)을 "상품 1개당 마진"과 "주문당 조정액"(배송·포장·기타·고객배송비·판매자 할인)으로 나눈다. 주문당 조정액은 주문마다 한 번만 반영한다(연결 상품이 여럿이면 비용이 가장 큰 것 하나).
- 마진 미등록 상품은 계산에서 빼고 수량만 표시한다. 저장한 판매가·원가 기준이라 실제 할인·쿠폰은 반영하지 않고, 과거 주문에도 현재 값을 적용한다.
- 외화 광고비는 사용자가 저장한 환율로만 원화로 바꾼다. 환율·마진·광고비 중 하나라도 없으면 이익을 0원이 아닌 "계산 불가"로 표시한다.
- Meta 구매 전환수는 별도 숫자로만 표시하고 판매 수량 대신 쓰지 않는다. 광고 카드의 값은 "광고별 추정"으로 쇼핑몰 전체 이익과 구분한다.

### 운영 도메인 복귀 허용 준비 (아직 적용하지 않음)
1. Vercel에 운영 도메인(예: launchroas.co.kr)을 연결하고 소유를 확인한다. www는 apex로 리디렉션해 Origin을 하나로 둔다.
2. 재배포 없이: `npx supabase@2.119.0 secrets set LAUNCHROAS_RETURN_ORIGIN=https://launchroas.co.kr --project-ref zzhvckikonnalqnyatgn` (정확히 일치하는 1개 Origin만 허용된다).
   - 또는 `_shared/return-origin.ts` 목록에 추가한 뒤 OAuth 함수 4개를 다시 배포한다(콜백 2개는 `--no-verify-jwt` 필수).
3. 이메일·비밀번호 로그인은 Auth Redirect URL이 필요 없다. 이메일 인증 링크는 Supabase Site URL(현재 런치데스크)로 열린다.

### 테스트 데이터 정리 (2026-10-05)
의존성을 확인한 뒤 한 문장(조건부 삭제)으로 지웠다.
- 쇼핑몰 5 `[TEST] 복귀 시험 – 삭제 예정`: CASCADE로 Meta pending 연결 1, 자격증명 1, OAuth 기록 1이 함께 삭제됐다.
- 운영 계정의 `[TEST] 검수용 상품` 계산 기록, 검수용 상품 연결 1건, 검수용 환율(1,400원) 1건
- 미인증 테스트 계정 1개(로그인 기록 없음, 자동 생성 profile 1행만 있었음)
- 운영 쇼핑몰 4의 연결 해시(`c84a4f2f…`), A상품 계산 2건, 광고 세트 연결 1건은 그대로다.

### 알려진 테스트 실패 해결
`tests/privacy-version-consistency.test.js` 1건도 CRLF 문제였다(v1.2 migration의 CR 160개 때문에 여러 줄 비교가 실패). 읽을 때 LF로 맞추도록 바꿔 45/45 통과한다. SQL은 바꾸지 않았다.
