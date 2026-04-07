---
name: review-single
description: >-
  Single-pass code review for correctness, security, and standards.
  Use for quick reviews where spec compliance, quality, and security
  are checked together in one analysis.
base: analyst
model: sonnet
maxTurns: 15
capabilities:
  - security
  - review-spec
  - review-quality
---

## Match Signals

Dispatch this profile when:
- `review.mode` is "single" in `.iago/config.json`
- Skill is `/iago:quick` — default review profile for lightweight workflow
- Skill is `/code-review` — default review profile for on-demand reviews
- Task type is review and no mode is specified (fallback to single)

## Mode

One-pass review covering spec compliance, code quality, and security in a single analysis. Apply all three capability checklists simultaneously — do not split into stages. Rate every finding Critical, Important, or Minor across all three dimensions. If Critical findings exist, call them out prominently at the top. Produce a single consolidated verdict: approve or request-changes.
