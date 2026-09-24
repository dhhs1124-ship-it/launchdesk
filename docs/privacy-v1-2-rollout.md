# 개인정보처리방침 v1.2 배포 순서 점검 (웹 ↔ RPC 버전 불일치)

이 문서는 "v1.1 → v1.2 전환 도중 웹 프런트와 Supabase RPC가 서로 다른
순간에 반영되면 무슨 일이 생기는가"와, 문의 폼·광고 기간 조회까지 포함한
**v1.2 통합 출시 순서**(맨 아래 "통합 출시 순서")를 다룬다.

(2026-09-24 갱신, 커밋 `3c9ea89` 이후) Turnstile은 제거됐으므로 Cloudflare
관련 항목은 출시 결정 항목이 아니다. Resend 관련 방침 문구는 `index.html`
본문에 확정 반영돼 있다. **실제 게시일은 2026년 9월 24일(한국시간)로
확정해** 헤더·14번·15번 세 곳에 채웠고, 날짜를 채우라는 HTML 주석 2곳도
지웠다 — 개인정보 배포 검사는 exit 0(OK)이다. 남은 것은 아래 "통합 출시
순서"의 C-9(커밋)부터다.

## 왜 "배포 순서"가 문제가 되는가

웹(정적 프런트, Vercel)과 RPC(Supabase 마이그레이션)는 별도 시스템이라
같은 순간에 원자적으로 함께 배포되지 않는다. 브라우저 캐시·CDN 전파
지연으로 "한쪽만 먼저 반영된 구간"이 실제로 생긴다.

이 저장소에서 버전 문자열을 저장하는 두 경로는 성격이 다르다:

- **`user_policy_consents`(회원가입/로그인 게이트 동의)** — `policy-consent.js`가
  `policy-consent-core.js`의 `PRIVACY_VERSION` 상수를 그대로 클라이언트에서
  INSERT한다. 서버(RPC)가 별도로 상수를 갖고 있지 않다 — 저장되는 값은
  항상 "이 브라우저가 지금 믿고 있는 버전"이다. 그래서 웹 배포가 아직
  전파되지 않은 사용자는 "v1.1을 봤다"고 정확히 기록되고, 다음에 v1.2
  화면을 받으면 `queryHasConsent`가 v1.2 동의가 없다고 정확히 재판정해
  다시 게이트를 띄운다 — **자기 교정되며, 이 문서가 다루는 위험에 해당하지
  않는다.**
- **`setup_inquiries.privacy_consent_version`(세팅 대행 문의)** —
  `submit_setup_inquiry` RPC 함수 안의 **서버 상수**(`v_consent_version`)만
  저장한다(클라이언트가 임의 버전 문자열을 보내 동의 증빙을 조작하지
  못하게 하려는 2026-09-18 보안 설계 — `setup.js` 주석 참고). 이 상수는
  웹의 `PRIVACY_VERSION`과 **완전히 독립적으로** 배포된다. 바로 이 지점이
  이번 점검 대상이다.

## 점검한 두 경우

### (a) 웹 = v1.1(구버전 캐시), RPC = v1.2(먼저 마이그레이션 적용)

가드 없이 원래 6개 인자 시그니처만 있었다면: 캐시된 v1.1 화면(Resend
설명이 없는 문구)을 보고 동의한 사용자가 제출한 요청도
서버는 무조건 자기 상수(`v1.2`)로 저장한다 — **"화면은 v1.1을 보여줬는데
DB에는 v1.2에 동의했다고 기록"**되는 상황. 사용자가 실제로 읽지 않은
내용(Resend 관련 조항)에 동의한 것으로 감사 기록에 남는다.

### (b) 웹 = v1.2(먼저 배포), RPC = v1.1(아직 마이그레이션 전)

반대로 옛 RPC(v1.1 상수)가 살아있는 동안 새 화면(v1.2)을 보고 동의한
사용자는 **"화면은 v1.2를 보여줬는데 DB에는 v1.1에 동의했다고
기록"**된다 — 이번엔 실제보다 적게 동의한 것으로 과소 기록된다.

두 경우 모두 "오래된/새 버전이 기록되는 것 자체"가 문제가 아니라,
**"실제로 화면에 표시된 버전과 DB에 기록되는 버전이 다르다"**는 것이
문제다.

## 적용한 차단 방법 — 버전 불일치 시 접수 자체를 거부(fail-closed)

`supabase/migrations/20260923170000_setup_inquiries_privacy_v1_2.sql`에
두 가지를 함께 넣었다(둘 중 하나만으로는 부족하다 — 아래 "왜 둘 다
필요한가" 참고):

1. **새 인자 `p_expected_privacy_version`**(기본값 `null`) — 클라이언트가
   "지금 화면이 보여주고 있다고 믿는 버전"을 그대로 보낸다
   (`setup.js`에서 `policy-consent-core.js`의 `PRIVACY_VERSION`을 읽어
   전달). 이 값은 **저장에는 전혀 쓰이지 않는다** — 저장은 여전히
   `v_consent_version` 서버 상수만 쓴다(보안 설계 유지). RPC는 이 값이
   서버 상수와 정확히 같은지만 검사하고, 다르면(구버전 클라이언트가
   이 인자를 몰라 `null`을 보내는 경우 포함) `PRIVACY_VERSION_MISMATCH`로
   접수를 거부한다 — 행 자체가 생기지 않는다.
2. **옛 6개 인자 시그니처를 같은 마이그레이션에서 명시적으로 `DROP`** —
   인자 개수가 달라지면 `CREATE OR REPLACE`는 "교체"가 아니라 "오버로드
   추가"가 된다. 옛 시그니처를 지우지 않으면 아직 업데이트되지 않은
   클라이언트가 가드가 아예 없는 옛 함수를 계속 호출해 검사를 완전히
   우회할 수 있다.

### 왜 둘 다 필요한가

인자 개수를 바꾸고 옛 시그니처를 지우는 것만으로도 "이번" v1.1→v1.2
전환은 막을 수 있다(시그니처 자체가 달라 아무 쪽이든 못 맞으면
PostgREST가 "함수를 찾을 수 없음"으로 실패하므로). 하지만 **다음
번(v1.2→v1.3) 전환**에서 인자 개수를 또 바꾸지 않는 한(보통 그러지
않는다 — 인자가 매번 늘어나면 곤란하다) 이 보호는 사라진다. 그래서
값을 비교하는 런타임 검사(1번)를 반드시 함께 둔다 — 이후 어떤 버전
전환에서도 시그니처를 바꾸지 않고 서버 상수만 바꾸면 계속 같은 방식으로
보호된다.

## 두 경우 각각 실제로 무슨 일이 생기는가(가드 적용 후)

- **(a) RPC 먼저**: 구버전 캐시로 접수를 시도하는 사용자는 6개 인자
  시그니처가 이미 사라진 상태라 "함수를 찾을 수 없음"(PostgREST
  스키마 오류)으로 실패한다. 문구가 다소 기술적이라 `friendlySubmitError`가
  일반 실패 문구로 대체한다 — 웹 배포가 완료되는 즉시(캐시 갱신) 정상
  동작으로 돌아온다.
- **(b) 웹 먼저**: 새 화면이 7개 인자로 호출하는데 RPC는 아직 6개
  인자만 알고 있어 역시 "함수를 찾을 수 없음"으로 실패한다. RPC
  마이그레이션이 적용되는 즉시 정상 동작으로 돌아온다.
- 어느 순서든 **"잘못된 버전이 기록되는" 사고는 발생하지 않는다.** 남는
  차이는 "그 짧은 구간 동안 세팅 대행 신청이 실패로 보인다"는 가용성
  저하뿐이다 — 베타 단계의 낮은 트래픽을 고려해 정확성을 우선한
  의도적 선택이다(더 엄격하게 하려면 옛 RPC에 호환 인자를 먼저 얹는
  3단계 무중단 마이그레이션이 필요하지만, 지금 트래픽 규모에서는 과도한
  설계로 판단해 넣지 않았다).

## 권장 배포 순서

**RPC(이 마이그레이션)를 먼저 적용하고, 그 직후 웹 프런트를 push한다.**
두 순서 모두 안전(잘못된 기록 없음)은 동일하지만, RPC 먼저 쪽이 실패
구간이 더 짧고 예측하기 쉽다. 단, 적용과 push 사이에 코드 수정·커밋이
남아 있으면 그 시간만큼 실패 구간이 늘어나므로, 게시일·테스트·검사·빌드·
커밋은 **적용 전에** 전부 끝내 둔다(아래 "통합 출시 순서" C·D 단계).

## 배포 때 자동으로 도는 검사 — 현재 상태(커밋 `3c9ea89`)

`vercel.json`이 커밋에 포함돼 있다:

```json
{
  "framework": null,
  "buildCommand": "node scripts/predeploy-privacy-v1_2-gate.js && node --test \"tests/**/*.test.js\" && node scripts/build-static-output.js",
  "outputDirectory": "dist"
}
```

- Vercel 빌드는 ① 개인정보 배포 검사 → ② 전체 테스트 → ③ `dist/` 정적
  빌드 순으로 돈다. 하나라도 실패하면 빌드가 실패하고 프로덕션으로
  승격되지 않는다. 즉 게시일 자리표시자가 남은 상태로 push했다면 공개
  사이트는 바뀌지 않는다(자리표시자는 2026-09-24에 모두 채웠다).
- `scripts/build-static-output.js`는 `index.html`이 `<script src>`로
  참조하는 로컬 JS와 정적 파일·`assets/`만 `dist/`에 복사한다. `docs/`,
  `supabase/`, `tests/`, `scripts/`, `*.sql`, `*.patch`, `*.md`는 공개
  폴더에 들어가지 않는다. `dist/`는 `.gitignore` 대상이다.
- **리포지토리만으로 확인할 수 없는 것**: Vercel 대시보드(Project Settings
  → Build & Output Settings)에서 Build Command·Output Directory를 수동으로
  덮어쓰고 있지 않은지, Node.js 버전이 22 이상인지(`node --test`의
  `"tests/**/*.test.js"` 패턴은 Node 21 이상에서 동작) — push 전에
  대시보드에서 직접 확인한다.
- 로컬 확인 결과(2026-09-24, 게시일 반영 후): 배포 검사 exit 0(OK), 전체
  테스트 통과, `node scripts/build-static-output.js` 성공.

## 게시일 반영 내역 (2026-09-24 완료)

실제 게시일 2026년 9월 24일(한국시간)을 기존 방침의 날짜 표기
("2026년 9월 22일" 형식)에 맞춰 아래에 **같은 날짜로 한 번에** 반영했다.

- `index.html` — 개인정보처리방침 헤더 `시행일 2026년 9월 24일 · v1.2 · …`
- `index.html` — 14번 `v1.1 → v1.2 주요 변경 사항(2026년 9월 24일 시행)`
- `index.html` — 15번 `<li>시행일: 2026년 9월 24일</li>`
- `index.html` — 날짜를 채우라는 `[공개 전 확정 필요]` HTML 주석 2곳(헤더
  아래·15번 끝) 삭제
- `tests/privacy-version-consistency.test.js` — 자리표시자 기대값을 실제
  게시일 기준으로 변경(세 곳이 같은 날짜인지, 자리표시자·안내 주석이 남지
  않았는지 확인)
- `supabase/migrations/20260923170000_setup_inquiries_privacy_v1_2.sql`의
  주석에는 `[게시 예정일]`이 남아 있지만 SQL 주석이라 동작·검사와 무관하다.
  원격에 적용할 파일 내용은 바꾸지 않았다.
- 방침의 다른 내용과 버전(v1.2)은 바꾸지 않았다.

## 통합 출시 순서 (v1.2 방침 · 회원 전용 문의 · Meta 광고 기간 조회)

구성 요소별 의존 관계:

| 구성 | 웹보다 늦게 적용되면 | v1.1 화면이 떠 있는 동안 먼저 적용하면 |
|---|---|---|
| 문의 Secrets · 마이그레이션 `20260923160000` · 함수 `contact-inquiry` | 새 화면의 문의 전송 실패 | 영향 없음(v1.1 화면은 이 함수를 부르지 않음) |
| 함수 `meta-adset-insights`(기간 확장) | 새 화면의 어제·전체·날짜 선택 조회 오류(오늘·이번 달은 정상) | 영향 없음(오늘·이번 달 요청은 계속 지원) |
| 마이그레이션 `20260923170000`(세팅 대행 동의 v1.2) | 새 화면의 세팅 대행 신청 실패 | **v1.1 화면의 세팅 대행 신청 실패**(옛 6개 인자 함수가 삭제됨) |

**v1.1이 멈추는 구간은 하나다**: `20260923170000` 적용 순간부터 새 웹이
공개될 때까지(Vercel 빌드·배포 시간) 세팅 대행 신청만 실패한다. 잘못된
동의 버전이 기록되지는 않는다. 공개 후에도 예전 탭을 연 사용자에게는
"페이지가 최신 상태가 아니에요. 새로고침한 뒤 다시 시도해주세요."가 뜰 수
있다. 새 웹 공개 후 기존 회원에게 v1.2 재동의 창이 뜨는 것은 의도된
동작이다.

### A. 원격 상태 확인 — 읽기 전용 SQL (Supabase 대시보드 → SQL Editor)

이 PC에는 Supabase CLI가 없으므로 `supabase migration list`를 필수로 두지
않는다. 아래 파일은 모두 INSERT/UPDATE/DELETE/DDL이 없는 조회 전용이다.

| 확인 대상 마이그레이션 | 실행할 파일 | 기대 결과 |
|---|---|---|
| `20260918100000`, `20260918120000`, `20260922100000`, `20260921100000` | `supabase/verify/remote_schema_readonly_audit.sql` | 전부 PASS(세팅 대행 동의 상수 v1.1) |
| `20260921230000_ad_margin_links` | `supabase/verify/ad_margin_links_verify.sql` | 전부 PASS |
| `20260922120000_cafe24_disconnect` | `supabase/verify/cafe24_disconnect_post_apply_readonly.sql` | 전부 PASS |
| `20260922130000_core_table_privilege_hardening` | `supabase/verify/core_table_privilege_hardening_verify.sql` | 전부 PASS |
| `20260923160000_contact_inquiry_rate_limit`(적용 전) | `supabase/verify/contact_inquiry_preflight_check.sql` | 결과 행 없음 = 미적용(B-3에서 적용). 상태 C = 이미 지금 버전 적용(B-3 건너뜀). 상태 A·B = 예전 버전이 적용돼 있음 → 그대로 적용하지 말고 멈춘다(파일 주석의 판정표 참고) |
| `20260923170000_setup_inquiries_privacy_v1_2`(적용 전) | `supabase/verify/setup_inquiry_consent_version_check.sql` | 상수 `v1.1`, 6개 인자 |

- 보조 확인(선택, 조회만): `select version, name from supabase_migrations.schema_migrations order by version;`
  — CLI(`db push`)로 적용한 것만 기록되고 SQL Editor로 직접 적용한 것은
  나오지 않으므로, 위 파일 결과를 우선한다.
- Edge Function 상태: 대시보드 → Edge Functions에서 `contact-inquiry`가
  아직 없는지, `meta-adset-insights`의 마지막 배포 시각을 확인한다.
- 위에서 하나라도 FAIL이면 이후 단계로 가지 않는다.

### B. v1.1 화면에 영향 없는 준비 — 오늘(2026-09-24) D 단계 전에 반드시 끝낸다

이 단계들은 공개 중인 v1.1 화면에 영향이 없지만, 끝나지 않은 채 D-13
push를 하면 새 화면에서 문의 전송·광고 기간(어제·전체·날짜) 조회가 실패한다.

1. Resend에서 `launchdesk.co.kr` 발송 도메인을 인증하고 발송 전용 API 키를
   만든다.
2. 대시보드 → Edge Functions → Secrets에 `RESEND_API_KEY`,
   `CONTACT_FROM_EMAIL`(예: `LaunchDesk <contact@launchdesk.co.kr>`),
   `CONTACT_RATE_PEPPER`(충분히 긴 무작위 문자열)를 넣는다. 키를
   소스·대화창에 붙여넣지 않는다.
3. SQL Editor에서 `supabase/migrations/20260923160000_contact_inquiry_rate_limit.sql`을
   적용한다(A에서 "결과 행 없음"으로 미적용이 확인된 경우만) → `supabase/verify/contact_inquiry_rate_limit_verify.sql`이
   전부 PASS인지 확인한다.
4. 함수 두 개를 배포한다: `npx supabase functions deploy meta-adset-insights`,
   `npx supabase functions deploy contact-inquiry`
   (`meta-adset-insights`는 `../_shared/meta-adset-normalize.mjs`를 import하므로
   대시보드 편집기가 아니라 CLI 배포가 필요하다. `npx`는 전역 설치 없이 CLI를
   받아 실행한다 — 처음이면 `npx supabase login`, `npx supabase link`가
   먼저 필요하다.)
   - 실제 메일 발송 확인은 방침이 공개된 E 단계에서 한다.

### C. 게시일 확정 후 코드 마무리 — `20260923170000` 적용 **전에** 전부 끝낸다

5. (2026-09-24 완료) 위 "게시일 반영 내역"대로 세 곳을 2026년 9월 24일로 바꿨다.
6. (2026-09-24 로컬 확인) `node --test "tests/**/*.test.js"` → 전부 통과.
7. (2026-09-24 로컬 확인) `node scripts/predeploy-privacy-v1_2-gate.js` → **exit 0**(OK).
8. (2026-09-24 로컬 확인) `node scripts/build-static-output.js` → 성공.
   커밋 직전에 6~8과 `git diff --check`를 한 번 더 실행한다.
9. 커밋한다(push는 아직 하지 않는다). `git status --short`에 커밋할 변경이
   남아 있지 않은지 확인한다.
10. Vercel 대시보드에서 Build Command·Output Directory 덮어쓰기가 없고
    Node.js 22 이상인지 확인한다.

### D. 전환 — 이 사이에 코드 수정·커밋 작업이 남아 있으면 안 된다

11. SQL Editor에서 `supabase/migrations/20260923170000_setup_inquiries_privacy_v1_2.sql`을
    적용한다. **여기서부터 v1.1 화면의 세팅 대행 신청이 실패한다.**
12. `supabase/verify/setup_inquiry_consent_version_check.sql`로 상수 `v1.2`,
    7개 인자(`p_expected_privacy_version` 포함)인지 확인한다(조회만, 수 초).
13. 즉시 `git push` → Vercel 빌드 로그에서 ① 배포 검사 OK ② 테스트 통과
    ③ 빌드 성공 → 프로덕션 승격을 확인한다.

### E. 공개 후 확인

14. `supabase/verify/setup_inquiries_privacy_v1_2_verify.sql` — ⚠️ 순수 읽기
    전용이 아니다(BEGIN~ROLLBACK 안에서 실제 INSERT). 버전 불일치 3종이
    거부되고 남는 행이 없는지 확인한다. 공개 후 한가한 시간에 실행한다.
15. 운영 도메인(`launchdesk.co.kr`)에서 확인한다 — `contact-inquiry`는
    기본적으로 `https://launchdesk.co.kr`, `https://www.launchdesk.co.kr`만
    허용하므로 Vercel 미리보기 주소에서는 문의 전송이 거부된다.
    - 세팅 대행 신청 1건이 정상 접수되는지
    - 회원 문의 1건이 운영자 Gmail에 도착하는지(실제 메일 발송)
    - 광고별 성과의 오늘·어제·이번 달·전체·날짜 선택 전환
    - 기존 회원 로그인 시 v1.2 재동의 창
    - 이전 탭 새로고침 후 세팅 대행 신청이 정상인지

## 이 문서가 다루지 않는 것

- 방침 문구 자체의 법적 판단 — Resend 관련 문구는 현재 `index.html`
  본문에 확정 반영된 것을 기준으로 한다(`docs/contact-inquiry-privacy-draft.md`는
  그 문구를 만들기 전의 사실관계 정리용 초안이다).
