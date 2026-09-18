-- LaunchDesk 세팅 대행 신청 — 개인정보 수집·이용 동의 증빙 컬럼 + 안전한
-- 제출 RPC.
--
-- 배경(이 파일 작성 전 읽은 코드): 20260915200000_setup_inquiries.sql은
-- anon/authenticated 모두에게 setup_inquiries 테이블 INSERT를 직접
-- 허용했다(그 파일 4번 섹션 grant). 그 INSERT는 클라이언트(setup.js)가
-- 보낸 plan_name/plan_price를 검증 없이 그대로 저장했고(그 파일 주석에
-- "서버가 plan_key 기준으로 재검증하지 않는다"는 신뢰도 메모가 이미 있음),
-- 개인정보 수집·이용에 대한 동의를 받는 절차 자체가 없었다.
--
-- [2026-09-18 보안 수정] 최초 버전은 privacy_consent_version을 클라이언트
-- 인자(p_privacy_consent_version)로 받아 그대로 저장했다 — 클라이언트가
-- 임의의 문자열("v99.9" 등)을 보내도 그대로 동의 증빙에 남는 구조였다.
-- 이제 이 함수는 그 인자를 아예 받지 않는다. 저장되는 버전 문자열은
-- 함수 본문 안의 v_consent_version 상수(v1.0) 하나뿐이다 — "이용자가
-- 어떤 버전에 동의했다고 주장하는가"가 아니라 "서버가 지금 이 순간
-- 실제로 게시 중인 버전이 무엇인가"만 기록한다. 화면(setup.js)의
-- policy-consent-core.js PRIVACY_VERSION 상수와 이 함수 안의 상수는
-- 서로 다른 저장소(JS 파일 vs SQL 함수)에 있어 하나의 변수로 묶을 수
-- 없다 — 개인정보처리방침을 개정해 버전을 올릴 때는 두 값을 같은
-- 배포에서 함께 갱신해야 한다(형식 통일 강제는 하지 않지만, 실제 값이
-- 어긋나면 화면에 보이는 버전 안내와 DB에 남는 증빙 버전이 달라진다).
--
-- 이 파일이 하는 일(기존 테이블/정책/함수는 아래에서 명시한 것 외에는
-- 건드리지 않는다 — set_setup_inquiry_status RPC와 관리자 SELECT 정책은
-- 그대로 둔다):
--   1) setup_inquiries에 동의 증빙 컬럼 2개 추가
--      (privacy_consent_version, privacy_consent_at) — 기존 행은 NULL로
--      남긴다. 동의를 받은 적이 없는 과거 신청에 값을 소급해서 채우면
--      "동의했다"는 거짓 기록이 되므로 절대 하지 않는다. 두 컬럼은
--      "둘 다 NULL 아니면 둘 다 값 있음"만 CHECK로 강제한다(한쪽만
--      채워진 반쪽짜리 증빙을 구조적으로 막는다) — 기존 행은 둘 다
--      NULL이라 이 제약을 통과한다.
--   2) public.submit_setup_inquiry(p_plan_id, p_name, p_phone, p_platform,
--      p_note, p_privacy_consent) RPC 신설(6개 인자 — 동의 버전 인자
--      없음) — plan_id로 플랜명·가격을 서버에서 결정(클라이언트 값 신뢰
--      안 함), status를 'pending'으로 고정, admin_note는 인자로 받지
--      않음(관리자 전용 값 주입 불가), 동의 버전은 함수 안의 상수로만
--      고정, 동의 시각은 now()로만 고정, 동의가 없으면 거부한다.
--   3) anon/authenticated의 setup_inquiries 테이블 직접 INSERT 권한을
--      회수하고 관련 INSERT 정책을 제거한다 — 이제 유일한 쓰기 경로는
--      이 RPC뿐이다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 적용한다.
-- 적용 후에는 supabase/verify/setup_inquiries_consent_rpc_verify.sql로
-- RLS·권한·RPC 동작을 실제 DB에서 확인한다.

-- ---------------------------------------------------------------------------
-- 1) 동의 증빙 컬럼
-- ---------------------------------------------------------------------------
alter table public.setup_inquiries
  add column if not exists privacy_consent_version text,
  add column if not exists privacy_consent_at timestamptz;

alter table public.setup_inquiries
  drop constraint if exists setup_inquiries_privacy_consent_version_length;
alter table public.setup_inquiries
  add constraint setup_inquiries_privacy_consent_version_length
    check (privacy_consent_version is null or char_length(privacy_consent_version) <= 40);

-- 둘 다 NULL(동의 절차 이전 신청) 아니면 둘 다 값이 있어야 한다 — 한쪽만
-- 채워진 상태(예: 버전은 있는데 시각이 없음, 또는 그 반대)는 데이터
-- 정합성이 깨진 것이므로 애초에 만들어질 수 없게 막는다. 기존 행은 두
-- 컬럼 모두 NULL이라 (NULL is null) = (NULL is null) → true이므로 이
-- 제약을 추가해도 마이그레이션이 실패하지 않는다.
alter table public.setup_inquiries
  drop constraint if exists setup_inquiries_privacy_consent_pair;
alter table public.setup_inquiries
  add constraint setup_inquiries_privacy_consent_pair
    check ((privacy_consent_version is null) = (privacy_consent_at is null));

-- 기존 행(이 마이그레이션 적용 전 제출분)은 두 컬럼 모두 NULL로 남는다 —
-- "동의를 받았다"는 기록을 허위로 만들지 않기 위한 의도적 설계다. 관리자
-- 화면에서 이 두 컬럼이 NULL인 행은 동의 절차 이전 신청으로 구분할 수 있다.

-- ---------------------------------------------------------------------------
-- 2) 구 시그니처 제거 — public.submit_setup_inquiry(text, text, text, text, text, boolean, text)
-- ---------------------------------------------------------------------------
-- PostgreSQL은 이름이 같아도 인자 개수/타입이 다르면 서로 다른 함수(오버로드)로
-- 취급한다. 즉 아래 3)에서 6개 인자짜리를 CREATE OR REPLACE해도, 어딘가에
-- 이미 이 7개 인자짜리가 만들어져 있었다면 그 함수는 지워지지 않고 그대로
-- 남아 여전히 호출 가능한 채로 방치된다 — "클라이언트가 동의 버전을 직접
-- 지정하는" 구멍이 새 6개 인자 함수와 나란히 살아남는 셈이다. 이 마이그레이션
-- 파일은 아직 원격에 적용된 적이 없다고 알고 있지만, 재사용/부분 시험
-- 가능성을 배제할 수 없으므로 존재하면 명시적으로 지운 뒤에만 새로 만든다.
drop function if exists public.submit_setup_inquiry(text, text, text, text, text, boolean, text);

-- ---------------------------------------------------------------------------
-- 3) 제출 RPC — public.submit_setup_inquiry(...) (6개 인자 — 동의 버전 인자 없음)
-- ---------------------------------------------------------------------------
-- 보안 설계는 기존 관리자 RPC들과 같은 원칙(SECURITY DEFINER + search_path
-- 고정)을 따르되, 이 함수는 "관리자 확인"이 아니라 "입력값 자체를 서버가
-- 재검증"하는 방식으로 신뢰 경계를 세운다:
--   - user_id는 인자로 받지 않는다 — auth.uid()만 쓴다(비로그인 호출은
--     auth.uid()가 NULL이므로 자동으로 null 저장 = 기존 anon 정책이
--     하던 일과 동일한 결과).
--   - plan_id로 plan_name/plan_price를 이 함수 안에서만 결정한다.
--     index.html의 현재 베타 가격(기본 79,000 / 연동·추적 129,000 /
--     전체 189,000)과 반드시 같이 맞춰 바꿀 것 — 가격이 바뀌면 이
--     함수도 CREATE OR REPLACE로 함께 갱신해야 한다(두 값이 따로 놀면
--     신청 화면에 보이는 가격과 실제 저장되는 가격이 달라진다).
--   - status는 'pending' 리터럴로 고정한다 — 인자로 받지 않는다.
--   - admin_note는 아예 인자 목록에 없다 — 관리자 전용 값을 신청자가
--     지정할 방법이 함수 시그니처 자체에 없다(테이블에는 여전히 값이
--     존재하지만 항상 기본값 NULL로 들어간다).
--   - privacy_consent_version은 인자로 받지 않는다 — v_consent_version
--     상수(아래 declare)만 저장된다. 클라이언트가 어떤 값을 보내려 해도
--     함수 시그니처 자체에 그 인자가 없어 애초에 전달할 방법이 없다.
--     개인정보처리방침을 개정해 버전을 올릴 때는 이 상수를 CREATE OR
--     REPLACE로 함께 갱신한다(policy-consent-core.js의 PRIVACY_VERSION과
--     같은 배포에서 같이 바꿀 것 — 두 값이 서로 다른 저장소에 있어
--     하나의 변수로 묶을 수는 없지만, 배포 절차상 함께 움직여야 한다).
--   - p_privacy_consent가 true가 아니면 거부한다(CONSENT_REQUIRED).
--     동의 시각(privacy_consent_at)은 클라이언트가 보낼 수 없고 항상
--     이 함수 안의 now()만 쓴다 — 인자로 받지 않는다.
--
-- search_path = ''(완전히 빈 값)로 고정한다 — 기존 관리자 RPC들의
-- 'public, pg_temp'보다 더 엄격하다. 이 함수 본문이 실제로 참조하는
-- "스키마가 있는" 객체는 auth.uid()와 public.setup_inquiries 단 둘뿐이고
-- 둘 다 이미 스키마를 명시했으므로 search_path가 비어 있어도 정상
-- 동작한다. 함수 본문에 나오는 나머지 이름(btrim/coalesce/nullif/
-- char_length/now())은 전부 PostgreSQL 내장 함수/구문이다 — pg_catalog는
-- search_path 설정값과 무관하게 항상 가장 먼저 암묵적으로 검색되는
-- 스키마이므로("If it is not named explicitly in the path, it is
-- implicitly searched first, before searching the path" — PostgreSQL
-- 공식 문서), search_path를 ''로 비워도 이 내장 함수들은 여전히 정상
-- 해석된다. 즉 search_path=''는 "이 함수가 의도치 않게 public 스키마의
-- 동명 객체(악의적으로 심어진 함수 등)를 먼저 찾아버리는" 하이재킹
-- 경로만 차단할 뿐, 표준 내장 함수 사용에는 아무 영향이 없다.
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
  -- 동의 버전은 오직 이 서버 상수로만 결정된다 — 클라이언트는 이 값을
  -- 절대 지정할 수 없다(함수 시그니처에 해당 인자가 없음). 개인정보
  -- 처리방침을 개정할 때 이 값을 CREATE OR REPLACE로 함께 올린다.
  v_consent_version constant text := 'v1.0';
begin
  -- plan_id → plan_name/plan_price를 서버에서만 결정한다(요구사항 3 —
  -- "플랜명과 가격은 클라이언트 값을 신뢰하지 않고 서버에서 plan_id로 결정").
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

-- 새로 만든 함수는 기본적으로 PUBLIC에 EXECUTE가 자동 부여된다 — 명시적으로
-- 회수한 뒤 anon/authenticated에게만 다시 준다(둘 다 신청 가능해야 하므로
-- 기존 관리자 RPC들과 달리 anon도 포함한다 — 이 저장소에서 anon에게
-- EXECUTE를 주는 첫 RPC다. 비로그인 제출을 허용하는 기존 INSERT 정책의
-- 취지를 그대로 RPC로 옮긴 것). 이 grant/revoke는 새 6개 인자 시그니처
-- 전용이다 — 2)에서 이미 지운 7개 인자 시그니처에는 아무 권한도 남지 않는다.
revoke all on function public.submit_setup_inquiry(text, text, text, text, text, boolean) from public;
grant execute on function public.submit_setup_inquiry(text, text, text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) 직접 INSERT 차단 — 유일한 쓰기 경로를 위 RPC로 좁힌다.
-- ---------------------------------------------------------------------------
-- 정책을 지워도 GRANT가 없으면 어차피 INSERT 자체가 42501로 거부되지만,
-- 더 이상 도달할 수 없는 정책을 그대로 남겨두면 "이 테이블이 여전히 정책
-- 기반으로 쓰기가 가능하다"고 오해하기 쉬우므로 같이 제거한다.
drop policy if exists "setup_inquiries_insert_anon" on public.setup_inquiries;
drop policy if exists "setup_inquiries_insert_own" on public.setup_inquiries;

revoke insert on table public.setup_inquiries from anon, authenticated;
-- SELECT 권한(관리자용, authenticated에게 테이블 단위로 이미 부여됨)과
-- set_setup_inquiry_status RPC 권한은 손대지 않는다 — 기존 관리자 조회·
-- 상태 변경 기능은 그대로 동작한다.
