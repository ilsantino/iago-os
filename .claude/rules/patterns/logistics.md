
<!-- Source: ECC logistics-* (consolidated) -->

## Purpose

Provide patterns for logistics and supply chain applications — shipment tracking,
route planning, warehouse operations, and event-driven status updates — using
DynamoDB single-table design and n8n webhook patterns.

## Steps

### 1. DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get shipment | `SHIPMENT#{id}` | `DETAIL` | Shipment metadata |
| Get shipment status | `SHIPMENT#{id}` | `STATUS` | Current status + location |
| List shipment events | `SHIPMENT#{id}` | `EVENT#{timestamp}` | Status history |
| List by customer | GSI1: `CUSTOMER#{id}` | `SHIPMENT#{date}` | Customer's shipments |
| List by status | GSI2: `STATUS#{status}` | `SHIPMENT#{id}` | Filter by status |
| Get route | `ROUTE#{id}` | `DETAIL` | Planned route |
| List route stops | `ROUTE#{id}` | `STOP#{sequence}` | Ordered stops |
| Get warehouse item | `WH#{id}#LOC#{zone}` | `ITEM#{sku}` | Location lookup |

### 2. Event-driven tracking

**Status update flow:**
```
External event (carrier webhook / scan)
  → API Gateway
  → Lambda: validate, update DynamoDB
  → DynamoDB Streams
  → Lambda: notify stakeholders (SES), update dashboards
```

**Standard shipment statuses:**
`created` → `picked_up` → `in_transit` → `out_for_delivery` → `delivered`
Branch: `exception` → `investigating` → `resolved`

**n8n integration:**
- Webhook receiver for carrier status updates
- Scheduled polling for carriers without webhooks
- Alert workflows for exceptions and delays

### 3. Route optimization patterns

- Lambda function for route calculation (time-windowed delivery)
- Input: stops with time windows, vehicle capacity constraints
- Output: ordered stop sequence with ETAs
- Cache computed routes in DynamoDB with TTL (valid until departure)

### 4. Warehouse operations

| Operation | Pattern |
|-----------|---------|
| Receiving | Scan → Lambda → DynamoDB put (location assignment) |
| Picking | Order → Lambda → DynamoDB query (location lookup) → pick list |
| Packing | Pack confirmation → Lambda → update shipment status |
| Shipping | Label generation → carrier API → status: `picked_up` |

Optimistic locking on inventory counts: `version` attribute with conditional writes.

## Output

Advisory — provides data models, event patterns, and integration strategies.

## Boundaries

- Advisory patterns only — does not create infrastructure
- DynamoDB single-table design only — no relational modeling
- Does not integrate with specific carrier APIs — provides webhook patterns
- Does not cover carrier management — use `/industry-patterns --domain carrier`
- Does not cover returns — use `/industry-patterns --domain returns`
- Does not dispatch agents
