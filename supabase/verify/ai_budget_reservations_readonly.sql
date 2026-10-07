-- ============================================================================
-- AI 비용 예약 원격 상태 확인 — 읽기 전용(SELECT만) · 적용 "전"에도 "후"에도 실행 가능
--   대상: 20261007090000_ai_budget_reservations.sql · 20261007100000_ai_budget_run_reservations.sql
-- ============================================================================
-- 실행 방법 (Supabase Studio SQL 편집기)
--   - 편집기는 마지막 문장의 결과만 보여 준다 → [블록 N]을 하나씩 선택해 실행한다(전체 실행 X).
--   - 블록 1~5 · 4-1 · 8 · 8-1은 예약 테이블 · 컬럼 · 함수가 없어도 오류가 나지 않는다(카탈로그 · 기존 테이블만 조회).
--   - 블록 6 · 7 · 8-2 · 9는 블록 2 결과를 보고 해당 객체가 있을 때만 실행한다(없으면 "relation does not exist" 오류 — 변경은 없음).
--   - 어떤 블록도 데이터 · 스키마를 바꾸지 않는다(insert · update · delete · create · alter · grant 없음).
--     예외: 블록 9는 ai_month_spent()를 호출한다 — stable SQL 함수로 합계만 읽는다.
--   - 개인정보 · 키는 조회하지 않는다: user_id · store_id · result · batches · period · ref · note · error 본문은 고르지 않는다.
-- ============================================================================


-- [블록 1] 마이그레이션 기록 — 예약 마이그레이션 2개와 직전 AI 마이그레이션
-- 기대: 적용 전이면 20261007090000 · 20261007100000 행이 없다. 기록이 있어도 실제 객체는 블록 2~5로 따로 확인한다.
-- name 컬럼이 없다는 오류(예전 CLI로 만든 기록 테이블)면: select version from supabase_migrations.schema_migrations where version >= '20261006000000' order by version;
select version, name
from supabase_migrations.schema_migrations
where version >= '20261006000000'
order by version;


-- [블록 2] 객체 존재 — 테이블 · 컬럼 · 함수 · check (없어도 false로 나온다)
-- 기대(둘 다 적용): 모두 true · run_kind_allowed true
-- 기대(090000만): reviews_reserved_cost_col false · run_kind_allowed false · 나머지 true
-- 기대(둘 다 미적용): 모두 false
select
  to_regclass('public.ai_budget_reservations') is not null                                              as reservations_table,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_weekly_verifications' and column_name = 'reservation_id') as verifications_reservation_col,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_weekly_reviews' and column_name = 'reserved_cost_usd')   as reviews_reserved_cost_col,
  to_regprocedure('public.ai_month_spent()') is not null                                                as fn_month_spent,
  to_regprocedure('public.ai_budget_reserve(uuid,bigint,text,text,numeric,numeric,text,integer)') is not null as fn_budget_reserve,
  to_regprocedure('public.ai_budget_settle(bigint,numeric,boolean,text)') is not null                   as fn_budget_settle,
  exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public' and t.relname = 'ai_budget_reservations' and c.conname = 'ai_budget_reservations_kind_check'
            and pg_get_constraintdef(c.oid) like '%''run''%')                                           as run_kind_allowed,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'ai_month_spent' and p.prosrc like '%reserved_cost_usd%')  as month_spent_excludes_reserved;


-- [블록 3] 컬럼 정의 — 예약 테이블 · 연결 컬럼(없으면 0행)
-- 기대: ai_budget_reservations 12개 컬럼(id … settled_at) · ai_weekly_verifications.reservation_id bigint · ai_weekly_reviews.reserved_cost_usd numeric(10,4) not null default 0
select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (table_name = 'ai_budget_reservations'
       or (table_name = 'ai_weekly_verifications' and column_name = 'reservation_id')
       or (table_name = 'ai_weekly_reviews' and column_name in ('cost_usd', 'reserved_cost_usd')))
order by table_name, ordinal_position;


-- [블록 4] 제약 · 인덱스 · RLS · 권한 — 예약 테이블(없으면 0행)
-- 기대: kind check에 'verify' · 'verify_video'(+ 100000 적용 시 'run') · status check 3값 · reserved_usd > 0 · RLS true
--       anon · authenticated select false · service_role select true · 인덱스 created_at · (kind, ref, created_at)
select 'constraint' as item, c.conname as name, pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname in ('ai_budget_reservations', 'ai_weekly_reviews', 'ai_weekly_verifications')
  and (t.relname = 'ai_budget_reservations' or pg_get_constraintdef(c.oid) like '%reserv%')
union all
select 'index', i.relname, pg_get_indexdef(i.oid)
from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'ai_budget_reservations'
union all
select 'rls', t.relname, case when t.relrowsecurity then 'enabled' else 'DISABLED' end
from pg_class t join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'ai_budget_reservations'
union all
select 'table_select_privilege', r.rolname || ' → ' || t.relname, has_table_privilege(r.oid, t.oid, 'select')::text
from pg_class t join pg_namespace n on n.oid = t.relnamespace cross join pg_roles r
where n.nspname = 'public' and t.relname = 'ai_budget_reservations' and r.rolname in ('anon', 'authenticated', 'service_role')
order by 1, 2;


-- [블록 4-1] 일반 사용자(anon · authenticated) 쓰기 · 실행 권한 — 기대: granted 전부 false · policies 0
-- 예약 테이블 모든 권한 · 예약 함수 실행(역할 직접 + PUBLIC 경유) · 월 합계에 쓰이는 컬럼(reserved_cost_usd · reservation_id · cost_usd) 쓰기
-- RLS가 켜져 있고 정책이 0개면 권한이 있어도 행은 안 보이지만, 권한 자체가 없어야 한다(이중 차단)
select r.rolname as role, 'table ai_budget_reservations' as object, pr.priv as privilege, has_table_privilege(r.oid, t.oid, pr.priv) as granted
from pg_class t join pg_namespace n on n.oid = t.relnamespace cross join pg_roles r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as pr(priv)
where n.nspname = 'public' and t.relname = 'ai_budget_reservations' and r.rolname in ('anon', 'authenticated')
union all
select r.rolname, 'function ' || p.proname, 'EXECUTE', has_function_privilege(r.oid, p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join pg_roles r
where n.nspname = 'public' and p.proname in ('ai_month_spent', 'ai_budget_reserve', 'ai_budget_settle') and r.rolname in ('anon', 'authenticated')
union all
select 'PUBLIC', 'function ' || p.proname, 'EXECUTE', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('ai_month_spent', 'ai_budget_reserve', 'ai_budget_settle')
union all
select r.rolname, 'column ' || c.table_name || '.' || c.column_name, pr.priv, has_column_privilege(r.oid, ('public.' || c.table_name)::regclass, c.column_name, pr.priv)
from information_schema.columns c cross join pg_roles r cross join unnest(array['INSERT', 'UPDATE']) as pr(priv)
where c.table_schema = 'public' and r.rolname in ('anon', 'authenticated')
  and ((c.table_name = 'ai_weekly_reviews' and c.column_name in ('cost_usd', 'reserved_cost_usd'))
    or (c.table_name = 'ai_weekly_verifications' and c.column_name in ('cost_usd', 'reservation_id')))
union all
select 'policies', 'table ' || tablename, 'count', (count(*) > 0)
from pg_policies where schemaname = 'public' and tablename = 'ai_budget_reservations' group by tablename
order by 1, 2, 3;


-- [블록 5] 함수 정의 · 실행 권한 — 예약 함수 3개(없으면 0행)
-- 기대: security definer true · search_path=public · anon · authenticated execute false · service_role true
--       ai_month_spent 정의에 100000 적용 시 'greatest(cost_usd - reserved_cost_usd, 0)'
select p.proname as function, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
       p.provolatile as volatility, p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role_exec,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('ai_month_spent', 'ai_budget_reserve', 'ai_budget_settle')
order by p.proname;


-- ---------------------------------------------------------------------------- 아래는 객체가 있을 때만
-- [블록 6] 미정산 예약 — 블록 2 reservations_table = true일 때만
-- 상태 · 종류별 건수 · 금액(이번 달 · 한국 시간). 미정산 = reserved(정산 전 · 강제 종료) + unsettled(사용량 미확인)
select kind, status, count(*) as n, sum(reserved_usd) as reserved_usd, sum(actual_usd) as actual_usd,
       min(created_at) as oldest, max(created_at) as newest
from public.ai_budget_reservations
where created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
group by kind, status
order by kind, status;

-- [블록 7] 미정산 예약 상세 — 블록 6에 reserved · unsettled가 있을 때만(식별자 · 금액 · 시각만, 사용자 · 대상 · 메모 제외)
-- 수동 정산 대상. 1시간 넘게 reserved면 함수가 강제 종료됐을 가능성
select id, kind, model, status, reserved_usd, created_at, settled_at,
       round(extract(epoch from (now() - created_at)) / 3600, 1) as age_hours
from public.ai_budget_reservations
where status in ('reserved', 'unsettled')
order by created_at
limit 50;


-- [블록 8] 최근 주간 실행 기록 — 항상 실행 가능(ai_weekly_reviews는 20261006100000부터 있음)
-- 비활성(2026-10-06 밤) 전에 실제 실행이 있었는지 · 이번 달 비용. 사용자 · 쇼핑몰 · 결과 · 오류 본문 제외
select id, quota_week, status, created_at, updated_at, retry_count,
       (usage ->> 'calls')::int            as calls,
       (usage ->> 'unconfirmed_calls')::int as unconfirmed_calls,
       cost_usd, error is not null         as has_error
from public.ai_weekly_reviews
order by updated_at desc
limit 20;

-- [블록 8-1] 주간 실행 · 운영자 검증 이번 달 합계 — 항상 실행 가능
select 'ai_weekly_reviews' as source, count(*) as n, count(distinct user_id) as users, sum(cost_usd) as cost_usd, max(updated_at) as last_at
from public.ai_weekly_reviews
where updated_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
union all
select 'ai_weekly_verifications', count(*), count(distinct user_id), sum(cost_usd), max(created_at)
from public.ai_weekly_verifications
where created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');

-- [블록 8-2] 예약 분 표시(reserved_cost_usd) — 블록 2 reviews_reserved_cost_col = true일 때만
select count(*) filter (where reserved_cost_usd > 0) as rows_with_reserved, sum(reserved_cost_usd) as reserved_cost_usd,
       sum(greatest(cost_usd - reserved_cost_usd, 0)) as counted_in_month_from_reviews
from public.ai_weekly_reviews
where updated_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');


-- [블록 9] 월 합계 함수 — 블록 2 fn_month_spent = true일 때만(합계 숫자 1개)
-- 블록 8-1 · 6 값으로 손 계산한 합계와 비교: 주간(− 예약 분) + 예약 이전 검증 + 예약(정산 실제 또는 예약 금액)
select public.ai_month_spent() as month_spent_usd;
