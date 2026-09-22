-- ============================================================================
-- LaunchDesk Cafe24 연동 해제 — 원격 스키마 선행 확인(읽기 전용)
-- 파일: cafe24_disconnect_prereq_readonly.sql
-- ============================================================================
-- [2026-09-22 보강] 1차 버전은 orders 테이블을 대상에서 아예 빼고(다른
-- 파일에 이미 확인돼 있다는 이유였음), FK 섹션 자체가 없어 "FK 없음"과
-- "검사 누락"을 구분할 수 없었으며, section/item/detail 세 컬럼과 PASS/
-- FAIL 표시·SUMMARY가 없었다. 이번 버전은 그 지적을 반영해 아래를 전부
-- 새로 갖춘다:
--   - disconnect_cafe24_integration()이 실제로 건드리는 5개 테이블(stores,
--     connected_accounts, integration_credentials, oauth_states, orders)을
--     전부 이 파일 하나로 완결되게 확인한다(다른 파일 참조로 대체하지 않음).
--   - 모든 검사가 VALUES 기준 키 목록 + LEFT JOIN/스칼라 서브쿼리로
--     이뤄져 있어, 대상 테이블·컬럼·제약이 없어도 결과 행 자체는 항상
--     나오고 PASS/FAIL/CHECK로 표시된다(INNER JOIN으로 행이 사라지는
--     구조를 쓰지 않는다).
--   - 결과 컬럼은 ord/check_name/expected/actual/status 다섯 개이고,
--     맨 앞에 00_SUMMARY 한 행이 전체 PASS/FAIL/CHECK 개수를 요약한다.
--
-- 목적: 20260922120000_cafe24_disconnect.sql이 새 함수(disconnect_cafe24_
-- integration)를 적용하기 전, 그 함수가 의존하는 5개 테이블 중 이 저장소의
-- migration 파일로는 만들어진 적 없는(Studio에서 직접 만든) 부분의 실제
-- 모양을 사람이 Supabase SQL Editor에서 한 번 실행해 확인한다.
--
-- 확인 항목(아래 각 절 번호는 결과의 check_name 접두사와 대응):
--   01) 5개 테이블 존재 여부(stores/connected_accounts/integration_
--       credentials/oauth_states/orders)
--   02) 함수가 의존하는 11개 컬럼의 존재 여부·정확한 타입(+ stores.
--       external_store_id는 NULL 허용까지)
--   03) orders.provider의 실제 타입과 provider='cafe24' 비교가 안전한지
--       (text 계열이면 안전, enum이면 'cafe24' 라벨 존재 여부까지 확인)
--   04) 4개 FK(connected_accounts.store_id→stores.id, integration_
--       credentials.connected_account_id→connected_accounts.id,
--       orders.store_id→stores.id, oauth_states.store_id→stores.id) —
--       존재 여부·ON DELETE 동작·제약 원문. disconnect 함수는 자식→부모
--       순서로 명시적 DELETE를 실행하므로 CASCADE 존재는 필수가 아니다
--       (expected에 이 판단을 명시한다) — 없다고 FAIL 처리하지 않는다.
--   05) SECURITY DEFINER로 함수를 만들 수 있는 조건에 대한 참고 메타데이터
--       (테이블 소유자, public 스키마 소유자, 이 세션 role의 CREATE 권한,
--       함수 소유자는 실제 적용 역할에 따라 달라진다는 주의)
--   06) 기존 public.disconnect_cafe24_integration(bigint) 충돌 여부
--       + authenticated가 stores/connected_accounts에 가진 과다 권한
--       (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) 참고 표시(이 파일에서
--       회수하지 않음)
--
-- 이 파일은 supabase/verify/remote_schema_readonly_audit.sql과 같은 성격
--이다 — information_schema/pg_catalog 메타데이터만 읽고, 실행해도 DB에
-- 흔적이 남지 않는다.
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH ... SELECT 한 문장뿐이다. INSERT/UPDATE/DELETE/ALTER/CREATE/
--     DROP/GRANT/REVOKE/TRUNCATE/COPY/SET/DO/CALL/PERFORM/EXECUTE 문장이
--     없다('TRUNCATE' 등 대문자 단어가 보이는 곳은 전부 privilege_type
--     비교용 문자열 리터럴이지 실행 문장이 아니다).
--   - 사용자 행 데이터를 읽지 않는다 — stores/connected_accounts/
--     integration_credentials/oauth_states/orders 어디서도 실제 행
--     (access_token, 이메일, UUID, 주문 원문 등)을 SELECT하지 않는다.
--     전부 information_schema/pg_catalog 카탈로그 메타데이터만 조회한다.
--   - 테이블/컬럼/제약/함수가 없어도 전체 쿼리가 중단되지 않고, 그 검사의
--     결과 행도 사라지지 않는다(to_regclass/to_regprocedure는 없으면
--     NULL을 반환하고, 모든 검사는 VALUES 키 목록에서 시작해 스칼라
--     서브쿼리 또는 LEFT JOIN으로만 실제 메타데이터를 붙인다).
--
-- 실행 방법: 이 파일 전체를 Supabase SQL Editor에 그대로 붙여넣고 한 번에
-- 실행한다. 결과는 ord/check_name/expected/actual/status 다섯 컬럼의 표
-- 하나로 나온다(ord 순서대로 읽는다 — 00_SUMMARY가 맨 위).
--
-- ※ 이 파일은 저장소에만 존재한다. 작성한 세션에서는 원격 DB에 실행하지
--    않았다(읽기 전용 조사 지침에 따름 — 실행은 사람이 한다). 로컬
--    Postgres가 없어 실제 서버로는 문법을 확인하지 못했다(정적 검토만).
-- ============================================================================

with

-- ---------------------------------------------------------------------------
-- 01) 테이블 존재 여부 — 5개 전부 VALUES 키 목록에서 시작(사라지지 않음)
-- ---------------------------------------------------------------------------
tbl_keys(ord, tbl) as (
  values
    (1.01, 'stores'),
    (1.02, 'connected_accounts'),
    (1.03, 'integration_credentials'),
    (1.04, 'oauth_states'),
    (1.05, 'orders')
),
chk_tables as (
  select
    ord,
    '01_테이블 존재: public.' || tbl as check_name,
    '존재' as expected,
    case when to_regclass('public.' || tbl) is not null
         then '존재 (relkind=' || (select c.relkind::text from pg_class c where c.oid = to_regclass('public.' || tbl)) || ')'
         else 'MISSING — public 스키마에 없음' end as actual,
    case when to_regclass('public.' || tbl) is not null then 'PASS' else 'FAIL' end as status
  from tbl_keys
),

-- ---------------------------------------------------------------------------
-- 02) 컬럼 존재·타입 확인 — LEFT JOIN으로 컬럼이 없어도 행이 남는다.
--     expected_canon은 format_type(atttypid, null)이 실제로 내는 표준
--     명칭과 비교하기 위한 값이다(timestamptz는 "timestamp with time
--     zone"으로 출력되므로 표시용 이름과 비교용 이름을 분리했다).
-- ---------------------------------------------------------------------------
col_keys(ord, tbl, col, expected_display, expected_canon, must_be_nullable) as (
  values
    (2.01, 'stores', 'id', 'bigint', 'bigint', false),
    (2.02, 'stores', 'user_id', 'uuid', 'uuid', false),
    (2.03, 'stores', 'external_store_id', 'text (NULL 허용)', 'text', true),
    (2.04, 'stores', 'updated_at', 'timestamptz', 'timestamp with time zone', false),
    (2.05, 'connected_accounts', 'id', 'bigint', 'bigint', false),
    (2.06, 'connected_accounts', 'store_id', 'bigint', 'bigint', false),
    (2.07, 'connected_accounts', 'provider', 'text', 'text', false),
    (2.08, 'integration_credentials', 'connected_account_id', 'bigint', 'bigint', false),
    (2.09, 'oauth_states', 'store_id', 'bigint', 'bigint', false),
    (2.10, 'oauth_states', 'provider', 'text', 'text', false),
    (2.11, 'orders', 'store_id', 'bigint', 'bigint', false)
),
col_info as (
  select
    k.ord, k.tbl, k.col, k.expected_display, k.expected_canon, k.must_be_nullable,
    a.atttypid, a.atttypmod, a.attnotnull
  from col_keys k
  left join pg_attribute a
    on a.attrelid = to_regclass('public.' || k.tbl)
   and a.attname = k.col
   and not a.attisdropped
),
chk_cols as (
  select
    ord,
    '02_컬럼: ' || tbl || '.' || col as check_name,
    expected_display as expected,
    case when atttypid is null then 'MISSING — 컬럼 없음(또는 테이블 없음)'
         else format_type(atttypid, atttypmod)
              || (case when attnotnull then ' NOT NULL' else ' NULL 허용' end)
    end as actual,
    case
      when atttypid is null then 'FAIL'
      when format_type(atttypid, null) <> expected_canon then 'FAIL'
      when must_be_nullable and attnotnull then 'FAIL'
      else 'PASS'
    end as status
  from col_info
),

-- ---------------------------------------------------------------------------
-- 03) orders.provider — text 계열이면 안전, enum이면 'cafe24' 라벨 존재까지
--     확인한다(삭제 함수의 `where ... provider = 'cafe24'` 조건이 실제로
--     동작할 수 있는지). 컬럼이 아예 없어도 이 절은 1행을 그대로 낸다.
-- ---------------------------------------------------------------------------
orders_provider_info as (
  select a.atttypid, a.atttypmod, t.typtype, t.typname
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  where a.attrelid = to_regclass('public.orders')
    and a.attname = 'provider'
    and not a.attisdropped
),
chk_orders_provider as (
  select
    3.00 as ord,
    '03_orders.provider 타입 및 provider=''cafe24'' 조건 사용 가능성' as check_name,
    'text 계열(문자열 비교 가능) 이거나, enum이면 ''cafe24''가 유효한 라벨' as expected,
    coalesce(
      (select format_type(atttypid, atttypmod) || ' (typtype=' || typtype::text || ')' from orders_provider_info),
      'MISSING — orders.provider 컬럼이 없음'
    ) as actual,
    case
      when not exists (select 1 from orders_provider_info) then 'FAIL'
      when (select typname from orders_provider_info) in ('text', 'varchar', 'bpchar') then 'PASS'
      when (select typtype from orders_provider_info) = 'e'
       and exists (
             select 1 from pg_enum e
             where e.enumtypid = (select atttypid from orders_provider_info)
               and e.enumlabel = 'cafe24'
           ) then 'PASS'
      when (select typtype from orders_provider_info) = 'e' then 'FAIL'
      else 'CHECK'
    end as status
),

-- ---------------------------------------------------------------------------
-- 04) FK 확인 — 4개 관계를 VALUES 키 목록 + 스칼라 서브쿼리로 확인한다.
--     FK가 없어도 행은 남고 status='CHECK'(아래 이유로 FAIL이 아님):
--     disconnect_cafe24_integration()은 자식(credentials/orders/states)을
--     부모(connected_accounts/stores)보다 먼저 명시적으로 DELETE하므로,
--     ON DELETE CASCADE가 있든 없든, RESTRICT/NO ACTION이든 정상 동작한다
--     — 이 함수의 정확성은 FK 존재에 의존하지 않는다. 다만 사람이 참고할
--     수 있도록 실제 존재 여부·ON DELETE 동작·원문은 그대로 보여준다.
-- ---------------------------------------------------------------------------
fk_keys(ord, label, child_tbl, child_col, parent_tbl, parent_col) as (
  values
    (4.01, 'connected_accounts.store_id -> stores.id', 'connected_accounts', 'store_id', 'stores', 'id'),
    (4.02, 'integration_credentials.connected_account_id -> connected_accounts.id', 'integration_credentials', 'connected_account_id', 'connected_accounts', 'id'),
    (4.03, 'orders.store_id -> stores.id', 'orders', 'store_id', 'stores', 'id'),
    (4.04, 'oauth_states.store_id -> stores.id', 'oauth_states', 'store_id', 'stores', 'id')
),
fk_info as (
  select
    k.ord, k.label, k.child_tbl, k.parent_tbl,
    to_regclass('public.' || k.child_tbl) as child_oid,
    to_regclass('public.' || k.parent_tbl) as parent_oid,
    (
      select c.oid
      from pg_constraint c
      where c.conrelid = to_regclass('public.' || k.child_tbl)
        and c.contype = 'f'
        and c.confrelid = to_regclass('public.' || k.parent_tbl)
        and (select a.attnum from pg_attribute a
              where a.attrelid = c.conrelid and a.attname = k.child_col and not a.attisdropped) = any(c.conkey)
        and (select a2.attnum from pg_attribute a2
              where a2.attrelid = c.confrelid and a2.attname = k.parent_col and not a2.attisdropped) = any(c.confkey)
      limit 1
    ) as fk_oid
  from fk_keys k
),
chk_fk as (
  select
    ord,
    '04_FK: ' || label as check_name,
    'FK 존재는 필수 아님(참고용) — 함수가 자식→부모 순서로 명시적 DELETE를 실행하므로 CASCADE 유무와 무관하게 정상 동작함' as expected,
    case
      when child_oid is null or parent_oid is null then '확인 불가 — 대상 테이블 없음(01번 항목 참고)'
      when fk_oid is null then 'FK 없음'
      else pg_get_constraintdef(fk_oid)
    end as actual,
    case
      when child_oid is null or parent_oid is null then 'CHECK'
      when fk_oid is not null then 'PASS'
      else 'CHECK'
    end as status
  from fk_info
),

-- ---------------------------------------------------------------------------
-- 05) SECURITY DEFINER 실행 가능성 — 전부 참고용(CHECK), PASS/FAIL 판단
--     대상이 아니다. 함수를 실제로 만드는 주체(마이그레이션을 적용하는
--     역할)는 이 조회를 실행하는 세션과 다를 수 있으므로 단정하지 않는다.
-- ---------------------------------------------------------------------------
owner_keys(ord, tbl) as (
  values
    (5.01, 'stores'),
    (5.02, 'connected_accounts'),
    (5.03, 'integration_credentials'),
    (5.04, 'oauth_states'),
    (5.05, 'orders')
),
chk_owners as (
  select
    ord,
    '05_테이블 소유자(참고): public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용)' as expected,
    coalesce(
      (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = to_regclass('public.' || ok.tbl)),
      'MISSING — 테이블 없음(01번 항목 참고)'
    ) as actual,
    'CHECK' as status
  from owner_keys ok
),
chk_schema_owner as (
  select
    5.06 as ord,
    '05_public 스키마 소유자(참고)' as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용)' as expected,
    coalesce((select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'public'), 'MISSING') as actual,
    'CHECK' as status
),
chk_create_priv as (
  select
    5.07 as ord,
    '05_참고: 이 SQL을 실행하는 세션 role의 public 스키마 CREATE 권한' as check_name,
    '(참고용 — 실제 migration을 적용할 역할과 다를 수 있음, 단정 금지)' as expected,
    'current_user=' || current_user || ' | has_create_on_public=' || has_schema_privilege(current_user, 'public', 'CREATE')::text as actual,
    'CHECK' as status
),
chk_role_caveat as (
  select
    5.08 as ord,
    '05_주의: 새 함수의 소유자는 실제 CREATE FUNCTION을 실행하는 역할로 정해짐' as check_name,
    '(참고용 — postgres로 생성된다고 미리 단정하지 않는다)' as expected,
    'Supabase Studio SQL Editor/CLI 마이그레이션 적용에 쓰는 역할을 직접 확인할 것 — 이 파일을 실행 중인 세션의 current_user=' || current_user || '와 실제 적용 세션의 역할이 다를 수 있음' as actual,
    'CHECK' as status
),

-- ---------------------------------------------------------------------------
-- 06) 기존 함수 이름 충돌 + authenticated 과다 권한 참고(이 파일에서 회수하지 않음)
-- ---------------------------------------------------------------------------
chk_fn_conflict as (
  select
    6.01 as ord,
    '06_함수 이름 충돌: public.disconnect_cafe24_integration(bigint)' as check_name,
    '없음(최초 적용 전 정상 상태)' as expected,
    case when to_regprocedure('public.disconnect_cafe24_integration(bigint)') is not null
         then '이미 존재(oid=' || to_regprocedure('public.disconnect_cafe24_integration(bigint)')::text || ') — 재실행/부분 적용 여부를 먼저 확인할 것'
         else '없음' end as actual,
    case when to_regprocedure('public.disconnect_cafe24_integration(bigint)') is null then 'PASS' else 'FAIL' end as status
),
priv_keys(ord, tbl) as (
  values
    (6.02, 'stores'),
    (6.03, 'connected_accounts')
),
chk_priv as (
  select
    ord,
    '06_참고: authenticated의 과다 권한(TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) on ' || tbl as check_name,
    '이 파일에서는 회수하지 않음(참고용) — 있다면 별도 후속 migration에서 검토' as expected,
    coalesce(
      (select string_agg(distinct privilege_type, ', ' order by privilege_type)
       from information_schema.role_table_grants
       where table_schema = 'public' and table_name = pk.tbl and grantee = 'authenticated'
         and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')),
      'NONE'
    ) as actual,
    'CHECK' as status
  from priv_keys pk
),

-- ---------------------------------------------------------------------------
-- 전체 집계(SUMMARY) — 아래 all_checks 전체에서 FAIL 개수를 센다.
-- ---------------------------------------------------------------------------
all_checks as (
  select * from chk_tables
  union all select * from chk_cols
  union all select * from chk_orders_provider
  union all select * from chk_fk
  union all select * from chk_owners
  union all select * from chk_schema_owner
  union all select * from chk_create_priv
  union all select * from chk_role_caveat
  union all select * from chk_fn_conflict
  union all select * from chk_priv
),
chk_summary as (
  select
    0.00 as ord,
    '00_SUMMARY' as check_name,
    '모든 FAIL=0(CHECK는 참고용이라 실패로 세지 않음)' as expected,
    'PASS=' || count(*) filter (where status = 'PASS')
      || ' / FAIL=' || count(*) filter (where status = 'FAIL')
      || ' / CHECK=' || count(*) filter (where status = 'CHECK')
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
