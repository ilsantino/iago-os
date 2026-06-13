
<!-- Source: ECC production-scheduling -->

## Purpose

Provide patterns for production scheduling — work order management, resource
allocation, shift planning, and schedule optimization — using Lambda for
computation and DynamoDB for storage.

## Steps

### 1. DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get work order | `WO#{id}` | `DETAIL` | Order details, priority |
| List WO operations | `WO#{id}` | `OP#{sequence}` | Ordered operations |
| Get resource schedule | `RESOURCE#{id}` | `SLOT#{date}#{time}` | Time slots |
| List WOs by date | GSI1: `SCHEDULE#{date}` | `WO#{id}` | Daily schedule |
| List WOs by status | GSI2: `STATUS#{status}` | `WO#{id}` | Queue management |
| Get shift | `SHIFT#{date}#{line}` | `DETAIL` | Shift configuration |

### 2. Scheduling engine

**Lambda function for schedule computation:**
- Input: work orders (priority, due date, operations, duration)
- Constraints: resource availability, shift calendar, setup times
- Algorithm: priority-based forward scheduling with conflict detection
- Output: assigned time slots per operation per resource
- Timeout: 5 minutes (complex schedules may need extended compute)

**Schedule update flow:**
```
New/changed work order
  → Lambda: compute schedule
  → DynamoDB: write time slots (batch write)
  → DynamoDB Streams → Lambda: notify affected operators (SES)
```

### 3. Resource management

| Resource Type | Key Pattern | Attributes |
|--------------|-------------|------------|
| Machine | `RESOURCE#M#{id}` | Capacity, setup time, maintenance windows |
| Labor | `RESOURCE#L#{id}` | Skills, shift assignments, availability |
| Tooling | `RESOURCE#T#{id}` | Quantity, location, maintenance schedule |

Availability check: query `SLOT#{date}#{time}` range for conflicts before assigning.
Querying then writing is a TOCTOU — two concurrent schedule runs can both pass the
check and double-book the same `RESOURCE#{id}`/`SLOT#{date}#{time}` (a batch write
enforces no per-slot uniqueness). Make each slot assignment a **conditional write**
(`attribute_not_exists(sk)`) or a `TransactWriteItems`, so the second writer fails
the condition instead of overwriting an already-claimed slot.

### 4. Work order lifecycle

`draft` → `scheduled` → `released` → `in_progress` → `completed`
Branch: `on_hold` (material shortage, machine down) → `rescheduled`

Status changes trigger:
- DynamoDB Streams → Lambda for downstream notifications
- SES alerts for priority changes or delays
- Dashboard updates via API Gateway WebSocket (if real-time needed)

### 5. Shift planning

- Shifts defined per production line per date
- Capacity = available hours x resource efficiency factor
- Overtime rules as Lambda business logic
- Cognito role-based access: supervisors manage shifts, operators view only

## Output

Advisory — provides data models, scheduling patterns, and workflow designs.

## Boundaries

- Advisory patterns only — does not create infrastructure
- Lambda for scheduling computation — not a dedicated scheduling engine
- Simple priority-based scheduling — not advanced optimization (CP, LP solvers)
- DynamoDB single-table design only
- Does not dispatch agents
