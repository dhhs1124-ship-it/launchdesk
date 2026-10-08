-- ============================================================================
-- 운영자 verify 1회(AI 컨설턴트 consult-2026-10-08.3) — 결과 확인(읽기 전용)
-- 파일: supabase/verify/ai_consult_verify_result_readonly.sql
-- ============================================================================
-- 무엇: 반영 뒤 유료 verify 1회(label = 'release-2026-10-08-consult')가 ① 새 지시문으로 실제 모델 답에 조건 표시(requires)를
--   받았는지 ② 주간 실행과 같은 최종 처리(guardResults)를 따로 기록했는지 ③ 예약 비용이 정산됐는지 본다.
-- 안전: SELECT만 한다. 광고 이름 · 문구 · 분석 내용은 출력하지 않는다(광고 ID · 상태 · 개수 · 비용만).
-- 실행: Supabase SQL Editor에서 [블록]마다 따로 실행.


-- [블록 1] 기록 — 기대: 1행 · status completed · model claude-sonnet-5-5 · effort medium · truncated false · failed_ads 0 ·
--   final_basis가 'guardResults consult-2026-10-08.3'로 시작 · consult_version consult-2026-10-08.3
--   variant는 운영 시크릿 AI_POLICY_VERSION 상태를 그대로 보여 준다(policy_on · policy_off) — 시크릿 값을 읽지 않고 확인하는 방법
select id, label, effort, model, status, cost_usd, duration_ms,
       result ->> 'variant' as variant,
       result ->> 'truncated' as truncated,
       jsonb_array_length(coalesce(result -> 'failed_ads', '[]'::jsonb)) as failed_ads,
       left(result ->> 'final_basis', 34) as final_basis,
       result -> 'consult' ->> 'version' as consult_version,
       jsonb_typeof(result -> 'consult' -> 'profile') = 'object' as had_profile,
       jsonb_array_length(coalesce(result -> 'consult' -> 'actions', '[]'::jsonb)) as actions
  from public.ai_weekly_verifications
 where label = 'release-2026-10-08-consult'
 order by id desc
 limit 3;


-- [블록 2] 광고별 원본 · 최종 — 기대: requires_present = true(모델이 조건 표시를 냈다).
--   점검 기준에 '예산 늘리기'를 넣었다면: 원본 조건(next_action_budget · recommendation_budget)이 increase인 광고는
--   final_held_reason = constraint · final_recommendation_null = true. 조건을 못 낸 광고는 unverifiable(보류). 진행 중 실행이 있으면 in_progress.
--   점검 기준이 없으면 제약 보류는 없다(final_held_reason null — 진행 중 실행이 없을 때).
select v.id, e.key as ad_id,
       jsonb_typeof(e.value -> 'requires') = 'object' as requires_present,
       e.value -> 'requires' -> 'next_action' ->> 'budget' as next_action_budget,
       e.value -> 'requires' -> 'recommendation' ->> 'budget' as recommendation_budget,
       f.value -> 'consult_held' ->> 'reason' as final_held_reason,
       coalesce(jsonb_typeof(f.value -> 'recommendation'), 'null') = 'null' as final_recommendation_null
  from public.ai_weekly_verifications v
  cross join lateral jsonb_each(v.result -> 'ads_by_id') e
  left join lateral jsonb_each(v.result -> 'ads_by_id_final') f on f.key = e.key
 where v.label = 'release-2026-10-08-consult'
 order by v.id desc, e.key;


-- [블록 3] 예약 정산 — 기대: kind verify · status settled · actual_usd = 블록 1의 cost_usd · reserved_usd ≤ 요청한 budget_usd(0.30)
select r.id, r.kind, r.model, r.reserved_usd, r.actual_usd, r.status, r.settled_at is not null as settled
  from public.ai_budget_reservations r
 where r.id in (select reservation_id from public.ai_weekly_verifications where label = 'release-2026-10-08-consult')
 order by r.id desc;
