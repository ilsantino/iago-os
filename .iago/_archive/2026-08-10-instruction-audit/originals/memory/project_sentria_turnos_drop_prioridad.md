---
name: project_sentria_turnos_drop_prioridad
description: Sentria PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 168d1d6c-6317-4639-a3c9-f77dc307fc05
---

Sentria PR #240 `feat/turnos-drop-prioridad` (base sentria-qc, repo bas-labs/sentria) removes the per-horario **Prioridad** input from the turno editor; every block now submits `priority: 0`. Post-PR dual-adversarial Team gate (2026-06-24/25) on the worktree `clients/sentria/.worktrees/turnos-drop-prioridad`.

**Outcome:** fixed via direct-Bash edits (NOT the fix Workflow — Sentria format-hook hazard, see [[feedback_format_hook_breaks_workflow_gates]]). Gate went **13 blocking → PASS_WITH_CONCERNS, 4 blocking**. Fix commits pushed (HEAD `e41bb11`); PR MERGEABLE; **Santiago merges** (Claude never merges, [[feedback_no_auto_merge]]). @claude NOT tagged (Santiago chose "merge + follow-up", not the tag option).

**Core fix:** the impl forced the *payload* priority to 0 but left the diff baseline (`seedRef.horarios`) at the stored non-zero priority, so `buildTurnoUpdate` (priority is in its canonical key — plan forbids removing it) saw a LABEL-ONLY edit as a schedule change → blocked corrupt-turno renames, defeated the no-op short-circuit, silently shifted routing. Fix = normalize the seed baseline to 0 to match the force.

**Residual 4 Important findings = plan-locked, NOT defects** (Santiago's 2026-06-18 locked decision; plan `quick-260618-turnos-drop-prioridad.md` defers migration + forbids resolver edits):
- Theme A (×3): priority 0 = HIGHEST precedence (resolver sorts ASC), so a new/re-saved turno outranks un-migrated legacy/preset (priority≥1) in `selectDefaultTurnoId` (new-tech default shift) + `getActiveTurnoIdsByPriority` (escalation anchor). Codex: regression vs base (base used max+1 = lowest).
- Theme B (×1): `CreateTechnicianModal` + `TurnosSupervisorEditor` sort `(priority, label.localeCompare)`; backend `selectDefaultTurnoId` sorts `(priority, id/code)` → once priorities converge to 0, UI first-shift ≠ backend default.

**Queued follow-up (Santiago approved):** plan `quick-260625-turnos-priority-normalize` (off sentria-qc): (1) one-time idempotent migration normalizing ALL turnos' horarios to priority 0 (collapses Theme A; reference repo's existing backfill-migration pattern); (2) align the 2 assignment-UI sorts to backend code/id tiebreak (Theme B); (3) regression tests for mixed + all-0 precedence. NOT yet written to disk — execute off a fresh branch when greenlit.
