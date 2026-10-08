-- ============================================================================
-- Cafe24 주문 raw_data 최소수집 정리 — 적용 "전" 읽기 전용 확인
-- 파일: supabase/verify/orders_raw_data_minimize_precheck_readonly.sql
-- ============================================================================
-- 무엇: public.orders 중 provider = 'cafe24' 행의 raw_data에 남은 Cafe24 주문 원본 전체(주문자 · 결제자 ·
--   회원 · SNS · 카드 거래 · 계좌 · 자유 입력 등)를 앱 코드와 같은 허용 목록으로 줄이기 전에 대상 행 수와
--   개인정보 key 존재 건수를 센다.
-- 안전: SELECT만 한다. 개인정보 값은 출력하지 않는다(key 이름 · 개수 · 타입 · 크기만).
-- 실행: Supabase SQL Editor에서 [블록]마다 따로 실행해 결과를 확인한다.
--
-- 전체 순서
--   1) cafe24-orders-sync 새 코드 배포(raw_data = 허용 목록) — 먼저 해야 정리 뒤 원본이 다시 쌓이지 않는다
--   2) 이 파일 — [블록 5]의 rows_to_minimize 값을 적어 둔다
--   3) supabase/ops/orders_raw_data_minimize_apply.sql — 기본은 시험 실행(rollback), 확인 뒤 commit
--   4) supabase/verify/orders_raw_data_minimize_post_apply_readonly.sql — 개인정보 key 0건 확인
--
-- 허용 목록 = supabase/functions/_shared/cafe24-order-items.mjs의 slimOrder · ORDER_AMOUNT_FIELDS
--   최상위 9개: order_id, order_date, paid, canceled, order_place_id, market_id, payment_amount, naver_point, actual_order_amount
--   actual_order_amount 안 13개: order_price_amount, shipping_fee, points_spent_amount, credits_spent_amount,
--     coupon_discount_price, coupon_shipping_fee_amount, membership_discount_amount, shipping_fee_discount_amount,
--     set_product_discount_amount, app_discount_amount, market_other_discount_amount, total_amount_due, payment_amount
-- "정리 대상" 행 = raw_data가 JSON 객체이면서 ① 최상위에 허용 목록 밖 key가 있거나 ② actual_order_amount 안에
--   허용 목록 밖 key가 있거나 ③ actual_order_amount가 객체 · null이 아닌 행(적용 스크립트와 같은 조건).
--   raw_data가 null이거나 객체가 아닌 행은 정리하지 않는다(개수만 [블록 5]에 표시 — 0이 아니면 따로 판단).


-- [블록 1] 실행 환경 — 행을 빠짐없이 보는지(RLS) · Postgres 버전(trim_scale은 13 이상)
--   기대: rls_forced = false 이고 (bypass_rls = true 또는 role = table_owner). 아니면 개수가 0으로 보일 수 있어 멈춘다.
select version() as postgres_version,
       current_user as role,
       r.rolbypassrls as bypass_rls,
       pg_get_userbyid(c.relowner) as table_owner,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_roles r
cross join pg_class c
where r.rolname = current_user
  and c.oid = 'public.orders'::regclass;


-- [블록 2] 컬럼 구성(값 아님) — 적용 스크립트는 raw_data만 바꾸고 나머지 컬럼은 전부 그대로인지 검사한다
select a.attnum, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull as not_null
from pg_attribute a
where a.attrelid = 'public.orders'::regclass
  and a.attnum > 0
  and not a.attisdropped
order by a.attnum;


-- [블록 3] 트리거 — 기대: 결과 없음.
--   UPDATE 때 다른 컬럼(예: updated_at)을 바꾸는 트리거가 있으면 적용 스크립트가 "raw_data 외 컬럼이 바뀜"으로
--   멈추고 전부 되돌린다. 그 경우 진행 방법을 따로 정한다(트리거를 끄지 않는다).
select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.orders'::regclass
  and not t.tgisinternal;


-- [블록 4] 규모 — provider · raw_data 타입별 행 수와 raw_data 크기
select provider,
       coalesce(jsonb_typeof(raw_data), 'SQL NULL') as raw_data_type,
       count(*) as rows,
       pg_size_pretty(sum(pg_column_size(raw_data))) as raw_data_size
from public.orders
group by 1, 2
order by 1, 2;


-- [블록 5] 정리 대상 행 수 — rows_to_minimize를 적용 스크립트의 v.expected_rows에 넣는다
select count(*) filter (where is_object and needs)     as rows_to_minimize,
       count(*) filter (where is_object and not needs) as rows_already_minimal,
       count(*) filter (where not is_object and raw_data_type in ('SQL NULL', 'null')) as rows_raw_data_null,
       count(*) filter (where not is_object and raw_data_type not in ('SQL NULL', 'null')) as rows_raw_data_not_object
from (
  select coalesce(jsonb_typeof(raw_data), 'SQL NULL') as raw_data_type,
         jsonb_typeof(raw_data) = 'object' is true as is_object,
         case when jsonb_typeof(raw_data) = 'object' then
           (raw_data - array['order_id', 'order_date', 'paid', 'canceled', 'order_place_id', 'market_id',
                             'payment_amount', 'naver_point', 'actual_order_amount']) <> '{}'::jsonb
           or (jsonb_typeof(raw_data -> 'actual_order_amount') is not distinct from 'object'
               and (raw_data -> 'actual_order_amount')
                   - array['order_price_amount', 'shipping_fee', 'points_spent_amount', 'credits_spent_amount',
                           'coupon_discount_price', 'coupon_shipping_fee_amount', 'membership_discount_amount',
                           'shipping_fee_discount_amount', 'set_product_discount_amount', 'app_discount_amount',
                           'market_other_discount_amount', 'total_amount_due', 'payment_amount'] <> '{}'::jsonb)
           or coalesce(jsonb_typeof(raw_data -> 'actual_order_amount'), 'null') not in ('object', 'null')
         end as needs
  from public.orders
  where provider = 'cafe24'
) s;


-- [블록 6] 개인정보 · 식별 key 존재 건수(값 출력 없음) — 정리 뒤 post-check에서 전부 0이어야 한다
select k.key,
       count(*) filter (where o.raw_data ? k.key) as rows_with_key,
       count(*) filter (where nullif(o.raw_data ->> k.key, '') is not null
                          and o.raw_data -> k.key not in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)) as rows_with_value
from public.orders o
cross join unnest(array['billing_name', 'member_id', 'member_email', 'social_member_code', 'social_name',
                        'transaction_ids', 'bank_account_no', 'bank_account_owner_name', 'bank_code', 'bank_code_name',
                        'market_order_no', 'additional_order_info_list', 'service_data', 'member_authentication',
                        'group_no_when_ordering', 'first_order', 'subscription_id',
                        'receivers', 'buyer', 'items', 'return', 'cancellation', 'exchange']) with ordinality as k(key, ord)
where o.provider = 'cafe24'
  and jsonb_typeof(o.raw_data) = 'object'
group by k.key, k.ord
order by k.ord;


-- [블록 7] 허용 목록 밖 key 종류 수 · '@'(이메일 형태)가 들어 있는 행 수 — 값 출력 없음
select (select count(distinct k)
          from public.orders o
          cross join lateral jsonb_object_keys(case when jsonb_typeof(o.raw_data) = 'object' then o.raw_data else '{}'::jsonb end) k
         where o.provider = 'cafe24'
           and k <> all (array['order_id', 'order_date', 'paid', 'canceled', 'order_place_id', 'market_id',
                               'payment_amount', 'naver_point', 'actual_order_amount'])) as key_names_outside_allowlist,
       (select count(*) from public.orders o where o.provider = 'cafe24' and o.raw_data::text like '%@%') as rows_with_at_sign;


-- [블록 8] 값 형식 — 기대: *_unexpected 전부 0.
--   0이면 적용 스크립트가 만드는 값이 앱 코드(slimOrder)가 저장하는 값과 같다(문자열은 그대로, "32000.00" 같은 숫자 문자열은 숫자로).
--   0이 아니어도 개인정보와는 무관하다(그 칸만 null 또는 다른 표기로 저장될 수 있음).
select count(*) as object_rows,
       count(*) filter (where coalesce(jsonb_typeof(raw_data -> 'order_id'), 'null') not in ('string', 'number')) as order_id_unexpected,
       count(*) filter (where exists (
         select 1 from unnest(array['order_date', 'paid', 'canceled', 'order_place_id', 'market_id']) f
          where coalesce(jsonb_typeof(raw_data -> f), 'null') not in ('string', 'null'))) as text_fields_unexpected,
       count(*) filter (where exists (
         select 1 from unnest(array['payment_amount', 'naver_point']) f
          where not (coalesce(jsonb_typeof(raw_data -> f), 'null') in ('number', 'null')
                     or (jsonb_typeof(raw_data -> f) = 'string'
                         and ((raw_data ->> f) = ''
                              or (raw_data ->> f) ~ '^\s*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?\s*$'))))) as amount_fields_unexpected,
       count(*) filter (where jsonb_typeof(raw_data -> 'actual_order_amount') is not distinct from 'object' and exists (
         select 1 from unnest(array['order_price_amount', 'shipping_fee', 'points_spent_amount', 'credits_spent_amount',
                                    'coupon_discount_price', 'coupon_shipping_fee_amount', 'membership_discount_amount',
                                    'shipping_fee_discount_amount', 'set_product_discount_amount', 'app_discount_amount',
                                    'market_other_discount_amount', 'total_amount_due', 'payment_amount']) f
          where not (coalesce(jsonb_typeof(raw_data -> 'actual_order_amount' -> f), 'null') in ('number', 'null')
                     or (jsonb_typeof(raw_data -> 'actual_order_amount' -> f) = 'string'
                         and ((raw_data -> 'actual_order_amount' ->> f) = ''
                              or (raw_data -> 'actual_order_amount' ->> f) ~ '^\s*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?\s*$'))))) as order_amount_fields_unexpected
from public.orders
where provider = 'cafe24'
  and jsonb_typeof(raw_data) = 'object';
