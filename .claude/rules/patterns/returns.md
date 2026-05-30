
<!-- Source: ECC returns-reverse-logistics -->

## Purpose

Provide patterns for returns and reverse logistics — RMA creation, return
tracking, inspection, disposition, and refund processing — using DynamoDB
for return records and API Gateway webhooks for status updates.

## Steps

### 1. DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get return | `RMA#{id}` | `DETAIL` | Return request details |
| Get return status | `RMA#{id}` | `STATUS` | Current status + location |
| List return events | `RMA#{id}` | `EVENT#{timestamp}` | Status history |
| List by customer | GSI1: `CUSTOMER#{id}` | `RMA#{date}` | Customer returns |
| List by status | GSI2: `STATUS#{status}` | `RMA#{id}` | Processing queue |
| Get disposition | `RMA#{id}` | `DISPOSITION` | Restock/refurb/scrap |
| List by order | `ORDER#{id}` | `RMA#{id}` | Returns per order |

### 2. Return lifecycle

`requested` → `approved` → `label_sent` → `in_transit` → `received` → `inspected` → `disposed` → `closed`

**API Gateway webhooks for external updates:**
- Carrier scan events → status: `in_transit`, `received`
- Warehouse scan → status: `inspected`
- Finance confirmation → status: `closed`

### 3. Disposition logic

After inspection, Lambda determines disposition:

| Condition | Disposition | Action |
|-----------|------------|--------|
| Like new, unopened | `restock` | Return to inventory (optimistic lock) |
| Minor damage, functional | `refurbish` | Route to refurb queue |
| Defective | `warranty_claim` | Create supplier claim record |
| Unrepairable | `scrap` | Remove from inventory, log write-off |

Store: `pk: RMA#{id}`, `sk: DISPOSITION`, attributes: `type`, `reason`, `decided_by`.

### 4. Refund processing

- Lambda calculates refund: original price - restocking fee (if applicable)
- Refund record: `pk: RMA#{id}`, `sk: REFUND`
- SES notification to customer with refund confirmation
- Integration point: external payment processor webhook for refund execution

### 5. Analytics

- Return rate by product: `GSI3: PRODUCT#{sku}`, `sk: RMA#{date}`
- Return reason analysis: aggregate disposition types per period
- Cost of returns: Lambda scheduled report, output to DynamoDB report table
- Flag high-return products for quality investigation

## Output

Advisory — provides data models, webhook patterns, and disposition logic.

## Boundaries

- Advisory patterns only — does not create infrastructure
- DynamoDB single-table design only
- Does not process actual refunds — provides integration patterns
- Does not cover forward logistics — use `/logistics`
- Does not dispatch agents
