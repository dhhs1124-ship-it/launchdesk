-- LaunchDesk 관리자 기능 2단계 — "도매처 등록 문의" 승인/반려.
--
-- 이 파일이 하는 일:
--   1) wholesaler_inquiries에 관리자용 SELECT 정책 추가(기존 본인-행-only
--      정책은 그대로 둔다 — RLS의 permissive 정책은 OR로 합쳐지므로 둘 다
--      유효하다: 본인 것만 보이던 사용자는 계속 본인 것만, 관리자는 전체를
--      본다).
--   2) approve_wholesaler_inquiry / reject_wholesaler_inquiry 두 RPC.
--      브라우저(authenticated)는 wholesalers INSERT나 wholesaler_inquiries
--      UPDATE 권한을 전혀 갖지 않고, 이 두 SECURITY DEFINER 함수를 통해서만
--      (그것도 함수 내부에서 매번 관리자 여부를 다시 확인한 뒤에만) 그 쓰기가
--      일어난다.
--
-- 이 파일은 기존 마이그레이션(20260915094200_wholesalers.sql,
-- 20260915140000_admin_users.sql)의 어떤 내용도 수정하지 않는다 — 새 정책과
-- 새 함수만 추가한다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- 1) 관리자용 SELECT 정책 — wholesaler_inquiries
-- ---------------------------------------------------------------------------
-- 기존 "wholesaler_inquiries_select_own"(user_id = auth.uid())은 그대로
-- 둔다. 이 정책을 추가로 얹으면 Postgres RLS가 같은 command(select)의
-- permissive 정책 여러 개를 OR로 합치므로, 일반 사용자는 여전히 본인 행만
-- 보이고 관리자는 전체가 보인다 — 기존 정책을 손대지 않고도 요구사항을
-- 만족한다.
drop policy if exists "wholesaler_inquiries_select_admin" on public.wholesaler_inquiries;
create policy "wholesaler_inquiries_select_admin"
  on public.wholesaler_inquiries
  for select
  to authenticated
  using (public.is_admin());

-- 테이블 GRANT는 새로 필요 없다 — 20260915094200_wholesalers.sql에서 이미
-- `grant select, insert on wholesaler_inquiries to authenticated`를 부여해
-- 뒀고, 어떤 행이 보이는지는 위 정책(들)이 계속 결정한다. UPDATE/DELETE
-- 권한은 여기서도 authenticated에게 주지 않는다 — 승인/반려는 전부 아래
-- SECURITY DEFINER 함수를 통해서만 이뤄진다.

-- ---------------------------------------------------------------------------
-- 2) 승인 RPC — public.approve_wholesaler_inquiry(p_inquiry_id, p_admin_note)
-- ---------------------------------------------------------------------------
-- 보안 설계:
--   - SECURITY DEFINER를 쓴다 — authenticated는 wholesalers INSERT 권한도,
--     wholesaler_inquiries UPDATE 권한도 없으므로(의도적으로 안 줬음), 이
--     함수가 소유자 권한으로 대신 그 두 쓰기를 원자적으로 수행한다.
--   - 그래서 함수 맨 첫 줄에서 is_admin()으로 "지금 호출한 사람"이 관리자인지
--     반드시 다시 확인한다 — SECURITY DEFINER가 권한을 끌어올려주는 것과,
--     그 권한을 아무나 쓸 수 있는 것은 완전히 다른 문제이기 때문이다.
--   - search_path를 고정해 검색 경로 하이재킹을 막는다.
--   - 인자로 user_id를 받지 않는다 — 관리자 여부 판별은 오직 auth.uid()
--     (지금 이 요청을 보낸 세션)로만 한다.
--   - 함수 본문 전체가 하나의 문장처럼 원자적으로 실행된다(Postgres 함수는
--     그 자체로 트랜잭션 단위다) — 중간에 raise exception이 나면 그 안에서
--     이미 실행된 insert/update까지 전부 롤백된다. 별도 begin/commit이
--     필요 없다.
--   - select ... for update로 문의 행을 잠가서, 같은 문의를 동시에
--     승인/반려하려는 두 요청(중복 클릭, 또는 서로 다른 관리자 2명)이
--     경합해도 하나만 성공하고 나머지는 "이미 처리됨" 에러를 받는다.
--
-- slug 처리:
--   문의에는 slug가 없다. wholesalers.slug는 UNIQUE NOT NULL이라 반드시
--   충돌 없는 값을 만들어야 하는데, 한글 사이트명을 로마자로 바꾸는 시도는
--   이번 MVP 범위가 아니다. 대신 이미 유일함이 DB 제약(primary key)으로
--   보장된 "문의 자신의 id"를 그대로 재료로 쓴다 —
--     'wholesaler-' || replace(p_inquiry_id::text, '-', '')
--   문의 하나는 pending 상태에서 딱 한 번만 승인될 수 있으므로(아래 상태
--   체크), 같은 문의로 두 번째 slug가 생성될 일 자체가 없고, 서로 다른
--   문의는 서로 다른 uuid를 가지므로 이 slug끼리 충돌할 수도 없다 —
--   확률적으로 낮은 게 아니라 구조적으로 불가능하다. 향후 SEO를 위해
--   운영자가 이 slug를 더 보기 좋은 값으로 바꾸고 싶다면, wholesalers.slug는
--   이후 Studio에서 자유롭게 UPDATE하면 된다(이 함수는 "최초 생성" 시점의
--   기본값만 책임진다).
create or replace function public.approve_wholesaler_inquiry(
  p_inquiry_id uuid,
  p_admin_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inquiry public.wholesaler_inquiries%rowtype;
  v_wholesaler_id uuid;
  v_slug text;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select * into v_inquiry
  from public.wholesaler_inquiries
  where id = p_inquiry_id
  for update;

  if not found then
    raise exception 'INQUIRY_NOT_FOUND';
  end if;

  if v_inquiry.status <> 'pending' then
    raise exception 'INQUIRY_ALREADY_PROCESSED';
  end if;

  v_slug := 'wholesaler-' || replace(p_inquiry_id::text, '-', '');

  insert into public.wholesalers (
    slug, name, url, category, summary, main_products, min_order_condition,
    requires_business_membership, allows_small_quantity, allows_dropshipping,
    status, source_inquiry_id
  ) values (
    v_slug, v_inquiry.name, v_inquiry.url, v_inquiry.category, v_inquiry.summary,
    v_inquiry.main_products, v_inquiry.min_order_condition,
    v_inquiry.requires_business_membership, v_inquiry.allows_small_quantity,
    v_inquiry.allows_dropshipping, 'published', p_inquiry_id
  )
  returning id into v_wholesaler_id;

  update public.wholesaler_inquiries
  set status = 'approved',
      admin_note = p_admin_note,
      resolved_wholesaler_id = v_wholesaler_id,
      updated_at = now()
  where id = p_inquiry_id;

  return v_wholesaler_id;
end;
$$;

-- 새로 만든 함수의 EXECUTE 권한은 기본적으로 PUBLIC(anon 포함)에 자동으로
-- 부여된다 — 이 함수는 쓰기 작업(wholesalers 생성, 문의 승인 처리)을
-- 하므로 그 기본값을 절대 그대로 두면 안 된다. PUBLIC에서 명시적으로
-- 회수하고 authenticated에게만 다시 부여한다(anon은 실행 불가).
revoke all on function public.approve_wholesaler_inquiry(uuid, text) from public;
grant execute on function public.approve_wholesaler_inquiry(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) 반려(등록 보류) RPC — public.reject_wholesaler_inquiry(p_inquiry_id, p_admin_note)
-- ---------------------------------------------------------------------------
-- 보안 설계는 승인 함수와 완전히 동일(SECURITY DEFINER + is_admin() 재확인 +
-- search_path 고정 + user_id 인자 없음 + for update 잠금). wholesalers에는
-- 아무것도 만들지 않고, resolved_wholesaler_id는 null로 남겨둔다.
create or replace function public.reject_wholesaler_inquiry(
  p_inquiry_id uuid,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select status into v_status
  from public.wholesaler_inquiries
  where id = p_inquiry_id
  for update;

  if not found then
    raise exception 'INQUIRY_NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'INQUIRY_ALREADY_PROCESSED';
  end if;

  update public.wholesaler_inquiries
  set status = 'rejected',
      admin_note = p_admin_note,
      updated_at = now()
  where id = p_inquiry_id;
end;
$$;

revoke all on function public.reject_wholesaler_inquiry(uuid, text) from public;
grant execute on function public.reject_wholesaler_inquiry(uuid, text) to authenticated;
