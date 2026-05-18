I have enough context. Drafting findings now.

# Adversarial Review (Opus 4.7): PR #55

**Verdict:** NEEDS_CHANGES
**Plan(s) reviewed against:** `.iago/plans/feature-phase-1b-pipeline-tooling/02-clean-tree-guard-and-adversarial-fallback-sentinel.md` (Plan 02). Diff also bundles Plan 01 artifacts (`learnings-writer.sh`, `pipeline-telemetry.sh` sessionId, `.writer-contract.md`, `_dispatch-c-01*.log`, gitignore for fallback files) — Plan 01 reviewed adjacently since both were folded into one PR after the prior pipeline run died at PR-create.
**Diff size:** ~2,300 insertions / ~15 deletions across 13 files (incl. 2 dispatch logs).

## Critical
- *(none — the PR genuinely addresses real bugs from Codex's prior PR review; severity of remaining issues is Important/Minor)*

## Important

- **I1 — Primary-path `err` capture in `learnings-writer.sh` is always empty (silent observability gap).** `scripts/lib/learnings-writer.sh:73` (diff line 1357):
  ```bash
  err=$(printf '\n## %s — %s\n\n%s\n' "$ts" "$key" "$body" >> "$target" 2>&1)
  ```
  Redirect order is `>> $target` THEN `2>&1`. Bash applies redirects left-to-right: fd1 is redirected to the file first, then fd2 dups to whatever fd1 currently points to (the file). Result: both stdout AND stderr go to `$target`, the `$(...)` substitution captures nothing, and `err=""` on every failure. The telemetry event then emits `"err":""`, losing the diagnostic that the writer was specifically created to surface ("a chmod 0500 parent or full disk would cause the write to fail with no signal" per the writer's own header).

  The fallback path on line 1371 uses the CORRECT order (`2>&1 >> "$fb_path"`), which is why `fb_err` captures usefully. The primary path has the order inverted.

  Test 3 (`perm-denied fail-loud`) doesn't catch this: it greps `'FAIL'` in stderr, which matches the literal word in `echo "learnings_write: FAIL — could not write to $target: $err" >&2` regardless of whether `$err` is empty. It also greps `'learnings_write_failed'` in NDJSON which checks event TYPE, not the `err` payload.

  **Fix:** swap to `2>&1 >> "$target"` like the fallback path; add a test that asserts the telemetry event's `err` field is non-empty on a deliberately-failed write.

- **I2 — Plan deviation on UNKNOWN handling is undocumented in the plan and changes pipeline failure semantics.** `scripts/execute-pipeline.sh:820-829` (diff line ~1126-1141). Plan 02 Task 6 specifies:
  > `UNKNOWN) log "WARNING: Claude fallback emitted no verdict sentinel — escalating to manual review"; _has_findings=true;`

  Implementation does `exit 1` (hard stop) instead. The change is defensible (Codex PR review flagged the fail-loop path as risky) and IS documented inline, but the deviation never made it back into the plan file or any STATE.md entry. A future operator reading the plan to predict pipeline behavior will be wrong — they'll expect a fix-loop entry, get a hard exit instead. Also surprises operators on flaky Claude responses: a malformed sentinel now blocks PR creation entirely rather than entering a (potentially no-op) fix session that would still create the PR.

  **Fix:** either amend Plan 02 Task 6 to record the spec change (and the Codex finding that motivated it), or roll back to the spec'd behavior and let the fix loop run as a no-op.

## Minor

- **M1 — `run_claude` per-call sessionId synthesis is dead in production.** `scripts/execute-pipeline.sh:155-170` (diff line ~1038-1054). With Plan 01's change, `pipeline_init` now exports `CLAUDE_CODE_SESSION_ID` if unset, BEFORE any `run_claude` call. So `run_claude`'s `export CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-$_call_sid}"` always preserves pipeline_init's value; `_call_sid` is computed and discarded. The docstring comment still advertises "per-call id `claude-{RUN_ID}-{ms}-{RANDOM}`", which is misleading: every `run_claude` invocation in a pipeline now shares the SAME synthesized id. The test `run_claude_synthesis_fallback_test` only exercises the dead path (it deliberately unsources the telemetry helper). **Fix:** either delete the synthesis logic from `run_claude` (pipeline_init handles it) or update the comment to reflect "shared per-pipeline id, preserved across calls."

- **M2 — `.gitignore` coverage grep relies on GNU-grep `\s` extension.** `scripts/check-clean-tree.sh:75` (diff line ~690): `grep -v '^\s*#' .gitignore`. POSIX BSD grep treats `\s` as a literal — silently matches zero lines, so the comment-strip becomes a no-op and the coverage check still passes if any line (including comments) mentions `.iago/state/`. Works on Git Bash + GNU/Linux; would degrade gracefully (false positive on commented `# .iago/state/`) on stock macOS. **Fix:** use `[[:space:]]` for portability.

- **M3 — `.gitignore` coverage check is substring-only.** Same line as M2. `grep -q '\.iago/state/'` matches negation lines (`!.iago/state/whatever`) and partial paths (`!important.iago/state/`) as if they covered the directory. Theoretical edge case; the lenient filter would still let the file through downstream `git add -A` exclusion (`:!.iago/state/**`), so the gap is contained — but worth tightening to a line-anchored match for the actual ignore semantics (`^\.iago/state/` or `^\.iago/state/\*\*`).

- **M4 — Dispatch logs committed contain wall-clock secrets-adjacent paths.** `.iago/summaries/_dispatch-c-01.log:347-389` reveals the Windows username and full powershell.exe invocation chains in PR history. Not a security defect for THIS repo (path is `C:\\WINDOWS\\System32\\...`, not creds), but consider whether dispatch logs belong in commits or under `.iago/state/` (now hard-gated). Carry-over from prior pipeline practice; flagging for awareness only.

- **M5 — Test 9 vs Test 10 numbering / file-order skew.** `scripts/check-clean-tree.test.sh`: tests defined out of numeric order (8, 10, 9) but invoked in source order (8, 9, 10). Confusing for grep navigation. Pure cosmetic.

## Dimension verdicts
- **Auth/security:** PASS — no auth surface; the only shell-spawn vector is `bash` invoking trusted scripts; no untrusted JSON parsing; sentinel literals are static.
- **Data loss:** PASS_WITH_NOTES — clean-tree guard now hard-fails on missing `.gitignore` coverage AND the staging globs exclude `.iago/state/`, so the prior pipeline-state-into-commits risk is closed. I1's silent-err is observability, not data loss.
- **Concurrency:** PASS — NDJSON `>>` appends under POSIX `PIPE_BUF` atomicity; no new lock surface; the only fire-and-forget paths (`__emit_telemetry`, `learnings_write` fallback) have explicit `|| true` and documented intent.
- **Rollback:** PASS — no on-disk state mutations; SKILL.md renumber is doc-only; verdict-parser is new code with backward-compat (UNKNOWN escalation handles the legacy prose-emitting model).
- **Plan compliance:** FAIL — I2 (UNKNOWN→`exit 1` vs spec'd `_has_findings=true`) is undocumented in the plan; otherwise the 6 tasks land as specified and exceed test coverage (10/7 tests for check-clean-tree, 5/4 verdict tests).
- **Code quality:** PASS_WITH_NOTES — M1 (dead synthesis branch), M2/M3 (grep portability/precision). Comments and source-guards are otherwise unusually careful for a shell module.
- **Test quality:** FAIL — I1 reveals a real test gap (no assertion on the `err` field of `learnings_write_failed` events, so a broken capture passes). Other tests are realistic and assert contract-level properties (e.g., `run_claude_parent_stage_end_observability_test` locks the designed empty-sessionId contract).

## Notes
- **Bundled PRs:** This PR carries BOTH Plan 01 and Plan 02 because the prior Plan 01 dispatch (`_dispatch-c-01.log`) died at PR-create with `You've hit your limit` and the retry (`_dispatch-c-01-retry.log`) died with `Reached max turns (15)`. The user appears to have manually folded the Plan 01 changes into the Plan 02 branch. Reviewing against both plans was necessary; the diff still lines up cleanly with the union.
- **Codex's prior PR-#50 finding (sessionId subshell scope)** IS genuinely addressed by moving synthesis into `pipeline_init`. The new `run_claude_parent_stage_end_observability_test` locks the contract that the parent stage_end's `sessionId` reflects whatever pipeline_init set, not whatever the subshell exported. Good engineering.
- **Stress test in Plan 02** was inline and the implementer fed C1/C2/I1-I5 forward into the code — the `tail -10` widen, source-guard, `printf` (not heredoc) for the suffix, and dual-mode telemetry header are all present. C2 (skill renumber breaking external refs) was verified clean in dispatch log review at line 442.
- The Codex P1 fix that converts the gitignore-coverage warning into a hard-fail is a net safety win for the pipeline. Test 8 + Test 10 (comment-only) make the contract concrete.
