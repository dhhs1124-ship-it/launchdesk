# LaunchROAS 첫 버전

별도 Vercel 프로젝트의 Root Directory를 `launchroas`로 설정하는 정적 사이트다.
현재 공개 배포 전이며, 검색 색인은 막는다. 별도 도메인은 정해지지 않았다.

- 기존 LaunchDesk Supabase 프로젝트의 **publishable** 키와 Auth를 공유한다.
- 이메일·비밀번호를 가진 기존 계정으로 로그인해 본인 쇼핑몰(Cafe24)의 주문과 Meta 광고 성과를 조회한다. 새 계정 생성·소셜 로그인은 아직 제공하지 않는다.
- 연결 추가/해제, 주문 동기화는 기존 LaunchDesk `#/account`에서 처리한다. 새 사이트는 조회만 한다.
- Cafe24 주문금액은 취소·환불·미입금 미차감이고, Meta 구매금액은 Meta 귀속 기준이다. 두 값을 합산하지 않는다.
- 오늘 주문은 오늘 시작 이후 마지막 동기화 시각이 있을 때만 숫자를 표시한다. 건수가 조회 한도를 초과하면 불완전한 합계를 표시하지 않는다.

배포 전에는 새 Origin의 Supabase Auth Redirect URL과 Edge Function CORS 허용 목록을 점검해야 한다. 현행 `meta-insights`가 새 Origin을 허용하는지 검증하기 전에는 공개하지 않는다. 새 사이트의 개인정보처리방침·약관과 OAuth 연결 경로도 출시 전에 정리한다.
