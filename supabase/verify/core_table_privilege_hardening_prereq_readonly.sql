-- ============================================================================
-- LaunchDesk 핵심 테이블 권한 최소화 — 원격 스키마 선행 확인(읽기 전용)
-- 파일: core_table_privilege_hardening_prereq_readonly.sql
-- ============================================================================
-- 목적: 20260922130000_core_table_privilege_hardening.sql을 적용하기 전,
-- public.stores / public.connected_accounts / public.tool_records의 실제
-- RLS·정책·GRANT(테이블·컬럼)·identity/sequence 상태를 사람이 Supabase SQL
-- Editor에서 한 번 실행해 확인한다. 이 세 테이블은 전부 이 저장소의
-- migration 파일로는 만들어진 적이 없다(마이그레이션 이력 이전부터 존재) —
-- DDL을 추측하지 않고 이 파일로 실제 값을 직접 읽는다.
--
-- [2026-09-22 보강] 이 파일의 1차 실행 결과(SUMMARY: PASS=11/FAIL=0/
-- CHECK=106)로 아래가 확인됐다:
--   - 3개 테이블 전부 존재, RLS enabled=true.
--   - anon/PUBLIC 테이블 단위 권한 없음.
--   - authenticated 테이블 단위 권한은 세 테이블 모두 동일하게 DELETE,
--     INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.
--   - 세 테이블의 "모든" 컬럼에 authenticated의 컬럼 단위 INSERT/
--     REFERENCES/SELECT/UPDATE가 존재하는 것처럼 보이는 결과가
--     information_schema.column_privileges로 나왔다. 이를 근거로
--     20260922130000_core_table_privilege_hardening.sql에 컬럼 단위
--     REVOKE ALL PRIVILEGES (컬럼 목록) ON TABLE ...을 추가해 적용했다.
--
-- [2026-09-22 2차 정정 — 중요] migration 적용 후 검증 결과 07번이
-- FAIL로 나왔는데, 원인은 실제 남은 권한이 아니라 판정 방법 자체의
-- 오류였다. PostgreSQL 공식 문서 기준으로 information_schema.column_
-- privileges는 "이 역할이 이 컬럼에 대해 실질적으로(effectively) 가진
-- 권한"을 has_column_privilege()로 계산해 보여주는 뷰다 — 테이블 단위
-- GRANT SELECT/INSERT/UPDATE/REFERENCES 하나만 있어도 그 테이블의 모든
-- 컬럼에 대해 "권한 있음"으로 펼쳐져 나온다. 즉 위 1차 실행에서 "모든
-- 컬럼에 권한 존재"로 보였던 것은 진짜 컬럼 단위 ACL(pg_attribute.
-- attacl에 별도로 저장된 항목)이 아니라, 이미 있던 테이블 단위 권한이
-- 컬럼별로 반사돼 보인 것이었을 가능성이 높다(즉 컬럼 단위 REVOKE가
-- 실제로는 처음부터 대상이 없었던 no-op이었을 수 있다 — migration
-- 자체는 이미 적용됐고 되돌리지 않는다). 이 파일의 03.5·06번 항목을
-- pg_attribute.attacl을 aclexplode()로 직접 푸는 방식으로 교정해
-- "명시적으로 저장된 컬럼 ACL"만 검사하도록 고쳤다. information_schema.
-- column_privileges 기반 값은 06.5번에 "유효 권한 참고값(테이블 권한
-- 포함) — ACL 존재 판정에는 쓰지 않음"으로 명확히 구분해 남겨뒀다.
--
-- 배경(이 파일 작성 전 저장소 전체를 grep해 확인한 실제 코드 사용처):
--   - public.stores: 브라우저(authenticated)가 stores.js에서 직접
--     select(fetchStores/admin.js 조회)·insert(추가)·update(수정)·
--     delete(삭제)를 전부 수행한다. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN을
--     쓰는 코드는 없다. Edge Function(cafe24-oauth-start/-callback,
--     cafe24-orders-sync, cafe24-store-info, meta-oauth-start,
--     meta-adset-insights)은 ctx.supabase로 select만 하고, stores에 대한
--     모든 쓰기(external_store_id/updated_at)는 ctx.supabaseAdmin
--     (service_role)만 수행한다.
--   - public.connected_accounts: 브라우저(stores.js/admin.js/ops-
--     overview.js)는 select만 한다 — insert/update/delete를 호출하는
--     브라우저 코드가 전혀 없다. 모든 Edge Function(cafe24-oauth-callback,
--     cafe24-orders-sync, cafe24-store-info, meta-account-select,
--     meta-adaccounts, meta-adset-insights, meta-insights, meta-oauth-
--     callback, meta-disconnect)도 ownership 확인용 select만 ctx.supabase로
--     하고, insert/update/delete는 전부 ctx.supabaseAdmin(service_role)
--     이다. disconnect_cafe24_integration()도 SECURITY DEFINER라 호출자
--     (authenticated)의 테이블 권한과 무관하게 함수 소유자 권한으로
--     동작한다(20260922120000_cafe24_disconnect.sql 참고).
--   - public.tool_records: 브라우저(store.js/app.js)가 select(최근 5건
--     조회)·insert(마진계산·광고기록 저장)·delete(본인 기록 삭제, ad_log는
--     data->>id로 필터)를 수행한다. update를 호출하는 코드는 저장소
--     전체(*.js/*.ts)에 단 한 곳도 없다(grep으로 확인).
--
-- 확인 항목:
--   01) 3개 테이블 존재 여부
--   02) RLS 활성화 여부(참고용 — 이 migration은 RLS를 변경하지 않는다)
--   03) authenticated의 현재 테이블 권한(문의 배경에 보고된 stores/
--       connected_accounts/tool_records 값과 실제로 일치하는지 대조)
--   03.5) [2026-09-22 정정] 명시적 컬럼 ACL 요약(pg_attribute.attacl을
--       aclexplode()로 직접 확인 — information_schema.column_privileges
--       아님). status는 항상 CHECK.
--   04) anon/PUBLIC의 현재 테이블 권한(있으면 안 됨)
--   05) 정책 개수 + 정책별 cmd/roles/USING/WITH CHECK 원문(참고용 나열 —
--       테이블에 정책이 0개여도 "정책 없음" 한 행이 나오도록 LEFT JOIN)
--   06) 명시적 컬럼 ACL 상세 나열(pg_attribute.attacl 기준, 참고용 — 없으면
--       "명시적 컬럼 ACL 없음" 한 행)
--   06.5) [2026-09-22 신설] information_schema.column_privileges 기준
--       "유효 권한" 참고값 — 테이블 단위 권한도 컬럼별로 펼쳐져 나오므로
--       ACL 존재 판정에는 쓰지 않는다(참고용 CHECK 나열).
--   07) id 컬럼의 identity 여부·DEFAULT 표현식
--   08) id 컬럼에 연결된 시퀀스 이름(identity/serial 공통, pg_get_serial_
--       sequence로 조회 — 테이블/컬럼이 없으면 호출 자체를 건너뛴다)
--   09) 그 시퀀스에 대한 authenticated의 USAGE/SELECT/UPDATE 권한
--   10) pg_default_acl의 public 스키마 기본 권한(참고용 CHECK — 이번
--       migration에서 변경하지 않는다)
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH ... SELECT 한 문장뿐이다. INSERT/UPDATE/DELETE/ALTER/CREATE/
--     DROP/GRANT/REVOKE/TRUNCATE/COPY/SET/DO/CALL/PERFORM/EXECUTE 문장이
--     없다.
--   - public.stores/connected_accounts/tool_records 등 사용자 테이블의
--     실제 행(이름·URL·마진 계산 데이터 등)은 어디에서도 SELECT하지 않는다.
--     전부 information_schema/pg_catalog 카탈로그 메타데이터만 조회한다.
--   - 테이블/컬럼/정책/시퀀스가 없어도 전체 쿼리가 중단되지 않고, "고정
--     검사"(01~04, 07~09)의 결과 행도 사라지지 않는다 — 전부 VALUES 키
--     목록에서 시작해 스칼라 서브쿼리 또는 LEFT JOIN으로만 실제 메타데이터를
--     붙인다. pg_get_serial_sequence()는 대상이 없으면 예외를 던지므로
--     to_regclass/컬럼 존재를 먼저 확인한 뒤에만 호출한다(CASE로 단락 평가).
--   - 05)·06)의 "나열" 섹션은 정책·컬럼 권한 개수가 가변적이라 행 수가
--     달라질 수 있다(이는 정상이다 — 각 테이블마다 최소 1행은 항상 나온다).
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

-- ---------------------------------------------------------------------------
-- 01) 테이블 존재 여부
-- ---------------------------------------------------------------------------
tbl_keys(ord, tbl) as (
  values
    (1.01, 'stores'),
    (1.02, 'connected_accounts'),
    (1.03, 'tool_records')
),
chk_exists as (
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
-- 02) RLS 활성화(참고용 — 이 migration은 RLS를 건드리지 않는다)
-- ---------------------------------------------------------------------------
rls_keys(ord, tbl) as (
  values
    (2.01, 'stores'),
    (2.02, 'connected_accounts'),
    (2.03, 'tool_records')
),
chk_rls as (
  select
    ord,
    '02_RLS 활성화(참고용): public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용, 이 migration은 RLS 무변경)' as expected,
    coalesce(
      (select 'rls_enabled=' || c.relrowsecurity::text || ' | rls_forced=' || c.relforcerowsecurity::text
         from pg_class c where c.oid = to_regclass('public.' || rk.tbl)),
      'MISSING — 테이블 없음(01번 항목 참고)'
    ) as actual,
    'CHECK' as status
  from rls_keys rk
),

-- ---------------------------------------------------------------------------
-- 03) authenticated의 현재 테이블 권한 — 문의 배경에 보고된 값과 대조.
--     [2026-09-22 보강] 첫 실행 결과 stores/connected_accounts/tool_records
--     세 테이블 모두 동일한 과다 권한 집합(DELETE, INSERT, REFERENCES,
--     SELECT, TRIGGER, TRUNCATE, UPDATE)임이 확인돼, tool_records도 이제
--     PASS/FAIL 비교 대상에 포함한다(이전 버전은 tool_records를 사전 보고가
--     없다는 이유로 CHECK로만 뒀었다).
-- ---------------------------------------------------------------------------
auth_priv_keys(ord, tbl, expected_set) as (
  values
    (3.01, 'stores', 'DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE'),
    (3.02, 'connected_accounts', 'DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE'),
    (3.03, 'tool_records', 'DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE')
),
auth_priv_info as (
  select
    k.ord, k.tbl, k.expected_set,
    (select string_agg(privilege_type, ', ' order by privilege_type)
       from information_schema.role_table_grants
       where table_schema = 'public' and table_name = k.tbl and grantee = 'authenticated'
    ) as actual_set
  from auth_priv_keys k
),
chk_auth_priv as (
  select
    ord,
    '03_authenticated 현재 테이블 권한: public.' || tbl as check_name,
    coalesce(expected_set, '(선행 보고 없음 — 정보 수집 전용)') as expected,
    coalesce(actual_set, '(권한 없음 또는 테이블 없음)') as actual,
    case
      when expected_set is null then 'CHECK'
      when actual_set = expected_set then 'PASS'
      else 'FAIL'
    end as status
  from auth_priv_info
),

-- ---------------------------------------------------------------------------
-- 03.5) [2026-09-22 정정] 명시적 컬럼 ACL 요약 — pg_attribute.attacl을
--     aclexplode()로 직접 풀어 PUBLIC(grantee oid=0)/anon/authenticated
--     앞으로 된 항목만 센다. information_schema.column_privileges는 쓰지
--     않는다 — 그 뷰는 has_column_privilege() 기준의 "유효 권한"이라
--     테이블 단위 GRANT 하나만 있어도 모든 컬럼에 권한이 있는 것처럼
--     펼쳐져 나와, "명시적으로 저장된 컬럼 ACL이 존재하는가"라는 질문에는
--     답하지 못한다(06.5번에 그 값을 참고용으로 따로 남겨뒀다).
--     status는 항상 CHECK다 — 이 파일은 조사 전용이고, 이 값이 0이 아닌
--     것 자체가 실패는 아니다(단, 0이 아니면 컬럼 단위 REVOKE가 실제로
--     필요하다는 확실한 근거가 된다).
--     역할명을 regrole로 캐스팅할 때 'PUBLIC'은 실제 pg_authid 행이 아니라
--     캐스팅하면 오류가 나므로, CASE로 PUBLIC만 grantee=0으로 직접
--     비교하고 나머지만 role_name::regrole로 캐스팅한다(AND/OR는
--     좌우 평가 순서를 보장하지 않아 단락 평가에 기대면 안 되므로 CASE 사용
--     — PostgreSQL 공식 문서 "Expression Evaluation Rules" 참고).
-- ---------------------------------------------------------------------------
col_priv_summary_keys(ord, tbl, role_name) as (
  values
    (3.51, 'stores', 'authenticated'),
    (3.52, 'stores', 'anon'),
    (3.53, 'stores', 'PUBLIC'),
    (3.54, 'connected_accounts', 'authenticated'),
    (3.55, 'connected_accounts', 'anon'),
    (3.56, 'connected_accounts', 'PUBLIC'),
    (3.57, 'tool_records', 'authenticated'),
    (3.58, 'tool_records', 'anon'),
    (3.59, 'tool_records', 'PUBLIC')
),
chk_col_priv_summary as (
  select
    ord,
    '03_5_명시적 컬럼 ACL 요약(pg_attribute.attacl 원본): public.' || tbl || ' · ' || role_name as check_name,
    '0(참고용 — 이 파일은 조사 전용이라 0이 아니어도 FAIL 아님)' as expected,
    coalesce(
      (select count(*)::text || '개 항목에 [' || string_agg(distinct x.privilege_type, ',') || '] 명시적 ACL 존재'
         from pg_attribute a
         cross join lateral aclexplode(a.attacl) x
         where a.attrelid = to_regclass('public.' || k.tbl)
           and a.attnum > 0 and not a.attisdropped
           and x.grantee = case when k.role_name = 'PUBLIC' then 0 else (k.role_name::regrole)::oid end
      ),
      '명시적 컬럼 ACL 없음'
    ) as actual,
    'CHECK' as status
  from col_priv_summary_keys k
),

-- ---------------------------------------------------------------------------
-- 04) anon/PUBLIC의 현재 테이블 권한 — 전부 없어야 정상(PASS).
-- ---------------------------------------------------------------------------
anon_pub_keys(ord, tbl, grantee_name) as (
  values
    (4.01, 'stores', 'anon'),
    (4.02, 'connected_accounts', 'anon'),
    (4.03, 'tool_records', 'anon'),
    (4.11, 'stores', 'PUBLIC'),
    (4.12, 'connected_accounts', 'PUBLIC'),
    (4.13, 'tool_records', 'PUBLIC')
),
chk_anon_pub as (
  select
    ord,
    '04_' || grantee_name || ' 테이블 권한: public.' || tbl as check_name,
    '없음' as expected,
    coalesce(
      (select string_agg(privilege_type, ', ' order by privilege_type)
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = k.tbl and grantee = k.grantee_name),
      '없음'
    ) as actual,
    case when (select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name = k.tbl and grantee = k.grantee_name) = 0
         then 'PASS' else 'FAIL' end as status
  from anon_pub_keys k
),

-- ---------------------------------------------------------------------------
-- 05) 정책 개수(고정, 사라지지 않음) + 정책별 원문 나열(참고용, 가변 행수 —
--     정책이 0개인 테이블도 LEFT JOIN이라 "정책 없음" 한 행은 반드시 남는다)
-- ---------------------------------------------------------------------------
policy_count_keys(ord, tbl) as (
  values
    (5.01, 'stores'),
    (5.02, 'connected_accounts'),
    (5.03, 'tool_records')
),
chk_policy_count as (
  select
    ord,
    '05_정책 개수(참고용): public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용)' as expected,
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename = pck.tbl) as actual,
    'CHECK' as status
  from policy_count_keys pck
),
policy_list_keys(tbl) as (
  values ('stores'), ('connected_accounts'), ('tool_records')
),
policy_rows as (
  select
    plk.tbl,
    p.policyname,
    p.cmd,
    p.permissive,
    p.roles,
    p.qual,
    p.with_check
  from policy_list_keys plk
  left join pg_policies p on p.schemaname = 'public' and p.tablename = plk.tbl
),
chk_policy_list as (
  select
    5.5 as ord,
    '05_정책 원문(참고용): public.' || tbl
      || case when policyname is not null then ' · ' || policyname else '' end as check_name,
    '(참고용 나열 — PASS/FAIL 없음)' as expected,
    case when policyname is null then '정책 없음'
         else 'cmd=' || cmd || ' | permissive=' || permissive || ' | roles=' || array_to_string(roles, ',')
              || ' | USING(' || coalesce(qual, '-') || ') | WITH CHECK(' || coalesce(with_check, '-') || ')'
    end as actual,
    'CHECK' as status
  from policy_rows
),

-- ---------------------------------------------------------------------------
-- 06) [2026-09-22 정정] 명시적 컬럼 ACL 상세 나열 — pg_attribute.attacl을
--     aclexplode()로 직접 풀어, PUBLIC(oid=0)/anon/authenticated 앞으로
--     된 항목만 컬럼별로 보여준다(참고용 — 없으면 "명시적 컬럼 ACL 없음"
--     한 행). 3개 테이블 각각 이 세 역할과 무관한 다른 역할의 ACL이나
--     attacl 자체가 NULL(컬럼 단위 GRANT를 한 번도 실행한 적 없는 기본
--     상태)인 컬럼은 여기 나오지 않는다 — 그 컬럼들은 테이블 단위 권한
--     으로만 통제된다는 뜻이라 정상이다.
-- ---------------------------------------------------------------------------
col_priv_list_keys(tbl) as (
  values ('stores'), ('connected_accounts'), ('tool_records')
),
-- PUBLIC(oid=0)/anon/authenticated 앞으로 된 명시적 컬럼 ACL이 실제로
-- 존재하는 (테이블, 컬럼, 역할, 권한) 조합만 먼저 골라낸다.
col_acl_found as (
  select
    cplk.tbl,
    a.attname as column_name,
    case x.grantee when 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name,
    x.privilege_type
  from col_priv_list_keys cplk
  join pg_attribute a
    on a.attrelid = to_regclass('public.' || cplk.tbl) and a.attnum > 0 and not a.attisdropped
  cross join lateral aclexplode(a.attacl) x
  where x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated')
),
-- 위에서 한 건도 발견되지 않은 테이블만 "없음" placeholder 한 행을 낸다
-- (테이블이 없거나 컬럼이 없는 경우도 자연히 여기로 떨어진다).
col_acl_none as (
  select cplk.tbl
  from col_priv_list_keys cplk
  where not exists (select 1 from col_acl_found f where f.tbl = cplk.tbl)
),
chk_col_priv as (
  select
    6.0 as ord,
    '06_명시적 컬럼 ACL(pg_attribute.attacl, 참고용): public.' || tbl || ' · ' || column_name || ' · ' || grantee_name as check_name,
    '(참고용 나열 — PASS/FAIL 없음)' as expected,
    privilege_type as actual,
    'CHECK' as status
  from col_acl_found
  union all
  select
    6.0,
    '06_명시적 컬럼 ACL(pg_attribute.attacl, 참고용): public.' || tbl,
    '(참고용 나열 — PASS/FAIL 없음)',
    '명시적 컬럼 ACL 없음',
    'CHECK'
  from col_acl_none
),

-- ---------------------------------------------------------------------------
-- 06.5) [2026-09-22 신설] information_schema.column_privileges 기준 "유효
--     권한" 참고값 — PostgreSQL 공식 동작상 이 뷰는 테이블 단위 GRANT만
--     있어도 그 테이블의 모든 컬럼에 권한이 있는 것처럼 펼쳐서 보여준다
--     (has_column_privilege() 기준). 그래서 "명시적 컬럼 ACL이 존재하는가"
--     판정에는 절대 쓰지 않는다 — 03.5·06번(pg_attribute.attacl 기준)만
--     그 목적으로 쓴다. 이 항목은 "이 역할이 이 컬럼에 실질적으로 어떤
--     권한을 행사할 수 있는가"를 사람이 참고하는 용도로만 남긴다.
-- ---------------------------------------------------------------------------
col_priv_effective_list_keys(tbl) as (
  values ('stores'), ('connected_accounts'), ('tool_records')
),
col_priv_effective_agg as (
  select
    cplk.tbl,
    cp.column_name,
    cp.grantee,
    string_agg(distinct cp.privilege_type, ', ' order by cp.privilege_type) as privs
  from col_priv_effective_list_keys cplk
  left join information_schema.column_privileges cp
    on cp.table_schema = 'public' and cp.table_name = cplk.tbl
  group by cplk.tbl, cp.column_name, cp.grantee
),
chk_col_priv_effective as (
  select
    6.5 as ord,
    '06_5_유효 권한 참고값(information_schema, 테이블 권한 포함 — ACL 판정에 사용 안 함): public.' || tbl
      || case when column_name is not null then ' · ' || column_name || ' · ' || grantee else '' end as check_name,
    '(참고용 나열 — PASS/FAIL 없음, 명시적 ACL 존재 여부와 다름)' as expected,
    case when column_name is null then '유효 권한 없음' else privs end as actual,
    'CHECK' as status
  from col_priv_effective_agg
),

-- ---------------------------------------------------------------------------
-- 07) id 컬럼 identity/default(고정, 사라지지 않음)
-- ---------------------------------------------------------------------------
id_col_keys(ord, tbl) as (
  values
    (7.01, 'stores'),
    (7.02, 'connected_accounts'),
    (7.03, 'tool_records')
),
id_col_info as (
  select
    k.ord, k.tbl,
    a.attidentity, a.atttypid, a.atttypmod,
    d.adbin, d.adrelid
  from id_col_keys k
  left join pg_attribute a
    on a.attrelid = to_regclass('public.' || k.tbl) and a.attname = 'id' and not a.attisdropped
  left join pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
),
chk_id_col as (
  select
    ord,
    '07_id 컬럼 identity/default: public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용, 08번 시퀀스 조회의 근거)' as expected,
    case
      when atttypid is null then 'MISSING — id 컬럼 없음(또는 테이블 없음)'
      else format_type(atttypid, atttypmod)
        || ' | identity=' || coalesce(
             case attidentity when 'a' then 'ALWAYS' when 'd' then 'BY DEFAULT' else '(아님)' end, '(아님)')
        || ' | default=' || coalesce(pg_get_expr(adbin, adrelid), '(없음)')
    end as actual,
    'CHECK' as status
  from id_col_info
),

-- ---------------------------------------------------------------------------
-- 08) id 컬럼에 연결된 시퀀스(고정, 사라지지 않음) — identity/serial 공통.
--     pg_get_serial_sequence()는 대상이 없으면 예외를 던지므로, 테이블·
--     컬럼이 모두 존재할 때만 호출한다(CASE 단락 평가로 보호).
-- ---------------------------------------------------------------------------
seq_keys(ord, tbl) as (
  values
    (8.01, 'stores'),
    (8.02, 'connected_accounts'),
    (8.03, 'tool_records')
),
seq_info as (
  select
    k.ord, k.tbl,
    case
      when to_regclass('public.' || k.tbl) is not null
       and exists (
             select 1 from pg_attribute a
             where a.attrelid = to_regclass('public.' || k.tbl) and a.attname = 'id' and not a.attisdropped
           )
      then pg_get_serial_sequence('public.' || k.tbl, 'id')
      else null
    end as seq_name
  from seq_keys k
),
chk_seq as (
  select
    ord,
    '08_id 시퀀스: public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용)' as expected,
    coalesce(seq_name, '시퀀스 없음(identity/serial 기본값이 아니거나 테이블·컬럼 없음)') as actual,
    'CHECK' as status
  from seq_info
),

-- ---------------------------------------------------------------------------
-- 09) 그 시퀀스에 대한 authenticated의 USAGE/SELECT/UPDATE 권한(고정,
--     사라지지 않음) — 이 migration은 시퀀스 권한을 절대 건드리지 않으므로
--     순수 참고용이다.
-- ---------------------------------------------------------------------------
chk_seq_priv as (
  select
    9.0 + (ord - 8.0) as ord,
    '09_authenticated의 id 시퀀스 권한: public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용, 이 migration은 시퀀스 권한 무변경)' as expected,
    case
      when seq_name is null then 'N/A(08번 항목 참고 — 시퀀스 없음)'
      else 'usage=' || has_sequence_privilege('authenticated', seq_name::regclass, 'usage')::text
        || ' | select=' || has_sequence_privilege('authenticated', seq_name::regclass, 'select')::text
        || ' | update=' || has_sequence_privilege('authenticated', seq_name::regclass, 'update')::text
    end as actual,
    'CHECK' as status
  from seq_info
),

-- ---------------------------------------------------------------------------
-- 10) pg_default_acl의 public 스키마 기본 권한(참고용 — 이 migration은
--     default privileges를 변경하지 않는다).
-- ---------------------------------------------------------------------------
chk_default_acl as (
  select
    10.0 as ord,
    '10_public 스키마 기본 권한(pg_default_acl, 참고용)' as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용, 이 migration은 변경하지 않음)' as expected,
    coalesce(
      (select string_agg(
                 pg_get_userbyid(d.defaclrole) || '→objtype=' || d.defaclobjtype::text || ':' || pg_get_userbyid(x.grantee) || '=' || x.privilege_type,
                 ', '
               )
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
         cross join lateral aclexplode(d.defaclacl) x
         where n.nspname = 'public'),
      '(public 스키마 전용 기본 권한 없음 — 전역 기본값만 적용 중일 수 있음)'
    ) as actual,
    'CHECK' as status
),

-- ---------------------------------------------------------------------------
-- 전체 집계(SUMMARY)
-- ---------------------------------------------------------------------------
all_checks as (
  select * from chk_exists
  union all select * from chk_rls
  union all select * from chk_auth_priv
  union all select * from chk_col_priv_summary
  union all select * from chk_anon_pub
  union all select * from chk_policy_count
  union all select * from chk_policy_list
  union all select * from chk_col_priv
  union all select * from chk_col_priv_effective
  union all select * from chk_id_col
  union all select * from chk_seq
  union all select * from chk_seq_priv
  union all select * from chk_default_acl
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
