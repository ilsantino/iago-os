# Workflow Starter: Client Management

For freelancers, consultants, and agencies managing multiple clients. Download the structure, edit the context files, duplicate the client folder for each new engagement.

---

## Folder Structure

```
consulting-practice/
├── CLAUDE.md
├── clients/
│   ├── client-template/
│   │   ├── CONTEXT.md
│   │   ├── intake/
│   │   ├── deliverables/
│   │   └── communications/
│   ├── [client-name-1]/
│   │   ├── CONTEXT.md
│   │   ├── intake/
│   │   ├── deliverables/
│   │   └── communications/
│   └── [client-name-2]/
│       ├── CONTEXT.md
│       ├── intake/
│       ├── deliverables/
│       └── communications/
├── templates/
│   ├── CONTEXT.md
│   ├── proposals/
│   ├── reports/
│   └── emails/
└── business-dev/
    ├── CONTEXT.md
    ├── pipeline/
    ├── outreach/
    └── case-studies/
```

**To onboard a new client:** Copy the `/clients/client-template/` folder, rename it, fill in the CONTEXT.md, and add one row to the routing table in CLAUDE.md.

---

## CLAUDE.md

```markdown
# Consulting Practice — [Your Name]

[One sentence: what you do and who you serve.]

## Active Clients

- /clients/[client-1] — [Company]. [Engagement type]. Phase: [current phase].
- /clients/[client-2] — [Company]. [Engagement type]. Phase: [current phase].

## Internal

- /templates — Reusable proposals, reports, email templates.
- /business-dev — Pipeline, outreach, case studies.

## Routing

| Task | Go to | Read |
|------|-------|------|
| Work for [Client 1] | /clients/[client-1] | CONTEXT.md |
| Work for [Client 2] | /clients/[client-2] | CONTEXT.md |
| Build a new proposal | /templates then /clients/[name] | Both CONTEXT.md files |
| Draft outreach | /business-dev | CONTEXT.md |
| Write a case study | /business-dev/case-studies | CONTEXT.md |

## Critical Rules

- NEVER reference one client's information in another client's workspace.
- All proposals start from /templates/ and get customized in the client folder.
- Deliverables go in /clients/[name]/deliverables/. Drafts stay until approved.
- When unsure about confidentiality, ask before proceeding.

## Naming Conventions

- Proposals: clientname_proposal_YYYY-MM.md
- Deliverables: clientname_deliverable-type_v1.md
- Meeting notes: clientname_YYYY-MM-DD_topic.md
- Emails: clientname_recipient_topic.md
- Case studies: YYYY_industry_outcome-summary.md (always anonymized)
```

---

## clients/client-template/CONTEXT.md

Copy this for each new client. Fill in the brackets.

```markdown
# [Client Name]

## Engagement

- Company: [Full company name]
- Contact: [Primary contact name and role]
- Engagement type: [Consulting, training, build, audit, etc.]
- Start date: [Date]
- Current phase: [Intake / Active / Delivery / Follow-up]

## What we are doing

[2-3 sentences describing the engagement, the problem, and the expected outcome.]

## What good looks like

[What does a successful deliverable look like for this client? What are their standards?]

## Client-specific rules

- Tone: [How this client communicates — formal, casual, technical, etc.]
- Terminology: [Any terms this client uses that differ from standard language]
- Sensitivities: [Topics to avoid, political considerations, past issues]
- Review process: [Who reviews, how many rounds, what format they expect]

## Key documents in this folder

- /intake/ — [Brief, signed agreement, initial notes]
- /deliverables/ — [List current deliverables and their status]
- /communications/ — [Meeting notes, email drafts, status updates]

## What Claude should know

[Anything else relevant to this engagement that does not fit above. 
Client's business model, industry context, competitive landscape, 
previous work they have done with others, etc.]
```

---

## templates/CONTEXT.md

```markdown
# Templates

Reusable frameworks for proposals, reports, and communications. 
These are starting points. Every template gets customized for the specific client.

## How to use

1. Find the relevant template in the subfolder.
2. Copy it to the client's workspace.
3. Customize based on the client's CONTEXT.md.
4. Never modify the original template. Always work from a copy.

## Available templates

### Proposals (/proposals/)
- standard-proposal.md — [Describe the standard structure]
- quick-proposal.md — [Shorter version for smaller engagements]

### Reports (/reports/)
- progress-report.md — [Monthly/weekly progress format]
- final-report.md — [End-of-engagement summary format]

### Emails (/emails/)
- kickoff-email.md — [Initial engagement kickoff]
- status-update.md — [Regular status update format]
- follow-up.md — [Post-engagement follow-up]
```

---

## business-dev/CONTEXT.md

```markdown
# Business Development

Pipeline, outreach, and case studies. This is the internal workspace 
for growing the practice.

## Ideal client

- Industry: [Target industries]
- Size: [Company size, team size, revenue range]
- Problem: [The problem they have that you solve]
- Signal: [How you know they are ready — triggers, events, behaviors]

## My positioning

[2-3 sentences: what you do differently from others in your space. 
Your methodology, your background, your unique angle.]

## Outreach approach

- Channel: [Email, LinkedIn, referrals, events, etc.]
- Tone: [How outreach should sound — understated, direct, consultative, etc.]
- Volume: [How many touchpoints per week/month]
- Follow-up: [Cadence and approach for follow-ups]

## Pipeline stages

1. Lead identified → logged in /pipeline/
2. Outreach sent → draft in /outreach/
3. Conversation started → notes in /pipeline/
4. Proposal sent → copy in /pipeline/ and /clients/[name]/
5. Engaged → client folder created, pipeline entry marked won

## Case studies

- Anonymized by default. Client name removed unless permission granted.
- Format: situation, approach, result, takeaway.
- Stored in /case-studies/ with naming: YYYY_industry_outcome.md
```
