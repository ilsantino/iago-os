---
name: PR titles use plain-English feature names, no jargon
description: PR titles must be short plain-English feature descriptions Santiago can identify at a glance from the GitHub PR list — NOT technical / library / commit-prefix style. Applies to all client deliverables.
type: feedback
originSessionId: 1d4602fc-8c9f-4ef3-823e-a6736c9394b4
---
PR titles must be short, plain-English descriptions of what the feature DOES from a user/business POV. No technical jargon, no library names, no implementation details, no conventional-commit prefixes in the TITLE.

**Why:** Santiago reviews PRs in GitHub list view (PR list page). Technical titles like `feat(ayuda): two-pass research + remark-figure plugin` force him to open each PR to understand what it actually delivers. He wants to identify intent at a glance, sort by business impact, and triage merge order without parsing tech detail. He told me this explicitly on 2026-05-16 during sentria feature-ayuda-content-deep execution.

**How to apply:**
- ✗ `feat(ayuda): two-pass research + remark-figure plugin`
- ✗ `fix(estado): adversarial findings on auth + markdown`
- ✗ `feat(runtime): IPC server skeleton + telemetry NDJSON emitter`
- ✓ `Help center: deep flow research + screenshots`
- ✓ `Estado command: tighten auth + clean markdown rendering`
- ✓ `Runtime: agent-to-dashboard message channel`
- Pattern: `{user-area or short-fix-prefix}: {plain-English what-user-gets}`
- Keep under 60 chars
- Skip conventional-commit prefixes in the title — but KEEP them in the COMMIT message (commit convention unchanged per `.claude/rules/git-workflow.md`)
- Applies to ALL client project PRs (sentria, munet, din, fulldata, hermes, palazuelos, rsf, iago-os itself)
- Applies in the pipeline's `step5_create_pr` stage — the claude -p session that creates the PR must follow this
