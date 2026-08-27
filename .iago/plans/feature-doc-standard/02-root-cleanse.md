---
phase: feature-doc-standard
plan: 02
wave: 2
depends_on: [01]
context: .iago/plans/feature-doc-standard/README.md
created: 2026-08-26
revised: 2026-08-26
source: feature
---

# Plan: feature-doc-standard/02-root-cleanse

## Goal

Bring `iago-os/.iago/` and `docs/` to zero violations of the schema plan 01 wrote, so the repo that *defines* the standard is the first tree to satisfy it.

Most of this is `git mv`. The risk is not in the moves — it is in the **references left behind**: four shell scripts, two `settings.json` templates and the root `.gitignore` hardcode paths this plan changes, and three of them fail *silently* (a new client scaffolds with zero hooks; the learnings writer recreates a banned directory). Every task that moves a directory owns updating what points at it.

Evidence: `.iago/research/2026-08-26-doc-standard-audit.md` §3. Acceptance is `iago-lint.py check --root .` exiting 0 **and** a repo-wide stale-path grep returning 0.

## Prerequisite

`scripts/organize/` — and therefore `iago-lint.py` — exists only on `fix/session-capture-hooks` (**PR #104**, open). This plan's acceptance command is unevaluable from `main`. Run it stacked on that branch, or after #104 merges. State the base in the PR body.

## Commit granularity

**One commit per task.** Task 5 is atomic (move + all reference updates together) — a commit containing only the move leaves every session hookless. Without per-task commits, reverting one breakage also reverts ~40 harmless moves.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| rmdir | 6 empty `docs/` dirs + emptied parent | untracked; `git rm` errors on them |
| move | 6 superseded `docs/specs/*.md` | → `.iago/_archive/2026-08-v1-specs/` |
| move | 19 stale `.iago/plans/feature-*/` | → `.iago/plans/_archive/{YYYY-MM-slug}/` |
| merge | `.iago/plans/feature-pipeline-speed-wedges/` | into its archive twin — **not a duplicate** |
| modify | `.iago/research/` | 9 renames, 8 deletions, 3 archived-with-repoint |
| move | `.iago/{runbooks,context,decisions,learnings,prompts,handoff}/` | → `.iago/_config/` |
| move | `.iago/hooks/` → `.iago/_config/hooks/` | + 12 settings entries, 4 scripts, 2 templates |
| move | `.iago/reviews/` → `.iago/_archive/2026-08-pipeline-reviews/` | tracked, decision-bearing — **not** run scratch |
| move | `.iago/{logs,runs,pipeline-runs}/` | → `.iago/state/` |
| modify | root `.gitignore` | 4 rules go dead; needs the Bash-redirect bypass |

## Tasks

### Task 1: Clear the empty `docs/` scaffolding and archive the v1 specs
- **files:** `docs/`, `.iago/_archive/2026-08-v1-specs/`
- **action:** `rmdir` (not `git rm` — git tracks no empty dirs and errors on them) the 6 empty directories `docs/archive/{plans,research,specs}`, `docs/automations`, `docs/patterns`, `docs/research`, then `docs/archive` once emptied. `git mv` the six v1-era specs superseded by `docs/specs/iago-os-v2-vision.md` + `.iago/ROADMAP.md` — `iago-os-cleanup.md`, `iago-os-vision.md`, `iago-os-roadmap.md`, `parallel-execution-wedges.md`, `feature-tool-surveillance.md`, `hermes-agent-adoption.md` — into `.iago/_archive/2026-08-v1-specs/` with a `README.md` naming what superseded each.
- **verify:** `find docs -type d -empty | wc -l; ls docs/specs/*.md | wc -l; ls .iago/_archive/2026-08-v1-specs/ | wc -l`
- **expected:** `0` empty dirs; `5` specs remain (11 − 6); `7` files in the archive (6 + README).

### Task 2: Archive the shipped and stale plan folders — and merge, do not delete
- **files:** `.iago/plans/`, `.iago/ROADMAP.md`, `.iago/STATE.md`
- **action:** `git mv` these **19** folders into `.iago/plans/_archive/{YYYY-MM}-{slug}/` by their newest file's month: 2026-06 — `feature-gate-hardening`, `feature-pipeline-efficiency`, `feature-v2-phase-1-daemon`, `feature-v2-supervisor-role`, `feature-v2-shape2-langchain-home`, `feature-v2-per-agent-bots`, `feature-v2-dashboard-comms-kanban-tabs`, `feature-v2-agent-comms-channel`, `feature-pr84-r1-daemon-creds`, `feature-pr84-gap-closure`; 2026-05 — `feature-phase-1-deferred-hardening`, `feature-phase-1b-pipeline-tooling`, `feature-v2-foundation`, `feature-wedge-c-routines`, `feature-tool-surveillance`, `feature-iago-os-cleanup`; 2026-04 — `codex`, `feature-youtube-transcript-mcp`, `feature-audit`. `git rm -r` the genuinely empty `feature-lead-hunt-scrapling/` (0 files) and correct `STATE.md:31`, which still records it as planned.
  **`feature-pipeline-speed-wedges/` is NOT a duplicate** — `diff -rq` against `_archive/2026-04-pipeline-speed-wedges/` shows disjoint sets: the live folder holds `01-measurement-protocol.md` and `06-wedge-e-tsc-vite-parallel-build.md`; the archive holds `02`–`05`. **Merge** the live folder into the archive twin; deleting it destroys two plans. (`_deferred/` there is an empty directory — remove it, it is a W005, not an artifact.)
  Then repoint every archived-plan reference in `.iago/ROADMAP.md` — `:38` (`feature-v2-foundation/02-orphan-cleanup.md`), `:77-80` (four v2 folders), `:100`, `:121`.
  Finally, `.claude/rules/execution-pipeline.md` says **deferred ≠ superseded**: `feature-v2-supervisor-role`, `feature-v2-shape2-langchain-home` and `feature-v2-dashboard-comms-kanban-tabs` are forward Phase-3/4 work with no summaries. Either name what superseded each in the archive README, or leave those three live — do not archive them silently.
- **verify:** `ls -d .iago/plans/feature-* .iago/plans/codex 2>/dev/null | wc -l; ls .iago/plans/_archive/ | wc -l; ls .iago/plans/_archive/2026-04-pipeline-speed-wedges/ | wc -l; for p in $(grep -oE '\.iago/plans/[A-Za-z0-9._/-]+' .iago/ROADMAP.md | sort -u); do test -e "$p" || echo "DANGLING: $p"; done`
- **expected:** 6 live plan folders (the keep-list: `doc-standard`, `filesystem-order`, `skill-routing`, `caja-terminals`, `daemon-durability-hardening`, `phase-2-vps-bootstrap`) — this count assumes plan 01 Task 6 already archived the three `mwp-restructure` folders; `_archive/` holds 23 entries; the merged wedges folder holds 6 plans and no empty `_deferred/`; **no `DANGLING:` lines**.

### Task 3: Normalize `.iago/research/` without deleting a live source-of-record
- **files:** `.iago/research/`, `.iago/research/2026-06-13-deferred-backlog-index.md`
- **action:** Rename the 9 non-conforming files to `YYYY-MM-DD-{slug}.md` using the date in their name or their first-commit date: `_summary.md`, `codex-stall-diagnosis-2026-04-28.md`, `iago-os-adversarial-review-2026-05.md`, `munet-web-playbook.md`, `team-{1..5}-*.md`.
  **Do NOT delete `2026-06-13-daemon-durability-deferrals.md`** — all five files of `feature-daemon-durability-hardening/` cite it, that folder is on the keep-list, and `STATE.md:12` records it as awaiting `/iago-execute`. It is not closed.
  Delete `2026-04-28-mwp-restructure-audit.md` (superseded by the identically-slugged 2026-05-25 file), `2026-05-30-orphan-recovery-manifest.md`, `2026-05-30-plan-state-and-reorg-audit.md`, `2026-05-30-config-optimization-action-plan.md`, `2026-05-30-cc-config-optimization-audit.md`.
  Move `2026-05-28-pr84-gap-closure.md`, `2026-05-30-pr84-gate-findings-and-cutover-gates.md` and `2026-06-13-gate-hardening-backlog.md` to `.iago/_archive/` rather than deleting — `2026-06-13-deferred-backlog-index.md` cites all three and is itself kept (`STATE.md:3` calls it the canonical map of ~38 open items) — and repoint its links in the same commit.
- **verify:** `ls .iago/research/ | grep -vcE '^[0-9]{4}-[0-9]{2}-[0-9]{2}-'; ls .iago/research/*.md | wc -l; test -f .iago/research/2026-06-13-daemon-durability-deferrals.md && echo kept; for p in $(grep -oE '\.iago/research/[A-Za-z0-9._-]+\.md' .iago/research/2026-06-13-deferred-backlog-index.md .iago/plans/feature-daemon-durability-hardening/*.md | cut -d: -f2- | sort -u); do test -e "$p" || echo "DANGLING: $p"; done`
- **expected:** `0` non-conforming names; **37** files remain (46 − 5 deleted − 3 archived, +/- the renames); `kept`; **no `DANGLING:` lines**.

### Task 4: Consolidate the L3 dirs under `_config/` — and fix every consumer
- **files:** `.iago/{runbooks,context,decisions,learnings,prompts,handoff}/`, `scripts/lib/learnings-writer.sh`, `scripts/new-client.sh`, plus whatever the sweep finds
- **action:** `git mv` each into `.iago/_config/`: `runbooks/*` merges into the existing `_config/runbooks/` (2 files joining 5 — collision check confirmed clean), and `context/`, `decisions/`, `learnings/`, `prompts/` move as folders. Move `handoff/2026-05-17-workstream-a.md` into `_config/context/`.
  **Then sweep the whole repo, not just markdown.** The audit's original grep missed `.sh`, `.ps1`, `.py`, `.ts`, `.yml`, omitted `context`, and searched only top-level `.iago/*.md`. The consequential hit is `scripts/lib/learnings-writer.sh:70` — `local learnings_dir="$proj/.iago/learnings"` — the production writer the pipeline's learnings stage calls: post-move it `mkdir -p`s a fresh `.iago/learnings/`, silently recreating a banned root dir and re-failing the linter this plan exists to satisfy. Also `scripts/new-client.sh:121,124` (`mkdir -p .iago/context` and `.iago/reviews` — scaffolds banned dirs into every new client), `scripts/measure-build-gate-rss.sh:11`, `runtime/agent-runtime/types.ts:6,18`, `.iago/_config/architecture.md`, `.iago/_config/runbooks/automations/trigger-templates.md` (live automation prompt bodies), `.iago/decisions/2026-05-18-phase-2-split-and-dispatch.md:112` (points at the `handoff/` file this task moves), several `SKILL.md` files, and both `templates/*/CLAUDE.md.template` + `.iago/CONTEXT.md.template`.
- **verify:** `ls .iago/ | grep -cE '^(runbooks|context|decisions|learnings|prompts|handoff)$'; rg -n '\.iago/(runbooks|context|decisions|learnings|prompts|handoff)/' -g '!node_modules' -g '!.git' -g '!**/_archive/**' -g '!**/feature-doc-standard/**' . | wc -l; bash scripts/lib/learnings-writer.test.sh; echo "lw_exit=$?"`
- **expected:** First `0`; the repo-wide sweep `0`; `lw_exit=0` — the learnings writer's own suite proves it writes to `_config/learnings/` and does not recreate `.iago/learnings/`.

### Task 5: Move the hooks — ONE atomic Bash call, or it crashes the session
- **files:** `.iago/hooks/`, `.claude/settings.json`, `.claude/settings.local.json`, `templates/{client,internal}-project/.claude/settings.json.template`, `scripts/{validate-hooks.sh,sync-skills.sh,new-client.sh,sync-skills.ps1}`, `.iago/plans/feature-skill-routing/02-triage-and-discovery.md`

> **This fix is inherited, not invented.** `feature-mwp-restructure-code/01-iago-physical-split.md` §"Stress-test BLOCK fix (C1+C3)" solved this exact move in May; plan 01 archives that folder, so read it before touching this task. **`safety-guard.mjs` and `commit-quality.mjs` are `PreToolUse` hooks matched on `Bash`** — they fire on *every* Bash call. The instant `git mv .iago/hooks …` lands, the next Bash invocation resolves them from a path that no longer exists → `MODULE_NOT_FOUND`. Splitting the move from its verify means **the verify itself is the call that breaks**, and `git revert` cannot repair a session already in that state.

- **action:** Do the whole thing in a **single Bash invocation** — not one tool call per step. `PreToolUse` fires once from the still-valid old path, the sequence runs, and the next call fires from the new path because `settings.json` was rewritten inside the same call. The call must: `git mv .iago/hooks .iago/_config/hooks` (its `lib/` rides along — all **8** `.mjs` use relative `./lib/*.mjs`, none uses `import.meta.url` or `__dirname`); rewrite **all 12** `.iago/hooks/` commands in `.claude/settings.json` (lines 8, 20, 25, 35, 40, 52, 62, 67, 72, 83, **94, 99** — the last two are the **`Stop` block**, `context-persistence.mjs stop` and `usage-tracker.mjs stop`, whose omission silently kills session digests and usage telemetry); rewrite the same 12 in **both** `templates/*/.claude/settings.json.template`; fix the four scripts that hardcode the path and fail silently — `scripts/validate-hooks.sh:4` (the hook validator validates nothing), `scripts/sync-skills.sh:106-107` (hook sync no-ops), `scripts/new-client.sh:95-97` (the `-d` guard goes false, so **every new client scaffolds with zero hooks, no error**), `scripts/sync-skills.ps1:126`; fix `.claude/skills/iago-init/SKILL.md:23`, `.iago/_config/architecture.md:43,46,108`, and `.iago/plans/feature-skill-routing/02-triage-and-discovery.md:58` (a **keep-list** plan left holding a dead path); run the smoke test; and **on any failure, `git mv .iago/_config/hooks .iago/hooks` back inside the same call**.
  Use a scripted sweep, not hand-enumeration — hand-enumeration is exactly how the two `Stop` entries were missed.
  **Correction to the May plan if you reuse its text:** it claims `.claude/settings.json` is config-protected and needs a `sed` bypass. It is **not** — `config-protection.mjs` blocks only `biome.json`, `tsconfig.json`, `.gitignore` and `Dockerfile`. (`.gitignore` *is* protected; that is Task 6's problem, not this one.) It also expects "≥9 `.mjs`"; there are 8.
  **Do not touch `scripts/hooks/*.py`** — an unrelated family, the session-capture hooks wired into `~/.claude/settings.json` by `scripts/setup-memory.sh:176`.
- **verify:** (inside the same atomic call) `grep -c "_config/hooks" .claude/settings.json; grep -c "\.iago/hooks" .claude/settings.local.json; rg -n '\.iago/hooks' -g '!node_modules' -g '!**/_archive/**' . | wc -l; for h in .iago/_config/hooks/*.mjs; do out=$(echo '{}' | node "$h" 2>&1); case "$out" in *MODULE_NOT_FOUND*|*"Cannot find module"*) echo "BROKEN $h";; esac; done; node -e "const j=JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));let n=0,bad=0;for(const k of Object.keys(j.hooks||{}))for(const m of j.hooks[k])for(const h of (m.hooks||[])){n++;const p=(h.command.match(/CLAUDE_PROJECT_DIR\/([^\"']+\.mjs)/)||[])[1];if(p&&!require('fs').existsSync(p))bad++;}console.log('entries='+n+' missing='+bad)"`
- **expected:** `12` in settings.json; `0` in settings.local.json (clean today — assert it stays so); repo-wide stale count `0`; **no `BROKEN` lines**; `entries=12 missing=0`. Capturing stderr matters — Node exits 1 on module-resolution failure indistinguishably from a hook's own non-zero code.
- **after:** `.claude/settings.json` is read at session start, so the session that ran this is still pointed at the old path and is effectively hookless (edits in that window are not auto-formatted — `feedback_format_hook_breaks_workflow_gates`). The real acceptance is a **fresh session**: restart, then confirm a `Stop`-hook artifact appears (a session digest is written, or `.iago/state/usage-log.jsonl` grows).

### Task 6: Separate the archive from the scratch — and update what reads them
- **files:** `.iago/{reviews,logs,runs,pipeline-runs,summaries}/`, `scripts/lib/learnings-writer.sh`, root `.gitignore`
- **action:** `.iago/reviews/` is **136 tracked, decision-bearing review documents**, one of them linked from `STATE.md:13` — not run scratch. `git mv` it to `.iago/_archive/2026-08-pipeline-reviews/`: that satisfies the banned-root-dir rule, keeps the files tracked and backed up, and avoids deleting 136 documents from the remote. (Moving them into gitignored `state/` would *not* untrack them — `.gitignore` has no effect on already-tracked paths — so the only way to make that "work" is `git rm --cached`, which contradicts this feature's own thesis.)
  Only three are genuinely ephemeral. `git mv .iago/runs .iago/state/runs` and `git mv .iago/logs .iago/state/logs` (10 and 1 tracked). `.iago/pipeline-runs/` has **0 tracked files** and `.iago/state/pipeline-runs/` already exists, so `git mv` fails and a plain `mv` would nest it — use `mv .iago/pipeline-runs/* .iago/state/pipeline-runs/ && rmdir .iago/pipeline-runs`.
  `git rm` the 9 `_dispatch-*.log` and 3 `_pr-body-*.md` in `summaries/` so it holds only `{plan-slug}.md`.
  **Then update the readers** — this task previously had no reference step at all. `scripts/lib/learnings-writer.sh:72` uses `.iago/logs` as its fallback dir (documented at `:16`) and would recreate the banned root dir; `scripts/lib/learnings-writer.test.sh:139` and `scripts/test-phase-1b-integration.sh:212,214,234` assert on `.iago/logs`. Root `.gitignore` lines `:27`, `:35-37`, `:42`, `:48` go dead — and `.gitignore` is in `config-protection.mjs`'s `BLOCKED_FILES` (unlike `settings.json`, which is not), so edit it with the Bash-redirect bypass, not Edit.
  Finally rescue what is buried in `state/`: `2026-05-10-orphan-playbook-recovery.md` duplicates `research/munet-web-playbook.md` — keep one, in `research/`, conformingly named; `phase-1-kickoff-prompt.md` → `_config/prompts/`; the six `pr-*.md`/`pr-*.txt` bodies and `costs.jsonl` (dead since 2026-04-12) → delete.
- **verify:** `ls .iago/ | grep -cE '^(reviews|logs|runs|pipeline-runs)$'; ls .iago/summaries/ | grep -cE '\.log$|^_pr-body'; git ls-files .iago/_archive/2026-08-pipeline-reviews | wc -l; bash scripts/lib/learnings-writer.test.sh; echo "lw=$?"; bash scripts/test-phase-1b-integration.sh; echo "p1b=$?"; rg -n '\.iago/(logs|runs|pipeline-runs|reviews)/' -g '!node_modules' -g '!**/_archive/**' . | wc -l`
- **expected:** First two `0`; **136** review files still tracked at their new path; `lw=0` and `p1b=0`; repo-wide stale count `0`.

### Task 7: Refresh the status docs and close the dead links
- **files:** `.iago/{STATE,ROADMAP,PROJECT}.md`, `.iago/plans/feature-filesystem-order/README.md`, `.inbox-domains.tsv`
- **action:** Set `STATE.md`'s `Updated:` to today, add rows for the 2026-08 filesystem work, the instruction audit and this feature, and correct the `:31` row that still lists `feature-lead-hunt-scrapling` as planned (keep the file ≤ 80 lines; overflow to `PROJECT.md`). In `ROADMAP.md` mark daemon-recovery-hardening shipped and repoint **both** occurrences (`:23` and `:65`) at `.iago/plans/_archive/2026-06-daemon-recovery-hardening/`. Add an `Updated:` line to `PROJECT.md`. Fix the one real dead link — `feature-filesystem-order/README.md:68` → `clients/palazuelos/.iago/research/2026-08-18-erp-dumps-in-downloads.md` (`:201` of the same file already has the correct path). Delete `.inbox-domains.tsv` (confirmed unreferenced repo-wide). Commit the **three** untracked research files, including this feature's own audit.
- **verify:** `grep -m1 "Updated:" .iago/STATE.md; awk 'END{print NR" lines"}' .iago/STATE.md; git status --porcelain | wc -l; grep -c "2026-08-18-downloads-client-data-exposure" .iago/plans/feature-filesystem-order/README.md`
- **expected:** `Updated:` is today; STATE.md ≤ 80 lines; working tree clean (`0`); the dead link count in that file is `0`.

## Verification

```bash
# The gate this whole plan exists to satisfy
python scripts/organize/iago-lint.py check --root . ; echo "lint=$?"          # 0

# No path in the repo points at something that moved
rg -n '\.iago/(hooks|runbooks|context|decisions|learnings|prompts|handoff|reviews|logs|runs|pipeline-runs)/' \
   -g '!node_modules' -g '!.git' -g '!**/_archive/**' -g '!**/feature-doc-standard/**' . | wc -l   # 0

# Hooks resolve, and the suites that read the moved trees still pass
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))" && echo settings-ok
for h in .iago/_config/hooks/*.mjs; do out=$(echo '{}' | node "$h" 2>&1); case "$out" in *"Cannot find module"*) echo "BROKEN $h";; esac; done
bash scripts/lib/learnings-writer.test.sh;      echo "lw=$?"                  # 0
bash scripts/test-phase-1b-integration.sh;      echo "p1b=$?"                 # 0
node scripts/validate-workflows.mjs;            echo "wf=$?"                  # 0

# Index accounting: nothing left the tracked tree unintentionally
git ls-files .iago | wc -l    # compare against the pre-plan count; every delta must be a named deletion

# Shape
ls .iago/    # CONTEXT PROJECT ROADMAP STATE config.json _archive _config plans research state summaries
find docs .iago -type d -empty | grep -v state | wc -l                        # 0
```

**Not** `npx tsc --noEmit` — there is no root `tsconfig.json`, so it prints the compiler help and exits 1 no matter what (same class as `reference_munet_typecheck_noop`). This plan touches no TypeScript.

## Preconditions before any destructive step

1. `diff -rq` proves any plan folder being deleted is a strict subset of its archive twin. **This is the check that catches `feature-pipeline-speed-wedges`**, whose two sets are disjoint.
2. Record `git ls-files .iago | wc -l` before starting; every file that leaves the index must map to a named deletion in a task.
3. No `git rm --cached` on `.iago/reviews/` — Task 6 archives them tracked instead.

## Rollback

Every task here is `git mv`/`git rm` on tracked files: `git revert` the offending commit, which is why one-commit-per-task matters.

Two caveats. **Task 5 is the only one that breaks the running session** — and it is atomic for that reason — and `git revert` does not repair it either, because settings are read at session start; restart after reverting. **Task 4 is the only one that breaks at runtime with no git symptom** — `learnings-writer.sh` would keep working while silently recreating `.iago/learnings/`, which is why its test suite is in the verify.

## Moved out of this plan

The `.worktrees/` prune is **not** here any more. It was the only irreversible action in an otherwise fully git-recoverable plan, it is unrelated to the doc schema, and `iago-lint.py` does not check it. Two corrections to the original framing, recorded so nobody repeats them: there are **6** worktrees, not 7; **none of the five non-`main` branches is merged** into `origin/main` (`+7`, `+5`, `+2`, `+2`, `+1` commits), so they must never be followed with `git branch -d`; and `.worktrees/caja-exec` is **dirty** with untracked plan files — verified byte-identical to content already committed at `01aa9ee`, so `--force` would not have lost unique work here, but the precondition (`git status --porcelain` empty per worktree, never `--force`) belongs in whatever finally does the prune. `.claude/worktrees/agent-a814c32f/` is not a registered worktree at all and needs `prune` + `rm -rf`, not `worktree remove`.

## Stress Test

**Verdict:** BLOCK on the 2026-08-26 draft → **PROCEED** after revision (this file).
**Date:** 2026-08-26 · analyst (opus), read-only, every count re-measured against disk.

The most valuable of the three reviews. Three findings were latent data loss, not wording.

**Data loss averted**
- *Critical — `feature-pipeline-speed-wedges/` is not a duplicate.* `diff -rq` against `_archive/2026-04-pipeline-speed-wedges/` shows **disjoint** sets: live holds `01-measurement-protocol.md`, `06-wedge-e-tsc-vite-parallel-build.md` and `_deferred/`; the archive holds `02`–`05`. The Files table asserted "duplicate", which would have carried an implementer straight past the confirm-identical guard. **Fixed:** merge, never delete — and a `diff -rq` subset proof is now a stated precondition.
- *Critical — the delete list included the source-of-record for the next queued plan.* `research/2026-06-13-daemon-durability-deferrals.md` is cited by all five files of `feature-daemon-durability-hardening/`, which is on the keep-list and which `STATE.md:12` records as awaiting `/iago-execute`. Three more delete-list files are cited by `2026-06-13-deferred-backlog-index.md`, itself kept and called canonical by `STATE.md:3`. **Fixed:** the deferrals file is kept; the other three are archived with their citations repointed in the same commit.
- *Critical — `.worktrees/caja-exec` is dirty*, holding untracked `feature-caja-terminals/` (on the keep-list) and `quick-260708-…md`, and `--force` would delete them. **Verified independently:** both are byte-identical to content already committed at `01aa9ee`, so no unique work was at risk here. **Fixed anyway:** the prune is removed from this plan entirely (it was its only irreversible step), with the precondition written down for whoever runs it.

**Critical — mechanism errors**
- *`git mv` into a gitignored path does not untrack anything.* `.gitignore` has no effect on tracked paths: `reviews/` (136), `runs/` (10), `logs/` (1) would all stay tracked under `state/`, and the only way to satisfy the old verify was `git rm --cached` on 147 files — deleting 136 decision-bearing review documents, one of them linked from `STATE.md:13`, from the remote. That contradicts this feature's own thesis. **Fixed by adopting the reviewer's S3:** `reviews/` goes to `_archive/2026-08-pipeline-reviews/` and stays tracked; only `logs/`, `runs/`, `pipeline-runs/` move to `state/`.
- *`.claude/settings.json` has **12** hook entries, not 10.* The omitted two are the **`Stop` block** (`context-persistence.mjs stop`, `usage-tracker.mjs stop`) — session digests and usage telemetry would have died silently, and the old verify expecting `10` would have read a *correct* 12-entry rewrite as failure. **Fixed** in the action, the verify, and with a shape check that every hook command resolves to an existing file.
- *Four scripts hardcode `.iago/hooks`; three fail silently.* `validate-hooks.sh:4` (the validator validates nothing), `sync-skills.sh:106-107` (hook sync no-ops), `new-client.sh:95-97` (**every new client scaffolds with zero hooks, no error**). Plus both `templates/*/.claude/settings.json.template` carry the same 12 stale paths and were in neither plan's scope. **All added to Task 5.**
- *`.iago/pipeline-runs/` collides with the existing `.iago/state/pipeline-runs/`* and has 0 tracked files, so `git mv` errors and plain `mv` nests it. **Fixed** with the explicit per-directory sequence.
- *The acceptance command lives on an unmerged branch.* `scripts/organize/` exists only on `fix/session-capture-hooks` (now PR #104), so from `main` every criterion is unevaluable. **Fixed:** a Prerequisite section names the base.

**Important — silent runtime breakage**
- *`scripts/lib/learnings-writer.sh:70,72`* hardcodes `.iago/learnings` and `.iago/logs`. Post-move the production learnings writer would `mkdir -p` a fresh `.iago/learnings/` — **silently recreating a banned root dir and re-failing the very linter this plan exists to satisfy** — with no git symptom. Its own test suite and `test-phase-1b-integration.sh` assert on `.iago/logs` and would go red later, in CI, not here. **Fixed:** both suites are now in the verify, and Task 7 gained the reference-update step it never had.
- *The old reference grep could not find any of this* — no `.sh`/`.ps1`/`.py`/`.ts`/`.yml`, `context` missing from the alternation, `.iago/*.md` matching only the top level, and `templates/`/`runtime/`/`docs/`/`.github/` outside the search roots. **Fixed:** a single repo-wide `rg` expected to return 0, in both Task 4 and Task 7 and again in the Verification block.
- *Root `.gitignore` rules `:27,:35-37,:42,:48` go dead* at the moment those dirs move — and `.gitignore` is in `config-protection.mjs`'s `BLOCKED_FILES` (unlike `settings.json`, which is not), so it needs the Bash-redirect bypass. **Both noted in Task 7.**
- *`ROADMAP.md` names ≥5 archived folders as live* (`:38`, `:77-80`, `:100`, `:121`) and daemon-recovery-hardening appears **twice** (`:23`, `:65`) where the task said "its link", singular. **Fixed:** a generic dangling-path loop replaces the single-link edit.
- *Archiving never-executed plans contradicts `execution-pipeline.md`'s own "deferred ≠ superseded"* for three forward Phase-3/4 folders. **Fixed:** name the superseder or leave them live.
- *The hook smoke test discarded stderr*, so it could not detect the failure it was written to detect; and Claude Code reads settings at session start, so the running session stays hookless until restart and an edit-and-revert test cannot pass. **Both fixed**, with a fresh-session confirmation as the real acceptance.

**Counts corrected against disk:** 19 enumerated stale folders (not 22); `_archive/` ends at 23 (not "25+"); 46 research files (not 45), 37 remaining (not 27); 6 worktrees (not 7), none of the five branches merged; 12 settings entries (not 10); the empty `docs/` dirs are untracked so `rmdir`, not `git rm`. Runbook collision check came back clean as claimed.

**Removed:** `npx tsc --noEmit` — there is no root `tsconfig.json`, so it prints the compiler help and exits 1 regardless (`reference_munet_typecheck_noop`). A separate `biome check .` run confirmed the other direction: 29,378 pre-existing errors across 11,078 files because a root run descends into the client inner repos (`feedback_subproject_format_hook`). Neither is a gate for a plan that touches no source.

**Adopted:** S1 (one commit per task, Task 5 atomic), S3 (`reviews/` archived, not demoted), S4 (worktree prune removed). **Not adopted:** S2's `perl -pi` sweep as the *only* mechanism — the plan asks for a scripted sweep but keeps the enumerated line numbers so the implementer can verify the sweep hit everything.

### Addendum — a tenth Critical, arriving last and mattering most

**The hooks move would have crashed the session, and the fix already existed.**

`safety-guard.mjs` and `commit-quality.mjs` are registered as **`PreToolUse` hooks matched on `Bash`** — verified in `.claude/settings.json`. They fire on *every* Bash invocation. The instant `git mv .iago/hooks .iago/_config/hooks` lands, the next Bash call resolves them from a deleted path → `MODULE_NOT_FOUND`. The draft split the move (Task 5) from its smoke test (Task 6), which meant **Task 5's own verify was the call that would break**, and the Rollback's `git revert` cannot repair a session already in that state.

`feature-mwp-restructure-code/01-iago-physical-split.md` §"Stress-test BLOCK fix (C1+C3)" solved this in May: fuse move + settings rewrite + verify into **one atomic Bash call**, so `PreToolUse` fires once from the still-valid old path, the sequence completes, and the next call fires from the new path. It also carries an in-call `git mv` back on failure.

**Fixed:** Tasks 5 and 6 are now a single atomic task (8 tasks → 7) with the self-revert, and it cites the May plan as its source.

**Two corrections to that May plan, verified here and recorded so its text is not reused blind:**
- It claims `.claude/settings.json` is config-protected and needs a `sed` bypass. **It is not** — `config-protection.mjs:12-17` blocks only `biome.json`, `tsconfig.json`, `.gitignore` and `Dockerfile`. (`.gitignore` *is* protected, which is why Task 6's `.gitignore` edit needs the Bash-redirect bypass.)
- It expects "≥9 `.mjs`"; there are **8**.

**Also folded into Task 5:** `.iago/plans/feature-skill-routing/02-triage-and-discovery.md:58` references `.iago/hooks/context-persistence.mjs`. That plan is on this plan's **keep** list — a live, unexecuted plan that would be left holding a dead path. `.claude/settings.local.json` is clean today; the verify now asserts it stays clean.

**The meta-finding, worth stating plainly.** Plan 01 archives the three `feature-mwp-restructure-*` folders. `execution-pipeline.md` warns against *executing* an archived plan without re-stress-testing; the failure here is the mirror image — the *replacement* plan was written without inheriting the archived plan's stress-test fixes. An archive labelled "superseded" reads as "safe to ignore", and a hard-won fix inside it becomes invisible. Plan 01 Task 6 now requires the archive README to flag `01-iago-physical-split.md` as **carry-forward**, and this plan cites it directly.
