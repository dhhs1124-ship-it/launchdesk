-- ============================================================================
-- LaunchDesk 광고 세트 손익분기 기준 연결(ad_margin_links) — 원격 스키마 선행 확인
-- 파일: ad_margin_links_prereq_readonly.sql
-- ============================================================================
-- 목적: 새 테이블(ad_margin_links)의 마이그레이션을 쓰기 전에, 이 저장소의
-- 마이그레이션에는 없는(Supabase Studio에서 직접 만든) 기존 테이블의 실제 모양을
-- 사람이 Supabase SQL Editor에서 한 번 실행해 확인한다.
--   1) public.stores.id 의 정확한 타입            → 새 테이블 store_id 컬럼 타입 / FK
--   2) stores 의 사용자 소유권 컬럼과 타입        → RLS 정책의 소유권 조건
--   3) stores 의 PK · FK · UNIQUE · CHECK 제약    → FK 대상, on delete 동작
--   4) stores 의 RLS 활성화 여부와 정책 원문      → 기존 소유권 정책 패턴
--   5) tool_records 의 컬럼 · PK · RLS · 정책 · GRANT
--   6) 기존 테이블의 created_at/updated_at 타입 · 기본값 · 갱신 트리거
--   7) auth.uid() 와 stores 소유권을 잇는 기존 정책 · 함수 패턴
--   (8번 "개인정보처리방침이 이 저장을 포괄하는가"는 SQL이 아니라 저장소 코드
--    (index.html #view-privacy, policy-consent-core.js)로 확인한다 — 이 파일 범위 밖.)
--
-- 이 파일은 supabase/verify/remote_schema_readonly_audit.sql 과 같은 성격이다 —
-- information_schema/pg_catalog 메타데이터만 읽고, 실행해도 DB에 흔적이 남지 않는다.
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH/SELECT 한 문장뿐이다. INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/GRANT/
--     REVOKE/TRUNCATE/COPY/SET/DO/CALL/PERFORM/EXECUTE 문장이 없다.
--     ('INSERT' 같은 대문자 단어가 보이는 곳은 전부 주석이나 문자열 리터럴이다.)
--   - 사용자 행 데이터를 읽지 않는다. stores / tool_records / connected_accounts
--     등 어떤 사용자 테이블도 FROM/JOIN 대상이 아니다 — 테이블은 to_regclass()로
--     "존재하는지"만 확인하고, 내용은 pg_class / pg_attribute / pg_constraint /
--     pg_policies / pg_index(es) / pg_trigger / pg_proc 카탈로그로만 읽는다.
--   - 어떤 함수도 실제로 호출하지 않는다(pg_proc의 서명 · 옵션만 조회하고 본문은
--     출력하지 않는다).
--   - 테이블이 없어도 전체 쿼리가 중단되지 않는다(to_regclass는 없으면 NULL).
--
-- 실행 방법: 이 파일 전체를 Supabase SQL Editor에 그대로 붙여넣고 한 번에 실행한다.
-- 결과는 section / item / detail 세 컬럼의 표 하나로 나온다(section 순서대로 읽는다).
--
-- 결과를 공유하기 전에 확인할 것(사용자 데이터는 나오지 않지만 원격 설정이 나온다):
--   - detail 안의 정책 원문(USING / WITH CHECK)과 default 값에 이메일 주소, UUID
--     리터럴, 토큰처럼 보이는 문자열이 있으면 그 값만 가리고 공유한다.
--     (저장소 마이그레이션에는 그런 리터럴이 없지만, Studio에서 직접 만든 정책은
--     저장소로 확인할 수 없다.)
--   - 함수 본문은 출력하지 않는다(서명 · security · search_path만 나온다).
--
-- ※ 이 파일은 저장소에만 존재한다. 작성한 세션에서는 원격 DB에 실행하지 않았다
--    (읽기 전용 조사 지침에 따름 — 실행은 사람이 한다). 로컬 Postgres가 없어 문법도
--    실제 서버로는 확인하지 못했다(정적 검사만). 실행 중 오류가 나면 오류 문구와
--    함께 알려 달라.
-- ============================================================================

with
-- 대상 테이블: 핵심 2개(stores, tool_records) + 광고계정 연결 참고용 1개(connected_accounts)
targets(tbl) as (
  values ('stores'), ('tool_records'), ('connected_accounts')
),
t as (
  select tg.tbl, to_regclass('public.' || tg.tbl) as oid
  from targets tg
),
rel as (
  select
    to_regclass('public.stores')       as stores_oid,
    to_regclass('public.tool_records') as tr_oid,
    to_regclass('auth.users')          as users_oid
),

-- ---------------------------------------------------------------------------
-- 00 핵심 요약 — 아래 세부 섹션에서 뽑은 결론만 한눈에 (판단은 사람이 한다)
-- ---------------------------------------------------------------------------
r_summary as (
  select '00_핵심 요약' as section, 'stores.id 타입' as item,
    coalesce((select format_type(a.atttypid, a.atttypmod)
              from rel join pg_attribute a on a.attrelid = rel.stores_oid
              where a.attname = 'id' and not a.attisdropped), '(stores.id 없음)') as detail
  union all
  select '00_핵심 요약', 'stores 소유권 후보 컬럼(이름 · 타입)',
    coalesce((select string_agg(a.attname || ' : ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
              from rel join pg_attribute a on a.attrelid = rel.stores_oid
              where a.attnum > 0 and not a.attisdropped
                and a.attname in ('user_id', 'owner_id', 'owner', 'created_by', 'profile_id', 'account_id')), '(후보 이름의 컬럼 없음 — 컬럼 목록 직접 확인)')
  union all
  select '00_핵심 요약', 'stores → auth.users 를 참조하는 FK',
    coalesce((select string_agg(c.conname || ' : ' || pg_get_constraintdef(c.oid), ' ; ')
              from rel join pg_constraint c on c.conrelid = rel.stores_oid
              where c.contype = 'f' and c.confrelid = rel.users_oid), '(없음)')
  union all
  select '00_핵심 요약', 'stores PRIMARY KEY',
    coalesce((select string_agg(c.conname || ' : ' || pg_get_constraintdef(c.oid), ' ; ')
              from rel join pg_constraint c on c.conrelid = rel.stores_oid
              where c.contype = 'p'), '(없음)')
  union all
  select '00_핵심 요약', 'stores RLS',
    coalesce((select 'rls_enabled=' || c.relrowsecurity::text || ' | rls_forced=' || c.relforcerowsecurity::text
                     || ' | 정책 수=' || (select count(*)::text from pg_policies p where p.schemaname = 'public' and p.tablename = 'stores')
              from rel join pg_class c on c.oid = rel.stores_oid), '(stores 없음)')
  union all
  select '00_핵심 요약', 'tool_records PRIMARY KEY',
    coalesce((select string_agg(c.conname || ' : ' || pg_get_constraintdef(c.oid), ' ; ')
              from rel join pg_constraint c on c.conrelid = rel.tr_oid
              where c.contype = 'p'), '(없음 또는 tool_records 없음)')
  union all
  select '00_핵심 요약', 'tool_records RLS',
    coalesce((select 'rls_enabled=' || c.relrowsecurity::text || ' | rls_forced=' || c.relforcerowsecurity::text
                     || ' | 정책 수=' || (select count(*)::text from pg_policies p where p.schemaname = 'public' and p.tablename = 'tool_records')
              from rel join pg_class c on c.oid = rel.tr_oid), '(tool_records 없음)')
  union all
  select '00_핵심 요약', 'tool_records 컬럼(이름 : 타입)',
    coalesce((select string_agg(a.attname || ' : ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
              from rel join pg_attribute a on a.attrelid = rel.tr_oid
              where a.attnum > 0 and not a.attisdropped), '(tool_records 없음)')
  union all
  select '00_핵심 요약', 'auth.users.id 타입',
    coalesce((select format_type(a.atttypid, a.atttypmod)
              from rel join pg_attribute a on a.attrelid = rel.users_oid
              where a.attname = 'id' and not a.attisdropped), '(auth.users 없음)')
),

-- ---------------------------------------------------------------------------
-- 01 존재 여부
-- ---------------------------------------------------------------------------
r_exists as (
  select '01_존재 여부' as section, 'public.' || t.tbl as item,
    case when t.oid is null then 'MISSING — public 스키마에 이 이름의 객체가 없습니다'
         else 'exists (relkind=' || (select c.relkind::text from pg_class c where c.oid = t.oid) || ')' end as detail
  from t
),

-- ---------------------------------------------------------------------------
-- 02 컬럼 — 이름 · 타입 · NULL 여부 · 기본값 · identity/generated (항목 1, 2, 5)
-- ---------------------------------------------------------------------------
r_cols as (
  select '02_컬럼' as section,
    t.tbl || '.' || a.attname || ' (#' || lpad(a.attnum::text, 2, '0') || ')' as item,
    concat_ws(' | ',
      format_type(a.atttypid, a.atttypmod),
      case when a.attnotnull then 'NOT NULL' else 'NULL 허용' end,
      case when d.adbin is not null then 'default=' || pg_get_expr(d.adbin, d.adrelid) end,
      case a.attidentity when 'a' then 'identity=ALWAYS' when 'd' then 'identity=BY DEFAULT' end,
      case a.attgenerated when 's' then 'generated=STORED' end
    ) as detail
  from t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),

-- ---------------------------------------------------------------------------
-- 03 제약조건 · 인덱스 · 이 테이블을 참조하는 FK (항목 3)
-- ---------------------------------------------------------------------------
r_cons as (
  select '03_제약조건' as section,
    t.tbl || ' · ' || c.conname || ' [' ||
      case c.contype when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY' when 'u' then 'UNIQUE'
                     when 'c' then 'CHECK' when 'x' then 'EXCLUDE' else c.contype::text end || ']' as item,
    pg_get_constraintdef(c.oid) as detail
  from t
  join pg_constraint c on c.conrelid = t.oid
),
r_idx as (
  select '03_인덱스(UNIQUE 인덱스 포함)' as section,
    i.tablename || ' · ' || i.indexname as item,
    i.indexdef as detail
  from pg_indexes i
  join targets tg on tg.tbl = i.tablename
  where i.schemaname = 'public'
),
r_inbound as (
  select '03_stores 를 참조하는 FK(삭제 시 동작 확인용)' as section,
    c.conrelid::regclass::text || ' · ' || c.conname as item,
    pg_get_constraintdef(c.oid) as detail
  from rel
  join pg_constraint c on c.confrelid = rel.stores_oid
  where c.contype = 'f'
),

-- ---------------------------------------------------------------------------
-- 04 RLS · 정책 원문 (항목 4, 5)
-- ---------------------------------------------------------------------------
r_rls as (
  select '04_RLS 활성화' as section,
    'public.' || t.tbl as item,
    'rls_enabled=' || c.relrowsecurity::text || ' | rls_forced=' || c.relforcerowsecurity::text
      || ' | 테이블 소유자=' || pg_get_userbyid(c.relowner) as detail
  from t
  join pg_class c on c.oid = t.oid
),
r_pol as (
  select '04_정책 원문' as section,
    p.tablename || ' · ' || p.policyname as item,
    'cmd=' || p.cmd || ' | permissive=' || p.permissive || ' | roles=' || array_to_string(p.roles, ',')
      || ' | USING(' || coalesce(p.qual, '-') || ') | WITH CHECK(' || coalesce(p.with_check, '-') || ')' as detail
  from pg_policies p
  join targets tg on tg.tbl = p.tablename
  where p.schemaname = 'public'
),

-- ---------------------------------------------------------------------------
-- 05 GRANT — 테이블 · 컬럼 · public 스키마 기본 권한 (항목 5)
-- ---------------------------------------------------------------------------
r_acl as (
  select '05_테이블 GRANT' as section,
    t.tbl || ' · ' || coalesce(r.rolname, 'PUBLIC') as item,
    string_agg(x.privilege_type || case when x.is_grantable then '(+GRANT OPTION)' else '' end, ', ' order by x.privilege_type) as detail
  from t
  join pg_class c on c.oid = t.oid
  cross join lateral aclexplode(c.relacl) x
  left join pg_roles r on r.oid = x.grantee
  group by t.tbl, coalesce(r.rolname, 'PUBLIC')
),
r_acl_null as (
  select '05_테이블 GRANT' as section,
    t.tbl || ' · (ACL 없음)' as item,
    'relacl IS NULL — 별도 GRANT 없이 소유자 기본 권한만 있는 상태' as detail
  from t
  join pg_class c on c.oid = t.oid
  where c.relacl is null
),
r_colacl as (
  select '05_컬럼 단위 GRANT' as section,
    t.tbl || '.' || a.attname || ' · ' || coalesce(r.rolname, 'PUBLIC') as item,
    string_agg(x.privilege_type, ', ' order by x.privilege_type) as detail
  from t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  cross join lateral aclexplode(a.attacl) x
  left join pg_roles r on r.oid = x.grantee
  group by t.tbl, a.attname, coalesce(r.rolname, 'PUBLIC')
),
r_defacl as (
  select '05_기본 권한(pg_default_acl — 새 테이블 자동 GRANT 여부)' as section,
    pg_get_userbyid(d.defaclrole) || ' → 객체유형 ' || d.defaclobjtype::text
      || ' (' || case when d.defaclnamespace = 0 then '모든 스키마' else 'public' end || ') · ' || coalesce(r.rolname, 'PUBLIC') as item,
    string_agg(x.privilege_type, ', ' order by x.privilege_type) as detail
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles r on r.oid = x.grantee
  where d.defaclnamespace = 0 or n.nspname = 'public'
  group by d.defaclrole, d.defaclobjtype, d.defaclnamespace, coalesce(r.rolname, 'PUBLIC')
),

-- ---------------------------------------------------------------------------
-- 06 created_at / updated_at — 타입 · 기본값 · 갱신 방식 (항목 6)
-- ---------------------------------------------------------------------------
r_ts as (
  select '06_created_at/updated_at 컬럼(public 전체 테이블)' as section,
    c.relname || '.' || a.attname as item,
    concat_ws(' | ',
      format_type(a.atttypid, a.atttypmod),
      case when a.attnotnull then 'NOT NULL' else 'NULL 허용' end,
      coalesce('default=' || pg_get_expr(d.adbin, d.adrelid), 'default 없음')
    ) as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                     and a.attname in ('created_at', 'updated_at')
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where c.relkind in ('r', 'p')
),
r_trg as (
  select '06_트리거(public 전체 테이블, 내부 트리거 제외)' as section,
    c.relname || ' · ' || tr.tgname as item,
    concat_ws(' | ',
      'fn=' || pn.nspname || '.' || p.proname,
      'enabled=' || tr.tgenabled::text,
      'fn이 updated_at을 언급=' || (p.prosrc ilike '%updated_at%')::text,
      pg_get_triggerdef(tr.oid)
    ) as detail
  from pg_trigger tr
  join pg_class c on c.oid = tr.tgrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_proc p on p.oid = tr.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where not tr.tgisinternal
),
r_fn_ts as (
  select '06_updated_at 성격의 public 함수(서명만, 본문 미출력)' as section,
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
    concat_ws(' | ',
      'returns=' || format_type(p.prorettype, null),
      'security=' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
      'search_path=' || coalesce(array_to_string(p.proconfig, ','), '(미설정)')
    ) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.proname ilike '%updated%'
),

-- ---------------------------------------------------------------------------
-- 07 auth.uid() ↔ stores 소유권 — 기존 정책 · 함수 패턴 (항목 7)
-- ---------------------------------------------------------------------------
r_own_pol as (
  select '07_stores 를 언급하는 정책(다른 테이블이 stores 소유권을 확인하는 방식)' as section,
    p.tablename || ' · ' || p.policyname as item,
    'cmd=' || p.cmd || ' | roles=' || array_to_string(p.roles, ',')
      || ' | USING(' || coalesce(p.qual, '-') || ') | WITH CHECK(' || coalesce(p.with_check, '-') || ')' as detail
  from pg_policies p
  where p.schemaname = 'public'
    and (p.qual ilike '%stores%' or p.with_check ilike '%stores%')
),
r_own_fn as (
  select '07_stores 와 auth.uid() 를 함께 다루는 public 함수(서명만, 본문 미출력)' as section,
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
    concat_ws(' | ',
      'security=' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
      'returns=' || format_type(p.prorettype, null),
      'search_path=' || coalesce(array_to_string(p.proconfig, ','), '(미설정)')
    ) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.prosrc ilike '%stores%' and p.prosrc ilike '%auth.uid()%'
),

-- ---------------------------------------------------------------------------
-- 08 참고 — FK 대상이 될 auth.users 의 PK 타입
-- ---------------------------------------------------------------------------
r_auth as (
  select '08_참고: auth.users' as section,
    'auth.users PRIMARY KEY' as item,
    coalesce((select string_agg(c.conname || ' : ' || pg_get_constraintdef(c.oid), ' ; ')
              from rel join pg_constraint c on c.conrelid = rel.users_oid
              where c.contype = 'p'), '(auth.users 없음)') as detail
)

select u.section, u.item, u.detail
from (
  select * from r_summary
  union all select * from r_exists
  union all select * from r_cols
  union all select * from r_cons
  union all select * from r_idx
  union all select * from r_inbound
  union all select * from r_rls
  union all select * from r_pol
  union all select * from r_acl
  union all select * from r_acl_null
  union all select * from r_colacl
  union all select * from r_defacl
  union all select * from r_ts
  union all select * from r_trg
  union all select * from r_fn_ts
  union all select * from r_own_pol
  union all select * from r_own_fn
  union all select * from r_auth
) u
order by u.section, u.item, u.detail;
