# Stage 01: Intake

## Purpose
Receive incoming work, extract the actual requirements, assign priority, and produce a structured work item that the process stage can execute from without ambiguity.

## Inputs
- **Client request**: Email, form submission, verbal brief, message, or any other format the request arrives in. Paste or reference it here.
- **_config/business-rules.md**: Scope boundaries and service tiers. Used to determine if the request is in scope and which service tier it falls under.
- **_config/client-context.md** (if recurring client): Previous work, preferences, known requirements.

## Process
1. Read the client request in full.
2. Extract: What is being asked for? What is the deadline? What is the budget or service tier? Are there unstated assumptions?
3. Check against business rules: Is this in scope? Does it fit a standard service tier or is it custom?
4. Identify what is missing. What questions need to be answered before work can begin? List them.
5. Assign priority based on deadline, client relationship, and complexity.
6. Produce the structured work item.

## Output
Write to: 01_intake/output/work-item-[client]-[date].md

Format:
```
# Work Item: [Short Description]

Client: [Name]
Date received: [Date]
Priority: [High / Medium / Low]
Service tier: [Standard / Custom / reference to business-rules.md]

## What They Asked For
[The request in their words. Direct quote or close paraphrase.]

## What They Actually Need
[Your interpretation. What is the real deliverable? This is where
experience and judgment matter. What they asked for and what they
need are often slightly different.]

## Scope
- Includes: [Explicit list of what is in scope]
- Excludes: [Explicit list of what is NOT in scope]
- Open questions: [Things that need to be clarified before work starts]

## Deadline
[Date and any flexibility noted]

## Notes
[Anything else relevant: client preferences, related past work, risks]
```

## Done Looks Like
A work item that the process stage can pick up and execute without needing to re-read the original client request or ask "what exactly should I do?" If the processor needs to contact the client for basic scope clarification, intake did not dig deep enough.

## Layer Annotation
L2 stage contract. Client request is L4 (this run). Business rules and client context from _config/ are L3 (stable reference).
