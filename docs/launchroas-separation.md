# LaunchDesk / LaunchROAS 분리 기준

결정(2026-09-29): LaunchROAS는 별도 사이트로 운영한다. 도메인, 계정 공유 방식과 출시 범위는 아직 정하지 않았다.

진입 방식: 두 사이트는 각각 해당 주소로 바로 열리게 한다. LaunchDesk 방문 직후 '가이드 / 광고 효율'을 고르는 필수 인트로 화면은 두지 않는다. 광고와 콘텐츠 링크는 목적에 맞는 페이지로 직접 연결하고, LaunchDesk 홈에는 이미 운영 중인 사용자를 위한 LaunchROAS 안내 링크를 새 사이트 공개 후 추가한다.

## 제품 경계

| 기능 | LaunchDesk | LaunchROAS |
| --- | --- | --- |
| 창업 STEP, 자료실, 도매처, 택배 집하, 마진 계산기 | 유지 | 제외 |
| 세팅 대행과 비회원 문의 | 유지 | 제외 |
| Cafe24 주문 및 Meta 광고 연동 | 전환 완료 전 유지 | 이전 대상 |
| 운영 현황, 광고 기록, ROAS·손익분기 분석 | 전환 완료 전 유지 | 이전 대상 |

Meta 귀속 매출과 Cafe24 주문금액은 서로 다른 수치다. 새 사이트에서도 더하거나 같은 매출로 부르지 않는다.

## 현재 코드 의존성

- 화면: index.html의 view-dashboard, app.js의 /dashboard 경로와 쇼핑몰·Cafe24·Meta 연결 모달.
- 클라이언트: ops-overview.js, meta-adsets.js, meta-margin-core.js, adlog-meta.js, stores.js, store.js, home-dashboard.js 일부.
- 서버: supabase/functions의 Cafe24·Meta OAuth 및 조회 함수, supabase/migrations의 stores, connected_accounts, orders, 광고 기록, 인증·권한 정의.
- 새 도메인에서는 OAuth redirect, 허용 Origin, Supabase Auth callback, 개인정보·분석 동의와 환경 변수를 다시 검증해야 한다. 비밀키는 클라이언트나 저장소에 복사하지 않는다.

## 이행 순서

1. 새 사이트에 운영 화면과 필요한 로그인·연동 코드만 준비한다. 데이터가 없으면 실제 빈 상태를 보인다.
2. 기존 계정과 저장된 쇼핑몰·광고 기록을 새 사이트에서 어떻게 접근할지 결정한다.
3. Cafe24·Meta 앱 리디렉션, 서버 Origin, Auth callback, 권한 및 동의 문구를 새 도메인에 맞춘다.
4. 주문·광고 조회, 광고 기록 저장·재조회, 연동 해제를 확인한다.
5. 새 사이트가 정상 동작하고 기존 데이터 접근을 확인한 뒤 LaunchDesk 운영 메뉴를 새 사이트 안내로 바꾼다. 그 전에는 기존 기능과 데이터를 지우지 않는다.

## 결정할 사항

1. 새 도메인과 Vercel 프로젝트.
2. 기존 LaunchDesk 계정/쇼핑몰 데이터를 공유할지, 별도 계정을 만들지.
3. 첫 출시를 현재 운영 현황 전체로 할지, Meta 광고·ROAS 핵심 기능부터 열지.

2026-09-29 첫 변경: LaunchDesk 세팅 문의 랜딩 문구와 플랜 진입 버튼을 개선했다. 기존 가격, 문의 폼, Lead 전송 조건은 건드리지 않았다.
