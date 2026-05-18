# PR #57 Adversarial Review — feat/c-03-integration-harness-and-aggregator-projection

**Scope:** Plan 03 of `feature-phase-1b-pipeline-tooling` — integration harness, aggregator projection extension, learnings README.

---

## Critical
None.

## Important

### I1 — Docblock contradicts implementation in `scripts/lib/pipeline-telemetry.sh`
**File:** `scripts/lib/pipeline-telemetry.sh:4-22` vs `:81-95`

Top-of-file docblock asserts:
> `pipeline_init` captures the outer env once into `RUN_SESSION_ID` and emits a `pipeline_init` NDJSON record so the orchestrator's session (if any) is pinned at the start. **`RUN_SESSION_ID` is NOT synthesized and NOT exported.**

But the function body does both:
```bash
export CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-claude-${RUN_ID}-${_sid_now}-${RANDOM}}"
RUN_SESSION_ID="${CLAUDE_CODE_SESSION_ID}"
```

This is the same class of doc-vs-behavior drift Codex flagged on PR #50 (I-A in `_dispatch-c-01.log`). A future reader of the docblock will conclude `stage_end` records carry an empty `sessionId` when env is unset — they will not. Either rewrite the docblock to match the synthesize-and-export behavior, or revert the synthesis. Pick one truth.

### I2 — Plan/test drift on Section 1b sentinel
**File:** `scripts/test-phase-1b-integration.sh` Section 1b vs plan text

Plan 03 §Section 1 specifies: *"assert `sessionId:""` in all 3 records when env unset"*. Shipped test asserts the synthesized `"sessionId":"claude-"` prefix. The shipped behavior is correct (matches the synthesize-and-export choice), but the plan was not amended and no in-test comment explains why the assertion deviates. Future contributors reconciling test ↔ plan will hit the same confusion as I1. Add an inline comment in Section 1b pointing at the synthesize decision (or update the plan).

## Minor

### M1 — Dead code: `_call_sid` in `run_claude`
**File:** `scripts/execute-pipeline.sh:1433-1434`

`_call_sid="claude-${RUN_ID:-norun}-${_call_now}-${RANDOM}"` followed by an export is unreachable behavior — `pipeline_init` has already exported `CLAUDE_CODE_SESSION_ID` into the parent scope before `run_claude` is ever called, so the `${CLAUDE_CODE_SESSION_ID:-...}` default never fires. Delete or document.

### M2 — `outer_session_id` field semantically misnamed
**File:** `scripts/lib/pipeline-telemetry.sh` `pipeline_init` emission

When `CLAUDE_CODE_SESSION_ID` is unset, the emitted `outer_session_id` is the synthesized id, not an actual outer orchestrator session. The field name lies for the unset case. Rename to `run_session_id` or document the inferred-id semantics.

### M3 — Aggregator comment overstates lifecycle coverage
**File:** `scripts/metrics-aggregate.mjs`

Comment mentions "init-only or init+finalize-only" runs surfacing in `by_session`, but the `complete` filter requires exactly one `pipeline_finalize` — init-only runs are dropped before they reach the projection. Tighten the comment to match.

### M4 — `__learnings_emit_event` reads caller-local variables
**File:** `scripts/lib/learnings-writer.sh`

The helper reads `key`, `mode`, `sid` from the caller's local scope rather than taking them as args. Works today, but any rename of those locals silently breaks telemetry. Pass explicitly.

---

## Dimension verdicts

| Dimension | Verdict | Notes |
|---|---|---|
| Auth / security | PASS | No auth surface touched |
| Data loss | PASS | Fail-loud writer + gitignored fallback dir; no silent drops |
| Concurrency / observability | PASS | NDJSON records well under PIPE_BUF; sessionId propagation via env+export is correct for sequential `claude -p` calls |
| Rollback safety | PASS | Legacy NDJSON without `sessionId` falls back to `_unsessioned`; aggregator handles both |
| Plan compliance | PASS_WITH_NOTES | All 5 tasks shipped; Section 1b assertion drift undocumented (I2) |
| Code quality | PASS_WITH_NOTES | Docblock contradiction (I1); minor dead code (M1) and field naming (M2) |
| Test quality | PASS | 8 new pipeline-telemetry tests + 5 aggregator tests + 4-section integration harness; cross-platform failure injection via dir-as-file trick is robust |

---

## Verdict

**APPROVE_WITH_NOTES**

The PR ships all five Plan 03 deliverables with adequate test coverage and addresses every Stress Test forward-list item (C1, I1–I5). The two Important findings are documentation/drift hygiene, not behavioral defects — the shipped behavior is the correct one in both cases. Land the PR; open a follow-up to reconcile the docblock with the synthesize-and-export decision before another contributor inherits the contradiction.
