# `.iago/plans/feature-v2-foundation/` — v2 Foundation Phase (MWP L2 Stage Contract)

**Stage:** v2 foundation phase (Phase 0 + Phase 0.5 — done; Phase 1 to follow under `runtime/CONTEXT.md`).
**Layer:** L2 — stage contract.
**Token budget:** 200–500 tokens.

This stage encompasses the iago-os v2 *foundation* work — preparing the runtime substrate (VPS audit + orphan cleanup) BEFORE daemon implementation begins. The plans here document what was inspected and what was cleaned. Phase 1 daemon implementation is a separate stage (`runtime/CONTEXT.md`), not this one.

## Inputs

### Layer 3 (reference — internalized as constraints)

- `docs/specs/iago-os-v2-vision.md` § OpenClaw → VPS Migration Sequence (Stage A maps to Phase 0; Stage E maps to Phase 7+)
- `docs/specs/iago-os-v2-master-prompt.md` § P0 — Foundation (Phase 0–2)
- `CLAUDE.md` (repo root)
- `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § Decisions made under this amendment (HTTP-shape auth verdict — relevant to Phase 1 prep)

### Layer 4 (product — processed as input)

- `runtime/migration/00-vps-audit.md` — Phase 0 audit data (read by Phase 0.5 plan, post-cleanup state recorded here)
- `01-vps-audit.md` — Phase 0 plan (CLOSED — execution evidence in audit doc)
- `02-orphan-cleanup.md` — Phase 0.5 plan (CLOSED — execution evidence: commit 6bcbbac, audit doc § Orphan processes)

## Process

1. **Phase 0 — VPS audit** (DONE 2026-05-13). Plan `01-vps-audit.md` executed via Tailscale SSH; deliverable `runtime/migration/00-vps-audit.md` written; merged in PR #38.
2. **Phase 0.5 — Orphan cleanup** (DONE 2026-05-15). Plan `02-orphan-cleanup.md` executed via Tailscale SSH; iaguito-hq + pulsara stopped via PM2 cleanup; ufw active; audit doc updated; merged in commit 6bcbbac.
3. **Phase 1+** — Moves to `runtime/CONTEXT.md` (separate stage). Daemon skeleton + AgentRuntime + Shape 1 PTY adapter implementation lives there.

## Outputs

All outputs from this stage are already shipped:

| Output | Status | Location |
|---|---|---|
| Phase 0 audit doc | ✅ DONE | `runtime/migration/00-vps-audit.md` |
| Phase 0.5 cleanup execution evidence | ✅ DONE | Audit doc § "Orphan processes — CLEANED 2026-05-15"; commit 6bcbbac |
| ufw active on VPS (default-deny + Tailscale-only SSH) | ✅ DONE | VPS state (verified via `ssh root@srv1456441 'ufw status verbose'`) |
| PM2 supervised processes cleaned | ✅ DONE | `pm2 list` empty; `dump.pm2` persisted empty |
| Memory `reference_iago_v2_vps` | ✅ CURRENT | No drift discovered |

## Stage status

**CLOSED — Phase 0 + Phase 0.5 deliverables shipped.** This stage contract is retained as historical reference. Active v2 build work continues under `runtime/CONTEXT.md` (Phase 1 stage).

If a new foundation-level task surfaces (e.g., Phase 1.5 — additional VPS prep before Phase 2 install), write a new plan here AND extend this contract's Process + Outputs sections to cover it.

## Source

- L0: `CLAUDE.md` (repo root)
- L1: `.iago/CONTEXT.md`
- This file: L2 stage contract for v2 foundation
- Sibling stage: `runtime/CONTEXT.md` (v2 daemon build)
