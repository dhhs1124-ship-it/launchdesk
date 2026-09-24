'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'supabase/functions/contact-inquiry/index.ts'), 'utf8');
const browserSource = fs.readFileSync(path.join(root, 'contact.js'), 'utf8');

// 실제 SQL 함수(claim_contact_inquiry_attempt/release_contact_inquiry_reservation/
// record_contact_inquiry_delivery/contact_inquiry_already_delivered)를 재구현하지
// 않고, 이 파일이 필요로 하는 시나리오(재시도 성공·중복 요청·동시 요청·상한
// 도달)만 흉내내는 최소 인메모리 모델이다. 성공 카운터의 "확인 후 증가"를
// claim_contact_inquiry_attempt 하나(await 없이 동기적으로 확인+증가)에서
// 처리해, Postgres의 행 잠금과 동일하게 동시 호출끼리 순서대로 직렬화되는
// 것만 흉내낸다 — 실제 원자성·잠금 동작 자체는 Postgres 엔진에서만 검증
// 가능하다(이 환경에는 Postgres/Docker/Supabase CLI가 없어 실행하지 못했다 —
// 최종 보고의 "미검증 사항" 참고).
function serverHarness(opts = {}){
  opts = opts || {};
  const calls = {
    getUser: 0, externalOther: 0, delivery: 0, alreadyDelivered: 0, claimAttempt: 0, release: 0, recordDelivery: 0,
    mail: null, resendIdempotencyKeys: [],
  };
  const env = {
    RESEND_API_KEY: 'test-only',
    CONTACT_FROM_EMAIL: 'LaunchDesk <contact@launchdesk.co.kr>', CONTACT_RATE_PEPPER: 'test-only',
    ...(opts.env || {}),
  };
  const deliveries = new Map(); // idempotency_key -> content_hash
  const successCounts = { daily: new Map(), email: new Map() };
  const optCaps = opts.caps || {};
  const caps = {
    daily: optCaps.daily !== undefined ? optCaps.daily : 30,
    email: optCaps.email !== undefined ? optCaps.email : 3,
  };
  const sandbox = {
    Response, Request, TextEncoder, crypto: globalThis.crypto,
    Deno: { env: { get(key){ return env[key]; } } },
    console: { error(){} },
    withSupabase(_opts, fn){ return fn; },
    fetch: async (url, request) => {
      if(url !== 'https://api.resend.com/emails'){
        calls.externalOther++; // Turnstile 등 Resend 외 외부 호출이 생기면 테스트가 잡는다
        throw new Error('unexpected fetch: ' + url);
      }
      calls.delivery++;
      calls.mail = JSON.parse(request.body);
      // fetch(url, {headers}) 두 번째 인자는 이 mock 안에서 평범한 옵션
      // 객체다(진짜 Headers 인스턴스로 정규화되지 않음) — .get()이 없을 수
      // 있으니 둘 다 처리한다.
      const headers = request.headers;
      const idemHeader = headers && typeof headers.get === 'function'
        ? headers.get('Idempotency-Key')
        : (headers ? headers['Idempotency-Key'] : undefined);
      calls.resendIdempotencyKeys.push(idemHeader);
      return Response.json(opts.deliveryError ? { error: 'failed' } : { id: 'test' }, { status: opts.deliveryError ? 503 : 200 });
    },
  };
  vm.createContext(sandbox);
  const js = serverSource
    .replace(/^import .*;\s*$/gm, '')
    .replace('export default {', 'globalThis.contactHandler = {')
    .replace('function json(body: unknown, status: number, origin: string)', 'function json(body, status, origin)')
    .replace('function sha256Hex(text: string)', 'function sha256Hex(text)')
    .replace('let input: Record<string, unknown>;', 'let input;')
    .replaceAll('category as keyof typeof types', 'category');
  vm.runInContext(js, sandbox, { filename: 'contact-inquiry/index.ts' });
  const payload = {
    category: 'beginner', email: 'hello@example.com', phone: '010-1234-5678',
    subject: '상품 등록이 궁금해요', message: '온라인 쇼핑몰에 첫 상품을 올리려면 어디서 시작해야 하나요?',
    consent: true, website: '',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };
  // Supabase Auth 흉내: 'member-token'만 실제 회원, 'anon-key-jwt'는 anon 키처럼
  // 형식은 JWT지만 사용자가 없는 토큰, 'anonymous-token'은 익명 로그인 사용자.
  const users = {
    'member-token': { id: 'user-1', email: 'Member@Example.com' },
    'anonymous-token': { id: 'user-anon', email: '', is_anonymous: true },
    ...(opts.users || {}),
  };
  const supabaseAdmin = {
    auth: {
      async getUser(token){
        calls.getUser++;
        const user = users[token];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    rpc: async (name, params) => {
      if(name === 'contact_inquiry_already_delivered'){
        calls.alreadyDelivered++;
        const storedHash = deliveries.get(params.p_idempotency_key);
        return { data: storedHash !== undefined && storedHash === params.p_content_hash, error: null };
      }
      if(name === 'claim_contact_inquiry_attempt'){
        calls.claimAttempt++;
        if(opts.attemptLimitReached) return { data: null, error: { message: 'CONTACT_ATTEMPT_LIMIT' } };
        // 아래는 await 없이(동기적으로) 확인+증가한다 — Postgres가 같은 행의
        // UPDATE를 행 잠금으로 직렬화하는 것과 동일하게, JS 이벤트 루프에서도
        // 이 블록 중간에 다른 호출이 끼어들 수 없다(비동기 경계가 없으므로).
        const dailyKey = params.p_category;
        const emailKey = params.p_email_hash;
        const dailyCount = successCounts.daily.get(dailyKey) || 0;
        const emailCount = successCounts.email.get(emailKey) || 0;
        if(dailyCount >= caps.daily || emailCount >= caps.email){
          return { data: null, error: { message: 'CONTACT_QUOTA_REACHED' } };
        }
        successCounts.daily.set(dailyKey, dailyCount + 1);
        successCounts.email.set(emailKey, emailCount + 1);
        return { data: true, error: null };
      }
      if(name === 'release_contact_inquiry_reservation'){
        calls.release++;
        const dailyKey = params.p_category;
        const emailKey = params.p_email_hash;
        successCounts.daily.set(dailyKey, Math.max((successCounts.daily.get(dailyKey) || 0) - 1, 0));
        successCounts.email.set(emailKey, Math.max((successCounts.email.get(emailKey) || 0) - 1, 0));
        return { data: null, error: null };
      }
      if(name === 'record_contact_inquiry_delivery'){
        calls.recordDelivery++;
        if(opts.recordError) return { data: null, error: { message: 'boom' } };
        deliveries.set(params.p_idempotency_key, params.p_content_hash);
        return { data: true, error: null };
      }
      throw new Error('unexpected rpc call: ' + name);
    },
  };
  return {
    calls, payload, deliveries, successCounts, opts, handler: sandbox.contactHandler.fetch,
    async send(overrides = {}) {
      const headers = { 'Origin': (overrides && overrides.__origin) || 'https://launchdesk.co.kr', 'Content-Type': 'application/json' };
      // __token: undefined면 회원 토큰, null이면 Authorization 헤더 없음(비회원)
      const token = overrides && '__token' in overrides ? overrides.__token : 'member-token';
      if(token !== null) headers.Authorization = 'Bearer ' + token;
      const req = new Request('https://example.supabase.co/functions/v1/contact-inquiry', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, ...overrides, __origin: undefined, __token: undefined }),
      });
      const res = await sandbox.contactHandler.fetch(req, { supabaseAdmin });
      const body = await res.clone().json().catch(() => null);
      return { status: res.status, body };
    },
  };
}

test('문의 화면은 메일·연락처·제목·본문·별도 동의를 받는다', () => {
  const view = html.slice(html.indexOf('id="view-contact"'), html.indexOf('id="view-privacy"'));
  for(const id of ['contactForm', 'contactEmail', 'contactPhone', 'contactSubject', 'contactMessage', 'contactConsent']){
    assert.match(view, new RegExp('id="' + id + '"'));
  }
  assert.match(view, /id="contactPhone"[^>]+type="tel"/);
  assert.match(view, /문의 보내기/);
});

test('회원 문의는 로그인 확인과 횟수 확인 후 운영자 메일로 전달하고, Resend에 Idempotency-Key를 함께 보낸다', async () => {
  const h = serverHarness();
  const result = await h.send();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(h.calls.getUser, 1, '토큰을 Supabase Auth에 직접 확인해야 한다');
  assert.equal(h.calls.externalOther, 0, 'Turnstile 등 Resend 외 외부 호출이 없어야 한다');
  assert.equal(h.calls.claimAttempt, 1);
  assert.equal(h.calls.delivery, 1);
  assert.equal(h.calls.recordDelivery, 1);
  assert.equal(h.calls.release, 0, '성공했으면 예약을 되돌리면 안 된다');
  assert.equal(typeof h.calls.resendIdempotencyKeys[0], 'string');
  assert.equal(h.calls.resendIdempotencyKeys[0].length > 0, true, 'Resend 요청에 Idempotency-Key가 실려야 한다');
  assert.deepEqual(h.calls.mail, {
    from: 'LaunchDesk <contact@launchdesk.co.kr>', to: ['dhhs1124@gmail.com'],
    reply_to: 'hello@example.com',
    subject: '[LaunchDesk] [쇼핑몰 시작 질문] 상품 등록이 궁금해요',
    text: '문의 유형: 쇼핑몰 시작 질문\n제목: 상품 등록이 궁금해요\n답변 이메일: hello@example.com\n회원 계정: member@example.com\n연락처: 010-1234-5678\n\n문의 내용:\n온라인 쇼핑몰에 첫 상품을 올리려면 어디서 시작해야 하나요?',
  });
});

test('비회원 요청(Authorization 없음)은 401 LOGIN_REQUIRED — 입력 확인·DB·메일 발송 모두 하지 않는다', async () => {
  const h = serverHarness();
  const result = await h.send({ __token: null });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: 'LOGIN_REQUIRED' });
  assert.equal(h.calls.alreadyDelivered + h.calls.claimAttempt + h.calls.delivery, 0);
});

test('anon 키처럼 형식만 JWT인 토큰·위조 토큰·익명 로그인 사용자는 회원이 아니므로 거부한다', async () => {
  for(const token of ['anon-key-jwt', 'forged.token.value', 'anonymous-token', '']) {
    const h = serverHarness();
    const result = await h.send({ __token: token });
    assert.equal(result.status, 401, token + ' 토큰은 거부돼야 한다');
    assert.deepEqual(result.body, { error: 'LOGIN_REQUIRED' });
    assert.equal(h.calls.claimAttempt + h.calls.delivery, 0);
  }
});

test('클라이언트가 보낸 이메일로 회원 여부를 판단하지 않는다 — 회원 계정과 같은 이메일을 적어도 토큰이 없으면 거부', async () => {
  const h = serverHarness();
  const result = await h.send({ __token: null, email: 'member@example.com' });
  assert.equal(result.status, 401);
  assert.equal(h.calls.delivery, 0);
});

test('발송 횟수 제한은 폼 이메일이 아니라 로그인 계정 기준 — 답장 주소를 바꿔도 계정 상한을 피할 수 없다', async () => {
  const h = serverHarness({ caps: { email: 1, daily: 30 } });
  const first = await h.send({ email: 'a@example.com', idempotencyKey: '55555555-5555-4555-8555-555555555555' });
  assert.equal(first.status, 200);
  const second = await h.send({ email: 'b@example.com', idempotencyKey: '66666666-6666-4666-8666-666666666666' });
  assert.equal(second.status, 429);
  assert.deepEqual(second.body, { error: 'QUOTA_REACHED' });
  assert.equal(h.calls.delivery, 1);
  assert.equal(h.successCounts.email.get(await emailHashFor('member@example.com')), 1, '계정 이메일(소문자) 해시로 집계돼야 한다');
});

test('Turnstile 토큰 없이도 회원 문의는 접수된다(회원 전용 전환으로 Turnstile 제거)', async () => {
  const h = serverHarness();
  assert.doesNotMatch(serverSource, /turnstile|siteverify/i);
  const result = await h.send({ turnstileToken: undefined });
  assert.equal(result.status, 200);
  assert.equal(h.calls.externalOther, 0);
});

test('잘못된 입력이나 동의 없는 문의는 외부 요청과 메일 발송을 하지 않는다', async () => {
  const h = serverHarness();
  for(const fields of [
    { consent: false }, { category: 'unknown' }, { category: '__proto__' }, { subject: 'a' },
    { message: 'short' }, { email: 'invalid' }, { idempotencyKey: 'not-a-uuid' }, { idempotencyKey: '' },
  ]) {
    assert.equal((await h.send(fields)).status, 400);
  }
  assert.equal(h.calls.claimAttempt, 0);
  assert.equal(h.calls.delivery, 0);
});

test('오늘 발송 성공 횟수를 다 쓰면 429 QUOTA_REACHED — 시도 횟수 상한과 다른 코드', async () => {
  const h = serverHarness({ caps: { email: 0, daily: 30 } }); // 이메일 상한 0 = 이미 다 쓴 상태 재현
  const result = await h.send();
  assert.equal(result.status, 429);
  assert.deepEqual(result.body, { error: 'QUOTA_REACHED' });
  assert.equal(h.calls.delivery, 0);
  assert.equal(h.calls.release, 0, '예약 자체가 안 됐으니 되돌릴 것도 없다');
});

test('반복된 실패 등으로 시도 자체가 많으면 429 ATTEMPT_LIMIT — QUOTA_REACHED와 다른 코드', async () => {
  const h = serverHarness({ attemptLimitReached: true });
  const result = await h.send();
  assert.equal(result.status, 429);
  assert.deepEqual(result.body, { error: 'ATTEMPT_LIMIT' });
  assert.equal(h.calls.delivery, 0);
});

test('메일 제공자가 실패하면 성공으로 표시하지 않고, 예약해둔 성공 횟수를 되돌린다', async () => {
  const h = serverHarness({ deliveryError: true });
  const result = await h.send();
  assert.equal(result.status, 502);
  assert.equal(h.calls.claimAttempt, 1, '발송 전 예약은 이뤄진다');
  assert.equal(h.calls.release, 1, '발송 실패 시 예약을 되돌려야 다음 재시도가 막히지 않는다');
  assert.equal(h.calls.recordDelivery, 0);
  assert.equal(h.successCounts.email.get(await emailHashFor('member@example.com')) || 0, 0, '되돌린 뒤에는 예약이 남아있으면 안 된다');
});

test('발송 실패 후 같은 요청을 재시도하면(같은 idempotencyKey) 예약이 되돌려져 있어 다시 시도할 수 있고, 성공하면 정상 접수된다', async () => {
  const h = serverHarness({ deliveryError: true });
  const first = await h.send();
  assert.equal(first.status, 502);
  assert.equal(h.calls.release, 1);

  h.opts.deliveryError = false; // 장애 복구 상황 재현
  const second = await h.send();
  assert.equal(second.status, 200, '실패 후 재시도는 차단되지 않고 정상 접수돼야 한다');
  assert.equal(h.calls.claimAttempt, 2);
  assert.equal(h.calls.delivery, 2, 'Resend를 다시 호출했다(첫 실패가 영구 차단하지 않음)');
  assert.equal(h.calls.release, 1, '두 번째는 성공했으니 추가로 되돌릴 필요가 없다');
});

test('발송 성공 후 같은 idempotencyKey·같은 내용으로 재요청(응답 유실 재현)하면 Resend를 다시 부르지 않고 그대로 성공을 돌려준다', async () => {
  const h = serverHarness();
  const first = await h.send();
  assert.equal(first.status, 200);
  assert.equal(h.calls.delivery, 1);

  const second = await h.send(); // 같은 payload = 같은 idempotencyKey + 같은 내용
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { ok: true });
  assert.equal(h.calls.delivery, 1, '이미 성공한 요청은 Resend를 다시 호출하면 안 된다(중복 발송 방지)');
  assert.equal(h.calls.getUser, 2, '재요청이어도 회원 확인은 매번 한다');
  assert.equal(h.calls.claimAttempt, 1, '이미 처리된 요청은 시도·성공 횟수도 다시 소모하지 않는다');
});

test('같은 idempotencyKey라도 입력을 수정해 내용이 달라지면 다른 요청으로 취급해 새로 발송한다', async () => {
  const h = serverHarness();
  const first = await h.send();
  assert.equal(first.status, 200);

  // 같은 idempotencyKey를 그대로 쓰되(클라이언트가 재사용했다고 가정) 문의
  // 내용만 바뀐 경우 — 서버는 "이미 처리됨"으로 착각해 수정 전 응답을
  // 돌려주면 안 되고, 실제로 새로 발송해야 한다.
  const second = await h.send({ message: '수정된 문의 내용입니다. 배송비도 같이 알려주세요.' });
  assert.equal(second.status, 200);
  assert.equal(h.calls.delivery, 2, '내용이 달라졌으면 Resend를 다시 호출해야 한다(예전 응답 재사용 금지)');
  assert.notEqual(
    h.calls.resendIdempotencyKeys[0], h.calls.resendIdempotencyKeys[1],
    '내용이 다르면 Resend에 보내는 Idempotency-Key도 달라야 한다(Resend가 예전 캐시된 메일을 재사용하지 않도록)',
  );
});

test('Resend에 보내는 Idempotency-Key는 같은 key+같은 내용이면 항상 같다(진짜 재시도의 Resend측 중복 방지 근거)', async () => {
  const h = serverHarness({ deliveryError: true }); // 실패를 반복시켜 매번 Resend까지 도달하게 함
  await h.send();
  h.opts.deliveryError = true;
  await h.send();
  assert.equal(h.calls.resendIdempotencyKeys.length, 2);
  assert.equal(h.calls.resendIdempotencyKeys[0], h.calls.resendIdempotencyKeys[1], '같은 idempotencyKey+같은 내용은 항상 같은 Resend Idempotency-Key를 써야 한다');
});

test('[동시 요청] 상한 근처에서 서로 다른 문의 2건이 동시에 도착하면 하나만 통과하고, 성공 상한을 초과해 실제로 발송하지 않는다', async () => {
  const h = serverHarness({ caps: { email: 1, daily: 30 } }); // 이메일당 상한 1로 낮춰 경합을 쉽게 재현
  const [a, b] = await Promise.all([
    h.send({ idempotencyKey: '22222222-2222-4222-8222-222222222222', subject: '동시 요청 A' }),
    h.send({ idempotencyKey: '33333333-3333-4333-8333-333333333333', subject: '동시 요청 B' }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 429], '하나는 성공, 하나는 상한 도달이어야 한다(둘 다 성공하면 상한 초과)');
  assert.equal(h.calls.delivery, 1, 'Resend 실제 호출은 정확히 1번이어야 한다 — 두 번이면 상한을 넘겨 발송한 것');
  const rejected = a.status === 429 ? a : b;
  assert.deepEqual(rejected.body, { error: 'QUOTA_REACHED' });
});

test('[동시 요청] 같은 idempotencyKey로 동시 재시도가 오면 우리 쪽 사전 조회가 둘 다 통과시킬 수 있다 — 이 경우에도 Resend에 보내는 Idempotency-Key는 동일해 Resend가 최종 방어선이 된다', async () => {
  // 이 테스트는 "우리 DB 사전 조회만으로는 동시 재시도의 중복 발송을 못
  // 막을 수 있다"는 한계를 있는 그대로 보여준다(마이그레이션 주석의 "문제
  // 2" 참고) — 대신 두 요청이 Resend에 보내는 Idempotency-Key가 동일함을
  // 확인해, 실제 중복 발송 방지는 Resend 쪽 처리에 달려 있음을 문서화한다.
  // 이 mock은 Resend의 실제 중복 제거 동작까지는 흉내내지 않는다(외부
  // 서비스라 이 저장소에서 검증할 수 없음).
  const h = serverHarness();
  const [a, b] = await Promise.all([h.send(), h.send()]); // 같은 payload = 같은 idempotencyKey
  assert.equal(h.calls.resendIdempotencyKeys.length >= 1, true);
  const uniqueKeys = new Set(h.calls.resendIdempotencyKeys);
  assert.equal(uniqueKeys.size, 1, '동시 재시도라도 Resend에 보내는 Idempotency-Key는 하나여야 Resend가 중복을 걸러낼 수 있다');
});

test('다른 idempotencyKey를 쓰는 별도 문의는 정상적으로 각각 발송된다', async () => {
  const h = serverHarness();
  const first = await h.send();
  assert.equal(first.status, 200);
  const second = await h.send({ idempotencyKey: '44444444-4444-4444-8444-444444444444' });
  assert.equal(second.status, 200);
  assert.equal(h.calls.delivery, 2, '서로 다른 문의는 각각 실제로 발송돼야 한다');
});

test('Resend 성공 후 기록(RPC)이 실패해도 사용자에게는 성공으로 응답한다(메일은 이미 전달됨)', async () => {
  const h = serverHarness({ recordError: true });
  const result = await h.send();
  assert.equal(result.status, 200, '메일이 실제로 전달됐다면 기록 실패를 이유로 실패라고 알리면 안 된다(재시도 시 중복 발송 위험)');
  assert.equal(h.calls.delivery, 1);
  assert.equal(h.calls.release, 0, '이미 성공했으니 예약을 되돌리면 안 된다(기록 실패와 발송 실패는 다르다)');
});

test('함정 필드가 채워진 자동 제출은 메일을 보내지 않는다', async () => {
  const h = serverHarness();
  const result = await h.send({ website: 'example.com' });
  assert.equal(result.status, 200);
  assert.equal(h.calls.claimAttempt, 0);
  assert.equal(h.calls.delivery, 0);
});

test('신뢰하지 않는 사이트에서의 요청은 공개 함수에서도 거부한다', async () => {
  const h = serverHarness();
  const result = await h.send({ __origin: 'https://evil.example' });
  assert.equal(result.status, 403);
  assert.equal(h.calls.getUser, 0, 'Origin이 거부되면 회원 확인까지 가지 않는다');
  assert.equal(h.calls.delivery, 0);
});

test('개발용 Origin은 기본값에 없다 — CONTACT_ALLOWED_ORIGINS로만 열 수 있다', async () => {
  const withoutDevOrigin = serverHarness();
  const blocked = await withoutDevOrigin.send({ __origin: 'http://localhost:3000' });
  assert.equal(blocked.status, 403, '기본 배포본은 localhost를 허용하면 안 된다(운영 코드에 개발용 origin 하드코딩 금지)');

  const withDevOrigin = serverHarness({ env: { CONTACT_ALLOWED_ORIGINS: 'https://launchdesk.co.kr,http://localhost:3000' } });
  const allowed = await withDevOrigin.send({ __origin: 'http://localhost:3000' });
  assert.equal(allowed.status, 200, '환경변수로 명시적으로 추가하면 로컬 개발 origin도 허용돼야 한다');
});

// 테스트 안에서 이메일 해시를 직접 계산 — 프로덕션 코드와 동일한 방식(추가
// 의존성 없이 Node 내장 webcrypto)으로 successCounts 맵의 키를 찾기 위함.
async function emailHashFor(email){
  const pepper = 'test-only';
  const bytes = new TextEncoder().encode(pepper + ':' + email.toLowerCase());
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MEMBER_SESSION = { user: { id: 'user-1', email: 'member@example.com' } };

// session: 처음 onAuthStateChange 구독 시 넘길 세션(기본은 회원, null이면 비회원).
// initialEmail: 폼 이메일 칸의 초기값(기본은 사용자가 직접 적은 주소를 흉내).
function browserHarness(result = { data: { ok: true }, error: null }, { session = MEMBER_SESSION, initialEmail = 'hello@example.com' } = {}){
  const ids = [
    'contactForm', 'contactGuestNotice', 'contactCategory', 'contactEmail', 'contactPhone', 'contactSubject',
    'contactMessage', 'contactConsent', 'contactWebsite', 'contactFormStatus', 'contactSubmit',
  ];
  const elements = new Map(ids.map((id) => [id, {
    id, value: '', checked: false, hidden: true, disabled: true, textContent: '',
    listeners: {}, classList: { value: '', toggle(name, present){ this.value = present ? name : ''; }, contains(name){ return this.value === name; } },
    addEventListener(name, fn){ this.listeners[name] = fn; },
    focus(){}, reportValidity(){ return true; },
    reset(){ for(const key of ['contactEmail', 'contactPhone', 'contactSubject', 'contactMessage']) elements.get(key).value = ''; },
  }]));
  elements.get('contactCategory').value = 'beginner';
  elements.get('contactEmail').value = initialEmail;
  elements.get('contactMessage').value = '온라인 쇼핑몰에 첫 상품을 올리려면 어디서 시작해야 하나요?';
  elements.get('contactConsent').checked = true;
  const calls = [];
  let nextResult = result;
  let authCallback = null;
  const docListeners = {};
  const sandbox = {
    document: {
      getElementById(id){ return elements.get(id) || null; },
      addEventListener(name, fn){ docListeners[name] = fn; },
    },
    location: { hash: '#/contact' },
    addEventListener(){},
    launchdeskSupabase: {
      // supabase-js처럼 구독 즉시 현재 세션(INITIAL_SESSION)으로 한 번 호출한다.
      auth: { onAuthStateChange(cb){ authCallback = cb; cb('INITIAL_SESSION', session); return { data: { subscription: { unsubscribe(){} } } }; } },
      functions: { async invoke(name, body){ calls.push({ name, body }); return typeof nextResult === 'function' ? nextResult(calls.length) : nextResult; } },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(browserSource, sandbox, { filename: 'contact.js' });
  return {
    elements, calls,
    setNextResult(r){ nextResult = r; },
    setSession(next){ authCallback(next ? 'SIGNED_IN' : 'SIGNED_OUT', next); },
    async submit(){ return elements.get('contactForm').listeners.submit({ preventDefault(){} }); },
    // 화면의 "질문하기" 링크(a[data-ask-subject]) 클릭을 흉내 낸다.
    clickAsk(attrs){
      const link = { getAttribute(name){ return attrs[name] ?? null; } };
      docListeners.click({ target: { closest(sel){ return sel === 'a[data-ask-subject]' ? link : null; } } });
    },
  };
}

test('질문하기: 어느 화면에서 왔는지 문의 유형 · 제목 기본값에 반영한다', () => {
  const h = browserHarness();
  h.elements.get('contactMessage').value = '';
  h.elements.get('contactCategory').value = 'service';
  h.clickAsk({ 'data-ask-category': 'beginner', 'data-ask-subject': '[STEP 02 · 사업자 · 플랫폼] 질문' });
  assert.equal(h.elements.get('contactCategory').value, 'beginner');
  assert.equal(h.elements.get('contactSubject').value, '[STEP 02 · 사업자 · 플랫폼] 질문');
  // 다른 화면에서 다시 오면 자동으로 채운 제목만 바뀐다
  h.clickAsk({ 'data-ask-category': 'beginner', 'data-ask-subject': '[자료실] 질문' });
  assert.equal(h.elements.get('contactSubject').value, '[자료실] 질문');
});

test('질문하기: 이용자가 쓴 제목 · 문의 내용은 덮어쓰지 않는다', () => {
  const h = browserHarness(); // 하니스 기본값: 문의 내용이 이미 적혀 있다
  h.clickAsk({ 'data-ask-category': 'partner', 'data-ask-subject': '[자료실] 질문' });
  assert.equal(h.elements.get('contactSubject').value, '쇼핑몰 시작 질문');
  assert.equal(h.elements.get('contactCategory').value, 'beginner');

  h.elements.get('contactMessage').value = '';
  h.elements.get('contactSubject').value = '제가 직접 쓴 제목';
  h.clickAsk({ 'data-ask-category': 'partner', 'data-ask-subject': '[자료실] 질문' });
  assert.equal(h.elements.get('contactSubject').value, '제가 직접 쓴 제목');
  assert.equal(h.elements.get('contactCategory').value, 'beginner');
});

test('질문하기 링크는 #/contact로만 이동하고 URL에 제목 · 내용을 싣지 않는다', () => {
  const links = html.match(/<a [^>]*data-ask-subject[^>]*>/g) || [];
  assert.ok(links.length >= 12, '홈 · STEP 00~08 · 자료실 진입점: ' + links.length);
  for (const a of links) assert.match(a, /href="#\/contact"/);
  assert.doesNotMatch(html, /#\/contact\?/);
  assert.match(fs.readFileSync(path.join(root, 'resources.js'), 'utf8'), /href="#\/contact" data-ask-category="beginner" data-ask-subject="' \+\s*escapeHtml\(/);
  assert.doesNotMatch(browserSource, /sessionStorage|localStorage|location\.hash\s*=/);
});

function invokeError(code){
  return { data: null, error: { context: { json: async () => ({ error: code }) } } };
}

test('문의 화면: 비회원용 로그인 안내(기존 로그인 모달로 여는 #/login 링크)가 있고 Turnstile은 남아 있지 않다', () => {
  const view = html.slice(html.indexOf('id="view-contact"'), html.indexOf('id="view-privacy"'));
  const notice = view.match(/<div class="empty-state" id="contactGuestNotice" hidden>[\s\S]*?<\/div>\s*<\/div>|<div class="empty-state" id="contactGuestNotice" hidden>[\s\S]*?href="#\/login"/);
  assert.ok(notice, '비회원 로그인 안내 블록을 찾지 못함');
  assert.match(notice[0], /href="#\/login"/);
  assert.match(view, /id="contactForm" novalidate hidden/, '세션 확인 전에는 폼을 숨겨 둔다');
  assert.doesNotMatch(html, /turnstile/i, 'index.html에 Turnstile 흔적(메타 태그·위젯)이 없어야 한다');
  assert.doesNotMatch(browserSource, /turnstile|challenges\.cloudflare/i);
});

test('비회원: 폼 대신 로그인 안내를 보여주고, 제출해도 서버를 호출하지 않는다', async () => {
  const h = browserHarness(undefined, { session: null });
  assert.equal(h.elements.get('contactGuestNotice').hidden, false);
  assert.equal(h.elements.get('contactForm').hidden, true);
  assert.equal(h.elements.get('contactSubmit').disabled, true);
  await h.submit();
  assert.equal(h.calls.length, 0);
});

test('회원: 폼을 보여주고 답장 이메일 칸을 로그인 계정 이메일로 채운다', () => {
  const h = browserHarness(undefined, { initialEmail: '' });
  assert.equal(h.elements.get('contactGuestNotice').hidden, true);
  assert.equal(h.elements.get('contactForm').hidden, false);
  assert.equal(h.elements.get('contactSubmit').disabled, false);
  assert.equal(h.elements.get('contactEmail').value, 'member@example.com');
});

test('회원이 답장 이메일을 직접 고쳤다면 세션 갱신 때 덮어쓰지 않고, 로그아웃하면 자동으로 채운 계정 이메일은 지운다', () => {
  const h = browserHarness(undefined, { initialEmail: '' });
  const email = h.elements.get('contactEmail');
  email.value = 'other@example.com';
  h.setSession(MEMBER_SESSION); // TOKEN_REFRESHED 등
  assert.equal(email.value, 'other@example.com');

  const h2 = browserHarness(undefined, { initialEmail: '' });
  h2.setSession(null);
  assert.equal(h2.elements.get('contactEmail').value, '', '이전 계정 이메일이 남으면 안 된다');
  assert.equal(h2.elements.get('contactForm').hidden, true);
  assert.equal(h2.elements.get('contactGuestNotice').hidden, false);
});

test('회원 제출: Turnstile 토큰 없이 서버 함수로 보내고, 성공 후에는 계정 이메일을 다시 기본값으로 채운다', async () => {
  const h = browserHarness(undefined, { initialEmail: '' });
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.body.email, 'member@example.com');
  assert.equal('turnstileToken' in h.calls[0].body.body, false);
  assert.equal(h.elements.get('contactEmail').value, 'member@example.com');
});

test('서버가 LOGIN_REQUIRED로 거부하면 다시 로그인하라고 안내하고 입력은 유지한다', async () => {
  const h = browserHarness(invokeError('LOGIN_REQUIRED'));
  const original = h.elements.get('contactMessage').value;
  await h.submit();
  assert.match(h.elements.get('contactFormStatus').textContent, /로그인이 필요해요/);
  assert.equal(h.elements.get('contactMessage').value, original);
});

test('문의 유형을 바꾸면 기본 제목만 바꾸고 직접 쓴 제목은 유지한다', () => {
  const h = browserHarness();
  const category = h.elements.get('contactCategory');
  const subject = h.elements.get('contactSubject');
  assert.equal(subject.value, '쇼핑몰 시작 질문');
  category.value = 'partner';
  category.listeners.change();
  assert.equal(subject.value, '택배·도매 제휴 문의');
  subject.value = '직접 정한 제목';
  category.value = 'service';
  category.listeners.change();
  assert.equal(subject.value, '직접 정한 제목');
});

test('브라우저 문의는 서버 함수로 전송하고 메일 앱을 열지 않는다', async () => {
  const h = browserHarness();
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'contact-inquiry');
  assert.equal(h.calls[0].body.body.email, 'hello@example.com');
  assert.match(h.calls[0].body.body.idempotencyKey, /^[0-9a-f-]{36}$/i, 'idempotencyKey를 함께 보내야 한다');
  assert.equal(h.elements.get('contactFormStatus').textContent, '문의가 접수됐어요. 입력하신 이메일로 답변드릴게요.');
});

test('전송 실패 시 입력 내용과 동의를 유지하고 성공이라고 말하지 않는다', async () => {
  const h = browserHarness({ data: null, error: { message: 'server error' } });
  const original = h.elements.get('contactMessage').value;
  await h.submit();
  assert.equal(h.elements.get('contactMessage').value, original);
  assert.equal(h.elements.get('contactConsent').checked, true);
  assert.match(h.elements.get('contactFormStatus').textContent, /전송에 실패/);
});

test('실패 후 아무것도 안 고치고 재시도하면 같은 idempotencyKey를 그대로 재사용한다', async () => {
  const h = browserHarness({ data: null, error: { message: 'server error' } });
  await h.submit();
  const firstKey = h.calls[0].body.body.idempotencyKey;
  await h.submit();
  const secondKey = h.calls[1].body.body.idempotencyKey;
  assert.equal(secondKey, firstKey, '내용을 안 바꾼 재시도는 서버가 중복 여부를 판단할 수 있도록 같은 key를 보내야 한다');
});

test('실패 후 입력(문의 내용)을 고쳐서 재시도하면 다른 idempotencyKey를 쓴다', async () => {
  const h = browserHarness({ data: null, error: { message: 'server error' } });
  await h.submit();
  const firstKey = h.calls[0].body.body.idempotencyKey;
  h.elements.get('contactMessage').value = '고친 문의 내용입니다. 배송 관련 질문이에요.';
  await h.submit();
  const secondKey = h.calls[1].body.body.idempotencyKey;
  assert.notEqual(secondKey, firstKey, '입력을 고쳐 다시 제출했다면 새 문의로 취급해 새 key를 써야 한다(예전 응답 재사용 방지)');
});

test('성공 후 새 문의를 보내면 idempotencyKey가 바뀐다', async () => {
  const h = browserHarness({ data: { ok: true }, error: null });
  await h.submit();
  const firstKey = h.calls[0].body.body.idempotencyKey;
  h.elements.get('contactMessage').value = '두 번째 문의 내용입니다. 배송이 궁금해요.';
  await h.submit();
  const secondKey = h.calls[1].body.body.idempotencyKey;
  assert.notEqual(secondKey, firstKey, '성공한 뒤에는 다음 문의에 새 key를 써야 한다');
});

test('QUOTA_REACHED는 "오늘 문의 가능 횟수를 모두 사용했어요"로, ATTEMPT_LIMIT은 다른 문구로 안내한다', async () => {
  const quota = browserHarness(invokeError('QUOTA_REACHED'));
  await quota.submit();
  assert.match(quota.elements.get('contactFormStatus').textContent, /오늘 문의 가능 횟수를 모두 사용했어요/);

  const attemptLimit = browserHarness(invokeError('ATTEMPT_LIMIT'));
  await attemptLimit.submit();
  assert.match(attemptLimit.elements.get('contactFormStatus').textContent, /지금은 문의를 보낼 수 없어요/);
  assert.doesNotMatch(attemptLimit.elements.get('contactFormStatus').textContent, /오늘 문의 가능 횟수를 모두 사용했어요/);
});
