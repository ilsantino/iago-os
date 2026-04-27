# Small Business Operations Workspace

## What This Is
A workspace for managing recurring operational tasks in a small business. Intake, processing, and delivery of whatever your business does repeatedly. This architecture fits service businesses, agencies, freelancers, and small product teams where the same type of work comes in regularly and needs consistent handling.

## Current State
- This is a reference architecture. No active project.
- To use: copy the folder, edit _config files to match your business, rename stages if needed.

## Structure
```
small-business-ops/
  CLAUDE.md              # You are here.
  CONTEXT.md             # Workflow routing.
  01_intake/
    CONTEXT.md           # Stage contract: receiving and triaging new work.
    output/              # Triaged work items, ready for processing.
  02_process/
    CONTEXT.md           # Stage contract: doing the work.
    output/              # Completed work, ready for review.
  03_deliver/
    CONTEXT.md           # Stage contract: review, package, and deliver.
    output/              # Delivered items and records.
  _config/               # Business rules, templates, client info.
  _templates/            # Reusable output templates.
```

## How to Use
1. Read CONTEXT.md for the full workflow.
2. Populate _config/ with your business rules and client context.
3. New work enters through 01_intake. Every piece of incoming work gets triaged here.
4. Triaged work moves to 02_process. This is where the actual work happens.
5. Completed work moves to 03_deliver for review, packaging, and client delivery.

## Key Decisions
- **"Intake" not "receive."** Intake implies triage. The first stage does not just receive work; it evaluates, categorizes, and prioritizes it. If you skip triage, everything feels equally urgent and nothing gets done well.
- **"Process" is deliberately generic.** Your business's core work goes here. For a design agency, this is the design stage. For a consultant, this is the analysis stage. For a repair shop, this is the repair stage. Rename it to match your domain. The architecture does not change.
- **"Deliver" includes review.** The final stage is not just sending the work out. It includes a quality check against the standards in _config/. This prevents the common failure of rushing delivery because the work is "done."
- **_templates/ is separate from _config/.** Templates are output structures (invoice format, report skeleton, email template). Config is business logic (pricing rules, client requirements, quality standards). They change at different rates and for different reasons.

## Layer Annotations
- CLAUDE.md: L0 (always loaded, orientation)
- CONTEXT.md: L1 (workflow routing)
- Stage CONTEXT.md files: L2 (stage contracts)
- _config/ files: L3 (reference material, business rules)
- _templates/ files: L3 (reference material, output structures)
- Incoming work and stage outputs: L4 (working artifacts)
