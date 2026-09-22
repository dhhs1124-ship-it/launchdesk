import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// Cafe24 연동 해제 — LaunchDesk 내부에 저장된 Cafe24 연결 정보(access/refresh
// token 포함)·동기화된 주문 데이터·남은 OAuth state를 지우고, stores의
// Cafe24 mall_id(external_store_id)만 초기화한다. stores 행 자체, Meta
// 연동, 마진 계산 기록 등은 전혀 건드리지 않는다.
//
// meta-disconnect와 달리 service_role로 테이블을 하나씩 순서대로 지우지
// 않는다 — 실제 삭제는 하나의 SECURITY DEFINER RPC(단일 트랜잭션,
// disconnect_cafe24_integration — 20260922120000_cafe24_disconnect.sql
// 참고)에 전부 위임해 부분 삭제가 남지 않게 한다. RPC는 ctx.supabase(로그인
// 사용자의 JWT를 그대로 쓰는 클라이언트)로 호출해야 함수 내부의 auth.uid()가
// 이 요청의 로그인 사용자로 정확히 해석된다 — ctx.supabaseAdmin(service
// role)으로 호출하면 auth.uid()가 NULL이 되어 함수가 항상 거부한다.
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

      // 1. 로그인 사용자가 소유한 쇼핑몰인지 먼저 확인 — ctx.supabase는
      //    현재 사용자의 RLS를 그대로 적용하므로, 다른 사용자의 store_id를
      //    넘기면 이 select 자체가 아무 것도 돌려주지 않는다. RPC 내부에서도
      //    auth.uid() 기준으로 소유권을 다시 확인한다(이중 방어).
      const { data: store, error: storeError } = await ctx.supabase
        .from("stores")
        .select("id")
        .eq("id", store_id)
        .single();

      if (storeError || !store) {
        return Response.json(
          { error: "쇼핑몰을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 2. 삭제 RPC 호출 — Cafe24 연결 정보·자격증명·주문·OAuth state 삭제와
      //    stores.external_store_id 초기화가 하나의 트랜잭션으로 원자적으로
      //    처리된다. access_token/refresh_token/주문 원문은 이 함수도,
      //    RPC도 어디에도 반환하지 않는다.
      const { error: rpcError } = await ctx.supabase.rpc(
        "disconnect_cafe24_integration",
        { p_store_id: store.id }
      );

      if (rpcError) {
        if (
          rpcError.message === "AUTH_REQUIRED" ||
          rpcError.message === "STORE_NOT_FOUND"
        ) {
          return Response.json(
            { error: "쇼핑몰을 찾을 수 없습니다." },
            { status: 404 }
          );
        }

        throw rpcError;
      }

      return Response.json({ ok: true });
    } catch (error) {
      console.error(
        "Cafe24 disconnect error:",
        error instanceof Error ? error.message : error
      );

      return Response.json(
        { error: "Cafe24 연결 해제 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
  }),
};
