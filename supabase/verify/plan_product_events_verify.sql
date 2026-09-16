-- ============================================================================
-- plan_product_events 검증 — 20260916120000_plan_product_events.sql 적용 "후"
-- ============================================================================
-- 확인 항목
--   1) product_events allowlist CHECK에 plan_created/plan_reviewed가 포함
--   2) track_product_event(text, uuid, text) 시그니처·SECURITY DEFINER·
--      search_path 설정·권한(public/anon 없음, authenticated 실행)이 원본과 동일
--   3) authenticated 사용자로 RPC 호출 시 이번 실행 전용 session_id로 행이
--      정확히 1건씩 생기고, 허용 밖 이름은 거부, anon은 실행 불가,
--      테이블 직접 조회는 여전히 차단됨
--
-- 실행 조건
--   - Supabase Studio SQL 편집기(postgres 역할) 또는 postgres 역할 psql.
--     postgres 역할은 authenticated/anon으로 SET ROLE 할 수 있어야 하고(Supabase
--     기본), authenticated/anon이 DO 블록(plpgsql)을 실행할 수 있어야 한다.
--   - 아래 "테스트 계정"에 테스트 전용 계정 UUID를 반드시 넣는다. 가장 오래된
--     계정을 자동으로 고르지 않는다. 실제 UUID는 이 파일에 저장해 두지 말고
--     실행 시에만 넣는다.
--   - 만드는 행(product_events 2건)은 이 트랜잭션 안에서만 존재하고 마지막
--     ROLLBACK으로 사라진다. 검증이 실패해도 운영 권한/정책을 완화하지 않는다.
--
-- 역할별 접근 권한(설계 메모, plans_verify.sql과 동일 방식)
--   - 컨텍스트(테스트 계정 UUID, 이번 실행 전용 session_id)는 임시 테이블이
--     아니라 트랜잭션 로컬 GUC(v.*)에 둔다. set_config/current_setting은 객체
--     권한이 필요 없어 postgres·authenticated·anon 어느 역할에서도 읽고 쓸 수
--     있다. (postgres가 만든 임시 테이블은 authenticated에 SELECT 권한이 없어
--     조회가 막힌다 — 그 문제를 권한 완화로 풀지 않는다.)
--   - 사용자 전환도 pg_temp 도우미 함수 없이 set_config 호출을 그대로 쓴다.
--
-- 실행 방법: 파일 전체를 한 번에 실행한다(BEGIN ~ ROLLBACK이 한 묶음).
-- Studio SQL 편집기는 중간 NOTICE를 안 보여줄 수 있다 — 마지막 SELECT
-- 'PASS: ...' 한 줄이 결과 창에 뜨면 전부 통과한 것이다. NOTICE까지 보려면
-- psql로 실행한다.
--
-- 2026-09-16 검토 반영 개정본 — 아직 실제 PostgreSQL/Supabase에서 실행해 보지
-- 않았다. 첫 실행에서 FAIL이 나면 스크립트 쪽 결함일 수도 있으니 메시지와
-- 함께 검토한다.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- 테스트 계정 (반드시 수정)
select set_config('v.user_a', 'PUT-TEST-USER-A-UUID-HERE', true);

do $$
declare
  a_txt text := current_setting('v.user_a', true);
  re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if a_txt is null or a_txt !~* re then raise exception 'FAIL: v.user_a에 테스트 계정의 UUID를 지정하세요.'; end if;
  if not exists (select 1 from auth.users where id = a_txt::uuid) then
    raise exception 'FAIL: 테스트 계정이 auth.users에 없습니다.';
  end if;
  raise notice 'OK: 테스트 계정 확인(auth.users에 존재)';
end $$;

-- 이번 실행 전용 session_id — 최종 검증을 이 값으로 한정해 기존/다른 실행의
-- 이벤트와 섞이지 않게 한다("최근 1분" 같은 시간 기반 집계를 쓰지 않는다).
select set_config('v.session_id', gen_random_uuid()::text, true);

-- ---------------------------------------------------------------- 0) 구조 확인 (postgres)
do $$
declare
  def text;
  fn_oid oid;
  p record;
  cfg text;
begin
  if to_regclass('public.product_events') is null then raise exception 'FAIL: product_events가 없습니다(선행 마이그레이션 미적용).'; end if;

  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.product_events'::regclass and conname = 'product_events_event_name_allowlist';
  if not found or def is null then raise exception 'FAIL: allowlist CHECK 제약이 없습니다.'; end if;
  if def not like '%plan_created%' or def not like '%plan_reviewed%' or def not like '%dashboard_viewed%' or def not like '%roadmap_started%' then
    raise exception 'FAIL: allowlist CHECK 내용이 예상과 다릅니다: %', def;
  end if;
  raise notice 'OK: allowlist CHECK = %', def;

  -- 함수 존재는 OID로 먼저 확인한다(없으면 to_regprocedure가 NULL을 돌려주고,
  -- NULL::oid로 pg_proc을 조회하면 조용히 0행이 나와 아래 검사들이 전부
  -- "NULL이라 통과"로 새 버릴 수 있다 — 그래서 여기서 먼저 막는다).
  fn_oid := to_regprocedure('public.track_product_event(text, uuid, text)');
  if fn_oid is null then raise exception 'FAIL: track_product_event(text, uuid, text) 시그니처가 없습니다.'; end if;

  select prosecdef, proconfig, pg_get_function_identity_arguments(oid) as args, prorettype::regtype::text as ret
    into p from pg_proc where oid = fn_oid;
  if not found then raise exception 'FAIL: track_product_event 함수 정보를 읽지 못했습니다(oid=%).', fn_oid; end if;

  if p.prosecdef is distinct from true then raise exception 'FAIL: SECURITY DEFINER가 아닙니다.'; end if;
  if p.ret is distinct from 'void' then raise exception 'FAIL: 반환형이 void가 아닙니다(%).', coalesce(p.ret, 'NULL'); end if;

  -- proconfig가 NULL(설정 없음)이면 array_to_string도 NULL이 되고, `if not (NULL like ...)`은
  -- NULL로 평가돼 조용히 통과해 버린다 — coalesce로 빈 문자열을 줘서 그 경우 확실히 FAIL 되게 한다.
  cfg := coalesce(array_to_string(p.proconfig, ','), '');
  if cfg not like '%search_path=public, pg_temp%' then
    raise exception 'FAIL: search_path 설정이 원본과 다릅니다(%).', case when cfg = '' then '설정 없음' else cfg end;
  end if;

  if has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'FAIL: anon에 실행 권한이 있습니다.';
  end if;
  if not has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'FAIL: authenticated에 실행 권한이 없습니다.';
  end if;
  raise notice 'OK: RPC 시그니처(%) · SECURITY DEFINER · search_path · 권한 보존', p.args;
end $$;

-- ---------------------------------------------------------------- 1) authenticated 사용자로 호출
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  sid uuid := current_setting('v.session_id', true)::uuid;
begin
  if current_user::text is distinct from 'authenticated' then
    raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%). service_role/postgres 실행은 RLS/RPC 권한 검증이 아닙니다.', current_user;
  end if;
  if auth.uid() is distinct from a then raise exception 'FAIL: auth.uid()가 테스트 계정이 아닙니다(NULL 포함).'; end if;

  -- 이번 실행 전용 session_id로 두 이벤트만 기록한다.
  perform public.track_product_event('plan_created', sid, '/tools');
  perform public.track_product_event('plan_reviewed', sid, '/');

  begin
    perform public.track_product_event('plan_deleted', sid, '/');
    raise exception 'FAIL: allowlist 밖 이벤트 이름이 허용됐습니다.';
  exception when raise_exception then
    if sqlerrm is distinct from 'INVALID_EVENT_NAME' then raise; end if;
    raise notice 'OK: 허용 밖 이름 → INVALID_EVENT_NAME';
  end;

  begin
    perform count(*) from public.product_events;
    raise exception 'FAIL: authenticated가 product_events를 직접 조회할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: 테이블 직접 접근은 여전히 차단(RPC만 허용)';
  end;
end $$;

-- ---------------------------------------------------------------- 2) anon — RPC 실행 불가
set local role anon;
do $$
declare sid uuid := current_setting('v.session_id', true)::uuid;
begin
  begin
    perform public.track_product_event('plan_created', sid, '/');
    raise exception 'FAIL: anon이 RPC를 실행할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: anon RPC 실행 거부';
  end;
end $$;

-- ---------------------------------------------------------------- 3) 기록 확인 (postgres, 이번 session_id로 한정)
reset role;
do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  sid uuid := current_setting('v.session_id', true)::uuid;
  n_created int;
  n_reviewed int;
  n_other int;
begin
  select count(*) into n_created from public.product_events
   where user_id = a and session_id = sid and event_name = 'plan_created';
  select count(*) into n_reviewed from public.product_events
   where user_id = a and session_id = sid and event_name = 'plan_reviewed';
  select count(*) into n_other from public.product_events
   where user_id = a and session_id = sid and event_name not in ('plan_created', 'plan_reviewed');

  if n_created is distinct from 1 then raise exception 'FAIL: 이번 session_id의 plan_created가 정확히 1건이 아닙니다(%건).', n_created; end if;
  if n_reviewed is distinct from 1 then raise exception 'FAIL: 이번 session_id의 plan_reviewed가 정확히 1건이 아닙니다(%건).', n_reviewed; end if;
  if n_other is distinct from 0 then raise exception 'FAIL: 이번 session_id에 예상 밖 이벤트가 %건 있습니다(거부됐어야 할 plan_deleted 등이 기록됐을 수 있음).', n_other; end if;

  raise notice 'OK: 이번 실행 session_id 기준 plan_created 1건 · plan_reviewed 1건 · 그 외 0건';
end $$;

select 'PASS: 이벤트 검증 완료 — 테스트 기록은 마지막 ROLLBACK으로 제거' AS verification_result;

rollback;
