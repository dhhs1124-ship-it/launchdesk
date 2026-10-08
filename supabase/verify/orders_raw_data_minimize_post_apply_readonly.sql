-- ============================================================================
-- Cafe24 주문 raw_data 최소수집 정리 — 적용 "후" 읽기 전용 확인
-- 파일: supabase/verify/orders_raw_data_minimize_post_apply_readonly.sql
-- ============================================================================
-- supabase/ops/orders_raw_data_minimize_apply.sql을 commit한 뒤 실행한다. SELECT만 한다. 값은 출력하지 않는다.
-- [블록]마다 따로 실행한다. 기대값은 블록마다 적었다. 허용 목록은 precheck 파일 머리말과 같다.


-- [블록 1] 규모 — precheck [블록 4]와 provider · 타입별 행 수가 같아야 한다(크기만 줄어듦)
select provider,
       coalesce(jsonb_typeof(raw_data), 'SQL NULL') as raw_data_type,
       count(*) as rows,
       pg_size_pretty(sum(pg_column_size(raw_data))) as raw_data_size
from public.orders
group by 1, 2
order by 1, 2;


-- [블록 2] 정리 대상이 남았는지 — 기대: rows_to_minimize = 0
--   (rows_raw_data_not_object가 precheck에서 0이 아니었다면 그 행은 이번 정리 대상이 아니었다 — 따로 판단)
select count(*) filter (where is_object and needs)     as rows_to_minimize,
       count(*) filter (where is_object and not needs) as rows_minimal,
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


-- [블록 3] 개인정보 · 식별 key 존재 건수 — 기대: 모든 행 0
select k.key,
       count(*) filter (where o.raw_data ? k.key) as rows_with_key
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


-- [블록 4] 남은 key 목록 — 기대: 허용 목록 9개 key만(각각 정리한 행 수만큼), 그 밖의 key 없음
select k as key, count(*) as rows_with_key
from public.orders o
cross join lateral jsonb_object_keys(case when jsonb_typeof(o.raw_data) = 'object' then o.raw_data else '{}'::jsonb end) k
where o.provider = 'cafe24'
group by k
order by k;


-- [블록 5] 이메일 형태('@')가 남은 행 수 — 기대: object_rows_with_at_sign = 0
--   not_object_rows_with_at_sign은 이번 정리 대상이 아닌 행(raw_data가 객체가 아님)이라 0이 아니면 따로 판단한다.
select count(*) filter (where jsonb_typeof(raw_data) = 'object' and raw_data::text like '%@%') as object_rows_with_at_sign,
       count(*) filter (where jsonb_typeof(raw_data) <> 'object' and raw_data::text like '%@%') as not_object_rows_with_at_sign
from public.orders
where provider = 'cafe24';
