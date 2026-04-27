# Workflow: Client Delivery

## Overview
Four-stage engagement pipeline: Discovery → Build → Review → Handoff. Each stage has a client-facing checkpoint. The discovery stage is non-negotiable. Skipping it is the single most common cause of engagement failure.

## Stage Map

| Stage | Purpose | Key Inputs | Output Location | Client Checkpoint |
|---|---|---|---|---|
| 01_discovery | Understand the real problem | Client brief, interviews, existing systems | 01_discovery/output/ | Client validates requirements and scope |
| 02_build | Create the deliverable | Discovery output, references, domain material | 02_build/output/ | Progress updates as appropriate |
| 03_review | Internal then client review | Build output, quality standards, scope document | 03_review/output/ | Client reviews and provides feedback |
| 04_handoff | Deliver and transition | Reviewed deliverables, documentation | 04_handoff/output/ | Client accepts delivery and transition plan |

## How Stages Connect
- 01 → 02: Discovery produces a requirements document and scope agreement. Build works from this, not from the original client brief. The original brief is what they said. The requirements document is what they need. These are often different.
- 02 → 03: Build produces the deliverable. Review evaluates it first internally (against quality standards and scope), then with the client. Feedback from review either approves for handoff or returns to build with specific revision notes.
- 03 → 04: Review produces an approved deliverable. Handoff packages it with documentation and transition materials.
- 03 → 02 (loop): If client review produces revision requests, they go back to build as a scoped work item, not as a vague "make changes." The review stage should produce specific, actionable feedback.

## Reference Material
- _config/client-brief.md: The original client communication. Kept for reference but not used as the working specification after discovery is complete.
- _config/engagement-terms.md: Contract terms, timeline, budget, deliverable list.
- _config/scope-agreement.md: Produced in discovery. The working specification for the engagement.
- _references/: Domain frameworks, methodologies, prior work from similar engagements.

## When to Add Stages
- **01a_proposal** before discovery: If the engagement requires a formal proposal or SOW before discovery begins.
- **02a_prototype** within build: If the deliverable benefits from a prototype or proof-of-concept before full build.
- **05_support** after handoff: If the engagement includes ongoing support, maintenance, or advisory.
