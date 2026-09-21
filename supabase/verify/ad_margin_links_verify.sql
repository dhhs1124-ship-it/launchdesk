-- ============================================================================
-- LaunchDesk ad_margin_links 적용 후 검증 — ad_margin_links_verify.sql
-- ============================================================================
-- 대상: supabase/migrations/20260921230000_ad_margin_links.sql 이 원격 DB에 적용된 뒤,
-- 테이블 · 제약 · RLS · 권한이 설계대로인지 사람이 Supabase SQL Editor에서 한 번
-- 실행해 PASS/FAIL 표로 확인한다. (적용 전에 실행하면 대부분 FAIL로 나오는 것이 정상.)
--
-- 이 파일은 information_schema/pg_catalog 메타데이터만 SELECT로 읽는다. 테스트 계정도
-- 필요 없고, 실행해도 DB에 어떤 흔적도 남기지 않는다(supabase/verify/plans_verify.sql처럼
-- INSERT를 해보고 롤백하는 방식이 아니다).
--
-- 안전 요건(이 파일 전체에 적용됨):
--   - WITH/SELECT 한 문장뿐이다. INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/GRANT/REVOKE/
--     TRUNCATE/COPY/SET/DO/CALL/PERFORM/EXECUTE 문장이 없다. ('INSERT' 같은 대문자
--     단어가 보이는 곳은 전부 권한 이름과 비교하는 문자열 리터럴이나 주석이다.)
--   - 사용자 행 데이터를 읽지 않는다. public.ad_margin_links · public.stores 어느 것도
--     FROM/JOIN 대상이 아니다 — to_regclass()로 존재 여부만 확인하고 내용은 pg_class /
--     pg_attribute / pg_constraint / pg_policies / pg_trigger / pg_proc / pg_depend 같은
--     카탈로그로만 읽는다.
--   - 어떤 함수도 실제로 호출하지 않는다(트리거 함수는 pg_proc의 서명 · 옵션 · 본문 일치
--     여부만 본다).
--   - 테이블이 없어도 전체 쿼리가 중단되지 않는다(to_regclass는 없으면 NULL).
--
-- 실행 방법: 이 파일 전체를 SQL Editor에 그대로 붙여넣고 한 번에 실행한다. 결과는
-- check_name / expected / actual / status 표 하나이고, 맨 위 SUMMARY 행이 전체 결과다.
--   PASS  = 설계와 일치
--   FAIL  = 설계와 다름(actual 컬럼에 실제 값)
--   CHECK = 참고 정보(service_role 권한 · 서버 버전 등) 또는 사람이 판단할 항목 — 실패 신호 아님
--
-- 이 파일로 확인하지 못하는 것: INSERT/UPDATE가 실제로 되는지(RLS · 제약이 실제로 값을
-- 막는지)는 쓰기 없이는 볼 수 없다. 카탈로그로 "정의가 설계와 같은지"만 확인한다.
--
-- 결과를 공유하기 전에 확인할 것: 사용자 데이터는 나오지 않는다. 정책 원문(USING /
-- WITH CHECK)이 actual에 그대로 나오므로 이메일 · 토큰처럼 보이는 문자열이 있으면 가리고
-- 공유한다(이 테이블의 정책에는 없다).
--
-- ※ 이 파일은 저장소에만 존재한다. 작성한 세션에서는 원격 DB에 실행하지 않았고, 로컬
--    Postgres가 없어 문법도 실제 서버로는 확인하지 못했다(정적 검사만).
-- ============================================================================

with
rel as (
  select to_regclass('public.ad_margin_links') as t_oid,
         to_regclass('public.stores')          as s_oid
),

-- ---------------------------------------------------------------------------
-- 기대하는 컬럼 12개 (이름, 타입, NOT NULL, identity, default)
-- ---------------------------------------------------------------------------
exp_cols(col, typ, nn, ident, dflt) as (
  values
    ('id',              'bigint',                   true, 'a', null),
    ('store_id',        'bigint',                   true, '',  null),
    ('meta_adset_id',   'text',                     true, '',  null),
    ('product_label',   'text',                     true, '',  null),
    ('calc_version',    'integer',                  true, '',  null),
    ('currency',        'text',                     true, '',  null),
    ('total_income',    'numeric',                  true, '',  null),
    ('pre_ad',          'numeric',                  true, '',  null),
    ('source_saved_at', 'timestamp with time zone', true, '',  null),
    ('confirmed_at',    'timestamp with time zone', true, '',  'now()'),
    ('created_at',      'timestamp with time zone', true, '',  'now()'),
    ('updated_at',      'timestamp with time zone', true, '',  'now()')
),
act as (
  select a.attname::text as col,
         format_type(a.atttypid, a.atttypmod) as typ,
         a.attnotnull as nn,
         a.attidentity::text as ident,
         pg_get_expr(d.adbin, d.adrelid) as dflt
  from rel
  join pg_attribute a on a.attrelid = rel.t_oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),

-- ---------------------------------------------------------------------------
-- 제약 · 정책 · 권한 · 시퀀스 · 트리거 원본 (모두 카탈로그)
-- ---------------------------------------------------------------------------
cons as (
  select c.conname::text as conname,
         c.contype::text as contype,
         (select array_agg(a.attname::text order by k.o)
            from unnest(c.conkey) with ordinality k(n, o)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as cols,
         c.confrelid as confrelid,
         c.confdeltype::text as deltype,
         c.confupdtype::text as updtype,
         (select array_agg(a.attname::text order by k.o)
            from unnest(c.confkey) with ordinality k(n, o)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) as refcols,
         pg_get_constraintdef(c.oid) as def
  from rel
  join pg_constraint c on c.conrelid = rel.t_oid
),
exp_checks(cname, pat, human) as (
  values
    ('ad_margin_links_product_label_length',  'char_length\(btrim\(product_label\)\).*>=\s*1\M.*<=\s*40\M', 'char_length(btrim(product_label)) 1~40'),
    ('ad_margin_links_meta_adset_id_format',  'meta_adset_id\s*~.*\^\[0-9\]\{1,20\}\$',                     'meta_adset_id ~ ^[0-9]{1,20}$'),
    ('ad_margin_links_currency_krw',          'currency\s*=\s*.KRW.',                                       'currency = KRW'),
    ('ad_margin_links_calc_version_supported','calc_version\s*=\s*2\M',                                     'calc_version = 2'),
    ('ad_margin_links_total_income_finite',   'total_income\s*-\s*total_income',                            'total_income - total_income = 0 (NaN/Infinity 거부)'),
    ('ad_margin_links_pre_ad_finite',         'pre_ad\s*-\s*pre_ad',                                        'pre_ad - pre_ad = 0 (NaN/Infinity 거부)')
),
pol as (
  select p.policyname::text as name,
         p.cmd::text as cmd,
         p.permissive::text as permissive,
         array_to_string(p.roles, ',') as roles,
         p.qual as qual,
         p.with_check as with_check,
         coalesce(p.qual ~* 'stores'
                  and p.qual ~* 'user_id\s*=\s*\(?\s*(select\s+)?auth\.uid\(\)'
                  and p.qual ~* '\.id\s*=\s*(\w+\.)?store_id|store_id\s*=\s*\w+\.id', false) as own_q,
         coalesce(p.with_check ~* 'stores'
                  and p.with_check ~* 'user_id\s*=\s*\(?\s*(select\s+)?auth\.uid\(\)'
                  and p.with_check ~* '\.id\s*=\s*(\w+\.)?store_id|store_id\s*=\s*\w+\.id', false) as own_w
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'ad_margin_links'
),
tacl as (
  select coalesce(r.rolname::text, 'PUBLIC') as grantee,
         x.privilege_type::text as priv,
         x.is_grantable as grantable
  from rel
  join pg_class c on c.oid = rel.t_oid
  cross join lateral aclexplode(c.relacl) x
  left join pg_roles r on r.oid = x.grantee
  where coalesce(r.rolname::text, 'PUBLIC') <> pg_get_userbyid(c.relowner)::text
),
seq as (
  select sc.oid as q_oid, sc.relname::text as q_name
  from rel
  join pg_attribute a on a.attrelid = rel.t_oid and a.attname = 'id' and not a.attisdropped
  join pg_depend d on d.refclassid = 'pg_class'::regclass and d.refobjid = rel.t_oid and d.refobjsubid = a.attnum
                  and d.classid = 'pg_class'::regclass and d.deptype in ('i', 'a')
  join pg_class sc on sc.oid = d.objid and sc.relkind = 'S'
),
sacl as (
  select coalesce(r.rolname::text, 'PUBLIC') as grantee,
         x.privilege_type::text as priv,
         x.is_grantable as grantable
  from seq
  join pg_class sc on sc.oid = seq.q_oid
  cross join lateral aclexplode(sc.relacl) x
  left join pg_roles r on r.oid = x.grantee
  where coalesce(r.rolname::text, 'PUBLIC') <> pg_get_userbyid(sc.relowner)::text
),
trg as (
  select tr.tgname::text as name,
         tr.tgtype as tgtype,
         p.proname::text as fn,
         pn.nspname::text as fn_schema,
         p.prosecdef as secdef,
         p.proconfig as cfg,
         p.prosrc as src,
         p.proacl as acl
  from rel
  join pg_trigger tr on tr.tgrelid = rel.t_oid and not tr.tgisinternal
  join pg_proc p on p.oid = tr.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
),

-- ---------------------------------------------------------------------------
-- 검사 항목 (ord 순서로 출력)
-- ---------------------------------------------------------------------------
c_prereq as (
  select 1 as ord, 'prereq · public.stores.id = bigint (FK 대상 타입)' as check_name, 'bigint' as expected,
    coalesce((select format_type(a.atttypid, a.atttypmod)
              from rel join pg_attribute a on a.attrelid = rel.s_oid and a.attname = 'id' and not a.attisdropped),
             '(stores.id 없음)') as actual,
    case when exists (select 1 from rel join pg_attribute a on a.attrelid = rel.s_oid and a.attname = 'id'
                      and not a.attisdropped and a.atttypid = 'int8'::regtype) then 'PASS' else 'FAIL' end as status
  union all
  select 2, 'prereq · public.stores.user_id = uuid NOT NULL (소유권 컬럼)', 'uuid | NOT NULL',
    coalesce((select format_type(a.atttypid, a.atttypmod) || ' | ' || case when a.attnotnull then 'NOT NULL' else 'NULL 허용' end
              from rel join pg_attribute a on a.attrelid = rel.s_oid and a.attname = 'user_id' and not a.attisdropped),
             '(stores.user_id 없음)'),
    case when exists (select 1 from rel join pg_attribute a on a.attrelid = rel.s_oid and a.attname = 'user_id'
                      and not a.attisdropped and a.attnotnull and a.atttypid = 'uuid'::regtype) then 'PASS' else 'FAIL' end
  union all
  select 3, 'prereq · public.stores RLS 활성화', 'relrowsecurity = true',
    coalesce((select 'relrowsecurity=' || c.relrowsecurity::text from rel join pg_class c on c.oid = rel.s_oid), '(stores 없음)'),
    case when exists (select 1 from rel join pg_class c on c.oid = rel.s_oid where c.relrowsecurity) then 'PASS' else 'FAIL' end
),
c_table as (
  select 10 as ord, 'table · public.ad_margin_links 존재(일반 테이블)' as check_name, 'relkind = r' as expected,
    coalesce((select c.relkind::text from rel join pg_class c on c.oid = rel.t_oid), 'MISSING') as actual,
    case when exists (select 1 from rel join pg_class c on c.oid = rel.t_oid where c.relkind = 'r') then 'PASS' else 'FAIL' end as status
),
c_cols as (
  select 20 as ord, 'columns · ' || e.col as check_name,
    e.typ || ' | ' || case when e.nn then 'NOT NULL' else 'NULL 허용' end
      || ' | identity=' || case when e.ident = 'a' then 'ALWAYS' else 'none' end
      || ' | default=' || coalesce(e.dflt, 'none') as expected,
    coalesce(a.typ || ' | ' || case when a.nn then 'NOT NULL' else 'NULL 허용' end
      || ' | identity=' || case a.ident when 'a' then 'ALWAYS' when 'd' then 'BY DEFAULT' else 'none' end
      || ' | default=' || coalesce(a.dflt, 'none'), '(컬럼 없음)') as actual,
    case when a.col is not null and a.typ = e.typ and a.nn = e.nn and a.ident = e.ident
              and a.dflt is not distinct from e.dflt then 'PASS' else 'FAIL' end as status
  from exp_cols e
  left join act a on a.col = e.col
),
c_extra as (
  select 21 as ord, 'columns · 예상 밖 컬럼 없음(user_id 등 소유자 값 중복 저장 금지, 성과 데이터 컬럼 금지)' as check_name,
    '(없음) — 정확히 12개 컬럼' as expected,
    coalesce((select string_agg(a.col, ', ' order by a.col) from act a where a.col not in (select col from exp_cols)), '(없음)')
      || ' | 컬럼 수=' || (select count(*)::text from act) as actual,
    case when not exists (select 1 from act a where a.col not in (select col from exp_cols))
              and (select count(*) from act) = 12 then 'PASS' else 'FAIL' end as status
),
c_cons as (
  select 30 as ord, 'constraint · PRIMARY KEY (id)' as check_name, 'PRIMARY KEY (id), 하나' as expected,
    coalesce((select string_agg(x.def, '; ') from cons x where x.contype = 'p'), '(없음)') as actual,
    case when (select count(*) from cons x where x.contype = 'p') = 1
              and exists (select 1 from cons x where x.contype = 'p' and x.cols = array['id']) then 'PASS' else 'FAIL' end as status
  union all
  select 31, 'constraint · FOREIGN KEY (store_id) → public.stores(id) ON DELETE CASCADE, FK는 이것 하나',
    'store_id → stores(id) | ON DELETE CASCADE | ON UPDATE NO ACTION',
    coalesce((select string_agg(x.def, '; ') from cons x where x.contype = 'f'), '(없음)'),
    case when (select count(*) from cons x where x.contype = 'f') = 1
              and exists (select 1 from cons x, rel
                          where x.contype = 'f' and x.cols = array['store_id'] and x.confrelid = rel.s_oid
                            and x.refcols = array['id'] and x.deltype = 'c' and x.updtype = 'a') then 'PASS' else 'FAIL' end
  union all
  select 32, 'constraint · UNIQUE (store_id, meta_adset_id), UNIQUE는 이것 하나',
    'UNIQUE (store_id, meta_adset_id) — 이 순서',
    coalesce((select string_agg(x.def, '; ') from cons x where x.contype = 'u'), '(없음)'),
    case when (select count(*) from cons x where x.contype = 'u') = 1
              and exists (select 1 from cons x where x.contype = 'u' and x.cols = array['store_id', 'meta_adset_id']) then 'PASS' else 'FAIL' end
  union all
  select 33, 'constraint · CHECK 정확히 6개(product_label · meta_adset_id · currency · calc_version · total_income · pre_ad)',
    '6개',
    (select count(*)::text from cons x where x.contype = 'c') || '개: '
      || coalesce((select string_agg(x.conname, ', ' order by x.conname) from cons x where x.contype = 'c'), '(없음)'),
    case when (select count(*) from cons x where x.contype = 'c') = 6 then 'PASS' else 'FAIL' end
  union all
  select 34, 'constraint · total_income / pre_ad 에 양수 · 음수 제약 없음(0원 · 적자 상태 보존)',
    '(없음)',
    coalesce((select string_agg(x.conname, ', ') from cons x
              where x.contype = 'c' and x.def ~* '(total_income|pre_ad)\)*\s*(>=|>)\s*\(?\s*0\M'), '(없음)'),
    case when not exists (select 1 from cons x
                          where x.contype = 'c' and x.def ~* '(total_income|pre_ad)\)*\s*(>=|>)\s*\(?\s*0\M') then 'PASS' else 'FAIL' end
),
c_named as (
  select 35 as ord, 'check · ' || e.cname as check_name, e.human as expected,
    coalesce((select x.def from cons x where x.conname = e.cname and x.contype = 'c'), '(제약 없음)') as actual,
    case when exists (select 1 from cons x where x.conname = e.cname and x.contype = 'c' and x.def ~ e.pat) then 'PASS' else 'FAIL' end as status
  from exp_checks e
),
c_rls as (
  select 50 as ord, 'rls · 활성화' as check_name, 'relrowsecurity = true' as expected,
    coalesce((select 'relrowsecurity=' || c.relrowsecurity::text || ' | relforcerowsecurity=' || c.relforcerowsecurity::text
              from rel join pg_class c on c.oid = rel.t_oid), '(테이블 없음)') as actual,
    case when exists (select 1 from rel join pg_class c on c.oid = rel.t_oid where c.relrowsecurity) then 'PASS' else 'FAIL' end as status
  union all
  select 51, 'rls · 정책 정확히 4개(SELECT/INSERT/UPDATE/DELETE 각 1개, ALL 없음)',
    '4개: DELETE,INSERT,SELECT,UPDATE',
    (select count(*)::text from pol) || '개: ' || coalesce((select string_agg(p.cmd, ',' order by p.cmd) from pol p), '(없음)'),
    case when (select count(*) from pol) = 4
              and coalesce((select string_agg(p.cmd, ',' order by p.cmd) from pol p), '') = 'DELETE,INSERT,SELECT,UPDATE' then 'PASS' else 'FAIL' end
  union all
  select 52, 'rls · SELECT 정책 — authenticated 전용, USING에 stores 소유권(user_id = auth.uid()), WITH CHECK 없음',
    'roles=authenticated | PERMISSIVE | USING(stores.user_id = auth.uid()) | WITH CHECK 없음',
    coalesce((select p.name || ' | roles=' || p.roles || ' | ' || p.permissive || ' | USING(' || coalesce(p.qual, '-') || ') | WITH CHECK(' || coalesce(p.with_check, '-') || ')'
              from pol p where p.cmd = 'SELECT' limit 1), '(정책 없음)'),
    case when exists (select 1 from pol p where p.cmd = 'SELECT' and p.roles = 'authenticated' and p.permissive = 'PERMISSIVE'
                      and p.own_q and p.with_check is null) then 'PASS' else 'FAIL' end
  union all
  select 53, 'rls · INSERT 정책 — authenticated 전용, WITH CHECK에 stores 소유권, USING 없음',
    'roles=authenticated | PERMISSIVE | WITH CHECK(stores.user_id = auth.uid()) | USING 없음',
    coalesce((select p.name || ' | roles=' || p.roles || ' | ' || p.permissive || ' | USING(' || coalesce(p.qual, '-') || ') | WITH CHECK(' || coalesce(p.with_check, '-') || ')'
              from pol p where p.cmd = 'INSERT' limit 1), '(정책 없음)'),
    case when exists (select 1 from pol p where p.cmd = 'INSERT' and p.roles = 'authenticated' and p.permissive = 'PERMISSIVE'
                      and p.own_w and p.qual is null) then 'PASS' else 'FAIL' end
  union all
  select 54, 'rls · UPDATE 정책 — authenticated 전용, USING과 WITH CHECK 모두 stores 소유권',
    'roles=authenticated | PERMISSIVE | USING(...) 와 WITH CHECK(...) 모두 stores.user_id = auth.uid()',
    coalesce((select p.name || ' | roles=' || p.roles || ' | ' || p.permissive || ' | USING(' || coalesce(p.qual, '-') || ') | WITH CHECK(' || coalesce(p.with_check, '-') || ')'
              from pol p where p.cmd = 'UPDATE' limit 1), '(정책 없음)'),
    case when exists (select 1 from pol p where p.cmd = 'UPDATE' and p.roles = 'authenticated' and p.permissive = 'PERMISSIVE'
                      and p.own_q and p.own_w) then 'PASS' else 'FAIL' end
  union all
  select 55, 'rls · DELETE 정책 — authenticated 전용, USING에 stores 소유권, WITH CHECK 없음',
    'roles=authenticated | PERMISSIVE | USING(stores.user_id = auth.uid()) | WITH CHECK 없음',
    coalesce((select p.name || ' | roles=' || p.roles || ' | ' || p.permissive || ' | USING(' || coalesce(p.qual, '-') || ') | WITH CHECK(' || coalesce(p.with_check, '-') || ')'
              from pol p where p.cmd = 'DELETE' limit 1), '(정책 없음)'),
    case when exists (select 1 from pol p where p.cmd = 'DELETE' and p.roles = 'authenticated' and p.permissive = 'PERMISSIVE'
                      and p.own_q and p.with_check is null) then 'PASS' else 'FAIL' end
),
c_grant as (
  select 60 as ord, 'grant · anon 테이블 권한 없음' as check_name, '(없음)' as expected,
    coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g where g.grantee = 'anon'), '(없음)') as actual,
    case when not exists (select 1 from tacl g where g.grantee = 'anon') then 'PASS' else 'FAIL' end as status
  union all
  select 61, 'grant · PUBLIC 테이블 권한 없음', '(없음)',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g where g.grantee = 'PUBLIC'), '(없음)'),
    case when not exists (select 1 from tacl g where g.grantee = 'PUBLIC') then 'PASS' else 'FAIL' end
  union all
  select 62, 'grant · authenticated = DELETE,INSERT,SELECT,UPDATE 정확히', 'DELETE,INSERT,SELECT,UPDATE',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g where g.grantee = 'authenticated'), '(없음)'),
    case when coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g where g.grantee = 'authenticated'), '') = 'DELETE,INSERT,SELECT,UPDATE'
         then 'PASS' else 'FAIL' end
  union all
  select 63, 'grant · authenticated 불필요 권한 없음(TRUNCATE/REFERENCES/TRIGGER/MAINTAIN 등)', '(없음)',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g
              where g.grantee = 'authenticated' and g.priv not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')), '(없음)'),
    case when not exists (select 1 from tacl g
                          where g.grantee = 'authenticated' and g.priv not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) then 'PASS' else 'FAIL' end
  union all
  select 64, 'grant · authenticated GRANT OPTION 없음', '(없음)',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g where g.grantee = 'authenticated' and g.grantable), '(없음)'),
    case when not exists (select 1 from tacl g where g.grantee = 'authenticated' and g.grantable) then 'PASS' else 'FAIL' end
  union all
  select 65, 'grant · 예상 밖 grantee 없음(소유자 · authenticated · service_role 외)', '(없음)',
    coalesce((select string_agg(distinct g.grantee, ', ') from tacl g where g.grantee not in ('authenticated', 'service_role')), '(없음)'),
    case when not exists (select 1 from tacl g where g.grantee not in ('authenticated', 'service_role')) then 'PASS' else 'FAIL' end
  union all
  select 66, 'grant · service_role 권한(참고 — 이 migration은 추가도 회수도 하지 않음)', '(정보)',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from tacl g where g.grantee = 'service_role'), '(없음)'),
    'CHECK'
  union all
  select 67, 'grant · 컬럼 단위 권한 없음(테이블 단위 CRUD만 부여)', '(없음)',
    coalesce((select string_agg(a.attname::text, ', ' order by a.attnum)
              from rel join pg_attribute a on a.attrelid = rel.t_oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null), '(없음)'),
    case when not exists (select 1 from rel join pg_attribute a on a.attrelid = rel.t_oid and a.attnum > 0
                          and not a.attisdropped and a.attacl is not null) then 'PASS' else 'FAIL' end
),
c_seq as (
  select 70 as ord, 'sequence · ad_margin_links.id 의 identity 시퀀스 존재' as check_name, '시퀀스 1개' as expected,
    coalesce((select string_agg(s.q_name, ', ') from seq s), '(없음)') as actual,
    case when (select count(*) from seq) = 1 then 'PASS' else 'FAIL' end as status
  union all
  select 71, 'sequence · anon / PUBLIC 권한 없음', '(없음)',
    coalesce((select string_agg(g.grantee || ':' || g.priv, ', ' order by g.grantee, g.priv) from sacl g where g.grantee in ('anon', 'PUBLIC')), '(없음)'),
    case when (select count(*) from seq) = 1
              and not exists (select 1 from sacl g where g.grantee in ('anon', 'PUBLIC')) then 'PASS' else 'FAIL' end
  union all
  select 72, 'sequence · authenticated = USAGE 정확히(SELECT · UPDATE 없음)', 'USAGE',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from sacl g where g.grantee = 'authenticated'), '(없음)'),
    case when (select count(*) from seq) = 1
              and coalesce((select string_agg(g.priv, ',' order by g.priv) from sacl g where g.grantee = 'authenticated'), '') = 'USAGE'
         then 'PASS' else 'FAIL' end
  union all
  select 73, 'sequence · GRANT OPTION 없음(anon · PUBLIC · authenticated)', '(없음)',
    coalesce((select string_agg(g.grantee || ':' || g.priv, ', ' order by g.grantee, g.priv) from sacl g
              where g.grantable and g.grantee in ('anon', 'PUBLIC', 'authenticated')), '(없음)'),
    case when (select count(*) from seq) = 1
              and not exists (select 1 from sacl g where g.grantable and g.grantee in ('anon', 'PUBLIC', 'authenticated'))
         then 'PASS' else 'FAIL' end
  union all
  select 74, 'sequence · 예상 밖 grantee 없음(소유자 · authenticated · service_role 외)', '(없음)',
    coalesce((select string_agg(distinct g.grantee, ', ') from sacl g where g.grantee not in ('authenticated', 'service_role')), '(없음)'),
    case when (select count(*) from seq) = 1
              and not exists (select 1 from sacl g where g.grantee not in ('authenticated', 'service_role')) then 'PASS' else 'FAIL' end
  union all
  select 75, 'sequence · service_role 권한(참고 — 이 migration은 추가도 회수도 하지 않음)', '(정보)',
    coalesce((select string_agg(g.priv, ',' order by g.priv) from sacl g where g.grantee = 'service_role'), '(없음)'),
    'CHECK'
),
c_trg as (
  select 80 as ord, 'trigger · BEFORE INSERT OR UPDATE FOR EACH ROW 트리거 하나(ad_margin_links_before_write)' as check_name,
    '트리거 1개 | BEFORE | INSERT + UPDATE (DELETE · TRUNCATE 없음) | FOR EACH ROW' as expected,
    (select count(*)::text from trg) || '개: '
      || coalesce((select string_agg(t.name || ' (tgtype=' || t.tgtype::text || ')', ', ') from trg t), '(없음)') as actual,
    case when (select count(*) from trg) = 1
              and exists (select 1 from trg t
                          where t.name = 'ad_margin_links_before_write'
                            and (t.tgtype & 1) = 1      -- FOR EACH ROW
                            and (t.tgtype & 2) = 2      -- BEFORE
                            and (t.tgtype & 4) = 4      -- INSERT
                            and (t.tgtype & 16) = 16    -- UPDATE
                            and (t.tgtype & (8 + 32 + 64)) = 0) then 'PASS' else 'FAIL' end as status
  union all
  select 81, 'trigger function · 이 테이블 전용 public.ad_margin_links_before_write (기존 함수 재사용 안 함)',
    'public.ad_margin_links_before_write',
    coalesce((select string_agg(t.fn_schema || '.' || t.fn, ', ') from trg t), '(없음)'),
    case when exists (select 1 from trg t where t.fn_schema = 'public' and t.fn = 'ad_margin_links_before_write') then 'PASS' else 'FAIL' end
  union all
  select 82, 'trigger function · SECURITY INVOKER', 'prosecdef = false',
    coalesce((select string_agg('prosecdef=' || t.secdef::text, ', ') from trg t), '(없음)'),
    case when exists (select 1 from trg t where t.fn = 'ad_margin_links_before_write' and not t.secdef) then 'PASS' else 'FAIL' end
  union all
  select 83, 'trigger function · search_path 고정(proconfig = pg_catalog 우선)', 'search_path=pg_catalog, pg_temp',
    coalesce((select array_to_string(t.cfg, ' ; ') from trg t where t.cfg is not null limit 1), '(proconfig 없음)'),
    case when exists (select 1 from trg t, unnest(coalesce(t.cfg, array[]::text[])) c
                      where t.fn = 'ad_margin_links_before_write' and c like 'search_path=pg_catalog%') then 'PASS' else 'FAIL' end
  union all
  select 84, 'trigger function · 식별 컬럼 4개(id · store_id · meta_adset_id · created_at)가 UPDATE에서 바뀌면 예외(정확히 4개)',
    'id, created_at, meta_adset_id, store_id',
    coalesce((select string_agg(k.col, ', ' order by k.col)
              from trg t, unnest(array['id', 'store_id', 'meta_adset_id', 'created_at']) k(col)
              where t.fn = 'ad_margin_links_before_write'
                and t.src ~ ('new\.' || k.col || '\s+is\s+distinct\s+from\s+old\.' || k.col)), '(없음)'),
    case when exists (select 1 from trg t
                      where t.fn = 'ad_margin_links_before_write'
                        and t.src ~ 'new\.id\s+is\s+distinct\s+from\s+old\.id'
                        and t.src ~ 'new\.store_id\s+is\s+distinct\s+from\s+old\.store_id'
                        and t.src ~ 'new\.meta_adset_id\s+is\s+distinct\s+from\s+old\.meta_adset_id'
                        and t.src ~ 'new\.created_at\s+is\s+distinct\s+from\s+old\.created_at'
                        and t.src ~ '(raise\s+exception.*){4}'
                        and t.src !~ '(raise\s+exception.*){5}') then 'PASS' else 'FAIL' end
  union all
  select 85, 'trigger function · 다시 연결할 때 바꿀 수 있는 컬럼(product_label · calc_version · currency · total_income · pre_ad · source_saved_at)은 막지 않는다',
    '(막는 비교 없음)',
    coalesce((select case when t.src ~ 'is\s+distinct\s+from\s+old\.(calc_version|currency|total_income|pre_ad|source_saved_at|product_label|confirmed_at|updated_at)'
                          then '막는 비교가 있음' else '(막는 비교 없음)' end
              from trg t where t.fn = 'ad_margin_links_before_write' limit 1), '(함수 없음)'),
    case when exists (select 1 from trg t
                      where t.fn = 'ad_margin_links_before_write'
                        and t.src !~ 'is\s+distinct\s+from\s+old\.(calc_version|currency|total_income|pre_ad|source_saved_at|product_label|confirmed_at|updated_at)') then 'PASS' else 'FAIL' end
  union all
  select 86, 'trigger function · INSERT · UPDATE 모두에서 product_label := btrim(product_label)', 'new.product_label := btrim(new.product_label) — 분기 밖(공통 경로)',
    coalesce((select case when t.src ~ 'end\s+if;\s+new\.product_label\s*:=\s*btrim\(new\.product_label\)' then '공통 경로에 있음' else '없음' end
              from trg t where t.fn = 'ad_margin_links_before_write' limit 1), '(함수 없음)'),
    case when exists (select 1 from trg t
                      where t.fn = 'ad_margin_links_before_write'
                        and t.src ~ 'end\s+if;\s+new\.product_label\s*:=\s*btrim\(new\.product_label\)') then 'PASS' else 'FAIL' end
  union all
  select 87, 'trigger function · 서버 시각 설정 — INSERT: created_at · confirmed_at · updated_at / UPDATE: confirmed_at · updated_at',
    'created_at := now() (INSERT 분기), confirmed_at := now() · updated_at := now() (공통 경로)',
    coalesce((select case when t.src ~ 'tg_op\s*=\s*.INSERT.\s+then\s+new\.created_at\s*:=\s*now\(\)' then 'created_at(INSERT) 있음' else 'created_at(INSERT) 없음' end
                     || ' | ' ||
                     case when t.src ~ 'new\.confirmed_at\s*:=\s*now\(\)\s*;\s*new\.updated_at\s*:=\s*now\(\)\s*;\s*return\s+new' then 'confirmed_at · updated_at(공통) 있음' else 'confirmed_at · updated_at(공통) 없음' end
              from trg t where t.fn = 'ad_margin_links_before_write' limit 1), '(함수 없음)'),
    case when exists (select 1 from trg t
                      where t.fn = 'ad_margin_links_before_write'
                        and t.src ~ 'tg_op\s*=\s*.INSERT.\s+then\s+new\.created_at\s*:=\s*now\(\)'
                        and t.src ~ 'end\s+if;\s+new\.product_label\s*:=\s*btrim\(new\.product_label\)\s*;\s*new\.confirmed_at\s*:=\s*now\(\)\s*;\s*new\.updated_at\s*:=\s*now\(\)\s*;\s*return\s+new') then 'PASS' else 'FAIL' end
  union all
  select 88, 'trigger function · EXECUTE 권한(참고 — 트리거 함수는 직접 호출할 수 없고, 이 migration은 함수 권한을 바꾸지 않음)', '(정보)',
    coalesce((select case when t.acl is null then '기본 권한(PUBLIC 실행 가능)'
                          else (select string_agg(coalesce(r.rolname::text, 'PUBLIC') || ':' || x.privilege_type::text, ', ')
                                from aclexplode(t.acl) x left join pg_roles r on r.oid = x.grantee) end
              from trg t limit 1), '(없음)'),
    'CHECK'
),
c_info as (
  select 90 as ord, 'info · server_version_num' as check_name, '(정보)' as expected,
    current_setting('server_version_num') as actual, 'CHECK' as status
  union all
  select 91, 'selftest · NaN 은 유한성 검사식(x - x = 0)을 통과하지 못한다', 'false',
    ((('NaN'::numeric - 'NaN'::numeric) = 0))::text,
    case when ((('NaN'::numeric - 'NaN'::numeric) = 0)) = false then 'PASS' else 'FAIL' end
  union all
  select 92, 'selftest · 0원 · 음수(적자) 값은 유한성 검사식을 통과한다', 'true',
    (((0::numeric - 0::numeric) = 0) and (((-5)::numeric - (-5)::numeric) = 0))::text,
    case when ((0::numeric - 0::numeric) = 0) and (((-5)::numeric - (-5)::numeric) = 0) then 'PASS' else 'FAIL' end
),
all_checks as (
  select * from c_prereq
  union all select * from c_table
  union all select * from c_cols
  union all select * from c_extra
  union all select * from c_cons
  union all select * from c_named
  union all select * from c_rls
  union all select * from c_grant
  union all select * from c_seq
  union all select * from c_trg
  union all select * from c_info
)

select u.check_name, u.expected, u.actual, u.status
from (
  select ord, check_name, expected, actual, status from all_checks
  union all
  select 0, 'SUMMARY', '모든 항목 PASS(CHECK는 참고 정보)',
    (count(*) filter (where status = 'FAIL'))::text || '건 FAIL · '
      || (count(*) filter (where status = 'CHECK'))::text || '건 CHECK · '
      || (count(*) filter (where status = 'PASS'))::text || '건 PASS',
    case when count(*) filter (where status = 'FAIL') = 0 then 'PASS' else 'FAIL' end
  from all_checks
) u
order by u.ord, u.check_name;
