import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { getValidMetaAccessToken } from "../_shared/meta-token.ts";
import { GRAPH_API_VERSION } from "../_shared/meta-adset-normalize.mjs";

// [초안 · 미배포] 연결된 광고의 영상 원본(재생 주소)을 받을 수 있는지 확인하는 함수.
// - 입력: { store_id, ad_id } — 본인 쇼핑몰의 연결된 Meta 광고계정만
// - 순서: 광고 → 크리에이티브 video_id(object_story_spec.video_data 또는 video_id) → /{video_id}?fields=source,length,picture
// - Meta 문서(Graph API Video 레퍼런스): source = "A URL to the raw, playable video file". 권한은 공개 영상에 페이지 · 사용자 토큰을
//   요구한다고만 적혀 있어, 광고 전용(비공개) 영상에 이 연결 토큰으로 source가 오는지는 실제 호출로만 확인된다.
// - 영상 파일은 서버에 저장하지 않는다. 재생 주소는 요청한 사용자에게만 돌려주고 프레임 추출은 그 사용자의 브라우저에서 한다.
// - AI를 부르지 않는다(유료 호출 없음).

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function meta(url: string, token: string) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => null);
    return res.ok && data ? { ok: true as const, data } : { ok: false as const, status: res.status, code: data?.error?.code ?? null };
  } catch {
    return { ok: false as const, status: 0, code: null };
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const userId = ctx.userClaims?.id;
    if (!userId) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
    const body = await req.json().catch(() => null);
    const storeId = body?.store_id, adId = String(body?.ad_id ?? "");
    if (!storeId || !/^\d{5,25}$/.test(adId)) return json({ ok: false, code: "BAD_REQUEST" }, 400);
    const { data: store } = await ctx.supabase.from("stores").select("id").eq("id", storeId).eq("user_id", userId).single();
    if (!store) return json({ ok: false, code: "STORE_NOT_FOUND" }, 404);
    // 행 타입 명시(meta-adset-insights와 같은 방식) — 스키마 타입이 없는 클라이언트는 select 결과를 never로 추론한다
    const { data: account } = await ctx.supabase.from("connected_accounts").select("id, status, external_account_id").eq("provider", "meta").eq("store_id", storeId)
      .returns<{ id: number; status: string | null; external_account_id: string | null }[]>().maybeSingle();
    if (!account || account.status !== "connected") return json({ ok: false, code: "META_NOT_CONNECTED" });
    const tok = await getValidMetaAccessToken(ctx.supabaseAdmin, account.id);
    if (!tok.ok) return json({ ok: false, code: "META_TOKEN" });

    const ad = await meta(`https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}?fields=account_id,creative{video_id,object_story_spec,asset_feed_spec}`, tok.accessToken);
    if (!ad.ok) return json({ ok: false, code: "AD_NOT_READABLE", meta_status: ad.status, meta_code: ad.code });
    // 다른 광고계정의 광고는 거절(연결 계정 id는 'act_' 접두어가 있을 수 있음)
    if (String(account.external_account_id).replace(/^act_/, "") !== String(ad.data.account_id)) return json({ ok: false, code: "AD_NOT_IN_ACCOUNT" }, 403);
    const c = ad.data.creative || {};
    const videoIds = [c.video_id, c.object_story_spec?.video_data?.video_id, ...((c.asset_feed_spec?.videos || []).map((v: any) => v.video_id))].filter(Boolean).map(String);
    if (!videoIds.length) return json({ ok: true, has_video: false });

    const out = [];
    for (const id of [...new Set(videoIds)].slice(0, 3)) {
      const v = await meta(`https://graph.facebook.com/${GRAPH_API_VERSION}/${id}?fields=source,length,picture`, tok.accessToken);
      out.push(v.ok ? { video_id: id, source_available: !!v.data.source, source: v.data.source ?? null, length: v.data.length ?? null, picture: v.data.picture ?? null }
        : { video_id: id, source_available: false, meta_status: v.status, meta_code: v.code });
    }
    return json({ ok: true, has_video: true, videos: out });
  }),
};
