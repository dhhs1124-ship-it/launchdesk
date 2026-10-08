// 쇼핑몰 삭제 시 AI 점검 기준(tool_records business_profile)도 함께 지운다 — 기존 Meta 자동 기록 삭제 트리거
// (20260924170000_store_delete_meta_auto_adlog.sql)와 같은 방식인지 SQL 문장으로 확인한다. 실행: node --test tests/business-profile-store-delete.test.mjs
// 실제 동작(삭제 범위)은 원격 DB에 적용하지 않고 로컬 PGlite로 따로 확인했다(검토 ZIP의 검증 결과).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const FILE = new URL("../supabase/migrations/20261008120000_store_delete_business_profile.sql", import.meta.url);

test("쇼핑몰 삭제 트리거: 그 쇼핑몰 소유자의 AI 점검 기준만 같은 트랜잭션에서 지운다", () => {
  const code = fs.readFileSync(FILE, "utf8").replace(/--.*$/gm, "");
  assert.match(code, /create trigger stores_delete_business_profile\s+after delete on public\.stores\s+for each row\s+execute function public\.delete_business_profile_for_store\(\);/);
  assert.equal((code.match(/create trigger/g) || []).length, 1);
  assert.equal((code.match(/delete from/g) || []).length, 1, "지우는 문장은 하나뿐");
  assert.match(code, /delete from public\.tool_records\s+where user_id = old\.user_id\s+and tool_type = 'business_profile'\s+and \(data ->> 'store_id'\) = old\.id::text;/);
  assert.doesNotMatch(code, /'ad_log'|data \?/, "광고 기록 · 실행 기록은 건드리지 않고, json · jsonb 모두 되는 ->>만 쓴다");
  assert.match(code, /security definer\s+set search_path = ''/);
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(code, new RegExp(`revoke all on function public\\.delete_business_profile_for_store\\(\\) from ${role};`));
  }
});
