-- Cafe24 주문 동기화 범위 기록 — connected_accounts.orders_synced_from
--
-- 운영 현황(#/dashboard)이 기간별 주문 수치를 "0건"으로 보여도 되는지(그
-- 기간 주문이 실제로 동기화됐는지) 판단하는 근거. cafe24-orders-sync가 한
-- 범위를 오류 없이 끝까지 가져와 last_synced_at을 갱신할 때 같은 update로
-- 함께 기록한다(supabase/functions/_shared/orders-sync-range.mjs).
--
--   의미: [orders_synced_from 00:00 KST, last_synced_at] 구간의 주문은 빠짐없이
--         동기화됐다. null이면 기록 없음 — 과거 범위를 추정하지 않는다.
--
-- 적용 순서: 이 마이그레이션 → cafe24-orders-sync 배포 → 웹 배포.
-- (새 함수 · 새 화면은 이 컬럼을 select하므로, 컬럼이 없으면 동기화 · 운영
-- 현황 Cafe24 조회가 실패한다.)
--
-- 권한: connected_accounts는 authenticated에 테이블 단위 SELECT만 있다
-- (20260922130000_core_table_privilege_hardening.sql) — 새 컬럼도 RLS(본인
-- 행)대로 읽기만 가능하고, 쓰기는 service role(Edge Function)만 한다. 연결
-- 해제(disconnect_cafe24_integration)는 행 자체를 지우므로 기록도 함께 사라진다.

alter table public.connected_accounts
  add column if not exists orders_synced_from date;

comment on column public.connected_accounts.orders_synced_from is
  'Cafe24 주문이 이 날짜(KST)부터 last_synced_at까지 빠짐없이 동기화됐다는 기록. cafe24-orders-sync만 기록. null = 기록 없음.';
