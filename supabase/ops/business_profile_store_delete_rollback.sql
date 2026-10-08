-- ============================================================================
-- 되돌리기 — 쇼핑몰 삭제 → AI 점검 기준 삭제 트리거 제거(필요할 때만)
-- 파일: supabase/ops/business_profile_store_delete_rollback.sql
-- ============================================================================
-- 적용: supabase/migrations/20261008120000_store_delete_business_profile.sql
-- 이 파일은 트리거와 트리거 함수만 지운다. 기록(tool_records)은 건드리지 않는다.
-- 기존 Meta 자동 기록 삭제 트리거(stores_delete_meta_auto_adlog)는 그대로 둔다.

begin;
drop trigger if exists stores_delete_business_profile on public.stores;
drop function if exists public.delete_business_profile_for_store();
commit;
