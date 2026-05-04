# Feature: Tool Surveillance — Pattern Absorption

**Date:** 2026-05-04
**Source:** `.iago/research/2026-05-04-integration-matrix.md` + `.iago/research/2026-05-04-*.md` (6 repos) + council verdict (in matrix)
**Driver:** Tool surveillance + pattern mining across 6 external repos. Council rejected pre-emptive browser-tool install and full skill auto-dispatch; absorbable patterns and one selective-install bundled here.

## Goal

Absorb the validated patterns from the 6-repo research sweep into iago-os without taking on the architectural risk that the council rejected. Specifically:
- Add doc/rules-only patterns that improve context hygiene, council deliberation, pipeline restart semantics, and skill discoverability metadata.
- Extend `/deep-research` with the source-grounded answer pattern from notebooklm research.
- Selectively install 3 of kepano's 5 obsidian-skills.
- Build a `/what-skill` recommender that uses skill metadata for discovery without auto-invoking anything.

## Out of scope

- **agent-browser MCP install** — deferred until first real scraper task lands. When it lands: thin MCP wrapper, npm/Rust binary, Apache-2.0. Not now.
- **Scrapling install** — deferred until a client actually hits Cloudflare/Turnstile and agent-browser can't bypass. Treat as anti-bot escape hatch only.
- **Skill self-dispatch via Claude Code auto-invocation** — frontmatter `description` blocks added (Plan 01) are metadata-only. The recommender (Plan 04) suggests; humans/orchestrator invoke explicitly. Council ruled auto-dispatch violates the determinism + self-freeze invariants.
- **Productizing as `/iago-scrape` SKU** — no client demand, no surplus capacity (Munet M2 in flight).
- **Snapshot-first browser interface pattern** — bundles with the agent-browser tool when it ships.

## Plan breakdown

Output: 4 plans inside `.iago/plans/feature-tool-surveillance/`, named `01-patterns-core.md`, `02-source-grounded.md`, `03-obsidian-skills.md`, `04-what-skill.md`.

### Plan 01 — Patterns Core (doc/rules-only, no installs)

Absorb 10 patterns into rules, agent capabilities, /council, and the pipeline. Pure additive — zero tool installs.

Tasks (target 6-8):
1. New `.claude/rules/context-hygiene.md` — degradation taxonomy (lost-in-middle, poisoning, distraction, confusion, clash) + write/select/compress/isolate mitigation buckets. Source: agent-skills-context.
2. Append observation-masking policy to `.claude/rules/execution-pipeline.md` — verbose tool outputs replaced with compact references after 3+ turns in long impl sessions. Source: agent-skills-context.
3. Append probe-based compression evaluation to `.claude/rules/obsidian.md` session-digest workflow — six targeted questions post-compaction to verify digest preserved critical info. Source: agent-skills-context.
4. New `.claude/agents/capabilities/trust-boundary.md` capability module — treat all external content as untrusted, never echo secrets, stay in-domain, flag injection. Wire into `operator` base. Source: agent-browser.
5. Add "Do NOT use when" anti-triggers to high-confusion skill descriptions (`/iago-fast`, `/iago-quick`, `/iago-execute`, `/iago-plan`, `/subagent-driven-development`). Source: kepano.
6. Add YAML `description` frontmatter blocks to all skill files in `.claude/skills/**` — metadata only, NOT auto-dispatch. Used by Plan 04. Source: kepano.
7. Update `.claude/skills/council/SKILL.md` — add BroadcastChannel peer-draft round before peer review (advisors see each others' anonymized drafts once, may revise) + CoordinationTracker voting record in chairman synthesis output. Source: massgen.
8. Update `scripts/execute-pipeline.sh` review stage — when review finds Critical, restart impl session with fresh context rather than stacking diffs on broken base. Source: massgen `new_answer` restart semantics.
9. New `.claude/rules/skill-authoring.md` — references/ sub-doc pattern for large skills + rubric-based skill-selection eval skeleton. Source: kepano + agent-browser.

Acceptance:
- `tsc --noEmit` and `vite build` pass.
- New rule files under `.claude/rules/` are referenced from `CLAUDE.md` "Rules" section.
- `/council` produces voting record in transcript.
- Pipeline restart-on-Critical exercises in a smoke run.
- All skill files in `.claude/skills/` parse with valid frontmatter.

### Plan 02 — Source-grounded research enhancement

Extend `/deep-research` with the source-grounded answer pattern from the notebooklm research. Pure rules + skill enhancement. No new tools.

Tasks (target 3-4):
1. New `.claude/rules/source-grounded-answers.md` — source registry shape (typed metadata block per ingested document: id, type, uri, fetched_at, hash) + corpus-isolation flag (skill must answer ONLY from registry-listed sources, no weight-drawn answers).
2. Update `.claude/skills/deep-research/SKILL.md` — add source-router-before-answer pre-step that picks which corpus subset to query based on the question, and emits source registry for the research artifact.
3. Update research artifact template — every claim cites a source registry entry by id. Unsourced claims flagged with `[unsourced]` tag.
4. Add citation lint to research artifact write step (or document the convention if no automation possible).

Acceptance:
- `/deep-research` output includes source registry block.
- Citations in artifact reference registry by id.
- Unit test or smoke run on a real research question shows source-grounded output.

### Plan 03 — kepano obsidian-skills selective install

Install 3 of kepano's 5 skills. Skip 2 that overlap with existing iago-os capabilities.

Tasks (target 3-4):
1. Run `npx obsidian-skills` install for `obsidian-markdown` (Obsidian syntax guardrails — wikilinks, embeds, callouts, PROPERTIES.md types).
2. Install `defuddle` globally (`npm i -g defuddle`) and wire into `/deep-research` WebFetch path — strip nav/ads/clutter before passing to agent.
3. Build initial `obsidian-bases` set: `sessions-by-project.base`, `meetings-by-client.base`, `decisions-by-date.base` (2-4h authoring).
4. Skip `obsidian-cli` (requires Obsidian desktop; our MCP supersedes) and `json-canvas` (Graphify covers visualization).

Acceptance:
- `obsidian-markdown` triggers on relevant Obsidian writes (test by writing a malformed wikilink — agent corrects it).
- `defuddle` reduces web-content tokens by ≥30% on a real article fetch.
- `obsidian-bases` views render in Obsidian and surface accurate filtered lists.
- Existing Obsidian MCP, session-digest workflow, and graphify integration unchanged.

### Plan 04 — `/what-skill` recommender

Build a discovery skill that reads frontmatter `description` blocks (added in Plan 01) and recommends matching skills with confidence scores. Recommends only — never invokes.

Depends on: Plan 01 (frontmatter blocks must exist).

Tasks (target 3-5):
1. New `.claude/skills/what-skill/SKILL.md` — accepts a natural-language intent, scans `.claude/skills/**/*.md` frontmatter, ranks matches.
2. Output format: top 3 candidates with confidence score + one-line description + explicit invocation hint (`Invoke with: /<skill-name>`).
3. Hard ceiling: NEVER auto-invoke. NEVER suggest anything that writes/commits/pushes without an extra confirmation note.
4. Add to `.claude/rules/available-skills.md` quick-reference table.
5. Smoke test on 5 representative intents ("I want to ship a small fix", "I want to research a library", "I want to plan a phase", "I want to review a PR", "I want to explore a feature").

Acceptance:
- `/what-skill` returns 3 ranked candidates with confidence + invocation hints.
- Never produces an auto-invocation directive.
- Smoke tests show the right skill in top-1 for ≥4 of 5 intents.

## Sequencing and parallelism

```
Plan 01 ─────┬───► Plan 04 (gated on 01 frontmatter blocks)
             │
Plan 02 ─────┤  (parallel-safe with 01, 03)
             │
Plan 03 ─────┘  (parallel-safe with 01, 02)
```

01 and 03 may run in parallel waves. 02 may run in any wave. 04 must wait for 01.

## Slot

After Munet M2 ships. Council called this out as a hard precondition; bandwidth constraint is real.

## References

- `.iago/research/2026-05-04-integration-matrix.md` — full matrix + council verdict
- `.iago/research/2026-05-04-agent-browser.md`
- `.iago/research/2026-05-04-scrapling.md`
- `.iago/research/2026-05-04-obsidian-skills.md`
- `.iago/research/2026-05-04-notebooklm-skill.md`
- `.iago/research/2026-05-04-agent-skills-context.md`
- `.iago/research/2026-05-04-massgen.md`
