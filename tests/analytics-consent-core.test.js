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

// 2026-10-12 인증 복귀 주소 — Supabase 로그인 · 이메일 인증에서 돌아온 주소(#access_token=… · ?code=… · ?error=…)의 인증 값.
// GA4는 이 값이 주소에서 지워진 뒤에만 실행하고, 이전 페이지 주소(page_referrer)에서도 이 값만 뺀다.
test('hasAuthParams: 쿼리의 인증 이름, 또는 화면 경로(#/…)가 아닌 해시의 인증 이름이 있으면 true', () => {
  assert.equal(consent.hasAuthParams('', '#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=signup'), true);
  assert.equal(consent.hasAuthParams('', '#error=access_denied&error_code=otp_expired&error_description=x'), true);
  assert.equal(consent.hasAuthParams('?code=abc&state=s&utm_source=meta', '#/'), true);
  assert.equal(consent.hasAuthParams('?error=access_denied&error_description=x', ''), true);
  assert.equal(consent.hasAuthParams('?Code=abc', ''), true, '이름은 대소문자 구분 없이');
  assert.equal(consent.hasAuthParams('?utm_source=meta&utm_campaign=beta', '#/tools'), false);
  assert.equal(consent.hasAuthParams('', '#/privacy'), false);
  assert.equal(consent.hasAuthParams('', ''), false);
  assert.equal(consent.hasAuthParams('', '#top'), false, '인증 이름이 없는 해시는 해당 없음');
});

test('withoutAuthParams: 쿼리는 인증 이름만 빼고(utm 등은 남김), 인증 해시는 통째로 뺀다 — 화면 경로 해시는 그대로', () => {
  const plain = (o) => JSON.parse(JSON.stringify(o));
  assert.deepEqual(plain(consent.withoutAuthParams('?code=abc&state=s&utm_source=meta&utm_campaign=beta', '#/')), { search: '?utm_source=meta&utm_campaign=beta', hash: '#/' });
  assert.deepEqual(plain(consent.withoutAuthParams('', '#access_token=a&refresh_token=b')), { search: '', hash: '' });
  assert.deepEqual(plain(consent.withoutAuthParams('?error=e&error_code=c&error_description=d', '')), { search: '', hash: '' });
  assert.deepEqual(plain(consent.withoutAuthParams('?utm_source=x', '#/tools')), { search: '?utm_source=x', hash: '#/tools' });
  assert.deepEqual(plain(consent.withoutAuthParams('', '#top')), { search: '', hash: '#top' });
});

test('safeReferrer: 이전 페이지 주소에서 인증 값만 뺀다 — 출처 · 경로 · utm은 남겨 유입 분석을 유지', () => {
  assert.equal(consent.safeReferrer('https://launchdesk.co.kr/?code=abc&state=s&utm_source=ref'), 'https://launchdesk.co.kr/?utm_source=ref');
  assert.equal(consent.safeReferrer('https://x.example/cb?access_token=t&refresh_token=r'), 'https://x.example/cb');
  assert.equal(consent.safeReferrer('https://accounts.google.com/'), 'https://accounts.google.com/');
  assert.equal(consent.safeReferrer('https://l.instagram.com/?u=abc'), 'https://l.instagram.com/?u=abc');
  assert.equal(consent.safeReferrer(''), '');
  assert.equal(consent.safeReferrer(undefined), '');
});
