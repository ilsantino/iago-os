---
phase: feature-iago-os-cleanup
plan: 01
wave: 1
depends_on: []
context: docs/specs/iago-os-cleanup.md
created: 2026-04-29
revised: 2026-05-04
source: feature
---

# Plan: feature-iago-os-cleanup/01-cleanup-hygiene

## Goal

All five items of the cleanup spec in one bundled PR — STATE.md digest discipline,
post-merge branch prune, deferred plan archive, `.iago/state/` purpose doc, and the
**minimized** macOS audit (inline comments + CLAUDE.md prereq extension, no shims).
Plan 02 was deleted after stress test; its scope collapsed into Task 7 here per the
spec's Item 4 minimization.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.iago/STATE.md` | Refresh `Updated:` + remove contradictory Active line |
| modify | `.claude/rules/git-workflow.md` | Document STATE.md bump + zsh-safe post-merge prune snippet |
| (delete) | local branches matching `: gone]` | Prune dead branches via `while read -r` (safe form); excludes `wip/*` and `pr-26` |
| move | `.iago/plans/feature-pipeline-speed-wedges/_deferred/*.md` → `.iago/plans/_archive/2026-04-pipeline-speed-wedges/` | Archive 4 superseded plans; idempotent prepend; empty-check before rmdir |
| modify | `.claude/rules/execution-pipeline.md` | Document `_archive/` convention + recognition heuristic |
| create | `.iago/state/README.md` | Document `state/` purpose + note that `_archive/` is tracked (not gitignored) |
| modify | (audited call sites in `scripts/`) | Add `# GNU-only — Mac path requires brew coreutils per CLAUDE.md prereq` comments |
| modify | `CLAUDE.md` | Extend Prerequisites with explicit `g`-prefixed binary list |

## Tasks

### Task 1: Refresh STATE.md header and Active section (idempotent, layout-agnostic)

- **files:** `.iago/STATE.md`
- **action:** Find the line beginning `> **Tag:**` and update its `Updated:` field to `2026-05-04` (do not rely on a hardcoded line number — STATE.md layout has shifted before). Update the `Phase:` field on the line beginning `> **Phase:**` to `phase-1-cleanup`. Replace the line "No active plans. Audit phase complete." in the Active section with "Phase 1 cleanup in flight per `docs/specs/iago-os-roadmap.md`." Add a final sentence to the same Active block: "Implementer of Plan 01 must remove this 'in flight' line and replace with a dated completion row in the Active table at merge time." This closes the digest-rot loop the council Consumer reviewer flagged.
- **verify:** `grep -E "Updated:.*2026-05-04" .iago/STATE.md && grep -F "Phase 1 cleanup in flight" .iago/STATE.md`
- **expected:** Both grep commands match (exit 0). Idempotent on re-run because the patterns are exact, not append-style.

### Task 2: Document STATE.md discipline + zsh-safe post-merge branch prune

- **files:** `.claude/rules/git-workflow.md`
- **action:** Append a new top-level section `## STATE.md discipline` — one paragraph: every PR merge bumps `Updated:` to the merge date and appends one row to the Active table; the implementer of the merge does both edits. Append a second top-level section `## Post-merge branch prune`. The exact snippet to embed (must use the `while read -r` form, **not** `for b in $(...)` — the latter word-splits in zsh on macOS):
  ```bash
  git fetch --prune
  git branch -vv | awk '/: gone\]/ {print $1}' | while read -r b; do
    case "$b" in wip/*|pr-26) continue ;; esac
    git branch -d "$b"
  done
  ```
  Include a one-line note: "Uses `git branch -d` (lowercase) — refuses on unmerged commits. Skips `wip/*` and `pr-26` explicitly. Run on bash or zsh."
- **verify:** `grep -F "STATE.md discipline" .claude/rules/git-workflow.md && grep -F "Post-merge branch prune" .claude/rules/git-workflow.md && grep -F "while read -r b" .claude/rules/git-workflow.md`
- **expected:** All three grep commands match. Confirms the section headers are present AND the snippet uses the safe form, not the word-splitting `for` form.

### Task 3: Prune merged local branches (zsh-safe, exclusion-explicit)

- **files:** (no file change — git operation)
- **action:** From repo root run the exact snippet documented in Task 2 — including the `case "$b" in wip/*|pr-26) continue ;; esac` exclusion guard. Capture the resulting deleted-branch list in the commit message body for this task. The snippet's structural exclusion of `wip/*` and `pr-26` is the safety net; the agent does not delete branches by hand. **Pre-state log:** before running the snippet, capture `git branch -vv | grep -c -E ': gone\]'`. If the count is 0 (a recent `git fetch --prune` may have zeroed it on this checkout), log `NO-OP — pre-prune count was 0` in the commit body. The verify below is a post-state assertion regardless of pre-state, so a no-op run still passes.
- **verify:** `git branch -vv | grep -c -E ': gone\]'`
- **expected:** `0` — after pruning, no local branches show a gone tracking remote. (Pre-state: ~21 such branches.) This verify is causal — it asserts the prune removed everything it was supposed to, regardless of exclusion-list state.

### Task 4: Archive superseded pipeline-speed-wedges plans (idempotent, atomic-ordered)

- **files:** Source: 4 files under `.iago/plans/feature-pipeline-speed-wedges/_deferred/`. Destination: `.iago/plans/_archive/2026-04-pipeline-speed-wedges/`.
- **action:** Use `git mv` to handle the rename, then write the prepended header to the destination file (NOT the source — `git mv` refuses on dirty files, so order is: move first, then prepend). Idempotency guard: before prepending, run `head -1 "$dest" | grep -q "^> ARCHIVED"` and skip the prepend if already present. The header line is `> ARCHIVED 2026-05-04 — superseded by docs/specs/iago-os-roadmap.md (Wave 1/2 wedge alphabet replaces these execution patterns).` After all 4 moves complete, check `_deferred/` is empty (`[ -z "$(ls -A .iago/plans/feature-pipeline-speed-wedges/_deferred 2>/dev/null)" ]`); if non-empty, report which file remained and stop without `rmdir`. If empty, `rmdir` the directory.
- **verify:** `[ ! -d .iago/plans/feature-pipeline-speed-wedges/_deferred ] && [ "$(ls .iago/plans/_archive/2026-04-pipeline-speed-wedges/ | wc -l)" = "4" ] && head -1 .iago/plans/_archive/2026-04-pipeline-speed-wedges/02-wedge-a-plus-review-fanout.md | grep -q "^> ARCHIVED 2026-05-04"`
- **expected:** Exit 0 on all three gates: `_deferred/` removed, archive contains 4 files, first file's first line is the ARCHIVED header.

### Task 5: Document _archive convention in execution-pipeline rules

- **files:** `.claude/rules/execution-pipeline.md`
- **action:** Append a new top-level section `## Plan archive convention` with two short paragraphs. First: "Plans superseded by a canonical roadmap or vision spec move to `.iago/plans/_archive/{YYYY-MM-{slug}}/` with a roadmap-pointer header on each file. Never execute archived plans without first re-stress-testing them against the current roadmap." Second (recognition heuristic — closing the Consumer reviewer's terseness flag): "A plan is *superseded* when a canonical spec explicitly replaces its execution pattern, not merely when it is *deferred* (deferred plans stay in their phase folder; superseded plans move to `_archive/`)."
- **verify:** `grep -F "Plan archive convention" .claude/rules/execution-pipeline.md && grep -F "superseded when a canonical spec" .claude/rules/execution-pipeline.md`
- **expected:** Both grep commands match.

### Task 6: Create .iago/state/ README with `_archive` tracked-vs-ignored note

- **files:** `.iago/state/README.md`
- **action:** Create the file with three short paragraphs. (1) Purpose — "`.iago/state/` holds per-machine, per-run pipeline artifacts. Always gitignored. Anything cross-session must live in `.iago/summaries/` or `.iago/learnings/`, not here." (2) Verification command — show `git check-ignore -v <path>` with one worked example for any file currently under `.iago/state/` (the implementer chooses an extant file at runtime, e.g., `.iago/state/exposicion-run/01-foundation.log`). (3) `_archive` boundary — "Note: `.iago/plans/_archive/` is the *opposite* — explicitly tracked, not gitignored. When auditing a new write site under `.iago/`, run `git check-ignore -v` against it before committing; if no ignore rule fires, the path is tracked, and you must either move the write or extend `.gitignore`." File must end with a single trailing newline.
- **verify:** `test -f .iago/state/README.md && grep -F "Always gitignored" .iago/state/README.md && grep -F ".iago/plans/_archive/" .iago/state/README.md`
- **expected:** All three gates pass.

### Task 7: Audit GNU-coreutils call sites + inline-comment + extend CLAUDE.md prereq

- **files:** Audit output: `.iago/state/macos-portability-audit-2026-05-04.txt` (gitignored). Inline comments: every audited call site under `scripts/` and `scripts/lib/` (`.claude/hooks/` does not exist in this repo and is excluded from scope; if it is added later, extend the audit). Prereq extension: `CLAUDE.md` Prerequisites section.
- **action:** Run grep sweeps via Bash tool calls (not a separate script — the agent owns this directly) over `scripts/` and `scripts/lib/` for these patterns: `sed -i`, `readlink -f`, `grep -P`, `sort -V`, `date -d`, `date -I`, `xargs -r`, `stat -c`, `cp --reflink`. For each match write one line `path:line:pattern` to the audit file (no surrounding context — keeps any inline tokens out of the file per Security reviewer's note). For each unique call site, add an inline bash comment immediately above it: `# GNU-only — Mac path requires brew coreutils per CLAUDE.md prereq`. Idempotency guard: before adding, check the line above already starts with `# GNU-only`. After audit completes, extend `CLAUDE.md` Prerequisites section by appending **one new top-level bullet** (line starts with `- `, content starts with a backtick) listing the `g`-prefixed binaries the audit actually surfaced — e.g., ``- `gsed`, `greadlink`, `gsort` — installed via `brew install coreutils` (macOS only).`` This format is required because the aggregate verify uses regex `^- \`(gsed|greadlink|gsort|gdate|gstat|gxargs)\`` (line-anchored, backtick-leading) — a sub-bullet under the existing `**macOS:**` line will not match. List only what the audit found, not the full coreutils set. Embed the audit table in the PR description (commit message body) — the audit file is gitignored and goes away on a fresh clone.
- **verify:** `test -f .iago/state/macos-portability-audit-2026-05-04.txt && [ "$(wc -l < .iago/state/macos-portability-audit-2026-05-04.txt)" -ge 1 ] && grep -c "# GNU-only" /dev/null $(awk -F: '{print $1}' .iago/state/macos-portability-audit-2026-05-04.txt | sort -u | tr '\n' ' ') | awk -F: '{sum+=$2} END {if (sum>=1) print "OK"}' | grep -q OK`
- **expected:** Audit file exists with ≥1 line; every file named in the audit has at least one `# GNU-only` comment. The `CLAUDE.md` extension is asserted in the aggregate `## Verification` block via a separate grep so this task's verify stays bounded.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-04
**Mode:** single-pass (post-revision check after prior `--deep`)

### Findings

#### Edge Cases

- **IMPORTANT** — Task 3 pre-state may already be zero on this checkout (a recent `git fetch --prune` zeroed `: gone]` branches; the plan's "Pre-state: ~21 such branches" claim from 2026-04-29 is now stale). The verify is post-state assertion only — the snippet would no-op and still pass. **Resolution applied:** Task 3 action now logs `NO-OP — pre-prune count was 0` in commit body if pre-count is 0, converting the no-op into evidence.
- **IMPORTANT** — Task 7 originally audited `.claude/hooks/`, but that directory does not exist in this repo (`.claude/` contains `agents/`, `rules/`, `skills/`, `settings*.json` only). Greps over a missing path silently match zero, masking incomplete audit. **Resolution applied:** Task 7 scope reduced to `scripts/` and `scripts/lib/`; hooks/ explicitly excluded with a note for future extension.

#### Contradictions

- **NOTE** — Task 7 local verify originally used `grep -c "# GNU-only" $(...)` — when the audit lists exactly one unique file, `grep -c` outputs just an integer (no `filename:` prefix), and `awk -F:` parsing produces sum=0 (false negative). **Resolution applied:** `/dev/null` passed as first file arg to force multi-file `filename:count` output format regardless of audit cardinality.
- **NOTE** — Aggregate verify regex `^- \`(gsed|greadlink|gsort|gdate|gstat|gxargs)\`` (line 120 in `## Verification` block) is line-anchored and requires backtick-leading bullet content. Existing CLAUDE.md macOS prereq uses bold-prefix `**macOS:**` format — a sub-bullet would fail the regex. **Resolution applied:** Task 7 action now mandates the new bullet must be a NEW top-level entry, not a sub-bullet under macOS, with example wording.

#### Missing Acceptance Criteria

- **NOTE** — Aggregate verify enforces "audit file has ≥1 entry" and "CLAUDE.md has ≥1 g-prefixed binary listed" — does not assert "every audited call site has the inline comment." Acceptable gap: Task 7's local verify (`sum>=1` over per-file grep counts) covers comment presence; aggregate is intentionally bounded. Flagged so implementer reads the local verify as load-bearing.

### Notes for implementer

All IMPORTANT findings have been patched into the relevant tasks above (Task 3 action, Task 7 files + action + verify). NOTE-level findings folded into the same patches. Prior `--deep` resolutions all hold: zsh `while read -r` form correct, `case` exclusion guard structural, `git mv` ordering sound, idempotency guards verified.

---

## Verification

```bash
# Task 1
grep -qE "Updated:.*2026-05-04" .iago/STATE.md && \
grep -qF "Phase 1 cleanup in flight" .iago/STATE.md && \
# Task 2
grep -qF "STATE.md discipline" .claude/rules/git-workflow.md && \
grep -qF "Post-merge branch prune" .claude/rules/git-workflow.md && \
grep -qF "while read -r b" .claude/rules/git-workflow.md && \
# Task 3
[ "$(git branch -vv | grep -c -E ': gone\]')" = "0" ] && \
# Task 4
[ ! -d .iago/plans/feature-pipeline-speed-wedges/_deferred ] && \
[ "$(ls .iago/plans/_archive/2026-04-pipeline-speed-wedges/ | wc -l)" = "4" ] && \
head -1 .iago/plans/_archive/2026-04-pipeline-speed-wedges/02-wedge-a-plus-review-fanout.md | grep -qF "ARCHIVED 2026-05-04" && \
# Task 5
grep -qF "Plan archive convention" .claude/rules/execution-pipeline.md && \
grep -qF "superseded when a canonical spec" .claude/rules/execution-pipeline.md && \
# Task 6
test -f .iago/state/README.md && \
grep -qF "Always gitignored" .iago/state/README.md && \
grep -qF ".iago/plans/_archive/" .iago/state/README.md && \
# Task 7
test -f .iago/state/macos-portability-audit-2026-05-04.txt && \
[ "$(wc -l < .iago/state/macos-portability-audit-2026-05-04.txt)" -ge 1 ] && \
grep -qE "^- \`(gsed|greadlink|gsort|gdate|gstat|gxargs)\`" CLAUDE.md && \
echo "PLAN_01_VERIFIED"
```

Expected output: `PLAN_01_VERIFIED` after every gate succeeds.

## Stress test resolution log

This plan was stress-tested via `/iago-stress --deep` Phase A (10 reviewers, 5 lenses
× 2 plans). Phase B/C were not run because Phase A findings were severe enough
(Plan 02: 3 BLOCKs + YAGNI; Plan 01: 1 BLOCK + 13 IMPORTANTs) to warrant immediate
revision rather than synthesis. Plan 02 was deleted; its scope collapsed into Task 7
here. Phase A findings addressed:

| Lens | Severity | Finding | Resolution in this revision |
|------|----------|---------|------------------------------|
| Consumer | BLOCK | `for b in $(...)` snippet word-splits in zsh on macOS | Task 2 + 3 both use `while read -r b` form |
| Failure Modes | IMPORTANT | Branch exclusion is behavioral not structural | Task 2 snippet now contains explicit `case` guard for `wip/*` and `pr-26` |
| Failure Modes | IMPORTANT | `git mv` + prepend non-atomic, non-idempotent | Task 4: move first, then prepend at destination, with `head -1 \| grep -q` idempotency guard |
| Failure Modes | IMPORTANT | `_deferred/` rmdir assumes empty | Task 4: explicit `[ -z "$(ls -A ...)" ]` check before rmdir |
| Feasibility | IMPORTANT | "Line 3" hardcoded but `Updated:` is line 4 | Task 1: locate by line content (`grep -F`-style), no hardcoded numbers |
| Feasibility | IMPORTANT | Task 3 verify is non-causal (counts ambient state) | Task 3 verify now asserts zero `: gone\]` branches — causal to the prune |
| Consumer | IMPORTANT | "in flight" line creates digest-rot | Task 1 includes self-removing protocol sentence |
| Consumer | IMPORTANT | Archive convention too terse | Task 5: added explicit superseded-vs-deferred recognition heuristic |
| Security | IMPORTANT | Documented snippet weaker than implemented | Tasks 2 + 3 now use the same safe `while read -r` form |
| Simplicity (P02) | IMPORTANT | Plan 02 violates `feedback_diagnose_before_fix` | Plan 02 deleted; Task 7 here is the minimized replacement (audit + comments + prereq) |
| Feasibility (P02) | BLOCK ×3 | Executor unspecified, dispositions discretionary, Files table not authoritative | Task 7 explicitly says "Bash tool calls" + single disposition (inline comment only) + audit drives the file list |
| Failure Modes (P02) | IMPORTANT | sed -i partial-edit rollback | Moot — no `sed -i` in revised plan; comments are append-style |
| Consumer (P02) | IMPORTANT | IAGO_DEBUG discoverability zero | Moot — no shims, no IAGO_DEBUG |

Notes-severity findings folded into wording where load-bearing; remaining notes
forwarded to the implementer via this section as awareness items.
