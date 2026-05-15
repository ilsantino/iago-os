# feature-ayuda-chat

Two-phase plan that builds on PR #121's onboarding docs feature.

## Phase 1 — Flatten Ayuda UX ([01.md](01.md))

Replace the 3-tier card-grid → audience-index → doc-page nav with a single sidebar layout (Notion/GitBook style). One click from `Ayuda` sidebar nav to a useful doc. ~1 day.

## Phase 2 — LLM chat over docs corpus ([02.md](02.md))

Claude API answers user questions in Spanish from the 24-doc corpus only. Retrieval-free RAG (corpus fits in single context with prompt caching). Chat panel lives in the Plan 01 sidebar. Rate-limited, source-cited, observable. ~3–4 days.

## Ship order

Phase 1 first (standalone win, no LLM dependency). Phase 2 builds on it (chat UI lives in the sidebar Phase 1 establishes).

## Dependencies

- Phase 1 depends on PR #121 merged (`feat/onboarding-usage-docs`).
- Phase 2 depends on Phase 1 merged.

## Note

These plans are in `clients/sentria/.iago/plans/feature-ayuda-chat/` — sentria's `.iago/` is gitignored. The plans live in the working tree only. When ready to execute, run `/iago-execute feature-ayuda-chat` from inside `clients/sentria/`.
