# Customs

Reference for the `/industry-patterns` skill — customs domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get HTS classification | `HTS#{code}` | `DETAIL` | Tariff details + duty rate |
| Get shipment customs data | `SHIPMENT#{id}` | `CUSTOMS` | Declaration, status |
| List pending declarations | GSI1: `STATUS#pending` | `SHIPMENT#{id}` | Processing queue |
| Get party screening result | `PARTY#{name-hash}` | `SCREEN#{date}` | Denied party check |
| Get trade agreement | `AGREEMENT#{code}` | `DETAIL` | FTA, preferential rates |
| List compliance docs | `SHIPMENT#{id}` | `DOC#{type}#{date}` | Commercial invoice, packing list |

## Compliance caveats

- Restricted-party screening results are cached with 24h TTL — denied-party lists update daily.
- Screening matches are flagged for human review — NEVER auto-approve.
- Certificate of origin requires human sign-off.
- Customs audit records retained ≥5 years: `pk: AUDIT#CUSTOMS#{YYYY-MM}`, `sk: {timestamp}#{shipment-id}`.
