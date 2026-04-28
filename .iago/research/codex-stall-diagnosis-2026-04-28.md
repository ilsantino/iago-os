---
date: 2026-04-28
type: rca
phase: phase-0-standalone
trigger: 8h codex stage 4 stall during PR #26 local pipeline run
predecessor_pr: 21 (merged 2026-04-28T00:59Z, squash 254a02b)
gates: phase-1 cleanup blocked until standalone fix PR merges
---

# Codex Stage 4 Stall RCA — PR #26 Local Pipeline Run

## Summary

PR #21 fixed the **cwd-misfire** failure mode (Codex returning spurious "no changed files"). PR #21 did **not** address the **liveness** failure mode (Codex hanging indefinitely with no return). The 8h stall on the PR #26 local pipeline run is best explained by the latter — a hazard PR #21 was not designed to catch. The handoff digest's "PR #26 RECURRED the Codex cwd issue DESPITE PR #21" is imprecise: the cwd patch is in place and held (PR #26 closed with `Codex: exit 0` per `.iago/summaries/06-wedge-e-tsc-vite-parallel-build.md`); the actual recurrence is a different bug in the same stage.

## Hypotheses

### (a) Codex CLI / GPT-5.5 model regression — REJECTED as load-bearing cause

The companion script at `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` has mtime `Apr 27 11:49` (predates PR #21's merge by hours; no churn since). Cache holds versions `1.0.2` and `1.0.4`. Code reading shows the companion's `--wait` flag IS parsed by `handleReviewCommand` (line 685) but **never branched on** — `adversarial-review` always runs synchronously via `runForegroundCommand` regardless. This is design intent (foreground = blocking until done), not a regression. A regression in GPT-5.5 itself or the codex CLI's request-handling could trigger longer-than-expected turns, but that's an aggravating factor, not a root cause — a properly-bounded pipeline would fail-fast in minutes regardless of upstream slowness.

### (b) Anthropic API rate or latency — REJECTED

Codex stage 4 calls OpenAI's GPT-5.5 (model pinned per-operator in `~/.codex/config.toml`), NOT the Anthropic API. The Claude *fallback* path (`run_claude_adversarial`, line 631) hits Anthropic, but that path only runs if Codex exits non-zero or trips the cwd sanity check — it cannot itself be the cause of a Codex stall because it hasn't been invoked yet. Even if OpenAI's API were slow, the load-bearing question is not "did upstream stall" but "did our pipeline absorb the stall or block forever on it" — which is hypothesis (c).

### (c) iago-os script bug — CONFIRMED root cause

`scripts/execute-pipeline.sh:672` invokes the codex companion with **no timeout, no tree-kill, no background+poll pattern**:

```bash
CODEX_OUTPUT=$(cd "$PROJECT_DIR" && node "$CODEX_COMPANION" adversarial-review --cwd "$PROJECT_DIR" --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
```

Compare against every Claude invocation in the same script — lines 182, 281, 370, 426, 497, 552, 571, 592 — all use `run_claude <secs> -p ...`, which is the in-script helper at line 121. `run_claude` runs the child in the background, polls with `kill -0` every 5s up to `$timeout_secs`, and tree-kills via `taskkill //F //T //PID` (Windows) + `kill -9` if exceeded. The Codex call has none of this. If `node "$CODEX_COMPANION"` hangs (codex CLI deadlock, OpenAI request stuck mid-stream, child process FD-leak holding the pipe open after parent dies — same Windows hazard `run_claude` was designed for), bash blocks on the command-substitution forever. The PR #21 sanity check at line 684 is *post-call* — it can only fire after node returns. If node never returns, the check never fires, the cwd `--cwd` flag accomplishes nothing, and the pipeline silently waits.

This is the load-bearing root cause. It is not a Codex bug, not an OpenAI bug, not an Anthropic bug, and not a cwd recurrence. It is a missing liveness gate on a single call site.

## Why PR #21 missed it

PR #21's framing was "two bugs surfaced on PR #73 (munet-web H1)": the FAIL-regex per-line bug, and Codex returning "no changed files". Both are **correctness** failures (wrong output produced and trusted). PR #21's fix was scoped to the symptoms it could observe — pass `--cwd` flag, add a post-call sanity-check, add a regression test for the regex. The 8h-stall failure mode is a **liveness** failure (no output produced at all, indefinite block). PR #21 had no symptom from this class to triangulate against because, definitionally, a stall produces no output for a regression test to assert against. The fix needed is structural (apply `run_claude`'s timeout discipline to the Codex call site), not symptomatic (patch around what Codex returned).

A secondary contributor: `~/.claude/projects/.../memory/MEMORY.md` entry `project_pipeline_bugs (2026-04-27)` still asserts the bugs are open. PR #21 closed them but the memory wasn't updated, so the council and the handoff both treated "Codex cwd misfire" as the active failure mode for PR #26 — when in fact the cwd misfire was already fixed and the actual PR #26 failure was elsewhere.

## Concrete fix design — REVISED post stress-test

Original fix design proposed externalizing `run_claude` to a lib and authoring a new `run_codex_companion` helper. Stress test surfaced two BLOCK findings (return-code ambiguity, taskkill-grandchild reach) and three IMPORTANT findings (Phase 0 cap creep, undefined macOS-no-coreutils branch, unverified `--wait` precondition). Revised design below picks the simpler path the stress test advocated and resolves all five.

**Revised Phase 0 standalone PR — touches 2 locations, not 8 call sites:**

1. **Portable `_TIMEOUT_CMD` detection at script header.** Add near the top of `scripts/execute-pipeline.sh` (after the existing self-freeze block, before the function definitions):
   ```bash
   _TIMEOUT_CMD=""
   if command -v timeout >/dev/null 2>&1; then
     _TIMEOUT_CMD="timeout"
   elif command -v gtimeout >/dev/null 2>&1; then
     _TIMEOUT_CMD="gtimeout"
   else
     echo "ERROR: neither 'timeout' nor 'gtimeout' available. Install GNU coreutils (macOS: brew install coreutils)." >&2
     exit 1
   fi
   ```
   **HARD BLOCK** on missing utility, NOT warn-and-skip — a missing timeout utility silently re-exposes the exact bug we're fixing. Resolves IMPORTANT finding on shim ambiguity. Git Bash on Windows ships GNU coreutils, so `timeout` is present by default; macOS without `brew install coreutils` is the only fail case.

2. **Wrap line 672 with `$_TIMEOUT_CMD 600 --kill-after=10`** — single call-site change, no helper, no lib extraction:
   ```bash
   CODEX_OUTPUT=$(cd "$PROJECT_DIR" && $_TIMEOUT_CMD 600 --kill-after=10 node "$CODEX_COMPANION" adversarial-review --cwd "$PROJECT_DIR" --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
   ```
   `timeout` exits 124 on SIGTERM-after-elapsed and 137 on SIGKILL-after-`--kill-after`. The existing `elif [[ $CODEX_EXIT -ne 0 ]]` at line 698 fires on both, falls through to `run_claude_adversarial` fallback. **Resolves BLOCK 1** (return code unambiguous: `timeout`'s 124/137 captured by outer `|| CODEX_EXIT=$?`, no internal helper assignment). **Mitigates BLOCK 2** (taskkill-grandchild reach): `timeout` sends SIGTERM to the spawned process, then SIGKILL after 10s grace. On Windows Git Bash, `timeout`'s SIGKILL maps to `TerminateProcess` which is a hard kill on the node parent; if codex CLI grandchildren survive (Job Object breakaway), they're orphaned but no longer block the pipeline because `timeout` has returned and bash command-substitution has unblocked. The 10s grace also lets node's signal handler clean up its own children — the failure mode the original bug exhibited (parent dies, children hold pipe) is avoided because `timeout` doesn't kill the node parent until SIGKILL.

3. **Pre-PR verification — do these BEFORE writing the patch:**
   - **Verify `--wait` actually blocks.** `cd /tmp && time node "$CODEX_COMPANION" adversarial-review --wait --cwd "$PWD" 2>&1 | tail -5` against an empty repo. Document elapsed time. If it returns immediately (≤2s) the 600s budget is wrong and the timeout-trigger logic must be inverted. **Resolves IMPORTANT finding** on `--wait` load-bearing claim.
   - **Confirm `timeout` exit codes on Git Bash 5.2.** `bash -c 'timeout 1 sleep 5; echo $?'` should print 124. `bash -c 'timeout --kill-after=1 1 sleep 5; echo $?'` should print 137 if SIGTERM was ignored (sleep ignores SIGTERM after waking). Document both.
   - **Confirm Phase 0 cap honored.** Roadmap items: (a) RCA — done, (b) Codex cwd patch + regression test — cwd patch already in code from PR #21, ADD regression test, (c) macOS timeout shim — done via item 1 above, (d) FAIL-regex per-line parser fix — already in code from PR #21, ADD residual confirmation. Four items, no scope creep. **Resolves IMPORTANT finding** on Phase 0 cap.

4. **Regression test in `scripts/test-pipeline-helpers.sh`.** Stub `node` (PATH-prepend a fake one that runs `sleep 30`), invoke the timeout-wrapped command with budget=5, assert: exit code ∈ {124, 137}, elapsed ≤ 16s (5s timeout + 10s kill-after grace + 1s slack). Catches the regression where someone removes `$_TIMEOUT_CMD` from the call site.

5. **FAIL-regex residual confirmation.** Read `scripts/test-pipeline-helpers.sh` (added by PR #21) and verify cases cover: (a) lowercase `verdict: fail`, (b) verdict surrounded by prose ("the verdict is FAIL because..."), (c) multiple verdict mentions where `tail -1` picks the last one, (d) `PASS` negative case to confirm no spurious trigger, (e) `PASS_WITH_CONCERNS` triggers the loop. If any missing, add. No script changes if all present — just a documented read-through.

6. **Update MEMORY entry `project_pipeline_bugs`** at `~/.claude/projects/C--Users-sanal-dev-iago-os/memory/project_pipeline_bugs.md`. Mark cwd-misfire and FAIL-regex as fixed (PR #21, 2026-04-28). Record: "Codex stage 4 missing liveness gate — fixed in Phase 0 standalone PR (this PR)". Per the frozen-snapshot rule, mutation persists for next session; do not Read after Write to verify within this session except as the documented exception.

**Explicitly rejected alternatives:**
- Externalizing `run_claude` to `scripts/lib/run-claude.sh` — rejected. Single-site `timeout` wrap (item 2) achieves the liveness gate without touching 8 Claude call sites or stretching the Phase 0 cap. Lib extraction can ship in cycle 2 if a second Codex call site appears.
- Backgrounding `node` with bash poll-and-`taskkill //T` (mirroring `run_claude`) — rejected. `taskkill //T` reach to codex CLI grandchildren is unverified on Windows; `timeout`'s two-stage SIGTERM→SIGKILL handles signal-aware children better and is one line.
- Setting `CODEX_EXIT` inside a helper — rejected. Outer `|| CODEX_EXIT=$?` is the established pattern at every other call site.

**Out of scope:** wedges J/K, Phase 1 cleanup, anything not on the four-item Phase 0 list.

## Verification path before PR opens

Concrete acceptance bar (do before patching):

1. `bash -c 'timeout 1 sleep 5; echo $?'` → expect 124 on Git Bash 5.2.
2. `bash -c 'timeout --kill-after=1 1 trap "" TERM; sleep 5; echo $?'` → expect 137 (SIGKILL after grace).
3. `time node "$CODEX_COMPANION" adversarial-review --wait --cwd /tmp --base HEAD 2>&1 | tail -5` against an empty repo. Document elapsed. If ≤2s, the `--wait` blocks-until-done assumption is wrong and the design must be revisited.
4. After patch lands: stub `node` as `sleep 30`, invoke pipeline's stage 4, confirm pipeline exits stage 4 within 16s with `CODEX_EXIT ∈ {124, 137}` and Claude fallback (`run_claude_adversarial`) runs.

## Verdict

**Hypothesis (c) confirmed. PR #21 fixed correctness; Phase 0 PR must add liveness.** Stress test surfaced 2 BLOCK + 3 IMPORTANT findings on the original fix design — all resolved in the revised design above by adopting the simpler single-site `timeout` wrap, rejecting the lib extraction, and specifying explicit acceptance criteria. Cap honored at 4 items (regression test, macOS timeout shim with hard-block on missing utility, FAIL-regex residual confirmation, MEMORY update). RCA + stress-test elapsed: under 90 minutes — no `/codex:rescue` escalation.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES → fix design revised; revisions resolve all BLOCK and IMPORTANT findings.
**Date:** 2026-04-28
**Mode:** standard (single analyst, 5 dimensions)

### Findings consolidated

| Severity | Dimension | Finding | Resolution |
|----------|-----------|---------|------------|
| BLOCK | Precision | Original fix said "On timeout, set `CODEX_EXIT=124`" alongside `\|\| CODEX_EXIT=$?`. Two developers would split: one sets internally + returns 0, breaking the line-698 fallthrough. | Revised: drop the helper. `timeout`'s native exit (124/137) is captured by outer `\|\|`. Pattern matches every other call site. |
| BLOCK | Edge cases | `taskkill //F //T //PID` on Windows reaches direct children but may not reach `node`-spawned codex CLI grandchildren if they break away from the Job Object. The original stall was attributed to FD-leak holding pipe — same hazard at OS level for codex grandchildren. | Revised: `timeout` two-stage (SIGTERM→SIGKILL after `--kill-after=10`) lets node's signal handler clean up its own children before SIGKILL. If grandchildren orphan, they no longer block bash command-substitution because `timeout` has returned. Strictly better than poll-and-`taskkill //T`. |
| IMPORTANT | Contradictions | "Externalize `run_claude` to `scripts/lib/run-claude.sh`" is NOT on the roadmap's Phase 0 four-item list. Touches 8 Claude call sites + frozen-copy sourcing path. Silent scope creep. | Revised: dropped lib extraction. Single-site wrap touches 2 lines (header + line 672). Phase 0 cap honored. |
| IMPORTANT | Edge cases | macOS-no-coreutils branch was specified as "warn-and-skip" — silently re-exposes the exact bug being fixed. | Revised: HARD `exit 1` with brew install instructions. Operator-visible, never silent. |
| IMPORTANT | Simpler alternatives | Helper + lib refactor proposed without evaluating the one-liner `timeout` wrap. Lib extraction buys nothing because there is one Codex call site. | Revised: adopted the one-liner. Lib extraction deferred to cycle 2 if a second call site appears. |
| NOTE | Acceptance | "Verification path" tested bash behavior, not the actual fix. | Revised: 4 concrete acceptance checks added (timeout exit codes, `--wait` blocks, post-patch end-to-end). |
| NOTE | Hypothesis (b) | OpenAI vs Anthropic distinction verified via `~/.codex/config.toml` (model = gpt-5.5). | No change — already correct. |
| NOTE | "RECURRED" reframing | Defensible but thin. Stale MEMORY entry is the secondary contributor. | No change — fix item 6 (MEMORY update) addresses. |

Reviewer's verdict: PROCEED_WITH_NOTES. Two BLOCK findings are implementation ambiguities, not RCA-verdict errors — they do not invalidate hypothesis (c). All five flagged issues are resolved in the revised fix design above. Implementation can proceed.

## Sources

- `scripts/execute-pipeline.sh:121-152` (`run_claude` helper — liveness pattern reference)
- `scripts/execute-pipeline.sh:672` (Codex call site — missing liveness gate)
- `scripts/execute-pipeline.sh:680-692` (PR #21 post-call sanity check — cannot fire if node hangs)
- `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs:142` (`-C` aliases to `cwd`)
- `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs:682-723` (`handleReviewCommand` — `--wait` parsed but unused for adversarial path)
- `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs:406-414` (`executeReviewRun` adversarial path — `runAppServerTurn` has no in-companion timeout)
- PR #21 squash commit `254a02b` (`git show 254a02b`)
- PR #26 summary `.iago/summaries/06-wedge-e-tsc-vite-parallel-build.md` (Codex exit 0, Review PASS — confirms cwd patch held)
- Handoff digest `sessions/2026-04-28-iago-os-pipeline-speed-07.md` (claim of recurrence — clarified above as imprecise framing)
- MEMORY entry `project_pipeline_bugs` (stale; needs update as part of fix PR)
- Roadmap `docs/specs/iago-os-roadmap.md` (Phase 0 standalone scope)
