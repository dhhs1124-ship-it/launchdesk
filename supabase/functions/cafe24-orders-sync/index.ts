import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const API_VERSION = "2026-09-01";
const PAGE_LIMIT = 1000;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCafe24Date(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;

  // Cafe24가 "YYYY-MM-DD HH:mm:ss" 형태로 주는 경우
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(" ", "T") + "+09:00";
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function validDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
}

function rangeIsWithinThreeMonths(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00+09:00`);
  const endDate = new Date(`${end}T23:59:59+09:00`);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate > endDate
  ) {
    return false;
  }

  const maxDate = new Date(startDate);
  maxDate.setMonth(maxDate.getMonth() + 3);

  return endDate <= maxDate;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }

  return result;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const { store_id, start_date, end_date } = await req.json();

      if (!store_id) {
        return Response.json(
          { error: "store_id가 필요합니다." },
          { status: 400 }
        );
      }

      if (
        !validDateString(start_date) ||
        !validDateString(end_date)
      ) {
        return Response.json(
          { error: "날짜는 YYYY-MM-DD 형식이어야 합니다." },
          { status: 400 }
        );
      }

      if (!rangeIsWithinThreeMonths(start_date, end_date)) {
        return Response.json(
          { error: "한 번에 최대 3개월 범위까지만 동기화할 수 있습니다." },
          { status: 400 }
        );
      }

      // 1. 현재 로그인 사용자가 소유한 store인지 확인
      const { data: store, error: storeError } = await ctx.supabase
        .from("stores")
        .select("id, platform")
        .eq("id", store_id)
        .single();

      if (storeError || !store) {
        return Response.json(
          { error: "쇼핑몰을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      if (store.platform !== "cafe24") {
        return Response.json(
          { error: "Cafe24 쇼핑몰이 아닙니다." },
          { status: 400 }
        );
      }

      // 2. 연결된 Cafe24 계정 확인
      const { data: account, error: accountError } =
        await ctx.supabase
          .from("connected_accounts")
          .select("id, external_account_id, status")
          .eq("store_id", store.id)
          .eq("provider", "cafe24")
          .eq("status", "connected")
          .single();

      if (accountError || !account) {
        return Response.json(
          { error: "Cafe24가 연결되어 있지 않습니다." },
          { status: 400 }
        );
      }

      const mallId = account.external_account_id;

      if (!mallId || !/^[a-zA-Z0-9_-]+$/.test(mallId)) {
        return Response.json(
          { error: "Cafe24 mall_id가 올바르지 않습니다." },
          { status: 400 }
        );
      }

      // 3. 서버 전용 토큰 조회
      const { data: credential, error: credentialError } =
        await ctx.supabaseAdmin
          .from("integration_credentials")
          .select("access_token, access_token_expires_at")
          .eq("connected_account_id", account.id)
          .single();

      if (credentialError || !credential) {
        console.error("Credential lookup failed:", credentialError);

        return Response.json(
          { error: "Cafe24 인증정보를 찾을 수 없습니다." },
          { status: 500 }
        );
      }

      if (
        new Date(credential.access_token_expires_at).getTime() <= Date.now()
      ) {
        return Response.json(
          {
            error: "Cafe24 Access Token이 만료되었습니다.",
            code: "TOKEN_EXPIRED",
          },
          { status: 401 }
        );
      }

      // 4. Cafe24 주문 전체 페이지 순회
      let offset = 0;
      let fetchedCount = 0;
      let savedCount = 0;

      while (true) {
        if (offset > 15000) {
          throw new Error(
            "한 기간의 주문량이 pagination 한도를 초과했습니다. 기간을 더 작게 나눠주세요."
          );
        }

        const apiUrl = new URL(
          `https://${mallId}.cafe24api.com/api/v2/admin/orders`
        );

        apiUrl.searchParams.set("shop_no", "1");
        apiUrl.searchParams.set("start_date", start_date);
        apiUrl.searchParams.set("end_date", end_date);
        apiUrl.searchParams.set("date_type", "order_date");
        apiUrl.searchParams.set("limit", String(PAGE_LIMIT));
        apiUrl.searchParams.set("offset", String(offset));

        const cafe24Response = await fetch(apiUrl.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${credential.access_token}`,
            "Content-Type": "application/json",
            "X-Cafe24-Api-Version": API_VERSION,
          },
        });

        const cafe24Data = await cafe24Response.json();

        if (!cafe24Response.ok) {
          console.error(
            "Cafe24 orders API failed:",
            cafe24Response.status,
            cafe24Data
          );

          return Response.json(
            {
              error: "Cafe24 주문을 가져오지 못했습니다.",
              status: cafe24Response.status,
            },
            { status: 502 }
          );
        }

        const orders = Array.isArray(cafe24Data.orders)
          ? cafe24Data.orders
          : [];

        if (orders.length === 0) {
          break;
        }

        fetchedCount += orders.length;

        const rows = orders
          .filter((order: any) => order?.order_id)
          .map((order: any) => ({
            store_id: store.id,
            provider: "cafe24",
            external_order_id: String(order.order_id),

            ordered_at: normalizeCafe24Date(order.order_date),

            order_status:
              typeof order.order_status === "string"
                ? order.order_status
                : null,

            currency:
              typeof order.currency === "string"
                ? order.currency
                : null,

            order_amount: toNumber(
              order.actual_order_amount?.order_price_amount ??
              order.initial_order_amount?.order_price_amount
            ),

            payment_amount: toNumber(order.payment_amount),

            raw_data: order,

            updated_at: new Date().toISOString(),
          }));

        // payload가 너무 커지지 않도록 DB 저장은 200건씩
        for (const batch of chunk(rows, 200)) {
          const { error: upsertError } =
            await ctx.supabaseAdmin
              .from("orders")
              .upsert(batch, {
                onConflict:
                  "store_id,provider,external_order_id",
              });

          if (upsertError) {
            console.error("Orders upsert failed:", upsertError);
            throw upsertError;
          }

          savedCount += batch.length;
        }

        if (orders.length < PAGE_LIMIT) {
          break;
        }

        offset += PAGE_LIMIT;
      }

      // 5. 마지막 동기화 시간 기록
      const { error: syncTimeError } = await ctx.supabaseAdmin
        .from("connected_accounts")
        .update({
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      if (syncTimeError) {
        console.warn(
          "last_synced_at update failed:",
          syncTimeError
        );
      }

      return Response.json({
        ok: true,
        mall_id: mallId,
        start_date,
        end_date,
        fetched: fetchedCount,
        saved: savedCount,
      });
    } catch (error) {
      console.error(
        "Cafe24 order sync error:",
        error instanceof Error ? error.message : error
      );

      return Response.json(
        { error: "Cafe24 주문 동기화 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
  }),
};