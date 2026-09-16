-- ============================================================================
-- plans 검증 스크립트 — 20260916100000_plans.sql 적용 "후" 실제 DB에서 실행
-- ============================================================================
-- 목적: RLS(본인 행만) · 컬럼 단위 권한 · CHECK(NULL 평가 포함) · 트리거
--       (불변 컬럼 · 재확인일 규칙 · updated_at)를 "일반 사용자(authenticated)
--       역할"로 실제 실행해 확인한다. service_role/postgres로 성공한 것은 RLS
--       검증이 아니므로, 사용자 시나리오는 전부 `set local role authenticated`
--       + request.jwt.claims 설정 아래에서 돈다.
--
-- 실행 조건
--   - Supabase Studio SQL 편집기(postgres 역할) 또는 postgres 역할 psql.
--     postgres 역할은 authenticated/anon으로 SET ROLE 할 수 있어야 하고(Supabase
--     기본), authenticated/anon이 DO 블록(plpgsql)을 실행할 수 있어야 한다.
--   - 아래 "테스트 계정"의 두 값을 테스트 전용 계정 UUID로 반드시 바꾼다.
--     실제 사용 중인 계정을 넣지 않는다. 지정하지 않으면 시작 단계에서 멈춘다.
--     계정 UUID는 이 파일에 저장해 두지 말고 실행 시에만 넣는다.
--   - 만드는 행은 전부 이 트랜잭션 안에서만 존재하고 마지막 ROLLBACK으로
--     사라진다. 기존 사용자 데이터와 테이블 설정(트리거/정책/권한)은 건드리지
--     않는다. 변경·삭제 시도는 전부 이번 실행에서 만든 테스트 행 1개에만 한정한다.
--   - 어떤 검증이라도 실패하면 RAISE EXCEPTION으로 즉시 멈추고 트랜잭션
--     전체가 롤백된다. 메시지의 "FAIL:" 항목을 본다.
--   - 성공하면 NOTICE로 "OK: ..." 줄이 순서대로 찍히고 마지막에 롤백된다.
--     Studio SQL 편집기는 NOTICE를 결과 창에 보여주지 않을 수 있다 — 그 경우
--     "오류 없이 끝남(Success)" = 전부 통과이고, FAIL은 오류 메시지로 나타난다.
--     NOTICE까지 보려면 psql로 실행한다.
--
-- 실행 방법: 파일 전체를 한 번에 실행한다(BEGIN ~ ROLLBACK이 한 묶음).
--
-- 역할별 접근 권한(설계 메모)
--   - 검증 컨텍스트(테스트 계정 UUID, 이번 실행에서 만든 계획 id/요청 id)는
--     임시 테이블이 아니라 트랜잭션 로컬 GUC(v.*)에 둔다. set_config /
--     current_setting은 객체 권한이 필요 없어 postgres·authenticated·anon 어느
--     역할에서도 읽고 쓸 수 있다. (postgres가 만든 임시 테이블은 authenticated에
--     SELECT 권한이 없어 조회가 막힌다 — 그 문제를 public.plans 권한 완화로
--     풀지 않는다.)
--   - 사용자 전환도 pg_temp 도우미 함수 없이 set_config 호출을 그대로 쓴다
--     (임시 스키마 ACL에 기대지 않는다).
--   - 같은 트랜잭션에서는 now()가 고정이라 created_at < updated_at 비교로는
--     트리거를 판별할 수 없다. updated_at은 8)에서 "보낸 값을 트리거가 now()로
--     덮어쓰는지"로 확인한다(운영 트리거 변경 없음).
--   - 기한 지난 계획(과거 재확인일) 시나리오는 운영 트리거를 끄지 않고는
--     데이터를 만들 수 없어 이 파일에서는 미검증이다.
--     plans_verify_overdue_staging.sql(로컬/스테이징 전용) 참고.
--
-- 2026-09-16 검토 반영 개정본 — 아직 실제 PostgreSQL/Supabase에서 실행해 보지
-- 않았다. 첫 실행에서 FAIL이 나면 스크립트 쪽 결함일 수도 있으니 메시지와
-- 함께 검토한다.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- 테스트 계정 (반드시 수정)
-- 테스트 전용 계정 2개의 UUID를 아래 두 값에 넣는다. 서로 다른 계정이어야 하고
-- auth.users에 존재해야 한다.
select set_config('v.user_a', 'PUT-TEST-USER-A-UUID-HERE', true);
select set_config('v.user_b', 'PUT-TEST-USER-B-UUID-HERE', true);

do $$
declare
  a_txt text := current_setting('v.user_a', true);
  b_txt text := current_setting('v.user_b', true);
  re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  n int;
begin
  if a_txt is null or a_txt !~* re then raise exception 'FAIL: v.user_a에 테스트 계정 A의 UUID를 지정하세요.'; end if;
  if b_txt is null or b_txt !~* re then raise exception 'FAIL: v.user_b에 테스트 계정 B의 UUID를 지정하세요.'; end if;
  if lower(a_txt) = lower(b_txt) then raise exception 'FAIL: 테스트 계정 A와 B는 서로 다른 계정이어야 합니다.'; end if;
  select count(*) into n from auth.users where id in (a_txt::uuid, b_txt::uuid);
  if n is distinct from 2 then
    raise exception 'FAIL: 테스트 계정 A/B 중 auth.users에 없는 계정이 있습니다(존재 %명).', n;
  end if;
  raise notice 'OK: 테스트 계정 A/B 확인(서로 다름 · auth.users에 존재)';
end $$;

-- ---------------------------------------------------------------- 0) 구조 확인 (postgres)
do $$
declare ins text; upd text;
begin
  if to_regclass('public.plans') is null then raise exception 'FAIL: public.plans가 없습니다(마이그레이션 미적용).'; end if;
  if not exists (select 1 from pg_class where oid = 'public.plans'::regclass and relrowsecurity) then
    raise exception 'FAIL: plans에 RLS가 켜져 있지 않습니다.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'plans') <> 4 then
    raise exception 'FAIL: plans 정책이 4개가 아닙니다(select/insert/update/delete 본인 행).';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.plans'::regclass
                   and attname = 'calc_version' and attgenerated = 's' and attnotnull) then
    raise exception 'FAIL: calc_version이 NOT NULL stored 생성 컬럼이 아닙니다.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.plans'::regclass and tgname = 'plans_before_insert' and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.plans'::regclass and tgname = 'plans_before_update' and tgenabled <> 'D') then
    raise exception 'FAIL: plans_before_insert / plans_before_update 트리거가 없거나 비활성 상태입니다.';
  end if;

  -- 컬럼 단위 권한: 클라이언트(plans.js)가 실제로 보내는 컬럼과 정확히 일치해야 한다.
  -- 권한이 하나도 없으면 string_agg가 NULL이라 <> 비교는 통과해 버린다 → IS DISTINCT FROM.
  select string_agg(column_name::text, ',' order by column_name::text) into ins
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'plans' and grantee = 'authenticated' and privilege_type = 'INSERT';
  if ins is distinct from 'action_text,calc_snapshot,client_request_id,review_date,title,user_id' then
    raise exception 'FAIL: authenticated INSERT 컬럼 권한이 클라이언트 insert payload와 다릅니다(현재: %).', coalesce(ins, '없음');
  end if;
  select string_agg(column_name::text, ',' order by column_name::text) into upd
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'plans' and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if upd is distinct from 'action_text,done_at,executed,review_date,review_note,reviewed_at,status,title' then
    raise exception 'FAIL: authenticated UPDATE 컬럼 권한이 예상과 다릅니다(현재: %).', coalesce(upd, '없음');
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'plans' and grantee in ('anon', 'PUBLIC'))
     or exists (select 1 from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'plans' and grantee in ('anon', 'PUBLIC')) then
    raise exception 'FAIL: anon 또는 PUBLIC에 plans 권한이 남아 있습니다.';
  end if;
  raise notice 'OK: 구조 · RLS on · 정책 4개 · 트리거 2개 활성 · 컬럼 권한 = 클라이언트 payload · anon/PUBLIC 권한 없음';
end $$;

-- ---------------------------------------------------------------- 1) 사용자 A로 insert (RLS 아래)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  b uuid := current_setting('v.user_b', true)::uuid;
  rid uuid := gen_random_uuid();
  r record; n int;
begin
  if current_user::text is distinct from 'authenticated' then
    raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%). service_role/postgres 실행은 RLS 검증이 아닙니다.', current_user;
  end if;
  if auth.uid() is distinct from a then raise exception 'FAIL: auth.uid()가 사용자 A가 아닙니다(NULL 포함).'; end if;

  -- 클라이언트 insert와 동일한 컬럼만 보낸다 + RETURNING(=PostgREST .select())
  insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
  values (a, rid, '  검증 계획 A  ', '실행할 일', (now() at time zone 'Asia/Seoul')::date + 7,
          '{"calc_version":2,"date":"x","saved_at":"y","platform":null,"input":{"price":30000},"result":{"postAd":9000}}'::jsonb)
  returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 or r.id is null then raise exception 'FAIL: A insert가 1행을 만들지 못했습니다.'; end if;
  if r.calc_version is distinct from 2 or r.status is distinct from 'active' or r.executed is distinct from false then
    raise exception 'FAIL: insert 기본값/생성 컬럼 값이 예상과 다릅니다.';
  end if;
  -- 이번 실행에서 만든 테스트 행의 id / 요청 id를 컨텍스트에 보관 — 이후의 모든
  -- 변경·삭제 시도는 이 행에만 한정한다(기존 계획을 고르지 않는다).
  perform set_config('v.plan_a_id', r.id::text, true);
  perform set_config('v.plan_a_rid', rid::text, true);
  raise notice 'OK: A insert + returning(생성 컬럼 calc_version=2, 기본 status/executed) · 테스트 행 id 보관';

  -- 충돌 후 조회(클라이언트 lookupExisting과 동일 필터)
  if (select count(*) from public.plans where user_id = a and client_request_id = rid) <> 1 then
    raise exception 'FAIL: user_id+client_request_id 조회가 본인 행을 돌려주지 않습니다.';
  end if;
  -- 같은 요청 ID 재시도 → unique_violation(23505)
  begin
    insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
    values (a, rid, '재시도', '재시도', (now() at time zone 'Asia/Seoul')::date + 7, '{"calc_version":2,"input":{},"result":{}}'::jsonb);
    raise exception 'FAIL: 같은 (user_id, client_request_id) 재insert가 허용됐습니다.';
  exception when unique_violation then raise notice 'OK: 중복 요청 ID → 23505';
  end;

  -- 다른 사용자 소유로 insert 시도 → RLS with check 위반(42501)
  begin
    insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
    values (b, gen_random_uuid(), 'x', 'x', (now() at time zone 'Asia/Seoul')::date, '{"calc_version":2,"input":{},"result":{}}'::jsonb);
    raise exception 'FAIL: 다른 사용자 user_id로 insert가 허용됐습니다.';
  exception when insufficient_privilege then raise notice 'OK: 타인 소유 insert → RLS 거부';
  end;

  -- 생성 컬럼에 값 전송 → 거부(컬럼 권한 없음 42501 또는 428C9)
  begin
    execute 'insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot, calc_version) values ($1,$2,$3,$4,$5,$6,2)'
      using a, gen_random_uuid(), 'x', 'x', (now() at time zone 'Asia/Seoul')::date, '{"calc_version":2,"input":{},"result":{}}'::jsonb;
    raise exception 'FAIL: 생성 컬럼 calc_version에 값을 넣는 insert가 허용됐습니다.';
  exception when insufficient_privilege or generated_always then raise notice 'OK: 생성 컬럼 값 전송 거부';
  end;

  -- 과거 재확인일로 새 계획 → 트리거 거부
  begin
    insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
    values (a, gen_random_uuid(), 'x', 'x', (now() at time zone 'Asia/Seoul')::date - 1, '{"calc_version":2,"input":{},"result":{}}'::jsonb);
    raise exception 'FAIL: 과거 재확인일 insert가 허용됐습니다.';
  exception when check_violation then raise notice 'OK: 과거 재확인일 insert → REVIEW_DATE_IN_PAST';
  end;

  -- 공백만 있는 제목 → CHECK
  begin
    insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
    values (a, gen_random_uuid(), '   ', 'x', (now() at time zone 'Asia/Seoul')::date, '{"calc_version":2,"input":{},"result":{}}'::jsonb);
    raise exception 'FAIL: 공백 제목이 허용됐습니다.';
  exception when check_violation then raise notice 'OK: 공백 제목 거부';
  end;
end $$;

-- ---------------------------------------------------------------- 2) 스냅샷 CHECK — NULL 평가 함정 (A)
do $$
declare a uuid := current_setting('v.user_a', true)::uuid; bad jsonb; label text;
begin
  for bad, label in
    select * from (values
      ('{"calc_version":2,"result":{}}'::jsonb,                 'input 키 없음'),
      ('{"calc_version":2,"input":{}}'::jsonb,                  'result 키 없음'),
      ('{"input":{},"result":{}}'::jsonb,                       'calc_version 키 없음'),
      ('{"calc_version":"2","input":{},"result":{}}'::jsonb,    'calc_version이 문자열'),
      ('{"calc_version":3,"input":{},"result":{}}'::jsonb,      '지원하지 않는 버전 3'),
      ('{"calc_version":2,"input":[],"result":{}}'::jsonb,      'input이 배열'),
      ('[]'::jsonb,                                             '객체가 아님')
    ) as t(j, l)
  loop
    begin
      insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
      values (a, gen_random_uuid(), 'x', 'x', (now() at time zone 'Asia/Seoul')::date, bad);
      raise exception 'FAIL: 잘못된 스냅샷(%)이 CHECK를 통과했습니다(NULL 평가 확인).', label;
    exception when check_violation or not_null_violation or invalid_text_representation then
      raise notice 'OK: 잘못된 스냅샷 거부 — %', label;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- 3) 사용자 A의 컬럼 권한 — 불변 컬럼 (테스트 행만)
do $$
declare
  b uuid := current_setting('v.user_b', true)::uuid;
  pid uuid := current_setting('v.plan_a_id', true)::uuid;
begin
  if pid is null then raise exception 'FAIL: 테스트 행 id(v.plan_a_id)가 없습니다.'; end if;

  begin
    update public.plans set calc_snapshot = '{"calc_version":2,"input":{"price":1},"result":{}}'::jsonb where id = pid;
    raise exception 'FAIL: authenticated가 calc_snapshot을 수정할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: calc_snapshot UPDATE 권한 없음';
  end;
  begin
    update public.plans set user_id = b where id = pid;
    raise exception 'FAIL: authenticated가 user_id(소유자)를 수정할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: user_id UPDATE 권한 없음';
  end;
  begin
    update public.plans set client_request_id = gen_random_uuid() where id = pid;
    raise exception 'FAIL: authenticated가 client_request_id를 수정할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: client_request_id UPDATE 권한 없음';
  end;
  begin
    update public.plans set created_at = now() where id = pid;
    raise exception 'FAIL: authenticated가 created_at을 수정할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: created_at UPDATE 권한 없음';
  end;
  begin
    update public.plans set updated_at = now() where id = pid;
    raise exception 'FAIL: authenticated가 updated_at을 직접 수정할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: updated_at UPDATE 권한 없음(트리거만 갱신)';
  end;
end $$;

-- ---------------------------------------------------------------- 4) UI가 보내는 update 패턴 (A의 테스트 행)
do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  pid uuid := current_setting('v.plan_a_id', true)::uuid;
  today date := (now() at time zone 'Asia/Seoul')::date;
  r record; n int;
begin
  if pid is null then raise exception 'FAIL: 테스트 행 id(v.plan_a_id)가 없습니다.'; end if;

  update public.plans set executed = true where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: executed 변경이 테스트 행 1행에 적용되지 않았습니다(% 행).', n; end if;
  if r.executed is not true then raise exception 'FAIL: executed 변경 실패'; end if;

  update public.plans set review_note = '  메모  ', reviewed_at = now() where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: 메모 저장이 테스트 행 1행에 적용되지 않았습니다(% 행).', n; end if;
  if r.review_note is null or r.reviewed_at is null or r.status is distinct from 'active' then
    raise exception 'FAIL: 메모만 저장(active 유지) 실패';
  end if;

  update public.plans set review_date = today + 14 where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: 미루기가 테스트 행 1행에 적용되지 않았습니다(% 행).', n; end if;
  if r.review_date is distinct from today + 14 or r.review_note is null or r.executed is not true then
    raise exception 'FAIL: 미루기가 날짜를 반영하지 않았거나 메모/실행 여부를 잃었습니다.';
  end if;
  -- 같은 트랜잭션에서는 created_at = updated_at = now()라 여기서는 updated_at
  -- 갱신 여부를 판별할 수 없다(정상 트리거도 "같은 시각"이다). 8)에서 확인한다.
  raise notice 'OK: executed · 메모+reviewed_at · review_date 미루기(메모/실행 보존)';

  begin
    update public.plans set status = 'done' where id = pid and user_id = a; -- done_at 없이
    raise exception 'FAIL: done_at 없는 status=done이 허용됐습니다.';
  exception when check_violation then raise notice 'OK: status=done ↔ done_at 정합성 CHECK';
  end;
  begin
    update public.plans set review_note = 'x', reviewed_at = null where id = pid and user_id = a;
    raise exception 'FAIL: reviewed_at 없는 메모가 허용됐습니다.';
  exception when check_violation then raise notice 'OK: 메모 → reviewed_at 필수 CHECK';
  end;
  begin
    update public.plans set status = 'paused', done_at = now() where id = pid and user_id = a;
    raise exception 'FAIL: 허용되지 않은 status가 통과했습니다.';
  exception when check_violation then raise notice 'OK: status 허용값 CHECK';
  end;

  update public.plans set status = 'done', done_at = now(), reviewed_at = now() where id = pid and user_id = a returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: 완료 처리가 테스트 행 1행에 적용되지 않았습니다(% 행).', n; end if;
  if r.status is distinct from 'done' or r.done_at is null then raise exception 'FAIL: 완료 처리 실패'; end if;
  raise notice 'OK: 완료 처리(status=done + done_at + reviewed_at)';
end $$;

-- ---------------------------------------------------------------- 5) 기한 지난 계획 — 운영에서는 미검증
-- 재확인일이 이미 지난 행은 insert/update 트리거가 모두 막아, 운영 트리거를
-- 끄지 않고는 만들 수 없다. 운영 테이블 설정을 바꾸지 않기 위해 이 시나리오
-- (지난 계획의 메모/실행/완료 허용 · 과거로 미루기만 거부)는 여기서 검증하지
-- 않는다 → supabase/verify/plans_verify_overdue_staging.sql (로컬/스테이징 전용).
do $$ begin raise notice '미검증: 기한 지난 계획 시나리오는 이 파일에서 다루지 않음(plans_verify_overdue_staging.sql 참고)'; end $$;

-- ---------------------------------------------------------------- 6) 사용자 B — A의 테스트 행 접근 차단
-- B에게 기존 계획이 있어도 상관없도록, A의 테스트 행(id / user_id+요청 id)만 대상으로 본다.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_b', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_b', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  b uuid := current_setting('v.user_b', true)::uuid;
  pid uuid := current_setting('v.plan_a_id', true)::uuid;
  rid uuid := current_setting('v.plan_a_rid', true)::uuid;
  n int;
begin
  if pid is null or rid is null then raise exception 'FAIL: 테스트 행 id/요청 id(v.plan_a_id, v.plan_a_rid)가 없습니다.'; end if;
  if current_user::text is distinct from 'authenticated' then raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%).', current_user; end if;
  if auth.uid() is distinct from b then raise exception 'FAIL: auth.uid()가 사용자 B가 아닙니다(NULL 포함).'; end if;

  if (select count(*) from public.plans where id = pid) <> 0 then
    raise exception 'FAIL: B가 A의 테스트 행을 id로 조회할 수 있습니다.';
  end if;
  if (select count(*) from public.plans where user_id = a and client_request_id = rid) <> 0 then
    raise exception 'FAIL: B가 A의 테스트 행을 user_id+client_request_id로 조회할 수 있습니다.';
  end if;
  update public.plans set executed = false where id = pid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B가 A의 테스트 행을 수정했습니다(% 행).', n; end if;
  update public.plans set executed = false where id = pid and user_id = a; -- 클라이언트 update 필터 그대로
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B가 user_id 필터를 A로 넣은 update로 A의 테스트 행을 수정했습니다(% 행).', n; end if;
  delete from public.plans where id = pid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B가 A의 테스트 행을 삭제했습니다(% 행).', n; end if;
  begin
    insert into public.plans (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
    values (a, gen_random_uuid(), 'x', 'x', (now() at time zone 'Asia/Seoul')::date, '{"calc_version":2,"input":{},"result":{}}'::jsonb);
    raise exception 'FAIL: B가 A 소유의 계획을 insert할 수 있습니다.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK: B는 A의 테스트 행을 조회·수정·삭제할 수 없고(0행) A 소유로 insert도 못 함';
end $$;

-- ---------------------------------------------------------------- 7) anon — 아무 것도 못 함
set local role anon;
do $$
begin
  begin
    perform count(*) from public.plans;
    raise exception 'FAIL: anon이 plans를 조회할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: anon SELECT 거부';
  end;
end $$;

-- ---------------------------------------------------------------- 8) 트리거 = 마지막 방어선 (postgres, 테스트 행만)
reset role;
do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  b uuid := current_setting('v.user_b', true)::uuid;
  pid uuid := current_setting('v.plan_a_id', true)::uuid;
  r record; n int;
begin
  if pid is null then raise exception 'FAIL: 테스트 행 id(v.plan_a_id)가 없습니다.'; end if;
  if (select count(*) from public.plans where id = pid and user_id = a) <> 1 then
    raise exception 'FAIL: 테스트 행이 B의 수정·삭제 시도 뒤에 남아 있지 않습니다.';
  end if;
  raise notice 'OK: 테스트 행이 B의 수정·삭제 시도 뒤에도 그대로 존재';

  begin
    update public.plans set calc_snapshot = '{"calc_version":2,"input":{"price":999},"result":{}}'::jsonb where id = pid;
    raise exception 'FAIL: 트리거가 calc_snapshot 변경을 막지 못했습니다.';
  exception when check_violation then raise notice 'OK: 트리거 — calc_snapshot 불변';
  end;
  begin
    update public.plans set user_id = b where id = pid;
    raise exception 'FAIL: 트리거가 user_id 변경을 막지 못했습니다.';
  exception when check_violation then raise notice 'OK: 트리거 — user_id(소유자) 불변';
  end;
  begin
    update public.plans set client_request_id = gen_random_uuid() where id = pid;
    raise exception 'FAIL: 트리거가 client_request_id 변경을 막지 못했습니다.';
  exception when check_violation then raise notice 'OK: 트리거 — client_request_id 불변';
  end;
  begin
    update public.plans set created_at = now() - interval '1 day' where id = pid;
    raise exception 'FAIL: 트리거가 created_at 변경을 막지 못했습니다.';
  exception when check_violation then raise notice 'OK: 트리거 — created_at 불변';
  end;

  -- updated_at: 같은 트랜잭션에서는 now()가 고정이라 "나중 시각"으로는 판별할 수
  -- 없다. 대신 하루 전 값을 보내고 트리거가 그것을 now()로 덮어쓰는지 본다 —
  -- 트리거가 없거나 갱신하지 않으면 하루 전 값이 그대로 남아 FAIL이 된다.
  update public.plans set updated_at = now() - interval '1 day' where id = pid returning updated_at into r;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'FAIL: updated_at 검증 update가 테스트 행 1행에 적용되지 않았습니다(% 행).', n; end if;
  if r.updated_at is distinct from now() then raise exception 'FAIL: 트리거가 updated_at을 now()로 갱신하지 않았습니다.'; end if;
  raise notice 'OK: 트리거 — updated_at은 보낸 값과 무관하게 now()로 갱신';

  raise notice 'OK: 모든 검증 통과(기한 지난 계획 시나리오는 미검증) — 아래 ROLLBACK으로 테스트 행 전부 제거';
end $$;

rollback;
