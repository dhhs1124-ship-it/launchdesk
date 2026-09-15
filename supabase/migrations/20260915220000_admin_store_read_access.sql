-- LaunchDesk 관리자 기능 5단계 — "쇼핑몰" 운영 현황(읽기 전용).
--
-- 구현 전 실제 코드를 직접 확인한 결과(추측으로 컬럼을 만들지 않음):
--   - stores.js가 실제로 select하는 컬럼: id, user_id, name, platform,
--     store_url, is_active, created_at (fetchStores, line ~330)
--   - connected_accounts에서 실제로 select하는 컬럼: store_id, provider,
--     status, last_synced_at, id, external_account_id, display_name
--     (fetchConnectedAccounts/fetchMetaAccounts)
--   - connected_accounts.status로 실제 코드에 등장하는 값은 'connected'와
--     'pending' 두 가지뿐이다 — 'error' 같은 세 번째 상태값은 어디에도
--     저장되지 않는다(Cafe24/Meta 관련 Edge Function 전체를 확인함:
--     cafe24-oauth-callback/meta-oauth-callback/meta-account-select가
--     쓰는 status는 "connected" 또는 "pending"뿐). 오류는 연결 "시도"
--     시점에 토스트로만 보여주고 DB에 남기지 않는다. 그래서 이번 단계의
--     관리자 화면은 "연결됨 / 연결 진행중(Meta만 해당, 광고계정 선택
--     대기) / 연결 안 됨" 3가지로 표시한다 — "오류" 상태는 만들지 않는다
--     (있지도 않은 상태를 지어내지 않기 위함, admin.js 쪽 주석 참고).
--   - 토큰/시크릿은 connected_accounts가 아니라 완전히 별도 테이블인
--     integration_credentials에 있다(meta-oauth-callback.ts:
--     `supabaseAdmin.from("integration_credentials").upsert(...)`).
--     connected_accounts 자체는 이미 "안전한 메타데이터만" 담는 테이블
--     이었다 — 이번 마이그레이션은 그 경계를 유지하고, integration_credentials
--     에는 정책도 GRANT도 절대 추가하지 않는다.
--   - profiles 테이블: app.js의 checkProfileRow()가 `.select('id')`만
--     조회하고, 주석에 "테이블 미생성이면 에러가 정상"이라고 명시돼 있다
--     — 즉 이 테이블이 실제로 존재하는지, email/표시명 같은 안전한 컬럼이
--     있는지 코드만으로는 확인할 수 없다(마이그레이션 파일도 없음 —
--     stores/connected_accounts처럼 이 프로젝트 초기에 Studio에서 직접
--     만들어졌을 가능성이 있고, 실제로 만들어졌는지조차 불확실하다).
--     안전하지 않은 추측으로 새 조회 구조를 만들지 않기 위해, 이번
--     단계에서는 profiles를 전혀 참조하지 않는다 — 관리자 화면에는
--     stores.user_id를 축약해서만 표시하고, "실제 이메일/표시명 표시"는
--     별도의 "회원 관리" 단계에서 profiles 실존 여부부터 확인한 뒤
--     해결하는 것을 권장한다(작업 보고 참고).
--
-- 이번 마이그레이션이 하는 일: stores/connected_accounts에 관리자용
-- SELECT 정책만 추가한다. 기존 사용자 정책(정확한 이름은 이 저장소에 SQL
-- 파일로 남아있지 않아 알 수 없지만, 두 파일의 코드 주석이 "본인 몫만
-- RLS로 걸러짐"을 명시적으로 전제하고 있어 이미 존재한다고 판단함)은
-- 전혀 건드리지 않는다 — DROP도 하지 않고, 이름도 모르니 손댈 수도 없다.
-- Postgres RLS는 같은 command(select)의 permissive 정책을 OR로 합치므로
-- 이 새 정책을 추가하는 것만으로 기존 정책 동작에는 영향이 없다.
--
-- UPDATE/DELETE 정책은 추가하지 않는다(이번 단계는 읽기 전용 운영 화면).
-- GRANT도 새로 추가하지 않는다 — 기존 사용자 기능이 이미 정상 동작
-- 중이므로 authenticated에게 SELECT GRANT가 이미 있다는 뜻이고(GRANT가
-- 없었다면 지금 사용자들도 이미 401을 겪고 있었을 것), 관리자도 같은
-- authenticated 역할이라 추가 GRANT가 필요 없다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- alter table ... enable row level security는 이미 켜져 있어도 안전한
-- idempotent 문장이다(stores.js 자체가 "RLS가 이미 걸러준다"고 전제하고
-- 있어 이미 켜져 있을 가능성이 높지만, 확인할 SQL 파일이 없으므로
-- 방어적으로 한 번 더 명시한다).
alter table public.stores enable row level security;
alter table public.connected_accounts enable row level security;

drop policy if exists "stores_select_admin" on public.stores;
create policy "stores_select_admin"
  on public.stores
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "connected_accounts_select_admin" on public.connected_accounts;
create policy "connected_accounts_select_admin"
  on public.connected_accounts
  for select
  to authenticated
  using (public.is_admin());

-- integration_credentials: 여기에는 어떤 정책도, GRANT도 추가하지 않는다
-- (요청사항 그대로 — access_token/refresh_token/app secret이 있는
-- 테이블이라 관리자 브라우저 조회 대상이 아니다).
