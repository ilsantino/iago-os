# DynamoDB Capability

## Design Principles

- Single-table design: access patterns drive schema — never start from entity relationships
- All entities share one table; `pk` and `sk` encode entity type and relationships
- Every recommendation must include: key schema, access pattern it serves, and example items

## Key Schema

- `pk` (partition key): entity type + identifier — e.g., `USER#123`, `ORDER#456`
- `sk` (sort key): relationship or attribute — e.g., `PROFILE`, `ORDER#2024-01-15#789`
- Composite keys enable hierarchical queries: `pk = USER#123 AND sk BEGINS_WITH ORDER#`
- Overloaded keys: same attribute stores different entity types in the same table

## Entity Structure

Every item includes: `pk`, `sk`, `entityType`, `createdAt`, `updatedAt`
Optional fields: `GSI1PK`, `GSI1SK`, `TTL`

## Client Usage

- Use `DocumentClient` with typed helper functions — no ORMs, no Mongoose-style abstractions
- Typed helpers wrap every access pattern: `getUser(id)`, `listUserOrders(userId)`, etc.

## GSI Strategy

- Plan GSIs upfront — max 5 per table, cannot add more without redesign
- GSI1: most common alternate access pattern (e.g., query by email instead of ID)
- Sparse GSIs: only items with the GSI key appear — useful for status-based filtering
- Project only needed attributes — reduces cost and read capacity units

## Batch Operations

- `batchWrite`: max 25 items per call
- `batchGet`: max 100 items per call
- Handle unprocessed items — retry with exponential backoff

## TTL and Reads

- TTL attribute (Unix epoch number) for auto-expiring records — sessions, temp tokens, cache
- Default to eventually consistent reads; use consistent reads only when staleness is unacceptable
- Even key distribution: avoid hot partitions by varying `pk` values
