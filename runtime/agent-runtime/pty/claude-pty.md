# claude-pty — Shape 1 PTY Adapter

## Purpose

Shape 1 PTY adapter for Claude Code. Spawns a real `claude` subprocess inside a
pseudo-terminal via `node-pty`, parses prompt/status transitions from stdout
against pinned patterns, fails closed when the parser cannot recognize output,
and exposes the polymorphic `AgentRuntime` surface plus a Shape-1-only
`inject()` method.

Implements `PTYAdapter`, which extends the shape-neutral `AgentRuntime`
interface defined in `runtime/agent-runtime/types.ts`. Registered with the
runtime registry at module load via `registerRuntime(claudePty)`, so anything
that does `resolveRuntime("claude-pty")` after importing this module gets a
working adapter.

## Version pinning policy

The adapter declares a supported Claude Code version range in
`version-pin.ts`:

```ts
export const SUPPORTED_CLAUDE_CODE_VERSION_RANGE = ">=2.0.0 <3.0.0";
```

`spawn()` calls `assertSupportedVersion()` before launching the PTY. That
helper shells out to `claude --version` via `child_process.spawn` (not the
PTY), parses the semver, and matches against the range with the `semver`
package. Three failure modes:

- `not-installed` — `claude` binary missing from `$PATH`
- `parse-failure` — `claude --version` succeeded but no semver-shaped token
  appeared in stdout
- `unsupported` — installed version is outside `SUPPORTED_CLAUDE_CODE_VERSION_RANGE`

Any of the three causes `spawn()` to throw with a message starting
`claude-pty: unsupported Claude Code version: <detail>`.

To bump the supported range:

1. Confirm the installed Claude Code version on Santiago's box and on Sebas's
   Mac (`claude --version`).
2. Re-capture all three golden transcripts (see next section).
3. Update `SUPPORTED_CLAUDE_CODE_VERSION_RANGE`.
4. Run `npx vitest run agent-runtime/pty/` and verify the conformance tests
   still pass against the new transcripts.

The range exists so we crash early instead of mis-parsing output from a
Claude version we have not validated against.

## Golden transcript format

Three `.jsonl` files in `golden-transcripts/`:

- `claude-code-running.jsonl` — Claude executing a tool call
- `claude-code-idle.jsonl` — Claude at the REPL prompt awaiting input
- `claude-code-exited.jsonl` — Claude after `/exit`, including the exit code

Each line is a JSON object:

```json
{ "at": 0, "kind": "stdout", "data": "..." }
{ "at": 142, "kind": "stderr", "data": "..." }
{ "at": 3018, "kind": "exit", "data": 0 }
```

`at` is ms since spawn. `kind` is `"stdout" | "stderr" | "exit"`. `data` is a
string for stdout/stderr, a number (exit code) for exit. Full format spec and
the manual capture procedure live in `golden-transcripts/README.md`. The
checked-in capture script is `golden-transcripts/capture.sh`.

Placeholders policy: empty `.jsonl` files are intentional when a version
hasn't been captured yet. The conformance tests in `prompt-parser.test.ts`
use `it.skipIf(!hasContent(file))` so an empty transcript skips its test
rather than failing the build. Synthetic inline fixtures (also in
`prompt-parser.test.ts`) cover the same regex branches independently, so
coverage holds even with all three transcripts empty.

## Fail-closed parse behavior

`prompt-parser.parseStatusFromOutput` iterates `KNOWN_PATTERNS` in order and
returns the first matching `StatusValue`. If no pattern matches AND the
buffer holds more than 100 bytes of non-whitespace, the parser returns
`status: "unknown"`. The adapter treats `"unknown"` as a crash signal:

1. Emit `crashed` to all `statusListeners` for the handle.
2. Write a `.daemon-stop` marker via `writeStopMarker(handleId, "crash")` so
   `agent-manager` can detect the crash on its next scan and trigger replay.
3. Persist the status transition to `session-log` via `appendEvent`.

Rationale: a silent mis-interpretation of Claude's state is strictly worse
than a restart. If Claude introduces a new prompt shape we haven't seen, we
restart it (cheap, deterministic) instead of guessing and routing input to
the wrong state. The fail-closed posture is the whole reason version pinning
+ golden transcripts exist — together they bound how often the unknown branch
fires in practice.

The 100-byte threshold is empirical (M1 from the plan stress test). It
exists to avoid false-positive crashes on short whitespace bursts or banner
fragments early in the session. Re-tune after the first real golden capture
if Claude turns out to emit >100-byte intermediate states with no recognized
marker.

## inject() semantics

`PTYAdapter.inject(handle, text)` writes `text + "\n"` to the PTY's stdin.
Identical to `send(handle, { kind: "inject", payload: { text } })`.

PTY-only. Other shapes (Shape 2 file-bus, Shape 3 chat-bridge, Shape 4
SDK-direct) do not implement `inject` — those shapes have no stdin to write
to. Daemon code that wants to inject context (e.g., the Telegram `/inject`
command from plan 06) MUST check `runtime.shape === "pty"` before calling.

`inject` is distinct from `prompt` semantically — `prompt` is a user-driven
turn ("what should the agent do next?"), `inject` is a context push ("here
is information you should know before continuing"). On the wire they look the
same (text + newline to stdin). The distinction matters for replay: both
`prompt` and `inject` events are re-fed during `restoreFromMarker`; `abort`
and `approval` are not.

## restoreFromMarker flow

`restoreFromMarker(markerPath)` performs a two-phase replay so a crashed
agent can resume mid-session without losing work:

1. **Phase 1 — read marker.** Marker JSON carries `handleId`, `agentId`,
   `sessionId`, and the original spawn config (`cwd`, plus a per-runtime
   `runtimeOptions` blob).
2. **Phase 2 — spawn fresh PTY.** Same `cwd`/`env`/`sessionId`/`agentId`,
   new pid, new `generationToken` (bumped from the prior handle so any stale
   listeners can detect they're holding a dead reference).

The adapter returns the new `AgentHandle`. The replay loop itself lives in
`AgentManager.attemptCrashReplay` (plan 03), which walks `session.jsonl`
from the start up to the stored high-water mark and re-feeds events via
`runtime.send`. Only `prompt` and `inject` events are re-sent — `approval`,
`abort`, and `custom` are application-level and would re-trigger side
effects if replayed.

If the stored HWM is missing (older sessions before HWM persistence landed),
`restoreFromMarker` returns `null` and `agent-manager` falls back to a clean
spawn.

## Failure modes

| Trigger | Outcome |
|---------|---------|
| `claude` binary missing | `spawn()` throws — `assertSupportedVersion` reports `not-installed` |
| Installed version outside range | `spawn()` throws — `assertSupportedVersion` reports `unsupported` |
| `claude --version` output unparseable | `spawn()` throws — `assertSupportedVersion` reports `parse-failure` |
| Unknown stdout (>100 bytes, no pattern match) | Listeners receive `crashed`; `.daemon-stop` marker written; `agent-manager` replays |
| PTY exits during session | `onExit` fires; listeners receive `exited`; state marked `alive = false` |
| `shutdown(handle, "SIGTERM")` and child still alive after 30s | Escalated to `SIGKILL`; state marked `alive = false` |
| `send` to a handle that isn't tracked | Throws `claude-pty: unknown handle id <id>` |

Every failure mode is observable through `onStatusChanged` (transitions) or
the registry's logger (spawn/throw). There is no silent failure path — that's
the whole point of fail-closed.

## Known limitations

- **Windows uses ConPTY via `node-pty`.** Behavioral parity with Unix PTY is
  high but not perfect (cursor positioning, line-ending normalization,
  certain ANSI sequences). Santiago's primary dev box is Windows; if Claude
  Code's stdout shape differs there, capture Windows-side golden transcripts
  and either widen the patterns or maintain platform-conditional patterns.
- **Single-process assumption.** The adapter assumes one `claude` subprocess
  per `AgentHandle`. It does not currently support Claude Code's multi-agent
  spawning, hooks, or sub-agents — those would each need their own handle if
  surfaced as separate iaGO agents.
- **No transcript rotation.** `outputBuffer` is truncated to the last 4 KB on
  every `onData`, but the persisted `session.jsonl` grows unbounded. Long
  sessions need an explicit rotation policy (plan TBD).
- **Approval routing.** `send(handle, { kind: "approval", ... })` is a
  no-op in this adapter — approvals are owned by the file-bus shape (plan
  05). Calling it here is harmless but does nothing useful.
- **Re-entrant shutdown.** Calling `shutdown` twice on the same handle is
  safe but the second call's escalation timer is redundant. Not a bug — just
  noise in logs.
