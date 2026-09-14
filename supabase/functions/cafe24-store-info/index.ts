import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import {
  getValidCafe24AccessToken,
  cafe24TokenErrorStatus,
} from "../_shared/cafe24-token.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const { store_id } = await req.json();

      if (!store_id) {
        return Response.json(
          { error: "store_id가 필요합니다." },
          { status: 400 }
        );
      }

      // 1. 현재 로그인 사용자가 소유한 쇼핑몰인지 확인
      const { data: store, error: storeError } = await ctx.supabase
        .from("stores")
        .select("id, name, platform, external_store_id")
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

      // 2. Cafe24 연결정보 확인
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

      // 4. Cafe24 실제 API 호출
      const cafe24Response = await fetch(
        `https://${mallId}.cafe24api.com/api/v2/admin/store`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenResult.accessToken}`,
            "Content-Type": "application/json",
            "X-Cafe24-Api-Version": "2026-09-01",
          },
        }
      );

      const cafe24Data = await cafe24Response.json();

      if (!cafe24Response.ok) {
        console.error(
          "Cafe24 store API failed:",
          cafe24Response.status,
          cafe24Data
        );

        return Response.json(
          {
            error: "Cafe24 쇼핑몰 정보를 가져오지 못했습니다.",
            status: cafe24Response.status,
          },
          { status: 502 }
        );
      }

      // Access Token은 절대 반환하지 않음
      return Response.json({
        ok: true,
        mall_id: mallId,
        store: cafe24Data,
      });
    } catch (error) {
      console.error(
        "Cafe24 store info error:",
        error instanceof Error ? error.message : error
      );

      return Response.json(
        { error: "쇼핑몰 정보 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
  }),
};