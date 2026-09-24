-- 문의 폼 마이그레이션(20260923160000_contact_inquiry_rate_limit.sql) 적용 *전에*
-- 원격 Supabase 프로젝트의 SQL Editor에서 그대로 실행할 사전 점검. 스키마
-- 메타데이터(테이블·컬럼·함수 정의)만 읽고, contact_inquiry_* 테이블의 실제
-- 데이터 행은 단 한 건도 조회하지 않는다. INSERT/UPDATE/DELETE/DDL 전혀 없음
-- — 이 쿼리 자체를 실행해도 아무것도 만들거나 바꾸지 않는다.
--
-- 이 저장소가 지금까지 이 마이그레이션을 두 번 다시 썼기 때문에(2026-09-23),
-- 원격에 "이미 적용된" 상태가 있다면 세 가지 중 하나일 수 있다:
--   상태 A(맨 처음 버전) — 테이블 1개(contact_inquiry_rate_limits, kind 컬럼 없음)
--                         + 함수 1개(claim_contact_inquiry_rate_limit(text))
--   상태 B(1차 재설계)   — 테이블 2개(deliveries에 content_hash 없음)
--                         + 함수 3개(already_delivered(uuid), claim_contact_inquiry_attempt(text,text)
--                           [발송 후 성공 카운터 증가하는 옛 로직], record_contact_inquiry_delivery(text,text,uuid))
--   상태 C(지금 버전)     — 테이블 2개(deliveries에 content_hash 있음)
--                         + 함수 4개(already_delivered(uuid,text), claim_contact_inquiry_attempt(text,text)
--                           [발송 *전* 원자적 예약하는 새 로직], release_contact_inquiry_reservation(text,text),
--                           record_contact_inquiry_delivery(uuid,text))
-- 아래 세 블록의 결과를 이 파일 맨 아래 "결과 해석" 표와 대조할 것.

-- ── 1) 테이블 존재 여부 + 컬럼 목록 ─────────────────────────────────────────
select
  t.table_name,
  string_agg(c.column_name || ':' || c.data_type, ', ' order by c.ordinal_position) as columns
from information_schema.tables t
join information_schema.columns c
  on c.table_schema = t.table_schema and c.table_name = t.table_name
where t.table_schema = 'public'
  and t.table_name in ('contact_inquiry_rate_limits', 'contact_inquiry_deliveries')
group by t.table_name
order by t.table_name;

-- 위 쿼리가 0행이면 두 테이블 다 없는 것 — 아래 함수 쿼리도 확인할 것
-- (테이블 없이 함수만 남아있는 비정상 상태가 이론상 가능하므로).

-- ── 2) 함수 존재 여부 + 정확한 인자 시그니처 ────────────────────────────────
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  -- claim_contact_inquiry_attempt(text,text)는 상태 B·C에서 시그니처가
  -- 같아 이름·인자만으로 구분이 안 된다 — 본문에 "c_email_success_cap"
  -- (지금 버전에서만 쓰는 변수명)이 있는지로 구분한다.
  (pg_get_functiondef(p.oid) like '%c_email_success_cap%') as looks_like_current_version
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_contact_inquiry_rate_limit',   -- 상태 A 전용
    'contact_inquiry_already_delivered',  -- 상태 B: 인자 1개 / 상태 C: 인자 2개
    'claim_contact_inquiry_attempt',      -- 상태 B·C 공통 시그니처, looks_like_current_version으로 구분
    'release_contact_inquiry_reservation',-- 상태 C 전용
    'record_contact_inquiry_delivery'     -- 상태 B: 인자 3개 / 상태 C: 인자 2개
  )
order by p.proname, arguments;

-- ── 3) (참고) 이 프로젝트에서 함수를 부를 권한이 없는 쪽에 새고 있지 않은지 ──
-- 위 2)에서 함수가 하나라도 나왔다면, 그 함수들이 예상대로 anon/authenticated에는
-- 막혀 있고 service_role에만 열려 있는지도 참고로 확인할 수 있다(선택 사항).
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_contact_inquiry_rate_limit', 'contact_inquiry_already_delivered',
    'claim_contact_inquiry_attempt', 'release_contact_inquiry_reservation',
    'record_contact_inquiry_delivery'
  )
order by p.proname, arguments;

-- ── 결과 해석 ────────────────────────────────────────────────────────────
-- 1)·2)가 전부 0행 → 아무것도 없음(상태 0). 지금 마이그레이션 파일을 그대로
--   적용해도 된다 — "create table"이 실패할 이유가 없다.
--
-- 1)에서 contact_inquiry_rate_limits는 나오는데 columns에 "kind:"가 없음
--   → 상태 A(맨 처음 버전). 지금 마이그레이션 파일을 그대로 적용하면
--   "relation already exists"로 실패한다. 그대로 적용하지 말 것 — 옛
--   테이블·함수(claim_contact_inquiry_rate_limit)를 어떻게 할지(보존한 채
--   새 테이블을 다른 이름으로 만들지, DROP 후 새로 만들지) 먼저 정해야
--   한다. DROP은 기존 발송 횟수 기록이 날아간다는 뜻이므로(문의 원문·
--   이메일은 원래도 저장 안 하니 개인정보 손실은 아니지만, 그날 카운터가
--   초기화된다) 별도로 검토할 것.
--
-- 1)에서 contact_inquiry_deliveries가 없거나 있어도 columns에
--   "content_hash:"가 없음, 그리고/또는 2)에서 claim_contact_inquiry_attempt는
--   있는데 looks_like_current_version=false, 그리고/또는
--   release_contact_inquiry_reservation이 아예 없음 → 상태 B(1차 재설계).
--   지금 파일을 그대로 재실행하면 테이블은 "already exists"로 실패하고,
--   함수는 시그니처가 겹치는 것(claim_contact_inquiry_attempt)은
--   "CREATE OR REPLACE"로 덮어써지지만 시그니처가 다른 것
--   (contact_inquiry_already_delivered, record_contact_inquiry_delivery)은
--   옛 버전과 새 버전이 동시에 남는 오버로드 상태가 된다 — Edge Function은
--   새 시그니처로만 호출하므로 옛 버전은 죽은 채 남지만, 스키마가 지저분해
--   지고 옛 함수의 권한(anon/authenticated 차단)이 그대로 유지되는지도
--   별도로 확인해야 한다. 이행 마이그레이션(테이블 컬럼 추가 + 옛 시그니처
--   함수 명시적 DROP)이 필요하다 — 지금 파일을 그대로 적용하지 말 것.
--
-- 1)에서 두 테이블 다 있고 deliveries에 content_hash:가 있음, 2)에서
--   claim_contact_inquiry_attempt의 looks_like_current_version=true이고
--   release_contact_inquiry_reservation도 있음 → 상태 C(지금 버전과 동일).
--   이미 적용돼 있다는 뜻이다 — 지금 마이그레이션 파일을 다시 적용할
--   필요가 없고(그대로 실행하면 테이블은 "already exists"로 실패한다),
--   적용 자체를 건너뛰고 바로 verify(contact_inquiry_rate_limit_verify.sql)만
--   돌리면 된다.
--
-- 2)에서 같은 함수 이름(예: contact_inquiry_already_delivered)이 서로 다른
--   arguments로 "두 줄 이상" 나오면(오버로드) → 과거에 이 마이그레이션을
--   부분적으로/여러 버전 섞어 수동 적용한 흔적이다. 위 상태 구분과 별개로
--   반드시 각 줄을 개별적으로 검토하고, 필요 없는 옛 시그니처는 명시적으로
--   DROP FUNCTION IF EXISTS로 정리한 뒤에 지금 마이그레이션을 적용할 것.
