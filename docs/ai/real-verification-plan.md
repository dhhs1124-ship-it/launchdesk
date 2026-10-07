# 실제 검증 준비 (2026-10-06)

이 문서는 **준비 목록**이다. 1~5장은 계획, 6장은 2026-10-06에 로컬에서 진행한 준비 결과, 7장은 실제 검증 적용 항목을 한 번에 정리한 것이다. 실제 검증 항목은 아직 하나도 실행하지 않았다(운영 배포 · 병합 · 푸시 · 원격 변경 · 함수 재배포 · 유료 호출 없음, 실행 기록 저장 스위치 꺼짐).
각 단계는 앞 단계가 끝나고 사용자가 승인한 뒤에 진행한다.

## 0. 현재 상태 (확인한 사실)

| 항목 | 상태 |
|---|---|
| 미리보기 브랜치 | `preview/launchroas-apple` — 광고 기록 확장 · 결과 비교 · 정책 연결 코드(기본 꺼짐) · 영상 준비 코드. 전체 테스트 통과 |
| 운영 메인 호환 | 로컬 브랜치 `compat/main-adlog-nan`(₩NaN 최소 수정) · `compat/main-adlog-parity`(합계 일치 + 선택 조회 실패 표시, 최소 수정 포함) — 둘 다 master 기준 · 푸시 안 함 |
| 운영 DB | `tool_records`의 `ad_log` 0건 · `ad_log_decision` 0건(2026-10-06 읽기 전용 확인) · 스키마 변경 필요 없음 |
| AI 월 사용액 | $0.3122 / 한도 $5(2026-10-06 기준, 이후 유료 호출 없음) · 운영자 검증 경로 1회 상한 $0.50(최악 비용 사전 검사) |
| 배포된 주간 점검 함수 | 정책 연결 코드가 없는 이전 버전(지시문에 고정 표본 기준이 남아 있음) |

## 1. 운영 메인 호환 변경 — 로컬 화면 확인

목적: 운영 배포 전에, 같은 공용 DB를 읽는 운영 메인 화면이 새 기록 종류와 사용자 선택을 올바르게 보이는지 로컬에서 확인한다. **DB에 쓰지 않는 확인만** 한다.

1. 작업 폴더: `git worktree add <임시 폴더> compat/main-adlog-parity`(또는 최소안이면 `compat/main-adlog-nan`).
2. 로컬 정적 서버로 그 폴더를 띄운다(예: `127.0.0.1:8773`). 운영 메인은 Supabase 로그인이 필요하므로 **사용자가 직접 로그인**한다.
3. 광고 기록은 메뉴가 숨겨져 있어 `#/dashboard`로 직접 연다.
4. 확인 항목(실제 데이터 0건이므로 빈 화면 · 합계 ₩0이 정상):
   - 빈 목록 문구 · 합계 ₩0 · 합계 상태 줄이 비어 있음 · 콘솔 오류 없음
   - 브라우저 개발자 도구에서 `launchdeskStore.isAdlogDecisionsFailed()`가 `false`(선택 조회 성공 · 0건)
5. 기록이 있는 화면(₩NaN 없음 · 합계 제외 태그 · 미결 중복 표시)은 실제 데이터가 없어 **로컬 테스트(가짜 DB)로만 확인된 상태**다. 실제 화면 확인은 2단계에서 기록을 만든 뒤에 한다.

완료 기준: 로그인 상태에서 오류 없이 열리고, 선택 조회 성공 상태가 확인됨.

## 2. 저장 · 재조회 · 사용자 선택 실패와 재시도 검증

**선행 조건**: 1단계 통과 → 운영 메인 호환 변경 master 병합 · 운영 배포(사용자 승인) → 운영 메인에서 ₩NaN 없는 것 확인. 그 전에는 공용 DB에 새 기록 종류를 쓰지 않는다.

| 순서 | 할 일 | 기대 결과 | 쓰는 곳 |
|---|---|---|---|
| 2-1 | 미리보기에서 직접 입력 기록 1건(채널 메타 · 계정 · 범위 선택) 저장 | 표에 보임 · 운영 메인 `#/dashboard`에도 같은 행 · 합계 같음 | `ad_log` 1건 |
| 2-2 | 같은 날 Meta 하루 합계 기록(원화 계정일 때만 가능 — 현재 계정은 USD라 불가) 또는 이 단계 생략 | 중복 판정 확인은 원화 계정이 있을 때만 | — |
| 2-3 | 중복 가능 기록에서 ‘합계에서 제외’ 선택 | 미리보기 합계 변경 · 새로고침 후 유지 · 운영 메인 합계도 같은 값 | `ad_log_decision` 1건 |
| 2-4 | 선택 조회 실패 재현 — 브라우저 개발자 도구의 네트워크 차단으로 `tool_records?...tool_type=eq.ad_log_decision` 요청만 막고 새로고침 | 두 화면 모두 합계 ‘(미확정)’ · 안내 문구 · ‘다시 불러오기’ | 없음 |
| 2-5 | 차단 해제 후 ‘다시 불러오기’ | 선택 반영 합계로 돌아오고 ‘미확정’ 사라짐 | 없음 |
| 2-6 | 검증용 기록 삭제(사용자 확인 후) | 표에서 사라짐 · 합계 원래대로 | `ad_log` · `ad_log_decision` 삭제 |

완료 기준: 두 화면 합계가 매 단계 같고, 실패 · 재시도 표시가 기대대로 바뀜. 결과는 캡처와 함께 ‘실제 데이터 검증’으로 기록한다.

## 3. 실제 광고 실행 기록 1건 — 비교 계획

**선행 조건**: 2단계 통과 → 미리보기 `launchroas/index.html`에 `window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true }` 추가 · 미리보기 배포(승인).

| 항목 | 계획 |
|---|---|
| 대상 | 지금 집행 중인 광고 1개(현재 주간 점검에서 분석된 광고는 ‘9월 전환광고’ 1개) — 사용자가 고른다 |
| 바꿀 요소 | 한 가지만(예: 본문 첫 줄). 실제로 바꾼 내용을 그대로 입력 |
| 방식 | **기존 광고 수정(전후 비교)** 을 권장 — 같은 광고의 같은 길이 전후를 비교한다. 방식은 기본값 없이 직접 고른다. 새 광고 추가는 새 광고 변경 후 ↔ 기존 광고 변경 전 비교라 **관찰값만** 기록하고 신호 · 지출 집계에서 뺀다(9장) |
| 시작일 · 비교 기간 | 수정한 날을 시작일로, 7일씩. 변경 전 7일은 저장할 때 자동 조회(하루라도 조회 실패 · 페이지 누락이면 저장 거절) |
| 결과 확인일 | 변경 후 기간 마지막 날 + 8일부터(귀속 창 7일 클릭 · 노출일 보고 — 그 전은 잠정). 날짜는 **광고계정 시간대** 기준(모르면 한국 날짜 − 1일). 안내 · 판정 모두 `finalFrom(마지막 날, 창)` 한 함수(11장). 결과 비교 때 변경 전 · 후를 함께 다시 조회한다 |
| 함께 바뀐 조건 | 같은 기간 예산 · 할인 · 상품 · 타깃 변경을 체크(있으면 신호를 확정하지 않음) |
| Meta 조회 | 저장 시 약 8~10회(광고 세트 찾기 + 하루 단위 7회), 결과 비교 시 14회(변경 전 · 후 재조회) — `meta-adset-insights` 재배포 후(명시 귀속) · 무료 |
| 해석 | 결과는 ‘관찰’(구매 · 광고비 · 구매당 광고비 변화)과 ‘신호’(구매당 광고비 개선 · 악화 신호 / 판단 보류 / 판단 불가)로 나온다. 1건 · 7일 비교는 대부분 ‘판단 보류’가 예상되며, 이것은 기능 검증이지 효과 검증이 아니다 |
| 결과 저장 | ‘결과 저장’으로 결과 기록 1건 추가 · 기존 실행 기록은 수정되지 않음을 확인 |

완료 기준: 실행 기록 → 결과 비교 → 결과 기록이 실제 데이터로 저장 · 재조회되고, 두 화면 합계에 영향이 없음.

## 4. 새 정책 AI 검증 · 영상 1개 검증 — 적용 항목 · 호출 수 · 예산

### 4-1. 새 정책(분석 기준 `policy-2026-10-06.3`) 검증

| 적용 항목 | 내용 |
|---|---|
| 함수 재배포 | `ai-weekly-review`(정책 연결 코드 포함, 시크릿 없으면 기존 지시문 그대로) |
| 비교 1회차 | 시크릿 설정 전 운영자 검증 경로(`action: verify`, 광고 1개 · effort medium) — 이전 지시문 |
| 시크릿 | `AI_POLICY_VERSION=policy-2026-10-06.3` 설정(설정 값은 사용자가 직접 입력) |
| 비교 2회차 | 같은 광고 · 같은 effort로 운영자 검증 — 새 지시문 + 사례 선택 |
| 되돌리기 | 비교가 끝나면 시크릿을 지우거나 유지 여부를 결정(이 시크릿은 주간 점검 전체에 적용된다) |
| 확인할 것 | 고정 표본 기준이 사라졌는지, ‘유지’가 목표 · 손익 근거 없이 나오지 않는지, `hold_scope` · `case_ids` · `policy_version` 기록, 영상 · 제목 미확인 규칙을 확정적으로 쓰지 않는지 |

- 호출 수: **2회**(광고 1개 × 이전/새 지시문 1회씩). 실측 기준 medium 1회 $0.034 + 정책 · 사례로 입력 약 +1,400토큰(추정 +$0.003) → **약 $0.07~0.08**.
- 주의: 시크릿 변경이 재배포 없이 바로 반영되는지는 확인이 필요하다(미확인). 반영되지 않으면 시크릿 설정 후 재배포 1회 추가(호출 비용 없음).

### 4-2. 사용자 광고 영상 1개 검증

| 적용 항목 | 상태 · 내용 |
|---|---|
| `ad-video-source` 배포 | 준비됨(미배포). 영상 광고 1개로 호출해 `source_available` 확인 — AI 호출 없음 · 무료 |
| 프레임 추출 | 준비됨(`launchroas/video-frames.js`, 화면 미연결). 화면에 보이는 탭에서 재생 주소 또는 업로드 파일로 0~3초 0.5초 간격 + 이후 간격 확대 최대 24장 |
| 드라이런 | 준비됨(`scripts/video-review-dryrun.mjs`) — 요청 크기 · 토큰 · 비용을 호출 없이 확인 |
| 운영자용 영상 분석 호출 경로 | **구현됨(미배포)** — `ai-weekly-review` `action: "verify_video"`(6장) |
| 음성 | 사용자 전사 입력이 없으면 ‘음성 미확인’으로 둔다(유료 전사 도구는 쓰지 않음) |

- [정정 8-1] 지금 분석된 광고 1개(‘9월 전환광고’)의 소재 형식은 저장 결과에 `video`로 기록됨. 영상 ID는 미조회 — 원본을 못 받으면 직접 제공 방식(8-3)으로 검증.
- 호출 수: **1회**(+ 출력 검증 실패 시 재시도 최대 1회). 추정 1회 $0.03~0.06(프레임 24장 × 약 620토큰 + 지시문 · 출력) → **상한 $0.15로 잡음**.

### 4-3. 예산 합계

| 항목 | 호출 수 | 예상 비용(추정) |
|---|---|---|
| 정책 비교 | 2 | $0.07~0.08 |
| 영상 1개 | 1~2 | $0.03~0.12 |
| 합계 | 3~4 | **약 $0.10~0.20** — 월 한도 $5 중 현재 $0.31 사용, 검증 후 약 $0.5 이하 |

## 5. 진행 순서 요약

1. 운영 메인 호환 로컬 화면 확인(1단계) → 2. 운영 메인 호환 배포(승인) → 3. 저장 · 재조회 · 실패 · 재시도 실제 검증(2단계) → 4. 저장 스위치 켜고 미리보기 배포(승인) → 5. 실제 광고 실행 기록 1건(3단계, 결과는 약 2주 뒤) → 6. 정책 비교 AI 검증(4-1, 승인) → 7. 영상 분석 호출 경로 구현 · 1개 검증(4-2, 승인).

## 6. 2026-10-06 준비 진행 결과 (로컬 · 유료 호출 없음 · 공용 DB 쓰기 없음)

| 항목 | 결과 | 근거 |
|---|---|---|
| 1-a 미리보기 실제 로그인 화면(읽기 전용) | 로그인 상태 · 광고 기록 0건 · 합계 ₩0 · 선택 조회 정상(미확정 표시 없음) · 저장 꺼짐 안내 · 쓰기 시도 0건 | `docs/review/2026-10-06-verify-prep/01-REAL-readonly-preview-adlog.jpg` |
| 1-b 운영 메인(`compat/main-adlog-parity`) 실제 로그인 화면(읽기 전용) | 같은 출처에서 로그인 세션 공유 · `#/dashboard` 광고 기록 0건 · 합계 ₩0 · 선택 0건 · 조회 실패 아님 · 쓰기 시도 0건 · USD 계정 자동 기록 안내 표시 | `02-REAL-readonly-main-adlog-top.jpg` · `03-REAL-readonly-main-adlog-total.jpg` |
| 읽기 전용 보장 | 로컬 서버(`scripts/local-readonly-server.js`)가 두 화면에 쓰기 차단 스크립트를 넣어 DB insert · upsert · update · delete · rpc와 쓰기 함수(주문 동기화 등) 호출을 막고 기록 — 확인 중 차단된 시도 0건(앱이 쓰기를 시도하지 않음). 운영 메인의 게스트 데이터 이전 조건(`ld-*` 키) 없음 확인 · 분석 동의 배너는 누르지 않음 | 서버 코드 |
| 2 저장 → 재조회 → 선택 조회 실패 → 재시도(두 화면 연결 · 로컬 모의 DB) | **8개 항목 모두 통과**: 저장 후 두 화면 합계 일치(₩22,000) · 미결 중복 · 외화 제외 표시 · 선택 저장 후 ₩12,000 일치 · 새로 띄운 뒤 유지 · 선택 조회 실패 시 두 화면 ‘₩22,000 (미확정)’ · 다시 불러오기 표시 · 재시도 후 ₩12,000 · 변경 기록이 운영 메인에 ₩NaN 없이 합계 제외 | `scripts/verify-adlog-cross-screen.js` · `cross-screen-mock.txt` |
| 3 영상 운영자 검증 경로 | `ai-weekly-review`에 `action: "verify_video"` 추가(미배포): 기존 로그인 · `AI_VERIFY_USER_IDS` · 월 예산(`monthSpent`) · 1회 상한($0.50) 재사용, 결과는 `ai_weekly_verifications`(label `video`). `dry_run: true`면 AI를 부르지 않고 저장하지 않음. 음성 전사가 없으면 요청에 ‘음성 미확인’을 넣고 출력 검증이 강제 | 코드 · `tests/ai-video-core.test.mjs` |
| 3 드라이런 | 프레임 추출: 실제 추출 모듈로 MP4 1개(경쟁사 영상 21.7초 — 사용자 광고 영상 원본을 확보하지 않아 처리 경로 확인용으로 사용(사용자 광고 분석 검증 아님), 파일은 로컬 임시 폴더에만)에서 17장. 숨김 탭이라 `<video>`가 열리지 않아 **WebCodecs 대체 경로**로 추출됨. 요청 구성: 595KB · 입력 약 8,236토큰 · 추정 $0.0415 · 사전 검사 최악 $0.0984. 출력 검증: 모의 정상 응답 통과 · 모의 위반 응답(본 프레임 밖 시간대 · 전사 없이 음성 언급 · 음성 미확인 누락) 3건 모두 거름 | `video-extract.json` · `video-dryrun.json` |

## 7. 실제 검증에 필요한 적용 항목 (한 번에 정리)

### 7-1. 적용 항목

| 구분 | 항목 | 내용 | 비용 |
|---|---|---|---|
| 운영 메인 호환 배포 | `compat/main-adlog-parity`(권장 — 합계 일치 · 선택 조회 실패 표시 포함) 또는 `compat/main-adlog-nan`(₩NaN만) | master 병합 · 푸시 · Vercel 운영 배포. 배포 후 운영 메인 `#/dashboard`에서 ₩NaN 없음 · 선택 조회 상태 확인 | 없음 |
| 미리보기 저장 스위치 | `launchroas/index.html`에 `window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true }` | 운영 메인 호환 배포 **뒤에만** 켠다 · 미리보기 배포 경로(브랜치 배포 방식)는 확인 필요 | 없음 |
| 함수 재배포 | `ai-weekly-review` 1회 | 정책 연결 코드(시크릿 없으면 기존 지시문) + `verify_video` 경로 포함 | 없음 |
| 함수 배포(선택) | `ad-video-source` | 사용자 영상 광고의 원본 주소 확인용 — 영상 광고가 생겼을 때만 | 없음 |
| 시크릿 | `AI_POLICY_VERSION=policy-2026-10-06.3` | 정책 비교 2회차 직전에 설정(주간 점검 전체에 적용되므로 비교 후 유지 여부 결정). 기존 `LAUNCHROAS_ANTHROPIC_API_KEY` · `AI_VERIFY_USER_IDS` · `AI_MONTHLY_BUDGET_USD`는 이미 설정됨. 시크릿 변경이 재배포 없이 반영되는지는 확인 필요 | 없음 |
| DB | 스키마 변경 없음 | 검증 중 기존 표에 기록 추가만: `tool_records`(ad_log · ad_log_decision), `ai_weekly_verifications`(AI 검증 결과) | 없음 |

### 7-2. AI 호출 수와 합산 예산

| 검증 | 호출 수 | 예상 비용(추정 · 측정 전) |
|---|---|---|
| 새 정책 비교(같은 광고 · medium · 이전 지시문 1회 + 새 지시문 1회) | 2 | 약 $0.07~0.08(실측 $0.034/회 + 정책 · 사례 입력 증가분) |
| 영상 1개(`verify_video`, 프레임 17~24장) | 1(+출력 검증 실패 시 재시도 1) | 약 $0.04(드라이런 추정) · 사전 검사 최악 $0.10/회 |
| **합계** | **3~4** | **약 $0.11~0.28**(최악 기준) — 월 한도 $5 중 현재 $0.3122 사용 |

Meta 조회(무료, 기존 함수): 실행 기록 저장 약 8~10회 · 결과 비교 7회 · 영상 원본 확인 2~4회.

### 7-3. 실제 광고 실행 기록 — 제안(자동 진행 안 함 · 사용자 확인 필요)

| 항목 | 제안 |
|---|---|
| 대상 광고 | ‘9월 전환광고’ — 현재 주간 점검에서 분석된 유일한 광고(지난주 구매 2→7건 · ROAS 432% · 판정 ‘유지’, 개선안은 제목 노출 미확인으로 보류) |
| 바꿀 요소 | **본문 첫 줄(문구) 1가지** — 2026-10-06 운영자 검증(effort 비교)에서 두 결과 모두 ‘본문 첫 줄을 제품 특징으로’를 선택적 테스트로 제안. 새 문구는 사용자가 확인한 상품 사실로만 작성(가격 · 할인 · 소재 수치는 확인된 것만) |
| 방식 | 기존 광고 수정(같은 광고의 전후 7일 비교). 새 광고 추가는 현재 화면이 동시 집행 비교를 하지 않아 이번 검증에는 권하지 않음 |
| 일정 | 시작일 = 실제 수정한 날 · 변경 후 7일 + 귀속 지연 4일 → 결과 비교는 시작일 + 11일 이후. **그 전에는 결과를 만들지 않는다**(화면도 비교 기간이 끝나기 전에는 결과 비교 버튼이 꺼짐) |
| 함께 바뀐 조건 | 같은 기간 예산 · 할인 · 상품 · 타깃 변경 여부를 사용자가 체크 |
| 기대 | 1건 · 7일은 대부분 ‘판단 보류’ — 기능 검증이며 효과 검증이 아님 |

### 7-4. 진행 순서

1. 운영 메인 호환 배포(승인) → 2. 운영 메인에서 실제 저장 · 재조회 · 선택 실패(네트워크 차단) · 재시도 확인(2단계 표) → 3. 저장 스위치 켜고 미리보기 배포(승인) → 4. 사용자가 광고 · 문구를 확정하고 실제 수정 → 실행 기록 저장 → 5. 시작일 + 11일 뒤 결과 비교 · 저장 → 6. 함수 재배포 · 정책 비교 2회(승인) → 7. 영상 1개 검증(영상 확보 · 승인).

## 8. 2026-10-06 후속 — 영상 여부 정정 · 광고 수정 없는 AI 검증 · 직접 제공 영상 · 리뷰 안내

### 8-1. ‘영상 광고 없음’ 보고 정정

| 항목 | 확인 결과 |
|---|---|
| 조회 계정 | 매장 4 · Meta `act_4384942328316978`(connected) |
| 기간 | 주간 점검 1회차(이용 주 2026-10-05): 분석 주 2026-09-28~10-04 · 그 전주 2026-09-21~09-27 |
| 활성 상태 필터 | 없음 — 광고 단위 성과(`level=ad`)에서 해당 기간에 노출된 광고만 대상. 그 기간에 노출되지 않은 영상 광고는 처음부터 조회 대상이 아님 |
| ‘9월 전환광고’ 소재 형식 | 저장된 결과에 `video`로 기록됨(소재에 영상 ID가 있거나 형식이 VIDEO일 때만 이렇게 기록). 썸네일만 분석 |
| 해당 광고 video_id | **미조회** — 주간 점검이 형식만 남기고 영상 ID는 저장하지 않았고(이번에 저장하도록 수정 · 미배포), 이후 Meta에 별도로 조회하지 않음. 조회 실패도 아니고, 영상 부재 확인도 아님 |
| 이전 보고가 틀린 이유 | 이 문서 4장의 ‘이미지 기반으로 기록됨’이 저장 결과와 다른 잘못된 기록이었고, 6장 드라이런 설명이 이를 근거로 ‘영상 광고가 없어’라고 적음. 실제 조회 없이 쓴 문장 — 정정함 |
| 다음 확인(무료 · 읽기만) | `ai-weekly-review` 재배포 뒤 다음 점검 결과에 `video_id`가 남거나, `ad-video-source` 배포 뒤 해당 광고의 원본 주소 확인. 원본을 못 받으면 8-3의 직접 제공 방식 |

### 8-2. 광고를 수정하지 않는 AI 검증 — 정책 비교

- 운영자 검증(`action: "verify"`)에 `compare_policy: true` 추가(미배포). **한 번의 요청**에서 스냅샷(기간 · 지표 · 소재 · 이미지)을 한 번만 만들고, 같은 입력에 이전 지시문과 새 지시문(정책 · 사례 포함)을 각각 1회 돌림.
- 같은 입력이었는지는 두 결과의 `input_fingerprint`(기간 · 지표 · 소재 문구 · 영상 ID · 노출 위치의 SHA-256)가 같은지로 확인. 이미지는 한 번 받은 것을 두 호출이 공유.
- 기간 고정: `weeks: { current, previous }`(7일씩 · 연속 · 끝난 주만). 나중에 다시 돌려도 같은 주를 쓸 수 있음. 단, Meta 귀속 지표가 늦게 바뀌면 지문이 달라지므로 비교는 한 요청 안의 두 결과끼리만 한다.
- 주간 이용 횟수: 운영자 검증은 `ai_weekly_reviews`(주 1회 이용)를 건드리지 않고 `ai_weekly_verifications`에만 저장 — 사용자의 이번 주 점검 횟수는 그대로.
- 시크릿 `AI_POLICY_VERSION`과 무관하게 동작 → **정책 비교만 할 거라면 시크릿 설정은 필요 없음**(7-1의 시크릿 항목은 사용자 주간 점검에 새 정책을 켤 때만).
- 통제: 허용 사용자 · 1회 상한(최악 비용 = 호출 수 × 입력 2만 토큰 + 출력 상한) · 월 한도를 호출 전에 검사.
- 요청 예: `{ action: "verify", store_id: 4, compare_policy: true, effort: "medium", weeks: { current: { since: "2026-09-28", until: "2026-10-04" }, previous: { since: "2026-09-21", until: "2026-09-27" } }, label: "policy-compare" }` → 호출 2회 · 저장 2행(`policy-compare:policy_off`, `policy-compare:policy_on`).

### 8-3. 직접 제공한 영상으로 검증

- `launchroas/video-verify.html`(운영자 전용 · 메뉴에 연결하지 않음 · `noindex`): 파일 선택 → 브라우저에서 프레임 추출(파일은 서버로 보내지 않음) → 프레임 미리보기 → **드라이런**(`verify_video` + `dry_run: true`, AI 호출 · 저장 없음) → 동의 체크 후 **실제 분석 1회**.
- 음성 전사 칸은 비워 두면 결과에 ‘음성 미확인’이 강제됨.
- 같은 로그인 세션 사용(같은 주소의 LaunchROAS에서 로그인). 로컬에서 화면이 열리고 로그인 · 매장 ID를 읽는 것까지 확인. 함수가 배포되지 않아 서버 호출은 아직 할 수 없음.
- 6장의 경쟁사 영상 드라이런은 **처리 경로 검증**(추출 · 요청 구성 · 출력 검사)일 뿐이며, 사용자 광고 영상 분석 검증이 아님.

### 8-4. 리뷰 안내 (현재 커밋 기준)

기준: 미리보기 브랜치 `preview/launchroas-apple`(master 대비) + 운영 메인 호환 브랜치 `compat/main-adlog-parity`(0a3c764). 작업 트리의 `supabase/migrations/20260921230000_ad_margin_links.sql` 수정은 이 작업과 무관 — 리뷰 · 커밋 대상 아님.

| 검토 영역 | 파일 | 볼 점 |
|---|---|---|
| 새 정책 연결 | `supabase/functions/_shared/ai-policy.mjs` · `ai-weekly-core.mjs`(`batchContent` · `parseBatch` · `pinnedWeeks`) · `ai-weekly-review/index.ts`(`SYSTEM` · `POLICY` · `verify`) · `tests/ai-policy.test.mjs` | 시크릿 없으면 기존 지시문 그대로 · 사례는 새 지시문에만 · 비교 시 두 변형 입력 동일(지문) · 고정 기간 검사 |
| verify_video 권한 · 예산 | `ai-weekly-review/index.ts`(`verifyVideo` · `monthSpent` · `VERIFY_CAP_USD` · 요청 처리부의 로그인 · action 목록) | 로그인(withSupabase) → 허용 목록 → 입력 검사 → dry_run은 키 · 예산 확인 전에 끝나고 저장 없음 → 키 → 1회 상한 → 월 한도 → 호출 · 저장 순서 |
| 영상 입력 · 출력 검증 | `_shared/ai-video-core.mjs`(`prepareVideoVerify` · `finishVideoVerify` · `validateVideoOutput`) · `launchroas/video-frames.js` · `launchroas/video-verify.html` · `scripts/video-review-dryrun.mjs` · `tests/ai-video-core.test.mjs` | 광고 ID · 프레임 수 · 형식 · 크기 · 시각 순서 · 전사 길이 제한 · 본 프레임 밖 시간대 · 전사 없는 음성 언급 거절 · 브라우저와 서버의 프레임 계획 일치 |
| 광고 기록 계산 | `launchroas/adlog-core.js` · `adlog-change-core.js` · `adlog.js` · `adlog-meta.js` · `launchroas/adlog-core.test.js` · `adlog-ui.test.js` | 확정 중복(계정 · 날짜 · 범위 · 금액) · 외화 환율 · 사용자 선택 우선 · 관찰과 판단 분리 · 최신 결과 기준 요약 · 기간 중복 제거 |
| 운영 메인 호환 | `compat/main-adlog-parity`: `adlog-core.js` · `store.js` · `tools.js` · `index.html` · `tests/open-beta-simplification.test.js` | 변경 기록이 합계에 안 섞임 · 선택 조회 실패 시 ‘미확정’ · 다시 불러오기 · ₩NaN 없음 |
| 검증 보조(배포 안 함) | `scripts/local-readonly-server.js` · `scripts/verify-adlog-cross-screen.js` | 쓰기 차단 범위 · 두 화면을 같은 모의 DB로 묶는 방식 |

실행할 검증 명령(유료 호출 · 원격 변경 없음):

```sh
# 미리보기 브랜치 전체 테스트
node --test tests/*.test.js tests/*.test.mjs launchroas/*.test.js
# 함수 형식 검사(배포 아님)
npx --yes deno check supabase/functions/meta-adset-insights/index.ts supabase/functions/ai-weekly-review/index.ts supabase/functions/ad-video-source/index.ts
# 영상 처리 드라이런(프레임 폴더 필요 — video-verify.html 또는 video-frames.js로 뽑은 0.0.jpg … 형식)
node scripts/video-review-dryrun.mjs <frames-dir> --ad=<광고ID>
# 두 화면 연결 모의 검증(운영 메인 호환 브랜치를 임시 작업 트리로)
git worktree add ../main-parity-wt compat/main-adlog-parity
node scripts/verify-adlog-cross-screen.js ../main-parity-wt
git worktree remove ../main-parity-wt
# 운영 메인 호환 브랜치 자체 테스트(작업 트리를 지우기 전에)
#   cd ../main-parity-wt && node --test tests/*.test.js
```

## 9. 2026-10-07 수정 결과 — 광고 기록 비교 기준(v3) · 운영 메인 조회 실패 표시 (로컬 · 원격 변경 없음)

### 9-1. 수정한 것

| # | 문제 | 수정 | 위치 |
|---|---|---|---|
| 1 | 변경 전 지표가 저장 시점에 고정 → 늦게 귀속된 구매가 빠져 개선 쪽 편향 | 결과 비교 때 변경 전 · 후를 같은 명시 귀속으로 함께 다시 조회해 비교. 저장 당시 값만 있으면 관찰만 · 신호 없음(`baseline_not_refetched`). 저장 당시 값은 `saved_baseline` 이력, 재조회 값은 결과 기록 `before` | `adlog-change-core.js compare` · `adlog.js runCompare` |
| 6 | 새 광고 비교가 신호를 냄 · 방식 기본값 new_ad | 새 광고 ↔ 기존 광고 비교는 관찰값만(`different_ads`) · 신호 · 지출 집계 제외(`observed_only_new_ad`). 방식 기본값 없음(‘선택해 주세요’) · 미선택이면 저장 거절 | `compare` · `outcomeSummary` · `buildChangeRecord` · `index.html chgMethod` |
| 7 | 귀속 기준 고정 문자열 · 잠정 3일 | 요청한 귀속 설정과 실제 적용 근거를 구분(10장에서 정정 — 요청값을 돌려준 것만으로는 확인으로 보지 않음). 근거가 없으면 보류(`attribution_unverified`). 잠정 기간 = 귀속 창(보고 시점 미확인 → 노출일 가정 · 변경 후 마지막 날 + 8일부터 확정) | `attributionWindowDays` · `dailyAds` · `meta-adset-insights` |
| 8 | 변경 전 조회 실패해도 저장 · 응답에 없는 광고 0 처리 | 하루 상태 구분: ok · absent(정상 조회 · 광고 없음 = 0) · failed · truncated(페이지 누락이고 광고 없음). 실패 · 누락이 있으면 저장 거절 · 비교 안 함(`fetch_failed`) | `aggregate` · `dailyAds` · `buildChangeRecord` |
| — | 재조회 기간이 기록된 기간과 다를 때 | 비교하지 않음(`condition_mismatch`) | `compare` |
| — | 결과 카드 통화 표시 오류(`var cur` 재선언으로 ‘광고비 null 70000.00’) | 변수 분리 | `adlog.js changeCard` |
| 낮음 | 기록 조회 실패가 ‘기록 없음 · ₩0’으로 보임(두 화면) | 합계 ‘—’ · ‘불러오지 못했어요’ · 다시 불러오기. 미리보기 `recordsFailed`, 운영 메인 `isAdlogFailed` · `reloadAdlogRecords` | `adlog.js` · `compat/main-adlog-parity` `store.js` · `tools.js`(d4d56c7) |

판정 버전: `adlog-compare-v3` — v2 이하로 저장된 결과는 ‘이전 판정 기준’으로 따로 세고 신호에 넣지 않는다.

### 9-2. 로컬 검증 결과

- 미리보기 전체 테스트 776개 통과(새 회귀 테스트: 재조회 기준 · 새 광고 관찰값만 · 귀속 확인 불가 보류 · 귀속 창 잠정 경계 · 실패/누락/부재 구분 · 불완전 기준 거절 · 방식 기본값 없음 · 기록 조회 실패 · 명시 귀속 옵션)
- 운영 메인 호환 브랜치 전체 테스트 639개 통과
- 두 화면 모의 검증 10/10(기록 조회 실패 · 다시 불러오기 2개 추가) · 공용 DB 쓰기 0
- `deno check` 통과: `meta-adset-insights` · `ai-weekly-review`(기존 `meta-adset-insights` 형식 오류 2건도 정리). `ad-video-source`는 수정 전부터 형식 오류 3건(`connected_accounts` 조회 결과 타입이 `never`) — 10장에서 수정

### 9-3. 원격 적용 항목(추가 · 승인 후)

- `meta-adset-insights` 재배포 — `attribution_mode:'explicit'` 요청에만 `action_attribution_windows=["7d_click","1d_view"]` · `action_report_time=impression`을 넣고 응답에 `attribution`을 돌려준다. 다른 화면 요청은 URL · 응답 그대로.
  재배포 전에는 응답에 `attribution`이 없어 결과 비교가 모두 ‘귀속 기준 확인 불가 · 판단 보류’로 나온다(안전한 쪽).
- 재배포 후 무료 조회 1회로 확인: 명시 귀속 시 `actions[].value`가 지정 창 합계인지(창별 키 `7d_click` · `1d_view`가 함께 오는지), 구매 수가 기본 귀속 조회와 크게 다르지 않은지.
- 운영 메인 호환 배포(`compat/main-adlog-parity` d4d56c7) → 그 뒤 미리보기 저장 스위치. 저장 스위치는 지금도 꺼져 있다.

### 9-4. 남은 제한

- 전후 비교는 인과를 증명하지 않는다(계절 · 행사 · 노출 배분). 같은 기간 두 광고 비교(새 광고 추가)는 이 화면에서 판정하지 않는다.
- 귀속 창 동안 잠정 처리는 노출일 보고 기준의 가정 — Meta의 사후 데이터 정정(최대 28일)은 반영하지 못한다.
- 결과 비교 1회에 Meta 조회 14회(하루 단위) — 비교 기간 28일이면 56회.

## 10. 운영 배포 전 최종 확인 (로컬 · 원격 변경 없음)

### 10-1. `ad-video-source` 형식 오류 3건

- 오류: `connected_accounts` 조회 결과가 `never`로 추론돼 `account.status` · `account.id` · `account.external_account_id` 접근이 TS2339. 스키마 타입이 없는 Supabase 클라이언트의 `select` 결과 추론 문제.
- 수정: `meta-adset-insights`와 같은 방식으로 행 타입을 명시(`.returns<{ id; status; external_account_id }[]>()`). 동작 변경 없음.
- 이전 ‘통과’ 근거: **이전 환경 확인 불가.** 저장소 기록에서 `ad-video-source` 검사 통과를 적은 곳을 찾지 못했다. 인계 문서는 `ai-weekly-review`만 통과로 적었고, 8-4의 명령 목록은 실행할 명령만 있고 결과가 없다.
  `ad-video-source`는 처음 추가(cfed98e) 이후 바뀌지 않았다. 저장소에 `deno.json` · `deno.lock`이 없어 `npx deno`가 그때그때 최신 Deno와 `jsr:@supabase/server@^1` 최신 1.x를 받으므로 회사 PC의 당시 버전은 알 수 없다. 이번 검사: deno 2.9.6 · TypeScript 6.0.3.
- 현재 결과: `deno check` 통과 — `ad-video-source` · `meta-adset-insights` · `ai-weekly-review` · `ai-insights`.

### 10-2. 귀속 기준 — 요청한 설정과 실제 적용 구분

- 서버(`meta-adset-insights`, `attribution_mode:'explicit'`일 때만): 응답 `attribution`에 요청값(`requested`)과 응답 근거(`windows_seen`)를 나눠 넣는다. 광고 행마다 `attribution_windows_seen` = Meta 응답의 `actions` · `action_values` 항목에 요청한 창별 값(`7d_click` · `1d_view`)이 실제로 있던 창. 보고 시점(`action_report_time`)은 응답에 드러나지 않아 `action_report_time_applied: 'unconfirmed'`.
- 화면(`adlog.js`): 요청값이 모든 날 같고, 대상 광고 행에서 요청 창이 모두 보였을 때만 `applied.windows = 'response_evidence'`. 결과 비교는 변경 전 · 후 두 기간 모두 근거가 있어야 한다. 그 외는 `unconfirmed` → 판단 보류(`attribution_unverified`).
  요청값만 돌아오고 창별 값이 없거나(재배포 전 · 응답 형식 다름 · 그 기간 행동 없음) 예전 기록의 문자열이면 모두 미확인.
- 잠정 기간: 보고 시점은 확인 근거가 없으므로 요청값과 관계없이 노출일 기준으로 가정해 귀속 창 전체(7일)를 잠정으로 둔다. 이전에는 요청값이 전환일이면 0일로 봤는데, 근거 없는 요청값을 쓴 것이라 바꿨다(테스트 기대값도 이 기준 변경에 맞춰 수정).
- 주간 분석과의 차이: 주간 분석(`ai-weekly-review`)은 `use_unified_attribution_setting=true`(광고 세트 귀속 설정 기준), 결과 비교는 창을 지정해 요청한다. 요청 방식이 달라 같은 기준이라고 확인되지 않는다.
  변경 기록(`basis.attribution_vs_weekly`) · 결과 기록(`result.attribution_vs_weekly`)에 남기고, 결과 주의 문구와 카드 ‘주간 분석과 기준’ 줄에 표시한다.
- 재배포 후 무료 조회 1회로 확인할 것: 명시 귀속 응답의 `actions` 항목에 `7d_click` · `1d_view` 키가 실제로 오는지. 오지 않으면 결과 비교는 계속 ‘미확인 · 판단 보류’(안전한 쪽)이고, 응답 형식에 맞춰 근거 판별을 고쳐야 한다.

### 10-3. 비용 예약 SQL · 호출 코드 검토

| 상황 | 처리(수정 후) | 결과 |
|---|---|---|
| 동시 요청(운영자 검증) | `ai_budget_reserve`가 트랜잭션 advisory lock 안에서 합계 → 한도 → 예약 삽입. 다음 요청은 앞 예약이 커밋된 뒤 합계를 다시 계산 | 함께 통과 안 함(SQL 검사) |
| 호출 후 시간 초과 · 응답 실패 | 사용량이 없으면 `known=false` → `unsettled` · 예약 금액 유지. 함수가 강제 종료돼 정산을 못 하면 `reserved` 그대로 예약 금액으로 집계 | 0으로 풀리지 않음 |
| 검증 결과 저장 실패 | 정산은 저장 전에 끝나고 비용은 예약에 남음. 예약에 연결된 검증 기록 비용은 합계에서 빼므로 중복 없음 | 비용 유지 |
| 사용량 미확인 | 예약 금액 유지 → 운영자가 Anthropic 사용량 확인 후 `ai_budget_settle(id, 실제, true, '수동 정산')` | 수동 정산 |
| **[결함 · 수정] 예약 금액이 최악 비용보다 작음** | 운영자 검증은 호출당 입력 20,000토큰 고정 가정, 영상은 프레임 1,600토큰 · 글자 수 ÷ 2 · 지표 · 문구 미포함이었다. 시간 초과 시 이 예약 금액만 남으므로 실제 비용이 한도를 넘을 수 있었다. → 실제로 보낼 지시문 · 내용으로 상한 계산(`inputTokensUpperBound`: 텍스트 ≤ UTF-8 바이트, 이미지 장당 4,800토큰 = 고해상도 모델 최대 약 4,784 이상, 출력 = max_tokens). 검증은 이미지를 받은 뒤 예약 | 예약 ≥ 실제 최대 비용 |
| **[결함 · 수정] 금액 내림** | SQL `round(p_amount, 4)` → 올림(`ceil`), 한도 검사도 같은 값. 화면 코드의 최악 비용도 올림 | 0.00001 예약이 0이 되어 실패하던 경우 포함 |
| **[결함 · 수정] 주간 실행 사용량 미확인 = 0** | 주간 실행(예약 없음)은 시간 초과 호출 비용을 0으로 더했다 → 그 호출의 최악 비용으로 기록(`usage.unconfirmed_calls`). 중간 예외로 끝나도 그때까지의 비용을 저장 | 월 합계에서 빠지지 않음 |

검증: SQL 로컬 검사 15/15(PGlite · 올림 검사 추가) · 회귀 테스트(상한 · 올림 · 예약 순서 · 주간 실행 미확인 비용).

### 10-4. 남은 제한

- 주간 실행(run)은 여전히 예약을 쓰지 않는다. 묶음 그룹마다 월 합계를 확인하므로 넘는 폭은 최대 그룹 1개 비용이고, 다른 요청(운영자 검증 · 다른 사용자의 주간 실행)과 동시에 돌면 잠금 없이 함께 통과할 수 있다. 결과 저장(`finish`)이 실패하면 그 실행 비용은 기록되지 않는다. 주간 점검은 현재 꺼져 있다 — 켜기 전에 주간 실행도 예약 방식으로 바꿔야 한다(이번 범위 밖).
- 응답 실패(예: 529 · 400)는 과금되지 않았을 수도 있지만 사용량이 없어 예약 금액을 유지한다(보수적). 수동 정산 대상.
- 이미지 상한 4,800토큰은 문서상 고해상도 모델 최대 기준. 더 큰 이미지 토큰을 쓰는 모델이 나오면 `IMAGE_TOKENS_MAX`를 올려야 한다.
- 예약 SQL 동시성은 PGlite 단일 연결로만 확인했다(advisory lock 경로). 두 연결 동시 실험은 하지 않았다.
- 귀속 적용 근거는 Meta 응답 형식(창별 키)에 의존한다. 재배포 후 실제 응답으로 확인하기 전까지 결과 비교는 판단 보류로 나온다.

## 11. 2026-10-06 맥 이어서 — 주간 실행 비용 예약 · 확정 판단일 정합 (로컬 · 원격 변경 없음)

### 11-1. 주간 실행(run) 원자적 예약 · 정산 (10-4 첫 항목 해소)
- `ai-weekly-review` 주간 실행: 묶음 그룹마다 이미지를 먼저 받고 실제 보낼 내용으로 그룹 최악 비용(`worstGroupUsd` = 호출별 `worstCallUsd` 합 · 올림)을 계산 → `ai_budget_reserve(kind 'run', ref 'review:<id>')`로 원자적 예약 → 호출 → `finally`에서 `ai_budget_settle`.
  - 예약 거절(`budget`)이면 그 그룹과 남은 그룹은 호출하지 않고 대기(이용 횟수 차감 없음). 예약 확인 자체가 실패하면 같은 방식으로 멈추고 '운영 한도를 확인하지 못함'으로 남긴다.
  - 그룹 안 호출에 시간 제한(`callTimeout(deadline)`)을 걸어 함수 시간 안에 정산하게 했다(운영자 검증과 같은 방식).
  - 중간 예외로 호출 기록이 모자라면 미확인 → 예약 금액 유지. 정산 실패 · 강제 종료면 `reserved`로 남아 예약 금액으로 집계.
  - 그룹마다 잠금 없이 월 합계를 비교하던 검사는 없앴다(시작 전 `ai_month_spent()` 빠른 거절은 유지).
- 이중 집계 방지: 새 마이그레이션 `20261007100000_ai_budget_run_reservations.sql`
  - `ai_budget_reservations.kind`에 `run` 추가 · `ai_weekly_reviews.reserved_cost_usd`(예약으로 이미 월 합계에 들어간 비용) 추가.
  - `ai_month_spent()` = 주간 기록 `cost_usd − reserved_cost_usd` + 예약 이전 검증 비용 + 예약(정산 실제 또는 예약 금액). 예약 쪽이 기준이라 `finish` 저장이 실패해도 비용이 남고, 저장이 성공해도 두 번 세지 않는다.
  - 이어서 하기(예약 이전 실행 비용 + 예약 비용이 섞인 기록)도 예약 이전 부분만 주간 기록으로 센다.
  - 090000을 고치지 않고 별도 파일로 둔 이유: 원격 적용 여부를 확인하지 못했다(이미 적용됐어도 · 아니어도 순서대로 적용하면 같은 결과).

### 11-2. 확정 판단일 안내 ↔ 잠정 판정 정합
- 판정 조건과 안내 날짜를 한 함수(`finalFrom(until, win) = until + win + 1`)로 계산한다. `compare` 결과 · 저장 기록에 `final_from`을 남긴다.
- 판정 날짜: 한국 날짜 대신 **광고계정 시간대의 오늘**(`accountToday`, 응답 `account.timezone`). Meta 하루 지표는 계정 시간대 날짜라, 계정 시간대가 한국보다 늦으면(예: 로스앤젤레스) 한국 날짜 기준 확정이 하루 앞당겨졌다. 시간대를 모르면 한국 날짜 − 1일(어느 시간대보다 늦지 않음).
- 화면: 비교 기간 중 카드에 'X부터 확정 판단', 기간이 끝났지만 확정일 전이면 버튼 '결과 비교하기(잠정 · X부터 확정)', 결과 태그 '잠정(X부터 확정)'. 예상 창 `EXPECTED_WINDOW_DAYS = 7`은 서버 요청 창(`7d_click · 1d_view`)과 같은지 테스트로 묶었다.
- 비교 버튼(기간 종료 · 잠정 표시)도 판정과 같은 광고계정 날짜를 쓴다: 이번 비교에서 받은 시간대 → 기록 당시 `basis.timezone`(새 기록부터 저장) → 모르면 한국 날짜 − 1일. 한국 날짜로 먼저 열던 버튼이 판정과 하루 어긋나던 것을 맞췄다.

### 11-3. 로컬 검증
- 테스트 786/786(추가: 경계 날짜 — 마지막 날 · +1 · +7 · +8 · 월/연 경계 · 전환일 0일 · 시간대(서울 · LA · UTC+14 · 미상 · 잘못된 값) · 화면 시각 고정 · 주간 실행 예약 순서 · 그룹 최악 비용).
- 예약 SQL 로컬 검사 23/23(PGlite · 두 마이그레이션 순서대로 · 주간 실행 이중 집계 6건 추가).
- `deno check` 함수 17개 전부 통과(Deno 2.9.7 · 맥). 두 화면 모의 10/10.

### 11-4. 원격 적용 순서(갱신 · 모두 승인 후)
`20261007090000_ai_budget_reservations` → `20261007100000_ai_budget_run_reservations` → `ai-weekly-review` 재배포 → `meta-adset-insights` 재배포 + 무료 조회 1회 → (필요 시) `ad-video-source` → 운영 메인 호환 배포 → 미리보기 저장 스위치.
원격 상태(마이그레이션 적용 여부 · 배포 버전 · 주간 점검 활성 · 미정산 예약)는 **미확인** — 이번에도 조회하지 않았다.

### 11-5. 남은 제한
- 예약 SQL 동시성은 여전히 PGlite 단일 연결 확인뿐.
- 그룹 최악 비용은 출력 상한(16,000토큰 × 그룹 호출 수)을 포함해 커서, 월 한도에 가까우면 실제로는 들어갈 그룹도 예약이 거절될 수 있다(보수적).
- 확정일 이후에도 Meta 사후 데이터 정정(최대 28일)은 반영하지 못한다.

## 12. 2026-10-07 귀속 구매 수 계산 기준 (로컬 · 함수 재배포 전)
### 실제 확인한 것 (`meta-adset-insights` v13 · 무료 조회 1회 · 광고 세트 · 2026-10-01~10-07)
- 응답 `attribution.windows_seen` = `["7d_click","1d_view"]` — Meta 응답 **어떤 행동 항목이든** 창별 키가 있다는 뜻일 뿐(링크 클릭 항목도 포함), 구매 수가 그 기준으로 계산됐다는 근거가 아니다.
- 화면 구매 6건 = `offsite_conversion.fb_pixel_purchase` 항목의 **`value`**(`pickCountAndValue` → `metrics.purchase.value`). 창별 값(`7d_click` · `1d_view`)은 쓰지 않는다.
- **같은 구매 항목의 `value` · `7d_click` · `1d_view` 숫자는 아직 보지 못했다** — v13 응답은 창별 숫자를 내려주지 않는다. 아래 서버 수정을 재배포(승인 후)한 뒤 무료 조회 1회로 본다.

### Meta 공식 문서 (2026-10-07 확인)
- AdsActionStats(`developers.facebook.com/docs/marketing-api/reference/ads-action-stats/`): `value` = "Metric value of default attribution window", `7d_click` = "Metric value of attribution window '7 days after clicking the ad'", `1d_view` = "… '1 day after viewing the ad'".
- Ad Account Insights(`…/reference/ad-account/insights/`): `action_attribution_windows`는 행동을 보고할 창 · 참여 유형을 정하는 필터. **창별 값을 더해도 되는지 · 클릭/조회 중복 제거 규칙은 문서에 없다.**
- → `value`는 요청 창 기준이라는 근거가 없고(문서상 '기본 귀속 창'), 창별 값의 단순 합산도 근거가 없다. **더하지 않는다.**

### 바꾼 것 (로컬 · 커밋 · 함수 재배포 안 함)
- 서버(`_shared/meta-adset-normalize.mjs` `purchaseWindowValues` · `meta-adset-insights/index.ts`, 명시 귀속 요청에만):
  - 행별 `attribution_purchase` = 화면 구매 수와 **같은 action_type 항목**의 `{ count: { value, windows:{7d_click, 1d_view} }, purchase_value: {...} }` 원본 그대로(없는 창 null · 합산 · 보정 없음).
  - `attribution.metric_basis = { field:'value', windows_summed:false, matches_requested_windows:'unconfirmed' }`.
- 화면(`adlog.js`) 귀속 기준을 세 가지로 나눠 저장 · 표시:
  - 요청한 설정(`windows` · `action_report_time`) / 응답 관찰(`applied.windows` = 창별 키 있음 여부 · `observed.purchase_count` = 같은 구매 항목의 value · 창별 값, 창마다 날짜별로만 더함) / 계산 기준(`calculation:{field:'value', windows_summed:false}` · `applied.metric_basis`).
  - `metric_basis`는 서버가 정상 조회한 날 모두 `matches_requested_windows:'response_evidence'`를 줬을 때만 확인 — **현재 서버는 항상 unconfirmed**.
- 판정(`adlog-change-core.js` `attributionWindowDays`): 창별 키 근거 + **구매 수 계산 기준 근거**가 모두 있을 때만 귀속 기준 확인. 아니면 `attribution_unverified` → **판단 보류**(관찰값은 그대로 표시). 판정 버전 `adlog-compare-v4`.
- 테스트 790/790 · `deno check`(meta-adset-insights · ai-weekly-review) 통과.

### 남은 일 (각각 승인 후)
1. `meta-adset-insights` 재배포 → 무료 조회 1회(`scope:'ads'` 또는 `adsets` · `attribution_mode:'explicit'`)로 같은 구매 항목의 `value` · `7d_click` · `1d_view` 확인.
2. 그 숫자와 Meta 문서 · 광고 관리자 '귀속 설정 비교' 값으로 `value`가 어떤 창 기준인지 판단할 근거를 정한다. 근거가 생기기 전까지 `matches_requested_windows`는 unconfirmed 유지 → 광고 기록 비교는 판단 보류.

### 실제 값 (2026-10-07 09:52 KST · `meta-adset-insights` v14 = `8cb1883` · 무료 조회 · 광고 세트 · 2026-10-01~10-07 · Asia/Seoul · 1행 · 잘림 없음)
| `offsite_conversion.fb_pixel_purchase` | value | 7d_click | 1d_view |
|---|---|---|---|
| 구매 수 | 6 | 6 | null(키 없음) |
| 구매 금액 | 550.3 | 550.3 | null(키 없음) |
- 화면 값(구매 6 · 금액 550.3) = 같은 항목의 `value`. 서버 `metric_basis.matches_requested_windows` = unconfirmed.
- 응답 전체 `windows_seen`에는 `1d_view`가 있었지만 **구매 항목에는 `1d_view` 키가 없다** → 다른 행동 항목의 키였다(창별 키 존재 ≠ 구매 근거, 위 판단 확인).
- 해석 한계(확정하지 않음):
  - `value` = `7d_click`이 이번 한 번 같았을 뿐 — `1d_view`가 없거나 0이면 "`value` = 7d_click만"과 "`value` = 7d_click + 1d_view(합산 · 중복 제거)" 두 해석이 같은 숫자를 낸다. 구분하려면 같은 구매 항목에 `1d_view` 값이 있는 기간 · 광고가 필요하다.
  - 구매 항목에 `1d_view` 키가 없는 것이 '조회 후 구매 0'인지 '보고 안 됨'인지 문서로 확인되지 않았다 → 0으로 보지 않고 null.
  - Meta 문서상 `value`는 '기본 귀속 창 값' — 어떤 기본(계정 · 광고 세트 설정 · API 기본)인지 명시 없음. 보고 시점(`impression`) 적용 근거도 없음.
  - 광고 세트 1개 · 기간 1개 · 구매 6건 관찰.
- 결론: 계산 기준 **미확인 유지 → 광고 기록 비교 판단 보류 유지**(`matches_requested_windows` 변경 없음).

### 귀속 조회 정리 · 7일 클릭 기준 비교 (2026-10-07 · 로컬 수정 · 재배포 없음)
- 이번 귀속 조회는 **완료**(추가 조회 없음). 확인 범위는 **광고 세트 단위 1행 · 1기간** — 광고 단위 응답에 같은 구매 항목의 7d_click이 오는지는 가정하지 않는다.
- 광고 기록 비교(`adlog-change-core.js` `compare` · `aggregate`, `adlog.js` `dailyAds`):
  - 하루별 광고 행(광고 단위 응답 `ads[].attribution_purchase`)의 같은 구매 항목 `7d_click`을 `click7`로 모은다(구매 항목 없음 = null → 0으로 집계 · 키 없음 = 값 null · 관찰값 없음(재배포 전 서버) = undefined).
  - **전후 모두** 광고 행이 있는 모든 날에 값이 있고 · 구매 항목(action_type)이 같고 · 요청 설정에 `7d_click`이 있을 때만 → 구매 수 · 구매당 광고비 · 이항검정 · 참고 이익을 **7일 클릭 값**으로(`count_basis: 7d_click` · 결과 문구 '7일 클릭 기준 구매당 광고비 …').
  - `value` · `1d_view`와 합산하지 않음. ROAS · 매출은 Meta 기본 값(value) 기준 관찰값으로만.
  - 하나라도 빠지면 기존대로 `value` 기준 → 계산 기준 미확인 → `attribution_unverified` **판단 보류**.
  - 기존 조건 유지: 비교 기간 종료 · 기간 일치 · 조회 실패 · 통화 · 변경 전 재조회 · 새 광고 · 함께 바뀐 조건. 귀속 창 7일 · 보고 시점 미확인(노출일 가정) → 확정일 전 잠정. 주간 AI 분석과 귀속 기준이 다르다는 안내 유지.
  - 판정 버전 `adlog-compare-v5`.
- 테스트 793/793(7일 클릭 기준 판정 · value와 분리 · 창별 값 누락 / 관찰값 없음 / 구매 항목 다름 / 요청 설정에 7d_click 없음 → 보류 · 기존 조건 유지 · 화면에서 광고 행 7d_click 없으면 보류).
- 서버(`meta-adset-insights` v14)는 이미 광고 단위 응답에도 `attribution_purchase`를 내려준다 — 이 수정은 화면 코드만. 미리보기 저장 스위치 · 운영 배포는 그대로(꺼짐 · 안 함).

## 13. 2026-10-07 조회 · 계산 연결 검증 — ‘9월 전환광고’ 광고 단위 (광고 변경 효과 검증 아님)
> 실제 광고 변경 없이 종료된 두 주를 변경 전/후로 놓고 **조회 → 일별 행 → 집계 → 비교 계산**이 연결되는지만 본다. 결과 상태는 광고 변경의 효과가 아니다. 기록 저장 · 광고 수정 · AI 호출 · 배포 없음 · 저장 스위치 꺼짐.

### 보완(로컬 `3bd40b5` · 판정 버전 v6)
- 보고 시점(`action_report_time`)이 응답 근거로 확인되지 않으면 확정일이 지나도 `report_time_unverified` → 개선 · 악화 신호로 확정하지 않음(관찰값 · 검정 결과만). 지금 서버는 항상 unconfirmed → 모든 비교가 판단 보류.
- ROAS는 구매당 광고비와 같은 기준으로만: 7일 클릭 기준이면 같은 구매 항목 구매 금액의 `7d_click` 합 ÷ 광고비, 값이 하루라도 없으면 계산 보류(기본 값 ROAS로 대체하지 않음). 지표 줄(기본 값 구매 · ROAS)은 '(구매 · ROAS는 Meta 기본 값 기준)'으로 표시해 구분.

### 조회 (무료 · `meta-adset-insights` v14 · `scope:'ads'` · `period:'date'` · `attribution_mode:'explicit'` · 하루 1회 × 14일, 2026-10-07 10시대 KST)
- 광고 `120248679197140578`(‘9월 전환광고’) · 광고 세트 1개(전환 캠페인) · 계정 시간대 Asia/Seoul · **통화 USD**.
- 14일 모두 조회 성공 · 광고 행 있음 · 조회 실패 0 · 페이지 누락 0 · 부재 0. 응답 요청값 `{7d_click, 1d_view, impression}` 일정 · `metric_basis` unconfirmed.
- 구매 항목: 구매가 있는 날 모두 `offsite_conversion.fb_pixel_purchase` · 그 항목의 `1d_view` 키는 모든 날 없음. 구매 항목이 없는 날 9일(변경 전 5 · 후 4)은 구매 0으로 집계(누락 아님).

| 날짜 | 광고비 | value 구매 | 7d_click 구매 | 7d_click 금액 |
|---|---|---|---|---|
| 09-21 | 18.55 | 1 | 1 | 33.78 |
| 09-22 | 25.33 | 1 | 1 | 31.85 |
| 09-23~09-27 | 11.83 · 9.44 · 11.31 · 8.39 · 11.35 | 0 | 구매 항목 없음 | — |
| 09-28 · 09-29 | 16.45 · 19.19 | 0 | 구매 항목 없음 | — |
| 09-30 | 19.69 | 2 | 2 | 59.33 |
| 10-01 | 22.48 | 4 | 4 | 499.68 |
| 10-02 | 19.12 | 1 | 1 | 32.16 |
| 10-03 · 10-04 | 16.14 · 23.85 | 0 | 구매 항목 없음 | — |

### 로컬 비교 (`adlog-change-core.js` `aggregate` · `compare` — 화면 `dailyAds`와 같은 행 형태, 스크립트는 임시 폴더)
- 변경 전 09-21~09-27: 광고비 $96.20 · 7일 클릭 구매 2 · 매출 $65.63 / 변경 후 09-28~10-04: 광고비 $136.92 · 구매 7 · 매출 $591.17.
- 계산 기준 `7d_click`(전후 같은 구매 항목) · 구매당 광고비 $48.10 → $19.56(−59.3%) · ROAS(7일 클릭) 0.68 → 4.32 · 참고 이익 보류(마진 · 환율 없음).
- 이항검정 n=9 · 변경 후 예상 5.3건 · 단측 p(개선) 0.209 → 우연 범위(`sample_uncertain`).
- 상태: **판단 보류** — 오늘(10-07): `provisional`(10-12부터 확정) · `report_time_unverified` · `sample_uncertain` / 10-12 가정: `report_time_unverified` · `sample_uncertain`(보고 시점 미확인으로 확정 신호 없음 확인).
- 주간 AI 분석과 귀속 기준이 다르다는 안내 유지 확인.
- 해석 한계: 실제 변경이 없는 두 주 비교라 효과 판단 대상이 아님 · 10-01 매출 499.68(4건)이 매출 · ROAS를 크게 끌어올림 · 광고 단위 1개 · 두 주 관찰.

## 14. 2026-10-07 보고 시점 '명시 요청' 기준 (로컬 · 판정 버전 v7)
- 공식 API 계약(Ad Account Insights): `action_report_time` = `enum{impression, conversion, mixed, lifetime}` — "Determines the report time of action stats" · 기본값 명시 없음 · **응답에 사용한 값을 되돌려 주는 필드 없음** → 응답으로는 확인 불가.
- 구분: `applied.action_report_time` = 응답 확인(지금은 항상 `unconfirmed`) / `applied.action_report_time_basis` = `explicit_request` — 전후 모든 조회(하루 1회 · 서버에 기본값 재조회 경로 없음)가 정상 응답이고 서버가 돌려준 요청값이 모두 같고 `impression`일 때만. 조회 실패 · 페이지 누락이 있으면 비교 자체가 막히고, 하루라도 요청값이 다르면 귀속 기준을 쓰지 않는다(보류).
- 판정: `impression` 명시 요청이면 보고 시점 때문에 막지 않음 — '노출일 기준으로 요청한 비교예요(… Meta 응답에서 재확인되지는 않음)'로 표시(`report_time_basis: explicit_request`). 응답에서 확인됐다고 표기하지 않음. 전환일 등은 요청만으로 인정하지 않음(`report_time_unverified`).
- 유지되는 제한: 귀속 창 대기(잠정) · 표본 불확실 · 함께 바뀐 조건 · 변경 전 재조회 · 새 광고 · 기간 · 통화 · 구매 수 기준(7일 클릭 또는 value 근거).
- 이번 사례(13장 데이터 재계산, 추가 조회 없음): 10-07 `provisional` · `sample_uncertain` / 10-12 가정 `sample_uncertain` → **판단 보류**. 변경 기록 · 결과를 저장하지 않았으므로 성과 집계(outcomeSummary)에 들어가지 않음 — 서비스 개선 성과 아님.
- 테스트 795/795.

## 15. 배포 범위 정리 (2026-10-07 · 배포 안 함 · 각각 승인 후)
### A. 운영 메인 호환 — `compat/main-adlog-parity` = `d4d56c7`
- 범위: `master`(`6695178` = `origin/master`) + 커밋 5개 · 파일 `adlog-core.js`(신규 · 미리보기 `launchroas/adlog-core.js`와 동일) · `index.html` · `store.js` · `tools.js` · 테스트 3개.
- 내용: LaunchROAS 변경 · 결과 기록을 ₩NaN 없이 목록에만(합계 제외) · LaunchROAS와 같은 합계(공유 모듈 + 저장된 포함/제외 선택) · 선택 조회 실패 시 '미확정' · 기록 조회 실패를 '기록 없음'과 구분 + 다시 불러오기.
- 오늘 바뀐 판정(v5~v7 · `adlog-change-core.js` · `adlog.js`)은 **미리보기 전용** — 운영 메인은 판정 상태를 표시하지 않아(라벨 '변경 기록 · 합계 제외 · 결과 N건'만) 호환 브랜치 수정 불필요.
- 방식: `master` 병합 · 푸시 → Vercel 운영 배포(빌드에서 테스트 실행). 배포 전: 호환 브랜치 테스트 재실행(임시 작업 트리) · 배포 후 `#/dashboard` ₩NaN 없음 · 선택 조회 상태 확인.
### B. 미리보기 저장 기능 — `preview/launchroas-apple`
- 범위: 원격보다 앞선 로컬 커밋 전부(광고 기록 비교 v7 · AI 주간 점검 화면 · 정책 · 비용 예약 등) · 저장 스위치 `launchroas/index.html`에 `window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true }`(지금 없음 = 꺼짐).
- 서버 선행 조건: `ai-weekly-review` v16 · `meta-adset-insights` v14(광고 단위 `attribution_purchase` · 명시 귀속) 배포 완료. DB 스키마 변경 없음 — 저장 시 `tool_records`(ad_log · ad_log_decision)에 행 추가만.
- 순서: A 배포 → 운영 메인에서 실제 저장 · 재조회 · 실패 · 재시도 확인 → 저장 스위치 켜고 미리보기 푸시(브랜치 배포 방식 확인 필요) → 실제 광고 변경 기록 1건(결과는 약 2주 뒤).
### C. 이번 범위 밖
- `ad-video-source` 배포(영상 광고가 생겼을 때만) · `AI_WEEKLY_ENABLED` 재활성(별도 승인 · 지금 false) · `migration repair`(별도 결정) · `db push` 금지 유지 · 유료 AI 호출.

### A 운영 메인 호환 배포 — 완료 (2026-10-07 10:33 KST)
- 배포 전: 원격 `master` = `6695178`(변경 없음) · 호환 브랜치는 그 위 커밋 5개(fast-forward). 제품 코드 = 광고 기록 호환만(`adlog-core.js` · `index.html` · `store.js` · `tools.js`), 나머지는 테스트(광고 기록 1 · 마이그레이션 SQL CRLF 읽기 보정 2 — SQL 변경 없음).
- 검사(임시 폴더에 `git archive`로 풀어 Vercel 빌드 명령 그대로): 공개 전 점검 통과 · 테스트 639/639 · 빌드 통과(`dist`에 `adlog-core.js`) · 두 화면 모의 검증 10/10(공용 DB 쓰기 0).
- `master` `6695178` → `d4d56c7` 푸시 · Vercel `launchdesk` · `launchroas` 운영 배포 success.
- 운영 메인(launchdesk.co.kr) 확인: 로그인 유지 · 새 스크립트 적용 · 광고 기록 0건 · 합계 ₩0 · ₩NaN 없음 · 조회 실패 흉내(페이지 메모리만) → '불러오지 못함 · 합계 — · 다시 불러오기' → 복구.
- 실제 저장: `[검증용] 운영 메인 호환 확인 2026-10-07`(카카오 · ₩1,000) 저장 → 목록 · 합계 ₩1,000 · 서버 재조회 1행 확인 → 사용자가 ✕로 삭제 → 서버 재조회 광고 기록 0행 · 선택 0행 · 합계 ₩0.
- 함께 배포된 LaunchROAS 운영(launchroas.vercel.app, 읽기 전용): 이번 커밋에 `launchroas/` 변경 없음 · 제공 파일 `index.html` · `core.js` · `app.js` · `styles.css`가 `master`와 동일 · 미리보기 전용 파일(`adlog.js` · `adlog-change-core.js` · `insights.js` 등) 404 · `LAUNCHROAS_FLAGS`/저장 스위치 없음(운영 메인도 없음).
- 하지 않음: 미리보기 병합 · 저장 스위치 · AI 재활성화 · 광고 변경 · 다른 함수 배포.

### B 미리보기 저장 기능 — 완료 (2026-10-07 10:40~10:55 KST)
- 저장 스위치: `launchroas/index.html`에 `window.LAUNCHROAS_FLAGS = { adlogChangeRecords: true }`(커밋 `6d2423c`) · 테스트 795/795 · 운영 빌드 테스트 640/640 · 푸시 범위 비밀 값 검사 이상 없음.
- `preview/launchroas-apple` 푸시(`d4edd76..6d2423c`, 43커밋) → Vercel **Preview** 배포만(launchroas · launchdesk success, Vercel SSO 보호). 운영 `master` · 운영 배포 변경 없음 · LaunchROAS 운영 주소는 그대로(미리보기 파일 404).
- 미리보기에서 스위치 켜짐 확인(`changeEnabled:true`) → 사용자 로그인 → ‘9월 전환광고’ 실행 기록 1건 저장(`[검증용] 저장·조회 확인 — 실제 광고 변경 없음`, 기타 · 기존 광고 수정, AI 제안 연결 없음, 광고 변경 없음, 무료 Meta 조회만):
  - 서버 재조회 1행(`source:change` · id `1791337882709039`) · 변경 전 9/30~10/6 누락 0 · $137.05 · 구매 8(7일 클릭 8) · USD · Asia/Seoul · 귀속 `explicit_request` · 계산 기준 unconfirmed 저장.
  - 미리보기: '변경 기록 · 합계 제외 · 결과 대기' · 비교 기간 10/13 종료 · 확정 판단일 10/21 안내. 운영 메인: 같은 기록 '변경 기록 · 합계 제외 · 결과 대기' · 금액 — · 합계 ₩0 · ₩NaN 없음.
  - 사용자가 삭제 → 서버 광고 기록 0 · 선택 0 · 미리보기 · 운영 메인 모두 '기록 없음 · ₩0'.
- 하지 않음: 운영 `master` 병합 · 운영 배포 · AI 재활성화 · 광고 변경.
