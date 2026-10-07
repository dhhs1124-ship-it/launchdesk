-- LaunchROAS AI 비용 예약 — 운영자 검증(verify · verify_video)이 호출 전에 최악 비용을 원자적으로 예약한다.
-- [준비 · 미적용] 원격 적용은 승인 후. 적용 순서: 이 마이그레이션 → ai-weekly-review 재배포(새 코드는 ai_month_spent()가 없으면 예산 검사 실패로 멈춘다).
--
-- 규칙
-- - 예약(reserved): 호출 전 최악 비용. 월 합계에 예약 금액으로 들어간다.
-- - 정산(settled): 모든 호출의 사용량을 확인했을 때만 — 실제 비용으로 바뀐다.
-- - 미확인(unsettled): 시간 초과 · 응답 실패 등으로 사용량을 확인하지 못함 — 예약 금액을 그대로 월 합계에 남긴다(0으로 풀지 않음).
-- - 함수가 강제 종료돼 정산하지 못한 예약은 reserved로 남아 예약 금액으로 계속 집계된다. 운영자가 Anthropic 콘솔 사용량을 확인한 뒤
--   select public.ai_budget_settle(<id>, <실제 비용>, true, '수동 정산');  으로 정리한다.
-- - 동시 요청: ai_budget_reserve가 트랜잭션 advisory lock 안에서 합계 계산 → 한도 검사 → 예약 삽입을 한 번에 한다.
-- - 월 합계 = 주간 점검 비용 + 예약 이전(reservation_id 없음) 운영자 검증 비용 + 예약(정산 실제 비용 또는 예약 금액).
--   예약에 연결된 검증 기록의 cost_usd는 중복 집계하지 않는다(검증 기록 저장이 실패해도 비용은 예약에 남는다).

create table if not exists public.ai_budget_reservations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id bigint references public.stores(id) on delete set null,
  kind text not null check (kind in ('verify', 'verify_video')),
  model text not null,
  reserved_usd numeric(10, 4) not null check (reserved_usd > 0),
  actual_usd numeric(10, 4) check (actual_usd is null or actual_usd >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'unsettled')),
  ref text, -- 같은 대상 재시도 상한용(영상: 프레임 묶음 해시)
  note text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists ai_budget_reservations_created_at_idx on public.ai_budget_reservations (created_at);
create index if not exists ai_budget_reservations_ref_idx on public.ai_budget_reservations (kind, ref, created_at);

alter table public.ai_weekly_verifications add column if not exists reservation_id bigint references public.ai_budget_reservations(id) on delete set null;

alter table public.ai_budget_reservations enable row level security;
revoke all on public.ai_budget_reservations from anon, authenticated;
grant select on public.ai_budget_reservations to service_role;

-- 이번 달(한국 시간 1일 00시부터) AI 비용
create or replace function public.ai_month_spent()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with m as (select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as start)
  select coalesce((select sum(cost_usd) from public.ai_weekly_reviews, m where updated_at >= m.start), 0)
       + coalesce((select sum(cost_usd) from public.ai_weekly_verifications, m where created_at >= m.start and reservation_id is null), 0)
       + coalesce((select sum(case when status = 'settled' then actual_usd else reserved_usd end) from public.ai_budget_reservations, m where created_at >= m.start), 0);
$$;

-- 예약: 한도 안이면 예약 행을 만들고 id를 돌려준다. 한도를 넘으면 ok=false, reason='budget'(예약 없음)
-- p_ref · p_max_ref_per_day(선택): 같은 대상(ref)의 최근 24시간 예약이 상한 이상이면 ok=false, reason='attempts' — 같은 잠금 안에서 센다
create or replace function public.ai_budget_reserve(p_user uuid, p_store bigint, p_kind text, p_model text, p_amount numeric, p_limit numeric, p_ref text default null, p_max_ref_per_day integer default null)
returns table (ok boolean, reservation_id bigint, spent_usd numeric, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
  v_id bigint;
  v_amount numeric;
begin
  if p_amount is null or p_amount <= 0 or p_limit is null or p_limit <= 0 then
    raise exception 'ai_budget_reserve: amount and limit must be positive';
  end if;
  v_amount := ceil(p_amount * 10000) / 10000; -- 올림: 예약 · 한도 검사가 최악 비용보다 작아지지 않게
  perform pg_advisory_xact_lock(hashtext('launchroas_ai_budget'));
  v_spent := public.ai_month_spent();
  if p_ref is not null and p_max_ref_per_day is not null and (
    select count(*) from public.ai_budget_reservations where kind = p_kind and ref = p_ref and created_at > now() - interval '24 hours') >= p_max_ref_per_day then
    return query select false, null::bigint, v_spent, 'attempts'::text;
    return;
  end if;
  if v_spent + v_amount > p_limit then
    return query select false, null::bigint, v_spent, 'budget'::text;
    return;
  end if;
  insert into public.ai_budget_reservations (user_id, store_id, kind, model, reserved_usd, ref)
  values (p_user, p_store, p_kind, p_model, v_amount, p_ref)
  returning id into v_id;
  return query select true, v_id, v_spent, null::text;
end;
$$;

-- 정산: 사용량을 모두 확인했으면 실제 비용(settled), 아니면 예약 금액 유지(unsettled). 이미 정산된 예약은 바꾸지 않는다(수동 정산은 unsettled · reserved만)
create or replace function public.ai_budget_settle(p_id bigint, p_actual numeric, p_known boolean, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_budget_reservations
     set status = case when p_known then 'settled' else 'unsettled' end,
         actual_usd = case when p_known then round(greatest(coalesce(p_actual, 0), 0), 4) else null end,
         note = left(coalesce(p_note, ''), 300),
         settled_at = now()
   where id = p_id and status in ('reserved', 'unsettled');
  return found;
end;
$$;

revoke all on function public.ai_month_spent() from public, anon, authenticated;
revoke all on function public.ai_budget_reserve(uuid, bigint, text, text, numeric, numeric, text, integer) from public, anon, authenticated;
revoke all on function public.ai_budget_settle(bigint, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.ai_month_spent() to service_role;
grant execute on function public.ai_budget_reserve(uuid, bigint, text, text, numeric, numeric, text, integer) to service_role;
grant execute on function public.ai_budget_settle(bigint, numeric, boolean, text) to service_role;

-- 되돌리기(예약 기록도 지워짐 — 먼저 미정산 예약을 확인):
--   alter table public.ai_weekly_verifications drop column if exists reservation_id;
--   drop function if exists public.ai_budget_settle(bigint, numeric, boolean, text);
--   drop function if exists public.ai_budget_reserve(uuid, bigint, text, text, numeric, numeric, text, integer);
--   drop function if exists public.ai_month_spent();
--   drop table if exists public.ai_budget_reservations;
-- 되돌린 뒤에는 이 마이그레이션 이전 ai-weekly-review(테이블 직접 합산)로 함께 되돌려야 한다.
