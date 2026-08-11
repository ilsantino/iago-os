# Obsidian Rules

## Context Loading
1. Before starting any project work, check Obsidian for relevant context.
   Don't ask Santiago for information that's already documented — go find it.
2. When Santiago references a meeting, decision, or past context — search Obsidian
   first rather than asking him to explain it.
3. Use `search_notes` for keyword lookups. Read `_context/` docs for business context.

## Session Digests
After every significant session (plan execution, major decision, architectural change),
write a session digest to the vault:
- Path: `sessions/YYYY-MM-DD-{project-name}.md`
- Use the session template structure: What Was Done, Decisions Made, Files Changed,
  Open Questions
- Tag with project name in frontmatter
- Link to relevant project notes with [[wikilinks]]
- If multiple sessions on the same project in one day, append a counter:
  `sessions/2026-04-06-munet-02.md`

## Meeting Transcript Import
When Santiago asks to import meeting notes:
1. Check `meetings/_inbox/` for raw transcript files
2. Read each file, extract: date, attendees, project, key decisions, action items
3. Write cleaned version to `meetings/YYYY-MM-DD-{topic}.md` using meeting template
4. Delete or move the raw file from `_inbox/`

## Daily Summary
When Santiago asks for a daily summary, or at end of a long session:
1. Read all session digests from today (`sessions/YYYY-MM-DD-*.md`)
2. Read any meeting notes from today (`meetings/YYYY-MM-DD-*.md`)
3. Write a daily summary to `daily/YYYY-MM-DD.md` using daily template
4. Link to all referenced sessions and meetings with [[wikilinks]]

## Routing
- Use Obsidian MCP tools for ALL vault access (read_note, write_note, search_notes,
  list_directory, patch_note)
- Never use Bash/Read/Write tools to access vault files directly
- search_notes for finding information by keyword
- list_directory to see what exists in a folder
- read_note to read specific notes
- write_note to create or update notes
