-- ============================================================================
-- plans 기한 지난 계획 검증 — 로컬/스테이징 전용 (운영 DB에서 실행 금지)
-- ============================================================================
-- plans_verify.sql에서 분리한 시나리오: 재확인일이 이미 지난 계획도 메모 저장 ·
-- 실행 체크 · 완료 처리는 되고, 과거 날짜로 "미루기"만 거부되는지.
--
-- 왜 운영에서 하지 않나: 과거 재확인일 행은 plans_before_insert / plans_before_update
-- 트리거가 insert · update 모두 막아, 트리거를 잠시 끄지 않고는 만들 수 없다.
-- 아래 ALTER TABLE ... DISABLE TRIGGER는 트랜잭션 안이라 ROLLBACK으로 되돌아가지만,
-- 실행되는 동안 plans 테이블에 ACCESS EXCLUSIVE 잠금을 걸어 모든 사용자의 읽기 ·
-- 쓰기를 막고 운영 테이블 설정을 순간적으로 바꾸는 행위다. 그래서 운영 검증
-- (plans_verify.sql)에서 제외하고 여기서만 다룬다.
--
-- 실행 조건
--   - 로컬 Supabase(supabase start) 또는 스테이징 프로젝트. postgres 역할.
--   - 테스트 전용 계정 1개의 UUID를 아래 v.user_a에 넣는다(파일에 저장해 두지 않는다).
--   - 만드는 행은 이 트랜잭션 안에서만 존재하고 마지막 ROLLBACK으로 사라진다.
--     변경 시도는 이번 실행에서 만든 테스트 행 1개에만 한정한다.
--   - 실패하면 RAISE EXCEPTION으로 멈추고 전체 롤백된다. NOTICE 표시 방식과
--     역할 전환 방식(GUC 컨텍스트, set_config)은 plans_verify.sql과 같다.
--
-- 2026-09-16 작성 — 아직 실제 PostgreSQL/Supabase에서 실행해 보지 않았다.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- 테스트 계정 (반드시 수정)
select set_config('v.user_a', 'PUT-TEST-USER-A-UUID-HERE', true);

do $$
declare
  a_txt text := current_setting('v.user_a', true);
  re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if a_txt is null or a_txt !~* re then raise exception 'FAIL: v.user_a에 테스트 계정 A의 UUID를 지정하세요.'; end if;
  if not exists (select 1 from auth.users where id = a_txt::uuid) then
    raise exception 'FAIL: 테스트 계정 A가 auth.users에 없습니다.';
  end if;
  if to_regclass('public.plans') is null then raise exception 'FAIL: public.plans가 없습니다(마이그레이션 미적용).'; end if;
  raise notice 'OK: 테스트 계정 A 확인';
end $$;

-- ---------------------------------------------------------------- 1) postgres — 과거 재확인일 행 만들기 (update 트리거를 잠시 끔)
do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  rid uuid := gen_random_uuid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  pid uuid; n int;
begin
  insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
  values (a, rid, '기한 지난 계획', 'x', today, '{"calc_version":2,"input":{},"result":{}}'::jsonb)
  returning id into pid;
  if pid is null then raise exception 'FAIL: 테스트 행 insert 실패'; end if;

  alter table public.plans disable trigger plans_before_update;
  update public.plans set review_date = today - 3 where id = pid;
  get diagnostics n = row_count;
  alter table public.plans enable trigger plans_before_update;
  if n is distinct from 1 then raise exception 'FAIL: 과거 재확인일 설정이 테스트 행 1행에 적용되지 않았습니다(% 행).', n; end if;

  perform set_config('v.plan_a_id', pid::text, true);
  raise notice 'OK: 과거 재확인일(오늘-3일) 테스트 행 준비 · 트리거 다시 켬';
end $$;

-- ---------------------------------------------------------------- 2) 사용자 A — 지난 계획의 검토 (RLS 아래)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  pid uuid := current_setting('v.plan_a_id', true)::uuid;
  today date := (now() at time zone 'Asia/Seoul')::date;
  r record; n int;
begin
  if pid is null then raise exception 'FAIL: 테스트 행 id(v.plan_a_id)가 없습니다.'; end if;
  if current_user::text is distinct from 'authenticated' then raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%).', current_user; end if;
  if auth.uid() is distinct from a then raise exception 'FAIL: auth.uid()가 사용자 A가 아닙니다(NULL 포함).'; end if;

  update public.plans set review_note = '늦게 검토', reviewed_at = now() where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: 기한 지난 계획 메모 저장이 테스트 행에 적용되지 않았습니다(% 행).', n; end if;
  if r.review_note is distinct from '늦게 검토' or r.review_date is distinct from today - 3 then
    raise exception 'FAIL: 기한 지난 계획 메모 저장이 막혔거나 재확인일이 바뀌었습니다.';
  end if;

  update public.plans set executed = true where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 or r.executed is not true then raise exception 'FAIL: 기한 지난 계획 실행 체크가 막혔습니다.'; end if;

  begin
    update public.plans set review_date = today - 1 where id = pid and user_id = a;
    raise exception 'FAIL: 과거 날짜로 미루기가 허용됐습니다.';
  exception when check_violation then raise notice 'OK: 기한 지난 계획도 메모/실행 변경은 허용, 과거로 미루기만 거부';
  end;

  -- 재확인일이 지난 채로(값 그대로) 완료 처리 — 날짜 검사에 걸리지 않아야 한다.
  -- (오늘 이후로 미루기 허용은 plans_verify.sql 4)에서 이미 확인한다.)
  update public.plans set status = 'done', done_at = now(), reviewed_at = now() where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 or r.status is distinct from 'done' or r.done_at is null or r.review_date is distinct from today - 3 then
    raise exception 'FAIL: 기한 지난 계획 완료 처리가 막혔거나 재확인일이 바뀌었습니다.';
  end if;
  raise notice 'OK: 기한 지난 계획 완료 처리(재확인일 그대로) — 아래 ROLLBACK으로 테스트 행 제거';
end $$;

rollback;
