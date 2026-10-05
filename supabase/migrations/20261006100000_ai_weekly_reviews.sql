-- LaunchROAS 주간 AI 광고 점검 — 계정당 주 1회(한국 시간 월요일 00시 갱신, 이월 없음).
-- 이용 횟수 · 동시 요청 제어는 (user_id, quota_week) 고유 제약과 함수의 상태 비교(compare-and-set)로 서버에서 한다.
-- 사용자는 이 표를 직접 읽거나 쓰지 않는다(정책 없음) — ai-weekly-review 함수(service_role)만 다루고,
-- 함수는 사용자에게 결과만 돌려준다. usage · cost_usd는 운영자 확인용이다.
-- [적용 전] 원격 DB 변경이므로 사용자 승인 후에만 적용한다.

create table if not exists public.ai_weekly_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_week date not null,                    -- 이용 주(한국 시간 월요일)
  store_id bigint not null references public.stores(id) on delete cascade,
  status text not null check (status in ('running', 'partial', 'completed', 'failed', 'no_data')),
  period jsonb,                                -- 분석 기간 · 비교 기간 · 시간대 · 귀속 기준
  batches jsonb not null default '[]'::jsonb,  -- 묶음별 상태(pending · done · failed)와 광고 ID
  result jsonb,                                -- 사용자에게 보여줄 결과(요약 · 우선순위 · 광고별 분석)
  retry_count integer not null default 0,
  usage jsonb not null default '{}'::jsonb,    -- 운영자용: 호출 수 · 토큰 · 이미지 수
  cost_usd numeric(10, 4) not null default 0,  -- 운영자용: 공식 요금 기준 계산값
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quota_week)
);

create index if not exists ai_weekly_reviews_created_at_idx on public.ai_weekly_reviews (created_at);

alter table public.ai_weekly_reviews enable row level security;
revoke all on public.ai_weekly_reviews from anon, authenticated;

-- 되돌리기: drop table if exists public.ai_weekly_reviews;
