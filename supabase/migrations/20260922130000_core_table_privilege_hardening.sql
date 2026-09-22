-- LaunchDesk 오픈 베타 전 DB 권한 최소화 — public.stores / public.
-- connected_accounts / public.tool_records의 authenticated 권한을 실제
-- 코드가 쓰는 최소 집합으로 좁힌다(1차 코드 감사 후속 — orders에 이미
-- 적용한 20260921100000_orders_privilege_hardening.sql과 같은 성격의
-- 작업을 이 세 테이블로 확장).
--
-- [2026-09-22 보강] 최초 버전은 "REVOKE ALL ON TABLE"(테이블 단위 권한)만
-- 다뤘다. 원격 core_table_privilege_hardening_prereq_readonly.sql 실행
-- 결과, 테이블 단위 권한과는 완전히 별개로 세 테이블의 **모든 컬럼에
-- authenticated의 컬럼 단위 INSERT/REFERENCES/SELECT/UPDATE 권한이 각각
-- 부여돼 있음**이 확인됐다. PostgreSQL은 테이블 단위 GRANT/REVOKE와 컬럼
-- 단위 GRANT/REVOKE를 서로 다른 ACL 항목(pg_class.relacl vs pg_attribute.
-- attacl)으로 완전히 독립적으로 관리한다 — "REVOKE ALL ON TABLE"은
-- pg_class.relacl만 비우고 pg_attribute.attacl(컬럼 단위 권한)에는 전혀
-- 영향을 주지 않는다. 즉 최초 버전을 그대로 적용해도 컬럼 단위 권한이
-- 남아 authenticated는 여전히 (예를 들어) connected_accounts의 모든
-- 컬럼에 INSERT/UPDATE를 컬럼 단위로 시도할 수 있는 상태가 유지된다 —
-- 권한 최소화가 완성되지 않는다. 이번 버전은 컬럼 단위 REVOKE를 명시적으로
-- 추가해 이 구멍을 막는다.
--
-- 배경 — 원격 읽기 전용 검사(core_table_privilege_hardening_prereq_
-- readonly.sql, 사람이 직접 실행)에서 확인된 현재 상태:
--   테이블 단위: stores/connected_accounts/tool_records 전부 authenticated
--     = DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   컬럼 단위: 세 테이블의 "모든" 컬럼에 authenticated의 INSERT,
--     REFERENCES, SELECT, UPDATE 권한이 각각 존재(DELETE/TRUNCATE/TRIGGER/
--     MAINTAIN은애초에 PostgreSQL에서 컬럼 단위로 존재할 수 없는 권한이라
--     해당 없음).
--   anon/PUBLIC은 테이블 단위 권한이 없음(확인됨) — 컬럼 단위 권한 존재
--     여부는 prereq 결과에 함께 나열돼 있으므로, 아래 REVOKE는 안전하게
--     "있으면 지우고 없어도 오류 없이 끝나는" REVOKE 문으로 anon/PUBLIC도
--     함께 다룬다(REVOKE는 대상 권한이 이미 없어도 에러 없이 0건으로
--     끝난다).
--
-- 아래 REVOKE/GRANT는 "현재 정확히 무엇이 부여돼 있는가"에 의존하지
-- 않는다 — 테이블 단위·컬럼 단위 권한을 전부 비운 뒤 코드로 증명된 최소
-- 권한만 테이블 단위로만 다시 부여하므로, 실제 현재 상태가 위 보고와
-- 약간 다르더라도 결과는 항상 동일한 최소 집합으로 수렴한다.
--
-- 조사 방법 — 저장소 전체(*.js, *.ts)에서 각 테이블의 .from('테이블명')/
-- .from("테이블명") 호출을 전부 찾아, 그 뒤에 이어지는 .select/.insert/
-- .update/.delete/.upsert 중 어떤 것이 실제로 호출되는지, 그리고 어떤
-- Supabase 클라이언트(브라우저의 authenticated 세션 vs Edge Function의
-- ctx.supabase(사용자 JWT) vs ctx.supabaseAdmin(service_role))로
-- 실행되는지를 하나하나 확인했다(자세한 근거는 각 절 참고).
--
-- ---------------------------------------------------------------------------
-- 1) public.stores — authenticated: SELECT, INSERT, UPDATE, DELETE(테이블 단위만)
-- ---------------------------------------------------------------------------
-- 확인된 실제 호출:
--   - stores.js fetchStores(): sb.from('stores').select(...) — 목록 조회.
--   - stores.js 폼 제출: 신규 등록은 sb.from('stores').insert(...), 수정은
--     sb.from('stores').update(...).eq('id', editingId).eq('user_id', ...).
--   - stores.js deleteStore(): sb.from('stores').delete()
--     .eq('id', id).eq('user_id', currentUserId).
--   - admin.js/ops-overview.js: sb.from('stores').select(...)뿐(관리자 전체
--     조회·본인 쇼핑몰 필터 조회) — insert/update/delete 없음.
--   - Edge Function 중 stores를 쓰는 곳(cafe24-oauth-start/-callback,
--     cafe24-orders-sync, cafe24-store-info, meta-oauth-start, meta-adset-
--     insights)은 소유권 확인 select만 ctx.supabase(사용자 JWT)로 하고,
--     stores.external_store_id/updated_at에 대한 모든 쓰기는 ctx.
--     supabaseAdmin(service_role)만 수행한다 — authenticated 권한과
--     무관하게 동작한다.
--   - TRUNCATE/REFERENCES/TRIGGER/MAINTAIN을 쓰는 코드는 저장소 어디에도
--     없다 — 전부 회수 대상. 컬럼 단위 INSERT/REFERENCES/SELECT/UPDATE도
--     전부 회수 대상(테이블 단위로만 재부여하므로 컬럼 단위 GRANT는 이
--     migration 적용 후 0이어야 한다).
--
-- ---------------------------------------------------------------------------
-- 2) public.connected_accounts — authenticated: SELECT만(테이블 단위만)
-- ---------------------------------------------------------------------------
-- 확인된 실제 호출:
--   - 브라우저(stores.js fetchConnectedAccounts/fetchMetaAccounts, admin.js
--     fetchAllConnectedAccountsForAdmin/fetchConnectedAccountsForStoreIds/
--     fetchStoreCount류, ops-overview.js loadEligibleCafe24Stores/Meta 상태
--     조회)는 전부 .select(...)만 호출한다 — insert/update/delete를
--     호출하는 브라우저 코드는 저장소 전체에 단 한 줄도 없다(grep으로
--     확인).
--   - Edge Function(cafe24-oauth-callback, cafe24-orders-sync, cafe24-
--     store-info, meta-account-select, meta-adaccounts, meta-adset-
--     insights, meta-insights, meta-oauth-callback, meta-disconnect)도
--     소유권 확인 select만 ctx.supabase(사용자 JWT)로 하고, insert/update/
--     delete는 전부 ctx.supabaseAdmin(service_role)이다.
--   - disconnect_cafe24_integration()(20260922120000_cafe24_disconnect.sql)
--     은 ctx.supabase.rpc(...)로 호출되지만 SECURITY DEFINER라 함수 내부의
--     delete/update는 호출자(authenticated)가 아니라 함수 소유자 권한으로
--     실행된다 — 이 revoke로 인해 깨지지 않는다.
--   - 즉 authenticated가 connected_accounts에 실제로 쓰는 권한은 SELECT
--     뿐이다. INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
--     (테이블 단위)과 INSERT/REFERENCES/SELECT/UPDATE(컬럼 단위) 전부
--     회수 대상 — 남는 것은 테이블 단위 SELECT 하나뿐이다.
--
-- ---------------------------------------------------------------------------
-- 3) public.tool_records — authenticated: SELECT, INSERT, DELETE(테이블 단위만, UPDATE 제외)
-- ---------------------------------------------------------------------------
-- 확인된 실제 호출(store.js, app.js):
--   - store.js hydrate(): sb.from('tool_records').select('data, created_at')
--     .eq('user_id', userId).eq('tool_type', ...) — 마진계산/광고기록 조회.
--   - store.js addCalcRecord()/addAdlogRecord(), app.js(게스트 데이터
--     이전 시): sb.from('tool_records').insert({ user_id, tool_type, data }).
--   - store.js clearCalcHistory()/removeAdlogRecord():
--     sb.from('tool_records').delete().eq('user_id', ...).eq('tool_type', ...)
--     (ad_log는 .eq('data->>id', ...) 조건 추가) — 본인 기록만 삭제.
--   - .update(를 호출하는 코드가 저장소 전체(*.js, *.ts)에 단 한 곳도 없다
--     (grep으로 확인) — 기록은 항상 "새로 추가" 또는 "통째로 삭제"만 하고
--     기존 행의 값을 부분 수정하는 흐름 자체가 없다.
--   - Edge Function/service_role/RPC 중 tool_records를 쓰는 곳은 없다.
--   - 따라서 UPDATE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN(테이블 단위)과
--     INSERT/REFERENCES/SELECT/UPDATE(컬럼 단위) 전부 회수 대상.
--
-- ---------------------------------------------------------------------------
-- 이 파일이 하지 않는 것(범위 밖 — 명시적으로 그대로 둔다):
-- ---------------------------------------------------------------------------
--   - RLS 활성화 여부·정책(cmd/roles/USING/WITH CHECK)을 전혀 만들거나
--     바꾸지 않는다 — 이 파일은 GRANT/REVOKE(테이블·컬럼 단위 권한)만
--     다룬다. RLS는 "그 권한 안에서 어떤 행이 보이는가"를 결정하고,
--     GRANT는 "그 동작 자체를 시도할 수 있는가"를 결정하는 서로 다른
--     층위다 — 이미 존재하는 정책은 이 revoke 이후에도 그대로 평가된다.
--   - public.orders는 건드리지 않는다 — 20260921100000_orders_privilege_
--     hardening.sql로 이미 별도 하드닝이 끝났다.
--   - public.integration_credentials, public.oauth_states, public.
--     ad_margin_links는 이번 범위에서 다루지 않는다(요구사항 그대로) —
--     별도 조사·후속 migration으로 분리한다.
--   - service_role/postgres의 테이블·컬럼 권한은 전혀 언급하지 않는다 —
--     이 파일의 모든 REVOKE/GRANT는 anon/authenticated/PUBLIC만 대상으로
--     한다.
--   - id 컬럼의 identity/시퀀스(USAGE/SELECT/UPDATE) 권한을 전혀 건드리지
--     않는다 — 이 파일에 SEQUENCE 관련 GRANT/REVOKE 문장이 단 하나도
--     없다. 원격 prereq 결과 세 테이블의 id는 모두 identity 컬럼이고
--     authenticated의 시퀀스 권한은 usage=false/select=false/update=false
--     인데도 브라우저 INSERT가 이미 정상 동작 중이다(identity 컬럼은
--     SQL 표준상 DEFAULT의 nextval 호출이 시퀀스 권한 검사를 우회한다 —
--     legacy serial과 다른 부분). 이 상태를 그대로 유지한다 — 이번
--     migration에서 시퀀스 권한을 새로 주거나 뺏지 않는다.
--   - PostgreSQL default privileges(ALTER DEFAULT PRIVILEGES, pg_default_acl)
--     는 이 파일에서 임의로 바꾸지 않는다. 원격 prereq 결과 supabase_admin
--     이 만든 기본 권한(default privileges)이 anon/authenticated에게
--     새로 만들어지는 테이블·시퀀스에 대해 광범위한 권한을 자동으로 주고
--     있음이 확인됐다 — 이는 이 세 테이블 각각의 GRANT/REVOKE로는 해결할
--     수 없는 프로젝트 전역 설정이라, 섞지 않고 별도 후속 보안 과제로만
--     보고한다(사람이 별도로 ALTER DEFAULT PRIVILEGES 적용 여부를 판단).
--   - 테이블/컬럼/인덱스/데이터를 만들거나 바꾸거나 지우지 않는다 — GRANT/
--     REVOKE 문장 외에는 아무 것도 실행하지 않는다.
--
-- to_regclass로 각 테이블 존재를 먼저 확인한 뒤에만 GRANT/REVOKE를
-- 실행한다(이 저장소를 처음부터 새로 세팅해 아직 이 테이블들이 없는
-- 환경에서도 migration이 실패하지 않게 하기 위함 — 20260921100000_orders_
-- privilege_hardening.sql과 동일한 방어). 컬럼 목록은 원격 prereq 실행
-- 결과로 실제 확인된 값을 그대로 썼다(추측 없음). 객체 이름(스키마·
-- 테이블명·컬럼명·역할명·권한명)은 전부 이 파일에 고정 리터럴로만 쓰여
-- 있고, 사용자 입력이나 실행 시점에 조립되는 동적 값은 전혀 없다.
--
-- 아래 세 DO 블록 전체를 BEGIN ~ COMMIT으로 감싼다 — 중간에 하나라도
-- 실패하면 이미 실행된 앞 블록의 권한 변경까지 전부 롤백되게 하기 위함.

begin;

do $$
begin
  if to_regclass('public.stores') is not null then
    -- 테이블 단위 권한 전부 회수.
    revoke all on table public.stores from public;
    revoke all on table public.stores from anon;
    revoke all on table public.stores from authenticated;

    -- 컬럼 단위 권한 전부 회수(원격 확인된 실제 9개 컬럼 전부 명시).
    -- REVOKE ALL PRIVILEGES (컬럼 목록) ON TABLE ...은 SELECT/INSERT/
    -- UPDATE/REFERENCES(컬럼 단위로 존재할 수 있는 권한 전부)를 한 번에
    -- 회수한다 — DELETE/TRUNCATE/TRIGGER/MAINTAIN은 PostgreSQL에서
    -- 애초에 컬럼 단위로 존재할 수 없는 권한이라 이 문장의 대상이 아니다
    -- (위 테이블 단위 REVOKE ALL이 이미 처리했다).
    revoke all privileges (
      created_at, external_store_id, id, is_active, name, platform,
      store_url, updated_at, user_id
    ) on table public.stores from public;
    revoke all privileges (
      created_at, external_store_id, id, is_active, name, platform,
      store_url, updated_at, user_id
    ) on table public.stores from anon;
    revoke all privileges (
      created_at, external_store_id, id, is_active, name, platform,
      store_url, updated_at, user_id
    ) on table public.stores from authenticated;

    -- 코드로 증명된 최소 권한만 테이블 단위로만 재부여(컬럼 단위 GRANT는
    -- 다시 주지 않는다).
    grant select, insert, update, delete on table public.stores to authenticated;
  end if;
end $$;

do $$
begin
  if to_regclass('public.connected_accounts') is not null then
    revoke all on table public.connected_accounts from public;
    revoke all on table public.connected_accounts from anon;
    revoke all on table public.connected_accounts from authenticated;

    -- 컬럼 단위 권한 전부 회수(원격 확인된 실제 10개 컬럼 전부 명시).
    revoke all privileges (
      connected_at, created_at, display_name, external_account_id, id,
      last_synced_at, provider, status, store_id, updated_at
    ) on table public.connected_accounts from public;
    revoke all privileges (
      connected_at, created_at, display_name, external_account_id, id,
      last_synced_at, provider, status, store_id, updated_at
    ) on table public.connected_accounts from anon;
    revoke all privileges (
      connected_at, created_at, display_name, external_account_id, id,
      last_synced_at, provider, status, store_id, updated_at
    ) on table public.connected_accounts from authenticated;

    grant select on table public.connected_accounts to authenticated;
  end if;
end $$;

do $$
begin
  if to_regclass('public.tool_records') is not null then
    revoke all on table public.tool_records from public;
    revoke all on table public.tool_records from anon;
    revoke all on table public.tool_records from authenticated;

    -- 컬럼 단위 권한 전부 회수(원격 확인된 실제 6개 컬럼 전부 명시).
    revoke all privileges (
      created_at, data, id, record_date, tool_type, user_id
    ) on table public.tool_records from public;
    revoke all privileges (
      created_at, data, id, record_date, tool_type, user_id
    ) on table public.tool_records from anon;
    revoke all privileges (
      created_at, data, id, record_date, tool_type, user_id
    ) on table public.tool_records from authenticated;

    grant select, insert, delete on table public.tool_records to authenticated;
  end if;
end $$;

commit;
