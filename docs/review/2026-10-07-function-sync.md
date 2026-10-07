# 배포 서버 함수 ↔ master 소스 동기화안 (2026-10-07)

브랜치 `sync/deployed-functions`(master `4eb3c9b` 기준 · 로컬 · 병합 · 푸시 · 함수 재배포 · SQL 변경 없음).
기준: 원격에 배포된 16개 함수를 `functions download`로 내려받은 소스(읽기만). 키 · 토큰 없음 — 함수는 시크릿을 `Deno.env.get("이름")`으로만 읽는다.

## 1. 배포 함수 목록과 master 차이
| 함수 | 배포 버전 · 시각(UTC) | master | 동기화안 |
|---|---|---|---|
| ai-insights | v7 · 10-05 13:47 | 소스 없음 | 배포본 추가 |
| ai-weekly-review | v16 · 10-07 00:01 | 소스 없음 | 배포본 추가(`_shared/ai-policy` · `ai-video-core` · `ai-weekly-core` 포함) |
| cafe24-oauth-callback | v15 · 10-04 10:20 | 다름 | 배포본 |
| cafe24-oauth-start | v13 · 10-04 10:21 | 다름 | 배포본(`_shared/return-origin.ts` 추가) |
| cafe24-order-items | v12 · 10-05 13:08 | 소스 없음 | 배포본 추가(`_shared/cafe24-order-items.mjs`) |
| cafe24-orders-sync | v18 · 10-05 06:56 | 다름 | 배포본 |
| cafe24-store-info | v15 · 10-05 06:56 | index 같음(공유 토큰 모듈만 다름) | 공유 모듈 배포본 |
| meta-adset-insights | v14 · 10-07 00:36 | 다름 | 배포본 |
| meta-oauth-callback | v12 · 10-04 10:20 | 다름 | 배포본 |
| meta-oauth-start | v11 · 10-04 10:21 | 다름 | 배포본 |
| cafe24-disconnect · contact-inquiry · meta-disconnect · meta-insights | — | 같음 | 변경 없음 |
| meta-adaccounts · meta-account-select | v11 · 09-14 | **master가 더 새로움**(배포 안 된 개선) | master 유지 — 아래 3 |
- `supabase/config.toml`: 배포된 `cafe24-order-items` · `ai-insights` · `ai-weekly-review` 항목 추가(`verify_jwt = true`, 배포 설정과 같음 · 시크릿은 이름만).

## 2. 대조 결과
동기화 브랜치 파일 ↔ 각 함수의 배포 묶음: **31개 파일 바이트 일치**, 다른 6개는 모두 아래 3 · 4의 설명대로다. `deno check` 16개 함수 통과.

## 3. 저장소에만 있는 미배포 변경 (master · 미리보기 공통 — 유지)
- `meta-adaccounts/index.ts` · `meta-account-select/index.ts` · `_shared/meta-token.ts`(이 두 함수의 배포 묶음은 09-14 버전): 광고계정 목록 페이지 상한 오류 코드(`META_ADACCOUNTS_PAGE_LIMIT`)를 응답에 포함 · 계정 확인은 찾는 즉시 멈춤(`findMetaAdAccount`). 배포본으로 덮으면 이 개선이 사라지므로 유지. 두 함수를 다시 배포할 때 반영된다(다른 Meta 함수는 이미 새 `meta-token.ts`로 배포돼 있음).

## 4. 함수별 공유 파일 버전 차이 (배포 시점 차이 — 최신 배포본으로 맞춤)
| 공유 파일 | 오래된 묶음 | 최신 묶음(동기화 기준) |
|---|---|---|
| `_shared/meta-adset-normalize.mjs` | ai-weekly-review(10-07 00:01, 명시 귀속 추가 전) | meta-adset-insights v14 |
| `_shared/cafe24-token.ts` | cafe24-oauth-callback(10-04) | orders-sync · store-info · order-items(10-05, 동시 요청 CAS — 시차 요청은 미해결이었음, 8장) |
| `_shared/meta-token.ts` | meta-adaccounts · meta-account-select(09-14) | 나머지 Meta 함수 · ai-weekly-review |
- 오래된 묶음의 함수를 다시 배포하면 최신 공유 파일을 쓰게 된다 — 새 버전은 기능을 추가만 했고 `deno check`로 import 해석 확인.

## 5. 미리보기 브랜치의 미배포 변경 (동기화하지 않음)
- `supabase/functions/ad-video-source/index.ts` — 배포된 적 없음.
- `launchroas/video-frames.js` · `video-verify.html` — 운영자 영상 도구(운영 LaunchROAS에 공개하지 않음).
- 마이그레이션 5개는 소스 동기화(`67db9ce`)에서 빼고, 별도 커밋(`e2beae6`)으로 **`supabase/migrations-applied-manually/`에 보존**(CLI 적용 대상 아님 · README에 원격 확인 상태) · 읽기 전용 확인 SQL은 `supabase/verify/`에 보존. 원격 기록 정리(`migration repair`)와 `db push` 금지는 그대로.
- 그 외 미리보기 함수 소스는 모두 배포본과 같다(= 이번 동기화 대상).

## 6. 테스트
- 미리보기에서 가져옴(함수 관련만): `ai-insights-core` · `ai-policy` · `ai-video-core` · `ai-weekly-core` · `cafe24-token-concurrency` · `return-origin`(.mjs) · `cafe24-oauth-state-claim` · `meta-adset-insights`(.js).
- (갱신) 예약 SQL 대조 테스트는 보존 파일(`migrations-applied-manually/`)을 읽어 **실행 · 통과**. 남은 건너뜀은 영상 프레임 일치 1개(아래)뿐.
- 두 테스트는 저장소에 없는 파일이 필요해 **없으면 이유를 표시하고 건너뜀**으로 바꿨다(미리보기처럼 파일이 있으면 그대로 실행 — 미리보기에서 12/12 · 18/18 통과 확인): 영상 프레임 일치(`launchroas/video-frames.js`) · 주간 실행 예약 SQL 대조(마이그레이션 `20261007100000`).
- 결과: 루트 `tests/**/*.test.js` 654/654 · `.mjs` 50 통과 · 2 건너뜀 · LaunchROAS 114/114 · 공개 전 점검 · 빌드(결과물에 supabase · tests 없음).

## 8. Cafe24 토큰 시차 요청 중복 갱신 — 버그 수정(`b1fc72d`, 동기화와 별도 커밋)
- 문제(배포본에도 있음): 첫 요청이 갱신 권한을 잡으며 `updated_at`을 바꾸고 Cafe24 응답을 기다리는 동안 온 요청이 바뀐 `updated_at`을 읽어 다시 CAS에 성공 → 같은 refresh_token으로 갱신을 두 번 요청 → 한쪽 `RECONNECT_REQUIRED`(재현: 호출 2회 · 첫 성공 · 두 번째 실패).
- 수정(스키마 변경 없음): 토큰이 만료됐는데 `updated_at`이 임대 시간(30초) 안이면 '갱신 중'으로 보고 CAS하지 않고 새 토큰을 기다림 · 임대 시간이 지나도 새 토큰이 없으면 다시 권한을 잡음 · Cafe24 갱신 요청 시간 제한 10초(임대 시간 안에 끝나게).
- 회귀 테스트: 시차 요청(Cafe24 호출 1회 · 둘 다 성공) — 수정 전 실패 확인 · 임대 시간 경과 후 재획득. 기존 동시 요청 3개 · 갱신 직후 · 거부 테스트 유지.
- 한계: 원격 `integration_credentials`에 `updated_at`을 덮어쓰는 트리거가 있어도 동작(쓰는 값이 현재 시각이므로). 함수 시계와 DB 시각이 크게 어긋나면 임대 판정이 흔들릴 수 있음(임대 30초로 여유). 더 엄격한 대안은 잠금 전용 컬럼(`refresh_claimed_until`) 추가 — 원격 스키마 변경이 필요해 이번에는 제안만.
- 반영하려면 `cafe24-orders-sync` · `cafe24-store-info` · `cafe24-order-items` 재배포 필요(콜백은 갱신 경로를 쓰지 않음) — 승인 후.

## 7. 다음 (각각 승인 후)
1. 이 브랜치 검토 → master 병합(소스만 · 배포 없음).
2. 배포본 기준으로 서버 함수 결함 수정(Meta 오류 분류 · 토큰 조회 일시 오류 · Cafe24 401 재연결 안내 등) → 함수별 재배포 승인.
3. 마이그레이션 파일 · 원격 기록 정리 방침 결정.
