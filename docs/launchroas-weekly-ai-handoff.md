# LaunchROAS 주간 AI 광고 점검 — 작업 인계 (2026-10-06)

## 현재 상태

**코드 구현 완료, 원격 적용 및 실제 Meta·AI 검증 전.**

- 기준 커밋: `360058c` (브랜치 `preview/launchroas-apple`). master 병합·푸시·운영 배포 안 함.
- 원격(공용 Supabase 프로젝트 `zzhvckikonnalqnyatgn`)에 이번 작업으로 바뀐 것 없음:
  DB 표 미생성 · `ai-weekly-review` 미배포 · 시크릿 미설정.
- 미리보기 화면은 함수가 없어 "주간 AI 점검은 아직 준비 중이에요(서버 미적용)"로 표시된다.
- 결과 화면은 가짜 데이터(로컬 목업)로만 확인했다. 실제 AI 출력 · 실제 비용은 아직 없다.
- 자동 테스트 71개 통과, `deno check`(ai-weekly-review) 통과.

## 관련 파일

| 파일 | 내용 |
|---|---|
| `supabase/functions/ai-weekly-review/index.ts` | 주간 점검 함수(status · run) |
| `supabase/functions/_shared/ai-weekly-core.mjs` | 기간 · 이용 횟수 판단 · 지표 · 소재 추출 · 묶음 · 프롬프트 · 출력 검증 · 비용(순수 함수) |
| `supabase/migrations/20261006100000_ai_weekly_reviews.sql` | DB 표(미적용) |
| `supabase/config.toml` | `[functions.ai-weekly-review] verify_jwt = true` |
| `launchroas/insights.js` | 화면(주간 점검 카드 · 규칙 기반 점검) |
| `tests/ai-weekly-core.test.mjs` | 핵심 로직 테스트 |

## 원격 적용 절차 (승인 후에만)

CLI: `npx --yes supabase@2.119.0`, 로그인 상태. 연결 작업 폴더는 이전과 같이 scratchpad의 `deployed` 폴더(`db query --linked --workdir ...`).

1. **적용 전 기록**: `ai_weekly_reviews` 표가 없는지, 함수 목록에 `ai-weekly-review`가 없는지 확인해 남긴다.
   ```
   npx --yes supabase@2.119.0 functions list --project-ref zzhvckikonnalqnyatgn
   ```
2. **DB 표 생성**: 원격에 schema_migrations 표가 없어 수동 적용 방식(이전 return_origin과 같음).
   ```
   npx --yes supabase@2.119.0 db query --linked --workdir "<scratchpad>/deployed" -f supabase/migrations/20261006100000_ai_weekly_reviews.sql
   ```
   확인: 표 존재, RLS 켜짐, anon · authenticated 권한 없음.
3. **함수 배포** (JWT 검사 켬 — config.toml 항목 그대로):
   ```
   npx --yes supabase@2.119.0 functions deploy ai-weekly-review --project-ref zzhvckikonnalqnyatgn --use-api --workdir "G:/launchroas-apple-preview"
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
| `AI_ADS_PER_BATCH` | — | 6 | AI 1회 호출에 묶는 광고 수 |
| `AI_MAX_IMAGES` / `AI_IMAGES_PER_AD` | — | 40 / 3 | 이미지 처리 상한 |
| `AI_MAX_OUTPUT_TOKENS` | — | 8000 | 묶음당 출력 토큰 상한 |
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

## 예상 비용 (Claude Sonnet 5.5 $2/$10 per MTok, 미측정 추정, 1,400원/USD)

| 광고 수 | AI 호출 | 1회 | 월 4~5회 |
|---|---|---|---|
| 5 | 1 | 약 95원 | 약 400원 |
| 20 | 4 | 약 380원 | 약 1,600원 |
| 50 | 9 | 약 930원(상한 시 최대 약 1,400원) | 약 4,000원 |

가정: 묶음당 지시문 약 2,500토큰, 광고당 텍스트 약 900 + 이미지 평균 1.5장(장당 약 850), 출력 광고당 약 800토큰.

## 남은 제한

- 실제 Meta 응답 · 실제 AI 출력 · 실제 비용 미확인(위 검증 순서로 확인).
- 상세페이지 내용은 가져오지 않음 → 페이지 수정안 없음.
- 영상은 썸네일만. 영상 · 음성 전체 분석은 별도 서버(장면 추출 · 음성 인식) 필요, 영상 1개당 대략 20~40원 추정(미측정).
- 캐러셀 · 동적 소재는 카드 · 조합별 성과 없음(광고 전체 지표만).
- Cafe24 쪽 주간 합계는 브라우저가 계산해 보냄(개인정보 없이 합계만). 서버 재계산은 아님.
- 광고별 순익 · 손익분기 ROAS는 상품-광고 연결이 확인되지 않아 판단하지 않음.
- Supabase 함수 실행 시간 제한 때문에 광고가 많으면 한 번에 끝나지 않을 수 있음("남은 광고 이어서 점검").

## 예전 ai-insights (삭제 여부는 사용자 결정)

- 원격에 배포된 상태, `verify_jwt=true`, 시크릿 `ANTHROPIC_API_KEY`(현재 미설정)를 읽는다. 키가 들어가면 주간 제한 없이 호출 가능한 구조.
- 사용처 확인 결과(커밋 `360058c` 기준):
  - 미리보기 화면(`launchroas/`): 호출 없음(주간 점검으로 대체됨).
  - master(운영): 참조 없음.
  - 남은 참조: 함수 코드 자체, `_shared/ai-insights-core.mjs`, `tests/ai-insights-core.test.mjs`, `config.toml` 항목.
- 원격 함수 호출 기록(대시보드 로그)은 아직 확인하지 않음 — 삭제 전 확인 권장.
