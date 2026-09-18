/* 회원가입 필수 동의 — 순수 로직(policy-consent-core.js) 검증. 실행: node --test
   (Node 18+ 내장 test runner, 별도 패키지 없음) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../policy-consent-core.js');

test('버전/허용 source 상수는 한 곳에서만 정의된다', () => {
  assert.equal(typeof core.TERMS_VERSION, 'string');
  assert.equal(typeof core.PRIVACY_VERSION, 'string');
  assert.deepEqual(Object.keys(core.SOURCES).sort(), ['EMAIL_SIGNUP', 'EXISTING_USER_GATE', 'GOOGLE_OAUTH'].sort());
});

test('isAllowedSource: 허용된 값만 true, 카카오/임의 문자열은 false', () => {
  assert.equal(core.isAllowedSource(core.SOURCES.EMAIL_SIGNUP), true);
  assert.equal(core.isAllowedSource(core.SOURCES.GOOGLE_OAUTH), true);
  assert.equal(core.isAllowedSource(core.SOURCES.EXISTING_USER_GATE), true);
  assert.equal(core.isAllowedSource('kakao_oauth'), false);
  assert.equal(core.isAllowedSource(''), false);
  assert.equal(core.isAllowedSource(null), false);
});

test('serializePending: 허용되지 않은 source는 예외', () => {
  assert.throws(() => core.serializePending('kakao_oauth'));
});

test('serializePending → parsePending 왕복(같은 시각)', () => {
  const now = 1_700_000_000_000;
  const raw = core.serializePending(core.SOURCES.GOOGLE_OAUTH, now);
  const parsed = core.parsePending(raw, now);
  assert.deepEqual(parsed, { source: core.SOURCES.GOOGLE_OAUTH, createdAt: now });
});

test('parsePending: 저장값 없음(null/undefined/빈 문자열/깨진 JSON)은 null', () => {
  assert.equal(core.parsePending(null), null);
  assert.equal(core.parsePending(undefined), null);
  assert.equal(core.parsePending(''), null);
  assert.equal(core.parsePending('{not json'), null);
  assert.equal(core.parsePending('"그냥 문자열"'), null);
});

test('parsePending: 현재 정책 버전과 다르면 무효(정책 개정 중 남은 pending 재사용 방지)', () => {
  const now = 1_700_000_000_000;
  const raw = JSON.stringify({ termsVersion: 'old', privacyVersion: core.PRIVACY_VERSION, source: core.SOURCES.EMAIL_SIGNUP, createdAt: now });
  assert.equal(core.parsePending(raw, now), null);
  const raw2 = JSON.stringify({ termsVersion: core.TERMS_VERSION, privacyVersion: 'old', source: core.SOURCES.EMAIL_SIGNUP, createdAt: now });
  assert.equal(core.parsePending(raw2, now), null);
});

test('parsePending: 허용되지 않은 source는 무효', () => {
  const now = 1_700_000_000_000;
  const raw = JSON.stringify({ termsVersion: core.TERMS_VERSION, privacyVersion: core.PRIVACY_VERSION, source: 'kakao_oauth', createdAt: now });
  assert.equal(core.parsePending(raw, now), null);
});

test('parsePending: TTL 이내는 유효, TTL을 넘으면 무효(다른 로그인 시도의 잔재로 취급)', () => {
  const createdAt = 1_700_000_000_000;
  const withinTtl = createdAt + core.PENDING_TTL_MS - 1;
  const pastTtl = createdAt + core.PENDING_TTL_MS + 1;
  const raw = core.serializePending(core.SOURCES.EMAIL_SIGNUP, createdAt);
  assert.notEqual(core.parsePending(raw, withinTtl), null);
  assert.equal(core.parsePending(raw, pastTtl), null);
});

test('parsePending: createdAt이 미래 시각(시계 조작/오류)이면 무효', () => {
  const now = 1_700_000_000_000;
  const raw = core.serializePending(core.SOURCES.EMAIL_SIGNUP, now + 1000);
  assert.equal(core.parsePending(raw, now), null);
});

test('isDuplicateInsertError: 23505만 true, 그 외 에러/무에러는 false', () => {
  assert.equal(core.isDuplicateInsertError({ code: '23505' }), true);
  assert.equal(core.isDuplicateInsertError({ code: '42501' }), false);
  assert.equal(core.isDuplicateInsertError(null), false);
  assert.equal(core.isDuplicateInsertError(undefined), false);
});
