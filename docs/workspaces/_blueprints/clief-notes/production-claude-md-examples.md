# Production CLAUDE.md Examples
## Five Real Use Cases — Pick the Closest One and Edit

Each example below is a complete, ready-to-use CLAUDE.md file. Copy the one closest to your situation, edit the details to match your work, and save it as `CLAUDE.md` in the root of your project folder. Claude Code reads it automatically.

These are based on real production setups. They are more detailed than the starter version from the free course. The structure, the routing tables, and the naming conventions are all patterns that have been tested across real workflows.

---
---

## Example 1: Solo Content Creator

For someone who writes, produces, and distributes content across multiple platforms. One person, multiple types of work.

```markdown
# Content Studio — [Your Name]

I create educational content about [YOUR TOPIC] for [YOUR AUDIENCE]. 
My primary platforms are YouTube (long-form), Instagram (short-form), 
and a newsletter ([frequency]).

## Workspaces

- /script-lab — Writing and ideation. Scripts, outlines, research notes.
- /production — Building. Animations, graphics, thumbnails, specs.
- /distribution — Publishing. Platform-specific versions, scheduling, analytics notes.

## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Write or brainstorm | /script-lab | CONTEXT.md | humanizer |
| Build animations or graphics | /production | CONTEXT.md | remotion |
| Publish or repurpose | /distribution | CONTEXT.md | — |
| Edit an existing script | /script-lab | CONTEXT.md + the specific draft | humanizer |

## Naming Conventions

- Scripts: topic-name_draft.md → topic-name_final.md
- Specs: topic-name_spec.md
- Animations: topic-name_scene-01.tsx (Claude handles this via Remotion)
- Published: YYYY-MM-DD_platform_topic.md
- Ideas: idea_short-description.md (stored in /script-lab/ideas/)

## Voice and Style

- Tone: Clear, direct, no hype. Explain with evidence and examples.
- Sentences: Short. Cut filler.
- Audience assumes: They are smart but new to this topic. Do not talk down. Do not assume jargon.
- Never: Start with "In today's world." Use "game-changing" or "revolutionary." Promise results without showing the work.

## Rules

- Read this file first on every new task.
- Do not create files outside the current workspace unless explicitly asked.
- When a script is finalized, move it from /script-lab/drafts/ to /script-lab/final/.
- Ask before deleting or overwriting any file.
```

---
---

## Example 2: Freelance Consultant (Multiple Clients)

For someone managing multiple client engagements with a consistent process across all of them.

```markdown
# Consulting Practice — [Your Name]

I am a [TYPE] consultant working with [TYPES OF CLIENTS]. 
Each client has a separate workspace. Shared templates and 
business development materials live in their own areas.

## Active Clients

- /clients/alpha — [Company name]. [One-line engagement description]. Phase: [current phase].
- /clients/beta — [Company name]. [One-line engagement description]. Phase: [current phase].
- /clients/gamma — [Company name]. [One-line engagement description]. Phase: [current phase].

## Internal

- /templates — Reusable proposals, reports, analysis frameworks, email templates.
- /business-dev — Pipeline tracking, outreach drafts, case studies.

## Routing

| Task | Go to | Read |
|------|-------|------|
| Work for Alpha | /clients/alpha | CONTEXT.md |
| Work for Beta | /clients/beta | CONTEXT.md |
| Work for Gamma | /clients/gamma | CONTEXT.md |
| New proposal | /templates then /clients/[name] | Both CONTEXT.md files |
| Outreach or pipeline | /business-dev | CONTEXT.md |
| Build a case study | /business-dev/case-studies | CONTEXT.md + relevant client folder (anonymized) |

## Critical Rules

- NEVER reference one client's information in another client's workspace.
- NEVER include client names or proprietary information in /business-dev materials without explicit permission.
- All proposals start from /templates and get customized in the client folder.
- Deliverables go in /clients/[name]/deliverables/. Drafts stay in working folders until approved.
- When in doubt about confidentiality, ask before proceeding.

## Naming Conventions

- Client deliverables: clientname_deliverable-type_v1.md
- Proposals: clientname_proposal_YYYY-MM.md
- Meeting notes: clientname_YYYY-MM-DD_meeting-topic.md
- Case studies: YYYY_industry_outcome-summary.md (anonymized)

## Process

1. Intake: Client fills out brief → stored in /clients/[name]/intake/
2. Scoping: Proposal built from /templates → customized in client folder
3. Delivery: Work happens in /clients/[name]/deliverables/
4. Follow-up: Summary and next steps in /clients/[name]/communications/

## My Positioning

- [2-3 sentences about who you serve, what you do differently, and your core methodology]
- Use this when drafting outreach, proposals, or case studies.
```

---
---

## Example 3: Software Developer (Single Product)

For a developer working on one application with a team or solo.

```markdown
# [App Name]

[One sentence: what the app does and who it is for.]

## Tech Stack

- Frontend: React 18 + TypeScript
- Backend: Express + Node.js
- Database: PostgreSQL
- Auth: [method]
- Deploy: [platform]
- CI: [tool]

## Workspaces

- /planning — Specs, architecture decisions, design docs
- /src — Application code
- /docs — API docs, user guides, changelog
- /ops — Deploy scripts, monitoring config, runbooks

## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Spec a feature | /planning | CONTEXT.md | — |
| Write application code | /src | CONTEXT.md | testing |
| Write documentation | /docs | CONTEXT.md | doc-authoring |
| Deploy or debug infra | /ops | CONTEXT.md | — |
| Review a PR | /src | CONTEXT.md + the specific files | testing |

## Commands

| Action | Command |
|--------|---------|
| Dev server | npm run dev |
| API server | npm run api |
| Run tests | npm test |
| Run specific test | npm test -- --grep "test name" |
| Build | npm run build |
| Lint | npm run lint |
| DB migrate | npm run db:migrate |

## Conventions

- Functional components only. No class components.
- Routes in /src/api/. One file per resource.
- All database queries go through /src/db/queries/. No raw SQL in route handlers.
- Tests live next to the code they test: feature.ts → feature.test.ts
- Decision records in /planning/decisions/: YYYY-MM-DD_decision-title.md
- Commits: conventional commits format (feat:, fix:, docs:, chore:)

## Avoid

- Do not use Moment.js. We use date-fns.
- Do not modify /src/db/migrations/ directly. Use the migration generator.
- Do not add new dependencies without checking if an existing one covers the need.
- Do not write code that requires environment variables not listed in .env.example.

## Architecture Notes

- [Any important patterns: event-driven, microservices, monolith, specific state management, etc.]
- [Any areas of the codebase that are fragile or under active refactor]
- [Any third-party integrations and their quirks]
```

---
---

## Example 4: Researcher / Academic Writer

For someone working on a paper, thesis, report, or long-form research project.

```markdown
# [Research Project Title]

[One sentence: the research question or thesis.]

## Workspaces

- /sources — Papers, articles, interview transcripts, raw data
- /analysis — Notes, themes, coded data, outlines
- /writing — Drafts, revisions, final manuscripts
- /admin — Submission guidelines, reviewer comments, correspondence

## Routing

| Task | Go to | Read |
|------|-------|------|
| Find or annotate a source | /sources | CONTEXT.md |
| Analyze data or develop themes | /analysis | CONTEXT.md |
| Write or revise | /writing | CONTEXT.md + /analysis/outlines/ |
| Handle submission logistics | /admin | CONTEXT.md |

## Naming Conventions

- Sources: authorlastname_year_shorttitle.pdf
- Notes: source-ref_notes.md (e.g., smith_2024_notes.md)
- Drafts: section-name_v1.md → section-name_v2.md → section-name_final.md
- Themes: theme_short-description.md

## Writing Standards

- Citation style: [APA / Chicago / IEEE / etc.]
- Voice: [First person plural "we" / passive / etc.]
- Audience: [Peer reviewers in X field / general academic / policy makers / etc.]
- Structure: [IMRaD / narrative / thematic / etc.]
- Avoid: [Specific writing habits to watch for — filler phrases, passive overuse, unsupported claims]

## Key Sources

- [Author, Year — one-line summary of why this source matters]
- [Author, Year — one-line summary]
- [Author, Year — one-line summary]

Claude should reference these sources by the naming convention above. When citing, use the correct citation style and verify the claim matches the source.

## Current Status

- [Which sections are drafted, which are in progress, which are not started]
- [Any deadlines]
- [Any reviewer feedback being addressed]
```

---
---

## Example 5: Small Business / Non-Technical Operations

For someone running a business who uses Claude for writing, planning, communications, and operational tasks. No code involved.

```markdown
# [Business Name] Operations

[One sentence: what the business does.]

## Workspaces

- /communications — Emails, newsletters, social posts, announcements
- /planning — Strategy docs, meeting notes, decision logs, quarterly plans
- /clients — Client folders with project details and correspondence
- /resources — SOPs, templates, brand guidelines, reference materials

## Routing

| Task | Go to | Read |
|------|-------|------|
| Write an email or post | /communications | CONTEXT.md + /resources/brand-guide.md |
| Plan or think through a decision | /planning | CONTEXT.md |
| Client-specific work | /clients/[name] | CONTEXT.md |
| Find a template or SOP | /resources | CONTEXT.md |

## Brand Voice

- Tone: [Warm and professional / Direct and casual / etc.]
- We say: [Phrases, values, or language that represents the brand]
- We never say: [Phrases, jargon, or language to avoid]
- Audience: [Who we are talking to and what they care about]

## Naming Conventions

- Emails: recipient_topic_YYYY-MM-DD.md
- Meeting notes: YYYY-MM-DD_meeting-topic.md
- SOPs: sop_process-name.md
- Client files: clientname_document-type.md

## Key Information

- Business address: [Address]
- Team: [Key people and their roles, if relevant for Claude to know]
- Tools we use: [CRM, email platform, scheduling tool, etc.]
- Current priorities: [Top 2-3 things the business is focused on right now]

## Rules

- All external communications must match the brand voice in /resources/brand-guide.md.
- Client information stays in /clients/[name]/. Never cross-reference between clients.
- When drafting anything public-facing, flag it for review before sending.
- Do not make up statistics, testimonials, or claims. If you are unsure about a fact, say so.
```

---
---

## How to Use These

1. Read through all five. Find the closest match.
2. Copy that example into a new file called `CLAUDE.md`.
3. Edit every bracketed field `[like this]` with your actual information.
4. Delete any sections that do not apply. Add sections specific to your work.
5. Save it in the root of your project folder.
6. Open Claude Code in that folder and start working.
7. Update the file whenever your project changes.

Your first version does not need to be perfect. A good CLAUDE.md that you edit over time beats a perfect one that you never start.
