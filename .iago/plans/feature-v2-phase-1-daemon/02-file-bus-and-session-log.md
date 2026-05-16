---
phase: feature-v2-phase-1-daemon
plan: 02
wave: 1
depends_on: []
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/02-file-bus-and-session-log

## Goal

Implement the two persistence primitives every shape depends on: (a) the file-bus that coordinates task claims via O_EXCL and atomic resolved-output writes with owner-ID validation, and (b) the `session.jsonl` append-only event log with two-phase replay (pause intake → replay up to HWM → resume). Both are standalone modules with no AgentRuntime knowledge — pure persistence primitives.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/file-bus.ts` | Task claiming + atomic resolved-output writes with owner-ID validation |
| create | `runtime/daemon/file-bus.test.ts` | O_EXCL collision tests, owner-ID mismatch rejection, atomic-rename invariants |
| create | `runtime/daemon/session-log.ts` | Append-only NDJSON event log + two-phase replay with high-water mark (HWM) |
| create | `runtime/daemon/session-log.test.ts` | Append, replay, HWM advancement, intake-pause correctness |
| create | `runtime/daemon/state-paths.ts` | Centralized state path resolution (`getStateRoot()`, `pathFor("tasks/pending")`, etc.) so plans 03-07 import a single source |
| create | `runtime/daemon/state-paths.test.ts` | Path resolution tests across platforms (Windows + Linux), env override |

## Tasks

### Task 1: Define centralized state paths

- **files:** `runtime/daemon/state-paths.ts`, `runtime/daemon/state-paths.test.ts`
- **action:** Export `getStateRoot(): string` that returns (in order of preference): `process.env.IAGO_DAEMON_STATE_ROOT`, then `path.join(process.cwd(), "runtime", "state")` if `process.cwd()` ends in `iago-os`, else `path.join(os.homedir(), ".iago-os", "daemon-state")`. Export `pathFor(kind: "tasks/pending" | "tasks/claimed" | "tasks/resolved" | "approvals/pending" | "approvals/resolved" | "agents" | "telemetry" | "session-logs" | "markers"): string` returning `path.join(getStateRoot(), kind)`. Export `ensureStateDirsSync(): void` that creates all the directories via `fs.mkdirSync(..., { recursive: true })` — idempotent. Use `node:path`, `node:os`, `node:fs` (NOT `node:fs/promises` for the sync setup). All named exports, no defaults. Tests: (1) env override wins; (2) repo-root fallback when cwd ends in `iago-os`; (3) homedir fallback otherwise; (4) `ensureStateDirsSync` creates every listed kind; (5) all returned paths are absolute. Use `vi.stubGlobal`/`vi.spyOn` on `process.cwd` and `os.homedir` in tests; restore in `afterEach`.
- **verify:** `cd runtime && npx vitest run daemon/state-paths.test.ts --reporter=verbose 2>&1 | tail -20`
- **expected:** All 5 tests pass; output contains `5 passed`.

### Task 2: Implement file-bus claimTask with O_EXCL

- **files:** `runtime/daemon/file-bus.ts`
- **action:** Export async `claimTask(opts: { taskId: string; ownerId: string; attemptId: string }): Promise<ClaimResult>` where `ClaimResult = { claimed: true; claimPath: string; ownerId: string; attemptId: string } | { claimed: false; reason: "already-claimed"; existingOwnerId?: string }`. Implementation: write a claim file at `pathFor("tasks/claimed") + "/" + taskId + ".claim.json"` using `fs.promises.writeFile(claimPath, JSON.stringify({ ownerId, attemptId, claimedAt: Date.now() }), { flag: "wx" })`. On `EEXIST`, read existing claim file, return `{ claimed: false, reason: "already-claimed", existingOwnerId: existing.ownerId }`. On other errors, re-throw. The task itself moves from `tasks/pending/<taskId>.json` to `tasks/claimed/<taskId>.json` via `fs.promises.rename` AFTER the `.claim.json` is written — second rename failure (e.g., task already moved) requires deleting the `.claim.json` and returning `{ claimed: false, reason: "already-claimed" }`. Export `readClaim(taskId: string): Promise<{ ownerId: string; attemptId: string; claimedAt: number } | null>`. No top-level await; no global state.
- **verify:** `cd runtime && npx tsc --noEmit && grep -c "^export" daemon/file-bus.ts`
- **expected:** `tsc --noEmit` exits 0. `grep -c "^export"` returns ≥2.

### Task 3: Implement atomic resolved-output write with owner-ID validation

- **files:** `runtime/daemon/file-bus.ts`
- **action:** Add to file-bus.ts: async `writeResolvedOutput(opts: { taskId: string; ownerId: string; attemptId: string; result: unknown }): Promise<WriteResolvedResult>` where `WriteResolvedResult = { ok: true; finalPath: string } | { ok: false; reason: "owner-mismatch"; expectedOwnerId: string } | { ok: false; reason: "no-claim" }`. Steps: (1) read claim file at `pathFor("tasks/claimed") + "/" + taskId + ".claim.json"`; if missing return `{ ok: false, reason: "no-claim" }`; (2) compare `claim.ownerId` to `opts.ownerId` — mismatch returns `{ ok: false, reason: "owner-mismatch", expectedOwnerId: claim.ownerId }` (this is the zombie-write rejection); (3) write to a temp file `pathFor("tasks/resolved") + "/." + taskId + ".tmp"` with full result envelope `{ taskId, ownerId, attemptId, result, completedAt: Date.now() }`; (4) `fs.promises.rename(tmpPath, pathFor("tasks/resolved") + "/" + taskId + ".json")` for atomic publish; (5) on success, return `{ ok: true, finalPath }`. Document in JSDoc: "Owner-ID + attempt-ID embedded in the resolved file; readers MUST validate owner-ID matches the claim before consuming." Add `readResolvedOutput(taskId: string): Promise<{ ownerId: string; attemptId: string; result: unknown; completedAt: number } | null>`.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (async )?function" daemon/file-bus.ts | wc -l`
- **expected:** `tsc --noEmit` exits 0. Exported function count ≥4 (claimTask, readClaim, writeResolvedOutput, readResolvedOutput).

### Task 4: Write file-bus Vitest tests

- **files:** `runtime/daemon/file-bus.test.ts`
- **action:** Use Vitest with `beforeEach(async () => { tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "iago-file-bus-")); process.env.IAGO_DAEMON_STATE_ROOT = tempDir; ensureStateDirsSync(); })` and `afterEach(async () => { delete process.env.IAGO_DAEMON_STATE_ROOT; await fs.promises.rm(tempDir, { recursive: true, force: true }); })`. Tests: (1) first claim of a fresh task succeeds, `claimed: true`; (2) second claim of same task returns `{ claimed: false, reason: "already-claimed", existingOwnerId }`; (3) `readClaim` returns correct ownerId/attemptId after claim; (4) `writeResolvedOutput` with matching ownerId publishes atomically — temp file gone, final file present; (5) `writeResolvedOutput` with mismatched ownerId returns `owner-mismatch` and does NOT write the final file (rejection of zombie writes); (6) `writeResolvedOutput` without prior claim returns `no-claim`; (7) concurrent `Promise.all([claimTask, claimTask])` from two distinct owners — exactly one succeeds, one fails (race-condition assertion); (8) `readResolvedOutput` round-trips a complex result object including `null`, nested arrays, dates-as-ISO-strings. File <300 lines.
- **verify:** `cd runtime && npx vitest run daemon/file-bus.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** All 8 tests pass; output contains `8 passed`.

### Task 5: Implement session-log append + two-phase replay

- **files:** `runtime/daemon/session-log.ts`
- **action:** Export async `appendEvent(handleId: string, event: unknown): Promise<{ byteOffset: number; sequence: number }>` that opens (or creates) `pathFor("session-logs") + "/" + handleId + ".jsonl"` in append mode, writes `JSON.stringify(event) + "\n"`, fsyncs, returns the post-write byte offset + monotonically-incrementing sequence number per handle. Sequence numbers persisted in `pathFor("session-logs") + "/" + handleId + ".seq"` (read on first append for the handle; written after every successful append). Export `readEventsUpToHWM(handleId: string, hwm: { byteOffset: number; sequence: number }): AsyncIterable<{ event: unknown; sequence: number }>` that streams events up to and including the HWM, parsing line by line, skipping malformed lines (log to stderr but do not throw). Export `getHWM(handleId: string): Promise<{ byteOffset: number; sequence: number } | null>` that returns the last persisted HWM marker at `pathFor("markers") + "/" + handleId + ".hwm.json"`, or `null` if absent. Export `setHWM(handleId: string, hwm: { byteOffset: number; sequence: number }): Promise<void>` that writes the marker atomically via tmp+rename. Add `ReplayController` class (yes, class allowed here — this is the one exception, document inline): constructor takes `handleId`, exposes `async pauseIntake(): Promise<void>` (sets internal flag), `async replay(cb: (event: unknown, seq: number) => Promise<void>): Promise<void>` (iterates up to HWM), `async resumeIntake(): Promise<void>` (clears flag, flushes any buffered events from `appendEvent` callers that arrived during pause). `appendEvent` checks the controller's pause flag (kept in a module-scope `Map<handleId, boolean>`) and buffers writes to an in-memory queue when paused; queue drained on `resumeIntake` in order.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (async )?(function|class|const)" daemon/session-log.ts`
- **expected:** `tsc --noEmit` exits 0. Exports list: `appendEvent`, `readEventsUpToHWM`, `getHWM`, `setHWM`, `ReplayController`.

### Task 6: Write session-log Vitest tests

- **files:** `runtime/daemon/session-log.test.ts`
- **action:** Use same temp-dir scaffolding as file-bus.test.ts. Tests: (1) `appendEvent` writes one line of NDJSON; sequence starts at 1 and increments; byte offset matches post-write file size; (2) 100 sequential appends produce 100 lines, sequence 1..100, byte offsets monotonically increasing; (3) malformed line in jsonl file is skipped during `readEventsUpToHWM` and a stderr warning is captured via `vi.spyOn(console, "error")`; (4) `setHWM` then `getHWM` round-trips correctly; (5) `getHWM` returns `null` when no marker exists; (6) two-phase replay: pause intake, append 5 events (they queue), call `replay(cb)` which iterates pre-pause events up to a previously-set HWM, then resume and assert the 5 queued events appear after replay in sequence order (no interleaving); (7) `replay` invokes the callback once per event in sequence order; (8) HWM write is atomic — kill mid-write simulation (write to a fake `.tmp` and assert the final file does not appear if rename never fires; use `vi.spyOn(fs.promises, "rename").mockRejectedValueOnce`). File <350 lines.
- **verify:** `cd runtime && npx vitest run daemon/session-log.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** All 8 tests pass; output contains `8 passed`.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Critical edge cases

- **E1 (Critical) — Orphan claim file strands tasks indefinitely.** Power loss between claim write and task rename: `.claim.json` exists but task JSON stays in `tasks/pending/`. Every future `claimTask` returns `already-claimed`. The 2026-05-14 Windows crash referenced in the vision spec is exactly this failure mode. **Fix:** specify which layer owns claim-staleness. Recommended: add `reclaimIfStale(taskId: string, maxAgeMs: number): Promise<boolean>` to file-bus.ts. The agent-manager (Plan 03) calls it during `bootRecovery` with `maxAgeMs = 6 * 60 * 60 * 1000` (6 hours — adjust based on max expected pipeline runtime). Document the contract in JSDoc and file-bus README.
- **E2 (Critical) — `fs.promises.rename` over existing file fails on Windows.** Node's `fs.promises.rename` does NOT pass `MOVEFILE_REPLACE_EXISTING` on Windows. Both `writeResolvedOutput` (`tmp → final`) and `setHWM` (`tmp → marker`) fail with `EEXIST` if the target already exists. Santiago's primary dev box is Windows. **Fix:** add an `atomicRename(src, dst)` helper in `state-paths.ts` (or new `runtime/daemon/fs-atomic.ts`) that on Windows does `try { fs.promises.rename(src, dst) } catch (e) { if (e.code === "EEXIST") { await fs.promises.unlink(dst); await fs.promises.rename(src, dst); } else throw }` and on Linux/macOS just calls rename. Document the non-atomicity on Windows (small race window between unlink and rename — acceptable for Phase 1; revisit in Phase 7 cutover if a paying client needs strict atomicity).

### Precision

- **P1 — Confirm `writeFile` with `flag: "wx"` IS O_EXCL-safe.** Both Linux (`O_CREAT|O_EXCL`) and Windows (`CREATE_NEW`) maps are atomic at the syscall level. Document this rationale at top of `file-bus.ts` so a future implementer doesn't substitute a less-safe primitive.
- **P2 (Important) — HWM boundary condition.** Specify in `appendEvent` JSDoc: returned `byteOffset` is the file size AFTER the write (exclusive end offset). `readEventsUpToHWM` replays all complete lines whose end byte offset is `<= hwm.byteOffset`. Add test case where HWM exactly equals the end of the last line.
- **P3 (Important) — Buffer drain contract on `appendEvent` during pause.** Callers `await appendEvent(...)`: the returned promise resolves only after the event is either written (not paused) OR queued AND drained on `resumeIntake`. Specify this in JSDoc — not implicit.

### Missing acceptance criteria

- **M1 (Important) — Claim fsync.** `claimTask` writes `.claim.json` via `writeFile`+`wx` but does not call `fsync`/`fdatasync`. On crash before flush, the claim file vanishes — defeats orphan prevention. **Fix:** use `fs.promises.open(path, "wx")` → write → `fileHandle.datasync()` → close.
- **M2 (Important) — `appendEvent` fsync semantics.** Use `fdatasync` (data only — faster than `fsync` metadata+data) after write. Caller MUST NOT store returned `byteOffset` as HWM until `appendEvent` resolves (the resolve gates on durability).
- **M3 (Important) — `.seq` recovery from absent file.** If `.seq` is missing, derive sequence by counting lines in `.jsonl` (NOT reset to 0). Document and test this recovery path.
- **M4 (Minor) — Windows rename-over-existing not in any test.** Add an explicit test in `file-bus.test.ts` (and `session-log.test.ts` for HWM) that exercises rename-over-existing — runs on Windows + Linux to catch divergence.

### Other

- E3 — `.seq` lost: see M3 above.
- E4 — Disk full mid-write: append-mode write truncated; malformed-line skip in replay handles correctness; document explicitly.
- E5 — HWM tmp partial-presence: next `getHWM` returns null, replay starts from beginning; idempotent if events are; document as known behavior.
- C — Class allowed for `ReplayController` is explicitly carved out in the plan with inline doc — no violation.
- S1 — `ReplayController` as factory function: viable alternative; class adds clarity around per-handle state. Keep class.
- S2 — `.seq` persistence rationale: scan-on-open is O(n) on log size; persist for performance. Document why.

### Implementer forward-list

1. Add `atomicRename(src, dst)` helper handling Windows EEXIST — see E2. ALL `tmp → final` renames in Plan 02 (and Plan 03 markers, Plan 06 approvals, Plan 05 telemetry where applicable) MUST use this helper.
2. Add `reclaimIfStale(taskId, maxAgeMs)` to file-bus.ts — see E1. Plan 03 `bootRecovery` calls it.
3. Use `fs.promises.open` + `datasync` + close for claim writes; document durability contract — see M1.
4. `appendEvent` uses `fdatasync` after write; promise resolves on durability — see M2.
5. `.seq` recovery: count lines in `.jsonl` if `.seq` absent — see M3.
6. HWM boundary: byteOffset is exclusive end; document + test — see P2.
7. Buffer drain contract on pause: document + test — see P3.
8. Add Windows-specific rename-over-existing tests — see M4.

### 2nd-pass stress notes (2026-05-15 PM)

- **`validateAgentId()` MUST land in `state-paths.ts` (Task 1).** Full regex: `/^[a-z][a-z0-9\-]{0,62}$/`. Reject substring `__`. Reject Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM[1-9]`, `LPT[1-9]`; case-insensitive). Reject trailing dot or whitespace. Length cap 63 chars (leaves room for `__<uuid>` to stay under filename byte limits). Export as named function. Add 5 unit tests to Task 1 test file: valid id passes, id with `__` rejected, `NUL` (Windows reserved, case-insensitive) rejected, empty string rejected, length 64 rejected.
- **`claimTask` JSDoc (Task 2) MUST state explicitly:** "taskId is opaque to the file-bus and MAY contain `__` (the Telegram → agent tagging convention writes filenames as `<agentId>__<uuid>.json`; the file-bus treats the whole string as the taskId). The file-bus NEVER splits on `__`."
- **TaskId uniqueness contract (file-bus.ts file header JSDoc):** "TaskIds MUST be globally unique within the file-bus. Callers SHOULD use `crypto.randomUUID()` or equivalent 128-bit random IDs. Structured human-readable taskIds are permitted only if the caller guarantees global uniqueness; collisions surface as `already-claimed` rejections and may strand the second caller's task."
- **Scale migration trigger (Task 2 JSDoc):** "Phase 1 + Phase 2 layout is `tasks/{pending,claimed,resolved}/<agentId>__<taskId>.json` (flat). Migrate to per-agent subdirectory layout `tasks/pending/<agentId>/<taskId>.json` when any single agent's pending queue exceeds 200 files OR per-agent poll latency exceeds 100ms. Migration is an explicit Phase 6+ task, NOT automatic."

## Verification

```bash
cd runtime && npx tsc --noEmit && npx vitest run daemon/state-paths.test.ts daemon/file-bus.test.ts daemon/session-log.test.ts --coverage 2>&1 | tail -25
```

Expected:
- `tsc --noEmit` exits 0
- Vitest: `21 passed` (5 + 8 + 8)
- Coverage on `file-bus.ts`, `session-log.ts`, `state-paths.ts` each ≥80% lines
- No `console.error` output that isn't from the malformed-line skip test (which uses `vi.spyOn` to capture)
