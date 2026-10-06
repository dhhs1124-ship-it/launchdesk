import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { getValidMetaAccessToken } from "../_shared/meta-token.ts";
import { GRAPH_API_VERSION, buildInsightsUrl, fetchAllInsightsRows } from "../_shared/meta-adset-normalize.mjs";
import {
  config, weekRanges, decideRun, adMetrics, totals, peerGroups, extractCreative, planBatches,
  batchContent, parseBatch, priorities, costUsd, scopeOf, placementInfo, SYSTEM_PROMPT, pinnedWeeks,
} from "../_shared/ai-weekly-core.mjs";
import { POLICY_VERSION, PLAYBOOK_VERSION, policySystemPrompt, policyOn, selectCases, policyVariants, casesForAds } from "../_shared/ai-policy.mjs";
import { VIDEO_SYSTEM_PROMPT, VIDEO_PROMPT_VERSION, VIDEO_LIMITS, prepareVideoVerify, finishVideoVerify } from "../_shared/ai-video-core.mjs";

// LaunchROAS 주간 AI 광고 점검 — 사용자가 버튼을 눌렀을 때만 실행(자동 실행 없음).
// 계정당 주 1회(한국 시간 월요일 00시 갱신) · 여러 광고를 묶어 전체 점검 1회로 계산.
// 키: 시크릿 LAUNCHROAS_ANTHROPIC_API_KEY (예전 ai-insights 함수가 쓰던 ANTHROPIC_API_KEY와 일부러 분리)
// 켜기: 시크릿 AI_WEEKLY_ENABLED=true — 꺼져 있으면 AI를 부르지 않고 이용 횟수도 쓰지 않는다.
// 사용자에게는 결과만 돌려주고 토큰 · 비용(usage, cost_usd)은 DB에만 남긴다(운영자 확인용).

type Admin = any;
const env = (k: string) => Deno.env.get(k) ?? "";
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function meta(url: string, token: string) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => null);
    return res.ok && data ? { ok: true as const, data } : { ok: false as const, status: res.status, data };
  } catch {
    return { ok: false as const, status: 0, data: null };
  }
}

// 광고 단위 성과(지정 기간, 귀속은 광고 세트 설정과 같게) — 페이지네이션 끝까지(상한 시 truncated)
async function adInsights(accountId: string, token: string, range: { since: string; until: string }) {
  return await fetchAllInsightsRows(async (after?: string) => {
    const url = new URL(buildInsightsUrl({ accountId, level: "ad", since: range.since, until: range.until, after, preset: null, filteringAdsetId: null, apiVersion: null }));
    url.searchParams.set("use_unified_attribution_setting", "true");
    url.searchParams.set("fields", url.searchParams.get("fields") + ",optimization_goal");
    const r = await meta(url.toString(), token);
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, rows: r.data.data || [], nextAfter: r.data.paging?.next ? r.data.paging?.cursors?.after : null };
  }, { maxPages: 30, maxRows: 2000 });
}

// 객체별 조회(10개씩 동시에) — Meta가 ids 파라미터를 더 이상 받지 않는다("The ids query parameter is deprecated in v26.0+", 2026-10-06 실제 응답)
async function byIds(ids: string[], fields: string, token: string) {
  const out: Record<string, any> = {}, failed: string[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      const r = await meta(`https://graph.facebook.com/${GRAPH_API_VERSION}/${id}?fields=${encodeURIComponent(fields)}`, token);
      if (r.ok) out[id] = r.data;
      else { failed.push(id); console.error("ai-weekly-review meta:", r.status, r.data?.error?.message); }
    }));
  }
  return { out, failed };
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
async function downloadImage(url: string) {
  try {
    const res = await fetch(url);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPES.includes(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 4_500_000) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { media_type: type, data: btoa(bin) };
  } catch {
    return null;
  }
}

// 분석 기준(정책 MD · 사례) — 시크릿 AI_POLICY_VERSION=${POLICY_VERSION}일 때만 켜진다. 기본은 기존 지시문 그대로.
const POLICY = policyOn(env);
const SYSTEM = POLICY ? policySystemPrompt(SYSTEM_PROMPT) : SYSTEM_PROMPT;
const policyMeta = () => POLICY ? { policy_version: POLICY_VERSION, playbook_version: PLAYBOOK_VERSION } : { policy_version: null, playbook_version: null };
const casesFor = (ads: any[], peers: any) => { if (!POLICY) return null; const m: Record<string, string[]> = {}; for (const a of ads) m[a.ad_id] = selectCases(a, peers); return m; };

async function claude(key: string, model: string, maxTokens: number, content: unknown[], effort?: string, system: string = SYSTEM) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }], ...(effort ? { output_config: { effort } } : {}) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return { ok: false as const, status: res.status, usage: data?.usage };
    const text = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    return { ok: true as const, text, usage: data.usage || {}, stop: data.stop_reason as string };
  } catch {
    return { ok: false as const, status: 0 };
  }
}

// 사용자에게 돌려줄 값 — 운영자용 usage · cost는 빼고
function publicView(row: any, weeks: ReturnType<typeof weekRanges>) {
  return {
    quota: { week: weeks.quotaWeek, resets_at: weeks.resetsAt, used: !!row && ["completed", "partial"].includes(row.status),
      status: row?.status ?? null, can_run: !row || ["failed", "no_data", "partial"].includes(row.status) },
    status: row?.status ?? null, error: row?.error ?? null,
    // 이어서 하기용 스냅샷(이미지 주소 · 원본 지표)과 내부 결과 맵은 내려주지 않는다
    result: row?.result ? { ...row.result, snapshot: undefined, ads_by_id: undefined } : null,
  };
}


// Meta에서 광고 · 지표 · 소재 · 게재 위치를 모아 분석 입력(스냅샷)을 만든다 — 주간 실행과 운영자 검증이 같은 입력을 쓴다
async function buildSnapshot(ctx: any, admin: Admin, storeId: unknown, body: any, weeks: ReturnType<typeof weekRanges>, cfg: ReturnType<typeof config>) {
    const { data: account }: { data: any } = await ctx.supabase.from("connected_accounts").select("id, status, external_account_id").eq("provider", "meta").eq("store_id", storeId).maybeSingle();
    if (!account || account.status !== "connected" || !account.external_account_id) return { ok: false as const, status: "failed", error: "Meta 광고계정이 연결되어 있지 않아요." };
    const tok = await getValidMetaAccessToken(admin, account.id);
    if (!tok.ok) return { ok: false as const, status: "failed", error: "Meta 연결을 다시 확인해 주세요." };
    const accountId = account.external_account_id, token = tok.accessToken;
    const accMeta = await meta(`https://graph.facebook.com/${GRAPH_API_VERSION}/${accountId}?fields=currency,timezone_name`, token);
    const timezone = accMeta.ok ? accMeta.data.timezone_name : null, currency = accMeta.ok ? accMeta.data.currency : null;

    const [cur, prev] = await Promise.all([adInsights(accountId, token, weeks.current), adInsights(accountId, token, weeks.previous)]);
    if (!cur.ok) return { ok: false as const, status: "failed", error: "Meta 광고 성과를 불러오지 못했어요." };
    const prevById: Record<string, any> = {};
    if (prev.ok) for (const r of prev.rows || []) prevById[String(r.ad_id)] = adMetrics(r);
    const rows = (cur.rows || []).filter((r: any) => Number(r.spend) > 0);
    if (!rows.length) return { ok: false as const, status: "no_data", error: "지난주 광고비가 집행된 광고가 없어요." };

    const adsetIds = [...new Set(rows.map((r: any) => String(r.adset_id)))];
    const adsets = await byIds(adsetIds, "optimization_goal,attribution_spec,targeting", token);
    const ads = rows.map((r: any) => {
      const set = adsets.out[String(r.adset_id)] || {};
      return { ad_id: String(r.ad_id), ad_name: r.ad_name, campaign_name: r.campaign_name, adset_name: r.adset_name, objective: r.objective || null,
        optimization_goal: set.optimization_goal || r.optimization_goal || null,
        placement: adsets.out[String(r.adset_id)] ? placementInfo(set.targeting) : null,
        attribution: Array.isArray(set.attribution_spec) ? set.attribution_spec.map((a: any) => `${a.event_type} ${a.window_days}일`).join(", ") : null,
        current: adMetrics(r), previous: prevById[String(r.ad_id)] || null };
    });
    const plan = planBatches(ads, cfg);
    const creativeFields = "creative.thumbnail_width(800).thumbnail_height(800){title,body,call_to_action_type,object_type,image_url,thumbnail_url,video_id,link_url,object_story_spec,asset_feed_spec}";
    let cr = await byIds(plan.analyzed.map((a: any) => a.ad_id), creativeFields, token);
    if (cr.failed.length) { // 크기 지정 문법이 거절된 광고만 크기 없이 다시
      const again = await byIds(cr.failed, creativeFields.replace(".thumbnail_width(800).thumbnail_height(800)", ""), token);
      cr = { out: { ...cr.out, ...again.out }, failed: again.failed };
    }
    for (const a of plan.analyzed) a.creative = extractCreative(cr.out[a.ad_id]?.creative);
    const replanned = planBatches(plan.analyzed, cfg); // 소재 이미지 수를 반영해 이미지 예산 다시 배분

    const notes: string[] = [];
    if (timezone && timezone !== "Asia/Seoul") notes.push(`Meta 광고계정 시간대 ${timezone} — Cafe24(한국 시간)와 하루 경계가 달라요`);
    if (!timezone) notes.push("Meta 광고계정 시간대를 확인하지 못했어요");
    if (cur.truncated) notes.push("Meta 광고 행이 조회 상한을 넘어 일부가 빠졌어요 — 전체 분석이 아니에요");
    if (!prev.ok) notes.push("그 전주 Meta 성과를 불러오지 못해 전주 비교가 없어요");
    if (cr.failed.length) notes.push(`소재를 불러오지 못한 광고 ${cr.failed.length}개 — 지표만 분석`);
    if (adsets.failed.length) notes.push(`광고 세트 설정(최적화 목표 · 귀속 기간)을 불러오지 못한 광고 세트 ${adsets.failed.length}개`);
    notes.push("귀속: 광고 세트 귀속 설정 기준(use_unified_attribution_setting). 최근 날짜의 구매는 귀속 지연으로 늘어날 수 있어요");
    notes.push("상세페이지 내용은 가져오지 않았어요 — 페이지 수정안은 제공하지 않아요");

    const sales = { current: salesBlock(body?.sales?.current), previous: salesBlock(body?.sales?.previous) };
    const fx = num(body?.fx_krw_per_unit);
    const snap = {
      period: { current: weeks.current, previous: weeks.previous, timezone_meta: timezone, timezone_cafe24: "Asia/Seoul", currency },
      ads: replanned.analyzed, skipped: replanned.skipped.concat(plan.skipped), notes, sales, fx,
      counts: { total: rows.length, analyzed: replanned.analyzed.length, skipped: plan.skipped.length },
    };
    return { ok: true as const, snap, batches: replanned.batches };
}

// 이번 달(한국 시간 1일 00시부터) AI 비용 — 주간 점검 + 운영자 검증. 조회 오류면 null(예산 검사를 통과시키지 않음)
async function monthSpent(admin: Admin): Promise<number | null> {
  const monthStart = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 8) + "01T00:00:00+09:00";
  const [a, b] = await Promise.all([
    admin.from("ai_weekly_reviews").select("cost_usd").gte("updated_at", monthStart),
    admin.from("ai_weekly_verifications").select("cost_usd").gte("created_at", monthStart),
  ]);
  if (a.error || b.error) { console.error("ai-weekly-review budget:", (a.error || b.error).message); return null; }
  return [...(a.data || []), ...(b.data || [])].reduce((t: number, r: any) => t + Number(r.cost_usd || 0), 0);
}

// 운영자 검증 — 사용자 화면에 없는 경로. 주간 기록 · 이용 횟수는 건드리지 않고 ai_weekly_verifications에 따로 남긴다.
// 같은 스냅샷 · 같은 이미지 · 같은 프롬프트로 effort만 바꿔 동시에 1회씩 호출한다(최대 2개). 최악 비용이 상한을 넘으면 호출하지 않는다.
const VERIFY_CAP_USD = 0.5;
async function verify(ctx: any, admin: Admin, userId: string, storeId: unknown, body: any, weeks: ReturnType<typeof weekRanges>, cfg: ReturnType<typeof config>) {
  const allowed = env("AI_VERIFY_USER_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(userId)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const key = env("LAUNCHROAS_ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, code: "AI_NOT_CONFIGURED" });
  // compare_policy: 같은 입력(한 번 만든 스냅샷 · 이미지)에 이전 지시문 · 새 지시문을 나란히 — 시크릿 · 주간 이용 횟수와 무관
  const comparePolicy = body?.compare_policy === true;
  const efforts = comparePolicy
    ? [["low", "medium", "high"].includes(body?.effort) ? body.effort : "medium"]
    : (Array.isArray(body?.efforts) ? body.efforts : ["high", "medium"]).filter((e: string) => ["low", "medium", "high"].includes(e)).slice(0, 2);
  if (!efforts.length) return json({ ok: false, code: "BAD_REQUEST" }, 400);
  const variants = comparePolicy ? policyVariants(SYSTEM_PROMPT)
    : [{ key: POLICY ? "policy_on" : "policy_off", system: SYSTEM, withCases: POLICY, meta: policyMeta() }];
  // 기간 고정(선택): 같은 주로 다시 돌릴 수 있게 — 없으면 지난주
  let useWeeks = weeks;
  if (body?.weeks) {
    const pin = pinnedWeeks(body.weeks, weeks);
    if (!pin.ok) return json({ ok: false, code: "BAD_REQUEST", error: pin.error }, 400);
    useWeeks = pin.weeks as ReturnType<typeof weekRanges>;
  }
  const cap = Math.min(VERIFY_CAP_USD, Number(body?.budget_usd) > 0 ? Number(body.budget_usd) : VERIFY_CAP_USD);
  const spent = await monthSpent(admin);
  if (spent == null) return json({ ok: false, code: "BUDGET_CHECK_FAILED" }, 500);
  const built = await buildSnapshot(ctx, admin, storeId, body, useWeeks, cfg);
  if (!built.ok) return json({ ok: false, code: "NO_SNAPSHOT", error: built.error });
  const { snap, batches } = built;
  const calls = batches.length * efforts.length * variants.length;
  const worst = calls * (costUsd(cfg.model, { input_tokens: 20000, output_tokens: cfg.maxOutputTokens }) || 0);
  if (worst > cap) return json({ ok: false, code: "OVER_VERIFY_BUDGET", calls, worst_usd: worst, cap_usd: cap });
  if (spent + worst > cfg.monthlyBudgetUsd) return json({ ok: false, code: "BUDGET_EXCEEDED", spent_usd: spent });
  const adsById: Record<string, any> = {};
  for (const a of snap.ads) adsById[a.ad_id] = a;
  const peers = peerGroups(snap.ads);
  const context = { period: snap.period, notes: snap.notes, currency: snap.period.currency };
  const cases = casesForAds(snap.ads, peers);
  // 입력 지문 — 두 변형이 같은 기간 · 지표 · 소재를 받았는지 확인용(이미지는 아래에서 한 번만 받아 공유)
  const inputs = JSON.stringify({ period: snap.period, ads: snap.ads.map((a: any) => ({ ad_id: a.ad_id, current: a.current, previous: a.previous, creative: { format: a.creative?.format, title: a.creative?.title, body: a.creative?.body, video_id: a.creative?.video_id ?? null }, placement: a.placement })) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(inputs));
  const fingerprint = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const imagesByBatch = await Promise.all(batches.map(async (b: any) => {
    const images: Record<string, any[]> = {};
    for (const id of b.ad_ids) {
      images[id] = [];
      for (const im of adsById[id].imagePlan || []) { const got = await downloadImage(im.url); im.sent = !!got; if (got) images[id].push({ ...got, label: im.label }); }
    }
    return images;
  }));
  const label = String(body?.label || (comparePolicy ? "policy-compare" : "verify")).slice(0, 48);
  const jobs: any[] = [];
  for (const effort of efforts) for (const v of variants) jobs.push({ effort, v });
  const runs = await Promise.all(jobs.map(async ({ effort, v }: any) => {
    const t0 = Date.now(), usage: any = { calls: 0, input_tokens: 0, output_tokens: 0, images: 0, stop_reasons: [] }, results: Record<string, any> = {}, failed: string[] = [];
    const casesById = v.withCases ? cases : null;
    let cost = 0;
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i], images = imagesByBatch[i];
      const res = await claude(key, cfg.model, cfg.maxOutputTokens, batchContent(b, adsById, peers, context, images, casesById), effort, v.system);
      usage.calls++; usage.images += Object.values(images).reduce((t: number, l: any) => t + l.length, 0);
      if (res.usage) { usage.input_tokens += res.usage.input_tokens || 0; usage.output_tokens += res.usage.output_tokens || 0; cost += costUsd(cfg.model, res.usage) || 0; }
      if (res.ok) usage.stop_reasons.push(res.stop);
      const parsed: Record<string, any> | null = res.ok ? parseBatch(res.text, b, adsById, peers, casesById) : null;
      if (parsed) Object.assign(results, parsed);
      failed.push(...b.ad_ids.filter((id: string) => !parsed || !parsed[id]));
    }
    const row = { user_id: userId, store_id: storeId, label: comparePolicy ? label + ":" + v.key : label, effort, model: cfg.model, status: failed.length ? "failed" : "completed",
      usage, cost_usd: Math.round(cost * 10000) / 10000, duration_ms: Date.now() - t0,
      result: { ...v.meta, variant: v.key, input_fingerprint: fingerprint, ads_by_id: results, failed_ads: failed, period: snap.period,
        inputs: snap.ads.map((a: any) => ({ ad_id: a.ad_id, placement: a.placement, title: a.creative?.title ?? null, images_sent: (a.imagePlan || []).filter((im: any) => im.sent).length })) } };
    const ins = await admin.from("ai_weekly_verifications").insert(row).select("id").single();
    if (ins.error) console.error("ai-weekly-review verify save:", ins.error.message);
    return { id: ins.data?.id ?? null, saved: !ins.error, ...row };
  }));
  return json({ ok: true, compare_policy: comparePolicy, input_fingerprint: fingerprint, runs });
}

function num(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function salesBlock(s: any) {
  if (!s || typeof s !== "object") return null;
  return { gross_sales_krw: num(s.gross_sales_krw), sold_qty: num(s.sold_qty), linked_qty: num(s.linked_qty),
    margin_total_krw: num(s.margin_total_krw), partial: !!s.partial, estimated_orders: num(s.estimated_orders) };
}

// 운영자 영상 검증 — 허용 사용자(AI_VERIFY_USER_IDS)만 · 월 예산 · 1회 상한 검사 후 1회 호출 · 결과는 ai_weekly_verifications에
// 프레임은 운영자 브라우저(화면에 보이는 탭)가 뽑아 보낸다. 영상 파일은 받지도 저장하지도 않는다. 음성 전사가 없으면 '음성 미확인'.
// dry_run=true면 요청 검사 · 구성 · 비용 추정만 돌려주고 AI를 부르지 않으며 저장하지 않는다.
async function verifyVideo(admin: Admin, userId: string, storeId: unknown, body: any, cfg: ReturnType<typeof config>) {
  const allowed = env("AI_VERIFY_USER_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(userId)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const prep: any = prepareVideoVerify(body, { model: cfg.model } as any);
  if (!prep.ok) return json({ ok: false, code: "BAD_REQUEST", errors: prep.errors }, 400);
  const summary = { prompt_version: VIDEO_PROMPT_VERSION, frames_seen: prep.frames_seen, transcript_provided: prep.transcript_provided, request_bytes: prep.request_bytes, worst_usd: prep.worst_usd };
  if (body?.dry_run === true) return json({ ok: true, dry_run: true, called_ai: false, ...summary });
  const key = env("LAUNCHROAS_ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, code: "AI_NOT_CONFIGURED" });
  if (prep.worst_usd > VERIFY_CAP_USD) return json({ ok: false, code: "OVER_VERIFY_BUDGET", worst_usd: prep.worst_usd, cap_usd: VERIFY_CAP_USD });
  const spent = await monthSpent(admin);
  if (spent == null) return json({ ok: false, code: "BUDGET_CHECK_FAILED" }, 500);
  if (spent + prep.worst_usd > cfg.monthlyBudgetUsd) return json({ ok: false, code: "BUDGET_EXCEEDED", spent_usd: spent });
  const effort = ["low", "medium", "high"].includes(body?.effort) ? body.effort : "medium";
  const t0 = Date.now();
  const res = await claude(key, cfg.model, VIDEO_LIMITS.maxOutputTokens, prep.content, effort, VIDEO_SYSTEM_PROMPT);
  const usage = { calls: 1, input_tokens: res.usage?.input_tokens || 0, output_tokens: res.usage?.output_tokens || 0, frames: prep.frames_seen.length, stop_reasons: res.ok ? [res.stop] : [] };
  const fin = res.ok ? finishVideoVerify(res.text, prep.frames_seen, prep.transcript_provided) : { ok: false, output: null, validation: { ok: false, errors: ["AI 호출 실패"] } };
  const row = { user_id: userId, store_id: storeId, label: String(body?.label || "video").slice(0, 60), effort, model: cfg.model, status: fin.ok ? "completed" : "failed",
    usage, cost_usd: Math.round((costUsd(cfg.model, res.usage || {}) || 0) * 10000) / 10000, duration_ms: Date.now() - t0,
    result: { kind: "video", ad_id: String(body.ad_id), ...summary, output: fin.output, validation: fin.validation } };
  const ins = await admin.from("ai_weekly_verifications").insert(row).select("id").single();
  if (ins.error) console.error("ai-weekly-review verify_video save:", ins.error.message);
  return json({ ok: true, id: ins.data?.id ?? null, saved: !ins.error, ...row });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const started = Date.now();
    const cfg = config(env);
    const userId = ctx.userClaims?.id;
    if (!userId) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
    const body = await req.json().catch(() => null);
    const storeId = body?.store_id, action = body?.action;
    if (!storeId || !["status", "run", "verify", "verify_video"].includes(action)) return json({ ok: false, code: "BAD_REQUEST" }, 400);
    const { data: store } = await ctx.supabase.from("stores").select("id").eq("id", storeId).eq("user_id", userId).single();
    if (!store) return json({ ok: false, code: "STORE_NOT_FOUND" }, 404);

    const admin: Admin = ctx.supabaseAdmin;
    const weeks = weekRanges(new Date());
    // DB 오류를 "기록 없음"으로 보면 이용 횟수 · 예산 검사가 통과돼 버린다 — 오류면 멈춘다
    const { data: row, error: rowErr } = await admin.from("ai_weekly_reviews").select("*").eq("user_id", userId).eq("quota_week", weeks.quotaWeek).maybeSingle();
    if (rowErr) {
      console.error("ai-weekly-review db:", rowErr.message);
      return json({ ok: false, code: "DB_ERROR", message: "점검 기록을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 500);
    }
    if (action === "status") return json({ ok: true, enabled: cfg.enabled, ...publicView(row, weeks) });
    if (action === "verify") return await verify(ctx, admin, userId, storeId, body, weeks, cfg);
    if (action === "verify_video") return await verifyVideo(admin, userId, storeId, body, cfg);

    // ---- 실행 ----
    const key = env("LAUNCHROAS_ANTHROPIC_API_KEY");
    if (!cfg.enabled || !key) return json({ ok: false, code: "AI_NOT_CONFIGURED", message: "주간 AI 점검이 아직 켜지지 않았어요.", ...publicView(row, weeks) });
    if (row && String(row.store_id) !== String(storeId) && !["failed", "no_data"].includes(row.status)) {
      return json({ ok: false, code: "USED_FOR_OTHER_STORE", message: "이번 주 점검은 다른 쇼핑몰에 사용했어요.", ...publicView(row, weeks) });
    }
    const decision = decideRun(row, new Date(), cfg.maxRetries);
    if (decision.kind === "done") return json({ ok: false, code: "WEEKLY_LIMIT", message: "이번 주 점검을 이미 사용했어요.", ...publicView(row, weeks) });
    if (decision.kind === "busy") return json({ ok: false, code: "IN_PROGRESS", message: "점검이 진행 중이에요.", ...publicView(row, weeks) });
    if (decision.kind === "retries_exhausted") return json({ ok: false, code: "RETRIES_EXHAUSTED", message: "이번 주 재시도 횟수를 모두 썼어요.", ...publicView(row, weeks) });

    // 서비스 전체 월 예산(운영자 검증 비용 포함)
    const spent = await monthSpent(admin);
    if (spent == null) return json({ ok: false, code: "BUDGET_CHECK_FAILED", message: "운영 한도를 확인하지 못해 점검을 시작하지 않았어요.", ...publicView(row, weeks) }, 500);
    if (spent >= cfg.monthlyBudgetUsd) return json({ ok: false, code: "BUDGET_EXCEEDED", message: "이번 달 AI 점검 운영 한도에 도달했어요.", ...publicView(row, weeks) });

    // 실행 권한 잡기 — 새 행 삽입(고유 제약) 또는 같은 updated_at일 때만 갱신(동시 클릭 · 동시 요청 방지)
    const nowIso = new Date().toISOString();
    let claimed: any = null;
    if (decision.kind === "new") {
      const ins = await admin.from("ai_weekly_reviews").insert({ user_id: userId, quota_week: weeks.quotaWeek, store_id: storeId, status: "running", updated_at: nowIso }).select("*").single();
      // 고유 제약 위반(23505)만 "다른 요청이 먼저 시작"이고, 그 밖의 오류는 진행 중으로 보이지 않게 한다
      if (ins.error && ins.error.code !== "23505") {
        console.error("ai-weekly-review claim:", ins.error.message);
        return json({ ok: false, code: "DB_ERROR", message: "점검을 시작하지 못했어요. 이용 횟수는 차감되지 않았어요." }, 500);
      }
      claimed = ins.data;
    } else {
      const upd = await admin.from("ai_weekly_reviews").update({ status: "running", updated_at: nowIso, store_id: decision.kind === "continue" ? row.store_id : storeId })
        .eq("id", row.id).eq("updated_at", row.updated_at).select("*").maybeSingle();
      claimed = upd.data;
    }
    if (!claimed) return json({ ok: false, code: "IN_PROGRESS", message: "점검이 진행 중이에요." });

    const finish = async (patch: Record<string, unknown>) => {
      const { data } = await admin.from("ai_weekly_reviews").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", claimed.id).select("*").single();
      return json({ ok: patch.status === "completed" || patch.status === "partial", ...publicView(data, weeks) });
    };

    try {
      // ---- 데이터: 이어서 하기면 저장한 스냅샷, 아니면 새로 조회 ----
      let snap = decision.kind === "continue" ? row.result?.snapshot : null;
      let batches = decision.kind === "continue" ? row.batches : null;
      if (!snap) {
        const built = await buildSnapshot(ctx, admin, storeId, body, weeks, cfg);
        if (!built.ok) return await finish({ status: built.status, error: built.error });
        snap = built.snap; batches = built.batches;
      }

      // ---- AI 묶음 처리(시간 예산 안에서) — 이어서 하기는 실패 · 남은 묶음만 ----
      const adsById: Record<string, any> = {};
      for (const a of snap.ads) adsById[a.ad_id] = a;
      const peers = peerGroups(snap.ads);
      const context = { period: snap.period, notes: snap.notes, currency: snap.period.currency };
      const casesById = casesFor(snap.ads, peers);
      const results: Record<string, any> = { ...(row?.result?.ads_by_id || {}) };
      const usage = { ...(row?.usage || {}) } as any;
      usage.calls = usage.calls || 0; usage.input_tokens = usage.input_tokens || 0; usage.output_tokens = usage.output_tokens || 0; usage.images = usage.images || 0;
      const startCost = Number(row?.cost_usd || 0);
      let cost = startCost, retried = false, budgetHit = false;
      // 묶음을 concurrency개씩 동시에 — 2026-10-06 실측 광고 1개(이미지 포함) 호출이 약 1분이라 순서대로면 함수 시간 제한(무료 150초)을 넘는다
      const todo = batches.filter((b: any) => b.status !== "done");
      if (todo.some((b: any) => b.status === "failed")) retried = true;
      for (let i = 0; i < todo.length; i += cfg.concurrency) {
        const group = todo.slice(i, i + cfg.concurrency);
        if (Date.now() - started > cfg.timeBudgetMs - 70000) { group.forEach((b: any) => (b.status = "pending")); continue; }
        // 묶음 그룹마다 월 예산 다시 확인 — 넘는 폭은 최대 그룹 1개 비용
        if (spent + (cost - startCost) >= cfg.monthlyBudgetUsd) { group.forEach((b: any) => (b.status = "pending")); budgetHit = true; continue; }
        await Promise.all(group.map(async (b: any) => {
        const images: Record<string, any[]> = {};
        for (const id of b.ad_ids) {
          images[id] = [];
          for (const im of adsById[id].imagePlan || []) {
            const got = await downloadImage(im.url);
            im.sent = !!got;
            if (got) images[id].push({ ...got, label: im.label });
          }
        }
        const res = await claude(key, cfg.model, cfg.maxOutputTokens, batchContent(b, adsById, peers, context, images, casesById), cfg.effort);
        usage.calls++;
        if (res.usage) { usage.input_tokens += res.usage.input_tokens || 0; usage.output_tokens += res.usage.output_tokens || 0; cost += costUsd(cfg.model, res.usage) || 0; }
        usage.images += Object.values(images).reduce((t, l) => t + l.length, 0);
        if (res.ok && res.stop !== "end_turn") (usage.stop_reasons = usage.stop_reasons || []).push(res.stop); // max_tokens = 답변 잘림 · refusal = 거절
        const parsed: Record<string, any> | null = res.ok ? parseBatch(res.text, b, adsById, peers, casesById) : null;
        const missing = b.ad_ids.filter((id: string) => !parsed || !parsed[id]);
        if (parsed) Object.assign(results, parsed);
        b.status = !parsed || missing.length === b.ad_ids.length ? "failed" : "done";
        b.missing = missing;
        }));
      }

      const done = batches.filter((b: any) => b.status === "done").length;
      const status = done === batches.length ? "completed" : done ? "partial" : "failed";
      for (const a of snap.ads) a.scope = scopeOf(a);
      const cur = totals(snap.ads, "current"), prv = totals(snap.ads.filter((a: any) => a.previous), "previous");
      const spendKrw = (v: number | null) => (v == null || !snap.fx ? (snap.period.currency === "KRW" ? v : null) : Math.round(v * snap.fx));
      const profit = (s: any, spend: number | null) => (s && s.margin_total_krw != null && spendKrw(spend) != null ? s.margin_total_krw - (spendKrw(spend) as number) : null);
      const result = {
        snapshot: snap, ads_by_id: results,
        summary: {
          cafe24: snap.sales, meta: { current: cur, previous: prv, currency: snap.period.currency, fx_krw_per_unit: snap.fx },
          expected_profit: { current: profit(snap.sales.current, cur.spend), previous: profit(snap.sales.previous, prv.spend),
            partial: !!(snap.sales.current?.partial || snap.sales.previous?.partial) },
          note: "Meta 귀속 구매값은 Cafe24 실제 매출과 다른 값이에요. 예상 이익은 입력한 상품 비용 기준이에요.",
        },
        priorities: priorities(results, adsById),
        ads: snap.ads.map((a: any) => ({ ad_id: a.ad_id, ad_name: a.ad_name, campaign_name: a.campaign_name, scope: a.scope,
          current: a.current, previous: a.previous, new_ad: !a.previous, analysis: results[a.ad_id] || null,
          creative: { format: a.creative?.format, title: a.creative?.title, body: a.creative?.body, notes: a.creative?.notes, headline: a.placement?.headline || "unknown" } })),
        coverage: { total: snap.counts.total, analyzed: Object.keys(results).length, requested: snap.counts.analyzed,
          skipped: snap.skipped, failed_ads: batches.flatMap((b: any) => b.status === "done" ? b.missing || [] : b.ad_ids) },
        notes: budgetHit ? snap.notes.concat(["이번 달 AI 운영 한도에 도달해 남은 광고는 분석하지 않았어요(이용 횟수 차감 없음)"]) : snap.notes, model: cfg.model, effort: cfg.effort, ...policyMeta(),
      };
      return await finish({ status, batches, result, usage, cost_usd: Math.round(cost * 10000) / 10000,
        retry_count: (row?.retry_count || 0) + (retried ? 1 : 0), period: snap.period,
        error: status !== "failed" ? null : budgetHit ? "이번 달 AI 점검 운영 한도에 도달했어요. 이용 횟수는 차감되지 않았어요." : "AI 분석에 실패했어요. 이용 횟수는 차감되지 않았어요." });
    } catch (e) {
      console.error("ai-weekly-review error:", e instanceof Error ? e.message : e);
      return await finish({ status: row?.status === "partial" ? "partial" : "failed", error: "점검 중 오류가 발생했어요. 이용 횟수는 차감되지 않았어요." });
    }
  }),
};

