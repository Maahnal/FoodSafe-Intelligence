'use strict';

const incidents = require('../data/incidents.json');
const entities = require('../data/entities.json');
const catalog = require('../data/catalog.json');
const { validateDataset, buildAnalytics } = require('../lib/engine');

const REQUIRED_CATALOG_FIELDS = [
  'id', 'name', 'category', 'originCountry', 'supplier', 'batch', 'barcode',
];

function validateCatalog(items) {
  const errors = [];
  const ids = new Set();
  const barcodes = new Set();
  const categories = new Set();

  for (const item of items) {
    for (const field of REQUIRED_CATALOG_FIELDS) {
      if (typeof item[field] !== 'string' || !item[field].trim()) {
        errors.push(`Missing catalogue field ${field}: ${item.id || 'unknown item'}`);
      }
    }
    if (ids.has(item.id)) errors.push(`Duplicate catalogue ID: ${item.id}`);
    if (barcodes.has(item.barcode)) errors.push(`Duplicate barcode: ${item.barcode}`);
    if (item.illustrative !== true) errors.push(`Catalogue item must be illustrative: ${item.id || 'unknown item'}`);
    if (!Array.isArray(item.keywords) || item.keywords.length === 0) errors.push(`Missing catalogue keywords: ${item.id || 'unknown item'}`);
    ids.add(item.id);
    barcodes.add(item.barcode);
    if (item.category) categories.add(item.category);
  }

  return {
    valid: errors.length === 0,
    errors,
    productCount: items.length,
    categoryCount: categories.size,
  };
}

if (require.main === module) {
  const report = validateDataset(incidents, entities);
  const catalogReport = validateCatalog(catalog);
  const analytics = buildAnalytics(incidents);

  if (!report.valid || !catalogReport.valid) {
    console.error('Data validation failed:');
    for (const error of [...report.errors, ...catalogReport.errors]) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Dataset valid: ${report.incidentCount} official incidents, ${report.entityCount} entities.`);
  console.log(`Catalogue valid: ${catalogReport.productCount} illustrative products, ${catalogReport.categoryCount} categories.`);
  console.log(`Analytics ready: ${analytics.byCountry.length} countries, ${analytics.byCategory.length} categories, ${analytics.byYear.length} years.`);
}

module.exports = { validateCatalog };
