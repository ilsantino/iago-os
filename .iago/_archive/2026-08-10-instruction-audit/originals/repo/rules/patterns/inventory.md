
<!-- Source: ECC inventory-* (consolidated) -->

## Purpose

Provide patterns for inventory management — stock levels, reorder automation,
multi-location tracking, and cycle counting — using DynamoDB single-table design
with optimistic locking.

## Steps

### 1. DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get item stock | `ITEM#{sku}` | `STOCK#{location}` | Quantity + version |
| Get item detail | `ITEM#{sku}` | `DETAIL` | Name, category, unit |
| List low stock | GSI1: `ALERT#low-stock` | `ITEM#{sku}` | Reorder trigger |
| List by location | GSI2: `LOC#{id}` | `ITEM#{sku}` | Location inventory |
| Get transaction | `ITEM#{sku}` | `TXN#{timestamp}` | Stock movement |
| Get reorder config | `ITEM#{sku}` | `REORDER` | Min, max, lead time |

### 2. Optimistic locking

Every stock update uses conditional writes to prevent overselling:

```typescript
// Decrement stock with version check
await docClient.update({
  TableName: TABLE,
  Key: { pk: `ITEM#${sku}`, sk: `STOCK#${location}` },
  UpdateExpression: "SET quantity = quantity - :qty, version = version + :one",
  ConditionExpression: "version = :currentVersion AND quantity >= :qty",
  ExpressionAttributeValues: {
    ":qty": orderQty,
    ":currentVersion": currentVersion,
    ":one": 1
  }
});
```

On `ConditionalCheckFailedException`: re-read the item, then distinguish the two
failure causes the combined `ConditionExpression` collapses — a **version drift**
(concurrent write) is retryable (fresh read, max 3 retries), but a **`quantity >= :qty`
failure** is genuine insufficient stock and must fail fast as out-of-stock (retrying
only burns attempts before surfacing the same condition).

### 3. Reorder automation

- Lambda scheduled daily: scan items where `quantity <= reorder_point`
- Generate purchase order records in DynamoDB — guard idempotency: before creating a
  PO, check for an existing **open** replenishment PO keyed by SKU/location/cycle and
  use a conditional write (`attribute_not_exists`), so a retry or a repeated daily run
  while stock stays below threshold does not create duplicate POs
- Notify via SES to procurement team
- n8n workflow for supplier API integration (if applicable)

### 4. Multi-location transfers

Transfer flow:
1. Create transfer record: `pk: TRANSFER#{id}`, `sk: DETAIL`
2. Decrement source location (optimistic lock)
3. Set transfer status: `in_transit`
4. On confirmation: increment destination (optimistic lock)
5. Update transfer status: `completed`

Use DynamoDB transactions for atomic multi-item updates when transferring
multiple SKUs in one operation.

The source-decrement and destination-increment target different partition keys and
are separated by an external confirmation, so a single-SKU hop is **not** atomic: if
the destination-increment never fires (crash, abandoned confirmation, lost webhook),
stock is decremented at source but never re-added — a permanent loss with the transfer
stuck `in_transit`. Guard it: make the source-debit + transfer-status leg a
`TransactWriteItems`, and add a reconciliation/idempotency sweep that compensates
(re-credits source) any transfer left `in_transit` past a timeout.

### 5. Cycle counting

- Lambda generates count tasks: `pk: COUNT#{date}`, `sk: ITEM#{sku}#{location}`
- Cognito role-based access: only authorized counters can submit
- Variance detection: flag discrepancies > 5% for investigation
- Adjustment records: `pk: ITEM#{sku}`, `sk: TXN#{timestamp}` with type `adjustment`

## Output

Advisory — provides data models, locking patterns, and automation strategies.

## Boundaries

- Advisory patterns only — does not create infrastructure
- DynamoDB single-table design with optimistic locking — no database locks
- Does not handle accounting/financial inventory valuation (FIFO, LIFO, WAC)
- Does not dispatch agents
