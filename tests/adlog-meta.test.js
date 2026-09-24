/* 광고 기록 — Meta 하루 합계 자동 기록(adlog-meta.js) 값 검증 · meta-insights 구매금액 원본 규칙.
   실행: node --test tests/adlog-meta.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AM = require('../adlog-meta.js');

const NOW = Date.parse('2026-09-24T10:00:00+09:00');
function payload(sel, extra){
  return Object.assign({
    ok: true,
    account: { id: 'act_111', name: '광고계정', currency: 'KRW', timezone_name: 'Asia/Seoul' },
    today: {}, month: {},
    selected: Object.assign({ spend: 30000, purchase_count: 3, purchase_value: 90000, purchase_value_observed: true, purchase_basis: 'offsite_conversion.fb_pixel_purchase', roas: 3 }, sel || {}),
    queried_range: { selected: { since: '2026-09-23', until: '2026-09-23' } }
  }, extra || {});
}

test('계정 전체 하루 합계 → 광고 기록 한 건: 날짜는 조회 범위(광고계정 시간대), 키는 쇼핑몰|광고계정|날짜', () => {
  const r = AM.buildMetaAdlogRecord('s1', payload(), NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.record, {
    id: NOW, source: 'meta_auto', meta_auto_key: 's1|act_111|2026-09-23', store_id: 's1',
    date: '2026-09-23', name: 'Meta 캠페인 전체 합계', channel: '메타',
    spend: 30000, revenue: 90000, purchases: 3, currency: 'KRW', fetched_at: new Date(NOW).toISOString()
  });
});

test('구매금액 항목이 없으면 매출 null(화면 "—"), 실제 0이면 0 — ROAS로 매출을 역산하지 않는다', () => {
  const missing = AM.buildMetaAdlogRecord('s1', payload({ purchase_value: 0, purchase_value_observed: false, purchase_basis: null, purchase_count: 0, roas: 5 }), NOW);
  assert.equal(missing.record.revenue, null);
  assert.equal(missing.record.purchases, null);
  const zero = AM.buildMetaAdlogRecord('s1', payload({ purchase_value: 0, purchase_value_observed: true, purchase_count: 0, roas: 0 }), NOW);
  assert.equal(zero.record.revenue, 0);
  assert.equal(zero.record.purchases, 0);
  // roas가 있어도 매출은 구매금액 원본만 쓴다
  const src = fs.readFileSync(path.join(__dirname, '..', 'adlog-meta.js'), 'utf8');
  assert.doesNotMatch(src, /roas\s*\*|\*\s*[a-z.]*roas/i);
});

test('원화가 아닌 계정 · 구매금액 확인 정보가 없는 예전 응답 · 형식이 맞지 않는 응답은 기록하지 않는다', () => {
  const usd = AM.buildMetaAdlogRecord('s1', payload(null, { account: { id: 'act_1', currency: 'USD' } }), NOW);
  assert.equal(usd.ok, false);
  assert.match(usd.message, /USD라 원화 기준 광고 기록에 자동으로 넣지 않았어요/);
  const old = payload();
  delete old.selected.purchase_value_observed;
  assert.equal(AM.buildMetaAdlogRecord('s1', old, NOW).ok, false);
  assert.equal(AM.buildMetaAdlogRecord('s1', payload(null, { queried_range: {} }), NOW).ok, false);
  assert.equal(AM.buildMetaAdlogRecord(null, payload(), NOW).ok, false);
});

test('meta-insights: 계정 레벨(level=account) 합계이고, 구매금액은 action_values 원본이며 있었는지(purchase_value_observed)를 따로 알린다', () => {
  const fn = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'meta-insights', 'index.ts'), 'utf8');
  assert.match(fn, /url\.searchParams\.set\("level", "account"\);/);
  assert.match(fn, /const valueEntry = valueList\.find\(\(a\) => a\.action_type === basis\);/);
  assert.match(fn, /purchase_value_observed: value !== null,/);
  assert.match(fn, /return \{ purchase_count: 0, purchase_value: 0, purchase_basis: null, purchase_value_observed: false \};/);
  assert.match(fn, /purchase_value_observed,\s*\/\/ ROAS는/);
});

test('쇼핑몰 삭제 트리거: stores 행 삭제와 같은 트랜잭션에서 그 쇼핑몰 소유자의 Meta 자동 기록만 지운다', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260924170000_store_delete_meta_auto_adlog.sql'), 'utf8');
  const code = sql.replace(/--.*$/gm, '');
  // 쇼핑몰 행 삭제에만 걸린다(연결 해제는 stores 행을 지우지 않으므로 해당 없음)
  assert.match(code, /create trigger stores_delete_meta_auto_adlog\s+after delete on public\.stores\s+for each row\s+execute function public\.delete_meta_auto_adlog_for_store\(\);/);
  assert.equal((code.match(/create trigger/g) || []).length, 1);
  // 지우는 문장은 tool_records 하나뿐이고, 조건은 소유자 · ad_log · meta_auto · 같은 쇼핑몰
  assert.equal((code.match(/delete from/g) || []).length, 1);
  assert.match(code, /delete from public\.tool_records\s+where user_id = old\.user_id\s+and tool_type = 'ad_log'\s+and \(data ->> 'source'\) = 'meta_auto'\s+and \(data ->> 'store_id'\) = old\.id::text;/);
  assert.doesNotMatch(code, /data \?/, 'json · jsonb 모두 되는 ->>만 쓴다');
  // 보안 설정 · 직접 호출 차단
  assert.match(code, /security definer\s+set search_path = ''/);
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(code, new RegExp('revoke all on function public\\.delete_meta_auto_adlog_for_store\\(\\) from ' + role + ';'));
  }
  // 브라우저는 쇼핑몰 행 삭제 한 번만 요청하고 광고 기록 삭제를 따로 보내지 않는다
  const stores = fs.readFileSync(path.join(__dirname, '..', 'stores.js'), 'utf8');
  const del = stores.slice(stores.indexOf('function deleteStore('), stores.indexOf('form.addEventListener(\'submit\''));
  assert.doesNotMatch(del, /tool_records|removeAutoAdlog/);
  assert.match(del, /forgetAutoAdlogRecordsForStore\(id\)/);
});

test('DB 중복 방지: 광고 기록 중 meta_auto_key가 있는 행만 사용자별 유일(수동 기록은 대상 아님)', () => {
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260924150000_ad_log_meta_auto_unique.sql'), 'utf8');
  assert.match(mig, /create unique index if not exists tool_records_ad_log_meta_auto_key\s+on public\.tool_records \(user_id, \(data ->> 'meta_auto_key'\)\)\s+where tool_type = 'ad_log' and \(data ->> 'meta_auto_key'\) is not null;/);
  // data 컬럼 타입(json/jsonb)을 모르므로 jsonb 전용 연산자(?)를 쓰지 않는다
  assert.doesNotMatch(mig.replace(/--.*$/gm, ''), /data \?/);
});
