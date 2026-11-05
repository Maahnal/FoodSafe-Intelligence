#!/usr/bin/env python3
"""Dependency-free processing worker for FoodSafe Intelligence."""

import json
import sys
import unicodedata
from datetime import date


INTENT_MAP = {
    "heavy metal": ["lead", "arsenic", "cadmium", "mercury"],
    "heavy metals": ["lead", "arsenic", "cadmium", "mercury"],
    "mould": ["aflatoxin", "ochratoxin", "mycotoxin"],
    "mold": ["aflatoxin", "ochratoxin", "mycotoxin"],
    "pesticide": ["pesticide residue", "chlorpyrifos", "imidacloprid"],
    "microbial": ["salmonella", "e. coli", "listeria"],
    "bacteria": ["salmonella", "e. coli", "listeria"],
}

SEARCH_FIELDS = [
    ("product", "product"),
    ("category", "category"),
    ("country", "country"),
    ("exportingCountry", "exporting country"),
    ("exporter", "exporter"),
    ("contaminant", "parameter"),
    ("violationClass", "violation"),
    ("reason", "reason"),
    ("port", "rejection point"),
    ("id", "record ID"),
]

PRODUCT_STOPWORDS = {
    "and", "for", "food", "foods", "fresh", "grade", "kernel", "pack",
    "premium", "product", "products", "roasted", "the", "whole", "powder",
    "bag", "cup", "dried", "dry", "drink", "instant", "supplement", "nutrition",
}

CATEGORY_FAMILIES = {
    "fruits vegetables": "produce",
    "nuts seeds": "produce",
    "health supplements": "supplements",
    "nutraceuticals": "supplements",
    "confectionery snacks": "confectionery",
    "confectionery": "confectionery",
    "sweets confectionery sweetening agents": "confectionery",
    "proprietary food": "packaged",
    "packaged foods": "packaged",
    "beverages": "beverages",
    "spices condiments": "spices",
    "grains cereals": "grains",
    "pulses dals": "pulses",
    "edible oils": "oils",
    "dairy products": "dairy",
    "seafood seaweed": "seafood",
}


def normalize(value=""):
    decomposed = unicodedata.normalize("NFKD", str(value).lower())
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    cleaned = "".join(char if char.isascii() and (char.isalnum() or char == ".") else " " for char in without_marks)
    return " ".join(cleaned.split())


def unique(values):
    return list(dict.fromkeys(values))


def tokenize(value=""):
    return unique(token for token in normalize(value).split() if len(token) > 1)


def expand_intent(query=""):
    normalized = normalize(query)
    terms = tokenize(normalized)
    for intent, expansions in INTENT_MAP.items():
        if intent in normalized:
            terms.extend(expansions)
    return unique(terms)


def alias_text(incident, entities):
    values = []
    linked = set(incident.get("entityIds", []))
    for entity in entities:
        if entity.get("id") in linked:
            values.append(entity.get("name", ""))
            values.extend(entity.get("aliases", []))
    return " ".join(values)


def matching_terms(text, terms):
    haystack = normalize(text)
    return [term for term in terms if normalize(term) in haystack]


def product_tokens(value=""):
    tokens = []
    for token in tokenize(value):
        singular = token[:-1] if token.endswith("s") and len(token) > 3 else token
        if singular not in PRODUCT_STOPWORDS:
            tokens.append(singular)
    return set(tokens)


def category_family(value=""):
    normalized = " ".join(token for token in normalize(value).split() if token != "and" and token.isalpha())
    if not normalized:
        return ""
    for label, family in CATEGORY_FAMILIES.items():
        if label in normalized:
            return family
    return normalized


def check_product(payload):
    submitted = payload.get("input", {})
    catalog = payload.get("catalog", [])
    incidents = payload.get("incidents", [])
    catalog_match = next((item for item in catalog if item.get("id") == submitted.get("catalogId")), None)
    if not catalog_match and submitted.get("barcode"):
        catalog_match = next((item for item in catalog if item.get("barcode") == str(submitted.get("barcode")).strip()), None)
    # A previously selected barcode must never override a different typed food.
    if catalog_match and str(submitted.get("productName", "")).strip():
        typed_tokens = product_tokens(submitted["productName"])
        catalog_tokens = product_tokens(catalog_match["name"] + " " + " ".join(catalog_match.get("keywords", [])))
        if not typed_tokens.intersection(catalog_tokens):
            catalog_match = None

    def chosen(field, catalog_field=None):
        explicit = str(submitted.get(field, "")).strip()
        if explicit:
            return explicit
        return str((catalog_match or {}).get(catalog_field or field, "")).strip()

    input_value = {
        "catalogId": (catalog_match or {}).get("id", ""),
        "productName": chosen("productName", "name"),
        "category": chosen("category"),
        "originCountry": chosen("originCountry"),
        "supplier": chosen("supplier"),
        "batch": chosen("batch"),
        "barcode": chosen("barcode"),
    }
    if not input_value["productName"]:
        raise ValueError("Product name is required")

    keyword_text = " ".join((catalog_match or {}).get("keywords", []))
    query_text = f'{input_value["productName"]} {keyword_text}'.strip()
    query_tokens = product_tokens(query_text)
    query_name = normalize(input_value["productName"])
    input_family = category_family(input_value["category"])
    input_country = normalize(input_value["originCountry"])
    matches = []

    for incident in incidents:
        incident_name = normalize(incident.get("product", ""))
        incident_tokens = product_tokens(incident_name)
        overlap = query_tokens.intersection(incident_tokens)
        denominator = max(len(query_tokens), len(incident_tokens)) or 1
        overlap_ratio = len(overlap) / denominator
        phrase_match = bool(query_tokens and overlap) and len(query_name) > 3 and (query_name in incident_name or incident_name in query_name)
        strong_product = phrase_match or (bool(overlap) and overlap_ratio >= 0.5)
        same_category = bool(input_family) and input_family == category_family(incident.get("category", ""))
        same_country = bool(input_country) and input_country == normalize(incident.get("country", ""))

        score = (60 if strong_product else 0) + (20 if same_category else 0) + (15 if same_country else 0)
        if score < 20:
            continue
        reasons = []
        if strong_product:
            reasons.append(f'product terms overlap: {", ".join(sorted(overlap)) or input_value["productName"]}')
        if same_category:
            reasons.append("same broad food category")
        if same_country:
            reasons.append("same country of origin")
        matches.append({
            "id": incident.get("id"),
            "product": incident.get("product"),
            "date": incident.get("date"),
            "originCountry": incident.get("country"),
            "port": incident.get("port"),
            "reason": incident.get("reason"),
            "sourceUrl": incident.get("sourceUrl"),
            "score": score,
            "matchReasons": reasons,
            "matchStrength": "strong-product" if strong_product else "context-only",
        })

    matches.sort(key=lambda item: (item["score"], item.get("date", "")), reverse=True)
    strong_matches = [item for item in matches if item["matchStrength"] == "strong-product"]
    if strong_matches:
        status = "historical-alert-match"
        headline = "Historical alert evidence found"
        summary = "A closely matching product appears in the available official FIRA rejection records."
        visible_matches = strong_matches + [item for item in matches if item["matchStrength"] != "strong-product"][:2]
    elif matches:
        status = "review-recommended"
        headline = "Review recommended"
        summary = "Broad category or origin signals overlap with past records, but no exact product alert was found."
        visible_matches = matches[:5]
    else:
        status = "no-known-alert-match"
        headline = "No known alert match in this dataset"
        summary = "The available cached FIRA subset contains no matching historical rejection record."
        visible_matches = []

    signals = unique(reason for item in visible_matches for reason in item["matchReasons"])
    next_steps = [
        "Verify the supplier invoice, FSSAI licence and product label.",
        "Confirm the batch number, country of origin and remaining shelf life.",
        "Request a recent certificate of analysis when the product is high-risk or imported.",
    ]
    if status == "historical-alert-match":
        next_steps.insert(0, "Open the matched official record and compare the exact product and batch details.")

    return {
        "status": status,
        "headline": headline,
        "summary": summary,
        "input": input_value,
        "catalogMatch": catalog_match,
        "signals": signals,
        "matchedIncidents": visible_matches[:6],
        "nextSteps": next_steps,
        "verificationGaps": [
            "The current shipment, supplier and batch cannot be verified from this cached import-rejection dataset.",
            "Barcode lookup uses the illustrative catalogue only; no live barcode registry is connected.",
            "Coverage: 18 cached FIRA records from 2024–2025. Domestic products and current alerts are not comprehensively covered.",
        ],
        "scopeNotice": "This historical evidence check does not test the food or certify the current batch. No match does not establish safety.",
    }


def search_incidents(incidents, entities, options):
    query = options.get("q", "")
    terms = expand_intent(query)
    matches = []

    for incident in incidents:
        if options.get("country") and incident.get("country") != options["country"]:
            continue
        if options.get("port") and incident.get("port") != options["port"]:
            continue
        if options.get("category") and incident.get("category") != options["category"]:
            continue
        if options.get("violation") and incident.get("violationClass") != options["violation"]:
            continue
        if options.get("contaminant") and incident.get("contaminant") != options["contaminant"]:
            continue
        if options.get("year") and incident.get("date", "")[:4] != str(options["year"]):
            continue

        aliases = alias_text(incident, entities)
        searchable = " ".join(str(incident.get(field, "")) for field, _ in SEARCH_FIELDS) + " " + aliases
        if terms and not matching_terms(searchable, terms):
            continue

        reasons = []
        score = 0
        if terms:
            for field, label in SEARCH_FIELDS:
                found = matching_terms(incident.get(field, ""), terms)
                if found:
                    reasons.append(f"{label}: {', '.join(found)}")
                    score += len(found) * (4 if field in ("product", "contaminant") else 2)
            alias_matches = matching_terms(aliases, terms)
            if alias_matches:
                reasons.append(f"linked entity: {', '.join(alias_matches)}")
                score += len(alias_matches) * 3
        else:
            reasons.append("matches selected filters")
            score = 1

        result = dict(incident)
        result.update({"score": score, "matchReasons": unique(reasons)})
        matches.append(result)

    sort = options.get("sort", "relevance")
    if sort == "oldest":
        matches.sort(key=lambda item: item.get("date", ""))
    elif sort == "newest":
        matches.sort(key=lambda item: item.get("date", ""), reverse=True)
    else:
        matches.sort(key=lambda item: (item.get("score", 0), item.get("date", "")), reverse=True)

    return {"query": query, "expandedTerms": terms, "total": len(matches), "items": matches}


def related_incidents(target, incidents):
    if not target:
        return []
    related = []
    target_entities = set(target.get("entityIds", []))
    target_date = date.fromisoformat(target["date"])
    for item in incidents:
        if item.get("id") == target.get("id"):
            continue
        signals = []
        similarity = 0
        if target_entities.intersection(item.get("entityIds", [])):
            signals.append("same normalized entity")
            similarity += 5
        if item.get("contaminant") == target.get("contaminant"):
            signals.append("same contaminant")
            similarity += 4
        if item.get("category") == target.get("category"):
            signals.append("same product category")
            similarity += 2
        if item.get("country") == target.get("country"):
            signals.append("same origin country")
            similarity += 2
        if abs((date.fromisoformat(item["date"]) - target_date).days) < 370:
            signals.append("within one year")
            similarity += 1
        if similarity:
            value = dict(item)
            value.update({"similarity": similarity, "sharedSignals": signals})
            related.append(value)
    related.sort(key=lambda item: (item["similarity"], item.get("date", "")), reverse=True)
    return related[:6]


def relationships(incidents, entities, focus_id=""):
    if focus_id:
        selected = []
        for item in incidents:
            is_related_incident = any(value["id"] == focus_id for value in related_incidents(item, incidents))
            if item.get("id") == focus_id or focus_id in item.get("entityIds", []) or is_related_incident:
                selected.append(item)
    else:
        selected = incidents

    involved = set(entity_id for item in selected for entity_id in item.get("entityIds", []))
    nodes = [
        {"id": entity["id"], "label": entity["name"], "type": entity["type"]}
        for entity in entities if entity.get("id") in involved
    ]
    nodes.extend({"id": item["id"], "label": item["id"], "detail": item["product"], "type": "Incident"} for item in selected)
    links = [
        {"source": entity_id, "target": item["id"], "type": "linked to"}
        for item in selected for entity_id in item.get("entityIds", []) if entity_id in involved
    ]
    return {"nodes": nodes, "links": links}


def aggregate(items, field):
    counts = {}
    for item in items:
        label = item.get(field) or "Not recorded"
        counts[label] = counts.get(label, 0) + 1
    return sorted(
        ({"label": label, "value": value} for label, value in counts.items()),
        key=lambda item: (-item["value"], item["label"]),
    )


def analytics(incidents):
    multiples = [
        item["measured"] / item["limit"]
        for item in incidents
        if isinstance(item.get("measured"), (int, float)) and item.get("measured", 0) > 0
        and isinstance(item.get("limit"), (int, float)) and item.get("limit", 0) > 0
    ]
    average = round(sum(multiples) / len(multiples) + 1e-12, 2) if multiples else 0
    by_year = aggregate([{"year": item.get("date", "")[:4]} for item in incidents], "year")
    by_year.sort(key=lambda item: item["label"])
    return {
        "total": len(incidents),
        "byCountry": aggregate(incidents, "country"),
        "byCategory": aggregate(incidents, "category"),
        "byContaminant": aggregate(incidents, "contaminant"),
        "byViolation": aggregate(incidents, "violationClass"),
        "byPort": aggregate(incidents, "port"),
        "byYear": by_year,
        "limitExceedances": {"count": len(multiples), "averageMultiple": average},
    }


def dispatch(request):
    operation = request.get("operation")
    payload = request.get("payload", {})
    if operation == "health":
        return {"status": "ready", "language": "Python", "service": "foodsafe-processing"}
    if operation == "search":
        return search_incidents(payload["incidents"], payload["entities"], payload.get("options", {}))
    if operation == "analytics":
        return analytics(payload["incidents"])
    if operation == "relationships":
        return relationships(payload["incidents"], payload["entities"], payload.get("focusId", ""))
    if operation == "product_check":
        return check_product(payload)
    raise ValueError(f"Unknown operation: {operation}")


def main():
    try:
        request = json.load(sys.stdin)
        json.dump(dispatch(request), sys.stdout, separators=(",", ":"))
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
