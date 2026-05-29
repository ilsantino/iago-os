---
date: 2026-05-28
type: audit
subject: execute-pipeline.sh — why it keeps failing, what to keep, what to rebuild
trigger: repeated impl-stage failures (sentria P3a catalog: 3 launches, 2 distinct failures)
---

# Execute-pipeline teardown

## TL;DR

The pipeline's **brain** (review + cross-model adversarial + check modules) is sound. Its
**hands** — a 1124-line bash script that shells out to `claude -p` via a polled background
process on Windows — are where you bleed. ~55% of the script is scar tissue working around
that one delivery choice. Both Sentria failures were the hands, not the brain, not the code,
not the plan. The "4.7 → 4.8" worry is a **non-issue**: everything uses model aliases that
already resolve to 4.8.

## 1. Why it keeps failing

Two failures on the Sentria P3a run, mapped to exact lines:

| # | Symptom | Root cause | Location |
|---|---------|------------|----------|
| 1 | `400 'thinking' blocks cannot be modified` → whole pipeline exits 1 | **Zero retry** on a transient API error. `run_claude` returns non-zero, caller does `|| IMPL_EXIT=$?` then `exit 1`. One flake kills the run. | `execute-pipeline.sh:352-367` |
| 2 | Impl hit 80-turn cap with tests unwritten | **Static turn budget.** `--max-turns ${IAGO_IMPL_MAX_TURNS:-80}` — a single monolithic agent does the *entire* plan in one session; big plans blow the cap. | `execute-pipeline.sh:358` |

Neither is a review failure or a code failure. The cost you actually feel is **manual
nursing** after each flake: back up untracked docs, reset the tree, diagnose the log,
relaunch with raised budgets, re-watch. That dance is the tax.

The deeper structural fact: **impl is one agent doing all N tasks**. That is the opposite of
`/subagent-driven-development`'s "fresh agent per task," and it is why turn caps bite.

## 2. The "4.7 → 4.8" sweep — non-issue

Everything substantive uses **aliases**, which Claude Code resolves to the current version:

- `execute-pipeline.sh`: `--model opus` / `--model sonnet` (13 call sites) → already 4.8.
- Agent profiles (`.claude/agents/**`): `model: opus` / `model: sonnet` frontmatter → already 4.8.

The only literal `claude-opus-4-7` strings are **cost-ledger test fixtures** in
`runtime/daemon/agent-manager.test.ts` (3 lines, passed to `recordCost`, not asserted as
behavior) — cosmetic. Literal "Opus 4.7" elsewhere is **historical prose** in
`.iago/decisions/`, `.iago/handoff/`, `runtime/agents/pr-triage/README.md` — records of what
was true then; do **not** rewrite them. The live VPS daemon pins `claude-opus-4-5` in its
OpenClaw config (not this repo) — a separate v2 cutover concern, out of scope here.

**Conclusion:** the system was correctly built on aliases. No functional 4.8 change exists to make.

## 3. Stage-by-stage: keep / relocate / drop

| Stage | Lines | Verdict | Rationale |
|-------|-------|---------|-----------|
| 0 Stress test | 233-319 | **Keep** (fold into planning) | Useful pre-impl; already skipped when plan has `## Stress Test`. Optional. |
| 1 Implement | 321-379 | **Relocate** | The brittle part. Move to a tracked subagent, per-task, no static cap, auto-retry. |
| 2 Build gate | 381-452 | **Keep** | `tsc + vite`, cheap, catches breakage. Non-negotiable. Run inside the build step. |
| 2b Console gate | 454-528 | **Keep** | Playwright console-error catch, zero token cost. |
| 3 Review (+fix loop) | 530-728 | **Keep** | The review brain: plan-compliance + domain routing + adversarial + 2-round fix loop. |
| 4 Codex adversarial | 730-856 | **Keep** | Cross-model (GPT-5.5) diversity. Keep companion + Claude fallback + verdict sentinel. |
| 4b Codex fix | 858-962 | **Keep** | Fixes cross-model findings before PR. |
| 5 Create PR | 964-1024 | **Keep** (sonnet) | Mechanical. |
| 5b Tag @claude | 1026-1080 | **Keep** | Triggers async GH loop. |
| 6 Summary | 1086-1122 | **Keep** | Writeback to `.iago/summaries/`. |

**Reusable assets that survive any rewrite:** `scripts/review-checks/*.md` (11 domain
modules — accumulated review knowledge), `scripts/lib/build-gate.sh`, `console-check.mjs`,
the Codex companion integration, the GH async loop (`claude.yml` + `claude-review-fix.yml`).

## 4. Scar-tissue inventory (only exists because of nohup-bash + `claude -p` on Windows)

These vanish the moment orchestration stops being "a bash script parsing itself while a
`claude -p` child edits sibling files":

- **Self-freeze re-exec** (75-89) — bash reads scripts by byte offset; an impl session
  editing the script tree mid-parse crashes the parser. Gone with no bash script to parse.
- **`run_claude` file-redirect + 5s poll + `taskkill //F //T`** (164-213) — Windows
  `claude.exe` children hold pipe FDs open after SIGKILL. Gone with harness-tracked agents.
- **`timeout`/`gtimeout` detection + HARD-fail** (91-109) — manual liveness gating. The
  Agent/Workflow runtime manages lifecycle.
- **Per-project `mkdir` lock + liveness check** (120-150) — concurrency guard. Workflow
  concurrency cap + worktree isolation replace it.

Estimate: ~600 of 1124 lines are this class of workaround. The review prompts + check-module
composition + codex plumbing — the parts worth keeping — are the minority.

## 5. Replacement shape (Phase B) + the dual-adversarial flow

Rebuild as a **harness-native Workflow** (the primitive built to replace deterministic
multi-stage `claude -p` orchestration). Each stage becomes a tracked subagent: retryable,
isolated (doesn't burn orchestrator context), no byte-offset/pipe-FD hazards, no static caps.

```
plan  (/iago-plan — planning was never the problem)
  │
  ▼  Workflow:
  build      pipeline(tasks, executor-agent-per-task)  ← fresh agent per task, build gate inside
  │
  dual-adv#1 parallel( opus-4.8 reviewer , codex adversarial via Bash )  → fix Critical/Important
  │
  PR + /iago-prfix  → @claude → async GH loop (claude.yml + claude-review-fix.yml)
  │
  dual-adv#2 (NEW)  parallel( opus-4.8 reviewer , codex adversarial )  ← final gate before YOU merge
```

Two dual-adversarial passes is **more** review than today (today = one review+codex pre-PR).
Pass #2 is the new piece, triggered after the async loop reports clean, before merge. You
merge; Claude never does (standing rule).

Open question for Phase B: run the Codex leg *inside* a Workflow agent (Bash → companion) vs.
as an orchestrator-invoked `/codex:adversarial-review` skill between phases. Former keeps it
in the workflow; latter reuses the existing skill verbatim. Lean former.

## 6. Two paths

| | Phase A — surgical | Phase B — Workflow rebuild |
|---|---|---|
| Scope | ~30 lines in `run_claude` + impl stage | Full rewrite + skill integration |
| Fixes failure #1 | ✅ retry-once on transient API errors | ✅ native |
| Fixes failure #2 | ✅ raise/auto-bump turn budget | ✅ per-task agents, no cap |
| Kills the nursing | ✅ (most of it) | ✅ (all of it) |
| Deletes scar tissue | ❌ | ✅ ~600 lines |
| Adds dual-adv #2 | ❌ | ✅ |
| Cost | ~1 hour | days |
| Risk to core infra | low (additive) | medium (big surface: 3 skills + CI) |

## 7. Integration surface (what Phase B must update)

Invokers of `execute-pipeline.sh`: `/iago-execute`, `/iago-quick`,
`/subagent-driven-development --pipeline`, plus the rules in `execution-pipeline.md` and
`available-skills.md`. CI: `claude.yml`, `claude-review-fix.yml` (keep — async loop is
separate). Any rebuild must re-point the three skills and rewrite the pipeline rule.

## Recommendation

**Staged. Phase A now, Phase B deliberately.**

Do the surgical fix today: auto-retry transient errors + adaptive turn budget. It removes
both failure modes you hit and ~80% of the nursing for ~5% of the cost — and it unblocks
Sentria immediately. Then do the Workflow rebuild as its own scoped effort when you're not
shipping under pressure, with Phase A already relieving the pain. Big-bang-rewriting core
infra mid-ship is the reckless move; sequencing it is not a compromise on the "build the
ocean" standard — Phase B still ships whole.
