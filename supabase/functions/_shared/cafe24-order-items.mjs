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

export function slimOrders(orders) {
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => order && order.order_id)
    .map((order) => ({
      order_id: String(order.order_id),
      order_date: str(order.order_date),
      paid: str(order.paid),
      canceled: str(order.canceled),
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
        payment_amount: num(item.payment_amount),
      })),
    }));
}
