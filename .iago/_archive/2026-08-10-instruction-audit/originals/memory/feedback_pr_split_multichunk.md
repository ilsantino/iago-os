---
name: Multi-chunk features split into per-chunk PRs from the start
description: For initiatives spanning distinct chunks (code + research + infra + multi-audience content), split into separate PRs per logical chunk from the start of planning. Don't stack all chunks on one branch — too big to review, hard to roll back a piece. Override of generic stack-prs convention for multi-chunk scope.
type: feedback
originSessionId: 1d4602fc-8c9f-4ef3-823e-a6736c9394b4
---
For multi-chunk feature initiatives, split into per-chunk PRs from planning time. Don't lump distinct deliverables onto one branch.

**Why:** Santiago told me on 2026-05-16 during sentria feature-ayuda-content-deep that "all of these plans include different features between ayuda right?" — referring to a 7-commit mega-PR (#133) that bundled: foundation code (link fix + figure plugin), flow research doc, Playwright infra, then 4 separate user-facing doc audiences, plus glossary regen. Each of those is its own deliverable that could ship independently. Combining them into one PR made the review impossibly large and made rollback all-or-nothing.

I had over-applied the `feedback_stack_prs.md` memory (which was about small refactor commits within ONE chunk on munet-web). That convention does NOT extend to distinct multi-feature initiatives.

**How to apply:**
- At `/iago-plan` time, look at the spec. If the plans span distinct chunks (different files/areas/audiences), set up SEPARATE branches + PRs per chunk from the start.
- Typical chunk splits for a sentria-scale initiative:
  - **PR A**: foundation code (one chunk of related code changes — components, libs, plugins)
  - **PR B**: research artifact (pure docs, ships anytime)
  - **PR C**: test infrastructure (Playwright, Vitest setup, etc.)
  - **PR D-G**: user-facing content per audience (admin docs, technician docs, etc. — one PR per audience OR per coherent content cluster)
  - **PR H**: final polish (cross-cutting glossary, capture run, dual adversarial)
- Each PR carries its own wave-1 + wave-2 + ... plan files in its own `.iago/plans/feature-{chunk-slug}/`
- Plans 04-07 (per the sentria pattern) depend on Plan 01 + Plan 02 being merged FIRST. Sequence the chunks: foundation PR merges before content PRs land.
- Trade-off accepted: more PRs = more overhead per PR, but each is reviewable + mergeable + rollback-able independently.

**When NOT to split:**
- Small feature (≤3 plans, single chunk). Stack-prs convention applies — one PR.
- Tightly coupled refactor (one logical change spread across files). One PR.

**For sentria feature-ayuda-content-deep specifically (2026-05-16):** finishing on the existing single PR #133 since we're mid-execution; future initiatives split per-chunk from the start.
