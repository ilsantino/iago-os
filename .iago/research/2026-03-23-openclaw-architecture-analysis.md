# OpenClaw / NemoClaw Architecture Analysis
## Mapping ruflo & everything-claude-code into OpenClaw

---

## 1. Executive Summary

**ruflo** (by ruvnet) and **everything-claude-code** (ECC, by affaan-m) are two mature frameworks that extend Claude Code with enterprise-grade agent orchestration, skills, hooks, memory, and multi-agent coordination. Both target the same problem: turning Claude Code from a single-agent CLI into a full orchestration platform.

**OpenClaw** (by Peter Steinberger) is an open-source AI agent gateway — a long-running Node.js daemon that routes messages between chat channels (WhatsApp, Discord, Telegram, Slack) and LLM backends (Claude, GPT, Gemini, local models). It has its own skills, hooks, memory, sandboxing, and plugin system.

**NemoClaw** is NVIDIA's security/sandboxing layer that wraps OpenClaw inside NVIDIA OpenShell, adding filesystem isolation, network policy enforcement, and inference routing through NVIDIA cloud endpoints.

**The core finding:** OpenClaw already provides ~60% of what ruflo and ECC implement. The remaining ~40% — particularly the self-learning loops, swarm consensus, deep eval harnesses, and multi-agent coordination patterns — would need to be custom-built as OpenClaw plugins or skill modules. Claude Code's native features (subagents, CLAUDE.md, hooks, memory) can be accessed *through* OpenClaw via ACP (Agent Client Protocol) sessions.

---

## 2. Correct Terminology Glossary

| Term | Correct Definition |
|------|-------------------|
| **Agent Harness** | The runtime that executes the AI loop: context assembly → model invocation → tool execution → state persistence. In OpenClaw = PiEmbeddedRunner. In Claude Code = the CLI process itself. |
| **Orchestration Layer** | The component coordinating multiple agents, routing tasks, managing sessions. OpenClaw = Gateway. ruflo = Q-Learning Router + Swarm Coordinator. ECC = commands layer + multi-plan/multi-execute. |
| **Skills Framework** | Pluggable capability modules injected into agent context at runtime. All three systems use `SKILL.md` files with YAML frontmatter. OpenClaw selectively injects relevant skills per turn. |
| **Hook System** | Event-driven callbacks triggered by lifecycle events (session start/end, tool use, file changes). OpenClaw = TypeScript handlers. Claude Code = JSON config in settings.json. ECC = 15+ event types with DRY adapters. |
| **Memory Persistence** | Long-term state stored across sessions. OpenClaw = SQLite + vector embeddings + MEMORY.md. Claude Code = file-based `.claude/memory/`. ruflo = AgentDB with hierarchical tiers. |
| **Command Layer** | User-facing slash commands that invoke skills, agents, or workflows. Claude Code = `.claude/commands/`. ECC = 60+ commands. OpenClaw = CLI + `/acp` commands. |
| **Subagent Model** | Mechanism for spawning child agents with constrained scope. Claude Code = Agent tool (Explore, Plan, general-purpose). OpenClaw = ACP sessions + `sessions_spawn()`. ruflo = Queen-Worker swarms. |
| **Eval/Verification Loop** | Automated quality gates that validate agent output. ECC = verification-loop skill + eval-harness. ruflo = RETRIEVE→JUDGE→DISTILL→CONSOLIDATE→ROUTE cycle. |
| **Gateway** | OpenClaw-specific: the central Node.js daemon (port 18789) that routes all messages between channels and agents. Not present in ruflo or ECC (they run inside Claude Code directly). |
| **ACP (Agent Client Protocol)** | OpenClaw's protocol for spawning external coding harnesses (Claude Code, Codex, etc.) as backend sessions. Key bridge between OpenClaw and Claude Code features. |
| **NemoClaw** | NVIDIA's OpenClaw plugin for OpenShell. Adds sandboxing, network policy, and inference routing. Alpha software as of March 2026. |
| **SONA** | ruflo's Self-Optimizing Neural Architecture — reinforcement learning layer for continuous pattern improvement. |
| **AgentShield** | ECC's security auditor: 3-agent red-team/blue-team/auditor pipeline scanning for secrets, permission issues, and hook injection. |

---

## 3. Repo-by-Repo Breakdown

### 3.1 ruflo (ruvnet/ruflo)

**What it is:** Enterprise AI orchestration platform (v3.5) extending Claude Code with self-learning capabilities and coordinated agent swarms.

#### Architecture Layers

| Layer | Components | Key Files |
|-------|-----------|-----------|
| **Entry** | CLI + MCP server + AIDefence security | Root config, MCP integration |
| **Routing** | Q-Learning router, 8 MoE specialists | `.agents/config.toml` |
| **Swarm Coordination** | 4 topologies (hierarchical, mesh, ring, star), 3 consensus algos | `.agents/agent-swarm/`, coordinator agents |
| **Agent Layer** | 60+ specialized agents | `.agents/agent-*/SKILL.md` |
| **Resource** | AgentDB, multi-LLM providers, 12 background workers | `.agents/agentdb-*/` |
| **Intelligence (RuVector)** | SONA, EWC++, Flash Attention, HNSW vector search | Neural/learning agent dirs |
| **Learning Loop** | RETRIEVE→JUDGE→DISTILL→CONSOLIDATE→ROUTE | Hooks + ReasoningBank |

#### Agent Types (130+ skill directories)
- **Core**: coder, planner, reviewer, tester, researcher
- **Coordinators**: queen (strategic/tactical/adaptive), hierarchical, mesh, consensus, byzantine, gossip
- **Domain**: security-manager, performance-benchmarker, trading-predictor, data-ml-model
- **GitHub**: PR-manager, issue-tracker, release-manager, multi-repo-swarm
- **Infrastructure**: CI/CD, workflow-automation, load-balancer, resource-allocator

#### Orchestration Model
- Queen-led swarms with worker specialization across 8 categories
- Three queen types: Strategic (planning), Tactical (execution), Adaptive (optimization)
- Byzantine consensus: tolerates 1/3 failing agents, 2/3 supermajority, queens weighted 3x
- Raft consensus for leader election in hierarchical topologies

#### Memory Architecture
- **3-tier**: Working (1MB) → Episodic → Semantic
- **Vector search**: HNSW indexing, ONNX local embeddings (384-dim, ~3ms)
- **Knowledge graph**: PageRank + label propagation
- **Scopes**: project / local / user with cross-agent transfer

#### Skills & Routing (Cost Optimization)
1. Agent Booster (WASM): simple transforms, <1ms, zero tokens
2. Haiku/Sonnet: medium tasks, ~500ms
3. Opus: complex architectural decisions
- Claims 2.5x extension of Claude Max, 75% API cost reduction

#### Hooks
- 32 lifecycle hooks: task, session, intelligence, worker, progress
- Auto-trigger on file changes, patterns detected, session events
- Feed patterns into ReasoningBank learning cycle

#### Security
- AIDefence security scanning at entry
- Per-agent memory isolation (3 scopes)
- Configurable approval policies: dev (unrestricted), safe (read-only), ci (workspace-write)
- Max 8 concurrent agents, 512MB per-agent memory limit

---

### 3.2 everything-claude-code (affaan-m/everything-claude-code)

**What it is:** Performance optimization system for AI agent harnesses. Hackathon-winning framework providing skills, instincts, memory, security, and research-first development across Claude Code, Cursor, Codex, and OpenCode.

#### Architecture Layers

| Layer | Count | Key Path |
|-------|-------|----------|
| **Agents** | 28 specialized subagents | `.claude/agents/`, `.kiro/agents/` |
| **Skills** | 119 workflow definitions | `.agents/skills/`, `.claude/skills/` |
| **Commands** | 60 slash commands | `.claude/commands/`, `.opencode/` |
| **Rules** | 34 always-follow guidelines | `.claude/rules/` (common + per-language) |
| **Hooks** | 15+ event types | `.claude-plugin/hooks/hooks.json`, `.cursor/hooks/` |
| **MCP Configs** | Multiple integrations | GitHub, Supabase, Vercel, Railway, Playwright |

#### Cross-Platform Support
| Harness | Hooks | Commands | Skills |
|---------|-------|----------|--------|
| Claude Code | 8 event types | 52 | 102 |
| Cursor | 15 event types | Shared | Shared |
| Codex | None yet | Instruction-based | 10 |
| OpenCode | 11 event types | 31 | 37 |

#### Skills System
- YAML frontmatter: `description`, `globs`, domain metadata
- Categories: testing/TDD, security, 12 language ecosystems, framework-specific (Django, Spring Boot, Laravel), content/research, DevOps
- Selective injection — only relevant skills loaded per turn

#### Hooks System
- DRY adapter pattern: Cursor reuses Claude Code hooks via `adapter.js`
- Key hooks: SessionStart (load context), SessionEnd (save state), PreToolUse, PostToolUse
- Verification hooks: pre-compilation checks, console.log warnings, secret detection
- Configurable via environment: `ECC_HOOK_PROFILE=standard|minimal|strict`

#### Memory & Continuous Learning
- Session state via SQLite stores
- `continuous-learning-v2` skill: instinct-based learning with confidence scoring
- Commands: `/instinct-status`, `/instinct-import`, `/instinct-export`, `/evolve`
- Auto-extracts patterns from sessions into reusable skills
- Strategic compaction at logical breakpoints vs auto-compaction

#### Security: AgentShield
- 3 Claude Opus 4.6 agents: red-team → blue-team → auditor
- 1282 tests, 102 rules
- Scans: secrets (14 patterns), permissions, hook injection, MCP risk, agent config
- Output: terminal, JSON (CI), Markdown, HTML; exit code 2 on critical findings

#### Folder Structure
```
.agents/skills/          # 40+ skill modules
.claude/
  commands/              # Slash command definitions
  enterprise/            # Enterprise controls
  homunculus/            # Instinct configurations
  research/              # Research playbooks
  rules/                 # Guardrails (common/ + per-language)
  skills/                # Skill modules
  team/                  # Team configuration
.claude-plugin/
  hooks/hooks.json       # Hook definitions
  scripts/               # install.sh, uninstall.sh, verify.sh
.cursor/                 # Cursor IDE hooks and rules
.codex/                  # Codex agent configurations
.kiro/                   # Kiro agent framework
  agents/                # 17+ specialized agents
  hooks/                 # Automated workflow hooks
  skills/                # Technical skill modules
  steering/              # Development guidance
.opencode/               # OpenCode commands (40+)
```

---

## 4. OpenClaw Equivalent Mapping Table

| Concept | ruflo Implementation | ECC Implementation | OpenClaw Equivalent | Native or Custom? |
|---------|---------------------|-------------------|--------------------|--------------------|
| **Agent Harness** | Claude Code CLI + MCP server | Claude Code CLI | PiEmbeddedRunner (Gateway agent runtime) | **Native** |
| **Orchestration** | Q-Learning router + swarm coordinator + queen agents | `/multi-plan` + `/multi-execute` commands | Gateway message routing + `agents.mapping` + ACP sessions | **Partial** — routing native, swarm consensus = custom plugin |
| **Skills** | 42+ SKILL.md files in `.agents/` | 119 SKILL.md files across `.agents/skills/` + `.claude/skills/` | Skills directory with SKILL.md files, selective injection per turn | **Native** — OpenClaw already has skill discovery + injection |
| **Hooks** | 32 lifecycle hooks (task, session, intelligence, worker) | 15+ event types, DRY adapter pattern | TypeScript handlers in hooks directory, discovered from workspace → managed → bundled | **Native** — but fewer event types; custom hooks needed for learning triggers |
| **Memory** | AgentDB v3: 3-tier hierarchical, HNSW vectors, knowledge graph | SQLite state stores + instinct-based learning | SQLite + vector embeddings (`~/.openclaw/memory/`), MEMORY.md, hybrid search (vector + BM25) | **Partial** — base memory native; hierarchical tiers + knowledge graph = custom plugin |
| **Commands** | N/A (skill-based routing) | 60 slash commands in `.claude/commands/` | CLI commands + `/acp` commands | **Partial** — CLI commands native; custom slash commands via skills |
| **Rules/Instructions** | System prompts via agent SKILL.md | 34 rules in `.claude/rules/` (common + per-language) | `AGENTS.md` + `SOUL.md` + `TOOLS.md` workspace files | **Native** — workspace files compose system prompt |
| **Subagent Model** | Queen-Worker swarms with consensus algorithms | 28 specialized subagents via Claude Code Agent tool | ACP sessions (`runtime: "acp"`) + native sub-agents (`runtime: "subagent"`) | **Native** — ACP is the bridge; consensus algorithms = custom |
| **Security/Sandboxing** | AIDefence + per-scope isolation + approval policies | AgentShield (3-agent red/blue/auditor) | Docker sandbox per session, DM/group policy, tool precedence hierarchy | **Partial** — sandbox native; AI-powered security scanning = custom |
| **Eval/Verification** | RETRIEVE→JUDGE→DISTILL→CONSOLIDATE→ROUTE learning cycle | `verification-loop` + `eval-harness` skills | Not native — build as custom skill + hook combination | **Custom build required** |
| **Self-Learning** | SONA + EWC++ + Flash Attention + 9 RL algorithms | `continuous-learning-v2` instinct system | Not native — build as custom plugin with vector memory integration | **Custom build required** |
| **Multi-LLM Routing** | 3-tier cost optimization (WASM → Haiku → Opus) | Token optimization recommendations | `models` config with primary/fallback selection | **Partial** — model selection native; intelligent cost-routing = custom |
| **Channel Integration** | N/A (runs inside Claude Code) | N/A (runs inside Claude Code) | WhatsApp, Discord, Telegram, Slack, iMessage, Signal, Teams, Google Chat | **Native** — this is OpenClaw's core strength |
| **Plugin System** | N/A | `.claude-plugin/` with marketplace | `openclaw.extensions` in package.json, hot-loaded plugins | **Native** |
| **Configuration** | `.agents/config.toml`, approval policies | `settings.json`, `.env`, hook profiles | `~/.openclaw/openclaw.json` (JSON5), `~/.openclaw/credentials/` | **Native** |

---

## 5. Recommended OpenClaw Architecture

### System Design

```
┌─────────────────────────────────────────────────────┐
│                   CHANNELS                           │
│  Discord │ Telegram │ Slack │ WhatsApp │ Web UI │CLI │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              OPENCLAW GATEWAY                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Channel      │  │ Session      │  │ Auth &     │ │
│  │ Adapters     │  │ Manager      │  │ DM Policy  │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────┘ │
│         │                │                           │
│  ┌──────▼────────────────▼──────────────────────┐   │
│  │         AGENT ROUTING LAYER                   │   │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────┐ │   │
│  │  │ agents   │  │ Model     │  │ Cost      │ │   │
│  │  │ .mapping │  │ Selection │  │ Router    │ │   │
│  │  └──────────┘  └───────────┘  └───────────┘ │   │
│  └──────────────────────┬───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│              AGENT RUNTIME LAYER                     │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  CONTEXT ASSEMBLY                            │    │
│  │  AGENTS.md + SOUL.md + Skills + Memory +     │    │
│  │  Tool Defs + Session History                 │    │
│  └──────────────────────┬──────────────────────┘    │
│                         │                            │
│  ┌──────────────────────▼──────────────────────┐    │
│  │  SKILL ENGINE                                │    │
│  │  ┌──────────┐ ┌───────────┐ ┌────────────┐ │    │
│  │  │ Core     │ │ Domain    │ │ Research   │ │    │
│  │  │ Skills   │ │ Skills    │ │ Skills     │ │    │
│  │  └──────────┘ └───────────┘ └────────────┘ │    │
│  └──────────────────────┬──────────────────────┘    │
│                         │                            │
│  ┌──────────────────────▼──────────────────────┐    │
│  │  HOOK SYSTEM                                 │    │
│  │  Session lifecycle │ Tool events │ Learning  │    │
│  └──────────────────────┬──────────────────────┘    │
│                         │                            │
│  ┌──────────────────────▼──────────────────────┐    │
│  │  TOOL EXECUTION                              │    │
│  │  ┌────────┐ ┌──────┐ ┌──────────┐ ┌──────┐ │    │
│  │  │ Bash   │ │ File │ │ Browser  │ │ ACP  │ │    │
│  │  │ (sand- │ │ Ops  │ │ Auto     │ │ (CC) │ │    │
│  │  │ boxed) │ │      │ │          │ │      │ │    │
│  │  └────────┘ └──────┘ └──────────┘ └──────┘ │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│              PERSISTENCE LAYER                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ Session  │  │ Memory    │  │ Config           │ │
│  │ Store    │  │ (SQLite + │  │ (openclaw.json + │ │
│  │ (events) │  │ vectors)  │  │ credentials/)    │ │
│  └──────────┘  └───────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│              CUSTOM PLUGINS (build these)            │
│  ┌────────────┐ ┌──────────────┐ ┌───────────────┐ │
│  │ Eval/      │ │ Learning     │ │ Swarm         │ │
│  │ Verify     │ │ Engine       │ │ Coordinator   │ │
│  │ Plugin     │ │ Plugin       │ │ Plugin        │ │
│  └────────────┘ └──────────────┘ └───────────────┘ │
│  ┌────────────┐ ┌──────────────┐ ┌───────────────┐ │
│  │ Security   │ │ Cost Router  │ │ Multi-Agent   │ │
│  │ Scanner    │ │ Plugin       │ │ Consensus     │ │
│  │ Plugin     │ │              │ │ Plugin        │ │
│  └────────────┘ └──────────────┘ └───────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Recommended Folder Structure

```
~/.openclaw/
  openclaw.json              # Global gateway config
  credentials/               # API keys, tokens (0600 perms)
  memory/                    # Per-agent SQLite memory DBs
  sessions/                  # Append-only session event logs
  plugins/                   # Custom plugin packages

~/openclaw-workspace/        # Your main workspace
  AGENTS.md                  # Global agent instructions
  SOUL.md                    # Agent personality/rules
  TOOLS.md                   # Available tools documentation

  skills/                    # Skill modules
    core/                    # Always-available skills
      code-review.md
      tdd.md
      security-review.md
      plan.md
    domain/                  # Domain-specific skills
      backend-patterns.md
      frontend-patterns.md
      api-design.md
    research/                # Research workflow skills
      deep-research.md
      verification-loop.md
      eval-harness.md
    learning/                # Self-learning skills
      instinct-capture.md
      pattern-evolution.md

  agents/                    # Agent role definitions
    core/
      coder.md
      reviewer.md
      planner.md
      researcher.md
    specialist/
      security-auditor.md
      performance-analyzer.md
    coordinator/
      orchestrator.md        # Multi-agent coordination

  hooks/                     # Event-driven automations
    session-start.ts         # Load context on session start
    session-end.ts           # Persist state on session end
    post-tool.ts             # Post-tool verification
    learning-capture.ts      # Extract patterns from completions

  rules/                     # Always-follow guidelines
    common/                  # Language-agnostic rules
      coding-standards.md
      security-policy.md
    typescript/
    python/
    go/

  commands/                  # Slash command definitions
    plan.md
    tdd.md
    code-review.md
    eval.md
    research.md

  plugins/                   # Custom OpenClaw plugins
    eval-verify/             # Eval/verification loop plugin
      package.json
      src/
    learning-engine/         # Pattern learning plugin
      package.json
      src/
    cost-router/             # Intelligent model routing
      package.json
      src/
    agent-shield/            # Security scanning plugin
      package.json
      src/

  clients/                   # Per-client configurations
    client-a/
      AGENTS.md              # Client-specific instructions
      skills/                # Client-specific skills
      openclaw.override.json # Config overrides
    client-b/
      AGENTS.md
      skills/
```

---

## 6. What Lives Where

### Global (Gateway-level: `~/.openclaw/`)

| Component | Rationale |
|-----------|-----------|
| `openclaw.json` | Gateway config: ports, models, channel auth, sandbox defaults |
| `credentials/` | API keys, tokens — never in workspace |
| Core plugins | Eval, learning, cost-router — shared across all workspaces |
| Memory SQLite DBs | Agent memory persists across sessions |
| Session event logs | Conversation history |

### Per-Client (Workspace-level: `~/openclaw-workspace/clients/<client>/`)

| Component | Rationale |
|-----------|-----------|
| `AGENTS.md` override | Client-specific instructions, context, constraints |
| Domain skills | Client-specific workflow skills |
| Custom rules | Client-specific coding standards |
| Config overrides | Model preferences, tool restrictions, sandbox policy |
| Channel bindings | Which channels route to this client's agent |

### Per-Agent (Agent session-level)

| Component | Rationale |
|-----------|-----------|
| Session state | Conversation context, tool call history |
| Working memory | Current task context (ephemeral) |
| Injected skills | Only skills relevant to current turn |
| Sandbox scope | Session-type determines sandbox level (main/DM/group) |
| ACP sessions | If agent spawns Claude Code via ACP, it gets its own session |

---

## 7. MVP Implementation Plan

### Goal: Functional agent system with skills, hooks, memory, and basic multi-agent support

**Timeline: 1-2 weeks**

#### Step 1: Base OpenClaw Setup (Day 1)
- Install OpenClaw, configure `openclaw.json`
- Set up at least one channel (Discord or Telegram)
- Configure Claude as primary model, Sonnet as fallback
- Verify Gateway starts and routes messages

#### Step 2: Workspace & AGENTS.md (Day 1-2)
- Create workspace directory structure
- Write `AGENTS.md` with core instructions (pull from ECC's rules structure)
- Write `SOUL.md` for agent personality/guidelines
- Test that agent responds correctly with workspace context

#### Step 3: Core Skills (Day 2-4)
- Port 10-15 highest-value skills from ECC:
  - `plan.md`, `tdd.md`, `code-review.md`, `security-review.md`
  - `deep-research.md`, `verification-loop.md`
  - `backend-patterns.md`, `frontend-patterns.md`
- Use SKILL.md format with YAML frontmatter
- Verify selective skill injection works

#### Step 4: Hook System (Day 4-5)
- Implement 4 core hooks:
  - `session-start.ts` — load context, inject relevant skills
  - `session-end.ts` — persist session summary to memory
  - `post-tool.ts` — basic verification after tool execution
  - `secret-scan.ts` — scan for leaked secrets in outputs
- Register hooks in workspace

#### Step 5: Memory Configuration (Day 5-6)
- Configure SQLite memory with vector embeddings
- Set up MEMORY.md for curated long-term facts
- Test memory retrieval across sessions
- Configure memory scoping per agent

#### Step 6: ACP Integration (Day 6-8)
- Enable ACP backend plugin
- Configure Claude Code as ACP agent
- Test spawning ACP sessions: `/acp spawn claude`
- Set up permission mode for non-interactive sessions
- Verify thread binding works on Discord/Telegram

#### Step 7: Basic Multi-Agent (Day 8-10)
- Configure `agents.mapping` to route different channels to different agent personas
- Set up 2-3 agent roles (coder, reviewer, researcher) as workspace variants
- Test inter-agent communication via `sessions_send()`

#### Step 8: Security Hardening (Day 10-12)
- Configure sandbox policy (Docker) for DM/group sessions
- Set up DM pairing for access control
- Configure tool access precedence hierarchy
- Basic secret scanning in hooks

#### MVP Deliverables
- Working OpenClaw Gateway with 1+ channels
- 10-15 skills with selective injection
- 4 lifecycle hooks
- Memory persistence across sessions
- ACP bridge to Claude Code
- Basic multi-agent routing
- Sandbox isolation for untrusted sessions

---

## 8. Production-Grade Implementation Plan

### Goal: Full-featured system matching ruflo + ECC capabilities

**Timeline: 4-8 weeks beyond MVP**

#### Phase 1: Advanced Skills Engine (Week 1-2)
- Port remaining ECC skills (119 total) — prioritize by usage
- Implement skill evolution: auto-extract patterns from sessions into new skills
- Build instinct system (`continuous-learning-v2` equivalent)
- Add `/instinct-status`, `/instinct-export`, `/instinct-import`, `/evolve` commands
- Cross-platform skill compatibility (Claude Code, Cursor, Codex via ACP)

#### Phase 2: Eval/Verification Plugin (Week 2-3)
- Build OpenClaw plugin: `eval-verify`
- Implement verification loop: generate → test → validate → iterate
- Eval harness for scoring agent outputs against criteria
- Quality gates that block deployment on failure
- Hook integration: post-tool verification triggers

#### Phase 3: Learning Engine Plugin (Week 3-5)
- Build OpenClaw plugin: `learning-engine`
- Implement pattern capture from successful sessions
- Confidence scoring on learned patterns
- ruflo-inspired cycle: RETRIEVE → JUDGE → DISTILL → CONSOLIDATE → ROUTE
- Vector memory integration for semantic pattern retrieval
- EWC-inspired mechanism to prevent catastrophic forgetting of good patterns

#### Phase 4: Cost Router Plugin (Week 4-5)
- Build OpenClaw plugin: `cost-router`
- 3-tier routing: simple tasks → fast/cheap model, medium → Sonnet, complex → Opus
- Task complexity classifier (can start rule-based, evolve to ML)
- Token budget tracking and alerting
- Per-client cost allocation

#### Phase 5: Multi-Agent Coordination (Week 5-6)
- Implement coordinator agent pattern (ruflo queen equivalent)
- Build consensus mechanism for multi-agent decisions
- Session-based agent-to-agent communication protocol
- Task decomposition: coordinator splits work → spawns worker sessions → collects results
- Conflict resolution when agents disagree

#### Phase 6: Security Scanner Plugin (Week 6-7)
- Build OpenClaw plugin: `agent-shield`
- Secret detection (14+ patterns from ECC)
- Permission auditing
- Hook injection analysis
- MCP server risk profiling
- Red-team/blue-team validation (use ACP to spawn Claude Code agents for adversarial testing)

#### Phase 7: Multi-Tenant / Per-Client (Week 7-8)
- Implement client workspace isolation
- Per-client AGENTS.md, skills, rules, and config overrides
- Channel → client routing rules
- Per-client memory isolation
- Usage tracking and billing hooks
- NemoClaw integration for hardened sandboxing (if needed)

#### Phase 8: Observability & Operations
- Dashboard for active sessions, agent status, memory usage
- Logging pipeline: structured logs from hooks
- Alerting on: failed tool executions, high token burn, security findings
- Session replay for debugging
- A/B testing framework for skill/prompt variants

---

## 9. Risks / Unknowns / Gaps

### High Risk
| Risk | Impact | Mitigation |
|------|--------|------------|
| **ACP session reliability** | ACP is the bridge to Claude Code features — if it's flaky, the whole system suffers | Extensive testing; fallback to native OpenClaw sub-agents; monitor `sessions_spawn()` failure rates |
| **NemoClaw alpha status** | NVIDIA labels it alpha — breaking changes likely | Abstract sandbox interface; prepare fallback to native Docker sandboxing |
| **Token cost at scale** | Multi-agent systems burn tokens fast — ruflo claims 2.5x efficiency but that's with WASM optimizations | Implement cost router early; set hard budget caps; use aggressive context compaction |

### Medium Risk
| Risk | Impact | Mitigation |
|------|--------|------------|
| **Skill injection bloat** | Too many skills → ballooned prompts → degraded model performance | OpenClaw's selective injection helps; limit to <10 skills per turn; measure impact |
| **Learning system quality** | Auto-extracted patterns may include bad patterns | Confidence scoring; human review gate; A/B test learned vs base patterns |
| **Multi-agent consensus overhead** | Byzantine/Raft consensus adds latency and token cost | Start with simple coordinator pattern; add consensus only where needed |
| **Cross-platform drift** | Skills working on Claude Code may break on Cursor/Codex | Abstract platform differences in adapter layer; test matrix per platform |

### Unknowns
| Unknown | Why It Matters | How to Resolve |
|---------|---------------|----------------|
| **OpenClaw plugin SDK stability** | Building 5+ plugins on it — API changes break everything | Pin versions; contribute upstream; maintain fork if needed |
| **Vector embedding quality in memory** | Semantic retrieval accuracy depends on embedding model | Benchmark local vs cloud embeddings; test retrieval recall |
| **ACP + NemoClaw interaction** | Can ACP sessions spawn inside NemoClaw sandboxes? | Test explicitly; may need custom bridge |
| **Scaling beyond single Gateway** | OpenClaw enforces "one Gateway per host" — multi-host coordination? | Evaluate for production; may need load balancer or clustering approach |

### Gaps (Not Covered by Any System)
1. **No unified dashboard** — ruflo, ECC, and OpenClaw all lack a production monitoring UI
2. **No billing/metering** — multi-tenant token tracking requires custom implementation
3. **No CI/CD integration** — eval harness needs to plug into GitHub Actions / similar
4. **No agent versioning** — skill/agent definitions lack versioning beyond git

---

## 9. Clear Recommendation: What to Build First

### Priority Order

1. **OpenClaw base + ACP bridge to Claude Code** (Week 1)
   - This unlocks everything. Without the Gateway running and ACP working, nothing else matters.
   - Validates the core architecture before investing in plugins.

2. **Skills + AGENTS.md + Workspace Structure** (Week 1-2)
   - Port the 15 most valuable ECC skills. These give immediate productivity gains.
   - AGENTS.md + SOUL.md define agent behavior — highest ROI per line written.

3. **Hook system with 4 core hooks** (Week 2)
   - Session lifecycle + secret scanning. Defensive baseline.
   - Memory persistence hook makes the agent useful across sessions.

4. **Eval/Verification Plugin** (Week 3)
   - Quality is the bottleneck in autonomous agents. Verification loops are what separate a toy from a tool.
   - Build this before the learning engine — you need to verify before you learn.

5. **Cost Router Plugin** (Week 3-4)
   - Token burn will be the #1 operational concern. Get routing right early.

6. **Learning Engine Plugin** (Week 4-6)
   - Only after eval works. Learning from unverified outputs creates garbage patterns.

7. **Multi-Agent Coordination** (Week 5-7)
   - Start with simple coordinator → workers. Add consensus only if needed.

8. **Security Scanner + Multi-Tenant** (Week 7-8)
   - Important but not blocking. Sandbox isolation (native to OpenClaw) covers most security needs initially.

### The One-Sentence Answer

> **Start with OpenClaw Gateway + ACP + 15 ported skills + 4 hooks + AGENTS.md, then build the eval plugin — everything else is an iteration on that foundation.**

---

## Sources

- [OpenClaw Docs - ACP Agents](https://docs.openclaw.ai/tools/acp-agents)
- [OpenClaw Docs - Configuration](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw Architecture Explained](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [What is NemoClaw - ADevGuide](https://adevguide.com/ai-engineering/llm-agents/what-is-nemoclaw/)
- [OpenClaw GitHub - AGENTS.md](https://github.com/openclaw/openclaw/blob/main/AGENTS.md)
- [Anthropic Agent SDK Confusion - The New Stack](https://thenewstack.io/anthropic-agent-sdk-confusion/)
- [OpenClaw-Claude Code Skill - GitHub](https://github.com/Enderfga/openclaw-claude-code-skill)
- [ruflo - GitHub](https://github.com/ruvnet/ruflo)
- [everything-claude-code - GitHub](https://github.com/affaan-m/everything-claude-code)
