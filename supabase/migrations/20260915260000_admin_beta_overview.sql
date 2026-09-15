-- LaunchDesk 관리자 기능 7단계 — "Beta 사용자 현황"(읽기 전용, 1차 범위).
--
-- 구현 전 실제 코드/DB 사용 구조를 확인한 결과(추측으로 설계하지 않음):
--   - 전체 회원 수: public.admin_member_count() (20260915240000_admin_members.sql)
--     가 이미 auth.users를 SECURITY DEFINER로 안전하게 세고 있다. 이번
--     함수는 그 함수를 중복 구현하지 않고, 같은 계산(select count(*) from
--     auth.users)을 이 함수 내부에도 한 번 더 직접 둔다 — admin_beta_overview()
--     자체가 여러 지표를 "한 번의 RPC 호출"로 묶어 반환하는 게 목적이라
--     (요구사항 3), 다른 RPC를 내부에서 다시 호출하는 것보다 같은 트랜잭션
--     안에서 직접 집계하는 편이 더 단순하고 일관적이다(집계 시점이 같은
--     스냅샷이라는 것도 보장된다).
--   - stores: user_id, id 컬럼 확인(20260915220000_admin_store_read_access.sql
--     주석 및 stores.js fetchStores 실사용 컬럼 기준). "쇼핑몰 등록 사용자
--     수"는 stores 행 수가 아니라 count(distinct stores.user_id)로 계산한다
--     (요구사항 1 — 한 사용자가 쇼핑몰을 여러 개 등록해도 1명으로 센다).
--   - connected_accounts: store_id, provider, status 컬럼 확인. status는
--     실제로 'connected'/'pending' 두 값만 쓰인다(20260915220000 마이그레이션
--     조사 결과 재확인 — cafe24-oauth-callback/meta-oauth-callback/
--     meta-account-select Edge Function 전체 기준). "Cafe24/Meta 연결 사용자
--     수"는 provider별로 status='connected'인 행이 있는 stores.user_id를
--     distinct로 센다.
--   - 수정(순차 퍼널 보정): users_with_meta는 users_with_cafe24와 독립적으로
--     집계되므로, "Meta 연결"을 Cafe24 연결의 하위 단계처럼 순차 퍼널에
--     그대로 이어붙이면 같은 user_id가 Cafe24는 연결하지 않고 Meta만
--     연결한 경우까지 포함돼 "직전 단계 대비 전환율"이 100%를 넘을 수
--     있다(퍼널의 각 단계가 이전 단계의 부분집합이라는 전제가 깨짐).
--     그래서 users_with_cafe24_and_meta(동일 user_id가 Cafe24 status=
--     'connected'이면서 동시에 Meta status='connected'인 distinct 사용자
--     수)를 추가했다 — 이 값은 정의상 users_with_cafe24의 부분집합이므로
--     순차 퍼널의 마지막 단계로 쓸 수 있다. 기존 users_with_meta는 삭제하지
--     않고 "Meta 연결 사용자"라는 독립 참고 지표로 그대로 남긴다.
--   - orders: 이 저장소에 orders를 생성하는 마이그레이션 파일이 없다(다른
--     핵심 테이블 stores/connected_accounts와 마찬가지로 프로젝트 초기에
--     Studio에서 직접 만들어졌을 가능성 — 20260915220000 마이그레이션의
--     선례와 동일한 상황). 실사용 컬럼은 cafe24-orders-sync/index.ts의 upsert
--     대상(supabase/functions/cafe24-orders-sync/index.ts:300-329)과
--     ops-overview.js의 select(store_id, ordered_at, payment_amount)로 확인:
--     store_id, provider, external_order_id, ordered_at, order_status,
--     currency, order_amount, payment_amount, raw_data, updated_at.
--     **orders에는 user_id 컬럼이 없다** — "주문이 있는 사용자"는 반드시
--     orders.store_id -> stores.id -> stores.user_id 조인으로만 판단할 수
--     있고, 이 조인 경로는 명확하므로(모호하지 않음) users_with_orders를
--     이번 1차에 포함한다. 다만 이 값은 "Cafe24 연결 상태와 무관하게 그
--     사용자의 쇼핑몰에 주문 데이터가 한 번이라도 동기화된 적이 있는가"만
--     의미한다 — "지금 Cafe24가 연결돼 있고 + 주문도 있다"처럼 두 조건을
--     동시에 요구하지 않는다(연결이 끊겼더라도 과거 동기화된 주문 데이터는
--     남아있을 수 있으므로, 두 조건을 AND로 묶으면 오히려 실제보다 과소
--     집계될 수 있다). 이 값은 "Activation" 수치가 아니다 — 작업 보고서
--     참고(사용자가 그 데이터를 실제로 "확인"했는지는 이 DB로 판단할 수
--     없다).
--   - 수정(provider 오염 방지): users_with_orders는 orders.provider = 'cafe24'
--     조건을 명시적으로 추가했다 — orders는 위에서 이미 확인했듯 provider
--     컬럼을 갖고 있고, cafe24-orders-sync/index.ts:304,338이 실제로
--     provider: "cafe24"로 채우고 있다(unique 제약도 store_id, provider,
--     external_order_id 조합). 지금은 orders를 채우는 sync가 cafe24-orders-sync
--     하나뿐이라 필터 유무와 결과가 같지만, 앞으로 SmartStore 등 다른
--     provider가 orders에 추가되면 필터 없이는 이 지표가 "Cafe24 주문
--     데이터가 있는 사용자"가 아니라 "아무 provider든 주문이 있는 사용자"로
--     조용히 의미가 바뀐다 — 그래서 지금 명시적으로 필터해 지표 이름
--     그대로("Cafe24 주문 데이터가 존재하는 사용자")의 의미를 고정한다.
--     없다).
--   - user_step_progress: 존재하지만(app.js/store.js가 로드맵 STEP 진행
--     상태 저장에 사용) 이번 1차 Beta 지표(가입/쇼핑몰/Cafe24/Meta)에는
--     필요하지 않아 이번 함수는 참조하지 않는다.
--   - GA4(gtag)는 app.js/setup.js/tools.js에 존재하지만(page_view,
--     chapter_start/complete, setup_form_complete, margin_calculator_use 등)
--     전부 브라우저에서 Google Analytics로 직접 전송될 뿐 Supabase DB에
--     저장되지 않는다 — 이 RPC(또는 어떤 서버측 코드)로도 조회할 수 없다.
--     docs/plans/beta-30-day-validation.md에 설계된 dashboard_viewed 등의
--     이벤트는 그 문서 자체에 "상태: 실행 계획 문서. 코드/화면은 이 문서로
--     변경하지 않는다"라고 명시돼 있고, 실제로 코드 어디에도 구현되어
--     있지 않다(grep 결과 없음) — 따라서 7일 재방문 등은 이번 함수에
--     포함하지 않는다(작업 보고서에 별도 설계 제안만 남긴다).
--
-- 보안 설계(admin_members/admin_wholesaler_* 와 동일한 패턴):
--   - SECURITY DEFINER + public.is_admin() 재확인(아니면 ADMIN_REQUIRED
--     예외) + search_path 고정.
--   - 인자 없음 — 다른 사용자를 지정해서 조회하는 방식 자체가 불가능하다.
--   - SELECT *를 쓰지 않는다 — 전부 count(*)/count(distinct ...) 집계값만
--     반환하고, 개별 회원 행이나 auth.users의 다른 컬럼은 전혀 반환하지
--     않는다(이메일조차 반환하지 않는다 — 이 화면은 집계 숫자만 필요).
--   - integration_credentials는 참조하지 않는다.
--   - PUBLIC EXECUTE는 회수하고 authenticated에게만 재부여한다.
--
-- 이번 단계도 읽기 전용이다. 주의: 이 파일은 아직 원격 DB에 적용되지
-- 않았다. 검토 후 별도로 배포한다.

create or replace function public.admin_beta_overview()
returns table (
  total_users bigint,
  users_with_store bigint,
  users_with_cafe24 bigint,
  users_with_cafe24_and_meta bigint,
  users_with_meta bigint,
  users_with_orders bigint
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
    (select count(*) from auth.users) as total_users,

    (select count(distinct st.user_id)
       from public.stores st) as users_with_store,

    (select count(distinct st.user_id)
       from public.stores st
       join public.connected_accounts ca on ca.store_id = st.id
       where ca.provider = 'cafe24' and ca.status = 'connected') as users_with_cafe24,

    -- 순차 퍼널의 마지막 단계 — 반드시 users_with_cafe24의 부분집합이
    -- 되도록 두 provider의 "연결된 user_id 집합"을 INTERSECT한다(같은
    -- 사용자가 Cafe24 없이 Meta만 연결한 경우는 제외).
    (select count(*) from (
      select st.user_id
        from public.stores st
        join public.connected_accounts ca on ca.store_id = st.id
        where ca.provider = 'cafe24' and ca.status = 'connected'
      intersect
      select st.user_id
        from public.stores st
        join public.connected_accounts ca on ca.store_id = st.id
        where ca.provider = 'meta' and ca.status = 'connected'
    ) both_connected) as users_with_cafe24_and_meta,

    -- 순차 퍼널에는 쓰지 않는 독립 참고 지표 — Cafe24 연결 여부와 무관하게
    -- Meta만 연결한 사용자도 포함된다.
    (select count(distinct st.user_id)
       from public.stores st
       join public.connected_accounts ca on ca.store_id = st.id
       where ca.provider = 'meta' and ca.status = 'connected') as users_with_meta,

    -- Cafe24 연결 상태(현재 connected 여부)와는 무관하게, 그 사용자의
    -- 쇼핑몰에 "Cafe24" 주문 데이터가 한 번이라도 동기화된 적이 있는지만
    -- 본다(위 조사 코멘트 참고 — Activation 수치 아님). orders.provider로
    -- 명시적으로 필터한다 — 지금은 cafe24-orders-sync만 orders를 채우므로
    -- 필터 없이도 결과가 같지만, 향후 SmartStore 등 다른 provider가 orders에
    -- 추가되면 필터가 없을 경우 이 지표가 "Cafe24 주문 데이터가 있는
    -- 사용자"가 아니라 "아무 provider든 주문이 있는 사용자"로 조용히
    -- 의미가 바뀌어버린다. 그 오염을 지금 미리 차단해둔다.
    (select count(distinct st.user_id)
       from public.stores st
       join public.orders o on o.store_id = st.id
       where o.provider = 'cafe24') as users_with_orders;
end;
$$;

revoke all on function public.admin_beta_overview() from public;
grant execute on function public.admin_beta_overview() to authenticated;
