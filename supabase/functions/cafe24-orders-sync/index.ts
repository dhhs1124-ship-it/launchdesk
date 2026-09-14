import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import {
  getValidCafe24AccessToken,
  cafe24TokenErrorStatus,
} from "../_shared/cafe24-token.ts";

const API_VERSION = "2026-09-01";
const PAGE_LIMIT = 1000;

// ---- 동기화 기간 정책 ---------------------------------------------------
// MVP 범위: 전체 과거 백필은 하지 않는다. 최초 연결 시에도 최근 90일치만
// 가져오고, 그 이후 90일보다 이전 주문은 이 함수로는 절대 조회하지 않는다
// (증분 동기화가 계산한 시작일도 아래에서 항상 이 창으로 clamp한다).
const INITIAL_SYNC_WINDOW_DAYS = 90;
// Cafe24 관리자 주문 목록 API(GET /admin/orders)는 date_type=order_date/
// payment_date/shipping_date 등 "주문이 언제 발생했는가" 기준 필터만
// 제공하고, "언제 마지막으로 수정됐는가" 기준 필터(예: modified_date)는
// 없다. 즉 "지난 동기화 이후"만 정확히 잘라 가져오면, 그 이전에 이미
// 동기화해둔 주문의 상태/금액이 그 뒤에 바뀐 경우(취소·환불·교환·배송 상태
// 변경, 부분/추가 결제 등)를 절대 다시 잡아낼 수 없다 — order_date는 주문
// 시점에 고정이라, 그 주문은 앞으로 영영 조회 대상 밖으로 벗어나기 때문.
// 그래서 매 증분 동기화마다 "마지막 동기화 시각보다 N일 더 앞"부터 다시
// 조회해 겹치는 구간을 만든다 — 그 구간 안의 주문은 이미 DB에 있어도
// unique(store_id, provider, external_order_id) upsert로 최신 상태/금액이
// 덮어써진다. N(며칠)은 트레이드오프: 짧으면 API 호출은 가볍지만 그보다
// 늦게 바뀐 상태 변경(예: 배송 후 한참 뒤 반품)을 놓치고, 길면 매번 더 많은
// 주문을 다시 읽어야 한다. order_date 기준 조회만 가능한 현재 구조에서는
// 배송완료/취소/반품/교환처럼 주문 후 며칠~1~2주 뒤에야 발생하는 상태
// 변경이 드물지 않으므로, MVP에서는 14일을 기본값으로 둔다(3일은 그런
// 변경을 놓칠 가능성이 높다고 판단해 배포 전 14일로 올림) — 그보다 오래
// 지나 바뀌는 상태 변경까지 잡으려면(웹훅 없이는 결국 어느 값을 골라도
// 한계가 있다) 이 상수만 늘리면 된다.
const INCREMENTAL_OVERLAP_DAYS = 14;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// UTC Date를 KST 기준 "YYYY-MM-DD" 문자열로. Cafe24 주문 조회는 날짜
// 단위(시각 없음)라서, 내부적으로 KST 달력 날짜로 통일해 계산한다(주문
// 데이터 자체가 한국 쇼핑몰 기준이므로 UTC 자정으로 끊으면 하루가 밀린다).
function toKstDateString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

function kstDateDaysBefore(date: Date, days: number): string {
  return toKstDateString(new Date(date.getTime() - days * 24 * 60 * 60 * 1000));
}

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
      const body = await req.json();
      const store_id = body?.store_id;
      // start_date/end_date는 이제 선택값이다 — 둘 다 생략하면 아래에서
      // connected_accounts.last_synced_at을 기준으로 자동 계산한다(최초
      // 연결이면 최근 90일, 이후면 last_synced_at 기준 증분). 명시적으로
      // 넘기면 기존처럼 그 범위를 그대로 쓴다(수동 재동기화용) — 단, 이번
      // 단계에서도 전체 과거 백필은 하지 않는다는 정책은 그대로라 3개월
      // 상한 검증은 유지한다.
      const rawStartDate = body?.start_date;
      const rawEndDate = body?.end_date;

      if (!store_id) {
        return Response.json(
          { error: "store_id가 필요합니다." },
          { status: 400 }
        );
      }

      const hasExplicitRange = rawStartDate != null || rawEndDate != null;

      if (hasExplicitRange && (!validDateString(rawStartDate) || !validDateString(rawEndDate))) {
        return Response.json(
          {
            error:
              "start_date/end_date는 함께 YYYY-MM-DD 형식으로 넘기거나, 자동 기간 계산을 쓰려면 둘 다 생략해주세요.",
          },
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
          .select("id, external_account_id, status, last_synced_at")
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

      // 2-1. 실제 조회 기간 확정.
      const now = new Date();
      const todayKst = toKstDateString(now);

      let start_date: string;
      let end_date: string;

      if (hasExplicitRange) {
        // 수동 지정 — 기존 동작 그대로.
        start_date = rawStartDate;
        end_date = rawEndDate;
      } else if (!account.last_synced_at) {
        // 최초 동기화: 최근 90일. (요구사항 1, 5)
        start_date = kstDateDaysBefore(now, INITIAL_SYNC_WINDOW_DAYS);
        end_date = todayKst;
      } else {
        // 증분 동기화: last_synced_at보다 INCREMENTAL_OVERLAP_DAYS일 더
        // 앞에서부터 다시 조회해, 그 사이 상태/금액이 바뀐 주문도 upsert로
        // 갱신되게 한다(요구사항 2, 4, 6). 다만 그 결과가 정책상 최대
        // 조회창(90일)보다 더 과거로 가면 안 되므로 90일 창 시작일보다
        // 이르게는 절대 내려가지 않는다 — "필요한 최소 기간만" 원칙과,
        // 이 함수가 전체 백필 창구가 되지 않게 막는 안전장치를 겸한다.
        const lastSyncedAt = new Date(account.last_synced_at);
        const overlapStart = kstDateDaysBefore(
          lastSyncedAt,
          INCREMENTAL_OVERLAP_DAYS
        );
        const windowFloor = kstDateDaysBefore(now, INITIAL_SYNC_WINDOW_DAYS);
        start_date = overlapStart > windowFloor ? overlapStart : windowFloor;
        end_date = todayKst;
      }

      if (!rangeIsWithinThreeMonths(start_date, end_date)) {
        return Response.json(
          { error: "한 번에 최대 3개월 범위까지만 동기화할 수 있습니다." },
          { status: 400 }
        );
      }

      // 3. Access Token 확보 — 유효하면 그대로, 만료/임박이면 여기서 자동
      //    refresh까지 처리하고 새 토큰을 DB에 즉시 저장한 뒤 반환한다.
      const tokenResult = await getValidCafe24AccessToken(
        ctx.supabaseAdmin,
        account.id,
        mallId
      );

      if (!tokenResult.ok) {
        return Response.json(
          { error: tokenResult.message, code: tokenResult.code },
          { status: cafe24TokenErrorStatus(tokenResult.code) }
        );
      }

      const accessToken = tokenResult.accessToken;

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
            Authorization: `Bearer ${accessToken}`,
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

      // 5. 마지막 동기화 시간 기록 — 위 while 루프가 여기까지 왔다는 것
      //    자체가 이번 요청 범위의 모든 페이지를 오류 없이 끝까지 가져와
      //    upsert했다는 뜻이다(중간에 Cafe24 API가 실패하거나 upsert가
      //    실패하면 위에서 곧장 return/throw로 여기 도달하지 못한다 —
      //    요구사항 9: 일부 구간 실패 시 last_synced_at을 건드리지 않음).
      //
      //    다만 그것과 별개로, end_date가 "오늘"까지 도달한 동기화일
      //    때만 last_synced_at을 갱신한다 — last_synced_at은 "지금까지
      //    빠짐없이 동기화됐다"는 커서라서, 누군가 과거의 특정 구간만
      //    수동으로 다시 동기화(start_date/end_date를 과거로 지정)한
      //    경우까지 last_synced_at을 앞으로 밀어버리면 그 이후(과거 구간
      //    ~ 실제 마지막 동기화 시점 사이)의 신규/변경 주문을 다음 증분
      //    동기화가 건너뛰게 된다.
      const reachedToday = end_date === todayKst;

      if (reachedToday) {
        const { error: syncTimeError } = await ctx.supabaseAdmin
          .from("connected_accounts")
          .update({
            last_synced_at: now.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);

        if (syncTimeError) {
          console.warn(
            "last_synced_at update failed:",
            syncTimeError
          );
        }
      }

      return Response.json({
        ok: true,
        mall_id: mallId,
        start_date,
        end_date,
        fetched: fetchedCount,
        saved: savedCount,
        last_synced_at_updated: reachedToday,
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