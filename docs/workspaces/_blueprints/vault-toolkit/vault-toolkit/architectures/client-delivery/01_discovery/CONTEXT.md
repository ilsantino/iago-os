# Stage 01: Discovery

## Purpose
Understand the client's actual problem, not just what they asked for. Produce a requirements document and scope agreement that the build stage can work from. This stage is the foundation of the entire engagement. Time invested here saves multiples in build and review.

## Inputs
- **_config/client-brief.md**: The original client communication.
- **_config/engagement-terms.md**: Contract terms, timeline, budget.
- **Client interviews, meetings, or additional materials**: Paste transcripts or notes here.
- **_references/** (selectively): Prior work from similar engagements, relevant domain frameworks.

## Process
1. Read the client brief and engagement terms.
2. Identify the stated problem (what they said) and hypothesize the actual problem (what is likely going on beneath the stated request).
3. List what you know, what you assume, and what you need to find out. This three-column analysis is the backbone of discovery.
4. Prepare discovery questions for the client. Focus on: what does success look like? What have they tried? What constraints exist that they have not mentioned?
5. Conduct discovery conversations (interviews, workshops, document review).
6. Synthesize findings into a requirements document.
7. Draft the scope agreement: what will be delivered, what will not, timeline, milestones, review points.
8. Get client validation on the scope agreement before proceeding.

## Output
Write to: 01_discovery/output/

Two files:

**requirements.md:**
```
# Requirements: [Engagement Name]

## Stated Problem
[What the client said they need, in their words.]

## Actual Problem
[Your assessment of the underlying problem. What discovery revealed.]

## Requirements
[Numbered list of specific, testable requirements. Each one should
be verifiable: you can point at the deliverable and say "this
requirement is met" or "this requirement is not met."]

## Constraints
[Technical constraints, budget constraints, timeline constraints,
organizational constraints. Things that limit how the solution
can be built.]

## Assumptions
[What you are assuming to be true. Make these explicit. If an
assumption turns out to be wrong, it changes the scope.]

## Open Risks
[Things that could derail the engagement. Client availability,
data access, organizational change, technical uncertainty.]
```

**scope-agreement.md:**
```
# Scope Agreement: [Engagement Name]

## Deliverables
[Explicit list of what will be delivered, with acceptance criteria.]

## Exclusions
[What is NOT included. Be specific. This prevents scope creep.]

## Timeline
[Milestones with dates. Include review checkpoints.]

## Review Process
[How and when the client reviews work. What constitutes approval.
What the revision process looks like.]

## Change Process
[How scope changes are handled. What triggers a change request
versus what is absorbed within the existing scope.]
```

Also copy the scope agreement to _config/scope-agreement.md so all subsequent stages can reference it.

## Done Looks Like
The client has reviewed and validated the scope agreement. The requirements document captures not just what the client asked for but what discovery revealed about their actual needs. Build can start without ambiguity about what "done" means.

## Layer Annotation
L2 stage contract. Client brief and engagement terms from _config/ are L3. Client interview materials are L4. Prior work from _references/ is L3.
