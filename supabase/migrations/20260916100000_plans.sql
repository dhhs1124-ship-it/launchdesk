-- LaunchDesk "계획(plans)" — 마진 계산기 결과를 실행 계획으로 저장하고
-- 재확인일에 홈에서 다시 확인하는 베타 최소 기능의 저장소.
--
-- 왜 tool_records를 확장하지 않고 별도 테이블인가:
--   tool_records(margin_calc)는 "최근 5개만 메모리에 유지 · 전체 삭제 ·
--   insert만" 하는 기록 수명주기를 갖는다(store.js hydrate/clearCalcHistory).
--   계획은 행 단위 수정(실행 여부·메모·재확인일·완료)과 날짜순 조회가
--   필요해 수명주기가 완전히 다르다. 별도 테이블로 두면 기존 기록 로직과
--   미커밋 계산기 작업(store.js/tools.js)에 손대지 않고, "전체 지우기"로
--   계산 기록을 지워도 계획은 영향받지 않는다.
--
-- 이 파일이 하는 일(전부 새로 만드는 것 — 기존 테이블/정책/권한은 건드리지
-- 않는다):
--   1) public.plans 테이블 + CHECK 제약 + 인덱스
--   2) 생성 후 불변 컬럼(user_id, client_request_id, calc_snapshot,
--      created_at) 보호 트리거 + updated_at 갱신 + 재확인일 규칙
--   3) RLS(본인 행만 select/insert/update/delete) + 컬럼 단위 GRANT
--
-- 분석 이벤트(plan_created/plan_reviewed) allowlist 확장은 이 파일에
-- 넣지 않았다 — product_events 마이그레이션 적용 여부와 무관하게 이
-- 파일만 단독으로 적용할 수 있어야 하기 때문이다. 이벤트 쪽은
-- 20260916120000_plan_product_events.sql 참고(그 파일은 product_events가
-- 실제로 존재하는지 런타임에 확인한 뒤에만 진행한다).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다("로컬 구현 완료, DB 적용
-- 전"). 검토 후 별도로 적용한다. 이 저장소에는 로컬 Postgres/Supabase CLI가
-- 없어 SQL 실행 검증은 하지 못했다 — 적용 후에는 supabase/verify/
-- plans_verify.sql(트랜잭션 안에서 만들고 롤백하는 검증 스크립트)을 실행해
-- RLS·권한·제약·트리거를 실제 DB에서 확인한다.
--
-- 적용 방식 주의: 이 파일과 20260916120000_plan_product_events.sql을 SQL
-- 편집기에 한꺼번에 붙여 넣어 한 트랜잭션으로 실행하지 않는다. 이벤트
-- 파일은 product_events 미적용 시 일부러 실패하는데, 같은 트랜잭션이면 이
-- 파일의 테이블·정책까지 함께 롤백된다. 파일 하나씩 따로 실행한다.

-- ---------------------------------------------------------------------------
-- 1) 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  -- 소유자. 계정 삭제 시 계획도 함께 정리한다(wholesaler_inquiries와 같은 방향).
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 멱등 키 — 클라이언트가 계획 폼을 열 때 1회 생성하고, 같은 요청을 재시도할
  -- 때 절대 새로 만들지 않는다. (user_id, client_request_id) unique로 중복
  -- 클릭·응답 유실 후 재시도가 두 번째 행을 만들지 못하게 한다.
  client_request_id uuid not null,
  -- 사용자 자유 입력. 공백만 있는 값은 거부하고 길이는 클라이언트 maxlength와
  -- 같은 상한을 DB에서도 강제한다.
  title text not null
    constraint plans_title_length check (char_length(btrim(title)) between 1 and 80),
  action_text text not null
    constraint plans_action_text_length check (char_length(btrim(action_text)) between 1 and 300),
  -- 재확인일 — KST 기준 "날짜"만 다룬다(시각 없음). 오늘 이전 날짜 금지는
  -- CHECK가 아니라 아래 트리거에서 "새로 정하는 경우"에만 적용한다 — CHECK로
  -- 걸면 기한이 지난 기존 계획의 실행 체크/메모 저장(UPDATE)까지 전부
  -- 막히기 때문이다.
  review_date date not null,
  status text not null default 'active'
    constraint plans_status_allowed check (status in ('active', 'done')),
  -- 실행 여부와 완료(status)는 별개다 — 실행하지 않은 계획도 검토 후 종료할
  -- 수 있다.
  executed boolean not null default false,
  -- 검토 메모는 베타에서 최신 1건만 보관한다(덮어쓰기). 이력 테이블은 없다.
  review_note text
    constraint plans_review_note_length check (review_note is null or char_length(btrim(review_note)) between 1 and 500),
  reviewed_at timestamptz,
  done_at timestamptz,
  -- 계획 당시의 계산 입력·결과 스냅샷 — tools.js mcBuildRecord()가 만드는
  -- v2 레코드 { calc_version, date, saved_at, platform, input, result }를
  -- 그대로 보관한다. 생성 후 변경 불가(아래 트리거). 계산기에서 다시 불러와
  -- 수정해도 이 값은 바뀌지 않는다.
  -- 주의(NULL 평가): jsonb에 키가 없으면 `->`가 NULL을 돌려주고
  -- jsonb_typeof(NULL)도 NULL이라, `= 'object'` 비교가 NULL이 되어 CHECK가
  -- "위반 아님"으로 통과해 버린다. 그래서 각 항목을 coalesce로 ''로 바꿔
  -- 키 누락도 확실히 거부한다(2026-09-16 검토 반영).
  calc_snapshot jsonb not null
    constraint plans_calc_snapshot_shape check (
      jsonb_typeof(calc_snapshot) = 'object'
      and coalesce(jsonb_typeof(calc_snapshot -> 'input'), '') = 'object'
      and coalesce(jsonb_typeof(calc_snapshot -> 'result'), '') = 'object'
      and coalesce(jsonb_typeof(calc_snapshot -> 'calc_version'), '') = 'number'
      -- 허용 계산 버전. 스냅샷 원문(텍스트)으로 비교해 생성 컬럼과 무관하게
      -- 항상 평가되며, 키가 없으면 coalesce로 ''가 되어 역시 거부된다.
      -- 새 계산 버전이 생기면 이 목록을 넓히는 마이그레이션이 필요하다(그때
      -- 화면도 함께 바뀌어야 하므로 의도적으로 좁게 둔다).
      and coalesce(calc_snapshot ->> 'calc_version', '') in ('2')
    ),
  -- calc_version은 스냅샷 안의 값에서 파생되는 생성 컬럼이다 — 별도로
  -- 저장하는 두 번째 사본이 아니므로 "일치 제약"이 필요 없고, 조회/필터에
  -- 그대로 쓸 수 있다. 클라이언트는 이 컬럼에 값을 보내지 않는다(보내면
  -- Postgres가 거부한다). not null은 위 CHECK가 이미 보장하지만 명시한다.
  calc_version smallint generated always as ((calc_snapshot ->> 'calc_version')::smallint) stored not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plans_user_request_unique unique (user_id, client_request_id),
  -- 완료 상태와 done_at은 항상 함께 움직인다.
  constraint plans_done_at_consistent check ((status = 'done') = (done_at is not null)),
  -- 메모가 있으면 반드시 검토 시각이 있다(메모만 있고 "언제 검토했는지"
  -- 모르는 행을 만들지 않는다).
  constraint plans_review_note_requires_reviewed_at check (review_note is null or reviewed_at is not null)
);

-- 홈 목록: 본인 행을 status/재확인일 순으로 읽는 패턴 하나뿐이다.
create index if not exists plans_user_status_review_date_idx
  on public.plans (user_id, status, review_date);

-- ---------------------------------------------------------------------------
-- 2) 트리거 — 불변 컬럼 보호 · updated_at · 재확인일 규칙
-- ---------------------------------------------------------------------------
-- 함수명은 이 기능 전용으로 네임스페이싱한다(wholesalers_set_updated_at과 같은
-- 이유 — 원격 DB에 같은 이름의 범용 함수가 있는지 저장소만으로는 알 수 없다).
create or replace function public.plans_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- 새 계획의 재확인일은 KST 오늘 이후여야 한다.
  if new.review_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception 'REVIEW_DATE_IN_PAST' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.plans_before_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- 생성 후 절대 바뀌면 안 되는 값들. 컬럼 단위 UPDATE GRANT(아래 3)로도
  -- 막지만, 정책/권한이 나중에 바뀌어도 이 트리거가 마지막 방어선이 된다.
  if new.user_id is distinct from old.user_id then
    raise exception 'PLAN_USER_ID_IMMUTABLE' using errcode = 'check_violation';
  end if;
  if new.client_request_id is distinct from old.client_request_id then
    raise exception 'PLAN_CLIENT_REQUEST_ID_IMMUTABLE' using errcode = 'check_violation';
  end if;
  if new.calc_snapshot is distinct from old.calc_snapshot then
    raise exception 'PLAN_CALC_SNAPSHOT_IMMUTABLE' using errcode = 'check_violation';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'PLAN_CREATED_AT_IMMUTABLE' using errcode = 'check_violation';
  end if;

  -- 재확인일을 "새로 정하는" 경우(미루기)에만 오늘 이전을 막는다. 값이 그대로면
  -- 기한이 지난 계획도 실행 체크·메모·완료 처리를 정상적으로 할 수 있다.
  if new.review_date is distinct from old.review_date
     and new.review_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception 'REVIEW_DATE_IN_PAST' using errcode = 'check_violation';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_before_insert on public.plans;
create trigger plans_before_insert
  before insert on public.plans
  for each row
  execute function public.plans_before_insert();

drop trigger if exists plans_before_update on public.plans;
create trigger plans_before_update
  before update on public.plans
  for each row
  execute function public.plans_before_update();

-- ---------------------------------------------------------------------------
-- 3) RLS + 권한 — 본인 행만, 필요한 컬럼만
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;

drop policy if exists plans_select_own on public.plans;
create policy plans_select_own on public.plans
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists plans_insert_own on public.plans;
create policy plans_insert_own on public.plans
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists plans_update_own on public.plans;
create policy plans_update_own on public.plans
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists plans_delete_own on public.plans;
create policy plans_delete_own on public.plans
  for delete to authenticated
  using (user_id = auth.uid());

-- 프로젝트 기본 설정의 auto-grant에 의존하지 않고 명시적으로 정리한다
-- (product_events 마이그레이션과 같은 방식). anon은 아무 것도 못 한다.
revoke all on table public.plans from public;
revoke all on table public.plans from anon;
revoke all on table public.plans from authenticated;

grant select, delete on table public.plans to authenticated;
-- INSERT: 클라이언트가 실제로 보내는 컬럼만. id/created_at/updated_at/
-- status/executed는 기본값, calc_version은 생성 컬럼이라 넣을 수 없다.
grant insert (user_id, client_request_id, title, action_text, review_date, calc_snapshot)
  on table public.plans to authenticated;
-- UPDATE: 사용자가 바꿀 수 있는 컬럼만. user_id/client_request_id/
-- calc_snapshot/created_at/updated_at은 권한 자체가 없어 PostgREST가 즉시
-- 거부하고, 혹시 통과해도 위 트리거가 다시 막는다.
grant update (title, action_text, review_date, status, executed, review_note, reviewed_at, done_at)
  on table public.plans to authenticated;
