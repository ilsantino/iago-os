## Review Patterns

| # | Pattern | Occurrences | Last Seen | Source |
|---|---------|-------------|-----------|--------|

## 2026-05-18T03:38:55Z — phase-1b-orthogonal-fix-batching

Pipeline tooling fixes that span multiple orthogonal failure modes (telemetry, write paths, pre-flight guards, parsers) can be batched in a single feature PR when (a) file surfaces are disjoint OR can be partitioned by line range, (b) each fix ships with shell-test coverage, (c) an integration harness exercises all fixes end-to-end. Anti-pattern: bundling fixes across overlapping line ranges in one plan — split into separate plans even within the same feature.

## 2026-08-13T00:00:00Z — stateful-replay-revives-sentinel-values

Converting a stateless filter/aggregate into a STATEFUL replay makes every
sentinel value that a downstream predicate used to discard become a live input to
the state machine.

Sentria `report-supervisores.ts`: chain counting moved from
`Map<incidentId, earliestStart>` (guarded by `if (inWindow && …)`) to an event
replay with an `open` latch. `statusChangeAtMs()` collapses an undated row to `0`;
under the old guard `0` was never `inWindow`, so it was inert. Under the replay it
sorts first, opens a phantom chain at epoch 0, and the genuine in-window
escalation then hits `if (!open)` and opens nothing — zeroing three numbers
printed verbatim in a client PDF. Three independent review legs reproduced it by
execution. The codebase's own docstring on the sibling `…OrNull` helper had named
this exact failure mode in advance.

Check on any stateless→stateful conversion: enumerate every sentinel/`?? 0`/
default the old code tolerated because a later predicate filtered it, and decide
about each one explicitly.

## 2026-08-13T00:00:01Z — a-fix-that-moves-a-shared-population-is-not-a-fix

A local fix that solves its stated finding by changing a SHARED population breaks
every consumer of that population, silently.

Sentria: "raw uuid printed as a supervisor name" was fixed by DROPPING unmatched
rows from `rows`. That moved `supervisorsPaged` (the denominator AND firing gate
of a CRÍTICO — it could MANUFACTURE the finding), made a `rows.length === 0`
branch reachable that prints a categorically false cause into a branded client
PDF, and desynced `pagedIncidentIds` from `rows`. Six independent Important
findings, one probe-verified. The correct fix was MASKING the rendered name —
same user-visible outcome, zero population change.

Rule for fix agents: before changing any value other code reads (a row set, a
count, a denominator, anything feeding a printed sentence), grep every consumer
and state what you checked. Prefer the fix with the smaller blast radius even
when it looks less principled.

## 2026-08-13T00:00:02Z — revert-over-iterate-when-a-fix-outgrows-its-finding

When one fix generates more findings than it closed, revert it; do not iterate.

Sentria PR #368: a height-budget/degradation system added to fix ONE finding (a
hard throw on page overflow) produced ten findings of its own, including a
client-facing UNDERSTATED count — a quantified false statement replacing the
silence it was meant to fix. Reverting restored a known, disclosed limitation.

A rare, visible, reportable error beats a silently wrong number in a document
carrying the client's brand. Reverting to a stated residual is a legitimate
terminal state for a finding, not a failure to fix it.

## 2026-08-16T00:00:00Z — mutation-verify every regression test before shipping it

A regression test that passes with its own guard disabled proves nothing. Run
the mutation before you commit it, not as a nicety.

Sentria PR #368, twice in one session:

1. A new section-number parity guard passed on an ordinary fixture. Mutating the
   split-branch index literal — the one a renumber pass most easily misses — kept
   it GREEN, because that page only renders when two tables are both full. A
   second fixture was required. Post-fix mutation: red on the split context,
   still green on the ordinary one, which is exactly the asymmetry that proved
   the second context was load-bearing rather than decorative.
2. A new twin-dedup integration test passed WITH `dedupeTwinRejections`
   neutered. The real guard was elsewhere: `classifyStatusChange` gives the twin
   its own kind and `isOfferOutcome` excludes it, so the dedup pass changes no
   output at all. The test was rewritten to pin the OUTCOME (a twin never
   inflates the ledger) with a discriminating assertion that goes red when a twin
   is admitted as an offer outcome.

The second case also refutes a claim in the PR body: the mechanism the body
credited was not the mechanism doing the work. A gate finding that says "X is
dead computation" is cheap to settle empirically — neuter X, run the suites —
and settling it beat arguing about it.

Rule for fix agents: for every regression test you add, state in the fix report
which mutation you ran and what went red. "The test passes" is not evidence; the
evidence is that it FAILS against the defect it names. If the mutation leaves it
green, the test is measuring the wrong thing — rewrite it, do not ship it.
