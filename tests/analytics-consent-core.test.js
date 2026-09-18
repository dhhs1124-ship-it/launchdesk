/* 분석 동의 상태 저장/파싱 순수 로직 검증 — 실행: node --test tests/
   (Node 18+ 내장 test runner, 별도 패키지 없음) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const consent = require('../analytics-consent-core.js');

test('저장값 없음(null/undefined/빈 문자열)은 parse() 결과가 null', () => {
  assert.equal(consent.parse(null), null);
  assert.equal(consent.parse(undefined), null);
  assert.equal(consent.parse(''), null);
});

test('잘못된 JSON은 저장값 없음으로 취급', () => {
  assert.equal(consent.parse('{not json'), null);
  assert.equal(consent.parse('"그냥 문자열"'), null);
});

test('알 수 없는 버전은 저장값 없음으로 취급', () => {
  const raw = JSON.stringify({ status: 'granted', version: 999, updatedAt: new Date().toISOString() });
  assert.equal(consent.parse(raw), null);
});

test('알 수 없는 status는 저장값 없음으로 취급', () => {
  const raw = JSON.stringify({ status: 'maybe', version: consent.CURRENT_VERSION, updatedAt: new Date().toISOString() });
  assert.equal(consent.parse(raw), null);
});

test('granted 직렬화 → 파싱 왕복', () => {
  const raw = consent.serialize(consent.STATUSES.GRANTED);
  const parsed = consent.parse(raw);
  assert.equal(parsed.status, 'granted');
  assert.equal(parsed.version, consent.CURRENT_VERSION);
  assert.equal(typeof parsed.updatedAt, 'string');
  assert.equal(consent.isGranted(parsed), true);
  assert.equal(consent.isDenied(parsed), false);
});

test('denied 직렬화 → 파싱 왕복', () => {
  const raw = consent.serialize(consent.STATUSES.DENIED);
  const parsed = consent.parse(raw);
  assert.equal(consent.isGranted(parsed), false);
  assert.equal(consent.isDenied(parsed), true);
});

test('isGranted/isDenied는 null(저장값 없음)에도 안전하게 false', () => {
  assert.equal(consent.isGranted(null), false);
  assert.equal(consent.isDenied(null), false);
});

test('serialize()는 granted/denied가 아닌 값을 거부', () => {
  assert.throws(() => consent.serialize('nope'));
});
