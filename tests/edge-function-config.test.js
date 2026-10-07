/* Edge Function 배포 설정 · AI 호출 경로 점검 — 실행: node --test

   1) supabase/config.toml의 verify_jwt: 외부 서비스(Cafe24 · Meta)가 사용자 브라우저를
      리다이렉트로 보내는 OAuth 콜백 2개만 false여야 한다. cafe24-oauth-callback 항목이
      없으면 다시 배포할 때 기본값(true)이 적용돼 콜백이 401로 막히고 Cafe24 연결이 끊긴다.
   2) Claude API를 부르는 함수 중 ai-insights는 베타 동안 비활성화(이용 횟수 · 예산 · 스위치가
      없는 경로)이고, 화면 어디에서도 부르지 않는다. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'supabase', 'functions');
const CONFIG = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');

// [functions.<이름>] 다음의 verify_jwt 값을 모은다(주석 줄 제외).
function functionJwtSettings(toml) {
  const out = {};
  let current = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#') || !line) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) { const m = section[1].match(/^functions\.([a-z0-9-]+)$/); current = m ? m[1] : null; if (current) out[current] = undefined; continue; }
    const kv = line.match(/^verify_jwt\s*=\s*(true|false)$/);
    if (current && kv) out[current] = kv[1] === 'true';
  }
  return out;
}
const settings = functionJwtSettings(CONFIG);

test('cafe24-oauth-callback · meta-oauth-callback은 verify_jwt = false로 명시돼 있다', () => {
  assert.equal(settings['cafe24-oauth-callback'], false);
  assert.equal(settings['meta-oauth-callback'], false);
});

test('verify_jwt = false는 OAuth 콜백 2개뿐 — 나머지 등록 함수는 모두 true(값 누락 없음)', () => {
  const off = Object.keys(settings).filter((name) => settings[name] === false).sort();
  assert.deepEqual(off, ['cafe24-oauth-callback', 'meta-oauth-callback']);
  for (const [name, value] of Object.entries(settings)) assert.equal(typeof value, 'boolean', name + ' verify_jwt 값 없음');
});

test('config.toml에 등록된 함수는 모두 실제 함수 폴더가 있다', () => {
  for (const name of Object.keys(settings)) {
    assert.ok(fs.existsSync(path.join(FUNCTIONS, name, 'index.ts')), name);
  }
});

test('JWT 검사를 끈 콜백은 함수 안에서 OAuth state를 원자적으로 claim해 위조 · 재사용 요청을 거른다', () => {
  for (const name of ['cafe24-oauth-callback', 'meta-oauth-callback']) {
    const src = fs.readFileSync(path.join(FUNCTIONS, name, 'index.ts'), 'utf8');
    assert.match(src, /withSupabase\(\{ auth: "none" \}/, name);
    assert.match(src, /\.from\("oauth_states"\)\s*\.update\(\{\s*used_at:\s*nowIso\s*\}\)[\s\S]{0,200}\.is\("used_at",\s*null\)\s*\.gt\("expires_at",\s*nowIso\)/, name);
  }
});

test('ai-insights: 비활성화 스위치가 켜져 있고, 키를 읽기 전에 멈춘다', () => {
  const src = fs.readFileSync(path.join(FUNCTIONS, 'ai-insights', 'index.ts'), 'utf8');
  assert.match(src, /const AI_INSIGHTS_DISABLED = true;/);
  const guard = src.indexOf('if (AI_INSIGHTS_DISABLED)');
  assert.ok(guard > -1);
  assert.ok(guard < src.indexOf('Deno.env.get("ANTHROPIC_API_KEY")'), '키를 읽기 전에 멈춰야 함');
  assert.ok(guard < src.indexOf('api.anthropic.com'), 'Claude API 호출 전에 멈춰야 함');
});

test('Claude API를 부르는 함수는 ai-insights · ai-weekly-review 둘뿐이다', () => {
  const callers = fs.readdirSync(FUNCTIONS).filter((d) => {
    const f = path.join(FUNCTIONS, d, 'index.ts');
    return fs.existsSync(f) && /api\.anthropic\.com/.test(fs.readFileSync(f, 'utf8'));
  }).sort();
  assert.deepEqual(callers, ['ai-insights', 'ai-weekly-review']);
});

test('화면(LaunchROAS · 런치데스크) 어디에서도 ai-insights를 부르지 않는다', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'launchroas')).filter((f) => /\.(js|html)$/.test(f) && !/\.test\.js$/.test(f)).map((f) => path.join(ROOT, 'launchroas', f)),
    ...fs.readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f)).map((f) => path.join(ROOT, f)),
  ];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /['"]ai-insights['"]/, path.relative(ROOT, f));
});
