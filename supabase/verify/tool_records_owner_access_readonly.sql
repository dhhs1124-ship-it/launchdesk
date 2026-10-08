-- ============================================================================
-- tool_records — 소유자 접근 제한 · 매장 구분 확인(읽기 전용)
-- 파일: supabase/verify/tool_records_owner_access_readonly.sql
-- ============================================================================
-- 무엇: AI 점검 기준(business_profile)과 실행 기록(ad_log change · change_result)이 저장되는 tool_records가
--   ① 본인 행만 읽고 쓰게 막혀 있는지(RLS · 정책 · 테이블 권한) ② 회원 탈퇴 시 함께 지워지는지(FK)
--   ③ 기록마다 쇼핑몰(store_id)이 있고 본인 쇼핑몰을 가리키는지(개수만)를 본다.
--   ai_weekly_reviews의 FK(쇼핑몰 · 회원 삭제 시 함께 삭제)도 함께 본다 — 개인정보처리방침 문구 근거.
-- 안전: SELECT만 한다. 개인정보 값은 출력하지 않는다(정책 정의 · 개수만).
-- 실행: Supabase SQL Editor에서 [블록]마다 따로 실행하거나 npx supabase db query --linked -f(블록별 파일).


-- [블록 1] RLS — 기대: rls_enabled = true
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
  from pg_class
 where oid = 'public.tool_records'::regclass;


-- [블록 2] 행 단위 정책 — 기대: authenticated의 정책이 모두 본인 행(auth.uid() = user_id)으로 제한.
--   2026-10-08 운영: select · insert · delete · update 4개 모두 본인 행. update 정책은 있지만 [블록 3]에서
--   authenticated에 UPDATE 권한이 없어 실제 수정은 막힌다(저장은 새 기록 + 예전 기록 삭제).
select policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'tool_records'
 order by cmd, policyname;


-- [블록 3] 테이블 권한(역할별) — 기대: anon 없음 · authenticated는 DELETE · INSERT · SELECT만(UPDATE 없음)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'tool_records'
 group by grantee
 order by grantee;


-- [블록 4] tool_records 제약 — 기대: user_id → auth.users(id) on delete cascade(회원 탈퇴 시 함께 삭제)
select conname, contype, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.tool_records'::regclass
 order by conname;


-- [블록 5] ai_weekly_reviews 외래 키 — 기대: store_id → stores, user_id → auth.users 모두 on delete cascade
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.ai_weekly_reviews'::regclass and contype = 'f'
 order by conname;


-- [블록 6] 매장 구분(개수만) — 기록마다 store_id가 있고 본인 쇼핑몰을 가리키는지
--   no_store_id: store_id 없는 기록(ad_log의 예전 직접 입력 기록은 store_id가 없을 수 있음 — 판단은 source별로)
--   not_owned_or_deleted: store_id가 있지만 본인 쇼핑몰이 아니거나 이미 삭제된 쇼핑몰
select t.tool_type,
       coalesce(t.data ->> 'source', '(없음)') as source,
       count(*) as rows,
       count(*) filter (where t.data ->> 'store_id' is null) as no_store_id,
       count(*) filter (where t.data ->> 'store_id' is not null and not exists (
         select 1 from public.stores s where s.id::text = t.data ->> 'store_id' and s.user_id = t.user_id)) as not_owned_or_deleted
  from public.tool_records t
 where t.tool_type in ('business_profile', 'ad_log')
 group by 1, 2
 order by 1, 2;
