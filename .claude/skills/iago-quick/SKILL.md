---
name: iago-quick
description: >-
  Use when executing a small focused task (1-3 tasks, clear scope) outside the
  full multi-phase workflow. Runs the FULL 8-stage pipeline on the lightweight plan.
  Do NOT use when the change is ≤3 files and obvious (use /iago-fast which skips review),
  when scope exceeds 3 tasks (decompose with /iago-plan first), or when the task is part of a
  ROADMAP phase (use the full init → discuss → plan → execute → verify cycle instead).
---

## Purpose

Lightweight one-shot execution path for standalone tasks that don't warrant the
full workflow. Produces a plan (with stress test), then runs it through the
`execute-pipeline` Workflow (`.claude/workflows/execute-pipeline.js`) for the full
pipeline (stress → implement → build → commit → dual adversarial → fix → PR → summary).

## When to Use

| Criteria | Quick | Full Workflow |
|----------|-------|---------------|
| 1-3 tasks, clear scope | Yes | No |
| Part of a ROADMAP phase | No | Yes |
| Needs wave grouping | No | Yes |
| Needs multi-plan coordination | No | Yes |
| Ad-hoc fix or small feature | Yes | No |

If >3 tasks or unclear scope, redirect to the full workflow.
If ≤3 file edits and trivially obvious, use `/iago-fast` instead.

## Arguments

`/iago-quick {description}` — describe what needs to be done.

Optional flags (composable):
- `--discuss` — run a brief discuss step before planning
- `--research` — dispatch `research` profile before planning
- `--verify` — run verification after execution
- `--no-tag` — skip @claude tagging on PR (PR created but async review-fix loop not triggered). Default: auto-tag (same as `/iago-execute`)

## Preconditions

- `.iago/PROJECT.md` should exist (for project context). If not, proceed with
  CLAUDE.md as the only context source — quick doesn't require init.

## Steps

### 1. Optional discuss (`--discuss` flag)

If `--discuss` is set:
- Surface 1-3 quick decisions the user needs to make
- Do NOT write a context artifact — keep it conversational
- Capture any decisions inline for the plan

### 2. Optional research (`--research` flag)

If `--research` is set:
- Dispatch `research` profile with: the task description, CLAUDE.md, PROJECT.md
- Use findings to inform the plan

### 3. Create lightweight plan

Write `.iago/plans/quick-{YYMMDD}-{slug}.md`:

```markdown
---
phase: quick
plan: quick-{YYMMDD}-{slug}
wave: 1
depends_on: []
created: {YYYY-MM-DD}
branch: fix/quick-{slug}
base: main
---

# Quick: {short description}

## Goal

{1-2 sentences}

## Files

| Action | Path | Purpose |
|--------|------|---------|

## Tasks

### Task 1: {name}
- **files:** `{path}`
- **action:** {instruction}
- **verify:** `{command}`
- **expected:** {output}
```

**Max 3 tasks** — if you need more, redirect to full workflow.

### 4. Run the execution pipeline

Determine the project directory (repo root or client project dir).

Resolve the workflow path, then invoke the **Workflow tool** (this skill invocation
is the authorization to call Workflow):
```bash
IAGO_ROOT="${IAGO_OS_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
echo "$IAGO_ROOT/.claude/workflows/execute-pipeline.js"   # absolute scriptPath
```

Before the Workflow call, grep the plan for a line-anchored `## Stress Test` heading
and pass `skipStress: true` only when present (otherwise OMIT it — the Workflow uses
strict `=== true`, so a missing value runs the full Opus stress agent):
```bash
grep -q '^## Stress Test' "<absolute plan path>" && echo skip || echo run
```
Quick plans are written WITHOUT a `## Stress Test` section, so this normally prints
`run` and the flag is omitted — stress still runs (correct for the lightweight path).

```
Workflow({
  scriptPath: "<IAGO_ROOT>/.claude/workflows/execute-pipeline.js",
  args: {
    plan: "<absolute plan path>",
    projectDir: "<absolute project dir>",
    iagoRoot: "<IAGO_ROOT>",
    noTag: <true ONLY if --no-tag was passed, else omit>,
    skipStress: <true ONLY if the plan has a `## Stress Test` section, else omit>
  }
})
```

By default, quick tasks auto-tag @claude. With `--no-tag`, set `noTag: true` (PR is
created but the async review-fix loop is not triggered).

The Workflow runs the full pipeline as tracked subagents (no `claude -p` fragility —
transient API errors auto-retry, no static turn caps):
stress → implement → build gate → **commit** → **dual adversarial (Opus ∥ Codex)** →
fix + regression tests (≤2 rounds) → PR → summary. It returns `{ branch, prUrl,
reviewVerdict, codexSource, fixRounds, minorRemaining, verificationSameFamily,
verificationDegraded, crossModelDegraded, filtered }` and notifies you on completion.
At the merge decision, surface ALL THREE honesty signals to Santiago — never declare safe
to merge without them: `verificationDegraded === true` (skeptic verification did not fully
run — a real gate gap, Tier 2/3), `crossModelDegraded === true` (the Codex leg fell back to
the same Claude family — the GPT-5.5 cross-model guarantee silently degraded), and a
non-empty `filtered` (the Critical/Important findings the skeptics double-refuted and
DROPPED — list each with its `reasons`; a false double-refute could erase a real Critical
with no other visible trace).

After the async GitHub review-fix loop reports clean, run the pre-merge gate (pass #2):
```
Workflow({ scriptPath: "<IAGO_ROOT>/.claude/workflows/dual-adversarial.js",
           args: { projectDir: "<dir>", iagoRoot: "<IAGO_ROOT>", base: "origin/main", prNumber: "<#>", mode: "team" } })
```
`mode: "team"` is REQUIRED — the pre-merge gate always runs Team depth (skeptic
verification of every Critical/Important finding); omitting it silently runs the
shallower standard gate. Lead on `clean` (the authoritative merge signal); if
`gateStatus === "INCOMPLETE"`, a core leg failed — re-run the gate. If it returns
`clean`, tell Santiago it's safe to merge. Never merge yourself.

Review-fix loop runs async via GitHub Action (`claude-review-fix.yml`).

Critical findings trigger automatic fix → rebuild → re-review (max 2 local rounds).
Async loop fixes ALL severities in priority order (Critical → Important → Minor,
max 5 rounds). Posts bullet-point summary when clean — human reviews and merges.
If the pipeline fails, report the error to the user. Do not retry manually.

### 5. Optional verify (`--verify` flag)

If `--verify` is set (the pipeline already runs a build gate, so this is for
additional checks beyond build):
- `npx vitest run` — test suite
- `npx biome check` — lint
- Report pass/fail for each

### 6. Update STATE.md

Log to the Quick Tasks table in STATE.md:

| Date | Mode | Description | PR |
|------|------|-------------|-----|
| {today} | quick | {description} | #{number} |

## Output

Display:
1. Pipeline result (pass/fail, PR URL)
2. Review findings (from pipeline output)
3. Verification results (if `--verify`)

## Boundaries

- No ROADMAP manipulation — quick tasks are standalone
- No wave grouping — single plan only
- No plan-checker self-review loop
- Max 3 tasks — redirect to full workflow if more needed
- If pipeline reports BLOCKED, escalate to user immediately (no retry logic)
- The pipeline handles all review — do NOT dispatch agents for implementation or review
