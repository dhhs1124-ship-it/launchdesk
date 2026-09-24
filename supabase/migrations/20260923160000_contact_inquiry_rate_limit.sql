-- 공개 문의 발송 횟수 제한 + 중복 발송 방지. 문의 원문·이메일·IP는 이 테이블에
-- 저장하지 않는다(이메일은 해시만, 문의 내용은 중복 발송 판별용 해시만).
-- Resend/Turnstile 비밀 설정과 방침 개정 전에는 배포·적용하지 않는다.
--
-- [2026-09-23 1차 재설계] "시도"와 "실제 발송 성공"을 분리 — Resend 호출 전에는
-- 시도 카운터만(넉넉한 상한) 늘고, 사용자에게 의미 있는 "오늘 문의 가능
-- 횟수"는 Resend 성공 이후에만 늘려 발송 실패가 재시도를 막지 않게 했다.
--
-- [2026-09-23 2차 재설계 — 이 버전] 1차 설계는 "성공 카운터를 Resend 호출
-- *이후*에 늘린다"는 점 때문에 두 가지 문제가 남아 있었다:
--   1) 동시 요청: 상한 근처에서 두 요청이 거의 동시에 들어오면 둘 다 "아직
--      여유 있음"을 보고 통과해 상한을 넘겨 발송할 수 있었다(확인과 기록
--      사이에 Resend 호출이라는 긴 시간차가 있어 발생하는 경쟁 상태).
--   2) 같은 idempotency key에 대한 사전 조회(contact_inquiry_already_delivered)만으로는
--      역시 "조회 후 실제 판단까지"의 시간차 때문에 동시 재시도의 중복 발송을
--      막지 못했다.
-- 이번 버전은 두 문제를 다르게 나눠 해결한다:
--   - 문제 1(성공 상한 초과)은 이 파일에서 "성공 예약"을 Resend 호출 *전에*
--     원자적으로 확인+증가시켜 막는다(claim_contact_inquiry_attempt). Postgres는
--     같은 행에 대한 동시 UPDATE를 행 잠금으로 직렬화하므로, 두 번째 요청은
--     반드시 첫 번째 요청이 반영한 값을 보고 상한 검사를 통과/실패한다 —
--     "둘 다 여유 있음을 보고 통과"하는 경쟁 상태 자체가 성립하지 않는다.
--     Resend가 실패하면 release_contact_inquiry_reservation으로 이 예약을
--     되돌린다(재시도가 여전히 가능하도록).
--   - 문제 2(동시 재시도의 중복 발송)는 이 DB 계층의 사전 조회만으로는 원천
--     차단할 수 없다는 걸 인정하고, 실제 발송 주체인 Resend 쪽에 문의
--     내용까지 반영한 Idempotency-Key를 실어 Resend가 최종 방어선이 되게
--     한다(supabase/functions/contact-inquiry/index.ts 참고) — 이 사전 조회는
--     "이미 끝난 요청이면 Resend를 아예 다시 부르지 않는" 최적화 겸 1차
--     방어선일 뿐, 유일한 방어선이 아니다.
--
-- [실제로 보장되는 것과 아닌 것 — 정직하게 남겨둔다]
--   - 보장됨: 정상적인 요청 흐름(성공/실패가 명확히 갈리는 경우)에서는 성공
--     상한이 초과되지 않는다. 동시 요청이 상한 근처에서 몰려도 마찬가지다
--     (위 문제 1 해결).
--   - 보장 안 됨: Edge Function 프로세스가 "예약 확정" 이후 "성공 기록 또는
--     실패 시 예약 해제" 중 어느 쪽에도 도달하지 못하고 강제 종료되는
--     극단적 상황(크래시·타임아웃 kill 등, 일반 예외 상황이 아님 — 그건
--     catch/finally로 잡힘)은 그 하루치 슬롯 하나를 영구히 소모한 채 남는다.
--     이걸 만료(TTL)로 되찾으려면 예약에 상태·타임스탬프를 추가하고 다음
--     요청마다 오래된 예약을 정리하는 로직이 더 필요하다 — 이번 베타
--     단계에서는 과도한 설계로 보고 넣지 않았다(낮은 트래픽 + 하루 단위로
--     자연히 복구되는 영향 범위이기 때문). 필요해지면 이 함수에 상태
--     컬럼과 만료 정리를 추가할 것.
create table public.contact_inquiry_rate_limits (
  day date not null,
  scope text not null check (scope in ('daily', 'email')),
  kind text not null check (kind in ('attempt', 'success')),
  subject_hash text not null check (
    (scope = 'daily' and subject_hash in ('beginner', 'service', 'partner')) or
    (scope = 'email' and subject_hash ~ '^[0-9a-f]{64}$')
  ),
  attempts integer not null check (attempts >= 0),
  primary key (day, scope, kind, subject_hash)
);

alter table public.contact_inquiry_rate_limits enable row level security;
revoke all on table public.contact_inquiry_rate_limits from public, anon, authenticated;

-- 성공한 발송의 (idempotency key, 문의 내용 해시)만 기록한다 — 같은 key라도
-- 내용이 바뀌면(입력 수정 후 재제출) 다른 조합으로 취급해 예전 응답을
-- 잘못 재사용하지 않는다. PII 없음(문의 원문·이메일 자체는 저장 안 함).
create table public.contact_inquiry_deliveries (
  idempotency_key uuid primary key,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.contact_inquiry_deliveries enable row level security;
revoke all on table public.contact_inquiry_deliveries from public, anon, authenticated;

-- 이미 같은 (key, 내용 해시) 조합으로 성공 처리됐는지 확인만 한다(부작용
-- 없음) — Turnstile 검증보다 먼저 불러 불필요한 외부 호출을 피한다. 내용이
-- 달라졌다면(입력 수정 후 재제출) false를 돌려줘 새 발송으로 처리되게 한다.
create or replace function public.contact_inquiry_already_delivered(p_idempotency_key uuid, p_content_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'AUTH_REQUIRED';
  end if;
  return exists(
    select 1 from public.contact_inquiry_deliveries
    where idempotency_key = p_idempotency_key and content_hash = p_content_hash
  );
end;
$$;

revoke all on function public.contact_inquiry_already_delivered(uuid, text) from public, anon, authenticated;
grant execute on function public.contact_inquiry_already_delivered(uuid, text) to service_role;

-- Resend 호출 *직전에* 부른다. 함수는 service_role만 호출한다. "시도"(넉넉한
-- 상한, Resend/Turnstile 남용 방지 목적 — 실패해도 되돌리지 않음)와 "성공
-- 예약"(진짜 상한, Resend 호출 전에 원자적으로 확인+증가 — 실패하면
-- release_contact_inquiry_reservation으로 되돌릴 것)을 함께 처리한다. 네
-- INSERT 모두 이 함수 하나의 트랜잭션 안에서 실행되므로, 뒤쪽 단계에서
-- 예외가 나면(raise exception) 앞서 늘려둔 카운터도 전부 함께 롤백된다
-- (Postgres 기본 동작 — 별도 보정 코드 불필요).
create or replace function public.claim_contact_inquiry_attempt(p_category text, p_email_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_attempts integer;
  -- 성공 상한(진짜 "오늘 보낼 수 있는 횟수") — 이메일당 3, 카테고리별 일일 30
  -- (3개 카테고리 합계 최대 90 — 기존 전역 60보다 합계는 늘지만, 한 카테고리
  -- 도배가 나머지 두 카테고리까지 막지 못하게 하는 트레이드오프).
  c_email_success_cap constant integer := 3;
  c_daily_success_cap constant integer := 30;
  -- 시도 상한(Resend/Turnstile 호출 자체의 남용 방지) — 성공 상한보다 넉넉히
  -- 둬 일시 장애로 인한 정상 재시도를 흡수한다.
  c_email_attempt_cap constant integer := 8;
  c_daily_attempt_cap constant integer := 80;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_category is null or p_category not in ('beginner', 'service', 'partner') then
    raise exception 'INVALID_CONTACT_RATE_KEY';
  end if;
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CONTACT_RATE_KEY';
  end if;

  insert into public.contact_inquiry_rate_limits(day, scope, kind, subject_hash, attempts)
  values (v_day, 'daily', 'attempt', p_category, 1)
  on conflict (day, scope, kind, subject_hash) do update
    set attempts = contact_inquiry_rate_limits.attempts + 1
    where contact_inquiry_rate_limits.attempts < c_daily_attempt_cap
  returning attempts into v_attempts;
  if v_attempts is null then raise exception 'CONTACT_ATTEMPT_LIMIT'; end if;

  v_attempts := null;
  insert into public.contact_inquiry_rate_limits(day, scope, kind, subject_hash, attempts)
  values (v_day, 'email', 'attempt', p_email_hash, 1)
  on conflict (day, scope, kind, subject_hash) do update
    set attempts = contact_inquiry_rate_limits.attempts + 1
    where contact_inquiry_rate_limits.attempts < c_email_attempt_cap
  returning attempts into v_attempts;
  if v_attempts is null then raise exception 'CONTACT_ATTEMPT_LIMIT'; end if;

  -- 성공 예약 — Resend를 부르기 전에 상한까지 원자적으로 확인+증가한다.
  -- 두 요청이 동시에 도달해도 Postgres가 같은 행의 UPDATE를 직렬화하므로
  -- (SELECT 후 나중에 증가시키는 방식과 달리) 상한을 넘겨 통과시키는
  -- 경쟁 상태가 없다.
  v_attempts := null;
  insert into public.contact_inquiry_rate_limits(day, scope, kind, subject_hash, attempts)
  values (v_day, 'daily', 'success', p_category, 1)
  on conflict (day, scope, kind, subject_hash) do update
    set attempts = contact_inquiry_rate_limits.attempts + 1
    where contact_inquiry_rate_limits.attempts < c_daily_success_cap
  returning attempts into v_attempts;
  if v_attempts is null then raise exception 'CONTACT_QUOTA_REACHED'; end if;

  v_attempts := null;
  insert into public.contact_inquiry_rate_limits(day, scope, kind, subject_hash, attempts)
  values (v_day, 'email', 'success', p_email_hash, 1)
  on conflict (day, scope, kind, subject_hash) do update
    set attempts = contact_inquiry_rate_limits.attempts + 1
    where contact_inquiry_rate_limits.attempts < c_email_success_cap
  returning attempts into v_attempts;
  if v_attempts is null then raise exception 'CONTACT_QUOTA_REACHED'; end if;

  delete from public.contact_inquiry_rate_limits where day < v_day - 7;
  return true;
end;
$$;

revoke all on function public.claim_contact_inquiry_attempt(text, text) from public, anon, authenticated;
grant execute on function public.claim_contact_inquiry_attempt(text, text) to service_role;

-- Resend 호출이 실패했을 때만 부른다 — claim_contact_inquiry_attempt가 미리
-- 늘려둔 "성공 예약" 두 칸(카테고리·이메일)을 되돌려, 실패한 시도가 오늘의
-- 진짜 발송 가능 횟수를 깎아먹지 않게 한다("시도" 카운터는 되돌리지 않는다
-- — 그건 원래도 실패 여부와 무관하게 유지되는 값이다).
create or replace function public.release_contact_inquiry_reservation(p_category text, p_email_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'AUTH_REQUIRED';
  end if;
  update public.contact_inquiry_rate_limits
    set attempts = greatest(attempts - 1, 0)
    where day = v_day and scope = 'daily' and kind = 'success' and subject_hash = p_category;
  update public.contact_inquiry_rate_limits
    set attempts = greatest(attempts - 1, 0)
    where day = v_day and scope = 'email' and kind = 'success' and subject_hash = p_email_hash;
end;
$$;

revoke all on function public.release_contact_inquiry_reservation(text, text) from public, anon, authenticated;
grant execute on function public.release_contact_inquiry_reservation(text, text) to service_role;

-- Resend가 성공을 반환한 *직후에만* 부른다. 성공 카운터는 이미
-- claim_contact_inquiry_attempt에서 예약 시점에 늘려뒀으므로, 이 함수는
-- 중복 발송 판별용 (idempotency key, 내용 해시)만 기록한다.
create or replace function public.record_contact_inquiry_delivery(p_idempotency_key uuid, p_content_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CONTACT_RATE_KEY';
  end if;

  insert into public.contact_inquiry_deliveries(idempotency_key, content_hash) values (p_idempotency_key, p_content_hash)
  on conflict (idempotency_key) do update set content_hash = excluded.content_hash, created_at = now();

  delete from public.contact_inquiry_deliveries where created_at < now() - interval '2 days';
  return true;
end;
$$;

revoke all on function public.record_contact_inquiry_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.record_contact_inquiry_delivery(uuid, text) to service_role;
