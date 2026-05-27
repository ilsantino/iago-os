# Research: Claude Platform, Agent SDK Deployment, and GitHub Integration

**Date:** 2026-04-13
**Question:** What is the current state of Claude Managed Agents, Agent SDK deployment patterns, GitHub integration, and pricing/rate limits?

---

## Findings

### 1. Claude Console / Managed Agents — Current State

**Launched:** Public beta, April 8, 2026. All endpoints require the `managed-agents-2026-04-01` beta header.
**Source:** [platform.claude.com/docs/en/managed-agents/overview](https://platform.claude.com/docs/en/managed-agents/overview)

**What it is:** A fully managed infrastructure layer for running Claude as an autonomous agent. You define an Agent (model + system prompt + tools + MCP servers), an Environment (cloud container), and a Session (a running instance). Anthropic handles sandboxing, state, checkpointing, and scaling.

**Can you deploy agents as API endpoints?**
Yes — agents are persistent, reusable configurations. You create an agent once, get an `agent.id`, and launch sessions against it programmatically via REST or SDK. Sessions stream responses over SSE. There is no "deploy as HTTP endpoint" abstraction (you still manage your own API layer that triggers sessions), but the agents themselves are cloud-hosted and addressable by ID.

**Can you attach MCP servers?**
Yes. MCP servers are first-class in both the Agent definition and the Agent SDK. You pass `mcpServers` config at agent creation or session start. Hundreds of community MCP servers are supported.

**Webhook / event trigger support?**
No native webhook/trigger system exists in Managed Agents as of April 2026. There is no "fire session on GitHub push" or "fire session on queue message" built in. You must implement your own trigger layer (GitHub Actions, SQS consumer, EventBridge rule) that calls the Sessions API. The session API itself is event-driven via SSE once started.

**Claude for Enterprise / managed agent hosting?**
Managed Agents is the enterprise hosting product. It is available to all API accounts (no separate signup for the base product). Three features require separate research-preview access request:
- **Outcomes API** — declare success criteria; Claude self-evaluates progress
- **Multi-agent orchestration** — orchestrator agent spawns parallel sub-agents; runtime manages inter-agent comms
- **Persistent memory** — key/value store that persists across sessions (user context, long-term facts)

**Known gaps as of April 2026:**
- No VPC peering or private endpoints — all traffic goes over Anthropic's public infrastructure
- No regional deployments yet (EU and Asia on roadmap)
- No agent marketplace
- Private networking (VPN/private link) on roadmap but not available

---

### 2. Agent SDK — Deployment Patterns

**Renamed:** The Claude Code SDK is now the Claude Agent SDK. Available in Python (`claude-agent-sdk`) and TypeScript (`@anthropic-ai/claude-agent-sdk`).
**Source:** [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview), [code.claude.com/docs/en/agent-sdk/hosting](https://code.claude.com/docs/en/agent-sdk/hosting)

**What it is:** The same tools, agent loop, and context management that power Claude Code, packaged as a library. Wraps the Claude Code CLI subprocess. Not a hosted service — you run it in your own infrastructure.

**Architecture constraint:** The SDK is a **long-running process** (not a request/response handler). It spawns a persistent shell, manages file state, executes tool calls with accumulated context. This makes Lambda a poor fit for anything beyond trivial tasks.

#### Lambda

Lambda works only for short, fire-and-forget agent runs where total execution fits within the 15-minute wall clock limit. Cold starts exist (Node.js process + Claude Code CLI subprocess initialization), but SnapStart and Graviton3 reduce this on supported runtimes. For agentic workloads requiring multi-turn tool loops or file state, Lambda is unsuitable. The official docs do not recommend Lambda for agent hosting — they recommend container-based sandboxes.

**Workaround:** Lambda as a trigger/dispatcher only — receives GitHub event, writes to SQS, ECS task picks up from queue and runs the agent.

#### Containers (recommended path)

The SDK docs explicitly recommend container-based sandboxing. Minimum requirements: 1 GiB RAM, 5 GiB disk, 1 CPU, Node.js 18+. Recommended providers:

| Provider | Notes |
|---|---|
| Modal Sandbox | Has demo implementation with Claude |
| Cloudflare Sandboxes | Edge-native, SDK available |
| E2B | Purpose-built for AI code execution |
| Fly Machines | Fast start, per-request billing |
| Vercel Sandbox | Beta |
| AWS ECS/Fargate | Self-managed, full control |

**Amazon Bedrock AgentCore** (AWS-native path): Serverless runtime for long-running agents, supports sessions up to 8 hours. Designed to run Claude via Bedrock within Lambda's execution model constraints. Relevant if you need to stay fully AWS-native.

#### Production Patterns (from official SDK docs)

| Pattern | Use Case | Notes |
|---|---|---|
| Ephemeral | One-off tasks (bug fix, invoice process) | New container per task, destroy on complete |
| Long-running | Email agents, high-freq chatbots | Persistent container, multiple agent processes |
| Hybrid (resume) | Research, project manager, support tickets | Ephemeral + session resumption from DB |
| Single-container multi-agent | Simulations, collaborative agents | Multiple SDK processes in one container |

#### Handling long-running sessions

The SDK has built-in session resumption: capture `session_id` from the init event, pass `resume: sessionId` on next call. Context is restored. For true async workflows (hours-long research), the pattern is: ECS/Fargate long-running task + checkpoint to DynamoDB at intervals + resume if container dies. The SDK itself has no timeout — set `maxTurns` to prevent infinite loops.

AWS Step Functions for agent orchestration: valid pattern, but adds overhead. Simpler: SQS queue as trigger → ECS task per message → SNS/WebSocket for results.

---

### 3. GitHub Integration

**Official Anthropic GitHub App:** Yes. Available at `github.com/apps/claude`. Install on any repo. Handles permissions (contents, issues, PRs read/write). Run `/install-github-app` in Claude Code CLI for automated setup.
**Source:** [code.claude.com/docs/en/github-actions](https://code.claude.com/docs/en/github-actions)

**Claude Code GitHub Actions (`anthropics/claude-code-action@v1`):** GA as of v1.0 (beta deprecated). Built on top of the Agent SDK.

**How it works:**
- Triggers on GitHub event types: `issue_comment`, `pull_request_review_comment`, `issues`, `pull_request`, `schedule`
- `@claude` mention in comment → action activates, runs agent loop, posts response/commits
- Auto-mode detection: tag-response mode vs automation mode based on presence of `prompt` param
- `claude_args` passes any Claude Code CLI flags through (model, max-turns, MCP config, allowed tools)

**Can Agent SDK agents respond to GitHub webhooks directly?**
Not natively — there is no built-in webhook listener in the SDK. The production pattern is:
1. GitHub webhook → API Gateway → Lambda dispatcher → ECS task running Agent SDK
OR
2. GitHub Actions (existing `claude.yml` pattern) — simpler, runs on GitHub runners, no infrastructure to maintain

**Agent SDK webhook handler vs current `claude.yml`:**

| Dimension | GitHub Actions (`claude.yml`) | Custom Agent SDK + Webhook |
|---|---|---|
| Infrastructure | Zero — runs on GH runners | API GW + Lambda/ECS + VPC |
| Cost | GitHub Actions minutes + API tokens | AWS infra + API tokens |
| Latency | 30–60s cold start (runner spin-up) | ~5–15s (warm ECS) |
| Control | Limited — GH runner environment | Full — custom tools, MCP, logging |
| CLAUDE.md support | Yes | Yes |
| Bedrock/Vertex support | Yes (OIDC auth) | Yes |
| Custom MCP servers | Via `--mcp-config` flag | Full programmatic config |
| Persistent state across PRs | No (ephemeral runner) | Yes (DynamoDB + session resume) |

**Verdict on current iaGO `claude.yml`:** The GitHub Actions approach is correct for PR review. Rolling a custom webhook handler adds infra cost and complexity for negligible gain on review workflows. The only reason to migrate is if you need sub-15s response times, custom MCP servers per repo, or cross-PR persistent state — none of which are current requirements.

---

### 4. Pricing and Rate Limits

**Source:** [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing), [platform.claude.com/docs/en/api/rate-limits](https://platform.claude.com/docs/en/api/rate-limits)

#### Model pricing (April 2026)

| Model | Input / MTok | Output / MTok |
|---|---|---|
| Opus 4.6 | $5 | $25 |
| Sonnet 4.6 | $3 | $15 |
| Haiku 4.5 | $1 | $5 |
| Haiku 3.5 | $0.80 | $4 |

Prompt caching: 5-min write = 1.25x, 1-hr write = 2x, cache read = 0.1x. Cached tokens do NOT count toward ITPM rate limits on current models (significant throughput advantage).

Batch API: 50% discount on input + output. No batch mode for Managed Agents sessions.

#### Managed Agents session runtime

$0.08 per session-hour, measured in milliseconds, only while status is `running` (idle time not billed).

Example: 1-hour Opus 4.6 session, 50K input / 15K output tokens = ~$0.71 total.

Agent running 24/7 = ~$58/month in runtime alone, before token costs.

#### Agent SDK pricing

No separate pricing. Pure API token consumption at standard model rates. You pay for your own infra (containers, etc.) separately.

#### Rate limits by tier

| Tier | Opus/Sonnet RPM | Opus/Sonnet ITPM | Sonnet OTPM |
|---|---|---|---|
| Tier 1 | 50 | 30,000 | 8,000 |
| Tier 2 | 1,000 | 450,000 | 90,000 |
| Tier 3 | 2,000 | 800,000 | 160,000 |
| Tier 4 | 4,000 | 2,000,000 | 400,000 |

Tier advancement is automatic based on cumulative credit deposits ($5 → T1, $40 → T2, $200 → T3, $400 → T4).

Managed Agents has separate limits: 60 RPM for create operations (agents, sessions, environments), 600 RPM for read/stream operations.

Weekly rate limits were added in August 2025 for heavy Claude Code CLI users specifically.

#### Spend limits

T1: $100/mo, T2: $500/mo, T3: $1,000/mo, T4: $200,000/mo, Monthly invoicing: no cap.

---

## Sources

| Source | Contribution |
|---|---|
| [platform.claude.com/docs/en/managed-agents/overview](https://platform.claude.com/docs/en/managed-agents/overview) | Managed Agents architecture, core concepts, MCP support, rate limits |
| [platform.claude.com/docs/en/managed-agents/quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart) | Session API shape, environment config, streaming events |
| [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview) | Agent SDK capabilities, MCP, subagents, sessions, hooks |
| [code.claude.com/docs/en/agent-sdk/hosting](https://code.claude.com/docs/en/agent-sdk/hosting) | Production patterns, sandbox providers, Lambda limitations, container requirements |
| [code.claude.com/docs/en/github-actions](https://code.claude.com/docs/en/github-actions) | GitHub Actions v1.0 configuration, official GitHub App, trigger types, Bedrock/Vertex support |
| [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) | All model pricing, Managed Agents runtime pricing, batch, caching, tool pricing |
| [platform.claude.com/docs/en/api/rate-limits](https://platform.claude.com/docs/en/api/rate-limits) | Tier-by-tier RPM/ITPM/OTPM limits, Managed Agents limits, spend tiers |
| [dev.to/bean_bean/claude-managed-agents-deep-dive](https://dev.to/bean_bean/claude-managed-agents-deep-dive-anthropics-new-ai-agent-infrastructure-2026-3286) | Research preview features detail, enterprise gaps (no VPC), roadmap |
| [helpnetsecurity.com/2026/04/09/claude-managed-agents](https://www.helpnetsecurity.com/2026/04/09/claude-managed-agents-bring-execution-and-control-to-ai-agent-workflows/) | Launch date confirmation, enterprise early adopters |

---

## Today vs. Announced

| Feature | Status |
|---|---|
| Managed Agents — sandboxed sessions, long-running, checkpointing | **GA (beta)** |
| Managed Agents — MCP server attachment | **GA (beta)** |
| Managed Agents — deploy agent as reusable config with ID | **GA (beta)** |
| Managed Agents — SSE streaming, mid-session steering | **GA (beta)** |
| Managed Agents — Outcomes API (self-evaluation) | **Research preview (waitlist)** |
| Managed Agents — Multi-agent orchestration | **Research preview (waitlist)** |
| Managed Agents — Persistent memory across sessions | **Research preview (waitlist)** |
| Managed Agents — Private networking (VPC/VPN) | **Roadmap — not available** |
| Managed Agents — Regional deployments (EU, Asia) | **Roadmap — not available** |
| Managed Agents — Webhook/event triggers | **Not in roadmap as stated** |
| Agent SDK — Lambda deployment | **Works (with caveats), not recommended for multi-turn** |
| Agent SDK — ECS/container deployment | **Supported, recommended** |
| Agent SDK — Session resumption | **GA** |
| Agent SDK — MCP server config | **GA** |
| Agent SDK — Subagents | **GA** |
| GitHub Actions (`claude.yml`) | **GA v1.0** |
| Official Anthropic GitHub App | **GA** |
| AWS Bedrock / Vertex in GitHub Actions | **GA** |
| Fast mode (Opus 4.6 6x speed premium) | **Research preview** |

---

## Recommendation

**Decision:** For iaGO's PR review pipeline, keep the current GitHub Actions (`claude.yml`) approach. Do not migrate to a custom Agent SDK webhook handler.

**Confidence:** High

**Reasoning:** The GitHub Actions integration is now GA v1.0, built on the Agent SDK, and handles all current requirements (PR review, issue response, scheduled runs). The only gaps — sub-15s latency, custom MCP per repo, cross-PR state — are not requirements for the current review-fix loop. A custom webhook handler adds ~$30–80/month in AWS infrastructure and weeks of maintenance for no functional gain. For future client deliverables requiring long-running autonomous agents (email triage, research pipelines), Managed Agents is the right primitive, not a DIY Agent SDK container.

**For Managed Agents adoption:** Evaluate when: (a) private networking ships (required for clients with internal APIs), or (b) multi-agent research preview opens (directly relevant to the multi-agent architecture work). Do not adopt Managed Agents as a replacement for Agent SDK containers if you need sub-$0.08/hour runtime costs or full infrastructure control.

**Next step:** Request access to the Managed Agents research preview at `claude.com/form/claude-managed-agents` to evaluate multi-agent orchestration for `/iago:agents` client deliverables.

**Risk if wrong:** If Managed Agents private networking ships Q2 2026 and the current Agent SDK container approach is already in use, migration is straightforward — the Session API shape is stable and the Agent SDK is the same underlying library.
