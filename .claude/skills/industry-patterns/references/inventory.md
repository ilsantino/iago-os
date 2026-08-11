# Inventory

Reference for the `/industry-patterns` skill — inventory domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get item stock | `ITEM#{sku}` | `STOCK#{location}` | Quantity + version |
| Get item detail | `ITEM#{sku}` | `DETAIL` | Name, category, unit |
| List low stock | GSI1: `ALERT#low-stock` | `ITEM#{sku}` | Reorder trigger |
| List by location | GSI2: `LOC#{id}` | `ITEM#{sku}` | Location inventory |
| Get transaction | `ITEM#{sku}` | `TXN#{timestamp}` | Stock movement |
| Get reorder config | `ITEM#{sku}` | `REORDER` | Min, max, lead time |

## Incident-derived caveats

1. **ConditionalCheckFailedException triage.** On `ConditionalCheckFailedException`, re-read the item, then distinguish the two failure causes the combined `ConditionExpression` collapses — a **version drift** (concurrent write) is retryable (fresh read, max 3 retries), but a **`quantity >= :qty` failure** is genuine insufficient stock and must fail fast as out-of-stock (retrying only burns attempts before surfacing the same condition).
2. **Reorder PO idempotency.** Before creating a purchase order, check for an existing **open** replenishment PO keyed by SKU/location/cycle and use a conditional write (`attribute_not_exists`), so a retry or a repeated daily run while stock stays below threshold does not create duplicate POs.
3. **Multi-location transfer is NOT atomic across partitions.** The source-decrement and destination-increment target different partition keys and are separated by an external confirmation — if the destination-increment never fires (crash, abandoned confirmation, lost webhook), stock is decremented at source but never re-added, a permanent loss with the transfer stuck `in_transit`. Guard it: make the source-debit + transfer-status leg a `TransactWriteItems`, and add a reconciliation/idempotency sweep that compensates (re-credits source) any transfer left `in_transit` past a timeout.
