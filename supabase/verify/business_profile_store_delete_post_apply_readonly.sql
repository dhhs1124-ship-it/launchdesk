-- ============================================================================
-- 쇼핑몰 삭제 → AI 점검 기준 삭제 트리거 — 적용 "후" 읽기 전용 확인
-- 파일: supabase/verify/business_profile_store_delete_post_apply_readonly.sql
-- ============================================================================
-- 안전: SELECT만 한다. 개인정보 값은 출력하지 않는다(정의 · 권한 · 개수만).
-- 실제 삭제 동작(그 쇼핑몰 · 소유자의 business_profile만 지우고 실행 기록 · 다른 쇼핑몰 · 다른 사용자는 남김)은
--   운영 데이터로 시험하지 않는다 — 같은 SQL을 로컬 PGlite(json · jsonb)로 확인했다(검토 ZIP verification).


-- [블록 1] 트리거 — 기대: 두 트리거 모두 AFTER DELETE ON public.stores FOR EACH ROW, 켜짐
select tgname,
       case tgenabled when 'O' then 'enabled' when 'D' then 'disabled' else tgenabled::text end as state,
       pg_get_triggerdef(oid) as definition
  from pg_trigger
 where tgrelid = 'public.stores'::regclass
   and tgname in ('stores_delete_meta_auto_adlog', 'stores_delete_business_profile')
 order by tgname;


-- [블록 2] 트리거 함수 — 기대: security definer · search_path="" · 본문의 삭제 조건이
--   user_id = old.user_id and tool_type = 'business_profile' and (data ->> 'store_id') = old.id::text
select p.proname,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'delete_business_profile_for_store';


-- [블록 3] 실행 권한 — 기대: postgres EXECUTE 1행만(public · anon · authenticated 없음 — 사용자가 직접 호출할 수 없음).
--   기존 delete_meta_auto_adlog_for_store도 운영에서 postgres 1행이다(2026-10-08 읽기 전용 확인).
select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public' and routine_name = 'delete_business_profile_for_store'
 order by grantee;


-- [블록 4] 점검 기준 기록 현황(개수만) — 적용 전 [블록 4]와 같아야 한다(적용 자체는 기록을 지우지 않는다)
select count(*) as business_profile_rows,
       count(*) filter (where not exists (
         select 1 from public.stores s where s.id::text = t.data ->> 'store_id' and s.user_id = t.user_id)) as orphan_rows
  from public.tool_records t
 where t.tool_type = 'business_profile';
