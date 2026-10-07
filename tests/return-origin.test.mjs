import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ALLOWED_RETURN_ORIGINS, allowedReturnOrigin } from '../supabase/functions/_shared/return-origin.ts';

test('소유가 확인된 정확한 LaunchROAS Origin만 복귀 주소로 허용한다', () => {
  for (const origin of ALLOWED_RETURN_ORIGINS) assert.equal(allowedReturnOrigin(origin), origin);
  assert.equal(allowedReturnOrigin('https://launchroas-git-preview-launchroas-apple-launchdesk.vercel.app'),
    'https://launchroas-git-preview-launchroas-apple-launchdesk.vercel.app');
  for (const bad of [
    'https://launchroas-evil-launchdesk.vercel.app',          // 예전 이름 패턴에 맞던 외부 주소
    'https://launchroas-abc-evil-launchdesk.vercel.app',
    'https://launchroas-88oq4pa5f-launchdesk.vercel.app.evil.com',
    'https://evil.com/?https://launchroas.vercel.app',
    'http://launchroas.vercel.app',                           // http 거부
    'https://launchroas.vercel.app/',                         // Origin이 아닌 URL 형태 거부
    'https://LAUNCHROAS.vercel.app',
    'https://launchroas.vercel.app:8443',
    'https://launchroas.co.kr',                               // 소유 확인 전 도메인
    'http://127.0.0.1:5173',
    '', null, undefined, 42, ['https://launchroas.vercel.app'],
  ]) assert.equal(allowedReturnOrigin(bad), null, String(bad));
});

test('LAUNCHROAS_RETURN_ORIGIN은 정확히 같은 값만 추가로 허용한다', () => {
  const configured = 'https://launchroas-newpreview-launchdesk.vercel.app';
  assert.equal(allowedReturnOrigin(configured, configured), configured);
  assert.equal(allowedReturnOrigin(configured + '/', configured), null);
  assert.equal(allowedReturnOrigin('https://launchroas-other-launchdesk.vercel.app', configured), null);
  assert.equal(allowedReturnOrigin('', ''), null);
});

test('OAuth 함수 4개는 공용 허용 목록을 쓰고 이름 패턴을 남기지 않는다', () => {
  for (const name of ['cafe24-oauth-start', 'cafe24-oauth-callback', 'meta-oauth-start', 'meta-oauth-callback']) {
    const src = fs.readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
    assert.match(src, /from "\.\.\/_shared\/return-origin\.ts"/, name);
    assert.doesNotMatch(src, /vercel\\?\.app/, name);
  }
});

test('콜백은 state의 제공자·미사용·만료 조건으로 한 번만 사용 처리한다', () => {
  for (const [name, provider] of [['cafe24-oauth-callback', 'cafe24'], ['meta-oauth-callback', 'meta']]) {
    const src = fs.readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
    assert.match(src, /\.update\(\{ used_at: nowIso \}\)/, name);
    assert.match(src, new RegExp(`\\.eq\\("provider", "${provider}"\\)`), name);
    assert.match(src, /\.is\("used_at", null\)/, name);
    assert.match(src, /\.gt\("expires_at", nowIso\)/, name);
  }
});
