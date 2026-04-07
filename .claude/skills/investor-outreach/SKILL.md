---
name: investor-outreach
description: >-
  Use when drafting investor emails, follow-ups, or outreach sequences.
  Not when creating pitch materials (use /investor-materials) or doing
  market research (use /deep-research --focus market).
---

<!-- Source: ECC investor-outreach -->

## Purpose

Draft personalized investor outreach emails and follow-up sequences — concise,
specific, and tailored to each investor's thesis and portfolio.

## Arguments

`/investor-outreach {investor-name or context}` — who to reach out to.

Optional flags:
- `--type {cold|warm|follow-up|update}` — email type (default: cold)
- `--sequence` — generate a 3-email sequence instead of single email

## Steps

### 1. Gather context

Collect or confirm:
- Investor name, firm, and investment thesis
- Your company's one-line value prop and stage
- Any existing relationship or warm intro path
- Specific traction or milestone to highlight

### 2. Draft email(s)

**Cold outreach:** 4-6 sentences max.
- Line 1: Why them specifically (thesis alignment, portfolio fit)
- Line 2-3: What you're building and one proof point
- Line 4: The ask (meeting, not money)

**Warm intro:** Brief context for the introducer + the forwardable blurb.

**Follow-up:** Reference previous touchpoint, add new traction data.

**Update:** Quarterly investor update with metrics, milestones, asks.

**Sequence (`--sequence` flag):**
- Email 1: Initial outreach (day 0)
- Email 2: Value-add follow-up with new data point (day 5)
- Email 3: Final gentle follow-up (day 12)

### 3. Save

Write to `docs/outreach/{investor-slug}-{type}.md`. Create directory if needed.

## Output

1. Email file path
2. Email type and word count
3. Key personalization points used
4. If sequence: timeline with send dates

## Boundaries

- Does not send emails — produces drafts only
- Does not research investors — provide context or use `/deep-research` first
- Does not dispatch agents — orchestrator writes inline
- No generic templates — every email must reference specific investor context
