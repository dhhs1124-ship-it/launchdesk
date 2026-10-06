// 공통 분석 기준(docs/ai/ad-review-policy.md) + 의류 사례(docs/ai/apparel-ad-playbook.md · research/*)를 서버 지시문에 연결하는 코드.
// 시크릿 AI_POLICY_VERSION이 POLICY_VERSION과 같을 때만 켜진다 — 기본은 꺼짐(지금 배포된 지시문 그대로). 이 파일을 저장 · 배포했다고 적용된 것이 아니다.
// 원칙
// - 사례는 '실제로 관찰한 것(observed)'과 '일반 전략 가설(hypothesis)'을 구분해 전달한다. 성과는 모두 미확인.
// - 영상 사례는 시간대별 프레임 확인이며 음성 · 프레임 사이 움직임 · 편집은 미확인. 게재 위치별 제목 노출 규칙 · 랜딩 페이지 조회 차이 원인 등 미확인 규칙은 확정 기준으로 넣지 않는다.
// - 광고마다 관련 사례 최대 2개만 서버가 규칙으로 고른다(AI가 고르지 않음). 쓴 사례 ID는 결과에 남긴다.

export const POLICY_VERSION = "policy-2026-10-06.3";
export const PLAYBOOK_VERSION = "apparel-2026-10-06.3";

// 정책 MD 1~4장의 압축본. 기존 SYSTEM_PROMPT와 충돌하는 줄은 policySystemPrompt()가 바꿔 끼운다(같은 지시문 안에 모순을 남기지 않음).
export const POLICY_ADDENDUM = `
[분석 기준 ${POLICY_VERSION}]
- 순서: 데이터 신뢰성 → 목적 · 귀속 · 비교 범위 → 성과 변화 → 실제 소재 → 우선 행동 → 구체적 변경안 → 테스트.
- 데이터 문제는 그 문제가 막는 범위만 보류한다(hold_scope). 예: 랜딩 페이지 조회가 링크 클릭보다 많으면 랜딩 · 구매 전환 구간 해석과 예산 판단만 보류하고, 확인한 문구 · 이미지 · 영상 프레임에 근거한 선택적 테스트는 제안할 수 있다(recommendation.scope="creative_test").
- 세 가지를 따로 쓴다: ① 전주 대비 변화 ② 목표 달성 여부(사용자 목표가 입력에 있을 때만) ③ 손익 판단 가능 여부(최신 연결 마진과, 귀속 구매가 그 상품이라는 근거가 있을 때만). 전주보다 나빠지지 않았다는 이유만으로 "유지"라고 하지 않는다. 목표 · 손익 근거가 없으면 verdict는 "판단 보류"(hold_scope에 "목표·손익 근거 없음")로 두고 headline에는 확인한 성과 범위만 쓴다.
- verdict: "유지"(목표 또는 손익 근거로 지금 상태를 유지할 이유가 있음) / "추가 확인"(판단을 막는 데이터 문제 — 확인할 것을 쓰고, creative_test 외 변경안 · 예산은 내지 않음) / "개선 필요"(근거 있는 저하와 원인 가설) / "판단 보류"(신규 · 비교 기간 부족 · 목표 지표 미측정 · 목표 · 손익 근거 없음).
- 표본 크기에는 고정 기준을 쓰지 않는다. 노출 · 클릭 · 구매 실제 건수를 그대로 쓰고, 건수가 적으면 "우연한 변동일 수 있음"을 limits에 적는다. 건수만으로 판단을 막거나 확정하지 않는다.
- 관찰 사실(입력에 보이는 것)과 원인 가설(성과 저하를 설명하는 추정)을 구분한다. 가설에는 확인 방법을 붙인다.
- 같은 광고 세트에 새 광고를 추가하는 비교는 A/B 테스트가 아니다 — Meta가 노출을 성과에 따라 나눠 배분하므로 두 광고의 노출 · 대상이 같지 않다. test.method에 "동시 집행 비교(균등 배분 아님)"와 이 한계를 쓰고, 전후 비교는 기간 차이(계절 · 행사 · 경쟁)의 영향을 배제하지 못한다고 쓴다.
- 예산 증감은 광고 목표 · 최신 손익 근거 · 사용자 제약이 모두 있을 때만 "검토"로 쓴다. 하나라도 없으면 budget_note는 null.
- 링크 클릭은 고정 1일 클릭 기여 지표라 구매 귀속 기간과 다르다. 랜딩 페이지 조회와 링크 클릭이 다른 이유를 단정하지 않는다. 제목의 게재 위치별 노출 규칙은 확인되지 않았다.
- <reference_cases>는 다른 쇼핑몰 광고를 관찰한 참고 자료다. 성과가 공개되지 않아 성공 사례가 아니다. 전략 유형으로만 참고하고 문구를 옮기지 않는다. 사용자 상품의 확인된 사실이 없으면 그 유형을 제안하지 않는다. 영상 사례는 시간대별 프레임만 봤다 — 음성 · 프레임 사이 움직임 · 편집은 확인하지 않았다. 근거로 쓴 사례 ID는 recommendation.basis에 적는다.
- 출력에 "hold_scope":["보류한 범위"]를 추가하고, recommendation에 "scope":"creative_test|change"를 쓴다.`;

// 기존 SYSTEM_PROMPT에서 정책과 충돌하는 줄 — 정책을 켜면 바꿔 끼운다
export const PROMPT_REPLACEMENTS = [
  ["- 표본이 작으면(예: 노출 수천 회 미만, 구매 3건 미만) verdict를 \"판단 보류\"로 두고 recommendation은 null로 둔다. 모든 광고에 억지로 개선안을 만들지 마라.",
   "- 표본 크기에 고정 기준을 쓰지 마라. 실제 건수를 쓰고, 건수가 적으면 limits에 우연한 변동 가능성을 적는다. 모든 광고에 억지로 개선안을 만들지 마라."],
  ["- verdict가 \"유지\"이고 문구나 이미지를 봤다면, 현재 광고는 그대로 두고 새 광고(같은 광고 세트)로 비교할 테스트 후보 1개를 recommendation에 쓴다.",
   "- verdict가 \"유지\" · \"판단 보류\" · \"추가 확인\"이어도 문구나 이미지를 봤다면, 현재 광고는 그대로 두고 새 광고(같은 광고 세트 · 동시 집행 비교, 균등 배분 아님)로 비교할 선택적 테스트 후보 1개를 recommendation(scope=\"creative_test\")에 쓸 수 있다."],
  ["- 영상은 썸네일만 봤다.", "- 영상은 썸네일만 받았다(시간대별 프레임 분석은 이 점검에 없음)."],
];
export function policySystemPrompt(base) {
  let out = base;
  for (const [from, to] of PROMPT_REPLACEMENTS) {
    if (!out.includes(from)) throw new Error("정책 지시문 교체 대상 문장을 찾지 못함: " + from.slice(0, 40));
    out = out.replace(from, to);
  }
  return out + POLICY_ADDENDUM;
}

// 사례 — facts는 짧은 관찰 요약(원문 복제 아님). signal: hook(첫 반응 · 클릭률) / conversion(클릭 뒤 구매) / info(상품 정보 · 사이즈)
export const CASES = [
  { id: "V-3441855369308050", kind: "observed", evidence: "video_frames", format: "video", type: "A 한 벌 여러 연출", signal: ["hook"], needs: ["연출별 착용 영상"],
    facts: ["0~1초 착용 장면 + '다 같은 옷' 반전 문구", "1.5~4.5초 잠금 · 풀림 대비", "22초 색상 3가지를 한 화면에"], limits: "시간대별 프레임 확인 · 음성 미확인 · 프레임 사이 움직임 · 편집 미확인 · 성과 미확인" },
  { id: "V-28300268669664652", kind: "observed", evidence: "video_frames", format: "video", type: "B 문제 제기 + 기능 확대 장면", signal: ["hook", "info"], needs: ["기능을 보여 줄 확대 장면", "사이즈 · 기장 옵션"],
    facts: ["0초 착용 · 0.5초 시청자 호명 스티커", "10~15초 프레임에 밑단 스냅을 잠근 확대 장면", "18초 기장 · 사이즈 옵션 카드"], limits: "시간대별 프레임 확인 · 음성 미확인 · 프레임 사이 움직임 · 편집 미확인 · 성과 미확인" },
  { id: "V-1615380123633564", kind: "observed", evidence: "video_frames", format: "video", type: "C 제작 · 핏 근거", signal: ["conversion", "info"], needs: ["실제 제작 과정 사실(수정 부위 · 횟수)"],
    facts: ["0초 상품 실물(책상 위) · 2.5초 수정 횟수 숫자 훅", "확인한 프레임 중 최초 착용 50.5초", "본문과 영상 자막의 숫자가 서로 다름 — 수치는 근거 확인 필요"], limits: "시간대별 프레임 확인 · 음성 미확인 · 프레임 사이 움직임 · 편집 미확인 · 성과 미확인" },
  { id: "V-1546230803447686", kind: "observed", evidence: "video_frames", format: "video", type: "A+C 연출 · 핏 설명(실물 중심)", signal: ["conversion"], needs: ["연출 방법", "색상별 실물"],
    facts: ["0초 5가지 색 실물 + 상품명 자막", "확인한 프레임 중 최초 착용 10.5초(작은 화면 삽입)", "81초 길이 · 영상 안 가격 정보 없음"], limits: "시간대별 프레임 확인 · 음성 미확인 · 프레임 사이 움직임 · 편집 미확인 · 성과 미확인" },
  { id: "V-3277926962401965", kind: "observed", evidence: "video_frames", format: "video", type: "B 문제 제기 + 코디 3가지", signal: ["hook", "info"], needs: ["코디 사진 · 모델 체형 정보(사용 동의)"],
    facts: ["0초 일교차 문제 제기 큰 자막", "LOOK마다 모델 키 · 몸무게 라벨", "끝 화면 CTA가 유튜브 유도(구매 목표와 다름)"], limits: "시간대별 프레임 확인 · 음성 미확인 · 프레임 사이 움직임 · 편집 미확인 · 성과 미확인" },
  { id: "V-874188032295861", kind: "observed", evidence: "video_frames", format: "video", type: "G 크리에이터 언박싱", signal: ["hook"], needs: ["크리에이터 촬영물 사용 권한 · 협업 표시"],
    facts: ["0 · 1 · 2초 프레임에 서로 다른 착장 3개", "프레임 순서: 상자를 든 장면 → LOOK별 옷을 펼친 장면 → 착용"], limits: "시간대별 프레임 확인 · 음성 미확인 · 프레임 사이 움직임 · 편집 미확인 · 성과 미확인" },
  { id: "I-1231840489132470", kind: "observed", evidence: "image", format: "carousel", type: "F 카테고리 큐레이션 + 가격", signal: ["conversion", "info"], needs: ["상품별 착용 사진 · 가격"],
    facts: ["표지 1장 + 카드 8장", "카드마다 전신 + 허리 아래 확대 2분할", "카드마다 상품명 · 가격 표시"], limits: "이미지 확인 · 성과 미확인" },
  { id: "I-1082450184378019", kind: "observed", evidence: "image", format: "carousel", type: "J 체형 커버 정보(주의 유형)", signal: ["info"], needs: ["실제 핏 구조 사실"],
    facts: ["카드마다 커버 포인트 짧은 설명 + 쿠폰 적용가", "표지에 체중 수치 제목 — 신체 관련 표현은 제안하지 않음"], limits: "이미지 확인 · 성과 미확인" },
  { id: "I-1707641646996113", kind: "observed", evidence: "image", format: "carousel", type: "A+C 한 벌 여러 착장 + 디테일", signal: ["hook", "info"], needs: ["같은 상품의 여러 착장 사진 · 디테일 확대"],
    facts: ["같은 데님을 여러 착장 · 장소로", "상품 단독 컷 1장 · 포켓 확대 1장"], limits: "이미지 확인 · 성과 미확인" },
  { id: "I-1106019735164514", kind: "observed", evidence: "image", format: "single_image", type: "D 사회적 증거 문구", signal: ["hook"], needs: ["근거가 있는 수치(판매량 · 후기)"],
    facts: ["이미지 문구에 사회적 증거 주장, 본문은 댓글형 훅 — 같은 광고에서 다른 전략"], limits: "이미지 확인 · 수치 근거 미확인 · 성과 미확인" },
  { id: "H-first3s", kind: "hypothesis", format: "video", type: "첫 3초에 상품 · 핵심 주장", signal: ["hook"], needs: [],
    facts: ["일반 가설: 관찰한 영상 8개 모두 0초에 상품이 보였다 — 성과와의 관계는 미확인"], limits: "가설" },
  { id: "H-price-in-creative", kind: "hypothesis", format: "carousel", type: "카드에 가격 표시", signal: ["conversion"], needs: ["확정된 가격"],
    facts: ["일반 가설: 가격이 이미지 안에만 있는 광고가 있었다(#7 · #26) — 효과 미확인"], limits: "가설" },
];

const FORMAT_GROUP = { video: "video", carousel: "carousel", dynamic: "carousel", single_image: "single_image" };

// 규칙 신호 — AI 호출 전에 지표만으로(판정 아님)
export function caseSignals(ad, peers) {
  const m = ad.current || {}, p = peers[(ad.objective || "?") + "|" + (ad.optimization_goal || "?")] || {}, out = [];
  if (m.link_ctr_pct != null && p.median_link_ctr_pct != null && m.link_ctr_pct < p.median_link_ctr_pct * 0.8) out.push("hook");
  if ((m.link_clicks || 0) >= 100 && m.purchases != null && p.median_purchase_rate_pct != null && m.purchase_rate_pct != null && m.purchase_rate_pct < p.median_purchase_rate_pct * 0.8) out.push("conversion");
  return out;
}

// 관련 사례 최대 2개(관찰 우선, 같은 형식) — 신호가 없으면 고르지 않는다
export function selectCases(ad, peers, { max = 2 } = {}) {
  const sig = caseSignals(ad, peers), fmt = FORMAT_GROUP[(ad.creative || {}).format];
  if (!sig.length || !fmt) return [];
  const score = (c) => (c.format === fmt ? 2 : 0) + (c.kind === "observed" ? 1 : 0) + c.signal.filter((s) => sig.includes(s)).length * 2;
  return CASES.filter((c) => c.signal.some((s) => sig.includes(s)) && (c.format === fmt || (fmt !== "video" && c.format !== "video")))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, max).map((c) => c.id);
}

export function casesBlock(adId, ids) {
  const list = ids.map((id) => CASES.find((c) => c.id === id)).filter(Boolean)
    .map((c) => ({ id: c.id, kind: c.kind === "observed" ? "관찰 사례" : "일반 가설", evidence: c.evidence || null, type: c.type, facts: c.facts, needs: c.needs, limits: c.limits }));
  return { type: "text", text: `<reference_cases ad_id="${adId}">\n${JSON.stringify(list)}\n</reference_cases>` };
}

export function policyOn(env) { return env("AI_POLICY_VERSION") === POLICY_VERSION; }
