# Foundation Decisions

> Phase 2 — Dispatcher, Location, Statusline
> Date: 2026-03-31

---

## Decision 7: Hook File Location

**Verdict:** `.iago/hooks/`

**Reasoning:** Everything iaGO-related lives under `.iago/` — state, research, config. Hooks are iaGO code, so they belong here too. `.claude/` stays minimal (just `settings.json` pointing to `.iago/hooks/`). This keeps the iaGO layer self-contained: you could copy `.iago/` into any project and get the full system. The alternative `.claude/hooks/` muddies ownership — is it Claude Code's directory or ours? It's Claude Code's. We're guests there with `settings.json`; our code lives in our namespace.

**settings.json path pattern:**
```json
"command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" pre-compact"
```

**Git status:** Tracked. Hooks are code. They get reviewed, versioned, and shared across the team. Nothing in `.iago/hooks/` is gitignored. Runtime state (bridge files, session data) goes in `.iago/state/` which IS gitignored — but that's a separate decision.

**Directory structure decided:**
```
.iago/
  hooks/          # hook .mjs files (tracked)
  hooks/lib/      # shared utilities (tracked)
  research/       # this file (tracked)
  state/          # runtime data (gitignored) — future decision
```

---

## Decision 1: Dispatcher

**Verdict:** Skip. Direct registration.

**Profile system:** No. Three people don't need minimal/standard/strict profiles. If Santiago wants to disable typecheck while prototyping, he comments out one line in `settings.json` or sets `IAGO_DISABLED_HOOKS=post:edit:typecheck`. Profile gating is organizational infrastructure for teams of 10+ where you need to enforce consistency. We need speed and transparency.

**Require() optimization:** No. ECC's in-process `require()` saves ~50-100ms per hook by loading CJS modules inside the dispatcher process instead of spawning a child. Two problems: (1) we're using ESM (.mjs), so it'd be `await import()` which is async and complicates the flow, and (2) without a dispatcher there's nothing to load in-process — each hook IS its own process. Claude Code spawns `node hook.mjs` directly. The 50-100ms overhead per hook is acceptable given our <2s sync budget.

**What we do instead:**
- Each hook is a standalone `.mjs` file registered directly in `.claude/settings.json`
- Shared boilerplate (stdin parsing, error handling) lives in `.iago/hooks/lib/stdin.mjs` — imported by each hook, ~20 lines
- Per-hook disable via env var: `IAGO_DISABLED_HOOKS=hook-id-1,hook-id-2` — each hook checks this on startup (2 lines of code via shared util)
- No dispatcher, no profile system, no dynamic loading

**Why this is better for us than ECC's approach:**
- **Debuggable**: `node .iago/hooks/post-edit-typecheck.mjs < test-input.json` — test any hook in isolation
- **Transparent**: Read `settings.json`, see every hook. No indirection through a dispatcher.
- **Less code**: ~20 lines of shared stdin util vs 182-line dispatcher + 74-line flag system
- **Failure isolation**: One hook crashing doesn't affect others. With a dispatcher, a bug in dispatch logic kills everything.

**Target lines:** 0 (no dispatcher file). Shared `lib/stdin.mjs` at ~20 lines. Per-hook disable check in `lib/flags.mjs` at ~15 lines.

**Trade-off acknowledged:** Without a dispatcher, adding a new hook means editing `settings.json` manually. With ECC's approach you'd just drop a file and the dispatcher picks it up. For 3 people adding maybe 2 hooks per quarter, manual registration is fine. If we ever hit 20+ hooks, reconsider.

---

## Decision 8: Statusline

**Verdict:** Adopt. Hybrid of Ruflo display + GSD bridge-file architecture.

**Fields (4 total, left to right):**

| Field | Source | Why |
|-------|--------|-----|
| Git branch | `git branch --show-current` | Always need this. One shell exec, cached per render. |
| Context % | Transcript JSONL token usage (Ruflo method) | The single most valuable metric. Tells you when to compact or pause. |
| Client slug | Read from `.iago/state/active-client.json` | Multi-client awareness. Shows which client's budget you're burning. Empty if no client set. |
| Session duration | `Date.now() - sessionStartTime` | Quick awareness of how long you've been at it. |

**Fields cut:**
- Model name — visible in Claude Code's own UI. Redundant.
- Intelligence % — Ruflo-specific concept tied to their neural learning system. We don't have one.
- Hooks count — Zero operational value. You know what hooks you installed.
- MCP status — Visible in Claude Code UI. Redundant.

**Bridge file:** Yes. This is the key architectural decision.

The statusline hook fires on Claude Code's render cycle (frequent, reliable). It computes context % from the transcript JSONL and writes it to a bridge file at `.iago/state/bridge-ctx.json`. A separate context-monitor hook (PostToolUse) reads the bridge file and injects warnings into the conversation when thresholds are crossed.

**Why bridge file, not direct computation in the monitor:**
- Statusline fires more often than PostToolUse — context % stays fresh
- Separation of concerns: statusline computes metrics, monitor decides on actions
- Bridge file is inspectable: `cat .iago/state/bridge-ctx.json` shows current context state
- Same architecture as GSD, proven to work

**Bridge file schema:**
```json
{
  "session_id": "abc123",
  "context_pct": 42,
  "client": "acme",
  "git_branch": "feat/auth",
  "timestamp": 1711843200,
  "estimated_turns_remaining": 28
}
```

**Thresholds (from Ruflo, adjusted):**
- `< 65%` used: Normal. No warnings.
- `>= 65%` used: Advisory in statusline (color change). No conversation injection.
- `>= 80%` used: WARNING injected via context monitor. "Context limited — finish current task, then compact or pause."
- `>= 90%` used: CRITICAL injected. "Context nearly exhausted. Run /compact now or risk losing work."

Thresholds raised from Ruflo's 70/85 because on a 200K window, 70% = 60K tokens remaining — that's still plenty of room. 65/80/90 gives better signal-to-noise.

**File name:** `statusline.mjs`
**Target lines:** ~80-100

---

## Dependency Map for Phase 3-4

These three decisions constrain what comes next:

### Immediate constraints (Phase 3 — Context Persistence):
- **Context persistence hook** writes to `.iago/state/` (Decision 7 sets the namespace)
- **Statusline** reads transcript JSONL for token counts, writes bridge file to `.iago/state/bridge-ctx.json` (Decision 8)
- **Context monitor** reads bridge file (Decision 8), injects warnings — no dispatcher indirection (Decision 1)
- **Shared `lib/stdin.mjs`** must be built first — every hook depends on it (Decision 1)
- **Shared `lib/flags.mjs`** provides `isDisabled(hookId)` — every hook imports it (Decision 1)

### Structural constraints (Phase 4 — Post-Edit Quality):
- Post-edit hooks (format, typecheck, console-warn) are standalone `.mjs` files in `.iago/hooks/` (Decision 7)
- Each registered individually in `.claude/settings.json` with appropriate matchers (Decision 1)
- No dispatcher means each hook handles its own tool-name matching via Claude Code's native `matcher` field — simpler than ECC's approach

### settings.json shape (emerging):
```json
{
  "hooks": {
    "Statusline": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/statusline.mjs\"",
        "timeout": 2000
      }]
    }],
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{
          "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-typecheck.mjs\"",
          "timeout": 5000
        }]
      }
    ],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" user-prompt-submit",
        "timeout": 10000
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" pre-compact",
        "timeout": 15000
      }]
    }]
  }
}
```

### Build order for Phase 3:
1. `lib/stdin.mjs` + `lib/flags.mjs` (shared utilities — everything depends on these)
2. `statusline.mjs` (standalone, no deps beyond lib/)
3. `context-persistence.mjs` (needs lib/, reads transcript JSONL, writes state/)
4. `context-monitor.mjs` (needs lib/, reads bridge file from statusline)

### Open questions for future decisions:
- **Decision TBD**: `.iago/state/` directory structure and gitignore rules
- **Decision TBD**: Context persistence — adopt Ruflo's importance scoring or simplify?
- **Decision TBD**: Session handoff format (GSD's HANDOFF.json vs simpler approach)
- **Decision TBD**: Cost tracking — per-client attribution model
