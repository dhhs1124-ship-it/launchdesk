-- ============================================================================
-- user_policy_consents 검증 스크립트 — 20260918100000_user_policy_consents.sql
-- 적용 "후" 실제 DB에서 실행
-- ============================================================================
-- 목적: RLS(본인 행만 select/insert, update/delete 전면 차단) · 컬럼 단위
--       권한(accepted_at/id는 클라이언트가 못 씀) · CHECK(버전 NOT NULL,
--       source 허용값) · unique(user_id, terms_version, privacy_version) ·
--       anon 완전 차단을 "일반 사용자(authenticated) 역할"로 실제 실행해
--       확인한다. service_role/postgres로 성공한 것은 RLS 검증이 아니므로
--       plans_verify.sql과 동일하게 `set local role authenticated` +
--       request.jwt.claims 아래에서 돈다.
--
-- 실행 조건 (plans_verify.sql과 동일)
--   - Supabase Studio SQL 편집기(postgres 역할) 또는 postgres 역할 psql.
--   - 아래 "테스트 계정"의 두 값을 테스트 전용 계정 UUID로 반드시 바꾼다.
--     실제 사용 중인 계정을 넣지 않는다. 계정 UUID는 이 파일에 저장해
--     두지 말고 실행 시에만 넣는다.
--   - 만드는 행은 전부 이 트랜잭션 안에서만 존재하고 마지막 ROLLBACK으로
--     사라진다.
--   - 어떤 검증이라도 실패하면 RAISE EXCEPTION으로 즉시 멈추고 트랜잭션
--     전체가 롤백된다. 메시지의 "FAIL:" 항목을 본다.
--   - 성공하면 NOTICE로 "OK: ..." 줄이 순서대로 찍히고 마지막에 롤백된다.
--
-- 실행 방법: 파일 전체를 한 번에 실행한다(BEGIN ~ ROLLBACK이 한 묶음).
-- ============================================================================

begin;

-- ---------------------------------------------------------------- 테스트 계정 (반드시 수정)
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
declare ins text;
begin
  if to_regclass('public.user_policy_consents') is null then
    raise exception 'FAIL: public.user_policy_consents가 없습니다(마이그레이션 미적용).';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.user_policy_consents'::regclass and relrowsecurity) then
    raise exception 'FAIL: user_policy_consents에 RLS가 켜져 있지 않습니다.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_policy_consents') <> 2 then
    raise exception 'FAIL: user_policy_consents 정책이 2개(select/insert 본인 행)가 아닙니다.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_policy_consents'
               and cmd in ('UPDATE', 'DELETE')) then
    raise exception 'FAIL: update/delete 정책이 존재합니다(만들지 않아야 함).';
  end if;

  -- 컬럼 단위 INSERT 권한: 클라이언트가 실제로 보내는 컬럼과 정확히 일치해야
  -- 하고, id/accepted_at은 절대 포함되면 안 된다. 권한이 하나도 없으면
  -- string_agg가 NULL이라 <> 비교는 통과해 버린다 → IS DISTINCT FROM.
  select string_agg(column_name::text, ',' order by column_name::text) into ins
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'user_policy_consents'
     and grantee = 'authenticated' and privilege_type = 'INSERT';
  if ins is distinct from 'privacy_version,source,terms_version,user_id' then
    raise exception 'FAIL: authenticated INSERT 컬럼 권한이 예상과 다릅니다(현재: %). id/accepted_at 포함 여부를 확인하세요.', coalesce(ins, '없음');
  end if;

  -- 테이블 단위 INSERT/UPDATE/DELETE 권한이 남아 있지 않아야 한다(요구사항 6 —
  -- "테이블 단위 INSERT를 남겨둔 채 컬럼 권한만 추가"하는 실수 검출).
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'user_policy_consents'
       and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: authenticated에게 테이블 단위 INSERT/UPDATE/DELETE 권한이 남아 있습니다.';
  end if;
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'user_policy_consents'
       and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: authenticated에게 컬럼 단위 UPDATE/DELETE 권한이 남아 있습니다.';
  end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'user_policy_consents' and grantee in ('anon', 'PUBLIC'))
     or exists (select 1 from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'user_policy_consents' and grantee in ('anon', 'PUBLIC')) then
    raise exception 'FAIL: anon 또는 PUBLIC에 user_policy_consents 권한이 남아 있습니다.';
  end if;

  raise notice 'OK: 구조 · RLS on · 정책 2개(update/delete 없음) · INSERT 컬럼 권한 = 클라이언트 payload(id/accepted_at 제외) · 테이블 단위 insert/update/delete 없음 · anon/PUBLIC 권한 없음';
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
  r record; n int;
begin
  if current_user::text is distinct from 'authenticated' then
    raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%).', current_user;
  end if;
  if auth.uid() is distinct from a then raise exception 'FAIL: auth.uid()가 사용자 A가 아닙니다(NULL 포함).'; end if;

  -- 클라이언트 insert와 동일한 컬럼만 보낸다 + RETURNING(=PostgREST .select())
  insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
  values (a, '2026-09-18', 'v1.0', 'email_signup')
  returning * into r;
  get diagnostics n = row_count;
  if n is distinct from 1 or r.id is null then raise exception 'FAIL: A insert가 1행을 만들지 못했습니다.'; end if;
  if r.accepted_at is null or r.accepted_at is distinct from now() then
    raise exception 'FAIL: accepted_at이 서버 now()로 채워지지 않았습니다.';
  end if;
  perform set_config('v.consent_a_id', r.id::text, true);
  raise notice 'OK: A insert + returning(accepted_at = 서버 now(), id 자동 생성) · 테스트 행 id 보관';

  -- 재조회로 존재 확인(app.js가 insert 후 반드시 다시 하는 검증과 동일한 필터)
  if (select count(*) from public.user_policy_consents where user_id = a and terms_version = '2026-09-18' and privacy_version = 'v1.0') <> 1 then
    raise exception 'FAIL: user_id+버전 조회가 본인 행을 돌려주지 않습니다.';
  end if;

  -- 같은 (user_id, terms_version, privacy_version) 재시도 → unique_violation(23505)
  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values (a, '2026-09-18', 'v1.0', 'existing_user_gate');
    raise exception 'FAIL: 같은 (user_id, terms_version, privacy_version) 재insert가 허용됐습니다.';
  exception when unique_violation then raise notice 'OK: 중복 (user_id, 버전) → 23505';
  end;

  -- 다른 사용자 소유로 insert 시도 → RLS with check 위반
  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values (b, '2026-09-18', 'v1.0', 'email_signup');
    raise exception 'FAIL: 다른 사용자 user_id로 insert가 허용됐습니다.';
  exception when insufficient_privilege then raise notice 'OK: 타인 소유 insert → RLS 거부';
  end;

  -- accepted_at을 클라이언트가 직접 지정 → 컬럼 권한 없음으로 거부
  begin
    execute 'insert into public.user_policy_consents (user_id, terms_version, privacy_version, source, accepted_at) values ($1,$2,$3,$4,$5)'
      using a, '2026-09-18', 'v1.0-dup', 'email_signup', now() - interval '10 years';
    raise exception 'FAIL: accepted_at을 클라이언트가 지정하는 insert가 허용됐습니다.';
  exception when insufficient_privilege then raise notice 'OK: accepted_at 클라이언트 지정 거부';
  end;

  -- id를 클라이언트가 직접 지정 → 컬럼 권한 없음으로 거부
  begin
    execute 'insert into public.user_policy_consents (id, user_id, terms_version, privacy_version, source) values ($1,$2,$3,$4,$5)'
      using gen_random_uuid(), a, '2026-09-18', 'v1.0-dup2', 'email_signup';
    raise exception 'FAIL: id를 클라이언트가 지정하는 insert가 허용됐습니다.';
  exception when insufficient_privilege then raise notice 'OK: id 클라이언트 지정 거부';
  end;

  -- source 허용값 밖 → CHECK
  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values (a, '2026-09-18', 'v1.0-dup3', 'kakao_oauth');
    raise exception 'FAIL: 허용되지 않은 source가 통과했습니다.';
  exception when check_violation then raise notice 'OK: source 허용값 CHECK';
  end;

  -- terms_version/privacy_version NULL → NOT NULL 위반
  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values (a, null, 'v1.0-dup4', 'email_signup');
    raise exception 'FAIL: terms_version NULL이 통과했습니다.';
  exception when not_null_violation then raise notice 'OK: terms_version NOT NULL';
  end;
  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values (a, '2026-09-18-dup5', null, 'email_signup');
    raise exception 'FAIL: privacy_version NULL이 통과했습니다.';
  exception when not_null_violation then raise notice 'OK: privacy_version NOT NULL';
  end;

  -- UPDATE/DELETE — authenticated는 자신의 행조차 못 고치고 못 지운다(GRANT 자체 없음)
  begin
    update public.user_policy_consents set source = 'google_oauth' where id = current_setting('v.consent_a_id', true)::uuid;
    raise exception 'FAIL: authenticated가 자신의 동의 행을 UPDATE할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: 본인 행 UPDATE도 거부(권한 자체 없음)';
  end;
  begin
    delete from public.user_policy_consents where id = current_setting('v.consent_a_id', true)::uuid;
    raise exception 'FAIL: authenticated가 자신의 동의 행을 DELETE할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: 본인 행 DELETE도 거부(권한 자체 없음)';
  end;
end $$;

-- ---------------------------------------------------------------- 2) 사용자 B — A의 행 접근 차단
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_b', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_b', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  a uuid := current_setting('v.user_a', true)::uuid;
  b uuid := current_setting('v.user_b', true)::uuid;
  cid uuid := current_setting('v.consent_a_id', true)::uuid;
begin
  if current_user::text is distinct from 'authenticated' then raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%).', current_user; end if;
  if auth.uid() is distinct from b then raise exception 'FAIL: auth.uid()가 사용자 B가 아닙니다(NULL 포함).'; end if;

  if (select count(*) from public.user_policy_consents where id = cid) <> 0 then
    raise exception 'FAIL: B가 A의 동의 행을 id로 조회할 수 있습니다.';
  end if;
  if (select count(*) from public.user_policy_consents where user_id = a) <> 0 then
    raise exception 'FAIL: B가 A의 동의 행을 user_id로 조회할 수 있습니다.';
  end if;

  -- UPDATE 권한 자체가 없으므로(마이그레이션에서 GRANT를 아예 주지 않음)
  -- 이 문장은 RLS로 0행이 되는 게 아니라 실행 자체가 insufficient_privilege로
  -- 거부돼야 한다 — get diagnostics로 행수를 재는 방식은 이 예외가 DO 블록
  -- 전체를 중단시켜 이후 검증(INSERT 시도·최종 NOTICE)이 실행되지 않게
  -- 만들므로 begin/exception으로 감싼다(사용자 A 블록과 동일한 패턴).
  begin
    update public.user_policy_consents set source = 'google_oauth' where id = cid;
    raise exception 'FAIL: B가 A의 동의 행을 UPDATE할 수 있습니다(권한 자체가 없어야 함).';
  exception when insufficient_privilege then raise notice 'OK: B의 UPDATE 권한 없음';
  end;

  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values (a, '2026-09-18', 'v1.0-b-attempt', 'email_signup');
    raise exception 'FAIL: B가 A 소유로 insert할 수 있습니다.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK: B는 A의 동의 행을 조회·수정할 수 없고(0행) A 소유로 insert도 못 함';
end $$;

-- ---------------------------------------------------------------- 3) anon — 아무 것도 못 함
set local role anon;
do $$
begin
  begin
    perform count(*) from public.user_policy_consents;
    raise exception 'FAIL: anon이 user_policy_consents를 조회할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: anon SELECT 거부';
  end;
  begin
    insert into public.user_policy_consents (user_id, terms_version, privacy_version, source)
    values ('00000000-0000-0000-0000-000000000000', '2026-09-18', 'v1.0', 'email_signup');
    raise exception 'FAIL: anon이 insert할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: anon INSERT 거부';
  end;
end $$;

reset role;
do $$ begin raise notice 'OK: 모든 검증 통과 — 아래 ROLLBACK으로 테스트 행 전부 제거'; end $$;

rollback;
