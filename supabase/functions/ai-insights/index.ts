import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { SYSTEM_PROMPT, MAX_OUTPUT_TOKENS, validatePayload, parseOutput } from "../_shared/ai-insights-core.mjs";

// LaunchROAS AI 개선 분석 — 로그인한 사용자가 버튼을 눌렀을 때만 호출된다(호출 1회 = Claude API 1회 과금).
// API 키는 Supabase 시크릿 ANTHROPIC_API_KEY. 없으면 AI를 부르지 않고 'AI 미연결'로 답한다.
// 모델은 시크릿 AI_MODEL로 바꿀 수 있다(기본 claude-sonnet-5-5).
const DEFAULT_MODEL = "claude-sonnet-5-5";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    try {
      if (!ctx.userClaims?.id) return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
      const body = await req.json().catch(() => null);
      const invalid = validatePayload(body);
      if (invalid) return Response.json({ ok: false, code: "BAD_REQUEST", message: invalid }, { status: 400 });

      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return Response.json({ ok: false, code: "AI_NOT_CONFIGURED", message: "AI API 키가 설정되지 않았습니다." });
      const model = Deno.env.get("AI_MODEL") || DEFAULT_MODEL;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: "분석할 데이터(JSON):\n" + JSON.stringify(body.payload) }],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        console.error("Claude API failed:", res.status, data?.error?.type);
        return Response.json({ ok: false, code: "AI_FAILED", status: res.status, message: "AI 호출에 실패했습니다." }, { status: 502 });
      }
      const raw = (data.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      const result = parseOutput(raw, body.payload);
      const usage = { input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null };
      if (!result) return Response.json({ ok: false, code: "AI_BAD_OUTPUT", model, usage, message: "AI 응답이 실제 지표 근거 형식에 맞지 않았습니다." });
      return Response.json({ ok: true, model, usage, result });
    } catch (error) {
      console.error("ai-insights error:", error instanceof Error ? error.message : error);
      return Response.json({ ok: false, code: "AI_FAILED", message: "AI 분석 중 오류가 발생했습니다." }, { status: 500 });
    }
  }),
};
