---
name: lead-hunt
description: >-
  Use for iaGO prospecting and high-value-target enrichment — Scrapling-MCP-backed
  lead discovery from public sites that emits a canonical Lead CSV with confidence
  scoring and an Apollo-validation flag (5-50 leads, public directories/profiles).
  Not when scraping authenticated platforms (LinkedIn logueado, Apollo UI) or when
  volume >100 leads needs paid tooling — use Apollo directly.
---

## Purpose

Free, repeatable lead discovery for iaGO's own prospecting. Orchestrates the
Scrapling MCP server (registered globally per `feature-lead-hunt-scrapling/01`)
to pull contact blocks from public web sources, structures them into a canonical
Lead schema, scores each lead's confidence, and flags which rows need paid Apollo
validation/enrichment. Output is a CSV ready for the hybrid workflow in the
runbook — Scrapling does discovery (free, volume), Apollo does validation
(paid, surgical). iaGO-internal tool, not a client deliverable.

## Arguments

- `--source {url}` **(required)** — public page or directory to discover from.
- `--target-role "{phrase or regex}"` *(optional)* — filter candidates by title.
  Validated via `re.compile()` before use; a malformed regex → **STOP** with the
  compile error. Treated as a regex; plain phrases match as substrings.
- `--max {N}` *(default 50)* — hard ceiling **200**. Above 200 → warn and clamp to 200.
  Sweet spot is 5–50; the **100–200 band is permitted but discouraged** — at that volume
  the anti-trigger applies, so above 100 also warn that Apollo is likely the better tool.
  The 200 cap is a technical safety limit, not a recommendation.
- `--output {csv_path}` *(default `leads-{YYYY-MM-DD-HHMMSS}.csv`)* — full timestamp
  prevents collision. If the path already exists, append `-1`, `-2`, … — never overwrite.

## Lead schema (inline)

CSV columns, in order:

| field | type | notes |
|-------|------|-------|
| `name` | str | full name |
| `title` | str | role/cargo (empty if unknown) |
| `company` | str | |
| `company_domain` | str | bare domain, no scheme |
| `email` | str | empty if not found |
| `linkedin_url` | str | public profile only |
| `source_url` | str | page the lead was discovered on |
| `confidence` | float | 0.0–1.0, see rubric |
| `needs_apollo_validation` | bool | see rubric |
| `discovered_at` | str | ISO8601 UTC, `Z` suffix |
| `notes` | str | free text (e.g. "title inferred from page section") |

## Confidence rubric

- name + title + company + verifiable email-pattern → **0.8–1.0**
- name + company + inferred title → **0.5–0.7**
- name + company only → **0.2–0.4**

`needs_apollo_validation = (confidence < 0.5) OR (email is None) OR (title is inferred)`

## Steps

1. **Validate args.** Compile `--target-role` regex (malformed → STOP). Confirm
   `--source` is a well-formed URL. Confirm output dir is writable. Clamp `--max ≤ 200`.
2. **Pick fetcher.** HEAD-test the source: if the `Server` header shows no
   `Cloudflare`, use `fetch` (static HTML). If Cloudflare/anti-bot is detected, use
   `stealthy_fetch`. Use `bulk_stealthy_fetch` **only** when the source yields a
   list-of-pages **and** `--max ≥ 10` — its bulk variant handles internal pacing.
   For single-call sequencing, the orchestrator enforces the rate limit by issuing
   **one MCP call at a time with `sleep 2` between calls** — rate-limiting comes from
   sequencing, NOT from any Scrapling internal config. Document this honestly.
3. **Extract** candidate contact blocks and structure them into Lead records.
4. **Score** each record per the confidence rubric.
5. **Dedupe** with normalization: lowercase + `strip()` + Unicode **NFC** normalize
   the key. Key = `email_normalized` OR (`name_normalized + "|" + company_normalized`).
   NFC collapses `José`/`José` (composed vs decomposed); lowercase handles `JOSE`/`jose`;
   strip handles trailing whitespace.
6. **Write CSV** — UTF-8 **no BOM**, comma delimiter, RFC 4180 quoting via Python
   `csv.QUOTE_MINIMAL`, header row, ISO8601 dates with `Z` suffix.
7. **Print summary**: `Wrote N leads to {path}. M need Apollo validation (M/N = X%).
   Average confidence: Y.`

## Failure modes

- **Zero candidate blocks extracted** → write an empty CSV with the header row and
  print `Wrote 0 leads.` Do **NOT** error.
- **All fetcher tiers return 403/blocked** → **STOP** with an explicit message naming
  the tiers actually attempted (`fetch`, `stealthy_fetch`, and `bulk_stealthy_fetch` only when
  it was used per step 2); do **NOT** write a CSV.
- **Scrapling MCP unreachable** → **STOP** and direct the user to
  `feature-lead-hunt-scrapling/01` verification (re-run `/mcp`, confirm `scrapling` connected).

## Boundaries

- Respect `robots.txt` — Scrapling honors it by default; do **NOT** override.
- Absolute max **200 leads/run**.
- Never attempt logged-in LinkedIn. `linkedin.com/in/` URLs requiring auth are out of
  scope; public profiles via Google cache only.

See the hybrid Apollo workflow + credit-budget heuristic in the runbook:
[`../../../.iago/_config/runbooks/lead-hunt.md`](../../../.iago/_config/runbooks/lead-hunt.md).

## Example invocation

```
/lead-hunt --source https://www.amhpac.org/socios/ --target-role "director general OR CEO" --max 5
```

Discovers up to 5 leads from the AMHPAC public member directory, filtering to
director-general / CEO roles. Produces `leads-2026-05-28-153012.csv` and prints,
for example: `Wrote 5 leads to leads-2026-05-28-153012.csv. 3 need Apollo
validation (3/5 = 60%). Average confidence: 0.52.` A `needs_apollo_validation`
rate above 50% is the runbook's trigger to layer Apollo enrichment on top.
