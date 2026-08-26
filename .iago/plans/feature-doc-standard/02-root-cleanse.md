---
phase: feature-doc-standard
plan: 02
wave: 2
depends_on: [01]
context: .iago/plans/feature-doc-standard/README.md
created: 2026-08-26
source: feature
---

# Plan: feature-doc-standard/02-root-cleanse

# Goal

Bring `iago-os/.iago/` and `docs/` to zero violations of the schema plan 01 wrote, so the repo that *defines* the standard is the first tree to satisfy it. Almost every task is `git mv` / `git rm`; the one task with real risk is the hooks move, which breaks every session hook if its `settings.json` update is not in the same commit.

Evidence and the reasoning behind each deletion: `.iago/research/2026-08-26-doc-standard-audit.md` §3. Acceptance for the whole plan is `python scripts/organize/iago-lint.py check --root .` exiting 0.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| delete | `docs/{archive/{plans,research,specs},archive,automations,patterns,research}` | 6 empty dirs + the emptied parent |
| move | 6 superseded `docs/specs/*.md` | → `.iago/_archive/2026-08-v1-specs/` |
| move | 22 stale `.iago/plans/feature-*/` | → `.iago/plans/_archive/{YYYY-MM-slug}/` |
| delete | `.iago/plans/feature-lead-hunt-scrapling/`, `.iago/plans/feature-pipeline-speed-wedges/` | empty dir; duplicate of an existing archive entry |
| modify | `.iago/research/` | 9 renames, ~10 deletions |
| move | `.iago/{runbooks,context,decisions,learnings,prompts,handoff}/` | → `.iago/_config/` |
| move | `.iago/hooks/` → `.iago/_config/hooks/` | + all 10 `settings.json` paths, same commit |
| move | `.iago/{reviews,logs,runs,pipeline-runs}/` | → `.iago/state/` (gitignored) |
| modify | `.iago/{STATE,ROADMAP,PROJECT}.md` | dates + two broken links |

## Tasks

### Task 1: Clear the empty `docs/` scaffolding and archive the v1 specs
- **files:** `docs/`, `.iago/_archive/2026-08-v1-specs/`
- **action:** Remove the 6 empty directories `docs/archive/{plans,research,specs}`, `docs/automations`, `docs/patterns`, `docs/research`, then `docs/archive` itself once emptied. `git mv` the six v1-era specs superseded by `docs/specs/iago-os-v2-vision.md` + `.iago/ROADMAP.md` — `iago-os-cleanup.md`, `iago-os-vision.md`, `iago-os-roadmap.md`, `parallel-execution-wedges.md`, `feature-tool-surveillance.md`, `hermes-agent-adoption.md` — into `.iago/_archive/2026-08-v1-specs/` with a `README.md` naming what superseded them.
- **verify:** `find docs -type d -empty | wc -l; ls docs/specs/*.md | wc -l; ls .iago/_archive/2026-08-v1-specs/`
- **expected:** `0` empty dirs; 5 specs left in `docs/specs/`; the archive lists the 6 moved files plus `README.md`.

### Task 2: Archive the shipped and stale plan folders
- **files:** `.iago/plans/`
- **action:** `git mv` each of these 22 folders into `.iago/plans/_archive/{YYYY-MM}-{slug}/` using its newest file's month: `feature-gate-hardening`, `feature-pipeline-efficiency` (2026-06); `feature-v2-phase-1-daemon`, `feature-v2-supervisor-role`, `feature-v2-shape2-langchain-home`, `feature-v2-per-agent-bots`, `feature-v2-dashboard-comms-kanban-tabs`, `feature-v2-agent-comms-channel`, `feature-pr84-r1-daemon-creds`, `feature-pr84-gap-closure` (2026-06); `feature-phase-1-deferred-hardening`, `feature-phase-1b-pipeline-tooling`, `feature-v2-foundation`, `feature-wedge-c-routines` (2026-05); `feature-tool-surveillance`, `feature-iago-os-cleanup` (2026-05); `codex`, `feature-youtube-transcript-mcp` (2026-04); `feature-audit` (2026-04). Then `git rm -r` the empty `feature-lead-hunt-scrapling/` and `feature-pipeline-speed-wedges/` (already archived at `_archive/2026-04-pipeline-speed-wedges/` — confirm identical before deleting). **Keep unarchived:** `feature-doc-standard`, `feature-filesystem-order`, `feature-skill-routing`, `feature-caja-terminals`, `feature-daemon-durability-hardening`, `feature-phase-2-vps-bootstrap`.
- **verify:** `ls -d .iago/plans/feature-* .iago/plans/codex 2>/dev/null | wc -l; ls .iago/plans/_archive/ | wc -l`
- **expected:** 6 live plan folders remain (the keep-list); `_archive/` holds 25+ entries.

### Task 3: Normalize and prune `.iago/research/`
- **files:** `.iago/research/`
- **action:** Rename the 9 non-conforming files to `YYYY-MM-DD-{slug}.md` using the date in their name or their `git log` first-commit date: `_summary.md`, `codex-stall-diagnosis-2026-04-28.md`, `iago-os-adversarial-review-2026-05.md`, `munet-web-playbook.md`, `team-{1..5}-*.md`. Delete `2026-04-28-mwp-restructure-audit.md` (superseded by the 2026-05-25 file of the same slug) and the shipped-subject files `2026-05-28-pr84-gap-closure.md`, `2026-05-30-pr84-gate-findings-and-cutover-gates.md`, `2026-06-13-gate-hardening-backlog.md`, `2026-06-13-daemon-durability-deferrals.md`, `2026-05-30-orphan-recovery-manifest.md`, `2026-05-30-plan-state-and-reorg-audit.md`, `2026-05-30-config-optimization-action-plan.md`, `2026-05-30-cc-config-optimization-audit.md` — first confirming each is closed per `.iago/STATE.md` or the 2026-08-10 instruction audit, and moving to `.iago/_archive/` instead of deleting any that still carry an unshipped decision.
- **verify:** `ls .iago/research/ | grep -vcE '^[0-9]{4}-[0-9]{2}-[0-9]{2}-'; ls .iago/research/*.md | wc -l`
- **expected:** `0` non-conforming names; roughly 27 files remain (from 45).

### Task 4: Consolidate the L3 reference dirs under `_config/`
- **files:** `.iago/{runbooks,context,decisions,learnings,prompts,handoff}/`
- **action:** `git mv` each into `.iago/_config/`: `runbooks/*` merges into the existing `_config/runbooks/` (2 files joining 4 — no name collisions, verify first), and `context/`, `decisions/`, `learnings/`, `prompts/` move as folders. Move `handoff/2026-05-17-workstream-a.md` to `_config/context/`. Then update every reference to the old paths across `.claude/`, `scripts/`, `CLAUDE.md` and `.iago/*.md` — enumerate them with `grep -rn` before moving, not after.
- **verify:** `ls .iago/ | grep -cE '^(runbooks|context|decisions|learnings|prompts|handoff)$'; ls .iago/_config/; grep -rn "\.iago/\(runbooks\|decisions\|learnings\|prompts\|handoff\)/" --include="*.md" --include="*.js" --include="*.mjs" --include="*.json" .claude scripts CLAUDE.md .iago/*.md | wc -l`
- **expected:** First prints `0`; `_config/` lists `context decisions hooks learnings prompts runbooks review-checks?`; the stale-reference grep prints `0`.

### Task 5: Move the hooks and repoint `settings.json` in the same commit
- **files:** `.iago/hooks/`, `.claude/settings.json`
- **action:** `git mv .iago/hooks .iago/_config/hooks` (including its `lib/` subdir), then update **all 10** `"command"` entries in `.claude/settings.json` from `$CLAUDE_PROJECT_DIR/.iago/hooks/` to `$CLAUDE_PROJECT_DIR/.iago/_config/hooks/` — `context-persistence.mjs` (session-start and pre-compact), `safety-guard.mjs` (×2), `commit-quality.mjs`, `config-protection.mjs`, `usage-tracker.mjs`, `post-edit-format.mjs`, `post-edit-typecheck.mjs`, `post-edit-console-warn.mjs`. Also grep the hook sources for sibling requires of `./lib/`. Stage both the move and the settings edit as one commit — a commit with only the move leaves every session hookless.
- **verify:** `grep -c "_config/hooks" .claude/settings.json; grep -c "\.iago/hooks/" .claude/settings.json; node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));console.log('settings.json parses')"; ls .iago/_config/hooks/`
- **expected:** `10` references to the new path, `0` to the old; settings.json parses; the hooks directory lists all 8 `.mjs` files plus `lib/`.

### Task 6: Smoke-test the hook chain before continuing
- **files:** `.iago/_config/hooks/`
- **action:** Confirm the chain still fires after the move: run each hook's entry directly with a minimal stdin payload (e.g. `echo '{}' | node .iago/_config/hooks/safety-guard.mjs`) and confirm none throws `MODULE_NOT_FOUND`, then edit and revert a scratch file to confirm the PostToolUse format hook runs. If any hook resolves a path relative to `.iago/hooks/`, fix it here rather than deferring.
- **verify:** `for h in .iago/_config/hooks/*.mjs; do printf '%s ' "$(basename $h)"; echo '{}' | node "$h" >/dev/null 2>&1; echo "exit=$?"; done`
- **expected:** Every hook exits 0 or with its own defined non-zero code; none reports `MODULE_NOT_FOUND` or `Cannot find module`.

### Task 7: Demote run artifacts into gitignored `state/`
- **files:** `.iago/{reviews,logs,runs,pipeline-runs,summaries,state}/`
- **action:** `git mv` `reviews/`, `logs/`, `runs/` and `pipeline-runs/` under `.iago/state/`, and `git rm` the 9 `_dispatch-*.log` and 3 `_pr-body-*.md` files in `summaries/` so it holds only `{plan-slug}.md`. Confirm `.iago/.gitignore` covers `state/` so the moved trees leave the index. Then rescue the decision-bearing docs currently buried in `state/`: `2026-05-10-orphan-playbook-recovery.md` is a duplicate of `research/munet-web-playbook.md` — keep one, in `research/`, under a conforming name; move `phase-1-kickoff-prompt.md` to `_config/prompts/`; delete `costs.jsonl` (dead since 2026-04-12, superseded by `usage-log.jsonl`) and the loose `commit-msg-*.txt`, `*.path` and `macos-portability-audit-*.txt` scratch.
- **verify:** `ls .iago/ | grep -cE '^(reviews|logs|runs|pipeline-runs)$'; ls .iago/summaries/ | grep -cE '\.log$|^_pr-body'; git ls-files .iago/state | wc -l; find .iago/state -name "*.md" -size +4k | wc -l`
- **expected:** First two print `0`; `state/` contributes 0 tracked files; no `.md` over 4 KB left under `state/`.

### Task 8: Refresh the status docs, fix the broken links, prune the worktrees
- **files:** `.iago/STATE.md`, `.iago/ROADMAP.md`, `.iago/PROJECT.md`, `.inbox-domains.tsv`
- **action:** Set `STATE.md`'s `Updated:` to today and add rows for the 2026-08 filesystem-order work, the instruction audit and this feature (keep it ≤ 80 lines, overflow to `PROJECT.md`); in `ROADMAP.md` mark daemon-recovery-hardening shipped and repoint its link at `.iago/plans/_archive/2026-06-daemon-recovery-hardening/`; add an `Updated:` line to `PROJECT.md`. Fix `feature-filesystem-order/README.md`'s dead link to `research/2026-08-18-downloads-client-data-exposure.md` by pointing it at the surviving `clients/palazuelos/.iago/research/2026-08-18-erp-dumps-in-downloads.md`. Delete the unreferenced `.inbox-domains.tsv`, commit the two untracked research files (`2026-08-19-gta6-money-plays.md`, `2026-08-24-onepager-prompts-sentria-fulldata.md`), and `git worktree remove` the 7 merged worktrees under `.worktrees/` plus the stale `.claude/worktrees/agent-a814c32f/`.
- **verify:** `grep -m1 "Updated:" .iago/STATE.md; awk 'END{print NR" lines"}' .iago/STATE.md; git worktree list | wc -l; git status --porcelain | wc -l; grep -rn "2026-08-18-downloads-client-data-exposure" .iago/ | wc -l`
- **expected:** `Updated:` is today's date; STATE.md ≤ 80 lines; `git worktree list` prints 1 (the main checkout); working tree clean; the dead-link grep prints `0`.

## Verification

```bash
python scripts/organize/iago-lint.py check --root . ; echo "lint exit=$?"   # -> 0
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))" && echo settings-ok
for h in .iago/_config/hooks/*.mjs; do echo '{}' | node "$h" >/dev/null 2>&1 || echo "HOOK BROKEN: $h"; done
ls .iago/                       # CONTEXT PROJECT ROADMAP STATE config.json _archive _config plans research state summaries
find docs .iago -type d -empty | grep -v state | wc -l                      # -> 0
git worktree list | wc -l                                                   # -> 1
npx tsc --noEmit && echo build-ok
```

**Expected:** lint exits 0, settings parse, no hook broken, `.iago/` matches the §2 schema exactly, no empty dirs outside `state/`, one worktree, build green.

## Rollback

The hooks move (Task 5) is the only step that can break the session itself. If hooks stop firing: `git revert` that single commit — the move and the `settings.json` edit are deliberately in one commit so the revert is atomic. Everything else in this plan is `git mv`/`git rm` under version control and recoverable with `git checkout HEAD~1 -- <path>`.
