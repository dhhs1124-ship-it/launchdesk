/* 운영 현황 상단 기간 · Cafe24 동기화 범위 판단 — ops-period-core.js 값 검증.
   실행: node --test tests/ops-period-core.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PC = require('../ops-period-core.js');

// 한국시간 벽시계 → 실제 순간(ms)
const kst = (s) => Date.parse(s + '+09:00');

test('기간 → KST 날짜 범위: 오늘 · 어제 · 이번 달 · 날짜 선택, 오늘 이후 · 잘못된 날짜는 거부', () => {
  const now = kst('2026-09-24T10:00:00');
  assert.deepEqual(PC.resolve('today', null, now), { period: 'today', date: null, since: '2026-09-24', until: '2026-09-24', label: '오늘' });
  assert.deepEqual(PC.resolve('yesterday', null, now), { period: 'yesterday', date: null, since: '2026-09-23', until: '2026-09-23', label: '어제' });
  assert.deepEqual(PC.resolve('month', null, now), { period: 'month', date: null, since: '2026-09-01', until: '2026-09-24', label: '이번 달' });
  assert.deepEqual(PC.resolve('date', '2026-09-10', now), { period: 'date', date: '2026-09-10', since: '2026-09-10', until: '2026-09-10', label: '2026-09-10' });
  assert.equal(PC.resolve('date', '2026-09-25', now), null);
  assert.equal(PC.resolve('date', '2026-02-30', now), null);
  assert.equal(PC.resolve('all', null, now), null, '"전체"는 상단 기간이 아니다');
});

test('월초의 "어제"는 전달 말일이고, 이번 달은 1일 하루다', () => {
  const now = kst('2026-10-01T08:00:00');
  assert.equal(PC.resolve('yesterday', null, now).since, '2026-09-30');
  assert.deepEqual([PC.resolve('month', null, now).since, PC.resolve('month', null, now).until], ['2026-10-01', '2026-10-01']);
  // 1월 1일의 어제는 전년 12월 31일
  assert.equal(PC.resolve('yesterday', null, kst('2027-01-01T00:30:00')).since, '2026-12-31');
});

test('KST 자정 경계: UTC로는 전날이어도 한국 날짜로 자른다', () => {
  const now = Date.parse('2026-09-30T16:00:00Z'); // 한국 10-01 01:00
  assert.equal(PC.resolve('today', null, now).since, '2026-10-01');
  const b = PC.queryBounds(PC.resolve('yesterday', null, now)); // 09-30 하루
  assert.equal(b.gte, '2026-09-29T15:00:00.000Z');
  assert.equal(b.lt, '2026-09-30T15:00:00.000Z');
});

test('새로고침 동기화 범위: 오늘 − 14일 · 이번 달 1일 · 선택 날짜 · 마지막 동기화 날짜 중 가장 이른 날 ~ 오늘, 3개월 밖은 넣지 않는다', () => {
  const now = kst('2026-09-24T10:00:00');
  // 24일: 이번 달 1일이 오늘 − 14일(09-10)보다 이르다
  assert.deepEqual(PC.syncPlan(PC.resolve('today', null, now), now, null), { start_date: '2026-09-01', end_date: '2026-09-24', outside: false });
  assert.deepEqual(PC.syncPlan(PC.resolve('date', '2026-08-01', now), now, null), { start_date: '2026-08-01', end_date: '2026-09-24', outside: false });
  const old = PC.syncPlan(PC.resolve('date', '2026-05-01', now), now, null);
  assert.deepEqual(old, { start_date: '2026-09-01', end_date: '2026-09-24', outside: true });
  // 마지막 동기화가 8/20이면 거기서부터 이어 받아 기존 기록과 끊기지 않게 한다
  const aug20 = new Date(kst('2026-08-20T09:00:00')).toISOString();
  assert.equal(PC.syncPlan(PC.resolve('today', null, now), now, aug20).start_date, '2026-08-20');
  // 3개월 상한 밖의 마지막 동기화는 이어 붙이지 않는다(서버가 거부하므로)
  const may = new Date(kst('2026-05-01T09:00:00')).toISOString();
  assert.equal(PC.syncPlan(PC.resolve('today', null, now), now, may).start_date, '2026-09-01');
  // 월초: 오늘 − 14일이 이번 달 1일보다 이르므로 전달 말일(어제)까지 포함된다
  const oct1 = kst('2026-10-01T08:00:00');
  assert.equal(PC.syncPlan(PC.resolve('yesterday', null, oct1), oct1, null).start_date, '2026-09-17');
  // 서버 3개월 상한 안(시작일 + 3개월 ≥ 오늘)
  assert.equal(PC.addDays('2026-09-24', -PC.SYNC_MAX_DAYS_BACK), '2026-06-28');
});

test('동기화 범위 판단은 기록(orders_synced_from)만 근거로 한다 — last_synced_at만으로 과거를 추정하지 않는다', () => {
  const now = kst('2026-09-24T18:00:00');
  const R = (p, d) => PC.resolve(p, d, now);
  const syncedToday = new Date(kst('2026-09-24T10:00:00')).toISOString();
  // 한 번도 동기화하지 않음 → 0건이 아니라 none
  assert.equal(PC.coverage(R('today'), null, null), 'none');
  // 오늘 동기화했어도 범위 기록이 없으면(마이그레이션 전 연결 등) 어제 · 오늘 모두 unknown
  assert.equal(PC.coverage(R('yesterday'), syncedToday, null), 'unknown');
  assert.equal(PC.coverage(R('today'), syncedToday, null), 'unknown');
  // 기록 09-10부터: 오늘은 10:00까지(partial), 어제는 전체(full), 이번 달(1일~)은 unknown
  assert.equal(PC.coverage(R('today'), syncedToday, '2026-09-10'), 'partial');
  assert.equal(PC.coverage(R('yesterday'), syncedToday, '2026-09-10'), 'full');
  assert.equal(PC.coverage(R('month'), syncedToday, '2026-09-10'), 'unknown');
  assert.equal(PC.coverage(R('date', '2026-09-10'), syncedToday, '2026-09-10'), 'full');
  assert.equal(PC.coverage(R('date', '2026-09-09'), syncedToday, '2026-09-10'), 'unknown');
  // 어제 동기화가 마지막 → 오늘은 아직 동기화 전(none), 어제는 그 시각까지(partial)
  const syncedYesterday = new Date(kst('2026-09-23T15:00:00')).toISOString();
  assert.equal(PC.coverage(R('today'), syncedYesterday, '2026-09-01'), 'none');
  assert.equal(PC.coverage(R('yesterday'), syncedYesterday, '2026-09-01'), 'partial');
  // 잘못된 값 · 기간 없음
  assert.equal(PC.coverage(null, syncedToday, '2026-09-01'), 'unknown');
  assert.equal(PC.coverage(R('today'), 'not-a-date', '2026-09-01'), 'none');
  assert.equal(PC.coverage(R('yesterday'), syncedToday, 'garbage'), 'unknown');
});

test('15일 이후 재접속: 기록(9/1~)이 DB에 있으면 페이지를 새로 열어도 이번 달이 "확인 전"으로 돌아가지 않는다', () => {
  // 9/24 10:00에 9/1부터 동기화 → 함수가 orders_synced_from=2026-09-01을 기록.
  // 나중에(같은 날 18:00) 페이지를 새로 열면 메모리 없이 DB 값만으로 판단한다.
  const reopen = kst('2026-09-24T18:00:00');
  const lastSync = new Date(kst('2026-09-24T10:00:00')).toISOString();
  assert.equal(PC.coverage(PC.resolve('month', null, reopen), lastSync, '2026-09-01'), 'partial');
  // 다음 날 재접속: 이번 달은 어제까지 전체 + 오늘은 동기화 전 → 이번 달 전체로는 partial
  const nextDay = kst('2026-09-25T09:00:00');
  assert.equal(PC.coverage(PC.resolve('month', null, nextDay), lastSync, '2026-09-01'), 'partial');
  assert.equal(PC.coverage(PC.resolve('yesterday', null, nextDay), lastSync, '2026-09-01'), 'partial');
  assert.equal(PC.coverage(PC.resolve('today', null, nextDay), lastSync, '2026-09-01'), 'none');
});

test('월초: 10/1에 기록 9/17~ · 오늘 동기화면 어제(9/30)는 전체, 이번 달(10/1)은 동기화 시각까지', () => {
  const now = kst('2026-10-01T09:00:00');
  const lastSync = new Date(kst('2026-10-01T08:00:00')).toISOString();
  assert.equal(PC.coverage(PC.resolve('yesterday', null, now), lastSync, '2026-09-17'), 'full');
  assert.equal(PC.coverage(PC.resolve('month', null, now), lastSync, '2026-09-17'), 'partial');
  // 지난달 말 이후 동기화가 없으면(마지막 9/29) 어제(9/30) · 이번 달 모두 동기화 전
  const sep29 = new Date(kst('2026-09-29T20:00:00')).toISOString();
  assert.equal(PC.coverage(PC.resolve('yesterday', null, now), sep29, '2026-09-01'), 'none');
  assert.equal(PC.coverage(PC.resolve('month', null, now), sep29, '2026-09-01'), 'none');
});

test('cafe24-orders-sync 기록 규칙: 이전 기록과 이어질 때만 합치고, 기록이 없거나 빈 구간이 있으면 새 시작일부터', async () => {
  const m = await import('../supabase/functions/_shared/orders-sync-range.mjs');
  const last = (s) => new Date(kst(s)).toISOString();
  // 기록 없음(마이그레이션 전 · 최초) → 새 시작일부터만
  assert.equal(m.nextOrdersSyncedFrom(null, last('2026-09-20T10:00:00'), '2026-09-01'), '2026-09-01');
  assert.equal(m.nextOrdersSyncedFrom('2026-06-01', null, '2026-09-01'), '2026-09-01');
  // 이어짐(새 시작일 ≤ 이전 마지막 동기화 날짜) → 더 이른 시작일 유지
  assert.equal(m.nextOrdersSyncedFrom('2026-07-01', last('2026-09-20T10:00:00'), '2026-09-06'), '2026-07-01');
  assert.equal(m.nextOrdersSyncedFrom('2026-07-01', last('2026-09-20T10:00:00'), '2026-09-20'), '2026-07-01', '마지막 동기화 당일부터 다시 받으면 이어진다');
  assert.equal(m.nextOrdersSyncedFrom('2026-09-10', last('2026-09-20T10:00:00'), '2026-09-01'), '2026-09-01');
  // 빈 구간(새 시작일 > 이전 마지막 동기화 날짜) → 새 시작일부터만
  assert.equal(m.nextOrdersSyncedFrom('2026-07-01', last('2026-09-20T10:00:00'), '2026-09-21'), '2026-09-21');
  // KST 날짜 경계: UTC로는 9/19 16:00이지만 한국 9/20 01:00 → 9/20 시작도 이어짐
  assert.equal(m.nextOrdersSyncedFrom('2026-07-01', '2026-09-19T16:00:00Z', '2026-09-20'), '2026-07-01');
  assert.equal(m.nextOrdersSyncedFrom('bad', last('2026-09-20T10:00:00'), '2026-09-01'), '2026-09-01');
});

test('cafe24-orders-sync: 요청한 start_date를 그대로 쓰고, 오늘까지 끝낸 동기화에서만 last_synced_at과 범위 기록을 함께 갱신한다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fn = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'cafe24-orders-sync', 'index.ts'), 'utf8');
  assert.match(fn, /if \(hasExplicitRange\) \{[\s\S]{0,120}start_date = rawStartDate;\s*end_date = rawEndDate;/);
  assert.match(fn, /\.select\("id, external_account_id, status, last_synced_at, orders_synced_from"\)/);
  assert.match(fn, /nextOrdersSyncedFrom\(\s*account\.orders_synced_from,\s*account\.last_synced_at,\s*start_date\s*\)/);
  const upd = fn.slice(fn.indexOf('if (reachedToday) {'), fn.indexOf('.eq("id", account.id);', fn.indexOf('if (reachedToday) {')));
  assert.match(upd, /last_synced_at: now\.toISOString\(\),\s*orders_synced_from: ordersSyncedFrom,/);
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260924120000_cafe24_orders_synced_from.sql'), 'utf8');
  assert.match(mig, /add column if not exists orders_synced_from date;/);
});

test('cafe24-orders-sync의 overlap(14일) · 3개월 상한과 같은 값을 쓴다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fn = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'cafe24-orders-sync', 'index.ts'), 'utf8');
  assert.match(fn, /const INCREMENTAL_OVERLAP_DAYS = 14;/);
  assert.equal(PC.SYNC_OVERLAP_DAYS, 14);
  assert.match(fn, /maxDate\.setMonth\(maxDate\.getMonth\(\) \+ 3\)/);
});
