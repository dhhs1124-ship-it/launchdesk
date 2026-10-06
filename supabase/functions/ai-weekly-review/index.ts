import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { getValidMetaAccessToken } from "../_shared/meta-token.ts";
import { GRAPH_API_VERSION, buildInsightsUrl, fetchAllInsightsRows } from "../_shared/meta-adset-normalize.mjs";
import {
  config, weekRanges, decideRun, adMetrics, totals, peerGroups, extractCreative, planBatches,
  batchContent, parseBatch, priorities, costUsd, scopeOf, placementInfo, SYSTEM_PROMPT, pinnedWeeks, priceOf, settleTotals, DECISION_INPUTS, worstCallUsd, worstGroupUsd,
} from "../_shared/ai-weekly-core.mjs";
import { POLICY_VERSION, PLAYBOOK_VERSION, policySystemPrompt, policyOn, selectCases, policyVariants, casesForAds, forcedCases } from "../_shared/ai-policy.mjs";
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

async function claude(key: string, model: string, maxTokens: number, content: unknown[], effort?: string, system: string = SYSTEM, timeoutMs?: number) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }], ...(effort ? { output_config: { effort } } : {}) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return { ok: false as const, status: res.status, usage: data?.usage };
    const text = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    return { ok: true as const, text, usage: data.usage || {}, stop: data.stop_reason as string };
  } catch (e) {
    return { ok: false as const, status: 0, aborted: e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError") };
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

// 이번 달(한국 시간 1일 00시부터) AI 비용 — 주간 점검 + 운영자 검증(예약 포함, DB 함수 ai_month_spent). 조회 오류면 null(예산 검사를 통과시키지 않음)
async function monthSpent(admin: Admin): Promise<number | null> {
  const { data, error } = await admin.rpc("ai_month_spent");
  if (error || data == null || !Number.isFinite(Number(data))) { console.error("ai-weekly-review budget:", error?.message || "no data"); return null; }
  return Number(data);
}

// 운영자 검증 비용 예약 — 합계 · 한도 검사 · 예약 삽입을 DB 함수 하나(advisory lock)로. 동시 요청이 함께 통과하지 않는다
async function reserveBudget(admin: Admin, userId: string, storeId: unknown, kind: string, model: string, amount: number, limit: number, ref: string | null = null, maxRefPerDay: number | null = null) {
  const { data, error } = await admin.rpc("ai_budget_reserve", { p_user: userId, p_store: Number(storeId), p_kind: kind, p_model: model, p_amount: amount, p_limit: limit, p_ref: ref, p_max_ref_per_day: maxRefPerDay });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) { console.error("ai-weekly-review reserve:", error?.message || "no row"); return null; }
  return { ok: !!row.ok, id: row.reservation_id as number | null, spent: Number(row.spent_usd), reason: row.reason as string | null };
}
// 정산 — 사용량을 모두 확인했으면 실제 비용, 아니면 예약 금액 유지(unsettled). 실패하면 예약은 reserved로 남아 예약 금액으로 집계된다
async function settleBudget(admin: Admin, id: number, model: string, calls: any[], note: string) {
  const t = settleTotals(model, calls);
  const { error } = await admin.rpc("ai_budget_settle", { p_id: id, p_actual: t.actual_usd, p_known: t.known, p_note: note });
  if (error) console.error("ai-weekly-review settle:", id, error.message);
  return { ...t, settled: !error };
}
async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 함수 시간 안에 정산할 수 있게 호출마다 시간 제한(남은 시간 − 여유 15초, 최소 20초)
const callTimeout = (deadline: number) => Math.max(20000, deadline - Date.now() - 15000);

// 운영자 검증 — 사용자 화면에 없는 경로. 주간 기록 · 이용 횟수는 건드리지 않고 ai_weekly_verifications에 따로 남긴다.
// 같은 스냅샷 · 같은 이미지 · 같은 프롬프트로 effort만 바꿔 동시에 1회씩 호출한다(최대 2개). 최악 비용이 상한을 넘으면 호출하지 않는다.
const VERIFY_CAP_USD = 0.5;
async function verify(ctx: any, admin: Admin, userId: string, storeId: unknown, body: any, weeks: ReturnType<typeof weekRanges>, cfg: ReturnType<typeof config>, deadline: number) {
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
  // 대상 광고 1개(선택) — 정책 비교를 같은 광고로 고정. 비교 광고(peers)는 그 주 전체 광고 기준 그대로
  const targetAd = body?.ad_id == null || body.ad_id === "" ? null : String(body.ad_id);
  if (targetAd !== null && !/^\d{5,25}$/.test(targetAd)) return json({ ok: false, code: "BAD_REQUEST", error: "ad_id" }, 400);
  // 사례 지정(선택, 사례 연결 검증용) — 새 지시문 변형에만 · 결과에 '운영자 지정'으로 남긴다
  let forced: string[] | null = null;
  if (body?.case_ids != null) {
    const fc = forcedCases(body.case_ids);
    if (!fc.ok) return json({ ok: false, code: "BAD_REQUEST", error: fc.error }, 400);
    if (!variants.some((v: any) => v.withCases)) return json({ ok: false, code: "BAD_REQUEST", error: "사례 지정은 compare_policy(또는 분석 기준 켜짐)에서만" }, 400);
    forced = fc.ids as string[];
  }
  const built = await buildSnapshot(ctx, admin, storeId, body, useWeeks, cfg);
  if (!built.ok) return json({ ok: false, code: "NO_SNAPSHOT", error: built.error });
  const snap = built.snap;
  let batches = built.batches;
  if (targetAd) {
    if (!snap.ads.some((a: any) => a.ad_id === targetAd)) return json({ ok: false, code: "AD_NOT_IN_PERIOD", error: "지정한 광고가 이 기간 분석 대상(광고비 집행)에 없어요" }, 400);
    batches = [{ index: 0, ad_ids: [targetAd], status: "pending" }];
  }
  const calls = batches.length * efforts.length * variants.length;
  const price = priceOf(cfg.model);
  if (!price) return json({ ok: false, code: "AI_MODEL_UNPRICED" }, 500);
  const adsById: Record<string, any> = {};
  for (const a of snap.ads) adsById[a.ad_id] = a;
  const peers = peerGroups(snap.ads);
  const context = { period: snap.period, notes: snap.notes, currency: snap.period.currency, decision_inputs: DECISION_INPUTS };
  const autoCases = casesForAds(snap.ads, peers);
  const casesOf = (v: any) => !v.withCases ? null : forced ? Object.fromEntries(batches.flatMap((b: any) => b.ad_ids).map((id: string) => [id, forced as string[]])) : autoCases;
  // 이미지(무료 다운로드)를 먼저 받아 실제로 보낼 내용으로 최악 비용을 잡는다 — 고정 입력 가정(예전 20,000토큰)은 이미지 · 광고 수가 많으면 예약이 실제보다 작았다
  const imagesByBatch = await Promise.all(batches.map(async (b: any) => {
    const images: Record<string, any[]> = {};
    for (const id of b.ad_ids) {
      images[id] = [];
      for (const im of adsById[id].imagePlan || []) { const got = await downloadImage(im.url); im.sent = !!got; if (got) images[id].push({ ...got, label: im.label }); }
    }
    return images;
  }));
  let worst = 0;
  for (const _effort of efforts) for (const v of variants) for (let i = 0; i < batches.length; i++) {
    worst += worstCallUsd(price, v.system, batchContent(batches[i], adsById, peers, context, imagesByBatch[i], casesOf(v)), cfg.maxOutputTokens) as number;
  }
  worst = Math.ceil(worst * 10000) / 10000;
  if (worst > cap) return json({ ok: false, code: "OVER_VERIFY_BUDGET", calls, worst_usd: worst, cap_usd: cap });
  const rsv = await reserveBudget(admin, userId, storeId, "verify", cfg.model, worst, cfg.monthlyBudgetUsd);
  if (!rsv) return json({ ok: false, code: "BUDGET_CHECK_FAILED" }, 500);
  if (!rsv.ok || !rsv.id) return json({ ok: false, code: "BUDGET_EXCEEDED", spent_usd: rsv.spent });
  const reservationId = rsv.id, allCalls: any[] = [];
  // 입력 지문 — 실제로 모델에 보내는 내용 그대로(지표 · 문구 · 이미지 데이터 · 귀속 · 목적 · 비교 광고 · 판단 입력 · 메모)
  // shared: 사례 블록을 뺀 공통 입력(두 변형이 같아야 함) / 실행별 full: 지시문 + 사례 포함 전체 입력
  const sharedFingerprint = await sha256(JSON.stringify(batches.map((b: any, i: number) => batchContent(b, adsById, peers, context, imagesByBatch[i], null))));
  const label = String(body?.label || (comparePolicy ? "policy-compare" : "verify")).slice(0, 48) + (forced ? ":forced-cases" : "");
  const jobs: any[] = [];
  for (const effort of efforts) for (const v of variants) jobs.push({ effort, v });
  let runs: any[] = [];
  try {
  runs = await Promise.all(jobs.map(async ({ effort, v }: any) => {
    const t0 = Date.now(), usage: any = { calls: 0, input_tokens: 0, output_tokens: 0, images: 0, stop_reasons: [] }, results: Record<string, any> = {}, failed: string[] = [];
    const casesById = casesOf(v), sent: unknown[] = [];
    let cost = 0;
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i], images = imagesByBatch[i];
      const content = batchContent(b, adsById, peers, context, images, casesById);
      sent.push(content);
      const res = await claude(key, cfg.model, cfg.maxOutputTokens, content, effort, v.system, callTimeout(deadline));
      allCalls.push(res); usage.calls++; usage.images += Object.values(images).reduce((t: number, l: any) => t + l.length, 0);
      if (res.usage) { usage.input_tokens += res.usage.input_tokens || 0; usage.output_tokens += res.usage.output_tokens || 0; cost += costUsd(cfg.model, res.usage) || 0; }
      if (res.ok) usage.stop_reasons.push(res.stop);
      // 잘림(max_tokens)은 해석하지 않고 실패로(자동 재시도 없음)
      const parsed: Record<string, any> | null = res.ok && res.stop !== "max_tokens" ? parseBatch(res.text, b, adsById, peers, casesById, { policy: v.key === "policy_on", decisionInputs: DECISION_INPUTS }) : null;
      if (parsed) Object.assign(results, parsed);
      failed.push(...b.ad_ids.filter((id: string) => !parsed || !parsed[id]));
    }
    const row = { user_id: userId, store_id: storeId, reservation_id: reservationId, label: comparePolicy ? label + ":" + v.key : label, effort, model: cfg.model, status: failed.length ? "failed" : "completed",
      usage, cost_usd: Math.round(cost * 10000) / 10000, duration_ms: Date.now() - t0,
      result: { ...v.meta, variant: v.key, shared_input_fingerprint: sharedFingerprint, full_input_fingerprint: await sha256(v.system + JSON.stringify(sent)),
        target_ad_id: targetAd, case_selection: !v.withCases ? "none" : forced ? "operator_forced" : "auto",
        case_ids: casesById ? Object.fromEntries(batches.flatMap((b: any) => b.ad_ids).map((id: string) => [id, (casesById as Record<string, string[]>)[id] || []])) : {},
        truncated: usage.stop_reasons.includes("max_tokens"), ads_by_id: results, failed_ads: failed, period: snap.period,
        inputs: snap.ads.map((a: any) => ({ ad_id: a.ad_id, placement: a.placement, title: a.creative?.title ?? null, images_sent: (a.imagePlan || []).filter((im: any) => im.sent).length })) } };
    const ins = await admin.from("ai_weekly_verifications").insert(row).select("id").single();
    if (ins.error) console.error("ai-weekly-review verify save:", ins.error.message);
    return { id: ins.data?.id ?? null, saved: !ins.error, ...row };
  }));
  } finally {
    // 예외 · 일부 실패여도 정산을 시도한다. 호출 기록이 모자라면(예외로 중단) known=false → 예약 금액 유지
    if (allCalls.length < calls) allCalls.push({ usage: undefined });
    var budget = await settleBudget(admin, reservationId, cfg.model, allCalls, comparePolicy ? "policy-compare" : "verify");
  }
  return json({ ok: true, compare_policy: comparePolicy, shared_input_fingerprint: sharedFingerprint, reservation: { id: reservationId, reserved_usd: worst, ...budget }, runs });
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
// 연결할 Meta 광고가 이 쇼핑몰의 연결 광고계정 광고인지(무료 조회 1회)
async function adInStoreAccount(ctx: any, admin: Admin, storeId: unknown, adId: string) {
  const { data: account }: { data: any } = await ctx.supabase.from("connected_accounts").select("id, status, external_account_id").eq("provider", "meta").eq("store_id", storeId).maybeSingle();
  if (!account || account.status !== "connected" || !account.external_account_id) return { ok: false as const, code: "META_NOT_CONNECTED" };
  const tok = await getValidMetaAccessToken(admin, account.id);
  if (!tok.ok) return { ok: false as const, code: "META_TOKEN_INVALID" };
  const r = await meta(`https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}?fields=account_id,name`, tok.accessToken);
  if (!r.ok) return { ok: false as const, code: r.status === 400 || r.status === 404 ? "AD_NOT_FOUND_OR_NO_ACCESS" : "AD_CHECK_FAILED" };
  const acct = "act_" + String(r.data?.account_id || "").replace(/^act_/, "");
  if (acct !== account.external_account_id) return { ok: false as const, code: "AD_NOT_IN_STORE_ACCOUNT" };
  return { ok: true as const, ad_name: r.data?.name ?? null };
}
async function verifyVideo(ctx: any, admin: Admin, userId: string, storeId: unknown, body: any, cfg: ReturnType<typeof config>, deadline: number) {
  const allowed = env("AI_VERIFY_USER_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(userId)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const prep: any = prepareVideoVerify(body, { model: cfg.model, price: priceOf(cfg.model) } as any);
  if (!prep.ok) return json({ ok: false, code: "BAD_REQUEST", errors: prep.errors }, 400);
  if (prep.source.meta_ad_id) {
    const own = await adInStoreAccount(ctx, admin, storeId, prep.source.meta_ad_id);
    if (!own.ok) return json({ ok: false, code: own.code }, own.code === "AD_NOT_IN_STORE_ACCOUNT" ? 403 : 400);
    prep.source.meta_ad_check = "verified";
  }
  const framesHash = await sha256(JSON.stringify(prep.frames_seen) + "|" + body.frames.map((f: any) => String(f.base64 || f.data || "")).join("|"));
  const summary = { prompt_version: VIDEO_PROMPT_VERSION, source: prep.source, frames_seen: prep.frames_seen, frames_hash: framesHash, transcript_provided: prep.transcript_provided,
    request_bytes: prep.request_bytes, max_output_tokens: prep.max_output_tokens, worst_usd: prep.worst_usd, attempts_per_day_limit: VIDEO_LIMITS.maxAttemptsPerVideoPerDay };
  if (body?.dry_run === true) return json({ ok: true, dry_run: true, called_ai: false, ...summary });
  const key = env("LAUNCHROAS_ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, code: "AI_NOT_CONFIGURED" });
  if (prep.worst_usd > VERIFY_CAP_USD) return json({ ok: false, code: "OVER_VERIFY_BUDGET", worst_usd: prep.worst_usd, cap_usd: VERIFY_CAP_USD });
  // 같은 프레임 묶음은 하루 최대 N회(예약과 같은 잠금 안에서 셈) — 자동 재시도는 하지 않는다
  const rsv = await reserveBudget(admin, userId, storeId, "verify_video", cfg.model, prep.worst_usd, cfg.monthlyBudgetUsd, framesHash, VIDEO_LIMITS.maxAttemptsPerVideoPerDay);
  if (!rsv) return json({ ok: false, code: "BUDGET_CHECK_FAILED" }, 500);
  if (!rsv.ok || !rsv.id) return json({ ok: false, code: rsv.reason === "attempts" ? "VIDEO_ATTEMPTS_EXCEEDED" : "BUDGET_EXCEEDED", spent_usd: rsv.spent }, rsv.reason === "attempts" ? 429 : 200);
  const effort = ["low", "medium", "high"].includes(body?.effort) ? body.effort : "medium";
  const t0 = Date.now();
  let res: any = { ok: false, status: 0 };
  try { res = await claude(key, cfg.model, VIDEO_LIMITS.maxOutputTokens, prep.content, effort, VIDEO_SYSTEM_PROMPT, callTimeout(deadline)); }
  finally { var budget = await settleBudget(admin, rsv.id, cfg.model, [res], "verify_video"); }
  const usage = { calls: 1, input_tokens: res.usage?.input_tokens || 0, output_tokens: res.usage?.output_tokens || 0, frames: prep.frames_seen.length, stop_reasons: res.ok ? [res.stop] : [] };
  const fin: any = res.ok ? finishVideoVerify(res.text, prep.frames_seen, prep.transcript, res.stop) : { ok: false, output: null, validation: { ok: false, errors: [res.aborted ? "시간 초과 — 사용량 미확인(예약 금액 유지)" : "AI 호출 실패"] } };
  const row = { user_id: userId, store_id: storeId, reservation_id: rsv.id, label: String(body?.label || "video").slice(0, 60), effort, model: cfg.model, status: fin.ok ? "completed" : "failed",
    usage, cost_usd: Math.round((costUsd(cfg.model, res.usage || {}) || 0) * 10000) / 10000, duration_ms: Date.now() - t0,
    result: { kind: "video", ...summary, truncated: !!fin.truncated, output: fin.output, validation: fin.validation } };
  const ins = await admin.from("ai_weekly_verifications").insert(row).select("id").single();
  if (ins.error) console.error("ai-weekly-review verify_video save:", ins.error.message);
  return json({ ok: true, id: ins.data?.id ?? null, saved: !ins.error, reservation: { id: rsv.id, reserved_usd: prep.worst_usd, ...budget }, ...row });
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
    // 가격표에 없는 모델은 비용 · 예산을 계산할 수 없다 — 호출하지 않는다(비용 0으로 보지 않음)
    if (!priceOf(cfg.model)) { console.error("ai-weekly-review: unpriced model", cfg.model); return json({ ok: false, code: "AI_MODEL_UNPRICED", message: "AI 설정을 확인하지 못해 점검을 시작하지 않았어요." }, 500); }
    const deadline = started + cfg.timeBudgetMs;
    if (action === "verify") return await verify(ctx, admin, userId, storeId, body, weeks, cfg, deadline);
    if (action === "verify_video") return await verifyVideo(ctx, admin, userId, storeId, body, cfg, deadline);

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

    // 이번 실행에서 쓴 비용(누적) — 중간 예외로 끝나도 호출 비용을 기록에서 빠뜨리지 않는다
    let runCost: number | null = null, runReserved: number | null = null;
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
      const context = { period: snap.period, notes: snap.notes, currency: snap.period.currency, decision_inputs: DECISION_INPUTS };
      const casesById = casesFor(snap.ads, peers);
      const results: Record<string, any> = { ...(row?.result?.ads_by_id || {}) };
      const usage = { ...(row?.usage || {}) } as any;
      usage.calls = usage.calls || 0; usage.input_tokens = usage.input_tokens || 0; usage.output_tokens = usage.output_tokens || 0; usage.images = usage.images || 0;
      const startCost = Number(row?.cost_usd || 0);
      let cost = startCost, reservedCost = Number(row?.reserved_cost_usd || 0), retried = false, budgetHit = false, budgetCheckFailed = false;
      // 묶음을 concurrency개씩 동시에 — 2026-10-06 실측 광고 1개(이미지 포함) 호출이 약 1분이라 순서대로면 함수 시간 제한(무료 150초)을 넘는다
      const todo = batches.filter((b: any) => b.status !== "done");
      if (todo.some((b: any) => b.status === "failed")) retried = true;
      for (let i = 0; i < todo.length; i += cfg.concurrency) {
        const group = todo.slice(i, i + cfg.concurrency);
        if (budgetHit || budgetCheckFailed || Date.now() - started > cfg.timeBudgetMs - 70000) { group.forEach((b: any) => (b.status = "pending")); continue; }
        // 이미지(무료 다운로드)를 먼저 받아 실제로 보낼 내용으로 그룹 최악 비용을 잡는다
        const prepared = await Promise.all(group.map(async (b: any) => {
          const images: Record<string, any[]> = {};
          for (const id of b.ad_ids) {
            images[id] = [];
            for (const im of adsById[id].imagePlan || []) {
              const got = await downloadImage(im.url);
              im.sent = !!got;
              if (got) images[id].push({ ...got, label: im.label });
            }
          }
          return { b, images, content: batchContent(b, adsById, peers, context, images, casesById) };
        }));
        // 그룹마다 최악 비용을 원자적으로 예약(합계 · 한도 검사 · 예약 삽입을 DB 잠금 하나로) — 동시 요청 · 운영자 검증과 함께 한도를 넘지 않는다
        const groupWorst = worstGroupUsd(priceOf(cfg.model), SYSTEM, prepared.map((p) => p.content), cfg.maxOutputTokens);
        const rsv = groupWorst == null ? null : await reserveBudget(admin, userId, storeId, "run", cfg.model, groupWorst, cfg.monthlyBudgetUsd, `review:${claimed.id}`);
        if (!rsv) { group.forEach((b: any) => (b.status = "pending")); budgetCheckFailed = true; continue; }
        if (!rsv.ok || !rsv.id) { group.forEach((b: any) => (b.status = "pending")); budgetHit = true; continue; }
        const groupCalls: any[] = [];
        try {
          await Promise.all(prepared.map(async ({ b, images, content }: any) => {
            const res = await claude(key, cfg.model, cfg.maxOutputTokens, content, cfg.effort, SYSTEM, callTimeout(deadline));
            groupCalls.push(res);
            usage.calls++;
            let callCost: number;
            if (res.usage && typeof res.usage.input_tokens === "number" && typeof res.usage.output_tokens === "number") {
              usage.input_tokens += res.usage.input_tokens; usage.output_tokens += res.usage.output_tokens; callCost = costUsd(cfg.model, res.usage) || 0;
            } else {
              // 사용량 미확인(시간 초과 · 응답 실패) — 0으로 보지 않고 이 호출의 최악 비용으로(예약도 미확인으로 남아 예약 금액 유지)
              usage.unconfirmed_calls = (usage.unconfirmed_calls || 0) + 1;
              callCost = worstCallUsd(priceOf(cfg.model), SYSTEM, content, cfg.maxOutputTokens) || 0;
            }
            // 예약으로 월 합계에 들어간 비용 — 주간 기록에는 운영자용으로 남기되 월 합계에서는 reserved_cost_usd만큼 빼서 이중 집계하지 않는다
            cost += callCost; reservedCost += callCost;
            runCost = cost; runReserved = reservedCost;
            usage.images += Object.values(images).reduce((t: number, l: any) => t + l.length, 0);
            if (res.ok && res.stop !== "end_turn") (usage.stop_reasons = usage.stop_reasons || []).push(res.stop); // max_tokens = 답변 잘림 · refusal = 거절
            const parsed: Record<string, any> | null = res.ok && res.stop !== "max_tokens" ? parseBatch(res.text, b, adsById, peers, casesById, { policy: POLICY, decisionInputs: DECISION_INPUTS }) : null;
            const missing = b.ad_ids.filter((id: string) => !parsed || !parsed[id]);
            if (parsed) Object.assign(results, parsed);
            b.status = !parsed || missing.length === b.ad_ids.length ? "failed" : "done";
            b.missing = missing;
          }));
        } finally {
          // 예외로 중단돼 호출 기록이 모자라면 known=false → 예약 금액 유지. 정산이 실패해도 예약은 reserved로 남아 예약 금액으로 집계된다
          if (groupCalls.length < prepared.length) groupCalls.push({ usage: undefined });
          await settleBudget(admin, rsv.id, cfg.model, groupCalls, `run:${claimed.id}`);
        }
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
        notes: budgetHit ? snap.notes.concat(["이번 달 AI 운영 한도에 도달해 남은 광고는 분석하지 않았어요(이용 횟수 차감 없음)"])
          : budgetCheckFailed ? snap.notes.concat(["운영 한도를 확인하지 못해 남은 광고는 분석하지 않았어요(이용 횟수 차감 없음)"]) : snap.notes,
        model: cfg.model, effort: cfg.effort, ...policyMeta(),
      };
      return await finish({ status, batches, result, usage, cost_usd: Math.round(cost * 10000) / 10000, reserved_cost_usd: Math.round(reservedCost * 10000) / 10000,
        retry_count: (row?.retry_count || 0) + (retried ? 1 : 0), period: snap.period,
        error: status !== "failed" ? null : budgetHit ? "이번 달 AI 점검 운영 한도에 도달했어요. 이용 횟수는 차감되지 않았어요."
          : budgetCheckFailed ? "운영 한도를 확인하지 못해 점검을 마치지 못했어요. 이용 횟수는 차감되지 않았어요." : "AI 분석에 실패했어요. 이용 횟수는 차감되지 않았어요." });
    } catch (e) {
      console.error("ai-weekly-review error:", e instanceof Error ? e.message : e);
      return await finish({ status: row?.status === "partial" ? "partial" : "failed", error: "점검 중 오류가 발생했어요. 이용 횟수는 차감되지 않았어요.",
        ...(runCost != null ? { cost_usd: Math.round(runCost * 10000) / 10000 } : {}),
        ...(runReserved != null ? { reserved_cost_usd: Math.round(runReserved * 10000) / 10000 } : {}) });
    }
  }),
};

