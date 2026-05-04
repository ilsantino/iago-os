---
phase: feature-tool-surveillance
plan: 03
wave: 1
depends_on: []
context: docs/specs/feature-tool-surveillance.md
created: 2026-05-04
source: feature
---

# Plan: feature-tool-surveillance/03-obsidian-skills

## Goal

Selectively install 3 of kepano's 5 obsidian-skills: `obsidian-markdown` (Obsidian syntax guardrails), `defuddle` (web-content stripper for /deep-research), and `obsidian-bases` (persistent filtered vault views). Skip `obsidian-cli` (requires Obsidian desktop running; our MCP supersedes) and `json-canvas` (Graphify covers visualization). Net additive — zero migration cost.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| run | command | `npx obsidian-skills` to install obsidian-markdown |
| run | command | `npm i -g defuddle` for web-content stripper |
| modify | `.claude/skills/deep-research/SKILL.md` | Wire defuddle into the WebFetch path |
| create | `C:\Users\sanal\dev\obsidian-brain\bases\sessions-by-project.base` | Persistent filtered view: sessions grouped by project tag |
| create | `C:\Users\sanal\dev\obsidian-brain\bases\meetings-by-client.base` | Persistent filtered view: meetings grouped by client |
| create | `C:\Users\sanal\dev\obsidian-brain\bases\decisions-by-date.base` | Persistent filtered view: decisions chronologically |
| modify | `.claude/rules/available-skills.md` | Document the three installed skills under the MCP/skills section |

## Tasks

### Task 1: Install obsidian-markdown skill

- **files:** Run command (no file edit)
- **action:** Run `npx obsidian-skills` interactively (or with `--yes` if non-interactive support is documented in the kepano repo) to install the `obsidian-markdown` skill into the user's Claude Code skills directory. Confirm install location is reachable from this project — if it lands in `~/.claude/skills/`, that is correct (user-global skills are picked up). If the installer asks which skills to install, select only `obsidian-markdown`.
- **verify:** `ls ~/.claude/skills/obsidian-markdown/SKILL.md 2>/dev/null && head -5 ~/.claude/skills/obsidian-markdown/SKILL.md`
- **expected:** SKILL.md exists in `~/.claude/skills/obsidian-markdown/`; first 5 lines show frontmatter.

### Task 2: Install defuddle globally and wire into /deep-research

- **files:** Run command + modify `.claude/skills/deep-research/SKILL.md`
- **action:** Run `npm i -g defuddle` to install globally. Then in `.claude/skills/deep-research/SKILL.md` Step 2 (dispatch research agent), update the web-fetch instruction so the agent pipes WebFetch output through `defuddle` (CLI usage: `defuddle <url>` or stdin pipe per the defuddle docs) before passing the cleaned content to the synthesis step. Add a one-line note in the artifact template that web-source registry entries should record the defuddled length and the original byte count for transparency (e.g., `defuddled: 4.2K of 38K original`).
- **verify:** `which defuddle && defuddle --help > /dev/null && grep -q "defuddle" .claude/skills/deep-research/SKILL.md`
- **expected:** `which defuddle` returns a path; `defuddle --help` exits 0; grep finds defuddle reference in deep-research SKILL.md.

### Task 3: Create three obsidian-bases files in vault

- **files:** `C:\Users\sanal\dev\obsidian-brain\bases\sessions-by-project.base`, `C:\Users\sanal\dev\obsidian-brain\bases\meetings-by-client.base`, `C:\Users\sanal\dev\obsidian-brain\bases\decisions-by-date.base`
- **action:** Use the Obsidian MCP `write_note` tool (per `~/.claude/rules/obsidian.md`) — NOT raw filesystem writes — to create three `.base` files in the vault's `bases/` folder (create the folder via Obsidian MCP if it does not exist). Each `.base` file follows the Obsidian Bases YAML schema documented in the obsidian-bases skill (just installed in Task 1, or per the kepano repo). (1) `sessions-by-project.base`: filter on `frontmatter.project IS NOT EMPTY`, group by `project`, sort by `created DESC`. (2) `meetings-by-client.base`: filter on `path STARTSWITH "meetings/"`, group by frontmatter `client`, sort by date. (3) `decisions-by-date.base`: filter on frontmatter `tags CONTAINS "council"` OR `path STARTSWITH "decisions/"`, sort by `created DESC`. Verify each base renders a non-empty result set in Obsidian (manual check — note the result count in the task summary).
- **verify:** Use Obsidian MCP `list_directory` on `bases/` to confirm the three files exist. Manual: open Obsidian and confirm each base view renders.
- **expected:** Obsidian MCP list shows the three `.base` files. Manual smoke check shows each renders a filtered list.

### Task 4: Document the skip decisions and update available-skills.md

- **files:** `.claude/rules/available-skills.md`
- **action:** In the MCP Servers / installed skills area of `available-skills.md`, add a brief subsection "kepano obsidian-skills (installed 2026-05-04)" listing the three installed skills (obsidian-markdown, defuddle, obsidian-bases) with one-line descriptions, and explicitly noting that `obsidian-cli` and `json-canvas` were intentionally NOT installed (with the reason: obsidian-cli requires Obsidian desktop running; json-canvas overlaps with Graphify visualization).
- **verify:** `grep -c "obsidian-markdown\|defuddle\|obsidian-bases\|obsidian-cli\|json-canvas" .claude/rules/available-skills.md`
- **expected:** Count ≥5 (three installed + two explicitly skipped).

## Verification

```bash
test -f ~/.claude/skills/obsidian-markdown/SKILL.md && \
which defuddle > /dev/null && \
grep -q "defuddle" .claude/skills/deep-research/SKILL.md && \
grep -q "obsidian-markdown\|obsidian-bases" .claude/rules/available-skills.md && \
echo OK
```

Expected: prints `OK`. Three `.base` files verified manually in Obsidian. `tsc --noEmit` and `vite build` exit 0 (no TS impact).

## Notes

- All vault writes use the Obsidian MCP per the user's global rule in `~/.claude/rules/obsidian.md` ("Never use Bash/Read/Write tools to access vault files directly"). This plan honors that rule strictly.
- If `npx obsidian-skills` requires Obsidian desktop or a vault path argument, follow the kepano README installation steps interactively. The implementer should NOT improvise — if the installer does not behave as expected, escalate (NEEDS_CONTEXT) rather than monkey-patching.
