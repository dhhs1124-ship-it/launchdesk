-- LaunchDesk 1차 코드 감사(P2) 후속 조치 — public.orders 테이블에서
-- authenticated 역할이 갖고 있던 불필요한 권한(INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER)을 회수하고 SELECT만 남긴다. anon/PUBLIC
-- 권한도 함께 회수한다.
--
-- 배경(이 파일 작성 전 저장소 전체를 직접 검색해 확인한 것):
--   - orders 테이블에 직접 쓰는 브라우저/authenticated 코드가 있는지
--     저장소 전체(*.js)를 grep했다 — orders를 실제로 건드리는 곳은
--     ops-overview.js:392 하나뿐이고, 그마저도 .select('store_id,
--     ordered_at, payment_amount')로 읽기만 한다. INSERT/UPDATE/DELETE를
--     호출하는 코드는 어디에도 없다(다른 파일에 나오는 "orders"는 전부
--     '/start/orders' 라우트 경로나 'usersWithOrders' 베타 지표 필드명
--     등 이 테이블과 무관한 문자열이었다).
--   - 실제 주문 동기화(supabase/functions/cafe24-orders-sync/index.ts)는
--     ctx.supabaseAdmin(service_role — RLS와 테이블 GRANT를 모두 우회
--     하는 서버 전용 클라이언트, _shared/cafe24-token.ts 주석에 "RLS
--     우회, 서버 전용"이라고 명시됨)으로만 orders에 쓴다. authenticated/
--     anon 권한을 아무리 좁혀도 이 서버 쪽 쓰기 경로에는 영향이 없다.
--   - 즉 authenticated가 orders에서 실제로 쓰는 권한은 SELECT뿐이다
--     (운영 현황 패널이 본인 매장의 이번 달 주문만 읽어 KPI를 계산함).
--
-- 이 파일이 하지 않는 것:
--   - orders 테이블 자체를 만들지 않는다 — 저장소에 이 테이블을 만드는
--     migration 파일이 없다는 사실(supabase/migrations/ 전체를 grep해
--     확인함)은 이 파일의 범위 밖이며, 추측으로 CREATE TABLE을 새로
--     쓰지 않는다. 별도의 schema baseline 작업으로 다뤄야 한다.
--   - 기존 RLS 정책("Users can view own orders")을 삭제하거나 다시
--     쓰지 않는다 — 정책은 그대로 두고 GRANT/REVOKE만 조정한다.
--   - orders의 행(주문 데이터)을 조회·수정·삭제하지 않는다 — 이 파일
--     전체가 시스템 카탈로그에 대한 GRANT/REVOKE 문뿐이다.
--
-- public.orders가 아직 없는 환경(예: 이 저장소를 처음부터 새로 세팅하는
-- 경우)에서도 이 migration이 실패하지 않도록 to_regclass로 존재를 먼저
-- 확인한 뒤에만 GRANT/REVOKE를 실행한다. 객체 이름(스키마.테이블명,
-- 역할명, 권한명)은 전부 이 파일에 고정 리터럴로만 쓰여 있고, 사용자
-- 입력이나 실행 시점에 조립되는 동적 값은 전혀 없다.
do $$
begin
  if to_regclass('public.orders') is not null then
    -- PUBLIC과 anon에 남아 있을 수 있는 모든 권한을 먼저 비운다(원격
    -- 메타데이터 확인 결과 현재 둘 다 권한이 없는 것으로 확인됐지만,
    -- 다른 마이그레이션들과 같은 관례로 방어적으로 명시해 둔다).
    revoke all on table public.orders from public;
    revoke all on table public.orders from anon;

    -- authenticated에게 남아 있던 불필요한 권한만 정확히 회수한다.
    -- SELECT는 이 목록에 없으므로 그대로 유지된다.
    revoke insert, update, delete, truncate, references, trigger
      on table public.orders from authenticated;

    -- SELECT는 "그대로 둔다"가 아니라 명시적으로 다시 선언해 둔다 —
    -- 이후 누군가 위 REVOKE 문을 복사해 실수로 "revoke all"로 바꿔도
    -- 이 GRANT 한 줄이 같은 파일 안에 남아 있어 바로 드러나 보이게
    -- 하기 위함이다(현재 이미 부여돼 있으므로 기능적으로는 no-op).
    grant select on table public.orders to authenticated;
  end if;
end $$;
