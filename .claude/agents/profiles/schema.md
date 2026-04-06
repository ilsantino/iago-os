---
name: schema
description: >-
  DynamoDB single-table schema design. Produces key schemas, GSI strategies,
  and access pattern analysis as design artifacts — does not write code.
base: analyst
model: sonnet
maxTurns: 15
capabilities:
  - dynamodb
---

## Match Signals

Dispatch this profile when:
- Task is schema design or data modeling for DynamoDB
- Task requires access pattern analysis before implementation begins
- Task involves GSI strategy planning or evaluation
- Task audits an existing table design for hot partitions or missing patterns
