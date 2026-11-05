const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  expandIntent,
  searchIncidents,
  getRelatedIncidents,
  getEntityProfile,
  getRelationships,
  buildAnalytics,
  validateDataset,
} = require('../lib/engine');
const dataValidator = require('../scripts/validate-data');

const catalogPath = path.join(__dirname, '..', 'data', 'catalog.json');
const catalog = fs.existsSync(catalogPath) ? require(catalogPath) : [];

const incidents = [
  {
    id: 'FIRA-001', product: 'Roasted Pistachios', category: 'Nuts & Seeds',
    country: 'Iran', exporter: 'Mehr Food Exports', date: '2025-08-19',
    contaminant: 'Aflatoxin B1', violationClass: 'Contaminant above limit',
    reason: 'Aflatoxin B1 measured above the prescribed limit', port: 'Mumbai',
    measured: 18.4, limit: 8, unit: 'µg/kg', entityIds: ['org-mehr', 'product-pistachio'],
    sourceUrl: 'https://fira.fssai.gov.in/view_details.php?rid=DEMO001', confidence: 0.96,
  },
  {
    id: 'FIRA-002', product: 'Turmeric Powder', category: 'Spices',
    country: 'Bangladesh', exporter: 'Eastern Harvest Ltd', date: '2025-06-10',
    contaminant: 'Lead', violationClass: 'Heavy metal above limit',
    reason: 'Lead content above prescribed maximum', port: 'Kolkata',
    measured: 3.2, limit: 2.5, unit: 'mg/kg', entityIds: ['org-eastern', 'product-turmeric'],
    sourceUrl: 'https://fira.fssai.gov.in/view_details.php?rid=DEMO002', confidence: 0.93,
  },
  {
    id: 'FIRA-003', product: 'Pistachio Kernels', category: 'Nuts & Seeds',
    country: 'Iran', exporter: 'Mehr Foods Export Co.', date: '2024-11-04',
    contaminant: 'Aflatoxin B1', violationClass: 'Contaminant above limit',
    reason: 'Aflatoxin B1 exceeds permitted value', port: 'Nhava Sheva',
    measured: 14.1, limit: 8, unit: 'µg/kg', entityIds: ['org-mehr', 'product-pistachio'],
    sourceUrl: 'https://fira.fssai.gov.in/view_details.php?rid=DEMO003', confidence: 0.91,
  },
];

const entities = [
  { id: 'org-mehr', type: 'Exporter', name: 'Mehr Food Exports', aliases: ['Mehr Foods Export Co.'] },
  { id: 'product-pistachio', type: 'Product', name: 'Pistachio products', aliases: ['Roasted Pistachios', 'Pistachio Kernels'] },
  { id: 'org-eastern', type: 'Exporter', name: 'Eastern Harvest Ltd', aliases: [] },
  { id: 'product-turmeric', type: 'Product', name: 'Turmeric Powder', aliases: [] },
];

test('expands a heavy metal intent into known contaminants', () => {
  const terms = expandIntent('show heavy metal contamination');
  assert.ok(terms.includes('lead'));
  assert.ok(terms.includes('arsenic'));
  assert.ok(terms.includes('cadmium'));
});

test('ranks a multi-term evidence match above a partial match', () => {
  const result = searchIncidents(incidents, entities, { q: 'aflatoxin pistachio iran' });
  assert.equal(result.items[0].id, 'FIRA-001');
  assert.ok(result.items[0].matchReasons.length >= 3);
  assert.equal(result.total, 2);
});

test('supports empty query and combined AND filters', () => {
  const result = searchIncidents(incidents, entities, {
    q: '   !!! ', country: 'Iran', category: 'Nuts & Seeds', year: '2024',
  });
  assert.deepEqual(result.items.map(item => item.id), ['FIRA-003']);
});

test('filters FIRA records by Indian point of rejection', () => {
  const result = searchIncidents(incidents, entities, { port: 'Mumbai' });
  assert.deepEqual(result.items.map(item => item.id), ['FIRA-001']);
});

test('finds related incidents and explains shared signals', () => {
  const related = getRelatedIncidents(incidents[0], incidents);
  assert.equal(related[0].id, 'FIRA-003');
  assert.ok(related[0].sharedSignals.includes('same normalized entity'));
  assert.ok(related[0].sharedSignals.includes('same contaminant'));
});

test('builds an entity profile using aliases and linked incidents', () => {
  const profile = getEntityProfile('org-mehr', incidents, entities);
  assert.equal(profile.entity.name, 'Mehr Food Exports');
  assert.equal(profile.incidents.length, 2);
  assert.deepEqual(profile.timeline.map(item => item.year), [2024, 2025]);
});

test('creates graph nodes and links from shared data', () => {
  const graph = getRelationships(incidents, entities);
  assert.ok(graph.nodes.some(node => node.id === 'org-mehr'));
  assert.ok(graph.links.some(link => link.source === 'org-mehr' && link.target === 'FIRA-001'));
});

test('aggregates analytics without hard-coded totals', () => {
  const analytics = buildAnalytics(incidents);
  assert.equal(analytics.total, 3);
  assert.deepEqual(analytics.byCountry[0], { label: 'Iran', value: 2 });
  assert.equal(analytics.limitExceedances.averageMultiple, 1.78);
});

test('data validation reports duplicates, malformed dates and missing source URLs', () => {
  const broken = [
    incidents[0],
    { ...incidents[0], date: 'not-a-date', sourceUrl: '' },
  ];
  const report = validateDataset(broken, entities);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.includes('Duplicate incident ID')));
  assert.ok(report.errors.some(error => error.includes('Invalid date')));
  assert.ok(report.errors.some(error => error.includes('Missing source URL')));
});

test('data validation enforces the India and FSSAI regulatory scope', () => {
  const outsideScope = [{ ...incidents[0], jurisdiction: 'Global', authority: 'Other' }];
  const report = validateDataset(outsideScope, entities);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.includes('Non-India jurisdiction')));
  assert.ok(report.errors.some(error => error.includes('Non-FSSAI authority')));
});

test('data validation rejects illustrative IDs from an official snapshot', () => {
  const demoRecord = [{ ...incidents[0], id: 'FIRA-DEMO-001', jurisdiction: 'India', authority: 'FSSAI' }];
  const report = validateDataset(demoRecord, entities);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.includes('Illustrative demo identifier')));
});

test('illustrative catalogue covers broad Indian-market food categories', () => {
  assert.equal(typeof dataValidator.validateCatalog, 'function');
  assert.ok(catalog.length >= 36);
  const categories = new Set(catalog.map(item => item.category));
  assert.ok(categories.size >= 12);
  for (const familiarName of ['Basmati rice', 'Whole wheat atta', 'Chana dal', 'Toor dal', 'Rajma', 'Haldi powder', 'Jeera whole', 'Paneer']) {
    assert.ok(catalog.some(item => item.name === familiarName), `missing ${familiarName}`);
  }
  const report = dataValidator.validateCatalog(catalog);
  assert.equal(report.valid, true);
  assert.equal(report.productCount, catalog.length);
  assert.equal(report.categoryCount, categories.size);
});

test('catalogue validation rejects duplicate and non-illustrative records', () => {
  assert.equal(typeof dataValidator.validateCatalog, 'function');
  const sample = {
    id: 'sample-atta', name: 'Whole wheat atta', category: 'Grains & cereals',
    originCountry: 'India', supplier: 'Demo Retail Supplier', batch: 'ATTA-01',
    barcode: '8900000000001', keywords: ['atta', 'wheat flour'], illustrative: true,
  };
  const report = dataValidator.validateCatalog([
    sample,
    { ...sample, illustrative: false },
    { id: 'missing-fields', illustrative: true },
  ]);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.includes('Duplicate catalogue ID')));
  assert.ok(report.errors.some(error => error.includes('Duplicate barcode')));
  assert.ok(report.errors.some(error => error.includes('must be illustrative')));
  assert.ok(report.errors.some(error => error.includes('Missing catalogue field')));
});
