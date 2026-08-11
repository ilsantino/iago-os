# Production

Reference for the `/industry-patterns` skill — production domain patterns.

## DynamoDB single-table design

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get work order | `WO#{id}` | `DETAIL` | Order details, priority |
| List WO operations | `WO#{id}` | `OP#{sequence}` | Ordered operations |
| Get resource schedule | `RESOURCE#{id}` | `SLOT#{date}#{time}` | Time slots |
| List WOs by date | GSI1: `SCHEDULE#{date}` | `WO#{id}` | Daily schedule |
| List WOs by status | GSI2: `STATUS#{status}` | `WO#{id}` | Queue management |
| Get shift | `SHIFT#{date}#{line}` | `DETAIL` | Shift configuration |

## Work order lifecycle

`draft` → `scheduled` → `released` → `in_progress` → `completed`
Branch: `on_hold` (material shortage, machine down) → `rescheduled`

## Concurrency caveat

Slot availability check-then-write is a TOCTOU — two concurrent schedule runs can both pass the check and double-book the same `RESOURCE#{id}`/`SLOT#{date}#{time}` (a batch write enforces no per-slot uniqueness). Each slot assignment must be a **conditional write** (`attribute_not_exists(sk)`) or `TransactWriteItems`, so the second writer fails the condition instead of overwriting an already-claimed slot.

Simple priority-based scheduling only — no CP/LP solvers.
