// AI 비용 예약 SQL(supabase/migrations/20261007090000_ai_budget_reservations.sql · 20261007100000_ai_budget_run_reservations.sql) 로컬 검사 — 원격 DB를 쓰지 않는다.
// PGlite(브라우저 · Node용 Postgres WASM)에 최소 테이블(auth.users · stores · ai_weekly_reviews · ai_weekly_verifications)을 만들고
// 마이그레이션을 순서대로 그대로 실행한 뒤 예약 · 한도 · 정산 · 미확인 · 동시 예약(같은 잠금 경로) · 주간 실행 예약 이중 집계 방지를 확인한다.
// 사용: node scripts/verify-budget-sql.mjs <pglite가 설치된 폴더>   (예: npm i @electric-sql/pglite 를 임시 폴더에)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const dir = process.argv[2];
if (!dir) { console.error("사용: node scripts/verify-budget-sql.mjs <pglite 설치 폴더>"); process.exit(1); }
const { PGlite } = await import(pathToFileURL(createRequire(path.join(path.resolve(dir), "x.js")).resolve("@electric-sql/pglite")).href);
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create table public.stores (id bigint primary key);
  create table public.ai_weekly_reviews (id bigint generated always as identity primary key, cost_usd numeric(10,4) not null default 0, updated_at timestamptz not null default now());
  create table public.ai_weekly_verifications (id bigint generated always as identity primary key, cost_usd numeric(10,4) not null default 0, created_at timestamptz not null default now());
  insert into auth.users values ('00000000-0000-0000-0000-000000000001'); insert into public.stores values (4);
  insert into public.ai_weekly_reviews (cost_usd) values (0.10);
  insert into public.ai_weekly_verifications (cost_usd) values (0.2122);  -- 예약 이전 검증 비용
`);
await db.exec(fs.readFileSync(new URL("../supabase/migrations/20261007090000_ai_budget_reservations.sql", import.meta.url), "utf8"));
await db.exec(fs.readFileSync(new URL("../supabase/migrations/20261007100000_ai_budget_run_reservations.sql", import.meta.url), "utf8"));
const U = "00000000-0000-0000-0000-000000000001";
const spent = async () => Number((await db.query("select public.ai_month_spent() as v")).rows[0].v);
const reserve = async (amt, limit) => (await db.query("select * from public.ai_budget_reserve($1, 4, 'verify', 'claude-sonnet-5-5', $2, $3)", [U, amt, limit])).rows[0];
const settle = async (id, actual, known) => (await db.query("select public.ai_budget_settle($1, $2, $3, 'test') as v", [id, actual, known])).rows[0].v;
const checks = [];
const ok = (name, fn) => checks.push([name, fn]);

ok("시작 합계 = 주간 0.10 + 예약 이전 검증 0.2122", async () => assert.equal(await spent(), 0.3122));
ok("한도 안 예약 → 예약 금액이 합계에 포함", async () => { const r = await reserve(0.40, 1); assert.equal(r.ok, true); assert.equal(await spent(), 0.7122); globalThis.r1 = r.reservation_id; });
ok("한도 초과 예약은 거절 · 행 없음", async () => { const r = await reserve(0.40, 1); assert.equal(r.ok, false); assert.equal(r.reservation_id, null); assert.equal(await spent(), 0.7122); });
ok("정산(사용량 확인) → 실제 비용으로", async () => { assert.equal(await settle(globalThis.r1, 0.034, true), true); assert.equal(await spent(), 0.3462); });
ok("이미 정산된 예약은 다시 바뀌지 않음", async () => { assert.equal(await settle(globalThis.r1, 0, true), false); assert.equal(await spent(), 0.3462); });
ok("사용량 미확인 → 예약 금액 유지(0으로 풀지 않음)", async () => { const r = await reserve(0.12, 1); assert.equal(await settle(r.reservation_id, 0, false), true); assert.equal(await spent(), 0.4662);
  assert.equal((await db.query("select status, actual_usd from public.ai_budget_reservations where id = $1", [r.reservation_id])).rows[0].status, "unsettled"); globalThis.r2 = r.reservation_id; });
ok("미확인 예약은 수동 정산 가능", async () => { assert.equal(await settle(globalThis.r2, 0.05, true), true); assert.equal(await spent(), 0.3962); });
ok("정산 안 된(함수 강제 종료) 예약은 예약 금액으로 계속 집계", async () => { await reserve(0.2, 1); assert.equal(await spent(), 0.5962); });
ok("예약에 연결된 검증 기록의 비용은 중복 집계하지 않음", async () => { await db.query("insert into public.ai_weekly_verifications (cost_usd, reservation_id) values (0.034, $1)", [globalThis.r1]); assert.equal(await spent(), 0.5962); });
ok("연속 예약 두 건이 함께 한도를 넘지 않음(같은 잠금 경로)", async () => { const a = await reserve(0.3, 1), b = await reserve(0.3, 1); assert.equal(a.ok, true); assert.equal(b.ok, false); });
ok("같은 대상(ref) 하루 시도 상한 — 상한에 닿으면 reason=attempts · 예약 없음", async () => {
  const q = (ref) => db.query("select * from public.ai_budget_reserve($1, 4, 'verify_video', 'claude-sonnet-5-5', 0.01, 100, $2, 2)", [U, ref]).then((r) => r.rows[0]);
  assert.equal((await q("h1")).ok, true); assert.equal((await q("h1")).ok, true);
  const third = await q("h1"); assert.equal(third.ok, false); assert.equal(third.reason, "attempts");
  assert.equal((await q("h2")).ok, true, "다른 프레임 묶음은 별도"); });
ok("한도 초과 이유는 budget", async () => { const r = await reserve(1000, 1); assert.equal(r.reason, "budget"); });
ok("금액 0 · 음수 예약은 오류", async () => { await assert.rejects(reserve(0, 1)); });
ok("예약 금액은 소수 4자리 올림(내림하면 최악 비용보다 작아짐)", async () => {
  const r = await reserve(0.00001, 100); assert.equal(r.ok, true);
  assert.equal(Number((await db.query("select reserved_usd from public.ai_budget_reservations where id = $1", [r.reservation_id])).rows[0].reserved_usd), 0.0001); });
ok("anon · authenticated는 함수 실행 권한 없음", async () => {
  const r = (await db.query("select has_function_privilege('authenticated', 'public.ai_budget_reserve(uuid,bigint,text,text,numeric,numeric,text,integer)', 'execute') a, has_function_privilege('anon', 'public.ai_month_spent()', 'execute') b, has_function_privilege('service_role', 'public.ai_budget_settle(bigint,numeric,boolean,text)', 'execute') c")).rows[0];
  assert.deepEqual([r.a, r.b, r.c], [false, false, true]); });

// 주간 실행(run) 예약 — 20261007100000
const runReserve = async (amt, limit) => (await db.query("select * from public.ai_budget_reserve($1, 4, 'run', 'claude-sonnet-5-5', $2, $3, 'review:1')", [U, amt, limit])).rows[0];
ok("kind run 예약 허용 · 모르는 kind는 거절", async () => {
  const r = await runReserve(0.05, 100); assert.equal(r.ok, true); await settle(r.reservation_id, 0.01, true);
  await assert.rejects(db.query("select * from public.ai_budget_reserve($1, 4, 'other', 'm', 0.01, 100)", [U])); });
ok("예약 이전 주간 기록(reserved_cost_usd 0)은 cost_usd 전체를 그대로 센다", async () => {
  const base = await spent(); await db.query("insert into public.ai_weekly_reviews (cost_usd) values (0.07)"); assert.equal(await spent(), Math.round((base + 0.07) * 1e4) / 1e4); });
ok("주간 실행 정산 후 주간 기록에 같은 비용이 있어도 한 번만 센다", async () => {
  const base = await spent(), r = await runReserve(0.3, 100);
  assert.equal(await spent(), Math.round((base + 0.3) * 1e4) / 1e4, "예약 중엔 예약 금액");
  await settle(r.reservation_id, 0.04, true);
  await db.query("insert into public.ai_weekly_reviews (cost_usd, reserved_cost_usd) values (0.04, 0.04)");
  assert.equal(await spent(), Math.round((base + 0.04) * 1e4) / 1e4); });
ok("이어서 하기: 예약 이전 비용 + 예약 비용이 섞인 기록은 예약 이전 부분만 주간 기록으로", async () => {
  const base = await spent(), r = await runReserve(0.2, 100); await settle(r.reservation_id, 0.05, true);
  await db.query("insert into public.ai_weekly_reviews (cost_usd, reserved_cost_usd) values (0.08, 0.05)"); // 0.03은 예약 이전 실행
  assert.equal(await spent(), Math.round((base + 0.08) * 1e4) / 1e4); });
ok("주간 기록 저장(finish) 실패 — 기록이 없어도 비용은 예약에 남는다", async () => {
  const base = await spent(), r = await runReserve(0.2, 100); await settle(r.reservation_id, 0.06, true);
  assert.equal(await spent(), Math.round((base + 0.06) * 1e4) / 1e4); });
ok("정산 실패(강제 종료) — 예약 금액으로 집계하고 주간 기록의 같은 비용은 빼서 이중 집계 없음", async () => {
  const base = await spent(); await runReserve(0.25, 100);
  await db.query("insert into public.ai_weekly_reviews (cost_usd, reserved_cost_usd) values (0.05, 0.05)");
  assert.equal(await spent(), Math.round((base + 0.25) * 1e4) / 1e4); });
ok("주간 실행 예약도 운영자 검증과 같은 잠금 · 한도 — 합쳐서 넘지 않음", async () => {
  const lim = (await spent()) + 0.5; const a = await runReserve(0.3, lim), b = await reserve(0.3, lim);
  assert.equal(a.ok, true); assert.equal(b.ok, false); assert.equal(b.reason, "budget"); });
ok("reserved_cost_usd 음수는 거절", async () => { await assert.rejects(db.query("insert into public.ai_weekly_reviews (cost_usd, reserved_cost_usd) values (0, -1)")); });

// 원격 확인 쿼리(supabase/verify/ai_budget_reservations_readonly.sql) — 미적용 · 090000만 · 둘 다 적용 세 상태에서
// 항상 실행 블록은 오류가 없고, 조건부 블록은 객체가 있을 때만 돈다. 블록 2 값이 상태와 맞는지 본다.
const RO = fs.readFileSync(new URL("../supabase/verify/ai_budget_reservations_readonly.sql", import.meta.url), "utf8");
const blocks = Object.fromEntries(RO.split(/^-- \[블록 /m).slice(1).map((b) => [b.slice(0, b.indexOf("]")), "-- [블록 " + b]));
const freshDb = async (migs) => {
  const d = new PGlite();
  await d.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.stores (id bigint primary key);
    create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text);
    create table public.ai_weekly_reviews (id bigint generated always as identity primary key, user_id uuid, quota_week date, status text, retry_count int not null default 0,
      usage jsonb not null default '{}'::jsonb, cost_usd numeric(10,4) not null default 0, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.ai_weekly_verifications (id bigint generated always as identity primary key, user_id uuid, cost_usd numeric(10,4) not null default 0, created_at timestamptz not null default now());
    insert into supabase_migrations.schema_migrations values ('20261006100000', 'ai_weekly_reviews'), ('20261006120000', 'ai_weekly_verifications');
    insert into public.ai_weekly_reviews (status, usage, cost_usd, error) values ('completed', '{"calls":2}', 0.07, null), ('failed', '{"calls":1,"unconfirmed_calls":1}', 0.3, '실패');
  `);
  for (const m of migs) {
    await d.exec(fs.readFileSync(new URL("../supabase/migrations/" + m + ".sql", import.meta.url), "utf8"));
    await d.query("insert into supabase_migrations.schema_migrations values ($1, $2)", [m.slice(0, 14), m.slice(15)]);
  }
  return d;
};
const runBlock = async (d, k) => { const r = await d.exec(blocks[k]); return r[r.length - 1].rows; };
const M1 = "20261007090000_ai_budget_reservations", M2 = "20261007100000_ai_budget_run_reservations";
ok("확인 쿼리: 읽기 전용(SELECT만) · 개인정보 컬럼을 고르지 않음", async () => {
  const code = RO.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
  assert.doesNotMatch(code, /\b(insert|update|delete|create|alter|drop|grant|revoke|truncate|perform|begin|commit|set)\b/);
  assert.doesNotMatch(code, /select[^;]*\b(ref|note|result|batches|period)\b(?![_a-z])/, "자유 텍스트 · 결과 본문 제외");
  assert.doesNotMatch(code.replace(/count\(distinct user_id\)/g, ""), /\buser_id\b|\bstore_id\b/, "사용자 · 쇼핑몰 식별자는 건수만");
  assert.deepEqual(Object.keys(blocks).sort(), ["1", "2", "3", "4", "5", "6", "7", "8", "8-1", "8-2", "9"]); });
for (const [label, migs] of [["미적용", []], ["090000만", [M1]], ["둘 다 적용", [M1, M2]]]) {
  ok("확인 쿼리 · " + label + ": 항상 실행 블록(1~5 · 8 · 8-1)은 오류 없음 · 블록 2가 상태와 일치 · 조건부 블록은 객체가 있을 때만", async () => {
    const d = await freshDb(migs);
    for (const k of ["1", "3", "4", "5", "8", "8-1"]) await runBlock(d, k);
    const mig = (await runBlock(d, "1")).map((r) => r.version);
    assert.equal(mig.includes("20261007090000"), migs.includes(M1)); assert.equal(mig.includes("20261007100000"), migs.includes(M2));
    const f = (await runBlock(d, "2"))[0], one = migs.length >= 1, two = migs.length === 2;
    assert.deepEqual([f.reservations_table, f.verifications_reservation_col, f.fn_month_spent, f.fn_budget_reserve, f.fn_budget_settle], [one, one, one, one, one]);
    assert.deepEqual([f.reviews_reserved_cost_col, f.run_kind_allowed, f.month_spent_excludes_reserved], [two, two, two]);
    const fns = await runBlock(d, "5");
    assert.equal(fns.length, one ? 3 : 0);
    if (one) assert.ok(fns.every((r) => r.security_definer && !r.anon_exec && !r.authenticated_exec && r.service_role_exec));
    const priv = (await runBlock(d, "4")).filter((r) => r.item === "table_select_privilege");
    if (one) assert.deepEqual(priv.map((r) => r.definition), ["false", "false", "true"]); else assert.equal(priv.length, 0);
    for (const k of ["6", "7", "9"]) { if (one) await runBlock(d, k); else await assert.rejects(runBlock(d, k)); }
    if (two) assert.equal((await runBlock(d, "8-2"))[0].counted_in_month_from_reviews !== undefined, true); else await assert.rejects(runBlock(d, "8-2"));
    assert.equal((await runBlock(d, "8"))[0].has_error !== undefined, true);
    await d.close(); });
}

let failed = 0;
for (const [name, fn] of checks) { try { await fn(); console.log("통과 · " + name); } catch (e) { failed++; console.log("실패 · " + name + " — " + e.message); } }
console.log(JSON.stringify({ checks: checks.length, failed, remote_db: false }));
process.exit(failed ? 1 : 0);
