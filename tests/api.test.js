const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppServer } = require('../server');

async function withServer(run) {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('health and summary report a valid cached dataset', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/api/health`).then(response => response.json());
    const summary = await fetch(`${base}/api/summary`).then(response => response.json());
    assert.equal(health.status, 'ok');
    assert.deepEqual(health.processing, {
      status: 'ready',
      language: 'Python',
      service: 'foodsafe-processing',
    });
    assert.equal(health.data.valid, true);
    assert.equal(summary.datasetMode, 'official_cached_snapshot');
    assert.equal(summary.totalIncidents, 18);
    assert.equal(summary.regulatoryContext.jurisdiction, 'India');
    assert.equal(summary.regulatoryContext.authority, 'Food Safety and Standards Authority of India (FSSAI)');
    assert.ok(summary.options.ports.includes('Mumbai-JNPT Nhava Sheva'));
    assert.equal(summary.officialRecordCount, 18);
    assert.equal(summary.illustrativeCatalogCount, 36);
    assert.equal(summary.catalogCategoryCount, 12);
    assert.ok(summary.latest.every(item => !item.id.includes('DEMO')));
  });
});

test('search endpoint filters by Indian point of rejection', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/search?q=aflatoxin&port=Mumbai-JNPT%20Nhava%20Sheva`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 1);
    assert.ok(result.items.every(item => item.port === 'Mumbai-JNPT Nhava Sheva'));
  });
});

test('search endpoint returns ranked matches and honors filters', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/search?q=aflatoxin+pistachio&country=Iran`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 1);
    assert.equal(result.items[0].country, 'Iran');
    assert.ok(result.items[0].matchReasons.length > 0);
  });
});

test('incident and entity endpoints return linked intelligence', async () => {
  await withServer(async base => {
    const incident = await fetch(`${base}/api/incidents/RNCC202500000512`).then(response => response.json());
    const entity = await fetch(`${base}/api/entities/product-tea-bags`).then(response => response.json());
    assert.equal(incident.product, 'PISTACHIO KERNEL');
    assert.ok(incident.related.length >= 1);
    assert.equal(entity.entity.name, 'Tea bag products');
    assert.equal(entity.incidents.length, 3);
  });
});

test('unknown API records return structured 404 responses', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/incidents/NOT-THERE`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Incident not found' });
  });
});

test('analytics and relationships are derived from shared records', async () => {
  await withServer(async base => {
    const analytics = await fetch(`${base}/api/analytics`).then(response => response.json());
    const graph = await fetch(`${base}/api/relationships?entity=port-mumbai-jnpt`).then(response => response.json());
    assert.equal(analytics.total, 18);
    assert.ok(graph.nodes.some(node => node.id === 'port-mumbai-jnpt'));
    assert.ok(graph.links.length >= 3);
  });
});

test('catalog endpoint separates illustrative inventory from official records', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/catalog`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 36);
    assert.ok(result.categories.length >= 12);
    assert.ok(result.items.every(item => item.illustrative === true));
    assert.match(result.disclosure, /illustrative/i);
  });
});

test('product check returns explainable official evidence without certification labels', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/product-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogId: 'nut-pistachio', productName: 'Pistachio kernel', originCountry: 'Iran' }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'historical-alert-match');
    assert.equal(result.matchedIncidents[0].id, 'RNCC202500000512');
    assert.match(result.matchedIncidents[0].sourceUrl, /^https:\/\/fira\.fssai\.gov\.in\//);
    assert.ok(!['safe', 'unsafe', 'approved', 'certified'].includes(result.status));
    assert.ok(result.nextSteps.length >= 3);
  });
});

test('product check rejects an empty product with structured field errors', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/product-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Product name is required',
      fields: { productName: 'Enter a product name or choose a sample product.' },
    });
  });
});

test('unknown barcode still checks a supplied product name', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/product-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: '0000000000000', productName: 'Roasted seaweed' }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'historical-alert-match');
    assert.equal(result.catalogMatch, null);
  });
});

test('product check rejects malformed body and non-text fields', async () => {
  await withServer(async base => {
    for (const payload of ['{broken', 'null', '[]', '{"productName":{"nested":"food"}}', '{"productName":"!!!"}']) {
      const response = await fetch(`${base}/api/product-check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      });
      assert.equal(response.status, 400, payload);
      const body = await response.json();
      assert.equal(typeof body.error, 'string');
      assert.equal(typeof body.fields, 'object');
    }
  });
});
