-- LaunchDesk 회원가입 필수 동의(이용약관 · 개인정보 수집·이용) 이력 저장소.
-- user_policy_consents 테이블 하나만 새로 만든다 — 기존 테이블/정책/권한은
-- 건드리지 않는다.
--
-- 왜 별도 RPC(SECURITY DEFINER) 없이 RLS + 컬럼 단위 GRANT만 쓰는가:
--   plans.sql과 완전히 같은 패턴이다. 이 테이블에 필요한 무결성 규칙
--   (terms_version/privacy_version NOT NULL, source 허용값, 중복 방지
--   unique 제약, accepted_at은 항상 서버 시각)은 전부 컬럼 제약과 컬럼
--   단위 GRANT만으로 충분히 강제된다 — accepted_at을 authenticated의
--   INSERT 컬럼 목록에서 아예 빼면(row default gen_random_uuid()/now()에
--   의존), 클라이언트가 그 컬럼에 어떤 값을 보내도 PostgREST/Postgres가
--   권한 오류로 거부한다. user_acquisition처럼 "클라이언트가 테이블에
--   직접 접근할 수 없어야 하는" 성격이 아니라(오히려 앱이 자신의 동의
--   이력을 조회할 수 있어야 함 — 요구사항), RPC로 우회 경로를 하나 더
--   만드는 대신 plans와 동일한 "RLS 본인 행 + 컬럼 GRANT" 조합을 그대로
--   재사용한다.
--
-- INSERT는 authenticated에게 "테이블 단위"로 주지 않는다 — 테이블 단위
-- INSERT를 먼저 주고 컬럼 단위 GRANT를 "추가"하면 테이블 단위 권한이
-- 모든 컬럼을 이미 허용해버려 컬럼 제한이 무의미해진다(요구사항 6 —
-- "테이블 단위 INSERT 권한을 남겨둔 채 컬럼 권한을 추가하는 실수"를 하지
-- 않기 위해, 아래 순서를 반드시 지킨다: 1) REVOKE ALL로 전부 비운다,
-- 2) SELECT만 테이블 단위로, INSERT는 컬럼 단위로만 준다. UPDATE/DELETE는
-- 정책도 GRANT도 아예 만들지 않는다).
--
-- 정책 버전 문자열(terms_version/privacy_version)의 실제 값은 이 파일이
-- 정하지 않는다 — 앱 코드(policy-consent-core.js)의 TERMS_VERSION/
-- PRIVACY_VERSION 상수가 유일한 소스이며, 이 테이블은 그 값을 문자열
-- 그대로 저장만 한다(형식을 강제하지 않고 길이 상한만 CHECK로 둔다 —
-- user_acquisition의 다른 자유 입력 컬럼들과 같은 원칙).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 적용한다.
-- 적용 후에는 supabase/verify/user_policy_consents_verify.sql로 RLS·권한·
-- 제약을 실제 DB에서 확인한다(plans_verify.sql과 동일한 트랜잭션+롤백 방식).

-- ---------------------------------------------------------------------------
-- 1) 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.user_policy_consents (
  id uuid primary key default gen_random_uuid(),
  -- 계정 삭제 시 동의 이력도 함께 정리한다(plans/wholesaler_inquiries와 같은 방향).
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 앱의 TERMS_VERSION/PRIVACY_VERSION 상수를 그대로 저장한다. 형식을
  -- 특정 패턴으로 강제하지 않는다(버전 표기 방식이 바뀔 수 있음) — 길이
  -- 상한만 이중 방어로 둔다.
  terms_version text not null
    constraint user_policy_consents_terms_version_length check (char_length(terms_version) <= 40),
  privacy_version text not null
    constraint user_policy_consents_privacy_version_length check (char_length(privacy_version) <= 40),

  -- 동의가 어느 화면/흐름에서 기록됐는지. 허용값을 좁게 고정해 임의
  -- 문자열이 감사 로그에 섞이지 않게 한다. 카카오는 현재 hidden이라
  -- 값을 만들지 않는다 — 필요해지면 새 값 추가 마이그레이션으로 확장.
  source text not null
    constraint user_policy_consents_source_allowed check (source in ('email_signup', 'google_oauth', 'existing_user_gate')),

  -- 서버 기준 동의 시각. 클라이언트가 이 값을 보낼 수 없도록 아래 3)에서
  -- INSERT 컬럼 권한 목록에서 뺀다 — 항상 이 컬럼의 default(now())만 쓰인다.
  accepted_at timestamptz not null default now(),

  -- 같은 사용자가 같은 버전 조합에 두 번째 행을 만들 수 없다 — 재제출/
  -- 중복 클릭은 이 제약에 부딪혀 23505가 되고, 클라이언트는 그 뒤 다시
  -- SELECT로 존재를 확인해 통과 여부를 정한다(insert 성공 여부 자체를
  -- 신뢰하지 않는다 — app 쪽 policy-consent.js 참고).
  constraint user_policy_consents_user_version_unique unique (user_id, terms_version, privacy_version)
);

alter table public.user_policy_consents enable row level security;

drop policy if exists user_policy_consents_select_own on public.user_policy_consents;
create policy user_policy_consents_select_own on public.user_policy_consents
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_policy_consents_insert_own on public.user_policy_consents;
create policy user_policy_consents_insert_own on public.user_policy_consents
  for insert to authenticated
  with check (user_id = auth.uid());

-- UPDATE/DELETE 정책은 의도적으로 만들지 않는다 — 아래에서 GRANT 자체도
-- 주지 않으므로 정책이 있어도 도달할 수 없다(이중 방어). 동의 이력은
-- 생성 후 절대 고치거나 지울 수 없는 감사 로그다.

-- 프로젝트 기본 auto-grant에 기대지 않고 전부 비운 뒤 필요한 것만 다시
-- 준다(plans.sql/user_acquisition.sql과 동일한 관례).
revoke all on table public.user_policy_consents from public;
revoke all on table public.user_policy_consents from anon;
revoke all on table public.user_policy_consents from authenticated;

-- SELECT는 테이블 단위(자신의 동의 이력을 전부 읽을 수 있어야 함 — RLS가
-- 행을 이미 본인 것으로 제한한다).
grant select on table public.user_policy_consents to authenticated;
-- INSERT는 컬럼 단위로만 — id(기본값 gen_random_uuid())와
-- accepted_at(기본값 now())은 목록에서 뺐다. 절대 테이블 단위 INSERT를
-- 먼저/추가로 주지 않는다(위 설명 참고 — 그러면 이 컬럼 제한이 무의미해짐).
grant insert (user_id, terms_version, privacy_version, source)
  on table public.user_policy_consents to authenticated;
-- UPDATE/DELETE GRANT 없음 — authenticated도 자신의 행을 고치거나 지울 수 없다.

-- anon은 SELECT/INSERT 모두 권한이 없다(위 REVOKE ALL로 이미 비어 있고,
-- 아래에서도 authenticated에게만 다시 준다 — anon에는 아무 것도 주지 않음).
