const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { staticFilesFor } = require('../scripts/build-static-output.js');

test('production bundle includes every stylesheet and script referenced by the page', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = staticFilesFor(html);
  const css = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)]
    .map(m => m[1]).filter(url => !/^https?:\/\//.test(url));
  const js = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => m[1]).filter(url => !/^https?:\/\//.test(url));
  assert.ok(css.length > 1, 'the site uses multiple themed stylesheets');
  for(const file of [...css, ...js]){
    assert.ok(files.includes(file), `missing from deployment: ${file}`);
    assert.ok(fs.existsSync(path.join(root, file)), `missing on disk: ${file}`);
  }
  assert.equal(files.length, new Set(files).size);
});
