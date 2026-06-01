---
date: 2026-05-17
status: deferred
plan: feature-phase-1-deferred-hardening/04
scope: runtime/tsconfig.json
---

# ADR: defer `exactOptionalPropertyTypes` in runtime/tsconfig.json

## Context

Plan B-04 Task 8 listed `exactOptionalPropertyTypes` as an **optional** sub-item: tighten the runtime tsconfig so `T | undefined` and an optional `T?` are not assignable to each other. The flag catches a real class of bug where `{ foo: undefined }` slips through where the caller intended `{}`, and the daemon's option-bag style (`shutdownStageTimeoutMs?: number` etc.) is a place that could regress silently.

The plan marked this optional precisely because turning it on for an existing 7K-line TypeScript runtime surfaces a noisy migration burden, and the implementation budget for B-04 was already tight (proven empirically — the implementation session hit the 80-turn max).

## Decision

**Defer** `exactOptionalPropertyTypes: true` to Phase 2 hardening. Track as a single dedicated plan in the Phase 2 roadmap rather than folding it into a coverage / refactor plan where the migration noise will pollute review of the primary change.

## Rationale

1. **Migration scope is unknown until flipped.** Enabling the flag on the current codebase will likely surface 20–60 errors across the daemon + telegram + agent-runtime modules; each needs case-by-case judgment (drop the optional, narrow the type, or accept `undefined` explicitly). Coupling that work to the B-04 PR would dilute review focus on the registry-hardening + adapter-isolation work that was the primary plan goal.
2. **No active regression class is masked today.** All currently-touched call sites in B-04 use option-bag spread with omission, not explicit `undefined`. The latent bug class exists but is not currently firing.
3. **Phase 2 has bandwidth.** The VPS bootstrap and cutover work in Phase 2 is more about deployment than type-system tightening, and a single focused PR for `exactOptionalPropertyTypes` will be cleaner there.

## Consequences

- A future contributor who reads `runtime/tsconfig.json` will not see the flag and may assume it was forgotten. The Plan 04 PR body links back to this ADR. The Phase 2 roadmap entry will reference it again.
- The latent `{ foo: undefined }` vs `{}` bug class can still bite during Phase 1; mitigated by explicit destructuring (`const { foo } = opts`) on the daemon's option-bag accessors, which is the existing pattern.

## Re-evaluation trigger

Re-open this ADR when **any** of the following fires:

- A regression slips through CI that the flag would have caught.
- The runtime tree exceeds 12K lines (current ~7K) — at that point the migration burden grows non-linearly and earlier is better.
- A Phase 2 plan explicitly takes ownership of runtime type-system tightening.
