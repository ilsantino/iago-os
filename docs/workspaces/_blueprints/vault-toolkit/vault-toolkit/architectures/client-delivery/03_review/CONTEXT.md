# Stage 03: Review

## Purpose
Evaluate the build output against quality standards and scope, then facilitate client review. This stage happens in two phases: internal review first, then client review. Never show a client something you have not reviewed internally first.

## Inputs
- **02_build/output/**: All deliverables and the build summary.
- **_config/scope-agreement.md**: Acceptance criteria for each deliverable.
- **01_discovery/output/requirements.md**: Full requirements list for coverage check.
- **Quality standards** (if you have them in _config/): General quality bar for your work.

## Process

### Phase 1: Internal Review
1. Read each deliverable.
2. Check against acceptance criteria from scope agreement. Pass/fail each criterion.
3. Check against requirements document. Verify coverage.
4. Review the build summary. Investigate any flagged issues or known gaps.
5. Produce an internal review document. If issues found, return to build with specific, actionable feedback. Do not send vague feedback like "needs improvement." Specify what needs to change and why.

### Phase 2: Client Review
6. Once internal review passes, prepare the deliverables for client presentation.
7. Create a review guide for the client: what they are looking at, what to focus on, how to provide feedback, what the revision process is.
8. Facilitate client review. Document all feedback.
9. Categorize feedback: in-scope revision (goes back to build), out-of-scope request (change request process), cosmetic/preference (handled in this stage or handoff).

## Output
Write to: 03_review/output/

**review-internal.md** (after phase 1):
```
# Internal Review: [Engagement Name]

## Acceptance Criteria Check
[For each criterion: pass / fail with explanation]

## Requirements Coverage
[For each requirement: met / not met / partially met]

## Issues for Build
[Specific, actionable items to fix. Reference exact locations
in the deliverables.]

## Approved for Client Review: [Yes / No - return to build]
```

**review-client-feedback.md** (after phase 2):
```
# Client Feedback: [Engagement Name]

## Feedback Items
[Numbered list. For each item:
 - What the client said
 - Category: in-scope revision / out-of-scope / cosmetic
 - Action: return to build / handle in review / change request]

## Revision Scope
[Summary of what goes back to build, if anything.]

## Approved for Handoff: [Yes / No - revision required]
```

## Done Looks Like
The client has reviewed the deliverables and either approved them for handoff or provided specific feedback that has been categorized and scoped for revision. There is no ambiguity about what is approved and what needs work.

## Layer Annotation
L2 stage contract. Build output is L4. Scope agreement and requirements are L4 (engagement-specific). Quality standards are L3 (stable across engagements).
