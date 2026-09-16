-- LaunchDesk 계획(plans) 기능 — 내부 행동 이벤트 allowlist 확장.
--
-- 20260916100000_plans.sql(테이블·RLS)과 의도적으로 분리했다. 계획 테이블은
-- product_events가 없어도 동작해야 하고, 이 파일은 반대로 product_events가
-- 실제로 존재할 때만 의미가 있기 때문이다.
--
-- 선행 조건: 20260915280000_product_events.sql이 원격 DB에 적용돼 있어야
-- 한다. 그 파일의 주석("아직 원격 DB에 적용되지 않았다")만으로 적용 여부를
-- 판단하지 않고, 아래 DO 블록이 테이블/함수 존재를 런타임에 직접 확인한 뒤
-- 없으면 즉시 실패시킨다 — 이 파일을 먼저 실행해 "함수는 갱신됐는데 테이블은
-- 없는" 어중간한 상태가 생기지 않게 하기 위함이다. 미적용된 다른 기존
-- 마이그레이션을 이 파일이 대신 실행하지는 않는다.
--
-- 추가 이벤트 2개(전부 "사실"만, 자유 입력·계산 스냅샷·금액은 없음):
--   plan_created  — 계획 insert가 실제로 새 행을 만든 뒤 1회. 중복 요청
--                   확인(unique 충돌 후 기존 행 조회)은 신규 생성이 아니므로
--                   기록하지 않는다(클라이언트 plans.js 참고).
--   plan_reviewed — 검토 메모 저장 또는 완료 처리가 DB에 성공한 뒤 1회.
--                   단순 조회/상세 펼치기/실행 체크/미루기는 기록하지 않는다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 적용한다.
--
-- 적용 방식 주의: 20260916100000_plans.sql과 같은 트랜잭션(SQL 편집기에
-- 두 파일을 이어 붙여 한 번에 실행)으로 돌리지 않는다. 아래 DO 블록이
-- 실패하면 같은 트랜잭션 안의 계획 테이블·정책까지 함께 롤백된다. 계획
-- 파일을 먼저 단독 적용하고, 이 파일은 그 뒤 별도로 실행한다. 적용 후
-- 검증은 supabase/verify/plan_product_events_verify.sql 참고.

do $$
begin
  if to_regclass('public.product_events') is null then
    raise exception 'PRODUCT_EVENTS_NOT_APPLIED: 20260915280000_product_events.sql을 먼저 적용하세요';
  end if;
  if to_regprocedure('public.track_product_event(text, uuid, text)') is null then
    raise exception 'TRACK_PRODUCT_EVENT_NOT_APPLIED: 20260915280000_product_events.sql을 먼저 적용하세요';
  end if;
end
$$;

-- 1) CHECK 제약 — 이름이 명시돼 있어(product_events_event_name_allowlist)
--    한 문장씩 교체할 수 있다(원 마이그레이션 주석 3번이 의도한 확장 방식).
alter table public.product_events
  drop constraint if exists product_events_event_name_allowlist;
alter table public.product_events
  add constraint product_events_event_name_allowlist check (event_name in (
    'dashboard_viewed',
    'roadmap_started',
    'plan_created',
    'plan_reviewed'
  ));

-- 2) track_product_event() — 본문의 allowlist만 넓힌다. 그 외(SECURITY
--    DEFINER, search_path, AUTH_REQUIRED, route 200자 절단, 권한)는 원본과
--    동일하게 다시 선언한다(CREATE OR REPLACE는 본문 전체를 교체하므로 일부만
--    쓰면 나머지가 사라진다).
create or replace function public.track_product_event(
  p_event_name text,
  p_session_id uuid default null,
  p_route text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_event_name is null or p_event_name not in (
    'dashboard_viewed', 'roadmap_started', 'plan_created', 'plan_reviewed'
  ) then
    raise exception 'INVALID_EVENT_NAME';
  end if;

  insert into public.product_events (user_id, event_name, session_id, route)
  values (v_user_id, p_event_name, p_session_id, left(p_route, 200));
end;
$$;

revoke all on function public.track_product_event(text, uuid, text) from public;
revoke execute on function public.track_product_event(text, uuid, text) from anon;
grant execute on function public.track_product_event(text, uuid, text) to authenticated;
