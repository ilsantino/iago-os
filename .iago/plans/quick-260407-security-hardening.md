---
phase: quick
plan: quick-260407-security-hardening
wave: 1
depends_on: []
created: 2026-04-07
branch: fix/quick-security-hardening
base: main
---

# Quick: Security hardening — fail-closed hooks, Bash secret detection, pipeline staging

## Goal

Fix three security vulnerabilities found by adversarial review: PreToolUse hooks that fail-open on crash, safety-guard missing secret detection for Bash commands, and pipeline script staging secrets via bare `git add -A`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Edit | `.iago/hooks/safety-guard.mjs` | Fail-closed catch + Bash secret detection |
| Edit | `.iago/hooks/config-protection.mjs` | Fail-closed catch |
| Edit | `.iago/hooks/commit-quality.mjs` | Fail-closed catch |
| Edit | `scripts/execute-pipeline.sh` | Safe git staging with pathspec exclusions |

## Tasks

### Task 1: Fix fail-closed hooks (PreToolUse only)
- **files:** `.iago/hooks/safety-guard.mjs`, `.iago/hooks/config-protection.mjs`, `.iago/hooks/commit-quality.mjs`
- **action:** In each of these 3 files, change `main().catch(() => process.exit(0))` to `main().catch((err) => { process.stderr.write("iaGO hook crash: " + (err?.message || "unknown") + "\n"); process.exit(2); })`. This makes PreToolUse guards fail-closed — a crash blocks the operation instead of silently allowing it. Do NOT change the PostToolUse hooks (post-edit-format.mjs, post-edit-typecheck.mjs, post-edit-console-warn.mjs) — those are advisory and fail-open is correct behavior for them.
- **verify:** `grep "process.exit(0)" .iago/hooks/safety-guard.mjs .iago/hooks/config-protection.mjs .iago/hooks/commit-quality.mjs; echo "EXIT:$?"`
- **expected:** No matching lines. grep exits 1 (no match). Output ends with `EXIT:1`.

### Task 2: Add secret detection to Bash commands in safety-guard
- **files:** `.iago/hooks/safety-guard.mjs`
- **action:** Inside the `if (toolName === "Bash")` block, after the existing destructive patterns loop ends (after the closing brace around line 103), add a new loop that checks the `command` string against `SECRET_PATTERNS`. Only check patterns where `scope` is `"both"` — skip patterns where `scope` is `"writes"` (those are for file content only). For each match, block with: `process.stdout.write(JSON.stringify({ decision: "block", reason: "iaGO: Possible " + secret.msg + " in Bash command. Use environment variables instead." })); process.exit(2);`. This ensures `echo AKIA... > file` or `curl -H sk-ant-...` are caught.
- **verify:** `node -e "const c=require('fs').readFileSync('.iago/hooks/safety-guard.mjs','utf8'); const hasBashSecrets = /if\s*\(toolName\s*===\s*['\"]Bash['\"]\)[\s\S]*?SECRET_PATTERNS/.test(c); console.log(hasBashSecrets ? 'OK' : 'FAIL')"`
- **expected:** `OK`

### Task 3: Fix unsafe git add -A in pipeline script
- **files:** `scripts/execute-pipeline.sh`
- **action:** There are two bare `git add -A` commands in this file (line 116 and line 192). Replace both with `git add -A -- ':!.env' ':!.env.*' ':!*.pem' ':!*.key'`. This uses git pathspec magic to exclude secret files from staging while still adding all other new/modified files.
- **verify:** `grep -c "git add -A$" scripts/execute-pipeline.sh`
- **expected:** `0` (no bare git add -A remaining — both now have pathspec exclusions)
