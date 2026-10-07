# 원격에 적용됐지만 마이그레이션 기록이 없는 SQL (보존용 — CLI 적용 대상 아님)

이 폴더는 `supabase/migrations/` 밖이라 Supabase CLI(`db push` · `migration` 명령)가 읽지 않는다. 원격 스키마와 저장소를 맞추기 위한 **기록 보존**이며, 여기 파일을 다시 실행하지 않는다.

| 파일 | 원격 객체 확인 | 원격 기록(schema_migrations) |
|---|---|---|
| `20260929164500_launchroas_oauth_return_origin.sql` | 미확인(간접 근거만 — 배포된 OAuth 함수가 `oauth_states.return_origin`을 씀) | 없음 |
| `20261006100000_ai_weekly_reviews.sql` | 확인 | 없음 |
| `20261006120000_ai_weekly_verifications.sql` | 확인 | 없음 |
| `20261007090000_ai_budget_reservations.sql` | 확인(SQL 편집기로 적용 · 확인 SQL 블록 2 · 4 · 4-1 · 5) | 없음 |
| `20261007100000_ai_budget_run_reservations.sql` | 확인(SQL 편집기로 적용 · 블록 2) | 없음 |

- **`db push` 금지 유지** — 원격 마이그레이션 기록이 비어 있어(예전 마이그레이션도 기록 없음) `db push`가 이미 적용된 마이그레이션을 다시 실행하려 한다.
- 기록 정리(별도 결정 · 원격 쓰기라 승인 필요): 읽기 전용으로 객체 확인 → 확인된 버전만 `migration repair --status applied` → `db push --dry-run` 대상 0 확인 → 그 뒤 이 파일들을 `supabase/migrations/`로 옮길지 결정.
- 읽기 전용 확인 SQL은 마이그레이션이 아니다: `supabase/verify/ai_budget_reservations_readonly.sql`.
