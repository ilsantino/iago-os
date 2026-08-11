---
name: agentic-os-dashboard evaluation
description: agentic-os-dashboard (cth9191/agentic-os-dashboard) — Streamlit local cockpit reading ~/.claude/ for token gauges + MCP status + skill buttons; STALE 2026-04-17 last push, 2 commits, 10 stars; cherry-pick patterns (MCP health check, token visual), do NOT adopt the Streamlit package
type: project
originSessionId: 6afa8fcf-62aa-4fa4-92cb-65c492427ae0
---
agentic-os-dashboard at https://github.com/cth9191/agentic-os-dashboard — Python, MIT, 10 stars, 13 forks, **2 commits, last push 2026-04-17 (stale, may be abandoned)**.

Streamlit dashboard, no daemon, reads `~/.claude/` directly. Three usage gauges (5h / weekly / daily routine cap), cumulative token chart, MCP server status, one-click skill buttons, activity feed.

**Verdict: cherry-pick patterns, do not adopt the package.** Streamlit + Python dependency cost not justified for a 3-person team in the terminal. Project may be abandoned.

**Patterns worth stealing (ranked):**
1. **MCP health check** (highest leverage, ~30 min spike) — port `~/.claude/` MCP-status read to `.claude/scripts/mcp-health.mjs`. Surfaces silent MCP failures we currently discover only via tool errors mid-session.
2. **Token consumption visual** (medium, ~2h) — fold into a `/iago-status` skill that prints gauges in terminal. No Streamlit.
3. **Pipeline telemetry feed** (latent) — Streamlit pattern is the reference IF Wedge B distiller ever wants a UI.

**Triggers to revisit:** MCP silent-failure incident; token-limit hit mid-pipeline costing real work; client visibility ask ("what is the bot doing?") — at which point consider cortextOS Next.js dashboard as stronger alternative.

Full eval: `~/dev/obsidian-brain/projects/agentic-os-dashboard-eval.md` (written 2026-05-10).

Discovered via Santiago supplying URL after status-pull failure searched wrong slug (`dashboard-os`). Pair with [project_cortextos](project_cortextos.md) — both close the same research-rediscovery gap.
