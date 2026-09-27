const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PAGES, renderPage } = require('../scripts/build-seo-pages.js');
const data = require('../resources-data.js');

test('each public search page has distinct metadata, useful content and a discoverable link', () => {
  const root = path.join(__dirname, '..');
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  for(const page of PAGES){
    const html = renderPage(page);
    assert.ok(home.includes(`href="${page.route}"`), `missing homepage link to ${page.route}`);
    assert.ok(sitemap.includes(`https://launchdesk.co.kr${page.route}`), `missing sitemap entry for ${page.route}`);
    assert.ok(html.includes(`<link rel="canonical" href="https://launchdesk.co.kr${page.route}">`));
    assert.ok(html.includes(`<h1>${page.heading}</h1>`));
    assert.ok(html.includes(data.getGuide(page.slug).intro));
    assert.ok(html.includes(`href="${page.actionHref}"`));
    assert.ok(html.includes('<meta name="description"'));
    assert.ok(!html.includes('name="robots" content="noindex"'));
  }
  assert.equal(new Set(PAGES.map(page => page.route)).size, PAGES.length);
});
