-- LaunchROAS AI 비용 예약 — 주간 실행(run)도 묶음 그룹마다 최악 비용을 원자적으로 예약하고 그룹이 끝나면 정산한다.
-- [준비 · 미적용] 원격 적용은 승인 후. 적용 순서: 20261007090000_ai_budget_reservations → 이 마이그레이션 → ai-weekly-review 재배포.
--   (이 마이그레이션 없이 새 함수를 배포하면 kind='run' 예약이 check 위반으로 거절돼 주간 실행이 예산 확인 실패로 멈춘다 — 비용은 쓰지 않음)
--
-- 이중 집계 방지
-- - 주간 기록(ai_weekly_reviews.cost_usd)은 운영자 확인용으로 그대로 누적한다.
-- - 그중 예약으로 이미 월 합계에 들어간 부분을 reserved_cost_usd에 따로 남기고, 월 합계는 주간 기록에서 cost_usd − reserved_cost_usd만 더한다.
--   예약 쪽 값(정산 실제 비용 또는 예약 금액)이 기준이다 — 주간 기록 저장(finish)이 실패해도 비용은 예약에 남는다.
-- - 예약 이전 주간 기록(reserved_cost_usd = 0)은 cost_usd 전체를 그대로 더한다.

alter table public.ai_budget_reservations drop constraint if exists ai_budget_reservations_kind_check;
alter table public.ai_budget_reservations add constraint ai_budget_reservations_kind_check check (kind in ('verify', 'verify_video', 'run'));

alter table public.ai_weekly_reviews add column if not exists reserved_cost_usd numeric(10, 4) not null default 0 check (reserved_cost_usd >= 0);

-- 이번 달(한국 시간 1일 00시부터) AI 비용 — 예약에 들어간 주간 실행 비용은 주간 기록에서 빼고 예약으로만 센다
create or replace function public.ai_month_spent()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with m as (select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as start)
  select coalesce((select sum(greatest(cost_usd - reserved_cost_usd, 0)) from public.ai_weekly_reviews, m where updated_at >= m.start), 0)
       + coalesce((select sum(cost_usd) from public.ai_weekly_verifications, m where created_at >= m.start and reservation_id is null), 0)
       + coalesce((select sum(case when status = 'settled' then actual_usd else reserved_usd end) from public.ai_budget_reservations, m where created_at >= m.start), 0);
$$;

revoke all on function public.ai_month_spent() from public, anon, authenticated;
grant execute on function public.ai_month_spent() to service_role;

-- 되돌리기(먼저 kind='run' 예약이 없는지 확인 — 있으면 check 재설정이 실패한다):
--   create or replace function public.ai_month_spent() ... (20261007090000의 정의로)
--   alter table public.ai_weekly_reviews drop column if exists reserved_cost_usd;
--   alter table public.ai_budget_reservations drop constraint if exists ai_budget_reservations_kind_check;
--   alter table public.ai_budget_reservations add constraint ai_budget_reservations_kind_check check (kind in ('verify', 'verify_video'));
-- 되돌린 뒤에는 이 마이그레이션 이전 ai-weekly-review(주간 실행 예약 없음)로 함께 되돌려야 한다.
