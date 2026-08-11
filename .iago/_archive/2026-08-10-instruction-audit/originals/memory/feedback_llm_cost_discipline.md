---
name: LLM cost discipline — deterministic by default
description: Reserve LLM calls for tasks where they're irreplaceable (judgment, NL understanding, ambiguity, NL→structured extraction, final prose). Default to deterministic code for everything else. Applies to client deliverables AND iaGO internal tooling.
type: feedback
originSessionId: d2c81219-e8d5-4e6b-9a2d-f510e81f9814
---
When designing any system that uses an LLM, Santiago wants LLM usage minimized to where it's 100% needed. Deterministic code, lookups, hardcoded mappings, rule-based routing, and verbatim retrieval are preferred wherever they can replace an LLM call.

**Why:** Cost control + better UX. LLMs are non-deterministic, slower per token than a function call, and expensive at scale. They earn their cost only where judgment / language understanding / unstructured input handling is genuinely required. Stated explicitly 2026-05-28 during FullData asistente Stage 01: "I don't want to use llms where we don't need to, optimize costs and code and only insert llm usage where we 100% need to use it either for effectivity or user experience."

**How to apply:**

1. **Before adding an LLM call to a design, ask: what's the deterministic alternative?** Examples of moves to make by default:
   - Shortcut/button clicks → server-side ID-to-action map, skip LLM.
   - "Suggested next actions" lists → hardcoded per tool/intent in a registry, not LLM-generated per response.
   - Response formatting (which widget renders this?) → tool declares its response type, frontend switches deterministically.
   - Static knowledge retrieval (FAQ, manuals) → return matched section verbatim. Don't ask an LLM to re-phrase what's already written well.
   - ID validation, tenant scoping, security checks → always deterministic, LLM never touches.
   - Tool argument projection (which fields go to the LLM after a DB hit) → fixed schema in the tool handler.

2. **Where LLMs DO earn their cost (use without hesitation):**
   - Intent classification on free-text input.
   - Ambiguity detection ("muéstrame el último" — last what?).
   - NL → structured extraction (dates, filters, references from user phrasing).
   - Final-prose assembly in the user's language when the response needs to adapt to their phrasing.
   - Multi-turn clarifier conversations.

3. **Model selection follows the same discipline.** Don't auto-pick the biggest model — pick by task. Sonnet for tasks where tool-calling discipline matters (writes, complex agents); Haiku for simple classification at scale. When unsure, ship cheap and instrument cost.

4. **Always instrument LLM cost from day 1.** Per-request token logging in the controller, daily aggregation. Don't ship LLM features without knowing what they cost.

5. **Reflect this in plans and architecture docs explicitly.** A table of "where LLM is used vs deterministic" belongs in every architecture document that has LLM involvement (see FullData asistente §1.4b for the template).
