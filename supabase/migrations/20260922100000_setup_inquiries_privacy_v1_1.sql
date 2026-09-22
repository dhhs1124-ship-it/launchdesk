-- LaunchDesk 개인정보처리방침 v1.0 → v1.1 개정에 따른 submit_setup_inquiry
-- 동의 버전 갱신.
--
-- 배경: 20260918120000_setup_inquiries_consent_rpc.sql이 만든
-- public.submit_setup_inquiry(text,text,text,text,text,boolean)는 함수 본문
-- 안의 서버 상수(v_consent_version)로만 동의 버전을 기록한다 — 클라이언트는
-- 이 값을 지정할 방법이 없다(함수 시그니처에 그 인자가 없음). 개인정보
-- 처리방침이 v1.1로 개정되면서(시행일 2026-09-22, Cafe24/Meta 연동·
-- ad_margin_links 반영), policy-consent-core.js의 PRIVACY_VERSION도
-- 'v1.0' → 'v1.1'로 함께 올렸다. 이 두 값은 서로 다른 저장소(JS 상수 vs
-- SQL 함수 상수)에 있어 자동으로 동기화되지 않으므로, 이 마이그레이션이
-- SQL 쪽 값을 같은 배포에서 맞춰 올린다.
--
-- 이 파일이 하는 일: CREATE OR REPLACE FUNCTION으로 함수 본문의
-- v_consent_version 상수만 'v1.0' → 'v1.1'로 바꾼다. 시그니처(인자 개수·
-- 타입·이름), SECURITY DEFINER, search_path='', 검증 로직, 플랜별 가격,
-- INSERT 대상 컬럼은 20260918120000_setup_inquiries_consent_rpc.sql과
-- 완전히 동일하게 유지한다 — 그 마이그레이션 파일 자체는 수정하지 않는다
-- (이미 원격에 적용됐을 수 있는 과거 마이그레이션이므로).
--
-- 과거 신청 행(이 마이그레이션 적용 전 제출분)의 privacy_consent_version은
-- 'v1.0'으로 남아 있으며, 이 마이그레이션은 과거 행을 소급 수정하지 않는다
-- (제출 당시 실제로 동의한 버전을 그대로 보존하는 것이 정확한 기록이다).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 개인정보처리방침 v1.1이
-- 실제로 게시된 뒤에만 적용한다. 적용 후에는
-- supabase/verify/setup_inquiries_privacy_v1_1_verify.sql로 확인한다.

create or replace function public.submit_setup_inquiry(
  p_plan_id text,
  p_name text,
  p_phone text,
  p_platform text default null,
  p_note text default null,
  p_privacy_consent boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_name text;
  v_plan_price integer;
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  -- [2026-09-22 개인정보처리방침 v1.1 개정] 서버 상수만 갱신한다 — 클라이언트는
  -- 여전히 이 값을 지정할 방법이 없다(함수 시그니처에 해당 인자 없음).
  v_consent_version constant text := 'v1.1';
begin
  if p_plan_id = 'basic' then
    v_plan_name := '기본 쇼핑몰 세팅';
    v_plan_price := 79000;
  elsif p_plan_id = 'integration' then
    v_plan_name := '연동·추적 세팅';
    v_plan_price := 129000;
  elsif p_plan_id = 'full' then
    v_plan_name := '전체 초기 세팅';
    v_plan_price := 189000;
  else
    raise exception 'INVALID_PLAN';
  end if;

  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'INVALID_NAME';
  end if;
  if v_phone = '' or char_length(v_phone) > 30 then
    raise exception 'INVALID_PHONE';
  end if;
  if v_platform is not null and char_length(v_platform) > 40 then
    raise exception 'INVALID_PLATFORM';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'INVALID_NOTE';
  end if;

  if p_privacy_consent is distinct from true then
    raise exception 'CONSENT_REQUIRED';
  end if;

  insert into public.setup_inquiries (
    user_id, plan_key, plan_name, plan_price, name, phone, platform, note,
    status, privacy_consent_version, privacy_consent_at
  ) values (
    v_user_id, p_plan_id, v_plan_name, v_plan_price, v_name, v_phone, v_platform, v_note,
    'pending', v_consent_version, now()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 시그니처가 바뀌지 않았으므로 CREATE OR REPLACE만으로 기존 GRANT가
-- 유지되지만, 권한 드리프트를 막기 위해 20260918120000과 동일한 문장을
-- 다시 명시적으로 실행해 재확인한다.
revoke all on function public.submit_setup_inquiry(text, text, text, text, text, boolean) from public;
grant execute on function public.submit_setup_inquiry(text, text, text, text, text, boolean) to anon, authenticated;
