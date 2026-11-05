const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');

test('frontend shell exposes navigation and application outlet without guide or status clutter', () => {
  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  for (const route of ['overview', 'check', 'search', 'explore', 'analytics']) {
    assert.match(html, new RegExp(`data-route="${route}"`));
  }
  assert.match(html, /id="app"/);
  assert.doesNotMatch(html, /Demo guide|id="demo-guide"|id="guide-open"|id="guide-close"/);
  assert.doesNotMatch(html, /Local API connected/);
  assert.doesNotMatch(html, /India regulatory scope/);
  assert.doesNotMatch(html, /FSSAI \/ FIRA records/);
  assert.doesNotMatch(html, /Cached snapshot · offline ready/);
  assert.match(html, /styles\.css/);
  assert.match(html, /app\.js/);
});

test('frontend controller implements all primary views and API integration', () => {
  const js = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  for (const name of ['renderOverview', 'renderSearch', 'renderIncident', 'renderEntity', 'renderExplore', 'renderAnalytics']) {
    assert.match(js, new RegExp(`function ${name}`));
  }
  for (const endpoint of ['/api/summary', '/api/search', '/api/incidents/', '/api/entities/', '/api/relationships', '/api/analytics']) {
    assert.ok(js.includes(endpoint), `missing endpoint ${endpoint}`);
  }
  assert.match(js, /Indian point of rejection/);
  assert.match(js, /Food Safety and Standards Authority of India \(FSSAI\)/);
  assert.match(js, /Within the collected FIRA records/);
  assert.match(js, /official cached FIRA records/);
  assert.match(js, /Measurement not available in cached index record/);
  assert.doesNotMatch(js, /openGuide|closeGuide|#demo-guide|#guide-open|#guide-close/);
  assert.match(js, /class="network-label"/);
  assert.match(js, /const anchor = incidentLabel \? 'end' : 'start'/);
  assert.match(js, /const labelY = incidentLabel \? p\.y \+ radius \+ 16 : p\.y - radius - 8/);
  assert.match(js, /text-anchor="\$\{anchor\}"/);
});

test('styles include responsive, focus, loading, empty and reduced-motion states', () => {
  const css = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.loading-state/);
  assert.match(css, /\.empty-state/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /Hallmark · genre: editorial · macrostructure: Map \/ Diagram/);
  assert.match(css, /--body: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif/);
  assert.doesNotMatch(css, /Avenir Next|Times New Roman/);
  assert.match(css, /--radius-card: 16px/);
  assert.match(css, /--radius-control: 10px/);
  assert.doesNotMatch(css, /\.guide-panel|\.guide-head|\.guide-steps|\.guide-note/);
  assert.match(css, /\.network-label[^}]*paint-order:\s*stroke fill/);
});

test('business safety checker exposes a complete explainable workflow', () => {
  const js = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
  assert.match(js, /function renderProductCheck/);
  assert.ok(js.includes('/api/catalog'));
  assert.ok(js.includes('/api/product-check'));
  for (const id of ['check-product', 'check-category', 'check-origin', 'check-supplier', 'check-batch', 'check-barcode']) {
    assert.match(js, new RegExp(`for="${id}"`));
  }
  for (const status of ['historical-alert-match', 'review-recommended', 'no-known-alert-match']) {
    assert.ok(js.includes(status), `missing result state ${status}`);
  }
  assert.doesNotMatch(js, /class="(?:safe|unsafe)-badge"/);
  assert.match(css, /\.checker-shell/);
  assert.match(css, /\.catalogue-grid/);
  assert.match(css, /\.check-result/);
  assert.match(css, /\.check-status/);
});
