# 2026-10-08 외부 연결 심사 준비 · Meta API 버전 · AI 컨설턴트 최소 흐름

브랜치 `feat/ai-consultant-minimal-flow`(master 024143e에서 분기). 이 문서와 코드는 로컬 커밋만 했습니다.
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
- 개인 개발자에게는 개인정보 취급권한을 주지 않습니다. [원문 C1]
  - `mall.read_order` 응답이 개인 개발자 앱에서 제한되는지는 문서에 없습니다. Cafe24에 문의해야 합니다. [미확인]
- 유료 판매에는 KG PG 신청이 필요합니다. 필요 서류는 사업자등록증 사본, 인감증명서 등입니다. 통신판매업 신고도 해야 합니다. [원문 C6·C1]
- 무료 앱 심사에 사업자 서류를 요구하는 문구는 찾지 못했습니다. [미확인]

### 1-4. 준비물 · 사업자등록이 필요한 절차
**사업자등록이 필요한 것**
- Meta BV, 그리고 BV를 전제로 하는 `ads_read` Advanced Access와 Access verification [원문 M1·M8·M9 → 추론]
- Cafe24 유료 판매(PG · 통신판매업) [원문 C6·C1]

**서류**
- 사업자등록증, 또는 정부 발급 세무문서나 사업자 명의 은행 명세서
- (선택) 상호가 적힌 공과금 고지서
- 유료 판매 시: 통신판매업 신고증, PG 서류

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
- Meta API 버전 올리기(2장): 녹화 전에 하는 것을 권합니다.

## 2. Meta API 버전

### 2-1. 코드 전수 [확인]
| 위치 | 값 | 쓰는 함수 | 호출 종류 |
|---|---|---|---|
| `_shared/meta-adset-normalize.mjs:25` | v21.0 | meta-adset-insights, ai-weekly-review | 광고 성과(Marketing) |
| `_shared/meta-token.ts:106` | v21.0 | meta-adaccounts, meta-account-select | `/me/adaccounts`(Marketing) |
| `meta-insights/index.ts:21` | v21.0 | meta-insights | 계정 성과(Marketing) |
| `meta-oauth-start/index.ts:15` | v21.0 | meta-oauth-start | 로그인 대화상자(Graph) |
| `meta-oauth-callback/index.ts:15` | v21.0 | meta-oauth-callback | 토큰 교환(Graph) |
| `tests/meta-adset-insights.test.js:757` | v21.0 고정 테스트 | — | 버전이 임의로 바뀌지 않게 막는 테스트 |
| `launchroas/oauth-return.test.js:38` | v21.0 | — | 테스트용 가짜 URL(바꿀 필요 없음) |

모두 v21.0으로 같습니다. 고정 테스트까지 있으므로 의도적으로 한 버전에 맞춘 것입니다.

### 2-2. 공식 지원 기간 [원문, developers.facebook.com 버전 표]
- Marketing API
  - v21.0은 **2025-09-09에 만료**됐습니다.
  - v22.0은 2026-02-19, v23.0은 2026-06-09, v24.0은 2026-10-06에 만료됐습니다.
  - **v25.0(2026-02-18 출시)만 만료일이 '미정'**입니다.
- Graph API: v21.0은 2027-01-21까지, v25.0은 2028-07-29까지 지원됩니다.
- 만료된 버전 호출은 "may fail or be upgraded to the next available version"입니다. 다음 버전에서 바뀐 엔드포인트에는 자동 업그레이드가 적용되지 않습니다.
- Marketing API 자동 업그레이드 시작일은 문서에 "will release on July 29, 2026"으로 적혀 있습니다(문서 문구 그대로).

### 2-3. 판단 · 제안(코드 변경은 하지 않음)
- **변경이 필요합니다.**
  - Marketing 호출 3곳(위 표 1~3행)은 만료된 버전으로 호출하고 있습니다. 지금은 자동 업그레이드 덕에 동작합니다. 2026-10-08 운영 조회도 정상이었습니다.
  - 하지만 다음 버전에서 바뀐 엔드포인트가 생기면 경고 없이 실패할 수 있습니다.
  - Graph 2곳(OAuth)은 2027-01-21까지 안전합니다.
- 제안: 5곳을 함께 **v25.0**으로 올립니다. v25.0은 Marketing 만료일이 미정인 유일한 버전이고, Graph 지원은 2028-07-29까지입니다.
  - v26.0은 Graph에만 있고 Marketing 표에는 없어서 고르지 않았습니다.
  - 고정 테스트도 v25.0으로 바꿉니다.
- 올리기 전에 확인할 것: v22~v25 변경 기록에서 우리가 쓰는 필드가 바뀌었는지 봅니다.
  - insights: `actions`, `action_values`, `inline_link_clicks`, `use_unified_attribution_setting`, 귀속 창
  - 광고 세트: `attribution_spec`, `optimization_goal`
  - 소재: `object_story_spec`, `asset_feed_spec`, `thumbnail_url`
- 반영하려면 함수 5개를 재배포해야 합니다(meta-adset-insights, ai-weekly-review, meta-insights, meta-adaccounts, meta-account-select). OAuth를 함께 올리면 2개가 더 늘어납니다. 그다음 운영에서 읽기 전용 확인을 합니다.
  - 배포 승인이 필요하므로 이번에는 하지 않았습니다.

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
| `tests/ai-consult-core.test.mjs` | 9 |
| `tests/ai-consult-flow.test.mjs` | 3 |
| `launchroas/insights.test.js` 추가분 | 4 |

- 흐름 테스트는 실제 함수를 실행하고, Meta · Anthropic · Supabase는 가짜로 둡니다.
  - 예약 → 호출 → 정산 순서를 확인합니다.
  - 지시문과 입력에 목표 · 실행 기록이 들어가는지 확인합니다.
  - 겹치는 변경안이 빠지는지, 요약 순서가 맞는지, 조회 실패를 표시하는지, 본인 기록만 읽는지 확인합니다.
- 변이 확인: 사용자 필터나 서버 재강제를 빼면 실패하는 것을 확인했습니다.
- 전체: 932개 중 931개 통과, 1개 건너뜀(영상 프레임, 기존과 같음).

### 3-6. 배포할 때(보류 · 승인 필요)
1. 병합 · 푸시
2. `ai-weekly-review` 재배포(Edge Function)
3. LaunchROAS 배포

- DB 마이그레이션은 필요 없습니다. tool_records를 재사용하고, `tool_type` CHECK 제약이 없습니다.
- AI를 켜는 것(`AI_WEEKLY_ENABLED`)은 별도 승인이 필요합니다.

### 3-7. 남은 항목
- 사업 정보 나머지 필드(업종 · 주 고객 · 강점 · 프로모션 일정): 설계 문서 §4
- 광고별 손익 근거(`ad_profit_basis`): 광고별 주문 연결(UTM · 주문 매칭)이 먼저 필요
- 정책 시크릿 켜기 여부: 운영자 verify 경로로 실제 비교한 뒤(유료 호출 · 승인 필요)
- `docs/ai/*`(정책 · 플레이북 · 설계)는 preview 브랜치에만 있음 — master로 가져올지 결정
- 실행 결과를 AI가 다시 검토하는 단계(action_reviews, 설계 §8 5단계): 미착수
- 쇼핑몰을 삭제해도 `business_profile`은 남음(개인정보 아님)
  - 기존 삭제 트리거는 meta_auto 광고 기록만 지움
- 개인정보처리방침에 '점검 기준(목표 · 숫자 · 체크 항목)' 저장을 적을지 검토(정책 파일은 수정하지 않음)

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
  - 버전 표: developers.facebook.com/docs/graph-api/changelog/versions · Marketing API versioning
- Cafe24
  - C1 developers.cafe24.com/cs/front/faq
  - C4 …/app/front/app/launch/test
  - C6 …/launch/payment/pg
  - C7 …/launch/examine
  - C8 …/launch/examine/systemsecurity
  - C9 …/launch/examine/Quick-examine
