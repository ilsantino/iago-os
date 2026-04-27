---
phase: feature-pipeline-speed-wedges
plan: 06
wave: 6
depends_on: ["01-measurement-protocol", "05-wedge-a-plus-review-fanout"]
context: docs/specs/parallel-execution-wedges.md
created: 2026-04-27
revised: 2026-04-27
source: feature
---

# Plan: feature-pipeline-speed-wedges/06-wedge-b-revived-multiplan-parallel

## Goal

Add `/iago-execute --parallel` mode that spawns one teammate per plan in its own git worktree. **Hybrid coordination:** static path-overlap pre-flight (parse plan `## Files` tables, serialize plans with shared files) + dynamic mailbox FILE_CLAIM/FILE_RELEASE for residual files (touched but not declared). **Mechanical claim enforcement via `PreToolUse` hook**, not prompt instruction. **JSONL atomicity via `flock`** (Linux) or single-coordinator-process model (Windows). Falls back to serial multi-plan when claim hook unavailable.

## Design decisions (post-revision)

- **Hybrid static + dynamic coordination.** Static analysis catches the known-overlap cases at zero runtime cost; dynamic mailbox handles residual unforeseen edits. Eliminates the "agent forgets to claim known-overlap file" failure mode without depending solely on hook reliability.
- **`PreToolUse` hook for claim enforcement** — fires before every Edit/Write tool call, blocks on conflicting open claim. Strictly more reliable than prompt instruction.
- **Liveness check before blocking on stale claim.** If holder PID is not alive, the claim is treated as stale and released automatically.
- **JSONL atomicity:** `flock` on Linux/macOS, single-coordinator-process on Windows (orchestrator owns the mailbox; teammates send claims via a named-pipe-or-file request the orchestrator serializes).
- **`.iago/coord/` is gitignored automatically** by the orchestrator (Bash shell-redirect bypass per the protected-config rule), with a log line. No more user-must-precondition error path.
- **Plans must be committed before `--parallel` runs.** Orchestrator checks `git status .iago/plans/` and refuses if uncommitted plans exist.
- **`LOCK_DIR` collision check confirmed safe** (each worktree has its own `.iago/state/`); add a comment in `execute-pipeline.sh` "do not modify the LOCK_DIR section."

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.claude/skills/iago-execute/SKILL.md` | Add `--parallel`, `--keep-worktrees`, `--no-teams` flags |
| create | `scripts/execute-parallel.sh` | Orchestrator: static overlap analysis, worktree setup, dispatch, monitor mailbox |
| create | `scripts/parallel-mailbox-protocol.md` | File-claim message schema |
| create | `scripts/parallel-worktree-setup.sh` | Programmatic worktree creation |
| create | `scripts/parallel-claim-hook.sh` | PreToolUse hook: enforce claims before Edit/Write |
| modify | `scripts/execute-pipeline.sh` | Recognize parallel mode env vars; install claim hook in spawned pipeline; LOCK_DIR comment |
| modify | `.claude/rules/execution-pipeline.md` | Document parallel mode |

## Tasks

### Task 1: Mailbox protocol + atomicity rules

- **files:** `scripts/parallel-mailbox-protocol.md`
- **action:** Document JSONL mailbox at `$PROJECT_DIR/.iago/coord/{phase}/mailbox.jsonl`. Three message types:
  - `{"type":"FILE_CLAIM","plan":"<plan-id>","holder_pid":<pid>,"files":["path1","path2"],"ts":"ISO-8601"}`
  - `{"type":"FILE_RELEASE","plan":"<plan-id>","files":[...],"ts":"..."}`
  - `{"type":"COORDINATION_REQUEST","plan":"<plan-id>","conflict_file":"path","other_plan":"<plan-id>","ts":"..."}`
  Atomicity: writers MUST acquire `flock` on Linux/macOS, or call the orchestrator's coordinator-write API on Windows (Task 4). Reading is unlocked (best-effort consistent). Liveness: before blocking on an open FILE_CLAIM, the requester checks `kill -0 $holder_pid` — if dead, treats claim as stale, emits a synthetic FILE_RELEASE on the holder's behalf, and proceeds. Resolution algorithm: claim granted iff no live open claim on any requested file; otherwise emit COORDINATION_REQUEST and wait up to 300s for FILE_RELEASE; on timeout, halt the requester and surface to orchestrator.
- **verify:** `grep -n "FILE_CLAIM\|FILE_RELEASE\|COORDINATION_REQUEST\|holder_pid\|flock\|kill -0" scripts/parallel-mailbox-protocol.md`
- **expected:** All six terms present

### Task 2: Worktree setup script

- **files:** `scripts/parallel-worktree-setup.sh`
- **action:** Bash script. Args: `--project-dir <dir> --slug <plan-id>` creates worktree at `../$(basename $dir)-$slug` from `origin/main`, runs `npm install` if `package.json` exists, prints absolute worktree path on stdout. Idempotent. `--cleanup --slug <plan-id>` removes the worktree (`git worktree remove --force`). Refuses if `realpath "$PROJECT_DIR"` resolves under `$IAGO_OS_ROOT` (mirroring iago-wt's existing guard, but with explicit path resolution). Make executable: `chmod +x scripts/parallel-worktree-setup.sh`.
- **verify:** `test -x scripts/parallel-worktree-setup.sh && bash scripts/parallel-worktree-setup.sh --help 2>&1 | grep -q slug`
- **expected:** Exit 0

### Task 3: PreToolUse claim hook

- **files:** `scripts/parallel-claim-hook.sh`
- **action:** Bash hook script. Reads stdin JSON (Claude Code hook protocol per `scripts/config-protection.mjs` reference). Extracts tool name and file paths:
  - For `Edit` and `Write`: read `tool_input.file_path` (single path).
  - For `MultiEdit`: iterate `tool_input.edits[*].file_path` (multiple paths). MUST be supported — a plan that uses MultiEdit would otherwise bypass enforcement entirely.
  When `IAGO_PARALLEL_MODE=true` is set in the environment of the running `claude -p` session:
  1. Detect OS: `case "$(uname -s)" in MINGW*|CYGWIN*|MSYS*) IS_WINDOWS=true ;; *) IS_WINDOWS=false ;; esac`.
  2. Read `$IAGO_PARALLEL_MAILBOX` for open FILE_CLAIM messages on each target path.
  3. For each open claim by another plan, check `kill -0 $holder_pid` — dead holders → emit synthetic FILE_RELEASE, treat as no conflict. Use `IAGO_PARALLEL_PIPELINE_PID` (env var exported by orchestrator) as the holder PID, NOT `$$` (which is the hook script's own PID, dead immediately after the hook exits — would invert the liveness check).
  4. If a live conflicting claim exists, exit 1 with stderr `IAGO_PARALLEL: file $file_path is held by plan $other_plan; aborting tool call`. Claude Code blocks the tool call.
  5. Otherwise, append a FILE_CLAIM for the target paths with `holder_pid=$IAGO_PARALLEL_PIPELINE_PID` and exit 0.
  Append serialization: on Linux/macOS use `flock -x "$mailbox.lock" -c '...'`; on Windows write `*.request.{ts}.{$$}` files into the coord directory and rely on the orchestrator's coordinator process (Task 4) to serialize them into the mailbox.
- **verify:** `test -x scripts/parallel-claim-hook.sh && grep -n 'FILE_CLAIM\|kill -0\|flock\|IAGO_PARALLEL_PIPELINE_PID\|MultiEdit\|tool_input.edits' scripts/parallel-claim-hook.sh`
- **expected:** All six patterns present

### Task 4: Orchestrator script (`execute-parallel.sh`)

- **files:** `scripts/execute-parallel.sh`
- **action:** Bash orchestrator. Args: `--project-dir <dir> --plans plan1,plan2,...`. Optional: `--keep-worktrees`, `--no-teams` (force serial fallback).
  Steps:
  1. **Precondition check:** confirm `git status --porcelain .iago/plans/` is empty (plans must be committed). Refuse with clear error otherwise.
  2. **Gitignore setup:** if `.iago/coord/` not in `.gitignore`, append it via `bash -c 'echo .iago/coord/ >> .gitignore'` (protected-config bypass) and log "auto-added .iago/coord/ to .gitignore".
  3. **Static overlap analysis:** parse each plan file's `## Files` table, build a map of file→[plans]. Plans sharing files form an "overlap group" — plans within a group are serialized; disjoint plans run in parallel. Log the resulting wave plan: e.g., "Wave 1: plan-01, plan-02 (parallel) | Wave 2: plan-03 (serial after plan-01 due to shared CLAUDE.md)".
  4. **Coordinator process** (Windows only): on Windows, fork a coordinator subshell that watches `$PROJECT_DIR/.iago/coord/{phase}/*.request.{ts}` files, serializes their content into the mailbox, deletes the request file. This avoids needing `flock` on Windows. On Linux/macOS, skip — `flock` works.
  5. **Per-plan dispatch:** for each plan:
     - Call `parallel-worktree-setup.sh` to create a worktree.
     - **Install the PreToolUse hook into the worktree's `.claude/settings.local.json`.** Claude Code does NOT honor a `CLAUDE_HOOKS_PRETOOLUSE` env var — hooks must be configured via `settings.json` / `settings.local.json` files in scope. Use a node or jq merge to idempotently add a `PreToolUse` entry to `<worktree>/.claude/settings.local.json` matching `Edit|Write|MultiEdit` with command pointing at `realpath $IAGO_OS_ROOT/scripts/parallel-claim-hook.sh`. Preserve any existing entries.
     - Export env vars for the spawned pipeline: `IAGO_PARALLEL_MODE=true`, `IAGO_PARALLEL_PLAN=<plan-id>`, `IAGO_PARALLEL_MAILBOX=$(realpath "$PROJECT_DIR/.iago/coord/<phase>/mailbox.jsonl")` (realpath-normalized absolute path), `IAGO_PARALLEL_PIPELINE_PID=$BASHPID` (the spawning subshell's PID — used as the holder PID by the claim hook so the liveness check works).
     - Spawn `execute-pipeline.sh --plan <plan> --project-dir <worktree-path>` as background; record the PID for the wait phase.
  6. **Wait + cleanup:** wait on all spawned PIDs, collect exit codes, run `parallel-worktree-setup.sh --cleanup` per slug unless `--keep-worktrees`. Stop the coordinator process. Surface any COORDINATION_REQUEST timeouts in final stderr summary; exit non-zero if any.
  7. **Fallback to serial:** if `--no-teams` OR claim hook missing/non-executable OR `flock` unavailable on non-Windows, run plans serially via `execute-pipeline.sh` calls in the original project dir (no worktree fan-out). Log fallback reason.
  Make executable: `chmod +x scripts/execute-parallel.sh`.
- **verify:** `test -x scripts/execute-parallel.sh && grep -n 'IAGO_PARALLEL_MAILBOX\|parallel-worktree-setup\|settings.local.json\|IAGO_PARALLEL_PIPELINE_PID\|static overlap\|--no-teams' scripts/execute-parallel.sh | head -10`
- **expected:** All six identifiers present (note: `CLAUDE_HOOKS_PRETOOLUSE` is NOT used — Claude Code doesn't honor it; hooks live in `settings.local.json`)

### Task 5: Pipeline integration (light-touch)

- **files:** `scripts/execute-pipeline.sh`
- **action:** Two changes only:
  1. Above the LOCK_DIR section (line ~50), add a comment: `# DO NOT modify the LOCK_DIR logic — Wedge B-revived (--parallel) relies on per-worktree LOCK_DIR isolation. The orchestrator passes a worktree path as --project-dir; each pipeline acquires its own lock independently. Changing the lock keying breaks parallel mode.`
  2. Near the top of the script, after env-var initialization, log when in parallel mode: `[[ "${IAGO_PARALLEL_MODE:-false}" == "true" ]] && log "Parallel mode: plan=${IAGO_PARALLEL_PLAN}, mailbox=${IAGO_PARALLEL_MAILBOX}"`. The hook installation happens automatically because `CLAUDE_HOOKS_PRETOOLUSE` is exported by the orchestrator.
  No other changes — claim enforcement is entirely in the hook (Task 3), not in the pipeline script.
- **verify:** `grep -n 'DO NOT modify the LOCK_DIR\|IAGO_PARALLEL_MODE' scripts/execute-pipeline.sh`
- **expected:** Both patterns present

### Task 6: Add `--parallel` flag to `/iago-execute` skill

- **files:** `.claude/skills/iago-execute/SKILL.md`
- **action:** Add to Arguments section:
  - `/iago-execute {phase-slug} --parallel` — detects ≥2 plans; prompts user "Run N plans in parallel? (y/n)"; on yes, calls `scripts/execute-parallel.sh`; on no or single plan, falls back to today's per-plan loop.
  - `/iago-execute {phase-slug} --parallel --keep-worktrees` — pass through to orchestrator.
  - `/iago-execute {phase-slug} --parallel --no-teams` — force serial fallback (useful for debugging).
  Boundaries: parallel mode is opt-in; never the default.
- **verify:** `grep -n '\-\-parallel\|--keep-worktrees\|--no-teams' .claude/skills/iago-execute/SKILL.md`
- **expected:** All three flags documented

### Task 7: Document parallel mode in pipeline rules

- **files:** `.claude/rules/execution-pipeline.md`
- **action:** Add `### Parallel multi-plan execution` subsection. Three paragraphs:
  - "`/iago-execute --parallel` runs each plan in its own git worktree. The orchestrator runs static path-overlap analysis (parses each plan's `## Files` table) and serializes plans with shared files; truly disjoint plans run concurrent."
  - "Concurrent plans coordinate via a `PreToolUse` hook that consults `.iago/coord/{phase}/mailbox.jsonl` before any Edit/Write — mechanical enforcement, not prompt instruction. Stale claims (dead holders) are released automatically via PID liveness check."
  - "Mailbox writes use `flock` on Linux/macOS; Windows uses a single-coordinator-process serializer. Plans must be committed before `--parallel` runs (uncommitted plans are not visible in worktrees)."
  Reference `scripts/parallel-mailbox-protocol.md`. Use Bash shell-redirect.
- **verify:** `grep -n 'Parallel multi-plan\|parallel-mailbox-protocol\|PreToolUse hook' .claude/rules/execution-pipeline.md`
- **expected:** All three terms present

## Stress Test

**Verdict:** PROCEED_WITH_NOTES (revised, was BLOCK)
**Date:** 2026-04-27 (re-stress after revision)

Three load-bearing critical findings from the previous round are addressed inline:
- **`CLAUDE_HOOKS_PRETOOLUSE` env var doesn't exist in Claude Code** → fixed in Task 4 (orchestrator now writes the hook into the worktree's `.claude/settings.local.json` via idempotent merge, matching the pattern in the existing `scripts/config-protection.mjs`).
- **`MultiEdit` not handled in the hook** → fixed in Task 3 (hook now reads `tool_input.edits[*].file_path` for MultiEdit and `tool_input.file_path` for Edit/Write).
- **`$$` in hook script is the hook's own PID** → fixed in Task 3 (now uses `IAGO_PARALLEL_PIPELINE_PID` env var exported by the orchestrator, which is the spawning subshell's `$BASHPID`).

### Important (still requires impl-session attention)

- **Windows coordinator-process crash recovery undefined.** If the orchestrator crashes (SIGKILL, OOM, Ctrl-C), the coordinator dies with it; workers blocked on `*.request.*` files time out at 300s without ever getting acknowledged, exit non-zero, and worktrees are not cleaned up. Acceptable for v1 but document the recovery procedure (manual `iago-wt-clean` + clear `.iago/coord/` mailbox directory).
- **Static overlap analysis on absent `## Files` table.** Currently treats absent table as "no files touched" → puts plan in parallel group, may cause silent collisions. **Fix:** if `## Files` is missing or unparseable, treat plan as touching ALL files (serialize with everything else). Add to Task 4 step 3.
- **`--keep-worktrees` partial-failure semantics undocumented.** Specify: keeps all worktrees regardless of outcome; user runs `iago-wt-clean` manually.
- **No speedup acceptance criterion.** Verification only confirms it doesn't crash. Add: parallel run on 2 disjoint plans must complete in ≤120% of single-plan wall-clock (allows 20% setup overhead).

### Cross-plan dependency

This plan depends on Plan 05 only loosely (mailbox protocol patterns). The hard dependency is on Plan 01 (metrics for verifying the speedup claim). If Plan 06 ships before Plan 01 lands, the speedup criterion above is unmeasurable.

## Verification

```
test -f scripts/parallel-mailbox-protocol.md \
  && test -x scripts/parallel-worktree-setup.sh \
  && test -x scripts/parallel-claim-hook.sh \
  && test -x scripts/execute-parallel.sh \
  && grep -q "DO NOT modify the LOCK_DIR" scripts/execute-pipeline.sh \
  && grep -q '\-\-parallel' .claude/skills/iago-execute/SKILL.md \
  && grep -q "Parallel multi-plan" .claude/rules/execution-pipeline.md \
  && echo "Plan 06 verified"
```

Expected: `Plan 06 verified`. Field tests:
1. **Disjoint plans:** pick a phase with 2 plans touching no shared files. Run `--parallel`. Confirm: 2 worktrees created, both pipelines complete in parallel, mailbox shows N FILE_CLAIM + N FILE_RELEASE entries (no COORDINATION_REQUEST).
2. **Shared files (static catch):** pick 2 plans where `## Files` tables overlap. Run `--parallel`. Confirm static analysis serializes them — orchestrator log shows "Wave 1: plan-A | Wave 2: plan-B (after plan-A — shared package.json)". No COORDINATION_REQUEST emitted (caught statically).
3. **Hook enforcement (residual catch):** pick 2 plans where `## Files` tables don't overlap but the implementation actually touches a shared file. Run `--parallel`. Confirm hook fires: one teammate's Edit is blocked with `IAGO_PARALLEL: file X is held by plan Y; aborting tool call`; orchestrator surfaces COORDINATION_REQUEST; orchestrator exits non-zero.
4. **Fallback:** run `--parallel --no-teams`. Confirm serial multi-plan execution; output identical to today's `/iago-execute` behavior.
5. **Stale claim recovery:** kill one teammate mid-run. Confirm the other teammate's next claim attempt detects dead holder via `kill -0`, emits synthetic FILE_RELEASE, and proceeds.
