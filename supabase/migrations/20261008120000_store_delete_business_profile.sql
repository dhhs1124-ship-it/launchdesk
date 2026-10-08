-- 쇼핑몰 삭제 시 그 쇼핑몰의 AI 점검 기준(사업 정보)을 같은 트랜잭션에서 함께 삭제
--
-- LaunchROAS 주간 AI 점검의 점검 기준(launchroas/insights.js 사업 정보 칸)은 tool_records
-- (tool_type='business_profile')의 data 안에 store_id(문자열)와 광고 목표 · 목표 ROAS · 월 광고 예산
-- 상한 · 바꿀 수 없는 것만 갖는다(개인정보 없음). 쇼핑몰별 설정이라 쇼핑몰이 없어지면 쓸 곳이 없다.
-- tool_records에는 stores로의 FK가 없어(store_id가 JSON 안에 있음) 쇼핑몰을 지워도 남았다.
--
-- 방식: 20260924170000_store_delete_meta_auto_adlog.sql과 같다 — public.stores 행 삭제 트리거
-- (AFTER DELETE, FOR EACH ROW). 쇼핑몰 삭제 문장과 같은 트랜잭션이라, 기록 삭제가 실패하면 쇼핑몰
-- 삭제도 함께 되돌아간다. 클라이언트는 기존 그대로 stores 행 삭제 한 번만 요청한다(새 권한 없음).
--
-- 지우는 범위(그 외는 지우지 않는다):
--   - 같은 소유자(user_id = 삭제된 쇼핑몰의 user_id)
--   - tool_type = 'business_profile'
--   - data->>'store_id' = 삭제된 쇼핑몰 id
--   → 광고 기록(직접 입력 · 실행 기록 source change/change_result) · 다른 쇼핑몰 · 다른 사용자의 기록은
--     조건에 맞지 않는다. Meta 자동 기록은 기존 트리거가 따로 지운다.
--
-- 적용되지 않는 경우: Cafe24 · Meta 연결 해제는 stores 행을 지우지 않으므로 점검 기준은 남는다
-- (사용자가 LaunchROAS 주간 AI 점검 칸의 '점검 기준 지우기'로 직접 지울 수 있다).
--
-- 보안: SECURITY DEFINER + search_path=''로, 호출자의 tool_records RLS와 무관하게 위 조건만 지운다.
-- 트리거 함수는 사용자가 직접 호출할 수 없다.
--
-- 구조: tool_records.data 타입(json/jsonb) 기록이 없어 ->> 만 쓴다(기존 트리거와 같은 이유).
--
-- 적용 순서: 이 마이그레이션은 웹 배포와 순서 관계가 없다(화면은 쇼핑몰 삭제 요청을 그대로 보낸다).
-- 원격 적용은 승인 후(2026-10-08 작성 시점 미적용).

create or replace function public.delete_business_profile_for_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tool_records
  where user_id = old.user_id
    and tool_type = 'business_profile'
    and (data ->> 'store_id') = old.id::text;
  return old;
end;
$$;

revoke all on function public.delete_business_profile_for_store() from public;
revoke all on function public.delete_business_profile_for_store() from anon;
revoke all on function public.delete_business_profile_for_store() from authenticated;

drop trigger if exists stores_delete_business_profile on public.stores;
create trigger stores_delete_business_profile
  after delete on public.stores
  for each row
  execute function public.delete_business_profile_for_store();
