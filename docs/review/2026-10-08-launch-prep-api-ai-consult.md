# 2026-10-08 외부 연결 심사 준비 · Meta API 버전 · AI 컨설턴트 최소 흐름

브랜치 `feat/ai-consultant-minimal-flow`(master 024143e에서 분기). 이 문서와 코드는 로컬 커밋만 했습니다.
커밋: 93dda06 AI 1차 → 290b3ea Meta v26.0(별도 커밋) → 87f9b18 AI 마무리 → 이 문서 2차 정정(심사 조건).
심사 제출, 병합 · 푸시 · 배포, 원격 SQL · 시크릿 변경, 유료 호출, 광고 변경은 하지 않았고 AI는 꺼진 상태 그대로입니다.

표기 기준: **[확인]** = 직접 본 화면 · 코드 · 운영 조회. **[원문]** = 공식 문서 문장(2026-10-08 열람). **[추론]** = 원문에서 끌어낸 판단. **[미확인]** = 권한이 없거나 문서에 없음.

## 1. 외부 사용자 연결 · 심사 준비

### 1-1. 직접 확인한 것
- Meta 앱은 **개발 모드**입니다. [확인]
  - 운영자 Chrome 계정의 앱 역할은 '테스터'입니다.
  - 그래서 앱 대시보드 · App Review 주소로 들어가면 앱 목록으로 돌아갑니다. 관리자 계정이 필요합니다.
- 코드가 요청하는 권한 [확인]
  - Meta: `ads_read` 하나뿐입니다(`meta-oauth-start` SCOPES).
  - Cafe24: `mall.read_product`, `mall.read_order`, `mall.read_store`입니다.
  - 이 중 `mall.read_product`는 코드에서 쓰는 곳이 없습니다.
- Chrome 계정에 보이는 비즈니스 포트폴리오는 4개입니다. LaunchDesk · LaunchROAS 이름의 포트폴리오는 없습니다. 이름은 기록하지 않습니다. [확인]
- Cafe24 개발자 어드민은 로그인하지 않았으므로 앱 상태를 보지 못했습니다. [미확인]

### 1-2. 권한이 없어 확인하지 못한 것 — 관리자가 직접 볼 화면
| 확인할 것 | 화면 |
|---|---|
| 앱 모드 · 필수 설정 | Meta 앱 대시보드(관리자 계정) → App settings > Basic: 표시 이름, 연락 이메일, 개인정보처리방침 · 이용약관 URL, 데이터 삭제 URL/콜백, 아이콘(1024), 카테고리, App Purpose |
| `ads_read` 접근 수준 · Ads Management Standard Access | 앱 대시보드 → App Review(또는 Publish) > Permissions and Features — Standard/Advanced 표시 |
| 앱 ↔ 포트폴리오 연결 · BV 상태 | 앱 대시보드 Settings > Basic > Verification · business.facebook.com/settings/security(Security Center) |
| Access verification(Tech Provider) | 앱 대시보드 Basics > Verifications > Access verification |
| 도메인 인증 | business.facebook.com/settings/owned-domains |
| Cafe24 앱 상태 · 설치 몰 수 · 권한 | developers.cafe24.com 개발자 어드민 > Apps > App 관리 > STEP 01 개발정보 관리(App URL · Redirect URI · 권한 · 테스트 실행), STEP 03 판매정보 관리(심사 요청 상태) |
| Cafe24 개발자 유형 · 개인정보 취급권한 | 개발자 어드민 > 파트너 정보관리(개인 / 사업자) |

### 1-3. 공식 문서 조건 요약
출처는 맨 아래에 모았습니다.

**Meta 비즈니스 인증(BV)**
- 대상: "Your business needs to be registered with local authorities"입니다. [원문 M1]
  - 그래서 사업자등록이 없는 개인은 통과할 수 없다고 봅니다. [추론]
  - 개인 인증(Individual Verification)으로 대신할 수도 없다고 봅니다. Advanced Access 쪽 원문이 "Business Verification is required"이기 때문입니다. [원문 M7·M8 → 추론]
- 서류는 법적 상호와 공식 주소 또는 전화번호를 입증해야 합니다. [원문 M3]
  - 인정 서류: 사업자등록증, 법인 서류, 정부가 발급한 세무 문서, 사업자 명의 은행 명세서, 공과금 고지서
  - 공과금 고지서는 주소 · 전화 확인용으로만 인정됩니다.
  - 한국어 서류도 받고, 주민번호처럼 필요 없는 개인정보는 가려야 합니다.
- 웹사이트는 HTTPS로 열려야 합니다. 법인 정보와 "exactly match"해야 합니다. 결정까지 최대 영업일 14일이 걸립니다. [원문 M2·M4]

**Access verification(Tech Provider)**
- 대상 권한에 `ads_read`가 들어 있습니다. 다른 비즈니스가 쓰는 앱은 이 절차를 거쳐야 합니다. [원문 M9]
- BV가 끝나 있어야 합니다. 결과는 약 5일 뒤에 나옵니다.
- 인증 전에 앱 역할이 없는 사용자의 토큰으로 호출하면 error 100으로 거부됩니다.

**App Review(`ads_read` Advanced + Ads Management Standard Access)** [원문 M10·M11·M13]
- 권한마다 사용 사례 설명이 필요합니다. 복사 · 붙여넣기는 안 됩니다.
- 권한마다 1080 이상 녹화가 필요합니다. 녹화는 로그인 → 권한 부여 → 광고비 · 노출 · 클릭 · 도달 · 전환 지표 표시까지 보여야 합니다. UI는 영어로 하거나 자막을 붙여야 합니다.
- 제출 전 30일 안에 그 권한으로 성공한 호출이 1회 이상 있어야 합니다.
- 심사자 접속 안내가 필요하고, 개인 계정 비밀번호는 넣지 않습니다.
- 결과는 "within a week"입니다.
- Live 전환은 심사 승인 뒤에 해야 합니다. 일찍 전환하면 승인 안 된 권한이 꺼집니다. [원문 M13·M16]
- 승인 뒤에는 Data Use Checkup을 매년 해야 합니다. [원문 M8]
- `ads_read`가 DPA 대상인지는 문서에 없습니다. [미확인]

**Cafe24**
- 미심사 앱 [원문 C4]
  - 실제 운영하지 않는 몰에만 설치합니다. 최대 5개 몰까지입니다.
  - 첫 설치 때 동의 화면이 반드시 떠야 합니다.
- 운영 중인 외부 몰에 설치되려면 무료 앱이어도 STEP 03 심사가 필요하다고 봅니다. [추론]
- 심사 [원문 C7·C9]
  - 영업일 3~5일이 걸립니다.
  - 심사를 요청한 뒤에는 앱을 수정할 수 없습니다.
  - 기준에 "지나치게 많은 쇼핑몰 권한"이 있습니다.
- 보안 요건: HTTPS, 보안정책 문서화, 개발 · 운영 분리, MFA, 비밀정보 관리 등이고 증빙을 요구할 수 있습니다. [원문 C8]
> **정정(2026-10-08 2차):** 처음 판의 "사업자등록이 없는 개인은 유료 판매를 할 수 없다"는 추론은 틀렸습니다.
> 개발자센터 홈 FAQ는 개인 판매를 허용하고, 정산 한도만 둡니다(아래 C-A).
> 또 '개인 판매 조건'과 '개인정보 권한 제한'은 서로 다른 문제라 나눠 적습니다.

**C-A. 개인(사업자등록 없음) 판매 조건**
- 가입 · 판매 가능 [원문 HOME FAQ "사업자등록 없이 개인이 가입 및 판매가 가능한가요?"]
  - "개인도 개발자센터의 가입과 판매가 가능합니다."
  - "단, 소득증빙을 위해 구매자가 요구할 경우 신분증사본을 제출이 필요합니다."
  - "사업자등록이 안되어 있는 '개인판매자'의 최대 정산 한도금액은 매출액 기준 월 '200만원'이며 초과 매출이 발생한경우에는 PG사 측으로 문의 해주시기 바랍니다."
  - 영문 FAQ도 같습니다: "individuals without business licenses can join cafe24 Developers and sell apps."
- 유료 앱: "유료 앱을 판매하기 위해선 반드시 PG에 가입을 하셔야 합니다." [원문]
  - KG 구비서류 표에는 법인 · 개인 사업자 두 행만 있습니다. 개인 사업자는 사업자등록증 사본 · 대표자 명의 정산계좌 사본 · 인감증명서입니다. [원문]
  - **사업자 없는 개인의 PG 서류는 문서에 없습니다.** [미확인 → 문의]
- 무료 앱: 판매정보 가이드는 "유료로 판매할 경우 먼저 PG신청"이라고 합니다. [원문]
  - 그래서 무료는 PG가 없어도 된다고 읽힙니다. [추론]
  - 다만 결제 가이드에는 구분 없이 "PG 신청이 완료되어야 스토어에서 판매가 가능합니다."라고 적혀 있습니다. [원문 → 문의]
- 통신판매업: "국내법 상 앱을 판매하시는 사업자의 경우 통신판매업 신고를 하셔야 합니다." [원문]
  - 사업자 없는 개인에게도 신고 의무가 있는지는 문서에 없습니다. [미확인 → 문의]
- 심사 제출물(STEP 03)에 사업자 서류 항목은 없습니다. [원문] 다만 "심사과정에서 개발자 … 자료를 요구할 수 있으며"라고 되어 있습니다. [원문]
- 개인에서 사업자로 바꾸기: 명의변경 서류(사업자등록증 등)를 보내면 처리한다는 FAQ가 있습니다(개인 회사 → 법인 문구). [원문]
  - 판매 중인 앱의 재심사가 필요한지는 문서에 없습니다. [미확인]
- 수익 배분은 80:20(개발자:카페24)이고, 카드 · PG 수수료가 포함됩니다. [원문]

**C-B. 개인정보 권한 제한과 `mall.read_order`**
- 제한 문구: "당사 규정과 ISMS 심사 규정을 위해 개인개발자에게는 개인정보 취급권한을 부여하고 있지 않습니다." (FAQ, 2022-03-24) [원문]
- 별도 권한 [원문]
  - `mall.read_privacy` "쇼핑몰 고객의 개인정보를 조회할 수 있습니다."가 따로 있습니다.
  - 회원 개인정보 API(`/customersprivacy`, READ_PRIVACY)는 '개인정보취급 서약서'를 내야 쓸 수 있습니다.
- `GET /orders` [원문 apidocs 스펙 2026-09-01]
  - 권한은 READ_ORDER뿐입니다.
  - embed가 없어도 `member_id` · `member_email` · `billing_name` · `bank_account_no` · `bank_account_owner_name` 등을 돌려줍니다. 예시 응답도 가리지 않았습니다.
  - `fields` 파라미터는 `/orders` 파라미터 목록에 **없습니다.** 2026-06-01 판에도 없습니다.
  - embed `buyer` · `receivers`도 READ_ORDER이고, 요청할 때만 반환됩니다.
- 우리 운영 [확인] 지금 앱의 주문 응답에 주문자 항목이 들어 옵니다(2026-10 조사, 키 이름 기준). 저장은 허용 목록만 합니다(024143e).
- 개인정보 없이 금액 · 상품 · 수량만 읽을 수 있는가
  - **"개인정보 권한 없이도 `mall.read_order`로 가능하다"는 공식 문구는 찾지 못했습니다.** [미확인]
  - 개인 개발자 앱에서 `/orders`의 주문자 필드를 가리거나 막는다는 문구도 없습니다. [미확인]
  - 대안 후보 [원문]
    - `/orders/{id}/items`: READ_ORDER, 상품 · 수량 · 결제 금액. 주문마다 따로 호출해야 합니다.
    - `/reports/productsales`: READ_SALESREPORT, 품목별 집계. 권한을 추가하고 재심사를 받아야 합니다.
- **Cafe24 문의 필요(요지)**
  1. 사업자 없는 개인이, 응답에 주문자 필드가 오는 `GET /orders`(READ_ORDER) 앱으로 심사를 통과할 수 있는지. 받은 즉시 버리면 충분한지
  2. 개인 개발자 토큰에서 `/orders` · buyer · receivers 필드를 가리거나 막는지(스펙의 `x-authorization: PRIVATE`가 무슨 뜻인지)
  3. `/orders`가 `fields` 파라미터를 지원하는지
  4. 개인정보 권한 없이 금액 · 상품 · 수량만 쓸 때 권장 경로: `embed=items` · `/orders/{id}/items` · `/reports/productsales` 중 무엇인지
  5. 무료 앱도 PG 신청이 필요한지, 비사업자 PG 서류와 월 200만원 한도를 어떻게 운영하는지
  6. 비사업자에게 통신판매업 신고번호 · 상품정보제공 고시가 필수인지
  7. 개인 → 개인사업자 전환 때 재심사 · 토큰 재발급이 필요한지
  8. `mall.read_product`를 빼면 재심사와 기존 설치 몰의 재동의가 필요한지

### 1-4. 준비물 · 사업자등록이 필요한 절차
**한눈에 — 내가 준비할 것 (2차 정리)**
1. **사업자등록**: Meta로 외부 사용자를 받으려면 필수입니다. BV → `ads_read` Advanced → Access verification이 모두 이것을 전제로 합니다.
   - Cafe24는 개인으로도 판매할 수 있지만 정산이 월 200만원 한도이고, PG · 통신판매업 요건이 불분명합니다. 사업자로 시작하는 편이 단순합니다. [추론]
2. **Meta**
   - 비즈니스 포트폴리오(관리자 권한)
   - HTTPS 사업 웹사이트와 도메인 인증
   - BV 서류: 사업자등록증 등
   - 앱을 포트폴리오에 연결 → Access verification
   - 앱 기본 설정: 아이콘 1024, 개인정보처리방침 · 이용약관 · 데이터 삭제 URL, 카테고리, App Purpose
   - 심사 자료: 권한별 사용 사례 설명, 1080 녹화(로그인 → 권한 → 지표), 심사자 접속 안내
3. **Cafe24**
   - 개발자 등록과 앱 정리: 이름에서 'test' 같은 단어 빼기, `mall.read_product` 빼고 재인증
   - 비운영 테스트몰 검증
   - 판매정보: 아이콘 · 스크린샷 · 이미지 상세 · 상품정보제공 고시 · 연락처
   - 보안 요건 문서화
   - 유료라면 PG 서류
   - 위 C-B 문의 8가지
4. **공통**: 개인정보처리방침 v1.7 게시(`docs/launchroas-ai-consult-privacy-draft.md`), 그다음 AI 켜기

**사업자등록이 필요한 것**
- Meta BV, 그리고 BV를 전제로 하는 `ads_read` Advanced Access와 Access verification [원문 M1·M8·M9 → 추론]
- Cafe24: 개인 판매는 가능합니다(월 정산 200만원 한도) [원문].
  - 사업자 없는 개인의 PG 서류와 통신판매업 신고 의무는 문서에 없습니다 [미확인 → 문의].
  - 사업자 PG 서류에는 사업자등록증이 들어갑니다 [원문].

**서류**
- 사업자등록증, 또는 정부 발급 세무문서나 사업자 명의 은행 명세서
- (선택) 상호가 적힌 공과금 고지서
- 유료 판매 시: PG 서류(사업자: 사업자등록증 사본 · 대표자 명의 통장 사본 · 인감증명서), 통신판매업 신고증(사업자는 필수, 비사업자는 문의)

**사이트 · 설정**
- HTTPS 사업 웹사이트 · 도메인 인증
- 공개된 개인정보처리방침 · 이용약관 URL
- 데이터 삭제 안내 URL 또는 콜백
- 1024 아이콘

**심사 자료**
- Meta: 권한별 사용 사례 설명 · 녹화 · 심사자 접속 안내
- Cafe24 판매정보: 아이콘 · 스크린샷 · 이미지가 들어간 상세페이지 · 상품정보제공 고시 · 문의 연락처

**코드 쪽 정리(심사 전)**
- `mall.read_product` 제거: Cafe24 앱 권한도 함께 바꾸고 재인증해야 합니다.
- Meta API 버전: v26.0으로 코드 반영(2장). 배포는 승인 후, 심사 녹화 전에 하는 것을 권합니다.

## 2. Meta API 버전 (2026-10-08 정정 · v26.0으로 코드 반영 · 배포 보류)

> **정정:** 처음 판(커밋 93dda06)의 "v25.0만 Marketing 만료일이 미정", "v26.0은 Graph에만 있다"는 **틀렸습니다.**
> Meta의 Marketing 버전 표(버전 페이지의 Marketing 섹션, Marketing changelog 목록)가 갱신되지 않아 맨 위가 v25.0이고 v26.0 행이 없었는데, 그 표만 보고 판단했습니다.
> Marketing v26.0 changelog 머리말은 "July 29, 2026 | Available until TBD"이고, 공식 블로그 제목도 "Introducing Graph API v26.0 and Marketing API v26.0"(2026-07-29)입니다. [원문]

### 2-1. 코드 (v21.0 → v26.0, 이 커밋)
| 위치 | 쓰는 함수 | 호출 종류 |
|---|---|---|
| `_shared/meta-adset-normalize.mjs` | meta-adset-insights, ai-weekly-review | 광고 성과(Marketing) |
| `_shared/meta-token.ts` | meta-adaccounts, meta-account-select | `/me/adaccounts`(Marketing) |
| `meta-insights/index.ts` | meta-insights | 계정 성과(Marketing) |
| `meta-oauth-start/index.ts` | meta-oauth-start | 로그인 대화상자(Graph) |
| `meta-oauth-callback/index.ts` | meta-oauth-callback | 토큰 교환(Graph) |

- 테스트
  - `tests/meta-adset-insights.test.js`는 다섯 곳이 모두 같은 v26.0인지 확인합니다.
  - 같은 테스트가 버전을 직접 적은 Meta 주소가 없는지도 확인합니다.
  - 광고 성과 주소 테스트와 OAuth 복귀 테스트의 가짜 주소도 v26.0으로 바꿨습니다.
- 이전의 v21.0 통일은 의도한 것이었습니다(고정 테스트가 있었음). 이번 변경도 같은 방식으로 한 버전에 고정합니다.

### 2-2. 공식 지원 기간 [원문, 2026-10-08 열람]
| 버전 | 출시 | Graph 만료 | Marketing 만료 |
|---|---|---|---|
| v21.0 | 2024-10-02 | 2027-01-21 | **2025-09-09(만료)** |
| v22.0 | 2025-01-21 | 2027-05-20 | 2026-02-19(만료) |
| v23.0 | 2025-05-29 | 2027-10-08 | 2026-06-09(만료) |
| v24.0 | 2025-10-08 | 2028-02-18 | 2026-10-06(만료) |
| v25.0 | 2026-02-18 | 2028-07-29 | 미정(TBD) |
| v26.0 | 2026-07-29 | 미정(TBD) | 미정(TBD) — 버전 표에는 행이 없고, v26.0 changelog 기준 |

- 공식 문서끼리 맞지 않는 곳이 남아 있습니다.
  - "The latest Graph API version is: v25.0", "The current version of the Marketing API is v25.0." 같은 갱신 안 된 문구 [원문]
- v27.0은 아직 없습니다. 어느 표에도 없고, changelog 주소도 404입니다. [추론]

### 2-3. 자동 업그레이드와 실제 동작
- 문서 규칙 [원문]
  - 만료된 Marketing 버전 호출은 다음 버전에서 바뀌지 않은 엔드포인트만 "next available version"으로 올려 처리하고, 바뀐 엔드포인트는 실패합니다.
  - 이 규칙대로면 v24.0이 2026-10-06에 만료됐으므로 지금은 v25.0으로 처리돼야 합니다. [추론]
- 운영에서 본 실제 동작 [확인]
  - 2026-10-06 운영 응답에 "The ids query parameter is deprecated in v26.0+"가 나왔습니다(코드 주석으로 기록됨).
  - 이 오류는 v26.0+에서만 나고, 모든 버전에 적용되는 날은 2026-10-27입니다. 그래서 v21.0 호출이 **v26.0 기준으로 처리되고 있다**는 정황입니다. 문서 규칙과는 다릅니다.
  - 어느 버전으로 처리됐는지는 응답 헤더 `X-Ad-Api-Version-Warning`으로 확정할 수 있습니다. 이번에는 운영 호출을 하지 않았습니다.
- Graph(OAuth)는 v21.0이 2027-01-21까지 유효하므로 지금은 v21.0으로 처리됩니다. [추론]

### 2-4. 판단: v26.0
- 고른 이유
  - Marketing 만료일이 미정이라 수명이 가장 깁니다.
  - v22~v26 변경 중 우리 호출을 깨는 것은 `?ids=` 하나인데, 2026-10-06에 이미 광고별 조회로 바꿨습니다.
  - 실제 동작이 이미 v26 기준인 정황이 있어, 고정해도 운영 동작이 바뀔 여지가 가장 작습니다.
  - 고정하면 "바뀐 엔드포인트는 업그레이드 대신 실패" 같은 자동 업그레이드의 모호함이 없어집니다.
  - OAuth 공식 예시도 v26.0입니다.
- v25.0이 아닌 이유 [추론]
  - 과거 Marketing 버전은 출시 후 11~13개월에 만료됐습니다. 이 패턴이면 v25.0은 v26.0보다 먼저 만료됩니다.
  - v26.0의 레거시 프로토콜 변경(`?ids=` · `date_format` 오류 등)도 2026-10-27부터 모든 버전에 적용되므로, v25로 고정해서 얻는 보호 기간이 3주도 안 됩니다.
- 버전과 무관하게 이미 모든 버전에 적용된 변경(참고)
  - `use_unified_attribution_setting` · `action_report_time`은 2025-06-10부터 무시되고, 응답은 광고 관리자 설정을 따릅니다. [원문]
  - 7일 · 28일 조회(7d_view · 28d_view) 데이터는 2026-01-12부터 비어서 옵니다. [원문]
  - 우리 코드는 7d_view · 28d_view를 쓰지 않습니다. 결과 비교의 `action_report_time`은 응답 근거가 있을 때만 확인된 것으로 다룹니다(`adlog-change-core.js`). [코드]
- 다른 변경은 영향이 없습니다. [추론]
  - v22 `instagram_actor_id` 지원 중단, asset feed 세그먼트 맞춤 중단: 우리는 쓰지 않습니다.
  - targeting · 소재에 필드가 추가된 것: 우리는 읽기만 합니다.
  - `date_format` · `pretty` · `debug`: 쓰지 않습니다.

### 2-5. 반영 (보류 · 승인 필요)
1. 함수 7개를 재배포합니다. 바뀐 상수를 묶는 함수가 모두 대상입니다.
   - meta-adset-insights, ai-weekly-review, meta-insights, meta-adaccounts, meta-account-select, meta-oauth-start, meta-oauth-callback
   - ai-weekly-review는 AI 변경과 함께 배포되므로, AI를 꺼 둔 채로 배포 순서를 정합니다.
2. 배포 뒤 읽기 전용으로 확인합니다.
   - 호출별 1회씩 `X-Ad-Api-Version-Warning` 헤더가 없는지
   - 광고 성과 · 계정 목록 · 주간 점검 입력이 정상인지
   - 테스터 계정으로 Meta 연결을 1회 다시 해 OAuth가 정상인지
3. 문제가 생기면 이 커밋만 되돌려 재배포합니다(상수 다섯 줄).

## 3. AI 컨설턴트 최소 흐름

### 3-1. 기존 구성 비교
| 구성 | 이전 상태 | 이번 연결 |
|---|---|---|
| ai-weekly-review(주 1회, 예약 → 호출 → 정산, 월 한도) | 구현됨 | 그대로. 비용 예약 · 호출 제한 로직은 손대지 않음 |
| 광고 정책 · 플레이북(`ai-policy.mjs`, 시크릿 `AI_POLICY_VERSION`) | 구현됨 · 꺼짐 | 그대로. 켜든 끄든 아래 규칙이 뒤에 붙음 |
| 사업 정보 | 없음. `DECISION_INPUTS`의 목표 · 제약이 항상 null | **새로 추가.** tool_records `business_profile`(광고 목표 · 목표 ROAS · 월 예산 상한 · 바꿀 수 없는 것) → `decision_inputs` |
| Cafe24 이익(`sales.js` → 요청 본문) | 구현됨 | 사장님 요약의 '지금 상태'에 연결 |
| Meta 광고 데이터(주간 스냅샷) | 구현됨 | 그대로 |
| 지난 실행 기록 · 결과(ad_log `change` · `change_result`) | 화면에만 구현, AI에는 미연결 | **연결.** 광고별 `previous_actions`, 진행 중인 실행이 있는 광고는 새 변경안을 서버가 제외 |

### 3-2. 구현
- `supabase/functions/_shared/ai-consult-core.mjs`(새 파일, 순수 함수)
  - 사업 정보 정리 · 판단 입력
  - 지난 실행 단계 판정: 진행 중 / 결과 비교 전 / 잠정 / 판단 불가 / 확정
  - 서버 재강제 규칙(`guardResults`)
  - 사장님 요약(`consultBrief`: 지금 상태 → 할 일 · 이유 · 출처 → 판단하지 않은 것)
  - 지시문 추가분
- `ai-weekly-review/index.ts`
  - 사업 정보 · 실행 기록을 **사용자 권한(RLS)**으로 읽습니다. service_role에는 tool_records 조회 권한이 없기 때문입니다.
  - 조회에 실패하면 `load: "failed"`로 남깁니다. '입력 없음'과 구분하고, 점검은 계속 진행합니다.
  - 결과에 `brief` · `consult`를 추가합니다. `ads_by_id`(이어서 하기용)는 원본 그대로 둡니다.
  - 예전 스냅샷으로 이어서 하면 기존 동작을 유지합니다.
- `ai-weekly-core.mjs`: 광고 입력에 `previous_actions`를 넣습니다. 실행 기록이 없는 광고는 기존 입력 그대로입니다.
- `launchroas/insights.js` · `styles.css`
  - 주간 카드 맨 위에 요약이 나옵니다.
  - 각 광고 줄에 '참고'(서버가 뺀 변경안의 이유)가 나옵니다.
  - 점검 기준(사업 정보) 입력 칸이 생깁니다. 저장은 새로 넣은 뒤 예전 기록을 지우는 방식입니다(UPDATE 권한이 없음).
  - 목표가 없으면 점검 전에 안내합니다.
  - **AI가 켜졌을 때(ready)만 보입니다.** 지금은 꺼져 있어서 운영 화면에 변화가 없습니다.
- (2차, 2026-10-08) 마무리
  - '점검 기준 지우기' 버튼: 이 쇼핑몰의 기록만 지웁니다.
  - 쇼핑몰 삭제 트리거 마이그레이션: `20261008120000_store_delete_business_profile.sql`. **원격 미적용**
  - 브라우저 확인에서 버그를 찾아 고쳤습니다.
    - 증상: '예산 늘리기'를 막아도 AI의 "예산을 20% 늘려…" 행동 문장이 할 일 · 권장 행동에 남았습니다.
    - 수정: 서버가 행동 문장도 "예산은 늘릴 수 없어(사업 정보) 이번 주 변경안 없음"으로 바꿉니다. 요약에서는 할 일 대신 "예산 변경안을 뺀 광고 N개" 한 줄로 보여 줍니다.
  - (3차에서 보완) 위 수정은 '예산' 변경안만 막고 행동 문장 · 예산 의견 · 다른 제약은 보지 않았고, 감액까지 뺐습니다. 3-11에서 구조 검증으로 바꿨습니다.
  - 정책 · 플레이북 · 설계 문서(`docs/ai/*`)를 이 브랜치에 포함했습니다. 각 문서 머리에 적용 상태와 버전을 적고, 코드와 어긋나지 않게 테스트(`tests/ai-docs-sync.test.mjs`)를 붙였습니다.

### 3-3. 기준 차이 · 판단하지 않는 것(화면 · 지시문에 그대로 표시)
- 목표 ROAS는 Meta 귀속 ROAS 기준이고, Cafe24 실제 매출 기준이 아닙니다.
- 광고별 이익은 판단하지 않습니다. 광고별 주문 연결이 없어서 `ad_profit_basis`는 계속 null입니다.
- 실행 결과의 구매 수와 주간 점검의 구매 수는 기준이 다릅니다. 실행 결과는 지정한 귀속 창 기준이고, 주간 점검은 광고 세트 귀속 설정 기준입니다.
- 실행 결과는 AI가 다시 판정하지 않습니다. 서버가 계산한 상태만 언급합니다.

### 3-4. 비용 · 제한
- 주 1회 제한, 월 한도, 그룹 예약 → 호출 → 정산 순서는 바뀌지 않았습니다. 흐름 테스트로 순서까지 확인했습니다.
- 늘어나는 것은 입력 토큰 소폭(지시문 추가분, 실행 기록이 있는 광고의 짧은 요약)뿐입니다. 예약액은 실제로 보낼 내용으로 계산하므로 이 증가분도 예약에 들어갑니다.

### 3-5. 테스트
| 테스트 | 수 |
|---|---|
| `tests/ai-consult-core.test.mjs` | 10 |
| `tests/ai-consult-flow.test.mjs` | 5 (정책 꺼짐 · 켜짐 모델 요청 2개 포함) |
| `launchroas/insights.test.js` 추가분 | 4 |
| `tests/ai-docs-sync.test.mjs` | 3 |
| `tests/business-profile-store-delete.test.mjs` | 1 |

- 흐름 테스트는 실제 함수를 실행하고, Meta · Anthropic · Supabase는 가짜로 둡니다.
  - 예약 → 호출 → 정산 순서를 확인합니다.
  - 지시문과 입력에 목표 · 실행 기록이 들어가는지 확인합니다.
  - 겹치는 변경안이 빠지는지, 요약 순서가 맞는지, 조회 실패를 표시하는지, 본인 기록만 읽는지 확인합니다.
- 변이 확인: 사용자 필터, 서버 재강제, 정책 스위치를 빼면 실패하는 것을 확인했습니다.
- 전체(2차, Meta v26.0 커밋 포함): 939개 중 938개 통과, 1개 건너뜀(영상 프레임, 기존과 같음).

### 3-6. 배포할 때(보류 · 승인 필요)
1. 병합 · 푸시
2. `ai-weekly-review` 재배포(Edge Function)
3. LaunchROAS 배포

- 기능 자체에는 DB 마이그레이션이 필요 없습니다. tool_records를 재사용하고, `tool_type` CHECK 제약이 없습니다.
- 쇼핑몰 삭제 때 점검 기준도 지우려면 트리거 마이그레이션을 원격에 적용해야 합니다(승인 필요). 웹 배포와는 순서 관계가 없습니다.
- AI를 켜는 것(`AI_WEEKLY_ENABLED`)은 별도 승인이 필요합니다.

### 3-7. 남은 항목
- 사업 정보 나머지 필드(업종 · 주 고객 · 강점 · 프로모션 일정): 설계 문서 §4
- 광고별 손익 근거(`ad_profit_basis`): 광고별 주문 연결(UTM · 주문 매칭)이 먼저 필요
- 정책 시크릿 켜기 여부: 운영자 verify 경로로 실제 비교한 뒤(유료 호출 · 승인 필요)
- 실행 결과를 AI가 다시 검토하는 단계(action_reviews, 설계 §8 5단계): 미착수
- 운영 시크릿 `AI_POLICY_VERSION`의 실제 값 확인(3-8)
- 개인정보처리방침 v1.7 초안 확정 · 게시: `docs/launchroas-ai-consult-privacy-draft.md`. 법률 검토 항목과 원격 확인 항목이 있습니다.
- 트리거 마이그레이션 원격 적용, 쇼핑몰 삭제 확인 문구(LaunchDesk `stores.js`)에 'AI 점검 기준' 추가: AI를 켤 때
- 실행 기록(`change` · `change_result`)은 쇼핑몰을 삭제해도 남습니다. 직접 입력한 광고 기록과 같은 기존 규칙입니다.

### 3-8. 정책 · 플레이북이 실제 모델 요청에 들어가는가
| 구분 | 상태 |
|---|---|
| 문서(`docs/ai/ad-review-policy.md` · `apparel-ad-playbook.md`) | 이 브랜치에 포함. **모델에 보내지 않는 사람용 문서**입니다. |
| 모델이 쓰는 것 | `ai-policy.mjs`의 압축본 `POLICY_ADDENDUM`(+충돌 문장 교체)과 사례 `CASES`(관찰 10 · 가설 2, 광고마다 최대 2개) |
| 켜지는 조건 | 시크릿 `AI_POLICY_VERSION`이 `policy-2026-10-06.3`과 정확히 같을 때만. 기본은 꺼짐 |
| 기록 | 결과의 `policy_version` · `playbook_version`(`apparel-2026-10-06.3`), 광고별 `case_ids`. 꺼져 있으면 null이고 화면에 '이전 기준 결과'로 표시. 사업 정보 · 지난 실행 규칙은 정책과 무관하게 `consult-2026-10-08.2`로 항상 붙음 |
| 테스트로 확인 [코드] | 정책 꺼짐: 모델 요청에 분석 기준 · 참고 사례 없음, 결과 버전 null. 정책 켜짐(테스트 환경 값): 요청 system에 `[분석 기준 policy-2026-10-06.3]`, 클릭률이 낮은 광고에 `<reference_cases>`, 결과에 두 버전 |
| 운영 상태 [미확인] | 운영 시크릿 값 비교는 권한 확인에서 막혀 하지 않았습니다. 운영에서는 AI 자체가 꺼져 있어 지금은 모델 요청이 없습니다. |

- 운영 상태는 Supabase 대시보드 > Edge Functions > Secrets에서 `AI_POLICY_VERSION`이 있는지와 값을 직접 확인하면 됩니다.
- 또는 AI를 켠 뒤 첫 점검 결과의 `policy_version`을 보면 됩니다.

### 3-9. 사업 정보: 저장 위치 · 접근 제한 · 삭제
- 저장 위치: `tool_records`(`tool_type='business_profile'`, `data.store_id`). 쇼핑몰별 최신 1건만 남깁니다.
- 접근 제한
  - 테이블 권한: authenticated SELECT · INSERT · DELETE.
  - 화면 · 서버 모두 본인 `user_id`와 선택한 `store_id`로 거르고, 서버는 쇼핑몰 소유를 먼저 확인합니다.
  - 쇼핑몰 단위 제한은 DB가 아니라 앱 코드가 합니다.
  - 행 단위 정책 정의는 저장소에 없어 원격 확인이 필요합니다.
- 삭제
  - 화면의 '점검 기준 지우기'
  - 쇼핑몰 삭제 트리거(원격 미적용). 로컬 PGlite에서 json · jsonb 모두 확인했습니다: 그 쇼핑몰 기준과 Meta 자동 기록만 지우고, 실행 기록 · 직접 입력 기록 · 다른 쇼핑몰 · 다른 사용자 기록은 남습니다.
  - 회원 탈퇴는 기존대로 이메일 요청입니다.
- 방침 초안: `docs/launchroas-ai-consult-privacy-draft.md`
  - 항목 · 보유 기간 · 삭제 방법
  - Anthropic 국외 이전(확인 필요)
  - 같이 고칠 기존 문구: Cafe24 주문 데이터. 024143e 뒤로 주문자 정보를 저장하지 않습니다.

### 3-10. 실제 브라우저 확인(모의 데이터)
- 방법: 로컬 서버 `tests/browser/launchroas-mock-server.mjs`에서 실제 Chrome으로 LaunchROAS 화면을 열었습니다.
  - 화면 코드와 서버 함수 코드(`ai-weekly-review` · `meta-adset-insights` · `meta-insights` · `cafe24-order-items`)는 실제 코드입니다.
  - DB는 메모리, Meta · Cafe24 · Anthropic 응답은 가짜입니다.
  - AI는 이 로컬 프로세스 안에서만 켰습니다.
- **실제로 확인한 것**
  - 화면 렌더링 · 입력 · 버튼 동작
  - 화면 → 서버 함수 → 모델 요청 본문까지 데이터 흐름
  - 비용 예약 → 정산 순서(가짜 사용량으로 계산)
  - 페이지가 보낸 요청은 localhost와 Google Fonts뿐입니다. Supabase · Meta · Cafe24 · Anthropic 요청은 0건입니다.
  - `pixel.itemscout.io` iframe이 하나 보였습니다. 브라우저 확장 프로그램이 넣은 것으로 저장소 코드에는 없습니다.
- **모의인 것**
  - 운영 DB, 실제 광고 · 주문 데이터
  - 모델 판단 내용: 광고마다 고정된 가짜 답이라 AI 품질 검증이 아닙니다.
  - Meta · Cafe24 API 응답 형식: 기존 테스트와 공식 문서 기준
- 시나리오별 결과(스크린샷은 검토 ZIP)
  1. 목표 없이 저장 → "광고 목표를 골라 주세요."
  2. 저장 실패(모의) → "사업 정보를 저장하지 못했어요."와 함께 입력값이 유지됩니다.
  3. 저장 → "저장됨 · 판매 · 목표 ROAS 300%"
  4. 점검 실행: 요약의 지금 상태에 이익 · ROAS 대 목표 · 실행 기록 건수 · 지난 실행 결과가 나옵니다. 할 일은 결과 비교 → AI 우선 확인 → 데이터 순서이고, '판단하지 않은 것'이 따로 나옵니다.
  5. 진행 중 실행이 있는 광고: "진행 중인 '문구' 변경의 결과를 먼저 확인"과 참고 문장이 나오고, 개선안 탭은 없습니다.
  6. 예산 막힘: 1차에서 버그를 발견했고, 2차에서 수정을 확인했습니다.
  7. 지우기 → "지웠어요"가 나오고, DB 기록 0건이 됐습니다. 끝난 점검 결과는 그대로입니다.
- 모델 요청 본문(가짜 모델이 받은 것)
  - 3개 요청 모두 사업 정보 · 지난 실행 규칙이 있고, 정책은 꺼져 있습니다.
  - 목표(판매 · 300%) · 제약(예산 늘리기)이 들어갔습니다.
  - 지난 실행: 111은 진행 중(blocks=true), 333은 결과 확정 · 개선 신호, 222는 없음.

### 3-11. 검토 보완(3차) — 제약을 출력 전체에 강제 · 확인 실패면 점검 중단 · 조회 누락 제거
버전 `consult-2026-10-08.2`. 새 기능은 넣지 않았습니다.

**1) 사용자 제약을 변경안 · 행동 · 예산 의견 · 요약 전체에 강제**
- AI가 광고마다 `requires`를 선언합니다.
  - 행동(next_action) · 변경안(recommendation)마다 예산 방향(늘리기 · 줄이기 · 그대로), 할인 · 가격 필요, 새 촬영 필요
  - 예산 의견(budget_note)의 방향
  - 서버(`guardResults`)가 형식부터 검사합니다.
- 다음이면 **확인 불가로 보류**합니다.
  - 선언이 없거나 형식이 틀림
  - 예산 변경안인데 방향이 '그대로'
  - 문장이 선언과 어긋남(예: "예산을 올려"인데 그대로라고 선언). 단어 확인은 선언을 검증하는 보조이고, 단어만으로 허용하지는 않습니다.
  - 변경 요소가 '기타'이거나 빠져도 선언으로 판단하므로 우회되지 않습니다.
- 제약에 걸리거나 확인 불가면 변경안 · 행동 · 예산 의견을 **함께** 보류합니다.
  - 행동 문장은 "사업 정보 제약(…)에 맞지 않아 이번 주 변경안 없음" 또는 "변경에 필요한 조건을 확인하지 못해…"로 바꿉니다.
  - 요약은 할 일에서 빼고, 지금 상태에 "…보류한 광고 N개(이유)" 한 줄을 남깁니다.
  - 예산 의견만 증액이면 그 의견만 뺍니다.
- **'예산 늘리기'는 증액만 막습니다.** 감액 · 유지는 그대로 둡니다(이전에는 예산 변경안을 모두 뺐음). 입력 칸에도 이 뜻을 적었습니다.
- '할인 · 가격' · '새 사진 · 영상 촬영'도 같은 방식으로 적용합니다. 있는 사진으로 하는 변경은 허용합니다.

**2) 사업 정보 · 실행 기록을 확인하지 못하면 점검하지 않음**
- 스냅샷을 만들 때 사업 정보 · 실행 기록을 **먼저** 읽습니다.
- 실패하면 Meta · AI 호출과 비용 예약 없이 '실패'로 끝냅니다. 이용 횟수는 차감되지 않아 다시 시도할 수 있습니다.
  - 빈 입력으로 바꿔 제한 없이 판단하던 동작을 없앴습니다.
- 화면: 실패하면 주간 칸이 통째로 사라지던 기존 동작을 고쳐, 칸을 유지하고 이유를 빨간 안내로 보여 줍니다.
  - 규칙 기반 관찰값(AI 점검 전 확인 신호)은 그대로 보입니다.

**3) 조회 누락을 없음 · 완료로 보지 않음**
- 사업 정보와 실행 기록 모두 쿼리에서 쇼핑몰(`data->>store_id`)을 먼저 거릅니다.
- 실행 · 결과 기록은 끝까지 페이지(200건씩)로 읽어 변경 원본과 최신 결과를 함께 확보합니다. 같은 id는 한 번만 셉니다.
- 2,000건을 넘어 완전성을 확인할 수 없거나 중간 페이지가 실패하면 '완전하지 않음'으로 표시하고 점검하지 않습니다.
- 점검 기준 저장 · 지우기는 불러온 id 목록이 아니라 조건(본인 · 종류 · 쇼핑몰)으로 지웁니다. 조회 상한 밖 예전 기록이 남았다가 다시 나타나지 않습니다.

**검증**
- 재현 사례를 회귀 테스트로 만들었고, **수정 전 실패 → 수정 후 통과**를 확인했습니다.

| 영역 | 수정 전 실패 | 수정 후 |
|---|---|---|
| 서버 | 26개 중 16개 | 전부 통과 |
| 화면 | 점검 기준 3개 + 실패 표시 1개 | 전부 통과 |

- 전체: 954개 중 953개 통과, 1개 건너뜀(영상 프레임, 기존과 같음).
- 모의 화면(실제 Chrome + 실제 화면 · 서버 코드 + 가짜 DB · 외부 응답)에서 9개 장면을 확인했습니다. 검토 ZIP의 `verification/`에 있습니다.
- 확인 중 `supabase-js` 호출 순서 문제를 미리 잡았습니다. `delete()` 전에 조건을 붙이면 실제 클라이언트에서 오류가 납니다. 화면 테스트의 가짜 클라이언트도 같은 순서를 강제하도록 고쳤습니다.

### 3-12. 검토 보완(4차) — 예산 의견 검사 · 동시 저장 · 운영자 verify
버전 `consult-2026-10-08.3`. 새 기능은 넣지 않았습니다.

- **예산 의견(budget_note)**
  - 예산 의견도 행동과 같은 형식으로 조건을 선언합니다(예산 방향 · 할인 · 가격 · 새 촬영).
  - 서버는 행동 · 변경안 검사와 별도로, 진행 중 실행이 있어도 건너뛰지 않고 검사합니다.
  - 제약에 걸리거나 확인할 수 없으면 그 의견만 뺍니다.
    - 재현: 할인 금지인데 "10% 쿠폰을 발행하고 광고비를 유지하세요"가 남던 것
    - 재현: 진행 중 실행이 있는 광고에 "예산 20% 증액 권장"이 남던 것
  - 진행 중 실행이 있으면 제약이 없어도 예산을 바꾸자는 의견은 보류하고, 바꾸지 않는 의견만 남깁니다(비교가 깨지지 않게).
- **점검 기준 동시 저장**
  - 두 탭이 동시에 저장하면, 각 저장이 "자기 것 빼고 전부" 지워 최종 0건이 됐습니다.
  - 이제 각 저장은 **자기 기록보다 먼저 만든 기록만** 지웁니다(`created_at` 기준). 더 늦은 기록은 남고, 조회 상한 밖 예전 기록 정리는 그대로입니다.
  - 정리 삭제가 실패하면 "저장했어요 · 예전 기록 정리는 실패했어요"로 알립니다.
- **운영자 verify**
  - 원본 파싱(`ads_by_id`)은 그대로 둡니다.
  - 주간 실행과 같은 최종 처리 결과를 `ads_by_id_final`로 따로 반환 · 기록합니다. 처리 근거 `final_basis`와 그때 쓴 사업 정보 · 실행 기록 `consult`도 함께 남깁니다.
  - 테스트: 제약 위반 · requires 누락 · 진행 중 변경이 섞인 같은 입력에서 verify의 최종 결과가 주간 실행 결과와 광고별로 일치합니다.
- **검증**: 새 · 바뀐 회귀 테스트 10개가 수정 전 실패 → 수정 후 통과했습니다. 전체 결과는 검토 ZIP에 있습니다.

## 출처
- Meta
  - M1 facebook.com/business/help/1095661473946872
  - M2 /2058515294227817
  - M3 /159334372093366
  - M4 /2342133782492969
  - M5 /321167023127050
  - M6 /1710077379203657
  - M7 developers.facebook.com/docs/development/release/business-verification
  - M8 …/graph-api/overview/access-levels
  - M9 …/release/access-verification
  - M10 …/development/permissions(ads_read)
  - M11 …/features-reference
  - M13 …/app-review/submission-guide
  - M14 …/app-dashboard/basic-settings
  - M16 …/development/release · app-modes
  - 버전 표: developers.facebook.com/docs/graph-api/changelog/versions (한국어판 ?locale=ko_KR 같은 값)
  - 자동 업그레이드: developers.facebook.com/docs/marketing-api/overview/versioning
  - Marketing changelog v22.0~v26.0: developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog/version26.0 등
  - Graph changelog v22.0~v26.0: developers.facebook.com/docs/graph-api/changelog/version26.0 등
  - v26.0 출시 공지: developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26
  - 버전 무관 변경: …/marketing-api/out-of-cycle-changes/occ-2025 · occ-2026, …/marketing-api/insights/best-practices
  - OAuth 예시: …/facebook-login/guides/advanced/manual-flow · …/access-tokens/get-long-lived
- Cafe24
  - C1 developers.cafe24.com/cs/front/faq
  - C4 …/app/front/app/launch/test
  - C6 …/launch/payment/pg
  - C7 …/launch/examine
  - C8 …/launch/examine/systemsecurity
  - C9 …/launch/examine/Quick-examine
  - (2차) 개발자센터 홈 FAQ: developers.cafe24.com/ko/ · FAQ JSON: developers.cafe24.com/cs/rest/qna?type=J|S|P|I (영문 /en/cs/rest/qna)
  - (2차) 결제 · PG: …/launch/payment · …/launch/payment/pg · 판매정보: …/launch/salesinfo · 재심사: …/launch/examine/Re-examination · 약관: developers.cafe24.com/terms
  - (2차) 권한(scope): …/develop/api/scope · 앱 서비스 FAQ: developers.cafe24.com/app/front/common/concepts/appservicefaq · 공지 387 · 423: developers.cafe24.com/cs/front/notice/387 · /423
  - (2차) API: apidocs.cafe24.com/docs/admin/get-orders · get-orders-by-order-id-buyer · get-orders-by-order-id-receivers · get-orders-by-order-id-items · get-customersprivacy · get-reports-productsales · docs/guide/how-to-use-get-api
