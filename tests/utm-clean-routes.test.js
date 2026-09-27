'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'utm-acquisition.js'), 'utf8');

function firstTouch({ hash = '', route = null, search = '?utm_source=naver_blog&utm_medium=organic&utm_campaign=margin_29000' } = {}){
  const saved = {};
  const sandbox = {
    location: { hostname: 'launchdesk.co.kr', pathname: '/tools/margin-calculator/', hash, search },
    document: { body: { getAttribute: name => name === 'data-route' ? route : null } },
    localStorage: {
      getItem: key => saved[key] || null,
      setItem: (key, value) => { saved[key] = value; },
      removeItem: key => { delete saved[key]; }
    },
    URLSearchParams, Date, console, window: {}
  };
  vm.runInNewContext(src, sandbox);
  return JSON.parse(saved['ld-pending-acquisition']);
}

test('blog UTM landing on a public calculator URL keeps the real app route and only allowed attribution fields', () => {
  const value = firstTouch({ route: '/tools' });
  assert.equal(value.source, 'naver_blog');
  assert.equal(value.medium, 'organic');
  assert.equal(value.campaign, 'margin_29000');
  assert.equal(value.landing_path, '/tools');
  assert.deepEqual(Object.keys(value).sort(), ['campaign','content','landing_path','medium','saved_at','source','term']);
});

test('unrecognised route attributes and auth callback hashes cannot place arbitrary paths in attribution', () => {
  assert.equal(firstTouch({ route: '/secret/email@example.com', hash: '#access_token=private' }).landing_path, '/');
  assert.equal(firstTouch({ route: '/tools', hash: '#access_token=private' }).landing_path, '/');
  assert.equal(firstTouch({ route: '/resources/marketplace-vs-own' }).landing_path, '/resources/marketplace-vs-own');
});
