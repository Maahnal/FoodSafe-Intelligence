'use strict';

const app = document.querySelector('#app');
const crumb = document.querySelector('#crumb');
const rail = document.querySelector('#side-rail');
const scrim = document.querySelector('#scrim');
const toast = document.querySelector('#toast');
const state = { summary: null, analytics: null, entities: null, catalog: null };

const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h11"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
  source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5V3Z"/><path d="M15 3v4h4M8 11h8M8 15h5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Z"/><path d="m8 14 2.5-3 2.5 2 3-4 2 3"/></svg>',
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function routeInfo() {
  const raw = location.hash.replace(/^#\/?/, '') || 'overview';
  const [pathPart, queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return { route: parts[0] || 'overview', id: parts[1] ? decodeURIComponent(parts[1]) : '', params: new URLSearchParams(queryPart) };
}

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function loading(label = 'Loading intelligence…') {
  app.innerHTML = `<div class="loading-state"><span></span><p>${escapeHtml(label)}</p></div>`;
}

function errorView(message) {
  app.innerHTML = `<div class="error-state">${icons.info}<h2>That view could not be loaded.</h2><p>${escapeHtml(message)}</p><a class="primary-button" href="#/overview">Return to overview</a></div>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function track(event) {
  fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) }).catch(() => {});
}

function setChrome(route, title) {
  document.querySelectorAll('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === route));
  crumb.textContent = title;
  document.title = `${title} — FoodSafe Intelligence`;
  rail.classList.remove('open');
  document.querySelector('#menu-toggle').setAttribute('aria-expanded', 'false');
  scrim.hidden = true;
}

async function ensureSummary() {
  if (!state.summary) state.summary = await api('/api/summary');
  return state.summary;
}

async function ensureAnalytics() {
  if (!state.analytics) state.analytics = await api('/api/analytics');
  return state.analytics;
}

async function ensureEntities() {
  if (!state.entities) state.entities = await api('/api/entities');
  return state.entities;
}

async function ensureCatalog() {
  if (!state.catalog) state.catalog = await api('/api/catalog');
  return state.catalog;
}

function recordRows(records) {
  return `<div class="record-table">${records.map(record => `
    <a class="record-row" href="#/incident/${encodeURIComponent(record.id)}">
      <span class="id">${escapeHtml(record.id)}</span>
      <div><strong>${escapeHtml(record.product)}</strong><small>Exporting country: ${escapeHtml(record.exportingCountry)}</small></div>
      <div><strong>${escapeHtml(record.contaminant)}</strong><small>Indian entry: ${escapeHtml(record.port)} · Import origin: ${escapeHtml(record.country)}</small></div>
      <time datetime="${escapeHtml(record.date)}">${formatDate(record.date)}</time>
      ${icons.arrow}
    </a>`).join('')}</div>`;
}

async function renderOverview() {
  setChrome('overview', 'Intelligence overview');
  loading('Reading the cached intelligence snapshot…');
  const [summary, catalog] = await Promise.all([ensureSummary(), ensureCatalog()]);
  app.innerHTML = `<section class="page home-page">
    <div class="page-head">
      <h1>Know more about the food <em>you buy and serve.</em></h1>
      <p class="lead">Food alert evidence for supermarket, restaurant and hotel owners, with a deeper investigation workspace for food-safety and compliance teams in India.</p>
    </div>

    <div class="audience-paths">
      <a class="audience-path business-path" href="#/check"><div><h2>Check a product</h2><p>Compare a stock item with historical food-import alerts. See matching evidence and what to verify with your supplier.</p></div><span class="path-action">Open safety check ${icons.arrow}</span></a>
      <a class="audience-path" href="#/search"><div><h2>Explore official records</h2><p>Search FSSAI/FIRA rejection records, inspect source evidence and follow connections between products, issues and Indian ports.</p></div><span class="path-action">Open intelligence workspace ${icons.arrow}</span></a>
    </div>

    <div class="coverage-line"><strong>${summary.officialRecordCount} official rejection records</strong><span>${catalog.total} illustrative inventory items</span><span>${catalog.categories.length} food categories</span></div>

    <div class="overview-stage">
      <div class="overview-primary">
        <span class="overline">Search the linked evidence</span>
        <h2 class="section-title">Start with a product, contaminant, Indian rejection point, or plain-language question.</h2>
        <form class="search-launch" id="overview-search">
          ${icons.search}
          <input name="q" aria-label="Search food-safety intelligence" placeholder="Try: aflatoxin pistachios rejected at Mumbai" autocomplete="off">
          <button type="submit">Investigate</button>
        </form>
        <div class="query-examples" aria-label="Example searches">
          <button class="query-chip" data-query="aflatoxin pistachio Mumbai">Aflatoxin · pistachio · Mumbai</button>
          <button class="query-chip" data-query="heavy metal contamination">Heavy metal contamination</button>
          <button class="query-chip" data-query="labelling">Labelling issues</button>
        </div>
      </div>
      <aside class="snapshot-panel">
        <span class="overline">Dataset snapshot</span>
        <dl class="metric-ledger">
          <div><dt>Incidents</dt><dd>${summary.totalIncidents}</dd></div>
          <div><dt>Linked entities</dt><dd>${summary.totalEntities}</dd></div>
          <div><dt>Coverage</dt><dd>${escapeHtml(summary.yearsCovered)}</dd></div>
          <div><dt>Indian entry points</dt><dd>${summary.options.ports.length}</dd></div>
        </dl>
        <div class="source-seal">${icons.source}<div><p><strong>${escapeHtml(summary.source.name)}</strong></p><small>${escapeHtml(summary.source.mode)} · provenance retained</small></div></div>
      </aside>
    </div>

    <div class="disclosure-strip">${icons.info}<div><strong>Evidence coverage</strong><p>${escapeHtml(summary.disclosure)} The business catalogue is illustrative; supplier and batch details are entered for context.</p></div></div>

    <section class="content-section">
      <div class="section-heading"><div><span class="overline">Latest in the snapshot</span><h2 class="section-title">Recently indexed incidents</h2></div><a href="#/search">Search all ${summary.totalIncidents} records →</a></div>
      ${recordRows(summary.latest)}
    </section>
  </section>`;

  document.querySelector('#overview-search').addEventListener('submit', event => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get('q').trim();
    location.hash = `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    track('overview_search');
  });
}

function optionMarkup(items, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${items.map(item => `<option value="${escapeHtml(item)}" ${item === selected ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
}

function checkResultMarkup(result) {
  const statusLabels = {
    'historical-alert-match': 'Historical alert match',
    'review-recommended': 'Review recommended',
    'no-known-alert-match': 'No known alert match',
  };
  return `<article class="check-result ${escapeHtml(result.status)}" aria-live="polite">
    <div class="check-status"><span></span>${escapeHtml(statusLabels[result.status] || result.headline)}</div>
    <h2>${escapeHtml(result.headline)}</h2>
    <p class="check-summary">${escapeHtml(result.summary)}</p>
    ${result.signals.length ? `<div class="check-signals"><strong>Why this result appeared</strong>${result.signals.map(signal => `<span>${escapeHtml(signal)}</span>`).join('')}</div>` : ''}
    <div class="checked-product">
      <span class="overline">Product checked</span>
      <strong>${escapeHtml(result.input.productName)}</strong>
      <small>${[result.input.category, result.input.originCountry].filter(Boolean).map(escapeHtml).join(' · ') || 'Product name only'}</small>
      ${result.input.supplier || result.input.batch ? `<small>Entered details: ${escapeHtml(result.input.supplier || 'Supplier not entered')} · Batch ${escapeHtml(result.input.batch || 'not entered')}</small>` : ''}
    </div>
    ${result.matchedIncidents.length ? `<div class="matched-evidence">
      <div class="result-section-head"><span class="overline">Relevant official evidence</span><strong>${result.matchedIncidents.length} record${result.matchedIncidents.length === 1 ? '' : 's'}</strong></div>
      ${result.matchedIncidents.map(item => `<a class="evidence-row" href="#/incident/${encodeURIComponent(item.id)}">
        <div><span class="id">${escapeHtml(item.id)} · ${item.matchStrength === 'strong-product' ? 'Similar product' : 'Broad category context'}</span><strong>${escapeHtml(item.product)}</strong><small>${escapeHtml(item.reason)}</small></div>
        <div><span>${formatDate(item.date)}</span><small>${escapeHtml(item.port)}</small></div>${icons.arrow}
      </a>`).join('')}
    </div>` : `<div class="no-evidence-note">${icons.info}<p>No relevant rejection record was found in the available cached subset. Continue normal supplier and batch verification.</p></div>`}
    <div class="next-steps"><span class="overline">Recommended next steps</span><ol>${result.nextSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div>
    <details class="check-limitations"><summary>What has and has not been verified</summary><ul>${result.verificationGaps.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></details>
    <div class="scope-notice">${icons.info}<p>${escapeHtml(result.scopeNotice)}</p></div>
  </article>`;
}

async function renderProductCheck() {
  setChrome('check', 'Business safety check');
  loading('Preparing the product catalogue…');
  const catalog = await ensureCatalog();

  app.innerHTML = `<section class="page checker-page">
    <div class="page-head">
      <div><h1>Check a product against <em>known alert evidence.</em></h1></div>
      <p class="lead">Enter an item from your stock or choose a sample. The check compares it with the available official FSSAI/FIRA rejection history and explains every match.</p>
    </div>

    <div class="coverage-line"><strong>For shops, restaurants and hotels</strong><span>${catalog.total} sample products · ${catalog.categories.length} food categories</span><span>Historical FSSAI / FIRA evidence</span></div>

    <div class="checker-shell">
      <form class="check-form" id="product-check-form" novalidate>
        <div class="form-heading"><h2>What are you checking?</h2><p>Choose a sample below or enter the item from your stock.</p></div>
        <div class="field full"><label for="sample-product">Load one of all ${catalog.total} samples</label><select id="sample-product"><option value="">Choose a sample product</option>${catalog.items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.category)}</option>`).join('')}</select></div>
        <input type="hidden" id="check-catalog-id" name="catalogId">
        <div class="field full"><label for="check-product">Product name *</label><input id="check-product" name="productName" required placeholder="Example: Pistachio kernel" autocomplete="off"></div>
        <div class="field"><label for="check-category">Food category</label><select id="check-category" name="category">${optionMarkup(catalog.categories, '', 'Choose category')}</select></div>
        <div class="field"><label for="check-origin">Country of origin</label><input id="check-origin" name="originCountry" placeholder="Example: India"></div>
        <div class="field"><label for="check-supplier">Supplier</label><input id="check-supplier" name="supplier" placeholder="Supplier or importer"></div>
        <div class="field"><label for="check-batch">Batch number</label><input id="check-batch" name="batch" placeholder="Printed on the pack"></div>
        <div class="field full"><label for="check-barcode">Sample barcode</label><div class="barcode-field"><input id="check-barcode" name="barcode" inputmode="numeric" placeholder="Example: 8901000000019"><button type="button" class="secondary-button" id="barcode-lookup">Look up</button></div><small class="field-help">Matches the sample catalogue only. A connected USB scanner can type into this field.</small><p id="barcode-feedback" class="field-feedback" role="status"></p></div>
        <button class="primary-button check-submit" type="submit">Check product evidence</button>
        <p class="form-footnote">Historical evidence only · no laboratory test is performed</p>
      </form>
      <div class="check-result-slot" id="check-result">
        <div class="check-placeholder">${icons.search}<h2>A clearer view before your next purchase.</h2><p>Choose a product, add the origin if known, and run a check to see relevant rejection history.</p><div class="quick-checks"><button type="button" data-quick-product="nut-pistachio">Try pistachio</button><button type="button" data-quick-product="grain-whole-wheat-atta">Try atta</button><button type="button" data-quick-product="nut-cashew">Try cashew</button></div><small>Checks cover 18 cached import-rejection records from 2024–2025.</small></div>
      </div>
    </div>

    <section class="sample-section">
      <div class="section-heading"><div><h2 class="section-title">Browse the product catalogue</h2><p class="section-copy">${catalog.total} illustrative stock items across ${catalog.categories.length} categories. Select a product to fill the form.</p></div></div>
      <div class="catalogue-controls"><div class="field"><label for="catalogue-search">Find a food</label><input id="catalogue-search" type="search" placeholder="Try atta, rajma, haldi or paneer"></div><div class="field"><label for="catalogue-category">Food category</label><select id="catalogue-category">${optionMarkup(catalog.categories, '', 'All categories')}</select></div></div>
      <p class="catalogue-count" id="catalogue-count" role="status">${catalog.total} products shown</p>
      <div class="catalogue-grid">${catalog.items.map(item => `<button class="catalogue-card" type="button" data-catalog-id="${escapeHtml(item.id)}" data-category="${escapeHtml(item.category)}" data-search="${escapeHtml([item.name, ...item.keywords].join(' ').toLowerCase())}"><span>${escapeHtml(item.category)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.originCountry)}</small></button>`).join('')}</div>
      <p class="catalogue-empty" hidden>No products match. Try another food name or clear the category.</p>
    </section>

    <div class="disclosure-strip">${icons.info}<div><strong>What this check means</strong><p>${escapeHtml(catalog.disclosure)} A result is decision support, not a laboratory finding or product certification.</p></div></div>
  </section>`;

  const form = document.querySelector('#product-check-form');
  const resultSlot = document.querySelector('#check-result');
  const submitButton = form.querySelector('.check-submit');
  let revision = 0;

  function resetResult() {
    revision += 1;
    resultSlot.innerHTML = '<div class="check-placeholder"><h2>Ready to check this product.</h2><p>Run the check to compare the details on the left with the available alert records.</p></div>';
  }

  function populateSample(id) {
    const item = catalog.items.find(value => value.id === id);
    if (!item) return;
    form.elements.catalogId.value = item.id;
    form.elements.productName.value = item.name;
    form.elements.category.value = item.category;
    form.elements.originCountry.value = item.originCountry;
    form.elements.supplier.value = item.supplier;
    form.elements.batch.value = item.batch;
    form.elements.barcode.value = item.barcode;
    document.querySelector('#sample-product').value = item.id;
    document.querySelectorAll('.catalogue-card').forEach(card => card.classList.toggle('selected', card.dataset.catalogId === item.id));
    resetResult();
    form.elements.productName.focus({ preventScroll: true });
  }

  document.querySelector('#sample-product').addEventListener('change', event => populateSample(event.target.value));
  document.querySelectorAll('.catalogue-card').forEach(card => card.addEventListener('click', () => { populateSample(card.dataset.catalogId); form.scrollIntoView({ block: 'start', behavior: 'smooth' }); }));
  document.querySelectorAll('[data-quick-product]').forEach(button => button.addEventListener('click', () => populateSample(button.dataset.quickProduct)));
  function filterCatalogue() {
    const query = document.querySelector('#catalogue-search').value.trim().toLowerCase();
    const category = document.querySelector('#catalogue-category').value;
    let count = 0;
    document.querySelectorAll('.catalogue-card').forEach(card => {
      const visible = (!category || card.dataset.category === category) && (!query || card.dataset.search.includes(query));
      card.hidden = !visible;
      if (visible) count += 1;
    });
    document.querySelector('#catalogue-count').textContent = `${count} product${count === 1 ? '' : 's'} shown`;
    document.querySelector('.catalogue-empty').hidden = count > 0;
  }
  document.querySelector('#catalogue-search').addEventListener('input', filterCatalogue);
  document.querySelector('#catalogue-category').addEventListener('change', filterCatalogue);
  document.querySelector('#barcode-lookup').addEventListener('click', () => {
    const barcode = form.elements.barcode.value.trim();
    const match = catalog.items.find(item => item.barcode === barcode);
    if (match) populateSample(match.id);
    document.querySelector('#barcode-feedback').textContent = match ? `Loaded ${match.name} from the sample catalogue.` : 'No sample barcode match. Enter the product details manually to continue.';
  });
  form.addEventListener('input', event => {
    if (event.target.name === 'productName') {
      form.elements.catalogId.value = '';
      form.elements.barcode.value = '';
      document.querySelector('#sample-product').value = '';
      document.querySelectorAll('.catalogue-card').forEach(card => card.classList.remove('selected'));
    }
    resetResult();
  });
  form.elements.category.addEventListener('change', resetResult);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const productName = form.elements.productName.value.trim();
    if (!productName) {
      form.elements.productName.setCustomValidity('Enter a product name or choose a sample product.');
      form.reportValidity();
      form.elements.productName.setCustomValidity('');
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Checking evidence…';
    resultSlot.innerHTML = '<div class="loading-state compact"><span></span><p>Comparing product details with official records…</p></div>';
    const submittedRevision = revision;
    try {
      const result = await api('/api/product-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      if (submittedRevision !== revision) return;
      resultSlot.innerHTML = checkResultMarkup(result);
      if (window.matchMedia('(max-width: 900px)').matches) resultSlot.scrollIntoView({ block: 'start', behavior: 'smooth' });
      track(`product_check_${result.status}`);
    } catch (error) {
      if (submittedRevision === revision) resultSlot.innerHTML = `<div class="error-state compact">${icons.info}<h2>Check could not be completed.</h2><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Check product evidence';
    }
  });
}

async function renderSearch(params) {
  setChrome('search', 'Search records');
  loading('Searching normalized records…');
  const summary = await ensureSummary();
  const query = Object.fromEntries(params);
  const result = await api(`/api/search?${params.toString()}`);

  app.innerHTML = `<section class="page">
    <div class="page-head compact">
      <div><span class="overline">Information retrieval</span><h1>Search the <em>evidence layer.</em></h1></div>
      <p class="lead">Every result explains why it matched. Combine a query with structured filters to narrow the record set.</p>
    </div>
    <div class="search-layout">
      <form class="filter-panel" id="filters">
        <h2>Refine records</h2>
        <div class="field"><label for="port">Indian point of rejection</label><select id="port" name="port">${optionMarkup(summary.options.ports, query.port, 'All Indian entry points')}</select></div>
        <div class="field"><label for="category">Product category</label><select id="category" name="category">${optionMarkup(summary.options.categories, query.category, 'All categories')}</select></div>
        <div class="field"><label for="violation">Violation class</label><select id="violation" name="violation">${optionMarkup(summary.options.violations, query.violation, 'All classes')}</select></div>
        <div class="field"><label for="year">Year</label><select id="year" name="year">${optionMarkup(summary.options.years, query.year, 'All years')}</select></div>
        <button class="clear-button" type="button" id="clear-filters">Clear filters</button>
      </form>
      <div>
        <form class="search-bar-wide" id="search-form">
          <input name="q" value="${escapeHtml(query.q || '')}" aria-label="Search query" placeholder="Product, contaminant, violation, Indian port…" autocomplete="off">
          <button class="primary-button" type="submit">Search records</button>
        </form>
        <div class="search-summary">
          <p><strong>${result.total}</strong> ${result.total === 1 ? 'record' : 'records'} found${query.q ? ` for “${escapeHtml(query.q)}”` : ''}</p>
          <div class="match-list">${result.expandedTerms.slice(0, 8).map(term => `<span>${escapeHtml(term)}</span>`).join('')}</div>
        </div>
        <div class="result-list">
          ${result.items.length ? result.items.map((item, index) => `
            <article class="result-card">
              <span class="result-index">MATCH ${String(index + 1).padStart(2, '0')}<br>SCORE ${item.score}</span>
              <div>
                <h3><a href="#/incident/${encodeURIComponent(item.id)}">${escapeHtml(item.product)}</a></h3>
                <p class="reason">${escapeHtml(item.reason)}</p>
                <div class="match-list">${item.matchReasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
              </div>
              <div class="result-facts">
                <div><span>Parameter</span><strong>${escapeHtml(item.contaminant)}</strong></div>
                <div><span>Indian point</span><strong>${escapeHtml(item.port)}</strong></div>
                <div><span>Date</span><strong>${formatDate(item.date)}</strong></div>
              </div>
            </article>`).join('') : `<div class="empty-state">${icons.empty}<h2>No records match this combination.</h2><p>Remove one filter or try a broader phrase such as “heavy metal” or “pesticide”.</p><button class="primary-button" id="empty-clear">Clear search</button></div>`}
        </div>
      </div>
    </div>
  </section>`;

  function updateHash() {
    const current = new URLSearchParams();
    const searchValue = document.querySelector('#search-form input').value.trim();
    if (searchValue) current.set('q', searchValue);
    new FormData(document.querySelector('#filters')).forEach((value, key) => { if (value) current.set(key, value); });
    location.hash = `#/search${current.size ? `?${current}` : ''}`;
  }
  document.querySelector('#search-form').addEventListener('submit', event => { event.preventDefault(); updateHash(); track('search_submit'); });
  document.querySelectorAll('#filters select').forEach(select => select.addEventListener('change', updateHash));
  document.querySelector('#clear-filters').addEventListener('click', () => { location.hash = '#/search'; });
  document.querySelector('#empty-clear')?.addEventListener('click', () => { location.hash = '#/search'; });
}

async function renderIncident(id) {
  setChrome('search', 'Incident evidence');
  loading('Assembling incident evidence…');
  const incident = await api(`/api/incidents/${encodeURIComponent(id)}`);
  const hasMeasurement = incident.measured !== null && incident.limit !== null;
  const ratio = incident.limit > 0 ? incident.measured / incident.limit : null;
  const progress = ratio ? Math.min(100, (ratio / 3) * 100) : 100;
  app.innerHTML = `<article class="page">
    <a class="back-link" href="#/search">${icons.back} Back to search</a>
    <div class="page-head">
      <div><span class="overline">${escapeHtml(incident.id)} · ${escapeHtml(incident.stage)}</span><h1>${escapeHtml(incident.product)}</h1></div>
      <p class="lead">A normalized incident view with the original reason, linked entities, measurement context, and explainable related records.</p>
    </div>
    <div class="detail-grid">
      <div>
        <span class="overline">Normalized facts</span>
        <dl class="fact-sheet">
          <div class="fact-row"><dt>Product category</dt><dd>${escapeHtml(incident.category)}</dd></div>
          <div class="fact-row"><dt>Regulatory jurisdiction</dt><dd>${escapeHtml(incident.jurisdiction)}</dd></div>
          <div class="fact-row"><dt>Source authority</dt><dd>Food Safety and Standards Authority of India (FSSAI)</dd></div>
          <div class="fact-row"><dt>Indian point of rejection</dt><dd>${escapeHtml(incident.port)}</dd></div>
          <div class="fact-row"><dt>Exporting country <small>(FIRA source field)</small></dt><dd>${escapeHtml(incident.exportingCountry)}</dd></div>
          <div class="fact-row"><dt>Import origin <small>(FIRA source field)</small></dt><dd>${escapeHtml(incident.country)}</dd></div>
          <div class="fact-row"><dt>Date</dt><dd>${formatDate(incident.date)}</dd></div>
          <div class="fact-row"><dt>Violation class</dt><dd><span class="tag amber">${escapeHtml(incident.violationClass)}</span></dd></div>
        </dl>
        <div class="evidence-block">
          <span class="overline">Preserved source text</span>
          <h2 class="section-title">What the collector received</h2>
          <blockquote>“${escapeHtml(incident.reason)}”</blockquote>
          <div class="entity-links">${incident.entities.map(entity => `<a class="entity-link" href="#/entity/${encodeURIComponent(entity.id)}"><span>${escapeHtml(entity.name)}</span><small>${escapeHtml(entity.type)}</small></a>`).join('')}</div>
        </div>
      </div>
      <aside>
        <div class="measure-panel">
          <span class="overline">Tested parameter</span>
          <h2>${escapeHtml(incident.contaminant)}</h2>
          ${hasMeasurement ? `<div class="measure-value">${escapeHtml(incident.measured)} <span>${escapeHtml(incident.unit)}</span></div>
          <div class="limit-line">Reference limit: ${escapeHtml(incident.limit)} ${escapeHtml(incident.unit)}</div>
          <div class="comparison-track" aria-label="Measured value compared with reference limit"><span data-bar-width="${progress}"></span></div>
          <small>${ratio ? `${ratio.toFixed(2)}× the referenced limit` : 'Detection where the referenced requirement is absence'}</small>` : `<div class="measure-value">—</div><div class="limit-line">Measurement not available in cached index record</div><small>Open the official detail page to inspect any published parameter table.</small>`}
          <div class="confidence-box"><span>Source</span><strong> Official FIRA snapshot</strong></div>
        </div>
        <div class="source-seal">${icons.source}<div><p><strong>Evidence retained</strong></p><small>Bundled source reference points to the official FIRA portal.</small><p><a href="${escapeHtml(incident.sourceUrl)}" target="_blank" rel="noreferrer">Open official portal ↗</a></p></div></div>
      </aside>
    </div>
    <section class="content-section">
      <div class="section-heading"><div><span class="overline">Incident linking</span><h2 class="section-title">Related records, with reasons</h2></div></div>
      <div class="related-list">${incident.related.length ? incident.related.map(item => `
        <a class="record-row" href="#/incident/${encodeURIComponent(item.id)}">
          <span class="id">SIM ${item.similarity}</span>
          <div><strong>${escapeHtml(item.product)}</strong><small>${escapeHtml(item.id)}</small></div>
          <div><strong>${escapeHtml(item.contaminant)}</strong><small class="signal">${escapeHtml(item.sharedSignals.join(' · '))}</small></div>
          <time>${formatDate(item.date)}</time>${icons.arrow}
        </a>`).join('') : '<p>No related incidents found.</p>'}</div>
    </section>
  </article>`;
  track('incident_view');
}

async function renderEntity(id) {
  setChrome('search', 'Entity profile');
  loading('Resolving entity history…');
  const profile = await api(`/api/entities/${encodeURIComponent(id)}`);
  app.innerHTML = `<article class="page">
    <a class="back-link" href="#/search">${icons.back} Back to records</a>
    <header class="profile-head">
      <div><span class="profile-type">Resolved ${escapeHtml(profile.entity.type)}</span><h1>${escapeHtml(profile.entity.name)}</h1></div>
      <div class="profile-count"><strong>${profile.incidents.length}</strong><span>linked incidents</span></div>
    </header>
    <div class="alias-line"><strong>Known aliases</strong>${profile.entity.aliases.length ? profile.entity.aliases.map(alias => `<span>${escapeHtml(alias)}</span>`).join('') : '<span>No aliases recorded</span>'}</div>
    <section class="content-section">
      <div class="section-heading"><div><span class="overline">Cross-record history</span><h2 class="section-title">One entity, traced over time</h2></div><a href="#/explore?focus=${encodeURIComponent(id)}">Open relationship map →</a></div>
      <div class="timeline">${profile.timeline.map(item => `<div class="timeline-item"><time>${item.year}</time><strong>${item.count}</strong><small>${item.count === 1 ? 'incident' : 'incidents'}</small></div>`).join('')}</div>
    </section>
    <div class="detail-grid content-section">
      <section>
        <span class="overline">Evidence trail</span><h2 class="section-title">Linked incidents</h2>
        ${recordRows(profile.incidents)}
      </section>
      <aside>
        <span class="overline">Recurring parameters</span>
        <div class="fact-sheet">${profile.recurring.map(item => `<div class="fact-row"><dt>${escapeHtml(item.label)}</dt><dd>${item.value} record${item.value > 1 ? 's' : ''}</dd></div>`).join('')}</div>
        <div class="evidence-block"><span class="overline">Resolution basis</span><p>Deterministic aliases and shared entity identifiers. This prototype exposes the alias set instead of hiding the matching decision.</p></div>
      </aside>
    </div>
  </article>`;
  track('entity_view');
}

function graphMarkup(graph) {
  const width = 900, height = 620;
  const byType = new Map();
  graph.nodes.forEach(node => {
    if (!byType.has(node.type)) byType.set(node.type, []);
    byType.get(node.type).push(node);
  });
  const typeOrder = ['Indian entry point', 'Product', 'Contaminant', 'Violation', 'Incident'];
  const columns = typeOrder.filter(type => byType.has(type));
  const positions = new Map();
  columns.forEach((type, colIndex) => {
    const nodes = byType.get(type);
    nodes.forEach((node, index) => {
      positions.set(node.id, { x: 95 + colIndex * ((width - 190) / Math.max(1, columns.length - 1)), y: 74 + index * ((height - 148) / Math.max(1, nodes.length - 1)), type });
    });
  });
  const lines = graph.links.map(link => {
    const a = positions.get(link.source), b = positions.get(link.target);
    return a && b ? `<line class="network-line" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` : '';
  }).join('');
  const nodes = graph.nodes.map(node => {
    const p = positions.get(node.id); if (!p) return '';
    const radius = node.type === 'Incident' ? 8 : 13;
    const label = node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label;
    const href = node.type === 'Incident' ? `#/incident/${encodeURIComponent(node.id)}` : `#/entity/${encodeURIComponent(node.id)}`;
    const incidentLabel = node.type === 'Incident';
    const labelX = incidentLabel ? p.x - 14 : p.x + 18;
    const labelY = incidentLabel ? p.y + radius + 16 : p.y - radius - 8;
    const anchor = incidentLabel ? 'end' : 'start';
    return `<a class="network-node" data-type="${escapeHtml(node.type)}" href="${href}"><circle cx="${p.x}" cy="${p.y}" r="${radius}"/><text class="network-label" x="${labelX}" y="${labelY}" text-anchor="${anchor}">${escapeHtml(label)}</text></a>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Entity relationship map"><g>${lines}</g><g>${nodes}</g></svg>`;
}

async function renderExplore(params) {
  setChrome('explore', 'Relationship explorer');
  loading('Mapping connected entities…');
  const entities = await ensureEntities();
  const focus = params.get('focus') || 'port-mumbai-jnpt';
  const graph = await api(`/api/relationships?entity=${encodeURIComponent(focus)}`);
  const focusEntity = entities.find(entity => entity.id === focus);
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>Trace the <em>relationships</em> behind a record.</h1>
      <p class="lead">The map is generated from the same entity and incident links used by search. Select a node to move from pattern to evidence.</p>
    </div>
    <div class="network-shell">
      <div class="network-canvas">${graphMarkup(graph)}</div>
      <aside class="network-legend">
        <span class="overline">Map controls</span><h2>Focus entity</h2>
        <div class="field"><label for="focus-entity">Normalized entity</label><select id="focus-entity">${entities.filter(entity => entity.incidentCount > 0).map(entity => `<option value="${escapeHtml(entity.id)}" ${entity.id === focus ? 'selected' : ''}>${escapeHtml(entity.name)} · ${entity.incidentCount}</option>`).join('')}</select></div>
        <div class="legend-list">
          <div class="legend-item"><span class="legend-dot entry"></span>Indian entry point</div>
          <div class="legend-item"><span class="legend-dot product"></span>Normalized product</div>
          <div class="legend-item"><span class="legend-dot contaminant"></span>Parameter / violation</div>
          <div class="legend-item"><span class="legend-dot incident"></span>Incident record</div>
        </div>
        <div class="focus-box"><span class="overline">Current focus</span><h2>${escapeHtml(focusEntity?.name || focus)}</h2><p>${graph.nodes.length} nodes · ${graph.links.length} evidence links</p><a href="#/entity/${encodeURIComponent(focus)}">Open entity profile →</a></div>
      </aside>
    </div>
  </section>`;
  document.querySelector('#focus-entity').addEventListener('change', event => { location.hash = `#/explore?focus=${encodeURIComponent(event.target.value)}`; });
  track('relationship_view');
}

function barChart(items, limit = 7) {
  const shown = items.slice(0, limit);
  const max = Math.max(...shown.map(item => item.value), 1);
  return `<div class="bar-chart">${shown.map(item => `<div class="bar-row"><span class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span><div class="bar-track"><span data-bar-width="${(item.value / max) * 100}"></span></div><strong>${item.value}</strong></div>`).join('')}</div>`;
}

async function renderAnalytics() {
  setChrome('analytics', 'Analytics');
  loading('Aggregating patterns from the record set…');
  const analytics = await ensureAnalytics();
  app.innerHTML = `<section class="page">
    <div class="page-head">
      <h1>Patterns derived from <em>one evidence set.</em></h1>
      <p class="lead">Counts update from the same cached incident records used by search, profiles, and the relationship map. No chart values are manually entered.</p>
    </div>
    <div class="analytics-grid">
      <section class="analytics-panel wide"><span class="overline">India · points of rejection</span><h2>Import rejections at Indian entry points</h2>${barChart(analytics.byPort)}</section>
      <section class="analytics-panel narrow"><span class="overline">Measured results</span><h2>Average exceedance</h2><div class="big-stat"><strong>${analytics.limitExceedances.averageMultiple}×</strong><span>reference limit across numeric results</span></div></section>
      <section class="analytics-panel"><span class="overline">Parameters</span><h2>Recurring contaminants and issues</h2>${barChart(analytics.byContaminant)}</section>
      <section class="analytics-panel"><span class="overline">Product intelligence</span><h2>Product categories represented</h2>${barChart(analytics.byCategory)}</section>
      <section class="analytics-panel"><span class="overline">Time</span><h2>Incident volume by year</h2>${barChart(analytics.byYear, 10)}</section>
      <section class="analytics-panel"><span class="overline">FIRA source field</span><h2>Import origins represented</h2>${barChart(analytics.byCountry)}</section>
      <section class="analytics-panel narrow"><span class="overline">Dataset</span><h2>Records analyzed</h2><div class="big-stat"><strong>${analytics.total}</strong><span>official cached FIRA records</span></div></section>
    </div>
    <div class="disclosure-strip">${icons.info}<div><strong>Interpretation boundary</strong><p>Within the collected FIRA records, these charts describe Indian import-rejection activity at Indian entry points. Foreign countries are shown only as import-origin metadata. The charts do not estimate national prevalence or public-health risk.</p></div></div>
  </section>`;
  track('analytics_view');
}


async function renderRoute() {
  const { route, id, params } = routeInfo();
  try {
    if (route === 'overview') await renderOverview();
    else if (route === 'check') await renderProductCheck();
    else if (route === 'search') await renderSearch(params);
    else if (route === 'incident') await renderIncident(id);
    else if (route === 'entity') await renderEntity(id);
    else if (route === 'explore') await renderExplore(params);
    else if (route === 'analytics') await renderAnalytics();
    else location.hash = '#/overview';
    document.querySelectorAll('[data-bar-width]').forEach(bar => { bar.style.width = `${Number(bar.dataset.barWidth)}%`; });
    window.scrollTo({ top: 0, behavior: 'instant' });
    app.focus({ preventScroll: true });
  } catch (error) {
    errorView(error.message);
  }
}

document.querySelector('#menu-toggle').addEventListener('click', event => {
  const open = rail.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
});
scrim.addEventListener('click', () => { rail.classList.remove('open'); scrim.hidden = true; });
document.addEventListener('click', event => {
  const query = event.target.closest('[data-query]');
  if (query) location.hash = `#/search?q=${encodeURIComponent(query.dataset.query)}`;
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { rail.classList.remove('open'); scrim.hidden = true; } });
window.addEventListener('hashchange', renderRoute);
window.addEventListener('offline', () => showToast('Offline mode active — cached data remains available.'));
window.addEventListener('online', () => showToast('Connection restored. The demo still uses cached data.'));

renderRoute();
