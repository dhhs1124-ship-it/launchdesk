/* 개인정보처리방침 v1.3(로컬 준비 · 공개 중 v1.2) — 버전 드리프트 방지 테스트. 실행: node --test
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
const V1_2_MIGRATION_PATH = path.join(SETUP_INQUIRY_MIGRATIONS_DIR, '20260923170000_setup_inquiries_privacy_v1_2.sql');
const V1_3_MIGRATION_PATH = path.join(SETUP_INQUIRY_MIGRATIONS_DIR, '20260924160000_setup_inquiries_privacy_v1_3.sql');

test('policy-consent-core.js: PRIVACY_VERSION은 v1.3', () => {
  assert.equal(core.PRIVACY_VERSION, 'v1.3');
});

test('policy-consent-core.js: TERMS_VERSION은 그대로(약관 본문을 고치지 않았으므로)', () => {
  assert.equal(core.TERMS_VERSION, '2026-09-18');
});

test('개인정보처리방침 화면: 헤더/버전 섹션이 v1.3 · 2026년 9월 24일(실제 게시일)로 코드 상수와 일치', () => {
  assert.match(PRIVACY_HTML, /시행일 2026년 9월 24일 · v1\.3 · 런치데스크/);
  assert.match(PRIVACY_HTML, /<li>버전: v1\.3\(이전 버전: v1\.2, 2026년 9월 24일 시행\)<\/li>/);
  assert.match(PRIVACY_HTML, /<li>시행일: 2026년 9월 24일<\/li>/);
});

test('개인정보처리방침 화면: v1.3 시행일이 헤더·14번·15번 세 곳에서 같은 날짜이고, 게시일 자리표시자·안내 주석이 남아 있지 않으며 이전 버전 이력은 그대로다', () => {
  assert.match(PRIVACY_HTML, /v1\.2 → v1\.3 주요 변경 사항\(2026년 9월 24일 시행\)/);
  assert.match(PRIVACY_HTML, /v1\.1 → v1\.2 주요 변경 사항\(2026년 9월 24일 시행\)/);
  assert.match(PRIVACY_HTML, /v1\.0 → v1\.1 주요 변경 사항\(2026년 9월 22일 시행\)/);
  // v1.3 시행일 3곳(헤더 · 14번 v1.2→v1.3 · 15번 시행일) + v1.2 이력 2곳(14번 v1.1→v1.2 · 15번 이전 버전)
  assert.equal((PRIVACY_HTML.match(/2026년 9월 24일/g) || []).length, 5);
  assert.doesNotMatch(PRIVACY_HTML, /\[게시 예정일\]/, '게시일 자리표시자가 남아 있으면 안 된다(주석 포함)');
  assert.doesNotMatch(PRIVACY_HTML, /\[공개 전 확정 필요/, '날짜를 채우라는 안내 주석이 남아 있으면 안 된다');
});

test('v1.3: Meta 성과 기록(광고 기록 저장)의 목적 · 항목 · 보유 · 삭제가 실제 코드와 같게 적혀 있다', () => {
  // 2번 목적 — 조회뿐 아니라 이용자가 실행한 경우의 저장
  assert.match(PRIVACY_HTML, /Meta 성과 기록을 실행한 경우 그날의 Meta 광고계정 전체 합계\(하루 광고비·Meta 귀속 구매금액·구매 건수\)를 광고 기록으로 저장/);
  // 3번 항목 — 저장 항목(광고계정 ID 포함) · 버튼을 누른 경우에만 · 날짜당 1건
  assert.match(PRIVACY_HTML, /<tr><td>Meta 성과 기록\(광고 기록\)<\/td><td>[^<]*Meta 광고계정 ID[^<]*<\/td><td>[^<]*“Meta 성과 기록하기”를 누른 경우에만[^<]*같은 쇼핑몰·광고계정·날짜는 1건만 저장\)<\/td><\/tr>/);
  // 4번 보유 — 연동 해제 시 연결 정보는 삭제, 광고 기록은 남아 직접 삭제 · 쇼핑몰 삭제 시 그 쇼핑몰 자동 기록 함께 삭제
  assert.match(PRIVACY_HTML, /연결 정보와 접근 권한이 즉시 삭제됩니다\. 다만 이용자가 이미 광고 기록으로 저장한 Meta 성과 기록은 연동 해제로 삭제되지 않으며, 광고 기록에서 직접 삭제할 수 있습니다/);
  assert.match(PRIVACY_HTML, /<strong>Meta 성과 기록[^<]*<\/strong> — 이용자가 직접 삭제하거나, 기록이 속한 쇼핑몰을 삭제하거나, 회원 탈퇴할 때까지 보유합니다\./);
  assert.match(PRIVACY_HTML, /Meta 연동을 해제해도 이미 저장한 기록\(그 안의 Meta 광고계정 ID 포함\)은 남으며, 연동 해제 후에도 조회하고 직접 삭제할 수 있습니다/);
  assert.match(PRIVACY_HTML, /쇼핑몰 자체를 삭제하면 그 쇼핑몰의 Meta 성과 기록도 함께 삭제되며, 이용자가 직접 입력한 광고 기록과 다른 쇼핑몰의 기록은 삭제되지 않습니다/);
  assert.match(PRIVACY_HTML, /쇼핑몰을 삭제하면 그 쇼핑몰의 Meta 성과 기록도 함께 삭제됩니다\.<\/li>/);
  assert.doesNotMatch(PRIVACY_HTML, /쇼핑몰을 삭제해도 이미 저장한 기록/, '쇼핑몰 삭제 시 남는다는 이전 설명이 남아 있으면 안 된다');
  // 코드 근거: Meta 연동 해제 · Cafe24 연동 해제는 광고 기록(tool_records)을 지우지 않고(stores 행도
  // 지우지 않으므로 트리거도 안 돈다), 쇼핑몰 행 삭제 트리거만 그 쇼핑몰의 Meta 자동 기록을 지운다
  const metaDisconnect = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'meta-disconnect', 'index.ts'), 'utf8');
  assert.doesNotMatch(metaDisconnect, /tool_records|from\("stores"\)/);
  const cafe24DisconnectFn = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'cafe24-disconnect', 'index.ts'), 'utf8');
  assert.doesNotMatch(cafe24DisconnectFn, /tool_records/);
  const cafe24Rpc = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260922120000_cafe24_disconnect.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(cafe24Rpc, /delete from public\.(stores|tool_records)/);
  const trig = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260924170000_store_delete_meta_auto_adlog.sql'), 'utf8');
  assert.match(trig, /after delete on public\.stores\s+for each row/);
  assert.match(trig, /where user_id = old\.user_id\s+and tool_type = 'ad_log'\s+and \(data ->> 'source'\) = 'meta_auto'\s+and \(data ->> 'store_id'\) = old\.id::text;/);
  // 코드 근거: 자동 기록이 실제로 저장하는 필드
  const adlogMeta = fs.readFileSync(path.join(ROOT, 'adlog-meta.js'), 'utf8');
  for (const field of ['spend:', 'revenue:', 'purchases:', 'meta_auto_key:', 'store_id:', 'currency:', 'fetched_at:']) {
    assert.ok(adlogMeta.includes(field), 'adlog-meta.js 저장 필드 누락: ' + field);
  }
});

test('이용약관 화면: v1.0 · 2026년 9월 18일 그대로(약관 본문을 고치지 않았으므로 버전을 올리지 않음)', () => {
  assert.match(TERMS_HTML, /시행일 2026년 9월 18일 · v1\.0 · 운영자: LaunchDesk/);
});

test('세팅 대행 문의 RPC의 서버 동의 버전 상수(가장 최근 마이그레이션 v1.3)가 프런트 PRIVACY_VERSION과 일치', () => {
  const sql = fs.readFileSync(V1_3_MIGRATION_PATH, 'utf8');
  const m = sql.match(/v_consent_version\s+constant\s+text\s*:=\s*'([^']+)'/);
  assert.ok(m, 'v_consent_version 상수를 마이그레이션 파일에서 찾지 못함');
  assert.equal(m[1], core.PRIVACY_VERSION, 'RPC가 저장하는 동의 버전과 policy-consent-core.js의 PRIVACY_VERSION이 어긋납니다');
});

test('과거 setup_inquiries 마이그레이션 파일 자체는 수정하지 않았다(이미 원격에 적용됐으므로)', () => {
  const v10 = fs.readFileSync(
    path.join(SETUP_INQUIRY_MIGRATIONS_DIR, '20260918120000_setup_inquiries_consent_rpc.sql'),
    'utf8'
  );
  assert.match(v10, /v_consent_version constant text := 'v1\.0'/, '과거 마이그레이션 파일(v1.0)의 서버 상수가 그대로 v1.0이어야 한다(수정 금지 대상)');

  const v11 = fs.readFileSync(V1_1_MIGRATION_PATH, 'utf8');
  assert.match(v11, /v_consent_version constant text := 'v1\.1'/, '과거 마이그레이션 파일(v1.1)의 서버 상수가 그대로 v1.1이어야 한다 — 원격에 이미 적용된 마이그레이션이므로 수정·재적용하지 않는다(읽기 전용 원격 조회로 확인됨)');
});

test('새 v1.2 마이그레이션의 업무 검증 로직(플랜 가격·필드 길이 상한·INSERT 컬럼)은 v1.1과 동일하다', () => {
  // v1.2는 버전 불일치 차단을 위해 시그니처에 인자를 하나 추가했으므로(아래
  // 별도 테스트) 더 이상 "주석 제거 후 문자열 완전 일치"로 비교할 수 없다
  // — 대신 실제 업무 로직 조각들이 문자 그대로 남아있는지 개별 확인한다.
  const v12 = fs.readFileSync(V1_2_MIGRATION_PATH, 'utf8');
  const sharedFragments = [
    "v_plan_name := '기본 쇼핑몰 세팅';",
    'v_plan_price := 79000;',
    "v_plan_name := '연동·추적 세팅';",
    'v_plan_price := 129000;',
    "v_plan_name := '전체 초기 세팅';",
    'v_plan_price := 189000;',
    "raise exception 'INVALID_PLAN';",
    "if v_name = '' or char_length(v_name) > 80 then",
    "if v_phone = '' or char_length(v_phone) > 30 then",
    'if v_platform is not null and char_length(v_platform) > 40 then',
    'if v_note is not null and char_length(v_note) > 1000 then',
    "if p_privacy_consent is distinct from true then",
    "raise exception 'CONSENT_REQUIRED';",
    'insert into public.setup_inquiries (\n    user_id, plan_key, plan_name, plan_price, name, phone, platform, note,\n    status, privacy_consent_version, privacy_consent_at\n  ) values (\n    v_user_id, p_plan_id, v_plan_name, v_plan_price, v_name, v_phone, v_platform, v_note,\n    \'pending\', v_consent_version, now()\n  )',
    'security definer',
    "set search_path = ''"
  ];
  for (const fragment of sharedFragments) {
    assert.ok(v12.includes(fragment), `v1.2 마이그레이션에서 v1.1과 동일해야 할 조각을 찾지 못함: ${fragment.slice(0, 40)}...`);
  }
});

test('v1.2 마이그레이션은 옛 6인자 시그니처를 명시적으로 DROP한다(오버로드로 남아 버전 검사를 우회하지 못하도록)', () => {
  const v12 = fs.readFileSync(V1_2_MIGRATION_PATH, 'utf8');
  assert.match(v12, /drop function if exists public\.submit_setup_inquiry\(text, text, text, text, text, boolean\);/, '옛 6인자 시그니처 DROP 구문이 없다 — 구버전 클라이언트가 여전히 가드 없는 함수를 호출할 수 있다');
  // DROP이 CREATE보다 먼저 나와야 한다(같은 트랜잭션 내 순서 — 마이그레이션은
  // 파일 전체가 한 트랜잭션으로 적용되므로 텍스트 순서가 곧 실행 순서다).
  const dropIdx = v12.indexOf('drop function if exists public.submit_setup_inquiry(text, text, text, text, text, boolean);');
  const createIdx = v12.indexOf('create function public.submit_setup_inquiry(');
  assert.ok(dropIdx !== -1 && createIdx !== -1 && dropIdx < createIdx, 'DROP이 CREATE보다 앞에 있어야 한다');
});

test('v1.2 마이그레이션은 새 인자 p_expected_privacy_version(기본값 null)을 시그니처 마지막에 추가한다', () => {
  const v12 = fs.readFileSync(V1_2_MIGRATION_PATH, 'utf8');
  assert.match(v12, /p_privacy_consent boolean default false,\s*\r?\n\s*p_expected_privacy_version text default null\s*\r?\n\)/, '새 인자가 시그니처 마지막에 기본값 null로 추가돼야 한다');
});

test('v1.2 RPC는 p_expected_privacy_version이 서버 상수와 다르면(구버전 클라이언트의 null 포함) 접수 자체를 거부하고, 이 값을 저장에 쓰지 않는다', () => {
  const v12 = fs.readFileSync(V1_2_MIGRATION_PATH, 'utf8');
  assert.match(v12, /if p_expected_privacy_version is distinct from v_consent_version then\s*\r?\n\s*raise exception 'PRIVACY_VERSION_MISMATCH';/, '버전 불일치 차단 가드가 없거나 문구가 다르다');
  // insert 문의 값 목록에 p_expected_privacy_version이 등장하지 않아야 한다
  // — 저장에는 여전히 v_consent_version 서버 상수만 쓰여야 한다(2026-09-18
  // 보안 수정과 같은 원칙: 클라이언트가 보낸 버전 문자열은 절대 저장되지 않음).
  const insertBlock = v12.match(/insert into public\.setup_inquiries[\s\S]*?returning id into v_id;/);
  assert.ok(insertBlock, 'INSERT 문을 찾지 못함');
  assert.doesNotMatch(insertBlock[0], /p_expected_privacy_version/, 'p_expected_privacy_version이 INSERT 문에 등장한다 — 클라이언트가 보낸 값이 그대로 저장되면 안 된다(서버 상수만 저장)');
});

test('v1.2 GRANT/REVOKE는 새 7인자 시그니처를 대상으로 하고, anon·authenticated 실행 권한은 v1.1과 동일하게 유지한다', () => {
  const v12 = fs.readFileSync(V1_2_MIGRATION_PATH, 'utf8');
  const newSig = '(text, text, text, text, text, boolean, text)';
  assert.ok(v12.includes(`revoke all on function public.submit_setup_inquiry${newSig} from public;`), '새 시그니처 대상 REVOKE 문이 없다');
  assert.ok(v12.includes(`grant execute on function public.submit_setup_inquiry${newSig} to anon, authenticated;`), '새 시그니처 대상 GRANT 문이 없거나 anon/authenticated 권한이 달라졌다');
});

test('setup.js는 RPC 호출 시 p_expected_privacy_version으로 PRIVACY_VERSION을 보내고, 불일치 오류를 사용자에게 안내한다', () => {
  const setupJs = fs.readFileSync(path.join(ROOT, 'setup.js'), 'utf8');
  assert.match(setupJs, /p_expected_privacy_version:\s*setupPolicyCore\s*\?\s*setupPolicyCore\.PRIVACY_VERSION\s*:\s*null/, 'setup.js가 RPC 호출에 p_expected_privacy_version을 보내지 않는다(버전 불일치 차단이 동작하지 않음)');
  assert.match(setupJs, /PRIVACY_VERSION_MISMATCH/, "setup.js가 PRIVACY_VERSION_MISMATCH 오류를 친절한 문구로 안내하지 않는다");
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

test('Meta 광고 성과: 조회한 성과 자체는 저장하지 않고, 이용자가 "Meta 성과 기록하기"를 누른 경우만 하루 합계를 광고 기록으로 저장한다고 정확히 표현됨', () => {
  assert.match(PRIVACY_HTML, /Meta 광고 성과\(광고비·노출·클릭·구매 등 지표\)는 화면에서 조회할 때마다 Meta로부터 그때그때 가져오며, 조회한 성과 자체는 서버에 저장하지 않습니다\. 다만 이용자가 운영 현황 “광고 기록”에서 “Meta 성과 기록하기”를 직접 누른 경우에는/);
  assert.match(PRIVACY_HTML, /Cafe24 주문금액과는 다르며 서로 합산하지 않습니다/);
  assert.doesNotMatch(PRIVACY_HTML, /서버에 별도로 저장하지 않습니다/, 'v1.2의 "저장하지 않음" 단정이 남아 있으면 안 된다');
});

test('v1.3 마이그레이션: 같은 7인자 시그니처를 CREATE OR REPLACE로 교체하고 서버 상수만 v1.3으로 바꾼다(검증 로직 · 가격 · INSERT · 권한은 v1.2와 동일)', () => {
  const v12 = fs.readFileSync(V1_2_MIGRATION_PATH, 'utf8');
  const v13 = fs.readFileSync(V1_3_MIGRATION_PATH, 'utf8');
  assert.match(v13, /create or replace function public\.submit_setup_inquiry\(\s*p_plan_id text,[\s\S]*?p_privacy_consent boolean default false,\s*p_expected_privacy_version text default null\s*\)/);
  assert.match(v13, /v_consent_version constant text := 'v1\.3';/);
  assert.match(v13, /if p_expected_privacy_version is distinct from v_consent_version then\s*raise exception 'PRIVACY_VERSION_MISMATCH';/);
  assert.doesNotMatch(v13, /drop function/i, '시그니처가 같으므로 DROP이 필요 없다');
  // v1.2와 본문이 상수 한 줄(과 주석)만 다르다
  const body = (s) => s.slice(s.indexOf('returns uuid'), s.indexOf('$$;')).replace(/--.*$/gm, '').replace(/\s+/g, ' ').replace(/'v1\.[23]'/, "'VER'");
  assert.equal(body(v13), body(v12));
  const sig = '(text, text, text, text, text, boolean, text)';
  assert.ok(v13.includes(`revoke all on function public.submit_setup_inquiry${sig} from public;`));
  assert.ok(v13.includes(`grant execute on function public.submit_setup_inquiry${sig} to anon, authenticated;`));
  // v1.2 파일 자체는 그대로(원격에 이미 적용됨)
  assert.match(v12, /v_consent_version constant text := 'v1\.2';/);
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

test('Resend는 6번(위탁)과 7번(국외 이전)에 함께 적고, 공식 자료(DPA·미국 저장·30일)에 근거한 사실만 쓴다', () => {
  // "~에 해당한다"식 법적 단정 문구는 쓰지 않는다(Cafe24/Meta와 같은 원칙).
  assert.doesNotMatch(PRIVACY_HTML, /Resend[\s\S]{0,80}(위탁|제3자 제공|국외 이전)에 해당/);
  // 6번(위탁)·7번(국외 이전) 표에서 각각 한 행씩 — 둘 중 하나를 고르는 게 아니라 함께 고지한다.
  const resendRows = PRIVACY_HTML.match(/<tr><td>Resend, Inc\.<\/td>[\s\S]*?<\/tr>/g) || [];
  assert.equal(resendRows.length, 2, 'Resend 표 행(6번·7번)을 찾지 못함');
  assert.doesNotMatch(resendRows[0], /공개 전 확정 필요/);
  assert.match(resendRows[0], /국외\(미국\) — Resend는 데이터처리계약\(DPA\)에 따라 회사를 대신해 일반 문의 메일을 발송하며/);
  assert.match(resendRows[0], /미국에 저장·처리되므로 7번 항목\(국외 이전\)에도 함께 적습니다/);
  assert.match(resendRows[1], /<td>미국<\/td>/);
  assert.match(resendRows[1], /30일\(Resend 보관 정책\)/);
  assert.match(resendRows[1], /로그인 계정 이메일/, '메일 본문에 회원 계정 이메일이 함께 가므로 이전 항목에 있어야 한다');
});

test('문의하기 회원 전용 전환으로 Cloudflare Turnstile을 쓰지 않으므로 방침에도 남아 있지 않다', () => {
  assert.doesNotMatch(PRIVACY_HTML, /Turnstile|Cloudflare/);
});

test('Resend 자체 보관(30일)과 운영자 Gmail 보관(수동 삭제)을 4번 항목에서 별도 항목으로 적는다', () => {
  const resendBullet = PRIVACY_HTML.match(/<li><strong>일반 문의 발송 기록\(Resend\)<\/strong>[\s\S]*?<\/li>/);
  assert.ok(resendBullet, 'Resend 발송 기록 보유기간 항목을 찾지 못함');
  assert.match(resendBullet[0], /30일간 보관/);
  assert.match(resendBullet[0], /Gmail에 보관되는 문의 메일과는 별개/);
});

test('일반 문의(#/contact) 수집 항목·처리 목적이 2·3번 항목에 회원 전용으로 반영됨', () => {
  assert.match(PRIVACY_HTML, /일반 문의\(쇼핑몰 시작 질문·사이트 이용 오류·택배\/도매 제휴\) 접수 및 이메일 답변, 회원 확인 및 발송 횟수 제한/);
  assert.match(PRIVACY_HTML, /<tr><td>일반 문의\(회원 전용\)<\/td><td>답변받을 이메일, 문의 유형, 제목, 문의 내용, 입력한 경우에 한한 연락처, 로그인 계정 이메일<\/td>/);
  assert.match(PRIVACY_HTML, /일반 문의는 로그인한 회원만 보낼 수 있습니다/);
  assert.doesNotMatch(PRIVACY_HTML, /로그인 여부 무관\) · 별도 필수 동의 체크 시에만 접수\. 자동/);
});

test('일반 문의 보유기간 문구는 "정확히 1년 파기"를 약속하지 않고, 실제 절차(Gmail 수동 삭제 · 매주 점검 · 7일 이내 휴지통 이동 · 30일 후 영구 삭제)와 일치한다', () => {
  const bullet = PRIVACY_HTML.match(/<li><strong>일반 문의<\/strong>[\s\S]*?<\/li>/);
  assert.ok(bullet, '일반 문의 보유기간 항목을 찾지 못함');
  assert.match(bullet[0], /받은 문의와 보낸 답장을 직접 삭제/);
  assert.match(bullet[0], /매주 정기 점검/, '점검 주기가 매주(週)로 명시돼야 한다 — 분기 점검은 최대 ~3개월 초과를 만들어 "1년" 약속과 어긋난다');
  assert.match(bullet[0], /늦어도 7일 이내에 휴지통으로 옮기고/);
  assert.match(bullet[0], /휴지통으로 옮긴 메일은 30일이 지나면 Gmail에서 영구 삭제/, '휴지통 이동과 영구 삭제를 구분해야 한다');
  // "목표로 합니다" 같은 완곡어법으로 절차-문구 불일치를 덮지 않는다(명시적 사용자 지적 사항).
  assert.doesNotMatch(PRIVACY_HTML, /목표로 합니다/);
});

test('발송 제한용 해시(7일)·중복 방지용 해시(2일)는 "다음 성공 요청 시 정리"로만 표현되고, 정해진 시각에 자동 삭제된다고 과장하지 않는다', () => {
  const hashBullets = PRIVACY_HTML.match(/<li><strong>일반 문의 (발송 횟수 제한용 이메일 해시값|중복 발송 방지용 식별자·내용 해시값)<\/strong>[\s\S]{0,260}?<\/li>/g) || [];
  assert.equal(hashBullets.length, 2, '해시 보유기간 항목(7일·2일) 두 개를 모두 찾지 못함');
  for (const bullet of hashBullets) {
    assert.match(bullet, /정해진 시각에 자동으로/, '자동 삭제가 아니라는 점이 명시돼야 한다');
    assert.match(bullet, /남아 있을 수 있습니다/, '다음 요청이 없으면 기준 기간이 지나도 남을 수 있다는 점이 명시돼야 한다');
  }
});

test('계약사(Google/Resend/Cloudflare) 문의 이메일 보유기간 표기가 서로 다른 3번째 항목(3개월/1년/정기 점검)을 정확히 구분해 표현한다', () => {
  const matches = PRIVACY_HTML.match(/세팅 대행 문의 3개월, 도매처 등록·개인정보 관련 문의 1년, 일반 문의는 처리 완료 1년 후 휴지통 이동, 휴지통 이동 30일 후 영구 삭제/g) || [];
  assert.equal(matches.length, 2, '6번·7번 Gmail 행 두 곳이 같은 문구여야 한다');
});

test('일반 문의 화면 자체의 별도 동의 문구(support-consent)도 방침 본문과 같은 절차로 표현되어 "정확히 1년 파기"를 약속하지 않는다', () => {
  // index.html에는 consent-info 문단이 두 곳(세팅 대행 문의 · 일반 문의)에 있으므로,
  // 뒤에 이어지는 contactConsent 체크박스로 일반 문의 쪽만 특정한다.
  const consentBlock = INDEX_HTML.match(/<p class="consent-info">[\s\S]{0,400}?<\/p>(?:(?!<p class="consent-info">)[\s\S]){0,300}?id="contactConsent"/);
  assert.ok(consentBlock, '일반 문의 화면(contactConsent)의 consent-info 문단을 찾지 못함');
  assert.match(consentBlock[0], /보유 기간<\/strong> 문의 처리 완료 후 1년이 지나면 운영자가 Gmail에서 받은 문의와 보낸 답장을 늦어도 7일 이내에 휴지통으로 옮기며, 휴지통으로 옮긴 메일은 30일이 지나면 영구 삭제됩니다/);
  assert.doesNotMatch(consentBlock[0], /목표로 합니다/);
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

test('Cafe24 연결 정보 보유기간은 이제 인앱 연동 해제로 설명한다(cafe24-disconnect 구현 완료 반영)', () => {
  const cafe24Bullet = PRIVACY_HTML.match(/<li><strong>Cafe24 연결 정보[\s\S]{0,320}?<\/li>/);
  assert.ok(cafe24Bullet, 'Cafe24 연결 정보 보유기간 항목을 찾지 못함');
  assert.match(cafe24Bullet[0], /연동을 해제할 때까지 보유/);
  assert.match(cafe24Bullet[0], /화면에서 Cafe24 연동 해제를 요청하면/);
  assert.match(cafe24Bullet[0], /즉시 삭제/);
  assert.match(cafe24Bullet[0], /쇼핑몰 정보와 마진 계산 기록은 연동 해제와 무관하게 유지/);
  // 이메일 요청만 가능하다는 옛 초안 문구(있지도 않은 버튼을 암시하지 않기 위한 것이었음)는
  // 실제 기능이 생겼으므로 더 이상 남아 있으면 안 된다.
  assert.doesNotMatch(cafe24Bullet[0], /이메일로 삭제를 요청/, 'Cafe24도 이제 인앱 연동 해제가 가능하므로 이메일 요청 전용 문구가 남아 있으면 안 됨');
});

test('셀프서비스 목록(4번·9번 항목)에 Cafe24 연동 해제가 반영되고, Cafe24를 더 이상 이메일 전용 삭제로 단정하지 않는다', () => {
  const selfServiceParas = PRIVACY_HTML.match(/현재 서비스 화면에서는[\s\S]{0,220}?이용자가 직접 처리할 수 있으며/g) || [];
  assert.equal(selfServiceParas.length, 2, '셀프서비스 안내 문단(4번·9번 항목)이 정확히 2곳이어야 한다');
  for (const para of selfServiceParas) {
    assert.match(para, /Cafe24 연동 해제/, 'Cafe24 연동 해제가 셀프서비스 목록에 없음');
    assert.match(para, /Meta 연동 해제/, 'Meta 연동 해제 문구가 사라짐(회귀)');
  }
});

test('Cafe24 연동 해제 즉시삭제 문구는 실제 cafe24-disconnect RPC(단일 트랜잭션)가 이행한다(정책 약속 ↔ 코드 대조)', () => {
  const fn = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'cafe24-disconnect', 'index.ts'),
    'utf8'
  );
  assert.match(fn, /\.rpc\(\s*"disconnect_cafe24_integration"/, 'cafe24-disconnect가 disconnect_cafe24_integration RPC를 호출하지 않는다');
  // service_role로 테이블을 하나씩 순차 삭제하는 방식(meta-disconnect 패턴)은
  // 이 함수에서 금지된다 — 원자성 요구사항 위반.
  assert.doesNotMatch(fn, /ctx\.supabaseAdmin\s*\n?\s*\.from\("(integration_credentials|connected_accounts|orders|oauth_states)"\)\s*\.delete\(/, 'cafe24-disconnect가 service_role로 테이블을 개별 삭제하고 있다(원자성 요구사항 위반)');

  const migration = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260922120000_cafe24_disconnect.sql'),
    'utf8'
  );
  assert.match(migration, /delete from public\.integration_credentials/);
  assert.match(migration, /delete from public\.connected_accounts[\s\S]{0,40}where store_id = p_store_id and provider = 'cafe24'/);
  assert.match(migration, /delete from public\.orders[\s\S]{0,40}where store_id = p_store_id and provider = 'cafe24'/);
  assert.match(migration, /delete from public\.oauth_states[\s\S]{0,40}where store_id = p_store_id and provider = 'cafe24'/);
  assert.match(migration, /set external_store_id = null/);
});
