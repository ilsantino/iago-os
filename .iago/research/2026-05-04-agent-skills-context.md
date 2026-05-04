# Research: muratcankoylan/agent-skills-for-context-engineering

**Date:** 2026-05-04
**Repo:** https://github.com/muratcankoylan/agent-skills-for-context-engineering

## What it is

A collection of 14 reference skill files (SKILL.md per skill, no executable runtime) covering context engineering theory and patterns for LLM agents — covering memory architectures, attention degradation, compression strategies, multi-agent coordination, and evaluation frameworks. It is a methodology library, not a framework or MCP. Skills are markdown documents loaded dynamically into Claude Code / Cursor contexts via a plugin manifest; the "dynamic loading" is just filesystem-based lazy inclusion, not a runtime engine. Academic-tier reference material, not production tooling.

## Stack & runtime

- Language: Markdown (skill content) + minimal TypeScript in examples/llm-as-judge-skills (19 tests)
- License: MIT
- Last commit: 2026-04-14
- Stars: 15,433
- Maintainership signal: Solo maintainer (muratcankoylan), active — v2.0.0 shipped 2026-03-17, 22 open issues, 1.2k forks. No org backing. Docs-only PRs from community. No CI pipeline.

## Skills/patterns inventory

- **context-fundamentals** — anatomy of context windows (system prompt + tools + retrieved docs + history + outputs)
- **context-degradation** — five failure modes: lost-in-middle, poisoning, distraction, confusion, clash; four-bucket mitigation (write/select/compress/isolate)
- **context-compression** — anchored iterative summarization, opaque compression, regenerative summary; tokens-per-task metric; probe-based evaluation
- **context-optimization** — KV-cache structure rules, observation masking, compaction triggers, context partitioning
- **multi-agent-patterns** — centralized supervisor, peer-to-peer, hierarchical decomposition; sub-agents as context isolators
- **memory-systems** — framework survey (Mem0, Zep/Graphiti, Letta, Cognee, LangMem); bi-temporal modeling; hybrid retrieval (semantic + entity + temporal)
- **tool-design** — comprehensive scope over fragmented tools, contextual error info, naming conventions
- **filesystem-context** — scratch pad, plan persistence, sub-agent comms via directories, dynamic skill loading, terminal persistence, self-modification
- **hosted-agents** — background agents, sandboxed VMs, multiplayer support
- **latent-briefing** — KV cache state sharing between orchestrator/worker via Attention Matching; task-guided queries, shared token masking, MAD thresholding
- **evaluation** — multi-dimensional rubric, token-usage dominates variance (80%), LLM-as-judge with cross-family models, continuous pipeline
- **advanced-evaluation** — LLM-as-judge bias mitigation, stratified test sets, per-dimension scoring
- **project-development** — staged pipeline design, manual validation first, idempotent steps
- **bdi-mental-states** — Belief/Desire/Intention formal modeling; RDF/OWL ontology; T2B2T pipeline; temporal validity on mental states; Logic Augmented Generation

## Overlap with iago-os

| Repo pattern | iago-os equivalent | Gap |
|---|---|---|
| Dynamic skill loading (lazy SKILL.md inclusion) | `.claude/skills/` — 50+ slash commands, already lazy-loaded by slash invocation | No gap — iago-os model is equivalent or better (skills are procedural, not just reference docs) |
| Filesystem-as-memory (scratch pad, plan persistence) | `.iago/plans/`, `.iago/summaries/`, `.iago/context/`, `.iago/research/` — already structured plan persistence | No gap |
| Memory systems survey (Mem0/Zep/Graphiti/Letta) | mempalace (ChromaDB + KG + diary), graphify (vault KG), obsidian (structured notes), context7 (docs) — 5-layer architecture fully operational | No gap — iago-os is ahead |
| Multi-agent patterns (hub-and-spoke) | `.claude/agents/` — 3 bases, 12 profiles, hub-and-spoke enforced in CLAUDE.md | No gap |
| KV-cache optimization (stable content first) | Frozen-snapshot MEMORY.md rule, prefix-cache preservation noted in CLAUDE.md | Partially covered — rule exists, but no explicit system-prompt structure guide |
| Context compression / compaction | `/iago-pause` + STATE.md ≤80-line rule + SESSION.md digests in Obsidian | Covered at workflow level; no per-session compaction trigger metric (70% threshold) |
| Context degradation taxonomy | Implicit via 7+Read escalation rule and execution discipline rules | Gap — no explicit taxonomy or detection signals documented |
| Retrieval routing table | CLAUDE.md retrieval routing table (5 rows, covers all layers) | No gap |
| Observation masking | Not explicitly named anywhere in iago-os | Gap |
| Evaluation framework (LLM-as-judge, rubrics) | `/code-review`, codex adversarial step — binary pass/fail + severity tiers | Partial gap — multi-dimensional rubric and continuous baseline tracking absent |
| Latent briefing (KV tensor sharing across agents) | Not present | Gap — but requires inference-level access, inapplicable to API-only deployment |
| BDI mental state modeling | Not present | Gap — niche, high-overhead; no current use case |

## What's actually new

Three patterns iago-os doesn't have:

1. **Context degradation taxonomy** — named failure modes (lost-in-middle, poisoning, distraction, confusion, clash) with detection signals and the four-bucket mitigation framework. iago-os has rules that implicitly avoid some of these but no explicit model of when/why context degrades.

2. **Observation masking as a named discipline** — the explicit rule to replace tool output verbosity with compact references after 3+ turns, tracking what was masked vs. what's retrievable. iago-os relies on agents exercising judgment; no policy exists.

3. **Probe-based compression evaluation** — testing whether critical info survived compression by posing targeted questions across six dimensions (Accuracy, Context Awareness, Artifact Trail, Completeness, Continuity, Instruction Following). iago-os has no evaluation protocol for its session summaries or STATE.md compactions.

Latent briefing and BDI are technically novel but inapplicable: latent briefing requires KV tensor access (not available via Anthropic API); BDI requires an RDF ontology infrastructure with no current use case.

## Patterns worth absorbing

1. **Context degradation taxonomy as CLAUDE.md rule** — document the five failure modes and detection signals (degradation at 60-70% window utilization, contradictions in tool output, persistent hallucinations). Pipeline agents and implementation sessions lack any shared vocabulary for recognizing and reporting context health. Adds a named pattern library that review agents can cite in findings. Low integration cost — pure documentation.

2. **Observation masking policy** — add an explicit rule: after 3+ turns, verbose tool outputs get replaced in context with `[MASKED: <summary> | retrievable via <ref>]`. iago-os pipeline sessions are long (50-turn impl sessions, 15-turn review sessions) and this is exactly the domain where tool output bloat accumulates. Could go in `execution-pipeline.md` or a new `context-hygiene.md` rule file. Small integration cost — rule + agent prompt addition.

3. **Tokens-per-task metric + 70% compaction trigger** — formalize the compaction trigger point and evaluation principle in the context of STATE.md and session digests. Currently the ≤80-line STATE.md rule is output-size-based; a utilization-based trigger with a probe-based verification step (did the digest preserve the critical decisions?) would be more principled. Medium cost — requires adding a verification step to the session digest workflow.

## Integration cost

**Estimate:** trivial (patterns 1-2) / small (pattern 3)

**Conflicts:** None. The repo is a methodology library. It doesn't install anything, introduce a runtime, or conflict with the 5-layer memory architecture. All three absorb-worthy patterns are additive documentation/rules changes. The iago-os architecture is already more sophisticated than what this repo describes on the implementation side.

## Verdict

**Recommendation:** clear-yes (selective absorption — not wholesale integration)

**Reasoning:** The repo is not a product to integrate — it's a vocabulary and pattern library. iago-os has equivalent or superior implementations for every operational pattern. What's missing is the *documented mental model*: the named taxonomy for context failure modes, the explicit observation-masking discipline, and a principled compaction trigger. These are cheap to absorb (docs/rules changes only) and would improve pipeline agent behavior by giving them shared vocabulary to recognize and report context health degradation.

**How to integrate:**
- Add `context-degradation` taxonomy (five failure modes + four-bucket mitigation) to `.claude/rules/` as `context-hygiene.md` — reference in `execution-pipeline.md` and agent base prompts
- Add observation masking policy to `execution-pipeline.md` under a "Context Hygiene" section: mask verbose tool outputs after 3 turns, retain summary + retrieval reference
- Add 70% utilization trigger + probe-based verification to the session digest workflow in `obsidian.md` rules and the Obsidian session digest template
- Skip: latent-briefing (API-only, KV tensors inaccessible), BDI (no RDF infrastructure, no current use case), evaluation rubrics (pipeline already has severity-tiered review — the multi-dimensional rubric is refinement, not a gap)
