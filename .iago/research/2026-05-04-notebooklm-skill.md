# Research: PleasePrompto/notebooklm-skill

**Date:** 2026-05-04
**Repo:** https://github.com/PleasePrompto/notebooklm-skill

## What it is

A Claude Code skill that bridges Claude to Google's NotebookLM via browser automation (Patchright/Chrome). When invoked, it opens a headless Chrome session, submits a question to a user-registered NotebookLM notebook, and returns the source-grounded, Gemini-synthesized answer back to Claude. The core value proposition: zero-hallucination answers from a pre-curated document corpus without building a local RAG pipeline.

## Stack & runtime

- **Language:** Python 3.8+ (browser automation scripts); SKILL.md loaded into Claude context
- **License:** MIT
- **Last commit:** 2025-11-21 (v1.3.0 — modular architecture + timeout fix)
- **Stars:** 6,263
- **Maintainership signal:** Stale. Last commit 6 months ago, 23 open issues, no recent activity. High star count reflects virality of the concept at launch, not active maintenance.

## Capabilities the skill provides

- Query a Google NotebookLM notebook from Claude Code by submitting a natural-language question
- Source-grounded answers: Gemini synthesizes from uploaded documents only (no hallucination beyond corpus)
- Notebook library management: register, list, activate, search, remove notebooks by URL + metadata
- Persistent Google authentication via stored browser session (one-time manual login)
- Smart notebook auto-selection based on registered topic tags
- Follow-up query loop until Claude confirms all information gaps are filled
- Synthesis step: Claude combines multiple NotebookLM responses before presenting to user

## Overlap with iago-os

| NotebookLM skill capability | iago-os equivalent | Gap? |
|---|---|---|
| Document ingestion → queryable corpus | markitdown converts docs to markdown; obsidian stores them | Partial — markitdown produces flat markdown, not a Gemini-indexed corpus |
| Knowledge clustering over a corpus | graphify clusters vault notes into communities + wiki | Partial — graphify clusters by co-occurrence, not by semantic Q&A |
| Cross-session recall over docs | mempalace ChromaDB search over conversation history | Partial — mempalace covers conversations, not arbitrary uploaded docs |
| Vault/note access | obsidian MCP (full read/write) | Full overlap — obsidian already handles personal vault |
| Source-grounded Q&A with citations | None | **GAP — iago-os has no citation-backed answer layer** |
| Multi-document synthesis without token burn | None | **GAP — iago-os always ingests docs into context (token cost)** |
| Notebook-scoped answer isolation (no hallucination beyond corpus) | None | **GAP — no corpus-isolation guarantee in current stack** |

## What's actually new

Three capabilities iago-os genuinely lacks:

1. **Source-grounded, citation-backed Q&A.** When Claude answers from markitdown output or obsidian notes, it draws on its own weights + context window. NotebookLM forces Gemini to answer exclusively from the uploaded corpus and attributes each claim to a source. iago-os has no equivalent isolation guarantee.

2. **Zero-token-cost document querying.** Ingesting a 200-page PDF via markitdown or reading vault notes costs context tokens on every query. The NotebookLM bridge offloads synthesis to Gemini — Claude only receives the final answer. At scale (large client document sets), the token delta is significant.

3. **Pre-processed corpus persistence.** NotebookLM indexes documents once; subsequent queries are fast and cheap. iago-os re-ingests on every session. For stable reference corpora (compliance docs, client contracts, architecture specs) this matters.

Audio podcast generation — a native NotebookLM feature — is NOT exposed by this skill. It is strictly a Q&A bridge.

## Patterns worth absorbing

1. **Notebook library registry (URL + name + topics + active flag).** The skill maintains a JSON library of registered notebooks with metadata. iago-os could adopt an analogous `source registry` pattern in `.iago/context/` for tracking external knowledge sources (client portals, Confluence spaces, Drive folders) — not for this specific skill, but as a general capability registry shape.

2. **Corpus isolation as a first-class constraint.** The skill makes "answer only from these sources" an explicit design goal, not an afterthought. When building client-facing agents in iago-os that must answer from a fixed corpus (e.g., compliance docs, product manuals), this constraint should be modeled explicitly rather than relying on prompt engineering alone. The pattern: register corpus → route queries through isolated synthesizer → return attributed answer.

3. **Smart auto-selection over registered sources.** The notebook_manager selects the most relevant notebook by topic tags before querying. iago-os's mempalace wing routing does something similar (route by wing name). Worth generalizing: a lightweight source-router that picks the right knowledge store (mempalace wing, obsidian section, external API) before answering — rather than dumping all context and hoping.

## Integration cost

**Estimate:** small (as a skill) / medium (if building a native equivalent)

**What it would take:**

Option A — Adopt the skill as-is:
- Copy SKILL.md to `.claude/skills/notebooklm.md` (5 min)
- Clone scripts to `~/.claude/skills/notebooklm/` (5 min)
- One-time Google login for auth
- Blocker: requires Python 3.8+ and Chrome on the executing machine; works on Santiago's Windows + Sebas's Mac but adds a non-TS dependency to an otherwise TypeScript stack
- Maintenance risk: skill is stale (6 months no commits), depends on NotebookLM's DOM staying stable under Patchright scraping — fragile

Option B — Build a native corpus-isolation layer using context7 + mempalace:
- Create a mempalace wing per document corpus
- Route queries through wing-scoped search + synthesis prompt
- Achieves corpus isolation without browser automation, but loses Gemini's pre-processed index quality
- Cost: 1 medium plan (3-5 tasks)

Option C — Use NotebookLM directly via its API when Google releases one:
- Currently no public API. Monitor for release.

## Verdict

**Recommendation:** clear-no (adopt as-is) + needs-decision (on native equivalent)

**Reasoning:**

The skill is fragile by design — browser automation against NotebookLM's DOM, no public API backing it, actively stale (6 months), and it introduces Python as a runtime dependency into a TypeScript-only stack. The Patchright scraping approach will break on any NotebookLM UI update, and with 23 open issues and no recent commits, fixes are not coming. Adopting it creates a maintenance liability, not an asset.

The underlying value proposition — source-grounded, citation-backed Q&A over a stable document corpus — is real and iago-os doesn't have it. But the right path is not this skill.

**If clear-no:** The fragility + stale maintenance + Python runtime dependency disqualify it. Do not add to iago-os.

**If needs-decision — what's the tradeoff:**

When a client project requires provably corpus-scoped Q&A (compliance, legal, regulated domains), the choice is:

- Use NotebookLM's UI manually and feed answers to Claude (no integration, zero maintenance cost)
- Build a native mempalace-backed corpus layer (TypeScript-native, maintainable, but weaker synthesis quality than Gemini's pre-indexed approach)
- Wait for a NotebookLM API (Google has signaled one is coming; worth monitoring)

For now: absorb patterns 1-3 above into how iago-os designs future knowledge-routing features. Do not ship any code from this repo.
