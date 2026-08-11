# Logistics

Reference for the `/industry-patterns` skill — logistics domain patterns.

## DynamoDB single-table design

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

## Status vocabulary

`created` → `picked_up` → `in_transit` → `out_for_delivery` → `delivered`
Branch: `exception` → `investigating` → `resolved`

Cache computed routes with TTL valid-until-departure.
