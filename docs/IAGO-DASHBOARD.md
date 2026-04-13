# iaGO Dashboard — Vision Document

> Status: NOT STARTED — post v0.1.0
> This document exists so Claude Code understands the product roadmap.
> Do not build any of this until iaGO-OS config layer is stable and in
> use on real client projects.

---

## What it is

iaGO Dashboard is a separate product — a web application that makes
iaGO-OS visible and interactive. The config layer (hooks, skills, agents,
workflow engine) runs inside Claude Code sessions. The dashboard surfaces
that activity as a real-time UI.

iaGO-OS is the engine. iaGO Dashboard is the cockpit.

---

## Why it exists

Running an AI consultancy on Claude Code means most of what's happening
is invisible — tasks dispatched, agents working, state written to .iago/.
The dashboard makes the system observable and controllable without
opening a terminal.

---

## Core capabilities (in priority order)

### 1. Agent structure visualization

- Which agents exist in iaGO-OS (from .claude/agents/)
- Their roles, models, and relationships (hub-and-spoke topology)
- Which agents are active in the current session

### 2. Task distribution view

- What tasks are in flight across projects
- Which agent is handling what
- State transitions: discuss → plan → execute → verify

### 3. Project state dashboard

- All active client projects with their .iago/STATE.md surfaced as cards
- Current phase, last activity, open decisions
- Quick jump into the relevant Claude Code session

### 4. Command interface

- Trigger iaGO-OS skills from UI (equivalent to typing /iago:init in terminal)
- Works by writing to a watched file that hooks pick up — no separate
  backend required for v1

### 5. Audit log

- What happened in each session (from .iago/summaries/)
- Which agents were invoked, what was produced, what was committed

---

## Tech stack

Same as all iaGO products:
- Frontend: React 19 + Vite + TypeScript strict + TailwindCSS 4 + ShadCN/UI
- Backend: AWS (Amplify Gen 2, API Gateway, DynamoDB, Cognito, Lambda)
- Real-time: DynamoDB Streams → Lambda → WebSocket API Gateway

---

## What it is NOT

- Not a replacement for Claude Code — you still build inside Claude Code
- Not a chat interface — that's Claude.ai
- Not a Paperclip clone — inspired by Paperclip's vision but built
  from scratch as iaGO proprietary IP
- Not a multi-tenant SaaS yet — v1 is internal tooling for the 3-person
  iaGO team only

---

## Prerequisites before building

1. iaGO-OS config layer stable and used on 2+ real client projects
2. Real usage data — which skills get triggered most, what state is
   actually useful to surface, how agents actually distribute work
3. At least 2 weeks of running the workflow engine in production

Do not design the dashboard in the abstract. Let real usage define
what needs to be visible.

---

## Data pipeline

The usage-tracker hook (Phase 5A) writes JSONL to `.iago/state/usage-log.jsonl`.
When the dashboard is built, this data feeds into DynamoDB via:

```
usage-log.jsonl → sync script → DynamoDB → Streams → Lambda → WebSocket → UI
```

The JSONL schema is designed to be forward-compatible with DynamoDB items.

---

## Entry point when ready

Start with `docs/ARCHITECTURE.md` and `.claude/rules/available-skills.md` in iaGO-OS —
the dashboard is a UI layer on top of what's already documented there.

First prompt to Claude Code when starting: read those two docs plus
research/CHERRY-PICK-PLAN.md §10 to understand the full system
before designing any component.
