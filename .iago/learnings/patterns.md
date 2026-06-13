## Review Patterns

| # | Pattern | Occurrences | Last Seen | Source |
|---|---------|-------------|-----------|--------|

## 2026-05-18T03:38:55Z — phase-1b-orthogonal-fix-batching

Pipeline tooling fixes that span multiple orthogonal failure modes (telemetry, write paths, pre-flight guards, parsers) can be batched in a single feature PR when (a) file surfaces are disjoint OR can be partitioned by line range, (b) each fix ships with shell-test coverage, (c) an integration harness exercises all fixes end-to-end. Anti-pattern: bundling fixes across overlapping line ranges in one plan — split into separate plans even within the same feature.
