---
phase: feature-phase-1-deferred-hardening
plan: 02
wave: 2
depends_on: [01]
context: .iago/plans/feature-phase-1-deferred-hardening/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1-deferred-hardening/02-atomic-rename-audit

## Goal

Resolve the open Garry-checklist item from `runtime/PHASE-1-EVIDENCE.md` line 246: "If there's a workaround, the upstream issue is filed AND the workaround documents the issue link (state-paths.ts atomicRename EEXIST destructive retry — documented in adversarial review files; PR #47 will file as GitHub issue with link)." PR #45 worked around this by reaching past `atomicRename` to use raw `fsp.rename` in `approval-bus.ts` CLAIM phase (line 350 source comment: "atomicRename's EEXIST recovery unlinks the destination and ..."). This is a load-bearing workaround that means the abstraction is leaky for at least one caller. Audit every `atomicRename` caller in `runtime/`, classify each as **race** (concurrent writer to same dest — destructive unlink+rename retry is safe; the loser's content was about to be replaced anyway) vs **stale-dest** (a stale file at dest must be replaced — destructive retry is safe AND that's the whole point) vs **collision-hazard** (a different writer's data at dest must NOT be destroyed — destructive retry corrupts; caller needs the `fail-on-EEXIST` semantics that approval-bus CLAIM needed). Land a per-caller decision + an explicit second variant (`atomicRenameStaleDest()` or rename the existing function to make the semantics legible). Update the JSDoc on `runtime/daemon/state-paths.ts` so every reader sees the classification matrix.

Sources: `runtime/PHASE-1-EVIDENCE.md` Garry deferred item; PR #41 review FORWARD #3 (telemetry counter for Windows-race window); PR #45 review (approval-bus workaround context).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/daemon/state-paths.ts` | Split `atomicRename` into two named variants OR add explicit `behavior: "race-tolerant" \| "stale-dest"` param; update JSDoc with classification matrix; OPTIONALLY add a telemetry counter for the Windows unlink-then-rename window (per PR #41 FORWARD #3) |
| edit | `runtime/daemon/state-paths.test.ts` | New tests for the variant API surface; classification regression tests |
| edit | `runtime/daemon/file-bus.ts` | Apply the classification verdict to `writeResolvedOutput`'s rename path |
| edit | `runtime/daemon/session-log.ts` | Apply the classification verdict to the HWM rename path |
| edit | `runtime/telegram/approval-bus.ts` | Either migrate the raw `fsp.rename` CLAIM workaround back to `atomicRename` (if classified as race-tolerant under new semantics) OR keep the raw call with a JSDoc pointer to the audit doc |
| create | `runtime/daemon/state-paths.md` | Companion doc — full audit table: file:line, caller name, classification (race / stale-dest / collision-hazard), rationale, chosen API |
| edit | `runtime/daemon/README.md` | Add Failure Modes entry referencing `state-paths.md` audit table |

## Tasks

### Task 1: Inventory every `atomicRename` caller

- **files:** `runtime/daemon/state-paths.md` (new — section 1: Inventory)
- **action:** Run `grep -rn "atomicRename\(" runtime/ --include="*.ts" | grep -v ".test.ts"` from `iago-os/`. Document every hit in `runtime/daemon/state-paths.md` § Inventory as a markdown table with columns: `File:line`, `Calling function`, `src arg`, `dst arg`, `Caller intent (in 1 sentence)`. Expected callers (from preliminary grep already in CONTEXT.md): `runtime/daemon/file-bus.ts:339` (`writeResolvedOutput` — tmp → resolved/<id>.json); `runtime/daemon/session-log.ts:392` (HWM publish — tmp → <handleId>.hwm.json); `runtime/telegram/approval-bus.ts:235` (PUBLISH pending tmp → pending/<id>.json); `runtime/telegram/approval-bus.ts:433` (PUBLISH resolved tmp → resolved/<id>.json). PLUS the raw `fsp.rename` workaround at `runtime/telegram/approval-bus.ts:350` (CLAIM unlink-via-rename). Include the bypass case explicitly so the audit covers it. Cross-reference each row's "intent" against PR #45's narrative (approval-bus.ts line 21-37 file header documents the original reasoning).
- **verify:** `grep -c "^| " runtime/daemon/state-paths.md`
- **expected:** Table contains ≥5 rows (4 atomicRename + 1 raw fsp.rename bypass). Each row has all 5 columns populated.

### Task 2: Classify each caller (race / stale-dest / collision-hazard)

- **files:** `runtime/daemon/state-paths.md` (section 2: Classification)
- **action:** For each Inventory row, decide the classification. Definitions:
  - **race** — multiple writers may legitimately compete for the same dest; destructive unlink+rename is acceptable because the "loser" of the rename race was about to be replaced anyway. Example: two concurrent task-resolution attempts from the same owner (rare — should be deduplicated upstream — but acceptable).
  - **stale-dest** — a stale file at dest must be replaced atomically; destructive retry is the desired behavior. Example: HWM publish (the old HWM IS stale by definition).
  - **collision-hazard** — a different writer's data at dest must NOT be destroyed (destructive retry would silently overwrite a legitimate concurrent winner). Example: approval-bus CLAIM phase — if a concurrent caller has already claimed the same approval id, our rename MUST fail-on-EEXIST so we know to give up. The current `atomicRename` is wrong for this case → that's why approval-bus uses raw `fsp.rename` directly.
  Write the rationale per row + the chosen API recommendation (`atomicRenameStaleDest()` for stale-dest + race; raw `fsp.rename` for collision-hazard; do NOT introduce a third variant unless an inventory row genuinely needs it).
- **verify:** `grep -c "race\|stale-dest\|collision-hazard" runtime/daemon/state-paths.md && grep -E "^(### |#### )" runtime/daemon/state-paths.md | wc -l`
- **expected:** Each Inventory row has exactly one classification. Section headers ≥2 (Inventory + Classification + Plan, plus subsections).

### Task 3: Implement the API split in state-paths.ts

- **files:** `runtime/daemon/state-paths.ts`
- **action:** Decision (locked by C1 in this plan's stress test): rename current `atomicRename` to `atomicRenameStaleDest` (since EVERY current caller using it is stale-dest or race, both safe under destructive retry). Keep `atomicRename` as a NEW exported function with **strict** semantics: `await fsp.rename(src, dst)` with NO EEXIST recovery — throws if dst exists. Both functions live in `state-paths.ts` with full JSDoc. Update file-header JSDoc (lines 1-23) to document the two-variant API + when to pick each + reference to `runtime/daemon/state-paths.md` audit doc. Preserve `getErrnoCode` behavior. Add `atomicRenameStaleDest` JSDoc explicitly: "destructive on Windows — if `dst` exists, unlink-then-rename; on POSIX the rename is atomic and overwrites by default." Add `atomicRename` JSDoc: "strict — throws EEXIST if `dst` exists (POSIX) or EPERM/EEXIST (Windows). Callers that need destructive overwrite MUST use `atomicRenameStaleDest`." Both functions are exported. No breaking change at the import site for the renamed function — but callers must update their import name.
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "^export async function atomicRename" daemon/state-paths.ts`
- **expected:** Two exports: `atomicRename` (strict, throw-on-EEXIST) and `atomicRenameStaleDest` (destructive retry on Windows). `tsc --noEmit` exits 0 — but BEFORE Task 4 runs, callers still importing the old name will fail to compile. Task 4 fixes them.

### Task 4: Migrate every caller to the right variant

- **files:** `runtime/daemon/file-bus.ts`, `runtime/daemon/session-log.ts`, `runtime/telegram/approval-bus.ts`
- **action:** Apply the Task 2 classification verdicts. For every classified `atomicRename` callsite, change the import + call to `atomicRenameStaleDest` if classified race / stale-dest. For the `approval-bus.ts` CLAIM workaround at line 350: it stays on raw `fsp.rename` BUT update its JSDoc to reference `runtime/daemon/state-paths.md` + cross-reference the new `atomicRename` (strict) export — since the CLAIM phase needs fail-on-EEXIST, a follow-up could migrate the workaround to `atomicRename` (the new strict variant) for vocabulary parity. Decision: migrate IF the strict variant gives identical semantics on Windows (since Windows' `fsp.rename` already throws EEXIST natively). Confirm via Task 5 test that strict `atomicRename` matches raw `fsp.rename` behavior on both platforms; if confirmed, update approval-bus.ts CLAIM to use the strict variant + delete the raw `fsp.rename` workaround. If platform behavior diverges, keep the raw workaround + document why.
- **verify:** `cd runtime && npx tsc --noEmit && grep -rn "atomicRename\(" runtime/ --include="*.ts" | grep -v ".test.ts" && grep -rn "atomicRenameStaleDest\(" runtime/ --include="*.ts" | grep -v ".test.ts"`
- **expected:** `tsc --noEmit` exits 0. `atomicRename(` strict-variant call-count matches the collision-hazard inventory rows (likely 1 if approval-bus CLAIM migrates back; 0 if it doesn't and stays on raw `fsp.rename`). `atomicRenameStaleDest(` call-count matches the race + stale-dest inventory rows (likely 4).

### Task 5: Tests for the two-variant API

- **files:** `runtime/daemon/state-paths.test.ts`
- **action:** Add a dedicated test suite `describe("atomicRename (strict) + atomicRenameStaleDest (destructive)")`. Tests: (1) `atomicRename` on POSIX where dst does NOT exist → succeeds; (2) `atomicRename` on POSIX where dst exists → throws EEXIST (use a sentinel file pre-created in beforeEach); (3) `atomicRename` on Windows where dst exists → throws EEXIST OR EPERM (use `process.platform === "win32"` skipIf); (4) `atomicRenameStaleDest` on POSIX where dst exists → succeeds, dst overwritten with src content (POSIX rename is atomic-overwrite by default); (5) `atomicRenameStaleDest` on Windows where dst exists → succeeds via unlink-then-rename (skipIf non-Windows); (6) `atomicRenameStaleDest` on Windows where dst does NOT exist → succeeds via direct rename; (7) `atomicRenameStaleDest` swallows EEXIST/EPERM ONLY — other errno (EACCES, ENOENT on src) re-throws; (8) regression: every former call-site of `atomicRename` that migrated to `atomicRenameStaleDest` still passes its own existing test (run `npx vitest run daemon/file-bus.test.ts daemon/session-log.test.ts telegram/approval-bus.test.ts` and confirm no regression).
- **verify:** `cd runtime && npx vitest run daemon/state-paths.test.ts daemon/file-bus.test.ts daemon/session-log.test.ts telegram/approval-bus.test.ts --reporter=verbose 2>&1 | tail -50`
- **expected:** All new state-paths tests pass (≥7 new). All downstream tests (file-bus 17, session-log 11, approval-bus N) still pass — no regression. The Windows skipIf tests skip cleanly on POSIX and vice versa.

### Task 6: Optional — atomic-rename window telemetry counter (PR #41 FORWARD #3)

- **files:** `runtime/daemon/state-paths.ts`, `runtime/daemon/telemetry.ts` (extend the discriminated union)
- **action:** PR #41 review FORWARD #3 requested "telemetry counter `state_paths_atomic_rename_window_ms` so we have actual data when Phase 7 decision arrives." Implementation: in `atomicRenameStaleDest`, when the destructive unlink-then-rename path fires on Windows, record `Date.now()` before unlink and after the second rename, emit a NEW telemetry event `{ kind: "atomic-rename-stale-dest-window", dst: <basename only — NO full path to avoid leaking state-root>, windowMs: <number>, platform: "win32" }` via `emit()` from `telemetry.ts`. Extend `DaemonEvent` discriminated union with the new kind. The emit is fire-and-forget (the telemetry helper already swallows errors); cost is bounded (rare on POSIX where rename is atomic, only fires on Windows EEXIST path). Document the new event kind in `runtime/daemon/telemetry.ts` header table. If telemetry emit risks recursion (e.g., telemetry writes call atomicRename → recursive event), guard via a module-private `inRecursiveEmit` flag. Realistically telemetry uses `fs.appendFile` not rename, so no recursion — verify by code inspection.
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "atomic-rename-stale-dest-window" daemon/telemetry.ts daemon/state-paths.ts`
- **expected:** New kind appears in both telemetry.ts (union member) and state-paths.ts (emit call). `tsc --noEmit` exits 0.

### Task 7: README pointer + Phase 1 evidence resolution

- **files:** `runtime/daemon/README.md`, `runtime/PHASE-1-EVIDENCE.md`
- **action:** Add a Failure Modes entry to `runtime/daemon/README.md` pointing readers to `runtime/daemon/state-paths.md` for the atomic-rename classification audit. In `runtime/PHASE-1-EVIDENCE.md`, update the Garry checklist at line 246 — change `[ ]` to `[x]` and replace the deferral note with: "Resolved by `runtime/daemon/state-paths.md` audit (Plan feature-phase-1-deferred-hardening/02). Two-variant API (`atomicRename` strict vs `atomicRenameStaleDest` destructive) replaces the leaky single-function abstraction. PR #45's raw `fsp.rename` workaround in approval-bus CLAIM phase either migrated to strict `atomicRename` (if behavior parity confirmed cross-platform) OR kept with explicit JSDoc reference to the audit doc."
- **verify:** `grep -c "state-paths.md" runtime/daemon/README.md && grep -c "feature-phase-1-deferred-hardening/02\|atomic-rename classification\|state-paths.md audit" runtime/PHASE-1-EVIDENCE.md`
- **expected:** Both files reference the audit doc. PHASE-1-EVIDENCE.md Garry-checklist row updated. README Failure Modes section grew by one entry.

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx vitest run --coverage 2>&1 | tail -40 \
  && grep -c "^| " ../runtime/daemon/state-paths.md \
  && grep -rn "atomicRename\(\|atomicRenameStaleDest\(" . --include="*.ts" | grep -v ".test.ts" | wc -l \
  && grep -c "state-paths.md" daemon/README.md
```

Expected:
- `tsc --noEmit` exits 0
- Full vitest suite passes (Phase 1 ~285 + new state-paths tests ≥292 total). No coverage regression in any file.
- state-paths.md table row count ≥5
- Combined atomicRename + atomicRenameStaleDest call-site count = original count (4) + any approval-bus CLAIM migration (1 → +1 if migrated; 0 if not)
- README references the audit doc

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — Naming inversion risk: keeping `atomicRename` as strict (throw-on-EEXIST) breaks every existing caller's import unless they update.** Task 3 says rename the existing destructive function to `atomicRenameStaleDest`. Task 4 then migrates every caller. **Risk:** if any caller is missed in Task 4, the strict `atomicRename` silently rejects on a stale dest where the old caller expected destructive overwrite — a regression with no compile error. **Fix:** make the rename + caller-migration atomic in a single commit. Use `grep -rn "atomicRename\b" runtime/` (with word boundary) BEFORE Task 4 to enumerate every caller, then update all of them in the same edit pass as Task 3's rename. The "Verify" after Task 4 must include a global search for any orphan `atomicRename(` call that didn't make the classification table — those are the missed migrations.
- **C2 — Approval-bus CLAIM phase migration: the "if behavior parity confirmed" hedge in Task 4 is a vague pass-through.** Make the decision binary in the plan: either (a) the strict `atomicRename` IS behaviorally identical to raw `fsp.rename` cross-platform (since Windows' `fsp.rename` already throws EEXIST natively, and POSIX `fsp.rename` overwrites by default — but POSIX caller wants throw-on-EEXIST behavior, which strict `atomicRename` provides via `wx`-flag-style pre-check); OR (b) it's NOT identical (POSIX `fsp.rename` does NOT throw on existing dst — it overwrites silently — so strict `atomicRename` MUST add a `lstat`-then-rename guard, which has its own race window). **Decision:** the strict `atomicRename` MUST be implemented as `try { await fsp.link(src, dst); await fsp.unlink(src); } catch (err) { ... fall back ... }` — `link(2)` is the only POSIX primitive that fails on existing dst without race, then unlinking the source completes the rename semantics. OR a simpler approach: pre-check via `fsp.stat(dst)` and throw EEXIST manually if it exists. The pre-check has a race window (a concurrent writer could create `dst` between the stat and the rename) — for approval-bus CLAIM, the race is between two callers trying to claim the same approval id, and the loser's stat-then-rename race is exactly the failure mode CLAIM needs to detect. The race window is tighter than the original `unlink+rename` window. Acceptable. Document the choice + the residual race in JSDoc.

### Important (forward to impl, don't block)

- **I1 — `atomicRenameStaleDest` Windows EEXIST window IS still a hazard for some callers.** The audit Task 2 may classify HWM publish as stale-dest but the daemon could theoretically have two concurrent HWM writes for the same handleId (e.g., two parallel `appendEvent` calls on the same handleId that both update HWM). The session-log file-lock prevents this in single-process, but a multi-process daemon (Plan 07 IPC server may proxy across processes in the far future) would expose it. **Mitigation:** document in the Classification table that "stale-dest" assumes single-process; multi-process callers MUST coordinate via file-lock before calling. Acceptable for Phase 1.
- **I2 — Telemetry counter (Task 6) is OPTIONAL — the plan should make the trigger explicit.** Task 6 is optional. The trigger to implement it: if any Inventory row's classification is "race" (not stale-dest) AND the caller is Windows-active. Without race callers, the telemetry counter has no signal to produce. Plan 02 default: implement the counter — it costs almost nothing and pays off in Phase 7 when the Windows race decision arrives. Move from optional to mandatory in the implementer forward-list.
- **I3 — `runtime/daemon/state-paths.md` is a new component doc — confirm it lives next to source, not under `docs/`.** Per `runtime/CONTEXT.md` outputs table convention + the existing `runtime/agent-runtime/pty/claude-pty.md` precedent, component docs colocate with source. `runtime/daemon/state-paths.md` is correct. Just confirm no symlink magic or path overrides break the find.

### Minor

- M1 — Task 1's `grep -rn "atomicRename\("` will also match `atomicRenameStaleDest(` once Task 3 renames. Inventory should run BEFORE Task 3. Sequence the impl: Task 1 + 2 (read-only audit) → Task 3 (API change) → Task 4 (caller migration) → Task 5 (tests) → Task 6 (telemetry) → Task 7 (docs). Task ordering in the plan is correct.
- M2 — `runtime/daemon/state-paths.md` is a new file; ensure it lands in the PR diff. Add to the verify command a `ls runtime/daemon/state-paths.md` existence check.
- M3 — Verify command uses `cd runtime` then references `../runtime/daemon/state-paths.md` — typo. Should be `daemon/state-paths.md` after the `cd`. Fix in impl.

### Dimension-by-dimension verdicts

- **Precision:** Task descriptions enumerate every file + grep pattern + decision criterion.
- **Edge cases:** C1 (silent regression on missed migration), C2 (POSIX `fsp.rename` overwrite-by-default), I1 (multi-process future hazard), I2 (telemetry trigger logic) cover the four non-obvious failure modes.
- **Contradictions:** Plan claims "back-compat" in CONTEXT.md but renames a function. Resolution: back-compat means semantic preservation per-callsite (every caller's behavior after migration is identical to before — because every existing call IS stale-dest semantics). The function name changes; the behavior at each site is preserved. Document the renaming as "API ergonomics: making the two distinct semantics nameable" in the state-paths.ts file header.
- **Simpler alternatives:** Could keep one function + add a boolean param `(src, dst, { overwrite: true })`. REJECTED — readers seeing `atomicRename(src, dst)` at a callsite still don't know which semantic they're getting without jumping to the call. Named variants are self-documenting.
- **Missing acceptance criteria:** Task 7 closes the PHASE-1-EVIDENCE.md Garry-deferred item. Task 5 covers all classification cases. Task 4 migrates every caller. The audit table itself (state-paths.md) IS the deliverable for the deferred item.

### Implementer forward-list

1. Atomic rename + caller migration in single commit; global grep with word boundary after migration (C1 fix).
2. Implement strict `atomicRename` via POSIX `stat`-then-`rename` (acknowledge residual race in JSDoc) OR `link`+`unlink` pattern; pick the simpler one if both give CLAIM the failure mode it needs (C2 fix).
3. Document "stale-dest assumes single-process" in Classification table (I1 fix).
4. Implement Task 6 telemetry counter unconditionally (I2 fix — move from optional to mandatory).
5. Add `ls runtime/daemon/state-paths.md` to the verification matrix (M2 fix).
6. Fix the `cd runtime` → `daemon/state-paths.md` path typo in verify command (M3 fix).
