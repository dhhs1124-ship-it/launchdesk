-- ============================================================================
-- submit_setup_inquiry 동의 버전 v1.1 갱신 검증 —
-- 20260922100000_setup_inquiries_privacy_v1_1.sql 적용 "후" 실제 DB에서 실행
-- ============================================================================
-- setup_inquiries_consent_rpc_verify.sql이 이미 시그니처·SECURITY DEFINER·
-- search_path·권한·제약을 전부 검증했으므로(이번 마이그레이션은 그중
-- 아무것도 바꾸지 않음), 이 파일은 "버전 드리프트" 하나만 좁게 확인한다:
--   1) 함수 정의 원문에 서버 상수로 'v1.1'이 박혀 있고 'v1.0'은 남아있지
--      않은지(정의 원문 자체를 읽는다 — 실행 없이도 확인 가능)
--   2) 실제로 함수를 호출했을 때 저장되는 privacy_consent_version이
--      정확히 'v1.1'인지(클라이언트가 무엇을 보내려 해도 이 값을 지정할
--      방법이 없다는 것은 기존 verify 파일에서 이미 확인함 — 여기서는
--      "그 고정된 값 자체가 최신 버전인지"만 본다)
--
-- 실행 조건: setup_inquiries_consent_rpc_verify.sql과 동일
--   - Supabase Studio SQL 편집기(postgres 역할) 또는 postgres 역할 psql.
--   - 아래 테스트 계정에 테스트 전용 UUID를 넣는다(실제 사용 계정 금지).
--   - 이 트랜잭션이 만든 행은 마지막 ROLLBACK으로 전부 사라진다.
--
-- 실행 방법: 파일 전체를 한 번에 실행한다(BEGIN ~ ROLLBACK이 한 묶음).
-- ============================================================================

begin;

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
end $$;

select set_config('v.marker', 'W' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), true);

-- ---------------------------------------------------------------- 0) 함수 정의 원문 검사(postgres)
do $$
declare
  fn_oid oid;
  def text;
begin
  fn_oid := to_regprocedure('public.submit_setup_inquiry(text, text, text, text, text, boolean)');
  if fn_oid is null then
    raise exception 'FAIL: submit_setup_inquiry(6개 인자)가 없습니다(선행 마이그레이션 미적용).';
  end if;

  def := pg_get_functiondef(fn_oid);

  if def !~ '''v1\.1''' then
    raise exception 'FAIL: 함수 정의에 서버 상수 v1.1이 없습니다 — v1.1 마이그레이션이 적용되지 않았을 수 있습니다.';
  end if;
  if def ~ '''v1\.0''' then
    raise exception 'FAIL: 함수 정의에 예전 서버 상수 v1.0이 여전히 남아 있습니다(부분 적용/롤백 의심).';
  end if;
  raise notice 'OK: 함수 정의 원문 — v_consent_version 상수가 v1.1로만 존재';
end $$;

-- ---------------------------------------------------------------- 1) 실제 호출 결과 검증
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  m text := current_setting('v.marker', true);
  new_id uuid;
begin
  select public.submit_setup_inquiry('basic', 'v1.1-drift-check', m, null, null, true) into new_id;
  if new_id is null then raise exception 'FAIL: 정상 제출이 id를 반환하지 않았습니다.'; end if;
  perform set_config('v.new_inquiry_id', new_id::text, true);
end $$;

reset role;
do $$
declare
  row_ver text;
begin
  select privacy_consent_version into row_ver
    from public.setup_inquiries
   where id = current_setting('v.new_inquiry_id', true)::uuid;

  if row_ver is distinct from 'v1.1' then
    raise exception 'FAIL: 새로 저장된 privacy_consent_version이 v1.1이 아닙니다(%).', coalesce(row_ver, 'NULL');
  end if;
  raise notice 'OK: 새로 제출된 행의 privacy_consent_version = v1.1';
end $$;

select 'PASS: submit_setup_inquiry 동의 버전이 v1.1로 갱신됨(v1.0 잔존 없음) — 테스트 행은 마지막 ROLLBACK으로 제거' AS verification_result;

rollback;
