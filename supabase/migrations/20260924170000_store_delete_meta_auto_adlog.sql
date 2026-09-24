-- 쇼핑몰 삭제 시 그 쇼핑몰의 Meta 자동 광고 기록을 같은 트랜잭션에서 함께 삭제
--
-- 운영 현황 "광고 기록"의 Meta 자동 기록(adlog-meta.js)은 tool_records
-- (tool_type='ad_log')의 data 안에 source='meta_auto', store_id(문자열)를 갖는다.
-- tool_records에는 stores로의 FK가 없어(store_id가 JSON 안에 있음) 쇼핑몰을
-- 지워도 기록이 남았다. 예전에는 stores.js가 쇼핑몰 삭제 뒤 별도 요청으로 기록을
-- 지웠는데, 두 요청 사이에 실패하면 한쪽만 반영될 수 있었다.
--
-- 방식: public.stores 행 삭제 트리거(AFTER DELETE, FOR EACH ROW). 트리거는 쇼핑몰
-- 삭제 문장과 같은 트랜잭션에서 실행되므로, 기록 삭제가 실패하면 쇼핑몰 삭제도
-- 함께 되돌아간다(둘 다 남는다). 클라이언트는 기존 그대로 stores 행 삭제 한 번만
-- 요청한다 — 새 RPC 권한을 열지 않는다.
--
-- 지우는 범위(그 외는 절대 지우지 않는다):
--   - 같은 소유자(user_id = 삭제된 쇼핑몰의 user_id)
--   - tool_type = 'ad_log' 이고 data->>'source' = 'meta_auto'
--   - data->>'store_id' = 삭제된 쇼핑몰 id
--   → 직접 입력한 광고 기록(source 없음) · 다른 쇼핑몰의 기록 · 다른 사용자의 기록은
--     조건에 맞지 않는다.
--
-- 적용되지 않는 경우: Cafe24 연결 해제(disconnect_cafe24_integration)와 Meta 연결
-- 해제(meta-disconnect)는 stores 행을 지우지 않으므로 이 트리거가 실행되지 않는다
-- — 두 경우 모두 광고 기록은 남는다(개인정보처리방침 v1.3 4번).
--
-- 보안: 트리거 함수는 SECURITY DEFINER + search_path=''로, 호출자의 tool_records
-- RLS와 무관하게 위 조건(삭제된 쇼핑몰 소유자의 행)만 지운다. 트리거 함수는
-- 사용자가 직접 호출할 수 없고, 누가 어떤 경로로 쇼핑몰을 지워도(자기 쇼핑몰은
-- stores RLS가 이미 확인) 그 쇼핑몰 소유자의 자동 기록만 대상이다.
--
-- 구조: tool_records.data 타입(json/jsonb) 기록이 없어 ->> 만 쓴다(json · jsonb 모두
-- 동작, 20260924150000_ad_log_meta_auto_unique.sql과 같은 이유). stores.id는 bigint
-- (20260921230000_ad_margin_links.sql의 FK 기준) — 문자열로 비교한다(화면은
-- String(storeId)로 저장).
--
-- 적용 순서: 이 마이그레이션 → 웹 배포(웹은 쇼핑몰 삭제 성공 = 자동 기록도 삭제로 안내).

create or replace function public.delete_meta_auto_adlog_for_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tool_records
  where user_id = old.user_id
    and tool_type = 'ad_log'
    and (data ->> 'source') = 'meta_auto'
    and (data ->> 'store_id') = old.id::text;
  return old;
end;
$$;

revoke all on function public.delete_meta_auto_adlog_for_store() from public;
revoke all on function public.delete_meta_auto_adlog_for_store() from anon;
revoke all on function public.delete_meta_auto_adlog_for_store() from authenticated;

drop trigger if exists stores_delete_meta_auto_adlog on public.stores;
create trigger stores_delete_meta_auto_adlog
  after delete on public.stores
  for each row
  execute function public.delete_meta_auto_adlog_for_store();
