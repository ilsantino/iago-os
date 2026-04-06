# DynamoDB Capability

## Choosing: Single-Table vs Multi-Table

Evaluate before designing. Neither is universally correct.

### Choose single-table when:
- Multiple entities have overlapping access patterns (e.g., "get user and their orders in one query")
- You need transactional writes across entity types (`TransactWriteItems`)
- Access patterns are well-defined upfront and unlikely to change
- The team has DynamoDB experience — single-table has a steep learning curve
- You need to minimize table count for cost/operational simplicity

### Choose multi-table when:
- Entities have independent access patterns with no cross-entity queries
- Entities have very different throughput profiles (orders at 1000 WCU vs audit logs at 10 WCU)
- Using Amplify Gen 2 `defineData` — AppSync models map naturally to per-entity tables
- The client's team will maintain the code — multi-table is easier to understand and debug
- Access patterns will evolve significantly (single-table key design is hard to change)
- You need different backup/restore policies per entity

### Hybrid approach
Use single-table for tightly related entities (user + profile + settings) and separate tables for independent domains (analytics, audit logs, notifications). This is often the right answer.

**Always state which approach you chose and why in the schema artifact.**

## Single-Table Design

- Access patterns drive schema — never start from entity relationships
- All entities share one table; `pk` and `sk` encode entity type and relationships
- Every recommendation must include: key schema, access pattern it serves, and example items

### Key Schema
- `pk` (partition key): entity type + identifier — e.g., `USER#123`, `ORDER#456`
- `sk` (sort key): relationship or attribute — e.g., `PROFILE`, `ORDER#2024-01-15#789`
- Composite keys enable hierarchical queries: `pk = USER#123 AND sk BEGINS_WITH ORDER#`
- Overloaded keys: same attribute stores different entity types in the same table

### Entity Structure
Every item includes: `pk`, `sk`, `entityType`, `createdAt`, `updatedAt`
Optional fields: `GSI1PK`, `GSI1SK`, `TTL`

## Multi-Table Design

- One table per entity or bounded context — e.g., `Users`, `Orders`, `AuditLogs`
- Each table has its own key schema optimized for that entity's access patterns
- No overloaded keys — `pk` is the natural identifier (e.g., `userId`, `orderId`)
- Cross-entity queries use application-level joins or denormalization

### Key Schema
- Simple keys: `pk = userId` or composite `pk = tenantId, sk = orderId`
- No entity-type prefixes needed — the table name provides context
- Each table gets its own GSIs tailored to its access patterns (still max 5 per table)

### When to denormalize
- Embed frequently-read related data (e.g., order includes customer name)
- Accept write amplification for read performance
- Use DynamoDB Streams + Lambda for cross-table sync when consistency matters

## Common Patterns (Both Approaches)

### Client Usage
- Use `DocumentClient` with typed helper functions — no ORMs, no Mongoose-style abstractions
- Typed helpers wrap every access pattern: `getUser(id)`, `listUserOrders(userId)`, etc.

### GSI Strategy
- Plan GSIs upfront — max 5 per table, cannot add more without redesign
- GSI1: most common alternate access pattern (e.g., query by email instead of ID)
- Sparse GSIs: only items with the GSI key appear — useful for status-based filtering
- Project only needed attributes — reduces cost and read capacity units

### Batch Operations
- `batchWrite`: max 25 items per call
- `batchGet`: max 100 items per call
- Handle unprocessed items — retry with exponential backoff

### TTL and Reads
- TTL attribute (Unix epoch number) for auto-expiring records — sessions, temp tokens, cache
- Default to eventually consistent reads; use consistent reads only when staleness is unacceptable
- Even key distribution: avoid hot partitions by varying `pk` values
