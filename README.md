# FoodSafe Intelligence — Final Demo

A working frontend and Node.js/Python backend for India-focused food alert investigation and product evidence checks. Designed for supermarket and kirana owners, hotel and restaurant procurement teams, compliance teams and food-safety analysts.

## Run

Double-click `START_DEMO.command` on macOS and keep its Terminal window open.

From the VS Code terminal, open this project folder and run:

```bash
npm start
```

Open http://127.0.0.1:4173. Requirements: Node.js 18+ and Python 3. No npm or Python packages need to be installed. The application works locally without internet; official source links require internet.

If port 4173 is already in use, stop the older demo with Control-C, or run `PORT=4174 npm start` and open http://127.0.0.1:4174.

## Five-minute presentation

1. Open Overview and introduce the two audiences: food businesses checking purchases and analysts investigating official records.
2. Open Safety check. Choose Pistachio kernel from the sample dropdown and click Check product evidence. Explain the historical product match, the official rejection record and the recommended document checks.
3. Choose Cashew kernels and run another check. Explain why a broad-category review is weaker evidence than a similar-product match.
4. Choose Whole wheat atta. The result has no known match in the cached subset; it does not establish that the current item is safe.
5. Browse the catalogue. Search `rajma`, `haldi` or `paneer`, or filter by grains, dals, dairy, oils or another category.
6. Demonstrate sample barcode `8901000000019` using Look up. This reads the local illustrative catalogue, not a live barcode registry.
7. Open a matched incident, then Search records, Relationships and Analytics to show the supporting evidence and computed connections.
8. Use the explanations in each check result to discuss matching and data coverage.

## Data and provenance

- **18 official cached FIRA incidents** and **27 normalized entities** drive regulatory search, evidence, relationships and analytics. These records cover 2024–2025, are not a complete or current FSSAI database, and retain official detail-page links.
- **36 illustrative inventory products across 12 food categories** demonstrate the business workflow. Product names use familiar Indian terminology. Suppliers, batch values and barcode identifiers are sample values and must not be presented as verified real stock.
- Catalogue entries do not increase the official rejection count. No additional official rejection data was scraped for this release.

## What a check means

The Python worker compares normalized product words, broad food-category families and origin countries. It returns one of:

- Historical alert match — a similar product appears in collected official rejection records.
- Review recommended — the broad category overlaps, without a strong product match.
- No known alert match — no relevant record is found in the collected subset.

Supplier names, batches and barcode numbers cannot establish a verified shipment match. Domestic products are not comprehensively covered by import-rejection data. The application does not test the physical food or issue a safety certificate. It uses deterministic rules rather than a trained AI model.

## Structure

- `app/`: accessible, responsive HTML/CSS/JavaScript interface.
- `server.js`: local Node HTTP server, APIs and validation.
- `python/engine.py`: search, analytics, relationships and product-check processing.
- `lib/python-engine.js`: Node-to-Python bridge with time and output limits.
- `lib/engine.js`: incident details, entity profiles and official-data validation.
- `data/incidents.json`: cached official rejection records.
- `data/entities.json`: normalized entity IDs and aliases.
- `data/catalog.json`: separate illustrative business inventory.
- `tests/`: backend, Python-worker, API and frontend verification.

## Verify

```bash
npm test
npm run validate
```

API routes include `GET /api/catalog`, `POST /api/product-check`, `GET /api/search`, `GET /api/incidents/:id`, `GET /api/entities/:id`, `GET /api/relationships`, `GET /api/analytics`, `GET /api/summary` and `GET /api/health`.
