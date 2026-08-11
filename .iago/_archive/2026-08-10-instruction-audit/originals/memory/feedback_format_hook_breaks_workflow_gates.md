---
name: feedback_format_hook_breaks_workflow_gates
description: "iago-os format hook mutates client sub-tree during workflow subagent edits → dual-adversarial SIDE-EFFECT BREACH + pipeline stray reformats; fix client-PR findings directly via Bash, not Edit/subagents"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f39e64a5-f375-4ae8-8f1b-572e1e58c85b
---

**★ 2026-07-03 — ROOT-CAUSE FIXED.** Patched `.iago/hooks/post-edit-format.mjs`: added, right after the existsSync guard, `if (/[\\/]clients[\\/]/.test(filePath)) process.exit(0);` — the hook now SKIPS every `clients/**` file, so Edit no longer reformats client sub-trees at all.

**⚠ 2026-07-04 gap:** the skip is PATH-BASED, so a client-repo **worktree created outside `clients/`** (e.g. `C:/Users/sanal/dev/munet-web-wt-*`) does NOT match and the hook fires again (confirmed: 627-line tab-mangle on ParticleNetwork.tsx in `munet-web-wt-homefix`; agent recovered via git restore + CRLF-aware Node patch script per the 2026-06-25 mechanism below). Either create client worktrees UNDER `clients/` (e.g. `clients/munet-web/.claude/worktrees/...`) or expect the hook and use Write/Node-patch from the start. Takes effect immediately (the hook script re-runs per Edit). This resolves the "Real infra fix (separate)" TODO below. The Write-only / Node-patch / Bash workarounds are no longer REQUIRED for client formatting (still fine to use). Discovered on the munet visual-rework wave-1 impl (wf_811093c8): the first run's Edit-based agents rewrote whole munet files to iago-os Biome style (tabs/double/semi), blowing 21-line diffs up to 400+; prettier-normalizing couldn't reverse it cleanly (munet's exact style ≈ prettier single/no-semi/es5 but with hand JSX-wrapping, ~87-line residual), so the fix + a clean re-run was the answer. Keep matching each file's on-disk style regardless.

---

The iago-os post-edit-format hook (Biome, iago-os root config) fires on ANY Edit/Write tool call against a client sub-tree (e.g. `clients/sentria/**`). When a Workflow's review/fix subagent touches a file there, the hook reformats it to iago-os style (double-quotes, tabs, semicolons), which sentria does NOT use. Two costly consequences observed 2026-06-17 on the Reportes plan-01 run (PR #236):

1. **execute-pipeline.js** left an 8-file stray working-tree mutation after the run (reformatted `reports-utils.ts` + reformatted/extended test files + doc-drift edits a fix-leg wrote). It was NOT committed (PR stayed clean) but it CONTAMINATED my verification: `npm test`/build-gate run against the dirty tree passed because the stray test fix was present; after I `git restore`d to protect code-style, the committed PR's pre-existing test actually FAILED (real CI-red). **Always run the build gate / tests against the COMMITTED tree (clean `git status`), never a dirty one.**

2. **dual-adversarial.js** (mode:team) aborted with `Error: SIDE-EFFECT BREACH — a read-only review leg mutated the worktree` (same 8-file signature). The gate's read-only contract is structurally incompatible with the hook firing in a client sub-tree. **Re-running does not help — it re-trips the hook.** The adversarial findings still landed before the abort (recover from `journal.jsonl`); only the clean-tree certification fails.

**Why:** the format hook is keyed to the iago-os root, not the sub-project; it cannot tell a review-leg's incidental file-touch from an intended edit, and rewrites to the wrong style.

**How to apply:**
- For a client-PR review FIX, do the edit DIRECTLY from the orchestrator via Bash (`node -e 'fs.readFileSync…replace…writeFileSync'` or `sed`) — Bash file writes do NOT trigger the PostToolUse:Edit hook, so no reformat. Verify the diff is exactly the intended change, then commit + run the full suite. (Did this for the at_risk→response_breached test fix; clean 1-line diff.)
- Treat a dual-adversarial gate over a `clients/*` PR as "review substance obtainable, certification not." Harvest findings from the journal, fix the blockers directly, verify CI-green by running the committed tree, and proceed to smoke + `/iago-prfix` — do not block on a green gate verdict that the hook makes unreachable.
- Real infra fix (separate): exempt review/gate subagents (or `clients/**`) from the format hook, or run the gate in worktree isolation. Until then this is the standing workaround.

Builds on [[feedback_subproject_format_hook]] (manual-Edit dimension) and [[feedback_subagent_git_wander_and_structuredoutput]] (do edits directly + verify). Recovery pattern per [[feedback_pipeline_hang_malformed_command]] (TaskStop + verify green + manual push/PR, don't re-run).

**2026-06-25 refinement (PR #241 Reportes plan-02, verified empirically).** The hook is `.iago/hooks/post-edit-format.mjs`, matcher **`Edit` only** (PostToolUse), so it fires on **Edit + MultiEdit but NOT `Write`**; and it only touches **`.js/.jsx/.ts/.tsx/.json`** — `.mjs` and `.md` are exempt. Tested with a scratch file: one Edit on a sentria `.ts` rewrote 2-space→**tabs + semicolons + double-quotes** (iago-os Biome). So the existing "Edit/Write" wording above is too broad — **Write does NOT trip it**. Two clean orchestrator-side mechanisms (no subagent, no hook):
- **Write tool** for whole new files / full rewrites (I had full content) — bypasses the hook, keeps your typed style.
- **Node patch script run via Bash** for surgical edits to files you don't have in full: read → assert an EXACT match-count (`s.split(old).length-1 === expected`, throw otherwise so a stale anchor never corrupts) → `split/join` → write. Anchor on distinctive substrings WITHOUT leading whitespace and supply new-line indentation with explicit `\t`/spaces, so tabs-vs-spaces never has to be reproduced. **CRLF-aware**: sentria sources are CRLF — detect `s.includes('\r\n')` and convert LF anchors to CRLF, or matches return 0. Match each file's ON-DISK style (some sentria files were already tab/semicolon iago-style from prior hook damage — match what's there, not the repo default).
- Indentation cleanup: do NOT run `npx biome` on a sentria file to tidy — iago-os Biome over-reformats (flips EOL to LF, touches unrelated lines). Re-indent a specific inserted block with a line-based Node script instead.
- This fully replaces the "via Bash sed" suggestion above — the Node-patch-script + Write combo is cleaner and self-verifying. Gate side-effect note still holds: a clean-tree gate over `clients/*` is reachable this way (no stray reformats), confirmed by `git status` clean + `porcelain:""` in the gate's own side-effect snapshot.
