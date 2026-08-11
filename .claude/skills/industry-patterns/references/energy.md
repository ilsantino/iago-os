# Energy

Reference for the `/industry-patterns` skill — energy domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get meter reading | `METER#{id}` | `READ#{timestamp}` | Time-series data |
| Get meter latest | `METER#{id}` | `LATEST` | Most recent reading |
| List readings by period | `METER#{id}` | `READ#{start}` to `READ#{end}` | Range query |
| Get grid event | `GRID#{region}` | `EVENT#{timestamp}` | Outage, demand response |
| Get energy price | `MARKET#{zone}` | `PRICE#{timestamp}` | Spot/forward prices |
| Get consumption summary | `METER#{id}` | `SUMMARY#{YYYY-MM}` | Monthly aggregate |

## TTL retention tiers

- Raw readings: 90-day TTL (archive to S3 before expiry)
- Hourly aggregates: 1-year TTL
- Monthly summaries: no TTL (permanent)
- Grid events: 2-year TTL

DR enrollment: `pk: DR_PROGRAM#{id}` / `sk: PARTICIPANT#{meter-id}`; settlement = actual vs baseline within the DR window.
