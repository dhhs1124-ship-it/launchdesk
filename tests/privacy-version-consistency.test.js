/* 개인정보처리방침 v1.1 — 버전 드리프트 방지 테스트. 실행: node --test
   (Node 18+ 내장 test runner, 별도 패키지 없음)

   여기서 확인하는 것은 딱 하나 — "버전을 나타내는 여러 곳이 서로 어긋나지
   않았는가"다. 문구 자체의 적절성(법률적 정확성)은 사람이 검토한다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require('../policy-consent-core.js');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// index.html은 #view-privacy와 #view-terms가 같은 privacy-* 클래스를 공유하는
// 문서형 레이아웃이라(policy-consent-flow.test.js 주석 참고), 두 뷰의 텍스트를
// 헷갈려 검사하지 않도록 마커로 정확히 구간을 자른다.
const PRIVACY_START = INDEX_HTML.indexOf('<!-- ============ VIEW: 개인정보처리방침 ============ -->');
const TERMS_START = INDEX_HTML.indexOf('<section class="view" id="view-terms"');
assert.ok(PRIVACY_START !== -1 && TERMS_START !== -1 && PRIVACY_START < TERMS_START, '테스트 전제(뷰 마커 위치)가 깨졌습니다 — index.html 구조 확인 필요');
const PRIVACY_HTML = INDEX_HTML.slice(PRIVACY_START, TERMS_START);
const TERMS_HTML = INDEX_HTML.slice(TERMS_START, TERMS_START + 1000);

const SETUP_INQUIRY_MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const V1_1_MIGRATION_PATH = path.join(SETUP_INQUIRY_MIGRATIONS_DIR, '20260922100000_setup_inquiries_privacy_v1_1.sql');

test('policy-consent-core.js: PRIVACY_VERSION은 v1.1', () => {
  assert.equal(core.PRIVACY_VERSION, 'v1.1');
});

test('policy-consent-core.js: TERMS_VERSION은 그대로(약관 본문을 고치지 않았으므로)', () => {
  assert.equal(core.TERMS_VERSION, '2026-09-18');
});

test('개인정보처리방침 화면: 헤더/버전 섹션이 v1.1 · 2026년 9월 22일로 코드 상수와 일치', () => {
  assert.match(PRIVACY_HTML, /시행일 2026년 9월 22일 · v1\.1 · 런치데스크/);
  assert.match(PRIVACY_HTML, /<li>버전: v1\.1/);
  assert.match(PRIVACY_HTML, /<li>시행일: 2026년 9월 22일<\/li>/);
});

test('이용약관 화면: v1.0 · 2026년 9월 18일 그대로(약관 본문을 고치지 않았으므로 버전을 올리지 않음)', () => {
  assert.match(TERMS_HTML, /시행일 2026년 9월 18일 · v1\.0 · 운영자: LaunchDesk/);
});

test('세팅 대행 문의 RPC의 서버 동의 버전 상수가 프런트 PRIVACY_VERSION과 일치', () => {
  const sql = fs.readFileSync(V1_1_MIGRATION_PATH, 'utf8');
  const m = sql.match(/v_consent_version\s+constant\s+text\s*:=\s*'([^']+)'/);
  assert.ok(m, 'v_consent_version 상수를 마이그레이션 파일에서 찾지 못함');
  assert.equal(m[1], core.PRIVACY_VERSION, 'RPC가 저장하는 동의 버전과 policy-consent-core.js의 PRIVACY_VERSION이 어긋납니다');
});

test('과거 setup_inquiries 마이그레이션 파일 자체는 수정하지 않았다(이미 적용됐을 수 있으므로)', () => {
  const old = fs.readFileSync(
    path.join(SETUP_INQUIRY_MIGRATIONS_DIR, '20260918120000_setup_inquiries_consent_rpc.sql'),
    'utf8'
  );
  assert.match(old, /v_consent_version constant text := 'v1\.0'/, '과거 마이그레이션 파일의 서버 상수가 그대로 v1.0이어야 한다(수정 금지 대상)');
});

test('광고 세트 손익분기 기준 연결 정보는 "기능을 사용하는 경우에만 저장"으로 명시됨(성과 원본 저장으로 오해되지 않게)', () => {
  assert.match(PRIVACY_HTML, /광고 세트 손익분기 기준 연결 정보/);
  assert.match(PRIVACY_HTML, /상품 구분용 이름/);
  assert.match(PRIVACY_HTML, /연결 시점의 마진 계산 기준/);
  assert.match(PRIVACY_HTML, /사용하는 경우에만 저장\(사용하지 않으면 저장되지 않음\)/);
});

test('Cafe24/Meta 연동 정보와 Cafe24 주문 데이터가 수집 항목 표에 반영됨', () => {
  assert.match(PRIVACY_HTML, /Cafe24·Meta 연동 정보/);
  assert.match(PRIVACY_HTML, /Cafe24 주문 데이터/);
});

test('Meta 광고 성과는 "매 요청마다 조회 · 저장하지 않음"으로 정확히 표현됨(DB 저장으로 오기하지 않음)', () => {
  assert.match(PRIVACY_HTML, /Meta 광고 성과\(광고비·노출·클릭·구매 등 지표\)는 화면에서 조회할 때마다 Meta로부터 그때그때 가져오며, 서버에 별도로 저장하지 않습니다/);
});

test('확인되지 않은 사업자등록번호를 임의로 추가하지 않았다(사업자등록 전이므로)', () => {
  assert.doesNotMatch(PRIVACY_HTML, /사업자등록번호/);
});

test('회사 표기는 기존과 동일하게 "운영자 김대환"만 — 새 법인명을 지어내지 않았다', () => {
  const companyMentions = PRIVACY_HTML.match(/회사는|회사가|회사를/g) || [];
  assert.ok(companyMentions.length > 0, '본문에 "회사" 표현이 있어야 한다(기존 표현 유지 확인용)');
  assert.match(PRIVACY_HTML, /런치데스크\(LaunchDesk, 이하 "서비스"\)는 운영자 김대환\(이하 "회사"\)이 운영하는/);
});

test('Supabase 저장 리전 표기는 기존 그대로(새 리전을 지어내지 않았다)', () => {
  const matches = PRIVACY_HTML.match(/ap-northeast-2/g) || [];
  // v1.0에도 이미 두 번(6번 위탁 표, 7번 국외이전 표) 등장하던 표기 — v1.1에서
  // 새 리전 문구를 추가하지 않았다면 등장 횟수가 그대로여야 한다.
  assert.equal(matches.length, 2, 'ap-northeast-2 등장 횟수가 v1.0과 달라졌다 — 리전 표기가 임의로 추가/변경됐을 수 있음');
});

test('Cafe24/Meta 위탁·제3자 제공·국외 이전 분류를 공개 문서에서 임의로 단정하지 않는다', () => {
  assert.doesNotMatch(PRIVACY_HTML, /Cafe24[\s\S]{0,80}(위탁|제3자 제공|국외 이전)에 해당/);
  assert.doesNotMatch(PRIVACY_HTML, /Meta[\s\S]{0,80}(위탁|제3자 제공|국외 이전)에 해당/);
});

test('공개 정책에 "검토 중" 같은 진행 상태 문구를 내부적으로 노출하지 않는다', () => {
  assert.doesNotMatch(PRIVACY_HTML, /법률 검토/);
  assert.doesNotMatch(PRIVACY_HTML, /검토가 끝나는 대로/);
});

test('공개 정책에 미완성 구현을 직접 언급하지 않는다(연동 해제 기능 없음 · 삭제 범위 미확인 등)', () => {
  assert.doesNotMatch(PRIVACY_HTML, /해제하는 기능이 없/);
  assert.doesNotMatch(PRIVACY_HTML, /아직 확인되지 않았/);
  assert.doesNotMatch(PRIVACY_HTML, /직접 삭제하는 기능은 아직 제공되지 않/);
  assert.doesNotMatch(PRIVACY_HTML, /미확인/);
});

test('공개 정책에 DB 내부 용어(테이블명 · RLS · CASCADE · RPC · "코드")를 노출하지 않는다', () => {
  assert.doesNotMatch(PRIVACY_HTML, /\bRLS\b/);
  assert.doesNotMatch(PRIVACY_HTML, /\bCASCADE\b/i);
  assert.doesNotMatch(PRIVACY_HTML, /\bRPC\b/);
  assert.doesNotMatch(PRIVACY_HTML, /테이블/);
  assert.doesNotMatch(PRIVACY_HTML, /코드로 확인/);
});

test('로그에 상태 코드만 남는다는(범위를 넘어서는) 약속을 하지 않는다', () => {
  assert.doesNotMatch(PRIVACY_HTML, /오류 코드와 응답 상태 등 기술 정보만 기록/);
  assert.doesNotMatch(PRIVACY_HTML, /상태코드만/);
});

test('Meta 연동 해제 즉시삭제 문구는 실제 meta-disconnect 코드가 이행한다(정책 약속 ↔ 코드 대조)', () => {
  const fn = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'meta-disconnect', 'index.ts'),
    'utf8'
  );
  assert.match(fn, /from\("integration_credentials"\)\s*\.delete\(\)/, 'integration_credentials 삭제 호출이 없어졌다면 정책의 "즉시 삭제" 문구를 다시 검토해야 함');
  assert.match(fn, /from\("connected_accounts"\)\s*\.delete\(\)/, 'connected_accounts 삭제 호출이 없어졌다면 정책의 "즉시 삭제" 문구를 다시 검토해야 함');
});

test('Cafe24 연결 정보 보유기간은 인앱 연동 해제가 아니라 이메일 요청 경로로만 설명한다(있지도 않은 버튼을 암시하지 않음)', () => {
  const cafe24Bullet = PRIVACY_HTML.match(/<li><strong>Cafe24 연결 정보[\s\S]{0,200}?<\/li>/);
  assert.ok(cafe24Bullet, 'Cafe24 연결 정보 보유기간 항목을 찾지 못함');
  assert.match(cafe24Bullet[0], /이메일로 삭제를 요청/);
  assert.doesNotMatch(cafe24Bullet[0], /연동을 해제/, 'Cafe24는 인앱 연동 해제 기능이 없으므로 "연동 해제"를 자체 삭제 경로로 표현하면 안 됨');
});
