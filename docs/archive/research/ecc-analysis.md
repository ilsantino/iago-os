# ECC Analysis

## Overview

**Everything Claude Code (ECC)** is a v1.9.0, MIT-licensed Claude Code plugin containing 30 agents, 136 skills, 61 commands, hooks, rules, and MCP configs. It is described as "battle-tested configs evolved over 10+ months of intensive daily use by an Anthropic hackathon winner." The repo supports multiple AI code editors (Claude Code, Cursor, Kiro, Codex, OpenCode, Trae) with parallel config directories for each.

**Maturity**: High. 1,028+ merged PRs. Active community contributions. Comprehensive test suite (`tests/` mirrors `scripts/`). All hooks are Node.js for cross-platform support. The hooks system is production-grade with profile-based gating, stdin truncation protection, path traversal guards, and graceful error handling.

**Quality**: Very high for hooks and lib utilities. Skills vary from excellent (tdd-workflow, verification-loop, security-review, strategic-compact) to niche/irrelevant (healthcare-phi-compliance, carrier-relationship-management, perl-patterns). The codebase is CommonJS throughout (no ESM, no TypeScript in the infra), which is a deliberate cross-platform choice.

**Key insight**: ECC is designed for a polyglot, multi-editor world. iaGO-OS is Claude Code-only, TypeScript-strict, AWS-only. We want the proven patterns, not the breadth.

---

## Hooks -- Full Catalog

Every hook script in `scripts/hooks/` is Node.js (`.js`). The only bash component is `run-with-flags-shell.sh`, a thin wrapper that delegates to Node for the enable-check.

| Hook | What It Does | Bash/Node | Take/Adapt/Skip | Reasoning | Source Path |
|------|-------------|-----------|-----------------|-----------|-------------|
| **run-with-flags.js** | Central hook dispatcher. Checks if hook is enabled by profile (minimal/standard/strict) and ECC_DISABLED_HOOKS env. Supports direct `require()` for hooks exporting `run()` (saves ~100ms per hook) or falls back to `spawnSync`. | Node | TAKE | Core infrastructure. Eliminates per-hook boilerplate. Allows profile-based hook toggling. | `scripts/hooks/run-with-flags.js` |
| **hook-flags.js** | Shared library: `isHookEnabled(hookId, {profiles})`. Reads ECC_HOOK_PROFILE and ECC_DISABLED_HOOKS env vars. | Node | TAKE | Dependency of run-with-flags.js. Clean, 74 lines. | `scripts/lib/hook-flags.js` |
| **run-with-flags-shell.sh** | Bash wrapper for shell-based hook scripts. Calls Node's check-hook-enabled.js for gating, then pipes stdin to the target script. | Bash | SKIP | Only used by continuous-learning-v2 observer (bash-only hooks). We require Node.js hooks. | `scripts/hooks/run-with-flags-shell.sh` |
| **check-hook-enabled.js** | CLI helper: outputs "yes" or "no" for a given hookId + profiles. Used by the bash wrapper. | Node | SKIP | Only needed if keeping the bash wrapper. | `scripts/hooks/check-hook-enabled.js` |
| **session-start.js** | SessionStart lifecycle hook. Loads previous session summary from `~/.claude/session-data/`, detects package manager, detects project type (languages/frameworks), loads learned skills, lists session aliases. Injects context via `hookSpecificOutput`. | Node | ADAPT | Excellent session continuity pattern. Needs adaptation: remove package-manager detection (we use pnpm), simplify project detection (we know our stack). | `scripts/hooks/session-start.js` |
| **session-end.js** | Stop hook. Reads transcript JSONL, extracts user messages, tools used, files modified. Writes/updates a session summary file with idempotent marker-based sections. | Node | TAKE | The core session persistence mechanism. Well-engineered with marker-based idempotent updates, merge-on-existing, and header normalization. | `scripts/hooks/session-end.js` |
| **pre-compact.js** | PreCompact hook. Logs compaction timestamp, appends note to active session file. | Node | TAKE | Simple (49 lines), valuable for session continuity. Marks when context was compacted so the next session-start knows. | `scripts/hooks/pre-compact.js` |
| **session-end-marker.js** | SessionEnd lifecycle hook. Pure passthrough (no-op). | Node | SKIP | Does nothing useful. Placeholder for future use. | `scripts/hooks/session-end-marker.js` |
| **config-protection.js** | PreToolUse (Write/Edit/MultiEdit). Blocks modifications to linter/formatter config files (.eslintrc, biome.json, .prettierrc, etc.). Forces agent to fix code instead. | Node | TAKE | Excellent guardrail. Agents love to weaken configs. 141 lines, exports `run()` for fast in-process execution. Handles truncated input gracefully. | `scripts/hooks/config-protection.js` |
| **doc-file-warning.js** | PreToolUse (Write). Warns about ad-hoc doc files (NOTES.md, TODO.md, SCRATCH.md) outside structured dirs. Denylist approach, not allowlist. | Node | TAKE | Lightweight (91 lines), useful guardrail. Prevents Claude from creating random doc files. | `scripts/hooks/doc-file-warning.js` |
| **pre-write-doc-warn.js** | Backward-compat entrypoint. Just `require('./doc-file-warning.js')`. | Node | SKIP | Compatibility shim, not needed. | `scripts/hooks/pre-write-doc-warn.js` |
| **pre-bash-commit-quality.js** | PreToolUse (Bash). Before `git commit`: checks staged files for console.log, debugger, hardcoded secrets (AWS keys, GitHub PATs, OpenAI keys). Validates conventional commit message format. Runs ESLint if available. Blocks on errors, warns on warnings. | Node | ADAPT | Valuable but over-scoped. Keep secret detection and debugger check. Remove Go/Python linting (not our stack). Simplify commit message validation to match our conventions. | `scripts/hooks/pre-bash-commit-quality.js` |
| **pre-bash-dev-server-block.js** | PreToolUse (Bash). Blocks `npm run dev` etc. outside tmux on non-Windows. Complex shell tokenizer to extract command words. | Node | SKIP | Not relevant. We don't require tmux. Windows has no tmux. The `auto-tmux-dev.js` hook is the better pattern. | `scripts/hooks/pre-bash-dev-server-block.js` |
| **auto-tmux-dev.js** | PreToolUse (Bash). Transforms dev server commands to run in tmux (macOS/Linux) or `start cmd` (Windows). Project-name-based session naming. | Node | ADAPT | Good idea for CTO on Mac. Needs adaptation: make it optional, skip on Windows (CEO uses terminal directly). | `scripts/hooks/auto-tmux-dev.js` |
| **pre-bash-tmux-reminder.js** | PreToolUse (Bash). Suggests tmux for long-running commands (npm test, cargo build, docker, etc.). Non-blocking. Skips on Windows. | Node | SKIP | 34 lines, low value for 3-person team. We know when to use tmux. | `scripts/hooks/pre-bash-tmux-reminder.js` |
| **pre-bash-git-push-reminder.js** | PreToolUse (Bash). Warns "review changes before push." | Node | SKIP | 29 lines, trivially simple. More annoying than helpful for experienced devs. | `scripts/hooks/pre-bash-git-push-reminder.js` |
| **suggest-compact.js** | PreToolUse (Edit/Write). Counts tool calls in session (via temp file). Suggests `/compact` at threshold (default 50) and every 25 calls after. Session-ID-scoped counter. | Node | TAKE | Smart context management. 81 lines. Prevents the "context silently degraded" problem. The temp-file counter is a clever lightweight approach. | `scripts/hooks/suggest-compact.js` |
| **quality-gate.js** | PostToolUse (Edit/Write/MultiEdit). Runs formatter checks after edits. Auto-detects Biome vs Prettier. Handles Go (gofmt) and Python (ruff) too. Skips JS/TS when Biome handles it. | Node | ADAPT | Good pattern but needs stripping. Keep Prettier/Biome check for TS/TSX only. Remove Go, Python. | `scripts/hooks/quality-gate.js` |
| **post-edit-format.js** | PostToolUse (Edit). Auto-formats JS/TS with detected formatter (Biome: check --write; Prettier: --write). Windows-safe with .cmd handling and shell metachar guards. | Node | TAKE | Production-quality formatter hook. 110 lines. Handles Windows .cmd binaries correctly with injection protection. | `scripts/hooks/post-edit-format.js` |
| **post-edit-typecheck.js** | PostToolUse (Edit). Runs `tsc --noEmit` after editing .ts/.tsx files. Walks up to find tsconfig.json. Filters output to only show errors in the edited file. | Node | TAKE | Essential for TypeScript strict mode. 97 lines. Smart filtering avoids flooding with unrelated errors. | `scripts/hooks/post-edit-typecheck.js` |
| **post-edit-console-warn.js** | PostToolUse (Edit). Warns about console.log in edited JS/TS files. Shows line numbers. | Node | TAKE | Simple (55 lines), useful. Catches debug statements before they ship. | `scripts/hooks/post-edit-console-warn.js` |
| **check-console-log.js** | Stop hook. Checks ALL git-modified JS/TS files for console.log after each response. Excludes test files, config files, scripts/. | Node | SKIP | Redundant with post-edit-console-warn.js. The per-edit check is sufficient. | `scripts/hooks/check-console-log.js` |
| **post-bash-pr-created.js** | PostToolUse (Bash). After `gh pr create`, logs PR URL and review command. | Node | TAKE | Tiny (37 lines), useful convenience. No adaptation needed. | `scripts/hooks/post-bash-pr-created.js` |
| **post-bash-build-complete.js** | PostToolUse (Bash). After build commands, logs "async analysis running." | Node | SKIP | Placeholder hook. Does nothing useful. | `scripts/hooks/post-bash-build-complete.js` |
| **cost-tracker.js** | Stop hook. Estimates cost per response based on model (Haiku/Sonnet/Opus rates) and token counts. Appends JSONL to `~/.claude/metrics/costs.jsonl`. | Node | TAKE | Valuable for a consultancy tracking AI spend. 79 lines. Simple JSONL append. Could extend with project attribution. | `scripts/hooks/cost-tracker.js` |
| **evaluate-session.js** | Stop hook. Reads transcript, counts user messages. If session > N messages, signals Claude to extract reusable patterns (continuous learning). | Node | SKIP | Part of the continuous-learning subsystem which is complex and over-engineered for a 3-person team. | `scripts/hooks/evaluate-session.js` |
| **desktop-notify.js** | Stop hook. Sends macOS notification (osascript) or WSL notification (PowerShell + BurntToast). Extracts summary from last assistant message. | Node | ADAPT | Mac notification is useful for CTO. Windows support via WSL/BurntToast is fragile. Adapt: keep macOS, add native Windows PowerShell toast (skip WSL layer). | `scripts/hooks/desktop-notify.js` |
| **governance-capture.js** | PreToolUse + PostToolUse. Detects secrets, policy violations, approval-needed commands, sensitive file access. Emits governance events to stderr as JSON. Opt-in via ECC_GOVERNANCE_CAPTURE=1. | Node | ADAPT | Secret detection patterns are excellent. Strip the governance event framework (overkill for 3 people). Keep the regex patterns for a simpler pre-commit secret scan. | `scripts/hooks/governance-capture.js` |
| **mcp-health-check.js** | PreToolUse + PostToolUseFailure. Probes MCP servers before tool calls. Caches health state. Supports reconnect commands. Exponential backoff. HTTP and stdio server probing. | Node | SKIP | 620 lines. Extremely sophisticated. Overkill unless you have unreliable MCP servers. Our servers (context7, obsidian) are stable. | `scripts/hooks/mcp-health-check.js` |
| **insaits-security-wrapper.js** | PreToolUse. Node wrapper that delegates to Python `insaits-security-monitor.py`. Opt-in via ECC_ENABLE_INSAITS=1. | Node+Python | SKIP | Requires pip install of third-party Python package. External dependency we don't need. | `scripts/hooks/insaits-security-wrapper.js` |
| **insaits-security-monitor.py** | Python security scanner. | Python | SKIP | Python dependency, not in our stack. | `scripts/hooks/insaits-security-monitor.py` |

---

## Skills -- Full Catalog

136 skills total. Categorized by relevance to iaGO-OS (React 19 + Vite + TS strict + TailwindCSS 4 + ShadCN/UI + AWS + Claude SDK + LangGraph).

### Directly Relevant (TAKE/ADAPT)

| Skill | What It Does | Take/Adapt/Skip | Reasoning | Source Path |
|-------|-------------|-----------------|-----------|-------------|
| coding-standards | Universal TS/JS/React standards, KISS/DRY/YAGNI principles | ADAPT | Good foundation, adapt for our strict TS + TailwindCSS 4 conventions | `skills/coding-standards/SKILL.md` |
| frontend-patterns | React component patterns, state mgmt, data fetching, forms | ADAPT | Solid React patterns. Add React 19 specifics (use, Actions, server components) | `skills/frontend-patterns/SKILL.md` |
| backend-patterns | REST API, repository pattern, service layer, caching | ADAPT | Good patterns. Adapt for API Gateway + Lambda + DynamoDB instead of Express | `skills/backend-patterns/SKILL.md` |
| api-design | REST API design: resources, status codes, pagination, versioning | TAKE | Stack-agnostic best practices, directly applicable | `skills/api-design/SKILL.md` |
| tdd-workflow | TDD with 80% coverage, unit/integration/E2E | TAKE | Our workflow already. Good structured reference | `skills/tdd-workflow/SKILL.md` |
| verification-loop | Build > typecheck > lint > test > security verification | TAKE | Excellent pre-PR checklist pattern | `skills/verification-loop/SKILL.md` |
| security-review | Security checklist: secrets, input validation, XSS, CSRF | TAKE | Comprehensive, stack-agnostic | `skills/security-review/SKILL.md` |
| strategic-compact | Manual compaction at logical task boundaries | TAKE | Already wired into hooks. Good skill doc | `skills/strategic-compact/SKILL.md` |
| claude-api | Claude API patterns (Python + TS), streaming, tool use, vision | TAKE | Directly relevant for our Claude SDK integration | `skills/claude-api/SKILL.md` |
| mcp-server-patterns | Build MCP servers with Node/TS SDK | TAKE | Relevant for custom MCP servers | `skills/mcp-server-patterns/SKILL.md` |
| e2e-testing | E2E with Playwright | TAKE | We use Playwright | `skills/e2e-testing/SKILL.md` |
| database-migrations | Schema migration patterns | ADAPT | Needs DynamoDB single-table adaptation (not SQL migrations) | `skills/database-migrations/SKILL.md` |
| docker-patterns | Docker development patterns | TAKE | Useful for Lambda container images | `skills/docker-patterns/SKILL.md` |
| deployment-patterns | CI/CD and deployment patterns | ADAPT | Adapt for Amplify Gen 2 | `skills/deployment-patterns/SKILL.md` |
| deep-research | Multi-source research workflow | TAKE | Useful for consultancy research tasks | `skills/deep-research/SKILL.md` |
| prompt-optimizer | Optimize prompts for LLMs | TAKE | Directly relevant for agent development | `skills/prompt-optimizer/SKILL.md` |
| agentic-engineering | Patterns for building AI agents | TAKE | Core to our LangGraph + Claude SDK work | `skills/agentic-engineering/SKILL.md` |
| git-workflow | Git branching, PR, and merge patterns | TAKE | Standard git discipline | `skills/git-workflow/SKILL.md` |
| context-budget | Token budget management | TAKE | Important for agent cost control | `skills/context-budget/SKILL.md` |
| codebase-onboarding | Rapid codebase understanding | TAKE | Useful for client project onboarding | `skills/codebase-onboarding/SKILL.md` |
| search-first | Search before creating (avoid duplication) | TAKE | Good development discipline | `skills/search-first/SKILL.md` |
| repo-scan | Repository structure analysis | TAKE | Useful for client audits | `skills/repo-scan/SKILL.md` |
| product-lens | Product thinking for developers | TAKE | Good for consultancy mindset | `skills/product-lens/SKILL.md` |
| safety-guard | AI safety patterns | TAKE | Important for responsible AI consulting | `skills/safety-guard/SKILL.md` |

### Potentially Useful (ADAPT with effort)

| Skill | What It Does | Take/Adapt/Skip | Reasoning | Source Path |
|-------|-------------|-----------------|-----------|-------------|
| continuous-learning | Extract patterns from sessions | ADAPT | Interesting concept but complex. Consider simplified version | `skills/continuous-learning/` |
| continuous-learning-v2 | Observation-based learning with bash hooks | SKIP | Uses bash observer hooks, over-engineered | `skills/continuous-learning-v2/` |
| eval-harness | Evaluation harness for agents | ADAPT | Useful for quality-gating our agents, needs simplification | `skills/eval-harness/SKILL.md` |
| cost-aware-llm-pipeline | Cost-optimized LLM pipelines | TAKE | Directly relevant for Haiku/Sonnet/Opus routing | `skills/cost-aware-llm-pipeline/SKILL.md` |
| architecture-decision-records | ADR documentation | TAKE | Good for 3-person team alignment | `skills/architecture-decision-records/SKILL.md` |
| design-system | Design system patterns | ADAPT | Adapt for ShadCN/UI + TailwindCSS 4 | `skills/design-system/SKILL.md` |
| token-budget-advisor | Token budget recommendations | TAKE | Useful for agent development | `skills/token-budget-advisor/SKILL.md` |
| security-scan | Automated security scanning | TAKE | Complementary to security-review | `skills/security-scan/SKILL.md` |
| content-hash-cache-pattern | Content-addressable caching | TAKE | Useful for DynamoDB cache patterns | `skills/content-hash-cache-pattern/SKILL.md` |

### Skip Entirely (wrong stack, niche, or irrelevant)

The remaining ~100 skills fall into these categories and should be SKIPPED:

- **Wrong language**: golang-*, python-*, rust-*, swift-*, kotlin-*, java-*, perl-*, php-*, cpp-*, csharp (we use TypeScript only)
- **Wrong framework**: django-*, laravel-*, springboot-*, nuxt4-*, nextjs-turbopack (we use React 19 + Vite, not Next.js)
- **Niche/industry**: healthcare-*, carrier-*, customs-*, energy-*, logistics-*, inventory-*, production-scheduling, quality-nonconformance, returns-reverse-logistics
- **Platform-specific**: android-clean-architecture, compose-multiplatform, swiftui-patterns, flutter-*, foundation-models-on-device
- **Third-party tools**: bun-runtime, clickhouse-io, videodb, fal-ai-media, exa-search, x-api, crosspost, nanoclaw-repl
- **ECC meta-tools**: configure-ecc, skill-comply, skill-stocktake, rules-distill, openclaw-persona-forge, plankton-code-quality, ralphinho-rfc-pipeline, blueprint, benchmark, canary-watch, dmux-workflows, claude-devfleet
- **Content/business**: article-writing, content-engine, investor-materials, investor-outreach, market-research, visa-doc-translate, frontend-slides
- **Experimental**: autonomous-loops, continuous-agent-loop, enterprise-agent-ops, agent-payment-x402, liquid-glass-design, santa-method

---

## Agent Pattern

Agents are defined as **Markdown files with YAML frontmatter** in `agents/*.md`. 30 agents total.

### Format

```yaml
---
name: architect
description: Software architecture specialist...
tools: ["Read", "Grep", "Glob"]
model: opus
---

[System prompt markdown body]
```

### Key Fields
- **name**: lowercase-hyphenated identifier
- **description**: When to use this agent (used for routing decisions)
- **tools**: Allowlist of tools the agent can access (Read, Grep, Glob, Bash, Edit, Write, etc.)
- **model**: `opus`, `sonnet`, or `haiku` -- determines which Claude model is used

### Model Routing
- **opus**: architect, planner (complex reasoning, design decisions)
- **sonnet**: code-reviewer, build-error-resolver, tdd-guide, e2e-runner, security-reviewer, refactor-cleaner, and most others (balanced capability)
- No haiku agents defined (reserved for high-volume, cost-sensitive tasks)

### Tool Restrictions
- Read-only agents (architect, planner): `["Read", "Grep", "Glob"]`
- Code review: adds `"Bash"` for running git diff
- Active agents (tdd-guide, e2e-runner): full tool access including Edit/Write

### Relevant Agents for iaGO-OS
| Agent | Model | Worth Taking |
|-------|-------|-------------|
| architect | opus | YES - system design |
| planner | opus | YES - implementation planning |
| code-reviewer | sonnet | YES - code quality |
| security-reviewer | sonnet | YES - security audit |
| tdd-guide | sonnet | YES - TDD workflow |
| e2e-runner | sonnet | YES - Playwright testing |
| build-error-resolver | sonnet | ADAPT - for Vite/TS errors |
| typescript-reviewer | sonnet | YES - TS-specific review |
| doc-updater | sonnet | YES - documentation |

Skip: go-*, python-*, rust-*, kotlin-*, java-*, flutter-*, cpp-*, healthcare-*, pytorch-*

---

## Config Architecture

### Hierarchy (from ECC repo)

1. **`CLAUDE.md`** (repo root): Project-level guidance. Describes architecture, test commands, development notes, skill routing table.

2. **`.claude/rules/*.md`**: Always-active rules files. Two found:
   - `everything-claude-code-guardrails.md` -- generated bundle: commit style, architecture conventions, detected workflows
   - `node.md` -- project-specific: stack (Node 18+, CommonJS), file conventions, hook development rules, testing requirements

3. **`RULES.md`** (repo root): Concise must-always/must-never rules. Agent format, skill format, hook format, commit style.

4. **`hooks/hooks.json`**: Complete hook registration. Uses Claude Code's `$schema` for validation. Defines all PreToolUse, PostToolUse, PreCompact, SessionStart, Stop, SessionEnd hooks with matchers, timeouts, and async flags.

5. **`.claude/identity.json`**: User preferences (technical level, verbosity, domains).

6. **`.claude/team/*.json`**: Team configuration.

7. **`.claude/ecc-tools.json`**: Tool configuration for ECC-specific operations.

8. **`.mcp.json`**: MCP server configs (github, context7, exa, memory, playwright, sequential-thinking).

### How They Compose
- `CLAUDE.md` is loaded first as project context
- `.claude/rules/` files are always-active constraints
- `hooks/hooks.json` registers event-driven automations
- Skills are activated on-demand by commands or context matching
- Agents are spawned as subagents with specific tool/model configs
- MCP servers provide external tool access

### For iaGO-OS
We should adopt:
- Single `CLAUDE.md` with our stack, conventions, and agent routing
- `.claude/rules/` with our guardrails (TS strict, AWS patterns, no experimental)
- `hooks.json` with curated subset of hooks
- `.mcp.json` for our MCP servers (obsidian, context7, etc.)

---

## State Management

### Session Persistence (File-Based)
- **Location**: `~/.claude/session-data/` (canonical) or `~/.claude/sessions/` (legacy)
- **Format**: `{date}-{sessionId}-session.tmp` markdown files
- **Lifecycle**:
  1. `session-start.js` loads latest session summary into context
  2. `session-end.js` (Stop hook) updates/creates session file from transcript
  3. `pre-compact.js` marks compaction events in session file
- **Idempotency**: Uses `<!-- ECC:SUMMARY:START -->` / `<!-- ECC:SUMMARY:END -->` markers to replace sections without duplication

### State Store (SQLite via sql.js)
- **Location**: `~/.claude/ecc/state.db`
- **Driver**: `sql.js` (pure JS SQLite, no native binaries)
- **Entities**: session, skillRun, skillVersion, decision, installState, governanceEvent
- **Schema validation**: JSON Schema + Ajv
- **Migrations**: SQL-based, auto-applied on open
- **Purpose**: Used by skill evolution, governance capture, install tracking -- NOT by the core hooks

### Session Aliases
- Named references to sessions (like git tags for sessions)
- `listAliases()` in session-start for quick resume

### Context Compaction Handling
- `pre-compact.js` appends timestamp to session file and compaction log
- `suggest-compact.js` proactively suggests compaction at logical boundaries (50+ tool calls)
- `strategic-compact` skill provides the philosophy: compact after exploration, before execution

### For iaGO-OS
The file-based session persistence (session-start + session-end + pre-compact) is the right pattern. The SQLite state store is overkill. Skip the state-store entirely; the file-based approach is simpler and sufficient.

---

## Key Innovation: run-with-flags.js

### What It Does
`run-with-flags.js` is the central hook dispatcher that solves three problems:

1. **Profile-based gating**: Each hook declares which profiles it runs in (minimal/standard/strict). The `ECC_HOOK_PROFILE` env var controls which profile is active. This lets you run `ECC_HOOK_PROFILE=minimal` for quick exploratory work and `ECC_HOOK_PROFILE=strict` for production code.

2. **Per-hook disable**: `ECC_DISABLED_HOOKS=pre:bash:tmux-reminder,post:edit:typecheck` disables specific hooks without editing config files. Useful for temporary overrides.

3. **Performance optimization**: For hooks that export a `run(rawInput)` function, the dispatcher `require()`s them directly instead of spawning a child process. This saves ~50-100ms per hook invocation. It detects `module.exports` + `run` in the source text before attempting `require()`.

### How It Works
```
hooks.json entry:
  command: node run-with-flags.js "hook-id" "relative/path.js" "profile1,profile2"

Flow:
  1. Read stdin (JSON, max 1MB, track truncation)
  2. Check isHookEnabled(hookId, {profiles}) → if disabled, passthrough
  3. Resolve script path (CLAUDE_PLUGIN_ROOT-relative, path traversal guard)
  4. If script exports run(): require() and call directly (fast path)
  5. Else: spawnSync child process (legacy path, 30s timeout)
  6. Forward stdout/stderr/exitCode appropriately
```

### Is It Worth the Complexity for a 3-Person Team?

**Yes, but simplify.** The core value is:
- **Profile switching** (minimal vs strict) -- useful when you want quick iterations vs careful code
- **In-process require()** -- measurable speedup when you have 10+ hooks
- **Centralized stdin handling** -- DRY pattern eliminates boilerplate from each hook

What to strip:
- The elaborate `CLAUDE_PLUGIN_ROOT` discovery logic in hooks.json (we know our paths)
- The legacy spawnSync fallback (all our hooks will export `run()`)
- The shell wrapper (`run-with-flags-shell.sh`) -- we don't need bash hooks

Simplified version: ~80 lines instead of 182.

---

## Top 10 Files to Extract

| # | File Path | What It Gives Us | Adaptation Needed |
|---|-----------|-----------------|-------------------|
| 1 | `scripts/hooks/run-with-flags.js` | Hook dispatcher with profile gating + in-process require | Simplify PLUGIN_ROOT resolution. Remove legacy spawnSync path. ~80 lines target. |
| 2 | `scripts/lib/hook-flags.js` | Profile-based hook enable/disable | None -- take as-is (74 lines) |
| 3 | `scripts/hooks/session-end.js` | Session persistence: transcript parsing, summary extraction, idempotent file updates | Remove git branch detection (we may not always be in git). Simplify. |
| 4 | `scripts/hooks/session-start.js` | Session context loading, project detection | Strip package-manager detection. Simplify project detection (we know our stack). |
| 5 | `scripts/hooks/pre-compact.js` | Pre-compaction state save | None -- take as-is (49 lines) |
| 6 | `scripts/hooks/config-protection.js` | Block linter/formatter config modifications | None -- take as-is (141 lines). Excellent guardrail. |
| 7 | `scripts/hooks/post-edit-format.js` | Auto-format after edits (Biome/Prettier, Windows-safe) | Keep as-is. Already handles our exact stack. |
| 8 | `scripts/hooks/post-edit-typecheck.js` | tsc --noEmit after TS edits, filtered to edited file | None -- take as-is (97 lines) |
| 9 | `scripts/hooks/cost-tracker.js` | Per-response cost estimation + JSONL logging | Add project attribution field. Update model pricing table. |
| 10 | `scripts/hooks/suggest-compact.js` | Strategic compaction suggestions at tool-call thresholds | None -- take as-is (81 lines) |

**Honorable mentions** (extract if time permits):
- `scripts/hooks/doc-file-warning.js` -- ad-hoc doc file warning (91 lines)
- `scripts/hooks/post-bash-pr-created.js` -- PR URL logging (37 lines)
- `scripts/hooks/post-edit-console-warn.js` -- console.log warning (55 lines)
- `scripts/hooks/governance-capture.js` -- steal the SECRET_PATTERNS regex array only
- `scripts/lib/utils.js` -- cross-platform utilities (getSessionsDir, ensureDir, readFile, etc.)
- `scripts/lib/resolve-formatter.js` -- Biome/Prettier detection logic (used by post-edit-format + quality-gate)
- `hooks/hooks.json` -- structural reference for our own hooks.json
- `skills/tdd-workflow/SKILL.md` -- TDD skill definition
- `skills/verification-loop/SKILL.md` -- verification workflow
- `skills/strategic-compact/SKILL.md` -- compaction philosophy
- `agents/architect.md` + `agents/code-reviewer.md` -- agent definition format reference

---

## Modularity Analysis

**Highly modular — almost everything is independently extractable:**

1. **Hooks are standalone.** Each hook in `scripts/hooks/` is a self-contained Node.js file. Dependencies are limited to `scripts/lib/` utilities (hook-flags, resolve-formatter, utils). You can take `config-protection.js` without `cost-tracker.js`. The only coupling is through `run-with-flags.js` as dispatcher.

2. **Skills are independent markdown files.** Each skill in `skills/*/SKILL.md` is a standalone document. No skill depends on another skill. The only infrastructure dependency is the agent definition format (YAML frontmatter + markdown body).

3. **Session persistence trio is coupled.** `session-start.js`, `session-end.js`, and `pre-compact.js` form a unit — taking one without the others loses the persistence loop. Extract as a set.

4. **State store is isolable.** The SQLite state store (`scripts/lib/state-store/`) is entirely separate from the hook system. Hooks don't depend on it. Skills don't depend on it. Safe to skip completely.

5. **Config layers compose but don't require each other.** You can use `CLAUDE.md` without `.claude/rules/`. You can use `hooks.json` without identity.json. Each layer adds to the system independently.

**Tightly coupled (take as unit or skip):**
- `run-with-flags.js` + `hook-flags.js` + hooks.json structure
- Session trio: `session-start.js` + `session-end.js` + `pre-compact.js`
- `post-edit-format.js` + `scripts/lib/resolve-formatter.js`

---

## Comparison vs Ruflo / GSD / The Architect / Superpowers

| Dimension | ECC | Ruflo | GSD | The Architect | Superpowers |
|-----------|-----|-------|-----|--------------|-------------|
| **Primary purpose** | Hook-based workflow automation, session persistence | Context lifecycle, archiving, token awareness | Spec-driven multi-phase development | Design-phase planning, blueprint generation | Development methodology via skills |
| **Hook system** | **Best in class.** Profile-gated dispatcher, in-process require, 20+ hooks | Single monolithic context-persistence hook | 5 hooks (statusline, context monitor, update, prompt guard, workflow guard) | None | Session-start injection only |
| **Session persistence** | File-based trio (start/end/pre-compact) with idempotent markers | Proactive archiving with importance scoring — **superior** | Pause/resume with HANDOFF.json + .continue-here.md | None (single session) | None |
| **Context management** | suggest-compact (counter-based) + strategic-compact skill | Context Autopilot reading real API token usage — **superior** | Context monitor hook with bridge file + /clear recommendations | Lazy-loading knowledge files | Not addressed |
| **Cost tracking** | cost-tracker.js (per-response JSONL) — **unique** | None | Execution time metrics only | None | None |
| **Config protection** | config-protection.js blocking linter/formatter edits — **unique** | None | Prompt guard (injection detection) | None | None |
| **Post-edit quality** | format + typecheck + console-warn pipeline — **unique** | None | None | None | None |
| **Workflow enforcement** | Hook-based (pre/post tool execution) | Context-threshold triggers | Code-gated phases + artifact dependencies | Prompt-based (LLM honor system) | Skill-based (mandatory + red flags) |
| **Agent definitions** | Markdown + YAML frontmatter (30 agents) | Markdown templates (60+ types) | 16 specialized agents | Single agent (CLAUDE.md identity) | Prompt templates for 3 roles |

**ECC's unique contributions not found elsewhere:**
1. Profile-gated hook dispatcher (`run-with-flags.js`) — no other repo has this
2. Post-edit quality pipeline (format → typecheck → console-warn) — no other repo automates post-edit checks
3. Config protection (blocking linter config edits) — no other repo guards config files
4. Per-response cost tracking to JSONL — no other repo tracks API costs
5. Desktop notifications (macOS + Windows) — no other repo has this

---

## Adaptation Notes

**Direct reuse (copy with minimal changes):**
- `scripts/hooks/run-with-flags.js` + `scripts/lib/hook-flags.js` — Simplify PLUGIN_ROOT resolution, remove legacy spawnSync path. Target ~80 lines.
- `scripts/hooks/config-protection.js` — Take as-is (141 lines)
- `scripts/hooks/post-edit-format.js` — Take as-is (already handles our Biome/Prettier stack)
- `scripts/hooks/post-edit-typecheck.js` — Take as-is (97 lines)
- `scripts/hooks/suggest-compact.js` — Take as-is (81 lines)
- `scripts/hooks/cost-tracker.js` — Add project/client attribution field

**Adapt for iaGO-OS:**
- Session trio (`session-start.js` + `session-end.js` + `pre-compact.js`) → Store session data in `.iago/sessions/` instead of `~/.claude/session-data/`. Add client context loading.
- `hooks/hooks.json` → Use as structural reference for iaGO's hook registration. Strip multi-editor paths.
- `pre-bash-commit-quality.js` → Keep secret detection regexes, remove Go/Python linting, simplify commit message validation.
- Agent definitions (YAML frontmatter format) → Adopt for `.iago/agents/` with our model routing (Opus for design, Sonnet for execution, Haiku for read-only).

**Implementation sequence:**
1. Port `run-with-flags.js` + `hook-flags.js` as iaGO hook dispatcher
2. Port session trio adapted for `.iago/sessions/`
3. Port config-protection, post-edit-format, post-edit-typecheck, suggest-compact as-is
4. Port cost-tracker with client attribution
5. Create iaGO agent definitions using ECC's YAML frontmatter format

---

## What to Skip Entirely

| Category | What | Reasoning |
|----------|------|-----------|
| **State store** | `scripts/lib/state-store/` (SQLite via sql.js) | Heavy dependency (sql.js, ajv). Overkill for session state. File-based persistence is sufficient. |
| **Skill evolution** | `scripts/lib/skill-evolution/` | Automated skill versioning/health tracking. Enterprise-scale feature, not 3-person team. |
| **Skill improvement** | `scripts/lib/skill-improvement/` | Automated skill quality analysis. Same reason. |
| **Continuous learning v2** | `skills/continuous-learning-v2/` | Bash-only observer hooks. Violates our Node.js-only requirement. |
| **Install system** | `scripts/install-*.js`, `scripts/lib/install-*` | Multi-editor install framework (Cursor, Kiro, Codex). We only use Claude Code. |
| **Orchestration** | `scripts/orchestrate-*.js`, `scripts/lib/tmux-worktree-orchestrator.js` | tmux + git worktree multi-agent orchestration. Over-engineered for our use. |
| **MCP health check** | `scripts/hooks/mcp-health-check.js` | 620 lines of MCP server probing. Our MCP servers are stable. |
| **InsAIts security** | `scripts/hooks/insaits-security-*.{js,py}` | External Python dependency. We have our own security patterns. |
| **Tmux hooks** | `pre-bash-dev-server-block.js`, `pre-bash-tmux-reminder.js` | tmux is optional for us, not mandatory. |
| **Placeholder hooks** | `session-end-marker.js`, `post-bash-build-complete.js` | No-ops or minimal placeholders. |
| **Non-stack skills (100+)** | golang-*, python-*, rust-*, swift-*, kotlin-*, java-*, perl-*, php-*, cpp-*, django-*, laravel-*, springboot-*, healthcare-*, etc. | Wrong language/framework/industry for our stack. |
| **Plugin system** | `.claude-plugin/`, `.codex-plugin/` | Multi-editor plugin manifests. We don't distribute as a plugin. |
| **Other editor configs** | `.cursor/`, `.kiro/`, `.codex/`, `.opencode/`, `.trae/`, `.agents/` | Cursor, Kiro, Codex, OpenCode, Trae configurations. Claude Code only. |
| **Governance events** | Full governance capture system | The secret detection patterns are worth stealing (5 regexes). The event framework, DB persistence, and audit trail are enterprise overhead. |
