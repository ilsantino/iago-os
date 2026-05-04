# Research: kepano/obsidian-skills

**Date:** 2026-05-04
**Repo:** https://github.com/kepano/obsidian-skills

## What it is

A set of five agent skill files (Claude Code / Codex CLI / OpenCode compatible) authored by Steph Ango (Obsidian CEO). Each skill is a SKILL.md that teaches an agent the syntax, conventions, and workflows for a specific Obsidian file format or CLI tool. The repo follows the emerging Agent Skills open specification — skills are plain markdown files with a YAML frontmatter block (`name`, `description`) that agents load as context documents, not as executable slash commands.

## Stack & runtime

- Language: Markdown (SKILL.md files) — no code, no scripts
- License: MIT
- Last commit: 2026-04-02
- Stars: 28,605 (forks: 1,917 — unusually high fork ratio, signals active adoption)
- Maintainership signal: Actively maintained by kepano (Obsidian CEO). 28K stars for a markdown-only repo signals this is a canonical reference, not a hobby project. High fork count suggests teams are copying + customizing.

## Skills inventory

| Skill | Trigger description |
|-------|---------------------|
| `obsidian-markdown` | Create/edit Obsidian Flavored Markdown — wikilinks, embeds, callouts, properties, tags |
| `obsidian-bases` | Create/edit `.base` files (Obsidian's database-like view layer) — filters, formulas, views |
| `json-canvas` | Create/edit `.canvas` files — nodes, edges, groups, JSON Canvas spec 1.0 |
| `obsidian-cli` | Drive a running Obsidian instance via CLI — read/create/search notes, plugin dev workflow |
| `defuddle` | Extract clean markdown from URLs via `defuddle` CLI — replaces noisy WebFetch for articles |

## Overlap with iago-os

### obsidian-markdown

**iago-os equivalent:** `~/.claude/rules/obsidian.md` routing rules + implicit vault conventions in CLAUDE.md.

**Overlap:** Partial. Our rules focus on *when* and *how* to call MCP tools. The SKILL.md teaches the agent *what valid Obsidian markdown looks like* — wikilink syntax, callout types, embed syntax, PROPERTIES.md field types, frontmatter YAML. We have none of that as explicit rules.

**Gap filled:** Agent currently relies on training data for Obsidian-specific syntax. If it writes a malformed embed or wrong callout type, there's no guardrail. This skill closes that.

### obsidian-bases

**iago-os equivalent:** None. We don't use `.base` files in the vault today.

**Overlap:** Zero. This is net-new capability.

**Gap filled:** `.base` files are Obsidian's answer to databases — they can replace ad-hoc `search_notes` queries with persistent filtered views (e.g., a live index of all session digests by project). Adopting this skill would let the agent *create* Bases as vault artifacts, not just search manually.

### json-canvas

**iago-os equivalent:** None. We don't generate `.canvas` files.

**Overlap:** Zero.

**Gap filled:** Low priority for iago-os workflows. Useful if we ever want visual relationship maps (e.g., client project map, ROADMAP visualization). Graphify already covers the knowledge-graph use case.

### obsidian-cli

**iago-os equivalent:** MCP server `mcp__obsidian__*` (11 tools).

**Overlap:** High functional overlap — both read/create/search notes. But the mechanism is completely different:
- MCP: structured JSON calls, no running Obsidian instance required, works headlessly.
- obsidian-cli: requires Obsidian to be open and responding on localhost. Purpose-built for plugin/theme *development* workflows (reload plugin, screenshot, eval JS, inspect DOM).

**Gap filled:** The plugin-dev half (reload, errors, screenshot, CSS inspection) has zero equivalent in our MCP setup. The note-CRUD half is redundant with our MCP.

### defuddle

**iago-os equivalent:** `WebFetch` tool built into Claude Code.

**Overlap:** Direct replacement for WebFetch on article/documentation URLs. Defuddle strips navigation/ads before passing to the agent, reducing token usage and noise.

**Gap filled:** We use WebFetch today and it often returns bloated HTML-converted-to-markdown with menus, footers, and boilerplate. Defuddle solves that. Already in our stack conceptually (see `MarkItDown` MCP for heavy documents), but defuddle is lighter and CLI-native.

### Session digests / meeting import / daily summary (rules/obsidian.md)

**kepano equivalent:** None. He ships format knowledge, not workflow automation. Our session-digest, meeting-import, and daily-summary rules have no analog in his repo — those are iago-os-specific capture workflows. No replacement risk.

## Patterns worth absorbing

1. **Frontmatter-first SKILL.md convention.** Every skill starts with a YAML block (`name`, `description`, trigger conditions). This is the Agent Skills spec trigger mechanism — agents use the `description` to decide *when* to apply the skill. Our current skill files in `.claude/skills/` use plain markdown with no such structured trigger. Adopting this pattern would make our skills more auto-dispatachable without relying on explicit slash-command invocation.

2. **Reference sub-documents.** kepano splits large reference material into `references/CALLOUTS.md`, `references/PROPERTIES.md`, `references/EXAMPLES.md` rather than bloating the main SKILL.md. We have the same problem in some of our larger rule files (e.g., `execution-pipeline.md` is 200+ lines). The `references/` split keeps the primary SKILL.md scannable while preserving completeness.

3. **Negative trigger conditions in description.** The `defuddle` skill explicitly says "Do NOT use for URLs ending in .md". The `obsidian-cli` skill scopes itself to plugin development. This disambiguation pattern prevents misfire. Our skills mostly say when to use them but rarely when *not* to — the "When NOT to use" table in `available-skills.md` is close but lives in a catalog, not in the skill itself.

4. **CLI-as-escape-hatch alongside MCP.** kepano ships both an MCP-equivalent (obsidian-markdown/bases) and a CLI skill (obsidian-cli). The CLI fills the gap MCP can't: interactive/visual operations, plugin debugging, JS eval in running Obsidian. This hybrid pattern validates our MarkItDown MCP + WebFetch + defuddle coexistence — different tools for different surfaces.

5. **obsidian-bases as a vault database layer.** `.base` files persist filtered views directly in the vault. Today our session-digest indexing relies on `search_notes` at query time. A `.base` file like `_indexes/sessions-by-project.base` would give Graphify and manual browsing a live, zero-cost index. Worth prototyping.

## Integration cost

**Estimate:** Trivial (obsidian-markdown + defuddle) / Small (obsidian-bases)

**What it would take:**

- `obsidian-markdown`: Copy `skills/obsidian-markdown/SKILL.md` + `references/` into `~/.claude/skills/` or reference via npx. No code. One `npx obsidian-skills` install command registers them. 30 minutes.
- `defuddle`: `npm install -g defuddle` + copy `skills/defuddle/SKILL.md`. Already aware of it from MarkItDown research. Zero code.
- `obsidian-bases`: Same file drop, but also requires learning the `.base` format and deciding which vault indexes to create. 2-4 hours to build initial base files for sessions/, meetings/.
- `json-canvas`: Optional, low priority. Drop-in if needed later.
- `obsidian-cli`: Skip — requires running Obsidian desktop app. Our vault access is headless via MCP. The plugin-dev subset doesn't apply to our workflows.

**Migration cost if we replace existing:**

Zero replacement cost. These skills *add* surface area — they don't compete with our MCP-based vault access (`rules/obsidian.md` stays unchanged). The obsidian-markdown skill supplements our MCP routing rules with syntax knowledge the agent was relying on training data for. Our session-digest workflows are untouched.

## Verdict

**Recommendation:** clear-yes (selective adoption — three of five skills)

**Reasoning:**

The three immediately useful skills (obsidian-markdown, obsidian-bases, defuddle) cost nothing to install, add zero maintenance burden (upstream MIT, maintained by Obsidian CEO), and fill real gaps:
- `obsidian-markdown` closes the "agent uses wrong Obsidian syntax" failure mode that currently has no guardrail.
- `defuddle` reduces token waste on every WebFetch of an article or docs page — directly relevant since deep-research uses WebFetch heavily.
- `obsidian-bases` enables persistent vault indexes that today require runtime `search_notes` queries.

Skip: `obsidian-cli` (requires Obsidian desktop open; MCP is superior for our headless workflow), `json-canvas` (no current use case; Graphify covers visualization).

**How to integrate:**

1. Install via npx (one command, registers all five skills automatically in `~/.claude/skills/`):
   ```
   npx obsidian-skills
   ```
2. Verify the three relevant skills landed: `obsidian-markdown`, `obsidian-bases`, `defuddle`.
3. Remove or ignore `obsidian-cli` and `json-canvas` from active use (they auto-register but won't fire unless triggered by `.canvas`/`.base`/CLI-context dispatch).
4. Optionally absorb the `references/PROPERTIES.md` frontmatter spec into our Obsidian session-digest templates so digests use correct YAML types.
5. Prototype one `.base` file: `_indexes/sessions-by-project.base` — filtered view of all `sessions/*.md` grouped by project tag. If useful, extend to meetings.
6. Do not modify `~/.claude/rules/obsidian.md` — MCP routing rules are orthogonal to format-knowledge skills.
