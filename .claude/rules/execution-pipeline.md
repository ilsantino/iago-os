## Execution Pipeline

The review pipeline is enforced by `scripts/execute-pipeline.sh`. Every plan
goes through 7 local stages + async GitHub review-fix loop. No shortcuts.

### How It Works

`/iago-execute {slug}` runs the pipeline script for each plan in the phase.
Each step is a fresh Claude session — no context bleed, no token burn in the
orchestrator.

The only way to skip the pipeline is `/iago-fast` (trivial fixes, ≤3 files).

### Self-freeze (Windows bash byte-offset hazard)

At startup, the pipeline copies the entire `scripts/` tree to
`$IAGO_PIPELINE_FROZEN_DIR` (a `mktemp -d` dir) and `exec`s itself from the
copy. The sentinel env var `IAGO_PIPELINE_FROZEN=1` prevents an infinite
re-exec loop. This exists because bash on Windows reads scripts by byte
offset — if an IMPLEMENT `claude -p` session edits
`scripts/execute-pipeline.sh` mid-run, line offsets shift and the parser
crashes (`ools: command not found` from a partial `--allowedTools` token).
The frozen copy gives the running bash a stable file to parse. Helpers under
`scripts/lib/` and `scripts/review-checks/` ride along in the copy so the
re-execed script can source/cat them via `$SCRIPT_DIR`. The frozen dir is
cleaned in the EXIT trap.

### Rule: Skill Invocation Is Required

When a plan exists that requires code changes:

1. **Invoke `/iago-execute`** — it runs the script. The pipeline is automatic.
2. **Do NOT read the plan and implement it yourself.** That bypasses the pipeline.
3. **`/iago-fast`** is the only path that skips review.

### Detecting the Violation

If you notice yourself doing any of these WITHOUT having invoked `/iago-execute`:
- Reading a plan file and decomposing it into tasks
- Creating TaskCreate items based on a plan
- Calling Edit/Write on files referenced in a plan
- Dispatching agents to implement a plan

**STOP.** Invoke the skill. The script handles everything.

### Pipeline Stages (per plan)

```
scripts/execute-pipeline.sh --plan {path} --project-dir {dir}
  |
  v
0. STRESS TEST — claude -p opus, adversarial review of the plan itself (max 15 turns)
  |  reads plan + referenced source files + CLAUDE.md
  |  checks: precision, edge cases, contradictions, simpler alternatives, missing acceptance criteria
  |  PROCEED → continue; PROCEED_WITH_NOTES → notes forwarded to impl; BLOCK → pipeline stops
  |  skipped if plan contains "## Stress Test" section (already tested during /iago-plan or /iago-stress)
  v
1. IMPLEMENT — claude -p reads plan + stress-test notes (if any), writes code (opus, max 50 turns)
  |
  v
2. BUILD GATE — tsc --noEmit && vite build (max 2 retries with fix sessions)
  |
  v
3. REVIEW — claude -p opus, three-pass: plan compliance + domain routing + adversarial (Critical/Important/Minor)
  |  reads full source files (not just diff) for context
  |  all check modules loaded (baseline + amplify + api + auth + backend + data-integrity + i18n + infra + react)
  |  reviewer selects relevant domains based on diff + plan, states which and why
  |  severity floors in modules enforced (ALWAYS Critical / ALWAYS Important — cannot downgrade)
  |  cross-cutting (always checked): auth bypass, data loss, races, rollback safety
  |  any findings → fix session (opus, priority: Critical→Important→Minor) → rebuild → re-review (max 2 rounds)
  v
4. CODEX ADVERSARIAL — codex CLI / GPT-5.5 if available, else claude -p opus
  |  reads plan for context; checks: auth bypass, data loss, race conditions, rollback safety
  v
4b. CODEX FIX — claude -p opus, fixes all Codex findings (P0→P1→P2)
  |  skipped if no findings; rebuild gate after fix
  v
5. CREATE PR — claude -p sonnet, stages, commits, pushes, creates PR via gh (plan embedded in PR body)
  |
  v
5b. TAG @claude — claude -p sonnet, context-rich review request (plan + diff → domains, focus areas, edge cases)
  |
  v
6. SUMMARY — write pipeline results to .iago/summaries/

```

### Build gate concurrency (`IAGO_PARALLEL_BUILD`)

The build gate (step 2) runs `tsc --noEmit` and `vite build`. Default is
sequential. Set `IAGO_PARALLEL_BUILD=1` to run them concurrently — the gate
then waits on both, kills the survivor if either fails (so retries don't stack
fresh vite processes on top of one still consuming RAM), and assembles a
labeled `# --- tsc --noEmit ---` / `# --- vite build ---` block for the fix
session regardless of which leg failed.

Default-off rationale: two concurrent TypeScript processes (explicit `tsc` plus
vite's internal one) on a 16GB Windows machine can press memory hard. The flag
IS the mitigation — once a memory-pressure run on a 16GB box documents safe
headroom, the default may flip. Until then, parallel mode is opt-in.

Telemetry: build_gate stage_end records carry `tsc_duration_ms`,
`vite_duration_ms`, and `build_gate_mode` extras so wedge effectiveness can be
measured offline (see `scripts/lib/pipeline-telemetry.sh`).

CI must exercise BOTH `IAGO_PARALLEL_BUILD=0` and `IAGO_PARALLEL_BUILD=1` on
every change to `scripts/lib/build-gate.sh` — the parallel path is otherwise
silently default-off and prone to bitrot. `scripts/test-build-gate.sh` runs
both modes against stubbed commands.

### Control Flags

`--no-tag` on the pipeline script skips step 5b (@claude tagging). The PR is
still created � only the async review-fix loop trigger is suppressed.

Default behavior per skill:
- **`/iago-execute`** — auto-review (tags @claude). Pass `--no-review` to suppress.
- **`/iago-quick`** — auto-review (tags @claude). Pass `--no-tag` to suppress.

Manual trigger: `/iago-prfix` tags @claude on any existing PR to start the
async loop after the fact.

### Async Review-Fix Loop (GitHub Actions)

Triggered automatically by step 5b. Runs without a session. Both workflows
skip merged/closed PRs (`state == open` guard).

```
@claude tagged on PR (step 5b or /iago-prfix)
  │
  ▼
claude.yml ── Claude Code Action reviews PR
  │
  ▼
Posts [claude-review-complete] signal (via GH_PAT)
  │
  ▼
claude-review-fix.yml ── checks findings + round count
  │
  ├── CLEAN (no findings) ──► post summary ──► human merges
  │
  ├── MAX ROUNDS (>5) ────► post notice ──► manual review
  │
  └── FINDINGS ──► fix agent fixes all findings
                     │
                     ▼
                   git commit + push (fallback push step)
                     │
                     ▼
                   re-tag @claude (via GH_PAT)
                     │
                     └──► back to claude.yml (loops)
```

### Handling Findings

All severities are fixed locally before PR creation. The local fix loop
runs in priority order (Critical → Important → Minor), max 2 rounds.
The async GitHub loop is a safety net, not the primary fix path.

| Severity | Action |
|----------|--------|
| Critical | Fix first. Rebuild, re-review. |
| Important | Fix second. Rebuild, re-review. |
| Minor | Fix last. Rebuild, re-review. |

Reviews must never dismiss findings as "acceptable" or "carry-over" — report
with severity, and the fix loop handles prioritization.

### What the Orchestrator Does

The orchestrator (main session) does NOT:
- Write implementation code
- Review implementation code
- Dispatch agents for implementation or review

The orchestrator DOES:
- Invoke `/iago-execute` (which runs the script)
- Report results to the user
- Update STATE.md after completion
- Escalate if the script fails

## Observation Masking

In implementation sessions exceeding ~3 turns of verbose tool output (full
file reads, multi-screen `Grep` dumps, long `Bash` logs), replace prior tool
outputs with compact reference markers when re-reading the same data instead
of re-emitting the full content. The marker format:

```
[file:<path>@lines L<start>-<end>, summary: <one-line gist>]
```

Goal: keep the prefix-cache stable and let later turns operate against
references rather than re-pasted bulk text. Source: agent-skills-context
(research sweep 2026-05-04).

### Three concrete examples

1. **Long Read result.** First turn: `Read .iago/plans/feature-X/01.md` (full
   200 lines). Subsequent turn that needs the same plan: emit
   `[file:.iago/plans/feature-X/01.md@lines L1-L200, summary: 5-task plan,
   wave 1, depends_on=[]]` rather than re-running Read. Re-fetch only the
   specific lines needed via `Read offset=… limit=…`.
2. **Multi-screen Grep result.** Initial `Grep -r "useEffect" src/` returns
   80 hits across 30 files. When re-referencing later, emit
   `[grep:"useEffect" src/, summary: 80 hits in 30 files; key clusters in
   src/features/auth (12) and src/features/dashboard (18)]`. If a later turn
   needs the auth cluster specifically, run a narrower targeted grep, do not
   re-emit the original 80-line list.
3. **Verbose Bash log.** A `npm run build` produces 400 lines. Capture the
   verdict (`exit 0` or first failing TypeScript diagnostic) and emit
   `[bash:npm run build, summary: exit 0, no warnings, build artifacts in
   dist/ (1.2 MB)]`. Keep the full log only if a later turn must inspect a
   specific error.

### Scope

- **Sub-agents (advisory).** Sub-agents dispatched by the orchestrator
  *should* apply observation masking when their internal tool history grows
  large; they are not required to.
- **Long sessions (mandatory).** Any session exceeding 30 turns must apply
  observation masking on every re-reference to a prior tool output.
  Implementation, fix, and review pipeline sessions count their own turns
  toward this threshold; the orchestrator counts all-of-session turns.
- **Pipeline `claude -p` stages.** Each stage starts fresh, so the 30-turn
  threshold rarely fires inside a single stage. The rule still applies if a
  stage explicitly loops (e.g., the review fix-loop running 2 rounds with
  each round re-reading the diff).

## Plan archive convention

Plans superseded by a canonical roadmap or vision spec move to `.iago/plans/_archive/{YYYY-MM-{slug}}/` with a roadmap-pointer header on each file. Never execute archived plans without first re-stress-testing them against the current roadmap.

A plan is superseded when a canonical spec explicitly replaces its execution pattern, not merely when it is deferred (deferred plans stay in their phase folder; superseded plans move to `_archive/`).
