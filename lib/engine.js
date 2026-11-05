'use strict';

const INTENT_MAP = {
  'heavy metal': ['lead', 'arsenic', 'cadmium', 'mercury'],
  'heavy metals': ['lead', 'arsenic', 'cadmium', 'mercury'],
  mould: ['aflatoxin', 'ochratoxin', 'mycotoxin'],
  mold: ['aflatoxin', 'ochratoxin', 'mycotoxin'],
  pesticide: ['pesticide residue', 'chlorpyrifos', 'imidacloprid'],
  microbial: ['salmonella', 'e. coli', 'listeria'],
  bacteria: ['salmonella', 'e. coli', 'listeria'],
};

const SEARCH_FIELDS = [
  ['product', 'product'], ['category', 'category'], ['country', 'country'],
  ['exportingCountry', 'exporting country'], ['exporter', 'exporter'], ['contaminant', 'parameter'], ['violationClass', 'violation'],
  ['reason', 'reason'], ['port', 'rejection point'], ['id', 'record ID'],
];

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return [...new Set(normalize(value).split(/\s+/).filter(token => token.length > 1))];
}

function expandIntent(query = '') {
  const normalized = normalize(query);
  const terms = tokenize(normalized);
  for (const [intent, expansions] of Object.entries(INTENT_MAP)) {
    if (normalized.includes(intent)) terms.push(...expansions);
  }
  return [...new Set(terms)];
}

function aliasTextForIncident(incident, entities) {
  return entities
    .filter(entity => incident.entityIds?.includes(entity.id))
    .flatMap(entity => [entity.name, ...(entity.aliases || [])])
    .join(' ');
}

function countTerms(text, terms) {
  const haystack = normalize(text);
  return terms.filter(term => haystack.includes(normalize(term)));
}

function searchIncidents(incidents, entities, options = {}) {
  const q = options.q || '';
  const queryTerms = expandIntent(q);
  const meaningfulQuery = queryTerms.length > 0;

  let items = incidents.filter(incident => {
    if (options.country && incident.country !== options.country) return false;
    if (options.port && incident.port !== options.port) return false;
    if (options.category && incident.category !== options.category) return false;
    if (options.violation && incident.violationClass !== options.violation) return false;
    if (options.contaminant && incident.contaminant !== options.contaminant) return false;
    if (options.year && String(new Date(incident.date).getUTCFullYear()) !== String(options.year)) return false;
    if (!meaningfulQuery) return true;

    const searchable = `${SEARCH_FIELDS.map(([field]) => incident[field] || '').join(' ')} ${aliasTextForIncident(incident, entities)}`;
    return countTerms(searchable, queryTerms).length > 0;
  }).map(incident => {
    const matchReasons = [];
    let score = 0;

    if (meaningfulQuery) {
      for (const [field, label] of SEARCH_FIELDS) {
        const matched = countTerms(incident[field], queryTerms);
        if (matched.length) {
          matchReasons.push(`${label}: ${matched.join(', ')}`);
          score += matched.length * (field === 'product' || field === 'contaminant' ? 4 : 2);
        }
      }
      const aliasMatches = countTerms(aliasTextForIncident(incident, entities), queryTerms);
      if (aliasMatches.length) {
        matchReasons.push(`linked entity: ${aliasMatches.join(', ')}`);
        score += aliasMatches.length * 3;
      }
    } else {
      matchReasons.push('matches selected filters');
      score = 1;
    }

    return { ...incident, score, matchReasons: [...new Set(matchReasons)] };
  });

  const sort = options.sort || 'relevance';
  items.sort((a, b) => {
    if (sort === 'oldest') return a.date.localeCompare(b.date);
    if (sort === 'newest') return b.date.localeCompare(a.date);
    if (b.score !== a.score) return b.score - a.score;
    return b.date.localeCompare(a.date);
  });

  return { query: q, expandedTerms: queryTerms, total: items.length, items };
}

function getRelatedIncidents(target, incidents) {
  if (!target) return [];
  return incidents.filter(item => item.id !== target.id).map(item => {
    const sharedSignals = [];
    let similarity = 0;
    const sharedEntities = (target.entityIds || []).filter(id => item.entityIds?.includes(id));
    if (sharedEntities.length) { sharedSignals.push('same normalized entity'); similarity += 5; }
    if (item.contaminant === target.contaminant) { sharedSignals.push('same contaminant'); similarity += 4; }
    if (item.category === target.category) { sharedSignals.push('same product category'); similarity += 2; }
    if (item.country === target.country) { sharedSignals.push('same origin country'); similarity += 2; }
    if (Math.abs(new Date(item.date) - new Date(target.date)) < 1000 * 60 * 60 * 24 * 370) {
      sharedSignals.push('within one year'); similarity += 1;
    }
    return { ...item, similarity, sharedSignals };
  }).filter(item => item.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || b.date.localeCompare(a.date))
    .slice(0, 6);
}

function getIncident(id, incidents, entities) {
  const incident = incidents.find(item => item.id === id);
  if (!incident) return null;
  return {
    ...incident,
    entities: entities.filter(entity => incident.entityIds?.includes(entity.id)),
    related: getRelatedIncidents(incident, incidents),
  };
}

function getEntityProfile(id, incidents, entities) {
  const entity = entities.find(item => item.id === id);
  if (!entity) return null;
  const linked = incidents.filter(item => item.entityIds?.includes(id)).sort((a, b) => a.date.localeCompare(b.date));
  const years = new Map();
  for (const item of linked) {
    const year = new Date(item.date).getUTCFullYear();
    years.set(year, (years.get(year) || 0) + 1);
  }
  const recurring = aggregate(linked, 'contaminant');
  return {
    entity,
    incidents: linked,
    timeline: [...years.entries()].map(([year, count]) => ({ year, count })),
    recurring,
    connectedEntities: entities.filter(candidate => candidate.id !== id && linked.some(item => item.entityIds?.includes(candidate.id))),
  };
}

function getRelationships(incidents, entities, focusId = '') {
  const selectedIncidents = focusId
    ? incidents.filter(item => item.id === focusId || item.entityIds?.includes(focusId) || getRelatedIncidents(item, incidents).some(r => r.id === focusId))
    : incidents;
  const involvedIds = new Set(selectedIncidents.flatMap(item => item.entityIds || []));
  const nodes = [
    ...entities.filter(entity => involvedIds.has(entity.id)).map(entity => ({ id: entity.id, label: entity.name, type: entity.type })),
    ...selectedIncidents.map(item => ({ id: item.id, label: item.id, detail: item.product, type: 'Incident' })),
  ];
  const links = selectedIncidents.flatMap(item => (item.entityIds || [])
    .filter(id => involvedIds.has(id))
    .map(id => ({ source: id, target: item.id, type: 'linked to' })));
  return { nodes, links };
}

function aggregate(items, field) {
  const counts = new Map();
  for (const item of items) {
    const label = item[field] || 'Not recorded';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function buildAnalytics(incidents) {
  const multiples = incidents.filter(item => Number(item.measured) > 0 && Number(item.limit) > 0)
    .map(item => item.measured / item.limit);
  const averageMultiple = multiples.length
    ? Number((multiples.reduce((sum, value) => sum + value, 0) / multiples.length).toFixed(2))
    : 0;
  return {
    total: incidents.length,
    byCountry: aggregate(incidents, 'country'),
    byCategory: aggregate(incidents, 'category'),
    byContaminant: aggregate(incidents, 'contaminant'),
    byViolation: aggregate(incidents, 'violationClass'),
    byPort: aggregate(incidents, 'port'),
    byYear: aggregate(incidents.map(item => ({ year: String(new Date(item.date).getUTCFullYear()) })), 'year')
      .sort((a, b) => a.label.localeCompare(b.label)),
    limitExceedances: { count: multiples.length, averageMultiple },
  };
}

function validateDataset(incidents, entities) {
  const errors = [];
  const ids = new Set();
  const entityIds = new Set(entities.map(entity => entity.id));
  for (const incident of incidents) {
    if (ids.has(incident.id)) errors.push(`Duplicate incident ID: ${incident.id}`);
    ids.add(incident.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incident.date || '') || Number.isNaN(Date.parse(incident.date))) errors.push(`Invalid date: ${incident.id}`);
    if (!/^https:\/\//.test(incident.sourceUrl || '')) errors.push(`Missing source URL: ${incident.id}`);
    if (String(incident.id).includes('DEMO')) errors.push(`Illustrative demo identifier: ${incident.id}`);
    if (incident.jurisdiction !== 'India') errors.push(`Non-India jurisdiction: ${incident.id}`);
    if (incident.authority !== 'FSSAI') errors.push(`Non-FSSAI authority: ${incident.id}`);
    if (typeof incident.confidence !== 'number' || incident.confidence < 0 || incident.confidence > 1) errors.push(`Invalid confidence: ${incident.id}`);
    for (const id of incident.entityIds || []) if (!entityIds.has(id)) errors.push(`Unknown entity ${id} in ${incident.id}`);
  }
  return { valid: errors.length === 0, errors, incidentCount: incidents.length, entityCount: entities.length };
}

module.exports = {
  normalize, tokenize, expandIntent, searchIncidents, getRelatedIncidents,
  getIncident, getEntityProfile, getRelationships, buildAnalytics, validateDataset,
};
