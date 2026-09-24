-- 적용 후 읽기 전용 정의 확인. 실제 발송·데이터 조회·함수 호출 없음.
with target as (
  select to_regclass('public.contact_inquiry_rate_limits') as limits_table_oid,
         to_regclass('public.contact_inquiry_deliveries') as deliveries_table_oid,
         to_regprocedure('public.claim_contact_inquiry_attempt(text, text)') as claim_fn_oid,
         to_regprocedure('public.release_contact_inquiry_reservation(text, text)') as release_fn_oid,
         to_regprocedure('public.record_contact_inquiry_delivery(uuid, text)') as record_fn_oid,
         to_regprocedure('public.contact_inquiry_already_delivered(uuid, text)') as already_fn_oid
), checks as (
  select 'limits_table_exists' as check_name,
         (limits_table_oid is not null) as passed from target
  union all
  select 'limits_rls_enabled',
         coalesce((select c.relrowsecurity from pg_class c where c.oid = limits_table_oid), false) from target
  union all
  select 'limits_anon_access_denied',
         coalesce(not has_table_privilege('anon', limits_table_oid, 'SELECT,INSERT,UPDATE,DELETE'), false) from target
  union all
  select 'limits_authenticated_access_denied',
         coalesce(not has_table_privilege('authenticated', limits_table_oid, 'SELECT,INSERT,UPDATE,DELETE'), false) from target
  union all
  select 'deliveries_table_exists',
         (deliveries_table_oid is not null) from target
  union all
  select 'deliveries_rls_enabled',
         coalesce((select c.relrowsecurity from pg_class c where c.oid = deliveries_table_oid), false) from target
  union all
  select 'deliveries_anon_access_denied',
         coalesce(not has_table_privilege('anon', deliveries_table_oid, 'SELECT,INSERT,UPDATE,DELETE'), false) from target
  union all
  select 'deliveries_authenticated_access_denied',
         coalesce(not has_table_privilege('authenticated', deliveries_table_oid, 'SELECT,INSERT,UPDATE,DELETE'), false) from target
  union all
  select 'claim_fn_exists', (claim_fn_oid is not null) from target
  union all
  select 'claim_fn_anon_denied',
         coalesce(not has_function_privilege('anon', claim_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'claim_fn_authenticated_denied',
         coalesce(not has_function_privilege('authenticated', claim_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'claim_fn_service_role_access',
         coalesce(has_function_privilege('service_role', claim_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'release_fn_exists', (release_fn_oid is not null) from target
  union all
  select 'release_fn_anon_denied',
         coalesce(not has_function_privilege('anon', release_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'release_fn_authenticated_denied',
         coalesce(not has_function_privilege('authenticated', release_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'release_fn_service_role_access',
         coalesce(has_function_privilege('service_role', release_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'record_fn_exists', (record_fn_oid is not null) from target
  union all
  select 'record_fn_anon_denied',
         coalesce(not has_function_privilege('anon', record_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'record_fn_authenticated_denied',
         coalesce(not has_function_privilege('authenticated', record_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'record_fn_service_role_access',
         coalesce(has_function_privilege('service_role', record_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'already_delivered_fn_exists', (already_fn_oid is not null) from target
  union all
  select 'already_delivered_fn_anon_denied',
         coalesce(not has_function_privilege('anon', already_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'already_delivered_fn_authenticated_denied',
         coalesce(not has_function_privilege('authenticated', already_fn_oid, 'EXECUTE'), false) from target
  union all
  select 'already_delivered_fn_service_role_access',
         coalesce(has_function_privilege('service_role', already_fn_oid, 'EXECUTE'), false) from target
)
select check_name, case when passed then 'PASS' else 'FAIL' end as status
from checks
order by check_name;
