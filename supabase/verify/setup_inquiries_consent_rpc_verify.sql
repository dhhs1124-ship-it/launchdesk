-- ============================================================================
-- setup_inquiries 동의 컬럼 + submit_setup_inquiry RPC 검증 —
-- 20260918120000_setup_inquiries_consent_rpc.sql 적용 "후" 실제 DB에서 실행
-- ============================================================================
-- [2026-09-18 보안 수정 반영] submit_setup_inquiry가 privacy_consent_version을
-- 클라이언트 인자로 받던 7개 인자 시그니처를 버리고, 동의 버전을 함수 안의
-- 서버 상수(v1.0)로만 고정하는 6개 인자 시그니처로 바뀌었다. 이 파일도 그에
-- 맞춰 전면 갱신한다 — 옛 7개 인자 시그니처가 남아 있지 않은지, 새 함수가
-- 동의 버전을 인자로 받지 않는지, 저장되는 버전이 항상 서버 상수인지를
-- 새로 검증한다.
--
-- 목적
--   1) direct INSERT가 anon/authenticated 모두에게 거부되는지
--   2) RPC를 통한 비로그인(anon) 신청이 가능하고 user_id가 NULL로 저장되는지
--   3) 로그인(authenticated) 신청 시 user_id가 auth.uid()로 고정되는지
--      (RPC에 user_id 인자 자체가 없어 스푸핑 자체가 불가능함을 함께 확인)
--   4) status가 항상 'pending'으로 고정되는지
--   5) admin_note를 호출자가 주입할 방법이 없는지(함수 시그니처에 그
--      인자가 없어 존재하지 않는 인자로 호출 시 자체가 실패해야 함)
--   6) 잘못된 plan_id가 INVALID_PLAN으로 거부되는지
--   7) plan_id별 서버 가격(79,000 / 129,000 / 189,000)이 정확히 저장되는지
--   8) RPC 호출자가 동의 버전을 지정할 수 없는지(p_privacy_consent_version
--      인자로 호출하면 그런 매개변수가 없어 실패해야 함)
--   9) 저장된 privacy_consent_version이 호출자가 뭘 보내려 했든 항상
--      서버 상수 'v1.0'이고, privacy_consent_at이 서버 now()로 저장되는지
--   10) 동의(p_privacy_consent)가 없으면 CONSENT_REQUIRED로 거부되는지
--   11) 옛 7개 인자 시그니처(text,text,text,text,text,boolean,text)가
--       존재하지 않는지
--   12) 새 6개 인자 함수에 PUBLIC 실행 권한이 없고 anon/authenticated만
--       실행 가능한지
--   13) 동의 증빙 두 컬럼의 정합성 CHECK 제약(둘 다 NULL 또는 둘 다 값)이
--       존재하는지
--   14) 관리자 조회/상태 변경(set_setup_inquiry_status) 기능이 그대로인지
--
-- 실행 조건 (plan_product_events_verify.sql과 동일 방식)
--   - Supabase Studio SQL 편집기(postgres 역할) 또는 postgres 역할 psql.
--   - 아래 "테스트 계정"에 테스트 전용 계정 UUID를 반드시 넣는다. 실제 사용
--     중인 계정을 넣지 않는다. UUID는 이 파일에 저장해 두지 말고 실행 시에만
--     넣는다.
--   - 이 트랜잭션 안에서 만든 행은 이번 실행 전용 마커(phone 컬럼에 실린
--     무작위 접두사)로만 조회하고, 마지막 ROLLBACK으로 전부 사라진다.
--   - 어떤 검증이라도 실패하면 RAISE EXCEPTION으로 즉시 멈추고 트랜잭션
--     전체가 롤백된다. 메시지의 "FAIL:" 항목을 본다.
--
-- 실행 방법: 파일 전체를 한 번에 실행한다(BEGIN ~ ROLLBACK이 한 묶음).
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

-- 이번 실행 전용 마커 — phone 컬럼에 실어 이번 트랜잭션이 만든 행만 정확히
-- 골라낸다(다른 실행/실제 데이터와 섞이지 않게). RPC의 phone 최대 길이(30자)
-- 안에 들어가야 하므로 짧게 만든다("V" + 임의 8자 = 9자).
select set_config('v.marker', 'V' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), true);

-- ---------------------------------------------------------------- 0) 구조 확인 (postgres)
do $$
declare
  fn_oid oid;
  old_fn_oid oid;
  p record;
  cfg text;
  ins_cnt int;
  pair_def text;
begin
  if to_regclass('public.setup_inquiries') is null then
    raise exception 'FAIL: setup_inquiries가 없습니다(선행 마이그레이션 미적용).';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'setup_inquiries' and column_name = 'privacy_consent_version'
  ) then
    raise exception 'FAIL: privacy_consent_version 컬럼이 없습니다.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'setup_inquiries' and column_name = 'privacy_consent_at'
  ) then
    raise exception 'FAIL: privacy_consent_at 컬럼이 없습니다.';
  end if;

  -- 11) 옛 7개 인자 시그니처(동의 버전을 클라이언트 인자로 받던 버전)가
  -- 남아 있으면 안 된다 — 남아 있으면 그 시그니처로 여전히 버전을 조작한
  -- 값을 넣을 수 있으므로 이 자체가 보안 실패다.
  old_fn_oid := to_regprocedure('public.submit_setup_inquiry(text, text, text, text, text, boolean, text)');
  if old_fn_oid is not null then
    raise exception 'FAIL: 옛 7개 인자 시그니처(동의 버전을 인자로 받는 버전)가 아직 존재합니다(oid=%).', old_fn_oid;
  end if;
  raise notice 'OK: 옛 7개 인자 시그니처 없음';

  -- 새 6개 인자 시그니처(동의 버전 인자 없음)만 존재해야 한다.
  fn_oid := to_regprocedure('public.submit_setup_inquiry(text, text, text, text, text, boolean)');
  if fn_oid is null then raise exception 'FAIL: 새 6개 인자 submit_setup_inquiry 시그니처가 없습니다.'; end if;

  select prosecdef, proconfig, prorettype::regtype::text as ret into p from pg_proc where oid = fn_oid;
  if p.prosecdef is distinct from true then raise exception 'FAIL: SECURITY DEFINER가 아닙니다.'; end if;
  if p.ret is distinct from 'uuid' then raise exception 'FAIL: 반환형이 uuid가 아닙니다(%).', coalesce(p.ret, 'NULL'); end if;

  -- search_path = ''(완전히 빈 값)로 고정되어 있어야 한다(요구사항 4 —
  -- 기존 'public, pg_temp'보다 더 엄격한 값). proconfig 원소는
  -- "search_path=<값>" 형태 문자열인데, 빈 문자열 값이 PostgreSQL 버전에
  -- 따라 search_path= 로 나올 수도, search_path="" 로 나올 수도 있어(둘 중
  -- 어느 쪽인지 이 저장소에는 로컬 Postgres가 없어 직접 확인하지 못했다),
  -- "=" 뒤의 값에서 큰따옴표를 걷어낸 뒤 빈 문자열인지로 판정해 두 표기
  -- 모두를 통과시킨다(값 자체가 비어 있다는 사실만 확인하면 충분하다).
  select e into cfg from unnest(p.proconfig) as e where e like 'search_path=%' limit 1;
  if cfg is null then
    raise exception 'FAIL: 함수에 search_path 설정이 전혀 없습니다(proconfig=%).', coalesce(array_to_string(p.proconfig, ','), '없음');
  end if;
  if trim(both '"' from substring(cfg from 13)) <> '' then
    raise exception 'FAIL: search_path 값이 빈 문자열이 아닙니다(%).', cfg;
  end if;
  raise notice 'OK: search_path = ''''(빈 값)로 고정 — %', cfg;

  if not has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'FAIL: anon에 RPC 실행 권한이 없습니다.';
  end if;
  if not has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'FAIL: authenticated에 RPC 실행 권한이 없습니다.';
  end if;
  -- 12) PUBLIC 실행 권한이 남아 있으면 안 된다(anon/authenticated 외 모든
  -- 역할이 이 함수를 실행할 수 있게 되므로 최소권한 원칙 위반).
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'submit_setup_inquiry' and grantee = 'PUBLIC'
  ) then
    raise exception 'FAIL: submit_setup_inquiry에 PUBLIC 실행 권한이 남아 있습니다.';
  end if;
  raise notice 'OK: 새 함수 권한 — anon/authenticated만 실행 가능, PUBLIC 없음';

  -- 테이블 직접 INSERT 권한이 anon/authenticated 어느 쪽에도 남아있지 않아야 한다.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'setup_inquiries'
       and grantee in ('anon', 'authenticated') and privilege_type = 'INSERT'
  ) then
    raise exception 'FAIL: anon/authenticated에게 setup_inquiries 테이블 직접 INSERT 권한이 남아 있습니다.';
  end if;

  -- INSERT 정책이 완전히 제거되어야 한다(SELECT 정책만 남아야 함).
  select count(*) into ins_cnt from pg_policies
   where schemaname = 'public' and tablename = 'setup_inquiries' and cmd = 'INSERT';
  if ins_cnt <> 0 then raise exception 'FAIL: setup_inquiries에 INSERT 정책이 아직 %개 남아 있습니다.', ins_cnt; end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'setup_inquiries' and policyname = 'setup_inquiries_select_admin'
  ) then
    raise exception 'FAIL: 관리자 SELECT 정책(setup_inquiries_select_admin)이 사라졌습니다 — 기존 관리자 조회 기능이 깨집니다.';
  end if;

  if to_regprocedure('public.set_setup_inquiry_status(uuid, text, text)') is null then
    raise exception 'FAIL: set_setup_inquiry_status RPC가 사라졌습니다 — 기존 관리자 상태 변경 기능이 깨집니다.';
  end if;

  -- 13) 동의 증빙 두 컬럼의 정합성 CHECK 제약(둘 다 NULL 또는 둘 다 값)이
  -- 존재해야 한다.
  select pg_get_constraintdef(oid) into pair_def from pg_constraint
   where conrelid = 'public.setup_inquiries'::regclass and conname = 'setup_inquiries_privacy_consent_pair';
  if not found or pair_def is null then
    raise exception 'FAIL: setup_inquiries_privacy_consent_pair 제약이 없습니다.';
  end if;
  raise notice 'OK: 동의 증빙 정합성 제약 존재 — %', pair_def;

  raise notice 'OK: 컬럼 2개 · 새 RPC 시그니처(6개 인자)·SECURITY DEFINER·search_path='''' · 테이블 직접 INSERT 권한 없음 · INSERT 정책 0개 · 관리자 SELECT 정책/상태변경 RPC 보존';
end $$;

-- ---------------------------------------------------------------- 1) anon — direct insert 거부 + RPC 동작
set local role anon;
do $$
declare
  m text := current_setting('v.marker', true);
  new_id uuid;
begin
  -- 1-1) 직접 INSERT는 거부되어야 한다.
  begin
    insert into public.setup_inquiries (plan_key, plan_name, plan_price, name, phone)
    values ('basic', '기본 쇼핑몰 세팅', 79000, 'anon-direct', m);
    raise exception 'FAIL: anon이 setup_inquiries에 직접 INSERT할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: anon 직접 INSERT 거부';
  end;

  -- 1-2) 동의 없이 RPC 호출(새 6개 인자 시그니처) → CONSENT_REQUIRED
  begin
    perform public.submit_setup_inquiry('basic', 'anon-no-consent', m, null, null, false);
    raise exception 'FAIL: 동의 없는 anon RPC 호출이 허용됐습니다.';
  exception when raise_exception then
    if sqlerrm is distinct from 'CONSENT_REQUIRED' then raise; end if;
    raise notice 'OK: 동의 없음 → CONSENT_REQUIRED';
  end;

  -- 1-3) 잘못된 plan_id → INVALID_PLAN
  begin
    perform public.submit_setup_inquiry('enterprise', 'anon-bad-plan', m, null, null, true);
    raise exception 'FAIL: 잘못된 plan_id가 허용됐습니다.';
  exception when raise_exception then
    if sqlerrm is distinct from 'INVALID_PLAN' then raise; end if;
    raise notice 'OK: 잘못된 plan_id → INVALID_PLAN';
  end;

  -- 1-4) 동의 버전을 인자로 주입 시도 → 그런 매개변수가 없으므로 함수
  -- 자체를 찾지 못해 실패해야 한다(undefined_function). 이 문장이 이
  -- DO 블록 안에서 처음 실행되는 시점에야 파싱/바인딩되므로(plpgsql의
  -- 문장 단위 지연 파싱), 아래 exception 절이 정상적으로 잡아낸다.
  begin
    perform public.submit_setup_inquiry(
      p_plan_id => 'basic', p_name => 'x', p_phone => 'x',
      p_privacy_consent => true, p_privacy_consent_version => 'v99.9-forged'
    );
    raise exception 'FAIL: p_privacy_consent_version을 인자로 주입하는 RPC 호출이 허용됐습니다.';
  exception when undefined_function then raise notice 'OK: 동의 버전 인자 주입 불가(그런 매개변수 없음 — 요구사항 8)';
  end;

  -- 1-5) 정상 호출(비로그인, 새 6개 인자 시그니처) — 성공해야 하고
  -- user_id는 NULL이어야 한다.
  select public.submit_setup_inquiry('basic', 'anon-ok', m, '카페24', '테스트 요청', true) into new_id;
  if new_id is null then raise exception 'FAIL: anon 정상 제출이 id를 반환하지 않았습니다.'; end if;
  perform set_config('v.anon_inquiry_id', new_id::text, true);
  raise notice 'OK: anon 비로그인 제출 성공(id 반환)';

  -- anon은 setup_inquiries SELECT 권한이 없으므로 결과를 여기서 직접
  -- 조회하지 않는다(원래도 못 봄 — 이후 postgres 블록에서 검증).
end $$;

-- ---------------------------------------------------------------- 2) authenticated(사용자 A) — direct insert 거부 + RPC 동작
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  m text := current_setting('v.marker', true);
  a uuid := current_setting('v.user_a', true)::uuid;
  new_id uuid;
begin
  if current_user::text is distinct from 'authenticated' then
    raise exception 'FAIL: 현재 역할이 authenticated가 아닙니다(%).', current_user;
  end if;
  if auth.uid() is distinct from a then raise exception 'FAIL: auth.uid()가 사용자 A가 아닙니다(NULL 포함).'; end if;

  -- 2-1) 직접 INSERT는 여전히 거부되어야 한다(로그인 여부와 무관).
  begin
    insert into public.setup_inquiries (user_id, plan_key, plan_name, plan_price, name, phone)
    values (a, 'basic', '기본 쇼핑몰 세팅', 79000, 'auth-direct', m);
    raise exception 'FAIL: authenticated가 setup_inquiries에 직접 INSERT할 수 있습니다.';
  exception when insufficient_privilege then raise notice 'OK: authenticated 직접 INSERT 거부';
  end;

  -- 2-2) admin_note를 함수 인자로 주입 시도 → 그런 인자가 없으므로 실패.
  begin
    perform public.submit_setup_inquiry(
      p_plan_id => 'basic', p_name => 'x', p_phone => 'x',
      p_privacy_consent => true, admin_note => 'injected'
    );
    raise exception 'FAIL: admin_note를 인자로 주입하는 RPC 호출이 허용됐습니다.';
  exception when undefined_function then raise notice 'OK: admin_note 인자 주입 불가(그런 매개변수 없음)';
  end;

  -- 2-3) 로그인 상태에서도 동의 버전 인자 주입은 거부되어야 한다.
  begin
    perform public.submit_setup_inquiry(
      p_plan_id => 'basic', p_name => 'x', p_phone => 'x',
      p_privacy_consent => true, p_privacy_consent_version => 'v99.9-forged'
    );
    raise exception 'FAIL: 로그인 상태에서 p_privacy_consent_version 주입이 허용됐습니다.';
  exception when undefined_function then raise notice 'OK: 로그인 상태에서도 동의 버전 인자 주입 불가';
  end;

  -- 2-4) 동의 없이 호출 → CONSENT_REQUIRED (로그인 상태에서도 동일)
  begin
    perform public.submit_setup_inquiry('integration', 'auth-no-consent', m, null, null, false);
    raise exception 'FAIL: 동의 없는 authenticated RPC 호출이 허용됐습니다.';
  exception when raise_exception then
    if sqlerrm is distinct from 'CONSENT_REQUIRED' then raise; end if;
    raise notice 'OK: 로그인 상태에서도 동의 없음 → CONSENT_REQUIRED';
  end;

  -- 2-5) 정상 호출(로그인) — user_id 인자가 아예 없으므로 auth.uid()로만
  -- 고정된다(스푸핑 시도 자체가 불가능 — 함수 시그니처에 user_id 인자가 없음).
  select public.submit_setup_inquiry('integration', 'auth-ok', m, '스마트스토어', '연동 요청', true) into new_id;
  if new_id is null then raise exception 'FAIL: authenticated 정상 제출이 id를 반환하지 않았습니다.'; end if;
  perform set_config('v.auth_inquiry_id', new_id::text, true);
  raise notice 'OK: authenticated 로그인 제출 성공(id 반환)';

  -- 2-6) full 플랜도 하나 더 제출해 가격 3종을 모두 검증할 수 있게 한다.
  select public.submit_setup_inquiry('full', 'auth-full', m, null, null, true) into new_id;
  perform set_config('v.auth_full_inquiry_id', new_id::text, true);
  raise notice 'OK: full 플랜 제출 성공';

  -- 2-7) authenticated도 setup_inquiries를 일반 SELECT로 조회할 수 없다
  -- (관리자만 — is_admin() 통과자만). 사용자 A는 관리자가 아니라고 가정한다.
  if not public.is_admin() then
    begin
      if (select count(*) from public.setup_inquiries where phone = m) <> 0 then
        raise exception 'FAIL: 관리자가 아닌 authenticated가 setup_inquiries 행을 조회할 수 있습니다.';
      end if;
      raise notice 'OK: 관리자가 아닌 authenticated는 SELECT해도 0행(RLS)';
    end;
  else
    raise notice 'SKIP: 테스트 계정 A가 관리자라 SELECT 차단 검증을 건너뜁니다(다른 계정으로 재검증 권장).';
  end if;
end $$;

-- ---------------------------------------------------------------- 3) postgres — 실제 저장된 값 검증
reset role;
do $$
declare
  m text := current_setting('v.marker', true);
  a uuid := current_setting('v.user_a', true)::uuid;
  anon_row public.setup_inquiries%rowtype;
  auth_row public.setup_inquiries%rowtype;
  full_row public.setup_inquiries%rowtype;
  n int;
begin
  select * into anon_row from public.setup_inquiries where id = current_setting('v.anon_inquiry_id', true)::uuid;
  select * into auth_row from public.setup_inquiries where id = current_setting('v.auth_inquiry_id', true)::uuid;
  select * into full_row from public.setup_inquiries where id = current_setting('v.auth_full_inquiry_id', true)::uuid;

  -- status는 항상 'pending' 고정.
  if anon_row.status is distinct from 'pending' or auth_row.status is distinct from 'pending' or full_row.status is distinct from 'pending' then
    raise exception 'FAIL: status가 pending으로 고정되지 않았습니다(anon=%, auth=%, full=%).', anon_row.status, auth_row.status, full_row.status;
  end if;
  raise notice 'OK: 세 건 모두 status = pending';

  -- user_id: 비로그인 제출은 NULL, 로그인 제출은 auth.uid()(=사용자 A)로 고정.
  if anon_row.user_id is not null then raise exception 'FAIL: anon 제출 행의 user_id가 NULL이 아닙니다(%).', anon_row.user_id; end if;
  if auth_row.user_id is distinct from a then raise exception 'FAIL: authenticated 제출 행의 user_id가 사용자 A가 아닙니다(%).', auth_row.user_id; end if;
  raise notice 'OK: user_id — 비로그인 NULL / 로그인 auth.uid() 고정';

  -- admin_note는 항상 NULL(호출자가 지정할 방법이 없었으므로).
  if anon_row.admin_note is not null or auth_row.admin_note is not null then
    raise exception 'FAIL: admin_note가 NULL이 아닌 값으로 채워졌습니다.';
  end if;
  raise notice 'OK: admin_note는 항상 NULL(주입 경로 없음)';

  -- 서버 가격 — plan_id별로 정확히 79,000 / 129,000 / 189,000이어야 한다.
  if anon_row.plan_price is distinct from 79000 or anon_row.plan_name is distinct from '기본 쇼핑몰 세팅' then
    raise exception 'FAIL: basic 플랜 서버 가격/이름이 다릅니다(price=%, name=%).', anon_row.plan_price, anon_row.plan_name;
  end if;
  if auth_row.plan_price is distinct from 129000 or auth_row.plan_name is distinct from '연동·추적 세팅' then
    raise exception 'FAIL: integration 플랜 서버 가격/이름이 다릅니다(price=%, name=%).', auth_row.plan_price, auth_row.plan_name;
  end if;
  if full_row.plan_price is distinct from 189000 or full_row.plan_name is distinct from '전체 초기 세팅' then
    raise exception 'FAIL: full 플랜 서버 가격/이름이 다릅니다(price=%, name=%).', full_row.plan_price, full_row.plan_name;
  end if;
  raise notice 'OK: 서버 가격 basic=79,000 / integration=129,000 / full=189,000 정확히 저장';

  -- 9) 동의 증빙 — 버전은 호출자가 무엇을 보내려 했든 항상 서버 상수
  -- 'v1.0'이어야 하고(클라이언트에게는 애초에 그 값을 지정할 방법이
  -- 없었다 — 위 1-4/2-3에서 이미 확인), 시각은 서버 now()로 저장되어야
  -- 한다. now()는 트랜잭션 내내 같은 값을 돌려주므로(트랜잭션 시작 시각
  -- 고정), 이 검증 시점의 now()와 정확히 같아야 한다.
  if anon_row.privacy_consent_version is distinct from 'v1.0' then
    raise exception 'FAIL: anon 제출 행의 동의 버전이 서버 상수(v1.0)가 아닙니다(%).', anon_row.privacy_consent_version;
  end if;
  if anon_row.privacy_consent_at is distinct from now() then
    raise exception 'FAIL: anon 제출 행의 동의 시각이 서버 now()가 아닙니다.';
  end if;
  if auth_row.privacy_consent_version is distinct from 'v1.0' then
    raise exception 'FAIL: authenticated 제출 행의 동의 버전이 서버 상수(v1.0)가 아닙니다(%).', auth_row.privacy_consent_version;
  end if;
  if auth_row.privacy_consent_at is distinct from now() then
    raise exception 'FAIL: authenticated 제출 행의 동의 시각이 서버 now()가 아닙니다.';
  end if;
  raise notice 'OK: privacy_consent_version은 항상 서버 상수 v1.0, privacy_consent_at은 서버 now()로 저장';

  -- 이번 실행 마커로 정확히 3건만 존재해야 한다(동의 거부/잘못된 plan_id/
  -- 인자 주입 시도는 전부 실패해 행을 남기지 않았어야 함).
  select count(*) into n from public.setup_inquiries where phone = m;
  if n <> 3 then
    raise exception 'FAIL: 이번 실행 마커로 조회되는 행이 3건이 아닙니다(%건) — 실패했어야 할 시도가 행을 남겼을 수 있습니다.', n;
  end if;
  raise notice 'OK: 이번 실행에서 성공했어야 할 제출만 정확히 3건 존재';

  -- 14) 관리자 상태 변경(set_setup_inquiry_status) 기능은 0) 구조 확인에서
  -- 시그니처 존재만 확인한다 — 실제 실행 테스트는 하지 않는다. 이 함수는
  -- 내부에서 is_admin()(auth.uid() 기준)을 재확인하는데, 이 트랜잭션에는
  -- "관리자로 확인된" 별도 테스트 계정이 없고(v.user_a는 일반 사용자로
  -- 가정 — 위 2-7 참고), reset role 이후에도 이전 authenticated 블록에서
  -- set_config(..., true)로 남긴 request.jwt.claim.sub가 트랜잭션 동안
  -- 유지되어 postgres 역할에서 호출해도 auth.uid()가 사용자 A로 남는다.
  -- 관리자 계정이 아닌 채로 호출하면 ADMIN_REQUIRED로 실패하는 게 오히려
  -- 정상 동작이므로, 여기서 "성공 호출"을 가정하는 테스트를 만들지 않는다
  -- (이번 작업(동의 버전 서버 고정)과 무관한 기능이라 이 파일이 원래
  -- 하던 대로 존재 확인 수준을 유지한다 — 요구사항 "검증 유지").
end $$;

select 'PASS: setup_inquiries 동의 컬럼 + submit_setup_inquiry RPC(6개 인자, 서버 고정 동의 버전) 검증 완료 — 테스트 행은 마지막 ROLLBACK으로 제거' AS verification_result;

rollback;
