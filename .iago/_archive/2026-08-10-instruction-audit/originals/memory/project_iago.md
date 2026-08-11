---
name: iaGO-OS project state
description: Claude Code config layer — v0.2.0 released, pipeline hardened, memory architecture live
type: project
---

iaGO-OS is a Claude Code configuration layer for a 3-person AI consultancy. Lives in `.iago/` inside client projects.

**Release history:**
- v0.1.0 (2026-04-06): Initial release — agents v2, skills, hooks, rules, state engine
- v0.2.0 (2026-04-09): Pipeline hardening + memory architecture (86 commits since v0.1.0)

**v0.2.0 highlights:**
- 3-stage review pipeline with build gate, Codex adversarial review
- Async GitHub review-fix loop (max 5 rounds, priority-ordered)
- Pipeline control flags (--no-review, --review, --no-tag)
- Memory architecture: MEMORY.md + Obsidian MCP + MemPalace (3-layer, 12,076 drawers)
- Graphify knowledge graph MCP integration
- Security: fail-closed hooks, bash secret detection, safe staging

**What exists:**
- 41 skills, 3 bases + 12 capabilities + 12 profiles, 8 rules, 10 hooks
- 2 template sets, 4 scripts, state engine, Codex plugin
- MCP servers: context7, obsidian, graphify, mempalace
- AWS CLI configured (user iaguito, account 582071018864)

**What's next:** First real client project (MUNET or other) to validate architecture in production.

**How to apply:** Read STATE.md for current phase. Check CLAUDE.md for all conventions.
