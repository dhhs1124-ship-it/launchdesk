// AI 컨설턴트 최소 흐름 — 순수 함수(네트워크 · DB 없음). ai-weekly-review가 쓰고 node --test로 검증한다.
// 연결하는 것: 사업 정보(tool_records business_profile) → 판단 입력(decision_inputs),
//   지난 실행 기록 · 결과(tool_records ad_log, source change · change_result — launchroas/adlog-change-core.js 형식) → 광고별 입력 · 겹침 방지,
//   주간 점검 결과 → 사장님용 요약(현재 상태 → 할 일 → 이유).
// 원칙: 없는 값은 만들지 않는다. '입력 없음'과 '불러오지 못함'을 구분한다. 광고별 손익 근거는 광고별 주문 연결이 없어 계속 없음.
import { DECISION_INPUTS } from "./ai-weekly-core.mjs";

export const CONSULT_VERSION = "consult-2026-10-08.1";
export const OBJECTIVES = ["판매", "신규 고객", "재구매", "브랜드 인지"];
export const CANNOT_CHANGE = ["예산 늘리기", "할인 · 가격", "새 사진 · 영상 촬영"];

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const inRange = (v, min, max) => (v != null && v >= min && v <= max ? Math.round(v) : null);

// ---- 사업 정보 — rows: tool_records 행(최신순). 이 쇼핑몰의 가장 최근 기록만 쓴다(예전 기록은 이력) ----
export function businessProfileOf(rows, storeId) {
  for (const r of rows || []) {
    if (!r || r.tool_type !== "business_profile" || !r.data || String(r.data.store_id) !== String(storeId)) continue;
    const d = r.data;
    const profile = {
      objective: OBJECTIVES.includes(d.objective) ? d.objective : null,
      target_roas_pct: inRange(num(d.target_roas_pct), 50, 5000),
      monthly_budget_cap_krw: inRange(num(d.monthly_budget_cap_krw), 10000, 1e10),
      cannot_change: Array.isArray(d.cannot_change) ? [...new Set(d.cannot_change.filter((x) => CANNOT_CHANGE.includes(x)))] : [],
      saved_at: typeof d.saved_at === "string" && Number.isFinite(Date.parse(d.saved_at)) ? d.saved_at : null,
    };
    const empty = !profile.objective && profile.target_roas_pct == null && profile.monthly_budget_cap_krw == null && !profile.cannot_change.length;
    return empty ? null : profile;
  }
  return null;
}

// ---- 판단 입력 — 사업 정보가 없으면 기존 상수 그대로(지시문 · 입력 변화 없음). 광고별 손익 근거는 항상 없음 ----
export function decisionInputsFrom(profile, load = "ok") {
  if (load !== "ok") {
    return Object.freeze({ goal: null, ad_profit_basis: null, user_constraints: null,
      note: "사업 정보를 불러오지 못했어요 — 목표 · 제약 없이 판단(목표 달성 · 손익 · 예산 판단 불가)" });
  }
  if (!profile) return DECISION_INPUTS;
  const goal = profile.objective ? { objective: profile.objective, target_roas_pct: profile.target_roas_pct,
    basis: profile.target_roas_pct != null ? "목표 ROAS는 Meta 귀속 구매금액 ÷ 광고비 기준 — Cafe24 실제 매출 기준이 아님" : null } : null;
  const user_constraints = profile.monthly_budget_cap_krw != null || profile.cannot_change.length
    ? { monthly_budget_cap_krw: profile.monthly_budget_cap_krw, cannot_change: profile.cannot_change } : null;
  const missing = [goal ? null : "광고 목표", "광고별 손익 근거(광고별 주문 연결 없음)", user_constraints ? null : "변경 제약"].filter(Boolean);
  return Object.freeze({ goal, ad_profit_basis: null, user_constraints,
    note: "입력 없음: " + missing.join(" · ") + " — 손익 · 예산 판단은 할 수 없고, 목표가 있으면 목표 대비 성과만 볼 수 있음" });
}

// ---- 지난 실행 기록 · 결과 ----
const STATUS_TEXT = { improved: "구매당 광고비 개선 신호", worse: "구매당 광고비 악화 신호", inconclusive: "판단 보류", small: "차이 작음(이전 기준)", unknown: "판단 불가" };
const STAGE_TEXT = { in_progress: "비교 기간 진행 중", awaiting_result: "비교 기간 끝남 · 결과 비교 전", provisional: "결과 잠정(귀속 기간 진행 중)", undetermined: "판단 불가", concluded: "결과 확정" };

// 광고계정 시간대를 몰라도 늦지 않은 오늘 — 한국 날짜 − 1일(launchroas/adlog-change-core.js accountToday의 대체값과 같음)
export function conservativeToday(nowMs) {
  return new Date(nowMs + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
}

// 실행마다 현재 결과 — 최신 결과가 조회 실패뿐이면 마지막 유효 결과(갱신 실패 · 이전 결과). adlog-change-core.js currentOf와 같은 규칙
function currentResult(list) {
  if (!list || !list.length) return null;
  const sorted = list.slice().sort((a, b) => String(a.measured_at || "").localeCompare(String(b.measured_at || "")));
  const latest = sorted[sorted.length - 1], s = latest.result;
  const onlyFetch = s.status === "unknown" && (s.blockers || []).length > 0 && (s.blockers || []).every((k) => k === "fetch_failed");
  if (onlyFetch) {
    const prev = sorted.slice(0, -1).filter((r) => r.result.status !== "unknown").pop();
    if (prev) return { record: prev, stale: true };
  }
  return { record: latest, stale: false };
}

// records: ad_log data(tool_records.data). 비교 기간이 안 끝났거나 · 결과 비교 전 · 잠정 · 판단 불가면 새 변경을 막는다(비교가 깨지지 않게)
export function previousActions(records, storeId, today) {
  const changes = [], results = {};
  for (const d of records || []) {
    if (!d || String(d.store_id) !== String(storeId)) continue;
    if (d.source === "change" && d.action_id && d.ad && d.ad.ad_id) changes.push(d);
    else if (d.source === "change_result" && d.action_id && d.result) (results[d.action_id] = results[d.action_id] || []).push(d);
  }
  return changes.map((c) => {
    const cur = currentResult(results[c.action_id]), after = (c.compare && c.compare.after) || null;
    let stage;
    if (!cur) stage = !after || !after.until || after.until >= today ? "in_progress" : "awaiting_result";
    else {
      const r = cur.record.result;
      stage = r.status === "unknown" ? "undetermined" : r.provisional === true || (r.blockers || []).includes("provisional") ? "provisional" : "concluded";
    }
    const r = cur && cur.record.result;
    return {
      action_id: c.action_id, ad_id: String(c.ad.ad_id), new_ad_id: c.ad.new_ad_id ? String(c.ad.new_ad_id) : null, ad_name: c.ad.ad_name || null,
      element: (c.change && c.change.element) || "기타", method: (c.change && c.change.method) || null, entry: c.entry || null,
      start: c.date || null, compare_after: after, changed_to: String((c.change && c.change.after) || "").slice(0, 120),
      stage, stage_text: STAGE_TEXT[stage], blocks_new_change: stage !== "concluded",
      result: r ? { status: r.status, status_text: STATUS_TEXT[r.status] || "판단 불가", measured_at: cur.record.measured_at || null, stale: cur.stale,
        provisional: r.provisional === true, blockers: (r.blockers || []).slice(0, 6), observations: (r.observations || []).slice(0, 3) } : null,
    };
  }).sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")) || String(b.action_id).localeCompare(String(a.action_id)));
}

// AI에 넘길 광고별 지난 실행 — 대상 광고 · 새 광고 ID로 찾고 사실만
export function actionsForAd(actions, adId) {
  return (actions || []).filter((a) => a.ad_id === String(adId) || a.new_ad_id === String(adId)).map((a) => ({
    element: a.element, method: a.method, start: a.start, compare_after: a.compare_after, changed_to: a.changed_to,
    stage_text: a.stage_text, result_text: a.result ? a.result.status_text + (a.result.stale ? " · 갱신 실패 · 이전 결과" : "") : null,
    blocks_new_change: a.blocks_new_change,
  }));
}

// ---- 서버가 강제하는 규칙: 진행 중인 실행이 있는 광고는 새 변경안 제외 · 예산을 못 늘리면 예산 변경안 제외. 입력은 바꾸지 않는다 ----
export function guardResults(results, actions, profile) {
  const out = {};
  const noBudget = !!(profile && profile.cannot_change.includes("예산 늘리기"));
  for (const [id, r0] of Object.entries(results || {})) {
    const r = { ...r0, hold_scope: Array.isArray(r0.hold_scope) ? r0.hold_scope.slice() : [] }, notes = [];
    const blocking = (actions || []).filter((a) => a.blocks_new_change && (a.ad_id === id || a.new_ad_id === id));
    if (blocking.length) {
      r.recommendation = null;
      r.next_action = `진행 중인 ‘${blocking[0].element}’ 변경의 결과를 먼저 확인`;
      r.hold_scope = ["진행 중인 실행 기록"].concat(r.hold_scope.filter((h) => h !== "진행 중인 실행 기록")).slice(0, 4);
      notes.push("진행 중인 실행 기록이 있어 새 변경안을 내지 않음(비교가 깨지지 않게)");
    }
    if (noBudget && r.recommendation && r.recommendation.element === "예산") {
      r.recommendation = null;
      notes.push("사업 정보: 예산을 늘릴 수 없음 — 예산 변경안 제외");
    }
    r.consult_adjusted = notes;
    out[id] = r;
  }
  return out;
}

// ---- 사장님용 요약 — 현재 상태(확인한 숫자 · 기준) → 할 일(최대 3개, 이유와 출처) → 판단하지 않은 것 ----
const won = (v) => (v < 0 ? "−" : "") + Math.abs(Math.round(v)).toLocaleString("ko-KR") + "원";
const pct = (r) => Math.round(r * 100).toLocaleString("ko-KR") + "%";

export function consultBrief({ sales, meta, expected_profit, priorities, consult, coverage }) {
  const cur = sales && sales.current, m = (meta && meta.current) || null, ep = expected_profit || {};
  const fxMissing = !!(meta && meta.currency && meta.currency !== "KRW" && !(Number(meta.fx_krw_per_unit) > 0));
  const loadOk = !!(consult && consult.load === "ok");
  const goal = consult && consult.decision_inputs && consult.decision_inputs.goal;
  const actions = (consult && consult.actions) || [];
  const status = [], todos = [], unknowns = [];

  if (ep.current != null) status.push(`지난주 광고비 차감 후 예상 이익 ${won(ep.current)}${ep.partial ? " (일부 상품 기준)" : ""}`);
  else status.push("지난주 예상 이익 계산 불가 — " + (!cur ? "Cafe24 판매 집계를 받지 못함" : fxMissing ? "광고비 환율이 없어 원화로 바꾸지 못함"
    : cur.margin_total_krw == null ? "비용을 입력한 판매 상품이 없음" : "필요한 값이 없음"));
  if (m && m.roas != null) {
    status.push(goal && goal.target_roas_pct != null
      ? `Meta ROAS ${pct(m.roas)} · 목표 ROAS ${goal.target_roas_pct}% (둘 다 Meta 귀속 기준 — Cafe24 실제 매출과 다름)`
      : `Meta ROAS ${pct(m.roas)} · ${loadOk ? "목표 미입력" : "목표 확인 불가"} (Meta 귀속 기준 — Cafe24 실제 매출과 다름)`);
  } else if (m) status.push("Meta ROAS 미측정 — 구매금액이 측정되지 않음");
  const count = (stage) => actions.filter((a) => a.stage === stage).length;
  if (count("awaiting_result")) status.push(`결과 비교를 기다리는 실행 기록 ${count("awaiting_result")}건`);
  if (count("in_progress")) status.push(`비교 기간이 진행 중인 실행 기록 ${count("in_progress")}건`);
  if (count("provisional") + count("undetermined")) status.push(`결과가 잠정 · 판단 불가인 실행 기록 ${count("provisional") + count("undetermined")}건`);
  const done = actions.filter((a) => a.stage === "concluded").sort((a, b) => String(b.result.measured_at || "").localeCompare(String(a.result.measured_at || "")))[0];
  if (done) status.push(`지난 실행 결과: ${done.ad_name || "광고"} · ${done.element} → ${done.result.status_text}${done.result.stale ? " (갱신 실패 · 이전 결과)" : ""}`);

  for (const a of actions.filter((x) => x.stage === "awaiting_result")) {
    todos.push({ what: `‘${a.ad_name || "광고"} · ${a.element} 변경’ 결과 비교하기`, source: "실행 기록",
      why: `비교 기간(${a.compare_after.since}~${a.compare_after.until})이 끝났어요 — 결과를 먼저 확인해야 다음 변경과 겹치지 않아요` });
  }
  const blocked = new Set(actions.filter((a) => a.blocks_new_change).flatMap((a) => [a.ad_id, a.new_ad_id]).filter(Boolean));
  for (const p of priorities || []) {
    if (blocked.has(String(p.ad_id))) continue; // 결과 확인이 먼저인 광고는 위 항목 · 진행 중 상태로 대신한다
    todos.push({ what: `${p.ad_name || "광고"}: ${p.action}`, why: p.headline || "AI 점검에서 우선 확인으로 분류", source: "AI 점검" });
  }
  if (loadOk && !consult.profile) todos.push({ what: "사업 정보(광고 목표) 입력", why: "목표가 없어 목표 달성 · 유지 판단을 하지 못했어요 — 다음 점검부터 반영돼요", source: "데이터" });
  if (cur && cur.partial) todos.push({ what: "비용 미입력 상품 입력", why: `지난주 판매 ${cur.sold_qty ?? "?"}개 중 ${cur.linked_qty ?? "?"}개만 이익에 들어갔어요`, source: "데이터" });
  if (fxMissing) todos.push({ what: "광고비 환율 입력", why: "광고비를 원화로 바꾸지 못해 예상 이익을 계산하지 못했어요", source: "데이터" });
  const top = todos.slice(0, 3);
  if (!top.length) top.push({ what: "이번 주 바꿀 것 없음 · 데이터 더 쌓기", why: coverage && coverage.analyzed ? "우선 확인할 광고가 없어요" : "분석한 광고가 없어요", source: "AI 점검" });

  unknowns.push("광고별 이익은 판단하지 않았어요 — 광고별 주문 연결이 없어요");
  if (!consult) unknowns.push("사업 정보 · 실행 기록 연결 전 점검이에요");
  else if (!loadOk) unknowns.push("사업 정보 · 실행 기록을 불러오지 못해 이번 점검에 반영하지 않았어요");
  else if (!goal) unknowns.push("목표 달성 여부는 판단하지 않았어요 — 광고 목표 미입력");
  if (actions.some((a) => a.result)) unknowns.push("실행 결과의 구매 수는 귀속 창을 지정해 비교한 값이라 주간 점검(광고 세트 귀속 설정)과 다를 수 있어요");
  return { version: CONSULT_VERSION, status, todos: top, unknowns };
}

// ---- 지시문 — 기존 지시문(정책 켜짐 · 꺼짐 모두) 뒤에 붙인다. 서버가 같은 규칙을 다시 강제한다(guardResults) ----
export const CONSULT_ADDENDUM = `

[사업 정보 · 지난 실행 ${CONSULT_VERSION}]
- 기간 · 계산 기준의 decision_inputs.goal은 사용자가 입력한 광고 목표다. null이면 목표 달성 여부를 말하지 마라. goal.target_roas_pct는 Meta 귀속 ROAS 기준 비교값이다(Cafe24 실제 매출 아님).
- decision_inputs.user_constraints.cannot_change에 있는 것(예산 늘리기 · 할인 · 가격 · 새 사진 · 영상 촬영)이 필요한 변경안은 내지 마라.
- ad_data.previous_actions는 이 광고에 사용자가 이미 실행한 변경과 서버가 계산한 결과다. 결과를 다시 판정하지 말고 적힌 상태만 언급한다. blocks_new_change가 true인 실행이 있으면 recommendation은 null로 두고 next_action은 그 실행의 결과 확인으로 쓴다.`;
export function consultSystemPrompt(base) {
  return base + CONSULT_ADDENDUM;
}
