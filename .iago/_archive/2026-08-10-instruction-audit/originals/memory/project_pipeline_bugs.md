---
name: iago-os pipeline bugs (resolved 2026-04-28)
description: Three pipeline bugs in scripts/execute-pipeline.sh — all fixed. cwd misfire + FAIL-regex per-line by PR #21, Codex stage 4 liveness gap by PR #27. Documents the historical issue + the fix shape so the diagnosis isn't lost.
type: project
originSessionId: c655d87e-44f5-4abd-9964-933b609bf7f9
---

All three pipeline bugs that bit `/iago-quick` and `/iago-execute` runs from
2026-04-25 to 2026-04-28 are fixed and merged.

## Bug 1 — FAIL-detection regex per-line — FIXED (PR #21, merged 2026-04-28)

**Was:** `scripts/execute-pipeline.sh:466` used `grep -qiE` (per-line). Markdown
verdicts like `## Verdict\n\n**FAIL**` had the header and verdict token on
different lines, regex never matched, local fix loop skipped, "Review passed"
logged spuriously, PR shipped with unfixed findings.

**Fix:** Switched to `tr '\n' ' ' | grep -qiE` so output is treated as a single
record. Tightened reviewer prompts to require single-line `Verdict: <word>`.
Summary-block extractor at line ~860 reworked the same way (uses `tail -1` so
the LAST verdict mention wins, ignoring quoted earlier ones). Regression tests
in `scripts/test-pipeline-helpers.sh` cover lowercase, prose-surrounded,
multi-mention, and PASS negative cases.

## Bug 2 — Codex stage 4 cwd misfire — FIXED (PR #21, merged 2026-04-28)

**Was:** `node "$CODEX_COMPANION" adversarial-review` ran without `--cwd`,
companion's internal `git diff` could drift to the iago-os parent repo
(instead of `--project-dir`), Codex returned "approve / no changed files"
spuriously, step 4 became a placebo on multi-repo runs.

**Fix:** Pass `--cwd "$PROJECT_DIR"` explicitly to the companion. Post-call
sanity check: if Codex says "no changed files" but `git diff $PRE_IMPL_SHA..HEAD`
in `$PROJECT_DIR` is non-empty, demote `CODEX_EXIT=99` so the existing
failure path runs the Claude adversarial fallback. Both layers are
defense-in-depth.

## Bug 3 — Codex stage 4 missing liveness gate — FIXED (PR #27, merged 2026-04-28)

**Was:** The companion call had no timeout, no tree-kill, no background-poll
discipline — unlike every Claude call which uses `run_claude` (line 121) with
explicit timeouts and `taskkill //T` on the process tree. If the Codex CLI
subprocess hung (network, OpenAI API, internal deadlock), bash
command-substitution blocked indefinitely. The 8h "stall" attributed to PR
#26 in handoff digest 07 was this bug — different bug class than PR #21's
cwd misfire (which the digest had imprecisely framed as a "recurrence").

**Fix:** Single-site `timeout` wrap at line 695:
`$_TIMEOUT_CMD --kill-after=10 600 node "$CODEX_COMPANION" ...`. Portable
detection at script header (`command -v timeout || command -v gtimeout`),
HARD `exit 1` if neither available (Mac without coreutils). `_TIMEOUT_CMD`
pinned to absolute path via `command -v` to defeat shell-function
shadowing inside `$(...)` subshells. New regression test
`liveness_gate_test()` in `scripts/test-pipeline-helpers.sh` PATH-stubs
`node` as `sleep 30`, verifies exit 124/137 in ≤9s with `node_invoked=yes`
marker (rules out exit 127 from misordered timeout args).

## What was rejected and why

- **Externalize `run_claude` to `scripts/lib/run-claude.sh`** — rejected by
  deep-stress council (5/5 convergence). Touches 8 call sites for one Codex
  call site. Stretches Phase 0 four-item cap. Cycle-2 if a second Codex call
  site appears.
- **Author a `run_codex_companion` helper** — rejected for same reason.
  `timeout` is one line; helper indirection unjustified for one call site.
- **macOS warn-and-skip on missing utility** — rejected. Silent fallback
  would re-expose the exact bug being fixed. Hard `exit 1` is the only
  safe option.

## Cycle-2 follow-ups (not in PR #21 or #27)

- **F3** — truncated Codex stdout containing `[P0/P1/P2]` markers on a
  timeout race could be treated as authoritative findings instead of
  triggering Claude fallback. Pre-existing pattern at lines 727-729.
  Re-evaluate if false-positive recurs.
- **Sec-2** — `$PROJECT_DIR` and `$HOME`-rooted `$CODEX_COMPANION` flow into
  the wrapped invocation without path-traversal sanitization. Pre-existing
  gap not introduced by liveness fix. Cycle-2.
- **C-7** — actual wall-clock cap is 610s (600 + 10s grace); not surfaced
  to operator at stage entry. Defer.

## Operational note for Sebas-on-Mac

PR #27 introduced a `gtimeout` dependency on macOS. Without coreutils,
pipeline hard-fails with: `ERROR: neither 'timeout' nor 'gtimeout' available.
Install GNU coreutils (macOS: brew install coreutils)...`. Phase 1 cleanup
candidate: add this to CLAUDE.md Tech Stack section as a documented Mac
prerequisite.

## How to apply (going forward):

1. Trust the local pipeline's review verdict — Bug 1's silent skip is closed.
2. Trust Codex stage 4's "no changed files" — if cwd misfires, the sanity
   check at line 707 demotes to fallback automatically.
3. Trust Codex stage 4's liveness — a hung node returns within ~610s and
   falls through to Claude adversarial.
4. If a regression in any of these surfaces, the regression tests at
   `scripts/test-pipeline-helpers.sh` should catch it locally before PR.

## References

- PR #21: https://github.com/ilsantino/iago-os/pull/21 (cwd + FAIL-regex)
- PR #27: https://github.com/ilsantino/iago-os/pull/27 (liveness gate)
- RCA: `.iago/research/codex-stall-diagnosis-2026-04-28.md`
- Plan: `.iago/plans/quick-260428-codex-stage4-liveness.md`
- Session digests: `2026-04-28-iago-os-pipeline-speed-{07,08}.md`
