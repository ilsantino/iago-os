# Stage 02: Process

## Purpose
Execute the core work defined in the intake work item. This stage is intentionally generic because "the work" varies by business. A consultant writes an analysis. A designer creates a mockup. A bookkeeper reconciles accounts. Rename this stage and customize the process steps to match your domain.

## Inputs
- **01_intake/output/work-item-[client]-[date].md**: The structured work item. This defines scope, requirements, and deliverable.
- **_config/quality-standards.md**: What "good" looks like. Check the deliverable against this before marking complete.
- **_config/client-context.md** (if applicable): Client preferences and history.
- **_templates/** (if applicable): Output templates for standard deliverables.
- **Domain-specific reference material**: Whatever your work requires. Manuals, specs, datasets, prior work. Load only what this specific work item needs.

## Process
1. Read the work item. Confirm scope is clear and all open questions have been resolved. If open questions remain, resolve them before proceeding.
2. Select the appropriate template from _templates/ if one exists. If not, structure the deliverable based on the quality standards.
3. Execute the work. [This is where your domain expertise goes. Replace this line with your actual process steps.]
4. Self-review against quality-standards.md. Does the deliverable meet the standards? Fix anything that does not.
5. Write completed work to output.

## Output
Write to: 02_process/output/[deliverable-name]-[client]-[date].[format]

The format depends on your business. Document, spreadsheet, design file, report, email draft. Whatever the deliverable is.

Include a brief cover note:
```
# Deliverable: [Name]
Client: [Client]
Work item reference: [filename from intake]
Status: Complete / Partial (note what remains)
Quality check: Pass / [list unresolved items]
```

## Done Looks Like
A deliverable that meets the quality standards and fulfills the scope defined in the work item. The deliver stage should only need to package and send it, not fix it.

## Common Failure Modes
- **Scope creep during execution.** The work item defines scope. If you discover the client needs more than what is scoped, that is a new intake item, not an expansion of this one.
- **Skipping the quality self-review.** The fastest path to client complaints is delivering work that does not meet your own standards. Check before you declare done.
- **Loading too much reference material.** Only load what this specific work item needs. A clean context produces better work than a comprehensive but noisy one.

## Layer Annotation
L2 stage contract. Work item from intake is L4. Quality standards, client context, and templates from _config/ and _templates/ are L3. Domain reference material is L3 or L4 depending on whether it is stable across projects or specific to this one.
