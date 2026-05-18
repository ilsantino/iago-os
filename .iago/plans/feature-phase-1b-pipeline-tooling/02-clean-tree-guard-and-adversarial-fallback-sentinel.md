---
phase: feature-phase-1b-pipeline-tooling
plan: 02
wave: 1
depends_on: []
context: .iago/plans/feature-phase-1b-pipeline-tooling/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1b-pipeline-tooling/02-clean-tree-guard-and-adversarial-fallback-sentinel

## Goal

Land two orthogonal pipeline-correctness fixes that share `scripts/execute-pipeline.sh` as common surface but touch disjoint line ranges (lines 660–669 + 776–784 for the parser; new file `scripts/check-clean-tree.sh` + skill SKILL.md edit for the guard) so they ride one plan without conflict. (A) Replace the implicit `/iago-execute` pre-flight dirty-branch check (which false-positives on `git worktree` metadata + gitignored untracked artifacts in a truly clean tree) with an explicit `scripts/check-clean-tree.sh` invoked from `.claude/skills/iago-execute/SKILL.md` § 3 — uses `git status --porcelain=v1` with worktree-filter + ignored-filter by default, exposes `--strict` for the rare case. (B) Replace the adversarial-fallback parser's prose-pattern matching (`\bCritical\b|\bImportant\b`) — which is already guarded off for the fallback path and therefore defaults to false-CLEAN — with a structured sentinel-verdict scheme: the Claude `-p opus` adversarial prompt at line 660–669 is updated to END with `===VERDICT: CLEAN===` or `===VERDICT: ISSUES===`; the parser at line 776–784 greps for these literals anchored to the last 3 lines; absence of EITHER sentinel triggers a manual-review escalation (NOT a default-clean). Both fixes ship with shell-test coverage. Source of truth: `.iago/plans/feature-phase-1b-pipeline-tooling/CONTEXT.md` "Decided constraints" §§ "Dirty-tree check uses `git status --porcelain=v1`" + "Adversarial fallback verdict sentinel".

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `scripts/check-clean-tree.sh` | Pre-flight clean-tree check with worktree+gitignore filtering; exit 0=clean, 1=dirty, 64=usage |
| create | `scripts/check-clean-tree.test.sh` | 7 tests covering clean, dirty, worktree-only, gitignored-only, --strict mode, non-git-dir, sub-worktree |
| edit | `.claude/skills/iago-execute/SKILL.md` | § 3 Git sync now invokes `scripts/check-clean-tree.sh` BEFORE `git checkout main && git pull` |
| edit | `scripts/execute-pipeline.sh` | (A) Edit `run_claude_adversarial` (line 660–669) to require sentinel verdict; (B) Edit parser block (line 776–784) to grep for sentinel; (C) Add escalation branch for no-sentinel response |
| edit | `scripts/test-pipeline-helpers.sh` | Add 4 verdict-parser tests: CLEAN sentinel, ISSUES sentinel, no sentinel, sentinel-in-prose collision |
| create | `scripts/lib/adversarial-verdict.sh` | Extract verdict-parsing into sourceable helper for testability + reuse |

## Tasks

### Task 1: Author `scripts/check-clean-tree.sh`

- **files:** `scripts/check-clean-tree.sh`
- **action:** New executable bash script. Shebang `#!/usr/bin/env bash`, `set -euo pipefail`. Header comments: purpose ("Pre-flight clean-tree check for /iago-execute. Replaces implicit `git status` check that false-positives on worktree metadata + gitignored artifacts."), usage `check-clean-tree.sh [--project-dir DIR] [--strict]`, exit codes (`0` clean, `1` dirty, `64` usage error, `65` not a git repo). Arg parsing for `--project-dir`, `--strict`. Default `PROJECT_DIR="$(pwd)"`. Validate: `cd "$PROJECT_DIR" && git rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: not a git repo: $PROJECT_DIR" >&2; exit 65; }`. Core check: `STATUS=$(git status --porcelain=v1 --untracked-files=normal 2>/dev/null)` — captures M/A/D/R/C plus untracked files (`??` prefix). Lenient mode (default): filter the output through `grep -vE '^!! ' | grep -vE '^\?\? \.claude/worktrees/' | grep -vE '^\?\? \.iago/state/'` — the `!!` lines come from `--ignored=traditional` which we don't pass, so `!!` filter is defensive; `.claude/worktrees/` filter catches any worktree-prefix artifact the local convention produces; `.iago/state/` filter catches the pipeline-lock dir + pipeline-runs NDJSON which are transient state, not real code changes. Strict mode (`--strict`): no filtering, return raw porcelain output. If filtered STATUS is empty → echo "CLEAN" + exit 0. If non-empty → echo "DIRTY:" + the offending lines + exit 1. Source `scripts/lib/pipeline-telemetry.sh` IF available + the env `CLAUDE_CODE_SESSION_ID` is set + RUN_FILE is writable → emit a one-shot telemetry event `{"type":"clean_tree_check","mode":"lenient|strict","verdict":"clean|dirty","ts":"...","sessionId":"..."}`. 70–100 lines.
- **verify:** `bash -n scripts/check-clean-tree.sh && shellcheck scripts/check-clean-tree.sh && bash scripts/check-clean-tree.sh --project-dir C:/Users/sanal/dev/iago-os ; echo "exit: $?"`
- **expected:** `bash -n` exits 0. `shellcheck` exits 0. Live invocation prints `CLEAN` OR `DIRTY:<list>` against the iago-os repo; either is acceptable — verifies the script runs end-to-end.

### Task 2: Tests for `check-clean-tree.sh`

- **files:** `scripts/check-clean-tree.test.sh`
- **action:** Pure-bash test harness. Each test creates an isolated repo via `mktemp -d && cd && git init -q`. Tests: (1) `test_truly_clean_returns_0` — empty repo with one committed file; assert exit 0 + "CLEAN"; (2) `test_dirty_uncommitted_returns_1` — modify the committed file; assert exit 1 + "DIRTY"; (3) `test_worktree_dir_ignored_lenient` — create `.claude/worktrees/agent-xyz/` with a file; default mode assert exit 0 (filtered); (4) `test_worktree_dir_caught_strict` — same setup; `--strict` mode assert exit 1; (5) `test_gitignored_files_pass` — add `*.tmp` to .gitignore + commit, create `foo.tmp` untracked; assert exit 0 (since `--untracked-files=normal` respects .gitignore); (6) `test_iago_state_dir_filtered_lenient` — create `.iago/state/pipeline-runs/test.ndjson`; assert exit 0; (7) `test_non_git_repo_returns_65` — `mktemp -d` outside git; assert exit 65 + ERROR stderr. Match the test harness pattern from `scripts/lib/pipeline-telemetry.test.sh` (`run_test` + `assert_eq` + summary line). Clean up each tmp repo in trap. 130–160 lines.
- **verify:** `bash scripts/check-clean-tree.test.sh 2>&1 | tail -15`
- **expected:** All 7 tests pass. Summary shows `7/7 passed`.

### Task 3: Wire `check-clean-tree.sh` into `/iago-execute` skill

- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Read current SKILL.md. Edit § 3 "Git sync" (currently line 81–87). Before the `git checkout main && git pull origin main` block, insert a new pre-step: explicit invocation of `scripts/check-clean-tree.sh`. New § 3 structure: (a) "### 3. Pre-flight: clean tree check" — invokes `bash "$IAGO_ROOT/scripts/check-clean-tree.sh" --project-dir "$PROJECT_DIR"`; if exit 1, STOP with the script's DIRTY output + instruction "commit, stash, or use a worktree (see `feedback_worktree_per_session` memory) before retrying"; if exit 65, STOP with "PROJECT_DIR is not a git repo: $PROJECT_DIR"; if exit 0, proceed; (b) "### 4. Git sync" (renumber existing § 3) — the `git checkout main && git pull` block as-is. Renumber subsequent sections (Execute plans sequentially → § 5, Report results → § 6, n8n dispatch → § 7). Add to the Boundaries section: "The clean-tree check uses lenient mode by default — it ignores `.claude/worktrees/` and `.iago/state/` artifacts. To enforce strict mode (catch ANY untracked file), set `IAGO_CLEAN_TREE_STRICT=1` in the env before invoking the skill, which translates to passing `--strict`." Add corresponding `--strict` arg-passing in the invocation snippet.
- **verify:** `head -30 .claude/skills/iago-execute/SKILL.md ; grep -c '^###' .claude/skills/iago-execute/SKILL.md ; grep -c 'check-clean-tree.sh' .claude/skills/iago-execute/SKILL.md`
- **expected:** Frontmatter intact (description field unchanged). `###` heading count went from 6 (current 1.Load plans, 2.Resolve paths, 3.Git sync, 4.Execute, 5.Report, 6.n8n) to 7. `check-clean-tree.sh` literal appears ≥2 times (the invocation block + the boundaries note).

### Task 4: Extract verdict-parsing helper

- **files:** `scripts/lib/adversarial-verdict.sh`
- **action:** New sourceable helper. Function `parse_adversarial_verdict(text_file)` returns: exit 0 + stdout `CLEAN` if last 3 lines of input contain literal `===VERDICT: CLEAN===`; exit 0 + stdout `ISSUES` if last 3 lines contain `===VERDICT: ISSUES===`; exit 0 + stdout `UNKNOWN` if neither sentinel present (caller decides escalation). Collision protection: anchor to `tail -3` to avoid the sentinel appearing earlier in prose (e.g., in a quoted diff being reviewed); if BOTH sentinels appear in `tail -3` (defensive), prefer `ISSUES` (fail-safe — escalate). Exact implementation: `local sentinel_clean='===VERDICT: CLEAN==='`; `local sentinel_issues='===VERDICT: ISSUES==='`; `tail_block=$(tail -3 "$1" 2>/dev/null || echo "")`; if `[[ "$tail_block" == *"$sentinel_issues"* ]]`: echo ISSUES, return 0; elif `[[ "$tail_block" == *"$sentinel_clean"* ]]`: echo CLEAN, return 0; else: echo UNKNOWN, return 0. Function `format_adversarial_prompt_suffix()` returns a here-doc string the pipeline appends to the Claude fallback prompt: "End your response with EXACTLY ONE of these sentinels on its own line, with NO surrounding markdown, NO backticks, NO bold: `===VERDICT: CLEAN===` if you found no actionable issues, `===VERDICT: ISSUES===` if you listed any issues above. The pipeline parser greps for these literals." 50–80 lines.
- **verify:** `bash -n scripts/lib/adversarial-verdict.sh && shellcheck scripts/lib/adversarial-verdict.sh && grep -c '^parse_adversarial_verdict\|^format_adversarial_prompt_suffix' scripts/lib/adversarial-verdict.sh`
- **expected:** `bash -n` exits 0. `shellcheck` exits 0. Both function definitions present (count = 2).

### Task 5: Tests for verdict-parsing helper

- **files:** `scripts/test-pipeline-helpers.sh`
- **action:** Append 4 tests to the existing harness. (1) `test_verdict_clean_sentinel` — write file with body + last line `===VERDICT: CLEAN===`; `parse_adversarial_verdict file` → stdout `CLEAN`; (2) `test_verdict_issues_sentinel` — write file with body + last line `===VERDICT: ISSUES===`; → stdout `ISSUES`; (3) `test_verdict_no_sentinel_unknown` — write file with prose only ("I checked X but no issues found there, however Y is broken"); → stdout `UNKNOWN` (verifies the original bug is fixed — prose "no issues found" does NOT trigger false-clean); (4) `test_verdict_collision_prefers_issues` — write file where both sentinels appear in last 3 lines (`===VERDICT: CLEAN===\n===VERDICT: ISSUES===\n`); → stdout `ISSUES` (fail-safe). Source `scripts/lib/adversarial-verdict.sh` at the top of the test additions.
- **verify:** `bash scripts/test-pipeline-helpers.sh 2>&1 | tail -15`
- **expected:** All existing tests + Plan 01 Task 4 tests + 4 new verdict-parser tests pass. Test summary increments by 4.

### Task 6: Integrate sentinel verdict into `execute-pipeline.sh`

- **files:** `scripts/execute-pipeline.sh`
- **action:** Edit two regions:
  - **Region A — line 660–669 `run_claude_adversarial` prompt.** Source `scripts/lib/adversarial-verdict.sh` near top of script (alongside line 21–22 sources). Edit `run_claude_adversarial` to append the suffix returned by `format_adversarial_prompt_suffix` to the existing `-p` prompt string. Concretely: change the multi-line `-p "Adversarial review: ..."` to use a heredoc-built variable that includes the suffix, OR concatenate at the call site: `local _suffix; _suffix=$(format_adversarial_prompt_suffix); run_claude 600 -p "Adversarial review: ... Read the diff: $DIFF_FILE${_suffix}" --model opus ...`. The suffix must land INSIDE the prompt string — verify the existing string-concat behavior in bash with multi-line `-p`.
  - **Region B — line 776–784 parser block.** Replace the existing `_has_findings` heuristic when `USED_CLAUDE_FALLBACK=true` with sentinel-based extraction. Concrete diff: keep the Codex path (the `\[P[012]\]|severity.*P[012]|^Verdict: needs-attention` patterns) unchanged because Codex output IS structured. For the Claude-fallback branch, replace the entire `elif [[ "$USED_CLAUDE_FALLBACK" != "true" ]] && echo "$CODEX_OUTPUT" | grep -qiE "$_codex_word_patterns"; then _has_findings=true; fi` block with: `if [[ "$USED_CLAUDE_FALLBACK" == "true" ]]; then _verdict=$(parse_adversarial_verdict "$CODEX_FILE"); case "$_verdict" in CLEAN) _has_findings=false ;; ISSUES) _has_findings=true ;; UNKNOWN) log "ERROR: Claude fallback emitted no verdict sentinel — halting pipeline for manual review"; exit 1 ;; esac; fi`. **Spec amendment (Opus PR #55 dual-review I2 + Codex prior-PR finding):** the original spec routed UNKNOWN to `_has_findings=true` (run the fix loop as fail-safe). Codex's prior-PR adversarial review flagged that path as risky — the fix session has no concrete findings to fix, so it becomes a wasted Claude invocation that masks a real upstream problem (the fallback reviewer was mis-prompted or broken). Hard-stopping the pipeline at UNKNOWN surfaces the issue at the right severity. The shipped behavior is `exit 1` (pipeline halts); the prior `_has_findings=true` fail-safe is rejected by design. Note: `$CODEX_FILE` is written at line 773 (`echo "$CODEX_OUTPUT" > "$CODEX_FILE"`) which is BEFORE the parser block, so the file exists at the time of `parse_adversarial_verdict` call.
  - Add a 3-line comment above each edited region citing this plan number for future archaeology.
- **verify:** `bash -n scripts/execute-pipeline.sh && grep -c 'adversarial-verdict.sh\|parse_adversarial_verdict\|===VERDICT' scripts/execute-pipeline.sh && grep -A2 'USED_CLAUDE_FALLBACK == "true"' scripts/execute-pipeline.sh | head -10`
- **expected:** `bash -n` exits 0. Reference count ≥3 (source line + parser call + format_suffix call). Visible match showing the case statement near the fallback-true branch.

## Verification

```bash
cd C:/Users/sanal/dev/iago-os \
  && bash -n scripts/check-clean-tree.sh \
  && bash -n scripts/lib/adversarial-verdict.sh \
  && bash -n scripts/execute-pipeline.sh \
  && shellcheck scripts/check-clean-tree.sh \
  && shellcheck scripts/lib/adversarial-verdict.sh \
  && bash scripts/check-clean-tree.test.sh 2>&1 | tail -5 \
  && bash scripts/test-pipeline-helpers.sh 2>&1 | tail -5 \
  && bash scripts/check-clean-tree.sh --project-dir C:/Users/sanal/dev/iago-os ; echo "live exit: $?"
```

Expected:
- All `bash -n` exit 0
- All `shellcheck` exit 0
- `check-clean-tree.test.sh` 7/7 passed
- `test-pipeline-helpers.sh` summary shows existing + Plan 01 Task 4 + Plan 02 Task 5 tests all green
- Live invocation runs (exit 0 or 1 acceptable)

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — `tail -3` window may MISS the sentinel.** If the Claude fallback response ends with markdown like ` ``` ` closing a code block followed by `===VERDICT: ISSUES===` on a NEW line followed by trailing whitespace + a final newline, the `tail -3` window catches it. But if the model emits the sentinel followed by 4+ explanatory lines (e.g., "I emitted ISSUES because of X, Y, Z, W"), `tail -3` misses it. **Fix:** widen the parser window to `tail -10` AND anchor with line-level regex `^===VERDICT: (CLEAN|ISSUES)===\s*$` to avoid catching it inside a code-block. Update Task 4 implementation + Task 5 tests accordingly. Add Task 5 test case 5: "model emits sentinel then chats below it" — parser still catches it within tail -10.
- **C2 — Skill renumber breaks any external references.** Task 3 renumbers SKILL.md sections 3→4, 4→5, 5→6, 6→7. If any external doc (`.iago/CONTEXT.md`, `docs/MANUAL.md`, `.iago/learnings/*`) references "iago-execute § 4" or similar, those refs break. **Fix:** Task 3 must add a final verification grep: `grep -rE 'iago-execute.*§\s?[3-7]' .iago/ docs/ CLAUDE.md` — if hits, update them in the same plan task (do NOT defer). If zero hits, proceed.

### Important (forward to impl, don't block)

- **I1 — `format_adversarial_prompt_suffix` heredoc whitespace.** Bash heredocs with `<<-EOF` strip leading tabs (not spaces). If implementer uses `<<EOF` (no dash), indented content blows up the prompt formatting. Task 4 must specify: build the suffix as a single-line `printf '%s\n' "End your response with EXACTLY ONE..."` OR a `<<-` heredoc, NOT a plain `<<EOF` with indented body.
- **I2 — `parse_adversarial_verdict` works on empty file.** If `CODEX_FILE` doesn't exist (theoretical — Codex crashed before `echo > $CODEX_FILE`), `tail -3` returns empty, function returns UNKNOWN, escalation fires. Acceptable behavior (fail-safe). Document explicitly in Task 4 function-header JSDoc.
- **I3 — Lenient filter for `.iago/state/` could mask a legitimate dirty state.** If a contributor accidentally commits a `.iago/state/` file (counter to gitignore intent), the lenient filter masks it. Acceptable trade-off: `.iago/state/` SHOULD be gitignored; if it isn't, that's the real bug. Task 1 should add a one-time-only stderr warning if the script detects `.iago/state/` NOT in `.gitignore`: `grep -q '\.iago/state/' "$PROJECT_DIR/.gitignore" 2>/dev/null || echo "WARNING: .iago/state/ is not in .gitignore — pipeline state dir may pollute commits" >&2`.
- **I4 — `IAGO_CLEAN_TREE_STRICT=1` env interaction.** Task 3 surfaces the env flag in skill boundaries; Task 1 doesn't read this env (only the `--strict` arg). The skill is responsible for translating env→arg. Document explicitly in Task 3 step-snippet: `[[ "${IAGO_CLEAN_TREE_STRICT:-0}" == "1" ]] && extra_args="--strict" || extra_args=""; bash ... $extra_args`.
- **I5 — Plan 01 telemetry helper read order.** Task 1's optional telemetry emit (`type stage_extra >/dev/null 2>&1`) checks if the telemetry helper is sourced. When `check-clean-tree.sh` is invoked from the skill (orchestrator session, NOT via `execute-pipeline.sh`), the telemetry helper is NOT sourced — the emit is a no-op, which is intended. When invoked from inside the pipeline (if a future task chains it), the helper IS sourced and emission fires. Document this dual-mode in Task 1's script-header comment.

### Minor

- M1 — `===VERDICT:` sentinel string was chosen for low collision probability. Could use a UUID-suffixed sentinel (`===VERDICT-7f3a:`) for absolute uniqueness, but readability suffers. Defer.
- M2 — `scripts/lib/adversarial-verdict.sh` is sourceable, not invocable. Add a guard: `(return 0 2>/dev/null) || { echo "adversarial-verdict.sh: source this file, do not execute" >&2; exit 1; }` at top. Optional polish.

### Dimension-by-dimension verdicts

- **Precision:** All 6 tasks have file paths + verify commands + expected output. Line-range targets in `execute-pipeline.sh` are exact (660–669, 776–784).
- **Edge cases:** Worktree metadata, gitignored files, non-git dir, prose-with-no-sentinel, dual-sentinel-collision, model-chats-below-sentinel all covered.
- **Contradictions:** Sentinel scheme matches CONTEXT.md "Adversarial fallback verdict sentinel" decided constraint. Clean-tree script matches "lenient default + `--strict` override". No contradiction.
- **Simpler alternatives:** Could ask Claude to emit JSON-only response with `{"verdict":"clean|issues"}` — REJECTED, more brittle than a string sentinel; Claude sometimes wraps JSON in markdown. String sentinel is the simplest reliable contract.
- **Missing acceptance criteria:** Plan 03 owns end-to-end integration; this plan owns the unit-level verification. Task 6 verify command exercises the integration point in `execute-pipeline.sh`.

### Implementer forward-list

1. Widen parser window to `tail -10` with line-anchored regex (C1 fix); add the "chats below sentinel" test in Task 5.
2. Grep for cross-references to skill section numbers; update if any (C2 fix).
3. Use `printf` or `<<-` heredoc for suffix building (I1 fix).
4. Document empty-file behavior in `parse_adversarial_verdict` JSDoc (I2 fix).
5. Add one-time gitignore-warning for `.iago/state/` (I3 fix).
6. Explicit env→arg translation in skill snippet (I4 fix).
7. Document dual-mode telemetry emission in script header (I5 fix).
