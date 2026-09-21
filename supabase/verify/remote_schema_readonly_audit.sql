-- ============================================================================
-- LaunchDesk 원격 스키마 읽기 전용 감사 — remote_schema_readonly_audit.sql
-- ============================================================================
-- 목적: 아래 두 마이그레이션이 원격 DB에 실제로 반영됐는지, 그리고 이 파일들이
-- 의존하는 기존 객체(setup_inquiries, orders, 관리자/도매처/이벤트 RPC들)가
-- 여전히 그대로인지를 사람이 Supabase SQL Editor에서 한 번 실행해 확인한다.
--   - supabase/migrations/20260918100000_user_policy_consents.sql
--   - supabase/migrations/20260918120000_setup_inquiries_consent_rpc.sql
--
-- 이 파일은 기존 supabase/verify/*.sql(테스트 계정으로 실제 INSERT/RPC 호출을
-- 해보고 BEGIN/ROLLBACK으로 되돌리는 방식)과 성격이 다르다 — 여기서는
-- information_schema/pg_catalog 메타데이터만 SELECT로 읽는다. 테스트 계정
-- UUID가 필요 없고, 실행해도 DB에 어떤 흔적도 남기지 않는다.
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH/SELECT만 사용한다. INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/GRANT/
--     REVOKE/TRUNCATE 문장이 없다. SET/DO/CALL/PERFORM 문장도 없다.
--     (아래 SQL 안에 'INSERT'/'UPDATE'/'DELETE' 같은 대문자 단어가 보이는
--     곳은 전부 privilege_type/cmd 컬럼 값과 비교하는 문자열 리터럴이지,
--     실행되는 쓰기 문장이 아니다.)
--   - SECURITY DEFINER 함수를 실제로 호출하지 않는다(예: select
--     submit_setup_inquiry(...) 같은 실행은 없음) — to_regprocedure/
--     pg_proc/information_schema로 "존재 여부·서명·권한"만 조회한다.
--   - 개인정보·실제 주문 행을 읽지 않는다 — setup_inquiries/orders/
--     user_policy_consents 어디에도 "select * from 테이블"이 없다.
--   - 테이블/함수가 없어도 전체 쿼리가 중단되지 않는다. to_regclass/
--     to_regprocedure는 없으면 예외 대신 NULL을 반환한다. 값이 없을 때
--     행 자체가 사라지지 않도록, 존재 여부가 불확실한 객체를 참조하는
--     모든 CTE는 집계 함수(count/string_agg) 또는 LEFT JOIN + 무조건
--     1행을 보장하는 소스(target_tables/new_fn 등)로만 작성했다.
--
-- 실행 방법: 이 파일 전체를 Supabase SQL Editor에 그대로 붙여넣고 한 번에
-- 실행한다. 결과는 check_name/expected/actual/status 한 개의 표로만 나온다.
-- status: PASS(정상) / FAIL(예상과 다름 — 아래 파일 매핑 참고) /
-- CHECK(이 파일만으로는 정상 여부를 판단할 근거가 없어 참고만 하라는 뜻,
-- 실패 신호 아님).
--
-- ※ 이 파일은 저장소에만 존재한다. 작성한 감사 세션에서는 실제 원격 DB에
--    실행하지 않았다(읽기 전용 조사 지침에 따름 — 실행은 사람이 한다).
-- ============================================================================

with
target_tables as (
  select
    to_regclass('public.user_policy_consents') as upc_oid,
    to_regclass('public.setup_inquiries')      as si_oid,
    to_regclass('public.orders')               as orders_oid
),

-- ---------------------------------------------------------------------------
-- user_policy_consents (20260918100000_user_policy_consents.sql)
-- ---------------------------------------------------------------------------
upc_cols as (
  select count(*) as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'user_policy_consents'
    and column_name in ('id','user_id','terms_version','privacy_version','source','accepted_at')
),
upc_rls as (
  select coalesce(p.relrowsecurity, false) as rls_on
  from target_tables
  left join pg_class p on p.oid = target_tables.upc_oid
),
upc_policy as (
  select
    count(*) as total,
    count(*) filter (where cmd in ('UPDATE','DELETE')) as ud_count
  from pg_policies
  where schemaname = 'public' and tablename = 'user_policy_consents'
),
upc_ins_cols as (
  select string_agg(column_name::text, ',' order by column_name::text) as cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'user_policy_consents'
    and grantee = 'authenticated' and privilege_type = 'INSERT'
),
upc_table_grant_leak as (
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'user_policy_consents'
    and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')
),
upc_anon_leak as (
  select
    (select count(*) from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'user_policy_consents'
        and grantee in ('anon','PUBLIC'))
    +
    (select count(*) from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'user_policy_consents'
        and grantee in ('anon','PUBLIC'))
    as n
),

-- ---------------------------------------------------------------------------
-- submit_setup_inquiry 신구 시그니처 (20260918120000_setup_inquiries_consent_rpc.sql)
-- ---------------------------------------------------------------------------
new_fn as (
  select to_regprocedure('public.submit_setup_inquiry(text,text,text,text,text,boolean)') as oid
),
old_fn as (
  select to_regprocedure('public.submit_setup_inquiry(text,text,text,text,text,boolean,text)') as oid
),
new_fn_meta as (
  select
    p.prosecdef as is_secdef,
    p.prorettype::regtype::text as ret,
    (select e from unnest(p.proconfig) as e where e like 'search_path=%' limit 1) as sp_cfg
  from new_fn
  left join pg_proc p on p.oid = new_fn.oid
),
new_fn_grants as (
  select
    has_function_privilege('anon', (select oid from new_fn), 'execute') as anon_exec,
    has_function_privilege('authenticated', (select oid from new_fn), 'execute') as auth_exec,
    (select count(*) from information_schema.routine_privileges
      where routine_schema = 'public' and routine_name = 'submit_setup_inquiry' and grantee = 'PUBLIC'
    ) as public_grant_n
),

-- ---------------------------------------------------------------------------
-- setup_inquiries 직접 INSERT 차단 + 동의 컬럼 (같은 마이그레이션)
-- ---------------------------------------------------------------------------
si_direct_insert_grant as (
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'setup_inquiries'
    and grantee in ('anon','authenticated') and privilege_type = 'INSERT'
),
si_insert_policy as (
  select count(*) as n
  from pg_policies
  where schemaname = 'public' and tablename = 'setup_inquiries' and cmd = 'INSERT'
),
si_consent_cols as (
  select count(*) as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'setup_inquiries'
    and column_name in ('privacy_consent_version','privacy_consent_at')
),
si_pair_constraint as (
  select count(*) as n
  from pg_constraint, target_tables
  where conrelid = si_oid and conname = 'setup_inquiries_privacy_consent_pair'
),

-- ---------------------------------------------------------------------------
-- orders (저장소에 migration 파일이 없음 — cafe24-orders-sync/index.ts가
-- 실제로 요구하는 컬럼·upsert 대상 제약만 메타데이터로 확인한다)
-- ---------------------------------------------------------------------------
orders_rls as (
  select p.relrowsecurity as rls_on
  from target_tables
  left join pg_class p on p.oid = target_tables.orders_oid
),
-- [2026-09-21 강화 — 1차 감사 P2 "orders 불필요 권한" 후속]
-- 20260921100000_orders_privilege_hardening.sql 적용 후 기대 상태(authenticated=
-- SELECT만, anon/PUBLIC=권한 없음, 정책은 "Users can view own orders" 하나만
-- 그대로 유지)를 참고용(CHECK)이 아니라 실제 PASS/FAIL로 강제한다.
-- (orders_privilege_hardening_verify.sql과 동일한 조회 로직.)
orders_auth_privs as (
  select coalesce(array_agg(privilege_type order by privilege_type), array[]::text[]) as arr
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'orders' and grantee = 'authenticated'
),
orders_anon_public_leak as (
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'orders' and grantee in ('anon','PUBLIC')
),
orders_policy as (
  select
    count(*) as n,
    string_agg(distinct cmd, ',') as cmd_agg,
    string_agg(distinct array_to_string(roles, '|'), ',') as roles_agg,
    string_agg(distinct coalesce(qual, ''), ' || ') as qual_agg
  from pg_policies
  where schemaname = 'public' and tablename = 'orders' and policyname = 'Users can view own orders'
),
orders_req_cols as (
  select count(*) as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'orders'
    and column_name in (
      'store_id','provider','external_order_id','ordered_at',
      'order_status','currency','order_amount','payment_amount',
      'raw_data','updated_at'
    )
),
orders_conflict_key as (
  select count(*) as n
  from pg_constraint, target_tables
  where conrelid = orders_oid and contype in ('u','p')
    and pg_get_constraintdef(oid) ilike '%store_id%'
    and pg_get_constraintdef(oid) ilike '%provider%'
    and pg_get_constraintdef(oid) ilike '%external_order_id%'
),

-- ---------------------------------------------------------------------------
-- 프런트/관리자 화면이 호출하는 나머지 RPC — 이름만 세지 않고 정확한 인자
-- 서명으로 확인한다. 각 서명은 해당 마이그레이션 파일을 직접 읽어 확정했다:
--   set_setup_inquiry_status        <- 20260915200000_setup_inquiries.sql
--   approve/reject_wholesaler_inquiry <- 20260915160000_admin_wholesaler_inquiries.sql
--   update/set_wholesaler_published/delete_wholesaler <- 20260915180000_admin_wholesaler_management.sql
--   admin_member_count/admin_list_members <- 20260915240000_admin_members.sql
--   admin_beta_overview             <- 20260915260000_admin_beta_overview.sql
--   admin_beta_behavior_overview    <- 20260915300000_admin_beta_behavior.sql
--   admin_beta_acquisition_overview / record_user_acquisition <- 20260915320000_user_acquisition.sql
--   track_product_event             <- 20260915280000_product_events.sql (+ 20260916120000 재정의, 동일 서명)
--   is_admin                        <- 20260915140000_admin_users.sql (프런트가 직접 부르진 않지만
--                                       위 SECURITY DEFINER 함수들이 전부 내부에서 쓰는 기반 함수라 포함)
-- ---------------------------------------------------------------------------
rpc_sigs (ord, label, sig) as (
  values
    (1,  'set_setup_inquiry_status',        'public.set_setup_inquiry_status(uuid,text,text)'),
    (2,  'approve_wholesaler_inquiry',       'public.approve_wholesaler_inquiry(uuid,text)'),
    (3,  'reject_wholesaler_inquiry',        'public.reject_wholesaler_inquiry(uuid,text)'),
    (4,  'update_wholesaler',                'public.update_wholesaler(uuid,text,text,text,text,text,text,boolean,boolean,boolean)'),
    (5,  'set_wholesaler_published',         'public.set_wholesaler_published(uuid,boolean)'),
    (6,  'delete_wholesaler',                'public.delete_wholesaler(uuid)'),
    (7,  'admin_member_count',               'public.admin_member_count()'),
    (8,  'admin_list_members',               'public.admin_list_members()'),
    (9,  'admin_beta_overview',              'public.admin_beta_overview()'),
    (10, 'admin_beta_behavior_overview',     'public.admin_beta_behavior_overview()'),
    (11, 'admin_beta_acquisition_overview',  'public.admin_beta_acquisition_overview()'),
    (12, 'track_product_event',              'public.track_product_event(text,uuid,text)'),
    (13, 'record_user_acquisition',          'public.record_user_acquisition(text,text,text,text,text,text)'),
    (14, 'is_admin',                         'public.is_admin()')
),
rpc_check as (
  select ord, label, sig, to_regprocedure(sig) as oid
  from rpc_sigs
)

select check_name, expected, actual, status
from (

  select 1.0 as ord,
         '1. user_policy_consents 테이블 존재' as check_name,
         '존재' as expected,
         case when upc_oid is not null then '존재' else '없음' end as actual,
         case when upc_oid is not null then 'PASS' else 'FAIL' end as status
  from target_tables

  union all
  select 2.0,
         '2. user_policy_consents 필수 컬럼 6개(id/user_id/terms_version/privacy_version/source/accepted_at)',
         '6', n::text,
         case when n = 6 then 'PASS' else 'FAIL' end
  from upc_cols

  union all
  select 3.0, '3. user_policy_consents RLS 활성화', 'true', rls_on::text,
         case when rls_on then 'PASS' else 'FAIL' end
  from upc_rls

  union all
  select 4.1, '4-1. user_policy_consents 정책 개수(select_own + insert_own)', '2', total::text,
         case when total = 2 then 'PASS' else 'FAIL' end
  from upc_policy

  union all
  select 4.2, '4-2. user_policy_consents UPDATE/DELETE 정책 없음', '0', ud_count::text,
         case when ud_count = 0 then 'PASS' else 'FAIL' end
  from upc_policy

  union all
  select 4.3, '4-3. authenticated INSERT 컬럼 권한 = 클라이언트 payload(id/accepted_at 제외)',
         'privacy_version,source,terms_version,user_id', coalesce(cols, '없음'),
         case when cols = 'privacy_version,source,terms_version,user_id' then 'PASS' else 'FAIL' end
  from upc_ins_cols

  union all
  select 4.4, '4-4. authenticated 테이블 단위 INSERT/UPDATE/DELETE 권한 없음', '0', n::text,
         case when n = 0 then 'PASS' else 'FAIL' end
  from upc_table_grant_leak

  union all
  select 4.5, '4-5. anon/PUBLIC에 user_policy_consents 권한 전무', '0', n::text,
         case when n = 0 then 'PASS' else 'FAIL' end
  from upc_anon_leak

  union all
  select 5.1, '5-1. submit_setup_inquiry 신규 6개 인자 시그니처 존재', '존재',
         case when oid is not null then '존재' else '없음' end,
         case when oid is not null then 'PASS' else 'FAIL' end
  from new_fn

  union all
  select 5.2, '5-2. submit_setup_inquiry(6개 인자) SECURITY DEFINER', 'true',
         coalesce(is_secdef::text, '함수 없음'),
         case when is_secdef is true then 'PASS' else 'FAIL' end
  from new_fn_meta

  union all
  select 5.3, '5-3. submit_setup_inquiry(6개 인자) 반환형', 'uuid', coalesce(ret, '함수 없음'),
         case when ret = 'uuid' then 'PASS' else 'FAIL' end
  from new_fn_meta

  union all
  select 5.4, '5-4. submit_setup_inquiry(6개 인자) search_path 빈 값 고정',
         'search_path=(빈 값)', coalesce(sp_cfg, '설정 없음/함수 없음'),
         case
           when sp_cfg is not null and trim(both '"' from substring(sp_cfg from 13)) = '' then 'PASS'
           else 'FAIL'
         end
  from new_fn_meta

  union all
  select 6.0, '6. submit_setup_inquiry 구 7개 인자 시그니처 부재', '없음',
         case when oid is null then '없음' else '존재(oid=' || oid::text || ')' end,
         case when oid is null then 'PASS' else 'FAIL' end
  from old_fn

  union all
  select 7.1, '7-1. submit_setup_inquiry(6개 인자) anon EXECUTE 권한', 'true',
         coalesce(anon_exec::text, '함수 없음'),
         case when anon_exec is true then 'PASS' else 'FAIL' end
  from new_fn_grants

  union all
  select 7.2, '7-2. submit_setup_inquiry(6개 인자) authenticated EXECUTE 권한', 'true',
         coalesce(auth_exec::text, '함수 없음'),
         case when auth_exec is true then 'PASS' else 'FAIL' end
  from new_fn_grants

  union all
  select 7.3, '7-3. submit_setup_inquiry(6개 인자) PUBLIC EXECUTE 권한 없음', '0', public_grant_n::text,
         case when public_grant_n = 0 then 'PASS' else 'FAIL' end
  from new_fn_grants

  union all
  select 8.1, '8-1. setup_inquiries anon/authenticated 테이블 직접 INSERT 권한 없음', '0', n::text,
         case when n = 0 then 'PASS' else 'FAIL' end
  from si_direct_insert_grant

  union all
  select 8.2, '8-2. setup_inquiries INSERT 정책 0개(유일한 쓰기 경로 = RPC)', '0', n::text,
         case when n = 0 then 'PASS' else 'FAIL' end
  from si_insert_policy

  union all
  select 9.1, '9-1. setup_inquiries 동의 증빙 컬럼 2개(privacy_consent_version/at)', '2', n::text,
         case when n = 2 then 'PASS' else 'FAIL' end
  from si_consent_cols

  union all
  select 9.2, '9-2. setup_inquiries_privacy_consent_pair 제약 존재', '존재',
         case when n > 0 then '존재' else '없음' end,
         case when n > 0 then 'PASS' else 'FAIL' end
  from si_pair_constraint

  union all
  select 10.0, '10. orders 테이블 존재(Cafe24 동기화가 의존, 저장소에 migration 파일 없음)',
         '존재', case when orders_oid is not null then '존재' else '없음' end,
         case when orders_oid is not null then 'PASS' else 'FAIL' end
  from target_tables

  union all
  select 11.01, '11-1. orders RLS 활성화(테이블 없으면 판단 불가)', 'true',
         coalesce(rls_on::text, '테이블 없음'),
         case when rls_on is null then 'CHECK'
              when rls_on then 'PASS'
              else 'FAIL' end
  from orders_rls

  union all
  select 11.02, '11-2. authenticated SELECT 권한 존재', 'true',
         ('SELECT' = any(arr))::text,
         case when 'SELECT' = any(arr) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.03, '11-3. authenticated INSERT 권한 부재', 'false',
         ('INSERT' = any(arr))::text,
         case when not ('INSERT' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.04, '11-4. authenticated UPDATE 권한 부재', 'false',
         ('UPDATE' = any(arr))::text,
         case when not ('UPDATE' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.05, '11-5. authenticated DELETE 권한 부재', 'false',
         ('DELETE' = any(arr))::text,
         case when not ('DELETE' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.06, '11-6. authenticated TRUNCATE 권한 부재', 'false',
         ('TRUNCATE' = any(arr))::text,
         case when not ('TRUNCATE' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.07, '11-7. authenticated REFERENCES 권한 부재', 'false',
         ('REFERENCES' = any(arr))::text,
         case when not ('REFERENCES' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.08, '11-8. authenticated TRIGGER 권한 부재', 'false',
         ('TRIGGER' = any(arr))::text,
         case when not ('TRIGGER' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 11.09, '11-9. anon/PUBLIC에 orders 권한 전무', '0', n::text,
         case when n = 0 then 'PASS' else 'FAIL' end
  from orders_anon_public_leak

  union all
  select 11.10, '11-10. "Users can view own orders" 정책 존재 + SELECT + authenticated 대상',
         '존재/SELECT/authenticated 포함',
         case when n = 1 then coalesce(cmd_agg, '') || '/' || coalesce(roles_agg, '') else '정책 없음' end,
         case when n = 1 and cmd_agg = 'SELECT' and roles_agg ilike '%authenticated%' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 11.11, '11-11. 정책 조건에 stores 조인(stores.id = orders.store_id) 포함', '포함',
         case when qual_agg ilike '%stores.id%' and qual_agg ilike '%orders.store_id%' then '포함'
              else coalesce(qual_agg, '정책 없음') end,
         case when qual_agg ilike '%stores.id%' and qual_agg ilike '%orders.store_id%' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 11.12, '11-12. 정책 조건에 본인 소유 확인(stores.user_id = auth.uid()) 포함', '포함',
         case when qual_agg ilike '%stores.user_id%' and qual_agg ilike '%auth.uid()%' then '포함'
              else coalesce(qual_agg, '정책 없음') end,
         case when qual_agg ilike '%stores.user_id%' and qual_agg ilike '%auth.uid()%' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 11.13, '11-13. 정책 조건 원문(참고용, 육안 확인)', '(참고용)', coalesce(qual_agg, '정책 없음'), 'CHECK'
  from orders_policy

  union all
  select 12.1, '12-1. Cafe24 동기화가 요구하는 orders 컬럼 10개 존재', '10', n::text,
         case when n = 10 then 'PASS' else 'FAIL' end
  from orders_req_cols

  union all
  select 12.2, '12-2. orders (store_id,provider,external_order_id) unique/PK 제약(upsert onConflict 대상)',
         '존재', case when n > 0 then '존재' else '없음' end,
         case when n > 0 then 'PASS' else 'FAIL' end
  from orders_conflict_key

  union all
  select 13.0 + (ord::numeric / 100),
         '13-' || ord || '. RPC 정확한 서명 존재: ' || label || ' — ' || sig,
         '존재',
         case when oid is not null then '존재' else '없음' end,
         case when oid is not null then 'PASS' else 'FAIL' end
  from rpc_check

) t
order by ord;
