import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// Meta 광고 연결 해제 — LaunchDesk 내부에 저장된 Meta 연결/토큰만 제거한다
// (Meta 서버 측 앱 권한 revoke는 이번 MVP 범위 밖 — 완료 보고 참고).
//
// FK에 ON DELETE CASCADE가 실제로 걸려 있는지는 이 환경에서 스키마를 직접
// 조회할 방법이 없어 확인하지 못했다. 그래서 CASCADE 존재 여부와 무관하게
// 항상 올바르게 동작하도록 integration_credentials → connected_accounts
// 순서로 각각 명시적으로 지운다: CASCADE가 있다면 첫 삭제가 먼저 끝내는
// 것일 뿐이고, 두 번째 삭제가 이미 없는 credential을 다시 지우려 해도
// DELETE는 대상이 0행이어도 에러 없이 끝난다.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      const { connected_account_id } = await req.json();

      if (!connected_account_id) {
        return Response.json(
          { error: "connected_account_id가 필요합니다." },
          { status: 400 }
        );
      }

      // 1. 이 connected_account가 로그인 사용자 소유의 Meta 연결인지 확인 —
      //    ctx.supabase는 현재 사용자의 RLS를 그대로 적용하므로, 다른
      //    사용자의 connected_account_id를 넘기면 이 select 자체가 아무
      //    것도 돌려주지 않는다(meta-adaccounts/meta-account-select와 동일한
      //    소유권 확인 패턴 — store ownership을 여기서 다시 검증한다).
      //    provider='meta' 조건도 함께 걸어 Cafe24 연결을 절대 건드릴 수
      //    없게 한다. status는 확인하지 않는다 — pending/connected 둘 다
      //    해제 가능해야 한다(요구사항 4).
      const { data: account, error: accountError } = await ctx.supabase
        .from("connected_accounts")
        .select("id, store_id, provider, status")
        .eq("id", connected_account_id)
        .eq("provider", "meta")
        .single();

      if (accountError || !account) {
        return Response.json(
          { error: "Meta 연결을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 2. integration_credentials의 Meta credential 삭제 — access_token이
      //    더 이상 어디에도 남지 않게 서버(service role)에서만 지운다.
      const { error: credentialError } = await ctx.supabaseAdmin
        .from("integration_credentials")
        .delete()
        .eq("connected_account_id", account.id);

      if (credentialError) {
        throw credentialError;
      }

      // 3. connected_accounts의 Meta row 자체도 삭제. provider='meta'를
      //    한 번 더 걸어(이중 방어) 실수로도 다른 provider(cafe24) 행을
      //    지울 수 없게 한다.
      const { error: deleteError } = await ctx.supabaseAdmin
        .from("connected_accounts")
        .delete()
        .eq("id", account.id)
        .eq("provider", "meta");

      if (deleteError) {
        throw deleteError;
      }

      return Response.json({ ok: true });
    } catch (error) {
      console.error(
        "Meta disconnect error:",
        error instanceof Error ? error.message : error
      );

      return Response.json(
        { error: "Meta 연결 해제 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }
  }),
};
