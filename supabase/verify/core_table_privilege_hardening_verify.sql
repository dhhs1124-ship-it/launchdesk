-- ============================================================================
-- LaunchDesk 핵심 테이블 권한 최소화 — 적용 "후" 읽기 전용 검증
-- 파일: core_table_privilege_hardening_verify.sql
-- ============================================================================
-- 20260922130000_core_table_privilege_hardening.sql을 적용한 뒤 실행한다.
-- cafe24_disconnect_verify.sql과 달리 이 파일은 처음부터 끝까지 순수
-- 읽기 전용이다 — 실제 사용자 행을 INSERT/UPDATE/DELETE하지 않고, 어떤
-- 테스트 계정도 필요하지 않다. pg_catalog/information_schema 메타데이터만
-- 조회해 GRANT/REVOKE 결과와 부작용 여부를 확인한다.
--
-- [2026-09-22 정정 — 중요] 1차 버전의 07번은 information_schema.column_
-- privileges로 "컬럼 단위 권한 0"을 판정해 FAIL 3건(stores/connected_
-- accounts/tool_records 각 authenticated)을 냈다. 실제로 남은 권한 때문이
-- 아니라 판정 소스 자체의 성격 때문이었다 — PostgreSQL 공식 동작상 그
-- 뷰는 has_column_privilege() 기준 "유효 권한"이라, 테이블 단위 GRANT
-- 하나만 있어도 모든 컬럼에 권한이 있는 것처럼 펼쳐져 나온다(실제로
-- FAIL 3건의 actual 값은 각각 그 테이블의 최종 테이블 권한과 정확히
-- 일치했다 — stores=INSERT,SELECT,UPDATE / connected_accounts=SELECT /
-- tool_records=INSERT,SELECT, 즉 01번 통과값과 동일). 이제 07번은
-- pg_attribute.attacl을 aclexplode()로 직접 풀어 "명시적으로 저장된
-- 컬럼 ACL"만 검사한다 — information_schema.column_privileges 값은
-- 07.5번에 "유효 권한 참고값(ACL 판정에 사용 안 함)"으로 명확히 구분해
-- 남겨뒀다.
--
-- 확인 항목:
--   01) authenticated의 최종 테이블 단위 권한이 정확히 최소 집합인지
--       (stores=DELETE,INSERT,SELECT,UPDATE / connected_accounts=SELECT /
--       tool_records=DELETE,INSERT,SELECT) — 하드 PASS/FAIL.
--   02) TRUNCATE/REFERENCES/TRIGGER/MAINTAIN이 authenticated에 전혀 없는지
--       — 하드 PASS/FAIL.
--   03) anon/PUBLIC 테이블 단위 권한이 3개 테이블 모두에 전무한지 — 하드
--       PASS/FAIL.
--   04) postgres/service_role의 테이블·컬럼 단위 권한(참고용) — migration
--       파일 자체가 이 두 역할을 전혀 언급하지 않는다는 전제하에, 예상 밖
--       변경이 없는지 사람이 눈으로 검토할 수 있도록 현재 상태를 보여준다
--       (구조적 보장은 migration 파일 내용 자체에서 나온다).
--   05) RLS 활성 상태(참고용 — 이 migration은 RLS를 바꾸지 않았으므로 값이
--       prereq 실행 결과와 동일해야 한다)
--   06) 정책 원문(참고용 나열 — prereq 실행 결과와 정확히 동일해야 "정책
--       무변경"이 확인된다)
--   07) [2026-09-22 정정] PUBLIC/anon/authenticated의 명시적 컬럼 ACL
--       (pg_attribute.attacl 원본, aclexplode 기준)이 3개 테이블 모두
--       정확히 0인지 — 하드 PASS/FAIL. information_schema.column_
--       privileges는 쓰지 않는다(테이블 권한까지 컬럼별로 펼쳐 보여줘
--       판정에 부적합함이 확인됨). 07.5는 그 information_schema 값을
--       "유효 권한 참고값(ACL 판정에 사용 안 함)"으로 별도 표시.
--   08) id 시퀀스에 대한 authenticated 권한이 prereq와 동일하게 유지됐는지
--       (참고용 — 이 migration은 시퀀스를 전혀 건드리지 않는다)
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH ... SELECT 한 문장뿐이다. INSERT/UPDATE/DELETE/ALTER/CREATE/
--     DROP/GRANT/REVOKE/TRUNCATE/COPY/SET/DO/CALL/PERFORM/EXECUTE 문장이
--     없다.
--   - public.stores/connected_accounts/tool_records 등 사용자 테이블의
--     실제 행은 어디에서도 SELECT하지 않는다 — 전부 information_schema/
--     pg_catalog 카탈로그 메타데이터만 조회한다.
--   - 테이블/컬럼/정책/시퀀스가 없어도 전체 쿼리가 중단되지 않고, "고정
--     검사"(01~05, 08)의 결과 행도 사라지지 않는다.
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
-- 01) authenticated 최종 권한 — 정확히 최소 집합과 일치해야 PASS.
-- ---------------------------------------------------------------------------
auth_final_keys(ord, tbl, expected_set) as (
  values
    (1.01, 'stores', 'DELETE, INSERT, SELECT, UPDATE'),
    (1.02, 'connected_accounts', 'SELECT'),
    (1.03, 'tool_records', 'DELETE, INSERT, SELECT')
),
chk_auth_final as (
  select
    ord,
    '01_authenticated 최종 권한: public.' || tbl as check_name,
    expected_set as expected,
    coalesce(
      (select string_agg(privilege_type, ', ' order by privilege_type)
         from information_schema.role_table_grants
         where table_schema = 'public' and table_name = k.tbl and grantee = 'authenticated'),
      '(권한 없음 또는 테이블 없음)'
    ) as actual,
    case when (
      select string_agg(privilege_type, ', ' order by privilege_type)
        from information_schema.role_table_grants
        where table_schema = 'public' and table_name = k.tbl and grantee = 'authenticated'
    ) = expected_set then 'PASS' else 'FAIL' end as status
  from auth_final_keys k
),

-- ---------------------------------------------------------------------------
-- 02) TRUNCATE/REFERENCES/TRIGGER/MAINTAIN 부재 — 3개 테이블 × 4개 권한.
-- ---------------------------------------------------------------------------
excess_priv_keys(ord, tbl, priv) as (
  values
    (2.011, 'stores', 'TRUNCATE'),   (2.012, 'stores', 'REFERENCES'),
    (2.013, 'stores', 'TRIGGER'),    (2.014, 'stores', 'MAINTAIN'),
    (2.021, 'connected_accounts', 'TRUNCATE'), (2.022, 'connected_accounts', 'REFERENCES'),
    (2.023, 'connected_accounts', 'TRIGGER'),  (2.024, 'connected_accounts', 'MAINTAIN'),
    (2.031, 'tool_records', 'TRUNCATE'), (2.032, 'tool_records', 'REFERENCES'),
    (2.033, 'tool_records', 'TRIGGER'),  (2.034, 'tool_records', 'MAINTAIN')
),
chk_excess_priv as (
  select
    ord,
    '02_authenticated에 ' || priv || ' 없음: public.' || tbl as check_name,
    '없음' as expected,
    case when exists (
      select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name = k.tbl and grantee = 'authenticated' and privilege_type = k.priv
    ) then '있음(회수 실패)' else '없음' end as actual,
    case when exists (
      select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name = k.tbl and grantee = 'authenticated' and privilege_type = k.priv
    ) then 'FAIL' else 'PASS' end as status
  from excess_priv_keys k
),

-- ---------------------------------------------------------------------------
-- 03) anon/PUBLIC 권한 전무 — 3개 테이블.
-- ---------------------------------------------------------------------------
anon_pub_keys(ord, tbl, grantee_name) as (
  values
    (3.01, 'stores', 'anon'), (3.02, 'connected_accounts', 'anon'), (3.03, 'tool_records', 'anon'),
    (3.11, 'stores', 'PUBLIC'), (3.12, 'connected_accounts', 'PUBLIC'), (3.13, 'tool_records', 'PUBLIC')
),
chk_anon_pub as (
  select
    ord,
    '03_' || grantee_name || ' 권한 전무: public.' || tbl as check_name,
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
-- 04) [2026-09-22 보강] postgres/service_role 권한(참고용) — migration
--     파일이 이 두 역할을 GRANT/REVOKE 대상으로 단 한 번도 언급하지
--     않았으므로 이 값 자체는 판정 대상이 아니다(구조적 보장은 migration
--     파일 내용 자체에서 나온다). 다만 "예상 밖으로 회수됐는지" 사람이
--     눈으로 검토할 수 있도록 테이블 단위·컬럼 단위 권한을 전부 보여준다
--     (이전 버전은 service_role 테이블 단위만 봤다 — postgres와 컬럼
--     단위를 추가했다).
-- ---------------------------------------------------------------------------
owner_priv_keys(ord, tbl, role_name, level_name) as (
  values
    (4.011, 'stores', 'postgres', 'table'), (4.012, 'stores', 'postgres', 'column'),
    (4.013, 'stores', 'service_role', 'table'), (4.014, 'stores', 'service_role', 'column'),
    (4.021, 'connected_accounts', 'postgres', 'table'), (4.022, 'connected_accounts', 'postgres', 'column'),
    (4.023, 'connected_accounts', 'service_role', 'table'), (4.024, 'connected_accounts', 'service_role', 'column'),
    (4.031, 'tool_records', 'postgres', 'table'), (4.032, 'tool_records', 'postgres', 'column'),
    (4.033, 'tool_records', 'service_role', 'table'), (4.034, 'tool_records', 'service_role', 'column')
),
chk_owner_priv as (
  select
    ord,
    '04_' || role_name || ' 현재 ' || level_name || ' 단위 권한(참고용, migration 미언급 — 예상 밖 변경 여부 육안 검토): public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — 참고용, migration이 이 역할을 언급하지 않았으므로 변경 없음이 정상)' as expected,
    case when level_name = 'table' then
      coalesce(
        (select string_agg(privilege_type, ', ' order by privilege_type)
           from information_schema.role_table_grants
           where table_schema = 'public' and table_name = k.tbl and grantee = k.role_name),
        '(전용 GRANT 없음 — 슈퍼유저/소유자 기본 권한으로 접근할 수 있음)'
      )
    else
      coalesce(
        (select count(distinct cp.column_name)::text || '개 컬럼에 [' || string_agg(distinct cp.privilege_type, ',') || ']'
           from information_schema.column_privileges cp
           where cp.table_schema = 'public' and cp.table_name = k.tbl and cp.grantee = k.role_name),
        '(컬럼 단위 GRANT 없음)'
      )
    end as actual,
    'CHECK' as status
  from owner_priv_keys k
),

-- ---------------------------------------------------------------------------
-- 05) RLS 활성 상태 유지(참고용 — prereq 실행 결과와 동일해야 함).
-- ---------------------------------------------------------------------------
rls_keys(ord, tbl) as (
  values (5.01, 'stores'), (5.02, 'connected_accounts'), (5.03, 'tool_records')
),
chk_rls as (
  select
    ord,
    '05_RLS 활성 상태 유지(참고용, prereq와 동일해야 함): public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — prereq 결과와 육안 대조)' as expected,
    coalesce(
      (select 'rls_enabled=' || c.relrowsecurity::text || ' | rls_forced=' || c.relforcerowsecurity::text
         from pg_class c where c.oid = to_regclass('public.' || rk.tbl)),
      'MISSING — 테이블 없음'
    ) as actual,
    'CHECK' as status
  from rls_keys rk
),

-- ---------------------------------------------------------------------------
-- 06) 정책 원문(참고용 나열, prereq와 동일해야 "정책 무변경"이 확인됨).
-- ---------------------------------------------------------------------------
policy_list_keys(tbl) as (
  values ('stores'), ('connected_accounts'), ('tool_records')
),
policy_rows as (
  select plk.tbl, p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check
  from policy_list_keys plk
  left join pg_policies p on p.schemaname = 'public' and p.tablename = plk.tbl
),
chk_policy_list as (
  select
    6.0 as ord,
    '06_정책 원문(참고용, prereq와 동일해야 함): public.' || tbl
      || case when policyname is not null then ' · ' || policyname else '' end as check_name,
    '(참고용 나열 — prereq 결과와 육안 대조)' as expected,
    case when policyname is null then '정책 없음'
         else 'cmd=' || cmd || ' | permissive=' || permissive || ' | roles=' || array_to_string(roles, ',')
              || ' | USING(' || coalesce(qual, '-') || ') | WITH CHECK(' || coalesce(with_check, '-') || ')'
    end as actual,
    'CHECK' as status
  from policy_rows
),

-- ---------------------------------------------------------------------------
-- 07) [2026-09-22 2차 정정 — 중요] 명시적 컬럼 ACL = 0(하드 PASS/FAIL).
--     1차 버전은 information_schema.column_privileges로 이 값을 판정해
--     FAIL 3건을 냈으나, 이는 실제 남은 권한이 아니라 판정 방법의 오류
--     였다. PostgreSQL 공식 동작상 그 뷰는 has_column_privilege() 기준의
--     "유효 권한"이라, 테이블 단위 GRANT SELECT/INSERT/UPDATE/REFERENCES
--     하나만 있어도 그 테이블의 모든 컬럼에 권한이 있는 것처럼 펼쳐져
--     나온다 — "명시적으로 저장된 컬럼 ACL이 존재하는가"라는 질문에는
--     원천적으로 답할 수 없는 소스다. 이제 pg_attribute.attacl을
--     aclexplode()로 직접 풀어 PUBLIC(grantee oid=0)/anon/authenticated
--     앞으로 된 항목이 실제로 있는지만 검사한다. 이 값이 0이라는 것은
--     "컬럼 단위로 별도 저장된 ACL이 없다"는 뜻이고, 테이블 단위 권한
--     (01번)은 여전히 정상적으로 적용된다 — 둘은 서로 다른 층위다.
--     'PUBLIC'은 pg_authid에 없는 pseudo-role이라 role_name::regrole로
--     캐스팅하면 오류가 나므로, CASE로 PUBLIC만 grantee=0으로 직접
--     비교한다(AND/OR는 좌우 평가 순서를 보장하지 않으므로 CASE로 단락
--     평가를 강제함 — PostgreSQL "Expression Evaluation Rules" 참고).
-- ---------------------------------------------------------------------------
col_priv_zero_keys(ord, tbl, role_name) as (
  values
    (7.01, 'stores', 'PUBLIC'),
    (7.02, 'stores', 'anon'),
    (7.03, 'stores', 'authenticated'),
    (7.04, 'connected_accounts', 'PUBLIC'),
    (7.05, 'connected_accounts', 'anon'),
    (7.06, 'connected_accounts', 'authenticated'),
    (7.07, 'tool_records', 'PUBLIC'),
    (7.08, 'tool_records', 'anon'),
    (7.09, 'tool_records', 'authenticated')
),
chk_col_priv_zero as (
  select
    ord,
    '07_명시적 컬럼 ACL 0(pg_attribute.attacl 원본): public.' || tbl || ' · ' || role_name as check_name,
    '0' as expected,
    coalesce(
      (select count(*)::text || '개 항목 [' || string_agg(distinct x.privilege_type, ',') || '] 남음(attacl)'
         from pg_attribute a
         cross join lateral aclexplode(a.attacl) x
         where a.attrelid = to_regclass('public.' || k.tbl)
           and a.attnum > 0 and not a.attisdropped
           and x.grantee = case when k.role_name = 'PUBLIC' then 0 else (k.role_name::regrole)::oid end
      ),
      '0'
    ) as actual,
    case when not exists (
      select 1
        from pg_attribute a
        cross join lateral aclexplode(a.attacl) x
       where a.attrelid = to_regclass('public.' || k.tbl)
         and a.attnum > 0 and not a.attisdropped
         and x.grantee = case when k.role_name = 'PUBLIC' then 0 else (k.role_name::regrole)::oid end
    ) then 'PASS' else 'FAIL' end as status
  from col_priv_zero_keys k
),

-- 07.5) [2026-09-22 신설] information_schema.column_privileges 기준
--     "유효 권한" 참고값 — 위에서 설명한 이유로 테이블 단위 권한도 컬럼별로
--     펼쳐져 나온다. 명시적 컬럼 ACL 존재 판정에는 절대 쓰지 않는다(07번만
--     그 목적으로 쓴다) — 여기는 "이 역할이 이 컬럼에 실질적으로 어떤
--     권한을 행사할 수 있는가"를 사람이 참고하는 용도로만 남긴다.
col_priv_list_keys(tbl) as (
  values ('stores'), ('connected_accounts'), ('tool_records')
),
col_priv_agg as (
  select
    cplk.tbl, cp.column_name, cp.grantee,
    string_agg(distinct cp.privilege_type, ', ' order by cp.privilege_type) as privs
  from col_priv_list_keys cplk
  left join information_schema.column_privileges cp
    on cp.table_schema = 'public' and cp.table_name = cplk.tbl
  group by cplk.tbl, cp.column_name, cp.grantee
),
chk_col_priv_detail as (
  select
    7.5 as ord,
    '07_5_유효 권한 참고값(information_schema, 테이블 권한 포함 — ACL 판정에 사용 안 함): public.' || tbl
      || case when column_name is not null then ' · ' || column_name || ' · ' || grantee else '' end as check_name,
    '(참고용 나열 — PASS/FAIL 없음, 07번의 명시적 ACL 존재 여부와 다른 개념)' as expected,
    case when column_name is null then '유효 권한 없음' else privs end as actual,
    'CHECK' as status
  from col_priv_agg
),

-- ---------------------------------------------------------------------------
-- 08) id 시퀀스에 대한 authenticated 권한 유지(참고용 — prereq와 동일해야
--     함, 이 migration은 SEQUENCE를 전혀 언급하지 않는다).
-- ---------------------------------------------------------------------------
seq_keys(ord, tbl) as (
  values (8.01, 'stores'), (8.02, 'connected_accounts'), (8.03, 'tool_records')
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
chk_seq_priv as (
  select
    ord,
    '08_authenticated의 id 시퀀스 권한 유지(참고용, prereq와 동일해야 함): public.' || tbl as check_name,
    '(PASS/FAIL 판단 대상 아님 — prereq 결과와 육안 대조, 이 migration은 시퀀스 무변경)' as expected,
    case
      when seq_name is null then 'N/A(시퀀스 없음)'
      else 'usage=' || has_sequence_privilege('authenticated', seq_name::regclass, 'usage')::text
        || ' | select=' || has_sequence_privilege('authenticated', seq_name::regclass, 'select')::text
        || ' | update=' || has_sequence_privilege('authenticated', seq_name::regclass, 'update')::text
    end as actual,
    'CHECK' as status
  from seq_info
),

-- ---------------------------------------------------------------------------
-- 전체 집계(SUMMARY)
-- ---------------------------------------------------------------------------
all_checks as (
  select * from chk_auth_final
  union all select * from chk_excess_priv
  union all select * from chk_anon_pub
  union all select * from chk_owner_priv
  union all select * from chk_rls
  union all select * from chk_policy_list
  union all select * from chk_col_priv_zero
  union all select * from chk_col_priv_detail
  union all select * from chk_seq_priv
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
