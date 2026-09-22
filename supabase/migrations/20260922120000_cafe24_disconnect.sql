-- LaunchDesk 오픈 베타 전 개인정보 보호 보완 — Cafe24 연동 해제(연결 정보·
-- OAuth 자격증명·동기화된 주문 데이터 삭제) RPC.
--
-- 조사한 기존 흐름(이 파일 작성 전 아래 파일들을 직접 읽어 확인함):
--   - supabase/functions/cafe24-oauth-start/index.ts: oauth_states에
--     (user_id, store_id, provider='cafe24', mall_id)를 insert하고
--     select("state")로 생성된 state를 받아온다.
--   - supabase/functions/cafe24-oauth-callback/index.ts: state를
--     `update oauth_states set used_at=? where state=? and provider='cafe24'
--     and used_at is null and expires_at > now() returning store_id,mall_id`
--     로 원자적으로 claim한 뒤, connected_accounts(store_id, provider=
--     'cafe24', external_account_id, display_name, status, connected_at,
--     updated_at)를 upsert하고, integration_credentials(connected_account_id,
--     access_token, refresh_token, access_token_expires_at,
--     refresh_token_expires_at, updated_at)를 onConflict: connected_account_id
--     로 upsert하며, 마지막으로 stores.external_store_id에 mall_id를
--     기록한다.
--   - supabase/functions/cafe24-store-info/index.ts: stores.external_store_id
--     를 Cafe24 mall_id로 select해 그대로 사용한다 — stores.js의 쇼핑몰
--     수정 폼도 "id/user_id/external_store_id는 절대 건드리지 않는다"는
--     주석과 함께 이 컬럼을 입력받지 않는다. 즉 stores.external_store_id는
--     Cafe24 연결 전용 식별자이고, Meta 연동은 이 컬럼을 전혀 쓰지 않는다
--     (grep 결과 external_store_id를 쓰는 곳은 cafe24-oauth-callback·
--     cafe24-store-info·stores.js 세 곳뿐).
--   - supabase/functions/cafe24-orders-sync/index.ts: orders를 upsert할 때
--     store_id, provider='cafe24', external_order_id 등을 쓰고 onConflict:
--     "store_id,provider,external_order_id"를 쓴다. 이 unique 제약은
--     supabase/verify/remote_schema_readonly_audit.sql 12-2번 체크로 원격에
--     존재함이 이미 확인돼 있다(참고용, 이 파일이 새로 만들지 않는다).
--   - supabase/functions/_shared/cafe24-token.ts: integration_credentials는
--     connected_account_id로만 조회/갱신하며, access_token/refresh_token을
--     응답이나 로그에 절대 노출하지 않는다는 방침을 이미 따르고 있다.
--   - supabase/functions/meta-disconnect/index.ts: 같은 목적(연동 해제)의
--     기존 함수지만 service_role로 integration_credentials →
--     connected_accounts 순서로 각각 별도 DELETE를 호출하는 비원자적
--     구조다(그 파일 자신의 주석: "CASCADE 존재 여부와 무관하게 항상
--     올바르게 동작하도록 ... 각각 명시적으로 지운다"). 이번 Cafe24 해제는
--     "여러 REST delete를 순서대로 호출해 일부만 삭제되는 구조는 쓰지
--     말 것"이라는 요구사항이 있어 그 패턴을 재사용하지 않고, 아래처럼
--     단일 SECURITY DEFINER 함수(=단일 트랜잭션) 하나로 묶는다.
--   - supabase/migrations/20260921100000_orders_privilege_hardening.sql:
--     orders 테이블은 이 저장소에 CREATE TABLE이 없다(마이그레이션 이력
--     이전부터 존재). authenticated는 orders에 SELECT만 가지고 있고
--     INSERT/UPDATE/DELETE 권한이 전혀 없다 — 이 함수가 SECURITY DEFINER가
--     아니면 orders를 지울 방법 자체가 없다.
--   - connected_accounts/integration_credentials/oauth_states/stores도
--     이 저장소에 CREATE TABLE이 없다(마이그레이션 이력 이전부터 존재).
--     이 파일은 그 테이블들의 존재를 확인할 수 없는 컬럼을 추측하지 않고,
--     위 Edge Function들이 실제로 select/insert/update에 쓰는 컬럼명만
--     그대로 재사용한다.
--
-- 삭제 대상(모든 테이블 조건에 provider='cafe24'를 명시):
--   1) integration_credentials — 이 store의 cafe24 connected_accounts.id에
--      연결된 행
--   2) connected_accounts — store_id + provider='cafe24'
--   3) orders — store_id + provider='cafe24'(다른 provider 주문이 같은
--      store_id로 존재할 가능성은 현재 없지만 provider 조건을 이중 방어로
--      명시한다)
--   4) oauth_states — store_id + provider='cafe24'(미사용·만료된 state
--      포함 전부)
--   5) stores.external_store_id를 NULL로 초기화 — stores 행 자체와 다른
--      컬럼(name/platform/store_url/user_id/is_active 등)은 전혀 건드리지
--      않는다.
--
-- 삭제하지 않는 것: stores 행 자체, Meta connected_accounts/
-- integration_credentials(provider='meta'), 다른 store·다른 provider의
-- orders, plans, product_events, ad_margin_links, tool_records, 다른
-- 사용자의 모든 데이터 — 이 함수는 그중 어느 것도 참조하지 않는다.
--
-- 원자성: 삭제 전체를 하나의 PL/pgSQL 함수로 묶는다 — Postgres 함수 본문은
-- 그 자체로 하나의 트랜잭션이므로, 중간에 raise exception이 나면(예:
-- 소유권 확인 실패) 그 안에서 실행된 delete/update가 전혀 없거나 이미
-- 실행된 것까지 전부 롤백된다. 여러 REST 호출로 나눠 부분 실패를 허용하는
-- 구조가 아니다.
--
-- 소유권 재검증: 인자로 user_id를 받지 않는다 — auth.uid()(이 요청을 보낸
-- 세션)와 stores.user_id가 일치하는 행만 `select ... for update`로 잠근
-- 뒤 진행한다. 일치하는 행이 없으면(store 없음 · 다른 사용자 소유) 삭제를
-- 전혀 시도하지 않고 STORE_NOT_FOUND로 즉시 거부한다.
--
-- 동시성 방어와 한계: 위 select ... for update가 이 stores 행에 대한 행
-- 잠금을 함수 트랜잭션이 끝날 때까지 유지한다. cafe24-oauth-callback의
-- 마지막 단계(stores.external_store_id UPDATE)도 같은 행을 잠그려 하므로,
-- 두 작업이 겹치면 하나가 끝난 뒤에야 다른 하나가 진행된다 — 이 함수를
-- 두 번 동시에 호출하는 경우(중복 클릭 등)도 마찬가지로 직렬화된다.
-- 다만 완전한 방어는 아니다: cafe24-oauth-callback의 앞 단계(connected_
-- accounts/integration_credentials에 대한 select·insert/update·upsert)와
-- cafe24-orders-sync 전체(연결 확인 select부터 orders upsert,
-- connected_accounts.last_synced_at update까지)는 stores 행을 전혀 잠그지
-- 않는다. 이 해제 함수가 커밋되기 직전·직후의 좁은 시간창에서 그 요청들과
-- 겹치면, 방금 지운 connected_accounts/integration_credentials 행이
-- 재연결 흐름에 의해 다시 생기거나(사용자가 실제로 재연결을 진행 중이라면
-- 정상적인 결과), 이미 지워진 connected_account_id를 참조하려던 orders-
-- sync의 마지막 갱신이 조용히 0행에 적용되는 정도로 그친다(에러 없이
-- 무시됨 — Supabase의 .update()/.eq()는 매치되는 행이 0개여도 오류를
-- 내지 않는다). 두 Edge Function이 이 잠금에 함께 참여하려면 그 함수들
-- 자체를 수정해야 하는데, 이번 작업 범위(Cafe24 연동 해제 신설)를 벗어나
-- 다루지 않았다 — 거짓으로 "완전히 해결됨"이라 보고하지 않는다.
--
-- 권한: 새로 만드는 함수 하나만 다룬다 — 관련 테이블의 기존 GRANT/RLS는
-- 전혀 건드리지 않는다(SECURITY DEFINER가 이 함수 소유자 권한으로 대신
-- 쓰기를 수행하므로, authenticated의 테이블 권한을 넓힐 필요가 없다 —
-- approve_wholesaler_inquiry 등 기존 관리자 RPC와 같은 원리).
--
-- search_path = ''(완전히 빈 값)로 고정한다 — 이 함수 본문이 참조하는
-- "스키마가 있는" 이름은 auth.uid()와 public.stores/connected_accounts/
-- integration_credentials/orders/oauth_states뿐이고 전부 이미 스키마를
-- 명시했다. 나머지(now(), found, get diagnostics ... row_count)는
-- PostgreSQL 내장 구문이라 search_path가 비어 있어도 정상 동작한다
-- (20260918120000_setup_inquiries_consent_rpc.sql과 같은 근거).
--
-- 적용 후 확인: supabase/verify/cafe24_disconnect_prereq_readonly.sql
-- (information_schema/pg_catalog만 읽는 선행 확인 SQL)과
-- supabase/verify/cafe24_disconnect_verify.sql로 원격 적용 후 실제 동작을
-- 확인한다.
create or replace function public.disconnect_cafe24_integration(
  p_store_id bigint
)
returns table (
  connected_accounts_deleted integer,
  integration_credentials_deleted integer,
  orders_deleted integer,
  oauth_states_deleted integer,
  store_external_id_cleared boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_prev_external_store_id text;
  v_ca_deleted integer := 0;
  v_ic_deleted integer := 0;
  v_orders_deleted integer := 0;
  v_states_deleted integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 소유권 재검증 + 동시성 방어: 이 stores 행을 함수가 끝날 때까지 잠근다.
  -- 다른 사용자의 store_id이거나 존재하지 않으면 아래에서 STORE_NOT_FOUND로
  -- 거부하고 어떤 delete/update도 시도하지 않는다.
  select external_store_id into v_prev_external_store_id
  from public.stores
  where id = p_store_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'STORE_NOT_FOUND';
  end if;

  -- 1) integration_credentials — FK에 ON DELETE CASCADE가 있든 없든 항상
  --    올바르게 동작하도록(meta-disconnect와 같은 이유) connected_accounts
  --    보다 먼저 명시적으로 지운다.
  delete from public.integration_credentials
  where connected_account_id in (
    select id from public.connected_accounts
    where store_id = p_store_id and provider = 'cafe24'
  );
  get diagnostics v_ic_deleted = row_count;

  -- 2) connected_accounts — provider 조건을 명시해 같은 store의 Meta 연결은
  --    절대 건드리지 않는다.
  delete from public.connected_accounts
  where store_id = p_store_id and provider = 'cafe24';
  get diagnostics v_ca_deleted = row_count;

  -- 3) 이 store로 동기화된 Cafe24 주문.
  delete from public.orders
  where store_id = p_store_id and provider = 'cafe24';
  get diagnostics v_orders_deleted = row_count;

  -- 4) 이 store에 남아 있는 Cafe24 OAuth state(미사용·만료 포함 전부).
  delete from public.oauth_states
  where store_id = p_store_id and provider = 'cafe24';
  get diagnostics v_states_deleted = row_count;

  -- 5) Cafe24 연결 전용 식별자만 초기화 — stores 행 자체·다른 컬럼은 유지.
  update public.stores
  set external_store_id = null,
      updated_at = now()
  where id = p_store_id;

  return query
  select
    v_ca_deleted,
    v_ic_deleted,
    v_orders_deleted,
    v_states_deleted,
    (v_prev_external_store_id is not null);
end;
$$;

-- 새로 만든 함수는 기본적으로 PUBLIC(anon 포함)에 EXECUTE가 자동 부여된다
-- — 이 함수는 삭제를 수행하므로 명시적으로 회수한 뒤 authenticated에게만
-- 다시 부여한다(로그인 사용자만 호출 가능, anon 불가).
revoke all on function public.disconnect_cafe24_integration(bigint) from public;
revoke all on function public.disconnect_cafe24_integration(bigint) from anon;
grant execute on function public.disconnect_cafe24_integration(bigint) to authenticated;
