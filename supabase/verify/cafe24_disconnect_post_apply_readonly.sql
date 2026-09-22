-- ============================================================================
-- LaunchDesk Cafe24 연동 해제 — 마이그레이션 적용 "직후" 읽기 전용 구조 확인
-- 파일: cafe24_disconnect_post_apply_readonly.sql
-- ============================================================================
-- [2026-09-22] cafe24_disconnect_prereq_readonly.sql(적용 "전" 스키마 선행
-- 확인)의 실제 원격 실행 결과, disconnect_cafe24_integration()이 의존하는
-- 5개 테이블·컬럼·FK(전부 ON DELETE CASCADE 확인됨)가 전부 PASS로 확인됐다.
-- 이 파일은 그 다음 단계 — 20260922120000_cafe24_disconnect.sql을 적용한
-- "직후" 새로 만들어진 함수 자체가 의도한 모양(인자·반환 타입·SECURITY
-- DEFINER·search_path·GRANT/REVOKE)대로 실제로 만들어졌는지만 확인한다.
--
-- cafe24_disconnect_verify.sql과 다르다: 그 파일은 실제 stores/connected_
-- accounts/integration_credentials/orders/oauth_states에 진짜 INSERT·
-- DELETE·UPDATE를 실행하는(BEGIN~ROLLBACK으로 되돌리는) "동작 검증" 파일이라
-- 전용 테스트 계정 2개가 준비된 뒤에만 사람이 실행해야 한다. 이 파일은 그와
-- 정반대로 오직 pg_catalog/information_schema 메타데이터만 읽고, 어떤
-- 사용자 테이블에도 SELECT조차 하지 않는다 — 마이그레이션을 적용한 바로
-- 그 순간, 테스트 계정 준비 여부와 무관하게 안전하게 바로 실행할 수 있다.
--
-- 확인 항목:
--   01) public.disconnect_cafe24_integration(bigint) 함수 존재
--   02) 인자 시그니처 = p_store_id bigint
--   03) 반환 타입 = TABLE(connected_accounts_deleted integer,
--       integration_credentials_deleted integer, orders_deleted integer,
--       oauth_states_deleted integer, store_external_id_cleared boolean)
--   04) SECURITY DEFINER
--   05) search_path가 빈 값('')으로 고정됨
--   06) 실행 권한 — anon 없음 / authenticated 있음 / PUBLIC에 남아있지 않음
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH ... SELECT 한 문장뿐이다. INSERT/UPDATE/DELETE/ALTER/CREATE/
--     DROP/GRANT/REVOKE/TRUNCATE/COPY/SET/DO/CALL/PERFORM/EXECUTE 문장이
--     없다.
--   - public.stores/connected_accounts/integration_credentials/orders/
--     oauth_states 등 사용자 테이블은 이 파일 어디에도 등장하지 않는다 —
--     오직 pg_proc/pg_catalog/information_schema.routine_privileges만
--     조회한다.
--   - 함수를 실제로 호출(perform/select disconnect_cafe24_integration(...))
--     하지 않는다 — 서명·보안 옵션만 카탈로그로 조회한다.
--   - 함수/권한이 없어도 전체 쿼리가 중단되지 않고, 그 검사의 결과 행도
--     사라지지 않는다(모든 검사가 스칼라 서브쿼리 기반이라 대상이 없으면
--     coalesce로 MISSING/FAIL 표시만 될 뿐 행 자체는 항상 나온다).
--
-- 실행 방법: 이 파일 전체를 Supabase SQL Editor에 그대로 붙여넣고 한 번에
-- 실행한다. 결과는 ord/check_name/expected/actual/status 다섯 컬럼의 표
-- 하나로 나온다(00_SUMMARY가 맨 위).
--
-- ※ 이 파일은 저장소에만 존재한다. 작성한 세션에서는 원격 DB에 실행하지
--    않았다(읽기 전용 조사 지침에 따름 — 실행은 사람이 한다). 로컬
--    Postgres가 없어 실제 서버로는 문법을 확인하지 못했다(정적 검토만).
-- ============================================================================

with

fn as (
  select to_regprocedure('public.disconnect_cafe24_integration(bigint)') as oid
),
fn_meta as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    pg_get_function_arguments(p.oid) as args,
    pg_get_function_result(p.oid) as ret
  from fn
  left join pg_proc p on p.oid = fn.oid
),

chk_exists as (
  select
    1.0 as ord,
    '01_함수 존재: public.disconnect_cafe24_integration(bigint)' as check_name,
    '존재' as expected,
    case when (select oid from fn) is not null
         then '존재(oid=' || (select oid::text from fn) || ')'
         else 'MISSING — 마이그레이션이 아직 적용되지 않았거나 실패함' end as actual,
    case when (select oid from fn) is not null then 'PASS' else 'FAIL' end as status
),

chk_args as (
  select
    2.0 as ord,
    '02_인자 시그니처' as check_name,
    'p_store_id bigint' as expected,
    coalesce((select args from fn_meta), 'MISSING(함수 없음)') as actual,
    case when (select args from fn_meta) = 'p_store_id bigint' then 'PASS' else 'FAIL' end as status
),

chk_returns as (
  -- pg_get_function_result()의 정확한 공백/구두점 서식을 이 저장소에서(로컬
  -- Postgres 없이) 단정할 수 없어, 전체 문자열을 정확히 일치시키는 대신
  -- TABLE(...) 형태 + 5개 컬럼명·타입이 전부 포함돼 있는지로 판정한다(서식
  -- 차이로 인한 거짓 FAIL을 피하기 위함 — 컬럼 이름·타입 자체는 여전히
  -- 정확히 검사한다).
  select
    3.0 as ord,
    '03_반환 타입(RETURNS TABLE 5개 컬럼 이름·타입 전부 포함)' as check_name,
    'TABLE(...)에 5개 컬럼(connected_accounts_deleted integer / integration_credentials_deleted integer / orders_deleted integer / oauth_states_deleted integer / store_external_id_cleared boolean)이 전부 포함' as expected,
    coalesce((select ret from fn_meta), 'MISSING(함수 없음)') as actual,
    case when (select ret from fn_meta) like 'TABLE(%'
      and (select ret from fn_meta) like '%connected_accounts_deleted integer%'
      and (select ret from fn_meta) like '%integration_credentials_deleted integer%'
      and (select ret from fn_meta) like '%orders_deleted integer%'
      and (select ret from fn_meta) like '%oauth_states_deleted integer%'
      and (select ret from fn_meta) like '%store_external_id_cleared boolean%'
    then 'PASS' else 'FAIL' end as status
),

chk_secdef as (
  select
    4.0 as ord,
    '04_SECURITY DEFINER' as check_name,
    'true' as expected,
    coalesce((select prosecdef::text from fn_meta), 'MISSING(함수 없음)') as actual,
    case when (select prosecdef from fn_meta) is true then 'PASS' else 'FAIL' end as status
),

chk_search_path as (
  select
    5.0 as ord,
    '05_search_path 빈 값으로 고정' as check_name,
    'search_path=(빈 값)' as expected,
    coalesce(
      (select e from unnest((select proconfig from fn_meta)) as e where e like 'search_path=%' limit 1),
      'MISSING(설정 없음 또는 함수 없음)'
    ) as actual,
    case when exists (
      select 1 from unnest((select proconfig from fn_meta)) as e
      where e like 'search_path=%' and trim(both '"' from substring(e from 13)) = ''
    ) then 'PASS' else 'FAIL' end as status
),

chk_perms as (
  select
    6.0 as ord,
    '06_실행 권한: anon 없음 / authenticated 있음 / PUBLIC 없음' as check_name,
    'anon=false, authenticated=true, PUBLIC 권한 수=0' as expected,
    'anon=' || coalesce((select has_function_privilege('anon', oid, 'execute')::text from fn), 'NULL(함수 없음)')
      || ' | authenticated=' || coalesce((select has_function_privilege('authenticated', oid, 'execute')::text from fn), 'NULL(함수 없음)')
      || ' | PUBLIC 권한 수=' || (
           select count(*)::text from information_schema.routine_privileges
           where routine_schema = 'public'
             and routine_name = 'disconnect_cafe24_integration'
             and grantee = 'PUBLIC'
         ) as actual,
    case
      when (select oid from fn) is null then 'FAIL'
      when coalesce((select has_function_privilege('anon', oid, 'execute') from fn), true) = false
       and coalesce((select has_function_privilege('authenticated', oid, 'execute') from fn), false) = true
       and (
             select count(*) from information_schema.routine_privileges
             where routine_schema = 'public'
               and routine_name = 'disconnect_cafe24_integration'
               and grantee = 'PUBLIC'
           ) = 0
      then 'PASS'
      else 'FAIL'
    end as status
),

all_checks as (
  select * from chk_exists
  union all select * from chk_args
  union all select * from chk_returns
  union all select * from chk_secdef
  union all select * from chk_search_path
  union all select * from chk_perms
),
chk_summary as (
  select
    0.0 as ord,
    '00_SUMMARY' as check_name,
    '모든 FAIL=0' as expected,
    'PASS=' || count(*) filter (where status = 'PASS')
      || ' / FAIL=' || count(*) filter (where status = 'FAIL')
      || ' (총 ' || count(*) || '개 검사)' as actual,
    case when count(*) filter (where status = 'FAIL') = 0 then 'PASS' else 'FAIL' end as status
  from all_checks
)

select ord, check_name, expected, actual, status
from (
  select * from chk_summary
  union all
  select * from all_checks
) f
order by ord;
