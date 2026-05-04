# Spec: Phase 1 cleanup — 5 highest-leverage items

**Status:** Draft for `/iago-plan`
**Date:** 2026-04-29
**Parent roadmap:** `docs/specs/iago-os-roadmap.md` (Phase 1 entry, Week 1, ~3 dev-days, one bundled PR)
**Selection criterion:** "blocks munet-web pipeline run OR blocks Sebas-on-Mac." Other items defer to Week 6 buffer or beyond.

---

## Why these 5 (and not the other 8)

The roadmap names three concrete blockers — *Sebas Mac dead-stop*, *FAIL-regex parser*, *STATE.md truncation* — and treats branch hygiene, embedded git repo, log artifacts, etc. as opportunistic.

Phase 0 already shipped two of the three named blockers:

| Roadmap blocker | Status |
|---|---|
| Sebas Mac dead-stop (`timeout` not on PATH) | DONE — PR #27 (auto-detect `timeout` / `gtimeout`) + PR #29 (CLAUDE.md prereq note) |
| FAIL-regex per-line parser | DONE — PR #21 (repair FAIL-detection regex) |
| STATE.md truncation / digest discipline | OPEN — picked up here as Item 1 |

That leaves 1 named blocker + 4 picks from the opportunistic pool. Selection biases to (a) reduce ongoing friction in every pipeline run, and (b) de-risk Sebas's first end-to-end pipeline run on a Mac (the `timeout` shim alone is necessary but not sufficient).

---

## The 5 items

### Item 1 — STATE.md digest discipline

**Problem.** `Updated: 2026-04-13` in the header but the latest tabular entry is 2026-04-28. The Active section also says "No active plans. Audit phase complete." while the roadmap, Phase 0, and the Active table itself contradict that. The file is 75 lines (under the 80 cap, OK), so the issue is freshness, not length.

**Why it matters.** The orchestrator reads STATE.md at session start as the canonical project digest. A stale header signals to humans (and to the model, when it weighs digest vs. recent commits) that the file is unreliable, undermining its purpose.

**Fix.**
1. Refresh `Updated:` to today and remove the contradictory "No active plans. Audit phase complete." line; replace with a one-line current-phase pointer.
2. Add a section "Update protocol" inside `.claude/rules/git-workflow.md` (or a new `.claude/rules/state-discipline.md` if it grows): every PR merge bumps the STATE.md `Updated:` field and appends one Active-table row. The `/iago-execute` summary step (#6) already writes to `.iago/summaries/` — extend it to also append the row + bump the timestamp.
3. Sanity grep in pipeline post-merge: STATE.md `Updated:` date must be ≥ `git log -1 --format=%cs` on main minus 7 days. Warn if older.

**Acceptance.**
- `head -5 .iago/STATE.md` shows today's date as `Updated:`.
- The Active section is internally consistent with the table below it.
- `.claude/rules/` documents the bump protocol; one pipeline summary or pre-merge hook references it.

**Out of scope.** Restructuring the file, splitting to PROJECT.md, or full STATE.md schema redesign. That's plan-level surgery, not cleanup.

---

### Item 2 — Local branch hygiene

**Problem.** `git branch` shows ~24 local branches; the majority correspond to merged PRs (#11–#29). Branch enumeration in tooling, terminal completion, and worktree creation all carry this dead weight.

**Why it matters.** `feedback_worktree_per_session` mandates worktrees for parallel sessions; every worktree create runs `git branch` matching, and stale branches inflate the candidate set. Also: when an operator types `git checkout fix/<tab>`, completion noise raises the chance of checking out the wrong stale branch.

**Fix.**
1. One-shot prune: delete every local branch whose tip is reachable from `origin/main` AND whose tracking remote is gone (`git branch --merged origin/main` filtered against `git branch -vv | grep ': gone\]'`). Spell out the exact `git branch -d` list in the PR — no wildcard sweep.
2. Document in `.claude/rules/git-workflow.md` "Post-merge cleanup" — the operator runs the prune snippet after each squash merge. Optional: add a `scripts/prune-merged.sh` helper that prints the list and asks for confirmation (no `-D`, no force).
3. Out-of-scope branches (`wip/*`, branches with uncommitted local-only work) are explicitly excluded from the sweep — list them in the PR description as "kept for inspection."

**Acceptance.**
- `git branch | wc -l` ≤ 8 after merge (main + active wips + at most one in-flight feature).
- `.claude/rules/git-workflow.md` documents the post-merge prune.
- No `wip/*` or feature branch with local-only commits is deleted.

**Out of scope.** Remote branch pruning (`git push origin --delete`) — the GitHub squash-merge UI already deletes the source branch on merge, and an out-of-band prune risks racing with in-flight CI.

---

### Item 3 — Deferred plan disposition

**Problem.** `.iago/plans/feature-pipeline-speed-wedges/_deferred/` contains 4 plan files (02 wedge-a-plus, 03 wedge-b multi-plan parallel BLOCKED, 04 wedge-c concurrent-preflight, 05 wedge-d review-codex-concurrent). The canonical roadmap (`docs/specs/iago-os-roadmap.md`) supersedes them — Wave 1 and Wave 2 use a different wedge alphabet (J, B, C, K, H, D) tied to client triggers, not these. The deferred files now have no path to execution and create search-result noise when the orchestrator looks for plans.

**Why it matters.** `/iago-execute` and `/iago-plan` enumerate `.iago/plans/` for context. Stale plans in `_deferred/` show up in greps and risk being pulled forward without re-stress-testing against the new roadmap.

**Fix.**
1. Create `.iago/plans/_archive/2026-04-pipeline-speed-wedges/` (sibling to `_deferred/`, unambiguous "do not execute").
2. Move the 4 deferred files into `_archive/`, prepending each with a one-line header: `> ARCHIVED 2026-04-29 — superseded by docs/specs/iago-os-roadmap.md (Wave {1,2} {wedge}).`
3. Delete the now-empty `_deferred/` directory.
4. Add one sentence to `.claude/rules/execution-pipeline.md` (or wherever `_deferred/` is documented, if anywhere): "Plans superseded by a canonical roadmap move to `.iago/plans/_archive/{YYYY-MM-{slug}}/` with a roadmap pointer at the top."

**Acceptance.**
- `_deferred/` no longer exists under `feature-pipeline-speed-wedges/`.
- `_archive/2026-04-pipeline-speed-wedges/` contains the 4 files, each with a roadmap-pointer header.
- The folder convention is documented in one place.

**Out of scope.** Deciding cycle-2 reactivation triggers for these specific wedges — the canonical roadmap already lists triggers for what's deferred (F, L, G, etc.); these 4 files don't map to deferred wedges, they map to execution patterns the roadmap dropped entirely.

---

### Item 4 — macOS portability sweep beyond `timeout`

**Problem.** PR #27 fixed the `timeout` blocker, but `scripts/execute-pipeline.sh` and helpers contain other GNU-coreutils-isms that *might* bite Sebas's first pipeline run on Mac: `sed -i`, `readlink -f`, `grep -P`, `sort -V` (already inline-mitigated at line 669), `date -d`, `xargs -r`, `stat -c`, `cp --reflink`.

**Why it matters — but only just.** Sebas has not yet attempted a pipeline run on Mac. Per `feedback_diagnose_before_fix`, we don't patch symptoms before reproducing the failure. The original draft of this item proposed a shim library + test harness; the council Simplicity reviewer correctly flagged that as premature engineering. Replaced with the minimum that surfaces the real surface area without over-investing.

**Fix (minimized).**
1. Audit `scripts/`, `scripts/lib/`, and `.claude/hooks/` for the listed patterns. Capture inventory as `path:line:pattern` to a gitignored audit file under `.iago/state/` AND embed the same table in the PR description (the file is for re-audit; the PR table is for review).
2. For every hit, add an inline comment `# GNU-only — Mac path requires brew coreutils per CLAUDE.md prereq` immediately above the call. No shims, no test harness, no `scripts/lib/portable.sh`.
3. Extend `CLAUDE.md` Prerequisites to enumerate the specific `g`-prefixed binaries `brew install coreutils` provides that the pipeline depends on (`gsed`, `greadlink`, `gsort`, `gdate`, `gstat`, `gxargs` as the audit reveals). Sebas's first failure should give him a name he can map back to the prereq.

**Acceptance.**
- Audit file exists with at least one entry; PR description embeds the same table.
- Every audited call site has the inline comment immediately above it.
- `CLAUDE.md` Prerequisites section names every `g`-prefixed binary the audit found at least one call for.

**What this trades.** Real shims are deferred to Sebas's first reproducible failure. If that failure ever happens, the audit file + inline comments tell the next implementer exactly where to add shims; Item 4 in a future cleanup phase becomes "shim the call sites that actually fired" instead of "shim everything that *might* fire."

**Out of scope.** Shim libraries, OS-detect helpers, portability test harness, CI matrix runs on macOS — all deferred until reproduction.

---

### Item 5 — `.iago/state/` purpose + gitignore audit

**Problem.** `.iago/state/` already accumulates run artifacts: `pipeline-wedge-06.log` (top-level), `state/exposicion-run/*.log`, `state/pipeline-logs/combustibles-*.log`. `.gitignore` covers `.iago/state/` and `.iago/pipeline-*.log` — but the boundary is implicit. A future contributor may add a "useful" file to `.iago/state/` and have it silently ignored, or split run artifacts to a sibling path that escapes the ignore.

**Why it matters.** Pipeline runs leave artifacts; if any artifact carries cross-session signal (e.g., the next run's input depends on the previous run's output), an ignored path silently drops it. Conversely, if an operator commits something to `.iago/state/` thinking it's tracked, the commit will look successful locally but be invisible to others.

**Fix.**
1. Add a `.iago/state/README.md` that names the directory's purpose: "Per-machine, per-run pipeline artifacts. Always gitignored. Anything cross-session must live in `.iago/summaries/` or `.iago/learnings/`."
2. Verify `.gitignore` coverage with `git check-ignore -v` against each existing file under `.iago/state/`. Document the verification command in the README.
3. Audit `scripts/execute-pipeline.sh` and helpers for any write to `.iago/` that bypasses `state/`. Confirm only `.iago/state/`, `.iago/summaries/`, `.iago/learnings/`, and explicit log paths under `.iago/state/` are written. Output the audit list in the PR.

**Acceptance.**
- `.iago/state/README.md` exists with the purpose statement and the `git check-ignore` verification command.
- `git check-ignore -v` passes against every file currently under `.iago/state/`.
- The PR description lists every `.iago/` write site in `scripts/` with confirmation it routes correctly.

**Out of scope.** Restructuring `.iago/` to consolidate state under a single subdirectory. The current layout (`state/`, `summaries/`, `learnings/`, `reviews/`, etc.) is intentional per CLAUDE.md "Memory Architecture."

---

## Cross-cutting

**One bundled PR.** Per `feedback_stack_prs` and the roadmap's explicit "one bundled PR" instruction, all 5 items ship together. PR title: `chore: phase 1 cleanup — 5 hygiene items per canonical roadmap`. Each item is one commit on the same branch.

**Blast radius.**
- Item 1 (STATE.md): repo-only, no runtime change.
- Item 2 (branches): local-only, no remote effect, no runtime change.
- Item 3 (plan archive): `.iago/plans/` reorganization, no script reads `_deferred/` directly.
- Item 4 (macOS audit): inline comments + CLAUDE.md additions only — no executable code path touched after the minimization.
- Item 5 (.iago/state/ docs): documentation + audit, no behavior change.

All five items are doc/reorg / inline-comment work. None touches executable code paths. Build gate is informational, not blocking.

**Effort estimate (revised).** Roadmap budgeted 3 dev-days. Per-item after minimization: 1 (0.25d) + 2 (0.25d) + 3 (0.25d) + 4 (0.5d) + 5 (0.5d) = ~1.75d. Inside budget with margin.

**Rollback.** Revert the PR. No external state, no remote API, no client-visible surface.

---

## What this spec replaces

Nothing — this is a new artifact. The roadmap (`docs/specs/iago-os-roadmap.md`) named `docs/specs/iago-os-cleanup.md` _(to be created)_ as a Phase 1 deliverable; this is that file.

## Sources

- `docs/specs/iago-os-roadmap.md` — Phase 1 sequencing, 5-item cap, selection criterion
- `.iago/research/team-5-internal.md` — original 6-item mess list
- `.iago/STATE.md` — stale-timestamp evidence
- `git branch` output 2026-04-29 — 24 local branches, ~21 stale
- `.iago/plans/feature-pipeline-speed-wedges/_deferred/` directory listing
- `.gitignore` — current coverage of `.iago/state/` and client subtrees
- `scripts/execute-pipeline.sh:669` — existing GNU-only flag with fallback comment
- `feedback_stack_prs`, `feedback_worktree_per_session`, `feedback_diagnose_before_fix` — guide constraints
