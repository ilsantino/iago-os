# Runbook — Test the `/dual-adversarial` gate

Repeatable procedure to validate the dual-adversarial review gate (core Opus 4.8 ∥ Codex
GPT-5.5, optional lenses, optional Team depth, optional Fix flow). Run after any change to
`.claude/workflows/dual-adversarial.js`, `dual-adversarial-fix.js`, or the skill.

**Invariants under test:** read-only by default; NEVER merges; Fix flow never pushes/merges
(structural git guard); Team verification keeps real bugs and only drops both-refute false
positives; standard mode unchanged.

## 1. Fast sanity (no agents)

```bash
node .claude/workflows/dual-adversarial.test.mjs     # expect: 9 passed, 0 failed
node scripts/validate-workflows.mjs                  # expect: OK on dual-adversarial.js, dual-adversarial-fix.js, execute-pipeline.js
```

## 2. Dogfood — Team mode, read-only

Invoke `/dual-adversarial` on an open PR (or current branch). At the 4-question prompt:
- Q3 depth = **Team**
- Q1 lenses = code-review + completeness (add security/amplify/frontend if the diff warrants)
- Q4 = **Report only**

> Codex GPT-5.5 has a usage quota — if it's exhausted the result will (correctly) show
> `crossModelDegraded: true` and `codexSource: claude-fallback`. Re-run after the quota
> resets for a true cross-model leg.

**Confirm in the result:** `mode: "team"`; the `team:data` + `team:arch` legs ran; each
Critical/Important finding was skeptic-verified; any both-refute finding is in `filtered`
(not `findings`); the report leads with `clean` (not `verdict`). Nothing is committed or
merged.

## 3. Exercise the Fix flow (throwaway branch, safe)

```bash
git switch -c test/dual-adv-fix-probe origin/main
# Plant ONE obvious blocking bug, e.g. an auth guard that always returns true,
# or a Lambda handler that fires an async write without awaiting it. Commit it.
```

Run `/dual-adversarial` with Q3 = **Team**, Q4 = **Fix verified findings**.

**Confirm:**
- The skeptics **CONFIRM** the planted bug (it survives verification — no false-drop).
- `dual-adversarial-fix.js` fixes + commits it on the branch.
- The gate re-runs and reports `clean`.
- **Nothing was pushed or merged:** `git status -sb` shows the branch advanced by a local
  fix commit only; no remote movement; the PR (if any) is untouched.

```bash
git switch -                      # leave the probe branch
git branch -D test/dual-adv-fix-probe
```

## Pass criteria

All of: tests 9/9 + validate OK (step 1); Team result shape correct + read-only (step 2);
planted bug confirmed-not-dropped, fixed, re-gated clean, and zero push/merge (step 3).
