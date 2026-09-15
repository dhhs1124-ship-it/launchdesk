-- LaunchDesk 관리자 기능 3단계 — "도매처 관리"(조회/수정/공개상태/삭제).
--
-- 이 파일이 하는 일:
--   1) wholesalers에 관리자용 SELECT 정책 추가(일반 사용자용 published-only
--      정책은 그대로 둔다 — 지난 단계의 wholesaler_inquiries와 같은 방식).
--   2) wholesalers.status CHECK 제약에 'unpublished'를 추가한다(기존
--      마이그레이션 파일은 전혀 수정하지 않고, 이 파일에서 제약만 다시
--      건다).
--   3) update_wholesaler / set_wholesaler_published / delete_wholesaler
--      세 개의 관리자 전용 RPC. 브라우저(authenticated)는 wholesalers에
--      대한 UPDATE/DELETE 권한을 전혀 갖지 않는다 — 이 세 함수를 통해서만
--      (그것도 함수 내부에서 매번 관리자 여부를 다시 확인한 뒤에만) 그
--      쓰기가 일어난다.
--
-- 이 파일은 기존 마이그레이션의 어떤 내용도 수정하지 않는다 — 제약
-- 재설정과 새 정책/함수만 추가한다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- 1) 관리자용 SELECT 정책 — wholesalers
-- ---------------------------------------------------------------------------
-- 기존 "wholesalers_select_published"(status = 'published')는 그대로
-- 둔다. RLS의 permissive 정책은 OR로 합쳐지므로, 일반 사용자는 여전히
-- published만 보이고 관리자는 is_admin()이 true라 전체(비공개/검토중/반려
-- 포함)가 보인다. 테이블 GRANT는 새로 필요 없다 — 20260915094200에서
-- 이미 `grant select on wholesalers to anon, authenticated`를 부여해뒀고,
-- 어떤 행이 보이는지는 정책이 계속 결정한다.
drop policy if exists "wholesalers_select_admin" on public.wholesalers;
create policy "wholesalers_select_admin"
  on public.wholesalers
  for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2) status CHECK에 'unpublished' 추가
-- ---------------------------------------------------------------------------
-- 원본 마이그레이션은 제약에 이름을 명시하지 않아 Postgres가 자동으로
-- 이름을 붙였다(보통 wholesalers_status_check가 되지만, 환경에 따라
-- 달라질 수 있어 이름을 가정하지 않는다). wholesalers.status에 걸린
-- CHECK 제약을 전부 찾아 지운 뒤, 값 4개짜리로 다시 만든다 — 기존 행은
-- 전부 예전 3개 값 중 하나이므로 이 변경으로 실패할 데이터는 없다.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'wholesalers'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.wholesalers drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.wholesalers
  add constraint wholesalers_status_check
  check (status in ('pending', 'published', 'rejected', 'unpublished'));

-- 'unpublished' = 관리자가 한 번 게시했다가 다시 비공개로 돌린 상태.
-- 'pending'/'rejected'는 여전히 문의 승인 흐름(2단계) 전용 의미로 남겨
-- 둔다 — 이 화면의 "공개상태 변경" 토글은 published <-> unpublished만
-- 오간다(그 외 상태의 행도 목록엔 보이지만, 토글은 항상 "공개로 전환"을
-- published로만 보낸다).

-- ---------------------------------------------------------------------------
-- 3) 수정 RPC — public.update_wholesaler(...)
-- ---------------------------------------------------------------------------
-- 보안 설계는 2단계 승인/반려 RPC와 동일: SECURITY DEFINER + 함수 내부
-- is_admin() 재확인 + search_path 고정 + user_id 인자 없음. status는 이
-- 함수로 바꾸지 않는다(그건 아래 set_wholesaler_published 전용) — 한
-- 함수가 "내용 수정"과 "공개 여부"를 동시에 다루지 않게 책임을 나눴다.
-- url은 이미 클라이언트(admin.js)가 정규화해서 보낸다고 가정한다(기존
-- wholesalers.js/stores.js의 normalizeUrl과 동일한 규칙) — DB에는 아직
-- url 형식에 대한 CHECK 제약이 없다(기존 스키마와 동일한 수준의 신뢰).
create or replace function public.update_wholesaler(
  p_wholesaler_id uuid,
  p_name text,
  p_url text,
  p_category text,
  p_summary text,
  p_main_products text default null,
  p_min_order_condition text default null,
  p_requires_business_membership boolean default false,
  p_allows_small_quantity boolean default false,
  p_allows_dropshipping boolean default false
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

  if not exists (select 1 from public.wholesalers where id = p_wholesaler_id) then
    raise exception 'WHOLESALER_NOT_FOUND';
  end if;

  update public.wholesalers
  set name = p_name,
      url = p_url,
      category = p_category,
      summary = p_summary,
      main_products = p_main_products,
      min_order_condition = p_min_order_condition,
      requires_business_membership = p_requires_business_membership,
      allows_small_quantity = p_allows_small_quantity,
      allows_dropshipping = p_allows_dropshipping,
      updated_at = now()
  where id = p_wholesaler_id;
end;
$$;

revoke all on function public.update_wholesaler(uuid, text, text, text, text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.update_wholesaler(uuid, text, text, text, text, text, text, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) 공개상태 RPC — public.set_wholesaler_published(p_wholesaler_id, p_published)
-- ---------------------------------------------------------------------------
create or replace function public.set_wholesaler_published(
  p_wholesaler_id uuid,
  p_published boolean
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

  if not exists (select 1 from public.wholesalers where id = p_wholesaler_id) then
    raise exception 'WHOLESALER_NOT_FOUND';
  end if;

  update public.wholesalers
  set status = case when p_published then 'published' else 'unpublished' end,
      updated_at = now()
  where id = p_wholesaler_id;
end;
$$;

revoke all on function public.set_wholesaler_published(uuid, boolean) from public;
grant execute on function public.set_wholesaler_published(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) 삭제 RPC — public.delete_wholesaler(p_wholesaler_id)
-- ---------------------------------------------------------------------------
-- wholesaler_inquiries.resolved_wholesaler_id는 20260915094200에서 이미
-- `on delete set null`로 선언돼 있다(이 파일에서 다시 확인·재선언할 필요
-- 없음) — 그래서 이 삭제는 관련 문의 행 자체는 절대 지우지 않고,
-- 그 문의의 resolved_wholesaler_id만 자동으로 null이 된다(문의 이력은
-- "한때 이 문의가 만든 도매처가 있었지만 지금은 삭제됨" 상태로 안전하게
-- 남는다).
create or replace function public.delete_wholesaler(
  p_wholesaler_id uuid
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

  if not exists (select 1 from public.wholesalers where id = p_wholesaler_id) then
    raise exception 'WHOLESALER_NOT_FOUND';
  end if;

  delete from public.wholesalers where id = p_wholesaler_id;
end;
$$;

revoke all on function public.delete_wholesaler(uuid) from public;
grant execute on function public.delete_wholesaler(uuid) to authenticated;
