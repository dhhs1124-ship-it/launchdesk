-- LaunchDesk 개인정보처리방침 v1.1 → v1.2 개정에 따른 submit_setup_inquiry
-- 동의 버전 갱신 + 웹/RPC 배포 시차로 인한 버전 불일치 기록 차단.
--
-- 배경(버전 갱신): 20260918120000_setup_inquiries_consent_rpc.sql이 만든
-- public.submit_setup_inquiry(text,text,text,text,text,boolean)는 함수 본문
-- 안의 서버 상수(v_consent_version)로만 동의 버전을 기록한다 — 클라이언트는
-- 이 값을 지정할 방법이 없다(그래야 클라이언트가 임의의 버전 문자열을 보내
-- 동의 증빙을 조작할 수 없다 — 2026-09-18 보안 수정, 아래에서도 유지).
-- 개인정보처리방침이 v1.2로 개정되면서(시행일 [게시 예정일] — 일반 문의
-- 폼(#/contact) 신설에 따른 Resend·Cloudflare Turnstile 관련 내용 반영),
-- policy-consent-core.js의 PRIVACY_VERSION도 'v1.1' → 'v1.2'로 함께 올렸다.
--
-- 배경(버전 불일치 차단, 2026-09-23 신규): 웹 프런트(정적 배포)와 이
-- RPC(Supabase 마이그레이션)는 별도 시스템이라 같은 순간에 원자적으로
-- 함께 배포되지 않는다 — 브라우저 캐시·CDN 전파 지연으로 한쪽이 먼저
-- 반영된 구간이 실제로 생긴다. 이 구간에서 발생할 수 있는 두 경우:
--   (a) RPC가 먼저 v1.2로 배포되고, 일부 사용자는 아직 캐시된 v1.1 화면을
--       보는 상태에서 접수 → 예전 시그니처(버전 인자 없음)로 부르면 서버는
--       "화면은 v1.1을 보여줬는데 실제로는 v1.2에 동의했다"고 기록해버린다.
--   (b) 웹이 먼저 v1.2로 배포되고 RPC는 아직 v1.1인 상태에서 접수 →
--       "화면은 v1.2를 보여줬는데 실제로는 v1.1에 동의했다"고 기록된다.
-- 두 경우 모두 "실제로 화면에 표시된 버전과 다른 버전이 동의 이력으로
-- 저장"되는 문제이지, 단순히 오래된/새 버전이 기록되는 것 자체가 문제가
-- 아니다(각 경우 자체 버전으로 정확히 기록됐다면 문제 없다).
--
-- 대응: 새 인자 p_expected_privacy_version을 추가한다. 클라이언트는 "지금
-- 화면이 보여주고 있다고 믿는 버전"(policy-consent-core.js의
-- PRIVACY_VERSION)을 그대로 보낸다 — 이 값은 저장에 전혀 쓰이지 않는다
-- (저장은 여전히 v_consent_version 서버 상수만 쓴다, 보안 수정 유지). RPC는
-- 이 값이 자신의 서버 상수와 정확히 같은지만 검사하고, 다르면(또는 구버전
-- 클라이언트가 이 인자 자체를 안 보내 null이면) PRIVACY_VERSION_MISMATCH로
-- 접수 자체를 거부한다 — "잘못된 버전이 기록"되는 대신 "접수 실패"로
-- 안전하게 막는다(차단 우선, 가용성보다 정확성 — 낮은 트래픽의 베타
-- 단계이므로 짧은 전환 구간의 재시도 요청 몇 건은 감내 가능하다고 판단).
--
-- 시그니처 변경 주의: 인자를 7개로 늘리면 기존 6개 인자 함수와 "타입
-- 목록"이 달라져 CREATE OR REPLACE가 "교체"가 아니라 "새 오버로드 추가"가
-- 된다 — 옛 6인자 함수를 그대로 두면 아직 업데이트되지 않은 구버전
-- 클라이언트가 여전히 그 함수를 호출해 새로 만든 버전 검사를 완전히
-- 우회할 수 있다(가드가 있으나 마나). 그래서 이 마이그레이션은 반드시
-- 같은 트랜잭션 안에서 먼저 옛 시그니처를 DROP한 뒤 새 시그니처를 만든다
-- — 이 순간부터는 7인자 시그니처를 모르는 구버전 클라이언트는 "함수를
-- 찾을 수 없음" 오류로 실패한다(이 역시 안전한 실패 — 잘못된 기록보다
-- 낫다).
--
-- 이 파일이 하는 일 외에는 손대지 않는다: 시그니처 앞 6개 인자(개수·
-- 타입·이름), SECURITY DEFINER, search_path='', 검증 로직, 플랜별 가격,
-- INSERT 대상 컬럼은 20260918120000_setup_inquiries_consent_rpc.sql·
-- 20260922100000_setup_inquiries_privacy_v1_1.sql과 완전히 동일하게
-- 유지한다 — 그 두 마이그레이션 파일 자체는 수정하지 않는다(이미 원격에
-- 적용된 과거 마이그레이션이므로 — 원격 읽기 전용 조회로 v1.1이 실제
-- 배포돼 있음을 확인했다).
--
-- 과거 신청 행(이 마이그레이션 적용 전 제출분)의 privacy_consent_version은
-- 'v1.0' 또는 'v1.1'로 남아 있으며, 이 마이그레이션은 과거 행을 소급
-- 수정하지 않는다(제출 당시 실제로 동의한 버전을 그대로 보존하는 것이
-- 정확한 기록이다).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 개인정보처리방침 v1.2가
-- 실제로 게시된 뒤에만 적용한다. 적용 후에는
-- supabase/verify/setup_inquiries_privacy_v1_2_verify.sql로 확인한다 —
-- 그 verify 파일은 실제로 행을 INSERT했다가 롤백하는 검증이라 순수
-- 읽기 전용이 아니다(파일 상단 경고 참고).
--
-- 권장 배포 순서: RPC(이 마이그레이션)를 먼저 적용하고, 그 직후 웹
-- 프런트를 배포한다. 이 순서에서 "RPC 먼저" 구간 동안 구버전 캐시로
-- 접수를 시도하는 사용자는 "함수를 찾을 수 없음"(옛 6인자 시그니처가
-- 이미 사라짐)으로 실패한다 — 문구가 다소 기술적이지만 안전하게
-- 막힌다. 반대 순서(웹 먼저)로도 안전은 동일하게 보장되지만(신버전
-- 웹이 7인자로 호출해도 옛 RPC가 그 시그니처를 모르므로 역시 "함수를
-- 찾을 수 없음"으로 실패), 이 경우는 "정상 배포 완료 후 정상 동작해야
-- 할 화면"이 더 오래 실패 상태로 보일 수 있어 RPC 먼저를 권장한다.
-- 두 순서 모두 "잘못된 버전이 기록되는" 사고는 발생하지 않는다.

drop function if exists public.submit_setup_inquiry(text, text, text, text, text, boolean);

create function public.submit_setup_inquiry(
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
  -- [개인정보처리방침 v1.2 개정] 서버 상수만 갱신한다 — 클라이언트는
  -- 여전히 이 값을 지정할 방법이 없다(저장에는 이 상수만 쓰인다).
  v_consent_version constant text := 'v1.2';
begin
  -- [2026-09-23 버전 불일치 차단] 다른 검증보다 먼저 확인한다 — 웹/RPC
  -- 배포가 어긋난 상태에서는 나머지 입력이 전부 정상이어도 접수 자체를
  -- 거부해야 한다. p_expected_privacy_version은 저장에 쓰이지 않는다 —
  -- v_consent_version과 같은지 비교하는 용도로만 쓰고 버린다.
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

-- 새 시그니처(7개 인자)이므로 옛 GRANT를 물려받지 않는다 — 명시적으로
-- 다시 준다. anon도 계속 실행 가능해야 한다(비로그인 게스트도 세팅 대행을
-- 신청할 수 있는 기존 동작 유지 — v_user_id는 auth.uid()가 null이면
-- 그대로 null로 저장됨, 20260918120000과 동일).
revoke all on function public.submit_setup_inquiry(text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_setup_inquiry(text, text, text, text, text, boolean, text) to anon, authenticated;
