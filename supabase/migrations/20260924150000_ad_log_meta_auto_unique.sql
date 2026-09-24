-- 광고 기록(tool_records, tool_type='ad_log')의 Meta 자동 기록 중복 방지
--
-- 운영 현황 "광고 기록"의 Meta 자동 기록(adlog-meta.js)은 쇼핑몰 · Meta 광고계정
-- · 날짜당 1건만 둔다. 기록의 data 안에 meta_auto_key("store_id|광고계정|YYYY-MM-DD")
-- 를 넣고, 같은 사용자 안에서 이 키가 두 번 들어오지 못하게 막는다. 화면도 먼저
-- 불러온 목록으로 건너뛰지만, 두 탭에서 동시에 누르는 경우까지 여기서 막는다
-- (두 번째 insert는 23505로 거부 → 화면은 "이미 기록됨"으로 처리).
--
-- 수동 기록(meta_auto_key 없음)은 이 인덱스 대상이 아니다 — 기존 기록 · 새 수동
-- 기록 모두 그대로 여러 건 저장할 수 있다. tool_records에는 UPDATE 권한이 없어
-- (20260922130000_core_table_privilege_hardening.sql) 기존 기록은 덮어쓰지 않는다.
--
-- 적용 순서: 이 마이그레이션 → 웹 배포(없어도 화면의 목록 기준 건너뛰기는 동작한다).
--
-- 구조 · 권한 검토:
--   - tool_records는 이 저장소 마이그레이션 밖에서 만들어졌고 data 컬럼 타입(json/jsonb)
--     기록이 없다 — jsonb 전용 연산자(?)를 쓰지 않고 json · jsonb 모두 되는 ->>만 쓴다
--     (store.js도 data->>id만 쓴다).
--   - 키에 user_id를 포함하므로 사용자끼리 충돌하지 않는다. 인덱스는 GRANT가 필요 없고,
--     authenticated의 기존 SELECT · INSERT · DELETE 권한과 RLS는 그대로다.
--   - 자동 기록은 이 마이그레이션과 함께 처음 생기므로, 적용 시점에 이 키로 중복된
--     기존 행은 없다(수동 기록에는 meta_auto_key가 없다).

create unique index if not exists tool_records_ad_log_meta_auto_key
  on public.tool_records (user_id, (data ->> 'meta_auto_key'))
  where tool_type = 'ad_log' and (data ->> 'meta_auto_key') is not null;
