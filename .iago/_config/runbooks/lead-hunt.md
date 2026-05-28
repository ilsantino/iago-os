# Runbook: lead-hunt — Scrapling discovery + Apollo enrichment

Hybrid lead workflow per Santiago's call: **Scrapling does discovery** (free,
volume), **Apollo does validation + enrichment** (paid, surgical). The
`/lead-hunt` skill produces the canonical Lead CSV; this runbook covers when to
stop at the free output and when to layer Apollo on top.

## When to run free-only

Stay on the Scrapling-only `/lead-hunt` output (no Apollo spend) when:

- One-off prospect lookups — checking a single company or directory.
- Volume is **≤50 leads**.
- Sources are **public sites** (member directories, public profiles, company team pages).
- Exploratory research — sizing a market or building an initial list before a campaign is committed.

The free CSV is enough to triage and prioritize. Only escalate to Apollo when the
cost of a bad/unverified contact (bounced email, wrong role) exceeds the Apollo
credit cost.

## When to layer Apollo

Layer Apollo enrichment on top of the free CSV when:

- An **active outreach campaign** is committed (emails will actually be sent).
- You need an **email-deliverability guarantee** (bounce rate matters to sender reputation).
- **Role validation** is required for engagements **≥$5k value** — confirming the
  contact still holds the cargo before pitching.
- The free-only output shows a **`needs_apollo_validation` rate >50%** — i.e. Scrapling
  found names/companies but couldn't verify enough emails/titles to trust the list as-is.

## Apollo workflow on a CSV

1. **Import** the `/lead-hunt` CSV to Apollo as a list.
2. **Bulk email-verify** the rows that already have an `email` value — cheapest first pass.
3. **Bulk people-search** Apollo for rows where `needs_apollo_validation=true` (no email,
   low confidence, or inferred title).
4. **Enrich** confirmed rows with direct dial + current cargo + current company tenure.
5. **Export back** and merge into the iaGO CRM, deduped on `linkedin_url` first, then
   `email_normalized` (same normalization the skill uses: lowercase + strip + NFC).

## Credit budget heuristic

Target **≤0.3 Apollo credits per usable lead** by routing discovery through Scrapling
first — the free pass should eliminate the cheap-to-find contacts before Apollo touches
them. If observed **cost-per-lead exceeds 0.5 credits over 3 consecutive campaigns**,
audit which step is burning credits. The usual culprit is **people-search on rows where
Scrapling found nothing** — those are often non-existent leads, not Apollo misses, so
spending search credits on them is pure waste. Cut those rows before the Apollo pass.
