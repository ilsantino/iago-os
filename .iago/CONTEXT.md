# `.iago/` — iaGO Workspace (MWP L1)

**Purpose:** Workspace entry routing for the iaGO-OS workflow. Every iaGO-managed phase, plan, review, decision, and stress-test artifact lives somewhere under this directory.

**MWP layer:** L1 — workspace entry routing. Reads ahead of any L2 stage CONTEXT.md to set context for which stage applies.

**Token budget:** keep this file under ~300 tokens of routing content (caps lower than L0 `CLAUDE.md` which is ~800 tokens).

## Doc-routing — where canonical specs live

| Topic | Authoritative location |
|---|---|
| iaGO-OS root rules + tech stack + execution discipline | `CLAUDE.md` (repo root, L0) |
| v2 architecture + AgentRuntime + 5 shapes | `docs/specs/iago-os-v2-vision.md` |
| v2 executable brief for builder agents | `docs/specs/iago-os-v2-master-prompt.md` |
| MWP doc-routing decision tree | `docs/specs/iago-os-mwp-routing-rule.md` |
| Path-scoped operational rules | `.claude/rules/*.md` |
| Skills + agent profiles | `.claude/skills/`, `.claude/agents/` |
| Architecture Decision Records | `.iago/decisions/YYYY-MM-DD-<slug>.md` |
| Operational runbooks | `.iago/runbooks/<name>.md` |
| Active phase status digest | `.iago/STATE.md` |
| Current execution plans | `.iago/plans/feature-<slug>/NN.md` |

## Layer assignments — what each `.iago/` subdir is

Per MWP §3.2: L3 = factory (configured once, stable, internalized by agents as constraints); L4 = product (per-run, processed as input).

| Subdir | Layer | Role |
|---|---|---|
| `.iago/decisions/` | **L3 reference** | ADRs — stable decisions that bind future work |
| `.iago/runbooks/` | **L3 reference** | Operational procedures — stable how-to for repeatable ops |
| `.iago/learnings/` | **L3 reference** | Accumulated review patterns (5+ occurrences → CLAUDE.md candidate) |
| `.iago/context/` | **L3 reference** | Long-term context artifacts (project framing, voice, conventions) |
| `.iago/prompts/` | **L3 reference** | Reusable prompt fragments |
| `.iago/hooks/` | **L3 reference** | Hook implementations (safety-guard, config-protection, post-edit-format) |
| `.iago/plans/` | **L4 product** | Per-execution plans — one folder per feature; consumed by `/iago-execute` |
| `.iago/research/` | **L4 product** | Per-question research artifacts — one-off analysis, dated |
| `.iago/reviews/` | **L4 product** | Per-PR review outputs from pipeline + adversarial sessions |
| `.iago/summaries/` | **L4 product** | Per-execution summaries written by pipeline step 6 |
| `.iago/state/` | **L4 product** | Session-specific runtime markers (gitignored, README tracked) |
| `.iago/logs/` | **L4 product** | Pipeline run logs (gitignored, README tracked) |

## Stage contracts (L2) — where the work actually executes

Each active "stage" (a coherent unit of work — a phase, a feature, a daemon build) declares its own `CONTEXT.md` with Inputs / Process / Outputs per MWP §3.2.

| Stage | CONTEXT.md location |
|---|---|
| **iago-os v2 daemon build (Phase 1)** | `runtime/CONTEXT.md` |
| **v2 foundation phase (Phase 0 + 0.5 + 1)** | `.iago/plans/feature-v2-foundation/CONTEXT.md` |
| Other feature phases | `.iago/plans/feature-<slug>/CONTEXT.md` *(write when starting a new phase)* |

A new phase that doesn't yet have a stage CONTEXT.md must write one before starting execution. The L2 stage contract is the control mechanism — it makes context selection (which L3 references load, which L4 artifacts consume) explicit, editable, and auditable instead of relying on the agent's judgment.

## When to read this file

- **First read** at the start of any iaGO-managed session that touches `.iago/`
- **Before navigating** to a subdirectory — confirm the layer assignment
- **When unsure** which canonical spec is authoritative — the doc-routing table answers

## Source

- MWP method: `.iago/research/2026-05-13-mwp-source-synthesis.md` (canonical synthesis of ICM paper + Eduba vault-toolkit + Clief Notes Skills Field Manual)
- MWP doc-routing rule: `docs/specs/iago-os-mwp-routing-rule.md`
- ICM paper §3.2 (Van Clief & McDermott 2026) — five-layer context hierarchy
