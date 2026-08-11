---
name: project-sentria-turno-delete
description: Sentria hard-delete turnos feature — in flight on feat/turnos-hard-delete; design decisions locked
metadata: 
  node_type: memory
  type: project
  originSessionId: 0687c4db-fad8-4c81-a651-ccf7bbaeaae5
---

**PR #213 + #214 — MERGED into sentria-qc (2026-06-16 UTC).** `sentria-qc` tip = `0d1cb85` (#214 "Turnos migration & preset safety guards", added `parseHorariosArg`/`isSentButEmptyHorarios` to turnoValidation.ts). #213 (`feat/turnos-admin-ui` multi-schedule editor) is `10480bc`. Both done — do not reopen.

**HARD-DELETE turnos — IN FLIGHT (launched 2026-06-15).**
Branch `feat/turnos-hard-delete` off `origin/sentria-qc` (0d1cb85). **IMPL COMPLETE + COMMITTED at `96f2caf`** (15 files, +1922/-6), verified GREEN: `npx tsc --noEmit`, `npm run lint` (eslint, NOT biome), `npm run build`, `npm test` = all 67 suites + 21 new hard-delete tests. Clean diff (resource.ts only 25 lines — restored pristine + re-applied 3 additions via Bash node script to dodge the iago-os format-hook churn; see [[feedback_subproject_format_hook]]).

The `.claude/workflows/turnos-hard-delete.js` dynamic workflow (run wf_9d2e0f7b-4ad) CRASHED at the IMPLEMENT stage TWICE (thinking-block 400 — [[feedback_thinking_block_400]] — agents returned `""`; my guard `if(!impl[0])` aborted). Both legs left ~65% on disk; recovered by reading the partial work + dispatching completion agents + finishing the mechanical backend wiring (IAM grant, backend.ts 3 sites, test file) DIRECTLY. The workflow's own gate→fix→PR→tag tail was NOT used; ran the dual-adversarial gate standalone instead.

REMAINING (cheap): dual-adversarial Team gate running NOW (run wf_9f83c9c5-bec, base origin/sentria-qc, lenses frontend/amplify/security/tests). On clean → push + `gh pr create --base sentria-qc` (noTag) + single @claude tag. On blocking → /dual-adversarial-fix → re-gate → then PR+tag. NEVER merge.

Design decisions LOCKED this session (encode if re-running):
- New admin-only mutation `hardDeleteTurnosCascade(turnos: AWSJSON)` = JSON array of `{turnoId, updatedAt?}`; single delete = batch of one. Mirrors `deactivateTurnoCascade` (server-side caller-org resolve + assertSameTenant, optimistic lock via deleteTurno condition on updatedAt, bumpOrgConfigCheckpoint).
- Cascade HARD-deletes ALL `TechnicianTurnoAssignment` rows (active AND inactive) via the turnoId GSI (`listTechnicianTurnoAssignmentByTurnoIdAndOrganizationId`) — new DI-injected `purgeAssignmentsForTurno` in turnoAssignmentCascade.ts.
- Escalation-anchor BLOCK = `escalationActive===true` only (query `listIncidentByOrganizationId` filter escalationActive eq true, then anchor∈deleteSet). Do NOT block merely-open non-escalating incidents — `escalation.ts resolveWalkTurnoId` re-anchors to the current active turno on a missing anchor (graceful degrade), so the block is a conservative product guard. TERMINAL incidents: LEAVE the anchor id (inert, audit history) — do NOT nullify.
- Batch last-active-turno guard: `batchDeleteWouldZeroActiveTurnos` (block iff active set non-empty AND every active id is in the delete set).
- Ordering: turno-row FIRST then purge assignments (turno is routing-authoritative; orphan assignments inert; idempotent re-run re-purges via turnoId GSI). getTurno null = already-deleted → skip (idempotent).
- Only two turno references in schema: `TechnicianTurnoAssignment.turnoId` + `Incident.escalationAnchorTurnoId` (verified). UI primitives: input/alert-dialog/dialog exist, NO checkbox.tsx (frontend adds shadcn checkbox).
- Tests CRLF: scripts/*.mjs (incl. test-turnos.mjs, test-turnos-frontend-parity.mjs) are CRLF+UTF-8 — preserve; .ts/.tsx are LF.

Sentria PR mechanics: [[feedback_sentria_qc_pr_base]]. Repo/env: [[project_sentria]], [[reference_sentria_qc_env]]. After async @claude loop reports clean, run post-async dual-adversarial pass #2 before Santiago merges.
