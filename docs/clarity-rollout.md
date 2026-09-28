# Microsoft Clarity 공개 준비 — 개인정보처리방침 v1.5 (프로젝트 ID yp7ibyta96)

**상태(2026-09-28, 로컬 완료 · 원격 SQL 적용·배포 안 함)**: 방침 v1.5(시행일 2026년 9월 28일)·통합 안내창의 Clarity 항목·로더·로그인 후 화면 마스킹·테스트가 맞춰져 있고 `clarity-consent-core.js` `ENABLED = true`다. **기존 회원의 필수 동의 재수집은 요구하지 않고, 세팅 대행 RPC 마이그레이션도 만들지 않았다**(아래 1번). 배포일이 9월 28일이 아니면 방침 세 곳의 날짜와 `tests/privacy-version-consistency.test.js`를 함께 고친다.

범위: 방문 행동 분석(녹화·히트맵) 선택 동의만. 식별자(`clarity('identify')`)·사용자 지정 태그·이벤트는 보내지 않는다.

## 1. 방침 v1.5와 필수 동의 · 세팅 대행 RPC (`20260928100000_setup_inquiries_privacy_v1_5.sql`은 삭제)

`policy-consent-core.js`는 버전을 세 가지로 나눈다.

| 상수 | 값 | 쓰이는 곳 |
|---|---|---|
| `PRIVACY_VERSION` | `v1.5` | 게시 중인 방침. 새 회원 동의 이력(`user_policy_consents.privacy_version`)에 기록 |
| `ACCEPTED_PRIVACY_VERSIONS` | `['v1.4','v1.5']` | 로그인 시 필수 동의 게이트 통과 기준. v1.4 동의 행도 유효 → **재동의 창이 뜨지 않는다** |
| `SETUP_INQUIRY_PRIVACY_VERSION` | `v1.4` | 세팅 대행 RPC가 요구하는 값(서버 상수와 같아야 함) |

- v1.5는 안내창에서 따로 동의받는 선택 항목(Clarity)만 더했고 필수 수집 항목·목적은 v1.4와 같다. 그래서 v1.4 동의자를 그대로 인정한다. 방침 14번에도 그렇게 적었다. v1.3 이하 동의자는 v1.4의 필수 범위 변경(Meta 픽셀 고지) 때문에 여전히 재동의 대상이다(테스트로 고정).
- 게이트 조회를 `.eq(privacy_version).maybeSingle()`에서 `.in(privacy_version, 허용목록).limit(1)`로 바꿨다. v1.4·v1.5 행이 둘 다 있는 회원에서 `maybeSingle`이 "여러 행" 오류를 내지 않게 하려는 것이다.
- **v1.5 RPC 마이그레이션이 필요한지 확인한 결과: 필요 없다.**
  - 그 파일은 `CREATE OR REPLACE FUNCTION`뿐이었다. 저장된 문의 행을 고치는 `UPDATE`는 없었고(기존 v1.1~v1.4 마이그레이션에도 없다 — 테스트로 고정), 이미 접수된 문의자의 `privacy_consent_version`·`privacy_consent_at`은 어떤 경우에도 바뀌지 않는다.
  - 유일한 효과는 **앞으로 접수되는 문의**에 기록될 버전 라벨과, 웹이 보내는 `p_expected_privacy_version`과 서버 상수가 같아야 접수된다는 불일치 차단이다. 웹이 v1.5를 보내면 마이그레이션이 필수가 되고(안 하면 세팅 대행 접수가 전부 `PRIVACY_VERSION_MISMATCH`), v1.4를 보내면 필요 없다. 필수 처리 범위가 그대로라 v1.4를 계속 보낸다.
  - 파일을 저장소에 남겨 두면 나중에 `supabase db push`가 적용해 웹(v1.4)과 어긋나 접수가 막히므로 삭제했다.
  - 트레이드오프: 새 세팅 대행 접수의 동의 증빙 버전이 게시 방침(v1.5)보다 한 단계 낮은 `v1.4`로 남는다. 세팅 대행에서 수집하는 항목·목적·보유는 v1.4와 v1.5가 같다(Clarity는 이 폼과 무관). 증빙을 정확히 v1.5로 남기고 싶으면 그때 마이그레이션을 새로 만들고 `SETUP_INQUIRY_PRIVACY_VERSION`을 함께 올린다.
- **미확인**: 원격 DB의 `submit_setup_inquiry` 상수가 실제로 `v1.4`인지. v1.4 마이그레이션은 Meta 커밋(fd15d59) 메시지에 "원격 미적용"으로 남아 있다. 이미 배포된 v1.4 웹이 접수를 보내고 있다면 적용됐다는 뜻이지만 코드로는 확인할 수 없다. 배포 전에 `supabase/verify/setup_inquiry_consent_version_check.sql`(조회 전용)로 확인한다.

## 2. 공식 문서·런타임으로 확인한 것 (2026-09-28 조회)

출처: Clarity 문서 <https://learn.microsoft.com/clarity/> — Consent API v2, Cookies, Masking, FAQ. 태그 `https://www.clarity.ms/tag/yp7ibyta96`와 런타임 `scripts.clarity.ms/0.8.72-beta/clarity.js`는 직접 내려받아 읽었다.

| 항목 | 확인 내용 | 반영 |
|---|---|---|
| 설치 스니펫 | 실행 즉시 `clarity.ms` 태그를 부르고, 태그 응답이 `CLID`(제3자) 쿠키를 심으며 `c.clarity.ms/c.gif`도 호출 | `index.html`에 넣지 않고 `clarity-consent.js`만 동의 후 삽입 |
| 공식 철회 API | `consentv2 denied`·`consent false`는 쿠키만 지우고 **"동의 없음 모드"로 재시작해 방문마다 임시 ID로 계속 전송**한다(문서 + 런타임 `no()`가 `stop()` 뒤 250ms에 `start`) | 쓰지 않는다 |
| 실제 중지 | 런타임의 `clarity('stop')`(공개 문서 표에는 없음, 런타임 API 객체에는 있음). 수집 모듈을 모두 멈추고 `window.clarity`를 큐 전용 껍데기로 바꾼다. **멈추기 직전에 대기 중이던 기록을 1회 전송한다**(업로드 모듈 `stop`이 `Or(!0)` 호출) | 철회 = `stop` + 쿠키·`_cltk` 삭제. 방침 11번에 "마지막 1회 전송" 명시 |
| 쿠키 | 1st party `_clck`·`_clsk`, 3rd party `CLID`·`ANONCHK`·`MR`·`MUID`·`SM`. 만료일은 문서에 없음 | 방침은 만료 숫자를 적지 않고 "Clarity가 정한 만료 시점". 제3자 쿠키는 회사가 삭제할 수 없다고 명시 |
| 보유 | 녹화 30일, 즐겨찾기·무작위 표본 최대 9개월(FAQ) | 방침 4번·안내창 "30일 보관" |
| 마스킹 | 기본 Balanced. 입력창·드롭다운은 모든 모드에서 마스킹, Balanced는 숫자·이메일도 마스킹. 그 밖의 화면 텍스트는 녹화에 나온다 | 3번의 코드 마스킹 |
| 처리 주체 | "Clarity is GDPR-compliant as a data controller", 데이터는 Azure, Microsoft가 데이터 접근 | 방침 5번·11번 표(수집해가는 사업자 = Microsoft Corporation). 위탁·국외 이전 표에는 넣지 않음(Meta와 같은 구조) |
| 연령 | "18세 미만 대상 사이트에 쓰지 말 것" | 서비스는 판매자 대상이라 해당 없음 |

## 3. 동의 안내창 · Meta와의 분리 · 마스킹

**안내창**: 한 창에서 GA4 · Meta · **방문 행동 분석 (Microsoft Clarity)**을 체크박스로 따로 고른다(모두 기본 해제, 저장 키 `ld-clarity-consent-v1`). 기존 방문자의 GA4·Meta 동의는 Clarity로 간주하지 않으며, Clarity 저장값이 없으면 "선택 안 함"으로 안내창이 한 번 다시 뜬다(GA4·Meta 체크는 저장값대로, Clarity는 해제). 모두 허용하지 않음 = 전부 거부 · 선택 저장 = 체크한 것만 · 모두 허용 = 전부 허용 · 푸터 "분석·광고 설정"으로 변경·철회.

**Meta 긴급 중단과의 분리**: 예전에는 통합 안내창을 `meta-pixel.js`만 열어서 Meta `ENABLED=false`가 Clarity까지 껐다. 이제 Clarity는 Meta 파일 없이 동작한다.

| 스위치 | 결과 |
|---|---|
| 둘 다 켜짐 | GA4 · Meta · Clarity 세 항목 |
| Meta 꺼짐(`meta-pixel-core.js` `ENABLED=false`) | Clarity가 창을 직접 열어 **GA4 + Clarity 두 항목**, Meta 항목 숨김, "선택 저장"의 GA4 저장도 Clarity 스크립트가 처리. 저장된 Clarity 허용은 그대로 로드 |
| Clarity 꺼짐(`clarity-consent-core.js` `ENABLED=false`) | Meta 창은 그대로, Clarity 항목만 숨김·로드 없음 |
| 둘 다 꺼짐 | 예전의 GA4 전용 안내창 |
| Meta 파일을 아예 싣지 않음 | Meta 꺼짐과 같음(Meta 코어에 의존하지 않도록 주소 안전 검사 `isSafeLocation`도 Clarity 코어에 따로 두고, 두 구현이 같은 답을 내는지 테스트로 대조) |

**로그인 후 화면 마스킹**(`data-clarity-mask="true"`, 정적 속성). Clarity는 노드가 만들어질 때 마스킹을 정하므로, 로그인 후에 속성을 붙이는 동적 토글은 쓰지 않는다(테스트로 금지).
- 화면 전체: 운영 현황(`#view-dashboard`: 주문·광고계정·쇼핑몰 이름), 내 계정(`#view-account`: 이메일·쇼핑몰 목록), 관리자(`#view-admin`)
- 사이드바 프로필 카드 · 상단 사용자 배지 · 알림(`#toastStack`) · 마진 계산기의 저장 계정 표시(`#mcPlanAccount`) · "최근 저장한 계산" 목록
- 모달: 로그인 · 쇼핑몰 추가/수정 · Cafe24 연결 · Meta 광고계정 선택 · 광고 세트 연결 · 도매처 문의
- 관리자 화면이 `body`에 직접 붙이는 오버레이 5곳(`admin.js`: 문의 상세 · 도매처 수정 · 세팅 대행 문의 상세 · 회원 상세 · 쇼핑몰 상세 — 이름·연락처·이메일이 나온다)
- 입력창은 Clarity가 어느 모드에서나 가린다.
- **미확인**: Clarity 대시보드의 Settings → Masking 모드(기본 Balanced). 코드로 볼 수 없어 방침도 이 설정을 약속하지 않는다(방침은 "입력창은 모든 설정에서 가려짐 + 로그인 후 화면은 회사가 코드로 따로 가림"만 말한다). Relaxed로 바뀌어 있으면 로그인 전 안내 화면의 숫자·이메일이 녹화에 나온다. 공개 화면에는 개인 정보가 없다.
- 마스킹하지 않은 곳: STEP·가이드·자료실·도매처·택배 등 공개 안내 화면, 마진 계산기 본문(입력창은 자동으로 가려짐), 문의 화면(입력창 위주).

## 4. 브라우저 실측 (실제 Chrome + 실제 Clarity 런타임, Microsoft로는 아무 것도 보내지 않음)

Chrome을 원격 디버깅으로 띄워 모든 요청을 가로챘다: `127.0.0.1`은 통과, `clarity.ms`는 기록 후 내려받아 둔 공식 태그·런타임 사본으로 응답(업로드 본문은 gzip을 풀어 확인), 그 밖의 외부 요청(fonts·jsdelivr 등)은 차단. 새 프로필 · 데스크톱 1280×900.

| 시나리오 | 결과 |
|---|---|
| 신규 방문자, 동의 전(마우스·스크롤 후 약 7초 대기) | `clarity.ms`/`bing.com` 요청 **0건**, `window.clarity` 미정의, 체크박스 3개 해제 |
| GA4·Meta만 허용 저장 | Clarity 요청 0건 |
| 푸터에서 다시 열어 Clarity 추가 허용 | 태그 1 · 런타임 1 · `c.gif` 1 · `collect` 4(약 10초), `_clck`·`_clsk` 생성 |
| **철회** 후 약 17초(마우스·스크롤·해시 이동·`pushState`+`popstate`·`visibilitychange`·`pagehide`) | 철회 순간 `collect` **1건**, 그 뒤 **0건**. `_clck`·`_clsk` 즉시 삭제, 이후 재생성 없음 |
| **철회 때 나가는 1건의 내용**(업로드 본문 해독) | 철회 클릭 14~32ms 뒤 `collect` 1건, 종료 표시(`end=1`). 철회 직전 화면에 넣어 둔 표식(`PREREVOKEPROBE`)은 들어 있고, 철회 직후 바꾼 표식(`POSTREVOKEPROBE`)은 이후 6초간 어떤 업로드에도 **없음**. 안에는 철회 직전의 클릭 기록(푸터 링크)과 종료 시각의 Clarity 자체 기록(측정값·종료 표시)뿐 |
| 같은 화면에서 재허용 | 태그·런타임 새로 로드, `collect` 4(허용 첫 구간과 같은 수 → 인스턴스 1개, 이중 전송 없음) |
| 허용 저장 상태로 새로고침 | 시작 때 로드·전송. 그 뒤 모두 허용하지 않음 → 새로고침: 요청 **0건**, 세 저장값 모두 `denied` |
| 허용 저장돼 있어도 주소에 `#access_token=…` | 로드 안 함(요청 0건). 이후 `#/start`로 이동하면 그때 로드. `?code=` 주소도 로드 안 함 |
| **마스킹**(업로드 4건·약 46만 자 해독, 마스킹된 컨테이너에 나중에 넣은 문구) | 계정 쇼핑몰 목록·알림·저장한 계산·대시보드 목록·프로필 이름·상단 사용자·모달·마진 계산기 계정 표시에 넣은 표식 9개와 한글 상호 **모두 업로드에 없음**. 마스킹하지 않은 곳에 넣은 표식(상단 위치 표시·마진 계산기 안내)과 공개 고정 문구는 **보임** → 속성이 동적으로 추가된 자식까지 가린다 |
| 대조: 공식 방식(`consentv2 denied`) | 호출 뒤 약 15초 동안 `collect` 5건 — **전송이 멈추지 않는다**(그래서 쓰지 않음) |
| 대조: 철회 없이 페이지를 떠남 | 떠나는 순간 `collect` 1건(언로드 마지막 전송). 철회 후 떠날 때는 추가 전송 없음 |

같은 시나리오 중 로더 동작은 Node vm으로 고정한 것이 `tests/clarity-consent.test.js`다(실제 런타임은 포함하지 않음).

## 5. 방침 11번 문구와 구현의 일치

| 방침 문구 | 구현·실측 |
|---|---|
| "철회하면 그 즉시 Clarity의 수집을 중지시키며, 철회 이후 새로 발생하는 정보는 전송되지 않습니다." | `clarity('stop')` 즉시 실행, 이후 화면 변경·마우스·스크롤·해시 이동·페이지 이탈에 요청 0건, 철회 직후 표식 미전송 |
| "다만 철회 시점까지 이미 수집돼 브라우저에 대기 중이던 기록은 Clarity가 종료 처리 과정에서 마지막으로 한 번 전송할 수 있습니다." | `stop`이 대기 기록을 `end=1`로 1회 전송(측정한 3회 모두 1건). 내용은 철회 이전 기록 + 종료 표시. 런타임이 바뀌면 달라질 수 있어 "할 수 있습니다"로 적었다 |
| "회사는 이 사이트에 남아 있는 Clarity 쿠키(_clck, _clsk)와 Clarity가 브라우저 세션에 저장한 값을 함께 삭제하고 이후 방문에서는 Clarity 스크립트를 불러오지 않습니다." | `_clck`·`_clsk`(등록 가능한 상위 도메인까지) + `sessionStorage._cltk` 삭제, 재방문 요청 0건 |
| "…Microsoft 도메인에도 제3자 쿠키(CLID, MUID 등)를 저장할 수 있으며, 이 쿠키는 회사가 삭제할 수 없으므로 브라우저 설정에서 직접 삭제…" | 코드로 삭제 불가(도메인이 다름) |
| "로그인 후 화면(…)의 글자와 값을 Clarity가 수집하지 않도록 따로 가립니다." | 3번의 정적 마스킹 + 실측 |

## 6. 남은 위험 · 운영자 확인

1. **미확인 — Clarity 대시보드 Masking 모드**(코드로 확인 불가). 방침은 약속하지 않지만, 공개 화면 녹화의 숫자·이메일 노출 범위가 이 설정에 달렸다.
2. **미확인 — 원격 `submit_setup_inquiry` 상수가 `v1.4`인지**(1번). 아니라면 v1.4 웹이 이미 접수를 거부하고 있을 수 있다.
3. **세팅 대행 동의 증빙 버전이 v1.4로 남는다**(1번 트레이드오프).
4. **철회 때 마지막 1회 전송은 막을 수 없다**(공개 API 없음). 방침에 적었다.
5. **`clarity('stop')`은 공개 문서에 없는 명령**이다. Clarity가 런타임을 바꾸면 달라질 수 있으니 공개 후 가끔 D-11을 다시 확인한다.
6. 마스킹 목록은 현재 화면 기준이다. 개인 데이터를 보여 주는 새 화면·모달·`body` 오버레이를 만들 때 `data-clarity-mask`를 함께 붙여야 한다(`admin.js` 오버레이는 테스트가 개수를 지킨다).
7. 마스킹하지 않은 로그인 후 화면이 없는지 이 목록으로만 확인했다. 문의(`#/contact`)·세팅 대행 화면은 입력창 위주라 뺐다.

## 7. 배포 순서 (원격 SQL 없음)

**A. 로컬** — 완료. `node scripts/predeploy-privacy-v1_2-gate.js` OK, `node --test "tests/**/*.test.js"` 전부 통과, `node scripts/build-static-output.js` 성공.

**B. 원격 사전 확인(조회만)** — SQL Editor에서 `supabase/verify/setup_inquiry_consent_version_check.sql` → 상수가 `v1.4`인지(6번의 2번).

**C. 배포** — 마이그레이션 적용 없음. `git push` → Vercel 빌드 로그에서 배포 검사 OK · 테스트 통과 · 빌드 성공 · 프로덕션 승격 확인.

**D. 공개 후 확인(운영 도메인)**
- D-10. 새 시크릿 창: 안내창에 세 항목이 보이고, 결정 전 Network에 `clarity.ms`·`c.clarity.ms`·`a.clarity.ms` 요청 0.
- D-11. Clarity만 선택 저장 → `tag/yp7ibyta96`·`clarity.js`·`collect` 확인, Clarity 대시보드 "라이브"에 세션 표시. 푸터 "분석·광고 설정"에서 해제 → 마지막 `collect` 1건 뒤 요청 0, `_clck`·`_clsk` 삭제.
- D-12. 로그인 후 운영 현황·내 계정 화면을 Clarity에서 재생해 글자가 가려져 있는지 확인. Settings → Masking 모드도 함께 기록한다.
- D-13. 기존 방문자(GA4·Meta 저장값이 있는 브라우저): 안내창이 다시 뜨고 Clarity는 해제 상태.
- D-14. **기존 회원(v1.4 동의)이 로그인할 때 재동의 창이 뜨지 않는지**, 세팅 대행 신청 1건이 정상 접수되는지.
