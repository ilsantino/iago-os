---
phase: feature-v2-phase-1-daemon
plan: 04
wave: 2
depends_on: [01, 02]
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/04-shape1-pty-claude-adapter

## Goal

Ship the Shape 1 PTY adapter for Claude Code: `runtime/agent-runtime/pty/claude-pty.ts`. Spawns a pseudo-terminal subprocess running `claude`, parses prompt/status output against pinned golden transcripts, fails closed on unknown parse, exposes `inject()` for PTY-specific stdin writes, returns unsubscribe fns from `onStatusChanged`, integrates two-phase session.jsonl replay in `restoreFromMarker`. Version pinning is mandatory — the adapter declares a supported Claude Code version range, ships conformance tests with captured transcripts, and treats unknown prompts as crashes (triggering restart) rather than guessing.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/agent-runtime/pty/claude-pty.ts` | Shape 1 PTY adapter implementing `AgentRuntime` |
| create | `runtime/agent-runtime/pty/prompt-parser.ts` | Prompt/status parser keyed on golden transcripts; fail-closed on unknown |
| create | `runtime/agent-runtime/pty/version-pin.ts` | Declared supported Claude Code version range + check |
| create | `runtime/agent-runtime/pty/golden-transcripts/README.md` | Format spec for golden transcripts; capture instructions |
| create | `runtime/agent-runtime/pty/golden-transcripts/claude-code-running.jsonl` | Captured prompt/status events from a known-good Claude run (the "running" state) |
| create | `runtime/agent-runtime/pty/golden-transcripts/claude-code-idle.jsonl` | Captured events for the "idle" (awaiting input) state |
| create | `runtime/agent-runtime/pty/golden-transcripts/claude-code-exited.jsonl` | Captured events for clean exit |
| create | `runtime/agent-runtime/pty/claude-pty.test.ts` | Unit tests with mocked PTY (no real subprocess) |
| create | `runtime/agent-runtime/pty/prompt-parser.test.ts` | Parser tests against golden transcripts + unknown-parse fail-closed |
| create | `runtime/agent-runtime/pty/claude-pty.md` | Adapter docs: version pinning policy, golden transcript format, fail-closed parse behavior, inject() semantics |

## Tasks

### Task 1: Declare version pin

- **files:** `runtime/agent-runtime/pty/version-pin.ts`
- **action:** Export `const SUPPORTED_CLAUDE_CODE_VERSION_RANGE = ">=1.0.0 <2.0.0"` (npm semver range — adjust to actual Claude Code version when capturing the first golden transcript). Export `async getClaudeCodeVersion(): Promise<string>` that runs `claude --version` via `child_process.spawn` (NOT the PTY) and parses the stdout for a semver string (regex `/(\d+\.\d+\.\d+)/`). Export `async assertSupportedVersion(): Promise<{ ok: true; version: string } | { ok: false; reason: "unsupported" | "not-installed" | "parse-failure"; detail: string }>` that calls `getClaudeCodeVersion`, then uses the `semver` npm package (add to runtime/package.json dependencies) to check against `SUPPORTED_CLAUDE_CODE_VERSION_RANGE`. Add `semver: "^7.6.0"` to `runtime/package.json` dependencies and `@types/semver: "^7.5.0"` to devDependencies.
- **verify:** `cd runtime && npm install && npx tsc --noEmit && grep -c "SUPPORTED_CLAUDE_CODE_VERSION_RANGE\|assertSupportedVersion" agent-runtime/pty/version-pin.ts`
- **expected:** `tsc --noEmit` exits 0. Symbols appear ≥4 total occurrences (declaration + uses).

### Task 2: Document + capture golden transcripts

- **files:** `runtime/agent-runtime/pty/golden-transcripts/README.md`, `runtime/agent-runtime/pty/golden-transcripts/claude-code-running.jsonl`, `runtime/agent-runtime/pty/golden-transcripts/claude-code-idle.jsonl`, `runtime/agent-runtime/pty/golden-transcripts/claude-code-exited.jsonl`
- **action:** Write README.md describing the format: each `.jsonl` file is a sequence of `{ at: <ms-since-spawn>, kind: "stdout" | "stderr" | "exit", data: <string|number> }` events. Each transcript represents one canonical PTY interaction. README documents the capture procedure: "Run `claude` in a real PTY, pipe stdout/stderr to JSONL via the helper script at `scripts/capture-claude-transcript.sh` (lands in plan 07 if not already present), commit the result here. Re-capture when bumping the supported version range." Capture three transcripts: (1) `claude-code-running.jsonl` — spawn claude, send a prompt that triggers a tool call, capture ~3 seconds; (2) `claude-code-idle.jsonl` — spawn claude, observe the initial idle prompt with no input, ~1 second; (3) `claude-code-exited.jsonl` — spawn claude, send `/exit` (or whatever the canonical exit command is in the pinned version), capture until exit code event. **Note: these may be empty placeholder files in the initial PR if Santiago hasn't captured them yet — the test suite must skip parser-vs-golden tests with `.skipIf(...)` when the transcript file is empty, NOT fail the build. Capture is a manual step Santiago performs ONCE per supported version; the README documents that step.** README also documents the format invariants and the recapture command. README 60-100 lines.
- **verify:** `ls runtime/agent-runtime/pty/golden-transcripts/ | sort && wc -l runtime/agent-runtime/pty/golden-transcripts/README.md`
- **expected:** Lists exactly: `README.md`, `claude-code-exited.jsonl`, `claude-code-idle.jsonl`, `claude-code-running.jsonl`. README line count 60-100.

### Task 3: Implement prompt parser with fail-closed semantics

- **files:** `runtime/agent-runtime/pty/prompt-parser.ts`
- **action:** Export `parseStatusFromOutput(chunks: string[]): { status: StatusValue; matchedPattern: string | null }`. Maintain an ordered array of `KnownPattern[]` (exported as `KNOWN_PATTERNS`) where each pattern is `{ status: StatusValue; regex: RegExp; description: string }`. Patterns to seed (refine when golden transcripts are captured): (1) `running` — matches typical tool-execution markers Claude emits (e.g., `/⏵ /` or `/Running tool:/i` — placeholder; adjust to actual captured patterns); (2) `idle` — matches Claude's REPL prompt (e.g., `/\nHuman: /` at end of buffer); (3) `exited` — matches `/Session ended/i` or exit code line; (4) `crashed` — matches `/Error: /` followed by stack trace pattern. Concatenate chunks into a single buffer (keep last 4 KB for matching), iterate patterns in order, return first match. **If no pattern matches AND the buffer is >100 bytes of non-whitespace, return `{ status: "unknown", matchedPattern: null }` — the caller (claude-pty.ts) treats unknown as crash.** This is the fail-closed behavior. Document at file top: "Fail-closed means we trigger restart rather than guessing the agent's state. Adding patterns requires capturing a fresh golden transcript and verifying the pattern matches it via the test suite."
- **verify:** `cd runtime && npx tsc --noEmit && grep -c "KNOWN_PATTERNS\|parseStatusFromOutput" agent-runtime/pty/prompt-parser.ts`
- **expected:** `tsc --noEmit` exits 0. Symbol occurrences ≥4.

### Task 4: Write prompt-parser tests against golden transcripts

- **files:** `runtime/agent-runtime/pty/prompt-parser.test.ts`
- **action:** Tests: (1) Feed concatenated `claude-code-running.jsonl` stdout chunks → assert parser returns `status: "running"` (test skipped via `it.skipIf(!hasContent("claude-code-running.jsonl"))` if file is empty placeholder); (2) Same for `idle` and `exited` golden transcripts; (3) Feed obviously-unknown output (`"completely unrelated noise XYZ"` >100 bytes) → assert `status: "unknown"`; (4) Feed <100 bytes of whitespace → assert no false-positive `unknown` (return previous status hint or `idle`); (5) `KNOWN_PATTERNS` array is non-empty and every entry has a non-empty `description`; (6) Patterns are evaluated in order (test priority: a buffer matching both `crashed` and `idle` patterns returns `crashed`). Add `hasContent(file: string): boolean` test helper that returns `fs.statSync(file).size > 0`. File <200 lines.
- **verify:** `cd runtime && npx vitest run agent-runtime/pty/prompt-parser.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** All 6 tests pass OR pass-with-skip when golden files are placeholders; output contains `passed` (no `failed`).

### Task 5: Implement claude-pty adapter

- **files:** `runtime/agent-runtime/pty/claude-pty.ts`
- **action:** Add `node-pty: "^1.0.0"` to runtime/package.json dependencies. Export `const claudePty: AgentRuntime` object (named export) with: `shape: "pty"`, `id: "claude-pty"`, `version: "0.1.0"`, `interfaceVersion: "v1"`. Implementation: maintain a module-scope `Map<handleId, { ptyProcess: IPty; statusListeners: Set<StatusCallback>; lastStatus: StatusValue; lastStatusChangeMs: number; outputBuffer: string[]; sessionId: string; agentId: string; markerPath: string; generationToken: number }>`. `spawn(opts)`: check `assertSupportedVersion()` first — if not ok, throw `Error("claude-pty: unsupported Claude Code version: <detail>")`; use `node-pty` to spawn `claude` with `cwd: opts.cwd`, `env: opts.env`, `cols: 200`, `rows: 50`; generate handleId = `crypto.randomUUID()`; subscribe to `ptyProcess.onData` accumulating chunks into outputBuffer, every 250ms call `parseStatusFromOutput`; on status change emit to all listeners + `appendEvent(handleId, { kind: "status", status, at })` to session-log; on `unknown` status, emit `crashed` to listeners and write `.daemon-stop` marker via `writeStopMarker(handleId, "crash")`; subscribe to `ptyProcess.onExit` emitting `exited`. Return `AgentHandle`. `send(handle, message)`: handle each kind — `prompt`/`inject` writes `message.payload.text + "\n"` to `ptyProcess.write`; `abort` sends Ctrl-C (`"\x03"`); `approval` ignored (file-bus handles approvals, not PTY); `custom` ignored (logs warning). `onStatusChanged(handle, cb)`: adds to `statusListeners`, returns `() => { statusListeners.delete(cb) }` unsubscribe fn. `isAlive(handle)`: returns `ptyProcess.pid !== undefined && !ptyProcess.killed`. `shutdown(handle, signal = "SIGTERM")`: `ptyProcess.kill(signal)`; if `signal === "SIGTERM"`, set 30s timer that escalates to `ptyProcess.kill("SIGKILL")` if still alive; clears state from internal map. `restoreFromMarker(markerPath)`: reads marker JSON; calls `getHWM(handleId)`; if no HWM stored, returns null (cannot resume without HWM); spawns a fresh PTY with the same `cwd`/`env`/`sessionId`/`agentId`; uses `ReplayController.pauseIntake` → iterates session.jsonl events up to HWM, re-sending `prompt` and `inject` events via `ptyProcess.write` → `resumeIntake`; returns the new handle with incremented `generationToken`. Export also `inject(handle, text)` as a separate named export for PTY-specific stdin writes (delegates to `send` with `kind: "inject"`). On module load, call `registerRuntime(claudePty)` so the adapter is available at boot.
- **verify:** `cd runtime && npm install && npx tsc --noEmit && grep -E "^export (const|async function|function)" agent-runtime/pty/claude-pty.ts`
- **expected:** `tsc --noEmit` exits 0. Exports include `claudePty` and `inject`.

### Task 6: Write claude-pty adapter Vitest tests (mocked PTY)

- **files:** `runtime/agent-runtime/pty/claude-pty.test.ts`
- **action:** Mock `node-pty` via `vi.mock("node-pty", () => ({ spawn: vi.fn() }))`. Build a mock IPty fixture that exposes `.onData(cb)`, `.onExit(cb)`, `.write(text)`, `.kill(signal)`, `.pid`, `.killed`. Mock `version-pin.assertSupportedVersion` to return `{ ok: true, version: "1.0.0" }` for the happy path; one test exercises the unsupported-version error path. Tests: (1) `spawn` with valid version → returns handle, calls node-pty spawn with correct cwd/env; (2) `spawn` with unsupported version → throws with `"unsupported Claude Code version"` in message; (3) `send` with `kind: "prompt"` → calls `ptyProcess.write` with text + newline; (4) `send` with `kind: "inject"` → same write; (5) `send` with `kind: "abort"` → writes `"\x03"`; (6) `send` with `kind: "approval"` → no write (assert mock not called); (7) `onStatusChanged` returns unsubscribe fn that, when called, removes the listener (subsequent status changes don't fire it); (8) `isAlive` returns true while pid is set, false when killed; (9) `shutdown(handle, "SIGTERM")` calls kill SIGTERM; after 30s (use fake timers) escalates to SIGKILL if still alive; (10) PTY emits stdout matching `idle` golden pattern → handle's listeners receive `("idle", undefined)`; (11) PTY emits unknown content >100 bytes → handle's listeners receive `("crashed", undefined)` AND `.daemon-stop` marker written with `reason: "crash"`. File <500 lines. Reset runtime registry in beforeEach.
- **verify:** `cd runtime && npx vitest run agent-runtime/pty/claude-pty.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** All 11 tests pass.

### Task 7: Write claude-pty.md adapter docs

- **files:** `runtime/agent-runtime/pty/claude-pty.md`
- **action:** Document: (1) Purpose — "Shape 1 PTY adapter for Claude Code"; (2) Version pinning policy — `SUPPORTED_CLAUDE_CODE_VERSION_RANGE` in version-pin.ts; how to bump it (recapture golden transcripts, update range, run conformance tests); (3) Golden transcript format — `.jsonl` of `{at, kind, data}` events; capture procedure documented in `golden-transcripts/README.md`; (4) Fail-closed parse behavior — unknown prompt → "crashed" → marker → restart by agent-manager; rationale: silent misinterpretation is worse than a restart; (5) `inject()` semantics — writes raw text + newline to PTY stdin; PTY-only (other shapes don't support it; daemon's Telegram `/inject` command checks `runtime.shape === "pty"` before invoking); (6) `restoreFromMarker` flow — requires stored HWM; two-phase replay via session.jsonl; only `prompt` and `inject` events are re-fed; `approval`/`abort`/`custom` skipped (those are application-level); (7) Failure modes — Claude binary missing → spawn fails fast with clear error; unsupported version → spawn throws; stale prompt (parser timeout) → fail-closed restart; PTY crash mid-session → onExit fires `crashed`; (8) Known limitations — Windows uses ConPTY via node-pty; behavioral parity with Linux PTY is high but Santiago should re-capture transcripts on Windows if behavior diverges. File 120-200 lines.
- **verify:** `wc -l runtime/agent-runtime/pty/claude-pty.md && grep -c "^##" runtime/agent-runtime/pty/claude-pty.md`
- **expected:** Line count 120-200. Heading count ≥7.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Critical precision

- **PR1 (Critical) — Wrong version range blocks installed Claude Code 2.1.113.** Plan Task 1 specifies `SUPPORTED_CLAUDE_CODE_VERSION_RANGE = ">=1.0.0 <2.0.0"`. Santiago's actual installed version is 2.1.113. `assertSupportedVersion()` returns `{ ok: false, reason: "unsupported" }` on first run, blocking every `spawn()` immediately. **Fix:** change the default range to `">=2.0.0 <3.0.0"`. The hello-world (Plan 07) won't run otherwise.

### Critical contradictions

- **C1 (Critical) — `PTYAdapter` type not defined.** ADR § Architecture impact: "The Shape-1-specific `PTYAdapter` interface (with `inject` method) extends `AgentRuntime` with PTY-specific affordances." Vision spec § Shape 1 detail shows `interface PTYAdapter` with `inject` as a first-class method. Plan 04 exports `claudePty: AgentRuntime` + a free `inject` function. **Fix:** in `runtime/agent-runtime/pty/types.ts` (or directly in `claude-pty.ts`), define `export interface PTYAdapter extends AgentRuntime { shape: "pty"; inject(handle: AgentHandle, text: string): Promise<void> }`. Export `claudePty: PTYAdapter` (not bare `AgentRuntime`). Drop the free `inject` export; callers reach `inject` via `claudePty.inject(handle, text)` OR via `runtime.send(handle, { kind: "inject", payload: { text } })` (the canonical AgentRuntime path).

### Important edge cases

- **EC1 — Buffer eviction ambiguity.** Task 3 (`prompt-parser`) says "keep last 4KB"; Task 5 (`claude-pty`) stores chunks in `outputBuffer: string[]` via onData. If parser-side eviction only fires on poll, buffer grows unboundedly between polls. **Fix:** evict in `claude-pty.ts` `onData` — truncate to last 4KB on append. Remove "keep last 4KB" from prompt-parser.ts; parser only matches what's passed in.
- **EC2 — 250ms polling is event-agnostic.** Status transitions lag up to 250ms; bursty output buffers between polls. **Fix:** parse on every `onData` callback (event-driven) instead of timer polling. Eliminates lag + bounded latency. Document the tradeoff: more CPU per chunk, faster status detection. For Phase 1, event-driven wins.
- **EC3 — Chunk split across regex boundary.** Pattern spans two `onData` calls. Buffering-then-parse-on-append handles this naturally. Add Task 6 test 12: "feed `idle` pattern split into two consecutive chunks → parser detects after second chunk."

### Important missing criteria

- **MC1 — `scripts/capture-claude-transcript.sh` referenced but unscheduled.** Plan 04 task 2 promises the script "lands in plan 07 if not already present." Plan 07 has no such task. **Fix:** add to Plan 04 Task 2 a sub-step that creates a minimal `runtime/agent-runtime/pty/golden-transcripts/capture.sh` — a 30-line bash script that spawns `claude` in `script` (Unix) or via PowerShell `Start-Transcript` (Windows fallback), captures stdout/exit to NDJSON, exits. Or: drop the script reference and document manual capture procedure in the README in full detail.
- **MC2 — Coverage floor unverifiable with placeholder transcripts.** If golden files are empty, parser tests 1-3 skip; `parseStatusFromOutput`'s pattern-match branches go untested. **Fix:** add 2-3 synthetic inline fixtures in `prompt-parser.test.ts` that exercise `running`, `idle`, `exited` branches with hand-crafted strings matching the seed regexes — independent of golden capture. These run always. Golden-transcript tests run additionally when files have content. Coverage floor holds either way.

### Minor

- M1 — 100-byte fail-closed threshold is empirical; document at file top: "Threshold tuned after first golden capture; adjust if Claude emits >100-byte intermediate states."
- M2 — `it.skipIf` is Vitest API (alias for `test.skipIf` since v1.x). Confirm `vitest@^2` supports it.
- M3 — Single `golden-transcripts.json` vs three `.jsonl` files: minor preference. Keep three files (cleaner per-scenario capture).

### Implementer forward-list

1. Change `SUPPORTED_CLAUDE_CODE_VERSION_RANGE` to `">=2.0.0 <3.0.0"` — see PR1. Run `claude --version` on Santiago's box to confirm before merging.
2. Define `PTYAdapter extends AgentRuntime` and export `claudePty: PTYAdapter` — see C1.
3. Buffer eviction in `claude-pty.ts onData` (truncate to last 4KB on append) — see EC1.
4. Parse on every `onData` (event-driven), not 250ms timer — see EC2.
5. Add chunk-split test — see EC3.
6. Add `capture.sh` OR self-sufficient manual capture README — see MC1.
7. Add 3 synthetic inline fixtures to prompt-parser.test.ts for branch coverage independent of golden capture — see MC2.

## Verification

```bash
cd runtime && npm install && npx tsc --noEmit && npx vitest run agent-runtime/pty/ --coverage 2>&1 | tail -25
```

Expected:
- `tsc --noEmit` exits 0
- Vitest: at least `17 passed` (6 parser + 11 adapter; transcript-dependent tests may skip if golden files are placeholders)
- Coverage on `claude-pty.ts`, `prompt-parser.ts`, `version-pin.ts` each ≥80% lines
- `node-pty` and `semver` listed in `runtime/package.json` dependencies
