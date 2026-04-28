# Team 4 — Competitive Landscape

## TL;DR (3-line verdict)

- Direct competitors (overlap with iago-os agency-delivery positioning): **none exist** — no tool occupies the exact "opinionated delivery layer on top of a foundation model CLI, purpose-built for a fixed client-delivery stack" niche. Continue.dev (CI review enforcement) and Cline (autonomous VS Code agent with MCP) are the closest adjacent tools that share individual subsystems.
- Top patterns to steal (max 3): (1) Continue.dev's markdown-file check definitions version-controlled in `.continue/checks/` — a cleaner pattern for externalizing review rules than embedding them in pipeline scripts; (2) Cline's checkpoint/snapshot system — workspace state captured at every step, diffable and restorable — directly applicable to iago-os pipeline rollback safety; (3) Cursor's Plans→Tasks→Stages UI model with cloud-VM agent execution — a workflow primitive language iago-os lacks at the user-facing layer.
- Top wedges to consider (max 3): (1) Version-control review rules as `.iago/checks/*.md` files (stealable from Continue.dev); (2) Pipeline checkpoint snapshots before each stage (stealable from Cline); (3) Named plan statuses (Pending / In Progress / Review / Done) surfaced in STATE.md (stealable from Cursor's stage model).

---

## Per-competitor analysis

### Aider

- **Positioning:** Terminal-based AI pair-programmer for individual developers who want git-native, multi-LLM code editing without leaving the shell. [aider.chat](https://aider.chat) / [GitHub](https://github.com/paul-gauthier/aider)
- **Workflow primitives:** Chat modes only — `/ask` (discuss), `/code` (implement), architect mode (two-model: reasoning model proposes → editor model applies). No plan files, no task lists, no stage gates. Iterative chat loop.
- **Review pipeline:** None built-in. Automated linting + test run on changes, with error remediation loop. No adversarial review, no cross-model review, no PR pipeline.
- **Agent dispatch:** Single agent. Architect mode adds a second LLM call (proposer + applier) but this is not multi-agent dispatch — it's a two-step inference chain per request.
- **Memory:** Session-scoped only. No persistent cross-session memory. Community plugins exist (e.g., MemNexus) but not native. No graph layer.
- **Skills/plugins:** None native. Config via `.aider.conf.yml`. No slash-command skill system.
- **Pricing/license:** Apache 2.0, fully free. LLM costs are pass-through (~$30–80/month at typical usage). [Source](https://www.morphllm.com/comparisons/morph-vs-aider-diff)
- **Adoption:** 44.1k GitHub stars, 4.3k forks, 13,133+ commits. v0.86.0 released Aug 2025. Actively maintained. [GitHub](https://github.com/paul-gauthier/aider)
- **Last update:** August 2025 (latest tagged release); repo shows ongoing commits.
- **Overlap: ORTHOGONAL.** Aider is a developer productivity tool. iago-os is a delivery governance layer. Aider has no concept of client projects, review pipelines, multi-client dispatch, or skill catalogs. A developer using Aider and a developer using iago-os are solving different problems.
- **What to steal:** Architect mode's two-model split (reasoning model → editing model) is a clean pattern for iago-os's plan/implement split. Today iago-os uses a single opus session for both stress-test reasoning and implementation. Separating these into explicit "architect" (stress test / plan refinement) and "editor" (implementation) roles with different model routing could reduce token burn on the implementation step.

---

### Cursor Agent

- **Positioning:** AI-first IDE for professional developers and engineering teams, competing directly with VS Code. Agent mode (Cursor 3, April 2026) runs on dedicated cloud VMs with git worktree isolation. [cursor.com](https://cursor.com)
- **Workflow primitives:** Plans (natural-language breakdowns), Tasks (discrete units with assignees), Stages (In Progress / Ready for Review / Done). Background agents on cloud VMs. Composer 2 for planning+building. `/worktree` for isolated branch execution. Parallel Agent Tabs. [Source](https://www.cursor.com/features)
- **Review pipeline:** Human-in-the-loop — agents complete work, await human review before merging. GitHub PR integration. Bugbot add-on ($40/user/month) for automated PR review: rule-based, up to 200 PR reviews/month. No adversarial cross-model review.
- **Agent dispatch:** Background cloud agents (parallel). Not hub-and-spoke — agents are task-scoped, not capability-profiled. No orchestrator layer.
- **Memory:** Semantic codebase indexing (proprietary). No persistent cross-session user memory. No graph layer.
- **Skills/plugins:** MCP integration (Pro+), hooks, custom rules via `cursor.rules`. No slash-command skill catalog equivalent.
- **Pricing/license:** Proprietary SaaS. Hobby free, Pro $20/month, Pro+ $60/month, Ultra $200/month, Teams $40/user/month, Enterprise custom. [cursor.com/pricing](https://cursor.com/pricing)
- **Adoption:** Dominant IDE-layer tool. No star count (not OSS). Reported 80%+ adoption at some enterprise orgs. [Source](https://www.cursor.com/features)
- **Last update:** Cursor 3 released April 2026. Actively developed.
- **Overlap: ADJACENT.** Cursor has a Plans→Tasks→Stages model and GitHub PR integration — the closest surface-level similarity to iago-os. But Cursor is an IDE, not a delivery governance layer. It has no 8-stage pipeline, no adversarial review, no cross-model review, no memory architecture, no skill catalog, no multi-client dispatch. A consultancy would use Cursor as the editor and iago-os as the delivery governance layer — they cohabit.
- **What to steal:** The Plans→Tasks→Stages status vocabulary is a clean user-facing primitive that iago-os currently lacks. STATE.md is a flat digest; surfacing plan status as explicit stages (Pending / In Progress / Review / Done) in STATE.md or a UI would improve visibility for multi-plan phases. Also: parallel Agent Tabs (cloud VM per task) is the cloud-native version of iago-os's worktree-per-session pattern — worth watching as a future execution model.

---

### Continue.dev

- **Positioning:** "Quality control for your software factory" — source-controlled AI checks enforceable in CI, targeting engineering teams that want PR review automated via version-controlled rules. [continue.dev](https://www.continue.dev) / [GitHub](https://github.com/continuedev/continue)
- **Workflow primitives:** Checks (markdown files in `.continue/checks/`), Agents (execute checks on PRs), Status checks (GitHub integration). Three modes: Chat, Plan, Agent. No roadmap/phase model, no plan files.
- **Review pipeline:** This is Continue's core value prop. Every PR triggers AI checks defined as markdown files. Checks appear as GitHub status checks — green or red with suggested diffs. CI-enforceable. Headless mode for async background agents. Domain-specific rules (Sentry alerts, Snyk vulns, docs drift). [Source](https://blog.continue.dev/beyond-code-generation-how-continue-enables-ai-code-review-at-scale)
- **Agent dispatch:** Single check-runner agent per PR check. No hub-and-spoke multi-agent dispatch.
- **Memory:** No persistent cross-session memory. Checks are stateless per PR.
- **Skills/plugins:** Skills folder in repo (undocumented). IDE extensions (VS Code, JetBrains). MCP not mentioned prominently.
- **Pricing/license:** Apache 2.0 OSS. Solo free, Teams $10/dev/month, Enterprise custom (SSO, BYOK). [continue.dev/pricing](https://www.continue.dev/pricing)
- **Adoption:** 32,900 GitHub stars, 4,400 forks. v1.2.22-vscode released March 2026. Actively maintained. [GitHub](https://github.com/continuedev/continue)
- **Last update:** March 2026.
- **Overlap: ADJACENT.** Continue.dev's check-enforcement pipeline is the closest external analogue to iago-os's review pipeline. Both run domain-specific review rules on code changes and post findings. The key difference: Continue.dev's checks run on PRs as a CI gate (reactive, post-implementation); iago-os's review runs inside the pipeline before the PR is created (proactive, pre-PR). Continue has no implementation pipeline, no memory architecture, no skill catalog. Cohabitable — a team could use Continue for PR-level enforcement and iago-os for pre-PR delivery.
- **What to steal:** The markdown check file pattern is superior to iago-os's current approach of embedding review rules in shell scripts and large monolithic prompt files. Externalizing check definitions as `.iago/checks/auth.md`, `.iago/checks/data-integrity.md`, etc. — version-controlled, diff-able, readable — would make the review pipeline significantly more maintainable and client-customizable. This is a concrete wedge candidate.

---

### AutoGen (Microsoft)

- **Positioning:** Multi-agent AI application framework for researchers and enterprise developers building autonomous agent systems. Now in **maintenance mode** — Microsoft replaced it with Microsoft Agent Framework 1.0 (GA April 2026). [VentureBeat](https://venturebeat.com/ai/microsoft-retires-autogen-and-debuts-agent-framework-to-unify-and-govern) / [GitHub](https://github.com/microsoft/autogen)
- **Workflow primitives:** Message passing, event-driven agents, AgentChat API for multi-agent conversations. No plan files, no delivery stages, no task queue.
- **Review pipeline:** None. Framework-level, not delivery-level.
- **Agent dispatch:** Event-driven message passing. Multi-agent orchestration via message bus. No hub-and-spoke constraint — mesh topology.
- **Memory:** Not specified natively. Extension-based.
- **Skills/plugins:** Extensions API (LLM clients, code execution, MCP servers). Python + .NET.
- **Pricing/license:** MIT (code) + CC-BY-4.0 (docs). Free. [GitHub](https://github.com/microsoft/autogen)
- **Adoption:** 57.5k GitHub stars, 8.7k forks. Last release python-v0.7.5 September 2025. Maintenance mode — no new features. [GitHub](https://github.com/microsoft/autogen)
- **Last update:** September 2025 (last release). Microsoft Agent Framework 1.0 is the active successor.
- **Overlap: ORTHOGONAL.** AutoGen is a general-purpose multi-agent framework, not a delivery layer. It has no concept of client projects, delivery pipelines, code review, PRs, or skill catalogs. The audience is researchers and platform engineers building agent systems, not consultancies shipping client code. Microsoft Agent Framework (the successor) merges AutoGen + Semantic Kernel — same positioning, not relevant to iago-os.
- **What to steal:** Nothing directly applicable. The event-driven agent messaging model is more complex than iago-os needs — hub-and-spoke is the right constraint for a 3-person consultancy. The AgentChat API's concept of structured agent roles (with goals + backstories) is already present in iago-os's capability module system.

---

### CrewAI

- **Positioning:** Python framework for autonomous multi-agent workflows, targeting enterprises building production AI systems. 100,000+ certified developers, PwC as a flagship enterprise customer. Dual paradigm: Crews (autonomous) + Flows (event-driven). [crewai.com](https://crewai.com) / [GitHub](https://github.com/crewAIInc/crewAI)
- **Workflow primitives:** Crews (agent teams), Flows (event-driven with `@start`/`@listen`/`@router`), Tasks (configurable units with expected outputs). Hierarchical process model (manager agent delegates to specialists). No delivery phases, no plan files, no PR pipeline.
- **Review pipeline:** Human-in-the-loop hooks available. No automated adversarial review. No build gate.
- **Agent dispatch:** Sequential or hierarchical. Manager agent auto-assigns in hierarchical mode. No hub-and-spoke enforcement — can be mesh.
- **Memory:** Agent memory configurations exist; implementation details sparse in docs. Not a 5-layer architecture.
- **Skills/plugins:** CrewAI Skills — official Claude Code / Cursor / Windsurf integration patterns. Enterprise: CrewAI AMP Suite. [GitHub](https://github.com/crewAIInc/crewAI)
- **Pricing/license:** MIT OSS + CrewAI AMP Suite (enterprise, custom pricing). [crewai.com](https://crewai.com)
- **Adoption:** 50.2k GitHub stars, 6.9k forks. v1.14.3 released April 24, 2026. Enterprise: 150+ enterprise customers within 6 months, $18M Series A. [BusinessWire](https://www.businesswire.com/news/home/20260211693427/en/Agentic-AI-Reaches-Tipping-Point-100-of-Enterprises-Plan-to-Expand-Adoption-in-2026-New-CrewAI-Survey-Finds)
- **Last update:** April 24, 2026. Actively developed.
- **Overlap: ORTHOGONAL.** CrewAI is a general-purpose agent orchestration framework. iago-os is a delivery governance layer for a specific stack. CrewAI has no delivery pipeline, no build gate, no review stages, no memory architecture for cross-client context, no skill catalog for client project types. A consultancy might use CrewAI to build agent deliverables for clients (iago-os has `/iago-agents` for exactly this), but CrewAI is not competing with iago-os's delivery workflow. No cohabitation conflict.
- **What to steal:** CrewAI's Flows event-driven model (`@start`/`@listen`/`@router` decorators with logical operators) is a cleaner primitive for iago-os's pipeline branching logic than the current bash `if/else` chains. The concept of explicit flow state transitions (not just sequential stage execution) would allow conditional pipeline paths (e.g., skip Codex fix if no findings) to be expressed as a graph rather than imperative script logic. Low priority but architecturally worth noting.

---

### Devin (Cognition AI)

- **Positioning:** Autonomous AI software engineer for engineering teams managing complex, multi-repo projects. Acquired Windsurf (formerly Codeium) for ~$250M in 2026. Targets teams wanting to delegate entire tasks — migrations, incident resolution, scheduled chores. [devin.ai](https://devin.ai)
- **Workflow primitives:** Task assignment via Linear tickets, Slack mentions, or API. Multi-agent orchestration ("fleet of Devins"). Iterative PR loop (picks up review feedback + CI results). No plan-file discipline, no phase model.
- **Review pipeline:** Human-in-the-loop for PR approval. Devin picks up CI failures and review comments and iterates. Devin Review product for automated PR analysis. No adversarial review, no cross-model review.
- **Agent dispatch:** Parallel fleet model — multiple Devin instances on separate tasks. Not hub-and-spoke. No capability-profiled agent roster.
- **Memory:** Codebase learning from past session trajectories. Tribal knowledge accumulation. No structured 5-layer memory architecture.
- **Skills/plugins:** Slack, Linear, MCP integrations. Windsurf IDE integration. [devin.ai/pricing](https://devin.ai/pricing)
- **Pricing/license:** Proprietary SaaS. Free (limited), Pro $20/month, Max $200/month, Teams $80/month, Enterprise custom. Originally $500/month — Devin 2.0 slashed to $20. [VentureBeat](https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500)
- **Adoption:** No OSS repo. Paid customers not disclosed. Enterprise-tier customers reported. Significant VC backing (Cognition AI).
- **Last update:** Devin 2.0 launched 2025/2026. Actively developed.
- **Overlap: ADJACENT.** Devin is the closest thing to an autonomous delivery tool — it accepts tasks, writes code, handles PR review feedback, and iterates. But Devin is a SaaS product that replaces developer labor, not a governance layer on top of Claude Code. iago-os adds review discipline, memory architecture, and skill catalogs to an existing developer workflow; Devin tries to replace the developer. Devin has no stack opinions, no multi-client discipline, no adversarial review pipeline. A consultancy might use Devin for low-complexity client tasks while using iago-os for high-stakes delivery — partial cohabitation possible.
- **What to steal:** Devin's "reads past session trajectories to improve" is a concrete mechanism for iago-os's learnings system. The `.iago/learnings/` folder already tracks review patterns, but there's no feedback loop from summaries back into future plan generation. A trajectory-ingestion step (reading past `.iago/summaries/` for the same client project before planning) would give iago-os genuine project-level memory improvement. This is directly actionable.

---

### Sweep

- **Positioning:** AI coding assistant for JetBrains IDEs (pivoted from GitHub app). Originally an AI developer that resolved GitHub issues by opening PRs; now repositioned as an IDE autocomplete + agent for JetBrains. [sweep.dev](https://sweep.dev) / [GitHub](https://github.com/sweepai/sweep)
- **Workflow primitives:** Issue-to-PR (legacy GitHub app mode). JetBrains plugin mode: inline suggestions, next-edit predictions. No plan files, no stage gates, no delivery phases.
- **Review pipeline:** Original GitHub app reviewed PRs it opened. JetBrains plugin mode: no review pipeline. Legacy functionality.
- **Agent dispatch:** Single agent (issue resolver). No multi-agent dispatch.
- **Memory:** Not documented.
- **Skills/plugins:** JetBrains plugin. GitHub Marketplace app (legacy). [GitHub Marketplace](https://github.com/marketplace/sweep-ai)
- **Pricing/license:** License file present but terms not public-facing. JetBrains plugin: 4.9 stars, 40k+ installs. [GitHub](https://github.com/sweepai/sweep)
- **Adoption:** 7.7k GitHub stars, 457 forks. Main repo last commit September 2025; JetBrains plugin updated April 2026. Transitional state.
- **Last update:** JetBrains plugin April 2026; main repo September 2025.
- **Overlap: ORTHOGONAL.** Sweep's original positioning (AI developer resolving GitHub issues) had surface overlap with Devin and iago-os's PR pipeline — but Sweep never had delivery governance, multi-client support, or review discipline. The JetBrains pivot makes it a pure IDE tool. Fully orthogonal to iago-os.
- **What to steal:** Nothing directly applicable. The issue-to-PR pattern (GitHub issue as task input → automated branch + PR) could theoretically be added to iago-os as a `/iago-issue-to-plan` skill, but this is low priority given iago-os's current Linear/Slack workflow.

---

### Cline

- **Positioning:** Open-source autonomous coding agent inside VS Code, with human-in-the-loop approval for every file change. Targets individual developers and teams who want full model flexibility, MCP extensibility, and auditability. [GitHub](https://github.com/cline/cline)
- **Workflow primitives:** Plan + Act two-phase approach (plan step, then explicit approval before acting). Checkpoint system — workspace snapshots at each step, diffable and restorable. No formal phase/roadmap model, no plan-file discipline.
- **Review pipeline:** Human approval gate on every file change and terminal command. No automated adversarial review, no cross-model review, no build-gate equivalent.
- **Agent dispatch:** Single agent. MCP extends tool access but doesn't add agent dispatch.
- **Memory:** Memory Bank (community MCP server) — structured markdown files tracking project context, decisions, progress across sessions. Not native — MCP add-on. [Cline docs](https://docs.cline.bot/features/memory-bank)
- **Skills/plugins:** MCP (Model Context Protocol) — extensible tool creation. `@` syntax for context injection (files, folders, URLs, workspace problems). No slash-command skill catalog.
- **Pricing/license:** Apache 2.0. Extension free; model costs pass-through ($10–30/month at typical use with Claude Sonnet 4). [morphllm.com](https://www.morphllm.com/comparisons/cline-vs-cursor)
- **Adoption:** 61.1k GitHub stars, 6.3k forks. v3.81.0 released April 24, 2026. Actively maintained. Most-starred tool in this comparison set.
- **Last update:** April 24, 2026.
- **Overlap: ADJACENT.** Cline is the closest tool in terms of MCP integration and autonomous agent behavior inside a single codebase. But Cline is a VS Code extension (IDE layer), not a delivery governance layer. It has no multi-client discipline, no plan-file artifacts, no 8-stage pipeline, no adversarial review, no skill catalog. The Memory Bank pattern is an independently implemented version of what iago-os does natively with MEMORY.md + Obsidian + MemPalace. Cline cohabits with iago-os — many developers run both.
- **What to steal:** The checkpoint/snapshot system is the most actionable steal. Cline captures workspace state at every step with diff view and restore capability. iago-os's pipeline has no rollback primitive — if stage 3 (review) produces a fix that breaks a previously passing stage, there's no structured way to restore. Adding a pre-stage snapshot (git stash ref or worktree snapshot) before each pipeline stage would directly address the rollback-safety finding that Codex adversarial review flags repeatedly.

---

### OpenHands (formerly OpenDevin)

- **Positioning:** Open-source platform for autonomous software agents — "AI-driven development." Sandboxed Docker execution, web UI, CLI, cloud platform, enterprise Kubernetes deployment. Raised $18.8M Series A. [openhands.dev](https://openhands.dev) / [GitHub](https://github.com/OpenHands/OpenHands)
- **Workflow primitives:** Agent receives task → creates plan → executes steps in sandboxed Docker (read/write files, run shell, browse web, call APIs). Planning Mode beta in v1.6.0. Multi-agent delegation primitives. No delivery-phase model, no plan-file discipline.
- **Review pipeline:** None documented. Human oversight via UI approval. No adversarial review, no build gate, no PR pipeline.
- **Agent dispatch:** Hierarchical multi-agent delegation — agents can spawn subtask agents. Enterprise: multi-user Kubernetes with RBAC. Not hub-and-spoke; mesh with delegation primitives.
- **Memory:** Not documented in detail. Agent SDK composable.
- **Skills/plugins:** Python SDK. REST API. Slack/Jira/Linear integrations (enterprise). [GitHub](https://github.com/OpenHands/OpenHands)
- **Pricing/license:** MIT (core). Enterprise edition source-available, license required for >1-month deployments. Cloud free tier (Minimax model). [openhands.dev](https://openhands.dev)
- **Adoption:** 72.3k GitHub stars, 9.1k forks. v1.6.0 released March 30, 2026. Highest-starred tool in this comparison. Actively developed.
- **Last update:** March 30, 2026.
- **Overlap: ADJACENT.** OpenHands is an autonomous execution platform — closer to Devin than to iago-os. The sandboxed Docker execution model (full OS access per task) is a more powerful but less opinionated approach than iago-os's pipeline. OpenHands has no delivery governance, no stack opinions, no multi-client discipline, no review pipeline, no skill catalog for client project types. A consultancy could use OpenHands for exploratory/research tasks and iago-os for governed delivery. Partial cohabitation possible, no direct competition.
- **What to steal:** Planning Mode beta (task → plan → execute with explicit plan artifact) is converging on iago-os's plan-file model. The sandboxed Docker execution model (each agent step runs in an isolated container) is a stronger isolation guarantee than iago-os's worktree-per-session approach — relevant if iago-os ever moves to cloud execution.

---

## Pattern matrix

| Pattern | Aider | Cursor | Continue.dev | AutoGen | CrewAI | Devin | Sweep | Cline | OpenHands | iago-os |
|---|---|---|---|---|---|---|---|---|---|---|
| Plans/tasks | NO | YES (Plans→Tasks→Stages) | NO | NO | YES (Tasks) | Partial (issues→tasks) | NO | Partial (Plan+Act) | Partial (Planning Mode beta) | YES |
| Multi-stage pipeline | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES (8 stages) |
| Automated adversarial review | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Cross-model review | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES (Codex/GPT-5.5) |
| Build gate (tsc + vite) | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Persistent memory (multi-layer) | NO | NO | NO | NO | Partial | Partial | NO | Via MCP add-on | NO | YES (5 layers) |
| Hub-and-spoke agents | NO | NO | NO | NO | Partial | NO | NO | NO | NO | YES |
| Skill catalog (slash commands) | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| MCP integration | NO | YES | Partial | YES | NO | YES | NO | YES | NO | YES |
| CI/PR enforcement | NO | Via Bugbot ($40) | YES (core feature) | NO | NO | Partial | NO | NO | NO | YES (async loop) |
| Version-controlled review rules | NO | Via cursor.rules | YES (.continue/checks/) | NO | NO | NO | NO | NO | NO | Partial (in scripts) |
| Checkpoint/rollback | NO | NO | NO | NO | NO | NO | NO | YES | NO | NO |
| Multi-client discipline | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Stack-opinionated (fixed) | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |

---

## Suggested wedges from competitive analysis

### Wedge A: Version-controlled review check files (`.iago/checks/*.md`)
**Stolen from:** Continue.dev  
**Pattern:** Externalize iago-os review rules from shell script prompt blocks into standalone markdown files at `.iago/checks/{domain}.md`. Each file defines the check name, domain, severity floor, and prompt. The pipeline `cat`s relevant check files into the review session rather than embedding rules in `execute-pipeline.sh`. Makes rules diffable, client-customizable, and independently updateable without touching the pipeline script. Also enables Continue.dev-style PR enforcement as a secondary gate if a client team adopts Continue.dev independently.  
**Effort:** Low — files already exist as embedded prompts in `scripts/review-checks/`; extraction is a refactor, not new logic.

### Wedge B: Pre-stage pipeline checkpoints (git snapshot before each stage)
**Stolen from:** Cline's checkpoint system  
**Pattern:** Before each pipeline stage (stress test, implement, build gate, review, codex), capture a `git stash create` ref or lightweight worktree snapshot. Store ref in `$IAGO_STAGE_CHECKPOINT_{stage}`. If a stage produces a regression (e.g., a fix in stage 3 breaks stage 2 artifacts), the pipeline can restore to the pre-stage state and retry with a different approach rather than accumulating broken intermediate states. Directly addresses rollback-safety findings that Codex adversarial review consistently flags.  
**Effort:** Medium — requires checkpoint capture in `scripts/lib/build-gate.sh` and restore logic in the fix-retry loop.

### Wedge C: Plan stage status in STATE.md (Pending / In Progress / Review / Done)
**Stolen from:** Cursor's Plans→Tasks→Stages model  
**Pattern:** Add a `## Active Plans` table to STATE.md with columns: plan slug, phase, status (Pending / In Progress / Review / Done), last-updated. Pipeline script updates status at each stage transition. Gives a single-glance dashboard for multi-plan phases without opening individual plan files. Particularly useful when running wave-grouped parallel plans.  
**Effort:** Low — STATE.md is already maintained; adding a status table is additive. Pipeline writes are a few additional `sed` calls.

---

## Suggested wedges to DROP from current spec given competitive landscape

None identified. The 8-stage pipeline, cross-model review, 5-layer memory, and skill catalog are all differentiated — no competitor offers this combination. The only risk is over-engineering the pipeline script as a bash monolith; the check-file externalization (Wedge A) is the mitigation.

---

## Sources

- Aider GitHub: https://github.com/paul-gauthier/aider
- Aider chat modes: https://aider.chat/docs/usage/modes.html
- Cursor features: https://www.cursor.com/features
- Cursor pricing: https://cursor.com/pricing
- Continue.dev GitHub: https://github.com/continuedev/continue
- Continue.dev website: https://www.continue.dev/
- Continue.dev pricing: https://www.continue.dev/pricing
- Continue.dev review pipeline blog: https://blog.continue.dev/beyond-code-generation-how-continue-enables-ai-code-review-at-scale
- AutoGen GitHub: https://github.com/microsoft/autogen
- Microsoft retires AutoGen (VentureBeat): https://venturebeat.com/ai/microsoft-retires-autogen-and-debuts-agent-framework-to-unify-and-govern
- Microsoft Agent Framework 1.0 (VS Magazine): https://visualstudiomagazine.com/articles/2026/04/06/microsoft-ships-production-ready-agent-framework-1-0-for-net-and-python.aspx
- CrewAI GitHub: https://github.com/crewAIInc/crewAI
- CrewAI enterprise survey (BusinessWire): https://www.businesswire.com/news/home/20260211693427/en/Agentic-AI-Reaches-Tipping-Point-100-of-Enterprises-Plan-to-Expand-Adoption-in-2026-New-CrewAI-Survey-Finds
- Devin.ai website: https://devin.ai
- Devin pricing: https://devin.ai/pricing
- Devin 2.0 pricing cut (VentureBeat): https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500
- Sweep GitHub: https://github.com/sweepai/sweep
- Sweep JetBrains plugin: https://sweep.dev/
- Cline GitHub: https://github.com/cline/cline
- Cline Memory Bank docs: https://docs.cline.bot/features/memory-bank
- Cline vs Cursor comparison: https://www.morphllm.com/comparisons/cline-vs-cursor
- OpenHands GitHub: https://github.com/OpenHands/OpenHands
- OpenHands website: https://openhands.dev/
- Smol Developer GitHub: https://github.com/smol-ai/developer
- Coding agents comparison (Artificial Analysis): https://artificialanalysis.ai/agents/coding
- Token efficiency comparison: https://www.morphllm.com/comparisons/morph-vs-aider-diff
- Claude Code vs Cursor (Builder.io): https://www.builder.io/blog/cursor-vs-claude-code
- Best AI coding agents 2026: https://www.morphllm.com/ai-coding-agent
- Agentic coding trends (Anthropic): https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf
