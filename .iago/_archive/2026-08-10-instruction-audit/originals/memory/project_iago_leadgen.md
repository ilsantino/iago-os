---
name: iago-leadgen
description: Lead-gen pipeline at ~/dev/iago-leadgen — Lusha Professional is the live data backbone (2026-06-10); Apollo dead/parked; repa tenant shipped first real contact deliverable
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab38c18-9a86-4cb7-9f7a-69610bdaff1a
---

Multi-tenant Python lead-gen pipeline at `~/dev/iago-leadgen` (github.com/ilsantino/iago-leadgen). Managed-service pivot per ADR 000; dashboard parked. Tenant 1 = repa (Pedro Palomino, pipas de acero inoxidable, WhatsApp-first outreach).

**Lusha Professional is the contact-data backbone** (validated live 2026-06-10): annual plan to 2027-06-08, ~7,080 credits left, key in `tenants/repa/secrets.env` (`LUSHA_API_KEY`). Search 1cr/25, email 1cr, phone 5cr, misses free. V3 integration in `orchestrator/steps/lusha_v3.py` + `scripts/lusha_batch_run.py` (hard credit cap, canReveal-projected budgeting). First real deliverable: `tenants/repa/deliverables/repa-lusha-contacts-2026-06-10.xlsx` — 46 contacts, 31 A+ emails, 18/28 companies, 205 credits.

**Apollo is dead and permanently parked** — key 401s, and Lusha covers both discovery (prospecting) + enrichment with better mobiles for WhatsApp. Don't recommend Apollo Basic again unless Lusha MX coverage fails at scale.

**Lusha API landmines (live-verified 2026-06-10):** `/v3/contacts/decision-makers` 500s on everything (use `/v3/contacts/prospecting`); prospecting company `ids` filter silently returns 0 (filter by `domains`); V2 person API rejects its own schema; departments taxonomy folds logistics/procurement into "Operations" + "General Management"; seniority ids manager=5 director=6 vp=8 c-suite=9. Spec archived at `docs/api-specs/lusha-openapi-v3.json`.

**Why:** the 2026-05-28 "deprioritized, sucks and costs more than the skill" verdict applied to the free-tools contact-discovery dead end — the paid Lusha plan unblocked it for the repa managed-service motion specifically.

**How to apply:** for repa contact batches run `scripts/lusha_batch_run.py repa --dry-run` first, inspect, then full run. Branch `feat/productization-backend-foundations` (commits NOT pushed without authorization). For ad-hoc iaGO prospecting outside repa, `/lead-hunt` skill still applies.
