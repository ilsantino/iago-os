# Stage 03: Deliver

## Purpose
Review the completed work against quality standards, package it for the client, and deliver it. This stage is the quality gate. Nothing leaves without passing through here.

## Inputs
- **02_process/output/[deliverable]**: The completed work.
- **01_intake/output/work-item-[client]-[date].md**: The original work item. Used to verify that the deliverable matches what was scoped.
- **_config/quality-standards.md**: Final quality check.
- **_templates/** (if applicable): Delivery packaging templates (cover email, invoice, handoff document).

## Process
1. Read the completed deliverable.
2. Read the original work item. Compare: does the deliverable address everything in scope? Are the exclusions respected? Are open questions resolved?
3. Quality check against quality-standards.md. This is a fresh-eyes review, not a rubber stamp.
4. If issues found: document them and return to stage 02 with specific feedback. Do not fix the work in this stage. Fixing belongs in process. Reviewing belongs here.
5. If quality passes: package the deliverable using the appropriate template.
6. Prepare delivery communication (email, message, portal upload, whatever your delivery channel is).
7. Record the delivery in output.

## Output
Write to: 03_deliver/output/delivered-[client]-[date].md

```
# Delivery Record

Client: [Client]
Deliverable: [Name and description]
Work item reference: [filename from intake]
Quality check: Pass
Delivered via: [email / portal / in-person / etc.]
Delivered on: [date]

## Client Communication
[The delivery message. Email text, cover note, or summary of
what was communicated at handoff.]

## Follow-up Required
[None / description of any follow-up actions with dates]
```

## Done Looks Like
The client has the deliverable. A record exists of what was delivered, when, and how. Any follow-up actions are documented with dates.

## Common Failure Modes
- **Skipping the scope comparison.** The most common delivery complaint is not that the work is bad but that it does not match what was requested. Comparing against the work item catches this.
- **Fixing issues in this stage instead of sending back to process.** This creates invisible rework that is not captured in the process stage's output. If the process stage's output needs fixing, send it back. The fix should happen where the work happens.
- **Not recording the delivery.** If you do not log what was delivered, you have no record when the client says "that is not what I received" or when you need to reference past work for a new project.

## Layer Annotation
L2 stage contract. Completed deliverable and work item are L4. Quality standards and templates are L3.
