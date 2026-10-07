-- LaunchROAS 주간 AI 점검 — 운영자 검증 실행 기록(사용자 화면에 없는 경로).
-- 주간 결과(ai_weekly_reviews)와 이용 횟수는 건드리지 않는다. cost_usd는 월 예산 합계에 포함된다(ai-weekly-review의 monthSpent).
-- 사용자는 이 표를 읽거나 쓰지 않는다 — 함수(service_role)만 다룬다.

create table if not exists public.ai_weekly_verifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id bigint not null references public.stores(id) on delete cascade,
  label text not null default 'verify',
  effort text,
  model text not null,
  status text not null check (status in ('completed', 'failed')),
  usage jsonb not null default '{}'::jsonb,
  cost_usd numeric(10, 4) not null default 0,
  duration_ms integer,
  result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_weekly_verifications_created_at_idx on public.ai_weekly_verifications (created_at);

alter table public.ai_weekly_verifications enable row level security;
revoke all on public.ai_weekly_verifications from anon, authenticated;
-- 이 프로젝트는 기본 권한을 줄여 둬서 service_role도 GRANT가 필요하다.
grant select, insert on public.ai_weekly_verifications to service_role;

-- 되돌리기: drop table if exists public.ai_weekly_verifications;
