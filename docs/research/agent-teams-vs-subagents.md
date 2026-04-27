# Research: Claude Code Agent Teams vs Sub-Agents

**Date:** 2026-04-26
**Question:** When should iago-os use agent teams vs sub-agents, and how do we encode the decision?

---

## TL;DR

- Anthropic's "sub-agent" = iago-os's "agent profile" — same thing, same file format (`.md` + YAML frontmatter), same location (`.claude/agents/`). Vocabulary is already aligned at the file level; the term "profile" is iago-os's composition layer on top.
- "Agent teams" is a distinct Anthropic feature (experimental, disabled by default, requires CC v2.1.32+) where multiple Claude Code **sessions** run in parallel with a shared task list and peer-to-peer messaging. iago-os does not currently use it.
- iago-os's pipeline already replicates most agent-team benefits via sequential `claude -p` sessions. The gap is **parallel independent work** — teams are the only Anthropic-native path for that without manual worktrees.
- Agent teams are still experimental with known bugs (session resumption broken, task status lags, no Windows split-pane). Do not adopt as a default pattern yet.
- The actionable integration is narrow: update vocabulary in docs, add a routing rule for when to reach for teams, and note the feature flag. No new slash command needed.

---

## What Anthropic Says

### Sub-agents

**Canonical URL:** https://code.claude.com/docs/en/sub-agents

A sub-agent is a specialized Claude session defined as a Markdown file with YAML frontmatter, stored in `.claude/agents/` (project scope) or `~/.claude/agents/` (user scope). Claude auto-delegates to it when the task description matches the agent's `description` field, or you can invoke it explicitly via `@agent-name` mention or `--agent` flag.

Key frontmatter fields:

| Field | Purpose |
|-------|---------|
| `name` | Unique ID (kebab-case) |
| `description` | Delegation trigger — Claude reads this to decide when to use the agent |
| `tools` | Allowlist of tools (omit = inherit all) |
| `disallowedTools` | Denylist (applied before `tools` allowlist) |
| `model` | `sonnet`, `opus`, `haiku`, full model ID, or `inherit` (default) |
| `maxTurns` | Cap on agentic turns |
| `skills` | Skill content injected at startup (not inherited from parent) |
| `mcpServers` | MCP servers scoped to this agent only |
| `hooks` | Lifecycle hooks (PreToolUse, PostToolUse, Stop) |
| `memory` | Persistent memory directory: `user`, `project`, or `local` |
| `permissionMode` | Override permission mode |
| `isolation` | `worktree` = isolated git worktree per run |
| `background` | `true` = always run async |

The body of the file is the agent's system prompt. Sub-agents **cannot spawn other sub-agents** — nesting is blocked.

Each sub-agent runs in its own context window. Results summarize back to the caller's context. For parallel work, multiple sub-agents can be spawned and run concurrently, but they only report back to the main agent — they cannot message each other.

Built-in sub-agents shipped by Anthropic: `Explore` (Haiku, read-only codebase search), `Plan` (read-only planning research), `General-purpose` (full tools, complex tasks).

**Invocation modes:**
1. Automatic — Claude delegates based on `description` match
2. Natural language — "use the X sub-agent to..."
3. @-mention — guarantees the specific agent runs for one task
4. `--agent <name>` — entire session runs as that agent
5. Background — `Ctrl+B` or `background: true` in frontmatter

**Limits:**
- No sub-agent nesting (sub-agents cannot spawn sub-agents)
- Latency cost: sub-agent starts fresh, must rebuild context
- Results from multiple parallel sub-agents all return to main context — can fill it fast

### Agent teams

**Canonical URL:** https://code.claude.com/docs/en/agent-teams

Agent teams are an **experimental feature** (disabled by default) where multiple Claude Code **sessions** run in parallel, coordinated by a "team lead" session. They are not a marketing term — they are a distinct technical feature requiring `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and CC v2.1.32+.

Key distinction from sub-agents: teammates **communicate peer-to-peer** via a mailbox system and share a **task list**. Sub-agents only report back to the caller.

Architecture:

| Component | Role |
|-----------|------|
| Team lead | Main CC session that creates and coordinates the team |
| Teammates | Separate CC instances, each in its own context window |
| Task list | Shared work items with locking (file-based, prevents race conditions) |
| Mailbox | Peer messaging between agents by name |

Teammate spawning: natural language instruction to the lead ("create a team with 3 reviewers..."). Lead decides structure, or you specify exactly. You can reference a sub-agent definition by name when spawning a teammate — it inherits `tools` and `model`, with the definition body appended to the teammate's system prompt.

Storage: `~/.claude/teams/{name}/config.json` (runtime state, auto-generated, do not edit manually).

**Known limitations (current):**
- `/resume` and `/rewind` do not restore in-process teammates
- Task status can lag (teammates fail to mark tasks complete)
- Shutdown can be slow
- One team per session, no nested teams
- Split-pane mode requires tmux or iTerm2 — **not supported on Windows Terminal**
- `skills` and `mcpServers` frontmatter fields are ignored when a sub-agent definition runs as a teammate

Best use cases per Anthropic:
- Parallel research/review (multiple reviewers, different lenses)
- New modules where teammates own separate file sets
- Debugging with competing hypotheses (adversarial parallel investigation)
- Cross-layer coordination (frontend + backend + tests owned by different teammates)

**Token cost:** significantly higher than sub-agents — each teammate is a full independent context.

### Comparison table

| Dimension | Sub-agent | Agent team |
|-----------|-----------|------------|
| Stability | GA | Experimental |
| Communication | Reports to caller only | Peer-to-peer via mailbox |
| Coordination | Caller manages all work | Shared task list, self-coordinating |
| Context | Own window; result summarized back | Own window; fully independent |
| Nesting | Cannot spawn sub-agents | Cannot spawn teams, no nested teams |
| Parallelism | Multiple can run concurrently (results flood main context) | Native parallel with sustained context isolation |
| Windows support | Full | Split-pane not supported; in-process works |
| Token cost | Lower | Higher (scales linearly with teammates) |
| Invocation | Automatic or @-mention | Natural language to lead |
| Config | `.claude/agents/*.md` | Dynamic via lead; sub-agent defs reusable as teammate roles |
| Resume | Yes | Broken for in-process teammates |
| File conflicts | Not applicable | Real risk — must partition file ownership |

---

## How iaGO-OS Already Uses Agents

Current architecture (from `.claude/agents/`):

**3 bases** — define tool access tiers:
- `executor.md` — read+write+run, model: opus. For code-writing tasks.
- `analyst.md` — read+run only (no Edit/Write), model: sonnet. For reviews and diagnostics.
- `operator.md` — read+run+WebSearch+WebFetch, model: sonnet. For research and infra.

**13 capability modules** (`.claude/agents/capabilities/`) — injected into agent prompts by the orchestrator. Examples: `react-19`, `dynamodb`, `lambda`, `tdd`, `review-spec`, `review-quality`, `security`, `animation`.

**12 profiles** (`.claude/agents/profiles/`) — pre-composed base + capability set. Examples: `fullstack.md` (executor + react-19 + dynamodb + lambda + tdd + forms + animation), `review-full.md` (analyst + security + review-spec + review-quality), `research.md` (operator + dynamic capabilities).

**Dispatch model:** the pipeline (`scripts/execute-pipeline.sh`) calls `claude -p` as fresh subprocess sessions — not the Task/Agent tool. Each pipeline stage is a separate `claude -p` invocation with explicit `--model`, `--max-turns`, `--allowedTools`, and a system prompt constructed inline. The `.claude/agents/` profile files are not read by the pipeline directly — they document the agent architecture but the pipeline builds its own prompts inline.

**Hub-and-spoke:** only the orchestrator (main session) dispatches agents. Agents never spawn agents. This matches Anthropic's sub-agent nesting restriction exactly.

---

## Gaps and Alignment

### Vocabulary

iago-os's "agent profile" = Anthropic's "sub-agent" at the file-format level. Both:
- Live in `.claude/agents/`
- Use `.md` files with YAML frontmatter
- Have `name`, `description`, `model`, `tools`, `maxTurns` fields

iago-os additions on top: `base` (inheritance pointer) and `capabilities` (list of modules to inject). These are iago-os conventions not in the Anthropic spec — they're documentation only; the pipeline reads `base` and `capabilities` to know which modules to concatenate when building dispatch prompts.

**Critical gap:** The pipeline does not use the Anthropic `Agent` tool or `@-mention` invocation at all. It calls `claude -p` as a subprocess. This means iago-os profiles are not true Anthropic sub-agents in runtime terms — they're reference docs for prompt construction. This is intentional (avoids context bleed, gives explicit control) but means features like `memory`, `hooks`, `isolation: worktree`, and `skills` frontmatter fields have no effect unless the profile is invoked via the Agent tool directly.

### Missing concepts

1. **`isolation: worktree`** — Anthropic supports running sub-agents in an isolated git worktree. iago-os uses `iago-wt` for this manually. The two approaches don't conflict, but the sub-agent-native path isn't wired in.

2. **`memory`** — Anthropic's persistent memory for sub-agents. iago-os uses MemPalace for conversation memory and `.iago/learnings/` for review patterns. No overlap at the sub-agent file level.

3. **`skills` preloading in sub-agents** — iago-os injects capability modules inline via prompt construction. Anthropic's `skills` field in frontmatter does the same thing but through the Claude Code runtime. If iago-os profiles were invoked via the Agent tool, the `skills` field could replace the manual capability injection.

4. **Agent teams** — no equivalent in iago-os today. The pipeline runs stages sequentially, not in parallel. The nearest analog is multi-plan phases where `/iago-execute` iterates over plans — but those are sequential, not concurrent teammates.

---

## Decision Criteria (proposed)

### When to use a sub-agent directly (@-mention or `--agent`)
- Task is self-contained, one concern, produces a summary you need in main context
- You want to enforce tool restrictions (e.g., read-only research, no writes)
- Cost matters and the task can return a compact result
- Example: `@research audit the auth module for JWT handling patterns`

### When to let the orchestrator decide (current default — pipeline or main session)
- Multi-step implementation (pipeline handles this via sequential `claude -p`)
- Task requires iterative refinement or back-and-forth
- Multiple phases share context (plan → implement → review)
- Latency matters (sub-agents rebuild context from scratch)

### When to use agent teams (future — not yet)
- N independent parallel tracks where teammates need to share findings mid-flight
- Adversarial review where reviewers should challenge each other's conclusions
- Parallel implementation of non-overlapping modules where you want sustained isolation
- Prerequisite: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` + CC v2.1.32+, Windows split-pane not supported

**Hard rule:** do not use agent teams for anything in the sequential pipeline (stress → impl → review → codex). Those stages depend on each other's outputs. Teams are for fan-out work, not pipelines.

**Team size:** 3-5 teammates maximum. Coordination overhead past that exceeds the parallelism benefit.

---

## Integration Proposal

### 1. CLAUDE.md — Agents section (minor update)

Current text: "3 bases, 13 capabilities, 12 profiles"

Add one sentence: "Profiles are Anthropic sub-agents (`.claude/agents/*.md` + YAML frontmatter). The pipeline dispatches them as `claude -p` subprocesses, not via the Agent tool — capability injection is done via inline prompt construction."

Add to Model Routing table: note that agent teams are available experimentally but not used in the pipeline.

### 2. available-skills.md — Agent Architecture section

Add a row to the MCP Servers table (or a new section):

```
| Agent teams | Experimental Anthropic feature: multiple CC sessions with shared task list + peer messaging. Not used in the pipeline. Opt-in: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. Best for parallel research/review tracks. |
```

Add decision table (3 rows: sub-agent direct, orchestrator/pipeline, agent team) with the criteria from the section above.

### 3. No new /team slash command

Agent teams are invoked through natural language to the lead session. There is no config file to author. A `/team` skill would just be a wrapper around "create an agent team..." — not worth the overhead while the feature is experimental and broken on Windows (split-pane).

### 4. No renaming "profiles" to "sub-agents"

"Profile" = base + capabilities composition. "Sub-agent" = the Anthropic runtime concept. They overlap at the file format but "profile" carries the iago-os-specific meaning of a pre-composed base + capability set. Keep "profile" in internal docs, note the mapping to Anthropic's "sub-agent" once in CLAUDE.md.

---

## Recommendation

**Decision:** Acknowledge alignment, document the gap, defer agent teams until stable on Windows.

**Confidence:** High

**Reasoning:** iago-os profiles are structurally identical to Anthropic sub-agents at the file level — no migration needed. The pipeline's `claude -p` dispatch pattern deliberately bypasses the Agent tool for control reasons; this is correct and should not change. Agent teams solve a real problem (parallel independent work) but are experimental, broken on Windows terminal split-pane, and the iago-os pipeline is sequential by design. The only immediately actionable change is a vocabulary note in CLAUDE.md and a routing rule in available-skills.md.

**Next step:** Add a "When to reach for agent teams" routing entry to `available-skills.md` Agent Architecture section (5-line addition, no code changes). Revisit when agent teams ship stable + Windows support.

**Risk if wrong:** If agent teams stabilize before the docs are updated, Santiago might reach for them manually without knowing the file-conflict risk or the Windows limitation. The docs addition mitigates that.

---

## Sources

- https://code.claude.com/docs/en/sub-agents — full sub-agent spec: frontmatter fields, invocation modes, scope priority, built-in agents, fork mode, tool restrictions, permission modes, memory, hooks. Primary reference for vocabulary alignment.
- https://code.claude.com/docs/en/agent-teams — agent teams: architecture, task list, mailbox, display modes, limitations, best practices, comparison table with sub-agents. Primary reference for the experimental feature assessment.
- `C:\Users\sanal\dev\iago-os\.claude\agents\executor.md` — base agent format, tool list, maxTurns, system prompt structure.
- `C:\Users\sanal\dev\iago-os\.claude\agents\profiles\fullstack.md` — profile composition: base + capabilities fields.
- `C:\Users\sanal\dev\iago-os\.claude\agents\profiles\research.md` — dynamic capability injection pattern.
- `C:\Users\sanal\dev\iago-os\.claude\agents\profiles\review-full.md` — two-stage gated review as profile.
- `C:\Users\sanal\dev\iago-os\scripts\execute-pipeline.sh` (lines 91-268) — confirms pipeline uses `claude -p` subprocess dispatch, not Agent tool; each stage is an inline prompt, not a profile file read.
