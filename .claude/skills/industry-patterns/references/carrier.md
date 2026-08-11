# Carrier

Reference for the `/industry-patterns` skill — carrier domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get carrier | `CARRIER#{id}` | `PROFILE` | Carrier details |
| List carrier rates | `CARRIER#{id}` | `RATE#{lane}#{effective-date}` | Rate history |
| Get carrier performance | `CARRIER#{id}` | `PERF#{YYYY-MM}` | Monthly KPIs |
| List carriers by lane | GSI1: `LANE#{origin}-{dest}` | `RATE#{carrier-id}` | Rate comparison |
| List carrier documents | `CARRIER#{id}` | `DOC#{type}#{date}` | Insurance, certs |
| Get carrier contacts | `CARRIER#{id}` | `CONTACT#{role}` | Dispatch, billing |

Monthly KPIs stored at `CARRIER#{id}`/`PERF#{YYYY-MM}`.
