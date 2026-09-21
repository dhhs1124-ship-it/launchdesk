-- LaunchDesk "광고 세트 손익분기 기준 연결(ad_margin_links)" — 사용자가 직접 확인해
-- 연결한 "광고 세트 ↔ 마진 계산 스냅샷"만 저장하는 테이블.
--
-- ⚠ 원격 DB에 적용하지 않는다(개인정보처리방침 v1.1 준비 전).
--   이 테이블은 Meta 광고 세트 ID(연결 계정 식별자)와 사용자가 확인한 마진 숫자를
--   저장한다. 현행 개인정보처리방침 v1.0은 "마진 계산기 기록"은 포괄하지만 광고 세트
--   ID · 연결 계정 식별자 저장은 명시하지 않으므로, 방침 개정(v1.1)과 재동의 흐름이
--   준비된 뒤에 적용한다. 이 파일은 저장소에만 있고 실행 검증은 하지 않았다.
--
-- 저장하는 것 / 저장하지 않는 것:
--   - 저장: (store_id, meta_adset_id) 연결 1건마다 상품 메모(사용자가 직접 입력) 1개와
--     마진 계산 스냅샷(total_income, pre_ad, calc_version, currency, source_saved_at).
--   - 저장하지 않음: 광고 성과(광고비 · ROAS · 구매 등), 광고 세트 · 캠페인 이름,
--     손익분기 ROAS(읽을 때 total_income / pre_ad × 100 으로 계산 — pre_ad <= 0 또는
--     total_income <= 0이면 손익분기 ROAS는 "없음"이며, 그 상태를 보존하려고 두
--     값에 양수 제약을 걸지 않는다).
--   - user_id 컬럼이 없다: 소유권은 stores.user_id = auth.uid() 를 RLS가 조회해서만
--     확인한다(사용자 값을 중복 저장하지 않는다).
--   - 이름 기반 자동 연결 · 최신 계산 자동 선택은 스키마 어디에도 없다.
--
-- 이 파일이 하는 일(전부 새로 만드는 것 — 기존 테이블/정책/권한은 건드리지 않는다):
--   1) public.ad_margin_links 테이블 + 제약 + unique(store_id, meta_adset_id)
--   2) BEFORE INSERT OR UPDATE 전용 트리거 함수(SECURITY INVOKER, 고정 search_path)와 트리거
--      — 서버 시각 설정 · 상품 메모 공백 제거 · 식별 컬럼 4개(id, store_id, meta_adset_id,
--      created_at)의 UPDATE 변경 금지
--   3) RLS 활성화 + 정책 4개(select / insert / update / delete, authenticated 전용)
--   4) GRANT/REVOKE — anon · PUBLIC 전권 회수, authenticated는 테이블 CRUD 4개와
--      identity 시퀀스 USAGE만
--
-- 이 파일이 하지 않는 일:
--   - stores / connected_accounts / tool_records 의 권한 · 정책 수정. 그 세 테이블의
--     과권한 정리는 별도 후속 migration으로 분리한다.
--   - service_role 권한을 추가하거나 회수하지 않는다(클라이언트 경로가 아니고 현재
--     이 테이블을 쓰는 서버 경로도 없다). 프로젝트 기본 권한이 부여한 것은 그대로 둔다.
--   - 기존 함수 재사용 — 다른 updated_at 함수의 search_path를 저장소만으로는 알 수
--     없으므로 이 테이블 전용 함수를 새로 만든다.
--
-- 적용 후 확인: supabase/verify/ad_margin_links_verify.sql(읽기 전용 PASS/FAIL 표).

-- ---------------------------------------------------------------------------
-- 1) 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.ad_margin_links (
  id bigint generated always as identity primary key,
  -- 이 연결이 속한 쇼핑몰. 쇼핑몰이 삭제되면 연결도 함께 정리한다(stores를 참조하는
  -- 다른 사용자 데이터와 같은 ON DELETE CASCADE 방향).
  store_id bigint not null references public.stores(id) on delete cascade,
  -- Meta 광고 세트 ID — 숫자 문자열 1~20자(meta-adset-insights 함수의 형식 검사와 동일).
  meta_adset_id text not null,
  -- 사용자가 직접 적은 "이 세트가 광고하는 상품" 메모. 표시용이며 어떤 매칭에도 쓰지 않는다.
  -- 저장할 때 트리거가 앞뒤 공백을 제거한다(아래 CHECK는 그 결과를 검사한다).
  product_label text not null,
  -- 마진 계산 스냅샷(사용자가 확인한 그 시점의 값). 값 자체를 복사해 두므로 원본
  -- 계산 기록이 지워지거나 바뀌어도 연결은 그대로다.
  calc_version integer not null,
  currency text not null,
  total_income numeric not null,
  pre_ad numeric not null,
  -- 원본 계산 기록의 saved_at(클라이언트 시각 — 표시용 참고값이며 신뢰 근거가 아님).
  source_saved_at timestamptz not null,
  -- confirmed_at(사용자가 이 연결을 확인한 시각) · created_at · updated_at 은 INSERT · UPDATE 때
  -- 트리거가 서버 시각(now())으로 설정한다 — 클라이언트가 보낸 값은 무시된다. UPDATE는 기준을
  -- 다시 연결하거나 메모를 고치는 경우뿐이라 confirmed_at 도 함께 갱신된다. created_at 은
  -- INSERT 때만 설정되고 이후 변경할 수 없다.
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 광고 세트 하나에 기준은 하나. 같은 세트를 다시 연결하면 insert가 아니라 update.
  constraint ad_margin_links_store_adset_unique unique (store_id, meta_adset_id),
  -- 앞뒤 공백을 뺀 뒤 1~40자(공백만 있는 값은 거부).
  constraint ad_margin_links_product_label_length
    check (char_length(btrim(product_label)) between 1 and 40),
  constraint ad_margin_links_meta_adset_id_format
    check (meta_adset_id ~ '^[0-9]{1,20}$'),
  -- 계산기는 현재 원화(KRW)만 다룬다. 다른 통화를 지원하게 되면 이 제약을 넓히는
  -- migration과 화면 변경을 함께 한다.
  constraint ad_margin_links_currency_krw
    check (currency = 'KRW'),
  -- 지원하는 계산 버전만 허용(plans.calc_snapshot과 같은 방향). total_income · pre_ad의
  -- 의미가 바뀌는 새 버전이 생기면 이 목록을 넓히는 migration이 필요하다.
  constraint ad_margin_links_calc_version_supported
    check (calc_version = 2),
  -- NaN · ±Infinity 거부. numeric은 NaN(PG14+는 Infinity도)을 저장할 수 있어서 타입만으로는
  -- 막히지 않는다. x - x 는 유한한 값이면 0이고, NaN이거나 무한대이면 NaN이 되어
  -- "= 0"이 거짓이 된다(NaN = NaN은 참이라 x <> 'NaN' 비교로는 무한대를 못 잡는다).
  -- 0원 · 음수(적자) 값은 그대로 통과한다.
  constraint ad_margin_links_total_income_finite
    check (total_income - total_income = 0),
  constraint ad_margin_links_pre_ad_finite
    check (pre_ad - pre_ad = 0)
);

comment on table public.ad_margin_links is
  '광고 세트별로 사용자가 직접 확인해 연결한 마진 계산 스냅샷(성과 데이터 아님). 소유권은 stores.user_id = auth.uid() 로만 확인한다.';

-- ---------------------------------------------------------------------------
-- 2) 쓰기 무결성 — 이 테이블 전용 BEFORE INSERT OR UPDATE 트리거
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER + 고정 search_path. btrim · now()는 pg_catalog 함수라 다른 스키마를 볼
-- 필요가 없다. BEFORE 트리거는 CHECK · NOT NULL 검사보다 먼저 실행되므로 아래 값 정리가
-- 제약 검사에 반영된다.
--   INSERT: product_label 공백 제거, confirmed_at · created_at · updated_at = 서버 시각
--   UPDATE: id · store_id · meta_adset_id · created_at 이 바뀌면 예외(연결의 정체성은 불변 —
--           다른 세트나 쇼핑몰로 옮기려면 삭제 후 새로 만든다). product_label 공백 제거,
--           confirmed_at · updated_at = 서버 시각.
--   UPDATE로 바꿀 수 있는 것: product_label, calc_version, currency, total_income, pre_ad,
--   source_saved_at (사용자가 기준을 다시 연결할 때).
create or replace function public.ad_margin_links_before_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'AD_MARGIN_LINK_ID_IMMUTABLE' using errcode = 'check_violation';
    end if;
    if new.store_id is distinct from old.store_id then
      raise exception 'AD_MARGIN_LINK_STORE_ID_IMMUTABLE' using errcode = 'check_violation';
    end if;
    if new.meta_adset_id is distinct from old.meta_adset_id then
      raise exception 'AD_MARGIN_LINK_META_ADSET_ID_IMMUTABLE' using errcode = 'check_violation';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'AD_MARGIN_LINK_CREATED_AT_IMMUTABLE' using errcode = 'check_violation';
    end if;
  end if;

  new.product_label := btrim(new.product_label);
  new.confirmed_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ad_margin_links_before_write on public.ad_margin_links;
create trigger ad_margin_links_before_write
  before insert or update on public.ad_margin_links
  for each row execute function public.ad_margin_links_before_write();

-- ---------------------------------------------------------------------------
-- 3) RLS — stores 소유권(stores.user_id = auth.uid())을 조회해서만 접근을 허용
-- ---------------------------------------------------------------------------
-- 정책의 서브쿼리는 호출자 권한으로 실행되므로 stores 자체의 RLS도 함께 적용된다.
alter table public.ad_margin_links enable row level security;

drop policy if exists ad_margin_links_select_own on public.ad_margin_links;
create policy ad_margin_links_select_own on public.ad_margin_links
  for select to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = ad_margin_links.store_id and s.user_id = auth.uid()
    )
  );

drop policy if exists ad_margin_links_insert_own on public.ad_margin_links;
create policy ad_margin_links_insert_own on public.ad_margin_links
  for insert to authenticated
  with check (
    exists (
      select 1 from public.stores s
      where s.id = ad_margin_links.store_id and s.user_id = auth.uid()
    )
  );

drop policy if exists ad_margin_links_update_own on public.ad_margin_links;
create policy ad_margin_links_update_own on public.ad_margin_links
  for update to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = ad_margin_links.store_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = ad_margin_links.store_id and s.user_id = auth.uid()
    )
  );

drop policy if exists ad_margin_links_delete_own on public.ad_margin_links;
create policy ad_margin_links_delete_own on public.ad_margin_links
  for delete to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = ad_margin_links.store_id and s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4) 권한 — 프로젝트 기본 권한(auto-grant)에 의존하지 않고 명시적으로 정리한다
-- ---------------------------------------------------------------------------
-- 새 테이블은 프로젝트의 기본 권한 설정에 따라 anon · authenticated 등에 자동으로
-- 권한이 붙을 수 있다. 먼저 전부 회수한 뒤 필요한 것만 다시 부여한다.
revoke all on table public.ad_margin_links from public, anon, authenticated;
-- authenticated는 CRUD 4개만. TRUNCATE · REFERENCES · TRIGGER · MAINTAIN 등은 부여하지 않는다.
grant select, insert, update, delete on table public.ad_margin_links to authenticated;

-- identity 시퀀스(ad_margin_links_id_seq): 테이블 권한은 연결된 시퀀스 권한까지 자동으로
-- 확장되지 않으므로 시퀀스 권한을 따로 명시한다. 먼저 전부 회수한 뒤, INSERT가 번호를 받는 데
-- 필요한 USAGE만 authenticated에 부여한다. SELECT · UPDATE는 부여하지 않는다(현재 값 조회 ·
-- setval 불가). anon · PUBLIC 은 시퀀스 권한이 전혀 없다.
revoke all on sequence public.ad_margin_links_id_seq from public, anon, authenticated;
grant usage on sequence public.ad_margin_links_id_seq to authenticated;
