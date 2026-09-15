-- "도매처 찾기" 기능 — 신규 테이블 2개.
--
-- 설계 배경(요약 — 자세한 내용은 docs/plans/wholesale-directory.md):
--   - wholesalers: 공개 디렉토리. 운영자가 Supabase Studio에서 직접
--     등록/발행/반려한다. 클라이언트(anon/authenticated)는 published 행만
--     읽을 수 있고, 쓰기는 전혀 못 한다 — 이 프로젝트엔 아직 관리자 role
--     개념이 없으므로, 이번 단계에서 새로 만들지 않고 그냥 서비스
--     role(Studio)로만 쓰게 한다.
--   - wholesaler_inquiries: 로그인 사용자가 남기는 "도매처 등록 문의".
--     본인 것만 읽고 쓸 수 있으며, anon은 아예 접근 불가. 운영자가 검토 후
--     승인하면 wholesalers에 새 행을 만들고 resolved_wholesaler_id로
--     연결한다(이 연결도 Studio에서 수동 처리).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
--
-- 프로젝트에 기존 updated_at 트리거 시스템이 없으므로, 여기서 과한 걸 새로
-- 만들지 않고 가장 표준적인 최소 트리거 함수 하나만 만들어 두 테이블에
-- 재사용한다.
--
-- 함수명을 이 기능 전용으로 네임스페이싱했다(wholesalers_set_updated_at) —
-- 이 저장소엔 기존 스키마가 SQL로 기록되어 있지 않아(지금까지 Studio에서만
-- 관리) 원격 DB에 이미 `set_updated_at`이라는 흔한 이름의 함수가 있는지
-- 저장소만으로는 확인할 수 없다. CREATE OR REPLACE는 동일 시그니처의 기존
-- 함수를 조용히 덮어쓰므로, 범용적인 이름 대신 이 파일이 소유권을 명확히
-- 갖는 이름을 써서 충돌 가능성 자체를 없앤다.
-- ---------------------------------------------------------------------------
create or replace function public.wholesalers_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A. wholesalers — 공개 도매처 디렉토리
-- ---------------------------------------------------------------------------
create table if not exists public.wholesalers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  url text not null,
  category text not null check (category in (
    'clothing',              -- 의류
    'fashion_accessories',   -- 패션잡화
    'living',                -- 생활용품
    'beauty',                -- 뷰티
    'food',                  -- 식품
    'pet',                   -- 반려동물
    'furniture_interior',    -- 가구/인테리어
    'packaging'              -- 포장/부자재
  )),
  summary text not null,
  main_products text,
  min_order_condition text,
  requires_business_membership boolean not null default false,
  allows_small_quantity boolean not null default false,
  allows_dropshipping boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  -- 문의에서 채택되어 만들어진 행이면 그 출처를 남긴다. wholesaler_inquiries가
  -- 아래(B)에서 이 테이블 다음에 만들어지므로, FK 제약은 두 테이블이 모두
  -- 생긴 뒤 파일 맨 끝에서 alter table로 붙인다(지금은 컬럼만 정의).
  source_inquiry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wholesalers_status_idx on public.wholesalers (status);
create index if not exists wholesalers_category_idx on public.wholesalers (category);

drop trigger if exists set_updated_at on public.wholesalers;
create trigger set_updated_at
  before update on public.wholesalers
  for each row
  execute function public.wholesalers_set_updated_at();

alter table public.wholesalers enable row level security;

-- anon + authenticated 모두 published 행만 읽을 수 있다 (비로그인 사용자도
-- 목록/상세를 볼 수 있어야 한다는 요구사항).
drop policy if exists "wholesalers_select_published" on public.wholesalers;
create policy "wholesalers_select_published"
  on public.wholesalers
  for select
  to anon, authenticated
  using (status = 'published');

-- insert/update/delete는 일부러 정책을 만들지 않는다 — 즉 client(anon/
-- authenticated) 키로는 어떤 쓰기도 불가능하고, 운영자는 service_role
-- (Supabase Studio)로만 관리한다.

-- ---------------------------------------------------------------------------
-- B. wholesaler_inquiries — 로그인 사용자의 도매처 등록 문의
-- ---------------------------------------------------------------------------
create table if not exists public.wholesaler_inquiries (
  id uuid primary key default gen_random_uuid(),
  -- 문의를 남긴 사용자 본인. 계정이 삭제되면 문의도 함께 정리한다(다른
  -- 사람 소유로 남겨두거나 고아 행으로 방치하지 않기 위함) — tool_records
  -- 등 기존 사용자 소유 테이블과 같은 방향.
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_email text not null,
  name text not null,
  url text not null,
  category text not null check (category in (
    'clothing',
    'fashion_accessories',
    'living',
    'beauty',
    'food',
    'pet',
    'furniture_interior',
    'packaging'
  )),
  summary text not null,
  main_products text,
  min_order_condition text,
  requires_business_membership boolean not null default false,
  allows_small_quantity boolean not null default false,
  allows_dropshipping boolean not null default false,
  memo text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- 반려 사유 등 운영자 메모. 신청자 본인에게도 SELECT로 노출되지만(왜
  -- 반려됐는지 알 수 있어야 하므로), 작성은 Studio(service_role)에서만.
  admin_note text,
  -- 승인되어 실제 디렉토리에 반영된 경우 그 행을 가리킨다. wholesalers
  -- 행이 지워져도 문의 이력 자체는 남아야 하므로 on delete set null.
  resolved_wholesaler_id uuid references public.wholesalers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wholesaler_inquiries_user_id_idx on public.wholesaler_inquiries (user_id);
create index if not exists wholesaler_inquiries_status_idx on public.wholesaler_inquiries (status);

drop trigger if exists set_updated_at on public.wholesaler_inquiries;
create trigger set_updated_at
  before update on public.wholesaler_inquiries
  for each row
  execute function public.wholesalers_set_updated_at();

alter table public.wholesaler_inquiries enable row level security;

-- 본인 문의만 조회 가능. anon은 정책이 없으므로 전면 차단.
drop policy if exists "wholesaler_inquiries_select_own" on public.wholesaler_inquiries;
create policy "wholesaler_inquiries_select_own"
  on public.wholesaler_inquiries
  for select
  to authenticated
  using (user_id = auth.uid());

-- 본인 명의로만 등록 가능 — user_id를 임의로 다른 사람 것으로 넣어
-- insert하는 걸 DB 레벨에서 막는다(클라이언트가 실수/악의적으로 다른
-- id를 보내도 거부됨).
drop policy if exists "wholesaler_inquiries_insert_own" on public.wholesaler_inquiries;
create policy "wholesaler_inquiries_insert_own"
  on public.wholesaler_inquiries
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- update/delete는 일부러 정책 없음 — 제출 후에는 신청자도 수정/삭제 불가,
-- 상태 변경(승인/반려)은 운영자가 Studio(service_role)에서만 처리한다.

-- ---------------------------------------------------------------------------
-- wholesalers.source_inquiry_id FK — wholesaler_inquiries가 위(B)에서 막
-- 생겼으므로 이제 붙인다. 문의 행이 지워져도 디렉토리 행은 남아야 하므로
-- on delete set null(위 컬럼 주석과 동일한 이유).
-- ---------------------------------------------------------------------------
alter table public.wholesalers
  add constraint wholesalers_source_inquiry_id_fkey
  foreign key (source_inquiry_id)
  references public.wholesaler_inquiries(id)
  on delete set null;
