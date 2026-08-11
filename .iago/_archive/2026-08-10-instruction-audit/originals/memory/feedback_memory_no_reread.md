---
name: MEMORY.md frozen-snapshot rule
description: Never re-read MEMORY.md mid-session; auto-injected at start, mutations persist for next session
type: feedback
originSessionId: 62f26338-ba81-43e0-9528-be44f42941c6
---
MEMORY.md is auto-injected into every Claude Code session (and `claude -p` non-bare sessions) at start. The full file contents are already in your context.

**Why:** Re-reading mid-session wastes tokens and breaks the prefix-cache assumption. The Hermes Agent project (Nous Research, 120K stars) made the same observation explicit and forbade a `read` action on its memory tool surface — the file is always already there.

**How to apply:**
- Do not grep, Read, or open `~/.claude/projects/{slug}/memory/MEMORY.md` mid-session.
- Mutations (Write to add new entries) persist for next session, not current.
- Read-after-Write to verify persistence is permitted.
- Skills designed to reference cross-session preferences (e.g., /council) may read memory files with an inline comment explaining the exception.

Surfaced via the hermes-agent adoption spec (docs/specs/hermes-agent-adoption.md, Wedge A) on 2026-04-27 after research into Hermes' memory model.
