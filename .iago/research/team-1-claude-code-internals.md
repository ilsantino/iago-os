# Team 1 — Claude Code skill-loader hooks

## TL;DR (3-line verdict)

- **Verdict:** NO native mechanism exists to filter the skill catalog before injection. Skill descriptions load into context at session start; full skill bodies load on-demand when invoked. Settings.json cannot gate or rewrite the catalog.
- **Wedge E feasibility:** RED — no documented filtering API. Workaround: hook-based progressive disclosure via `UserPromptSubmit` + `additionalContext` (capped 10K chars), or MCP meta-tool pattern (loses `/skill-name` slash invocation).
- **Wedge G feasibility:** YELLOW — partial native support via `disable-model-invocation: true` + `user-invocable: false` fields in skill frontmatter, but no built-in MCP-style "skill view" tool. Implement custom MCP server for dynamic skill details.

---

## What I checked

### Documentation sources
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks.md) — full hook lifecycle, matchers, input/output
- [Claude Code skills documentation](https://code.claude.com/docs/en/skills.md) — SKILL.md frontmatter, control fields, lifecycle
- [Claude Code settings schema](https://code.claude.com/docs/en/settings.md) — complete JSON schema, no skill gating fields found
- [Claude Code debug guide](https://code.claude.com/docs/en/debug-your-config.md) — `/skills` command, `/context`, skill loading inspection
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp.md) — server configuration, tool search, dynamic tools

### GitHub issues
- [Issue #26838: Feature request to disable built-in skills](https://github.com/anthropics/claude-code/issues/26838) — marked OPEN, no implementation planned
- [Issue #43928: Feature request enable/disable individual skills via settings.json](https://github.com/anthropics/claude-code/issues/43928) — marked OPEN, proposes `disabledSkills` array, not implemented

### Community research
- [Progressive disclosure pattern in Claude Code](https://alexop.dev/posts/stop-bloating-your-claude-md-progressive-disclosure-ai-coding-tools/) — layered documentation, on-demand loading, `/learn` skill pattern
- [Meta-tool pattern for MCP](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern) — two-tool structure (discovery + execution) for 85-95% token reduction
- [MCP Tool Search feature](https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide) — Anthropic's Jan 2026 feature for lazy-loading MCP tool definitions
- [Claude Skills vs MCP patterns 2026](https://www.morphllm.com/claude-code-skills-mcp-plugins) — skills use progressive disclosure (names + descriptions first, bodies on-demand)
- [Real-world setup example](https://okhlopkov.com/claude-code-setup-mcp-hooks-skills-2026/) — three MCP servers + three custom skills, no conditional gating pattern

---

## Findings

### Hooks system

**Lifecycle and timing:**
- `SessionStart` — fires once at session begin, BEFORE skill descriptions load into context
- `UserPromptSubmit` — fires after SessionStart, when user submits a prompt, BEFORE Claude processes it
- `PreToolUse` — fires before every tool call (including Skill tool)
- `PreCompact` — fires before context compaction
- `Stop` — fires when Claude finishes responding

**What hooks can do:**
- `SessionStart` + `UserPromptSubmit` can inject `additionalContext` (max 10,000 characters per invocation)
- `PreToolUse` can inspect incoming tool calls, modify input via `updatedInput`, and inject `additionalContext`
- Hooks execute before the model's system prompt is finalized, meaning **hook output cannot retroactively filter the skill catalog** — the catalog is already embedded when the hook fires

**Citation:** [Claude Code hooks reference](https://code.claude.com/docs/en/hooks.md) — `SessionStart` section states "Can return: `additionalContext`, environment variables via `$CLAUDE_ENV_FILE`"; `UserPromptSubmit` confirms "Can add context: Yes, via `additionalContext` or plain stdout"; additionalContext is capped at 10,000 characters.

**Why hooks don't solve the problem:**
The skill **catalog** (list of all available skills with descriptions) is merged into the system prompt at session initialization, before any hook fires. A `SessionStart` hook cannot prevent that injection — it can only add parallel context after the fact. There is no `SkillCatalogBuilt` hook or equivalent that fires between skill discovery and system prompt finalization.

---

### Settings.json schema

**Exhaustively searched fields:**
- `permissions.allow`, `.deny` — controls tool/skill access via rules, not catalog injection
- `permissions.defaultMode` — controls permission prompts, not skill visibility
- `enabledPlugins` — toggles plugin sources, not individual skills
- `extraKnownMarketplaces` — registers plugin marketplaces, not skill filtering
- `disableSkillShellExecution` — disables `!`command`` preprocessing in skills, not catalog filtering
- `allowedMcpServers`, `deniedMcpServers`, `enabledMcpjsonServers` — MCP server gating, not skill gating
- `alwaysThinkingEnabled`, `disableAutoMode`, `disableAllHooks` — feature toggles, not skill catalog control
- `disabledSkills` — **not in current schema** (this is a requested feature in Issue #43928 that hasn't shipped)
- `skills.filter`, `skills.allowlist` — **not in schema**
- `skills.includePatterns`, `skills.excludePatterns` — **not in schema**

**Citation:** [Complete settings.json schema documentation](https://code.claude.com/docs/en/settings.md) section "Skills & Plugins Control" explicitly states: "Skills are **not** configured in settings.json but rather through markdown files... Plugin Configuration" only covers `enabledPlugins` and `extraKnownMarketplaces`, with no skill-level filtering.

**Conclusion:** Settings.json has **zero fields for skill filtering**. The schema is comprehensive and documented; no hidden feature exists.

---

### CLI flags

**Searched for:**
- `claude --help` — no `--allowed-skills`, `--skills`, `--disable-skill`, `--enable-skill` flags
- `claude -p --help` — same result
- Feature requests [#26838](https://github.com/anthropics/claude-code/issues/26838) and [#43928](https://github.com/anthropics/claude-code/issues/43928) propose flags like `--disable-skill` — marked as **requested but not implemented**

**Citation:** WebSearch results on "Claude Code CLI flags --allowed-skills" surfaced only the GitHub feature requests as evidence that such flags have been **requested but never shipped**.

**Conclusion:** No CLI flags exist for skill filtering.

---

### Plugin system

**How plugins work:**
- Plugins are registered via `enabledPlugins: { "plugin-name@marketplace": true }` in settings.json
- Plugin skills live inside the plugin under `skills/` and are namespaced as `plugin-name:skill-name`
- Plugins cannot conflict with system or project skills

**Skill gating within plugins:**
- Plugins can include `hooks/hooks.json` which fires for that plugin's skills
- Individual plugin skills respect the same `disable-model-invocation` and `user-invocable` frontmatter as project/user skills
- **No mechanism exists to enable/disable plugin skills as a group** other than disabling the entire plugin

**Citation:** [Settings.json schema — Plugin Configuration](https://code.claude.com/docs/en/settings.md) confirms `blockedMarketplaces`, `allowedChannelPlugins` for whole-plugin or whole-marketplace gating, but no per-skill toggles. [Skills documentation](https://code.claude.com/docs/en/skills.md) states plugin skills use `plugin-name:skill-name` namespace and are subject to same frontmatter rules.

---

### Skill frontmatter

**Conditional/gating fields in SKILL.md:**

| Field | Effect | Supports filtering? |
|-------|--------|---------------------|
| `name` | Display name for the skill (required) | No |
| `description` | When Claude should invoke (Claude matches keywords) | No (text match, not programmable filter) |
| `disable-model-invocation: true` | Prevents Claude from auto-loading; only user can invoke | YES — but binary, not conditional |
| `user-invocable: false` | Hides skill from `/` menu but Claude can still invoke | YES — but binary, not conditional |
| `allowed-tools` | Which tools Claude can use without permission | No (tool restriction, not skill filtering) |
| `when_to_use` | Additional context for when Claude should invoke | No (text match, not programmable) |
| `paths` | **Glob patterns limiting when skill activates** | YES — Claude loads skill only when working with files matching the patterns |
| `context: fork` | Run in isolated subagent context | No (execution isolation, not filtering) |
| `model` | Override model for this skill | No |
| `effort` | Override effort level | No |

**Citation:** [Skill frontmatter reference](https://code.claude.com/docs/en/skills.md#frontmatter-reference) documents all fields. The `paths` field is described as: "Glob patterns that limit when this skill is activated. When set, Claude loads the skill automatically only when working with files matching the patterns."

**KEY FINDING:** The `paths` field provides **conditional skill activation**, but it's file-path-based, not task-type or session-mode-based. This is helpful for domain-scoped skills (e.g., `paths: "*.tsx,*.ts"` for React skills) but doesn't solve Wedge E's goal of showing only task-relevant skills in the catalog.

**What's missing:**
- No `when: pwd matches .*munet.*` or equivalent task-context filter
- No `condition: frontend_session` programmatic field
- No hook integration (e.g., firing a hook that returns filtered skill list)

---

### MCP server workaround

**Viability:** MEDIUM-HIGH, but with tradeoffs.

**How it works:**
1. Create an MCP server that returns tool definitions for "available skills" dynamically based on context
2. Register two meta-tools with MCP (as per [meta-tool pattern](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern)):
   - **Discovery tool** — returns filtered catalog (names + descriptions only)
   - **Execution tool** — dynamically fetches and returns full skill body when Claude asks for it
3. Claude invokes `/discovery` to see available skills, then `/view skill-name` for details, then `/invoke skill-name` to run

**Token efficiency:**
- Native skill catalog at session start: ~30-50 tokens per skill × 60+ skills = ~2,000+ tokens upfront
- MCP meta-tool approach: discovery tool returns index (~1,000 tokens), details fetched on-demand (~50-100 tokens per skill when needed)
- **Potential savings:** 85-95% context reduction for cold starts (per [meta-tool pattern article](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern))

**Tradeoffs:**
- **Loss of `/skill-name` slash invocation** — instead Claude calls MCP tools (`/discovery`, `/view`, `/invoke`)
- **Loss of native skill injection** — skill content is returned via MCP tool response, not injected into system prompt
- **Loss of frontmatter fields** — `allowed-tools`, `disable-model-invocation`, `user-invocable` don't work (custom logic needed)
- **Flexible filtering** — MCP server can filter by session context, env vars, CLAUDE.md hints, worktree, etc.
- **Dynamic skill updates** — new skills auto-discovered without re-reading files

**Implementation reference:** [claude-skills-mcp](https://github.com/K-Dense-AI/claude-skills-mcp) is a real implementation of this pattern for Agent Skills (similar concept). It uses semantic search + vector DB for skill discovery.

**Citation:** [Meta-tool pattern for progressive disclosure](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern) describes the two-tool architecture. [MCP Tool Search announcement](https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide) confirms 85-95% token reduction is achievable with lazy loading.

---

### Community patterns

**Searched for:**
- Real-world conditional skill implementations in iago-os, public repos, or blogs
- GitHub issues / discussions around "conditional skills", "task-scoped skills", "skill filtering"

**Findings:**
- [Progressive disclosure pattern](https://alexop.dev/posts/stop-bloating-your-claude-md-progressive-disclosure-ai-coding-tools/) — keep CLAUDE.md minimal, load specialized docs on-demand. Recommended for knowledge organization, not skill filtering.
- [Meta-tool pattern](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern) — inverting tool discovery via two-tool MCP (discovery + execution). Works but requires custom MCP.
- [MCP Tool Search](https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide) — Anthropic's Jan 2026 feature for lazy-loading MCP tool definitions (not skills, but analogous)
- **No documented pattern for conditional skill loading based on task type, session mode, or environment**
- **No published implementations of "Wedge E" or "Wedge G" style skill filtering in community** (as of 2026-04-28)

**Citation:** [Real-world MCP + skill setup](https://okhlopkov.com/claude-code-setup-mcp-hooks-skills-2026/) mentions three MCP servers and three custom skills but does not describe conditional activation. Author confirms all skills are globally available once placed in `~/.claude/skills/`.

---

### Compaction and context behavior

**PreCompact hook:**
- Fires before context compaction
- Can inject `additionalContext` to remind Claude of key facts
- **Cannot prevent skill catalog from re-attaching** after compaction

**Skill lifecycle after compaction:**
- Auto-compaction carries invoked skills forward within a 25,000-token shared budget
- Skill descriptions remain in context (always, separately from the bodies)
- **If a skill hasn't been invoked, only its description loads after compaction** (full body skipped to save tokens)

**Citation:** [Skill content lifecycle](https://code.claude.com/docs/en/skills.md#skill-content-lifecycle) section states: "Auto-compaction carries invoked skills forward within a token budget... When the conversation is summarized to free context, Claude Code re-attaches the most recent invocation of each skill after the summary."

**Why it doesn't help Wedge E:**
Skill descriptions (the catalog) are always present, even after compaction. You cannot suppress them post-load; you can only suppress **full skill bodies** if the skill hasn't been invoked yet — and that's automatic, not configurable.

---

## Wedge E — conditional skill activation

**Goal:** Show only task-relevant skills in the catalog. For example, frontend-only session hides `/iago-n8n`, `/iago-agents`; investor-prep session hides `/iago-execute`.

**Native support:** **NONE.**

**Recommended approach (Workaround 1: Hook + additionalContext):**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/task-router.mjs",
            "timeout": 2000
          }
        ]
      }
    ]
  }
}
```

Hook script reads the user's prompt, detects task type (frontend vs full-stack vs research), and returns:

```json
{
  "additionalContext": "ACTIVE_SKILLS: [/iago-plan, /iago-execute, /subagent-driven-development, /code-review]. Avoid suggesting: /iago-n8n, /iago-agents (not relevant to frontend work)."
}
```

**Limitations:**
- Max 10,000 characters per invocation — catalog hints must be terse
- Claude is not forced to avoid skills; it's advisory
- Doesn't hide skills from `/skills` command or skill descriptions from initial context

**Recommended approach (Workaround 2: MCP meta-tool + dispatch):**

Create an MCP server with:
1. `list_available_skills(task_type: string)` — returns filtered catalog based on task type
2. `get_skill_details(skill_name: string)` — returns full SKILL.md body
3. `invoke_skill(skill_name: string, args: string)` — delegates to native `/skill-name` invocation

Hook up a `/task-router` skill that:
- Asks user for task type or infers from context
- Calls MCP `list_available_skills(type)` to show relevant skills
- User picks a skill
- MCP server invokes the native skill on their behalf

**Advantages:**
- Full filtering control
- Token-efficient (catalog fetched on-demand)
- Loses native `/skill-name` invocation
- Requires custom MCP implementation

---

## Wedge G — progressive skill disclosure

**Goal:** Show only skill names and brief descriptions by default; expand full skill body on-demand via `/skill view {name}` or similar.

**Native support:** **PARTIAL.**

**What exists:**
- `/skills` command lists all available skills with descriptions (built-in, doesn't need custom code)
- `disable-model-invocation: true` removes skill from Claude's auto-trigger catalog
- `user-invocable: false` hides skill from `/` menu but Claude can still invoke it

**What's missing:**
- No built-in `/skill view {name}` command to fetch full body on-demand
- No MCP tool that returns skill details by name
- No progressive-loading mechanism native to Claude Code

**Recommended approach (Workaround 1: Custom `/skill-view` skill):**

Create a skill at `.claude/skills/skill-view/SKILL.md`:

```yaml
---
name: skill-view
description: Show full details of an available skill. Use when you want to understand what a skill does before invoking it.
disable-model-invocation: true
---

Show the full content of skill: $ARGUMENTS

- Use Bash or Read to fetch from `~/.claude/skills/$ARGUMENTS/SKILL.md` or `.claude/skills/$ARGUMENTS/SKILL.md`
- If not found, search for plugin skills at `~/.claude/plugins/*/skills/$ARGUMENTS/SKILL.md`
- Display the YAML frontmatter and markdown body
```

**Advantages:**
- Uses native skill invocation (`/skill-view {name}`)
- Simple implementation
- Still requires user to ask for details (not automatic progressive loading)

**Recommended approach (Workaround 2: MCP server for skill details):**

Create an MCP server with:
1. `list_skills()` — returns lightweight list (name + 1-line description)
2. `get_skill(name: string)` — returns full SKILL.md body
3. `search_skills(query: string)` — semantic search

Register as global MCP server. Claude can now call `/mcp_tools/get_skill my-skill` to fetch details on-demand.

**Advantages:**
- Native MCP tool integration (Claude discovers tools automatically)
- Semantic search support
- Reusable across sessions
- Requires custom MCP implementation
- Competes with other MCP tools for context budget

---

## Workarounds if native filtering doesn't exist

### Ranked by feasibility & token cost

1. **Skill frontmatter `paths` field (zero cost, limited scope)**
   - Already supported natively
   - Use case: Domain-scoped skills (React skills only load when editing `.tsx` files)
   - Does NOT support task-type filtering (frontend vs full-stack session)
   - **Effort:** Instant (already implemented in current iago-os setup)
   - **Token cost:** 0 (built-in)

2. **`disable-model-invocation: true` + documentation (zero cost, partial solution)**
   - Hide skills that shouldn't auto-trigger from Claude's catalog
   - Skill still invokable by user with `/skill-name`
   - Examples: `/deploy`, `/commit`, `/iago-execute` should be user-invoked, not auto-triggered
   - **Effort:** 5 min (add frontmatter to SKILL.md files)
   - **Token cost:** 0 (reduces catalog size)
   - **Compatibility:** 100% — native feature

3. **Hook-based catalog hints via `UserPromptSubmit` + `additionalContext` (low cost, partial solution)**
   - Hook detects task type (frontend, full-stack, research) from user message
   - Returns brief hints about relevant skills
   - Advisory, not enforced; Claude can still use other skills
   - **Effort:** 2 hrs (write hook script + test task detection)
   - **Token cost:** ~500 tokens per session (10K char cap)
   - **Compatibility:** 100% — standard hooks

4. **MCP meta-tool (medium cost, full solution)**
   - Implement `list_available_skills(task_type)` + `get_skill_details(name)` + `invoke_skill(name, args)` as MCP tools
   - Creates `/task-router` skill that dispatches to filtered catalog
   - **Effort:** 8-12 hrs (MCP SDK, conditional logic, testing)
   - **Token cost:** ~1,500 tokens per session (MCP tool discovery + user choices)
   - **Compatibility:** High — standard MCP integration
   - **Tradeoff:** Loses `/skill-name` slash invocation (uses MCP tools instead)

5. **Custom "skill view" MCP server (high cost, clean UX)**
   - Implements progressive disclosure of skill bodies
   - `list_skills()` returns names + descriptions
   - `get_skill(name)` fetches full body on-demand
   - Supports semantic search
   - **Effort:** 12-16 hrs (MCP SDK, persistent registry, testing)
   - **Token cost:** ~2,000 tokens per session (lazy loading saves context vs. upfront catalog)
   - **Compatibility:** High — standard MCP integration
   - **Benefit:** Reusable across projects; scales to 100+ skills without bloat

6. **Forked "skill catalog" plugin (highest cost, most control)**
   - Create custom Claude Code plugin (via plugin SDK, if available)
   - Plugin registers custom `skill_manager` tool in every session
   - Can intercept skill invocations and apply custom logic
   - **Effort:** 20-30 hrs (plugin SDK, testing, distribution)
   - **Token cost:** ~3,000 tokens per session
   - **Compatibility:** Moderate — depends on plugin SDK stability
   - **Benefit:** Fine-grained control over skill lifecycle

---

## Open questions

1. **Can `UserPromptSubmit` hook inject a modified skill list into the system prompt?**
   - Probably not — the system prompt is frozen before hooks fire, and `additionalContext` appends, not overwrites
   - **To resolve:** Ask Anthropic or reverse-engineer hook execution order

2. **Does MCP Tool Search (Jan 2026 feature) apply to skills, or only MCP tools?**
   - Search results suggest Tool Search is for MCP tools only, not CLAUDE.md skills
   - **To resolve:** Check official Anthropic blog or MCP spec for Tool Search scope

3. **Can a hook modify `$CLAUDE_ENV_FILE` to affect which skills are discovered?**
   - `SessionStart` hook supports `$CLAUDE_ENV_FILE` for environment variables
   - Skills don't have an environment-based disable mechanism
   - **To resolve:** Test if setting `CLAUDE_DISABLED_SKILLS=skill1,skill2` via hook env works (likely doesn't)

4. **If we implement a custom MCP server for skill management, can we preserve `/skill-name` slash invocation?**
   - No — the `/` prefix is reserved for native skills and commands
   - MCP tools use different invocation syntax (e.g., `/mcp:server/tool_name`)
   - **To resolve:** Anthropic would need to add a hook that transforms `/skill-name` → MCP dispatch (not implemented)

5. **What is the character budget for `additionalContext` across all hooks in a single turn?**
   - Individual invocations capped at 10,000 characters
   - Multiple hooks can inject `additionalContext`, but budget sharing is unclear
   - **To resolve:** Test empirically or ask Anthropic

6. **Can `paths` field in skill frontmatter use environment variables or session context?**
   - Field appears to accept only glob patterns
   - No documented interpolation or context-aware matching
   - **To resolve:** Test if `paths: "${CLAUDE_SESSION_TYPE}/**"` works (probably doesn't)

---

## Sources

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks.md) — Complete hook lifecycle, matchers, input/output patterns, exit codes
- [Claude Code skills documentation](https://code.claude.com/docs/en/skills.md) — SKILL.md format, frontmatter fields, invocation control, lifecycle
- [Claude Code settings schema](https://code.claude.com/docs/en/settings.md) — Full JSON schema, no skill filtering fields documented
- [Claude Code debug guide](https://code.claude.com/docs/en/debug-your-config.md) — `/skills`, `/context`, `/doctor` diagnostic commands
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp.md) — Server configuration, tool discovery, Tool Search feature
- [GitHub Issue #26838: Feature request to disable built-in skills](https://github.com/anthropics/claude-code/issues/26838) — OPEN, no workaround documented
- [GitHub Issue #43928: Feature request enable/disable individual skills via settings.json](https://github.com/anthropics/claude-code/issues/43928) — OPEN, proposes `disabledSkills` array (not shipped)
- [Progressive disclosure pattern in Claude Code](https://alexop.dev/posts/stop-bloating-your-claude-md-progressive-disclosure-ai-coding-tools/) — Knowledge organization via on-demand loading
- [Meta-tool pattern for progressive disclosure](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern) — Two-tool MCP architecture for 85-95% token reduction
- [MCP Tool Search feature announcement](https://www.atcyrus.com/stories/mcp-tool-search-claude-code-context-pollution-guide) — Anthropic's Jan 2026 lazy-loading for MCP tools
- [Claude Code Skills vs MCP patterns 2026](https://www.morphllm.com/claude-code-skills-mcp-plugins) — Skills use progressive disclosure natively
- [Real-world MCP + skill setup 2026](https://okhlopkov.com/claude-code-setup-mcp-hooks-skills-2026/) — Three MCP servers, three custom skills, no filtering
- [claude-skills-mcp GitHub repo](https://github.com/K-Dense-AI/claude-skills-mcp) — Real MCP server for Agent Skills discovery and filtering
- [Feature documentation: disable-model-invocation and skill menu visibility](https://dev.classmethod.jp/en/articles/disable-model-invocation-claude-code/) — Documents `disable-model-invocation` and `user-invocable` fields

---

## Executive Summary

Claude Code **does not expose any native mechanism** to filter, rewrite, or gate the skill catalog before it loads into the session prompt. Skill descriptions are always loaded at session start; the full skill bodies load on-demand when invoked. No hooks fire early enough to intercept catalog construction, no settings.json fields control skill visibility, and no CLI flags exist for skill filtering.

**Wedge E (conditional skill activation by task type)** is **not feasible natively** — it requires building a custom MCP meta-tool wrapper (8-12 hrs effort) that sacrifices the `/skill-name` slash invocation pattern, or using weaker advisory hints via `UserPromptSubmit` hooks (2 hrs, advisory only).

**Wedge G (progressive skill disclosure)** is **partially feasible** — the `/skills` diagnostic command already shows lightweight skill catalog, and the `disable-model-invocation` + `user-invocable` frontmatter fields provide binary gating. However, there is **no built-in on-demand "skill view" command**; implementing one requires either a custom `/skill-view` skill (1 hr, user-invoked) or an MCP server (12-16 hrs, auto-invokable).

Both wedges are **technically achievable but require workarounds outside native Claude Code features**. The community has published patterns (progressive disclosure, meta-tools, MCP Tool Search) that map to both use cases, but no one in the wild has published a "Wedge E" or "Wedge G" implementation for iago-os yet.

**Recommendation:** Defer both wedges until we can interview Anthropic about planned features (Tool Search for skills? `disabledSkills` settings field?). In the interim, use `disable-model-invocation: true` on non-critical skills and implement a lightweight hook-based hint system for task routing (low cost, partial benefit).

**Status: DONE**
