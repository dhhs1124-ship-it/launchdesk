-- ============================================================================
-- 쇼핑몰 삭제 → AI 점검 기준(tool_records business_profile) 삭제 트리거 — 적용 "전" 읽기 전용 확인
-- 파일: supabase/verify/business_profile_store_delete_precheck_readonly.sql
-- ============================================================================
-- 무엇: 적용 SQL(supabase/migrations/20261008120000_store_delete_business_profile.sql)을 실행하기 전에
--   stores 트리거 · 함수 현황, tool_records 구조(data json/jsonb), 점검 기준 기록 개수, 마이그레이션 기록을 본다.
-- 안전: SELECT만 한다. 개인정보 값은 출력하지 않는다(이름 · 개수 · 정의만).
-- 실행: Supabase SQL Editor에서 [블록]마다 따로 실행하거나 npx supabase db query --linked -f(블록별 파일).
--
-- 전체 순서
--   1) 이 파일 — [블록 4]의 business_profile_rows · orphan_rows를 적어 둔다
--   2) supabase/verify/tool_records_owner_access_readonly.sql — 소유자 접근 제한 · 매장 구분
--   3) 적용: supabase/migrations/20261008120000_store_delete_business_profile.sql 전체를 SQL Editor에서 한 번 실행
--      (db push · migration repair는 쓰지 않는다 — 적용 기록은 schema_migrations에 남지 않는다. 같은 파일을 다시
--       실행해도 create or replace · drop trigger if exists라 결과가 같다)
--   4) supabase/verify/business_profile_store_delete_post_apply_readonly.sql
--   되돌리기: supabase/ops/business_profile_store_delete_rollback.sql


-- [블록 1] 실행 환경 — 행을 빠짐없이 보는지(RLS)
--   기대: rls_forced = false 이고 (bypass_rls = true 또는 role = table_owner). 아니면 개수가 0으로 보일 수 있어 멈춘다.
select version() as postgres_version,
       current_user as role,
       (select rolbypassrls from pg_roles where rolname = current_user) as bypass_rls,
       (select pg_get_userbyid(relowner) from pg_class where oid = 'public.tool_records'::regclass) as table_owner,
       (select relforcerowsecurity from pg_class where oid = 'public.tool_records'::regclass) as rls_forced;


-- [블록 2] stores 삭제 트리거 · 트리거 함수 현황
--   기대(적용 전): stores_delete_meta_auto_adlog 1개 · delete_meta_auto_adlog_for_store(security definer)만 있고,
--   stores_delete_business_profile · delete_business_profile_for_store는 없다.
select 'trigger' as kind, tgname as name, case tgenabled when 'O' then 'enabled' when 'D' then 'disabled' else tgenabled::text end as state
  from pg_trigger
 where tgrelid = 'public.stores'::regclass and not tgisinternal
union all
select 'function', p.proname, case when p.prosecdef then 'security definer' else 'security invoker' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('delete_meta_auto_adlog_for_store', 'delete_business_profile_for_store')
 order by 1, 2;


-- [블록 3] tool_records 구조 — 적용 SQL은 data ->> 'store_id'만 쓴다(json · jsonb 모두 동작)
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'tool_records'
 order by ordinal_position;


-- [블록 4] 점검 기준 기록 현황(개수만) — AI가 꺼져 있어 입력 칸이 보이지 않으므로 0이 기대값
--   orphan_rows: 이미 지워졌거나 본인 것이 아닌 쇼핑몰을 가리키는 기록(트리거 적용 전 남은 것 — 0이 아니면 따로 판단)
select count(*) as business_profile_rows,
       count(distinct t.user_id) as owners,
       count(*) filter (where not exists (
         select 1 from public.stores s where s.id::text = t.data ->> 'store_id' and s.user_id = t.user_id)) as orphan_rows
  from public.tool_records t
 where t.tool_type = 'business_profile';


-- [블록 5] 마이그레이션 기록 표가 있는지 — 2026-10-08 운영 확인: 없음(false).
--   이 프로젝트의 SQL은 모두 SQL Editor로 적용됐고 CLI 적용 기록이 없다. 그래서 db push는 저장소의 모든 마이그레이션을
--   '미적용'으로 보고 다시 실행하려 하므로 쓰지 않는다(migration repair도 쓰지 않음).
select to_regclass('supabase_migrations.schema_migrations') is not null as migration_history_table_exists;
