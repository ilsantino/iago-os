---
name: FullData bot asistente repos
description: Planning repo + onetuweb source repos + long-lived branch for FullData AI assistant deliverable
type: reference
originSessionId: c2b34dac-2a7a-463a-a6be-e0b4fd00beee
---
**Planning repo:** `github.com/ilsantino/fulldata-bot-asistente` (private). Holds `BRIEFING-team.md`, `README.md`, `workspace/00..05/` stage outputs, `.claude/CLAUDE.md`. Local path: `clients/fulldata/bot-asistente/` (own git, gitignored from iago-os via `clients/`). Excludes `repos/` and `.env.docs`.

**Source code lives in onetuweb's repos (Santiago has push+triage, not admin):**

| Layer | Repo | Long-lived branch |
|---|---|---|
| Frontend (Next.js 14 widget) | `github.com/onetuweb/Fulldata` | `feat-ai-assistant-v1` |
| Backend (Laravel 12 + Sanctum) | `github.com/onetuweb/Fulldata-back` | `feat-ai-assistant-v1` |

Local clones at `clients/fulldata/bot-asistente/repos/Fulldata` and `.../Fulldata-back`. Both inner repos — gitignored from planning repo via `repos/` line.

**Workflow:** Stage 02–05 PRs target `feat-ai-assistant-v1` on the relevant onetuweb repo. Once Stage 05 testing passes end-to-end, a single PR `feat-ai-assistant-v1 → main` per repo for onetuweb review/merge. Branch name uses dashes (not slash) to match onetuweb convention (`feat-cfdi`, `feat-aff-finkok`).
