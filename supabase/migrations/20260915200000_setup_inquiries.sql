-- LaunchDesk 관리자 기능 4단계 — "세팅 대행 문의" 실제 저장 + 관리.
--
-- 배경(조사 결과 요약 — 이 파일 작성 전 setup.js/index.html을 직접 읽고
-- 확인함): 기존 "세팅 대행" 신청 흐름은 DB에 전혀 저장되지 않았다 —
-- setup.js는 입력값으로 mailto: 링크만 조립하고, 사용자가 그 버튼을 직접
-- 눌러 자기 메일 앱에서 [보내기]까지 눌러야만 완성되는 구조였다. 로그인도
-- 요구하지 않았고, 이메일 필드 자체가 폼에 없었다(전화번호만 있음).
--
-- 이번 변경으로 확정된 설계(대화에서 확인):
--   - 로그인 필수 아님 — 비로그인 제출 허용, 로그인 상태면 user_id 저장
--   - 이메일 필드는 이번 단계에서 추가하지 않음 — 기존 전화번호(phone)를
--     "연락처"로 그대로 사용
--   - DB 저장이 먼저이자 필수, mailto는 그 이후의 선택적 보조 수단
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- 1) setup_inquiries — 세팅 대행 신청
-- ---------------------------------------------------------------------------
create table if not exists public.setup_inquiries (
  id uuid primary key default gen_random_uuid(),
  -- 로그인 사용자면 auth.uid()를 저장하고, 비로그인 제출이면 null이다.
  -- 계정이 나중에 삭제돼도 이 신청 기록(연락처가 별도로 있는 실제 영업
  -- 문의)은 남아야 하므로 on delete set null — wholesaler_inquiries가
  -- on delete cascade인 것과는 의도적으로 다르다(그건 "본인이 다시
  -- 신청하면 그만인" 셀프서비스 문의이고, 이건 응대해야 할 영업 문의라
  -- 이력을 지우지 않는다).
  user_id uuid references auth.users(id) on delete set null,
  plan_key text not null check (plan_key in ('basic', 'integration', 'full')),
  -- 플랜 이름/가격은 index.html에 정적으로 박혀 있어 나중에 바뀔 수
  -- 있으므로, 신청 시점 값을 그대로 스냅샷으로 저장한다(이후 가격이
  -- 바뀌어도 이 신청 건의 기록은 그대로 남는다).
  -- 설계 메모(보안 아님, 데이터 신뢰도 메모): plan_name/plan_price는 둘 다
  -- 클라이언트(setup.js)가 제출 시점에 함께 보낸 값이다. 서버가 plan_key
  -- 기준으로 다시 계산해서 검증하지 않으므로, 브라우저에서 임의로 다른
  -- 값을 보내면 그대로 저장된다. 관리자 화면에서는 "신청자가 이 가격으로
  -- 알고 신청했다"는 참고 정보로만 쓰고, 실제 결제/정산 금액의 근거로
  -- 사용하지 않는다 — 결제 기능이 생기면 그 시점의 신뢰 가능한 가격
  -- 소스(서버 측 플랜 테이블 등)를 별도로 둬야 한다.
  plan_name text not null,
  plan_price integer not null,
  name text not null,
  phone text not null,
  platform text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'rejected')),
  -- 관리자만 보는 내부 메모(전화 완료/견적 전달/고객 회신 대기 등) — 일반
  -- 사용자에게 노출되는 SELECT 정책이 없으므로 이 컬럼은 관리자 조회
  -- 경로로만 도달 가능하다.
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists setup_inquiries_status_idx on public.setup_inquiries (status);
create index if not exists setup_inquiries_user_id_idx on public.setup_inquiries (user_id);

-- updated_at 자동 갱신 — wholesalers 마이그레이션의 wholesalers_set_updated_at()과
-- 같은 최소 트리거 패턴을 그대로 재사용한다(그 함수를 이 테이블에도 그대로
-- 붙여 쓴다 — 로직이 "new.updated_at = now()"뿐이라 테이블에 종속적이지
-- 않다. 새 함수를 또 만들지 않는다).
drop trigger if exists set_updated_at on public.setup_inquiries;
create trigger set_updated_at
  before update on public.setup_inquiries
  for each row
  execute function public.wholesalers_set_updated_at();

alter table public.setup_inquiries enable row level security;

-- ---------------------------------------------------------------------------
-- 2) INSERT 정책 — 로그인 여부와 무관하게 제출 가능하되, user_id 위조는
--    막는다.
-- ---------------------------------------------------------------------------
-- anon(비로그인)은 user_id가 null인 행만 넣을 수 있다 — 로그인 안 한
-- 사람이 다른 누군가의 user_id를 넣어 제출할 수 없다.
drop policy if exists "setup_inquiries_insert_anon" on public.setup_inquiries;
create policy "setup_inquiries_insert_anon"
  on public.setup_inquiries
  for insert
  to anon
  with check (user_id is null);

-- authenticated는 반드시 자기 자신의 user_id로만 넣을 수 있다(다른 사람
-- 것도, null도 안 됨) — 로그인 상태에서 제출하면 항상 본인 명의로 남는다.
drop policy if exists "setup_inquiries_insert_own" on public.setup_inquiries;
create policy "setup_inquiries_insert_own"
  on public.setup_inquiries
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) SELECT 정책 — 관리자만. 일반 사용자는 본인 행도 조회 불가.
-- ---------------------------------------------------------------------------
-- [보안 수정] 처음 설계에는 "본인이 로그인 상태로 제출한 행만 조회 가능"
-- (user_id = auth.uid()) 정책이 있었다. 그런데 RLS는 row(행) 단위 필터일
-- 뿐 컬럼을 가리지 못한다 — 그 정책대로면 본인 행에 한해서긴 하지만
-- .select('*')로 admin_note(관리자 전용 내부 메모, 예: "고객이 예산에
-- 민감함")까지 그대로 읽혔을 것이다. 지금 이 MVP엔 "내 세팅대행 문의
-- 조회" 기능 자체가 없으므로, 그 정책을 아예 없앤다 — authenticated는
-- 이제 SELECT로 setup_inquiries의 어떤 행도(본인 것 포함) 볼 수 없다.
-- 남는 유일한 SELECT 경로는 관리자뿐이다:
drop policy if exists "setup_inquiries_select_own" on public.setup_inquiries;

-- 관리자는 전체 조회 가능(is_admin() 재사용) — admin_users 마이그레이션에서
-- 이미 만든 함수를 그대로 쓴다. authenticated에게 테이블 SELECT GRANT는
-- 여전히 필요하다(관리자도 authenticated 역할로 로그인하므로) — 다만
-- "누가 실제로 어떤 행을 볼 수 있는가"는 GRANT가 아니라 이 RLS 정책이
-- 전적으로 결정하고, 지금은 is_admin()이 참인 세션만 통과한다.
drop policy if exists "setup_inquiries_select_admin" on public.setup_inquiries;
create policy "setup_inquiries_select_admin"
  on public.setup_inquiries
  for select
  to authenticated
  using (public.is_admin());

-- 향후 "내 세팅대행 문의" 조회 기능을 만들 때는 이 테이블에 본인-행 SELECT
-- 정책을 다시 추가하지 말 것 — admin_note가 다시 노출된다. 대신
-- admin_note를 뺀 안전한 컬럼만 돌려주는 별도 RPC(예: SECURITY DEFINER
-- function이 자기 user_id 행만 안전한 컬럼 목록으로 select해서 반환) 또는
-- admin_note를 제외한 view를 새로 만들고, 그 RPC/view에만 authenticated
-- 조회 권한을 주는 방향으로 설계할 것.

-- update/delete 정책은 의도적으로 만들지 않는다 — 상태 변경은 아래
-- SECURITY DEFINER RPC를 통해서만 이뤄진다.

-- ---------------------------------------------------------------------------
-- 4) GRANT — 테이블 자체에 대한 권한. RLS와 별개로 이게 없으면 PostgREST가
--    RLS 통과 여부와 무관하게 401을 반환한다(wholesalers 때 실제로 겪은
--    문제와 동일한 원인이라 처음부터 명시한다).
-- ---------------------------------------------------------------------------
grant insert on table public.setup_inquiries to anon, authenticated;
grant select on table public.setup_inquiries to authenticated; -- anon은 select 권한 자체가 없음(본인 제출도 다시 못 봄)

-- ---------------------------------------------------------------------------
-- 5) 상태 변경 RPC — public.set_setup_inquiry_status(p_inquiry_id, p_status, p_admin_note)
-- ---------------------------------------------------------------------------
-- 보안 설계는 앞선 관리자 RPC들과 동일: SECURITY DEFINER + 함수 내부
-- is_admin() 재확인 + search_path 고정 + user_id 인자 없음 + PUBLIC
-- execute revoke 후 authenticated에게만 grant.
--
-- p_admin_note가 null이면 기존 admin_note를 그대로 둔다(coalesce) — 관리자가
-- 메모는 그대로 두고 상태만 바꾸고 싶을 때 매번 기존 메모를 다시 입력할
-- 필요가 없게 하기 위함. 메모를 지우고 싶으면 빈 문자열('')을 보내면 된다
-- (null이 아니라 빈 문자열이므로 coalesce에 걸리지 않고 그대로 저장됨).
create or replace function public.set_setup_inquiry_status(
  p_inquiry_id uuid,
  p_status text,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_status not in ('pending', 'in_progress', 'completed', 'rejected') then
    raise exception 'INVALID_STATUS';
  end if;

  if not exists (select 1 from public.setup_inquiries where id = p_inquiry_id) then
    raise exception 'INQUIRY_NOT_FOUND';
  end if;

  update public.setup_inquiries
  set status = p_status,
      admin_note = coalesce(p_admin_note, admin_note),
      updated_at = now()
  where id = p_inquiry_id;
end;
$$;

revoke all on function public.set_setup_inquiry_status(uuid, text, text) from public;
grant execute on function public.set_setup_inquiry_status(uuid, text, text) to authenticated;
