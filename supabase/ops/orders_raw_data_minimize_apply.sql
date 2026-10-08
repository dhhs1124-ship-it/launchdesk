-- ============================================================================
-- Cafe24 주문 raw_data 최소수집 정리 — 적용(운영 1회 실행)
-- 파일: supabase/ops/orders_raw_data_minimize_apply.sql
-- ============================================================================
-- 하는 일: public.orders 중 provider = 'cafe24'이고 raw_data가 JSON 객체인 "정리 대상" 행의 raw_data만
--   앱 코드(supabase/functions/_shared/cafe24-order-items.mjs slimOrder)와 같은 허용 목록 객체로 바꾼다.
--   - 바꾸지 않는 것: raw_data 외 모든 컬럼(external_order_id 등 중복 방지 키 포함) · cafe24가 아닌 행 ·
--     raw_data가 null이거나 객체가 아닌 행 · 이미 허용 목록뿐인 행
--   - 정리 대상 조건은 precheck [블록 5]와 같다.
-- 마이그레이션이 아니다: 예전 코드가 쌓은 운영 데이터를 한 번 고치는 작업이다. 새 환경에서 다시 돌릴 이유가 없고,
--   새 코드 배포 "뒤"에 실행해야 해서 마이그레이션 순서에 넣지 않는다. 실행 날짜 · 행 수 · post-check 결과를 기록한다.
-- 되돌릴 수 없다(의도): 지운 원본(개인정보)은 이 스크립트로 복구하지 않는다.
--
-- 실행 순서
--   1) cafe24-orders-sync 새 코드 배포
--   2) supabase/verify/orders_raw_data_minimize_precheck_readonly.sql — [블록 3] 트리거 없음, [블록 5] rows_to_minimize 확인
--   3) 이 파일: 아래 set_config('v.expected_rows', …)의 자리표시자를 그 숫자로 바꾸고, 마지막 줄 rollback 그대로 시험 실행
--      → 오류 없이 끝나면 모든 검사 통과(알림 'OK: N행 정리'는 SQL Editor에 따라 안 보일 수 있음)
--      → 마지막 줄을 commit; 으로 바꿔 한 번 더 실행
--   4) supabase/verify/orders_raw_data_minimize_post_apply_readonly.sql
--
-- 멈추고 전부 되돌리는 경우(아무것도 저장되지 않음)
--   - 바뀐 행 수가 precheck와 다름(그 사이 주문 동기화 등) → precheck를 다시 실행
--   - raw_data 외 컬럼 · cafe24가 아닌 행 · raw_data가 객체가 아닌 행이 바뀜(트리거 등)
--   - 정리 뒤에도 허용 목록 밖 key가 남음
--   - 다른 쓰기(주문 동기화)가 5초 넘게 표를 잡고 있음
--   오류로 멈춘 뒤 같은 창에서 다른 SQL을 실행하기 전에 rollback; 을 한 번 실행한다.

begin;

-- 정리하는 동안 다른 쓰기(주문 동기화 upsert)만 잠깐 막는다 — 조회는 그대로 된다
set local lock_timeout = '5s';
lock table public.orders in share row exclusive mode;

select set_config('v.expected_rows', 'PUT-PRECHECK-ROWS-TO-MINIMIZE-HERE', true);

-- 바꾸기 전 지문: 전체 행 수 · 모든 행의 raw_data 외 컬럼 · cafe24가 아닌 행 전체 · raw_data가 객체가 아닌 행 전체
select set_config('v.before_rows', (select count(*)::text from public.orders), true);
select set_config('v.before_cols', (select coalesce(md5(string_agg(t, '|' order by t)), '')
                                      from (select (to_jsonb(o) - 'raw_data')::text as t from public.orders o) s), true);
select set_config('v.before_other', (select coalesce(md5(string_agg(t, '|' order by t)), '')
                                       from (select to_jsonb(o)::text as t from public.orders o
                                              where o.provider is distinct from 'cafe24'
                                                 or jsonb_typeof(o.raw_data) is distinct from 'object') s), true);

-- 앱 코드와 같은 변환(세션 임시 함수 — rollback이면 함께 사라지고, commit이어도 세션이 끝나면 사라진다)
-- str(): 문자열은 그대로, 숫자 · 참거짓은 문자열로, 없음 · null은 null
create or replace function pg_temp.lr_str(v jsonb) returns jsonb language sql immutable as $fn$
  select case jsonb_typeof(v)
           when 'string' then v
           when 'number' then to_jsonb(v #>> '{}')
           when 'boolean' then to_jsonb(v #>> '{}')
           else 'null'::jsonb
         end
$fn$;

-- num(): 숫자는 그대로, 숫자 문자열("32000.00")은 숫자(32000)로, 빈 값 · 숫자가 아닌 값은 null
create or replace function pg_temp.lr_num(v jsonb) returns jsonb language sql immutable as $fn$
  select case
           when jsonb_typeof(v) = 'number' then to_jsonb(trim_scale((v #>> '{}')::numeric))
           when jsonb_typeof(v) = 'string'
                and (v #>> '{}') ~ '^\s*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?\s*$'
             then to_jsonb(trim_scale((v #>> '{}')::numeric))
           else 'null'::jsonb
         end
$fn$;

-- slimOrder(): 허용 목록 9개 key만 · actual_order_amount는 금액 13개만(객체가 아니면 null)
create or replace function pg_temp.lr_minimize(raw jsonb) returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'order_id', raw ->> 'order_id',
    'order_date', pg_temp.lr_str(raw -> 'order_date'),
    'paid', pg_temp.lr_str(raw -> 'paid'),
    'canceled', pg_temp.lr_str(raw -> 'canceled'),
    'order_place_id', pg_temp.lr_str(raw -> 'order_place_id'),
    'market_id', pg_temp.lr_str(raw -> 'market_id'),
    'payment_amount', pg_temp.lr_num(raw -> 'payment_amount'),
    'naver_point', pg_temp.lr_num(raw -> 'naver_point'),
    'actual_order_amount',
      case when jsonb_typeof(raw -> 'actual_order_amount') in ('object', 'array') then jsonb_build_object(
        'order_price_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'order_price_amount'),
        'shipping_fee', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'shipping_fee'),
        'points_spent_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'points_spent_amount'),
        'credits_spent_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'credits_spent_amount'),
        'coupon_discount_price', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'coupon_discount_price'),
        'coupon_shipping_fee_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'coupon_shipping_fee_amount'),
        'membership_discount_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'membership_discount_amount'),
        'shipping_fee_discount_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'shipping_fee_discount_amount'),
        'set_product_discount_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'set_product_discount_amount'),
        'app_discount_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'app_discount_amount'),
        'market_other_discount_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'market_other_discount_amount'),
        'total_amount_due', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'total_amount_due'),
        'payment_amount', pg_temp.lr_num(raw -> 'actual_order_amount' -> 'payment_amount'))
      else 'null'::jsonb end)
$fn$;

-- 정리 대상(precheck [블록 5]와 같은 조건)의 raw_data만 바꾼다
with changed as (
  update public.orders
     set raw_data = pg_temp.lr_minimize(raw_data)
   where provider = 'cafe24'
     and jsonb_typeof(raw_data) = 'object'
     and ((raw_data - array['order_id', 'order_date', 'paid', 'canceled', 'order_place_id', 'market_id',
                            'payment_amount', 'naver_point', 'actual_order_amount']) <> '{}'::jsonb
          or (jsonb_typeof(raw_data -> 'actual_order_amount') is not distinct from 'object'
              and (raw_data -> 'actual_order_amount')
                  - array['order_price_amount', 'shipping_fee', 'points_spent_amount', 'credits_spent_amount',
                          'coupon_discount_price', 'coupon_shipping_fee_amount', 'membership_discount_amount',
                          'shipping_fee_discount_amount', 'set_product_discount_amount', 'app_discount_amount',
                          'market_other_discount_amount', 'total_amount_due', 'payment_amount'] <> '{}'::jsonb)
          or coalesce(jsonb_typeof(raw_data -> 'actual_order_amount'), 'null') not in ('object', 'null'))
  returning 1
)
select set_config('v.updated_rows', count(*)::text, true) from changed;

-- 검사 — 하나라도 어긋나면 예외로 멈추고 이 트랜잭션 전체가 되돌려진다
do $$
declare
  allowed text[] := array['order_id', 'order_date', 'paid', 'canceled', 'order_place_id', 'market_id',
                          'payment_amount', 'naver_point', 'actual_order_amount'];
  amounts text[] := array['order_price_amount', 'shipping_fee', 'points_spent_amount', 'credits_spent_amount',
                          'coupon_discount_price', 'coupon_shipping_fee_amount', 'membership_discount_amount',
                          'shipping_fee_discount_amount', 'set_product_discount_amount', 'app_discount_amount',
                          'market_other_discount_amount', 'total_amount_due', 'payment_amount'];
begin
  if current_setting('v.expected_rows') !~ '^[0-9]+$' then
    raise exception 'FAIL: v.expected_rows에 precheck [블록 5] rows_to_minimize 숫자를 넣으세요.';
  end if;
  if current_setting('v.updated_rows') <> current_setting('v.expected_rows') then
    raise exception 'FAIL: 바뀐 행 %건 ≠ precheck %건 — 전부 되돌립니다. precheck를 다시 실행하세요.',
      current_setting('v.updated_rows'), current_setting('v.expected_rows');
  end if;
  if (select count(*)::text from public.orders) <> current_setting('v.before_rows') then
    raise exception 'FAIL: 전체 행 수가 바뀜 — 전부 되돌립니다.';
  end if;
  if (select coalesce(md5(string_agg(t, '|' order by t)), '')
        from (select (to_jsonb(o) - 'raw_data')::text as t from public.orders o) s) <> current_setting('v.before_cols') then
    raise exception 'FAIL: raw_data 외 컬럼이 바뀜(트리거 등) — 전부 되돌립니다.';
  end if;
  if (select coalesce(md5(string_agg(t, '|' order by t)), '')
        from (select to_jsonb(o)::text as t from public.orders o
               where o.provider is distinct from 'cafe24'
                  or jsonb_typeof(o.raw_data) is distinct from 'object') s) <> current_setting('v.before_other') then
    raise exception 'FAIL: cafe24가 아니거나 raw_data가 객체가 아닌 행이 바뀜 — 전부 되돌립니다.';
  end if;
  if exists (select 1 from public.orders
              where provider = 'cafe24'
                and jsonb_typeof(raw_data) = 'object'
                and ((raw_data - allowed) <> '{}'::jsonb
                     or (jsonb_typeof(raw_data -> 'actual_order_amount') is not distinct from 'object'
                         and (raw_data -> 'actual_order_amount') - amounts <> '{}'::jsonb)
                     or coalesce(jsonb_typeof(raw_data -> 'actual_order_amount'), 'null') not in ('object', 'null'))) then
    raise exception 'FAIL: 정리 뒤에도 허용 목록 밖 key가 남음 — 전부 되돌립니다.';
  end if;
  raise notice 'OK: raw_data %행 정리(다른 컬럼 · 다른 행 변경 없음). 마지막 줄이 rollback이면 아무것도 저장되지 않았습니다.',
    current_setting('v.updated_rows');
end $$;

rollback;  -- 시험 실행. 실제 적용은 이 줄을 commit; 으로 바꿔 한 번 더 실행한다.
