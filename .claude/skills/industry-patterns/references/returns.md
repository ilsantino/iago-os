# Returns

Reference for the `/industry-patterns` skill — returns domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get return | `RMA#{id}` | `DETAIL` | Return request details |
| Get return status | `RMA#{id}` | `STATUS` | Current status + location |
| List return events | `RMA#{id}` | `EVENT#{timestamp}` | Status history |
| List by customer | GSI1: `CUSTOMER#{id}` | `RMA#{date}` | Customer returns |
| List by status | GSI2: `STATUS#{status}` | `RMA#{id}` | Processing queue |
| Get disposition | `RMA#{id}` | `DISPOSITION` | Restock/refurb/scrap |
| List by order | `ORDER#{id}` | `RMA#{id}` | Returns per order |

## RMA status vocabulary (with webhook mapping)

`requested` → `approved` → `label_sent` → `in_transit` → `received` → `inspected` → `disposed` → `closed`

- Carrier scan events → `in_transit`, `received`
- Warehouse scan → `inspected`
- Finance confirmation → `closed`

Disposition sk `DISPOSITION`, attrs `type`/`reason`/`decided_by`; types `restock` | `refurbish` | `warranty_claim` | `scrap`; restock re-enters inventory under optimistic lock.

Refund execution stays with the external payment processor — never in-house.
