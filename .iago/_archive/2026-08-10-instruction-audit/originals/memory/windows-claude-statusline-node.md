---
name: windows-claude-statusline-node
description: Claude Code statusLine + hook commands on this Windows machine must use node — bash/jq are NOT on the PATH Claude Code uses; statusline.js is the working impl
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7ff5853a-61b0-47cb-93f3-051825ba724b
---

On Santiago's Windows 11 machine, the PATH that Claude Code uses to launch `statusLine` and hook commands has **`node` (and `python`) but NOT `bash` or `jq`**. Git Bash exists at `C:\Program Files\Git\...` but is not on PATH, and `jq` is not installed at all (confirmed `where bash` / `where jq` both empty, 2026-05-30).

Consequence: any statusLine/hook command shelling out to `bash`/`jq`/`awk` fails. The old `~/.claude/statusline-command.sh` (bash + jq) rendered only `\x1b[2m  \x1b[0m` (dim whitespace) → the status line "never appeared". Fixed by rewriting in dependency-free Node.

- Active config: `~/.claude/settings.json` → `statusLine.command = node "C:/Users/sanal/.claude/statusline.js"`
- Script: `C:\Users\sanal\.claude\statusline.js` — reads stdin JSON via `fs.readFileSync(0)`, parses natively, prints `dir  model  effort  ctx N% [bar] M% left  $cost  5h% 7d%`, dim with green/yellow/red ctx% by threshold. Always prints something (never invisible).
- statusLine JSON schema IS real incl. `context_window.used_percentage` (pre-calc), `context_window.context_window_size`, `rate_limits.five_hour/.seven_day.used_percentage` (Pro/Max only, absent before first API call), `cost.total_cost_usd`, `effort.level`. The old `.sh` field names were correct — only the jq/bash deps were the failure.
- **Do NOT re-run `/statusline`** — the statusline-setup agent may regenerate a bash/jq command that breaks again here. Edit `statusline.js` directly instead.

Rule of thumb: author Claude Code hooks / statusline / scripts for this machine in **node** (or python), never bash/jq. The project's `.iago/hooks/*.mjs` already follow this. Relates to [[feedback_config_protection_bypass]] (settings.json is NOT protected by the config-protection hook, so it's directly editable).
