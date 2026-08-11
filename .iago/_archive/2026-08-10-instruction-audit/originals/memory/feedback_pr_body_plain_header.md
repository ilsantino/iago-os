---
name: PR body opens with plain-English "What this does" header
description: Every PR body must open with a short plain-English summary of what the feature does, BEFORE the technical detail. So Santiago can identify intent without parsing implementation prose.
type: feedback
originSessionId: 1d4602fc-8c9f-4ef3-823e-a6736c9394b4
---
PR body's first section must be a plain-English "## What this does" summary in 1-3 sentences, written for a non-developer reader (Santiago in PM/CEO mode). Detailed technical summary, plan reference, files changed, verification — all follow below.

**Why:** PR titles are constrained to ~60 chars. The body's first section is the second chance to communicate intent quickly. Without a plain-English header at the top, Santiago has to read the technical summary to understand what was delivered. He wants to land on the PR page, read 2-3 sentences in plain English, and know exactly what changed for the user — then drill into tech if needed. He told me this explicitly on 2026-05-16 during sentria feature-ayuda-content-deep execution.

**How to apply:**
- First section heading: `## What this does` (use this exact heading)
- 1-3 sentences in plain English, no jargon, no file paths, no library names, no AWS service names, no DB schema field names
- Then the existing technical summary sections (`## Summary`, `## Plan`, `## Files Changed`, `## Verification`, etc.) follow normally
- Pattern:
  ```
  ## What this does
  Makes [user-area] [do what] so [why it matters to the user].
  
  ## Summary
  {existing technical detail}
  ```
- Applies to ALL PRs in ALL client projects + iago-os itself
- Applies in the pipeline's `step5_create_pr` stage — the claude -p session that drafts the PR body must include this section as the first one
- For "What this does" tone: imagine explaining to a non-technical CEO who needs to triage 10 PRs in 30 seconds
