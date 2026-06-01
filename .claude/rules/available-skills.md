---
description: >-
  Reference of available skills and agents. Loaded at session start.
---

## Quick Reference — "What Do I Run?"

| I want to... | Run this | Example |
|---|---|---|
| **Build a feature** (have requirements) | `/iago-plan --feature` | `/iago-plan --feature "add user dashboard with role-based views"` |
| **Build from a doc** (PDF, MD, spec) | `/iago-plan --feature path` | `/iago-plan --feature docs/specs/auth-flow.md` |
| **Execute existing plans** | `/iago-execute` | `/iago-execute 01-auth` or `/iago-execute feature-payment` |
| **Small fix** (1-3 tasks, clear scope) | `/iago-quick` | `/iago-quick "fix login redirect after signup"` |
| **Trivial fix** (<=3 files, obvious) | `/iago-fast` | `/iago-fast "update API base URL env var"` |
| **Explore a feature idea** (no spec yet) | `/brainstorming` | `/brainstorming user-dashboard` |
| **Research something** | `/deep-research` | `/deep-research "DynamoDB TTL patterns"` |
| **Fix PR review comments** | `/iago-prfix` | `/iago-prfix` |
| **Debug a stuck issue** | `/codex:rescue` | `/codex:rescue "auth middleware fails on refresh"` |
| **Start a new client project** | `/iago-scaffold` then `/iago-init` | `/iago-scaffold client-name` |
| **Onboard existing codebase** | `/iago-onboard` | `/iago-onboard` |
| **Deep audit Amplify repo** | `/amplify-bug-bounty` | `/amplify-bug-bounty` (pre-launch, post-incident, periodic) |
| **Deep audit React frontend** | `/frontend-bug-bounty` | `/frontend-bug-bounty` (pre-launch, post-incident, periodic) |

## Size Your Task

Not sure which skill? Use task size:

```
Trivial (<=3 files, obvious)     → /iago-fast
Small (1-3 tasks, clear scope)   → /iago-quick
Medium (4-8 tasks, one feature)  → /iago-plan --feature → /iago-execute
Large (multi-feature, phased)    → /iago-init → /iago-plan → /iago-execute
```

## Delivery Pipeline (the full workflow)

The full delivery workflow (init → discuss → plan → execute → verify), the standalone-feature path, the pipeline flags, and the per-plan pipeline stage table live in `CLAUDE.md` (Workflow + Execution Path) and `.claude/rules/execution-pipeline.md`. See those for the canonical sequence and stages.

## All Skills

### Planning and Execution

| Skill | What | When to use | When NOT to use |
|-------|------|-------------|-----------------|
| `/iago-plan` | Create implementation plans (2-8 tasks each) | Have requirements and need a plan | Trivial fix (use `/iago-fast`) or 1-3 tasks (use `/iago-quick`) |
| `/iago-execute` | Run plans through 8-stage pipeline | Plans exist, ready to implement | No plans yet (run `/iago-plan` first) |
| `/iago-quick` | Lightweight plan + pipeline, one shot | 1-3 tasks, clear scope, standalone | Part of a ROADMAP phase |
| `/iago-fast` | Inline fix, build gate only | <=3 file edits, obvious change | Scope unclear or >3 files |
| `/iago-stress` | Adversarial stress-test on plan(s). `--deep` for council-style multi-lens (5 reviewers + peer review) | Want to stress-test before execution | Already running `/iago-plan` (it includes stress test) |
| `/iago-verify` | Verify completed phase against goals | Phase executed, PRs merged | Plans not executed yet |
| `/iago-prfix` | Tag @claude on PR for async review-fix | PR exists, needs review | Already tagged (don't double-tag) |

### Design and Research

| Skill | What | When to use | When NOT to use |
|-------|------|-------------|-----------------|
| `/brainstorming` | Socratic exploration, writes spec | Feature idea, no spec yet | Spec already exists (use `/iago-plan --feature path`) |
| `/writing-plans` | Break spec into tasks (non-pipeline) | Spec exists, want in-session execution | Want pipeline review (use `/iago-plan --feature`) |
| `/deep-research` | Multi-source research | Need to investigate beyond codebase | Answer is in the codebase (just search) |
| `/council` | 5-advisor council (Karpathy LLM Council) with peer review + synthesis | Business/strategic decisions with genuine uncertainty | Factual lookups, creation tasks, one-right-answer questions |
| `/santa-method` | Structured problem decomposition | Complex, ambiguous problem | Requirements already clear |
| `/code-review` | Dispatch reviewer on completed work | Implementation done, needs review | Still implementing or using pipeline (pipeline reviews automatically) |

### Project Setup

| Skill | What | When to use | When NOT to use |
|-------|------|-------------|-----------------|
| `/iago-init` | Bootstrap .iago/ with PROJECT/ROADMAP/STATE | Starting a new project in iaGO workflow | PROJECT.md already exists |
| `/iago-scaffold` | Full project directory (React 19 + Vite + AWS) | New client project needs codebase | Existing codebase (use `/iago-onboard`) |
| `/iago-onboard` | Scan codebase, produce architecture map | Existing codebase, new to iaGO workflow | New project (use `/iago-scaffold`) |
| `/iago-discuss` | Clarify gray areas for a ROADMAP phase | Before planning a ROADMAP phase | Feature mode (use `--discuss` flag on `/iago-plan`) |
| `/iago-pause` | Save session state for later resume | Switching context, ending day | Work is complete (use `/iago-verify`) |

### Content and Business

| Skill | What | When to use | When NOT to use |
|-------|------|-------------|-----------------|
| `/content-engine` | Articles, blog posts, multi-format output | Written content needed | Investor materials (use `/investor-materials`) |
| `/investor-materials` | Pitch decks, one-pagers | Investor-facing documents | Market research (use `/deep-research --focus market`) |
| `/investor-outreach` | Investor emails, outreach sequences | Drafting investor comms | Creating pitch materials (use `/investor-materials`) |
| `/iago-proposal` | Client proposal (scope, timeline, cost) | New client engagement | Project already initiated |
| `/frontend-slides` | Presentation slides from code/data | Need slide deck | Static documents (use `/content-engine`) |
| `/visa-doc-translate` | Visa document translation | Immigration documents | General translation |

### Automation and Architecture

| Skill | What | When to use | When NOT to use |
|-------|------|-------------|-----------------|
| `/iago-n8n` | Design n8n workflows | Webhook/Lambda/DynamoDB automations | Building workflows directly (this produces designs) |
| `/iago-agents` | Design multi-agent architectures | Client agent deliverables | Configuring iaGO's own agents |
| `/iago-schedule` | Set up scheduled triggers | Recurring automated tasks | One-off commands (just run them) |
| `/prompt-optimizer` | Optimize LLM prompts | Client chatbots, agents, extraction | Writing CLAUDE.md rules or skill files |

### Specialized

| Skill | What | When to use |
|-------|------|-------------|
| `/subagent-driven-development` | Execute plan with fresh agent per task | Multi-task plan, want in-session execution (not pipeline) |
| `/autonomous-loops` | Long task without per-step approval | Bulk refactors, batch processing |
| `/continuous-agent-loop` | Persistent watching agent | Monitoring, polling, CI |
| `/industry-patterns` | Domain-specific patterns | `--domain logistics\|inventory\|customs\|energy\|carrier\|production\|quality\|returns` |
| `/healthcare-phi-compliance` | HIPAA/PHI compliance | Healthcare features with PHI |
| `/liquid-glass-design` | Glassmorphism UI effects | Design calls for glass effects |
| `/agent-payment-x402` | Agent-to-agent payment (x402) | Agent payment flows, not Stripe/PayPal |

### Audit / Bug Bounty (on-demand deep sweeps)

The pipeline already runs the highest-leverage rules from these skills on every plan via `scripts/review-checks/data-integrity.md`, `scripts/review-checks/amplify.md`, and `scripts/review-checks/shell-deploy.md` (this last one auto-triggered on diffs touching `**/deploy/**`, `**/*.sh`, or systemd unit files — covers remote ssh pipefail, secret-file mode races, systemctl state guards, log-pattern coverage). Use the full skills for periodic deep sweeps — new client onboarding, pre-launch hardening, post-incident audits — not as a per-plan gate.

| Skill | What | When to use | When NOT to use |
|-------|------|-------------|-----------------|
| `/amplify-bug-bounty` | Full Amplify Gen 2 audit (~200 rules): CFN cycles, AppSync auth, multi-tenancy, IAM, Cognito, S3 | Pre-launch on any Amplify Gen 2 client, post-incident audit, periodic (monthly) sweep | Per-plan gate — pipeline already runs critical rules |
| `/frontend-bug-bounty` | Full React 19 + Vite + TS + Tailwind audit (~280 rules incl. Section Q data correctness) | Pre-launch on any React client, post-incident audit, periodic sweep | Per-plan gate — pipeline already runs critical Section Q rules |

### Codex (cross-model)

| Skill | What |
|-------|------|
| `/codex:rescue` | Delegate debugging or implementation to GPT-5.5 (`--write` for fixes) |
| `/codex:adversarial-review` | Cross-model review (auth, data loss, races, business logic) |
| `/codex:review` | GPT-5.5 read-only code review against git changes |
| `/codex:status` | Show active/recent Codex background jobs |
| `/codex:result` | Retrieve output from finished Codex job |
| `/codex:cancel` | Cancel active background Codex job |
| `/codex:setup` | Check Codex CLI readiness, manage review gate |
| `/dual-adversarial` | Final pre-merge Opus 4.8 ∥ Codex GPT-5.5 gate over a PR/branch diff, independent + aggressive, optional security/code/test/completeness lenses; read-only, never merges |

### Built-in (Claude Code native)

| Skill | What |
|-------|------|
| `/simplify` | Review changed code for reuse/quality, fix issues |
| `/loop` | Run command on interval (e.g., `/loop 5m /codex:status`) |
| `/schedule` | Create/manage cron-scheduled remote agents |
| `/claude-api` | Guidance for Claude API, Anthropic SDK, Agent SDK |
| `/ultraplan` | Cloud planning on Opus 4.6 via CCR (30 min compute) |
| `/powerup` | In-terminal interactive tutorials |
| `/insights` | 30-day usage analytics HTML report |

### MCP Servers (active)

| Server | What | When to use |
|--------|------|-------------|
| `context7` | Library/framework docs | API syntax, setup, version migration (prefer over web search) |
| `obsidian` | Read/write Obsidian vault | Notes, meetings, decisions, session digests |
| `graphify` | Knowledge graph over vault | Entity relationships, community structure (check before raw search) |
| `mempalace` | Conversation history + KG | Past reasoning, conversation recall, agent diary |
| `markitdown` | Document → markdown conversion (DOCX, PPTX, XLSX, EPub, YouTube, large PDFs) | Ingesting client files Claude can't read natively — briefs, RFPs, financial models, meeting DOCX, PDFs >20 pages |

## Agent Architecture

Internal implementation detail. Skills dispatch agents automatically — you don't need to know this to use the system. The base/profile/capability composition and hub-and-spoke dispatch model are documented in `CLAUDE.md` (Agents + Model Routing); the authoritative definitions and live counts are in `.claude/agents/`.
