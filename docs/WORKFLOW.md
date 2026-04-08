# iaGO-OS Workflow

## Phase Flow

```
/iago:init ──[PROJECT.md, ROADMAP.md, STATE.md, config.json]──►
  /iago:discuss ──[context/{NN}-{slug}.md]──►
    /iago:plan ──[plans/{NN}-{slug}-{PP}.md]──►
      /iago:execute ──[summaries/{NN}-{slug}-{PP}.md, git commits]──►
        /iago:verify ──[reviews/{NN}-{slug}.md]──► done / re-plan

After verify passes: STATE.md updated, PR created, orchestrator suggests next phase.
Discuss → plan → execute → verify repeats per ROADMAP phase.
```

## Phases

### 0. Init (`/iago:init`)

| | |
|---|---|
| **Trigger** | New project or first time setting up `.iago/` |
| **Gate** | None. Blocks if `.iago/PROJECT.md` already exists. |
| **What Claude does** | Scaffold directories, ask 3-5 discovery questions, write foundation artifacts |
| **State written** | Phase: `00-init`, Status: `idle` |
| **Output** | `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `config.json`, `active-client.json` |
| **Profiles** | `research` (optional, for existing codebase scan) |

### 1. Discuss (`/iago:discuss {phase-slug}`)

| | |
|---|---|
| **Trigger** | Starting work on a ROADMAP phase |
| **Gate** | `ROADMAP.md` must exist. Phase must be listed. |
| **What Claude does** | Surface 3-5 decisions, capture domain specifics, log deferred items |
| **State written** | Phase: `{NN}-{slug}`, Status: `discussing` |
| **Output** | `.iago/context/{NN}-{slug}.md` |
| **Agents** | None — orchestrator-direct, human-interactive |

### 2. Plan (`/iago:plan {phase-slug}`)

| | |
|---|---|
| **Trigger** | After discuss, before execution |
| **Gate** | `context/{NN}-{slug}.md` should exist (soft gate — warns if missing) |
| **What Claude does** | Decompose phase into plans with 2-8 tasks each, self-review, assign waves |
| **State written** | Phase: `{NN}-{slug}`, Status: `planning` |
| **Output** | `.iago/plans/{NN}-{slug}-{PP}.md` (one or more) |
| **Profiles** | `research` (optional, via `--research` flag) |

### 3. Execute (`/iago:execute {phase-slug}`)

| | |
|---|---|
| **Trigger** | Plans exist for the phase |
| **Gate** | At least one `plans/{NN}-{slug}-*.md` must exist |
| **What Claude does** | Wave analysis, run `scripts/execute-pipeline.sh` per plan (6-stage: implement → build gate → review → codex → PR → summary), collect results |
| **State written** | Phase: `{NN}-{slug}`, Status: `executing` → `executed` |
| **Output** | `.iago/summaries/{NN}-{slug}-{PP}.md` per plan, git commits, PRs |
| **Profiles** | Opus for implementation/fix, Sonnet for review/PR, GPT-5.4 for Codex adversarial (Claude fallback if unavailable) |
| **Pipeline** | Each plan runs through `execute-pipeline.sh` in separate `claude -p` sessions — no context bleed. Async GitHub Action review-fix loop after PR creation (max 5 rounds) |

### 4. Verify (`/iago:verify {phase-slug}`)

| | |
|---|---|
| **Trigger** | All plans executed for the phase |
| **Gate** | All plan summaries must exist |
| **What Claude does** | Goal-backward verification, run checks, produce report, ship PR if passed |
| **State written** | Phase: `{NN}-{slug}`, Status: `verified` (if passed) |
| **Output** | `.iago/reviews/{NN}-{slug}.md` with verdict: `passed` / `gaps_found` / `human_needed` |
| **Agents** | None — orchestrator-direct analysis |

## Bypass Modes

### Fast (`/iago:fast`)

For trivial tasks: ≤3 file edits, no new dependencies, obvious fix.

```
User describes task → Execute inline → Atomic commit → STATE.md log
```

Skips everything: no discuss, no plan, no summary, no verify, no agents.
If >3 files or uncertain scope → redirect to `/iago:quick`.

### Quick (`/iago:quick {description}`)

For standalone tasks: 1-3 tasks, clear scope, not part of a ROADMAP phase.

```
[--discuss] → Lightweight plan → matching profile → review-single → [--verify] → STATE.md log
```

Composable flags: `--discuss`, `--research`, `--verify`.
Skips: ROADMAP manipulation, wave grouping, plan self-review loop.
Plan naming: `quick-{YYMMDD}-{slug}.md`.

### Decision Table: Which Mode?

| Situation | Mode |
|-----------|------|
| Typo fix, 1-line change | `/iago:fast` |
| Bug fix, 2-3 files, obvious cause | `/iago:fast` |
| Small feature, 1-3 tasks, standalone | `/iago:quick` |
| Multi-task feature, part of a milestone | Full workflow |
| Unclear scope, needs exploration | Full workflow (start with `/iago:discuss`) |
| Client project kickoff | `/iago:init` → full workflow |

## Profile Dispatch Map

| Skill | Profile(s) Dispatched | When |
|-------|----------------------|------|
| `/iago:init` | `research` | Optional — existing codebase scan |
| `/iago:discuss` | (none) | Orchestrator-direct |
| `/iago:plan` | `research` | Optional — `--research` flag |
| `/iago:execute` | matching profile (fullstack/frontend/backend) | Per plan — selected by file paths |
| `/iago:execute` | `review-single` | After each plan (`review.mode: "single"`) |
| `/iago:execute` | `review-full` | After each plan (`review.mode: "full"`) |
| `/iago:execute` | `debug` | Ad-hoc, when build/typecheck/lint fails |
| `/iago:execute` | `/codex:adversarial-review` | Mandatory after every internal review — cross-model gate |
| `/iago:verify` | (none) | Orchestrator-direct |
| `/iago:quick` | `research` | Optional — `--research` flag |
| `/iago:quick` | matching profile | Per plan |
| `/iago:quick` | `review-single` | After implementation |
| `/iago:fast` | (none) | Inline execution |

## Pause / Resume

### Pause (`/iago:pause`)

Writes `.iago/state/HANDOFF.json` with:
- Workflow position (phase, plan, task number)
- Completed and remaining tasks
- Key decisions made in session
- Uncommitted files
- Next action (exact instruction to continue)

### Resume (automatic)

SessionStart hook loads `HANDOFF.json` → injects context → deletes file.
No explicit resume command needed.

Recovery hierarchy:
1. `HANDOFF.json` (manual pause — highest precision)
2. Session snapshot (automatic — "what was I doing?")
3. Interrupted session detection (crash recovery)

Stale warning: HANDOFF.json >7 days old triggers informational warning at session start.

## State Transitions

```
init → idle
discuss → discussing → idle
plan → planning → idle
execute → executing → executed
verify → verifying → verified (if passed)
```

STATE.md is updated at every transition. Under 80 lines always.
Overflow decisions → PROJECT.md Architecture Decisions table.

## Artifact Locations

| Artifact | Path | Created By |
|----------|------|-----------|
| Project vision | `.iago/PROJECT.md` | `/iago:init` |
| Phase roadmap | `.iago/ROADMAP.md` | `/iago:init` |
| Position digest | `.iago/STATE.md` | All phases |
| Workflow config | `.iago/config.json` | `/iago:init` |
| Context artifacts | `.iago/context/{NN}-{slug}.md` | `/iago:discuss` |
| Plans | `.iago/plans/{NN}-{slug}-{PP}.md` | `/iago:plan` |
| Summaries | `.iago/summaries/{NN}-{slug}-{PP}.md` | `/iago:execute` |
| Reviews | `.iago/reviews/{NN}-{slug}.md` | `/iago:verify` |
| Quick plans | `.iago/plans/quick-{YYMMDD}-{slug}.md` | `/iago:quick` |
| Quick summaries | `.iago/summaries/quick-{YYMMDD}-{slug}.md` | `/iago:quick` |
| Pause state | `.iago/state/HANDOFF.json` | `/iago:pause` |
| Session snapshots | `.iago/state/sessions/{id}.json` | Hooks (auto) |
| Cost log | `.iago/state/costs.jsonl` | Hooks (auto) |
