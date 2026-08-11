# Quality

Reference for the `/industry-patterns` skill — quality domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get NC record | `NC#{id}` | `DETAIL` | Nonconformance details |
| List NC by status | GSI1: `STATUS#{status}` | `NC#{id}` | Open/closed queue |
| List NC by product | GSI2: `PRODUCT#{sku}` | `NC#{date}` | Product history |
| Get inspection | `NC#{id}` | `INSPECTION#{date}` | Inspection record |
| Get CAPA | `NC#{id}` | `CAPA#{id}` | Corrective action |
| List NC by inspector | GSI3: `INSPECTOR#{id}` | `NC#{date}` | Inspector workload |

## NC lifecycle

`detected` → `documented` → `investigating` → `corrective_action` → `verified` → `closed`

## RBAC

Cognito groups + APIGW authorizer; inspector < quality_engineer < quality_manager (only manager closes NC / approves CAPA); operator views own NCs + acknowledges corrective actions.

CAPA effectiveness verified by an inspector before close.
