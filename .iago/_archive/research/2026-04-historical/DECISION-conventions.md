# Convention & Format Decisions

> Date: 2026-03-31
> Sprint: 3 (Skills & Agents) — Phase 2

---

## A. Skill Description Convention (CSO)

**Verdict:** Adopt.

Superpowers' finding is correct: "Use when [X]" descriptions let the model match skills to context instead of just reading a summary and skipping the body. Every iaGO skill description MUST follow the CSO pattern.

**YAML Frontmatter Template:**

```yaml
---
# iaGO Skill — canonical frontmatter
# Location: .claude/skills/{name}/SKILL.md
name: skill-name                    # kebab-case, matches directory name
description: >-
  Use when [triggering conditions].
  Not when [exclusion conditions].
allowed-tools:                      # optional — omit for unrestricted
  - Read
  - Grep
  - Glob
---
```

**SKILL.md Body Structure:**

Every skill body MUST contain these sections in order:

1. **`## Purpose`** — One sentence. What outcome this skill produces.
2. **`## Steps`** — Numbered procedure. Concrete actions, not philosophy.
3. **`## Output`** — What the skill produces (file, message, structured data). Include exact format if applicable.
4. **`## Boundaries`** — What this skill does NOT do. Prevents scope creep.

Optional section:

5. **`## Examples`** — Only when the procedure is ambiguous without one. Keep to 1-2 examples max.

No "Background", "Philosophy", "Rationale", or "See Also" sections. Skills are instructions, not essays.

---

## B. Agent YAML Frontmatter Template

**Canonical Template:**

```yaml
---
# iaGO Agent — canonical frontmatter
name: agent-name                    # kebab-case, matches filename
description: >-
  Use when [triggering conditions].
  Not when [exclusion conditions].
model: sonnet                       # haiku | sonnet | opus | inherit
tools:                              # allowlist — omit for full access
  - Read
  - Grep
  - Glob
maxTurns: 20                        # optional — cap agentic turns, omit for default
isolation: worktree                 # optional — "worktree" for isolated git copy
skills:                             # optional — preload skills into subagent context
  - skill-name
---

## Role

[One sentence: what this agent IS.]

## Constraints

- [Hard behavioral rules — things this agent must NEVER do]
- [Tool restrictions explained in plain language]

## Process

1. [Step-by-step procedure this agent follows]
2. [Concrete actions, not abstract guidance]

## Output Format

[Exact structure of what this agent returns to the invoker]

## Escalation

[When and how this agent reports status — see Section C]
```

Additional supported frontmatter fields (use when needed):

| Field | Purpose |
|-------|---------|
| `disallowedTools` | Denylist (applied before `tools` allowlist) |
| `permissionMode` | `default` / `acceptEdits` / `dontAsk` / `bypassPermissions` / `plan` |
| `hooks` | Lifecycle hooks scoped to this subagent |
| `mcpServers` | MCP servers available to this subagent |
| `background` | `true` to always run as background task |
| `effort` | `low` / `medium` / `high` / `max` (Opus only) |
| `memory` | `user` / `project` / `local` — persistent memory scope |
| `initialPrompt` | Auto-submitted first turn when run as main session agent |

**Tool Vocabulary (exact allowed values for `tools[]`):**

| Tool Name | What It Grants |
|-----------|---------------|
| `Read` | Read files |
| `Write` | Create/overwrite files |
| `Edit` | Edit existing files |
| `MultiEdit` | Multiple edits in one call |
| `Glob` | File pattern search |
| `Grep` | Content search |
| `Bash` | Shell commands |
| `WebSearch` | Web search |
| `WebFetch` | Fetch URLs |
| `Agent` | Spawn sub-agents (supports `Agent(name)` to restrict to specific agents) |

MCP tools use their full qualified name: `mcp__server__tool_name`.

**Model Values (exact strings):**

| Value | Maps To | Use For |
|-------|---------|---------|
| `haiku` | Fastest available Haiku | Mechanical tasks: formatting, simple lookups, file routing |
| `sonnet` | Current Sonnet | Default. Implementation, review, most coding work |
| `opus` | Current Opus | Architecture decisions, complex planning, multi-file reasoning |

Use short names (`haiku`/`sonnet`/`opus`), not versioned model IDs. Claude Code resolves these to the current version. This avoids hardcoding `claude-sonnet-4-6` which will rot.

**Description convention:** Same CSO pattern as skills. "Use when [X]. Not when [Y]."

---

## C. Escalation Protocol

**Verdict:** Adopt with modification.

Superpowers' four-status vocabulary is sound. Adopt as-is. No additions — `HANDOFF` is a user-initiated action (`/iago:pause`), not an agent-reported status, so it belongs in the hook/slash-command layer, not the escalation protocol.

**Status Vocabulary:**

| Status | Definition | Invoker Action |
|--------|-----------|----------------|
| `DONE` | All requirements complete. Verified by running tests/checks, not by self-assertion. Evidence provided. | Accept result. Proceed to next task. |
| `DONE_WITH_CONCERNS` | Requirements met but minor issues exist that don't block progress. Concerns listed explicitly. | Decide: fix now (re-dispatch same agent) or defer to polish phase. |
| `NEEDS_CONTEXT` | Cannot proceed — missing information, ambiguous spec, or architectural question that requires human/orchestrator input. States exactly what is needed. | Provide the requested context and re-dispatch. Do NOT retry without providing new information. |
| `BLOCKED` | External blocker: dependency unavailable, environment broken, access denied, rate limited. Agent cannot resolve this alone. | Escalate to human. Never force retry without resolving the blocker. |

**Lives In:** Each agent's system prompt under the `## Escalation` section. The status vocabulary is defined once in `CLAUDE.md` under a `## Agent Escalation Protocol` heading so all agents inherit it, and each agent's own `## Escalation` section references it. This avoids duplicating the table in every agent file while keeping agents self-contained enough to read standalone.

**Exact text for CLAUDE.md:**

```markdown
## Agent Escalation Protocol

Every agent MUST end its response with exactly one status line:

STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

- DONE — requirements verified with evidence (test output, build success)
- DONE_WITH_CONCERNS — requirements met, minor issues listed
- NEEDS_CONTEXT — state exactly what information is missing
- BLOCKED — state the external blocker; do not retry
```

---

## D. Analysis Paralysis Guard

**Verdict:** Adopt with consulting-context adjustment.

GSD's "5+ reads without write = STOP" is a good default for implementation agents. But iaGO is a consulting shop where research, analysis, and proposal writing are legitimate deliverables. The guard must distinguish between "agent spinning its wheels" and "agent doing deep research by request."

**Thresholds:**

| Metric | Threshold | Action |
|--------|----------|--------|
| Consecutive Read/Grep/Glob without Edit/Write/Bash | 7 (not 5) | STOP. State what you learned. Ask whether to continue reading or start writing. |
| Failed fix attempts on same issue | 3 | STOP fixing. Report the failure pattern. Escalate as `NEEDS_CONTEXT` or `BLOCKED`. |
| Same file read more than once in a session | 2 re-reads | Acceptable (file may have changed). 3+ re-reads of identical file = flag it. |

Raised from 5 to 7 because consulting tasks (research, audits, proposal prep) legitimately require reading 5-6 files before producing output.

**Exception:** When the user's explicit request is a read-only task (e.g., "analyze this codebase", "review these files", "research X"), the consecutive-read guard is suspended. The agent should still produce a written artifact (analysis, summary, recommendation) — it just doesn't need to write code.

**Detection heuristic for exception:** If the triggering user message contains "analyze", "review", "research", "audit", "investigate", "compare", or "summarize", treat as read-heavy task. No read-count guard, but agent must still produce written output before completing.

**Lives In:** `CLAUDE.md` under `## Execution Discipline`. Not in individual agent prompts — this is a universal behavioral rule that applies to all agents and to the orchestrator.

**Exact Text:**

```markdown
## Execution Discipline

During task execution, if you make 7+ consecutive Read/Grep/Glob calls without any
Edit/Write/Bash action: STOP. State what you have learned so far and ask whether to
continue investigating or begin producing output.

Exception: explicit research/analysis/review tasks may read freely, but must still
produce a written artifact (summary, analysis, recommendation) before reporting DONE.

After 3 failed attempts to fix the same issue, STOP. Report the failure pattern and
escalate — do not attempt a 4th fix without new information or a different approach.
```

---

## E. Two-Stage Review

**Verdict:** Conditional — two-stage for client deliverables, single-pass for internal/prototype.

For a 3-person consultancy on Claude Max, context budget matters more than enterprise-grade review rigor. Sequential two-agent review (spec-compliance THEN code-quality) doubles the context cost of review. Worth it for client-facing production code. Not worth it for internal tooling, prototypes, or research spikes.

**Protocol:**

### Single-Pass Review (default)

One reviewer agent checks both spec compliance and code quality in a single pass. Uses severity levels: Critical (blocks merge) / Important (should fix) / Minor (nice to have).

**When to use:** Internal projects, prototypes, PoCs, research spikes, anything not shipping to a client.

### Two-Stage Review (opt-in)

Stage 1 — **Spec Reviewer:** Does the implementation match the approved spec? Read actual code, do not trust implementer's self-report. Pass/fail only.

Stage 2 — **Quality Reviewer:** Only runs after Stage 1 passes. Reviews code quality, patterns, performance, testing. Outputs severity-categorized findings.

**When to use:** Client deliverables going to production. Explicitly triggered by the orchestrator or user, never automatic. Trigger phrase: "full review" or "two-stage review."

**Rationale:** Superpowers' insight — "don't waste quality review on code that doesn't meet spec" — is valid. But for a 3-person shop doing 80% prototype/PoC work, the default should be fast. Upgrade to thorough when stakes justify it.

---

## F. Skill Storage Convention

Three storage locations, each with clear criteria:

### Standalone `.claude/skills/{name}/SKILL.md` — Interactive Skills

**Criteria:** Use when ALL of these are true:
- User invokes it explicitly via `/{name}` slash command
- Requires multi-step procedure (3+ steps)
- Produces a distinct artifact or structured output
- Needs its own description for CSO matching

Skills directory supports additional files (templates, examples, scripts) alongside SKILL.md. Legacy `.claude/commands/{name}.md` still works but `.claude/skills/` is preferred.

**Examples:** `/iago:scaffold`, `/iago:proposal`, `/iago:pause`, `/iago:onboard`

### Absorbed into `CLAUDE.md` — Behavioral Rules

**Criteria:** Use when ALL of these are true:
- Rule is 1-5 lines of instruction
- Always active (not conditionally triggered)
- No procedure — just a constraint or convention
- Applies universally across all tasks

**Examples:** "Use Biome, not Prettier", "Commit messages use conventional prefixes", the escalation protocol vocabulary, the analysis paralysis guard text, verification-before-completion ("never claim success without evidence")

### `.claude/rules/{name}.md` — Domain-Specific Always-On Rules

**Criteria:** Use when:
- Too long for CLAUDE.md (6+ lines) but always active
- Scoped to a specific domain (e.g., AWS patterns, React conventions, testing standards)
- Not user-invoked — automatically loaded by Claude Code at session start

Rules support optional `paths:` frontmatter to scope activation to specific file patterns:
```yaml
---
paths:
  - "src/api/**/*.ts"
---
```
Without `paths:`, the rule loads unconditionally.

**Examples:** TDD red-green-refactor discipline (with rationalization table), systematic debugging procedure, React 19 component patterns, DynamoDB single-table conventions

### Decision Matrix

| Signal | Storage |
|--------|---------|
| User types `/{name}` to trigger it | `.claude/skills/{name}/SKILL.md` |
| 1-5 lines, always applies | Inline in `CLAUDE.md` |
| 6+ lines, always applies, domain-scoped | `.claude/rules/{name}.md` |
| Already covered by a hook | Skip — do not duplicate as skill |
| Needs YAML frontmatter for CSO matching | `.claude/skills/{name}/SKILL.md` |

### What NOT to create as a skill

- Anything already enforced by the 12 hooks (formatting, typechecking, safety, secrets, config protection, context monitoring, commit quality, compaction, cost tracking)
- Stack-specific reference material (put in `CLAUDE.md` or rules files)
- One-off procedures that won't be reused
