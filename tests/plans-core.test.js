/* 계획(plans) 순수 로직 검증 — 실행: node --test tests/plans-core.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PC = require('../plans-core.js');

const SNAP = {
  calc_version: 2, date: '9.16. 10:00', saved_at: '2026-09-16T01:00:00.000Z', platform: null,
  input: { price: 30000, qty: 1, unitCost: 15000, feeRate: 6, actualShipping: 3000, packaging: 1200, adMode: 'none' },
  result: { totalIncome: 30000, productFee: 1800, shippingFee: 0, pgFee: 0, feeTotal: 1800, preAd: 9000, adMode: 'none', adRate: null, adCost: 0, postAd: 9000, ratio: 30 }
};
const UUID = '0f1e2d3c-4b5a-4c6d-8e7f-a0b1c2d3e4f5';

// ------------------------------------------------------------ KST 날짜
test('kstToday: UTC 15:00 = KST 자정 경계에서 날짜가 넘어간다 (현지 시간대 무관)', () => {
  assert.equal(PC.kstToday(Date.UTC(2026, 8, 16, 14, 59, 59)), '2026-09-16');
  assert.equal(PC.kstToday(Date.UTC(2026, 8, 16, 15, 0, 0)), '2026-09-17');
  assert.equal(PC.kstToday(new Date(Date.UTC(2026, 11, 31, 15, 0, 0))), '2027-01-01');
});
test('isValidDate: 형식과 실존 날짜를 모두 검사한다', () => {
  assert.equal(PC.isValidDate('2026-09-16'), true);
  assert.equal(PC.isValidDate('2026-02-29'), false);
  assert.equal(PC.isValidDate('2028-02-29'), true);
  assert.equal(PC.isValidDate('2026-13-01'), false);
  assert.equal(PC.isValidDate('26-09-16'), false);
  assert.equal(PC.isValidDate(''), false);
  assert.equal(PC.isValidDate(null), false);
});
test('addDays/diffDays: 월·연 경계와 DST와 무관한 정수 연산', () => {
  assert.equal(PC.addDays('2026-09-16', 7), '2026-09-23');
  assert.equal(PC.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(PC.addDays('2026-03-08', 1), '2026-03-09'); // 미국 DST 전환일도 1일
  assert.equal(PC.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(PC.diffDays('2026-09-23', '2026-09-16'), 7);
  assert.equal(PC.diffDays('2026-09-10', '2026-09-16'), -6);
  assert.equal(PC.diffDays('bad', '2026-09-16'), null);
});
test('formatDateLabel: 요일 포함, 잘못된 값은 빈 문자열', () => {
  assert.equal(PC.formatDateLabel('2026-09-16'), '9월 16일 (수)');
  assert.equal(PC.formatDateLabel('x'), '');
});

// ------------------------------------------------------------ 분류/정렬
const TODAY = '2026-09-16';
function plan(over){ return Object.assign({ id: 'p', status: 'active', review_date: TODAY, executed: false, created_at: '2026-09-01T00:00:00Z', calc_snapshot: SNAP }, over); }

test('classify/statusInfo: 지남·오늘·예정·완료', () => {
  assert.equal(PC.classify(plan({ review_date: '2026-09-10' }), TODAY), 'overdue');
  assert.equal(PC.classify(plan({ review_date: TODAY }), TODAY), 'today');
  assert.equal(PC.classify(plan({ review_date: '2026-09-20' }), TODAY), 'upcoming');
  assert.equal(PC.classify(plan({ status: 'done', review_date: '2026-09-01', done_at: '2026-09-02T00:00:00Z' }), TODAY), 'done');
  assert.deepEqual(PC.statusInfo(plan({ review_date: '2026-09-10' }), TODAY), { kind: 'overdue', label: '6일 지남', tone: 'warn' });
  assert.deepEqual(PC.statusInfo(plan({ review_date: TODAY }), TODAY), { kind: 'today', label: '오늘 확인', tone: 'good' });
  assert.deepEqual(PC.statusInfo(plan({ review_date: '2026-09-20' }), TODAY), { kind: 'upcoming', label: '4일 후', tone: 'neutral' });
});
test('groupPlans: 지난→오늘→예정 순, 완료는 분리·최근 완료 우선', () => {
  const list = [
    plan({ id: 'up2', review_date: '2026-09-30' }),
    plan({ id: 'today', review_date: TODAY }),
    plan({ id: 'done1', status: 'done', done_at: '2026-09-05T00:00:00Z', review_date: '2026-09-01' }),
    plan({ id: 'over1', review_date: '2026-09-01' }),
    plan({ id: 'up1', review_date: '2026-09-20' }),
    plan({ id: 'done2', status: 'done', done_at: '2026-09-12T00:00:00Z', review_date: '2026-09-01' }),
    plan({ id: 'over2', review_date: '2026-09-14' })
  ];
  const g = PC.groupPlans(list, TODAY);
  assert.deepEqual(g.due.map(p => p.id), ['over1', 'over2', 'today']);
  assert.deepEqual(g.upcoming.map(p => p.id), ['up1', 'up2']);
  assert.deepEqual(g.done.map(p => p.id), ['done2', 'done1']);
});
test('groupPlans: 자정이 지나 today가 바뀌면 같은 데이터가 다르게 분류된다', () => {
  const list = [plan({ id: 'a', review_date: '2026-09-17' })];
  assert.equal(PC.groupPlans(list, '2026-09-16').upcoming.length, 1);
  assert.equal(PC.groupPlans(list, '2026-09-17').due.length, 1);
  assert.equal(PC.groupPlans(list, '2026-09-18').due.length, 1);
  assert.equal(PC.statusInfo(list[0], '2026-09-18').label, '1일 지남');
});

// ------------------------------------------------------------ 스냅샷
test('isValidSnapshot: v2 구조만 허용', () => {
  assert.equal(PC.isValidSnapshot(SNAP), true);
  assert.equal(PC.isValidSnapshot(Object.assign({}, SNAP, { calc_version: 1 })), false);
  assert.equal(PC.isValidSnapshot({ cost: 1, price: 2, profit: 3 }), false);
  assert.equal(PC.isValidSnapshot(Object.assign({}, SNAP, { result: { postAd: 'x' } })), false);
  assert.equal(PC.isValidSnapshot(null), false);
});
test('snapshotSummary/defaultTitle: 금액과 광고비 반영 여부, 적자 표현', () => {
  assert.equal(PC.snapshotSummary(SNAP), '판매가 30,000원 · 원가 15,000원 · 수수료 6% · 광고비 미반영 → 주문당 약 9,000원 남음');
  assert.equal(PC.defaultTitle(SNAP), '판매가 30,000원 · 약 9,000원 남기기');
  const ad = Object.assign({}, SNAP, { input: Object.assign({}, SNAP.input, { qty: 2 }), result: Object.assign({}, SNAP.result, { adMode: 'rate', adCost: 6000, postAd: -1500 }) });
  assert.equal(PC.snapshotSummary(ad), '판매가 30,000원 × 2 · 원가 15,000원 · 수수료 6% · 광고비 6,000원 → 주문당 약 1,500원 적자');
  assert.equal(PC.defaultTitle(ad), '판매가 30,000원 · 적자 조건 개선');
  assert.ok(PC.defaultTitle(SNAP).length <= PC.LIMITS.title);
  assert.equal(PC.snapshotSummary({ cost: 1 }), '이전 계산 방식이라 조건을 표시할 수 없어요');
});
test('snapshotsEqual: 시점 메타데이터(date/saved_at/platform)는 무시, input/result만 비교', () => {
  const same = Object.assign({}, SNAP, { date: '다른 시각', saved_at: '다른 저장시각', platform: 'coupang' });
  assert.equal(PC.snapshotsEqual(SNAP, same), true);
  const differentAd = Object.assign({}, SNAP, { result: Object.assign({}, SNAP.result, { adMode: 'rate', adCost: 3000, postAd: 6000 }) });
  assert.equal(PC.snapshotsEqual(SNAP, differentAd), false);
  const differentInput = Object.assign({}, SNAP, { input: Object.assign({}, SNAP.input, { price: 40000 }) });
  assert.equal(PC.snapshotsEqual(SNAP, differentInput), false);
  assert.equal(PC.snapshotsEqual(SNAP, { cost: 1 }), false);
  assert.equal(PC.snapshotsEqual(null, SNAP), false);
});
test('defaultReviewDate: 오늘 + 7일', () => {
  assert.equal(PC.defaultReviewDate('2026-09-16'), '2026-09-23');
});

// ------------------------------------------------------------ 입력 검증
test('validatePlanInput: 공백만 있는 값 거부, 길이 상한, 오늘 이전 날짜 거부, trim된 값 반환', () => {
  const bad = PC.validatePlanInput({ title: '   ', action_text: '', review_date: '2026-09-15' }, TODAY);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.title && bad.errors.action_text && bad.errors.review_date);
  assert.match(bad.errors.review_date, /지났어요/);
  const tooLong = PC.validatePlanInput({ title: 'a'.repeat(81), action_text: 'b'.repeat(301), review_date: TODAY }, TODAY);
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.title && tooLong.errors.action_text);
  const good = PC.validatePlanInput({ title: '  판매가 올리기 ', action_text: ' 상세페이지 수정 ', review_date: TODAY }, TODAY);
  assert.equal(good.ok, true);
  assert.deepEqual(good.values, { title: '판매가 올리기', action_text: '상세페이지 수정', review_date: TODAY });
  assert.equal(PC.validateNewReviewDate('2026-09-17', TODAY), '');
  assert.equal(PC.validateNewReviewDate('', TODAY), '재확인일을 선택해주세요.');
});
test('validateNote: 빈 값은 null, 500자 초과 거부', () => {
  assert.deepEqual(PC.validateNote('  '), { ok: true, value: null });
  assert.deepEqual(PC.validateNote(' 메모 '), { ok: true, value: '메모' });
  assert.equal(PC.validateNote('x'.repeat(501)).ok, false);
});

// ------------------------------------------------------------ 초안
test('parseDraft: 정상/없음/깨진 JSON/버전 불일치/만료를 구분한다', () => {
  const now = 1_800_000_000_000;
  const draft = PC.makeDraft({ client_request_id: UUID, title: 't', action_text: 'a', review_date: TODAY, calc_snapshot: SNAP, owner_user_id: null, saved_at: now });
  const raw = JSON.stringify(draft);
  assert.equal(PC.parseDraft(raw, now).reason, 'ok');
  assert.equal(PC.parseDraft(raw, now).draft.client_request_id, UUID);
  assert.deepEqual(PC.parseDraft(null, now), { draft: null, reason: 'none' });
  assert.deepEqual(PC.parseDraft('{not json', now), { draft: null, reason: 'invalid' });
  assert.equal(PC.parseDraft(JSON.stringify(Object.assign({}, draft, { v: 99 })), now).reason, 'invalid');
  assert.equal(PC.parseDraft(JSON.stringify(Object.assign({}, draft, { client_request_id: 'nope' })), now).reason, 'invalid');
  assert.equal(PC.parseDraft(JSON.stringify(Object.assign({}, draft, { calc_snapshot: { cost: 1 } })), now).reason, 'invalid');
  assert.equal(PC.parseDraft(raw, now + PC.DRAFT_TTL_MS + 1).reason, 'expired');
  assert.equal(PC.parseDraft(raw, now + PC.DRAFT_TTL_MS - 1).reason, 'ok');
});
test('draftVisibleFor: 게스트 초안은 누구에게나, 귀속된 초안은 그 계정에만', () => {
  const guest = PC.makeDraft({ client_request_id: UUID, calc_snapshot: SNAP, owner_user_id: null });
  const owned = PC.makeDraft({ client_request_id: UUID, calc_snapshot: SNAP, owner_user_id: 'user-a' });
  assert.equal(PC.draftVisibleFor(guest, null), true);
  assert.equal(PC.draftVisibleFor(guest, 'user-a'), true);
  assert.equal(PC.draftVisibleFor(owned, 'user-a'), true);
  assert.equal(PC.draftVisibleFor(owned, 'user-b'), false);
  assert.equal(PC.draftVisibleFor(owned, null), false);
  assert.equal(PC.draftVisibleFor(null, 'user-a'), false);
});

// ------------------------------------------------------------ 요청 ID
test('newRequestId: UUID v4 형식, 매번 다름, crypto 없이도 동작', () => {
  const a = PC.newRequestId(), b = PC.newRequestId();
  assert.ok(PC.isUuid(a) && PC.isUuid(b));
  assert.notEqual(a, b);
  assert.equal(a[14], '4');
  const c = PC.newRequestId({});
  assert.ok(PC.isUuid(c));
  assert.equal(c[14], '4');
  assert.ok('89ab'.includes(c[19]));
});
