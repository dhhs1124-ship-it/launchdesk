import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import {
  getValidCafe24AccessToken,
  cafe24TokenErrorStatus,
} from "../_shared/cafe24-token.ts";
import { slimOrders, ordersNeedingCoupons, attachCoupons } from "../_shared/cafe24-order-items.mjs";

// LaunchROAS 실제 판매 기준 집계용 — 선택 기간의 Cafe24 주문 상품(수량 · 상태)을 조회만 한다.
// DB에 주문을 저장하지 않으며(기존 cafe24-orders-sync와 별개), 토큰 갱신 때만 자격증명을 쓴다.
const API_VERSION = "2026-09-01";
const PAGE_LIMIT = 1000;
const MAX_ORDERS = 5000;
const MAX_RANGE_DAYS = 31;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const body = await req.json();
      const { store_id, start_date, end_date } = body ?? {};
      if (!store_id || !validDate(start_date) || !validDate(end_date) || start_date > end_date) {
        return Response.json({ error: "store_id와 YYYY-MM-DD 형식의 start_date · end_date가 필요합니다." }, { status: 400 });
      }
      const days = (Date.parse(end_date) - Date.parse(start_date)) / 86400000 + 1;
      if (days > MAX_RANGE_DAYS) {
        return Response.json({ error: `한 번에 최대 ${MAX_RANGE_DAYS}일까지 조회할 수 있습니다.` }, { status: 400 });
      }

      // 호출자 본인의 Cafe24 쇼핑몰만 허용한다(cafe24-orders-sync와 같은 기준).
      const { data: store } = await ctx.supabase
        .from("stores").select("id, platform")
        .eq("id", store_id).eq("user_id", ctx.userClaims?.id ?? "").single();
      if (!store || store.platform !== "cafe24") {
        return Response.json({ error: "쇼핑몰을 찾을 수 없습니다." }, { status: 404 });
      }
      const { data: account } = await ctx.supabase
        .from("connected_accounts").select("id, external_account_id")
        .eq("store_id", store.id).eq("provider", "cafe24").eq("status", "connected").single();
      const mallId = account?.external_account_id;
      if (!account || !mallId || !/^[a-zA-Z0-9_-]+$/.test(mallId)) {
        return Response.json({ error: "Cafe24가 연결되어 있지 않습니다." }, { status: 400 });
      }

      const tokenResult = await getValidCafe24AccessToken(ctx.supabaseAdmin, account.id, mallId);
      if (!tokenResult.ok) {
        return Response.json({ error: tokenResult.message, code: tokenResult.code }, { status: cafe24TokenErrorStatus(tokenResult.code) });
      }

      const orders = [];
      let truncated = false;
      for (let offset = 0; ; offset += PAGE_LIMIT) {
        if (offset >= MAX_ORDERS) { truncated = true; break; }
        const url = new URL(`https://${mallId}.cafe24api.com/api/v2/admin/orders`);
        url.searchParams.set("shop_no", "1");
        url.searchParams.set("start_date", start_date);
        url.searchParams.set("end_date", end_date);
        url.searchParams.set("date_type", "order_date");
        url.searchParams.set("embed", "items");
        url.searchParams.set("limit", String(PAGE_LIMIT));
        url.searchParams.set("offset", String(offset));
        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${tokenResult.accessToken}`,
            "Content-Type": "application/json",
            "X-Cafe24-Api-Version": API_VERSION,
          },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          console.error("Cafe24 order items API failed:", res.status);
          return Response.json({ error: "Cafe24 주문 상품을 가져오지 못했습니다.", status: res.status }, { status: 502 });
        }
        const page = slimOrders(data.orders);
        orders.push(...page);
        if (!Array.isArray(data.orders) || data.orders.length < PAGE_LIMIT) break;
      }

      // 쿠폰 상세(읽기 전용). 실패해도 주문 조회는 그대로 돌려주고, 해당 주문은 coupons: null로 표시한다.
      const couponIds = truncated ? [] : ordersNeedingCoupons(orders);
      const couponRows: unknown[] = [];
      const couponFailed: string[] = [];
      for (let i = 0; i < couponIds.length; i += 100) {
        const ids = couponIds.slice(i, i + 100);
        const url = new URL(`https://${mallId}.cafe24api.com/api/v2/admin/orders/coupons`);
        url.searchParams.set("shop_no", "1");
        url.searchParams.set("order_id", ids.join(","));
        url.searchParams.set("limit", "500");
        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${tokenResult.accessToken}`,
            "Content-Type": "application/json",
            "X-Cafe24-Api-Version": API_VERSION,
          },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !Array.isArray(data.coupons)) {
          console.error("Cafe24 order coupons API failed:", res.status);
          couponFailed.push(...ids);
          continue;
        }
        couponRows.push(...data.coupons);
      }
      attachCoupons(orders, couponRows, couponFailed);

      return Response.json({ ok: true, start_date, end_date, timezone: "Asia/Seoul", truncated, orders });
    } catch (error) {
      console.error("Cafe24 order items error:", error instanceof Error ? error.message : error);
      return Response.json({ error: "Cafe24 주문 상품 조회 중 오류가 발생했습니다." }, { status: 500 });
    }
  }),
};
