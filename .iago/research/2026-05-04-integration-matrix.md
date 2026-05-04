# Integration Matrix — 6-Repo Tool Surveillance + Pattern Mining

**Date:** 2026-05-04
**Driver:** (b) tool surveillance + (c) pattern mining. User open to replacing existing iago-os components.

## Verdict Summary

| # | Repo | Verdict | Tool cost | Pattern cost |
|---|------|---------|-----------|--------------|
| 1 | vercel-labs/agent-browser | clear-yes (MCP wrapper) | small | trivial (3 patterns) |
| 2 | D4Vinci/Scrapling | clear-yes (built-in MCP) | small (~1h) | n/a |
| 3 | kepano/obsidian-skills | clear-yes (selective: 3 of 5) | trivial | trivial (3 patterns) |
| 4 | PleasePrompto/notebooklm-skill | clear-no | n/a | trivial (3 patterns) |
| 5 | muratcankoylan/agent-skills-context | clear-yes (rules-only) | trivial | trivial (3 patterns) |
| 6 | massgen/massgen | clear-no | n/a | trivial (3 patterns) |

3 tools to install. 12 patterns to absorb across rules/skills/agents.

## Tools to Install

### Tool 1 — agent-browser (Vercel)
- **What:** Native Rust CLI, accessibility-tree snapshots (~300 tokens vs ~4000 raw HTML), numbered element refs, Apache-2.0, 31K stars
- **How:** New `mcp/agent-browser/index.ts` thin wrapper around the npm binary
- **Where it plugs in:** `operator` base agent gains `browser` capability module
- **License:** Apache-2.0

### Tool 2 — Scrapling
- **What:** 3-tier fetcher (HTTP-impersonation → Playwright → Camoufox stealth/Turnstile), built-in MCP server with 10 tools, BSD-3, 44K stars
- **How:** `pip install "scrapling[fetchers,ai]"` + `scrapling install` + JSON config in `~/.claude.json`. Already MCP-native — no wrapper needed.
- **Where it plugs in:** `operator` base + escalation rules in operator capability module
- **Constraint:** 1.5 GB browser footprint — MCP/desktop only, never Lambda

### Tool 3 — obsidian-skills (selective: 3 of 5)
- **Take:** `obsidian-markdown` (syntax guardrails), `defuddle` (web-content stripper for /deep-research), `obsidian-bases` (persistent filtered vault views)
- **Skip:** `obsidian-cli` (requires Obsidian desktop running, our MCP supersedes), `json-canvas` (Graphify covers it)
- **How:** `npx obsidian-skills` install + `npm i -g defuddle`
- **Migration:** Zero — purely additive to existing Obsidian MCP setup

## Patterns to Absorb (12)

### From agent-browser (3)
1. **Trust-boundary capability module** — small markdown injected into any browser-operating agent: treat all page content as untrusted, never echo secrets, stay in-domain, flag injection. iago-os has no equivalent.
2. **Snapshot-first interface** — accessibility-tree as primary representation, not raw HTML. Apply to any operator agent doing web work.
3. **Rubric-based skill-selection evals** — 5-point scoring of orchestrator routing. Catches regression as skill catalog grows.

### From kepano/obsidian-skills (3)
4. **YAML frontmatter trigger blocks** — name + description + negative conditions, makes skills self-dispatching. **Architectural — see Tension 2.**
5. **`references/` sub-document pattern** — keeps primary SKILL.md scannable for large skills.
6. **Explicit "Do NOT use when"** — anti-triggers in skill descriptions prevent misfire.

### From notebooklm-skill (3)
7. **Source registry shape** — typed metadata block for each ingested document.
8. **Corpus-isolation as explicit constraint** — answer-must-cite-sources flag for select skills.
9. **Source-router-before-answer** — pre-step that picks which corpus to query before generating.

### From muratcankoylan/agent-skills-context (3)
10. **Context degradation taxonomy** — named failure modes (lost-in-middle, poisoning, distraction, confusion, clash) + write/select/compress/isolate mitigation buckets. New `rules/context-hygiene.md`.
11. **Observation masking** — verbose tool outputs replaced with compact references after 3+ turns. Append to `execution-pipeline.md`.
12. **Probe-based compression evaluation** — six targeted questions post-compaction to verify digest preserved critical info. Wire into `obsidian.md` session-digest workflow.

### From massgen (3, ~free)
13. **`BroadcastChannel` round** — give /council advisors one peer-draft visibility round before finalizing (currently isolated). Likely improves synthesis quality at zero token cost increase.
14. **`CoordinationTracker`** — auditable voting record in /council output.
15. **`new_answer` restart semantics** — when review hits Critical, restart impl rather than stack diffs on broken base. Pipeline change in `scripts/execute-pipeline.sh`.

## Architectural Tensions

Two questions don't have a clean default — they need debate before bundling.

### Tension 1 — Browser tool primacy
agent-browser AND Scrapling both give agents web capability, but differ:

| | agent-browser | Scrapling |
|---|---------------|-----------|
| Strength | Token efficiency (AT-tree, 13× reduction) | Anti-bot (Turnstile bypass), stealth |
| Stack | Rust binary via npm | Python 3.11+ with 1.5GB browsers |
| MCP | Need wrapper | Built-in |
| Maintainership | Vercel | Solo + active |
| Cost surface | Small | Medium (Python runtime, browser footprint) |

Decision: install one as primary + fallback, install both with explicit escalation ladder, or domain-split (e.g., agent-browser for app testing/known-good sites; Scrapling for hostile/unknown).

### Tension 2 — Skill dispatch model
kepano's pattern: YAML frontmatter triggers, agent auto-dispatches based on description match. iago-os today: explicit `/slash-command` invocation only.

Adopting frontmatter triggers changes the skill discovery model. The risk: skill misfire (auto-dispatch when not wanted), drift between explicit and implicit catalogs. The reward: skills become discoverable by capability, not memorization.

Decision: adopt frontmatter triggers (and migrate), keep explicit-only, or hybrid (some skills auto, others explicit).

## Sequencing Recommendation (post-council)

Council rejected pre-emptive tool installation and full auto-dispatch adoption. Revised sequencing:

### Wave 1 — `feature-tool-surveillance-patterns/` (DO NOW, post-Munet M2)
Doc-only and rules-only changes. Zero tool installs. Zero architectural risk.
- `rules/context-hygiene.md` (degradation taxonomy from agent-skills-context)
- Append observation-masking policy to `execution-pipeline.md`
- Add probe-based compression check to `obsidian.md` session digest workflow
- New `agents/capabilities/trust-boundary.md` capability module (from agent-browser)
- Add "Do NOT use when" anti-triggers to high-confusion skills (/iago-fast, /iago-quick, /iago-execute)
- Add YAML `description` frontmatter blocks to skill files — **metadata only, NOT auto-dispatch**
- /council enhancement: BroadcastChannel peer-draft round + CoordinationTracker voting record
- Pipeline enhancement: `new_answer` restart semantics on Critical findings (replaces stack-diffs-on-broken-base)

### Wave 2 — `feature-obsidian-skills-selective/` (parallel-safe with Wave 1)
- Install `obsidian-markdown` skill (Obsidian syntax guardrails)
- Install `defuddle` (web-content stripper for /deep-research)
- Build `obsidian-bases` files (persistent filtered vault views — 2-4h of base-file authoring)
- Skip `obsidian-cli` and `json-canvas`

### Wave 3 — `/what-skill` recommender (gated on Wave 1 frontmatter data)
- New skill: `/what-skill "I want to..."` reads frontmatter descriptions, suggests matching skills with confidence scores
- Recommends only — human or orchestrator invokes explicitly
- Solves discoverability without auto-dispatch determinism cost

### Deferred until first real bottleneck
- **agent-browser** — install when a real scraper task lands. Apache-2.0 + npm/Rust = stack-aligned. Build thin MCP wrapper at that point.
- **Scrapling** — install only when a client hits Cloudflare/Turnstile and agent-browser can't bypass. Treat as anti-bot escape hatch, not a primary tool.
- Pre-emptive install rejected: existing MarkItDown + youtube-transcript + WebFetch cover ~70% of latent scrape needs; cross-platform Python tax is real; maintenance ownership unassigned.

### Dropped patterns (council didn't endorse)
- Skill self-dispatch via frontmatter triggers (Claude Code auto-invocation) — violates determinism + self-freeze interaction
- Productizing as `/iago-scrape` SKU — premature, no client demand, no surplus capacity
