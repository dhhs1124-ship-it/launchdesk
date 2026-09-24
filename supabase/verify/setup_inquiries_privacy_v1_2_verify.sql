-- ============================================================================
-- submit_setup_inquiry 동의 버전 v1.2 갱신 + 버전 불일치 차단 검증 —
-- 20260923170000_setup_inquiries_privacy_v1_2.sql 적용 "후" 실제 DB에서 실행
-- ============================================================================
-- ⚠️ 이 파일은 순수 읽기 전용(SELECT-only)이 아니다 — 실제로 INSERT를
-- 실행한다(setup_inquiries_privacy_v1_2_verify.sql이라는 이름 때문에
-- setup_inquiry_consent_version_check.sql·contact_inquiry_preflight_check.sql
-- 같은 "메타데이터만 읽는" 파일로 착각하기 쉬우므로 명시한다). 파일 전체가
-- BEGIN ~ ROLLBACK 한 트랜잭션으로 묶여 있어 커밋된 행은 하나도 남지
-- 않지만, 트랜잭션 도중에는 실제로:
--   - 실제 시퀀스/gen_random_uuid() 채번이 일어나고,
--   - setup_inquiries 테이블에 실제 INSERT 문이 실행되며(그 직후
--     ROLLBACK되기 전까지는 이 세션 안에서 실제로 존재하는 행이다),
--   - 만약 이 테이블에 INSERT 트리거·웹훅(예: Supabase Database
--     Webhooks, 감사 로그 트리거)이 걸려 있다면 그 부수 효과도 함께
--     실행된다 — ROLLBACK은 테이블 행 자체만 되돌릴 뿐, 트랜잭션 밖으로
--     이미 나간 부수 효과(예: 외부로 나간 웹훅 HTTP 요청)까지 취소하지
--     않는다.
-- 따라서 이 파일은 "읽기 전용이니 아무 때나 실행해도 안전"이 아니라
-- "테스트 계정으로 실제 신청을 넣었다가 지우는 검증"으로 취급할 것 —
-- 운영 알림·웹훅이 연결된 환경에서는 실행 전에 그 경로에 미칠 영향을
-- 먼저 확인한다.
--
-- 확인 범위:
--   0) 함수 정의 원문 — 새 7개 인자 시그니처에 서버 상수 'v1.2'만 있고
--      'v1.0'/'v1.1'은 없는지. 그리고 옛 6개 인자 시그니처가 실제로
--      DROP되어 더 이상 존재하지 않는지(오버로드로 남아있으면 구버전
--      클라이언트가 버전 검사를 완전히 우회할 수 있으므로 이 확인이
--      핵심이다).
--   1) 버전 불일치 차단이 실제로 동작하는지 — 아래 세 가지 "실패해야
--      정상"인 호출이 전부 거부되고, 그중 단 한 건도 setup_inquiries에
--      행을 남기지 않는지:
--        1-1) p_expected_privacy_version을 아예 안 보냄(기본값 null —
--             구버전 클라이언트가 이 인자를 모르는 상황을 흉내)
--        1-2) p_expected_privacy_version = 'v1.1'(웹은 새 버전을 보여주고
--             있다고 믿지만 실제로는 옛 버전을 보낸 경우 — 또는 그 반대,
--             RPC가 아직 안 올라간 상태에서 신버전 웹이 부르는 경우와
--             증상은 동일)
--        1-3) 옛 6개 인자 시그니처로 직접 호출(그런 함수가 더 이상 없어야
--             한다 — undefined_function)
--   2) 정상 호출(p_expected_privacy_version = 'v1.2')은 성공하고, 저장되는
--      privacy_consent_version이 정확히 'v1.2'인지 — 그리고
--      p_expected_privacy_version 값 자체는 저장에 쓰이지 않는지(서버
--      상수만 저장한다는 2026-09-18 보안 수정 원칙이 이번 변경으로
--      깨지지 않았는지).
--   3) 이번 트랜잭션에서 "성공했어야 할" 행이 정확히 1건뿐인지(1)의
--      세 실패 시도가 진짜로 아무 것도 남기지 않았다는 최종 확인).
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
  old_fn_oid oid;
  def text;
begin
  fn_oid := to_regprocedure('public.submit_setup_inquiry(text, text, text, text, text, boolean, text)');
  if fn_oid is null then
    raise exception 'FAIL: submit_setup_inquiry(7개 인자)가 없습니다(v1.2 마이그레이션 미적용).';
  end if;

  def := pg_get_functiondef(fn_oid);

  if def !~ '''v1\.2''' then
    raise exception 'FAIL: 함수 정의에 서버 상수 v1.2가 없습니다 — v1.2 마이그레이션이 적용되지 않았을 수 있습니다.';
  end if;
  if def ~ '''v1\.0''' then
    raise exception 'FAIL: 함수 정의에 예전 서버 상수 v1.0이 여전히 남아 있습니다(부분 적용/롤백 의심).';
  end if;
  if def ~ '''v1\.1''' then
    raise exception 'FAIL: 함수 정의에 예전 서버 상수 v1.1이 여전히 남아 있습니다(부분 적용/롤백 의심).';
  end if;
  raise notice 'OK: 함수 정의 원문 — v_consent_version 상수가 v1.2로만 존재';

  old_fn_oid := to_regprocedure('public.submit_setup_inquiry(text, text, text, text, text, boolean)');
  if old_fn_oid is not null then
    raise exception 'FAIL: 옛 6개 인자 시그니처가 여전히 존재합니다 — 구버전 클라이언트가 버전 검사 없이 이 함수를 호출할 수 있습니다(마이그레이션의 DROP FUNCTION이 적용되지 않았을 수 있음).';
  end if;
  raise notice 'OK: 옛 6개 인자 시그니처 없음(DROP 확인)';
end $$;

-- ---------------------------------------------------------------- 1) 버전 불일치 차단 + 2) 정상 호출(authenticated)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v.user_a', true), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('v.user_a', true), true),
       set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  m text := current_setting('v.marker', true);
  new_id uuid;
begin
  -- 1-1) p_expected_privacy_version을 안 보냄(기본값 null) → 구버전
  -- 클라이언트를 흉내 — 거부돼야 한다.
  begin
    perform public.submit_setup_inquiry('basic', 'v1.2-mismatch-null', m, null, null, true);
    raise exception 'FAIL: p_expected_privacy_version 없이(null) 호출한 RPC가 허용됐습니다.';
  exception when raise_exception then
    if sqlerrm is distinct from 'PRIVACY_VERSION_MISMATCH' then raise; end if;
    raise notice 'OK: p_expected_privacy_version 없음(null) → PRIVACY_VERSION_MISMATCH';
  end;

  -- 1-2) p_expected_privacy_version = 'v1.1'(어긋난 값) → 거부돼야 한다.
  begin
    perform public.submit_setup_inquiry(
      p_plan_id => 'basic', p_name => 'v1.2-mismatch-wrong', p_phone => m,
      p_privacy_consent => true, p_expected_privacy_version => 'v1.1'
    );
    raise exception 'FAIL: p_expected_privacy_version=v1.1로 호출한 RPC가 허용됐습니다.';
  exception when raise_exception then
    if sqlerrm is distinct from 'PRIVACY_VERSION_MISMATCH' then raise; end if;
    raise notice 'OK: p_expected_privacy_version=v1.1(불일치) → PRIVACY_VERSION_MISMATCH';
  end;

  -- 1-3) 옛 6개 인자 시그니처로 직접 호출 → 그런 함수가 더 이상 없어야
  -- 한다(0번 검사가 정적 확인이라면, 이건 "실제로 호출해도" 막히는지
  -- 동적으로 재확인).
  begin
    perform public.submit_setup_inquiry('basic', 'v1.2-old-signature', m, null, null, true);
    raise exception 'FAIL: 이 줄에 도달하면 안 됩니다 — 위 1-1과 같은 호출인데 다른 예외가 나야 정상입니다.';
  exception when raise_exception then
    -- 참고: PostgREST가 아니라 plpgsql perform 안에서 6개 인자로 부르면
    -- 새 시그니처(7번째 인자 default null)에 그대로 바인딩되므로 이 호출은
    -- 1-1과 동일하게 PRIVACY_VERSION_MISMATCH가 난다 — "함수를 못 찾는"
    -- 실패는 PostgREST(HTTP) 경로에서 인자 이름 집합이 달라졌을 때만
    -- 나타난다(예: 클라이언트가 여전히 p_expected_privacy_version 키 자체를
    -- 보내지 않는 구버전 JS로 호출하는 경우 — 이때도 결과적으로 기본값
    -- null이 적용되어 1-1과 같은 이유로 거부된다). 즉 SQL 레벨에서는
    -- "인자 개수"가 아니라 "값 불일치"가 최종 방어선이며, 이 테스트는 그
    -- 방어선이 이 경로에서도 동일하게 작동함을 재확인한다.
    if sqlerrm is distinct from 'PRIVACY_VERSION_MISMATCH' then raise; end if;
    raise notice 'OK: 옛 6개 인자 스타일 호출도 결국 PRIVACY_VERSION_MISMATCH로 거부(7번째 인자가 기본값 null로 채워짐)';
  end;

  -- 2) 정상 호출 — p_expected_privacy_version이 서버 상수와 일치하면 성공해야 한다.
  select public.submit_setup_inquiry(
    p_plan_id => 'basic', p_name => 'v1.2-drift-check', p_phone => m,
    p_privacy_consent => true, p_expected_privacy_version => 'v1.2'
  ) into new_id;
  if new_id is null then raise exception 'FAIL: 정상 제출(버전 일치)이 id를 반환하지 않았습니다.'; end if;
  perform set_config('v.new_inquiry_id', new_id::text, true);
  raise notice 'OK: p_expected_privacy_version=v1.2(일치) → 정상 접수';
end $$;

reset role;
do $$
declare
  row_ver text;
  total_rows int;
begin
  select privacy_consent_version into row_ver
    from public.setup_inquiries
   where id = current_setting('v.new_inquiry_id', true)::uuid;

  if row_ver is distinct from 'v1.2' then
    raise exception 'FAIL: 새로 저장된 privacy_consent_version이 v1.2가 아닙니다(%).', coalesce(row_ver, 'NULL');
  end if;
  raise notice 'OK: 새로 제출된 행의 privacy_consent_version = v1.2';

  -- 3) 이번 트랜잭션에서 이 마커로 실제로 존재하는 행이 "정상 호출 1건"뿐인지
  -- 최종 확인 — 위 1-1·1-2·1-3의 거부된 시도가 조금이라도 행을 남겼다면
  -- 여기서 2건 이상으로 걸린다.
  select count(*) into total_rows
    from public.setup_inquiries
   where phone = current_setting('v.marker', true);

  if total_rows is distinct from 1 then
    raise exception 'FAIL: 이 마커로 남은 행이 1건이 아니라 %건입니다 — 거부됐어야 할 시도가 실제로 행을 남겼을 수 있습니다.', total_rows;
  end if;
  raise notice 'OK: 거부된 3건(1-1·1-2·1-3)은 행을 남기지 않았고, 정상 접수 1건만 존재';
end $$;

select 'PASS: submit_setup_inquiry 동의 버전이 v1.2로 갱신되고(v1.0/v1.1 잔존 없음), 옛 6인자 시그니처는 제거됐으며, 버전 불일치 3종(null·오탑재값·구시그니처)이 전부 거부되어 행을 남기지 않음 — 테스트 행은 마지막 ROLLBACK으로 제거' AS verification_result;

rollback;
