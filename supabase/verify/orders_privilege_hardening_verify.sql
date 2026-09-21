-- ============================================================================
-- orders 권한 최소화 검증 — orders_privilege_hardening_verify.sql
-- 20260921100000_orders_privilege_hardening.sql 적용 "후" 실제 DB에서 실행
-- ============================================================================
-- 목적: authenticated가 public.orders에서 SELECT만 가지고 있는지, anon/
-- PUBLIC은 아무 권한도 없는지, 기존 RLS·"Users can view own orders" 정책이
-- (건드리지 않았으므로) 그대로 남아 자기 주문만 허용하는지를 확인한다.
--
-- 다른 supabase/verify/*.sql(테스트 계정으로 실제 INSERT/RPC를 해보고
-- BEGIN/ROLLBACK으로 되돌리는 방식)과 달리, 이 파일은 정적 권한/정책
-- 정의만 확인하면 충분하므로 테스트 계정 없이 information_schema/
-- pg_catalog 메타데이터만 읽는다 — 실제 주문 행(개인정보 포함 가능)은
-- 전혀 조회하지 않는다. WITH/SELECT만 사용하며 INSERT/UPDATE/DELETE/
-- ALTER/CREATE/DROP/GRANT/REVOKE/TRUNCATE 문장이 없다.
--
-- 실행 방법: 이 파일 전체를 Supabase SQL Editor에 그대로 붙여넣고 한 번에
-- 실행한다. 결과는 check_name/expected/actual/status 한 개의 표로 나온다.
-- status: PASS(정상) / FAIL(예상과 다름 — 20260921100000_orders_privilege_
-- hardening.sql을 다시 확인) / CHECK(참고용, 실패 신호 아님).
--
-- ※ 이 파일은 저장소에만 존재한다. 작성한 감사 세션에서는 실제 원격 DB에
--    실행하지 않았다(읽기 전용 조사 지침에 따름 — 실행은 사람이 한다).
-- ============================================================================

with
orders_tbl as (
  select to_regclass('public.orders') as oid
),
orders_rls as (
  select p.relrowsecurity as rls_on
  from orders_tbl
  left join pg_class p on p.oid = orders_tbl.oid
),
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
)

select check_name, expected, actual, status
from (

  select 1.0 as ord, '1. orders 테이블 존재' as check_name, '존재' as expected,
         case when oid is not null then '존재' else '없음' end as actual,
         case when oid is not null then 'PASS' else 'FAIL' end as status
  from orders_tbl

  union all
  select 2.0, '2. orders RLS 활성화', 'true', coalesce(rls_on::text, '테이블 없음'),
         case when rls_on is null then 'CHECK' when rls_on then 'PASS' else 'FAIL' end
  from orders_rls

  union all
  select 3.0, '3. authenticated SELECT 권한 존재', 'true',
         ('SELECT' = any(arr))::text,
         case when 'SELECT' = any(arr) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 4.1, '4-1. authenticated INSERT 권한 부재', 'false',
         ('INSERT' = any(arr))::text,
         case when not ('INSERT' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 4.2, '4-2. authenticated UPDATE 권한 부재', 'false',
         ('UPDATE' = any(arr))::text,
         case when not ('UPDATE' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 4.3, '4-3. authenticated DELETE 권한 부재', 'false',
         ('DELETE' = any(arr))::text,
         case when not ('DELETE' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 4.4, '4-4. authenticated TRUNCATE 권한 부재', 'false',
         ('TRUNCATE' = any(arr))::text,
         case when not ('TRUNCATE' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 4.5, '4-5. authenticated REFERENCES 권한 부재', 'false',
         ('REFERENCES' = any(arr))::text,
         case when not ('REFERENCES' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 4.6, '4-6. authenticated TRIGGER 권한 부재', 'false',
         ('TRIGGER' = any(arr))::text,
         case when not ('TRIGGER' = any(arr)) then 'PASS' else 'FAIL' end
  from orders_auth_privs

  union all
  select 5.0, '5. anon/PUBLIC에 orders 권한 전무', '0', n::text,
         case when n = 0 then 'PASS' else 'FAIL' end
  from orders_anon_public_leak

  union all
  select 6.1, '6-1. "Users can view own orders" 정책 존재', '1', n::text,
         case when n = 1 then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 6.2, '6-2. 위 정책이 SELECT 명령 대상', 'SELECT', coalesce(cmd_agg, '정책 없음'),
         case when cmd_agg = 'SELECT' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 6.3, '6-3. 위 정책이 authenticated 대상 포함', 'true',
         case when roles_agg ilike '%authenticated%' then 'true' else coalesce(roles_agg, '정책 없음') end,
         case when roles_agg ilike '%authenticated%' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 7.1, '7-1. 정책 조건에 stores 조인(stores.id = orders.store_id) 포함', '포함',
         case when qual_agg ilike '%stores.id%' and qual_agg ilike '%orders.store_id%' then '포함'
              else coalesce(qual_agg, '정책 없음') end,
         case when qual_agg ilike '%stores.id%' and qual_agg ilike '%orders.store_id%' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 7.2, '7-2. 정책 조건에 본인 소유 확인(stores.user_id = auth.uid()) 포함', '포함',
         case when qual_agg ilike '%stores.user_id%' and qual_agg ilike '%auth.uid()%' then '포함'
              else coalesce(qual_agg, '정책 없음') end,
         case when qual_agg ilike '%stores.user_id%' and qual_agg ilike '%auth.uid()%' then 'PASS' else 'FAIL' end
  from orders_policy

  union all
  select 7.3, '7-3. 정책 조건 원문(참고용, 육안 확인)', '(참고용)', coalesce(qual_agg, '정책 없음'), 'CHECK'
  from orders_policy

) t
order by ord;
