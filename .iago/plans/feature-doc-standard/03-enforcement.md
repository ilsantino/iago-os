---
phase: feature-doc-standard
plan: 03
wave: 3
depends_on: [01, 02]
context: .iago/plans/feature-doc-standard/README.md
created: 2026-08-26
source: feature
---

# Plan: feature-doc-standard/03-enforcement

## Goal

Make the standard self-sustaining: run the linter automatically, and close the four pipeline behaviors that manufacture the rot P3 just cleaned. Without this plan the cleanse decays exactly as the May one did — the audit's §6 lists the mechanisms, and every one of them is a code change, not a discipline problem.

Evidence: `.iago/research/2026-08-26-doc-standard-audit.md` §6. Two of these behaviors have already been observed producing real garbage this month: the mangled `C:Users…` lock dirs and the orphaned `clients/.baseline-sentria` worktree.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/organize/sweep.py` | Daily report includes `.iago/` conformance |
| modify | `.github/workflows/validate.yml` | PRs fail on new violations |
| modify | `.claude/workflows/execute-pipeline.js` | Worktree placement + temp paths |
| modify | `.claude/workflows/dual-adversarial.js` | Worktree placement rule for review legs |
| modify | `.claude/rules/git-workflow.md` | Post-merge prune covers worktrees, not just branches |
| delete | `scripts/execute-pipeline.sh` + its exclusive libs and tests | The deprecated bash pipeline that wrote the mangled lock paths |

## Tasks

### Task 1: Fold conformance into the daily sweep
- **files:** `scripts/organize/sweep.py`
- **action:** Add an `.iago/` conformance section to the sweep's report by invoking `iago-lint.py check --json` over the repo root and every `clients/*/.iago`, summarizing counts per rule code and listing the offending paths. Report only — the sweep must never delete or move `.iago/` content, matching its existing never-deletes contract.
- **verify:** `python scripts/organize/test-sweep.py 2>&1 | tail -2; python scripts/organize/sweep.py --dry-run 2>&1 | grep -A5 -i "iago\|conformance" | head -12`
- **expected:** Sweep tests still pass; the dry-run report contains an `.iago` conformance section with per-code counts.

### Task 2: Fail PRs that introduce violations
- **files:** `.github/workflows/validate.yml`
- **action:** Add a step running `python scripts/organize/iago-lint.py check --root .` scoped to the repo root only (not `clients/`, which is gitignored and absent in CI). The step fails the job on a non-zero exit. Ensure Python is available in the runner and the step runs after checkout.
- **verify:** `grep -n "iago-lint" .github/workflows/validate.yml; python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/validate.yml')); print('yaml ok')"`
- **expected:** The lint step appears in the workflow; the YAML parses.

### Task 3: Confine review worktrees to `.worktrees/` and verify their removal
- **files:** `.claude/workflows/execute-pipeline.js`, `.claude/workflows/dual-adversarial.js`
- **action:** Add an explicit instruction to the reviewer/verify stage prompts in both workflows: any scratch worktree must be created under `<repo>/.worktrees/<name>` and never as a sibling (`../.baseline-*`), must be removed with `git worktree remove --force` followed by an existence check, and a failed removal must be reported rather than ignored. This is the exact behavior that produced `clients/.baseline-sentria` on 2026-08-11 (sentria PR #366) and left it on disk for two weeks.
- **verify:** `grep -c "\.worktrees/" .claude/workflows/execute-pipeline.js .claude/workflows/dual-adversarial.js; node --check .claude/workflows/execute-pipeline.js && node --check .claude/workflows/dual-adversarial.js && echo syntax-ok`
- **expected:** Both files contain the rule at least once; both parse.

### Task 4: Route every pipeline temp path into `state/`
- **files:** `.claude/workflows/execute-pipeline.js`
- **action:** Find each place the workflow writes a scratch artifact — PR bodies, review diffs, dispatch logs — and repoint them under `.iago/state/` (gitignored) instead of `.iago/` root or `.iago/summaries/`. The audit found `_pr-body-*.md` and `_dispatch-*.log` in `summaries/` at the root, and `_scratch-pr*-body.md` plus `tmp-diff.txt` in the client trees; the linter now flags these, so leaving the writers unchanged means CI fails on the pipeline's own output.
- **verify:** `grep -nE "\.iago/(summaries|_scratch|tmp-|_pr-body)" .claude/workflows/execute-pipeline.js | grep -v "state/" | wc -l; node --check .claude/workflows/execute-pipeline.js && echo syntax-ok`
- **expected:** The grep prints `0` (no scratch write outside `state/`); the file parses.

### Task 5: Make post-merge prune cover worktrees
- **files:** `.claude/rules/git-workflow.md`
- **action:** Extend the existing "Post-merge branch prune" section so it also removes the merged branch's worktree: determine merged-ness from PR state (`gh pr list --state all --json state,headRefName`) rather than commit ancestry because squash merges break merge-base, then `git worktree remove`, falling back on Windows to `Remove-Item -Recurse -Force` plus `git worktree prune` when read-only files block it. Keep the addition under 6 lines.
- **verify:** `grep -A8 -i "post-merge" .claude/rules/git-workflow.md | grep -c "worktree"; awk 'END{print NR}' .claude/rules/git-workflow.md`
- **expected:** The prune section mentions worktrees at least twice; the rule file stays close to its current length (≈35 lines).

### Task 6: Delete the deprecated bash pipeline
- **files:** `scripts/execute-pipeline.sh`, `scripts/lib/*.sh`, the bash test scripts
- **action:** First confirm nothing live depends on them: `scripts/metrics-aggregate.mjs` only *mentions* `scripts/lib/pipeline-telemetry.sh` in a comment and imports nothing from it, and the JS workflows reference none of these libs — re-verify both with grep before deleting, and confirm what currently writes the telemetry NDJSON that `metrics-aggregate.mjs` reads. Then `git rm` `scripts/execute-pipeline.sh`, its exclusive libs `scripts/lib/{adversarial-verdict,build-gate,env-validation,pipeline-telemetry}.sh`, and the tests that exist only to exercise them (`scripts/test-{env-validation,build-gate,pipeline-helpers,phase-1b-integration}.sh`, `scripts/measure-build-gate-rss.sh`, `scripts/check-clean-tree.test.sh`). Keep `scripts/check-clean-tree.sh` if anything live still calls it. Update the references in `.claude/rules/execution-pipeline.md`, `.claude/skills/iago-execute/SKILL.md` and `.claude/skills/subagent-driven-development/SKILL.md` so they no longer point at a deleted file.
- **verify:** `test ! -f scripts/execute-pipeline.sh; grep -rn "execute-pipeline\.sh" .claude scripts .github --include="*.md" --include="*.js" --include="*.mjs" --include="*.yml" | grep -v "_archive" | wc -l; node scripts/metrics-aggregate.mjs --help >/dev/null 2>&1; echo "metrics exit=$?"`
- **expected:** The script is gone; zero live references remain; `metrics-aggregate.mjs` still runs.

### Task 7: Clear the locked stale worktree registrations
- **files:** `clients/sentria/.git/worktrees/`
- **action:** `git -C clients/sentria worktree prune` currently fails with `Permission denied` on 5 entries — `catalogo-incidencias-unificado`, `hard-delete-entities`, `pr-184`, `pr-185`, `turnos-hardening`. Clear the read-only attribute on those registration dirs (`attrib -r /s`, or PowerShell `Remove-Item -Recurse -Force`) and prune again. Only the `.git/worktrees/*` registration metadata is touched; no working tree and no branch is deleted. Confirm each corresponding PR is merged before removing its registration.
- **verify:** `git -C clients/sentria worktree prune 2>&1 | wc -l; ls clients/sentria/.git/worktrees/ 2>/dev/null | wc -l; git -C clients/sentria worktree list`
- **expected:** Prune emits no errors; only registrations with a live working tree remain; `worktree list` matches what is actually on disk.

## Verification

```bash
# The gate is real: a violation must fail
echo "scratch" > .iago/_scratch-probe.md
python scripts/organize/iago-lint.py check --root . ; echo "expect non-zero: $?"
rm .iago/_scratch-probe.md
python scripts/organize/iago-lint.py check --root . ; echo "expect 0: $?"

# Nothing live points at the deleted bash pipeline
grep -rn "execute-pipeline\.sh" .claude scripts .github --include="*.md" --include="*.js" --include="*.yml" | grep -v _archive | wc -l   # -> 0

# Workflows still parse; sweep still green
node --check .claude/workflows/execute-pipeline.js && node --check .claude/workflows/dual-adversarial.js && echo workflows-ok
python scripts/organize/test-sweep.py 2>&1 | tail -2

# Worktree registrations are truthful
git worktree list; git -C clients/sentria worktree list
```

**Expected:** the probe file makes the linter exit non-zero and its removal returns it to 0 — proving the gate bites; zero live references to the deleted pipeline; workflows parse; sweep tests pass; both worktree lists match disk.

## Notes for the implementer

- Task 6 is the highest-risk deletion in this feature. If any verification is ambiguous — particularly what writes the telemetry NDJSON — delete `execute-pipeline.sh` alone and leave the libs, reporting the residual. A partial, correct deletion beats a complete, wrong one.
- Do not add a `PreToolUse` hook to block bad paths. That option was considered and rejected in `docs/specs/iago-os-mwp-routing-rule.md` (Option C) on cross-platform-fragility and false-positive grounds; the decision was to build the cheap gate first and escalate only if it proves insufficient. CI plus the daily sweep is that cheap gate.
