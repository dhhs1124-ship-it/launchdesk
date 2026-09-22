-- ============================================================================
-- ⚠ 이 파일은 읽기 전용이 아니다 — 지금 바로 실행하지 말 것 ⚠
-- Cafe24 연동 해제 RPC "동작(runtime)" 검증 — 전용 테스트 계정 2개를 준비한
-- 뒤에만 사람이 직접 실행하는 파일이다.
-- ============================================================================
-- 이 파일이 실제로 하는 일(정보 조회만 하는 cafe24_disconnect_prereq_
-- readonly.sql · cafe24_disconnect_post_apply_readonly.sql과 다름):
--   - public.stores / connected_accounts / integration_credentials / orders /
--     oauth_states에 실제 INSERT를 여러 번 실행한다(테스트 전용 마커가 붙은
--     합성 행이지만, 실행 중에는 진짜 테이블에 진짜 행으로 존재한다).
--   - disconnect_cafe24_integration() RPC를 실제로 호출해 그 INSERT한 행들을
--     진짜 DELETE/UPDATE한다.
--   - 전체가 BEGIN ~ ROLLBACK 한 트랜잭션 안에서만 실행되므로 정상 종료되면
--     흔적이 남지 않지만, 트랜잭션 도중 연결이 끊기거나 ROLLBACK 대신 COMMIT
--     을 실행하면(또는 파일 뒷부분을 잘라서 실행하면) 합성 데이터가 실제로
--     남을 수 있다 — "읽기 전용"이 아니다.
--   - postgres 역할로 set local role anon/authenticated 전환과 request.jwt.
--     claims 조작이 필요하다(Supabase Studio SQL 편집기 또는 postgres 역할
--     psql에서만 실행 가능).
--
-- 그래서 이 파일은:
--   - 마이그레이션(20260922120000_cafe24_disconnect.sql) 적용 "직후" 바로
--     실행하는 파일이 아니다 — 그 용도는 cafe24_disconnect_post_apply_
--     readonly.sql(순수 카탈로그 조회, 쓰기 없음)이 담당한다.
--   - 아래 "테스트 계정 A/B"에 실제 서비스 계정이 아닌, 이 목적으로만 쓰는
--     전용 테스트 계정의 UUID를 준비한 뒤에만 실행한다.
--   - 실제 삭제 동작(연결 해제)을 눈으로 확인하고 싶을 때, 사람이 그 준비가
--     끝난 시점에 직접 실행 여부를 결정한다 — 자동 실행되지 않는다.
--
-- 목적(전용 테스트 계정 준비가 끝난 뒤 이 항목들을 실제로 검증한다)
--   0) disconnect_cafe24_integration(bigint)이 SECURITY DEFINER · search_path
--      = ''(빈 값)로 고정돼 있고, PUBLIC/anon 실행 권한이 없으며 authenticated
--      에게만 EXECUTE가 부여됐는지
--   1) anon은 RPC 호출 자체가 거부되는지(EXECUTE 권한 없음)
--   2) 다른 사용자(B)가 A의 store_id로 호출하면 STORE_NOT_FOUND로 거부되고
--      A의 데이터가 전혀 삭제되지 않는지
--   3) 존재하지 않는 store_id로 호출해도 STORE_NOT_FOUND로 거부되는지
--   4) 정상 소유자(A)가 자신의 Cafe24 store_id로 호출하면:
--      - integration_credentials(cafe24) 1건, connected_accounts(cafe24) 1건,
--        orders(cafe24) 2건, oauth_states(cafe24) 1건이 삭제되고
--      - stores.external_store_id가 NULL로 바뀌며 stores 행 자체
--        (name/platform/store_url/user_id/is_active)는 그대로 남는지
--      - 반환값(삭제 개수)이 실제 삭제된 행 수와 정확히 일치하는지
--   5) 같은 store의 Meta connected_accounts/integration_credentials,
--      Meta oauth_states, 다른 store/provider의 orders, 다른 사용자(B)의
--      모든 데이터가 전혀 건드려지지 않았는지
--   6) 같은 요청을 다시 호출해도(idempotent) 오류 없이 전부 0건을 반환하고
--      상태가 그대로인지
--
-- 실행 조건
--   - Supabase Studio SQL 편집기(postgres 역할) 또는 postgres 역할 psql.
--   - 아래 "테스트 계정" 두 개(A, B)에 테스트 전용 계정 UUID를 반드시
--     넣는다. 실제 사용 중인 계정을 넣지 않는다.
--   - 이 트랜잭션 안에서 만든 stores/connected_accounts/integration_
--     credentials/orders/oauth_states 행은 전부 이번 실행 전용 마커로만
--     식별해 조회하고, 마지막 ROLLBACK으로 전부 사라진다 — 실제 데이터에는
--     어떤 흔적도 남지 않는다.
--   - 어떤 검증이라도 실패하면 RAISE EXCEPTION으로 즉시 멈추고 트랜잭션
--     전체가 롤백된다. 메시지의 "FAIL:" 항목을 본다.
--
-- 실행 방법: 파일 전체를 한 번에 실행한다(BEGIN ~ ROLLBACK이 한 묶음).
-- ============================================================================

begin;

-- ---------------------------------------------------------------- 테스트 계정 (반드시 수정)
select set_config('v.user_a', 'PUT-TEST-USER-A-UUID-HERE', true);
select set_config('v.user_b', 'PUT-TEST-USER-B-UUID-HERE', true);

do $$
declare
  re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  a_txt text := current_setting('v.user_a', true);
  b_txt text := current_setting('v.user_b', true);
begin
  if a_txt is null or a_txt !~* re or b_txt is null or b_txt !~* re then
    raise exception 'FAIL: v.user_a/v.user_b에 서로 다른 테스트 계정의 UUID를 지정하세요.';
  end if;
  if a_txt = b_txt then
    raise exception 'FAIL: v.user_a와 v.user_b는 서로 다른 계정이어야 합니다.';
  end if;
  if not exists (select 1 from auth.users where id = a_txt::uuid)
     or not exists (select 1 from auth.users where id = b_txt::uuid) then
    raise exception 'FAIL: 테스트 계정이 auth.users에 없습니다.';
  end if;
  raise notice 'OK: 테스트 계정 A/B 확인(auth.users에 존재)';
end $$;

-- 이번 실행 전용 마커 — 이번 트랜잭션이 만든 행만 정확히 골라내기 위함.
select set_config('v.marker', 'ldcv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), true);

-- ---------------------------------------------------------------- 0) 함수 구조 확인 (postgres)
do $$
declare
  fn_oid oid;
  p record;
  cfg text;
begin
  fn_oid := to_regprocedure('public.disconnect_cafe24_integration(bigint)');
  if fn_oid is null then raise exception 'FAIL: disconnect_cafe24_integration(bigint) 함수가 없습니다(마이그레이션 미적용).'; end if;

  select prosecdef, proconfig into p from pg_proc where oid = fn_oid;
  if p.prosecdef is distinct from true then raise exception 'FAIL: SECURITY DEFINER가 아닙니다.'; end if;

  select e into cfg from unnest(p.proconfig) as e where e like 'search_path=%' limit 1;
  if cfg is null then raise exception 'FAIL: search_path 설정이 없습니다.'; end if;
  if trim(both '"' from substring(cfg from 13)) <> '' then
    raise exception 'FAIL: search_path 값이 빈 문자열이 아닙니다(%).', cfg;
  end if;
  raise notice 'OK: search_path = ''''(빈 값)로 고정 — %', cfg;

  if has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'FAIL: anon에 EXECUTE 권한이 남아 있습니다.';
  end if;
  if not has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'FAIL: authenticated에 EXECUTE 권한이 없습니다.';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'disconnect_cafe24_integration' and grantee = 'PUBLIC'
  ) then
    raise exception 'FAIL: PUBLIC EXECUTE 권한이 남아 있습니다.';
  end if;
  raise notice 'OK: authenticated만 EXECUTE 가능, anon/PUBLIC 없음';
end $$;

-- ---------------------------------------------------------------- 1) 테스트 데이터 구성 (postgres — RLS 우회)
do $$
declare
  m text := current_setting('v.marker', true);
  a uuid := current_setting('v.user_a', true)::uuid;
  b uuid := current_setting('v.user_b', true)::uuid;
  store_a_cafe24 bigint;
  store_a_other bigint;
  store_b bigint;
  ca_cafe24 bigint;
  ca_meta bigint;
begin
  -- A 소유: Cafe24 매장(해제 대상) + 완전히 다른 매장(다른 provider 주문 보존 확인용)
  insert into public.stores (user_id, name, platform, store_url, is_active, external_store_id)
    values (a, m || '-storeA-cafe24', 'cafe24', 'https://' || m || '-a.example.com', true, m || '-mallid')
    returning id into store_a_cafe24;
  insert into public.stores (user_id, name, platform, store_url, is_active)
    values (a, m || '-storeA-other', 'other', 'https://' || m || '-a2.example.com', true)
    returning id into store_a_other;
  -- B 소유: 완전히 다른 사용자의 Cafe24 매장(교차 사용자 격리 확인용)
  insert into public.stores (user_id, name, platform, store_url, is_active, external_store_id)
    values (b, m || '-storeB-cafe24', 'cafe24', 'https://' || m || '-b.example.com', true, m || '-mallid-b')
    returning id into store_b;

  perform set_config('v.store_a_cafe24', store_a_cafe24::text, true);
  perform set_config('v.store_a_other', store_a_other::text, true);
  perform set_config('v.store_b', store_b::text, true);

  -- A의 Cafe24 연결 + Meta 연결(둘 다 남아 있어야 하는 것과 지워져야 하는 것 대조용)
  insert into public.connected_accounts (store_id, provider, external_account_id, display_name, status, connected_at)
    values (store_a_cafe24, 'cafe24', m || '-mallid', m || '-mallid', 'connected', now())
    returning id into ca_cafe24;
  insert into public.connected_accounts (store_id, provider, external_account_id, display_name, status, connected_at)
    values (store_a_cafe24, 'meta', m || '-adacct', m || '-adacct', 'connected', now())
    returning id into ca_meta;
  -- B의 Cafe24 연결(절대 건드려지면 안 됨)
  insert into public.connected_accounts (store_id, provider, external_account_id, display_name, status, connected_at)
    values (store_b, 'cafe24', m || '-mallid-b', m || '-mallid-b', 'connected', now());

  perform set_config('v.ca_cafe24', ca_cafe24::text, true);
  perform set_config('v.ca_meta', ca_meta::text, true);

  insert into public.integration_credentials (connected_account_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, updated_at)
    values (ca_cafe24, m || '-token-cafe24', m || '-refresh-cafe24', now() + interval '1 hour', now() + interval '30 day', now());
  insert into public.integration_credentials (connected_account_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, updated_at)
    values (ca_meta, m || '-token-meta', m || '-refresh-meta', now() + interval '1 hour', now() + interval '30 day', now());

  -- A의 Cafe24 주문 2건(삭제 대상) + A의 다른 매장(같은 provider='cafe24')
  -- 주문 1건(보존 대상 — store_id 조건이 실제로 적용되는지까지 확인)
  insert into public.orders (store_id, provider, external_order_id, ordered_at, order_status, currency, order_amount, payment_amount, raw_data, updated_at)
    values (store_a_cafe24, 'cafe24', m || '-order-1', now(), 'N40', 'KRW', 10000, 10000, '{}'::jsonb, now());
  insert into public.orders (store_id, provider, external_order_id, ordered_at, order_status, currency, order_amount, payment_amount, raw_data, updated_at)
    values (store_a_cafe24, 'cafe24', m || '-order-2', now(), 'N40', 'KRW', 20000, 20000, '{}'::jsonb, now());
  insert into public.orders (store_id, provider, external_order_id, ordered_at, order_status, currency, order_amount, payment_amount, raw_data, updated_at)
    values (store_a_other, 'cafe24', m || '-order-3', now(), 'N40', 'KRW', 30000, 30000, '{}'::jsonb, now());

  -- A의 Cafe24 oauth_state(삭제 대상) + 같은 매장의 Meta oauth_state(보존 대상)
  insert into public.oauth_states (user_id, store_id, provider, mall_id)
    values (a, store_a_cafe24, 'cafe24', m || '-mallid');
  insert into public.oauth_states (user_id, store_id, provider, mall_id)
    values (a, store_a_cafe24, 'meta', null);

  raise notice 'OK: 테스트 데이터 구성 완료(marker=%)', m;
end $$;

-- ---------------------------------------------------------------- 2) anon — 호출 자체가 거부
set local role anon;
do $$
begin
  begin
    perform public.disconnect_cafe24_integration(current_setting('v.store_a_cafe24', true)::bigint);
    raise exception 'FAIL: anon이 disconnect_cafe24_integration을 호출할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: anon 호출 거부(EXECUTE 권한 없음)';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- 3) B가 A의 store_id로 호출 — 거부, A 데이터 그대로
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_b', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_b', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  m text := current_setting('v.marker', true);
  ca_cnt int;
begin
  if auth.uid() is distinct from current_setting('v.user_b', true)::uuid then
    raise exception 'FAIL: auth.uid()가 사용자 B가 아닙니다(NULL 포함).';
  end if;
  begin
    perform public.disconnect_cafe24_integration(current_setting('v.store_a_cafe24', true)::bigint);
    raise exception 'FAIL: B가 A 소유의 store_id로 해제를 실행할 수 있었습니다.';
  exception when others then
    if sqlerrm <> 'STORE_NOT_FOUND' then
      raise exception 'FAIL: 예상과 다른 오류(%): %', sqlstate, sqlerrm;
    end if;
    raise notice 'OK: 다른 사용자(B)의 호출은 STORE_NOT_FOUND로 거부됨';
  end;

  select count(*) into ca_cnt from public.connected_accounts
   where store_id = current_setting('v.store_a_cafe24', true)::bigint and provider = 'cafe24';
  if ca_cnt <> 1 then raise exception 'FAIL: B의 실패한 호출 이후 A의 cafe24 connected_accounts 행 수가 변했습니다(%).', ca_cnt; end if;
end $$;

-- 존재하지 않는 store_id도 STORE_NOT_FOUND
do $$
begin
  begin
    perform public.disconnect_cafe24_integration(-9223372036854775808);
    raise exception 'FAIL: 존재하지 않는 store_id 호출이 성공했습니다.';
  exception when others then
    if sqlerrm <> 'STORE_NOT_FOUND' then raise exception 'FAIL: 예상과 다른 오류(%): %', sqlstate, sqlerrm; end if;
    raise notice 'OK: 존재하지 않는 store_id도 STORE_NOT_FOUND';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- 4) A 본인 호출 — 실제 삭제 + 반환값 확인
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  r record;
begin
  if auth.uid() is distinct from current_setting('v.user_a', true)::uuid then
    raise exception 'FAIL: auth.uid()가 사용자 A가 아닙니다(NULL 포함).';
  end if;
  select * into r from public.disconnect_cafe24_integration(current_setting('v.store_a_cafe24', true)::bigint);
  if r.connected_accounts_deleted <> 1 then raise exception 'FAIL: connected_accounts_deleted=% (기대값 1)', r.connected_accounts_deleted; end if;
  if r.integration_credentials_deleted <> 1 then raise exception 'FAIL: integration_credentials_deleted=% (기대값 1)', r.integration_credentials_deleted; end if;
  if r.orders_deleted <> 2 then raise exception 'FAIL: orders_deleted=% (기대값 2)', r.orders_deleted; end if;
  if r.oauth_states_deleted <> 1 then raise exception 'FAIL: oauth_states_deleted=% (기대값 1)', r.oauth_states_deleted; end if;
  if r.store_external_id_cleared is distinct from true then raise exception 'FAIL: store_external_id_cleared=% (기대값 true)', r.store_external_id_cleared; end if;
  raise notice 'OK: 1회차 호출 반환값 정확 — ca=1 ic=1 orders=2 states=1 cleared=true';
end $$;
reset role;

-- ---------------------------------------------------------------- 5) 실제 삭제 범위 확인 (postgres)
do $$
declare
  m text := current_setting('v.marker', true);
  n int;
  ext text;
  nm text;
begin
  if exists (select 1 from public.connected_accounts where store_id = current_setting('v.store_a_cafe24', true)::bigint and provider = 'cafe24') then
    raise exception 'FAIL: A의 cafe24 connected_accounts가 남아 있습니다.';
  end if;
  if exists (select 1 from public.integration_credentials where connected_account_id = current_setting('v.ca_cafe24', true)::bigint) then
    raise exception 'FAIL: A의 cafe24 integration_credentials가 남아 있습니다.';
  end if;
  if exists (select 1 from public.orders where store_id = current_setting('v.store_a_cafe24', true)::bigint and provider = 'cafe24') then
    raise exception 'FAIL: A의 cafe24 orders가 남아 있습니다.';
  end if;
  if exists (select 1 from public.oauth_states where store_id = current_setting('v.store_a_cafe24', true)::bigint and provider = 'cafe24') then
    raise exception 'FAIL: A의 cafe24 oauth_states가 남아 있습니다.';
  end if;

  select external_store_id, name into ext, nm from public.stores where id = current_setting('v.store_a_cafe24', true)::bigint;
  if ext is not null then raise exception 'FAIL: stores.external_store_id가 NULL로 초기화되지 않았습니다(%).', ext; end if;
  if nm <> m || '-storeA-cafe24' then raise exception 'FAIL: stores 행 자체(name)가 훼손되었습니다.'; end if;
  raise notice 'OK: 대상 데이터 전부 삭제, stores 행/이름은 그대로, external_store_id만 NULL';

  -- 보존 대상 — Meta 연결
  if not exists (select 1 from public.connected_accounts where id = current_setting('v.ca_meta', true)::bigint and provider = 'meta') then
    raise exception 'FAIL: 같은 store의 Meta connected_accounts가 사라졌습니다.';
  end if;
  if not exists (select 1 from public.integration_credentials where connected_account_id = current_setting('v.ca_meta', true)::bigint) then
    raise exception 'FAIL: 같은 store의 Meta integration_credentials가 사라졌습니다.';
  end if;
  if not exists (select 1 from public.oauth_states where store_id = current_setting('v.store_a_cafe24', true)::bigint and provider = 'meta') then
    raise exception 'FAIL: 같은 store의 Meta oauth_state가 사라졌습니다.';
  end if;

  -- 보존 대상 — 다른 매장 주문, 다른 사용자(B)의 모든 데이터
  select count(*) into n from public.orders where store_id = current_setting('v.store_a_other', true)::bigint and provider = 'cafe24';
  if n <> 1 then raise exception 'FAIL: A의 다른 매장(같은 provider) 주문이 훼손되었습니다(%) — store_id 조건 누락 의심.', n; end if;

  select count(*) into n from public.connected_accounts where store_id = current_setting('v.store_b', true)::bigint and provider = 'cafe24';
  if n <> 1 then raise exception 'FAIL: B의 cafe24 connected_accounts가 훼손되었습니다(%).', n; end if;

  select count(*) into n from public.stores where id = current_setting('v.store_b', true)::bigint;
  if n <> 1 then raise exception 'FAIL: B의 store 행이 훼손되었습니다.'; end if;

  raise notice 'OK: Meta 연결·다른 매장 주문·다른 사용자(B) 데이터 전부 보존됨';
end $$;

-- ---------------------------------------------------------------- 6) 같은 요청 재호출 — idempotent
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  r record;
begin
  select * into r from public.disconnect_cafe24_integration(current_setting('v.store_a_cafe24', true)::bigint);
  if r.connected_accounts_deleted <> 0 or r.integration_credentials_deleted <> 0
     or r.orders_deleted <> 0 or r.oauth_states_deleted <> 0
     or r.store_external_id_cleared is distinct from false then
    raise exception 'FAIL: 2회차(idempotent) 호출의 반환값이 전부 0/false가 아닙니다 — %', r;
  end if;
  raise notice 'OK: 2회차 호출은 오류 없이 전부 0건 반환(idempotent)';
end $$;
reset role;

do $$ begin raise notice 'ALL CHECKS PASSED — Cafe24 연동 해제 RPC 검증 완료'; end $$;

rollback;
