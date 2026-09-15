-- LaunchDesk UTM First-Touch Acquisition MVP — user_acquisition 테이블 +
-- record_user_acquisition() RPC + 관리자 집계 RPC(admin_beta_acquisition_
-- overview()). docs/plans/utm-acquisition-design.md(설계안, 이전 단계에서
-- "구현하지 않음"으로 남겨둔 문서)를 전제로 하되, 실제 코드(app.js의
-- handleSession()/safePageLocation(), product-events.js의 프로덕션 호스트
-- allowlist, admin_beta_overview()/admin_beta_behavior_overview()의 보안·
-- 집계 패턴)를 다시 확인해 그 기준으로 조정했다 — 설계 문서와 다른 부분은
-- 작업 보고서에 명시한다.
--
-- 2026-09-15 원격 적용 전 검토 반영(이 파일은 원격 DB에 적용된 적이 없어
-- 별도 fix-up 마이그레이션을 만들지 않고 파일 자체를 고쳤다):
--   - source 컬럼을 NOT NULL로, record_user_acquisition()의 "source 없으면
--     조용히 return"을 "INVALID_ACQUISITION_SOURCE 예외"로 바꿨다 — 이유는
--     아래 §"UTM이 없는 방문자는..." 섹션 참고. 정상 클라이언트
--     (utm-acquisition.js)는 이 변경으로 영향받지 않는다(원래도 utm_source가
--     있을 때만 이 RPC를 호출함).
--
-- ---------------------------------------------------------------------------
-- 역할 분리(요구사항 0) — GA4를 대체하지 않는다
-- ---------------------------------------------------------------------------
-- GA4(gtag)는 app.js/setup.js/tools.js에 이미 있고 이번에도 전혀 건드리지
-- 않는다 — 방문/채널/웹 분석은 계속 GA4 몫이다. 이 테이블은 "로그인 사용자의
-- 최초 유입 출처"와 "그 사용자가 실제 제품 단계(쇼핑몰 등록/Cafe24 연결/
-- Meta 연결)까지 전환됐는가"만 연결한다 — product_events(행동 이벤트)와도
-- 완전히 분리된 별도 책임이다(요구사항 12 — UTM을 product_events.properties에
-- 넣지 않는다. product_events는 이번 마이그레이션에서 전혀 건드리지 않는다).
--
-- ---------------------------------------------------------------------------
-- First-touch 정의(요구사항 2·6·7)
-- ---------------------------------------------------------------------------
-- user_id를 PK로 써서 "한 사용자당 정확히 0개 또는 1개의 행"만 존재할 수
-- 있게 스키마 수준에서 강제한다. 쓰기는 record_user_acquisition() RPC
-- 하나뿐이고, 그 RPC는 반드시 INSERT ... ON CONFLICT (user_id) DO NOTHING을
-- 쓴다 — 이미 행이 있으면 새 UTM으로 절대 덮어쓰지 않는다(요구사항 11).
-- 브라우저가 .from('user_acquisition').insert(...)를 직접 호출하는 경로는
-- 아예 없다(테이블에 authenticated/anon GRANT 자체가 없음 — 아래).
--
-- ---------------------------------------------------------------------------
-- UTM이 없는 방문자는 행을 만들지 않는다(요구사항 9 — 사용자 권장안을 채택)
-- ---------------------------------------------------------------------------
-- organic/referral/direct를 지금 구조만으로 정확히 구분할 수 없으므로,
-- 클라이언트(utm-acquisition.js)는 utm_source가 있을 때만 이 RPC를
-- 호출한다 — user_acquisition에 행이 없다 = "UTM 유입으로 기록된 적
-- 없음"이지, "direct로 확정됐다"는 뜻이 아니다(admin.js UI 문구로 이
-- 한계를 안내한다 — "UTM 추적 기능 적용 이후 가입부터 집계").
--
-- 서버(record_user_acquisition())는 이걸 한 단계 더 강제한다: source가
-- 없는(정제 후에도 빈 값인) 요청은 INVALID_ACQUISITION_SOURCE 예외로
-- 명시적으로 거부하고 행을 만들지 않는다(2026-09-15 검토 반영 — 이전에는
-- 조용히 return했으나, authenticated 사용자가 이 RPC를 직접(예: 콘솔)
-- 호출해 source가 전부 null인 빈 first-touch 행을 먼저 만들면 user_id
-- PK + ON CONFLICT DO NOTHING 때문에 나중의 정상 UTM이 영구적으로
-- 기록되지 못하는 경로를 막기 위함 — source 컬럼 자체도 NOT NULL로
-- 이중 방어한다). 정상 클라이언트는 애초에 source 없이 이 RPC를 호출하지
-- 않으므로 영향받지 않는다.
--
-- ---------------------------------------------------------------------------
-- 관리자 집계 그룹핑 — 설계 문서(campaign까지 3단계)와 다르게 조정
-- ---------------------------------------------------------------------------
-- 요구사항 13은 "MVP에서는 campaign까지 그룹화해도 되고, 데이터가 너무
-- 세분화되면 source+medium 우선으로 단순화 가능"이라고 명시했고, 요구사항
-- 17의 관리자 UI 예시("Meta / paid_social", "Naver / blog")도 campaign을
-- 표에 전혀 보여주지 않는다. Beta 규모(가입자 수십~수백 명)에서
-- source+medium+campaign 3단으로 쪼개면 그룹당 표본이 너무 작아져(예:
-- 캠페인 A/B 테스트별로 2~3명씩) 전환율이 통계적으로 의미가 없어질 가능성이
-- 높다고 판단해, admin_beta_acquisition_overview()는 source+medium 2단으로
-- 그룹핑한다(campaign은 user_acquisition 테이블에는 그대로 저장되므로,
-- 캠페인 단위 상세가 필요해지면 이 RPC를 건드리지 않고 새 RPC를 추가하는
-- 후속 작업으로 확장 가능 — 요구사항 16 "범위를 크게 늘리지 않기"와 일치).
--
-- ---------------------------------------------------------------------------
-- 값 정제(요구사항 5)
-- ---------------------------------------------------------------------------
-- record_user_acquisition() 내부에서 각 필드를 trim → 제어문자 제거
-- (POSIX [:cntrl:] 클래스 — tab/개행/NUL 등) → 최대 길이로 truncate →
-- 빈 문자열이면 null로 정규화한다. source/medium/campaign/content/term은
-- 100자, landing_path는 200자(product_events.route와 동일한 길이 원칙)로
-- 제한한다. 테이블에도 동일한 길이 제약을 CHECK로 한 번 더 걸어(RPC
-- 우회 경로가 없더라도, product_events와 동일하게 스키마 자체에도 방어를
-- 남기는 이 프로젝트의 관례를 따름) 이중으로 방어한다.
--
-- ---------------------------------------------------------------------------
-- 로그인 후 연결 지점(요구사항 10) — app.js 변경은 별도 커밋에서
-- ---------------------------------------------------------------------------
-- 이 마이그레이션 자체는 DB만 다룬다. app.js의 handleSession()에는(기존
-- 인증 상태 머신을 재작성하지 않고) 딱 한 줄만 추가한다 — user가 확정된
-- 즉시(early-return 가드보다 앞) localStorage에 대기 중인 UTM이 있으면
-- 이 RPC를 호출하고, 성공/충돌(ON CONFLICT DO NOTHING) 여부와 무관하게
-- pending을 지운다. 실패(네트워크 오류 등)만 pending을 남겨 다음
-- SIGNED_IN/TOKEN_REFRESHED 등에서 자동 재시도되게 한다. 상세 위치는 작업
-- 보고서 참고.
--
-- ---------------------------------------------------------------------------
-- 보안 설계 — product_events(20260915280000)와 완전히 동일한 패턴
-- ---------------------------------------------------------------------------
--   - 테이블: RLS enable하되 정책은 만들지 않는다(authenticated/anon 둘 다
--     이 테이블에 대한 GRANT 자체가 없으므로 정책이 있어도 도달 불가 —
--     "이 테이블은 절대 직접 접근 대상이 아니다"라는 의도만 명시).
--     anon/authenticated 모두 명시적으로 REVOKE(프로젝트 기본 권한 설정과
--     무관하게 항상 차단).
--   - record_user_acquisition(): SECURITY DEFINER(테이블에 authenticated
--     직접 INSERT 정책을 주면 이 함수를 거치지 않고 브라우저가
--     .from('user_acquisition').insert(...)로 임의 user_id 위조 INSERT를
--     시도할 길이 열린다 — RLS의 WITH CHECK로 user_id=auth.uid()를 강제해도
--     "다른 user_id로 여러 번 시도"는 여전히 스키마상 가능해지므로, 유일한
--     쓰기 경로를 이 함수 하나로 강제하는 편이 더 단순하고 안전하다). 함수
--     내부에서 auth.uid()가 null이면 즉시 예외(AUTH_REQUIRED). user_id
--     인자를 아예 받지 않는다 — 다른 사람 명의로 기록하는 요청이 시그니처
--     수준에서 불가능하다. search_path 고정.
--   - admin_beta_acquisition_overview(): 다른 admin_* RPC와 동일하게
--     public.is_admin() 재확인 + SECURITY DEFINER + search_path 고정.
--     인자 없음(다른 사용자 기준 조회 불가). 집계값만 반환하고 개별
--     user_id/이메일 등 원시 목록은 전혀 반환하지 않는다(요구사항 13 —
--     "raw 사용자 목록은 필요 없음"). admin_users에 등록된 user_id는
--     admin_beta_behavior_overview()와 동일한 이유로 집계에서 제외한다
--     (요구사항 16 — 담당자 본인이 광고/테스트 링크를 눌러도 Beta 전환
--     숫자가 오염되지 않게).
--   - PUBLIC EXECUTE 회수 + anon 명시적 재회수 + authenticated에게만 재부여
--     (이 프로젝트의 2026-09-15 감사 반영 패턴과 동일).
--
-- 주의: 이 파일은 아직 원격 DB에 적용되지 않았다. 검토 후 SQL Editor에서
-- 직접 실행한다(supabase db push 등으로 자동 적용하지 않음).

-- ---------------------------------------------------------------------------
-- 1) public.user_acquisition
-- ---------------------------------------------------------------------------
create table if not exists public.user_acquisition (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- source는 NOT NULL — first-touch의 최소 필수값이다(2026-09-15 검토
  -- 반영, 아래 §2 참고). record_user_acquisition()이 유일한 쓰기 경로이고
  -- 그 함수가 source 없는 호출을 이미 예외로 거부하므로 이 제약에 실제로
  -- 걸릴 경로는 없지만, "이 테이블에 source 없는 행이 존재할 수 있다"는
  -- 가능성 자체를 스키마 수준에서 원천 차단해 이중으로 방어한다.
  source text not null
    constraint user_acquisition_source_length check (char_length(source) <= 100),
  medium text
    constraint user_acquisition_medium_length check (medium is null or char_length(medium) <= 100),
  campaign text
    constraint user_acquisition_campaign_length check (campaign is null or char_length(campaign) <= 100),
  content text
    constraint user_acquisition_content_length check (content is null or char_length(content) <= 100),
  term text
    constraint user_acquisition_term_length check (term is null or char_length(term) <= 100),
  -- 해시 라우트만(예: '/start/prepare') — 전체 URL/쿼리스트링/auth 콜백
  -- 토큰은 이 컬럼에 절대 들어오지 않는다(record_user_acquisition()이
  -- 받은 값을 그대로 저장할 뿐이고, 그 값을 만드는 쪽은 app.js의
  -- safePageLocation()과 동일한 판정 로직을 쓰는 클라이언트 코드다).
  landing_path text
    constraint user_acquisition_landing_path_length check (landing_path is null or char_length(landing_path) <= 200),

  created_at timestamptz not null default now()
);

-- 관리자 집계(admin_beta_acquisition_overview())의 group by (source, medium)
-- 패턴 하나만 지원하면 되는 규모(Beta 100~1000 사용자)라 인덱스도 그
-- 하나만 만든다(요구사항 16 — 과도한 인덱스 지양).
create index if not exists user_acquisition_source_medium_idx
  on public.user_acquisition (source, medium);

alter table public.user_acquisition enable row level security;
-- 의도적으로 정책을 하나도 만들지 않는다 — 아래에서 anon/authenticated
-- 모두 이 테이블에 대한 GRANT 자체를 제거하므로, RLS 정책이 있어도 도달할
-- 수 없다(product_events와 동일한 패턴).
revoke all on table public.user_acquisition from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) record_user_acquisition() — 유일한 쓰기 경로. first-touch만 기록한다.
-- ---------------------------------------------------------------------------
create or replace function public.record_user_acquisition(
  p_source text default null,
  p_medium text default null,
  p_campaign text default null,
  p_content text default null,
  p_term text default null,
  p_landing_path text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_source text;
  v_medium text;
  v_campaign text;
  v_content text;
  v_term text;
  v_landing_path text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 정제 순서: 제어문자 제거(POSIX [:cntrl:] — tab/개행/NUL 등) → 앞뒤
  -- 공백 trim(제어문자를 먼저 지워야 그 자리에 새로 드러나는 공백도 함께
  -- 걸러진다) → 최대 길이로 truncate → 빈 문자열은 null로 정규화.
  v_source := nullif(left(trim(both from regexp_replace(p_source, '[[:cntrl:]]', '', 'g')), 100), '');
  v_medium := nullif(left(trim(both from regexp_replace(p_medium, '[[:cntrl:]]', '', 'g')), 100), '');
  v_campaign := nullif(left(trim(both from regexp_replace(p_campaign, '[[:cntrl:]]', '', 'g')), 100), '');
  v_content := nullif(left(trim(both from regexp_replace(p_content, '[[:cntrl:]]', '', 'g')), 100), '');
  v_term := nullif(left(trim(both from regexp_replace(p_term, '[[:cntrl:]]', '', 'g')), 100), '');
  v_landing_path := nullif(left(trim(both from regexp_replace(p_landing_path, '[[:cntrl:]]', '', 'g')), 200), '');

  -- UTM이 실제로 없으면(정제 후에도 source가 비어있으면) 명시적으로
  -- 거부한다(요구사항 9의 "direct 행을 임의로 만들지 않음"은 여전히
  -- 지키되, 2026-09-15 검토 반영: 조용히 return하는 대신 예외를 던진다).
  -- 이유 — 이 함수는 authenticated라면 누구나 직접 호출할 수 있는 RPC다.
  -- 만약 어떤 사용자가 실제 UTM 랜딩보다 먼저(예: 콘솔에서) 모든 UTM을
  -- null로 이 함수를 호출하면, 예전 방식(조용히 return, 행 미생성)에서는
  -- 실질적 피해가 없었지만 — 그래도 "빈 first-touch 요청을 성공으로
  -- 취급한다"는 모호함을 남겼다. 이제는 그 요청 자체를 명확한 오류
  -- (INVALID_ACQUISITION_SOURCE)로 거부해, "source 없는 요청은 애초에
  -- 유효한 호출이 아니다"를 함수 계약 수준에서 명시한다. 정상 클라이언트
  -- (utm-acquisition.js)는 utm_source가 있을 때만 이 함수를 호출하므로
  -- (readPending()이 null이면 sendPendingIfAny()가 RPC 자체를 호출하지
  -- 않음) 이 변경으로 정상 흐름은 전혀 영향받지 않는다.
  if v_source is null then
    raise exception 'INVALID_ACQUISITION_SOURCE';
  end if;

  insert into public.user_acquisition (
    user_id, source, medium, campaign, content, term, landing_path
  )
  values (
    v_user_id, v_source, v_medium, v_campaign, v_content, v_term, v_landing_path
  )
  -- first-touch — 이미 기록이 있으면 절대 덮어쓰지 않는다(요구사항 7·11).
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.record_user_acquisition(text, text, text, text, text, text) from public;
revoke execute on function public.record_user_acquisition(text, text, text, text, text, text) from anon;
grant execute on function public.record_user_acquisition(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) admin_beta_acquisition_overview() — 관리자 "유입별 전환" 집계.
-- ---------------------------------------------------------------------------
create or replace function public.admin_beta_acquisition_overview()
returns table (
  source text,
  medium text,
  signups bigint,
  users_with_store bigint,
  users_with_cafe24 bigint,
  users_with_cafe24_and_meta bigint
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
  with acquisition as (
    -- 관리자 계정 제외(요구사항 16) — 담당자 본인의 테스트/광고 클릭이
    -- Beta 유입 전환 숫자를 오염시키지 않게 한다. medium이 없는 행은 표시용
    -- 라벨만 '(설정 안 됨)'으로 통일한다(source는 record_user_acquisition()이
    -- 비어있으면 애초에 행을 만들지 않으므로 여기서 null일 수 없다).
    select
      ua.user_id,
      ua.source as source,
      coalesce(ua.medium, '(설정 안 됨)') as medium
    from public.user_acquisition ua
    where ua.user_id not in (select au.user_id from public.admin_users au)
  ),
  store_users as (
    select distinct st.user_id from public.stores st
  ),
  cafe24_users as (
    select distinct st.user_id
    from public.stores st
    join public.connected_accounts ca on ca.store_id = st.id
    where ca.provider = 'cafe24' and ca.status = 'connected'
  ),
  -- admin_beta_overview()의 users_with_cafe24_and_meta와 동일한 방식
  -- (INTERSECT) — 정의상 cafe24_users의 부분집합이 되도록 보장해, "Cafe24
  -- 연결률" 대비 "Cafe24+Meta 연결률"이 절대 100%를 넘지 않게 한다.
  cafe24_and_meta_users as (
    select user_id from cafe24_users
    intersect
    select distinct st.user_id
    from public.stores st
    join public.connected_accounts ca on ca.store_id = st.id
    where ca.provider = 'meta' and ca.status = 'connected'
  )
  select
    a.source,
    a.medium,
    count(distinct a.user_id) as signups,
    count(distinct su.user_id) as users_with_store,
    count(distinct c24.user_id) as users_with_cafe24,
    count(distinct c24m.user_id) as users_with_cafe24_and_meta
  from acquisition a
  left join store_users su on su.user_id = a.user_id
  left join cafe24_users c24 on c24.user_id = a.user_id
  left join cafe24_and_meta_users c24m on c24m.user_id = a.user_id
  group by a.source, a.medium
  order by signups desc, a.source, a.medium;
end;
$$;

revoke all on function public.admin_beta_acquisition_overview() from public;
revoke execute on function public.admin_beta_acquisition_overview() from anon;
grant execute on function public.admin_beta_acquisition_overview() to authenticated;
