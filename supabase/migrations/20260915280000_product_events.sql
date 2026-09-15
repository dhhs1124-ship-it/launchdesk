-- LaunchDesk 내부 행동 이벤트 추적 1단계 — product_events 테이블 +
-- track_product_event() RPC.
--
-- 2026-09-15 Fable 최종 감사 반영: 최초 작성 버전에서 아래를 수정했다
-- (원격 DB에 한 번도 적용된 적 없는 파일이라 별도 fix-up 마이그레이션을
-- 만들지 않고 이 파일 자체를 고쳤다).
--   1) roadmap_completed를 allowlist에서 뺐다 — 이유는 아래 "설계 원칙"
--      섹션 및 20260915300000_admin_beta_behavior.sql 참고(canonical
--      상태인 user_step_progress로만 판단, 이벤트로 다시 만들지 않음).
--   2) p_properties 인자를 RPC에서 완전히 제거했다 — 실제 instrumentation
--      (app.js)이 어떤 이벤트에도 부가 메타데이터를 쓰지 않으므로,
--      브라우저가 임의 JSON을 보낼 길 자체를 없애 PII 오염 가능성을
--      원천 차단한다(요구사항 6). properties 컬럼 자체는 미래 확장을
--      위해 테이블에 남겨두되(기본값 '{}'), 지금은 어떤 RPC 인자로도
--      채울 수 없다 — service_role(Supabase Studio)만 채울 수 있다.
--   3) event_name CHECK 제약에 이름을 명시했다(product_events_event_name_
--      allowlist) — 이름 없이 만들면 자동 생성된 이름을 나중에 alter할
--      때 매번 확인해야 해서, 향후 allowlist 확장(예: meta_insights_viewed
--      추가)이 `alter table ... drop constraint product_events_event_name_
--      allowlist, add constraint ... check (...)` 한 문장으로 안전하게
--      가능하도록 미리 이름을 붙였다.
--   4) 테이블에 대한 anon/authenticated 권한을 "애초에 GRANT 안 함"에
--      더해 명시적으로 REVOKE했다 — 이 프로젝트가 아니라 Supabase
--      프로젝트 설정(ALTER DEFAULT PRIVILEGES로 새 테이블에 자동 GRANT하는
--      옵션)에 따라서는 "GRANT를 안 준다"만으로는 부족할 수 있어서,
--      프로젝트 기본값과 무관하게 항상 차단되도록 명시했다.
--   5) track_product_event()에 대해서도 PUBLIC revoke(기존)에 더해
--      anon을 명시적으로 다시 revoke했다 — PUBLIC에 준 권한을 revoke해도
--      anon에 "직접" 부여된 권한(역시 프로젝트 기본 설정에 따라 생길 수
--      있음)은 별도로 남을 수 있기 때문이다.
--
-- ---------------------------------------------------------------------------
-- 설계 원칙 — "상태"와 "행동"을 섞지 않는다
-- ---------------------------------------------------------------------------
-- 회원가입(auth.users)/쇼핑몰 등록(stores)/Cafe24·Meta 연결(connected_accounts)/
-- 주문 존재(orders)/로드맵 완료(user_step_progress.is_completed)는 이미
-- canonical DB가 답을 갖고 있는 "상태"다. 이 테이블로 그 사실들을 다시
-- 만들지 않는다(admin_beta_overview()는 상태만으로, admin_beta_behavior_
-- overview()의 roadmap_completed_users도 user_step_progress로만 계산하고,
-- 이번 마이그레이션은 그 함수들을 전혀 건드리지 않는다). product_events는
-- 오직 "사용자가 실제로 무엇을 했는가"—현재 DB 상태만으로는 알 수 없는
-- 행동 사실—만 기록한다. 이번 allowlist는 다음 2개뿐이다:
--   - dashboard_viewed — 로그인 사용자가 실제 운영 대시보드(/tools의
--     "쇼핑몰 운영 현황" 패널)에 진입한 시점(app.js render() 계측)
--   - roadmap_started  — 로드맵의 실제 STEP(STEP01~07, 소개/마무리 화면
--     제외) 중 어느 것이든 처음 진입한 시점(app.js render() 계측)
-- roadmap_completed는 의도적으로 넣지 않는다 — "완료"는 이미 canonical
-- 상태(user_step_progress.is_completed)가 정확히 답을 갖고 있고, 이벤트로
-- 따로 기록하면 게스트로 완료 후 로그인 병합/재조정(reconcileCompleted
-- Chapters) 등 setChapterDone()을 거치지 않는 경로에서 누락돼 canonical
-- 상태와 어긋나는 "두 번째 진실의 원천"이 생긴다(요구사항 0 정면 위반).
-- meta_insights_viewed도 포함하지 않는다 — 이 브랜치 어디에도 실제 Meta
-- Insights 조회 화면이 없다(stores.js/index.html/supabase/functions 전체
-- 확인, "insight" 문자열 매치 0건). 화면이 실제로 생길 때 allowlist에
-- 한 줄 추가하는 별도 마이그레이션으로 확장한다.
--
-- GA4(gtag)는 이 테이블과 완전히 별개로 계속 그대로 둔다(app.js의
-- page_view/chapter_start/chapter_complete, setup.js/tools.js의 자체
-- 이벤트) — 이번 마이그레이션도, 이후 클라이언트 계측도 기존 gtag() 호출을
-- 하나도 제거·변경하지 않는다. GA4는 마케팅/웹 분석, 이 테이블은 제품
-- 활성화·재방문·관리자 집계라는 별도 목적을 유지한다.
--
-- ---------------------------------------------------------------------------
-- 보안 설계
-- ---------------------------------------------------------------------------
--   - authenticated/anon 모두 이 테이블에 대한 GRANT를 받지 않을 뿐 아니라,
--     명시적으로 REVOKE도 해둔다(아래) — Supabase 프로젝트의 기본 권한
--     설정(auto_expose_new_tables류 옵션)과 무관하게 항상 직접 접근이
--     막히게 하기 위함이다(admin_users 마이그레이션 주석의 교훈과 같은
--     축: GRANT가 없으면 RLS와 무관하게 PostgREST가 401을 반환한다). RLS도
--     활성화해두지만, 실제 방어의 핵심은 GRANT 자체가 없다는 점이다 —
--     유일한 쓰기 경로는 track_product_event() RPC 하나뿐이다.
--   - track_product_event()는 SECURITY DEFINER를 쓴다(다른 관리자 RPC와
--     같은 이유는 아니다 — 여기서 DEFINER가 필요한 이유는 "authenticated가
--     이 테이블에 직접 쓸 수 있는 길 자체를 완전히 없애고, 검증(allowlist/
--     auth.uid() 강제)을 이 함수 하나로만 강제하기 위해서"다. INVOKER로
--     만들려면 authenticated에게 최소 "자기 user_id로만 INSERT" RLS
--     정책을 줘야 하는데, 그러면 이 함수를 거치지 않고 브라우저에서
--     .from('product_events').insert(...)를 직접 호출해 event_name
--     allowlist를 우회할 수 있다 — 이번 설계 요구사항(허용하지 않은
--     event_name 거부)과 정면으로 충돌한다. 그래서 DEFINER가 필요하다고
--     판단했다.) 함수 내부에서:
--       · auth.uid()가 null이면 즉시 예외(AUTH_REQUIRED) — 비로그인 사용자
--         기록 대상 제외.
--       · user_id 인자를 아예 받지 않는다 — auth.uid()만 쓴다(다른 사람
--         명의로 기록하는 요청 자체가 시그니처 수준에서 불가능).
--       · event_name이 allowlist 밖이면 즉시 예외(INVALID_EVENT_NAME).
--       · properties 인자를 아예 받지 않는다 — 브라우저가 임의 JSON을
--         보낼 길 자체가 없다(위 "2026-09-15 감사 반영" 참고).
--       · search_path를 고정한다(SET 절) — DEFINER 함수의 표준 방어.
--   - created_at은 컬럼 기본값(now())만 쓴다 — RPC 인자에도, INSERT 문에도
--     이 값을 넘길 방법이 없으므로 브라우저가 임의로 지정할 수 없다.
--   - PII/시크릿 금지: user_id(uuid) 외에는 이메일/전화번호/토큰/credential을
--     저장할 컬럼 자체가 없다. properties 컬럼은 남겨두지만(미래 확장 대비,
--     기본값 '{}') 이 RPC로는 채울 수 없으므로 지금 저장되는 값은 항상
--     빈 객체다.
--   - route도 200자로 잘라 저장한다(위치 정보 정도의 용도이지 자유 텍스트
--     저장용이 아님).
--   - PUBLIC EXECUTE는 회수하고, anon도 다시 한번 명시적으로 회수한 뒤
--     authenticated에게만 재부여한다. service_role은 Supabase 내부 role이라
--     이 GRANT와 무관하게 항상 실행 가능하지만, 이 프로젝트의 모든 브라우저
--     코드는 publishable(anon) key만 쓰므로 service_role이 브라우저에서
--     이 함수를 호출할 일은 없다.
--
-- 성능: 최근 7일 조회(user_id/event_name/created_at)와 이벤트별 distinct
-- user 집계(event_name/created_at) 두 패턴만 필요하므로 인덱스도 그
-- 두 개만 만든다(요구사항 16 — 과도한 인덱스 지양, Beta 규모 100~1000
-- 사용자 기준으로 이 두 개면 충분하다).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 별도로 배포한다.

-- ---------------------------------------------------------------------------
-- 1) product_events
-- ---------------------------------------------------------------------------
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null constraint product_events_event_name_allowlist check (event_name in (
    'dashboard_viewed',
    'roadmap_started'
  )),
  -- 브라우저 탭/세션 단위 식별자(sessionStorage 기반, product-events.js
  -- 참고) — 로그인 사용자 식별은 user_id가 전담하므로 session_id는 "같은
  -- 방문 안에서 일어난 이벤트를 묶어보는" 보조 정보일 뿐이다. null 허용.
  session_id uuid,
  -- 이벤트 발생 시점의 해시 라우트(예: '/tools') — 자유 텍스트 아님, 200자로
  -- 방어적으로 제한(아래 CHECK). null 허용(라우트와 무관한 이벤트 대비).
  route text constraint product_events_route_length check (route is null or char_length(route) <= 200),
  -- 미래 확장용으로만 남겨둔 컬럼 — track_product_event() RPC는 이 컬럼을
  -- 채우는 인자를 받지 않으므로(2026-09-15 감사 반영), 지금은 항상
  -- 기본값(빈 객체)만 저장된다. service_role(Supabase Studio)로 직접
  -- 채우는 경우에 대비해 크기 제한 CHECK만 방어적으로 남겨둔다.
  properties jsonb not null default '{}'::jsonb
    constraint product_events_properties_size check (pg_column_size(properties) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists product_events_user_event_created_idx
  on public.product_events (user_id, event_name, created_at);
create index if not exists product_events_event_created_idx
  on public.product_events (event_name, created_at);

alter table public.product_events enable row level security;
-- 의도적으로 정책을 하나도 만들지 않는다 — authenticated/anon 둘 다 이
-- 테이블에 대한 GRANT 자체가 없으므로(아래), RLS 정책이 있어도 도달할 수
-- 없다. 그래도 "이 테이블은 절대 직접 접근 대상이 아니다"라는 의도를
-- 명시하기 위해 RLS는 켜둔다.

-- 이 테이블에는 authenticated/anon 어느 role에도 어떤 권한(SELECT/INSERT/
-- UPDATE/DELETE)도 주지 않는다 — 유일한 접근 경로는 아래 RPC뿐이다. 새로
-- 만든 테이블은 기본적으로 이 두 role에 아무 권한도 없지만, 이 프로젝트의
-- 실제 기본 권한 설정과 무관하게 항상 차단되도록 명시적으로 한 번 더
-- REVOKE한다(2026-09-15 감사 반영 — 프로젝트 기본 설정에 auto-grant가
-- 켜져 있어도 이 문장이 그걸 되돌린다).
revoke all on table public.product_events from anon, authenticated;

-- (참고: service_role은 Supabase 내부 role이라 이 REVOKE 구문과 무관하게
-- 항상 전체 접근 가능하다 — 이는 Postgres/Supabase의 기본 동작이고, 이
-- 프로젝트 브라우저 코드는 service_role 키를 쓰지 않는다.)

-- ---------------------------------------------------------------------------
-- 2) track_product_event() — 유일한 쓰기 경로
-- ---------------------------------------------------------------------------
create or replace function public.track_product_event(
  p_event_name text,
  p_session_id uuid default null,
  p_route text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_event_name is null or p_event_name not in (
    'dashboard_viewed', 'roadmap_started'
  ) then
    raise exception 'INVALID_EVENT_NAME';
  end if;

  insert into public.product_events (user_id, event_name, session_id, route)
  values (v_user_id, p_event_name, p_session_id, left(p_route, 200));
end;
$$;

revoke all on function public.track_product_event(text, uuid, text) from public;
-- PUBLIC에서 회수해도 anon에 "직접" 부여된 권한(프로젝트 기본 설정에 따라
-- 생길 수 있음)은 별도로 남을 수 있어, anon을 한 번 더 명시적으로
-- 회수한다(2026-09-15 감사 반영).
revoke execute on function public.track_product_event(text, uuid, text) from anon;
grant execute on function public.track_product_event(text, uuid, text) to authenticated;
