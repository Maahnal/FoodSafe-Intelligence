'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const {
  getIncident, getEntityProfile, validateDataset,
} = require('./lib/engine');
const { runPythonEngine } = require('./lib/python-engine');

const incidents = require('./data/incidents.json');
const entities = require('./data/entities.json');
const catalog = require('./data/catalog.json');
const APP_DIR = path.join(__dirname, 'app');
const eventCounts = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function unique(field) {
  return [...new Set(incidents.map(item => item[field]).filter(Boolean))].sort();
}

function buildSummary() {
  return {
    datasetMode: 'official_cached_snapshot',
    disclosure: 'A cached subset of official FIRA records under Indian/FSSAI jurisdiction. Foreign countries appear only as country-of-origin and exporting-country fields published by FIRA. This subset is not the complete or current FIRA database.',
    officialRecordCount: incidents.length,
    illustrativeCatalogCount: catalog.length,
    catalogCategoryCount: new Set(catalog.map(item => item.category)).size,
    regulatoryContext: {
      jurisdiction: 'India',
      authority: 'Food Safety and Standards Authority of India (FSSAI)',
      sourceSystem: 'Food Import Rejection Alert (FIRA)',
      scope: 'Food import rejection incidents recorded at Indian points of entry',
    },
    totalIncidents: incidents.length,
    totalEntities: entities.length,
    yearsCovered: `${Math.min(...incidents.map(item => Number(item.date.slice(0, 4))))}–${Math.max(...incidents.map(item => Number(item.date.slice(0, 4))))}`,
    latestCollection: '2026-09-29T09:30:00+05:30',
    latest: [...incidents].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    options: {
      countries: unique('country'), ports: unique('port'), categories: unique('category'),
      violations: unique('violationClass'), contaminants: unique('contaminant'),
      years: [...new Set(incidents.map(item => item.date.slice(0, 4)))].sort().reverse(),
    },
    source: {
      name: 'FSSAI Food Import Rejection Alert (FIRA)',
      url: 'https://fira.fssai.gov.in/index.php',
      mode: 'official cached FIRA subset',
    },
  };
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Body too large');
  }
  return body ? JSON.parse(body) : {};
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/health') {
    const processing = await runPythonEngine('health');
    return json(res, 200, { status: 'ok', service: 'foodsafe-intelligence', processing, data: validateDataset(incidents, entities) });
  }
  if (req.method === 'GET' && pathname === '/api/summary') return json(res, 200, buildSummary());
  if (req.method === 'GET' && pathname === '/api/search') {
    const result = await runPythonEngine('search', {
      incidents, entities, options: Object.fromEntries(url.searchParams),
    });
    return json(res, 200, result);
  }
  if (req.method === 'GET' && pathname === '/api/analytics') {
    return json(res, 200, await runPythonEngine('analytics', { incidents }));
  }
  if (req.method === 'GET' && pathname === '/api/relationships') {
    return json(res, 200, await runPythonEngine('relationships', {
      incidents, entities, focusId: url.searchParams.get('entity') || '',
    }));
  }
  if (req.method === 'GET' && pathname === '/api/entities') {
    return json(res, 200, entities.map(entity => ({ ...entity, incidentCount: incidents.filter(item => item.entityIds?.includes(entity.id)).length })));
  }
  if (req.method === 'GET' && pathname === '/api/catalog') {
    return json(res, 200, {
      items: catalog,
      categories: [...new Set(catalog.map(item => item.category))].sort(),
      total: catalog.length,
      disclosure: 'Illustrative product inventory for demonstrating historical evidence checks. These items are not official FSSAI alerts.',
    });
  }
  if (req.method === 'GET' && pathname.startsWith('/api/incidents/')) {
    const value = getIncident(decodeURIComponent(pathname.slice('/api/incidents/'.length)), incidents, entities);
    return value ? json(res, 200, value) : json(res, 404, { error: 'Incident not found' });
  }
  if (req.method === 'GET' && pathname.startsWith('/api/entities/')) {
    const value = getEntityProfile(decodeURIComponent(pathname.slice('/api/entities/'.length)), incidents, entities);
    return value ? json(res, 200, value) : json(res, 404, { error: 'Entity not found' });
  }
  if (req.method === 'POST' && pathname === '/api/product-check') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { error: 'Send a valid JSON product object.', fields: {} });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Send a valid product object.', fields: {} });
    const inputFields = ['catalogId', 'productName', 'category', 'originCountry', 'supplier', 'batch', 'barcode'];
    const invalidField = inputFields.find(field => body[field] != null && typeof body[field] !== 'string');
    if (invalidField) return json(res, 400, { error: 'Product fields must be text.', fields: { [invalidField]: 'Enter a text value.' } });
    if (!body.productName?.trim()) {
      return json(res, 400, { error: 'Product name is required', fields: { productName: 'Enter a product name or choose a sample product.' } });
    }
    if (!/[a-z0-9]/i.test(body.productName) || body.productName.trim().length > 160) {
      return json(res, 400, { error: 'Enter a product name of 1–160 characters containing letters or numbers.', fields: { productName: 'Use a recognizable product name.' } });
    }
    const input = Object.fromEntries(inputFields.map(field => [field, (body[field] || '').trim().slice(0, 160)]));
    return json(res, 200, await runPythonEngine('product_check', { input, catalog, incidents }));
  }
  if (req.method === 'POST' && pathname === '/api/events') {
    try {
      const body = await readBody(req);
      const event = String(body.event || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
      if (!event) return json(res, 400, { error: 'Event name required' });
      eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
      return json(res, 202, { recorded: true, event, count: eventCounts.get(event) });
    } catch (error) {
      return json(res, 400, { error: 'Invalid event payload' });
    }
  }
  return json(res, 404, { error: 'API route not found' });
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(APP_DIR, requested);
  const safe = candidate.startsWith(`${APP_DIR}${path.sep}`) || candidate === path.join(APP_DIR, 'index.html');
  const file = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(APP_DIR, 'index.html');

  if (!fs.existsSync(file)) return json(res, 503, { error: 'Frontend not built yet' });
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:;",
  });
  fs.createReadStream(file).pipe(res);
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(res, url.pathname);
    } catch (error) {
      return json(res, 500, { error: 'Unexpected server error' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`FoodSafe Intelligence running at http://127.0.0.1:${port}`);
  });
}

module.exports = { createAppServer, buildSummary };
