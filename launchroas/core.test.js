const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./core');

test('KST 자정 경계: UTC 전날과 한국 날짜를 정확히 구분한다', () => {
  const now = Date.parse('2026-09-28T15:05:00Z');
  assert.equal(core.kstToday(now), '2026-09-29');
  assert.equal(core.kstStartIso(now), '2026-09-28T15:00:00.000Z');
});

test('동기화 전은 0건으로 표시할 수 없고, 동기화 후 빈 목록은 0건이다', () => {
  const now = Date.parse('2026-09-29T04:00:00Z');
  assert.equal(core.hasTodayCoverage(null, now), false);
  assert.equal(core.hasTodayCoverage('2026-09-28T14:59:59Z', now), false);
  assert.equal(core.hasTodayCoverage('2026-09-28T15:00:00Z', now), true);
  assert.deepEqual(core.summarizeOrders([]), {count:0, amount:0});
});

test('주문금액은 저장된 payment_amount를 그대로 더하며 취소·환불을 임의로 차감하지 않는다', () => {
  assert.deepEqual(core.summarizeOrders([{payment_amount:13900},{payment_amount:3500}]), {count:2, amount:17400});
});
