# Stage 04: Handoff

## Purpose
Deliver the final approved deliverables and ensure the client can operate independently. Handoff is not just file transfer. It includes documentation, knowledge transfer, and transition planning. The goal is that the client never needs to call you to ask "how does this work?"

## Inputs
- **03_review/output/**: Approved deliverables and review documentation.
- **_config/scope-agreement.md**: For final verification that all deliverables are accounted for.
- **_config/engagement-terms.md**: For any handoff-specific terms (training sessions, support period, warranty).

## Process
1. Compile final deliverables. Ensure all approved versions are collected (not draft versions).
2. Create handoff documentation: what was built, how it works, how to maintain it, known limitations, where to go for help.
3. Create a transition plan if applicable: who takes over what, training schedule, support period.
4. Package everything in a format the client can navigate. Think about the client opening this package six months from now. Would they understand it?
5. Deliver to client via agreed channel.
6. Conduct knowledge transfer session if included in scope.
7. Archive the engagement workspace for future reference.

## Output
Write to: 04_handoff/output/

**handoff-package/** (folder or zip containing):
- All final deliverables
- handoff-documentation.md
- transition-plan.md (if applicable)

**handoff-documentation.md:**
```
# Handoff Documentation: [Engagement Name]

## What Was Delivered
[List of all deliverables with brief descriptions.]

## How It Works
[For each deliverable or system: plain-language explanation of
what it does, how to use it, and how to maintain it. Write for
the person who will be using this daily, not for the person who
built it.]

## Known Limitations
[What the deliverable does NOT do. Edge cases. Things the client
should be aware of.]

## Maintenance
[What needs to happen to keep this working. Updates, renewals,
checks, refreshes. With frequency and responsible party.]

## Getting Help
[Where to go if something breaks or if they need changes.
Your support contact if applicable, or their internal resources.]
```

**engagement-record.md:**
```
# Engagement Record: [Engagement Name]

Client: [Name]
Duration: [Start date - End date]
Deliverables: [List]
Key decisions: [Major decisions made during the engagement and why]
Lessons learned: [What would you do differently next time?]
Follow-up: [Any pending items, future opportunities, support commitments]
```

## Done Looks Like
The client has all deliverables, documentation, and transition materials. They can operate independently. You have an engagement record that captures the knowledge from this project for future reference.

## Common Failure Modes
- **Delivering files without documentation.** The files are the deliverable. The documentation is what makes them useful six months later. Without it, the client calls you every time they need to make a change.
- **Writing documentation for yourself instead of the client.** Technical documentation uses your vocabulary and assumptions. Client documentation uses theirs. Write for the reader, not the writer.
- **Skipping the engagement record.** This is for you and your team, not the client. It captures lessons learned and institutional knowledge. Without it, the next similar engagement starts from scratch instead of building on what you learned.

## Layer Annotation
L2 stage contract. Approved deliverables from review are L4. Scope agreement and engagement terms from _config/ are L3.
