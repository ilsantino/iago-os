---
name: Remotion animation decision
description: LLM Council on 2026-04-21 rejected 4-week two-tier spec; only bare animation-studio workspace approved; expansion gated on trigger conditions
type: project
originSessionId: 645eae46-9803-4a9c-bda2-fd1955a7c88d
---
## Decision

iaGO adopts Remotion for programmatic video, but only at the minimum scope. 4 of 5 council advisors (Contrarian, First Principles, Outsider, Executor) rejected the full 4-week two-tier build. Only the Expansionist defended the full spec — unanimously flagged as blind spot in peer review.

**Why:** Zero client demand, licensing liability from scaffolding `packages/video/` into client repos without consent, and skills built before the workflow has been run once = cart-before-horse. 4 weeks = one billable client engagement of delivery capacity for a 3-person shop. Opportunity cost > speculative upside.

**How to apply:**
- When iaGO needs a video (marketing, deck, proposal asset): use `animation-studio/` workspace, render locally, drop into CapCut for finishing.
- When a client asks about video: answer scoping questions with the `remotion-animation` reference skill, but do NOT offer Remotion-based delivery until licensing is resolved in writing in the SOW.
- Do NOT build `/animation-spec`, `/animation-build`, `/animation-render` skills yet. Do NOT build `iago-video-scaffold` yet. Do NOT deploy Lambda yet.

## Trigger conditions for expansion

- **Build client scaffold:** signed SOW with video deliverable + internal workflow run 3+ times
- **Build custom workflow skills:** manually run Remotion-to-output 5+ times and can name exact friction
- **Go Lambda:** render latency or machine bottleneck is a real blocker on real work

## Artifact paths

- Spec (marked with verdict banner): `docs/specs/remotion-animation-workflow.md`
- Obsidian decision: `decisions/2026-04-21-remotion-animation-workflow.md`
- Reference skill (no automation, knowledge only): `.claude/skills/remotion-animation/SKILL.md`
