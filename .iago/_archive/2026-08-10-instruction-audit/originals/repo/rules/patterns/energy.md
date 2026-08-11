
<!-- Source: ECC energy-* (consolidated) -->

## Purpose

Provide patterns for energy sector applications — smart metering, grid event
processing, energy trading, and demand response — using DynamoDB TTL for
time-series data and Lambda for scheduled processing.

## Steps

### 1. DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get meter reading | `METER#{id}` | `READ#{timestamp}` | Time-series data |
| Get meter latest | `METER#{id}` | `LATEST` | Most recent reading |
| List readings by period | `METER#{id}` | `READ#{start}` to `READ#{end}` | Range query |
| Get grid event | `GRID#{region}` | `EVENT#{timestamp}` | Outage, demand response |
| Get energy price | `MARKET#{zone}` | `PRICE#{timestamp}` | Spot/forward prices |
| Get consumption summary | `METER#{id}` | `SUMMARY#{YYYY-MM}` | Monthly aggregate |

**TTL strategy:**
- Raw readings: 90-day TTL (archive to S3 before expiry)
- Hourly aggregates: 1-year TTL
- Monthly summaries: no TTL (permanent)
- Grid events: 2-year TTL

### 2. Time-series processing

**Lambda scheduled processing:**
- Every 15 minutes: aggregate raw readings into 15-min intervals
- Every hour: compute hourly statistics (min, max, avg, total)
- Daily: compute daily summaries, detect anomalies
- Monthly: generate billing-grade consumption reports

**Event-driven processing:**
- DynamoDB Streams → Lambda for real-time anomaly detection
- Threshold alerts via SES (overconsumption, outage detection)
- n8n webhooks for external grid operator notifications

### 3. Energy trading patterns

| Pattern | Implementation |
|---------|---------------|
| Price ingestion | Lambda scheduled every 5min, writes to `MARKET#{zone}` |
| Position tracking | `TRADE#{id}` with sk `POSITION`, `SETTLEMENT` |
| Settlement | Lambda batch process, DynamoDB conditional writes |
| Risk calculation | Lambda with compute-heavy logic, 15min timeout |

### 4. Demand response

- Event notification: SES + Lambda push to enrolled participants
- Opt-in tracking: `pk: DR_PROGRAM#{id}`, `sk: PARTICIPANT#{meter-id}`
- Baseline calculation: Lambda reads historical consumption, computes baseline
- Settlement: compare actual vs baseline during DR event window

## Output

Advisory — provides data models, processing patterns, and TTL strategies.

## Boundaries

- Advisory patterns only — does not create infrastructure
- DynamoDB + Lambda only — does not use dedicated time-series databases
- TTL strategy assumes S3 archival is configured separately
- Does not integrate with specific grid operators or ISOs
- Does not dispatch agents
