---
phase: feature-phase-2-vps-bootstrap
plan: 06
wave: 3
depends_on: [01b, 03b]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-17
updated: 2026-05-18
source: feature
---

# Plan: feature-phase-2-vps-bootstrap/06-sighup-credential-reload

## Goal

Close migration-scope § 13.3 gap row "Daemon SIGHUP handler for credential reload (§2)" — flagged Phase-2 BLOCKING per OQ17 ("YES — list in §13.3 gap | Phase 2 blocked"). Added during pre-merge adversarial review C3 fix to PR #47. Without this, rotating a credential (Telegram token, GH PAT, future Anthropic profile keys) requires `systemctl restart iago-os-v2-daemon.service` — interrupts in-flight Claude PTY sessions + drops the IPC socket + breaks the 30-min stay-at-keyboard monitoring window. Three deliverables: (1) SIGHUP signal handler in `runtime/daemon/main.ts` that re-invokes `loadSystemdCredentials()` + emits `cred-reload-fired` telemetry; (2) Vitest tests for the handler (mock signals + spy on telemetry emit); (3) operational doc in `runtime/daemon/README.md` documenting the reload pattern + `systemctl kill -s SIGHUP iago-os-v2-daemon.service` invocation. Source of truth: `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 13.3 (gap row) + OQ17 + `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 2 (Anthropic auth migration referencing the reload pattern).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/daemon/main.ts` | Register `process.on('SIGHUP', ...)` handler in `startDaemon` |
| create | `runtime/daemon/sighup.test.ts` | Vitest tests for SIGHUP handler (mock signals + telemetry spy) |
| edit | `runtime/daemon/README.md` | Add operational section on credential reload via SIGHUP |

## Tasks

### Task 1: Register SIGHUP handler in startDaemon

- **files:** `runtime/daemon/main.ts`
- **action:** Edit `startDaemon()` AFTER the existing shutdown-signal registration block (the SIGTERM + SIGINT handlers) and AFTER the initial `loadSystemdCredentials()` call (Plan 01 Task 7). Add: `process.on('SIGHUP', async () => { ... })`. Handler body: (1) capture the set of `process.env` keys-of-interest BEFORE re-invocation (the same envVar names listed in `cred-bootstrap.ts` CREDENTIALS array — `IAGO_TELEGRAM_BOT_TOKEN`, `GH_TOKEN`, plus any Phase 3 commented-out entries that have been activated); (2) call `loadSystemdCredentials()` again — the helper already handles the "env-var override beats credential" precedence per Plan 01 spec, so re-invocation is safe (it will not overwrite an explicit override); (3) compute the set of envVars that CHANGED (value before vs after); (4) emit NDJSON telemetry event `{ kind: "cred-reload-fired", credentialsReloaded: [<names of envVars that changed>], unchanged: [<names that were re-read but value identical>], errors: [<envVar names where read failed>] }` — NAMES only, never values (matches Plan 01 Task 4 C2 spec posture); (5) if ANY change happened, log via `console.error` (which routes to journal) "SIGHUP reload: <N> credential(s) updated. Restart in-flight agents to pick up new values." (the daemon does NOT auto-restart agents — that's an operational decision Santiago makes per agent); (6) wrap the entire handler body in try/catch — on error, emit `cred-reload-failed { error: String(err) }` telemetry but DO NOT crash the daemon (SIGHUP is informational; a failed reload leaves the daemon running with old credentials, which is safer than killing it). The handler must be async-aware: if a previous SIGHUP is still in flight, queue (or drop with a `cred-reload-debounced` event) — pick "drop" for Phase 2 simplicity, document in README. Add JSDoc above the handler explaining: "SIGHUP triggers re-load of systemd-creds files into process.env. Send via `systemctl kill -s SIGHUP iago-os-v2-daemon.service`. Does NOT auto-restart in-flight agents — operator decides per agent." Total addition: 30-60 LOC.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "SIGHUP|cred-reload-fired" daemon/main.ts`
- **expected:** `tsc --noEmit` exit 0. Both `SIGHUP` and `cred-reload-fired` appear in main.ts.

### Task 2: Author sighup.test.ts (Vitest, mock signals + telemetry spy)

- **files:** `runtime/daemon/sighup.test.ts`
- **action:** Vitest test file. Setup: spawn `startDaemon` in-process (or import the handler as a named export — Task 1 should `export function registerSighupHandler(deps): () => void` so tests can import it directly without spinning up a full daemon; this is the cleanest path). Mock `loadSystemdCredentials` via `vi.mock('./cred-bootstrap.js', ...)`. Mock telemetry emitter (Phase 1 telemetry contract — `import { emit } from './telemetry.js'` or whatever the existing export is). Test cases (≥5 mandatory): (1) SIGHUP received → `loadSystemdCredentials` is invoked exactly once → `cred-reload-fired` telemetry emitted; (2) SIGHUP changes `IAGO_TELEGRAM_BOT_TOKEN` value → `credentialsReloaded` array contains `"IAGO_TELEGRAM_BOT_TOKEN"`; (3) SIGHUP with no actual changes (file unchanged) → `credentialsReloaded` is empty, `unchanged` array has entries → telemetry emitted with both fields; (4) `loadSystemdCredentials` throws → `cred-reload-failed` telemetry emitted with the stringified error → daemon process is NOT killed (assert process is still running via a sentinel after the throw); (5) Two SIGHUPs fired in rapid succession while the first is mid-await → second is dropped, `cred-reload-debounced` telemetry emitted. Use `vi.spyOn(process, 'emit')` or call `process.emit('SIGHUP')` directly to simulate the signal. NO `any`, NO `as` casts. File 150-280 lines.
- **verify:** `cd runtime && npx vitest run daemon/sighup.test.ts --coverage --reporter=verbose 2>&1 | tail -25`
- **expected:** All ≥5 tests pass. Coverage on the new SIGHUP handler in `main.ts` ≥80% lines, ≥80% branches.

### Task 3: Operational doc in runtime/daemon/README.md

- **files:** `runtime/daemon/README.md`
- **action:** Append a new section "## Reloading credentials without restart (SIGHUP)" to the existing README. Content: (1) When to use — "After rotating a secret in 1Password + running `provision-credentials.sh <name>` (which updates the systemd-creds file but does NOT touch the running daemon's process.env). Sending SIGHUP causes the daemon to re-read all systemd-creds files into process.env. Safer than `systemctl restart` because it preserves in-flight Claude PTY sessions, the IPC socket binding, and the 30-min post-cutover stay-at-keyboard monitoring window."; (2) Invocation — exact command: `systemctl kill -s SIGHUP iago-os-v2-daemon.service` (run on VPS via `tailscale ssh root@srv1456441 -- 'systemctl kill -s SIGHUP iago-os-v2-daemon.service'`); (3) Verification — `tailscale ssh root@srv1456441 -- 'journalctl -u iago-os-v2-daemon.service --since "1 minute ago" --no-pager | grep cred-reload-fired'` should show one event line with `credentialsReloaded` populated; (4) Behavior — names only in telemetry (never values); old override env vars (set explicitly before daemon start) win over reloaded credentials per Plan 01 Task 4 precedence; in-flight agents continue running with their inherited (now-stale) env until the operator restarts them per-agent (no auto-restart); (5) Failure modes — `cred-reload-failed` event indicates the helper threw (e.g., a credstore file became unreadable mid-rotation); daemon continues running with old credentials; rapid double-SIGHUP results in `cred-reload-debounced` (the second is dropped, the first completes). Add to the README's top-of-file TOC if one exists. Section adds 40-80 lines.
- **verify:** `wc -l runtime/daemon/README.md && grep -c "SIGHUP\|cred-reload" runtime/daemon/README.md`
- **expected:** Line count up by 40-80 vs the pre-edit version. ≥3 `SIGHUP` references and ≥3 `cred-reload` references.

### Task 4: Cross-reference from cutover-runbook

- **files:** `runtime/migration/02-cutover-runbook.md` (cross-plan edit; runbook authored by Plan 03)
- **action:** Add to the "Post-cutover required actions" section (or wherever the 30-min monitoring guidance lives) a single checkbox: `- [ ] Confirm SIGHUP reload path works: rotate a benign credential (or simulate by re-running provision-credentials.sh) + `tailscale ssh root@srv1456441 -- 'systemctl kill -s SIGHUP iago-os-v2-daemon.service'` + `journalctl ... | grep cred-reload-fired`. Documented in runtime/daemon/README.md § Reloading credentials without restart (SIGHUP).`. Total addition: 3-5 lines.
- **verify:** `grep -F 'cred-reload-fired' runtime/migration/02-cutover-runbook.md`
- **expected:** ≥1 hit referencing the SIGHUP verification checkbox.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/sighup.test.ts --coverage --reporter=verbose 2>&1 | tail -25 \
  && cd .. \
  && grep -c "SIGHUP\|cred-reload" runtime/daemon/README.md \
  && grep -F 'cred-reload-fired' runtime/migration/02-cutover-runbook.md
```

Expected:
- `tsc --noEmit` exit 0
- `sighup.test.ts` ≥5 tests pass; ≥80% coverage on new handler
- README has ≥6 SIGHUP/cred-reload references
- cutover-runbook has ≥1 SIGHUP verification checkbox

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (added during pre-merge adversarial review C3 fix to close migration-scope § 13.3 SIGHUP gap)

### Critical (must fix in impl)

- **C1 — SIGHUP handler must not race with daemon-shutdown.** If SIGHUP arrives during `startDaemon`'s SIGTERM handler (operator runs `systemctl restart` and a SIGHUP happens to fire in the same tick), the cred-reload may run against a partially-torn-down telemetry pipeline → silent telemetry loss. **Fix:** Add an `isShuttingDown` boolean flag (the existing SIGTERM handler already needs one if it doesn't have one; check `runtime/daemon/main.ts` for the pattern); SIGHUP handler returns early with `console.error("SIGHUP ignored: daemon is shutting down")` if `isShuttingDown` is true. Test case (6 — add to Task 2): SIGHUP fired after SIGTERM → handler returns without calling `loadSystemdCredentials`; no telemetry emitted.
- **C2 — `process.env` mutation visibility to in-flight child processes.** Reloading credentials updates the DAEMON's `process.env` but in-flight spawned children (claude-pty agents) inherited the OLD env at spawn time. SIGHUP does NOT propagate to them. **Fix:** Document this loudly in BOTH the Task 1 JSDoc AND the Task 3 README section: "SIGHUP updates the DAEMON's process.env ONLY. Spawned agents inherited env at spawn time; they continue with old credentials until restarted per-agent. The daemon does NOT auto-restart agents on SIGHUP. To force an agent to pick up new credentials, restart it via the existing agent-restart pattern." The README must include the exact agent-restart command if Phase 1 ships one (check `runtime/agent-runtime/` for the pattern; if absent, defer the command to Phase 3 and document the gap).

### Important (forward to impl, don't block)

- **I1 — Debounce strategy choice (drop vs queue).** Task 1 picks "drop" for Phase 2 simplicity. Alternative: queue with a 1s debounce window (collapse rapid SIGHUPs into one reload). **Fix:** Drop is correct for Phase 2 (operator-driven SIGHUPs are not rapid); flag in README § 5 that if a Phase 3+ use case emerges (e.g., a credential-rotator daemon that fires SIGHUP on every rotate), reconsider with queue-based debouncing. Adds 0 LOC to Phase 2 plan.
- **I2 — Telemetry event naming consistency.** Phase 1 events use lowercase-hyphen kinds (`daemon-start`, `cred-bootstrap-loaded`). New events: `cred-reload-fired`, `cred-reload-failed`, `cred-reload-debounced` — match the pattern. Confirm via grep over `runtime/daemon/telemetry-events.md` (if exists) that no naming collision.
- **I3 — SIGHUP is Unix-only.** On Windows the daemon can't be SIGHUP'd because Windows has no SIGHUP signal. Phase 2 VPS is Linux (Debian 13) so production is fine; local-dev on Windows can simulate via... actually, Node on Windows does receive `SIGHUP` events through console-control-handler-mapping (Ctrl+Break maps to SIGBREAK, not SIGHUP). **Fix:** Document in Task 3 README that SIGHUP is Linux-only (production behavior); on Windows local-dev, the test suite (Task 2) exercises the handler via `process.emit('SIGHUP')` directly, bypassing the OS signal layer. This is sufficient for testing.

### Minor

- M1 — The cutover-runbook cross-edit (Task 4) is a Plan 03 file. Per pre-merge adversarial review I3 finding (cross-plan edits = coupling), this counts as Plan 06 coupling to Plan 03. Since both plans are wave-2 (depends_on chains converge at wave 1), the dispatcher can sequence them. If the build fails because Plan 03 hasn't yet shipped `02-cutover-runbook.md`, Task 4 should fail loudly with "Plan 03 not landed: 02-cutover-runbook.md missing" rather than silently creating a fresh file.
- M2 — `cred-reload-fired` telemetry could include a hash of the new credential value (not the value itself) so post-rotation audits can verify the daemon picked up the right value. REJECTED for Phase 2 — adds crypto dep + complexity; defer to Phase 8 cost-ledger work where credential hashes may surface anyway for audit-trail purposes.

### Dimension-by-dimension verdicts

- **Precision:** All 4 tasks have file paths + actions + verify + expected. Cross-plan edit (Task 4) flagged explicitly with fail-loud guidance.
- **Edge cases:** C1 (shutdown race) + C2 (in-flight agent env staleness) cover the non-obvious failures. I3 (Windows signal semantics) documented.
- **Contradictions:** Plan 06 owns SIGHUP handler; Plan 01 owns `loadSystemdCredentials` (the function the handler invokes). No code duplication. Cross-plan dependency on Plan 01 cred-bootstrap.ts encoded via `depends_on: [01]` frontmatter.
- **Simpler alternatives:** Could rely on `systemctl restart` for credential rotation. REJECTED per goal — restart interrupts in-flight sessions + 30-min monitoring. Could use `systemctl reload` if the unit file supported `ExecReload=`. REJECTED — SIGHUP via `kill` is simpler + matches the spec's OQ17 phrasing. Could use a credential-watching `fs.watch` on `/etc/credstore.encrypted/` to auto-reload. REJECTED — adds complexity for a rarely-fired event; operator-driven SIGHUP is the floor.
- **Missing acceptance criteria:** Plan 06 closes migration-scope § 13.3 SIGHUP gap row (Phase-2 BLOCKING per OQ17). Plan 05 verification gate should grep `runtime/daemon/main.ts` for `SIGHUP` AND `runtime/daemon/sighup.test.ts` existence + passing — add to Plan 05 Task 2 `check-evidence.mjs --phase 2` block list. (This is a forward note; Plan 05 owns its own implementation.)

### Implementer forward-list

1. Add `isShuttingDown` flag check at top of SIGHUP handler + add Task 2 test case 6 (C1 fix).
2. Document in Task 1 JSDoc AND Task 3 README that SIGHUP does NOT propagate to spawned children (C2 fix). Include agent-restart command if Phase 1 ships one; if not, defer with explicit Phase 3 link.
3. Confirm `cred-reload-fired` / `cred-reload-failed` / `cred-reload-debounced` naming doesn't collide with Phase 1 telemetry-event.md inventory (I2 fix).
4. Task 4 cross-edit fails loud with "Plan 03 not landed" if cutover-runbook missing (M1 fix).
5. Plan 05 forward: add SIGHUP handler presence to check-evidence.mjs block list (forward note; Plan 05 owns).
