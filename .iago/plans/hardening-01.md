---
phase: hardening
plan: 01
wave: 1
depends_on: []
created: 2026-04-06
---

# Plan: hardening-01 — Fix hook data pipeline

## Goal

Fix the broken transcript.mjs library so context-persistence and statusline hooks
produce real data instead of zeros. Root cause: `require("fs")` (CommonJS) used
inside an ESM `.mjs` module on line 34 — throws silently, catch block returns null.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `.iago/hooks/lib/transcript.mjs` | Fix ESM import bug, use `statSync` from `fs` import |
| modify | `.iago/hooks/context-persistence.mjs` | Verify it now receives non-zero token data |
| modify | `.iago/hooks/statusline.mjs` | Fix context window calculation with real data |
| modify | `.claude/settings.json` | Wire statusline hook to Statusline event (if supported) OR delete hook |

## Tasks

### Task 1: Fix require("fs") in transcript.mjs
- **files:** `.iago/hooks/lib/transcript.mjs`
- **action:** Line 34 uses `require("fs").statSync(fp)` inside an ESM module — this throws in `.mjs` files. Replace with `statSync` from the existing `import { readFileSync, existsSync, readdirSync } from "fs"` at the top of the file. Add `statSync` to the import on line 4.
- **verify:** `node -e "import { getTokenUsage } from './.iago/hooks/lib/transcript.mjs'; const r = getTokenUsage(); console.log(r.inputTokens > 0 ? 'PASS' : 'FAIL', JSON.stringify(r));"`
- **expected:** `PASS` followed by non-zero token counts

### Task 2: Verify context-persistence gets real data
- **files:** `.iago/hooks/context-persistence.mjs`
- **action:** After fixing transcript.mjs, run context-persistence in session-start mode and confirm the session snapshot it reads contains non-zero token usage. No code changes expected — just verify the fix propagates. If the output still shows zeros, trace the call chain from context-persistence → getTokenUsage → findLatestTranscript to find any secondary issue.
- **verify:** `echo '{"session_id":"test","event":"session-start"}' | node .iago/hooks/context-persistence.mjs session-start 2>&1 | head -20`
- **expected:** Output includes session context with non-zero token/file data (or "First iaGO session" if no prior snapshot exists — acceptable for first run)

### Task 3: Decide statusline hook fate
- **files:** `.iago/hooks/statusline.mjs`, `.claude/settings.json`
- **action:** Check if Claude Code supports a "Statusline" hook event type. If it does: add a Statusline entry to `.claude/settings.json` pointing to `.iago/hooks/statusline.mjs`. If it does NOT support the event: delete `statusline.mjs` entirely, remove the statusline row from the hooks table in README.md, update hook count from 10 to 9 in all docs (README, ARCHITECTURE, HANDOFF, CLAUDE.md).
- **verify:** `grep -c "statusline" .claude/settings.json` (should be >0 if wired, 0 if deleted) AND `ls .iago/hooks/statusline.mjs 2>/dev/null; echo $?` (should be 0 if kept, non-zero if deleted)
- **expected:** Either statusline is wired and functional, or cleanly removed from codebase and docs

### Task 4: Verify end-to-end token tracking
- **files:** `.iago/hooks/lib/transcript.mjs`
- **action:** Run a comprehensive test: call `readTranscript()`, `getTokenUsage()`, `extractDecisions()`, and `getFilesModified()` against the current project's transcript. Confirm all four return non-empty/non-zero results. If `extractDecisions()` returns empty, that's acceptable (depends on session content), but `getTokenUsage()` and `readTranscript()` must return data.
- **verify:** `node -e "import { readTranscript, getTokenUsage, extractDecisions, getFilesModified } from './.iago/hooks/lib/transcript.mjs'; const t = readTranscript(); const u = getTokenUsage(); const d = extractDecisions(); const f = getFilesModified(); console.log('entries:', t.length, 'tokens:', u.inputTokens, 'decisions:', d.length, 'files:', f.length); console.log(t.length > 0 && u.inputTokens > 0 ? 'PASS' : 'FAIL');"`
- **expected:** `PASS` with entries > 0 and tokens > 0

## Verification

After all tasks: `node -e "import { getTokenUsage } from './.iago/hooks/lib/transcript.mjs'; const r = getTokenUsage(); console.log(r.inputTokens > 0 ? 'PLAN-01 PASS' : 'PLAN-01 FAIL');"`

Expected: `PLAN-01 PASS`
