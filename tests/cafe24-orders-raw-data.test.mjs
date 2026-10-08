// Cafe24 주문 동기화 raw_data 최소수집 — 실행: node --test tests/cafe24-orders-raw-data.test.mjs
// 실제 supabase/functions/<함수>/index.ts를 Node에서 실행한다(Deno 전용 import만 가짜, tests/helpers 참고).
// Supabase · Cafe24는 가짜이며 네트워크에 나가지 않는다. 개인정보 자리의 값에는 모두 'pii'를 넣어, 저장 · 응답 어디에도 남지 않는지 문자열로도 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFunction, jsonRequest, fakeSupabase, setCtx, setEnv, fakeFetch, jsonResponse,
} from './helpers/edge-function-harness.mjs';

setEnv({ CAFE24_CLIENT_ID: 'client', CAFE24_CLIENT_SECRET: 'secret' });

const HOUR = 3600e3;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const CREDENTIAL = { access_token: 'A0', refresh_token: 'R0', access_token_expires_at: iso(2 * HOUR), refresh_token_expires_at: iso(14 * 24 * HOUR), updated_at: iso(-HOUR) };

function setup() {
  const user = fakeSupabase({
    stores: () => ({ data: { id: 's1', platform: 'cafe24' } }),
    connected_accounts: () => ({ data: { id: 9, external_account_id: 'mall1', status: 'connected', last_synced_at: null, orders_synced_from: null } }),
  });
  const admin = fakeSupabase({
    integration_credentials: () => ({ data: { ...CREDENTIAL } }),
    orders: () => ({ data: null }),
    connected_accounts: () => ({ data: null }),
  });
  setCtx({ supabase: user, supabaseAdmin: admin });
  return admin;
}

const ordersSync = await loadFunction('cafe24-orders-sync');
const orderItems = await loadFunction('cafe24-order-items');

// 주문 동기화 1회 — DB에 upsert한 행(가짜 Supabase 기록)과 upsert 옵션을 돌려준다.
async function sync(orders) {
  const admin = setup();
  fakeFetch((url) => {
    if (url.includes('/admin/orders')) return jsonResponse(200, { orders });
    throw new Error('unexpected fetch ' + url);
  });
  const res = await ordersSync(jsonRequest({ store_id: 's1' }));
  assert.equal(res.status, 200);
  const upserts = admin.calls.filter((c) => c.table === 'orders' && c.op === 'upsert');
  return { rows: upserts.flatMap((c) => c.values), options: upserts.map((c) => c.options) };
}

// ---- Cafe24 GET /api/v2/admin/orders(embed 없음) 응답 주문 — 필드 이름은 Cafe24 Admin API 공식 문서(2026-09-01)
const AMOUNTS = {
  order_price_amount: '30000.00', shipping_fee: '3000.00', points_spent_amount: '0.00', credits_spent_amount: '0.00',
  coupon_discount_price: '1000.00', coupon_shipping_fee_amount: '0.00', membership_discount_amount: '0.00', shipping_fee_discount_amount: '0.00',
  set_product_discount_amount: '0.00', app_discount_amount: '0.00', market_other_discount_amount: '0.00', total_amount_due: '0.00', payment_amount: '32000.00',
};
// 목록 응답에 실제로 오는 개인정보 · 식별 필드(운영 DB 378건에서 값 확인됨) + 자유 입력 · 회원 속성
const PERSONAL = {
  member_id: 'pii-member', member_email: 'pii@example.com', billing_name: 'PII 결제자',
  bank_code: 'pii-bank-code', bank_code_name: 'PII은행', bank_account_no: 'pii-000-0000', bank_account_owner_name: 'PII 예금주',
  social_member_code: 'pii-social-member', social_name: 'pii-social', market_order_no: 'pii-market-order',
  transaction_ids: [{ payment_gateway_name: 'pii-pg', id: 'pii-card-transaction' }],
  additional_order_info_list: [{ id: 1, name: '아이 이름', value: 'PII 자유 입력', input_type: 'T' }],
  service_data: [{ key: 'pii', value: 'pii-service', title: 'pii' }],
  member_authentication: 'pii-auth', group_no_when_ordering: 'pii-group', first_order: 'pii-first', subscription_id: 'pii-subscription',
  // embed 전용(이 함수는 embed를 쓰지 않는다) — 들어오더라도 저장하지 않는다
  receivers: [{ name: 'PII 수령인', phone: 'pii-phone', cellphone: 'pii-cell', address1: 'PII 주소', zipcode: 'pii-zip', shipping_message: 'PII 메모', clearance_information: 'pii-clearance' }],
  buyer: { name: 'PII 주문자', email: 'pii-buyer@example.com', cellphone: 'pii-buyer-cell', buyer_address1: 'PII 주문자 주소' },
};
const PERSONAL_KEYS = Object.keys(PERSONAL);

// A: 자사몰 주문(실제 결제 · 쿠폰 할인) — 문서에는 있지만 집계에 안 쓰는 필드와 Cafe24가 나중에 추가할 수 있는 필드도 넣는다
const ORDER_A = {
  shop_no: 1, currency: 'KRW', order_id: '20261007-0000001', order_date: '2026-10-07 10:00:00', payment_date: '2026-10-07 10:01:00',
  paid: 'T', canceled: 'F', order_place_id: 'self', order_place_name: 'PC쇼핑몰', market_id: 'self', shipping_status: 'F',
  payment_amount: '32000.00', naver_point: '0.00',
  initial_order_amount: { ...AMOUNTS },
  actual_order_amount: { ...AMOUNTS, point_incentive_amount: '0.00', tax: '0.00', future_amount_field: '7.00' },
  future_customer_field: 'pii-future',
  ...PERSONAL,
};
// B: 네이버페이 주문 — 결제금액 빈 값 · 네이버포인트에 결제액 · 현재 금액 객체 없음(최초 금액으로 주문 금액) · 상태 문자열 · ISO 날짜
const ORDER_B = {
  currency: 'KRW', order_id: '20261006-0000002', order_date: '2026-10-06T23:30:00+09:00', order_status: 'N40',
  paid: 'T', canceled: 'F', order_place_id: 'NCHECKOUT', market_id: 'self',
  payment_amount: '', naver_point: '15000.00', initial_order_amount: { order_price_amount: '15000.00' },
  ...PERSONAL,
};
// C: 주문번호가 없는 항목 — 예전처럼 저장하지 않는다
const ORDER_C = { order_date: '2026-10-07 11:00:00', payment_amount: '5000', ...PERSONAL };

const RAW_A = {
  order_id: '20261007-0000001', order_date: '2026-10-07 10:00:00', paid: 'T', canceled: 'F', order_place_id: 'self', market_id: 'self',
  payment_amount: 32000, naver_point: 0,
  actual_order_amount: {
    order_price_amount: 30000, shipping_fee: 3000, points_spent_amount: 0, credits_spent_amount: 0, coupon_discount_price: 1000,
    coupon_shipping_fee_amount: 0, membership_discount_amount: 0, shipping_fee_discount_amount: 0, set_product_discount_amount: 0,
    app_discount_amount: 0, market_other_discount_amount: 0, total_amount_due: 0, payment_amount: 32000,
  },
};
const RAW_B = {
  order_id: '20261006-0000002', order_date: '2026-10-06T23:30:00+09:00', paid: 'T', canceled: 'F', order_place_id: 'NCHECKOUT', market_id: 'self',
  payment_amount: null, naver_point: 15000, actual_order_amount: null,
};
const RAW_KEYS = ['order_id', 'order_date', 'paid', 'canceled', 'order_place_id', 'market_id', 'payment_amount', 'naver_point', 'actual_order_amount'];
const AMOUNT_KEYS = Object.keys(AMOUNTS);

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.external_order_id, r]));

test('orders-sync raw_data: 주문자 · 결제자 · 회원 · SNS · 카드 거래 · 계좌 · 자유 입력 · embed 전용 개인정보를 저장하지 않는다', async () => {
  const { rows } = await sync([ORDER_A, ORDER_B, ORDER_C]);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    for (const key of PERSONAL_KEYS) assert.ok(!(key in row.raw_data), key + '가 raw_data에 남음');
  }
  // 저장하는 행 전체(별도 컬럼 포함) 어디에도 개인정보 값이 없다
  assert.doesNotMatch(JSON.stringify(rows), /pii/i);
});

test('orders-sync raw_data: 주문 상태 · 경로 · 결제 금액 · 금액 구성만 정해진 허용 목록대로 남는다', async () => {
  const rows = byId((await sync([ORDER_A, ORDER_B])).rows);
  assert.deepEqual(rows['20261007-0000001'].raw_data, RAW_A);
  assert.deepEqual(rows['20261006-0000002'].raw_data, RAW_B);
});

test('orders-sync raw_data: Cafe24가 새 필드를 추가해도(최상위 · 금액 객체 안) 자동으로 저장되지 않는다', async () => {
  const future = {
    ...ORDER_A, order_id: '20261007-0000009', new_top_level_field: 'pii-new-top', loyalty_profile: { tier: 'pii-tier' },
    actual_order_amount: { ...AMOUNTS, brand_new_amount: '123.00' },
  };
  const [row] = (await sync([future])).rows;
  assert.deepEqual(Object.keys(row.raw_data).sort(), [...RAW_KEYS].sort());
  assert.deepEqual(Object.keys(row.raw_data.actual_order_amount).sort(), [...AMOUNT_KEYS].sort());
  assert.doesNotMatch(JSON.stringify(row), /pii/i);
});

test('orders-sync 저장 컬럼(주문번호 · 주문 일시 · 상태 · 통화 · 주문 금액 · 결제 금액)은 이전과 같다', async () => {
  const { rows } = await sync([ORDER_A, ORDER_B, ORDER_C]);
  const columns = (r) => { const { raw_data, updated_at, ...rest } = r; return rest; };
  const got = byId(rows);
  assert.deepEqual(columns(got['20261007-0000001']), {
    store_id: 's1', provider: 'cafe24', external_order_id: '20261007-0000001', ordered_at: '2026-10-07T10:00:00+09:00',
    order_status: null, currency: 'KRW', order_amount: 30000, payment_amount: 32000,
  });
  assert.deepEqual(columns(got['20261006-0000002']), {
    store_id: 's1', provider: 'cafe24', external_order_id: '20261006-0000002', ordered_at: '2026-10-06T14:30:00.000Z',
    order_status: 'N40', currency: 'KRW', order_amount: 15000, payment_amount: null,
  });
  for (const r of rows) assert.ok(Number.isFinite(Date.parse(r.updated_at)));
});

test('orders-sync 재동기화: 같은 키로 덮어쓰고, raw_data도 매번 같은 허용 목록 객체로 함께 덮어쓴다(예전 원본이 남지 않게)', async () => {
  const first = await sync([ORDER_A, ORDER_B]);
  const second = await sync([ORDER_A, ORDER_B]);
  for (const run of [first, second]) {
    assert.deepEqual(run.options, [{ onConflict: 'store_id,provider,external_order_id' }]);
    for (const r of run.rows) {
      assert.ok(Object.prototype.hasOwnProperty.call(r, 'raw_data'), 'upsert에 raw_data가 빠지면 DB의 예전 원본이 그대로 남는다');
      assert.equal(typeof r.raw_data, 'object');
      assert.notEqual(r.raw_data, null);
    }
  }
  assert.deepEqual(second.rows.map((r) => r.external_order_id), first.rows.map((r) => r.external_order_id));
  assert.deepEqual(second.rows.map((r) => r.raw_data), first.rows.map((r) => r.raw_data));
});

// ---- 같은 허용 목록을 쓰는 LaunchROAS 실제 판매 집계(cafe24-order-items) 응답은 바뀌지 않는다
test('order-items 응답: 주문 단위 허용 목록 + 품목 허용 목록 + 쿠폰 그대로, 개인정보 없음', async () => {
  setup();
  const item = {
    order_item_code: '20261007-0000001-01', product_no: '152', variant_code: 'P00000FW000A', product_name: '가족티', option_value: '색상=화이트',
    quantity: '2', claim_quantity: '0', order_status: 'N40', status_code: 'N4', status_text: '배송완료', product_bundle: 'F',
    product_price: '15000.00', option_price: '0.00', additional_discount_price: '0.00', coupon_discount_price: '1000.00', app_item_discount_amount: '0.00',
    payment_amount: '29000.00', shipping_code: 'D-001', shipping_fee_type: 'X', individual_shipping_fee: '0.00',
    // 품목 응답의 자유 입력 · 환불 계좌 · 송장 — 넘기지 않는다
    additional_option_value: 'PII 각인 문구', additional_option_values: [{ key: 'k', type: 'T', name: '이름', value: 'pii-name' }],
    claim_reason: 'PII 사유', refund_bank_account_no: 'pii-refund', refund_bank_account_holder: 'PII 환불 예금주', tracking_no: 'pii-tracking',
  };
  fakeFetch((url) => {
    if (url.includes('/admin/orders/coupons')) {
      return jsonResponse(200, { coupons: [{ order_id: '20261007-0000001', order_item_code: '20261007-0000001-01', coupon_name: '가을 쿠폰', coupon_value_final: '1000.00' }] });
    }
    if (url.includes('/admin/orders')) return jsonResponse(200, { orders: [{ ...ORDER_A, items: [item] }] });
    throw new Error('unexpected fetch ' + url);
  });
  const res = await orderItems(jsonRequest({ store_id: 's1', start_date: '2026-10-01', end_date: '2026-10-07' }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.orders, [{
    ...RAW_A,
    items: [{
      order_item_code: '20261007-0000001-01', product_no: 152, variant_code: 'P00000FW000A', product_name: '가족티', option_value: '색상=화이트',
      quantity: 2, claim_quantity: 0, order_status: 'N40', status_code: 'N4', status_text: '배송완료', product_bundle: 'F',
      product_price: 15000, option_price: 0, additional_discount_price: 0, coupon_discount_price: 1000, app_item_discount_amount: 0,
      payment_amount: 29000, shipping_code: 'D-001', shipping_fee_type: 'X', individual_shipping_fee: 0,
    }],
    coupons: [{ order_item_code: '20261007-0000001-01', coupon_name: '가을 쿠폰', coupon_value_final: 1000 }],
  }]);
  assert.doesNotMatch(JSON.stringify(body), /pii/i);
});
