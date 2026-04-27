# Stage 02: Build

## Purpose
Create the deliverables defined in the scope agreement. Work from the requirements document, not from the original client brief. The discovery stage already did the translation from "what they said" to "what they need."

## Inputs
- **_config/scope-agreement.md**: The working specification. What to build, acceptance criteria, exclusions.
- **01_discovery/output/requirements.md**: Detailed requirements and constraints.
- **_references/** (selectively): Domain frameworks, methodologies, prior work relevant to this build.
- **Domain-specific materials**: Data, systems access, content, or other materials needed for the build.

## Process
1. Read scope agreement and requirements. Confirm understanding of each deliverable and its acceptance criteria.
2. Plan the build. If multiple deliverables, determine order and dependencies. If a single complex deliverable, break it into components.
3. Execute. [Domain-specific. Replace with your actual build process.]
4. Self-check each deliverable against its acceptance criteria from the scope agreement.
5. Self-check against requirements. Every numbered requirement should be addressed.
6. Write output.

## Output
Write to: 02_build/output/

Deliverable files in whatever format the engagement requires, plus a build summary:

```
# Build Summary: [Engagement Name]

## Deliverables Completed
[List each deliverable with status: complete / partial / blocked]

## Requirements Coverage
[For each requirement in requirements.md: met / not met / partially met.
 If not fully met, explain why and what would be needed.]

## Known Issues
[Anything the review stage should pay special attention to.
 Areas of uncertainty, trade-offs made, items that need client input.]

## Assumptions Validated
[Which assumptions from discovery were confirmed or contradicted
 during build. If any were wrong, note the impact.]
```

## Done Looks Like
All deliverables defined in the scope agreement are complete and pass self-review against acceptance criteria. The build summary documents coverage and flags issues. Ready for review.

## Common Failure Modes
- **Building from the client brief instead of the requirements.** The brief is what they asked for. The requirements are what discovery determined they need. Build from requirements.
- **Scope creep during build.** If you discover the client needs more than what is scoped, that is a change request. Document it, discuss it with the client, amend the scope. Do not silently expand the build.
- **Perfectionism that delays delivery.** Build to the acceptance criteria. Not beyond. If the criteria say "functional prototype," do not deliver a production-ready system. Save polish for where it is specified.

## Layer Annotation
L2 stage contract. Scope agreement and requirements from discovery are L4 (specific to this engagement, though the scope agreement is also in _config/ for convenience). Domain references are L3.
