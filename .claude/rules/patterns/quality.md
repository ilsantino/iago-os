
<!-- Source: ECC quality-nonconformance -->

## Purpose

Provide patterns for quality nonconformance management — inspection recording,
defect classification, corrective/preventive actions (CAPA), and role-based
access for quality inspectors using DynamoDB and Cognito.

## Steps

### 1. DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get NC record | `NC#{id}` | `DETAIL` | Nonconformance details |
| List NC by status | GSI1: `STATUS#{status}` | `NC#{id}` | Open/closed queue |
| List NC by product | GSI2: `PRODUCT#{sku}` | `NC#{date}` | Product history |
| Get inspection | `NC#{id}` | `INSPECTION#{date}` | Inspection record |
| Get CAPA | `NC#{id}` | `CAPA#{id}` | Corrective action |
| List NC by inspector | GSI3: `INSPECTOR#{id}` | `NC#{date}` | Inspector workload |

### 2. Nonconformance lifecycle

`detected` → `documented` → `investigating` → `corrective_action` → `verified` → `closed`

Each status change:
- Logged as event: `pk: NC#{id}`, `sk: EVENT#{timestamp}`
- Triggers notification via SES to responsible party
- Updates dashboard via API Gateway

### 3. Cognito role-based access

| Role | Permissions |
|------|------------|
| `inspector` | Create NC, record inspections, upload evidence |
| `quality_engineer` | All inspector + assign CAPA, change status |
| `quality_manager` | All engineer + close NC, approve CAPA, run reports |
| `operator` | View own NC records, acknowledge corrective actions |

Implement via Cognito groups + API Gateway authorizer that checks group membership.

### 4. CAPA workflow

Corrective/Preventive Action tracking:
- Root cause analysis record: `pk: NC#{id}`, `sk: CAPA#{id}`
- Action items with assignees and due dates
- Verification step: inspector confirms effectiveness
- Lambda scheduled job: flag overdue CAPAs, notify via SES

### 5. Reporting

- Lambda generates reports on demand or scheduled:
  - NC by category (material, process, equipment, human)
  - NC trend by time period
  - CAPA effectiveness rate
  - Inspector productivity
- Store reports: `pk: REPORT#QA#{YYYY-MM}`, `sk: {type}`

## Output

Advisory — provides data models, RBAC patterns, and CAPA workflows.

## Boundaries

- Advisory patterns only — does not create infrastructure
- DynamoDB single-table design + Cognito RBAC only
- Does not replace quality management systems (QMS) — provides building blocks
- Does not dispatch agents
