# `state-paths.ts` — `atomicRename` caller audit (Plan feature-phase-1-deferred-hardening/02)

Resolves the Garry-checklist deferred item at `runtime/PHASE-1-EVIDENCE.md` line 246:
PR #45's CLAIM-phase workaround in `approval-bus.ts` reaches past `atomicRename` to call raw `fsp.rename` because the destructive EEXIST recovery would silently overwrite a concurrent winner's claim file. That bypass is load-bearing — the single-function `atomicRename` API is leaky for at least one caller. This audit classifies every callsite, splits the API into two named variants with distinct semantics (`atomicRename` strict vs `atomicRenameStaleDest` destructive), and migrates each caller to the variant whose semantics match its intent.

## 1. Inventory

Generated from `grep -rn "atomicRename\(" runtime/ --include="*.ts" | grep -v ".test.ts"` plus the documented raw `fsp.rename` bypass in `approval-bus.ts` CLAIM phase.

| File:line | Calling function | src arg | dst arg | Caller intent (1 sentence) |
|---|---|---|---|---|
| `runtime/daemon/file-bus.ts:339` | `writeResolvedOutput` | `resolvedTmpPathOf(taskId)` | `resolvedPathOf(taskId)` | Atomically publish the resolved output for `taskId`; the dst is per-taskId and the previous owner already validated. |
| `runtime/daemon/session-log.ts:392` | `setHWM` | `hwmTmpPathOf(handleId)` | `hwmPathOf(handleId)` | Atomically publish the new HWM marker for `handleId`; the existing dst is by definition a STALE prior HWM that we are deliberately replacing. |
| `runtime/telegram/approval-bus.ts:235` | `createApprovalRequest` PUBLISH | `pendingTmpPath(approvalId)` | `pendingFinalPath(approvalId)` | Atomically publish the pending approval envelope at a UUID-v4 path; concurrent writers to the same UUID are operationally impossible (random 128-bit id). |
| `runtime/telegram/approval-bus.ts:433` | `resolveApprovalLocked` PUBLISH | `resolvedTmpPath(approvalId)` | `resolvedFinalPath(approvalId)` | Atomically publish the resolved decision after the CLAIM phase already serialized callers; only one caller per approvalId ever reaches PUBLISH. |
| `runtime/telegram/approval-bus.ts:350` | `resolveApprovalLocked` CLAIM (raw `fsp.rename` bypass) | `pendingPath` (= `pending/<id>.json`) | `inflightPath` (= `inflight/<id>.json`) | Atomically MOVE the pending envelope into the `inflight/` directory as the **claim point** of the three-phase no-strand sequence; the dst MUST fail-on-EEXIST because a concurrent caller's inflight file at the same path is a legitimate race winner that we must never destroy. |

## 2. Classification

Each row above is classified into one of three buckets:

- **race** — multiple writers may legitimately compete for the same dst; destructive unlink+rename is acceptable because the loser was about to be replaced anyway. **Assumes single-process** — multi-process callers MUST coordinate via file-lock before calling.
- **stale-dest** — a stale file at dst must be replaced atomically; destructive retry is the desired behavior.
- **collision-hazard** — a different writer's data at dst must NOT be destroyed; destructive retry corrupts. Caller needs strict fail-on-EEXIST semantics.

### Classification matrix

| Row | Classification | Rationale | Chosen API |
|---|---|---|---|
| `file-bus.ts:339` writeResolvedOutput | **stale-dest** | The resolved-output filename is per-`taskId`. Owner-ID validation already rejected any zombie writer above; if the dst exists, it's a stale prior write of the same logical record (single-process assumption — Plan 07+ multi-process IPC must coordinate). Destructive replacement is correct. | `atomicRenameStaleDest` |
| `session-log.ts:392` setHWM | **stale-dest** | The HWM marker is the prior HWM by definition. Replacing it is the entire purpose of `setHWM`. Single-process assumption holds — `session-log.ts` header documents that multi-process callers MUST own a single writer per handle. | `atomicRenameStaleDest` |
| `approval-bus.ts:235` createApprovalRequest PUBLISH pending | **stale-dest** | The dst path embeds a fresh `crypto.randomUUID()` — concurrent collision is operationally impossible (2^-128). If the dst exists, it's an orphaned tmp from a crashed prior process and destructive replacement is correct. | `atomicRenameStaleDest` |
| `approval-bus.ts:433` resolveApprovalLocked PUBLISH resolved | **stale-dest** | The per-`approvalId` in-process mutex (`inProcessResolveLocks`) PLUS the CLAIM-phase rename winner-takes-all gate guarantee that only one caller per approvalId ever reaches PUBLISH. Same single-process assumption as session-log. | `atomicRenameStaleDest` |
| `approval-bus.ts:350` resolveApprovalLocked CLAIM (raw `fsp.rename`) | **collision-hazard** | The CLAIM rename IS the serialization point. If a concurrent caller's inflight file already exists at the dst, our rename MUST fail so we know to give up (the error-handling branch classifies the outcome via `ENOENT`/`EEXIST`/`EPERM`/`EBUSY`). Destructive retry would silently destroy the winner's claim file. | `atomicRename` (the new strict variant) |

### Notes

- The classifications above all carry the **single-process assumption** for the stale-dest rows. The multi-process daemon hazard (e.g., a future Plan 07+ IPC server that proxied two daemon processes both writing the same HWM) is documented here but is OUT of Phase 1 scope. Callers crossing process boundaries MUST add their own file-lock layer before calling either variant.
- The CLAIM row's raw `fsp.rename` is migrated to the new strict `atomicRename`. The strict variant is implemented as `fsp.link(src, dst) + fsp.unlink(src)` on BOTH platforms (NTFS's `CreateHardLinkW` fails atomically with `EEXIST` when dst exists, same as POSIX `link(2)`) — no stat-then-rename TOCTOU race, no silent overwrite. This tightens semantics over raw `fsp.rename` on POSIX (which would silently overwrite — a latent bug had the CLAIM ever fired on a POSIX daemon) and is behaviorally equivalent to raw `fsp.rename` on Windows for the CLAIM use case (both surface `EEXIST`/`EPERM` when dst exists).
- **Crash-mid-CLAIM dual-presence window (link+unlink trade-off).** The strict `atomicRename` is two syscalls (`link` then `unlink`). A crash between them leaves a hardlink pair: BOTH `pending/<id>.json` and `inflight/<id>.json` exist for the same approval id. Single-process happy path: the in-process call's catch block in `state-paths.ts::atomicRename` rolls back `dst` on `unlink(src)` failure, so this window only opens on a hard process crash (not on a recoverable error). Boot recovery (Plan 07+ daemon startup) MUST reconcile this state: if both `pending/<id>.json` and `inflight/<id>.json` are present for the same id, PREFER the inflight (it is the claim winner's intent) and `unlink` the pending. Without this reconciliation, `resolveApprovalLocked`'s rename will hit `EEXIST` on the link, observe inflight present, poll for 5s, and falsely classify the approval as `already-resolved` (line 403, "Long-stuck inflight") — even though no decision was ever recorded. Plan 07 boot recovery owns the reconciliation; this audit is the source of record for the requirement.

## 3. Plan

### API split (Task 3)

- Rename the existing destructive function `atomicRename` → `atomicRenameStaleDest`. Behavior preserved: Windows EEXIST/EPERM recovery via unlink-then-rename; POSIX native overwrite via `fsp.rename`.
- Introduce a NEW exported function `atomicRename` with **strict** semantics: throws `EEXIST` (POSIX) / `EEXIST` or `EPERM` (Windows) if dst exists. POSIX implementation uses `fsp.link(src, dst)` + `fsp.unlink(src)` to avoid the stat-then-rename TOCTOU race. Windows implementation is a pass-through to `fsp.rename` (which already throws when dst exists).
- Both functions live in `runtime/daemon/state-paths.ts` with full JSDoc cross-referencing this audit.

### Caller migration (Task 4)

- `file-bus.ts`, `session-log.ts`, `approval-bus.ts` PUBLISH-pending and PUBLISH-resolved → swap import + call to `atomicRenameStaleDest`.
- `approval-bus.ts` CLAIM (line 350) → migrate from raw `fsp.rename` to the new strict `atomicRename`. Update the comment block to point at this audit and remove the "raw rename — NOT atomicRename" rationale (since the strict atomicRename IS the right primitive now).

### Telemetry (Task 6)

- Add a `atomic-rename-stale-dest-window` event kind to `DaemonEvent`. Emit from `atomicRenameStaleDest` on the Windows EEXIST recovery path with `{ dst: <basename only>, windowMs, platform: "win32" }`. Cost is bounded (fires only on Windows EEXIST). No recursion risk (telemetry uses `fsp.appendFile`, not rename).

### Docs (Task 7)

- README adds a Failure Modes entry referencing this audit.
- `PHASE-1-EVIDENCE.md` Garry-checklist row at line 246 flips to `[x]` with a pointer to this audit.
