---
name: industry-patterns
description: >-
  Use when building domain-specific features. Loads DynamoDB schemas, API patterns,
  and compliance guidance for a vertical industry. Not when building generic CRUD
  (use standard profiles).
---

## Purpose

Load industry-specific patterns (DynamoDB schemas, API designs, compliance rules,
event-driven architectures) for the target domain and apply them to the current task.
Advisory — provides domain knowledge, does not implement code directly.

## Arguments

`/industry-patterns --domain {domain}`

Available domains:
- `logistics` — Shipment tracking, route optimization, warehouse operations, carrier APIs
- `inventory` — Stock tracking, reorder points, multi-location transfers, cycle counting
- `customs` — Tariff classification, duty calculation, export controls, denied party screening
- `energy` — Meter data ingestion, grid events, energy trading, demand response
- `carrier` — Carrier profiles, rate tables, lane pricing, performance scorecards
- `production` — Work orders, resource allocation, shift planning, capacity constraints
- `quality` — Inspections, defect classification, CAPA workflows, root cause analysis
- `returns` — RMA creation, return shipping, disposition, refund processing

## Steps

### 1. Load domain patterns

Read `references/{domain}.md` (relative to this skill folder, mapped from the `--domain` flag).

If the file doesn't exist, STOP: "Pattern file not found for domain '{domain}'.
Available: logistics, inventory, customs, energy, carrier, production, quality, returns."

### 2. Apply to current context

Inject the loaded patterns into the current conversation context:
- DynamoDB table designs and access patterns
- API endpoint structures
- Event-driven architecture patterns
- Compliance or regulatory considerations
- Domain-specific naming conventions

### 3. Advise on implementation

Based on the loaded patterns and the user's current task:
- Recommend specific DynamoDB pk/sk designs
- Suggest Lambda handler patterns for the domain
- Flag compliance requirements that apply
- Identify domain-specific edge cases

## Output

1. Summary of loaded patterns
2. Recommendations for current task
3. Suggested next step (implementation via `/iago-quick` or full workflow)

## Boundaries

- Advisory only — does not write application code
- Patterns are starting points — adapt to project-specific access patterns
- If the domain doesn't match any available pattern, suggest `/brainstorming` for custom design
