// Cafe24 GET /api/v2/admin/orders?embed=items 응답을 판매 집계에 필요한 필드만 남긴다.
// 구매자·수령인·결제 계좌 등 개인정보는 넘기지 않는다. 필드 이름은 Cafe24 Admin API 공식 문서
// (orders · orders/{order_id}/items)의 이름을 그대로 쓴다.
function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function str(value) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

const ORDER_AMOUNT_FIELDS = ["order_price_amount", "shipping_fee", "points_spent_amount", "credits_spent_amount",
  "coupon_discount_price", "coupon_shipping_fee_amount", "membership_discount_amount", "shipping_fee_discount_amount",
  "set_product_discount_amount", "app_discount_amount", "market_other_discount_amount", "total_amount_due", "payment_amount"];
function pickAmounts(amounts) {
  if (!amounts || typeof amounts !== "object") return null;
  const out = {};
  for (const k of ORDER_AMOUNT_FIELDS) out[k] = num(amounts[k]);
  return out;
}

export function slimOrders(orders) {
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => order && order.order_id)
    .map((order) => ({
      order_id: String(order.order_id),
      order_date: str(order.order_date),
      paid: str(order.paid),
      canceled: str(order.canceled),
      // 주문 경로 — 네이버페이(NCHECKOUT) 주문은 Cafe24 결제금액이 0원으로 온다(결제가 네이버 쪽에서 이뤄짐).
      order_place_id: str(order.order_place_id),
      market_id: str(order.market_id),
      // 주문 단위 금액(공식 문서 actual_order_amount: 최종 결제 내역). 고객 부담 배송비와 주문 단위 할인을 여기서 본다.
      payment_amount: num(order.payment_amount),
      // 네이버페이로 낸 금액. 네이버페이 주문은 payment_amount가 0원이고 이 값에 결제액이 들어온다(실제 응답으로 확인).
      naver_point: num(order.naver_point),
      actual_order_amount: pickAmounts(order.actual_order_amount),
      items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
        order_item_code: str(item.order_item_code),
        product_no: num(item.product_no),
        variant_code: str(item.variant_code),
        product_name: str(item.product_name),
        option_value: str(item.option_value),
        quantity: num(item.quantity),
        claim_quantity: num(item.claim_quantity),
        order_status: str(item.order_status),
        status_code: str(item.status_code),
        status_text: str(item.status_text),
        product_bundle: str(item.product_bundle),
        product_price: num(item.product_price),
        option_price: num(item.option_price),
        additional_discount_price: num(item.additional_discount_price),
        coupon_discount_price: num(item.coupon_discount_price),
        app_item_discount_amount: num(item.app_item_discount_amount),
        payment_amount: num(item.payment_amount),
        // 참고용 — shipping_code가 달라도 실제로 따로 발송했다는 뜻은 아니다(운영 쇼핑몰: 추가 비용 상품이 별도 코드).
        // shipping_fee_type(T 무료 · X 기본 등)과 개별 배송비는 상품별 배송비 설정을 본다.
        shipping_code: str(item.shipping_code),
        shipping_fee_type: str(item.shipping_fee_type),
        individual_shipping_fee: num(item.individual_shipping_fee),
      })),
    }));
}

// 쿠폰 할인이 있는 주문만 GET /api/v2/admin/orders/coupons 로 품목별 쿠폰을 붙인다(공식 문서: order_item_code ·
// coupon_name · coupon_value_final). 어느 품목에 적용된 쿠폰인지 확인하기 위함.
export function ordersNeedingCoupons(orders) {
  return orders.filter((o) => (o.actual_order_amount?.coupon_discount_price ?? 0) > 0).map((o) => o.order_id);
}
export function attachCoupons(orders, rows, failedIds) {
  const byOrder = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.order_id) continue;
    const list = byOrder.get(String(r.order_id)) ?? [];
    list.push({ order_item_code: str(r.order_item_code), coupon_name: str(r.coupon_name), coupon_value_final: num(r.coupon_value_final) });
    byOrder.set(String(r.order_id), list);
  }
  const failed = new Set(failedIds ?? []);
  for (const o of orders) {
    if (byOrder.has(o.order_id)) o.coupons = byOrder.get(o.order_id);
    else if (failed.has(o.order_id)) o.coupons = null; // 조회 실패 — 쿠폰 없음과 구분
  }
  return orders;
}
