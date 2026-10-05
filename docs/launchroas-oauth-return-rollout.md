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

## 2026-10-05 (2) 부분 계산 · 실제 결제 기준 · 토큰 동시 갱신

### 실제 결제금액으로 반영할 수 있는 범위 (운영 쇼핑몰 2026-07-06~10-05 주문 300건 응답으로 확인)
- `orders?embed=items` 목록 응답의 item `payment_amount`는 모든 줄에서 비어 있다. 상품별 실제 결제액은 바로 읽을 수 없다.
- item `additional_discount_price · coupon_discount_price · app_item_discount_amount`는 571줄 모두 0 또는 비어 있다(상품 단위 할인 없음).
- 판매 상품의 Σ(product_price+option_price)×quantity = `actual_order_amount.order_price_amount`: 278/278건 일치.
- 주문 `payment_amount` = 상품 소계 + `shipping_fee` − 주문 단위 할인(적립금 · 예치금 · 쿠폰 · 회원 · 배송비 할인 · 세트 · 앱): 249/278건 일치. 나머지 29건은 결제금액 0원이거나 위 필드에 없는 할인이 있다.
- 주문 단위 쿠폰 65건, 적립금 10건이 있었다(상품 단위가 아님).
- 그래서 실제 결제 기준은 다음과 같이 계산한다.
  - (주문 결제금액 − 고객이 낸 배송비)를 상품 등록가 소계 비율로 나눈다.
  - 원가 · 수수료율 · 주문당 비용은 연결한 계산값을 쓴다.
  - 결제금액 0원 주문, 취소 · 클레임이 섞인 주문, 계산 입력값을 찾지 못한 연결은 사유별로 세고 이 기준에서 뺀다.
- 두 기준은 같은 주문끼리만 비교한다. 실제 결제 기준이 연결 주문 전부를 계산하지 못하면, 예상 잔액은 모든 주문을 덮는 등록 판매가 기준으로 계산한다.
- 2026-10-05 이번 달 실제 응답에 결제금액 0원 · 판매 상태(N1)인 주문이 1건(7개) 있다. 원인(관리자 수기 주문 · 외부 결제 등)은 Cafe24 관리자 화면에서 확인해야 한다.

### 부분 계산 표시
- 판매 수량 카드에 "마진 반영 n개 · 마진 미등록 m개"를 함께 표시한다.
- 미등록 상품이 있으면 마진·잔액 카드 제목을 "일부 상품 기준 …"으로 바꾸고, 점선 테두리와 "· 부분 계산" 표시를 붙인다.
- 미등록 상품은 0원 마진으로 더하지 않는다. 광고비는 전체 금액을 그대로 뺀다는 것도 안내한다.

### 혼합 주문의 주문당 비용 (현재 기준과 개선안)
- 현재 기준: 주문마다 한 번만 뺀다. 마진 상품이 2종 이상인 주문은 그중 비용이 가장 큰 상품의 주문당 비용(배송·포장·기타)을 쓴다. 화면에 해당 주문 수와 함께 표시한다.
- 개선안: 쇼핑몰 단위로 "주문 단위 비용 설정"을 둔다.
  - 택배비 원가(기본 · 도서산간), 포장비, 주문당 기타 비용, 결제 수수료율을 저장한다.
  - 상품 마진 연결에는 1개당 값(판매가 · 원가 · 상품 수수료)만 남긴다. 그러면 혼합 주문도 주문 비용을 한 번, 정확한 값으로 뺄 수 있다.
  - 저장 위치는 `tool_records`(tool_type `order_cost_setting`, store_id별 1건)로 충분하다.

### Cafe24 토큰 동시 갱신 수정
- 원인: 두 요청이 동시에 만료를 보면 둘 다 Cafe24에 refresh를 요청했다. Cafe24는 새 토큰을 발급하면 이전 refresh_token을 폐기하므로, 한쪽은 RECONNECT_REQUIRED로 실패했다. 저장 순서가 엇갈리면 폐기된 토큰이 DB에 남을 수도 있었다.
- 수정(`_shared/cafe24-token.ts`):
  - refresh 전에 `integration_credentials.updated_at`을 읽은 값과 비교·교체(CAS)해 한 요청만 갱신 권한을 얻는다.
  - 나머지 요청은 최대 12초 동안 새 토큰이 저장되기를 기다렸다가 그 토큰을 쓴다.
  - 권한을 가진 요청이 죽었으면 한 번 더 권한을 얻어 직접 갱신한다.
  - DB 구조 변경은 없다.
- 배포: `cafe24-order-items` v2, `cafe24-orders-sync` v12, `cafe24-store-info` v9(모두 verify_jwt=true).
  - orders-sync v12에는 저장소에만 있던 "호출자 본인 쇼핑몰만 동기화" 조건도 함께 배포됐다.
  - 배포 전 원본 백업 위치: `G:\launchroas-backups\cafe24-token-functions-2026-10-05`
- 테스트: `tests/cafe24-token-concurrency.test.mjs`(가짜 Cafe24가 refresh_token을 1회용으로 폐기). 수정 전 모듈은 동시 요청 테스트에서 실패한다.

### 운영 도메인 · OAuth 복귀 설정 (2026-10-05 확인)
- `launchroas.co.kr` · `www.launchroas.co.kr`: .kr 레지스트리에서 NXDOMAIN이다. 등록되지 않았거나 위임되지 않은 상태라 사용 중이 아니다.
- 현재 LaunchROAS 운영 주소는 Vercel 기본 주소 `https://launchroas.vercel.app` 하나다(master Production 배포). 이미 복귀 허용 목록에 있다.
- Vercel 프로젝트의 사용자 도메인 목록은 Vercel 로그인이 없어 직접 보지 못했다. DNS 기준으로는 연결된 사용자 도메인이 없다.
- 운영 도메인을 정하면 설정할 값:
  - 복귀 허용 Origin: `https://<도메인>` (경로 · 끝 슬래시 없이 정확히).
    - 적용 위치 1: Supabase 프로젝트 `zzhvckikonnalqnyatgn`의 Edge Function secret `LAUNCHROAS_RETURN_ORIGIN`. OAuth 함수 4개가 실행할 때 읽으며 재배포가 필요 없다.
    - 적용 위치 2: `supabase/functions/_shared/return-origin.ts`의 `ALLOWED_RETURN_ORIGINS`. 이 경우 OAuth 함수 4개를 재배포하고, 콜백 2개는 `--no-verify-jwt`로 배포한다.
  - 바꾸지 않는 값: Cafe24 · Meta 앱의 Redirect URI. 각각 `https://zzhvckikonnalqnyatgn.supabase.co/functions/v1/cafe24-oauth-callback`, `…/meta-oauth-callback` 그대로다.
  - 복귀 주소가 없는(런치데스크) 흐름의 기본 복귀: `https://launchdesk.co.kr` (콜백의 `APP_URL`).
  - Supabase Auth: 이메일·비밀번호 로그인에는 Redirect URL이 필요 없다. 인증 메일을 LaunchROAS로 돌리려면 Auth URL 설정에 새 Origin을 추가하고 `signUp`에 `emailRedirectTo`를 넘겨야 한다(현재 미적용).

## 2026-10-05 (3) 네이버페이 금액 · 판매가 출처 정리
- 네이버페이(order_place_id `NCHECKOUT`) 주문은 Cafe24 `payment_amount`가 0원이거나 일부만 들어온다. 네이버페이로 낸 금액은 주문의 `naver_point`에 들어온다.
  - 공식 문서는 `naver_point`를 "NAVER points"로만 설명한다. `naverpay_payment_information`은 "P: PG payment / N: NaverPay"이고, 해당 주문은 `N`이다.
  - 실제 응답(2026-07-01~10-05, 비취소 주문): `payment_amount + naver_point` = 상품 소계 + 배송비 − 주문 단위 할인
    - 자체몰 · 모바일 · 스마트스토어(self/mobile/shopn): 229/229
    - 네이버페이: 55/55
    - 에이블리(ably): 0/5. 에이블리 주문은 실제 판매금액을 확인할 수 없다.
- 판매가 출처 변경
  - 주문 금액이 위 식과 맞는 주문은 실제 결제(`payment_amount + naver_point`)를 쓴다.
  - 맞지 않거나(마켓) 일부 취소 · 클레임이 섞인 주문, 결제금액 0원 주문은 Cafe24가 기록한 주문 당시 판매가(`product_price + option_price`) × 수량으로 추정한다. 사유별로 센다.
  - 저장한 계산에서는 원가 · 수수료율 · 주문당 비용만 쓴다. 판매가를 고쳐 저장할 필요가 없다.
  - Cafe24 상품가가 없거나 입력값을 찾지 못한 연결만 저장한 1개당 마진으로 계산한다.
- 2026-10-05 이번 달 대조: 연결 3건 모두 실제 결제(네이버페이 153,300원 주문 포함)였고, 화면 상품 마진 31,458원 = 원본 응답 독립 재계산 31,458원이었다.

## 2026-10-05 (4) Cafe24 토큰 동시 갱신 실검증
- 운영 쇼핑몰 4의 access token이 갱신 기준 시각(만료 5분 전)을 지난 08:16:58 UTC에, 로그인 사용자로 `cafe24-orders-sync` 1건과 `cafe24-order-items` 2건을 동시에 호출했다.
  - 결과: 3건 모두 성공했고, 직후 추가 조회도 성공했다.
  - DB: access token 만료가 08:21:37에서 10:16:58로 바뀌었다. refresh token 해시도 바뀌었고, 연결 상태는 `connected`, `last_synced_at`은 08:16:58로 갱신됐다.
  - 수정 전 모듈이었다면 동시 요청 중 하나가 폐기된 refresh token으로 RECONNECT_REQUIRED를 받았을 상황이다. 이번에는 실패한 요청이 없었다.
- 첫 시도(08:16:30)는 갱신 기준 시각 전이라 갱신이 일어나지 않았다. 이 시도는 일반 동시 조회 확인으로만 본다.
- 미확인: 새로 저장된 refresh token으로 다음 갱신(10:11 UTC 이후)이 성공하는지는 아직 확인하지 않았다.
