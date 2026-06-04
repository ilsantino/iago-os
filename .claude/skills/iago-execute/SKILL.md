---
name: iago-execute
description: >-
  Use when executing implementation plans that already exist on disk under .iago/plans/.
  Runs each plan through the full 8-stage pipeline (stress → impl → build → review → codex → fix → PR).
  Do NOT use when no plan files exist yet (run /iago-plan first), when the change is trivial
  (use /iago-fast), or when scope is 1-3 standalone tasks with no plan written
  (use /iago-quick which writes the plan inline).
---

## Purpose

Execute plans for a phase via the harness-native `execute-pipeline` Workflow. Each
plan goes through: stress → implement → build gate → commit → dual-adversarial
(Opus ∥ Codex GPT-5.5) → fix → PR. Every stage runs as a tracked subagent with
fresh context — no token burn in the orchestrator session, and completion is
notified automatically (no log polling).

## Preconditions

- `.iago/PROJECT.md` must exist.
- At least one `.iago/plans/{NN}-{slug}-*.md` must exist for the target phase.
  If not, STOP: "No plans found. Run `/iago-plan {slug}` first."
- `.claude/workflows/execute-pipeline.js` must exist in the iago-os root.
- When invoking from a client project directory, set `IAGO_OS_ROOT` to the
  iago-os installation path (e.g., `export IAGO_OS_ROOT=~/dev/iago-os`).
  `git rev-parse --show-toplevel` resolves to the client root, not iago-os.

## Arguments

`/iago-execute {phase-slug}` — execute all plans for the phase.

`/iago-execute {phase-slug} --plan {plan-id}` — execute a single plan only
(e.g., `--plan 02b`). Useful for re-running a failed plan.

`/iago-execute {phase-slug} --n8n` — dispatch to n8n webhook instead of local
script. Requires `automation.n8n_webhook_url` in `.iago/config.json`.

`/iago-execute {phase-slug} --no-review` — skip @claude tagging after PR
creation. Local pipeline still runs (build gate, review, codex). You can
manually trigger the async loop later with `/iago-prfix`.

If no phase-slug provided, read STATE.md for the current active phase.

## Steps

### 1. Load plans

Read plan files from the target folder:
- **Phase plans:** `.iago/plans/{NN}-{slug}/*.md` (e.g., `.iago/plans/01-auth/01-cognito-setup.md`)
- **Feature plans:** `.iago/plans/feature-{slug}/*.md` (e.g., `.iago/plans/feature-payment/01-stripe.md`)
- **Legacy flat plans:** `.iago/plans/{NN}-{slug}-*.md` (backwards compatible)

Sort by filename (alphabetical — `01-` before `02-`).

If `--plan` flag is set, filter to only that plan file.

Display the plan list and ask for confirmation:
```
Found {N} plans for phase {slug}:
  02a — {title from plan frontmatter or first heading}
  02b — ...
  ...
Execute all? (y/n)
```

### 2. Resolve paths

The pipeline is the harness-native **Workflow** at
`.claude/workflows/execute-pipeline.js` (NOT the deprecated `scripts/execute-pipeline.sh`).
Resolve its absolute path via Bash:

```bash
# Set IAGO_OS_ROOT env var, or auto-detect via git.
IAGO_ROOT="${IAGO_OS_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
WF="$IAGO_ROOT/.claude/workflows/execute-pipeline.js"
if [[ -z "$IAGO_ROOT" || ! -f "$WF" ]]; then
  echo "ERROR: Cannot resolve iago-os root / workflow. Set IAGO_OS_ROOT env var." >&2; exit 1
fi
echo "WF=$WF"   # absolute path to pass as the Workflow scriptPath
```

`PROJECT_DIR` = the client project directory (where `.iago/` lives), absolute.

### 3. Git sync

Before starting any plan:
```bash
cd "$PROJECT_DIR" && git checkout main && git pull origin main
```

This ensures we're on the latest main with no conflicts.

### 4. Execute plans sequentially

For each plan in order, invoke the **Workflow tool** (this skill invocation is the
authorization to call it — Workflow opt-in). Use the absolute paths from step 2:

Before each Workflow call, detect whether the plan was already stress-tested so the
Workflow can skip the (otherwise pure-waste) Opus stress spawn. Grep the plan for a
line-anchored `## Stress Test` heading:

```bash
grep -q '^## Stress Test' "<absolute plan path>" && echo skip || echo run
```

If it prints `skip`, add `skipStress: true` to `args`; otherwise OMIT the flag (the
Workflow uses strict `=== true`, so a missing value falls through to running the full
Opus stress agent — fail-safe toward more review).

```
Workflow({
  scriptPath: "<WF>",                      // .claude/workflows/execute-pipeline.js (absolute)
  args: {
    plan: "<absolute plan path>",
    projectDir: "<absolute PROJECT_DIR>",
    iagoRoot: "<IAGO_ROOT>",
    noTag: <true ONLY if --no-review was passed, else omit>,
    skipStress: <true ONLY if the plan has a `## Stress Test` section, else omit>
  }
})
```

The Workflow runs in the background as tracked subagents and notifies you on
completion; its return value carries `{ branch, prUrl, prNumber, reviewVerdict,
codexSource, fixRounds, minorRemaining }`. Run plans ONE AT A TIME — wait for each
to complete before launching the next (the next plan builds on the previous
plan's commits).

The Workflow runs the full pipeline per plan as tracked subagents (no
nohup-bash + `claude -p` fragility — transient API errors auto-retry, no static
turn caps):
0. **Stress** — adversarial plan review (skipped if plan has `## Stress Test`)
1. **Implement** — writes code from the plan
2. **Build gate** — `tsc --noEmit` + `vite build`
2b. **Commit** — commits on a feature branch so the cross-model diff is real
3+4. **Dual adversarial** — Opus reviewer ∥ Codex (GPT-5.5), in parallel
5. **Fix** — fixes findings + regression tests, commits, re-reviews (≤2 rounds)
6. **PR** — pushes branch, opens PR (full plan embedded), tags @claude unless `noTag`
7. **Summary** — writes `.iago/summaries/` + telemetry NDJSON

After the Workflow completes, the async GitHub review-fix loop runs
(`claude-review-fix.yml`): Claude reviews → fixes → re-tags → max 5 rounds.

**If a plan's Workflow throws** (stress BLOCK, build fail after 2 attempts, or
Critical/Important findings persisting after 2 fix rounds): STOP. Report the
error. Do not continue to the next plan. The user must investigate.

### 4b. Post-async dual-adversarial (pass #2)

Once the async GitHub loop posts its clean summary on a PR, run the final
cross-model gate before the human merges:

```
Workflow({
  scriptPath: "<IAGO_ROOT>/.claude/workflows/dual-adversarial.js",
  args: { projectDir: "<PROJECT_DIR>", iagoRoot: "<IAGO_ROOT>", base: "<PR base, e.g. origin/main>", prNumber: "<#>" }
})
```

It returns `{ clean, verdict, findings, blocking }`. If `clean`, tell Santiago
it's safe to merge. If `blocking > 0`, surface the findings and offer `/iago-prfix`.
**Never merge** — Santiago merges.

### 5. Report results

After all plans complete (or one fails):

```
Phase: {slug}
Plans executed: {N}/{total}
Status: {all passed | plan XX failed}

PRs created:
  - #{num} — {title} ({url})
  ...

Next: Review the PRs on GitHub, merge in order, then run
`/iago-verify {slug}` to verify the phase.
```

Update STATE.md:
- If all passed: Status → `executed`
- If one failed: Status → `executing (plan {XX} failed)`

### 6. n8n dispatch (if --n8n flag)

If `--n8n` flag is set:

1. Read `.iago/config.json` for `automation.n8n_webhook_url`.
2. For each plan, POST: `{ "phase": "{slug}", "plan_path": "{file}", "project_dir": "{cwd}" }`
3. Report: "Dispatched {N} plans to n8n. Monitor in dashboard."
4. STOP — n8n handles everything from here.

## Boundaries

- The orchestrator does NOT implement code — the Workflow's subagents do
- The orchestrator does NOT review code — the Workflow's subagents do
- The orchestrator does NOT dispatch implementation/review agents directly — the Workflow does
- One Workflow run per plan — never batch multiple plans into one run
- PRs are never auto-merged — Santiago reviews and merges on GitHub
- After the async loop reports clean, the orchestrator runs pass #2 (dual-adversarial) before telling Santiago to merge
- If the Workflow throws, STOP and escalate — do not retry without user input
