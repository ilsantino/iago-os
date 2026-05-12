---
phase: feature-wedge-c-routines
plan: 01
wave: 1
depends_on: []
context: docs/specs/iago-os-roadmap.md
created: 2026-05-10
source: feature
roadmap_ref: "§ Wedge C client-trigger primitive + § /routines adoption"
effort_estimate: 0.5d
trigger: "async review-fix scheduling (GitHub PR @claude-tag event)"
---

# Plan: feature-wedge-c-routines/01-routines-bind-viability

## Goal

Bind Anthropic Claude Code `/routines` to the iaGO async review-fix scheduling trigger (GitHub PR @claude-tag event), measure viability against real iaGO load, and document the fallback path. This is the Wedge C client-trigger primitive per the canonical roadmap, collapsed from 1.5d to 0.5d by `/routines` replacing custom cron + script + `[SILENT]` infrastructure.

**Why this trigger:** Async review-fix scheduling has real volume (every PR fires it), is GitHub-events-native (one of `/routines` three trigger types), and is the closest analog to the installflow Stripe-events pattern Wedge H will reframe against. Lets us stress-test `/routines` on iaGO's own load before committing Wedge H to a paying client.

**Why this wedge first:** Roadmap names Wedge C as the next unblocked Wave 1 move after A/B. `/routines` collapse makes it cheaper than B (distiller, 2d) — ship the smaller, faster wedge first to prove the `/routines` bind pattern before applying it to Wedge H.

## Constraints

- **Roadmap-mandated task 1 first:** Per roadmap § `/routines` adoption, the first task evaluates `/routines` bind viability against the named trigger (frequency, HMAC requirement, connector compatibility) before scaffolding ANY custom infrastructure.
- **Fallback preserved:** If `/routines` is killed, rate-limited below iaGO PR volume, or research-preview API changes break the bind, the wedge reverts to the original C design (cron + script + `[SILENT]` token). All decision artifacts must capture the fallback path explicitly.
- **No custom HMAC layer in this plan.** HMAC sits in Wedge H (Stripe-events). Wedge C is GitHub-events only — `/routines` covers that natively per Anthropic docs.
- **No iaGO client deliverable delay.** Per roadmap invariants, this wedge must not block MUNET MVP work. If task 1 surfaces a `/routines` blocker requiring custom scaffolding, the wedge is deferred to cycle 2, not pushed onto the current Wave 1 budget.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `.iago/research/2026-05-XX-routines-bind-viability.md` | Task 1 decision artifact: `/routines` viability against async review-fix trigger |
| create | `.iago/runbooks/async-review-fix-routine.md` | Operator runbook: how to configure, monitor, and rollback the routine bind |
| modify | `.github/workflows/claude-review-fix.yml` | If bind succeeds, document how the workflow's @claude-tag emission interfaces with the routine; if bind fails, document the fallback cron path. No behavioral change in this plan — workflow already emits the tag. |
| modify | `docs/specs/iago-os-roadmap.md` | Append Wedge C status row to roadmap (bound / fallback / deferred); update `/routines adoption` section with measured outcome |
| create or modify | `.claude/skills/iago-execute/SKILL.md` OR new `.claude/rules/routines-bind.md` | Codify the bind pattern as a reusable rule so Wedge H can cite it. Defer to task 4 once task 1's verdict is known. |

## Tasks

### Task 1: Evaluate `/routines` bind viability against async review-fix trigger

- **files:** `.iago/research/2026-05-XX-routines-bind-viability.md` (create; replace XX with execution date)
- **action:** Research artifact, no infrastructure change. Verify against current Anthropic `/routines` documentation and real iaGO state:
  1. **Frequency check** — measure async review-fix invocation volume over the last 30 days from `.github/workflows/claude-review-fix.yml` run history (`gh run list --workflow=claude-review-fix.yml --limit=200 --json createdAt`). Compute average + peak invocations/day. Compare against `/routines` documented daily run limits (research-preview tier).
  2. **Trigger-type fit** — confirm `/routines` GitHub-events trigger type supports the @claude-tag emission pattern from `claude-review-fix.yml`. Read `[code.claude.com/docs/en/overview](https://code.claude.com/docs/en/overview)` § Routines and cite the exact event types supported.
  3. **HMAC requirement** — confirm none. Async review-fix uses `GH_PAT` for cross-workflow trigger (already in repo secrets). No webhook signature verification needed at the iaGO side; GitHub signs its own events.
  4. **Connector compatibility** — confirm `/routines` supports GitHub repo connection on the team's Anthropic plan (Pro/Max/Team/Enterprise per roadmap). Santiago's Claude Max 200 plan must be eligible.
  5. **Recursion + context-bleed risk** — per roadmap fallback caveats, `/routines` has known issues with recursive routines (silent loops) and context bleed between invocations. Document the iaGO-specific risk: review-fix triggers @claude-tag on PR, which could re-trigger the routine. Verify with Anthropic docs whether `/routines` invocations are de-duplicated or rate-limited per PR.
  6. **Verdict** — one of: `BIND-VIABLE` (proceed task 2), `BIND-VIABLE-WITH-MITIGATION` (proceed task 2 with explicit mitigation steps for recursion/context-bleed/rate-limit), `BIND-NOT-VIABLE` (skip task 2, proceed task 3 fallback path).
- **verify:** `test -f .iago/research/*-routines-bind-viability.md && grep -qE "^## Verdict$" .iago/research/*-routines-bind-viability.md && grep -qE "BIND-(VIABLE|NOT-VIABLE)" .iago/research/*-routines-bind-viability.md`
- **expected:** File exists; ## Verdict section present; verdict line emits one of the three labels.

### Task 2: Bind `/routines` to async review-fix trigger (CONDITIONAL on task 1 verdict)

- **files:** `.iago/runbooks/async-review-fix-routine.md` (create); `.iago/research/2026-05-XX-routines-bind-viability.md` (append: bind configuration evidence)
- **gate:** Skip entirely if task 1 verdict is `BIND-NOT-VIABLE`. If `BIND-VIABLE-WITH-MITIGATION`, all named mitigations from task 1 must be configured in the routine before this task is marked complete.
- **action:** Configure the routine via `/schedule` CLI or Anthropic web UI per `[code.claude.com/docs/en/overview](https://code.claude.com/docs/en/overview)`. Routine spec:
  - **Trigger type:** GitHub events
  - **Event filter:** PR comment containing `@claude` on `ilsantino/iago-os` repo (and any other iaGO-owned repos with the review-fix workflow installed)
  - **Connectors:** GitHub repo connection scoped to PR-comment read + PR-comment write + PR-content read
  - **Prompt:** Read `.github/workflows/claude-review-fix.yml` review-fix step instructions and replicate them as the routine prompt. Cite the workflow file as the source-of-truth; if the workflow changes, the routine prompt must be updated.
  - **Rate-limit guard:** Per task 1 mitigation if applicable.
  - **Recursion guard:** Routine must NOT emit `@claude` itself in any reply; only post `[claude-review-complete]` signals to feed `claude-review-fix.yml` round counter.
  - Write the runbook with: how to view routine status, how to disable/pause, how to view invocation logs, how to roll back to the workflow-only path.
- **verify:** Manual smoke test — tag @claude on a test PR, confirm routine fires within expected SLA, confirm `[claude-review-complete]` signal posts back, confirm `claude-review-fix.yml` round-counter increments correctly. Document the smoke test in the runbook with screenshots of the routine dashboard.
- **expected:** Runbook exists; smoke test documented with at least one successful invocation; routine appears in Anthropic dashboard with status `Active`.

### Task 3: Fallback path documentation (ALWAYS write, even if task 2 succeeds)

- **files:** `.iago/runbooks/async-review-fix-routine.md` (append: fallback section)
- **action:** Document the revert path to the original Wedge C design — cron + script + `[SILENT]` token. Per roadmap fallback path: "if `/routines` is killed or rate-limits below installflow Stripe-event volume, fall back to the original C (cron + `[SILENT]`) and H (custom webhook + HMAC) plans." Concrete fallback steps:
  1. Disable the routine in Anthropic dashboard.
  2. Restore `.github/workflows/claude-review-fix.yml` to its current behavior (no change needed if workflow stayed intact).
  3. If we had migrated some logic out of the workflow into the routine prompt, restore that logic to the workflow.
  4. Document trigger conditions that would cause the revert: rate-limit incidents, killed feature, prompt-divergence between workflow and routine.
- **verify:** `grep -qE "## Fallback" .iago/runbooks/async-review-fix-routine.md && grep -qE "cron|SILENT" .iago/runbooks/async-review-fix-routine.md`
- **expected:** Fallback section present; cron/SILENT escape path documented.

### Task 4: Update roadmap with Wedge C outcome + create routines-bind rule (if applicable)

- **files:** `docs/specs/iago-os-roadmap.md` (modify); `.claude/rules/routines-bind.md` (create — only if task 2 succeeded)
- **action:**
  1. Append a status row to roadmap § Wedge-Set Verdict table: "Wedge C — SHIPPED-BOUND / FALLBACK-DOCUMENTED / DEFERRED-TO-CYCLE-2" per task 1 + task 2 verdicts.
  2. Update roadmap § `/routines` adoption section with measured outcome (volume, rate-limit behavior, recursion outcome, runbook link).
  3. IF task 2 succeeded: create `.claude/rules/routines-bind.md` codifying the bind pattern (when to use `/routines` vs custom infra, how to check Anthropic-plan eligibility, recursion-guard requirement, fallback path requirement). Wedge H plan (when written) will cite this rule.
  4. IF task 2 did not run (task 1 verdict BIND-NOT-VIABLE): note the blocker in the roadmap so future Wedge H planning can re-test `/routines` viability or skip directly to custom infra.
- **verify:** `grep -E "Wedge C" docs/specs/iago-os-roadmap.md | grep -E "SHIPPED-BOUND|FALLBACK-DOCUMENTED|DEFERRED-TO-CYCLE-2"`
- **expected:** Status row present in roadmap.

## Acceptance Criteria

- [ ] Task 1 verdict written and committed to `.iago/research/`
- [ ] Task 2 routine bound (or explicitly skipped per task 1 verdict)
- [ ] Task 3 fallback path documented in runbook
- [ ] Task 4 roadmap status row appended
- [ ] No regression to `.github/workflows/claude-review-fix.yml` behavior
- [ ] Smoke test confirms either `/routines` invocation OR workflow-only path still works
- [ ] No MUNET MVP work delayed by this wedge

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `/routines` research-preview API changes mid-implementation | Medium | Task 1 captures exact docs URL + retrieval date; if API changes, re-run task 1 |
| Routine recursion (routine triggers @claude which re-triggers routine) | High | Task 2 recursion-guard requirement; task 1 step 5 verifies de-dup |
| Rate-limit below iaGO PR volume | Medium | Task 1 step 1 measures actual volume; task 3 fallback path ready |
| `/routines` plan eligibility (Santiago's Max 200 vs required tier) | Low | Task 1 step 4 verifies |
| Prompt divergence between workflow + routine (two sources of truth) | Medium | Task 2 cites workflow as source-of-truth; routine prompt is mirror, not independent spec |

## Sources

- `docs/specs/iago-os-roadmap.md` § Wedge C + § `/routines` adoption (canonical roadmap)
- `.iago/research/team-2-hermes-state.md` § Wedge C (original 1.5d effort estimate before /routines collapse)
- `.github/workflows/claude-review-fix.yml` (current async review-fix workflow — source of truth for routine prompt)
- `~/dev/obsidian-brain/sessions/2026-05-10-iago-os.md` (this plan's authorization context)
- `~/dev/obsidian-brain/sessions/2026-05-07-iago-os.md` (`/routines` canon resolution)
- Anthropic docs: `[code.claude.com/docs/en/overview](https://code.claude.com/docs/en/overview)` § Routines (retrieved at task 1 execution)
- 9to5Mac coverage: `[9to5mac.com/2026/04/14/anthropic-adds-repeatable-routines-feature-to-claude-code-heres-how-it-works/](https://9to5mac.com/2026/04/14/anthropic-adds-repeatable-routines-feature-to-claude-code-heres-how-it-works/)`
- dev.to coverage: `[dev.to/whoffagents/claude-code-routines-what-anthropics-docs-left-out-35jc](https://dev.to/whoffagents/claude-code-routines-what-anthropics-docs-left-out-35jc)`
