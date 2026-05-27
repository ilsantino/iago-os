# Research: Nous Research `hermes-agent` — what it is, what we steal

**Date:** 2026-04-27
**Question:** What is `NousResearch/hermes-agent`, and what should iago-os borrow from it to be more robust?
**Repo:** https://github.com/NousResearch/hermes-agent
**License:** MIT

---

## TL;DR

Hermes is a self-improving agent CLI by Nous Research — a fork-friendly
successor to "OpenClaw," now at **120K stars and ~17.8K forks** with daily
commits (last push: 2026-04-27). Python, runs on a $5 VPS, talks to Telegram /
Discord / Slack / WhatsApp / Signal from a single gateway. Designed around four
distinguishing primitives we don't have: **(1) autonomous skill creation**,
**(2) cron with script-injection + `[SILENT]` suppression**, **(3) multi-platform
gateway**, and **(4) frozen-snapshot memory with prefix-cache preservation**.

iago-os already wins on the *implementation pipeline* side (8-stage
execute-pipeline.sh, Codex adversarial review, stress test, Amplify-specific
review checks). We do not win on *agent self-improvement*, *messaging
ubiquity*, or *unattended automation*. Those are the three things to steal.

---

## 1. What is it?

**Tagline:** "The agent that grows with you."

**Pitch (`README.md`):**
> The only agent with a built-in learning loop — it creates skills from
> experience, improves them during use, nudges itself to persist knowledge,
> searches its own past conversations, and builds a deepening model of who you
> are across sessions.

**Audience:** Power users who want a Claude-Code-style CLI that (a) outlives
the laptop, (b) runs on cheap infra, (c) exposes itself via chat platforms,
(d) is model-agnostic.

**Migration story:** They explicitly position Hermes as the upgrade path from
OpenClaw — `hermes claw migrate` imports `~/.openclaw/` (SOUL.md, MEMORY.md,
USER.md, skills, allowlists, secrets). Topics on the repo include
`openclaw`, `clawdbot`, `moltbot` — fork lineage from a community Claude Code
re-implementation.

**Maturity signals:**
- 120,324 stars, 17,872 forks, 6,821 open issues (high activity, not abandoned)
- Created 2025-07-22, pushed 2026-04-27 — 9 months of work, daily commits
- 11 release notes (`RELEASE_v0.2.0.md` … `RELEASE_v0.11.0.md`)
- ~15K pytest tests across ~700 files (per `AGENTS.md`)
- Hosted docs site: `hermes-agent.nousresearch.com`

---

## 2. Architecture and abstractions

### Core entry points (per `AGENTS.md`)

| File | LOC | Role |
|------|-----|------|
| `run_agent.py` | ~12K | `AIAgent` — the conversation loop |
| `cli.py` | ~11K | `HermesCLI` — interactive CLI orchestrator |
| `model_tools.py` | — | `discover_builtin_tools()`, `handle_function_call()` |
| `toolsets.py` | — | `_HERMES_CORE_TOOLS` list, toolset definitions |
| `hermes_state.py` | 81KB | `SessionDB` — SQLite + FTS5 |
| `gateway/run.py` | ~9K | `GatewayRunner` — 18 platform adapters |

### Agent loop (`run_agent.py`)

Synchronous, with interrupt + budget tracking. Per `AGENTS.md`:

```python
while (api_call_count < self.max_iterations
       and self.iteration_budget.remaining > 0) \
      or self._budget_grace_call:
    if self._interrupt_requested: break
    response = client.chat.completions.create(
        model=model, messages=messages, tools=tool_schemas)
    if response.tool_calls:
        for tool_call in response.tool_calls:
            result = handle_function_call(tool_call.name, tool_call.args, task_id)
            messages.append(tool_result_message(result))
        api_call_count += 1
    else:
        return response.content
```

Messages are OpenAI-format. Reasoning content stored at `assistant_msg["reasoning"]`.
Three API modes: `chat_completions`, `codex_responses`, `anthropic`.

### Tool registry (`tools/registry.py`)

47 tools across 19 toolsets, each tool **self-registers at import time**. Files
include `delegate_tool.py` (103KB — subagent dispatch),
`mcp_tool.py` (122KB — MCP client), `browser_tool.py` (115KB),
`send_message_tool.py` (68KB — multi-platform delivery),
`mixture_of_agents_tool.py` (22KB — multi-LLM consensus),
`session_search_tool.py` (24KB — FTS5 over past sessions),
`skill_manager_tool.py` (30KB — agent edits its own skills),
`memory_tool.py` (23KB — `add` / `replace` / `remove` actions; **no `read`**),
`cronjob_tools.py` (25KB), `approval.py` (49KB — command allowlist).

### Provider adapters (`agent/`)

Concrete adapters per provider, all bigger than typical glue code:
`anthropic_adapter.py` (72KB), `bedrock_adapter.py` (48KB),
`codex_responses_adapter.py` (45KB), `gemini_native_adapter.py` (34KB),
`gemini_cloudcode_adapter.py` (34KB), `copilot_acp_client.py` (22KB).
Plus `credential_pool.py` (61KB) — multi-key rotation with rate-limit tracking.

### Gateway (`gateway/`)

`GatewayRunner` (`gateway/run.py`) maps platform events → `AIAgent`:
> Platform event → `Adapter.on_message()` → `MessageEvent` →
> `GatewayRunner._handle_message()` → session authorization →
> resolve session key → create `AIAgent` with history →
> `AIAgent.run_conversation()` → deliver response

18 platform adapters: telegram, discord, slack, whatsapp, homeassistant,
signal, matrix, mattermost, email, sms, dingtalk, wecom, weixin, feishu,
qqbot, bluebubbles, webhook, api_server. Cross-platform mirroring via
`gateway/mirror.py`.

### Slash command registry (`hermes_cli/commands.py`)

Single source of truth: `COMMAND_REGISTRY` is a list of `CommandDef` objects.
Every surface derives from it automatically:
- CLI dispatch (`process_command`)
- Gateway dispatch (`GATEWAY_KNOWN_COMMANDS`)
- Telegram BotCommand menu (`telegram_bot_commands()`)
- Slack subcommand routing (`slack_subcommand_map()`)
- Autocomplete (`COMMANDS` flat dict)
- Help (`COMMANDS_BY_CATEGORY`)

Adding an alias = one-line edit to a tuple. **No other file changes.**

### Skills (`skills/`, `optional-skills/`)

Format mirrors Claude Code skills: `SKILL.md` with YAML frontmatter +
`references/`, `templates/`, `scripts/`, `assets/` subdirs. Example
(`skills/dogfood/SKILL.md`):

```yaml
---
name: dogfood
description: "Exploratory QA of web apps: find bugs, evidence, reports."
version: 1.0.0
metadata:
  hermes:
    tags: [qa, testing, browser, web, dogfood]
    related_skills: []
---
```

Frontmatter supports **conditional activation**:
- `requires_toolsets`, `requires_tools` — only show when deps available
- `fallback_for_toolsets`, `fallback_for_tools` — alternative when premium tool unavailable

25 skill categories shipped: apple, autonomous-ai-agents, creative,
data-science, devops, diagramming, dogfood, domain, email, gaming, github,
mcp, media, mlops, note-taking, productivity, red-teaming, research,
smart-home, social-media, software-development, etc.

**Compatible with `agentskills.io` open standard** — cross-agent portability.

### Profile isolation

Each profile gets its own `HERMES_HOME` directory (per `agent/architecture`
docs). Separate config, memory, sessions, logs. Enables concurrent
multi-profile execution without interference. Subagents are spawned as fresh
`AIAgent` instances with isolated session contexts.

---

## 3. Runtime model

| Property | Value |
|----------|-------|
| Concurrency | Synchronous loop, async I/O at gateway boundary |
| Isolation | Per-profile `HERMES_HOME`; subagents = fresh `AIAgent` |
| Persistence | SQLite (`SessionDB`) with FTS5 full-text search |
| Termination | `max_iterations` (default 90) + `iteration_budget` + interrupt |
| Errors | `agent/error_classifier.py` (37KB) categorizes for retry/route |
| Retries | `agent/retry_utils.py` + per-provider rate-limit tracker |
| Long-running | Cron jobs, webhook handlers, gateway runs unattended |
| Deployment | $5 VPS, Docker, SSH host, Daytona, Singularity, Modal serverless |

The "hibernate when idle, wake on demand" pattern (Daytona/Modal backends) is
genuinely interesting for cost — agent infra costs $0 when nobody is talking.

---

## 4. Memory model

Per the docs (`hermes-agent.nousresearch.com/docs/user-guide/features/memory`):

### Resident memory — frozen snapshot pattern

Two files in `~/.hermes/memories/`:
- **`MEMORY.md`** (~2,200 chars / ~800 tokens) — environmental notes (project
  structure, workarounds, conventions)
- **`USER.md`** (~1,375 chars / ~500 tokens) — user identity (style, timezone,
  technical level)

Loaded as **frozen snapshot at session start** — injected into system prompt,
preserves prefix caching. Mid-session writes persist to disk *immediately* but
do not appear in the prompt until next session.

Manipulation: `memory_tool` exposes only `add` / `replace` / `remove` —
**no `read` action** (forbidden because content is always already in context).
`replace` uses substring matching — agent doesn't have to quote full entries.

When approaching capacity, the tool returns an error listing current entries
and the agent consolidates. Best practice: consolidate at 80%.

### Extended memory

- **Session search tool** — FTS5 SQLite queries across all past sessions, then
  Gemini Flash summarizes the matched session(s).
- **Pluggable providers** (`plugins/memory/`) — Honcho, Mem0, Supermemory,
  OpenViking and others. Eight plugins. One active at a time. Add semantic
  search and KG over conversation history.

### Honcho

Third-party "dialectic user modeling" service — builds an evolving model of
the user from observed conversation, queryable by the agent. Plugged in via
`plugins/memory/honcho`.

---

## 5. Novel patterns (vs. LangGraph / AutoGen / Claude Agent SDK)

What's actually novel — not standard agent-loop boilerplate:

### a. Autonomous skill creation

After completing a complex task (5+ tool calls successfully), hitting an
error and finding a solution, receiving a user correction, or discovering a
non-trivial workflow, the agent invokes `skill_manage` with `create` to
distill the experience into a `SKILL.md`. `patch` (token-efficient) is
preferred over `edit` for updates.

This is the *learning loop* the README claims. Most agent frameworks have
neither the trigger nor the tool surface for this.

### b. Progressive skill disclosure

Three-level token-efficient loading:
- `skills_list()` — metadata only, ~3K tokens
- `skill_view(name)` — full skill body
- `skill_view(name, path)` — specific reference file

Distinguishes skills (procedural memory documents) from tools (function calls).

### c. Cron with script injection + `[SILENT]` pattern

From `hermes-already-has-routines.md`:

```bash
hermes cron create "every 1h" \
  "If CHANGE DETECTED, summarize what changed. \
   If NO_CHANGE, respond with [SILENT]." \
  --script ~/.hermes/scripts/watch-site.py \
  --name "Pricing monitor" \
  --deliver telegram
```

The Python `--script` runs *first*; its stdout becomes context for the LLM.
Mechanical work (HTTP fetches, diffs, parsing) happens deterministically in
Python — the LLM only sees the structured result. The agent can emit
`[SILENT]` to suppress delivery — you only get notified when something
actually changed.

### d. Frozen-snapshot memory with prefix caching

Memory is *injected once* per session and cached. Mid-session mutations
persist but don't break the cache. This is a deliberate prefix-cache
optimization most agent frameworks miss.

### e. Multi-platform single-agent gateway

One agent, 18 message platforms, conversation continuity across them.
"Talk to it from Telegram while it works on a cloud VM."

### f. Skill conditional activation

`fallback_for_toolsets` / `requires_tools` in frontmatter — skills appear or
hide based on what's installed. Enables "graceful degradation" packaging.

### g. Central `CommandDef` registry

All slash-command surfaces (CLI, gateway, Telegram menu, Slack subcommands,
autocomplete, help) derive from a single registry. Adding an alias is a
one-line tuple change. Most CLIs duplicate this everywhere.

### h. Webhook with HMAC

`hermes webhook subscribe alert-triage --prompt "..."` — POST endpoint with
HMAC auth, payload templates into prompt. Replaces a lot of glue.

### i. `agentskills.io` open standard

Skills are portable across agents (OpenClaw, Hermes, others). Implies that
their and Anthropic's skill formats are converging on a community spec.

### j. Trajectory compression for training

`trajectory_compressor.py` (65KB) + `environments/` (Atropos RL) — they use
their own agent's history to train next-gen tool-calling models. Research
ouroboros.

---

## 6. Dependencies and runtime

- **Language:** Python 3.11
- **Package manager:** `uv` (Astral)
- **DB:** SQLite + FTS5
- **TUI:** Ink (React) frontend + Python JSON-RPC backend (`tui_gateway/`)
- **Models:** Anthropic, OpenAI, Gemini (native + cloudcode), Bedrock, Codex
  Responses, OpenRouter (200+), NVIDIA NIM, Xiaomi MiMo, z.ai/GLM,
  Kimi/Moonshot, MiniMax, HuggingFace, custom endpoints
- **MCP:** Full client + OAuth manager (`tools/mcp_oauth_manager.py`)
- **OS support:** Linux, macOS, WSL2, Termux. **Native Windows: not supported.**
- **Deployment backends:** local, Docker, SSH, Daytona (serverless),
  Singularity (HPC), Modal (serverless)

---

## 7. Where iago-os already wins, and where it loses

iago-os is *not* a competitor to hermes-agent — we layer on top of Claude
Code, they replaced it. But the comparison surfaces gaps.

### iago-os wins on (keep doing)

| Capability | iago-os | hermes-agent |
|---|---|---|
| Adversarial review pipeline | 8-stage `execute-pipeline.sh` with Codex cross-model | None — agent is the worker, not a delivery system |
| Plan stress-test before exec | Yes (step 0) | No |
| Domain-specific review checks | Amplify, React, data-integrity, i18n modules | No |
| TypeScript / strict-stack discipline | CLAUDE.md + path-scoped rules | Generic |
| Profile composition | 3 bases × 13 capabilities × 12 profiles | Flatter — one `AIAgent` class |
| Plan/execute/verify workflow | `/iago-plan` → `/iago-execute` → `/iago-verify` | None — interactive only |

### hermes-agent wins on (steal)

| Capability | hermes-agent | iago-os today |
|---|---|---|
| Self-authoring skills | `skill_manage` after complex tasks | Manual via `.iago/learnings/` (no automation) |
| Skill self-improvement during use | Token-efficient `patch` action | Manual edit |
| Progressive skill disclosure | `skills_list` / `skill_view` 3-level | Skills auto-loaded into context |
| Cron + script injection + `[SILENT]` | First-class | We have `/iago-schedule` but no script-then-agent + suppression |
| Multi-platform gateway | 18 adapters, one agent | Terminal only |
| Webhook triggers with HMAC | First-class | GH Actions only |
| Pluggable memory providers | Honcho, Mem0, etc. behind one interface | Obsidian + MemPalace + Graphify, three separate MCPs |
| Frozen-snapshot memory pattern | Documented, enforced (no `read` action) | We have it accidentally — not enforced |
| Conditional skill activation | `requires_tools` / `fallback_for_tools` | None |
| Central command registry | `COMMAND_REGISTRY` single source | Claude Code skills folder + manual docs sync |
| Long-running unattended | Daytona/Modal serverless | None |

---

## Sources

- `gh api repos/NousResearch/hermes-agent` — repo metadata (stars, dates, language, topics)
- `README.md` — pitch, install, philosophy
- `AGENTS.md` (35KB) — developer architecture overview, file tree, AIAgent class shape, agent loop pseudocode, gateway/CLI/TUI architecture, slash command registry pattern
- `hermes-already-has-routines.md` — cron + script injection + `[SILENT]` + multi-skill chaining
- `hermes-agent.nousresearch.com/docs/developer-guide/architecture` — class roles, data flow, gateway message routing
- `hermes-agent.nousresearch.com/docs/user-guide/features/skills` — skill format, autonomous creation triggers, progressive disclosure, agentskills.io standard, conditional activation
- `hermes-agent.nousresearch.com/docs/user-guide/features/memory` — frozen snapshot pattern, MEMORY.md vs USER.md, no-read tool surface, FTS5 session search, plugin providers
- `skills/dogfood/SKILL.md` — concrete skill example (mirrors Claude Code skill format)
- Directory listings of `tools/`, `agent/`, `skills/` — tool surface, adapter list, skill catalog

---

## Recommendation

**Decision:** Adopt Hermes patterns into iago-os in 9 sequenced wedges over
~6 weeks. Ship Wedge A (frozen-snapshot MEMORY rule) first as a safe one-hour
proof-of-shipping; queue the rest as `feature-hermes-adoption` plans.

**Confidence:** High on Wedges A–C and E. Medium on D (provider abstraction
needs design). Lower on F (gateway is the biggest ticket; gate behind first
real demand).

**Reasoning:** We are a 3-person consultancy that needs to compound the
operational layer without distracting from client work. Each Hermes pattern
that closes a real iago-os gap (memory hygiene, learning loop, unattended
ops, mobile reachability) is leverage. Each pattern that doesn't (RL
training, Daytona backends) is noise. Adoption order optimizes for
load-bearing wins early, infrastructure-heavy wins later.

**Next step:** Ship Wedge A this PR; spec the rest as `docs/specs/hermes-adoption/`.

**Risk if wrong:** Spending 6 weeks on adoption that should have been 6 days.
Mitigated by per-wedge gating: each wedge ships independently and the next
wedge does not start until the prior wedge has been observed in production.

---

## Adoption Candidates Ranked by Leverage

Ordered high → low. Effort: **S** = ≤1 day, **M** = 2–5 days, **L** = 1–2 weeks.

### Wedge A · Frozen-snapshot MEMORY.md rule  · HIGH · S · SHIP NOW

Documentation rule. Forbids mid-session re-reads of MEMORY.md, with two
narrow exceptions. Audit existing skills for violations. ~1 hour.

### Wedge B · Autonomous skill creation after pipeline  · HIGH · M

Pipeline step 7 distills review/Codex findings into `.iago/learnings/`
candidates after each successful run. Trigger gates: ≥1 Codex finding, ≥2
review rounds, ≥1 build retry. Manual promotion to CLAUDE.md. ~2 days.

### Wedge C · Cron + script injection + `[SILENT]`  · HIGH · M

Extend `/iago-schedule` with `--script` flag. Python script runs first,
stdout becomes prompt context, agent emits `[SILENT]` to skip delivery.
Solves notification fatigue. ~2 days. Includes Windows encoding mitigation
(per `feedback_markitdown_cli_encoding.md`).

### Wedge D · Pluggable memory provider interface  · MED · M

Unify Obsidian + MemPalace + Graphify behind a single `memory_provider`
interface. Each can be swapped or stacked. Inspired by Hermes
`plugins/memory/`. Premature only if we don't see a swap need; useful as
a clean abstraction either way. ~3 days.

### Wedge E · Conditional skill activation (`requires_*` / `fallback_for_*`)  · MED · S

Skill frontmatter declares dependencies. Skill loader hides skills whose
dependencies are missing. `/codex:rescue` only appears when Codex CLI is
installed; `/iago-execute` only appears when `.iago/plans/` exists. ~1 day.

### Wedge F · Multi-platform gateway (Telegram first)  · HIGH · L

Single Node/Python process bridges Telegram → `claude -p` running in a
worktree. Santiago drives iago-os from his phone. One platform first
(Telegram), expand later. ~1.5 weeks.

### Wedge G · Progressive skill disclosure (`skills_list` / `skill_view`)  · MED · M

When the catalog grows past ~80 skills, lazy-load metadata only and
fetch full bodies on demand. Token savings compound. ~3 days. Defer until
catalog actually grows.

### Wedge H · Webhook subscriptions with HMAC  · MED · M

`/iago-webhook subscribe` registers an HMAC-protected POST endpoint that
templates request payload into a prompt. Could replace some GH Actions
glue. ~3 days. Lower priority — GH Actions works.

### Wedge I · `agentskills.io` standard compliance  · LOW · S

Add the standard's frontmatter fields so iago-os skills are portable
across agents. Cosmetic unless we publish skills externally. ~0.5 day.

### SKIPPED

- Mixture-of-Agents tool — `/council` already covers this
- RL training environments (Atropos) — irrelevant to consulting
- Daytona/Modal serverless backends — no need for cloud sandboxing
- Skin engine — cosmetic
- Trajectory compression for training — research ouroboros, not delivery

---

## Final Verdict

**Sequence:** A → B → C → E → D → G → H → F → I.

A first because it's the cheapest and proves the shipping cadence works.
B and C compound operational leverage immediately. E is a small UX win that
makes the next wedges cleaner. D is the foundation for any cross-tool
memory work. G and H are infrastructure investments that pay off later.
F is the biggest, gated last. I is cleanup.

The unifying insight: hermes-agent treats the agent as a *thing that lives*
(persistent infra, self-modifying, multi-channel). iago-os treats the agent
as a *thing that delivers* (pipeline, review, ship). Borrow their patterns
for "lives" without giving up our discipline for "delivers."
