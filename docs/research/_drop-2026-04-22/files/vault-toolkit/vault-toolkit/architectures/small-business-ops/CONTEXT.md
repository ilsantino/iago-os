# Workflow: Small Business Operations

## Overview
Three-stage pipeline: Intake → Process → Deliver. Designed for recurring work that follows a consistent pattern. The stages are generic by design. Rename them to match your domain. The structure stays the same.

## Stage Map

| Stage | Purpose | Inputs | Output Location |
|---|---|---|---|
| 01_intake | Receive, triage, and prioritize incoming work | Client request, email, form submission, verbal brief | 01_intake/output/ |
| 02_process | Execute the core work | Triaged work item from intake, reference material from _config/ | 02_process/output/ |
| 03_deliver | Review, package, and send to client | Completed work from process, delivery templates, client requirements | 03_deliver/output/ |

## How Stages Connect
- 01 → 02: Intake produces a structured work item with clear scope, priority, and requirements. Process picks that up and executes. If process needs to ask "what exactly does the client want?" then intake did not do its job.
- 02 → 03: Process produces the completed work. Deliver reviews it against quality standards, packages it in the appropriate format, and sends it. If deliver needs to redo significant portions, process needs tighter standards.

## Reference Material (in _config/)
- business-rules.md: Pricing, service tiers, turnaround commitments, scope boundaries. What you do and do not do.
- quality-standards.md: What "good" looks like for your deliverables. Specific enough to check against.
- client-context.md: Recurring client information. Preferences, history, contact details. Updated as clients evolve.

## Reference Material (in _templates/)
- Templates for common deliverables. Invoice, report, email, proposal. Whatever your business produces repeatedly.

## When to Add Stages
Common additions for specific business types:
- **02a_review** between process and deliver: If your work requires internal review before client delivery (peer review, manager approval, QA check).
- **01a_estimate** between intake and process: If you need to scope and price work before starting.
- **04_followup** after deliver: If your business includes follow-up, feedback collection, or ongoing support.

Add when you find yourself consistently doing that work informally. The stage makes it visible and repeatable.
