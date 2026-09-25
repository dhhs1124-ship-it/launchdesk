-- LaunchDesk 개인정보처리방침 v1.3 → v1.4 개정에 따른 submit_setup_inquiry
-- 동의 버전 갱신.
--
-- 배경: v1.4는 Meta 픽셀을 이용한 광고 성과 측정(선택 동의, PageView만) 도입에
-- 따라 방침 2·3·4·5·7·11번(수집 항목·목적·보유기간·이전·거부 방법)과 분석·광고
-- 측정 통합 안내창을 반영한 개정이다. policy-consent-core.js의 PRIVACY_VERSION도
-- 'v1.3' → 'v1.4'로 함께 올렸다. 시행일은 실제 게시일에 정한다.
--
-- 20260924160000_setup_inquiries_privacy_v1_3.sql과 시그니처가 같으므로 CREATE OR
-- REPLACE로 서버 상수(v_consent_version)만 'v1.4'로 바꾼다 — 인자 · SECURITY
-- DEFINER · search_path · 검증 로직 · 플랜 가격 · INSERT 컬럼 · 권한은 v1.3과 완전히
-- 같다. 과거 신청 행의 동의 버전은 소급 수정하지 않는다.
--
-- 적용 시점: 개인정보처리방침 v1.4 게시와 함께(RPC 먼저 → 곧바로 웹,
-- docs/meta-pixel-rollout.md). 이 파일을 적용한 순간부터 아직 v1.3 화면을 보는
-- 사용자의 세팅 대행 신청은 PRIVACY_VERSION_MISMATCH로 거부된다(setup.js가
-- "새로고침" 안내) — 잘못된 버전이 기록되지는 않는다. 적용 후
-- setup_inquiry_consent_version_check.sql로 상수가 v1.4인지 확인한다.

create or replace function public.submit_setup_inquiry(
  p_plan_id text,
  p_name text,
  p_phone text,
  p_platform text default null,
  p_note text default null,
  p_privacy_consent boolean default false,
  p_expected_privacy_version text default null
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
  -- [개인정보처리방침 v1.4 개정] 서버 상수만 갱신한다 — 클라이언트는
  -- 여전히 이 값을 지정할 방법이 없다(저장에는 이 상수만 쓰인다).
  v_consent_version constant text := 'v1.4';
begin
  -- 버전 불일치 차단(v1.2에서 도입) — 다른 검증보다 먼저 확인한다.
  -- p_expected_privacy_version은 저장에 쓰이지 않는다.
  if p_expected_privacy_version is distinct from v_consent_version then
    raise exception 'PRIVACY_VERSION_MISMATCH';
  end if;

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

-- CREATE OR REPLACE는 같은 시그니처의 기존 권한을 유지하지만, v1.2와 같은 상태임을
-- 명시적으로 다시 맞춘다(anon · authenticated 실행 가능, PUBLIC 회수).
revoke all on function public.submit_setup_inquiry(text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_setup_inquiry(text, text, text, text, text, boolean, text) to anon, authenticated;
