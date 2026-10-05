// AI 개선 분석 — 프롬프트 · 입력 검증 · 출력 검증(순수 함수, 테스트 가능).
// AI에는 클라이언트가 실제로 받은 지표와 계산 기준만 보낸다. 출력의 근거 지표(metric 경로)는
// 보낸 데이터에 실제로 있는 값이어야 하며, 없으면 버리고 버린 개수를 함께 돌려준다.

export const MAX_PAYLOAD_BYTES = 24000;
export const MAX_OUTPUT_TOKENS = 900;

export const SYSTEM_PROMPT = `너는 한국 온라인 쇼핑몰(Cafe24) 운영자를 돕는 광고 효율 분석가다.
입력 JSON의 실제 지표와 계산 기준만 근거로 쓴다. 입력에 없는 숫자 · 지표 · 사실을 만들지 마라.

규칙:
1. 광고 소재 이미지, 상세페이지, 결제 화면은 보지 못했다. 이것들에 대한 내용은 반드시 "점검 가설"로만 쓴다.
2. previous가 null이거나 비교 불가로 표시된 항목은 개선 · 악화를 단정하지 마라("비교 데이터 없음").
3. sales.partial이 true면 남은 금액은 일부 상품 기준이다. 이것으로 광고 전체 손익(적자 · 흑자)을 판단하지 마라.
4. 랜딩 페이지 조회가 링크 클릭보다 많아도 픽셀 오류라고 단정하지 마라. definitions의 지표 정의 · 집계 범위 · 귀속 기준 차이를 먼저 확인할 일로 쓴다.
5. rules는 규칙 기반 점검 결과다. 그 문장을 바꿔 말하는 것으로 끝내지 말고, 지표 사이의 관계(예: 클릭률은 정상인데 구매율이 낮음)를 근거로 가장 먼저 테스트할 행동 1개를 고른다.
6. 표본이 작으면(구매 3건 미만, 노출 2,000회 미만 등) 그 한계를 cautions에 쓴다.
7. 모든 문장은 한국어로 짧게. 금액은 원 단위 정수.

출력은 아래 JSON 하나만(설명 · 코드블록 없이):
{"status":"현재 상태 1~2문장","action":"우선 테스트할 행동 1개(한 줄)",
 "evidence":[{"metric":"입력 JSON 경로(예: current.adsets[0].link_ctr)","value":"입력 값 그대로 또는 단위만 붙인 값","meaning":"짧은 해석"}],
 "hypothesis":"점검 가설(확인하지 않은 원인)",
 "test":{"method":"테스트 방법","duration":"기간","compare_metrics":["이후 비교할 지표 경로나 이름"]},
 "comparison":"직전 동일 길이 기간 비교 요약 또는 '비교 데이터 없음'",
 "cautions":["주의 사항"]}`;

export function validatePayload(body) {
  if (!body || typeof body !== "object" || !body.payload || typeof body.payload !== "object") return "payload가 필요합니다.";
  const size = new TextEncoder().encode(JSON.stringify(body.payload)).length;
  if (size > MAX_PAYLOAD_BYTES) return `분석 데이터가 너무 큽니다(${size}바이트).`;
  if (!body.payload.current) return "current 지표가 필요합니다.";
  return null;
}

// "current.adsets[0].link_ctr" 같은 경로를 입력 JSON에서 찾는다.
export function lookup(obj, path) {
  if (typeof path !== "string" || !path) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function text(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// 모델 출력 → 검증된 결과. 형식이 맞지 않으면 null(= AI 분석 실패로 표시).
export function parseOutput(raw, payload) {
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const status = text(data.status, 300), action = text(data.action, 160);
  if (!status || !action) return null;
  const evidence = [], dropped = [];
  for (const e of Array.isArray(data.evidence) ? data.evidence.slice(0, 6) : []) {
    const metric = text(e && e.metric, 120), value = lookup(payload, metric);
    if (value === undefined || value === null || typeof value === "object") { dropped.push(metric || "(빈 경로)"); continue; }
    evidence.push({ metric, actual: value, value: text(e.value, 60), meaning: text(e.meaning, 160) });
  }
  if (!evidence.length) return null; // 실제 지표 근거가 하나도 없으면 분석으로 인정하지 않는다
  const t = data.test && typeof data.test === "object" ? data.test : {};
  return {
    status, action, evidence, dropped,
    hypothesis: text(data.hypothesis, 300),
    test: {
      method: text(t.method, 300), duration: text(t.duration, 60),
      compare_metrics: (Array.isArray(t.compare_metrics) ? t.compare_metrics : []).map((x) => text(x, 80)).filter(Boolean).slice(0, 5),
    },
    comparison: text(data.comparison, 300),
    cautions: (Array.isArray(data.cautions) ? data.cautions : []).map((x) => text(x, 200)).filter(Boolean).slice(0, 4),
  };
}
