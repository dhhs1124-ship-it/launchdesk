-- 읽기 전용 — submit_setup_inquiry가 원격 DB에 실제로 어떤 동의 버전 상수를
-- 저장하도록 배포돼 있는지 확인한다. 과거 마이그레이션 파일의 주석(예:
-- "아직 적용되지 않았다")은 파일이 쓰인 시점의 기록일 뿐 실제 원격 상태를
-- 보장하지 않으므로, 여기서는 마이그레이션 파일을 전혀 읽지 않고 원격에
-- 실제로 존재하는 함수 정의(pg_get_functiondef)만 읽는다. 함수를 호출하지
-- 않고, 데이터도 조회하지 않는다 — 순수 메타데이터 SELECT뿐이라 이 쿼리
-- 자체를 실행해도 아무것도 만들거나 바꾸지 않는다.

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  -- 함수 정의 원문에서 "v_consent_version constant text := '실제값'" 부분만
  -- 정규식으로 뽑아낸다 — 값을 직접 눈으로 확인할 수 있다.
  substring(
    pg_get_functiondef(p.oid)
    from 'v_consent_version\s+constant\s+text\s*:=\s*''([^'']+)'''
  ) as actual_consent_version_in_remote_function,
  -- 참고용 — 정의 원문에 v1.0/v1.1/v1.2 문자열이 몇 번씩 등장하는지(부분
  -- 적용·오버로드로 옛 상수가 섞여 남아있는지 눈으로 다시 확인할 때 씀).
  (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '''v1\.0''', 'g')) as v1_0_literal_count,
  (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '''v1\.1''', 'g')) as v1_1_literal_count,
  (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '''v1\.2''', 'g')) as v1_2_literal_count,
  (select count(*) from regexp_matches(pg_get_functiondef(p.oid), '''v1\.3''', 'g')) as v1_3_literal_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_setup_inquiry';

-- ── 결과 해석 ────────────────────────────────────────────────────────────
-- 0행 → submit_setup_inquiry 자체가 원격에 없음(선행 마이그레이션
--   20260918120000_setup_inquiries_consent_rpc.sql부터 미적용 상태) — 이
--   경우 "v1.1 마이그레이션이 아직 적용되지 않았다"는 파일 주석과 별개로,
--   더 근본적으로 세팅 대행 문의 기능 자체가 아직 배포되지 않은 것이므로
--   먼저 그 마이그레이션부터 적용 여부를 확인할 것.
--
-- 1행 이상 → 함수는 존재. actual_consent_version_in_remote_function 값이:
--   'v1.0' 이면 → 20260922100000_setup_inquiries_privacy_v1_1.sql이 아직
--     적용되지 않은 상태(주석과 일치). v1.2로 가려면 v1.1을 거칠지, v1.0→v1.2로
--     바로 갈 새 마이그레이션을 만들지 운영자가 결정.
--   'v1.1' 이면 → 이미 적용된 상태. v1.2로 가려면 새 마이그레이션(v1.1→v1.2)만
--     추가하면 됨.
--   NULL(값을 못 찾음) 이면 → 함수는 있는데 예상한 변수명·형태가 다르다는
--     뜻 — 누군가 수동으로 다르게 수정했을 수 있으니 실제 정의 원문을
--     따로 열어(`select pg_get_functiondef(oid) from pg_proc where proname='submit_setup_inquiry'`)
--     직접 확인할 것.
-- v1_0_literal_count·v1_1_literal_count·v1_2_literal_count 중 두 개 이상이
--   0이 아니면 → 여러 버전 문자열이 정의 원문에 동시에 남아 있다는 뜻(예:
--   주석에 예전 버전 언급이 남아있는 경우 포함) — actual_consent_version_in_remote_function
--   값이 실제로 코드가 사용하는 값이 맞는지 정의 원문을 직접 열어 재확인할 것.
