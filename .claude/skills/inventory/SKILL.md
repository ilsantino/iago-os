---
name: inventory
description: >-
  Use when building inventory management features (stock tracking, reorder
  points, multi-location inventory). Not when building warehouse logistics
  (use /logistics) or production scheduling (use /production-scheduling).
---

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

On `ConditionalCheckFailedException`: retry with fresh read (max 3 retries).

### 3. Reorder automation

- Lambda scheduled daily: scan items where `quantity <= reorder_point`
- Generate purchase order records in DynamoDB
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
