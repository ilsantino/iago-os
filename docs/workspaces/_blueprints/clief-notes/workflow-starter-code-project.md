# Workflow Starter: Code Project

For developers building an application. Download the structure, fill in your tech stack and conventions, and Claude Code immediately writes code that fits your project.

---

## Folder Structure

```
my-app/
├── CLAUDE.md
├── planning/
│   ├── CONTEXT.md
│   ├── specs/
│   ├── architecture/
│   └── decisions/
├── src/
│   ├── CONTEXT.md
│   └── [your application code]
├── docs/
│   ├── CONTEXT.md
│   ├── api/
│   ├── guides/
│   └── changelog.md
└── ops/
    ├── CONTEXT.md
    ├── deploy/
    ├── monitoring/
    └── scripts/
```

---

## CLAUDE.md

```markdown
# [App Name]

[One sentence: what this app does and who uses it.]

## Tech Stack

- Language: [TypeScript, Python, Go, etc.]
- Frontend: [React, Vue, Svelte, none, etc.]
- Backend: [Express, FastAPI, Django, etc.]
- Database: [PostgreSQL, MongoDB, SQLite, etc.]
- Auth: [Method — JWT, OAuth, session, etc.]
- Deploy: [Platform — Vercel, AWS, Railway, etc.]
- CI/CD: [Tool — GitHub Actions, CircleCI, etc.]

## Workspaces

- /planning — Feature specs, architecture docs, decision records
- /src — Application code
- /docs — API documentation, user guides, changelog
- /ops — Deploy scripts, monitoring, operational runbooks

## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Spec a feature | /planning | CONTEXT.md | — |
| Write code | /src | CONTEXT.md | testing |
| Write docs | /docs | CONTEXT.md | doc-authoring |
| Deploy or debug | /ops | CONTEXT.md | — |
| Review code | /src | CONTEXT.md + specific files | testing |
| Record a decision | /planning/decisions | CONTEXT.md | — |

## Commands

| Action | Command |
|--------|---------|
| Dev server | [your command] |
| API server | [your command] |
| Run all tests | [your command] |
| Run single test | [your command] |
| Build | [your command] |
| Lint | [your command] |
| DB migrate | [your command] |
| DB seed | [your command] |

## Conventions

- [Component style: functional only, class-based, etc.]
- [File organization: routes in X, queries in Y, utils in Z]
- [Naming: PascalCase for components, camelCase for functions, kebab-case for files, etc.]
- [Testing: tests next to code (feature.test.ts) or in /tests/ mirror]
- [Commits: conventional commits (feat:, fix:, docs:, chore:)]
- [Decision records: /planning/decisions/YYYY-MM-DD_title.md]

## Avoid

- [Libraries to not use and why]
- [Patterns to not follow and why]
- [Files or directories to not modify directly]
- [Anti-patterns specific to your codebase]

## Current State

- [What is working, what is in progress, what is broken]
- [Any active refactors or migrations]
- [Known tech debt and where it lives]
```

---

## planning/CONTEXT.md

```markdown
# Planning

Feature specs, architecture documents, and decision records.

## How specs work here

A spec describes WHAT to build and WHY, not HOW to build it. 
Claude reads the spec and makes implementation decisions based 
on the conventions in /src/CONTEXT.md.

## Spec template

When writing a new spec, follow this structure:

### [Feature Name]

**Problem:** What is the user problem this solves?
**Proposal:** What are we building?
**Scope:** What is included? What is explicitly excluded?
**Dependencies:** What does this touch? What needs to exist first?
**Open questions:** What is not decided yet?

## Architecture

Key architecture documents live in /architecture/. 
Reference these when building new features to maintain consistency.

## Decision records

When we make a significant technical decision, record it in /decisions/.
Format: YYYY-MM-DD_decision-title.md

### Decision record template

**Decision:** [What we decided]
**Context:** [Why this came up]
**Options considered:** [What else we looked at]
**Rationale:** [Why we chose this option]
**Consequences:** [What this means going forward]
```

---

## src/CONTEXT.md

```markdown
# Source Code

The application codebase.

## Structure

```
src/
├── components/    — [UI components]
├── services/      — [Business logic, API calls]
├── utils/         — [Shared utilities and helpers]
├── db/            — [Database queries and migrations]
├── api/           — [Route handlers / endpoints]
├── middleware/     — [Auth, logging, error handling]
├── types/         — [TypeScript types and interfaces]
└── tests/         — [Test utilities and fixtures]
```

## Patterns we follow

- [State management approach]
- [Error handling approach]
- [Logging approach]
- [How API responses are structured]
- [How database queries are organized]

## Patterns we avoid

- [List specific anti-patterns with brief reasons]

## Testing requirements

- [Minimum coverage expectations]
- [What must have tests (API routes, business logic, etc.)]
- [What does not need tests (pure UI layout, config files, etc.)]
- [How to write a test: framework, assertion style, mock approach]

## Environment

- Required env vars are listed in .env.example
- Do not hardcode values that should be environment variables
- [Any other environment-specific notes]
```

---

## docs/CONTEXT.md

```markdown
# Documentation

API docs, user guides, and the changelog.

## Audiences

- /api/ — For developers integrating with the API
- /guides/ — For end users of the application
- changelog.md — For anyone tracking what changed and when

## Standards

- API docs: [Format — OpenAPI, markdown, auto-generated, etc.]
- User guides: [Tone — step-by-step, reference, tutorial, etc.]
- Changelog: Keep a running log. Format: YYYY-MM-DD, what changed, why.

## Rules

- Every new API endpoint gets documented before merge.
- User guides update when user-facing behavior changes.
- Changelog updates with every release or significant change.
```

---

## ops/CONTEXT.md

```markdown
# Operations

Deploy scripts, monitoring configuration, and operational runbooks.

## Infrastructure

- Hosting: [Platform and tier]
- Database: [Managed/self-hosted, provider, backup schedule]
- CDN: [If applicable]
- Domain: [Domain and DNS provider]

## Deploy process

[Step by step: how code goes from merged PR to production. 
Include any manual steps, approval gates, or staging environments.]

## Monitoring

- [What is monitored: uptime, errors, performance, etc.]
- [Where alerts go: email, Slack, PagerDuty, etc.]
- [What triggers an alert vs what is logged quietly]

## Runbooks

Store runbooks in /scripts/ for common operational tasks:
- How to rollback a deploy
- How to reset a stuck job
- How to restore from backup
- How to investigate a performance issue

## Rules

- Do not deploy on Fridays. [Or whatever your deploy rules are.]
- All deploy scripts must be idempotent (safe to run twice).
- [Any other operational rules]
```
