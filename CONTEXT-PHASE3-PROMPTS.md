# Phase 3 Prompts — Copy-paste into fresh conversations

---

## Phase 3A: Remaining Workflow + Proprietary Skills (7 skills)

```
# iaGO-OS — Phase 3A: Remaining Workflow + Proprietary Skills

## Context
- Repo root: C:\Users\sanal\dev\iago-os
- .claude/skills/ — 6 workflow skills already built (read iago-init and iago-quick for format)
- .claude/agents/ — 11 agents already built
- research/ — READ ONLY, never modify

## Before you write a single file, read:
1. HANDOFF.md — understand current state
2. CLAUDE.md — stack constraints
3. research/CHERRY-PICK-PLAN.md §4a — iago-fast and iago-pause specs
4. research/DECISION-workflow.md §7 (Quick/Fast modes) and §8 (Pause/Resume)
5. research/DECISION-conventions.md line ~251 — proprietary skill names
6. .claude/skills/iago-quick/SKILL.md — match format exactly

## What you're building (7 skills)

### Remaining workflow (specs exist):
1. .claude/skills/iago-fast/SKILL.md — from §7 fast mode spec
2. .claude/skills/iago-pause/SKILL.md — from §8 pause/resume spec + HANDOFF.json schema

### Proprietary (NO specs in research — derive from stack + context):
3. .claude/skills/iago-scaffold/SKILL.md — Scaffold new client project:
   copy templates/client-project/, configure stack, init git, wire Amplify,
   run state-manager init(). This is the SETUP skill for new client engagements.
4. .claude/skills/iago-proposal/SKILL.md — Generate client proposal:
   scope, timeline, cost estimate, tech approach, deliverables. Dispatches
   content-writer agent. Output to docs/proposals/.
5. .claude/skills/iago-onboard/SKILL.md — Scan existing codebase, produce
   architecture map, identify patterns/tech debt, populate PROJECT.md.
   Dispatches researcher agent. Replaces ECC codebase-onboarding + repo-scan.
6. .claude/skills/iago-n8n/SKILL.md — Design n8n automation workflows for
   client projects. Webhook patterns, Lambda triggers, DynamoDB events.
7. .claude/skills/iago-agents/SKILL.md — Design multi-agent architectures
   using Claude SDK + LangGraph for client deliverables. Patterns, tool
   design, orchestration strategies.

Create skill directories for #3-7 (they don't exist yet).

## Validation checklist
- [ ] All 7 SKILL.md files exist
- [ ] iago-fast explicitly states <=3 files, no agents, inline execution
- [ ] iago-pause writes HANDOFF.json matching schema in DECISION-workflow.md §8
- [ ] Proprietary skills reference correct agents (content-writer, researcher, etc.)
- [ ] Stack references match CLAUDE.md
- [ ] No files modified under research/

git add -A && git commit -m "feat(skills): iago-fast, iago-pause, and 5 proprietary skills"
```

---

## Phase 3B: Core Feature Skills (6 skills)

```
# iaGO-OS — Phase 3B: Core Feature Skills

## Context
- Repo root: C:\Users\sanal\dev\iago-os
- .claude/skills/ — workflow + proprietary skills already built
- research/ — READ ONLY, never modify

## Before you write a single file, read:
1. HANDOFF.md — current state
2. CLAUDE.md — stack constraints
3. research/DECISION-skills.md — read Core Skills section IN FULL
   (entries #4 brainstorming, #5 writing-plans, #6 subagent-driven-development,
   #7 code-review, #9 deep-research, #10 prompt-optimizer)
   Note: #1-3 (verification, tdd, systematic-debugging) are already rules/CLAUDE.md.
   Note: #8 (search-first) is already a CLAUDE.md rule.
   Note: #11-12 (e2e-testing, mcp-server-patterns) are already rules.
4. .claude/skills/iago-init/SKILL.md — match format exactly

## What you're building (6 skills)

Build every SKILL.md skill from DECISION-skills.md Core Skills that isn't
already a rule or CLAUDE.md entry. No additions, no omissions.

1. .claude/skills/brainstorming/SKILL.md (~50 lines)
   - Socratic design exploration, writes spec to docs/specs/
   - Add "PoC-first" constraint — specs identify 4-week delivery path
   - Absorbs ECC product-lens
2. .claude/skills/writing-plans/SKILL.md (~45 lines)
   - Break approved spec into 2-5 min tasks with verify commands
   - Tasks target OUR stack (React 19 + Vite + AWS Amplify)
   - Add GSD wave/dependency metadata
3. .claude/skills/subagent-driven-development/SKILL.md (~60 lines)
   - Execute plans with fresh implementer per task
   - Escalation protocol: DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED
   - Default single-pass review, opt-in two-stage
   - Dispatches: implementer, code-reviewer (or spec-reviewer + code-quality-reviewer)
4. .claude/skills/code-review/SKILL.md (~40 lines)
   - Dispatch code-reviewer with git SHA range
   - Severity: Critical/Important/Minor
   - Anti-performative-agreement, YAGNI check
5. .claude/skills/deep-research/SKILL.md (~35 lines)
   - Multi-source research: codebase + context7 + web
   - Must conclude with actionable recommendation
   - Dispatches: researcher agent
6. .claude/skills/prompt-optimizer/SKILL.md (~30 lines)
   - Optimize Claude SDK prompts for client deliverables
   - Cost-awareness: prefer Haiku/Sonnet before Opus

Each skill must:
- Have YAML frontmatter with name + description (CSO trigger format)
- Be adapted to OUR stack (not generic)
- Reference correct agents where applicable
- Include 2-3 real examples or scenarios
- Credit source repo in a comment

## Validation checklist
- [ ] All 6 SKILL.md files exist
- [ ] Count = 6 (no extras)
- [ ] Every agent reference points to an agent that exists in .claude/agents/
- [ ] Stack references match CLAUDE.md (React 19, Vite, TS strict, TailwindCSS 4, ShadCN/UI, AWS)
- [ ] No files modified under research/

git add -A && git commit -m "feat(skills): core feature skills (brainstorming, writing-plans, sdd, code-review, deep-research, prompt-optimizer)"
```

---

## Phase 3C: Content/Business + Experimental Skills (13 skills)

```
# iaGO-OS — Phase 3C: Content/Business + Experimental Skills

## Context
- Repo root: C:\Users\sanal\dev\iago-os
- .claude/skills/ — workflow + proprietary + core skills already built
- .claude/agents/ — 11 agents (content-writer handles content skills)
- research/ — READ ONLY, never modify

## Before you write a single file, read:
1. HANDOFF.md — current state
2. CLAUDE.md — stack constraints
3. research/DECISION-skills.md — read Content/Business Skills (C1-C7) and
   Experimental/Agentic Skills (E1-E6) sections IN FULL
4. One already-built skill — match format exactly

## What you're building (13 skills)

### Content/Business (7 skills, from DECISION-skills.md C1-C7):
1. .claude/skills/article-writing/SKILL.md (~30 lines)
2. .claude/skills/content-engine/SKILL.md (~35 lines)
3. .claude/skills/investor-materials/SKILL.md (~30 lines)
4. .claude/skills/investor-outreach/SKILL.md (~25 lines)
5. .claude/skills/market-research/SKILL.md (~30 lines)
6. .claude/skills/visa-doc-translate/SKILL.md (~25 lines)
7. .claude/skills/frontend-slides/SKILL.md (~30 lines)

### Experimental (6 skills, from DECISION-skills.md E1-E6):
8. .claude/skills/autonomous-loops/SKILL.md (~35 lines)
9. .claude/skills/continuous-agent-loop/SKILL.md (~35 lines)
10. .claude/skills/enterprise-agent-ops/SKILL.md (~40 lines)
11. .claude/skills/agent-payment-x402/SKILL.md (~25 lines)
12. .claude/skills/liquid-glass-design/SKILL.md (~30 lines)
13. .claude/skills/santa-method/SKILL.md (~30 lines)

Each skill must:
- Have YAML frontmatter with name + description (CSO trigger format from DECISION-skills.md)
- Be adapted to OUR stack where applicable
- Content skills: dispatch content-writer agent where noted
- Experimental skills: include safety rails (max iterations, cost ceilings)
- Credit source repo in a comment
- 50-150 lines each, no placeholders

## Validation checklist
- [ ] All 13 SKILL.md files exist
- [ ] Count = 13 (7 content + 6 experimental, no extras)
- [ ] No invalid stack references
- [ ] No files modified under research/

git add -A && git commit -m "feat(skills): content/business and experimental skills (13)"
```

---

## Phase 3D: Industry Skills (9 skills)

```
# iaGO-OS — Phase 3D: Industry Skills

## Context
- Repo root: C:\Users\sanal\dev\iago-os
- .claude/skills/ — all non-industry skills already built
- research/ — READ ONLY, never modify

## Before you write a single file, read:
1. HANDOFF.md — current state
2. CLAUDE.md — stack constraints (especially DynamoDB, Lambda, Cognito, API Gateway)
3. research/DECISION-skills.md — read Industry Skills (I1-I9) section IN FULL
4. One already-built skill — match format exactly

## What you're building (9 skills)

From DECISION-skills.md I1-I9. No additions, no omissions.

1. .claude/skills/healthcare-phi-compliance/SKILL.md (~40 lines)
   - HIPAA/PHI patterns + AWS HIPAA-eligible config
2. .claude/skills/carrier-relationship-management/SKILL.md (~30 lines)
   - DynamoDB single-table for carrier data + API Gateway integrations
3. .claude/skills/customs/SKILL.md (~35 lines)
   - Bundled customs-* skills, DynamoDB for compliance records
4. .claude/skills/energy/SKILL.md (~35 lines)
   - Bundled energy-* skills, DynamoDB TTL + Lambda for time-series
5. .claude/skills/logistics/SKILL.md (~35 lines)
   - Bundled logistics-* skills, DynamoDB for shipment tracking
6. .claude/skills/inventory/SKILL.md (~30 lines)
   - DynamoDB single-table with optimistic locking
7. .claude/skills/production-scheduling/SKILL.md (~30 lines)
   - Lambda for scheduling computation, DynamoDB storage
8. .claude/skills/quality-nonconformance/SKILL.md (~25 lines)
   - DynamoDB + Cognito role-based access for inspectors
9. .claude/skills/returns-reverse-logistics/SKILL.md (~25 lines)
   - DynamoDB for return tracking + API Gateway webhooks

Each skill must:
- Have YAML frontmatter with name + description (CSO trigger)
- Be adapted to OUR AWS stack (DynamoDB single-table, Lambda, Cognito, API Gateway, SES)
- Include DynamoDB access pattern examples where applicable
- Credit source (ECC) in a comment
- No placeholders, no "customize as needed"

## Validation checklist
- [ ] All 9 SKILL.md files exist
- [ ] Count = 9 (no extras)
- [ ] All DynamoDB patterns use single-table design (pk/sk)
- [ ] No references to non-AWS services (no Firebase, Supabase, etc.)
- [ ] No files modified under research/

git add -A && git commit -m "feat(skills): industry skills (9)"
```
