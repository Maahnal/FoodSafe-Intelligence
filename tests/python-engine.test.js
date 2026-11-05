const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const incidents = require('../data/incidents.json');
const catalog = require('../data/catalog.json');
const worker = path.join(__dirname, '..', 'python', 'engine.py');

function runProductCheck(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BINARY || 'python3', [worker], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `worker exited ${code}`));
      resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify({
      operation: 'product_check',
      payload: { input, catalog, incidents },
    }));
  });
}

test('product checker reports a strong pistachio historical alert match', async () => {
  const result = await runProductCheck({ catalogId: 'nut-pistachio', productName: 'Pistachio kernel' });
  assert.equal(result.status, 'historical-alert-match');
  assert.equal(result.catalogMatch.id, 'nut-pistachio');
  assert.equal(result.matchedIncidents[0].id, 'RNCC202500000512');
  assert.ok(result.signals.some(signal => signal.includes('product')));
});

test('category-only overlap recommends review without claiming an exact alert', async () => {
  const result = await runProductCheck({ catalogId: 'nut-cashew', productName: 'Cashew kernels' });
  assert.equal(result.status, 'review-recommended');
  assert.ok(result.matchedIncidents.length > 0);
  assert.ok(result.matchedIncidents.every(item => item.matchStrength !== 'strong-product'));
});

test('unrelated product returns no known alert match', async () => {
  const result = await runProductCheck({
    productName: 'Kodo millet flour', category: 'Traditional millet foods', originCountry: 'India',
  });
  assert.equal(result.status, 'no-known-alert-match');
  assert.deepEqual(result.matchedIncidents, []);
});

test('product matching normalizes capitalization and repeated spaces', async () => {
  const normal = await runProductCheck({ productName: 'Pistachio kernel', originCountry: 'Iran' });
  const noisy = await runProductCheck({ productName: '  PISTACHIO   KERNEL  ', originCountry: 'IRAN' });
  assert.equal(noisy.status, normal.status);
  assert.deepEqual(noisy.matchedIncidents.map(item => item.id), normal.matchedIncidents.map(item => item.id));
});

test('unknown barcode falls back to a valid typed product name', async () => {
  const result = await runProductCheck({ barcode: '0000000000000', productName: 'Roasted seaweed' });
  assert.equal(result.status, 'historical-alert-match');
  assert.equal(result.catalogMatch, null);
  assert.equal(result.matchedIncidents[0].id, 'RNCC202400000691');
});

test('an omitted category does not create unrelated fruit-category matches', async () => {
  const result = await runProductCheck({ productName: 'Whole wheat atta' });
  assert.equal(result.status, 'no-known-alert-match');
  assert.deepEqual(result.matchedIncidents, []);
});

test('generic powder wording does not imply a matching commodity', async () => {
  for (const productName of ['Haldi powder', 'Milk powder', 'Whey protein powder']) {
    const result = await runProductCheck({ productName });
    assert.notEqual(result.status, 'historical-alert-match', productName);
  }
});

test('a typed name overrides stale catalogue barcode and aliases', async () => {
  const result = await runProductCheck({
    productName: 'Whole wheat atta', barcode: '8901000000019', catalogId: 'nut-pistachio',
  });
  assert.equal(result.status, 'no-known-alert-match');
  assert.equal(result.catalogMatch, null);
});

test('supplier and batch values never establish a verified shipment match', async () => {
  const a = await runProductCheck({ productName: 'Pistachio kernel' });
  const b = await runProductCheck({ productName: 'Pistachio kernel', supplier: 'New supplier', batch: 'BATCH-987' });
  assert.deepEqual(a.matchedIncidents, b.matchedIncidents);
  assert.ok(b.verificationGaps.some(value => value.includes('batch')));
});

test('official category wording maps spices and confectionery to broad review evidence', async () => {
  const spice = await runProductCheck({ productName: 'Haldi powder', category: 'Spices & condiments' });
  assert.equal(spice.status, 'review-recommended');
  assert.ok(spice.matchedIncidents.some(item => item.id === 'NCC202400021243'));
  const jelly = await runProductCheck({ catalogId: 'snack-fruit-jelly', productName: 'Fruit jelly cups' });
  assert.equal(jelly.status, 'review-recommended');
  assert.ok(jelly.matchedIncidents.some(item => item.id === 'NCC202400109012'));
});

test('generic product-format words cannot create strong phrase matches', async () => {
  for (const productName of ['powder', 'fresh', 'whole', 'roasted']) {
    const result = await runProductCheck({ productName });
    assert.equal(result.status, 'no-known-alert-match', productName);
  }
});
