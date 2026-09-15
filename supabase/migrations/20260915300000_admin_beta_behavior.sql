-- LaunchDesk 내부 행동 이벤트 추적 2단계 — 관리자 "최근 사용 현황" 집계
-- RPC(admin_beta_behavior_overview()). product_events(20260915280000)를
-- 전제로 한다.
--
-- 2026-09-15 Fable 최종 감사 반영: 최초 작성 버전에서 아래를 수정했다
-- (원격 DB에 한 번도 적용된 적 없는 파일이라 별도 fix-up 마이그레이션을
-- 만들지 않고 이 파일 자체를 고쳤다).
--   1) roadmap_completed_users를 product_events(event_name='roadmap_
--      completed') 대신 public.user_step_progress(canonical 상태)로
--      계산하도록 바꿨다 — 아래 "roadmap_completed_users 계산 방식" 섹션
--      참고. product_events의 roadmap_completed allowlist 항목 자체를
--      20260915280000 마이그레이션에서 제거했다.
--   2) admin_beta_behavior_overview()의 EXECUTE 권한에서 anon을 명시적으로
--      한 번 더 REVOKE했다(PUBLIC revoke만으로는 프로젝트 기본 설정에
--      따라 anon에 직접 부여된 권한이 남을 수 있어서).
--
-- ---------------------------------------------------------------------------
-- 무엇을 세는가(요구사항 8·9 그대로)
-- ---------------------------------------------------------------------------
--   - dashboard_users_7d          — 최근 7일 동안 dashboard_viewed가 1번
--     이상 있는 distinct user 수(product_events 기준).
--   - dashboard_returning_users_7d — 위 사용자 중, 최근 7일 동안 서로 다른
--     "날짜"에 dashboard_viewed가 2일 이상 있는 distinct user 수
--     (product_events 기준).
--   - roadmap_started_users        — roadmap_started가 1번이라도 있는
--     distinct user 수(product_events 기준, 기간 제한 없음 — 누적 지표).
--   - roadmap_completed_users      — STEP01~07 7개 gated step_path가 전부
--     is_completed=true인 distinct user 수(user_step_progress 기준, 아래
--     섹션 참고. product_events가 아니다).
-- 반복 방문율(returning/visitors)은 여기서 계산하지 않는다 — 분모가 0일 때
-- 처리, 반올림 자리수, 표기 형식(정수면 소수점 생략)을 admin_beta_overview()
-- 와 이미 완전히 동일한 규칙으로 admin.js의 formatBetaPercent()가 하고
-- 있으므로, SQL과 JS 두 곳에 같은 반올림 로직을 중복시키지 않고 원시
-- 카운트 4개만 반환한다(기존 admin_beta_overview() 응답 스타일과 동일).
--
-- ---------------------------------------------------------------------------
-- roadmap_completed_users 계산 방식 — product_events가 아니라 canonical
-- 상태(user_step_progress)를 쓰는 이유
-- ---------------------------------------------------------------------------
-- 로드맵 완료 여부는 이미 user_step_progress.is_completed가 canonical하게
-- 갖고 있는 사실이다(app.js/store.js가 STEP별로 upsert). 처음에는 이것도
-- product_events 이벤트(roadmap_completed)로 따로 기록했었지만, 감사 결과
-- app.js의 setChapterDone()을 거치지 않고 completed 상태가 바뀌는 경로가
-- 여럿 있다는 게 확인됐다:
--   - 게스트로 STEP01~07을 전부 마친 뒤 로그인 → 게스트 스냅샷 병합
--     (mergeGuestSnapshotToAccount, app.js)이 user_step_progress에 직접
--     upsert한다. 로드맵은 로그인 없이도 쓸 수 있는 핵심 후크라 이 경로가
--     흔하다.
--   - reconcileCompletedChapters()의 보정 upsert(DOM 재평가 결과가 저장된
--     완료 목록과 어긋날 때).
--   - 이 기능 배포 이전에 이미 로드맵을 완료한 기존 사용자, 다른 기기에서
--     완료한 사용자.
-- 이 경로들에서는 이벤트가 찍히지 않으므로, "이벤트 존재 여부"로 완료를
-- 판단하면 실제로 완료한 사용자를 체계적으로 과소 집계한다. 반면
-- user_step_progress는 완료 방식(체크박스/워크시트/병합/보정)과 무관하게
-- 항상 정확한 최종 상태를 갖고 있으므로, 이 지표는 그쪽으로 계산한다 —
-- "canonical 상태가 이미 갖고 있는 사실을 행동 이벤트로 다시 만들지
-- 않는다"는 이번 작업의 0번 원칙을 완료 지표에도 그대로 적용한 것이다.
--
-- GATED_STEPS(app.js)와 반드시 같은 7개 경로를 유지해야 한다 — STEP01~07
-- 구성이 바뀌면(추가/삭제/이름 변경) 이 배열도 함께 수정해야 한다:
--   /start/prepare, /start/setup, /start/sourcing, /start/content,
--   /start/orders, /start/marketing-setup, /start/marketing
-- (STEP00 /start/intro, STEP08 /start/wrapup은 게이트 없는 소개/마무리
-- 화면이라 제외 — app.js의 STEP_ROADMAP/GATED_STEPS와 동일한 기준.)
--
-- ---------------------------------------------------------------------------
-- "최근 7일"과 "날짜"의 기준 — 서로 다른 기준을 섞어 쓴다(의도적)
-- ---------------------------------------------------------------------------
--   - "최근 7일" 자체의 시작점은 now() - interval '7 days'(rolling 7×24시간)
--     이다. 달력상의 "이번 주" 같은 KST 자정 경계가 아니다 — 예를 들어
--     지금이 한국시간 15일 오후 3시라면, 창은 8일 오후 3시부터다. 이렇게
--     하면 "이 RPC를 지금 호출했을 때 보이는 값"이 하루 중 언제 호출해도
--     일관되게 "지금부터 정확히 7일 전까지"를 의미한다(자정 직후에 호출하면
--     경계 하루가 통째로 빠지거나 더해지는 혼란이 없다).
--   - 그 창 안에서 "서로 다른 날짜에 방문했는가"(반복 방문 판정)를 셀 때는
--     UTC 달력일이 아니라 Asia/Seoul 달력일 기준으로 나눈다 — LaunchDesk
--     주 사용자 환경이 한국이고, ops-overview.js/cafe24-orders-sync가 이미
--     "오늘/이번 달" 판정에 KST 기준(kstBoundary/toKstDateString)을 쓰고
--     있는 것과 같은 이유다(UTC 자정 기준으로 나누면 한국 시간 밤 9시~자정
--     사이의 방문이 실제 체감 날짜와 다른 날짜로 잘못 갈릴 수 있다). DB
--     저장 자체는 계속 UTC(timestamptz)로 유지하고, 집계 시점에만
--     `created_at at time zone 'Asia/Seoul'`로 변환해 날짜를 나눈다 —
--     기존 kstBoundary()와 동일한 결과를 SQL로 낸 것뿐, 저장 방식은 전혀
--     바꾸지 않는다.
--
-- ---------------------------------------------------------------------------
-- 관리자 계정 제외
-- ---------------------------------------------------------------------------
-- 담당자 본인이 테스트하며 남긴 행동이 Beta 사용자 지표를 오염시키지
-- 않도록, admin_users에 등록된 user_id는 이 RPC의 모든 집계(product_events
-- 기반 2개 + user_step_progress 기반 1개 전부)에서 제외한다(요구사항 14).
--
-- 주의(범위 제한 — 임의로 넓히지 않음): 이 제외는 이번에 새로 만드는 이
-- RPC(행동 지표)에만 적용한다. 기존 admin_beta_overview()(가입/쇼핑몰/
-- Cafe24/Meta 캐노니컬 퍼널)는 요구사항 10에서 "그대로 유지"라고 명시했고,
-- 관리자 계정 제외 여부에 대한 명시적 요청도 없었으므로 이번 마이그레이션은
-- 그 함수를 전혀 수정하지 않는다 — 캐노니컬 퍼널의 total_users 등은 지금과
-- 동일하게 관리자 계정을 포함한 전체 회원 수를 계속 의미한다. 이 모수 차이는
-- admin.js UI 문구로 안내한다(코드 아님).
--
-- localhost/개발 환경 오염 방지는 DB가 아니라 클라이언트(product-events.js)
-- 쪽 책임이다 — product-events.js는 알려진 프로덕션 운영 도메인
-- (launchdesk.co.kr / www.launchdesk.co.kr)에서만 track_product_event()를
-- 호출하므로, 그 외 호스트(localhost/LAN IP/미리보기·스테이징/file:// 등)
-- 에서 발생한 이벤트는 애초에 이 테이블에 들어오지 않는다. user_step_
-- progress 기반 roadmap_completed_users는 이 필터의 영향을 받지 않지만
-- (product_events가 아니므로), 그건 오염원이 아니다 — user_step_progress는
-- 실제 로그인 세션의 진짜 진행 상태이지 개발 환경에서만 발생하는 부산물이
-- 아니다. 그래서 이 RPC는 "환경" 구분 컬럼/필터를 두지 않는다(요구사항 17
-- — 필요 이상의 인프라를 만들지 않음).
--
-- ---------------------------------------------------------------------------
-- 보안 설계 — admin_beta_overview()/admin_member_count()와 동일한 패턴
-- ---------------------------------------------------------------------------
--   - SECURITY DEFINER + public.is_admin() 재확인(아니면 ADMIN_REQUIRED).
--   - 인자 없음 — 다른 사용자 기준으로 조회하는 방식 자체가 불가능하다.
--   - distinct user 집계값만 반환한다 — 개별 이벤트 행, user_id 목록,
--     properties 등 원시 로그는 전혀 반환하지 않는다(요구사항 4·15 — 원시
--     행동 로그를 관리자 UI에 무작정 내려주지 않는다).
--   - search_path 고정. PUBLIC EXECUTE 회수 + anon을 한 번 더 명시적으로
--     회수한 뒤(2026-09-15 감사 반영 — 프로젝트 기본 권한 설정과 무관하게
--     항상 차단) authenticated에게만 재부여한다.
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

create or replace function public.admin_beta_behavior_overview()
returns table (
  dashboard_users_7d bigint,
  dashboard_returning_users_7d bigint,
  roadmap_started_users bigint,
  roadmap_completed_users bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := now() - interval '7 days';
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
  with recent_dashboard_views as (
    select
      pe.user_id,
      (pe.created_at at time zone 'Asia/Seoul')::date as kst_date
    from public.product_events pe
    where pe.event_name = 'dashboard_viewed'
      and pe.created_at >= v_window_start
      and pe.user_id not in (select au.user_id from public.admin_users au)
  ),
  per_user_days as (
    select user_id, count(distinct kst_date) as distinct_days
    from recent_dashboard_views
    group by user_id
  ),
  -- STEP01~07(app.js GATED_STEPS와 반드시 같은 7개 경로 — 위 설명 참고).
  roadmap_gated_steps as (
    select unnest(array[
      '/start/prepare', '/start/setup', '/start/sourcing', '/start/content',
      '/start/orders', '/start/marketing-setup', '/start/marketing'
    ]) as step_path
  ),
  roadmap_completed_per_user as (
    select usp.user_id
    from public.user_step_progress usp
    join roadmap_gated_steps gs on gs.step_path = usp.step_path
    where usp.is_completed = true
      and usp.user_id not in (select au.user_id from public.admin_users au)
    group by usp.user_id
    -- 7개 gated step_path 전부 is_completed=true인 행이 있어야만
    -- "완료"다 — distinct step_path 개수가 전체 gated step 개수와 같은지로
    -- 판정한다(하드코딩된 7이 아니라 위 CTE의 실제 행 수와 비교해, 이
    -- 배열이 나중에 수정돼도 이 HAVING이 자동으로 맞는 개수를 쓴다).
    having count(distinct usp.step_path) = (select count(*) from roadmap_gated_steps)
  )
  select
    (select count(*) from per_user_days) as dashboard_users_7d,
    (select count(*) from per_user_days where distinct_days >= 2) as dashboard_returning_users_7d,
    (select count(distinct pe.user_id)
       from public.product_events pe
       where pe.event_name = 'roadmap_started'
         and pe.user_id not in (select au.user_id from public.admin_users au)) as roadmap_started_users,
    (select count(*) from roadmap_completed_per_user) as roadmap_completed_users;
end;
$$;

revoke all on function public.admin_beta_behavior_overview() from public;
-- PUBLIC에서 회수해도 anon에 "직접" 부여된 권한(프로젝트 기본 설정에 따라
-- 생길 수 있음)은 별도로 남을 수 있어, anon을 한 번 더 명시적으로
-- 회수한다(2026-09-15 감사 반영).
revoke execute on function public.admin_beta_behavior_overview() from anon;
grant execute on function public.admin_beta_behavior_overview() to authenticated;
