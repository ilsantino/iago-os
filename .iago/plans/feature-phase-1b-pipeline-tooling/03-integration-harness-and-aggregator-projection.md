---
phase: feature-phase-1b-pipeline-tooling
plan: 03
wave: 2
depends_on: [01, 02]
context: .iago/plans/feature-phase-1b-pipeline-tooling/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1b-pipeline-tooling/03-integration-harness-and-aggregator-projection

## Goal

Close the Phase 1b loop with three deliverables that exercise the four fixes end-to-end + extend the downstream consumer to surface the new schema. (A) Author `scripts/test-phase-1b-integration.sh` — a 4-section integration test harness that exercises each of the four bug fixes against a controlled fixture pipeline run; produces a one-page acceptance matrix. (B) Extend `scripts/metrics-aggregate.mjs` (forward-compat capture from Plan 01 Task 7) to project the new `sessionId` field into per-session rollups + handle the new event kinds (`learnings_written`, `learnings_write_failed`, `learnings_written_to_fallback`, `clean_tree_check`) from Plans 01 + 02. (C) Author `.iago/learnings/README.md` documenting the write contract, fail modes, and the env-var matrix — so future contributors discover the fail-loud-by-default behavior. Source of truth: `.iago/plans/feature-phase-1b-pipeline-tooling/CONTEXT.md` § "Verify" + § "Outputs" (Plan 03 rows).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `scripts/test-phase-1b-integration.sh` | 4-section end-to-end harness; one section per bug fix; emits acceptance matrix |
| edit | `scripts/metrics-aggregate.mjs` | Per-session rollups (group-by sessionId) + new event-kind handlers |
| edit | `scripts/lib/metrics-aggregate.test.sh` | 5 tests covering session-id grouping + new event kinds |
| create | `.iago/learnings/README.md` | Discoverable write-contract docs; fail-mode matrix; env-var reference |
| edit | `.iago/learnings/patterns.md` | Append a single learning entry recording the Phase 1b fix-pack pattern (dogfood: use `learnings-writer.sh` from Plan 01 to write this entry) |

## Tasks

### Task 1: Author the 4-section integration harness

- **files:** `scripts/test-phase-1b-integration.sh`
- **action:** New executable bash script. Each of the 4 sections is a function that exits 0 on pass, non-zero on fail; the main runs all 4 and emits a final acceptance matrix. Header: purpose ("Phase 1b end-to-end integration test. Exercises the 4 bug fixes from feature-phase-1b-pipeline-tooling against controlled fixtures. Run after Plan 01 + Plan 02 commits land."), usage `test-phase-1b-integration.sh [--section 1|2|3|4|all]`. Use `mktemp -d` for an isolated fixture project-dir; copy a minimal `.gitignore` + init git repo + commit one file. Section signatures:
  - **Section 1 — sessionId plumbing.** `export CLAUDE_CODE_SESSION_ID=integ-test-sess-001`; source telemetry helper; call `pipeline_init && stage_start integ && stage_end integ 0 && pipeline_finalize 0`; grep RUN_FILE for `"sessionId":"integ-test-sess-001"` in ALL 3 records (start + end + finalize); assert count == 3. Negative case: `unset CLAUDE_CODE_SESSION_ID`; same flow; assert `"sessionId":""` in all 3 records. Mid-flight change: `export A; stage_start; export B; stage_end`; assert start has A and end has B.
  - **Section 2 — learnings fail-loud.** Source `scripts/lib/learnings-writer.sh`. Happy path: `learnings_write "integ-test-pattern" "test body"`; assert file written + return 0. Permission failure: `chmod 0500 $tmp/.iago/learnings`; `learnings_write "fail-test" "body"`; assert exit 1, stderr contains FAIL, telemetry has `learnings_write_failed`. Fallback mode: `LEARNINGS_WRITE_MODE=fallback learnings_write "fb-test" "body"`; assert exit 0, fallback file exists in `.iago/logs/`, telemetry has `learnings_written_to_fallback`.
  - **Section 3 — clean-tree guard.** Initialize fixture repo; commit a file. Run `scripts/check-clean-tree.sh --project-dir $tmp`; assert exit 0 (truly clean). Create `.claude/worktrees/fake-worktree-meta/`; rerun; assert exit 0 (filtered). `--strict` rerun; assert exit 1 (caught). Modify the committed file; rerun default; assert exit 1 (real dirt). Cleanup: `rm -rf $tmp`.
  - **Section 4 — adversarial fallback parser.** Source `scripts/lib/adversarial-verdict.sh`. Write a fixture file with prose body + last line `===VERDICT: CLEAN===`; `parse_adversarial_verdict` → CLEAN. Write one with `===VERDICT: ISSUES===`; → ISSUES. Write one with only prose ("checked X, no issues found"); → UNKNOWN. Write one with sentinel inside a code block (` ``` ===VERDICT: CLEAN=== ``` `); → UNKNOWN (verifies anchor-to-own-line guard from Plan 02 Stress Test C1 fix). Write one with sentinel followed by 5 chat lines (within tail -10 window per C1 fix); → expected verdict captured.
  - **Final acceptance matrix.** After all 4 sections, print a markdown table to stdout: `| Bug | Section | Result |` with rows for each fix, marked PASS/FAIL. Exit 0 if all sections passed, non-zero otherwise. 220–280 lines.
- **verify:** `bash -n scripts/test-phase-1b-integration.sh && shellcheck scripts/test-phase-1b-integration.sh && bash scripts/test-phase-1b-integration.sh 2>&1 | tail -25`
- **expected:** `bash -n` exits 0. `shellcheck` exits 0 (or has documented disables). Live invocation prints the acceptance matrix; all 4 sections PASS; script exits 0.

### Task 2: Extend `metrics-aggregate.mjs` for per-session rollups

- **files:** `scripts/metrics-aggregate.mjs`
- **action:** Read current file to map the existing aggregation structure. Add a new aggregation dimension keyed on `sessionId` (alongside whatever per-plan / per-stage groupings already exist). Output shape: extend the JSON/markdown aggregate to include a `by_session` section: for each unique non-empty `sessionId`, list count of stage_start, count of stage_end, total duration_ms, count of timed_out=true, list of stages observed, plus counts of new event kinds (`learnings_written`, `learnings_write_failed`, `learnings_written_to_fallback`, `clean_tree_check`). Records with `sessionId: null` (legacy or env-unset) group under a `_unsessioned` bucket. Add JSDoc `@property {string|null} sessionId` to any record-type docblock + a `@property {string} type` enumeration that lists ALL event kinds (existing + the 4 new). Strict-mode JS — no `any`, no implicit globals, no default exports. If the file currently uses `import` syntax, keep it; if `require`, keep it. The change must not break existing CLI usage — `node scripts/metrics-aggregate.mjs <ndjson-glob>` continues to produce the prior output AS WELL AS the new `by_session` section.
- **verify:** `node --check scripts/metrics-aggregate.mjs && node scripts/metrics-aggregate.mjs '.iago/state/pipeline-runs/*.ndjson' 2>&1 | head -40`
- **expected:** `node --check` exits 0. Live run against existing NDJSON files (if any) prints both legacy aggregations AND the new `by_session` section. If no NDJSON files present (fresh checkout), prints "no input files" with exit 0 — not a crash.

### Task 3: Tests for aggregator projection

- **files:** `scripts/lib/metrics-aggregate.test.sh`
- **action:** Read existing test file (`scripts/lib/metrics-aggregate.test.sh` per Outputs row). Add 5 tests. (1) `test_by_session_groups_by_session_id` — write fixture NDJSON with 3 records sharing `"sessionId":"s1"` + 2 with `"sessionId":"s2"`; run aggregator; assert `by_session` contains keys `s1` (count 3) + `s2` (count 2). (2) `test_legacy_records_bucket_to_unsessioned` — fixture with records that have NO `sessionId` key (legacy format); aggregator should NOT crash; records group under `_unsessioned`. (3) `test_mixed_legacy_and_new` — fixture mixing both; both buckets populated. (4) `test_new_event_kinds_counted` — fixture with `learnings_written`, `learnings_write_failed`, `clean_tree_check` records; assert each kind appears in the per-session counts. (5) `test_timed_out_per_session` — fixture with some `timed_out:true`; aggregator shows correct count under each sessionId.
- **verify:** `bash scripts/lib/metrics-aggregate.test.sh 2>&1 | tail -10`
- **expected:** Existing tests + 5 new tests pass.

### Task 4: Author `.iago/learnings/README.md`

- **files:** `.iago/learnings/README.md`
- **action:** Discoverable docs for the learnings directory. Sections: (1) Purpose — "Curated patterns + project conventions surfaced from pipeline reviews. Promoted to CLAUDE.md once a pattern hits 5+ occurrences (per CLAUDE.md § Learnings)."; (2) Files — table of `patterns.md`, `project-conventions.md`, `.writer-contract.md` (dotfile, hidden by default) with one-line purpose each; (3) Writing entries — manual: append a `## YYYY-MM-DD HH:MM — {key}` section to `patterns.md`. Scripted: source `scripts/lib/learnings-writer.sh`, call `learnings_write {key} {body}`; (4) Fail modes — table mapping env var to behavior (`LEARNINGS_WRITE_MODE` unset|`fail-loud`|`fallback`; `LEARNINGS_FALLBACK_DIR` default + override; `PROJECT_DIR` required); (5) Telemetry events — list the 3 event kinds the writer emits (`learnings_written`, `learnings_write_failed`, `learnings_written_to_fallback`) with example JSON; (6) Promotion to CLAUDE.md — restate the 5+ occurrence rule + a one-paragraph procedure (manual review + Santiago approval). 80–130 lines.
- **verify:** `wc -l .iago/learnings/README.md && grep -c '^## ' .iago/learnings/README.md && grep -c 'learnings_write\|LEARNINGS_WRITE_MODE' .iago/learnings/README.md`
- **expected:** 80–130 lines. ≥5 top-level sections. ≥3 references to the writer fn/env.

### Task 5: Dogfood — write a Phase 1b learning entry

- **files:** `.iago/learnings/patterns.md`
- **action:** Append a single new entry to `patterns.md` USING `scripts/lib/learnings-writer.sh` (not via direct `Edit`). The body documents the Phase 1b pattern: "Pipeline tooling fixes that span multiple orthogonal failure modes (telemetry, write paths, pre-flight guards, parsers) can be batched in a single feature PR when (a) file surfaces are disjoint OR can be partitioned by line range, (b) each fix ships with shell-test coverage, (c) an integration harness exercises all fixes end-to-end. Anti-pattern: bundling fixes across overlapping line ranges in one plan — split into separate plans even within the same feature." Key: `phase-1b-orthogonal-fix-batching`. The implementation should be: `export PROJECT_DIR=$(pwd) && export CLAUDE_CODE_SESSION_ID=$(uuidgen 2>/dev/null || echo dogfood-$$); source scripts/lib/learnings-writer.sh && learnings_write "phase-1b-orthogonal-fix-batching" "<body text>"`. This is BOTH a documentation outcome AND a live smoke test of Plan 01 Task 5's writer in the real repo.
- **verify:** `tail -20 .iago/learnings/patterns.md && grep -c 'phase-1b-orthogonal-fix-batching' .iago/learnings/patterns.md`
- **expected:** Last 20 lines of patterns.md show the new entry with timestamp + key + body. Key appears exactly once (no double-write).

## Verification

```bash
cd C:/Users/sanal/dev/iago-os \
  && bash -n scripts/test-phase-1b-integration.sh \
  && node --check scripts/metrics-aggregate.mjs \
  && bash scripts/test-phase-1b-integration.sh 2>&1 | tail -10 \
  && bash scripts/lib/metrics-aggregate.test.sh 2>&1 | tail -5 \
  && wc -l .iago/learnings/README.md \
  && grep -c 'phase-1b-orthogonal-fix-batching' .iago/learnings/patterns.md
```

Expected:
- All `bash -n` + `node --check` exit 0
- Integration harness prints 4-row acceptance matrix; all PASS
- Aggregator tests all green
- README.md 80–130 lines
- Phase 1b learning entry present in patterns.md (count == 1)

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — Integration harness Section 1 mid-flight env change relies on `stage_end` reading env at emission.** This is the contract Plan 01 Task 1 establishes. If Plan 01 implementation drifts and reads env at `pipeline_init` time (captures into `RUN_SESSION_ID`), Section 1's third sub-test FAILS. **Fix:** Section 1 must reference the Plan 01 Task 1 contract explicitly in its comment block: "Asserts emission-time env read per Plan 01 contract. If this section fails AND Plan 01 sub-tests pass, the contract was violated — investigate."
- **C2 — Task 5 dogfood depends on Plan 01 Task 5 (`learnings-writer.sh`) being present AND sourceable AND `PROJECT_DIR` resolution working with the iago-os repo as the project-dir.** If Plan 01 ships first (wave 1) but the writer has a subtle path bug that only fires when `PROJECT_DIR` is a checked-out git repo (vs `mktemp -d`), Task 5 catches it AT MERGE TIME (late). **Fix:** Task 5 must include a fallback assertion: if the writer call fails, the task FAILS LOUDLY with a clear "Plan 01 writer broken: $stderr" message AND emits a recovery hint ("manually append entry to patterns.md as a temporary workaround; reopen Plan 01"). Does NOT silently fall back to manual append.

### Important (forward to impl, don't block)

- **I1 — Integration harness `mktemp -d` cleanup on failure.** Each section's mktemp dir must be cleaned in a trap even on early-exit. Use a top-level `trap 'rm -rf "$_all_tmp_dirs"' EXIT` + maintain `_all_tmp_dirs` array. Don't let test-failure leak temp dirs.
- **I2 — Aggregator `by_session` output ordering.** Tests in Task 3 must NOT depend on iteration order of session keys (Object.keys ordering is insertion-ordered in modern JS but tests should sort before asserting). Document in Task 3.
- **I3 — `.iago/learnings/README.md` doesn't conflict with the existing `.writer-contract.md`.** README is the user-facing overview; `.writer-contract.md` is the technical contract for implementers. Task 4 must add a one-line cross-reference: "Implementation details: see `.writer-contract.md` (dotfile)."
- **I4 — Section 4 sub-test for sentinel-in-code-block.** Plan 02 C1 fix added line-anchored regex `^===VERDICT: (CLEAN|ISSUES)===\s*$`. Section 4's "sentinel inside ` ``` ` code block" test asserts the regex correctly does NOT match the wrapped sentinel. If Plan 02 implementer skipped the anchor, Section 4 catches it.
- **I5 — Aggregator backward-compat from Plan 01 Task 7.** Plan 01 Task 7 added `sessionId ?? null` capture as forward-compat. Plan 03 Task 2 builds on this — must NOT re-implement, only extend. Task 2 explicit note: "If Plan 01 Task 7 produced a `sessionId` property in the parsed record object, Plan 03 Task 2 USES it directly. Do not re-parse the NDJSON; reuse the existing parse output."

### Minor

- M1 — Acceptance matrix output format is markdown table. Could be JSON for machine ingestion; markdown chosen for human-readability in CI logs. Defer.
- M2 — Task 5 dogfood uses `uuidgen 2>/dev/null || echo dogfood-$$` for the session-id. On Git Bash where uuidgen may be absent, falls back to PID-suffixed string. Acceptable.

### Dimension-by-dimension verdicts

- **Precision:** All 5 tasks have file paths + verify commands + expected output. Acceptance matrix shape specified.
- **Edge cases:** Empty NDJSON dir, mixed legacy+new records, sentinel-in-code-block, mid-flight env change, perm-denied + fallback + happy path all covered.
- **Contradictions:** Plan 03 reads Plan 01 + 02 contracts; no contradiction with Decided Constraints. Backward-compat preserved per "Aggregator legacy-record handling" OQ5 default.
- **Simpler alternatives:** Could merge Plan 03 into Plan 01 + 02 — REJECTED, end-to-end harness belongs in its own wave so it RUNS AFTER both wave-1 plans land. Splitting forces correct dependency order.
- **Missing acceptance criteria:** Plan 03's acceptance matrix IS the Phase 1b acceptance gate. CONTEXT.md § "Verify" 5(a)-(d) all map to integration-harness sections 1–4.

### Implementer forward-list

1. Section 1 comment block referencing Plan 01 contract explicitly (C1 fix).
2. Task 5 fail-loud-on-writer-failure assertion (C2 fix).
3. Top-level trap cleanup of all mktemp dirs (I1 fix).
4. Sort session keys before assertion in aggregator tests (I2 fix).
5. Cross-reference `.writer-contract.md` from README.md (I3 fix).
6. Document Plan 02 anchor-regex dependency in Section 4 (I4 fix).
7. Reuse Plan 01 Task 7 parse output in Task 2 (I5 fix).
