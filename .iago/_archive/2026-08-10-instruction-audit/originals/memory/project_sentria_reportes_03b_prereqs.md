---
name: sentria-reportes-03b-prereqs
description: Sentria reportes 03b is gated on two backend prerequisites surfaced by the PR
metadata: 
  node_type: memory
  type: project
  originSessionId: b79125c2-0e9c-4ed9-bfaf-976eece307dc
---

PR #242 (sentria reportes plan **03a** — per-shift turno coverage pure fn `aggregateByTurno` in `src/lib/reports-utils.ts`) shipped with a documented deferred limitation after a post-PR dual-adversarial gate (2026-06-24). Santiago chose merge-03a-with-limitation; **two backend changes must land BEFORE 03b renders these reports:**

1. **Immutable `reportingTurnoId` on Incident** — stamped once at creation, never mutated. Distinct from the mutable `escalationAnchorTurnoId`, which `amplify/functions/updateIncidentForCaller/handler.ts:744` RE-PINS to the reassigned tech's shift on every manual reassignment — so a fixed past-period coverage report drifts when an incident is later reassigned. `aggregateByTurno` currently attributes by the anchor (best-available; anchor-first, mirrors `resolveWalkTurnoId`); swap to `reportingTurnoId` once it exists. Historical incidents can't be backfilled.

2. **`escalation_started` StatusChange audit trail** (capturing `escalationReason`) emitted by `triggerEscalation` — needed to re-add the dropped escalation report fns `getEscalationReasonBreakdown` + `getTimeToEscalateDistribution`. Today `clearEscalation` (escalation.ts:930/932) nulls `escalationStartedAt` + `escalationReason` on EVERY escalation resolution, and there is NO `escalation_started` event (only `_paused`/`_failed`/`_cleared`), so escalation reports gating on `escalationStartedAt` undercount (only currently-stuck chains counted) and the start reason/timestamp are permanently lost on clear. `getEscalationAnalysis` (pre-existing) shares this latent gap.

Both are non-backfillable schema/Lambda changes (own branch, sandbox-deploy verified), not pure-fn work. See [[feedback_sentria_qc_pr_base]] for the sentria PR base/tagging mechanics.
