---
phase: feature-doc-standard
plan: 03
wave: 3
depends_on: [01, 02]
context: .iago/plans/feature-doc-standard/README.md
created: 2026-08-26
revised: 2026-08-26
source: feature
---

# Plan: feature-doc-standard/03-enforcement

## Goal

Make the standard self-sustaining: run the linter automatically, and close the pipeline behaviors that manufacture the rot P3 just cleaned. Without this the cleanse decays exactly as the May one did — audit §6 lists the mechanisms and every one is a code change, not a discipline problem.

Two have already produced real garbage this month: the mangled `C:Users…` lock dirs and the orphaned `clients/.baseline-sentria` worktree.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/organize/sweep.py` | Daily report includes `.iago/` conformance |
| modify | `.github/workflows/validate.yml` | Lint gate (advisory first) + register the linter's own tests + drop the deleted script from `bash -n` |
| modify | `.claude/workflows/execute-pipeline.js` | Worktree placement + scratch-path rule, with test assertions |
| modify | `.claude/workflows/dual-adversarial.js` | "Never create a worktree" — it is read-only by contract |
| modify | `.claude/rules/git-workflow.md` | Post-merge prune covers worktrees |
| delete | `scripts/execute-pipeline.sh` + 4 enumerated libs | The deprecated bash pipeline |

## Tasks

### Task 1: Fold conformance into the daily sweep
- **files:** `scripts/organize/sweep.py`, `scripts/organize/test-sweep.py`
- **action:** Add an `.iago/` conformance section to the sweep report by invoking `iago-lint.py check --json`. Model the subprocess handling on the existing `lint()` at `sweep.py:127-142`, whose docstring records the exact bug class to avoid ("a bare `int()` raised and the old handler swallowed it, reporting a healthy zone as 0/0 — a parse failure must be loud"). Three specifics: the linter **exits 1 by design when violations exist**, so `returncode == 0` must not be read as success; pass a `timeout=` since this is the first unattended call that walks seven client trees; and derive the repo root explicitly (`HERE.parents[2]`) since `sweep.py` knows only `org.ZONES`. Make the new report parameter **optional** — `write_report(record, review, installers, conformance, iago=None)` — because `test-sweep.py:172` calls it with four positional args and a required fifth turns this plan's own verify red. Report only; the sweep never deletes.
- **verify:** `python scripts/organize/test-sweep.py; echo "tests_exit=$?"; python scripts/organize/sweep.py --dry-run 2>&1 | grep -ci "conformance"`
- **expected:** `tests_exit=0`; the dry-run report contains a conformance section (≥1).

### Task 2: Wire the linter into CI — advisory first — and fix the gate it would break
- **files:** `.github/workflows/validate.yml`
- **action:** Three edits to the **`validate-scripts`** job (the only one already running Python, at `validate.yml:46,48`). (a) Add `python scripts/organize/iago-lint.py check --root . --exclude W006` with **`continue-on-error: true`**; W006 must be excluded because `actions/checkout` gives every file the same mtime, so "newest file under `.iago/`" is always *now* and the rule would fire on every PR forever. Use `python`, not `python3` — and confirm which the runner provides, adding `setup-python@v5` if neither resolves. (b) Register the linter's own tests — `python scripts/organize/test-iago-lint.py` and `python scripts/organize/test-sweep.py` — because `.github/workflows/` currently references `scripts/organize/` nowhere, and a blocking gate whose test suite never runs in CI turns every PR red with nothing to explain why. (c) Remove `scripts/execute-pipeline.sh` from the `bash -n` list at `validate.yml:33`, or Task 4's deletion turns CI red on the same PR. Note in the PR body that the gate is advisory for one week and flips to blocking once a week of PRs is clean.
- **verify:** `grep -n "iago-lint\|continue-on-error\|test-iago-lint" .github/workflows/validate.yml; grep -c "execute-pipeline.sh" .github/workflows/validate.yml; python -c "import yaml;yaml.safe_load(open('.github/workflows/validate.yml'));print('yaml ok')"`
- **expected:** The lint step, its `continue-on-error`, and the two test registrations are present; `0` references to the deleted script; the YAML parses.

### Task 3: One scratch-and-worktree rule, in the right workflow, with a test
- **files:** `.claude/workflows/execute-pipeline.js`, `.claude/workflows/execute-pipeline.test.mjs`, `.claude/workflows/dual-adversarial.js`, `.claude/workflows/dual-adversarial.test.mjs`
- **action:** In **`execute-pipeline.js`** add to the reviewer/build-verify and PR-stage prompts: any scratch worktree lives under `<repo>/.worktrees/<name>`, never a sibling `../.baseline-*`, and is removed with `git worktree remove --force` plus an existence check whose failure is *reported*, not swallowed; and any scratch file a stage creates lives under `.iago/state/`, never `.iago/` root or `.iago/summaries/`. In **`dual-adversarial.js`** the rule is the opposite and simpler: **never create a worktree — review from the current tree.** That file's PREAMBLE (`dual-adversarial.js:146`) is "read-only … Do NOT edit files, commit, push, or merge" and it implements a porcelain side-effect guard (`:296-301`, `:702-713`); telling it where to put a worktree would legitimize a mutation it exists to forbid — and a worktree inside the repo would newly trip that guard, whereas the sibling `../.baseline-*` was invisible to it, which is exactly why the 2026-08-11 incident went undetected. Add an assertion to each `.test.mjs` that the dispatched prompt contains its rule; `execute-pipeline.test.mjs:589` already asserts on prompt text and is the pattern to copy. Also add `.worktrees/` to the client `.gitignore` guidance, or the pipeline's own dirty-tree guard (`execute-pipeline.js:436`) blocks the next run on the worktree's contents.
- **verify:** `grep -q "\.worktrees/" .claude/workflows/execute-pipeline.js && echo impl-ok; grep -qi "never create a worktree" .claude/workflows/dual-adversarial.js && echo dual-ok; node scripts/validate-workflows.mjs; echo "wf_exit=$?"; node .claude/workflows/execute-pipeline.test.mjs; echo "t1=$?"; node .claude/workflows/dual-adversarial.test.mjs; echo "t2=$?"`
- **expected:** `impl-ok`, `dual-ok`, `wf_exit=0`, `t1=0`, `t2=0`. Use `validate-workflows.mjs` — **not** `node --check`, which fails on these files today because harness Workflow modules use top-level `return` (`execute-pipeline.js:1226`).

### Task 4: Retire the bash pipeline — references first, deletion second
- **files:** `scripts/execute-pipeline.sh`, `scripts/lib/{adversarial-verdict,build-gate,env-validation,pipeline-telemetry}.sh`, the four bash test scripts, `.claude/rules/execution-pipeline.md`, two `SKILL.md` files
- **action:** **Two commits.** *Commit A — references and the decision:* update `.claude/rules/execution-pipeline.md`, `.claude/skills/iago-execute/SKILL.md`, `.claude/skills/subagent-driven-development/SKILL.md` and `validate.yml:33` so none points at the script; and record the telemetry decision explicitly. That decision is: `scripts/lib/pipeline-telemetry.sh:122` is the **sole writer** of the per-run `*.ndjson` under `.iago/state/pipeline-runs/` that feeds `metrics-aggregate.mjs`'s p50/p95 stage-stats table; the JS workflow writes only `.iago/state/pipeline-runs.ndjson`, which carries no stage durations (`metrics-aggregate.mjs:16-18` says so). Deleting the lib therefore **ends stage-duration telemetry permanently**. Since `grep -rn "metrics-aggregate" .claude/` returns no live caller, accept the loss — but write it down in the summary as a stated residual, do not let it happen as a side effect. *Commit B — deletion:* `git rm` the script plus the **four enumerated libs only**. Do **not** glob `scripts/lib/*.sh`: that also sweeps `learnings-writer.sh`, `learnings-writer.test.sh`, `metrics-aggregate.test.sh` (the only regression net for the aggregator this plan keeps) and `pipeline-telemetry.test.sh`. Give those four an explicit disposition. `scripts/check-clean-tree.sh`'s only caller is `scripts/test-phase-1b-integration.sh:249`, which this task deletes — so either delete it too or record it as a kept orphan.
- **verify:** `test ! -f scripts/execute-pipeline.sh && echo gone; ls scripts/lib/; grep -rn "execute-pipeline\.sh" .claude scripts .github --include="*.md" --include="*.js" --include="*.mjs" --include="*.yml" | grep -v _archive | wc -l; node scripts/metrics-aggregate.mjs; echo "metrics_exit=$?"`
- **expected:** `gone`; `scripts/lib/` still contains `learnings-writer.sh`, `learnings-writer.test.sh` and `metrics-aggregate.test.sh` (or their deletion is recorded); `0` live references. Note `metrics-aggregate.mjs` exits 0 today only because historical sink files remain on disk — its exit code cannot distinguish healthy from dead, so it is evidence of nothing here; the residual note is the real acceptance.

### Task 5: Make post-merge prune cover worktrees
- **files:** `.claude/rules/git-workflow.md`
- **action:** Extend the "Post-merge branch prune" section so it also removes the merged branch's worktree: determine merged-ness from PR state (`gh pr list --state all --json state,headRefName`), not commit ancestry, because squash merges break merge-base; then `git worktree remove`, falling back on Windows to `Remove-Item -Recurse -Force` **on the worktree directory** plus `git worktree prune`. Keep the addition to ≤ 6 lines.
- **verify:** `grep -c "worktree" .claude/rules/git-workflow.md; awk 'END{print NR}' .claude/rules/git-workflow.md`
- **expected:** ≥ 2 mentions of worktree; the file stays ≤ 42 lines.

### Task 6: Clear the five locked stale worktree registrations — by name, never by glob
- **files:** `clients/sentria/.git/worktrees/`
- **action:** `git -C clients/sentria worktree prune` currently fails with `Permission denied` on exactly five registrations whose gitdir file is already gone: `catalogo-incidencias-unificado`, `hard-delete-entities`, `pr-184`, `pr-185`, `turnos-hardening`. Clear the read-only attribute on **those five directories by name**, then prune:
  ```powershell
  attrib -r "C:\Users\sanal\dev\iago-os\clients\sentria\.git\worktrees\<name>" /s /d   # x5, named
  ```
  ```bash
  git -C clients/sentria worktree prune
  ```
  **Never run `Remove-Item -Recurse -Force` over `.git/worktrees/*`.** Four other registrations there are **live** — `batch-scrub-fix`, `catalogo-hard-delete`, `fix-reporte-operacion-windows`, `turnos-drop-prioridad` — and `catalogo-hard-delete` is at **detached HEAD `3915486`** whose only ref lives in its registration; removing it makes that commit unreachable and gc-eligible. `git worktree prune` is itself safe: it removes only registrations whose gitdir is already missing and never deletes a branch, so no PR-state check is needed.
- **verify:** `git -C clients/sentria worktree prune 2>&1 | wc -l; git -C clients/sentria worktree list; ls clients/sentria/.git/worktrees/ | wc -l`
- **expected:** Prune emits `0` lines (no errors); `worktree list` shows the main checkout plus the four live worktrees; four registrations remain.

## Verification

```bash
# The gate bites locally
echo "scratch" > .iago/_scratch-probe.md
python scripts/organize/iago-lint.py check --root . ; echo "expect_nonzero=$?"
rm .iago/_scratch-probe.md
python scripts/organize/iago-lint.py check --root . ; echo "expect_zero=$?"

# Workflows parse by the validator that actually works on them, and their tests pass
node scripts/validate-workflows.mjs; echo "wf=$?"
node .claude/workflows/execute-pipeline.test.mjs; echo "t1=$?"
node .claude/workflows/dual-adversarial.test.mjs; echo "t2=$?"
python scripts/organize/test-sweep.py; echo "t3=$?"
python scripts/organize/test-iago-lint.py; echo "t4=$?"

# Nothing live points at the deleted pipeline
grep -rn "execute-pipeline\.sh" .claude scripts .github --include="*.md" --include="*.js" --include="*.yml" | grep -v _archive | wc -l   # 0

# Worktree registrations are truthful
git worktree list; git -C clients/sentria worktree list
```

**Expected:** probe non-zero then zero; `wf/t1..t4` all `0`; zero live references; both worktree lists match disk.

## Post-merge

`execute-pipeline.js:461` requires it: a canary `/iago-fast` run **after merge, before any `/iago-execute`**, because Tasks 3 modifies the pipeline that runs the pipeline. Record the canary result in the summary.

## Rollback

- Tasks 1–5 are tracked-file edits: `git revert` the relevant commit.
- **Task 6 is the one step `git revert` cannot undo** — it mutates `clients/sentria/.git/worktrees/`, which is not under version control and not in any PR. Run it last, alone, and capture `git -C clients/sentria worktree list` before and after. If a live registration is lost, the worktree is recoverable by re-adding it; a lost **detached-HEAD** ref is recoverable only via `git reflog`/`fsck` before gc.

## Deferred, deliberately

Audit §6.5 — decision-bearing `.md` accumulating in gitignored `state/` — is **not** closed here. Plan 01's linter skips `state/` when walking, and Task 3 directs more pipeline scratch into it, so the rule and the behavior would contradict. Closing it needs a W011 with a `state/` carve-out (session/handoff files exempt, everything over ~4 KB reported). Deferred to P4, where the client trees make the real shape of the problem visible. Audit §6.6 (session logs at a client root) is handled in P4 for palazuelos.

## Stress Test

**Verdict:** BLOCK on the 2026-08-26 draft → **PROCEED** after revision (this file).
**Date:** 2026-08-26 · analyst (opus), read-only, claims verified against the repo.

**CONTRADICTIONS**
- *Critical — the old Task 4 was built on a false premise.* Grep for `_pr-body`, `_dispatch`, `_scratch`, `tmp-diff`, `prBody` across `.claude/` and `scripts/` returns **zero matches**: the PR stage builds the body inline in `gh pr create`. The artifacts the audit found are committed relics of the May/June manual-dispatch era (`_dispatch-b-01.log` from PR #50, `_pr-body-b04.md` from PR #87), already removed by plan 02 Task 7. **Fixed:** old Task 4 deleted; its one real requirement — a prompt-level scratch-path rule for emergent agent behavior — folded into Task 3.
- *Critical — its verify would have destroyed canonical doc routing.* The grep's only live hits were `execute-pipeline.js:585,586,1222` writing `.iago/summaries/${planName}.md` — the canonical execution-summary location per `CLAUDE.md` and stage 7. Driving that grep to `0` moves the durable audit trail into gitignored `state/`. **Fixed:** verify deleted.
- *Critical — `dual-adversarial.js` is read-only by contract.* Its PREAMBLE forbids mutation and it enforces a porcelain side-effect guard (`:296-301`, `:702-713`). Telling it where to place a worktree legitimizes what it exists to prevent — and an in-repo worktree would newly trip that guard, whereas the sibling `../.baseline-*` was invisible to it, which is why 2026-08-11 went undetected. **Fixed:** it now gets "never create a worktree"; only `execute-pipeline.js` gets placement rules.
- *Important — `scripts/lib/*.sh` as a delete glob* would also remove `metrics-aggregate.test.sh`, the only regression net for the aggregator this plan keeps. **Fixed:** four files enumerated, explicit disposition required for the other four.

**CRITICAL / correctness**
- *`node --check` fails on these files today*, before any edit — harness Workflow modules use top-level `return` (`execute-pipeline.js:1226`). **Fixed:** every verify uses `scripts/validate-workflows.mjs` (what CI itself uses at `validate.yml:58`) plus the colocated `.test.mjs` suites.
- *`validate.yml:33` runs `bash -n` on `scripts/execute-pipeline.sh`* — deleting it reds CI on the same PR that adds a new CI gate. **Fixed:** now an explicit edit in Task 2.
- *Deleting the bash pipeline permanently ends stage-duration telemetry.* `scripts/lib/pipeline-telemetry.sh:122` is the sole writer of the per-run NDJSON feeding `metrics-aggregate.mjs`'s p50/p95 table; the JS sink carries no durations (`metrics-aggregate.mjs:16-18`). The old verify was a double lie: `--help` is unhandled and silently runs the aggregation, which exits 0 only because historical files remain on disk. **Fixed:** Task 4 now *decides* — accept the loss (no live caller of `metrics-aggregate.mjs` anywhere in `.claude/`) and record it as a written residual, in a references-first / delete-second two-commit split.
- *W006 in CI is nondeterministic.* `actions/checkout` gives every file the same mtime, so "newest file under `.iago/`" is always now and W006 would fire on every PR forever from 14 days after plan 02 lands. **Fixed:** excluded in CI, and the gate ships advisory for one week.
- *Task 7's escape hatch could have caused unrecoverable loss.* A recursive force-delete over `.git/worktrees/*` would orphan four **live** worktrees, one at detached HEAD `3915486` whose only ref lives in its registration. **Fixed:** that command is struck; five directories named explicitly; clear the read-only attribute then `git worktree prune`, never a glob. Renumbered Task 6, run last and alone, with a rollback note.

**PRECISION** — the CI job was unnamed (`validate-scripts` is the only Python job, and it uses `python3`, which on this machine is the MS Store stub); `sweep.py` had no stated repo-root discovery, no timeout, and a `returncode == 0` reading that misclassifies the normal case (the linter exits 1 by design); a required fifth argument to `write_report` would break `test-sweep.py:172`. **All fixed** in Tasks 1 and 2.

**EDGE CASES** — `scripts/organize/` has **zero CI coverage** today, so a blocking gate would have shipped with an untested linter. **Fixed:** Task 2(b) registers `test-iago-lint.py` and `test-sweep.py`. Also noted: the `@claude` fix loop never reads check-run conclusions, so a red Validate does not stop it declaring CLEAN — check it manually at pass #2.

**MISSING ACCEPTANCE** — no rollback section (added), no behavioral acceptance that the prompt rule reaches an agent (added as `.test.mjs` assertions, copying `execute-pipeline.test.mjs:589`), no canary note (added), and audit §6.5/§6.6 silently dropped (now an explicit **Deferred, deliberately** section).

**Adopted from SIMPLER ALTERNATIVES:** S1 (fold Task 4 into Task 3), S2 (references-first / delete-second split), S3 (advisory CI for one week). **Not adopted:** S4 (run the worktree cleanup outside the plan) — it stays as Task 6 so the safe command is written down, but is flagged as the one step outside `git revert`.
