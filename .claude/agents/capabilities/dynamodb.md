# DynamoDB Capability

Referenced by rules/aws-amplify.md for the single-vs-multi-table decision. Standard DynamoDB mechanics (keys, GSIs, batch limits, TTL) need no restating — only the house framework below.

## Single-table vs multi-table — decide per project

- **Single-table when:** overlapping cross-entity access patterns, transactional writes across entity types, access patterns stable and known upfront.
- **Multi-table when:** independent access patterns, very different throughput profiles, Amplify Gen 2 `defineData` (models map to per-entity tables), client team will maintain the code, or patterns will evolve.
- **Hybrid** (single-table for tightly related entities + separate tables for independent domains) is often the right answer.
- Always state the choice and reasoning in the schema artifact.

## House conventions

- Access patterns drive schema — never start from entity relationships.
- `DocumentClient` + typed helpers wrapping each access pattern — no ORMs.
- Schema artifacts include: key schema, the access pattern it serves, example items.
- GSIs planned upfront (max 5/table); default eventually-consistent reads.
