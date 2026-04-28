# Team 2 — Hermes Agent current state

## TL;DR (3-line verdict)

- Hermes v0.11.0 (tag: v2026.4.23), last commit April 28 2026, extremely active (6 releases in 30 days, ~4.8-day cadence, 123K stars).
- Patterns we missed: 7 — shell-script hooks, delegated-orchestrator subagents with file-coordination, ACP editor-server mode, context-compression config, per-toolset cron gate (wakeAgent), mid-run `/steer` without cache-break, MCP sampling controls.
- Top recommendation: add shell-hooks as a new wedge (Wedge J) — zero-dependency, high leverage for lifecycle automation; fold compression config into Wedge B (distiller already touches context management); note ACP as counter-pattern (editor IDE workflow, not agency delivery).

---

## Hermes current state

| Field | Value |
|---|---|
| Latest release | v0.11.0 (tag `v2026.4.23`, April 23 2026) |
| Last commit | April 28 2026 (active as of research date) |
| Stars / forks | 123K / 18.3K |
| Release cadence | 6 releases in 30 days (v0.6.0 Mar 30 → v0.11.0 Apr 23); avg 4.8 days |
| License | MIT |
| Stack | Python (core agent), React/Ink (TUI), Node (web dashboard), SQLite (state) |
| Maturity | Production-grade, actively maintained, breaking changes per minor version |

Hermes is not stagnant. It shipped 1,556 commits, 761 merged PRs, 1,314 files changed between v0.9.0 and v0.11.0 alone.

---

## What we already cover

Mapping confirms all 9 original wedges have direct Hermes counterparts:

| Wedge | Our label | Hermes counterpart | Status |
|---|---|---|---|
| A | Frozen-snapshot MEMORY rule | `memory.memory_char_limit` + session-scoped retention | SHIPPED PR #23 |
| B | Distiller stage (pipeline step 7) | Autonomous skill creation + `skills.creation_nudge_interval` | Queued plan 01 |
| C | Cron + `[SILENT]` token | `cron/jobs.py` scheduler + script injection | Queued plan 02 |
| D | Pluggable memory provider | Honcho dialectic + `auxiliary.session_search` + FTS5 | Queued plan 04 |
| E | Conditional skill activation | `skills.external_dirs` + skill loader filter | Queued plan 03 |
| F | Telegram gateway | Multi-platform gateway (Telegram, Discord, Slack, Signal, WhatsApp, 17 platforms) | Queued plan 07 |
| G | Progressive skill disclosure | `skills_list` / `skill_view` lazy loading | Queued plan 05 |
| H | Webhook + HMAC | Webhook subscriptions (v0.11.0 adds direct-delivery mode) | Queued plan 06 |
| I | agentskills.io compliance | `agentskills.io` open standard frontmatter | Queued plan 08 |

---

## Patterns we missed (gap analysis)

### Pattern 1 — Shell-script lifecycle hooks

**Hermes implementation:**
`cli-config.yaml` `hooks.<event>[]` — wire any shell script as a lifecycle callback without writing a Python plugin. Events: `pre_tool_call`, `post_tool_call`, `on_session_start`. Each hook entry has `matcher` (tool-name regex), `command` (script path), `timeout`. `hooks_auto_accept: bool` for non-interactive mode. Shipped in v0.11.0.

Source: `cli-config.yaml.example` (confirmed fields); v0.11.0 release notes ("Wire any shell script as a Hermes lifecycle hook ... without writing a Python plugin").

**Why it matters for agency delivery:**
Claude Code already has a hooks system (`settings.json` `hooks:` block). The gap is that our hooks are defined per-repo in `settings.json` and require operator knowledge of the config schema. Hermes' pattern formalizes hooks as first-class config with regex-scoped matchers and per-hook timeouts — enabling fine-grained automation (e.g., "before any file edit to `amplify/`, run a schema-validation script"). This is directly usable for our Wedge H (webhook) and Wedge C (cron) workflows without new infra.

**Replication confidence: HIGH**
Claude Code `settings.json` hooks already exist and support `pre_tool_call`, `post_tool_call`, `stop`. Adding `matcher` (regex on tool name) and per-hook `timeout` is a thin config extension. No new runtime needed.

**Suggested wedge:** Add as **Wedge J — Shell-hook matchers**. Fold into Wedge H plan or ship standalone (S effort, ~0.5d). Extend `settings.json` hook entries with `matcher` regex + per-hook `timeout` fields interpreted by our hook runner.

---

### Pattern 2 — Delegated-orchestrator subagents with file-coordination

**Hermes implementation:**
`delegation.*` config block: `max_spawn_depth` (1–3), `max_concurrent_children` (default 3), `orchestrator_enabled` (bool), `subagent_auto_approve`, `delegation.model` / `delegation.provider` override. Key addition in v0.11.0: explicit `role="orchestrator"` for subagents that can spawn their own workers, plus a file-coordination layer preventing concurrent sibling agents from overwriting each other's edits. Real-time observability overlay in TUI shows spawn tree.

Source: v0.11.0 release notes; `cli-config.yaml.example` delegation section.

**Why it matters for agency delivery:**
Our hub-and-spoke model already prevents agents spawning agents (correct for simplicity). The gap is the **file-coordination layer** — we have `feedback_worktree_per_session.md` (each concurrent session gets its own worktree) but no automatic conflict resolution when two tasks touch the same file. For multi-plan waves (iago-execute with parallel plan dispatch), this is a real risk. The `max_concurrent_children` config is directly analogous to our wave grouping in `/iago-execute`.

**Replication confidence: MEDIUM**
File-coordination layer requires a locking or patch-merge mechanism. Claude Code's worktree isolation is our current mitigation, but it doesn't handle the case where two plans in the same worktree touch the same file. A lightweight file-lock wrapper around Edit/Write in the pipeline script would replicate 80% of the value.

**Suggested wedge:** Fold into existing Wedge B (distiller) or add a note to Wedge C. The full `orchestrator_enabled` subagent tree is out of scope (hub-and-spoke is intentional). The file-coordination locking pattern IS worth a small Wedge B addendum: add a `IAGO_FILE_LOCK` advisory lock in `execute-pipeline.sh` when running parallel plans.

---

### Pattern 3 — Context compression as explicit config (not just pipeline step)

**Hermes implementation:**
`compression.*` config block: `enabled` (bool), `threshold` (float, default 0.50 — trigger at 50% context fill), `target_ratio` (float, 0.20 — compress to 20% of threshold), `protect_last_n` (int, 20 — always keep last 20 messages). Compression model falls back to main model on 503/404. Auxiliary model overrides (`auxiliary.session_search.provider`, `.max_concurrency`) for parallel summary jobs.

Source: `cli-config.yaml.example` compression section; v0.11.0 release notes ("Compression fallback", "Compression model falls back to main model on permanent 503/404 errors").

**Why it matters for agency delivery:**
Our Wedge B (distiller) triggers compression as a pipeline step after a plan completes. This is correct for structured summaries. Hermes' pattern adds **mid-session auto-compression** triggered by context fill, which is separate — it's a runtime safety valve, not a structured learning capture. Claude Code has `/compact` but no configurable threshold or target ratio. Long pipeline sessions (opus, 50-turn cap) can hit context limits on large diffs.

**Replication confidence: MEDIUM**
Claude Code exposes `compactRatio` in settings (maps roughly to `compression.target_ratio`). We don't have a `threshold`-triggered auto-compact hook. Adding a hook that calls `/compact` when turn count exceeds a threshold is feasible via our existing hook infra, but requires pipeline-level instrumentation to track token usage.

**Suggested wedge:** Fold into **Wedge B plan** (already touches context management). Add `compression.threshold` and `compression.protect_last_n` equivalents as Claude Code settings recommendations in the distiller spec. Explicitly document the distinction between distiller (structured learning) and auto-compression (context safety valve).

---

### Pattern 4 — Mid-run `/steer` without cache-break

**Hermes implementation:**
`/steer <prompt>` injects steering guidance after the agent's next tool call without interrupting the current turn or invalidating the prompt cache. Enabled by v0.11.0. Configured via `display.busy_input_mode: steer` (alongside `interrupt` and `queue`).

Source: v0.11.0 release notes; `cli-config.yaml.example` `display.busy_input_mode`.

**Why it matters for agency delivery:**
During long implementation sessions (50-turn opus runs), there is currently no way to redirect the agent without interrupting. The only option is Ctrl-C (breaks the session) or waiting. For pipeline runs where the reviewer spots an issue during IMPLEMENT, course-correction without cache-break is high value.

**Replication confidence: LOW**
This is a runtime capability of the agent loop itself. Claude Code does not expose a `/steer`-equivalent — interrupting a `claude -p` session requires SIGINT or waiting for it to finish. Replicating this requires a sidecar process that can inject into the running claude subprocess's stdin, which is non-trivial on Windows. Noting as architectural gap, not a near-term wedge.

**Suggested wedge:** Document as a known gap. If Claude Code adds an equivalent API, promote to a wedge. For now, mention in Wedge B notes as a future consideration.

---

### Pattern 5 — Per-job cron toolset limiting + wakeAgent gate

**Hermes implementation:**
Cron job schema includes `enabled_toolsets` (optional list of toolset names — when set, only those tools load, reducing token overhead per job). Separate `wakeAgent` gate: cron scripts can skip agent invocation entirely when output indicates no action needed (analogous to our `[SILENT]` token but implemented as a script-return gate before the LLM is called, not after).

Source: `cron/jobs.py` schema analysis; v0.11.0 release notes ("cron `wakeAgent` gate allowing scripts to skip agent invocation entirely"; "Per-job `enabled_toolsets`").

**Why it matters for agency delivery:**
Our Wedge C implements `[SILENT]` as a post-LLM token — the LLM is always called and decides silence. Hermes' `wakeAgent` gate is pre-LLM: the script runs, and if it returns a no-action signal, the agent is never invoked. This is strictly cheaper (zero LLM cost on quiet runs). `enabled_toolsets` reduces tool-loading overhead for narrow jobs (e.g., a PR-digest cron that only needs `gh` CLI, not all 40 tools).

**Replication confidence: HIGH**
Both patterns are additive to our Wedge C design. `wakeAgent` = add a `--wake-script` flag to `scripts/scheduled-runner.sh` that exits 0 without calling `claude -p` when the script returns a specific exit code (e.g., 42). `enabled_toolsets` = pass `--allowedTools` to `claude -p` in the cron invocation (already supported by Claude Code CLI).

**Suggested wedge:** Fold into **Wedge C plan** as two additive features. Add to Wedge C spec: (1) `--wake-check` flag (pre-LLM gate, analogous to `wakeAgent`); (2) `--allowed-tools` passthrough for per-job tool limiting.

---

### Pattern 6 — MCP server sampling controls

**Hermes implementation:**
Per-MCP-server sampling config: `mcp_servers.<name>.sampling.enabled` (bool), `.model` (override), `.max_tokens_cap` (int, default 4096), `.max_rpm` (requests/min), `.max_tool_rounds` (int, default 5). This caps how many LLM calls an MCP server can make on its own initiative.

Source: `cli-config.yaml.example` MCP section.

**Why it matters for agency delivery:**
We use 5 MCP servers (context7, obsidian, graphify, mempalace, markitdown). Some (mempalace, graphify) could in principle make LLM sampling calls. Without caps, a misbehaving or misconfigured MCP server could burn tokens unchecked. The `max_rpm` and `max_tokens_cap` are a cost-safety pattern that belongs in our Wedge D (pluggable memory provider) spec, which wires MCP adapters together.

**Replication confidence: MEDIUM**
Claude Code's MCP config in `.claude/settings.json` does not expose sampling caps natively (as of our knowledge cutoff). This would require either (a) wrapping MCP server invocations in a proxy that enforces caps, or (b) waiting for Claude Code to add native support. Document as a Wedge D enhancement.

**Suggested wedge:** Fold into **Wedge D plan** as a safety annotation: document recommended caps for each of our 5 MCP servers and add a note to `.claude/rules/` about the risk. Full enforcement is a future item pending Claude Code native support.

---

### Pattern 7 — ACP editor-server mode (identified but classified as counter-pattern)

Described below in Counter-patterns. Included here for completeness.

---

## What changed in the last 30 days

All releases from March 29 – April 28 2026. Cadence: one release every ~4.8 days.

| Release | Date | Headline | Relevant to iago-os? |
|---|---|---|---|
| v0.6.0 | Mar 30 | Isolated agent profiles + MCP server mode | Partial — profiles map to our worktree-per-session pattern |
| v0.7.0 | Apr 3 | Pluggable memory providers + credential pool rotation | YES — directly maps to our Wedge D |
| v0.8.0 | Apr 8 | Background process auto-notifications (`notify_on_complete`) + live `/model` switching | Partial — background notifications map to our pipeline telemetry |
| v0.9.0 | Apr 13 | Local web dashboard + Fast Mode (OpenAI/Anthropic) + iMessage/WeChat + mobile (Termux) | No — research/personal use patterns |
| v0.10.0 | Apr 16 | Nous Tool Gateway (web search, image gen, TTS, browser via subscription) | No — subscription service, not applicable |
| v0.11.0 | Apr 23 | React/Ink TUI rewrite, subagent orchestrator role, shell hooks, webhook direct-delivery, wakeAgent gate, `/steer`, MCP sampling caps, AWS Bedrock, QQBot (#17), compression fallback | YES — 6 of our 7 missed patterns landed in this single release |

**Notable individual commits since Apr 23 (post-release, on main):**
- `214ca94` Apr 28 — `feat(agent): add lmstudio integration` — local inference support
- `01ad0aa` Apr 28 — `fix(tui): show correct context length` — TUI correctness
- `fa2bee1` Apr 28 — `fix(tui): update test for target model` — TUI test fix
- `433d38d` Apr 28 — `chore(docs): update provider docs`
- `5d2f9b5` Apr 28 — `fix: follow-up for salvaged PR #17061`
- `0d957a8` Apr 28 — `fix(tui): surface mouse slash command (#17126)`

Post-release activity is fix/chore — no new features since v0.11.0.

**Key open issues flagged as P1 (as of Apr 28):**
- `#17139` — Cron job Telegram delivery fails: "no delivery target resolved"
- `#17133` — Nix hermes-web npm-deps hash refresh
- `#17138` / `#17141` — API key sanitizer splitting GLM keys incorrectly on startup

These are integration bugs, not architectural regressions. No open issues that affect patterns we're adopting.

---

## Counter-patterns (do NOT copy)

### ACP editor-server mode
Hermes' ACP adapter (`acp_adapter/`) runs Hermes as a JSON-RPC server that VS Code / Zed / JetBrains editors talk to over stdio. The `hermes-acp` toolset intentionally excludes cron, messaging delivery, and other automation. This is an IDE coding-assistant workflow — the agent responds to editor events, not to pipeline triggers. iago-os is a pipeline-driven, terminal-first delivery system. Adopting ACP would add a server process and editor dependency with zero benefit for client delivery. The protocol is Zed/JetBrains-specific and adds risk of version coupling. **Skip entirely.**

### Multi-platform gateway beyond Telegram
Our Wedge F scopes to Telegram first, with Discord/Slack as future expansion. Hermes now supports 17 platforms (v0.11.0 adds QQBot, prior releases added iMessage, WeChat, WeCom, Feishu, DingTalk, Matrix, Signal, Mattermost). The per-platform complexity (policy gating, QR-code device flows, reaction-based processing state) is substantial and research/community-focused. For a 3-person agency, 1–2 channels (Telegram + optionally Slack) is the correct scope. The 17-platform surface is a counter-pattern because each platform adapter carries maintenance cost with no client delivery value. Stick to our scoped Wedge F.

### Nous Tool Gateway (subscription-based managed tools)
v0.10.0 introduced a portal subscription that unlocks web search, image gen, TTS, and browser automation without separate API keys. This is a monetization pattern for Hermes' SaaS offering, not an architectural pattern. We manage our own API keys (Anthropic, OpenAI, AWS). Adopting this would mean depending on Nous Portal uptime. **Not applicable.**

### Skin engine / personality presets
`agent.personalities.<name>` with presets like `kawaii`, `teacher`, `creative`. Research/community user customization. Not relevant to agency delivery — our CLAUDE.md governs agent behavior uniformly per project. **Skip.**

### Trajectory compression for training / datagen-config-examples
The `datagen-config-examples/` directory ships examples for RL training data generation (Atropos trajectories). Already in our "NOT adopting" list. Confirmed no new angle from the last 30 days.

### `privacy.redact_pii` auto-redaction
`privacy.redact_pii: bool` strips phone numbers and hashes IDs before they leave the agent. For a general-purpose agent this is reasonable. For iago-os, we handle client data at the project level (each client repo has its own security posture). A blanket PII-strip in the pipeline would corrupt legitimate test data. Skip — handle at project level instead.

### Human delay simulation
`human_delay.mode: natural` adds 800–2500ms random delays to make the bot feel human. Counterproductive for a delivery pipeline where speed matters. Skip.

---

## Recommendations

### Wedges to ADD (max 3)

**Wedge J — Shell-hook matchers (S, ~0.5d)**
Extend `settings.json` hook entries with `matcher` (regex on tool name) and `timeout_seconds`. Enables scoped pre/post hooks without a full plugin. Example: "before any Edit to `amplify/data/resource.ts`, run schema-validation script." Zero new runtime, pure config extension. High confidence, high leverage.

**Wedge K — Pre-LLM cron wake gate (S, ~0.5d)**
Add `--wake-check <script>` flag to `scripts/scheduled-runner.sh`. If the script exits with a designated "no-wake" code, skip `claude -p` entirely. Cheaper than post-LLM `[SILENT]` token (our current Wedge C design). Can ship as a Wedge C addendum or a standalone micro-wedge. Also add `--allowed-tools` passthrough for per-job toolset limiting.

These are both addendum candidates to existing Wedge C and Wedge H plans rather than full new plan files. Whether they get their own plan files is a judgment call.

### Wedges to MODIFY

**Wedge B (distiller)** — Add compression config recommendation section: document `compression.threshold` (50% fill trigger) and `protect_last_n` (20 messages) equivalents as Claude Code `compactRatio` settings, and explicitly distinguish distiller (structured learning capture) from auto-compression (context safety valve). Low effort, high clarity.

**Wedge C (cron + `[SILENT]`)** — Add pre-LLM wake gate (`--wake-check`) and `--allowed-tools` passthrough as spec addenda. These fold naturally into the plan before it executes.

**Wedge D (memory provider)** — Add MCP sampling caps section: document recommended `max_tokens_cap` and `max_rpm` for each of our 5 MCP servers. Note that enforcement is pending Claude Code native support; document as a manual ops constraint for now.

**Wedge H (webhook + HMAC)** — Update spec to include Hermes v0.11.0's direct-delivery mode: webhooks can bypass LLM entirely for zero-compute push notifications. This is additive to our HMAC subscription design.

### Wedges to DROP

None. All 9 original wedges remain valid. The Hermes patterns are accelerating, not deprecating, any of them.

---

## Sources

- [Hermes Agent GitHub — main repo](https://github.com/NousResearch/hermes-agent) — 123K stars, MIT, Python/React/Ink stack
- [Hermes v0.11.0 release notes (tag v2026.4.23)](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.4.23) — Shell hooks, subagent orchestrator, wakeAgent, /steer, MCP sampling caps, AWS Bedrock
- [RELEASE_v0.11.0.md (raw)](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/RELEASE_v0.11.0.md) — Full feature breakdown with config keys
- [RELEASE_v0.10.0.md (raw)](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/RELEASE_v0.10.0.md) — Nous Tool Gateway, subscription-based managed tools
- [cli-config.yaml.example (raw)](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/cli-config.yaml.example) — Full configuration schema (compression, delegation, MCP sampling, hooks, memory)
- [cron/jobs.py (raw)](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/cron/jobs.py) — Cron job schema: enabled_toolsets, wakeAgent gate, script injection, context_from chaining
- [ACP editor integration docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp) — ACP protocol, VS Code/Zed/JetBrains support, hermes-acp toolset
- [ACP feature doc (raw)](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/acp.md) — ACP internals, session binding, toolset curation
- [Hermes Agent commit history](https://github.com/NousResearch/hermes-agent/commits/main) — Apr 28 most recent; 6 releases in 30 days
- [Hermes v0.8.0 release (tag v2026.4.8)](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.4.8) — Background process monitoring, live model switching, MCP OAuth 2.1
- [newreleases.io v2026.4.16](https://newreleases.io/project/github/NousResearch/hermes-agent/release/v2026.4.16) — v0.10.0 release date confirmation
- [newreleases.io v2026.4.13](https://newreleases.io/project/github/NousResearch/hermes-agent/release/v2026.4.13) — v0.9.0 release date confirmation
- [Hermes official docs](https://hermes-agent.nousresearch.com/docs/) — General overview, feature catalog
