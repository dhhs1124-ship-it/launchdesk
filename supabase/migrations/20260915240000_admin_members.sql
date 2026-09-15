-- LaunchDesk 관리자 기능 6단계 — "회원 관리"(읽기 전용).
--
-- 구현 전 실제 코드를 직접 확인한 결과(추측으로 설계하지 않음):
--   - public.profiles 테이블은 이 저장소 어디에도 마이그레이션이 없다.
--     app.js의 유일한 참조(checkProfileRow(), app.js:992-1000)는 진단용
--     콘솔 로그일 뿐이고, 코드 주석에 "테이블 미생성이면 에러가 정상"이라고
--     명시돼 있다 — 즉 profiles가 실제로 존재하는지, 어떤 컬럼이 있는지
--     이 저장소만으로는 확인할 수 없다. 20260915220000_admin_store_read_access.sql
--     마이그레이션도 같은 결론으로 profiles 참조를 피했다.
--   - 따라서 이번 마이그레이션은 profiles를 전혀 참조하지 않는다. 요청된
--     최소 정보(이메일/가입일/최근 로그인/관리자 여부/쇼핑몰 수/Cafe24·Meta
--     연결 여부)는 전부 auth.users(안전한 컬럼만) + public.admin_users +
--     public.stores + public.connected_accounts만으로 충분히 만들 수 있다.
--     profiles가 나중에 실제로 존재하는 것으로 확인되고 표시명 같은 안전한
--     컬럼이 있다면, 그때 이 함수에 컬럼을 추가하는 별도 마이그레이션으로
--     확장하면 된다(지금은 있는지 없는지도 모르는 테이블을 조인하지 않는다).
--
-- 보안 설계(admin_wholesaler_inquiries/admin_wholesaler_management와 동일한 패턴):
--   - 브라우저는 auth.users를 직접 조회할 수 없다(PostgREST는 auth 스키마를
--     노출하지 않고, 이 프로젝트는 애초에 auth 스키마를 API에 노출하지
--     않는다). 유일한 접근 경로는 아래 SECURITY DEFINER 함수 두 개뿐이다.
--   - 두 함수 모두 public.is_admin()으로 호출자 관리자 여부를 먼저 확인하고,
--     아니면 ADMIN_REQUIRED로 예외를 던진다 — 함수 자체가 "이미 관리자로
--     확인된 사람만" 실행할 수 있는 게 아니라, 실행 즉시 스스로 재확인한다.
--   - 인자로 user_id를 받지 않는다 — "내가 아닌 다른 사람 기준으로 관리자
--     행세를 해줘" 같은 요청 자체가 함수 시그니처 수준에서 불가능하다.
--   - auth.users에서는 다음 4개 컬럼만 명시적으로 SELECT한다: id, email,
--     created_at, last_sign_in_at. SELECT *를 쓰지 않는다 — encrypted_password/
--     confirmation_token/recovery_token/email_change_token_*/reauthentication_token/
--     raw_app_meta_data/raw_user_meta_data 등은 이 함수들이 절대 읽지도,
--     반환하지도 않는다.
--   - integration_credentials는 이번에도 참조하지 않는다(토큰/시크릿 테이블).
--   - search_path를 고정한다(SET 절) — DEFINER 함수의 표준 방어.
--   - 새로 만든 함수의 EXECUTE 권한은 기본적으로 PUBLIC(anon 포함)에 자동
--     부여되므로, 명시적으로 회수하고 authenticated에게만 다시 부여한다.
--     anon(비로그인)은 호출해도 is_admin() 내부의 auth.uid()가 null이라
--     즉시 ADMIN_REQUIRED로 막히지만, 방어를 한 겹 더 두기 위해 EXECUTE
--     권한 자체도 authenticated로 제한한다.
--
-- 성능: 회원별로 stores/connected_accounts를 N+1 조회하지 않는다 —
-- admin_list_members() 하나가 LEFT JOIN + GROUP BY로 회원별 집계까지 한
-- 쿼리 안에서 반환한다(Beta 규모인 회원 100~1000명까지는 이 방식으로
-- 충분하고, 클라이언트는 이 결과를 한 번만 받아 검색/필터를 메모리에서
-- 처리한다 — 20260915180000 마이그레이션 이후 stores 섹션과 동일한 패턴).
--
-- 이번 단계는 읽기 전용이다 — 회원 삭제/정지/비밀번호 초기화/이메일 변경/
-- 관리자 권한 부여·해제 관련 함수는 만들지 않는다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- 1) public.admin_member_count() — 관리자 대시보드 "전체 회원" KPI 전용.
--    auth.users의 실제 행 수만 반환한다(개인정보 없이 정수 하나).
-- ---------------------------------------------------------------------------
create or replace function public.admin_member_count()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select count(*) into v_count from auth.users;
  return v_count;
end;
$$;

revoke all on function public.admin_member_count() from public;
grant execute on function public.admin_member_count() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) public.admin_list_members() — 관리자 "회원" 섹션 목록 전용.
--    회원별로 안전한 auth.users 컬럼 + 관리자 여부 + 쇼핑몰/연동 집계를
--    한 번에 반환한다. 검색/필터/페이지네이션은 클라이언트가 이 결과를
--    받은 뒤 메모리에서 처리한다(Beta 규모에서는 별도 서버측 검색 파라미터가
--    필요 없다 — stores 섹션과 동일한 판단).
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_members()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_admin boolean,
  store_count bigint,
  cafe24_count bigint,
  meta_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
  select
    u.id as user_id,
    u.email::text as email,
    u.created_at,
    u.last_sign_in_at,
    (au.user_id is not null) as is_admin,
    coalesce(agg.store_count, 0::bigint) as store_count,
    coalesce(agg.cafe24_count, 0::bigint) as cafe24_count,
    coalesce(agg.meta_count, 0::bigint) as meta_count
  from auth.users u
  left join public.admin_users au on au.user_id = u.id
  left join (
    select
      st.user_id as user_id,
      count(distinct st.id) as store_count,
      count(distinct ca.id) filter (
        where ca.provider = 'cafe24' and ca.status = 'connected'
      ) as cafe24_count,
      count(distinct ca.id) filter (
        where ca.provider = 'meta' and ca.status = 'connected'
      ) as meta_count
    from public.stores st
    left join public.connected_accounts ca on ca.store_id = st.id
    group by st.user_id
  ) agg on agg.user_id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_members() from public;
grant execute on function public.admin_list_members() to authenticated;
