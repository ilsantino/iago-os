# iaGO-OS Research Sprint

## Goal
Analyze open-source Claude Code configuration repos to cherry-pick patterns for iaGO-OS — our Claude Code configuration layer that loads into every session across all projects.

## Team Context
- 3-person AI consultancy (CEO Windows 11, CTO Mac)
- Stack: React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS
- Agents: LangGraph + Claude SDK, n8n
- Constraints: Node.js hooks only, cross-platform, no heavy deps

## Research Repos

### 1. Everything Claude Code (ECC) — DONE
- **Repo**: `github.com/affaan-m/everything-claude-code`
- **Analysis**: `ecc-analysis.md` (327 lines)
- **Key finds**:
  - All hooks already Node.js, cross-platform
  - `run-with-flags.js` hook dispatcher with profile gating (minimal/standard/strict) — TAKE
  - Session persistence trio: session-start, session-end, pre-compact — TAKE
  - config-protection, post-edit-format, post-edit-typecheck — TAKE
  - cost-tracker (JSONL logging) — TAKE for consultancy spend tracking
  - suggest-compact (tool-call counter) — TAKE
  - 24 of 136 skills relevant; rest are wrong stack
  - Agent pattern: markdown + YAML frontmatter — clean, adoptable
  - File-based session persistence is sufficient; skip SQLite state store

### 2. Ruflo — DONE
- **Repo**: `github.com/ruvnet/ruflo`
- **Analysis**: `ruflo-analysis.md` (483 lines)
- **Key finds**:
  - Crown jewel: `context-persistence-hook.mjs` (1,979 lines) — Context Autopilot
  - Proactive archiving on EVERY prompt (not just at compaction) — superior to ECC
  - Reads actual Claude API token usage from transcript JSONL — real context %
  - Importance scoring: `recency * frequency * richness` — TAKE
  - JsonFileBackend (Tier 4) is zero-dep and sufficient
  - Session manager already cross-platform Node.js
  - Strip from 1,979 to ~600-800 lines (remove SQLite, PostgreSQL, ONNX backends)
  - Skip: daemon infra, swarm coordination, neural learning, Byzantine consensus

### 3. Get Shit Done (GSD) — DONE
- **Repo**: `github.com/gsd-build/get-shit-done`
- **Analysis**: `gsd-analysis.md` (564 lines)
- **Key finds**:
  - 44 slash commands with YAML frontmatter + prompt body
  - Meta-prompting framework: discuss → plan → execute → verify pipeline
  - Fresh-context subagent spawning to avoid context rot
  - State externalized to `.planning/` as human-readable Markdown + JSON
  - Task sizing discipline for context window limits
  - Spec-driven development with verification gates

### 4. Paperclip — DONE
- **Repo**: `github.com/paperclipai/paperclip`
- **Analysis**: `paperclip-analysis.md` (586 lines)
- **Key finds**:
  - Node.js/TypeScript monorepo: Express API + React UI + PostgreSQL via Drizzle
  - Multi-agent orchestration: companies, agents, issues, heartbeats, budgets, approvals
  - 10 adapter types for multi-provider support
  - Plugin system + skills framework
  - Company import/export for multi-client isolation
  - Routines and approval workflows

### 5. The Architect — DONE
- **Repo**: `github.com/Hainrixz/the-architect`
- **Analysis**: `architect-analysis.md` (317 lines)
- **Key finds**:
  - Pure markdown agent (zero code, zero hooks, zero deps)
  - 4-phase conversational workflow: Discovery → Deep Dive → Architecture → Generate
  - Agent-produces-agent-config pattern (design session outputs CLAUDE.md for builder)
  - 16-section blueprint template with build order as most critical section
  - 6 archetypes + 8 building-block decision guides + stack compatibility matrix
  - Opinionated consultant posture ("here's what I'd build" not "here are your options")

### 6. Superpowers — DONE
- **Repo**: `github.com/obra/superpowers`
- **Analysis**: `superpowers-analysis.md` (278 lines)
- **Key finds**:
  - Pure markdown development methodology (v5.0.7), not a runtime tool
  - Verification-before-completion: highest-ROI pattern — prevents false success claims
  - Two-stage review (spec compliance THEN quality) — unique value not in GSD
  - Rationalization prevention technique (excuse/reality tables, red flags) — meta-pattern for writing any iaGO instruction
  - Implementer escalation protocol (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED)
  - Systematic debugging with 3-fix-failure architectural escalation heuristic
  - Plan task granularity: 2-5 min steps, no placeholders, exact file paths
  - CSO (Claude Search Optimization) for command descriptions
  - Skip: git worktrees, visual brainstorm companion, absolute TDD delete rule, TodoWrite coupling

## Emerging Architecture

| Layer | Source | Pattern |
|-------|--------|---------|
| Hook dispatcher | ECC | `run-with-flags.js` with profile gating |
| Context persistence | Ruflo | Proactive archiving + importance-ranked restoration |
| Session management | Ruflo + ECC | File-based JSON, cross-platform paths |
| Workflow enforcement | GSD (pending) | Phase gates: discuss → plan → execute → verify |
| Config protection | ECC | Block linter/formatter config edits |
| Post-edit quality | ECC | Auto-format + typecheck + console.log warn |
| Cost tracking | ECC | Per-response JSONL with project attribution |
| Compaction | ECC + Ruflo | suggest-compact (counter) + pre-compact snapshots + autopilot |
| Agent definitions | ECC + Ruflo | Markdown + YAML frontmatter |

## Next Steps
1. ~~Re-run GSD subagent to completion — write `gsd-analysis.md`~~ DONE
2. ~~Analyze Paperclip repo~~ DONE
3. ~~Analyze The Architect repo~~ DONE
4. ~~Analyze Superpowers repo~~ DONE
5. Synthesize all findings into iaGO-OS design spec
6. Begin implementation
