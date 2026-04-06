# Plan: Agent v2 — Documentation + Templates

## Source
Spec: docs/specs/agent-architecture-v2.md (Phase 7)

## Wave 1: Documentation Updates

All documentation files are independent — can be updated in parallel.

### Task 1: Update CLAUDE.md for capability-based architecture
- **files:** `CLAUDE.md`
- **action:** Update the Architecture section: replace "DynamoDB single-table design" intro paragraph — keep it but update. Update the Agents section: change "11 agents in `.claude/agents/`" to "3 base agents + 12 capability modules + 12 profiles in `.claude/agents/`". Replace the agent list with: bases (executor, analyst, operator), note that profiles compose base + capabilities per task. Update Model Routing section to reference config.json routing options (default_model, security_critical, retry_upgrade, review_matches_impl). Add brief Learnings section: ".iago/learnings/ accumulates review patterns and project conventions, injected into agent context before dispatch." Update agent count everywhere (11 → 3 bases / 12 profiles).
- **verify:** `grep -q "executor" CLAUDE.md && grep -q "profiles" CLAUDE.md && grep -q "learnings" CLAUDE.md && echo "OK"`
- **expected:** `OK`

### Task 2: Update README.md Agent Architecture section
- **files:** `README.md`
- **action:** Rewrite the "Agent Architecture" section. Update Hub-and-Spoke subsection: change Mermaid diagram to show 3 base agents (executor, analyst, operator) with profiles as the dispatch mechanism. Update the paragraph to explain capability-based composition. Replace Tool Sandboxing table with 3 rows (one per base agent) instead of 11. Update Review Pipeline — keep the Mermaid diagram but change agent names to profile names (review-single, review-full, security-audit). Replace Agent Catalog table: show 12 profiles with columns: Profile, Base, Capabilities, Model, Replaces. Update Ecosystem Integrations Model Routing table to note that profiles override model per dispatch. Update any "11 agents" count references to "3 bases + 12 profiles".
- **verify:** `grep -q "executor" README.md && grep -q "profiles" README.md && grep -q "capability" README.md && echo "OK"`
- **expected:** `OK`

### Task 3: Rewrite docs/ARCHITECTURE.md for capability-based model
- **files:** `docs/ARCHITECTURE.md`
- **action:** Rewrite the Agents layer description in the Layers diagram: "3 base agents + 12 capability modules + 12 profiles". Update the layers ASCII diagram to show capabilities and profiles. Add new section "Capability-Based Dispatch" after the current agent description explaining: base agents define tool access, capability modules add domain knowledge, profiles are pre-composed combinations, orchestrator matches task to profile or composes custom. Add dispatch flow diagram (text, not ASCII — use numbered steps). Update Model Routing table to include profile-level routing. Add "Feedback Loops" section describing .iago/learnings/ pattern extraction and injection. Update all "11 agents" references to new counts. Keep Source Patterns, Config Hierarchy, Hook Lifecycle, Multi-Project Model, and Usage Tracking sections unchanged.
- **verify:** `grep -q "capability" docs/ARCHITECTURE.md && grep -q "profiles" docs/ARCHITECTURE.md && grep -q "learnings" docs/ARCHITECTURE.md && echo "OK"`
- **expected:** `OK`

### Task 4: Update available-skills.md agent catalog
- **files:** `.claude/rules/available-skills.md`
- **action:** Replace the "Available Agents" section. Change header from "Available Agents (11 — all Sonnet, hub-and-spoke)" to "Agent Architecture (3 bases + 12 capabilities + 12 profiles)". Add Base Agents subsection listing executor, analyst, operator with tool access. Add Profiles subsection listing all 12 profiles with: name, base, capabilities, model, what it replaces. Remove the old 11-agent list. Keep the note about hub-and-spoke and that agents never spawn agents. Update the behavioral rules section if it references old agent names.
- **verify:** `grep -q "executor" .claude/rules/available-skills.md && grep -q "profiles" .claude/rules/available-skills.md && ! grep -q "implementer" .claude/rules/available-skills.md && echo "OK"`
- **expected:** `OK`

## Wave 2: Templates + Sync

Depend on Wave 1 (documentation must be accurate before templates are updated).

### Task 5: Update client-project template
- **files:** `templates/client-project/.claude/agents/`, `templates/client-project/.iago/`
- **action:** Update the client-project template to reflect the new architecture. Remove any old agent references in the template's `.claude/` directory. Add `.iago/learnings/` directory with empty `patterns.md` (table header only) and `project-conventions.md` (starter template). If the template has a CLAUDE.md, update agent references to match the new capability-based architecture. Ensure the template's config.json includes the `routing` section with defaults.
- **verify:** `test -d templates/client-project && echo "OK"`
- **expected:** `OK`

### Task 6: Update internal-project template
- **files:** `templates/internal-project/.iago/learnings/patterns.md`, `templates/internal-project/.iago/learnings/project-conventions.md`
- **action:** Create `.iago/learnings/` directory in the internal-project template. Add `patterns.md` with the review patterns table header (columns: #, Pattern, Occurrences, Last Seen, Source) and no rows. Add `project-conventions.md` with the "Project Conventions" header and starter text about adding project-specific conventions. If the template has a config.json, add the `routing` section with defaults (default_model: auto, security_critical: opus, retry_upgrade: true, review_matches_impl: true).
- **verify:** `test -f templates/internal-project/.iago/learnings/patterns.md && echo "OK"`
- **expected:** `OK`

## Verification
```bash
# Documentation references new architecture
grep -c "executor\|analyst\|operator\|profile\|capability" CLAUDE.md          # Should be 5+
grep -c "executor\|analyst\|operator\|profile\|capability" README.md          # Should be 5+
grep -c "executor\|analyst\|operator\|profile\|capability" docs/ARCHITECTURE.md  # Should be 5+

# No references to old agent names in skills or docs
grep -rn "implementer\|code-reviewer\|spec-reviewer\|tdd-guide\|data-modeler" CLAUDE.md README.md docs/ARCHITECTURE.md .claude/rules/available-skills.md .claude/skills/iago-execute/SKILL.md .claude/skills/subagent-driven-development/SKILL.md .claude/skills/code-review/SKILL.md  # Should return nothing

# Templates have learnings directory
test -f templates/client-project/.iago/learnings/patterns.md && echo "client OK"
test -f templates/internal-project/.iago/learnings/patterns.md && echo "internal OK"
```
