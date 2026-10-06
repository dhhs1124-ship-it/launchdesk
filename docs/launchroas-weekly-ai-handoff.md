# LaunchROAS 주간 AI 광고 점검 — 작업 인계 (2026-10-06)

## 현재 상태

**2026-10-06: 원격 적용 · 실제 Meta + Claude 검증 완료(광고 1개 — 지난주 광고비 집행 광고가 1개뿐). master 병합 · 푸시 · 운영 배포 안 함.**

- 원격(공용 Supabase `zzhvckikonnalqnyatgn`): 표 `ai_weekly_reviews` 생성(RLS 켜짐, anon/authenticated 권한 없음, service_role 읽기 · 쓰기),
  `ai-weekly-review` 배포(JWT 검사 켬). 기존 함수 15개 버전 변화 없음. 로그인 없는 호출 401.
- 시크릿(사용자 설정): `LAUNCHROAS_ANTHROPIC_API_KEY`, `AI_MAX_ADS=5`, `AI_MONTHLY_BUDGET_USD=5`, `AI_WEEKLY_ENABLED=true`. `ANTHROPIC_API_KEY`는 없음.
- 미리보기 화면(Vercel 미리보기, 커밋 `d4edd76` 기준 `insights.js`)에서 실제 실행. 이번 수정은 함수 쪽이라 화면 재배포 없이 반영됨.
- 이번 주(2026-10-05) 검증 기록: `ai_weekly_reviews` id 2(store 4). 수정 · 재검증 때 `[TEST]` 표시로 failed로 되돌려 다시 실행했고 비용은 누적(총 $0.2137, AI 호출 4회).

### 실제 검증에서 찾아 고친 문제

1. **service_role에 표 권한 없음** — 이 프로젝트는 기본 권한을 줄여 둬서 service_role도 GRANT가 필요하다. 마이그레이션에 `grant select, insert, update, delete ... to service_role` 추가 · 원격 적용.
2. **DB 오류를 "기록 없음 · 비용 0"으로 처리(예산 검사 통과)** — 권한 오류 때 예산 $5 초과 상태인데도 통과했고, 삽입 실패는 "진행 중"으로 보였다. 조회 · 삽입 오류면 멈추도록(DB_ERROR · BUDGET_CHECK_FAILED) 수정.
3. **Meta `ids` 파라미터 폐기** — 실제 응답 "The ids query parameter is deprecated in v26.0+". 소재 · 광고 세트(귀속 · 최적화 목표) 조회가 모두 실패해 지표만 분석됐다. 객체별 조회(10개씩 동시)로 변경.
4. **이미지 기본값이 0장** — `AI_IMAGES_PER_AD` · `AI_MAX_IMAGES` 미설정 시 `Number("")=0`으로 읽혀 썸네일을 안 보냈다. 빈 값은 기본값으로.
5. **"유지" 광고는 개선안 없음** — 문구를 보고도 현재안 · 변경안 · 예시 · 테스트가 비었다. "유지"이고 소재를 봤으면 현재 광고는 두고 새 광고로 비교할 테스트안 1개를 쓰게 프롬프트 보완("판단 보류"는 그대로 null).
6. **답변 잘림 위험** — 실측 광고 1개(문구 + 썸네일 + 개선안) 출력 5,233~5,774토큰(생각 토큰 포함) · 약 1분. 기존 6개/8,000이면 잘림. 묶음 1개 = 광고 1개, 출력 상한 16,000, 묶음 5개 동시(`AI_CONCURRENCY`).
7. **예산 통제 보완** — 묶음 그룹마다 월 예산 재확인(넘는 폭 = 그룹 1개 비용), 한도 도달 시 남은 광고는 pending · 안내 문구. 월 경계를 한국 시간 1일 00시로.
8. 응답 `stop_reason`이 end_turn이 아니면 `usage.stop_reasons`에 남긴다(잘림 · 거절 확인용).

### 확인한 동작(실제 서버)

- 예산 차단: 지난주 날짜 `[TEST]` 행(비용 $5 = 상한)으로 실행 → `BUDGET_EXCEEDED`, AI 호출 없음, 이번 주 행 생성 안 됨. 테스트 행만 삭제.
- 주 1회: 완료 후 다시 실행 → `WEEKLY_LIMIT`. 연속 두 번 클릭 → AI 호출 1회.
- 소재: 영상 광고 · 본문 · CTA(SHOP_NOW) · 썸네일 1장 전송, 귀속 "CLICK_THROUGH 7일, VIEW_THROUGH 1일, ENGAGED_VIDEO_VIEW 1일", 최적화 OFFSITE_CONVERSIONS.
- 출력 검증: 근거 경로 모두 실제 값과 일치, 객체 경로(`change.purchases` 등)는 버림, LPV > 링크 클릭 퍼널 이상을 "판단 불가"로 처리.
- 같은 입력에서도 실행마다 테스트안이 달랐다(3차: 본문 마지막 줄 → 행동 안내, 4차: 제목 추가). 정답이 아니라 가설 후보로 표시하는 현재 문구가 맞다.

## 운영 현황 화면 개편 (2026-10-06, 미리보기 브랜치 · 미푸시)

- 첫 화면: 핵심 금액 3개(주문금액 · 광고비 · 광고비 차감 후 예상 이익) → 주간 AI 점검(지난주 고정 기간 · 점검 결과) → 광고 현황 · 비용 설정 요약.
  광고 성과 · 광고 기록 · 상품 비용/환율은 별도 메뉴. 운영 브리핑 · 규칙 기반 점검 · 이번 달 패널은 핵심 카드와 겹쳐 제거.
- '광고비 차감 후 예상 이익' 도움말 = sales-core 실제 공식: 상품 판매금액 + 고객 배송비 − 적립금 − 원가 − 판매/PG/배송비 수수료 − 택배 · 포장 · 기타(설정값, 주문당 1회) − Meta 광고비(원화).
  세금 · 인건비 · 임대료 · 반품 배송비 미반영이라 '순이익'으로 쓰지 않는다.
- 점검 결과 목록: 광고명 · 상태 / 핵심 숫자 / 권장 행동 / 확인 사항. '개선 필요'만 '우선 확인', 유지 · 판단 보류는 수정안을 권하지 않는다(권장 행동은 판정에서, 확인 사항은 실제 지표 상태에서 만든다).
  '판단 근거' · '테스트 제안'(변경안이 있을 때만)을 눌러야 펼쳐지고, 분석 전문은 그 안에서도 접혀 있다.
- 내부 필드명 · 코드 · null은 `launchroas/insights.js`의 koText · metricName · formatValue · trimNote로 한국어 변환(테스트: insights.test.js). 프롬프트에도 같은 규칙 추가(배포됨, 다음 실행부터 적용 · 재실행 검증 안 함).
- 화면 스크립트가 찾는 요소 ID는 dom-ids.test.js가 index.html과 대조한다(개편 중 광고비 카드가 멈춘 원인).

## 운영자 검증 경로 · effort 비교 (2026-10-06)

- `action: "verify"`(화면 없음, 시크릿 `AI_VERIFY_USER_IDS`의 계정만) → `ai_weekly_verifications`에 따로 기록. 주간 기록 · 이용 횟수는 건드리지 않고, 비용은 월 예산 합계(monthSpent)에 포함. 1회 최악 비용 상한 $0.50.
- 실측(광고 1개 · 같은 입력): high 42.4초 · $0.0645 / medium 17.9초 · $0.0340. 상세와 화면 캡처(실제/모의 구분)는 `docs/review/2026-10-06/README.md`.
- 기본 effort는 아직 바꾸지 않음(결정 필요).
- 게재 위치(`targeting`)로 제목 노출 여부를 판단해 AI에 넘긴다(자동 게재 위치 = 일부). 연결 마진이 최근 저장값과 다르면 손익분기 판정 · 예상 잔액은 보류.

## 다음 단계 설계 문서 (2026-10-06 · 서버 미적용)

- `docs/ai/ad-review-policy.md` — 공통 분석 기준(판단 순서 · 판정 4종 · 예산 조건 · 필수 제약 · Meta 문서 검증 표)
- `docs/ai/apparel-ad-playbook.md` — 의류 사례집(에이블리 인기 쇼핑몰 웹 상위 9곳 중 6곳 · 광고 36개, 지그재그 목록 미확보)
- `docs/ai/research/2026-10-06-apparel-ads-notes.md` — 광고별 원자료 · 제외 사유 · 공식 사이트 대조
- `docs/ai/ad-improvement-loop-design.md` — 실행 기록 ↔ 광고 기록 연결, 절감 · 성과 기준, 구현 순서
- 기본 effort는 medium으로 배포됨(`AI_EFFORT`로 변경 가능).

## 광고 기록 확장 · 영상 분석 준비 (2026-10-06 · 미리보기 브랜치 · 미배포)

- 설계 · 구현 상태: `docs/ai/ad-improvement-loop-design.md` 5-4~5-7 · 7-3 · 8~11장
- 운영 메인 최소 호환: 로컬 브랜치 `compat/main-adlog-nan`(master 기준 · 푸시 안 함) — 배포 전까지 실행 기록 저장 스위치(`window.LAUNCHROAS_FLAGS.adlogChangeRecords`)를 켜지 않는다
- 경쟁사 영상 8개 표본 프레임 관찰: `docs/ai/research/2026-10-06-competitor-video-notes.md`
- 정책 · 사례 서버 연결: `_shared/ai-policy.mjs`(시크릿 `AI_POLICY_VERSION` 없으면 꺼짐)
- 영상 원본 확인 함수 초안: `supabase/functions/ad-video-source`(미배포)

## 관련 파일

| 파일 | 내용 |
|---|---|
| `supabase/functions/ai-weekly-review/index.ts` | 주간 점검 함수(status · run) |
| `supabase/functions/_shared/ai-weekly-core.mjs` | 기간 · 이용 횟수 판단 · 지표 · 소재 추출 · 묶음 · 프롬프트 · 출력 검증 · 비용(순수 함수) |
| `supabase/migrations/20261006100000_ai_weekly_reviews.sql` | DB 표(원격 적용됨, service_role GRANT 포함) |
| `supabase/config.toml` | `[functions.ai-weekly-review] verify_jwt = true` |
| `launchroas/insights.js` | 화면(주간 점검 카드 · 규칙 기반 점검) |
| `tests/ai-weekly-core.test.mjs` | 핵심 로직 테스트 |

## 원격 적용 절차 (승인 후에만)

CLI: `npx --yes supabase@2.119.0`, 로그인 상태. DB 조회는 저장소 폴더에서 `db query --linked --project-ref zzhvckikonnalqnyatgn ...`.
외장하드는 PC에 따라 G: 또는 D:로 잡힌다(회사 PC는 D:). 작업 폴더 `.git`과 `D:/ai/.git/worktrees/launchroas-apple-preview/gitdir`의 드라이브 문자가 실제와 같아야 git이 동작한다.

1. **적용 전 기록**: `ai_weekly_reviews` 표가 없는지, 함수 목록에 `ai-weekly-review`가 없는지 확인해 남긴다.
   ```
   npx --yes supabase@2.119.0 functions list --project-ref zzhvckikonnalqnyatgn
   ```
2. **DB 표 생성**: 원격에 schema_migrations 표가 없어 수동 적용 방식(이전 return_origin과 같음).
   ```
   npx --yes supabase@2.119.0 db query --linked --project-ref zzhvckikonnalqnyatgn -f supabase/migrations/20261006100000_ai_weekly_reviews.sql
   ```
   확인: 표 존재, RLS 켜짐, anon · authenticated 권한 없음.
3. **함수 배포** (JWT 검사 켬 — config.toml 항목 그대로):
   ```
   npx --yes supabase@2.119.0 functions deploy ai-weekly-review --project-ref zzhvckikonnalqnyatgn --use-api --workdir "D:/launchroas-apple-preview"
   ```
   배포 직후(키 · 켜기 설정 전) 미리보기에서 status 호출 → `enabled:false`, 실행 버튼은 "AI 연결 전" 안내만 나와야 한다.
4. **ai-insights 처리**: 사용자가 사용처 확인 후 결정(아래 "예전 ai-insights" 참고). 삭제할 경우:
   ```
   npx --yes supabase@2.119.0 functions delete ai-insights --project-ref zzhvckikonnalqnyatgn
   ```

## 필요한 설정 (사용자가 직접 — 키 값은 문서 · 로그 · 대화에 남기지 않는다)

Supabase 대시보드 → Edge Functions → Secrets (또는 사용자가 직접 `secrets set`):

| 시크릿 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `LAUNCHROAS_ANTHROPIC_API_KEY` | 예 | — | Claude API 키. 예전 `ai-insights`가 읽는 `ANTHROPIC_API_KEY`와 일부러 다른 이름 |
| `AI_WEEKLY_ENABLED` | 예 | (꺼짐) | `true`일 때만 AI 호출. 끄면 즉시 중단(이용 횟수 차감 없음) |
| `AI_MONTHLY_BUDGET_USD` | 권장 | 30 | 서비스 전체 월 AI 비용 상한(USD) |
| `AI_MODEL` | — | `claude-sonnet-5-5` | 분석 모델 |
| `AI_MAX_ADS` | — | 50 | 1회 분석 광고 수 상한(넘치면 누락 표시) |
| `AI_ADS_PER_BATCH` | — | 1 | AI 1회 호출에 묶는 광고 수(실측상 2개 이상이면 잘림 · 시간 초과 위험) |
| `AI_CONCURRENCY` | — | 5 | 동시에 처리하는 묶음 수 |
| `AI_MAX_IMAGES` / `AI_IMAGES_PER_AD` | — | 40 / 3 | 이미지 처리 상한 |
| `AI_MAX_OUTPUT_TOKENS` | — | 16000 | 묶음당 출력 토큰 상한(생각 토큰 포함) |
| `AI_MAX_RETRIES` | — | 2 | 주당 실패 묶음 재시도 횟수 |
| `AI_TIME_BUDGET_MS` | — | 110000 | 한 번 실행의 시간 예산(넘으면 남은 묶음은 이어서 처리) |

## 되돌리는 방법

- 즉시 중단: `AI_WEEKLY_ENABLED` 삭제 또는 `false` → AI 호출 없음.
- 함수 제거: `functions delete ai-weekly-review --project-ref zzhvckikonnalqnyatgn`
- 표 제거: `drop table if exists public.ai_weekly_reviews;` (저장된 점검 결과 · 비용 기록도 함께 삭제됨)
- 키 제거: `secrets unset LAUNCHROAS_ANTHROPIC_API_KEY`
- 화면: 미리보기 브랜치에서 `360058c` 이전 커밋(`903f4f7`)으로 되돌리면 주간 점검 카드가 빠진다.
- 기존 계산 · 사용 가이드 · OAuth 함수는 이번 작업과 무관(건드리지 않음).

## 실제 데이터 검증 순서 (원격 적용 + 키 설정 후)

1. 미리보기에서 status만 호출 → 이번 주 미사용 · 갱신 시각(다음 월요일 00시 KST) 확인.
2. 광고 수가 적은 상태에서 `AI_MAX_ADS=5`로 1회 실행.
3. 확인할 것:
   - Meta 광고 단위 조회: 지난주 · 그 전주 행 수, 중지된 광고 포함 여부, 페이지네이션.
   - 소재 조회 문법 `creative.thumbnail_width(800).thumbnail_height(800){...}` 성공 여부(실패 시 크기 지정 없이 재조회하도록 되어 있음).
   - 이미지 다운로드 성공 수(`usage.images`), 광고별 분석 범위 표시(지표 · 문구 · 이미지).
   - 광고 세트 `attribution_spec` · 시간대 표시.
   - AI 출력: 근거 경로 검증 결과, "판단 보류" 처리, 지어낸 정보 없는지, 수정 예시 품질.
4. 운영자 확인(SQL, 키 값 없이):
   ```sql
   select quota_week, status, usage, cost_usd, retry_count, jsonb_array_length(batches) batches, error
   from public.ai_weekly_reviews order by created_at desc limit 10;
   ```
   → 실제 토큰 · 비용으로 아래 추정 비용표를 고친다.
5. 이용 횟수: 같은 주 두 번째 실행이 "이미 사용"으로 막히는지, 연속 클릭 시 호출 1회인지, 실패 시 차감 안 되는지.
6. 검증용 실행 기록은 `[TEST]`로 구분하고, 정리할 때 해당 행만 삭제(사용자 승인 후).

## 비용 (Claude Sonnet 5.5 `claude-sonnet-5-5`, $2/$10 per MTok — 2026-10-06 공식 Pricing 문서 확인, 1,400원/USD)

실측(광고 1개, 호출 4회):

| 호출 | 소재 | 입력 | 출력 | 비용 |
|---|---|---|---|---|
| 1차 | 지표만(소재 조회 실패) | 2,873 | 3,607 | $0.0418 |
| 2차 | 지표 + 문구 | 3,172 | 3,914 | $0.0455 |
| 3차 | 지표 + 문구 + 썸네일 + 개선안 | 4,095 | 5,774 | $0.0659 |
| 4차 | 같음(동시 처리 구조) | 4,095 | 5,233 | $0.0605 |

출력 대부분이 생각 토큰이라 이전 추정(광고당 출력 800)보다 약 7배 비싸다. 광고 1개 ≈ $0.06(약 85원) 기준 추정:

| 광고 수 | AI 호출 | 1회 | 월 4~5회 |
|---|---|---|---|
| 5 | 5 | 약 420원 | 약 1,900원 |
| 20 | 20 | 약 1,700원 | 약 7,500원 |
| 50 | 50 | 약 4,200원 | 약 19,000원 |

- 50개면 그룹 10개 × 약 1분 → 무료 요금제 실행 시간 안에 한 번에 1그룹만 처리돼 "남은 광고 이어서 점검"을 여러 번 눌러야 한다.
- 비용 · 시간을 줄이려면 effort를 낮추는 방법(`output_config.effort: "medium"`)이 있으나 품질 비교 전이라 적용하지 않음(결정 필요).

## 남은 제한

- 실제 검증은 광고 1개(영상)뿐 — 이미지 · 캐러셀 · 동적 소재, 여러 광고 비교(peers), 묶음 동시 처리 여러 개, "이어서 점검"은 실제 데이터로 미확인.
- 영상 광고가 기존 게시물을 쓰면 `object_story_spec`이 비어 링크 도메인을 모른다(이번 광고가 그랬다).
- 테스트 판단 조건(decision_rule)이 "충분히 쌓인 뒤" 같은 정성 표현으로 나오기도 한다.
- 상세페이지 내용은 가져오지 않음 → 페이지 수정안 없음.
- 영상은 썸네일만. 영상 · 음성 전체 분석은 별도 서버(장면 추출 · 음성 인식) 필요, 영상 1개당 대략 20~40원 추정(미측정).
- 캐러셀 · 동적 소재는 카드 · 조합별 성과 없음(광고 전체 지표만).
- Cafe24 쪽 주간 합계는 브라우저가 계산해 보냄(개인정보 없이 합계만). 서버 재계산은 아님.
- 광고별 순익 · 손익분기 ROAS는 상품-광고 연결이 확인되지 않아 판단하지 않음.
- Supabase 함수 실행 시간 제한 때문에 광고가 많으면 한 번에 끝나지 않을 수 있음("남은 광고 이어서 점검").

## 예전 ai-insights — 미사용 확인, 삭제 대기(원격에 아직 있음)

- 원격 배포(v1), `verify_jwt=true`, 시크릿 `ANTHROPIC_API_KEY`(미설정)를 읽는다. 키가 들어가면 주간 제한 없이 호출 가능한 구조.
- 호출 기록(대시보드, 배포 이후 전체): 2026-10-05 22:51 KST에 OPTIONS 1 + POST 1(200)뿐. 배포 22:47 → 미리보기 화면에 호출 추가(`f018712`, 22:48) → 이 호출 → 호출 제거(`360058c`, 23:32). 그 뒤 호출 없음. 키가 없어 AI 비용 0.
- 사용처: 미리보기 화면 · master 모두 참조 없음.
- 배포 원본은 저장소 코드와 같음(내려받아 비교). 삭제 명령이 자동 권한 판단에서 거부돼 미삭제 — 사용자가 직접 실행:
  `npx --yes supabase@2.119.0 functions delete ai-insights --project-ref zzhvckikonnalqnyatgn`
- 대시보드 Invocations의 기간 선택 메뉴는 0건으로 보일 때가 있었다. 주소에 `?its=now-2d&ite=now`를 붙이면 정상 조회.
