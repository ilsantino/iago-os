---
phase: feature-phase-1b-pipeline-tooling
plan: 01
wave: 1
depends_on: []
context: .iago/plans/feature-phase-1b-pipeline-tooling/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1b-pipeline-tooling/01-telemetry-session-id-and-learnings-write-path

## Goal

Land two orthogonal hardening fixes that share zero source-file surface so they can ride one plan without conflict. (A) Thread `CLAUDE_CODE_SESSION_ID` through every pipeline telemetry emission so each NDJSON record carries a `sessionId` field linking events to the originating `claude -p` session — enables the v2 dashboard "join key" per `docs/specs/iago-os-v2-vision.md` § Roadmap. (B) Replace the silent-failure `.iago/learnings/` write path with a fail-loud writer helper (`scripts/lib/learnings-writer.sh`) that logs to stderr + emits a `learnings-write-failed` telemetry event + offers an opt-in fallback write to `.iago/logs/learnings-fallback-{ts}.md` via `LEARNINGS_WRITE_MODE=fallback`. Both fixes ship with shell-test coverage matching the existing `scripts/test-pipeline-helpers.sh` + `scripts/lib/pipeline-telemetry.test.sh` pattern. Source of truth: `.iago/plans/feature-phase-1b-pipeline-tooling/CONTEXT.md` "Decided constraints" §§ "Threading vector", "Per-stage capture", "Learnings fail-loud as default".

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `scripts/lib/pipeline-telemetry.sh` | Add `sessionId` field to all 4 NDJSON emission `printf` lines (stage_start, stage_end, pipeline_finalize) + add `pipeline_init` capture of `CLAUDE_CODE_SESSION_ID` env |
| edit | `scripts/lib/pipeline-telemetry.test.sh` | Add 6 round-trip tests for sessionId field (env set/unset, per-stage capture, empty-string handling) |
| edit | `scripts/execute-pipeline.sh` | Modify `run_claude` (line ~150) to export per-call session-id; document the contract in helper-comment |
| edit | `scripts/test-pipeline-helpers.sh` | Add session-id integration test covering `run_claude` → emission flow |
| create | `scripts/lib/learnings-writer.sh` | Sourceable helper: `learnings_write {pattern-key} {markdown-body}` with fail-loud + opt-in fallback |
| create | `scripts/lib/learnings-writer.test.sh` | 8 tests: happy path, missing dir, perm-denied, disk-full sim, locked file, fallback mode, telemetry-event emission, env-override modes |
| create | `.iago/learnings/.writer-contract.md` | One-page contract: schema, fail modes, env-var matrix, telemetry event shape |
| edit | `scripts/metrics-aggregate.mjs` | Tolerate records WITH and WITHOUT `sessionId` (forward-compat — full projection lands in Plan 03) |

## Tasks

### Task 1: Thread `sessionId` through telemetry NDJSON emission

- **files:** `scripts/lib/pipeline-telemetry.sh`
- **action:** Edit `pipeline_init()` to capture `RUN_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"` immediately after the existing `RUN_ID` assignment (line ~67). Edit all 4 NDJSON `printf` lines: (a) `stage_start` line 87 — extend printf format from `{"type":"stage_start","stage":"%s","ts":"%s"}\n` to `{"type":"stage_start","stage":"%s","ts":"%s","sessionId":"%s"}\n` with `"${CLAUDE_CODE_SESSION_ID:-}"` as the last arg; (b) `stage_end` line 114 — extend with `,"sessionId":"%s"` (insert BEFORE the `STAGE_EXTRAS` interpolation point so legacy aggregators that split on `,"ts"` keep working); (c) `pipeline_finalize` line 131 — extend with `,"sessionId":"%s"`. Use `"${CLAUDE_CODE_SESSION_ID:-}"` at every emission point — NOT the captured `RUN_SESSION_ID` — because `run_claude` invocations export per-call session-ids into the subshell, and `stage_end` runs in the parent shell after the subshell returns; reading env at emission time picks up whichever value is current. JSON-escape via `${VAL//\"/\\\"}` if the env value could contain a literal `"` — Claude Code session-ids are UUID-shaped so this is defensive only; add the escape regardless. Update header comment block (lines 1–4) with one line: "Each NDJSON record carries sessionId = CLAUDE_CODE_SESSION_ID at emission time; empty string when env unset."
- **verify:** `bash -n scripts/lib/pipeline-telemetry.sh && grep -c '"sessionId"' scripts/lib/pipeline-telemetry.sh && grep -c 'CLAUDE_CODE_SESSION_ID' scripts/lib/pipeline-telemetry.sh`
- **expected:** `bash -n` exits 0. `"sessionId"` literal appears ≥4 times (3 emission sites + 1 header comment + optional `RUN_SESSION_ID` capture). `CLAUDE_CODE_SESSION_ID` appears ≥4 times (1 capture + 3 emission reads).

### Task 2: Pure-bash tests for sessionId emission

- **files:** `scripts/lib/pipeline-telemetry.test.sh`
- **action:** Extend the existing test harness (read current file first to match the source-then-assert pattern). Add 6 tests appended to the existing test list: (1) `test_session_id_emitted_when_env_set` — `export CLAUDE_CODE_SESSION_ID=test-sess-abc123`, source helper, call `pipeline_init && stage_start foo && stage_end foo 0`, grep RUN_FILE for `"sessionId":"test-sess-abc123"` — assert ≥2 hits (stage_start + stage_end); (2) `test_session_id_empty_when_env_unset` — `unset CLAUDE_CODE_SESSION_ID`, same flow, assert `"sessionId":""` appears in RUN_FILE; (3) `test_session_id_per_stage_capture` — set env to `A`, run stage_start, change env to `B`, run stage_end, assert stage_start record has `A` and stage_end record has `B` (verifies emission-time read, not init-time capture); (4) `test_session_id_in_pipeline_finalize` — call `pipeline_finalize 0`, assert finalize record carries `sessionId`; (5) `test_session_id_json_escape` — set env to `weird"id`, assert RUN_FILE contains `"sessionId":"weird\"id"` (escape preserved); (6) `test_session_id_with_stage_extras` — set env, call `stage_extra build_gate_mode '"parallel"'`, end stage, assert record has BOTH the extra AND sessionId. Use the existing test framework conventions (`run_test`, `assert_grep`, `cleanup_run_file`). Each test cleans up its env mutations in a trap.
- **verify:** `bash scripts/lib/pipeline-telemetry.test.sh 2>&1 | tail -15`
- **expected:** All existing tests pass + 6 new tests pass. Test summary line shows total count incremented by 6.

### Task 3: Per-call session-id capture in `run_claude`

- **files:** `scripts/execute-pipeline.sh`
- **action:** Edit `run_claude` (line ~150–181). After `__pipeline_latch_timed_out` (line 155) and BEFORE the `claude "$@" > "$out" 2>&1 &` spawn (line 157), insert a 4-line block that exports a per-call session-id: `local _call_sid="claude-${RUN_ID:-unknown}-$(__pipeline_now_ms)-$RANDOM"; export CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-$_call_sid}"`. Rationale: if the parent (orchestrator session that invoked `execute-pipeline.sh`) already has `CLAUDE_CODE_SESSION_ID` set, preserve it (it's the orchestrator's session, which is the right join key for that depth); if unset, fabricate a stable per-call id so spawned `claude -p` sessions correlate to ONE telemetry event series (every stage_start/stage_end while the `run_claude` is in flight sees the same env value). The fabricated id format encodes RUN_ID + timestamp + random for uniqueness; downstream aggregator (Plan 03) treats `claude-*` prefix as "synthesized" vs UUID as "real Claude Code injected". Add a 3-line helper comment above the export documenting the precedence rule. Do NOT export back to the parent shell — `run_claude` runs within `$(...)` subshells per existing pattern (line ~211, 310, 526, etc.), so the export naturally scopes to that subshell + its children.
- **verify:** `bash -n scripts/execute-pipeline.sh && grep -A2 'run_claude()' scripts/execute-pipeline.sh | head -20 ; grep -c 'CLAUDE_CODE_SESSION_ID' scripts/execute-pipeline.sh`
- **expected:** `bash -n` exits 0. `run_claude` function declaration visible. `CLAUDE_CODE_SESSION_ID` literal appears ≥2 times in `execute-pipeline.sh` (preserve + export lines).

### Task 4: Integration test for `run_claude` → emission flow

- **files:** `scripts/test-pipeline-helpers.sh`
- **action:** Read current file to match conventions. Add 2 tests: (1) `test_run_claude_synthesizes_session_id_when_env_unset` — stub `claude` to a 1-line shell script that echoes `OK` and exits 0; `unset CLAUDE_CODE_SESSION_ID`; source telemetry helper + execute-pipeline helper functions in a controlled subshell; call `pipeline_init && stage_start test && (output=$(run_claude 5 -p stub)) && stage_end test 0`; assert RUN_FILE record for stage_end has `"sessionId":"claude-..."` prefix (synthesized); (2) `test_run_claude_preserves_outer_session_id` — set `CLAUDE_CODE_SESSION_ID=outer-abc`; same stub + flow; assert RUN_FILE record carries `"sessionId":"outer-abc"`. Stub uses `mktemp -d` for PATH override + cleanup in trap. If `claude` binary cannot be stubbed in the test env (Windows quirks), document a `SKIP_RUN_CLAUDE_TESTS=1` env override at top of file and emit a clear "SKIPPED — set SKIP_RUN_CLAUDE_TESTS=0 to enable" line.
- **verify:** `bash scripts/test-pipeline-helpers.sh 2>&1 | tail -20`
- **expected:** All existing tests pass + 2 new tests pass (or print SKIPPED with rationale on Windows where stubbing is awkward).

### Task 5: Author `scripts/lib/learnings-writer.sh`

- **files:** `scripts/lib/learnings-writer.sh`, `.iago/learnings/.writer-contract.md`
- **action:** Create the sourceable helper. Shebang `#!/usr/bin/env bash` (sourceable, but include for shellcheck linting). Function `learnings_write` signature: `learnings_write <pattern-key> <markdown-body>`. Required env: `PROJECT_DIR` (writer derives `LEARNINGS_DIR="$PROJECT_DIR/.iago/learnings"`). Optional env: `LEARNINGS_WRITE_MODE` (`fail-loud` default, `fallback` alternative); `LEARNINGS_FALLBACK_DIR` (default `$PROJECT_DIR/.iago/logs`). Body: (a) validate both args present, else return 64 with stderr `learnings_write: usage: learnings_write <key> <body>`; (b) compute target file `$LEARNINGS_DIR/patterns.md` (per OQ2 — existing file name); (c) attempt `mkdir -p "$LEARNINGS_DIR" 2>/dev/null` — on failure (dir-cannot-be-created → likely chmod 0500 parent), proceed to fail-mode branch; (d) attempt `printf '\n## %s — %s\n\n%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$target"` with stderr redirected to capture; (e) if write succeeds: emit telemetry event via helper if loaded (`type stage_extra >/dev/null 2>&1 && command -v __pipeline_now_iso >/dev/null && printf '{"type":"learnings_written","key":"%s","path":"%s","ts":"%s","sessionId":"%s"}\n' "$1" "$target" "$(__pipeline_now_iso)" "${CLAUDE_CODE_SESSION_ID:-}" >> "$RUN_FILE"`); return 0; (f) on write failure: if `LEARNINGS_WRITE_MODE` is `fail-loud` (default), log to stderr `learnings_write: FAIL — could not write to $target: $captured_err` + emit telemetry event `learnings_write_failed` with mode/key/path/err fields + return 1; (g) if `LEARNINGS_WRITE_MODE=fallback`, log stderr WARNING + write to `$LEARNINGS_FALLBACK_DIR/learnings-fallback-$(date -u +%Y%m%d-%H%M%S)-$$.md` with same body + emit telemetry event `learnings_written_to_fallback` + return 0. Use `set -u` discipline inside the function (no unset-var traps). 80–110 lines of source. Companion `.iago/learnings/.writer-contract.md` (dotfile so it doesn't pollute the existing learnings catalog): 40-line page documenting the function signature, return codes (0 success, 1 fail-loud fail, 2 fallback-used, 64 usage), env-var matrix, telemetry event shapes, the rationale ("silent learnings-write failure was the bug — Garry standard requires loud failure").
- **verify:** `bash -n scripts/lib/learnings-writer.sh && shellcheck scripts/lib/learnings-writer.sh && grep -c '^learnings_write\|^function learnings_write' scripts/lib/learnings-writer.sh && wc -l .iago/learnings/.writer-contract.md`
- **expected:** `bash -n` exits 0. `shellcheck` exits 0 (no findings; document disables inline if any). Exactly 1 function definition line. `.writer-contract.md` 35–60 lines.

### Task 6: Tests for `learnings-writer.sh`

- **files:** `scripts/lib/learnings-writer.test.sh`
- **action:** Pure-bash test harness matching `pipeline-telemetry.test.sh` style. Each test uses `mktemp -d` for isolated `PROJECT_DIR` + cleanup in trap. Tests: (1) `test_happy_path_writes_to_patterns_md` — call `learnings_write "test-key" "test body"`; assert `$PROJECT_DIR/.iago/learnings/patterns.md` exists, contains `## ` + `test-key` + `test body`; assert return 0; (2) `test_missing_args_returns_64` — call `learnings_write`, assert exit 64 + stderr contains "usage"; (3) `test_perm_denied_fail_loud_default` — create LEARNINGS_DIR readable but not writable (`chmod 0500`); call writer; assert return 1, stderr contains "FAIL", telemetry RUN_FILE contains `learnings_write_failed` event; (4) `test_perm_denied_fallback_mode` — same setup as (3) but `LEARNINGS_WRITE_MODE=fallback`; assert return 0, `LEARNINGS_FALLBACK_DIR` file exists with body, stderr contains "WARNING", telemetry contains `learnings_written_to_fallback`; (5) `test_parent_dir_missing_creates_it` — delete `.iago/`; call writer; assert `mkdir -p` recovered, file present; (6) `test_locked_file_simulation` — use `exec 9>"$target"; flock 9; LOCK_PID=$!; (the writer's `>>` should still succeed on locked files in bash since `flock` is advisory — this test asserts that, and that fail-loud mode WOULD fire if the write actually failed); document the limit; (7) `test_telemetry_includes_session_id` — set `CLAUDE_CODE_SESSION_ID=writer-sess`; happy path; assert RUN_FILE event carries `"sessionId":"writer-sess"`; (8) `test_disk_full_sim` — write to a path under a `mount` point that returns ENOSPC if available, else SKIP with clear note. 110–140 lines.
- **verify:** `bash scripts/lib/learnings-writer.test.sh 2>&1 | tail -20`
- **expected:** All 8 tests pass OR test 8 prints SKIPPED with rationale (disk-full sim impractical on shared Windows runner). Test summary shows 7-or-8 passed / 0 failed.

### Task 7: Forward-compat aggregator update

- **files:** `scripts/metrics-aggregate.mjs`
- **action:** Read the current file. Find the NDJSON parser (look for `JSON.parse` calls). Where each parsed record is fielded into the aggregate output, add a single line: `const sessionId = record.sessionId ?? null;` and include `sessionId` in the output object structure (matching the existing field-ordering convention). Do NOT add joining/grouping logic — Plan 03 owns the full projection. The change here is the minimum required for backward-compat: aggregator can ingest both old and new NDJSON without throwing. If the file uses TypeScript-style JSDoc types, extend any record-type docblock with `@property {string|null} sessionId`. Strict-mode JS, no `any`, no implicit globals.
- **verify:** `node --check scripts/metrics-aggregate.mjs && grep -c 'sessionId' scripts/metrics-aggregate.mjs`
- **expected:** `node --check` exits 0. `sessionId` appears ≥2 times (the destructure + the output use).

## Verification

```bash
cd C:/Users/sanal/dev/iago-os \
  && bash -n scripts/lib/pipeline-telemetry.sh \
  && bash -n scripts/lib/learnings-writer.sh \
  && bash -n scripts/execute-pipeline.sh \
  && node --check scripts/metrics-aggregate.mjs \
  && bash scripts/lib/pipeline-telemetry.test.sh 2>&1 | tail -5 \
  && bash scripts/lib/learnings-writer.test.sh 2>&1 | tail -5 \
  && bash scripts/test-pipeline-helpers.sh 2>&1 | tail -5 \
  && grep -c '"sessionId"' scripts/lib/pipeline-telemetry.sh \
  && wc -l .iago/learnings/.writer-contract.md
```

Expected:
- All `bash -n` calls exit 0
- `node --check` exits 0
- All 3 test scripts report 0 failures (some Windows-quirk tests may print SKIPPED)
- `sessionId` literal appears ≥4 times in `pipeline-telemetry.sh`
- `.writer-contract.md` 35–60 lines

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — `STAGE_EXTRAS` ordering hazard in `stage_end` printf.** Current `stage_end` printf format string interpolates `STAGE_EXTRAS` AFTER `timed_out`. Task 1 says insert `sessionId` BEFORE `STAGE_EXTRAS`. If the implementer instead appends after `STAGE_EXTRAS`, downstream `jq` parsers that key on field order survive but `jq -r '.sessionId'` works either way. Bigger risk: if `STAGE_EXTRAS` is non-empty and starts with `,"sessionId":...` from a `stage_extra sessionId` call elsewhere (unlikely but possible), we get duplicate keys. **Fix:** Task 1 must explicitly forbid using `stage_extra` to set `sessionId` — add a hard guard in `stage_extra` body: `if [[ "$1" == "sessionId" ]]; then echo "stage_extra: 'sessionId' is reserved — use CLAUDE_CODE_SESSION_ID env" >&2; return 1; fi`. Test in Task 2 should cover this.
- **C2 — `run_claude` per-call synthesis breaks orchestrator session continuity.** Task 3's design exports `CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-$_call_sid}"` — preserves outer if set. But Task 3's _call_sid synthesis runs `$(__pipeline_now_ms)` which sources the helper from the parent — if the helper is not yet sourced when `run_claude` is called (theoretically impossible given line 21 source order, but defensive matters), the call fails silently and we get `claude--$RANDOM` with two dashes. **Fix:** Task 3 must add a fallback `_call_sid="claude-${RUN_ID:-norun}-${EPOCHSECONDS:-$(date +%s)}-$RANDOM"` using `$EPOCHSECONDS` bash builtin (no subshell, no helper dep). Add unit test in Task 4 covering "helper unsourced → synthesis still produces well-formed id".

### Important (forward to impl, don't block)

- **I1 — Test 6 (locked-file) is a near-noop on Linux/Mac since `flock` is advisory.** Acknowledge in the test comment; reframe the test as "writer DOES succeed on advisory-locked file (no false fail-loud trigger)" — not as "writer survives a real lock". Real exclusive-lock simulation needs Windows mandatory locking which is non-portable.
- **I2 — `LEARNINGS_FALLBACK_DIR` default `.iago/logs`.** Confirm this dir is git-ignored (otherwise fallback writes pollute git). Add Task 5 verification: `grep -q '\.iago/logs' $PROJECT_DIR/.gitignore || echo "WARNING: .iago/logs not gitignored"`. If not gitignored, append to .gitignore as part of Task 5 (one-line edit, document in commit msg).
- **I3 — `metrics-aggregate.mjs` change is intentionally minimal in this plan.** Plan 03 owns the full projection (group-by sessionId, emit per-session rollups). Implementer must NOT over-engineer in Task 7 — `sessionId ?? null` capture is the entire change.
- **I4 — JSON escape in Task 1.** `${VAL//\"/\\\"}` handles literal `"` but NOT `\n` or `\t`. Claude Code session-ids are alphanumeric+dash (UUID-like) so newlines won't appear. Document this assumption inline.
- **I5 — Task 4 stub strategy.** Stubbing `claude` on Windows is fragile because `claude.exe` is on PATH and the test stub needs to win the lookup. Use `PATH="$test_stub_dir:$PATH"` prepend, AND name the stub `claude` (no `.exe`) — bash on Git Bash resolves shell scripts before .exe with this PATH order. Document this in the test setup comment.

### Minor

- M1 — `.iago/learnings/.writer-contract.md` filename uses a dot prefix to keep it out of the catalog. Confirm `read_note` / `search_notes` Obsidian MCP tools don't index dotfiles (they don't by default).
- M2 — Telemetry events from the writer (`learnings_written`, `learnings_write_failed`, `learnings_written_to_fallback`) are NEW event kinds. Plan 03 aggregator update SHOULD acknowledge these; surface in Plan 03 task list.

### Dimension-by-dimension verdicts

- **Precision:** All 7 tasks have file paths + verify commands + expected output. JSON-escape rule explicit.
- **Edge cases:** Empty env, env mid-flight change, per-call vs outer-call preservation, fail-loud vs fallback, missing parent dir all covered.
- **Contradictions:** Plan 01 telemetry contract matches CONTEXT.md "Decided constraints" "Threading vector" (emission-time read, not init-time capture). No contradiction.
- **Simpler alternatives:** Could pass session-id as an arg to every `stage_*` function — REJECTED, requires editing every call site in `execute-pipeline.sh` (~30 sites). Env-read at emission is the minimum-touch approach.
- **Missing acceptance criteria:** Task verifications cover the 5 sub-criteria of CONTEXT.md "Verify" §5(a) + §5(b). Plan 03 integration test will exercise end-to-end.

### Implementer forward-list

1. Add `stage_extra` reserved-key guard for `sessionId` (C1 fix); test it in Task 2.
2. Use `$EPOCHSECONDS` fallback in `run_claude` synthesis (C2 fix); test it in Task 4.
3. Reframe Task 6 test 6 as "advisory-lock no-fail" (I1 fix).
4. Verify `.iago/logs` is gitignored, append if not (I2 fix).
5. Document JSON-escape scope assumption inline (I4 fix).
6. Document Windows PATH-prepend stub strategy in Task 4 setup (I5 fix).
