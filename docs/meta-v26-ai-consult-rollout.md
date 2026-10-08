# 운영 반영 준비 — Meta API v26.0 · AI 컨설턴트 (2026-10-08)

**상태: 로컬 준비 · 읽기 전용 확인까지 끝남.** master 병합 · 푸시 · 함수 배포 · 원격 SQL 적용 · 방침 게시 · 시크릿 변경 · 유료 호출은 하지 않았다(아래 6번 순서대로 승인 후 진행).
AI는 계속 꺼 둔다(`AI_WEEKLY_ENABLED`는 `true`가 아니면 꺼짐 — `ai-weekly-core.mjs` `config()`).

---

## 1. 반영용 브랜치 `release/2026-10-08-meta-v26-ai-consult`

- 원격 master: `origin/master = master = 024143e`(2026-10-08 fetch). 새 원격 커밋 없음 → 충돌 해결 · 재검증할 것 없음.
- 브랜치 = `024143e` + 아래 커밋. master에서 fast-forward로 병합된다.
- `preview/launchroas-apple`(master 기준 106커밋 앞섬)은 넣지 않았다.

| 커밋 | 내용 |
|---|---|
| `93dda06` | AI 컨설턴트 최소 흐름 — 점검 기준(사업 정보) · 지난 실행 기록을 주간 점검 입력에, 사장님 요약 |
| `290b3ea` | Meta API 버전 v21.0 → v26.0(별도 커밋) |
| `87f9b18` | AI 마무리 — 정책 적용 여부 기록, 쇼핑몰 삭제 트리거 SQL, 예산 제약 수정, 모의 화면 확인 |
| `1b09d26` | 문서 — 심사 준비 정정 |
| `3ed3689` | 검토 보완 — 제약을 출력 전체에, 조회 실패 · 미완료 시 중단, 조회 누락 없음 |
| `dd058ea` | 문서 — 방침 초안 정정(ai_weekly_reviews 삭제 연동) |
| `2aa6502` | 검토 보완 4 — 예산 의견 검사, 동시 저장, verify 최종 결과 |
| (이 커밋) | 반영 준비 — 읽기 전용 확인 SQL · 되돌리기 SQL · 이 문서 |

### 운영에 반영되는 파일

| 파일 | 반영 대상 | 바뀌는 이유 |
|---|---|---|
| `supabase/functions/_shared/meta-adset-normalize.mjs` | 함수 6개 공통 | `GRAPH_API_VERSION` v21.0 → v26.0(Marketing API v21.0은 2025-09-09 만료) |
| `supabase/functions/_shared/meta-token.ts` | 함수 5개 공통 | 같은 상수(토큰 확인 · 갱신 호출) |
| `supabase/functions/meta-insights/index.ts` | meta-insights | 같은 상수 |
| `supabase/functions/meta-oauth-start/index.ts` | meta-oauth-start | Meta 로그인 창 주소 버전 |
| `supabase/functions/meta-oauth-callback/index.ts` | meta-oauth-callback | 토큰 교환 주소 버전 |
| `supabase/functions/_shared/ai-consult-core.mjs`(새 파일) | ai-weekly-review | 점검 기준 · 지난 실행 반영, `requires` 구조 검사(사용자 제약 · 진행 중 변경), 조회 실패 · 미완료 시 중단, 요약 |
| `supabase/functions/_shared/ai-weekly-core.mjs` | ai-weekly-review | 광고 입력에 지난 실행, 모델 답의 `requires` 해석 |
| `supabase/functions/ai-weekly-review/index.ts` | ai-weekly-review | 위 흐름 연결, verify에 최종 결과(`ads_by_id_final`) 기록 |
| `launchroas/insights.js` · `launchroas/styles.css` | LaunchROAS(Vercel, master 기준) | 점검 기준 입력 · 지우기 · 요약 — **AI가 켜졌을 때만 보임**(`insights.test.js` 'AI가 꺼져 있으면 … 숨긴다') |
| `supabase/migrations/20261008120000_store_delete_business_profile.sql` | DB(SQL 편집기로 수동 적용) | 쇼핑몰 삭제 시 그 쇼핑몰의 점검 기준도 삭제 |

배포되지 않는 것: `docs/**`, `tests/**`(모의 서버 `tests/browser/**` 포함), `launchroas/*.test.js`(`.vercelignore`).
LaunchDesk(루트) 결과물은 그대로다 — 빌드는 루트 파일 목록과 `assets/`만 복사한다(`scripts/build-static-output.js`).

---

## 2. 함수 배포 계획 (7개)

### 사전 확인 결과 (2026-10-08, 읽기 전용)
- `functions list`: 버전 · verify_jwt가 아래 표와 같다. `supabase/config.toml`의 verify_jwt와 운영 값이 같고, config.toml은 이번 변경에 없다.
- 운영 배포본 소스(`functions download`, 빈 임시 폴더)는 **master `024143e`와 바이트 단위로 같다**(13개 파일, 줄바꿈만 맞춤). 그래서 이번 배포로 나가는 변경은 1번 표의 diff뿐이다.

| 순서 | 함수 | 배포 전 | verify_jwt(유지) | 바뀌는 것 | 배포 후 확인 |
|---|---|---|---|---|---|
| 1 | meta-insights | v14 | true | index.ts + 공통 2개: v26.0 | LaunchROAS 대시보드 Meta 성과가 보인다 |
| 2 | meta-adset-insights | v15 | true | 공통 2개: v26.0 | 광고 세트 패널이 보인다 |
| 3 | meta-adaccounts | v12 | true | 공통 2개: v26.0 | 광고계정 목록이 보인다 |
| 4 | meta-account-select | v12 | true | 공통 2개: v26.0 | (다시 고를 때만) 선택 저장 |
| 5 | meta-oauth-start | v11 | true | 로그인 창 주소 `/v26.0/dialog/oauth` | 6과 연달아. 실제 재연결은 필요할 때만 |
| 6 | meta-oauth-callback | v13 | **false** | 토큰 교환 v26.0 | 〃 |
| 7 | ai-weekly-review | v16 | true | AI 컨설턴트 전체 + 공통 v26.0 | AI 칸 숨김 그대로(`status` → `enabled:false`), 이용 횟수 변화 없음 |

- 순서 이유: 읽기 함수 → 연결 함수 2개 연달아 → AI 함수. Meta 쪽은 이미 v26으로 응답받고 있었다(운영 응답의 "deprecated in v26.0+" 안내). 그래서 버전 고정의 동작 차이는 작고, AI 함수는 꺼진 채로 나간다.
- 명령(저장소 루트, master = 이 브랜치 상태에서). `--no-verify-jwt`는 쓰지 않는다 — config.toml 값이 그대로 적용된다:
  ```bash
  npx -y supabase@2.120.0 functions deploy meta-insights --project-ref zzhvckikonnalqnyatgn --use-api
  # meta-adset-insights · meta-adaccounts · meta-account-select · meta-oauth-start · meta-oauth-callback · ai-weekly-review 순서로 같은 명령
  ```
- 공통 확인(7개 끝난 뒤):
  1. `functions list` — 각 버전 +1, VERIFY_JWT 그대로(meta-oauth-callback만 false), STATUS ACTIVE.
  2. 배포본 = 커밋: 새 빈 임시 폴더에 `functions download <이름> --project-ref zzhvckikonnalqnyatgn --workdir <임시 폴더> --use-api`(저장소 안으로 받지 않음). 그다음 `git show HEAD:<경로>`와 줄바꿈만 맞춰 비교한다 → 모두 같아야 함.
  3. 대시보드 Edge Functions 로그에서 확인 시간대에 새 오류가 없다.
- `AI_WEEKLY_ENABLED=false` 유지: 운영 시크릿 값은 이번에 조회하지 않았다. 대시보드 Edge Functions → Secrets에서 이 이름이 없거나 `true`가 아닌지만 본다. 코드는 정확히 `"true"`일 때만 켠다.
- 되돌리기: `git checkout 024143e`(배포 전 운영본과 같음을 확인함) 상태에서 같은 명령으로 해당 함수를 재배포 → `git checkout master`.

---

## 3. DB 적용 준비 — 쇼핑몰 삭제 → 점검 기준 삭제 트리거

| 단계 | 파일 |
|---|---|
| 적용 전 확인(읽기 전용) | `supabase/verify/business_profile_store_delete_precheck_readonly.sql` |
| 소유자 접근 · 매장 구분(읽기 전용) | `supabase/verify/tool_records_owner_access_readonly.sql` |
| 적용(SQL 편집기에서 파일 전체 1회) | `supabase/migrations/20261008120000_store_delete_business_profile.sql` |
| 적용 후 확인(읽기 전용) | `supabase/verify/business_profile_store_delete_post_apply_readonly.sql` |
| 되돌리기(필요할 때만) | `supabase/ops/business_profile_store_delete_rollback.sql` |

- `db push` · `migration repair`는 쓰지 않는다. 운영에 `supabase_migrations.schema_migrations` 표가 아예 없다(2026-10-08 확인). 그래서 `db push`는 저장소 마이그레이션 전부를 '미적용'으로 보고 다시 실행하려 한다.
- SQL 파일은 `supabase/migrations/`에 둔다. 같은 방식의 기존 트리거(`20260924170000_store_delete_meta_auto_adlog.sql`)도 여기 있고 같은 방식(SQL 편집기)으로 적용됐다.
- 같은 파일을 다시 실행해도 결과가 같다(`create or replace` · `drop trigger if exists`).

### 운영 읽기 전용 확인 결과 (2026-10-08, `db query --linked`)

| 확인 | 결과 |
|---|---|
| 실행 환경 | postgres · bypass_rls true · rls_forced false(행을 빠짐없이 봄) · PostgreSQL 17.6 |
| stores 트리거 | `stores_delete_meta_auto_adlog`(켜짐) + 함수 `delete_meta_auto_adlog_for_store`(security definer)만 — 새 트리거 · 함수 없음(적용 전 상태) |
| 기존 트리거 함수 실행 권한 | postgres 1행 — 새 함수도 적용 후 같아야 함 |
| `tool_records.data` | jsonb, NOT NULL |
| 점검 기준(`business_profile`) | 0건(소유자 0 · 고아 0) |
| 실행 기록(`ad_log`) | 0건 — 운영 tool_records는 `ad_fx_rate` 1 · `margin_calc` 2 · `product_margin_link` 3뿐 |
| RLS | 켜짐(강제 아님) |
| 행 단위 정책 | authenticated 대상 select · insert · delete · update 4개 모두 `auth.uid() = user_id` |
| 테이블 권한 | authenticated: DELETE · INSERT · SELECT(UPDATE 없음 → update 정책은 실효 없음) · anon 없음 · service_role: REFERENCES · TRIGGER · TRUNCATE(조회 불가 → 함수가 사용자 권한으로 읽는 코드와 일치) |
| 외래 키 | `tool_records.user_id → auth.users` on delete cascade · `ai_weekly_reviews` store_id · user_id 모두 cascade |
| 마이그레이션 기록 표 | 없음 |

- 매장 구분: DB는 사용자 단위까지(RLS), 쇼핑몰 단위는 앱 쿼리(`data->>store_id`)가 거른다 — 서버 `loadConsult`, 화면 `loadProfile` · `deleteProfiles` 모두. 운영 데이터가 0건이라 실제 행으로 교차 확인할 것은 없다(필터는 테스트로 확인).
- 로컬 확인(PGlite, 원격 미사용): 적용 전 → 소유자 접근 → 적용 → 적용 후 → 되돌리기 → 두 번 다시 적용 → 쇼핑몰 삭제 순서로 다섯 파일을 실제로 돌렸다. 그 쇼핑몰 · 소유자의 `business_profile`만 지워지고 다른 쇼핑몰 기준 · 실행 기록 · 직접 입력 기록은 남는다.

---

## 4. 개인정보처리방침 v1.7 반영안

### 4-1. 비교
- **게시본 = 저장소**: `https://launchdesk.co.kr/` 방침 본문과 `index.html` 본문이 같다(해시 일치, v1.6 · 2026-09-28 시행).
- v1.6과 실제 처리의 차이:
  - AI · Anthropic · LaunchROAS 언급이 없다.
  - LaunchROAS(`https://launchroas.vercel.app`)는 이 방침에 링크하지만 1번 적용 범위 문장에 없다.
  - 3번 Meta 문단 "조회한 성과 자체는 서버에 저장하지 않습니다"는 AI 점검을 켜면 맞지 않는다(점검 기록에 광고별 성과 · 문구 · 이미지 주소 저장).
  - 3번 Cafe24 행 · 문단은 실제보다 넓다. 운영 저장값은 허용 목록(`slimOrder`)뿐이고 주문자 · 수령인 정보는 저장하지 않는다. 주문 상품은 `cafe24-order-items`가 조회해 돌려줄 뿐 저장하지 않는다.
- 초안(`docs/launchroas-ai-consult-privacy-draft.md`)에서 고친 것:
  - **판매 집계는 Anthropic으로 보내지 않는다.** 모델 입력은 기간 · 메모 · 통화 · 점검 기준 + 광고별 정보 · 이미지뿐이다(`batchContent` context). 판매 집계는 점검 기록 저장 · 요약 계산에만 쓴다.
  - Anthropic 관련 사실을 공식 문서로 채웠다:
    - 계약 주체: 한국 고객은 Anthropic, PBC.
    - 학습: 상업 약관 "Anthropic may not train models on Customer Content from Services"(학습 금지).
    - 보관: API 입력 · 출력은 받은 날부터 30일 이내 자동 삭제. 이용정책 위반 판정 시 최대 2년, 법령상 예외가 있다.
    - 위치: 저장은 미국. 처리(추론)는 기본 설정에서 미국 · 유럽 · 아시아 · 호주로 보내질 수 있다(코드는 `inference_geo`를 쓰지 않음).
    - 사용 모델: `claude-sonnet-5-5`(가격표에 없는 모델은 호출 거절). Covered Models(Mythos급 · Fable)가 아니다.
  - 빠졌던 항목을 더했다:
    - 1번 LaunchROAS 범위.
    - Meta 문단 예외.
    - AI 이용 비용 기록: `ai_budget_reservations`. 쇼핑몰을 삭제하면 쇼핑몰 연결만 지워지고(`on delete set null`), 금액 기록은 회원 탈퇴 시 삭제된다.
  - 초안의 원격 [확인 필요] 3건(행 단위 정책 · FK cascade · ai_weekly_reviews FK)은 3번 표로 해소했다.

### 4-2. 게시할 문안 (index.html `/privacy`에 그대로 반영)
`[게시 예정일]` · `[공개 전 확정 필요 …]`는 배포 검사(`scripts/predeploy-privacy-v1_2-gate.js`)가 막는 자리표시자다 — 결정 뒤 채운다.

**머리말** — 시행일 · 버전만 바꾼다: `시행일 [게시 예정일] · v1.7 · `(운영자 표기는 현행 그대로)

**1번 — 마지막 문단 교체**
> 이 방침은 런치데스크 웹사이트(https://launchdesk.co.kr)와 광고 성과 관리 서비스 LaunchROAS(https://launchroas.vercel.app)를 통해 제공되는 모든 서비스에 적용됩니다.

**2번 — 목록에 추가("쇼핑몰 판매·광고 데이터 연동" 다음)**
> 주간 AI 광고 점검(LaunchROAS) — 이용자가 "이번 주 점검하기"로 점검을 실행한 경우에만, 지난주 Meta 광고 성과·광고 소재와 이용자가 입력한 점검 기준(광고 목표·목표 ROAS·월 광고 예산 상한·바꿀 수 없는 것)을 AI(Anthropic의 Claude)로 분석해 광고별 판단과 이번 주 할 일을 제공하고, 점검 결과와 이용 비용을 기록

**3번 — 표**

| 구분 | 수집 항목 | 수집 방법 |
|---|---|---|
| Cafe24 주문 데이터(행 교체) | 연동한 쇼핑몰 주문의 주문 번호·주문 일시·주문 상태·결제·취소 여부·주문 경로·결제 및 주문 금액 구성·통화 — 주문자·수령인의 이름·연락처·주소 등 쇼핑몰 고객 정보는 저장하지 않음 | Cafe24 주문 동기화 시 자동 조회해 위 항목만 저장. 주문 상품 정보(상품명·옵션·수량·금액)는 판매 집계·마진 계산을 볼 때 그때그때 조회하며 저장하지 않음 |
| AI 점검 기준(LaunchROAS)(새 행, "Meta 성과 기록" 다음) | 광고 목표, 목표 ROAS, 월 광고 예산 상한, 바꿀 수 없는 것(예산 늘리기·할인·가격·새 사진·영상 촬영 중 선택), 연결된 쇼핑몰, 저장 시각 | 이용자가 주간 AI 점검 화면에서 "점검 기준 저장"을 누른 경우에만 저장(쇼핑몰별 최신 1건만 보관) |
| 주간 AI 점검 기록(LaunchROAS)(새 행) | 분석 기간, 점검한 광고의 Meta 광고 ID와 캠페인·광고 세트·광고 이름, 성과 지표(광고비·노출·클릭·구매 등, 지난주와 그 전주), 캠페인 목적·최적화 목표·귀속 설정, 광고 문구·행동 유도 버튼·랜딩 도메인·게재 위치·광고 이미지 주소, 점검 기준, 그 광고에 이미 실행한 변경과 결과 요약, 쇼핑몰 주간 판매 집계(매출·판매 수량·마진 합계), AI 분석 결과, 사용량·이용 비용 | 이용자가 "이번 주 점검하기"로 점검을 실행할 때 생성·저장(실행하지 않으면 생성되지 않음) |

**3번 — 문단**
- "Cafe24·Meta 계정 연동도 구조는 비슷합니다 …" 문단 끝에 추가:
  > 또한 이용자가 LaunchROAS에서 주간 AI 점검을 실행한 경우에는 분석에 사용한 광고별 성과·광고 문구·이미지 주소와 분석 결과를 주간 AI 점검 기록으로 저장합니다(보유기간은 4번 항목 참고).
- "다만 Cafe24 연동을 통해 조회·저장되는 주문 데이터에는 …" 문단 교체:
  > Cafe24 주문 조회 응답에는 이용자의 쇼핑몰을 이용한 주문자·수령인의 성명·연락처·배송지 등 제3자(쇼핑몰 고객)의 정보가 함께 포함될 수 있습니다. 회사는 이 응답에서 판매 집계에 필요한 항목(위 표의 Cafe24 주문 데이터)만 골라 저장하며, 쇼핑몰 고객 정보는 저장하지 않습니다. 이는 이용자가 쇼핑몰 운영자로서 이미 보유한 정보를 서비스가 조회하는 것입니다.
- 그다음 새 문단:
  > 주간 AI 점검을 실행하면 회사 서버가 점검할 광고의 정보를 Anthropic, PBC의 Claude API로 보내 분석을 받습니다. 보내는 정보는 분석 기간(통화·광고계정 시간대 포함), 광고별 Meta 광고 ID와 캠페인·광고 세트·광고 이름, 성과 지표, 캠페인 목적·최적화 목표·귀속 설정, 광고 문구·행동 유도 버튼·랜딩 도메인·게재 위치, 광고 소재 이미지, 점검 기준, 그 광고에 이미 실행한 변경과 결과 요약입니다. 이용자의 이메일·이름·회원 식별자와 Cafe24 주문·판매 정보는 보내지 않습니다. 광고 소재 이미지에 사람이 나오는 경우 그 이미지도 함께 전송됩니다. 위탁·국외 이전 내용은 6·7번 항목을 참고해 주세요.

**4번 — 목록**
- "쇼핑몰 정보" 항목 교체:
  > 쇼핑몰 정보 — 쇼핑몰을 삭제할 때까지 보유합니다. 쇼핑몰 목록 화면에서 이용자가 직접 삭제할 수 있으며, 쇼핑몰을 삭제하면 그 쇼핑몰의 Meta 성과 기록, AI 점검 기준, 주간 AI 점검 기록도 함께 삭제됩니다.
- "Meta 성과 기록" 항목 다음에 추가:
  > AI 점검 기준 — 이용자가 직접 지우거나(주간 AI 점검 화면의 "점검 기준 지우기"), 그 쇼핑몰을 삭제하거나, 회원 탈퇴할 때까지 보유합니다. 새 기준을 저장하면 같은 쇼핑몰의 이전 기준은 삭제됩니다. Cafe24·Meta 연동을 해제해도 삭제되지 않습니다.

  > 주간 AI 점검 기록 — [공개 전 확정 필요: 결정 3 — 기본안] 그 쇼핑몰을 삭제하거나 회원 탈퇴할 때까지 보유하며, 쇼핑몰을 삭제하면 그 쇼핑몰의 점검 기록도 함께 삭제됩니다. 기록 삭제를 원하시면 12번 항목의 이메일로 요청해 주세요. AI 이용 비용 기록(예약·정산 금액)은 월 이용 한도 관리를 위해 회원 탈퇴 시까지 보유하며, 쇼핑몰을 삭제하면 쇼핑몰과의 연결만 지워집니다.

  > Anthropic에 보낸 점검 요청·응답 — 회사 서버의 점검 기록과 별개로, Anthropic은 API로 받은 입력과 출력을 받은 날부터 30일 이내에 자동 삭제합니다. 다만 Anthropic 이용정책 위반으로 판정된 경우 최대 2년, 법령에 따라 필요한 경우 그 기간 동안 보관될 수 있습니다(Anthropic 공식 안내).
- 목록 아래 문단 교체:
  > 현재 서비스 화면에서는 쇼핑몰 등록 정보 삭제, 광고 기록(Meta 성과 기록 포함) 삭제, AI 점검 기준 삭제, Meta 연동 해제, Cafe24 연동 해제를 이용자가 직접 처리할 수 있으며, 그 밖의 회원 탈퇴, 열람·정정·처리정지, 광고 세트 손익분기 기준 연결 정보와 주간 AI 점검 기록의 삭제는 12번 항목의 이메일(dhhs1124@gmail.com)로 요청해 주시면 운영자가 직접 확인한 후 처리합니다.

**6번 — 위탁 표에 행 추가**

| 수탁자 | 위탁 업무 내용 | 비고 |
|---|---|---|
| Anthropic, PBC | LaunchROAS 주간 AI 광고 점검 분석(Claude API) | 국외(미국) — 이용자가 점검을 실행할 때만 전송하며 자세한 내용은 7번 항목 참고. Anthropic은 회사가 보낸 내용을 모델 학습에 이용하지 않으며(Anthropic 상업 약관), 데이터처리계약(DPA)에 따라 처리합니다. 보관기간은 4번 항목 참고 |

**7번**
- "Google 로그인(OAuth)은 …" 문단 다음에 추가:
  > LaunchROAS 주간 AI 점검은 이용자가 점검을 실행한 경우에만 아래 표의 Anthropic, PBC 행과 같이 이전되며, 실행하지 않으면 이전되지 않습니다.
- 국외 이전 표에 행 추가:

| 이전받는 자 | 이전 항목 | 이전 국가 | 이전 목적 | 이전 시점 및 방법 | 보유·이용 기간 |
|---|---|---|---|---|---|
| Anthropic, PBC | 점검한 광고의 Meta 광고 ID와 캠페인·광고 세트·광고 이름, 성과 지표, 캠페인 목적·최적화 목표·귀속 설정, 광고 문구·행동 유도 버튼·랜딩 도메인·게재 위치, 광고 소재 이미지, 분석 기간, AI 점검 기준, 그 광고에 이미 실행한 변경과 결과 요약(이메일·이름·회원 식별자와 Cafe24 주문·판매 정보는 보내지 않음) | 미국(저장). 분석은 미국·유럽·아시아·호주 중 Anthropic이 운영하는 시설에서 처리될 수 있음 | 주간 AI 광고 점검 분석 | 이용자가 점검을 실행할 때 네트워크(암호화 통신)를 통해 전송 | 받은 날부터 30일 이내 자동 삭제(이용정책 위반 판정 시 최대 2년, 법령상 필요한 경우 예외) |

- 정책 링크 목록에 추가:
  > Anthropic 개인정보처리방침: anthropic.com/legal/privacy · Anthropic 상업 약관: anthropic.com/legal/commercial-terms · Anthropic 데이터 보관·처리 위치 안내: privacy.claude.com

**9번 — 둘째 문단 교체**
> 현재 서비스 화면에서는 쇼핑몰 등록 정보 삭제, 광고 기록(Meta 성과 기록 포함) 삭제, AI 점검 기준 삭제, Meta 연동 해제, Cafe24 연동 해제를 이용자가 직접 처리할 수 있으며, 그 밖의 열람·정정·삭제·처리정지는 셀프서비스로 제공되지 않습니다. 권리 행사를 원하시는 경우 12번 항목의 이메일(dhhs1124@gmail.com)로 요청해 주시면, 회사가 요청인의 본인 여부를 확인한 후 직접 확인해 관련 법령이 정한 기간 내에 필요한 조치를 취합니다.

**14번 — 마지막에 추가**
> v1.6 → v1.7 주요 변경 사항([게시 예정일] 시행) — LaunchROAS 주간 AI 광고 점검 도입에 따라 적용 범위(LaunchROAS)와 처리 목적·수집 항목·보유기간·위탁·국외 이전(Anthropic, PBC)·직접 삭제 방법을 1·2·3·4·6·7·9번 항목에 반영하고, Cafe24 주문 데이터의 저장 항목을 실제 저장 범위(쇼핑몰 고객 정보는 저장하지 않음)로 고쳤습니다. [공개 전 확정 필요: 결정 2 — A: 기존에 개인정보처리방침(v1.6)에 동의한 회원은 다음 로그인 시 변경된 방침에 대한 재동의 절차를 거치게 됩니다. / B: 주간 AI 점검은 이용자가 실행할 때만 처리되므로 v1.6에 동의한 회원에게 재동의를 요구하지 않습니다.]

**15번 — 교체**
> 버전: v1.7(이전 버전: v1.6, 2026년 9월 28일 시행) / 시행일: [게시 예정일]

### 4-3. 결정할 것 (이것만)
1. **시행일(= 게시일).** 관행은 게시 당일 시행이다(14번: 이 페이지 게시로 고지). 조건은 3번 트리거 적용 뒤, AI 켜기 전.
2. **기존 회원 재동의.**
   - A — 재동의(권장 · 관행). v1.1~v1.4처럼 새 수집 항목 · 새 국외 이전이 더해지는 개정이다. 두 `policy-consent-core.js`(루트 · `launchroas/`)의 `PRIVACY_VERSION`을 `'v1.7'`로, `ACCEPTED_PRIVACY_VERSIONS`를 `['v1.7']`로 바꾼다.
   - B — 재동의 없음. v1.5 · v1.6처럼 처리한다. `ACCEPTED_PRIVACY_VERSIONS`에 `'v1.7'`을 더한다.
   - 어느 쪽이든 문의 접수 동의 버전(`SETUP_INQUIRY_PRIVACY_VERSION = 'v1.4'`)은 그대로다(처리 내용 변화 없음).
3. **주간 AI 점검 기록 보유기간.** 기본안은 지금 코드 그대로다: 쇼핑몰 삭제 · 회원 탈퇴 시까지, 이메일 요청 시 삭제. "점검일부터 N개월" 같은 안은 자동 삭제 작업이 새로 필요하다(이번 범위 밖).
4. **국외 이전 근거(법률 판단).** 문안은 Resend와 같은 방식이다(6번 위탁 + 7번 국외 이전 고지, 별도 동의 없음). 별도 동의가 필요하다고 보면 AI 첫 실행 전 동의 화면(새 기능)이 있어야 하므로 AI 켜기 전에 결론이 나야 한다. 광고 이미지 속 인물은 문안에 이미 넣었다.
5. **LaunchDesk 쇼핑몰 삭제 안내 문구**(`stores.js` — 지금은 'Meta 자동 광고 기록'만 언급). AI 켜기 전에 'AI 점검 기준 · 주간 AI 점검 기록'을 더할지 정한다. 더하면 문구 고정 테스트도 함께 바꾼다.

게시 작업(결정 뒤, 별도 커밋)은 다음 셋이다. 배포 검사 exit 0을 확인한다.
- `index.html` 위 문안
- 결정 2에 따른 동의 버전 상수
- v1.6 문구 · 버전을 고정한 테스트(`tests/privacy-version-consistency.test.js` · `tests/policy-consent-flow.test.js` 등)

---

## 5. 유료 운영자 검증 1회 — 요청 계획 (아직 호출하지 않음)

- **목적**: 운영에서 실제 모델이 새 지시문대로 `requires`(행동에 필요한 조건)를 내는지 본다. 운영 RLS로 점검 기준 · 실행 기록을 읽는지(`load: ok`), 주간 실행과 같은 최종 처리(`ads_by_id_final`)가 기록되는지도 본다.
- **전제**:
  - 2번 배포가 끝났다.
  - verify 경로는 `AI_WEEKLY_ENABLED`와 무관하다 — 꺼진 채로 진행하고, 가짜 환경에서 꺼짐 상태로 `ok:true`를 확인했다.
  - `AI_VERIFY_USER_IDS`에 운영자 ID가 있고 `LAUNCHROAS_ANTHROPIC_API_KEY`가 있다(대시보드에서 이름만 확인).
- **최대 승인 비용: US$0.30.**
  - 함수가 호출 전에 실제 보낼 내용으로 최악 비용을 계산한다. 이 값이 `budget_usd`를 넘으면 호출하지 않는다(`OVER_VERIFY_BUDGET`, 무료). 예약도 이 금액 이하다.
  - 최악 추정: 광고 1개 · 이미지 3장 · 출력 상한 16,000토큰에서 약 $0.22.
  - 예상 실제 비용: $0.03~0.10(2026-10-06 같은 경로 medium 광고 1개 실측 $0.0340).
  - 월 예산(기본 $30) 검사도 함께 받는다.

LaunchROAS(`https://launchroas.vercel.app`)에 운영자 계정으로 로그인한 탭의 개발자 도구 콘솔에서:
```js
const c = window.supabase.createClient('https://zzhvckikonnalqnyatgn.supabase.co', 'sb_publishable_hu9XkhXJKyoWVL7zMQD8_g_iMmDymMK'); // app.js의 공개 값
(await c.from('stores').select('id,name')).data;   // 쇼핑몰 ID 확인
const STORE_ID = 0, AD_ID = '';                    // AD_ID: 지난주(월~일) 광고비가 쓰인 광고 1개의 Meta 광고 ID
const call = (budget_usd, label) => c.functions.invoke('ai-weekly-review', { body: { action: 'verify', store_id: STORE_ID, ad_id: AD_ID, efforts: ['medium'], budget_usd, label } });
// 4xx 응답은 data가 비고 error에 담긴다: await res.error.context.json()
```
0. (선택 · 무료 · 운영 쓰기 1건) 제약 처리까지 실제 모델로 보려면 점검 기준 1건을 저장한다(화면 저장과 같은 모양, 본인 권한):
   ```js
   const uid = (await c.auth.getUser()).data.user.id;
   await c.from('tool_records').insert({ user_id: uid, tool_type: 'business_profile', data: { store_id: String(STORE_ID), saved_at: new Date().toISOString(), objective: '판매', target_roas_pct: null, monthly_budget_cap_krw: null, cannot_change: ['예산 늘리기'] } });
   ```
1. 무료 사전 확인 — `(await call(0.0001, 'release-preflight')).data`
   - 기대: `code: 'OVER_VERIFY_BUDGET'` · `calls: 1` · `worst_usd ≤ 0.30`. 모델 호출 · 예약 · 기록이 없다(가짜 환경에서 확인).
   - `NO_SNAPSHOT`(점검 기준 · 실행 기록 조회 실패 포함) · `AD_NOT_IN_PERIOD`면 멈춘다.
2. **유료 1회(승인 후)** — `(await call(0.30, 'release-2026-10-08-consult')).data`
   - 기대: `ok: true` · `runs[0].status: 'completed'` · `saved: true`.
3. 결과 확인(읽기 전용) — `supabase/verify/ai_consult_verify_result_readonly.sql`
   - 블록 1: completed · truncated false · `final_basis`가 `guardResults consult-2026-10-08.3`로 시작한다. `variant`로 운영 `AI_POLICY_VERSION` 상태(policy_on/off)도 시크릿을 읽지 않고 알 수 있다.
   - 블록 2: 광고별 `requires_present` · 최종 보류 사유.
   - 블록 3: 예약 정산.
   - 가짜 행으로 세 사례(in_progress · unverifiable · constraint)가 구분되는 것을 확인했다.
4. 0번을 했다면 지운다(화면 '점검 기준 지우기'와 같은 조건):
   ```js
   await c.from('tool_records').delete().eq('user_id', uid).eq('tool_type', 'business_profile').eq('data->>store_id', String(STORE_ID));
   ```

---

## 6. 전체 반영 순서 (각 단계 승인 후)
1. master 병합(fast-forward) · 푸시.
   - LaunchDesk 결과물은 변화 없다.
   - LaunchROAS는 `insights.js` · `styles.css`가 바뀐다(AI 꺼짐이라 화면 변화 없음). 운영 LaunchROAS 파일 7개가 지금 master와 같으므로 master 기준 배포다.
   - 먼저 병합하는 이유: 함수 배포본이 항상 master와 같게.
2. 함수 7개 배포 + 공통 확인(2번).
3. DB 트리거: 적용 전 확인 → 적용 → 적용 후 확인(3번).
4. 유료 verify 1회(5번, 상한 $0.30).
5. 방침 v1.7 게시(4-3 결정 뒤 별도 커밋).
6. AI 켜기(`AI_WEEKLY_ENABLED=true`) — 별도 승인. 5번 뒤.

## 7. 이번 확인 (2026-10-08) — 기존 검증은 재사용, 새로 바뀐 것만 확인
- 재사용: `2aa6502` 기준 결과를 그대로 쓴다. 이 브랜치의 코드는 그 뒤로 바뀌지 않았다.
  - 4차 보완 37개 테스트(수정 전 10개 실패 → 수정 후 37개 통과)
  - 전체 961개(960 통과 · 1 건너뜀)
  - 모의 HTTP 확인 · 검토 ZIP 자체 점검
- 새로 확인:
  - 원격 master 변화 없음(병합 · 충돌 해결 불필요).
  - 운영 함수 7개 버전 · verify_jwt = config.toml.
  - 운영 배포본 13개 파일 = master.
  - LaunchDesk Vercel 빌드 명령을 로컬로 실행 — 배포 검사 OK · 테스트 670개 통과 · 결과물 생성.
  - 운영 LaunchROAS 파일 7개 = master.
  - 운영 DB 읽기 전용 조회(3번 표).
  - 반영 SQL 5개 로컬 PGlite 실행.
  - verify 결과 SQL을 함수가 실제로 남기는 행 모양으로 실행.
  - 무료 사전 확인이 모델 · 예약 · 기록 없이 끝나는 것.
  - 게시 방침 = 저장소.
  - Anthropic 보관 · 학습 · 위치 · 계약 주체(공식 문서).
- 하지 않은 것: 운영 시크릿 값 조회, 원격 쓰기, 유료 호출, 함수 배포, 푸시.
