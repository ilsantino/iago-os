---
phase: audit
plan: 06
wave: 2
depends_on: [audit-05]
created: 2026-04-12
---

# Plan: audit-06 — Fix Codex adversarial review on Windows

## Goal

Codex adversarial review (step 4) is non-functional on Windows — every git command
is blocked by Codex's sandbox policy (PowerShell commands rejected). Fix this so
cross-model review works on the CEO's Windows machine. Also fix the silent skip
when Codex fails at runtime (no Claude fallback).

## Findings Addressed

munet-web PR #31 — Codex review produced zero useful findings because every tool
call was blocked. Pipeline findings I2 (Codex runtime failure has no Claude fallback)
and I3 (Codex fallback omits --allowedTools).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Fix Codex invocation + add runtime failure fallback |

## Tasks

### Task 1: Probe Codex CLI capabilities (1 tool call max)
- **files:** None (probe only)
- **action:** Run `codex --help 2>&1 | head -40` to check if Codex CLI is installed and has sandbox/shell config flags. If not installed (`command not found`), skip to Task 2 option 3 immediately. If installed, look for `--sandbox`, `--shell`, `--policy` flags. Spend at most ONE tool call on this — do not research further.
- **verify:** Decision documented: either "Codex has flag X, using option 1/2" or "No config available, using option 3"
- **expected:** Quick decision, no wheel-spinning

### Task 2: Fix Codex invocation for Windows compatibility
- **files:** `scripts/execute-pipeline.sh`
- **action:** Default approach: **option 3** (OS detection + Claude fallback). Implement this FIRST as the guaranteed-to-work path. Then, only if Task 1 found viable Codex config flags, add option 1 or 2 as a preferred path before the OS check.
  Option 3 implementation: before the `command -v codex` check at line 392, detect Windows (`[[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]` or `[[ "$(uname -s)" == MINGW* ]]`). If Windows AND Codex sandbox is not configured, log "Codex sandbox blocks git on Windows — using Claude adversarial" and jump to the Claude fallback path.
  The Codex review must produce findings or explicitly fall back — no silent skip.
- **verify:** `grep -A5 "codex review" scripts/execute-pipeline.sh` — should show either config flags or diff-file approach
- **expected:** Codex invocation handles Windows environment

### Task 3: Add Claude fallback on Codex runtime failure
- **files:** `scripts/execute-pipeline.sh`
- **action:** Currently (lines 407-413), if `codex` is installed but fails at runtime without findings, the pipeline silently skips adversarial review. Fix: after the Codex failure check, if output has no findings, fall back to the Claude adversarial session (same as the `else` branch at lines 395-401). This ensures adversarial review always happens — either via Codex or Claude.
  Use the EXACT same prompt and arguments as the existing Claude fallback at lines 395-401 (references `$PLAN_FILE` and `$DIFF_FILE`). Do not write a new prompt.
  Also handle the case where Codex exits 0 but produces no severity markers — log a warning and treat as clean (acceptable, no findings means no concerns).
- **verify:** `grep -c "falling back to Claude" scripts/execute-pipeline.sh`
- **expected:** 1

### Task 4: Add --allowedTools to Claude adversarial fallback
- **files:** `scripts/execute-pipeline.sh`
- **action:** The Claude fallback for Codex (lines 395-401) omits `--allowedTools`, giving the review session write access. A review session should never modify files. Add `--allowedTools "Read Glob Grep Bash"` to both the primary fallback (line 395-401) and the new runtime failure fallback from Task 3.
- **verify:** `grep -B2 -A2 "Adversarial review" scripts/execute-pipeline.sh | grep -c "allowedTools"`
- **expected:** 2 (one per fallback path)

## Verification

After all tasks:
```bash
grep "allowedTools" scripts/execute-pipeline.sh | grep -c "Adversarial\|adversarial\|codex"
grep "falling back" scripts/execute-pipeline.sh
bash -n scripts/execute-pipeline.sh && echo "SYNTAX OK"
```

Expected: allowedTools on both fallback paths, fallback message present, syntax valid

## Stress Test

Reviewed by opus adversarial analyst on 2026-04-12. Verdict: **PROCEED_WITH_NOTES**.
- Task 1: Capped to 1 tool call. If Codex not installed or no config flags, skip to option 3 immediately.
- Task 2: Default to option 3 (OS detection + Claude fallback) as guaranteed path. Options 1/2 are stretch goals.
- Task 3: Use EXACT same prompt from existing fallback (lines 395-401), not placeholders. Also handle Codex exit 0 with no findings.
- Task 4: Add --allowedTools to both fallback paths. run_claude is a transparent passthrough — no conflict.
- Cross-plan: depends_on audit-05 to avoid merge conflicts on execute-pipeline.sh.
