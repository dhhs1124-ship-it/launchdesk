-- LaunchDesk 관리자 기능 1단계 — 관리자 판별용 테이블 + 재사용 가능한
-- is_admin() 함수. 실제 회원관리/승인처리 등 운영 기능은 이 마이그레이션의
-- 범위가 아니다(#/admin 화면 골격 + 이 테이블만).
--
-- 설계 원칙(요청사항 그대로):
--   - 기존 Supabase Auth를 그대로 쓴다 — 별도 관리자 로그인 시스템 없음
--   - 이메일 문자열 비교로 관리자를 판별하지 않는다 — auth.users.id(uuid)
--     기준으로만 판별한다
--   - 클라이언트(anon/authenticated)는 admin_users에 쓸 수 없다 — 관리자
--     등록은 Supabase Studio에서 운영자가 수동으로 한다
--   - 이 파일에 특정 관리자 계정을 하드코딩하지 않는다
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- admin_users — user_id가 이 테이블에 존재하면 관리자다.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- authenticated는 "자기 자신의" 관리자 등록 여부만 조회 가능 — 이 정책
-- 덕분에, 관리자가 아닌 사용자는 이 테이블에서 어떤 행도(자기 자신의
-- 부재조차) 다른 사람의 존재 여부를 유추할 수 없다(본인 조회 결과 0건이면
-- "나는 관리자가 아니다"만 알 수 있을 뿐, 관리자가 누구인지는 절대 알 수
-- 없음). anon용 정책은 없음 — 로그인하지 않은 사용자는 이 테이블에 전혀
-- 접근할 수 없다.
drop policy if exists "admin_users_select_own" on public.admin_users;
create policy "admin_users_select_own"
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

-- insert/update/delete는 의도적으로 정책을 만들지 않는다 — 클라이언트
-- (anon/authenticated) 키로는 관리자 등록이 절대 불가능하고, 운영자가
-- Supabase Studio(service_role)에서만 수동으로 행을 추가/삭제한다.

-- RLS 정책만으로는 부족하다 — 테이블 자체에 대한 GRANT가 없으면 RLS와
-- 무관하게 PostgREST가 401을 반환한다(wholesalers 마이그레이션 때 실제로
-- 겪은 문제와 동일한 원인). authenticated에게 SELECT만 부여하고, 실제로
-- 어떤 행이 보이는지는 위 정책이 계속 제한한다. anon에게는 어떤 권한도
-- 주지 않는다.
grant select on table public.admin_users to authenticated;

-- ---------------------------------------------------------------------------
-- is_admin() — "지금 로그인된 사용자가 관리자인가"만 판별하는 재사용 가능한
-- 함수. 향후 다른 테이블(예: wholesaler_inquiries의 승인/반려 정책)에서
-- `using (is_admin())` 형태로 그대로 재사용하기 위해 만든다.
--
-- 설계 결정 — SECURITY INVOKER를 쓴다(DEFINER 아님):
--   위 admin_users_select_own 정책이 이미 "로그인한 사용자는 자기 자신의
--   행만 볼 수 있다"를 보장하므로, 이 함수가 하려는 일(자기 자신의 관리자
--   여부 확인)에 필요한 접근 권한은 호출자(invoker) 본인의 권한만으로
--   이미 충분하다. 즉:
--     - 관리자가 아닌 사용자가 호출 -> RLS가 자기 행조차 없는 걸로 필터링
--       하지 않는다(자기 행은 원래 없으므로) -> exists()가 false -> 정상
--     - 관리자가 호출 -> RLS가 자기 행을 보여줌 -> exists()가 true -> 정상
--   이 함수를 나중에 다른 테이블의 RLS 정책 안에서 호출해도(예:
--   wholesaler_inquiries) 그 정책은 여전히 "지금 요청을 보낸 사용자"의
--   권한으로 평가되므로 결과는 동일하게 정확하다. 권한을 끌어올릴
--   이유가 없다 — SECURITY DEFINER는 "권한이 없는 걸 있게 만들어줘야
--   할 때"(예: admin_users를 authenticated가 아예 못 보게 다 막아버리고
--   이 함수로만 우회 접근시키고 싶을 때) 필요한데, 이번 설계는 애초에
--   본인 행 조회 자체를 authenticated에게 허용하기로 했으므로 그 이유가
--   없다. DEFINER를 안 쓰면 search_path 하이재킹 등 DEFINER 특유의 위험
--   범주 자체가 사라진다는 것도 장점이다.
--   (그래도 습관적 방어로 search_path는 고정해둔다 — SET 절 참고.)
--
--   인자로 user_id를 받지 않는다 — 항상 auth.uid()(현재 세션)만 판별하고,
--   "다른 사람 것도 확인해줘" 요청 자체를 함수 시그니처 수준에서 원천
--   차단한다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

-- PostgreSQL은 새로 만든 함수의 EXECUTE 권한을 기본적으로 PUBLIC(모든
-- role)에 준다 — 이 함수는 인자도 없고 자기 자신의 admin_users 행 존재
-- 여부(true/false)만 반환하므로 그 기본값 자체가 위험하지는 않지만(anon이
-- 호출해도 auth.uid()가 null이라 항상 false), 의도를 명확히 하기 위해
-- authenticated에게 명시적으로 EXECUTE를 부여해둔다.
grant execute on function public.is_admin() to authenticated;
