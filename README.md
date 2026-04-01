# iaGO-OS

A Claude Code configuration layer for AI consultancies. Hooks, guardrails, context persistence, and cost tracking — loaded into every session across all projects.

## What is this

iaGO-OS is not a framework. It's a set of Node.js hooks and configuration files that sit on top of Claude Code to make it production-ready for consultancy work. It handles the things Claude Code doesn't: surviving context compaction, tracking which client you're billing, stopping Claude from leaking secrets or weakening your linter config, and auto-formatting code after every edit.

Built for a 3-person AI consultancy (Windows + Mac) working across multiple client codebases.

## Architecture

iaGO-OS is a configuration layer that lives in `.iago/` inside your project. Claude Code's `.claude/settings.json` points to hooks in `.iago/hooks/`. All runtime state goes in `.iago/state/` (gitignored). All hook code goes in `.iago/hooks/` (tracked).

```
.iago/
  hooks/                          # Hook .mjs files (git tracked)
    lib/                          #   Shared utilities
      stdin.mjs                   #     stdin JSON parser (~20 lines)
      flags.mjs                   #     Per-hook disable via env var (~15 lines)
      transcript.mjs              #     Transcript JSONL reader (~80 lines)
    statusline.mjs                #   Statusline: branch, context %, client, duration
    context-persistence.mjs       #   Session snapshots + cost logging (SessionStart/PreCompact/Stop)
    context-monitor.mjs           #   Context threshold warnings (PostToolUse)
    post-edit-typecheck.mjs       #   tsc --noEmit on edited .ts/.tsx files
    post-edit-format.mjs          #   Auto-format with Biome after edits
    post-edit-console-warn.mjs    #   Warn about console.log in edited files
    config-protection.mjs         #   Block edits to linter/formatter configs
    safety-guard.mjs              #   Secret detection + destructive command blocking
    commit-quality.mjs            #   Conventional commit validation + pre-commit checks
  state/                          # Runtime data (gitignored)
    sessions/                     #   Session snapshots (last 10)
    bridge-ctx.json               #   Context metrics (statusline -> monitor)
    active-client.json            #   Current client tag
    costs.jsonl                   #   Per-session utilization log
    HANDOFF.json                  #   Pause/resume state (ephemeral)
  research/                       # Design decisions (git tracked)
```

## How it works

### Context persistence

Sessions survive compaction and restarts. Three hook events handle the lifecycle:

- **SessionStart** loads the previous session snapshot (files modified, key decisions, current task) and injects it into Claude's context. If a `HANDOFF.json` exists from a structured pause, it loads that instead.
- **PreCompact** reads the transcript JSONL, extracts key state, writes a session snapshot, and injects compact instructions so Claude knows what to preserve.
- **Stop** finalizes the session — writes outcome, duration, token totals, and appends a utilization entry to `costs.jsonl`.

### Context monitoring

The statusline computes context usage (%) by reading actual token counts from Claude Code's transcript JSONL and writes metrics to a bridge file. A separate context-monitor hook reads the bridge file on every tool use and injects warnings:

| Context used | Action |
|-------------|--------|
| < 65% | Normal |
| >= 65% | Yellow statusline indicator |
| >= 80% | WARNING injected into conversation |
| >= 90% | CRITICAL — suggests immediate compact or pause |

### Cost tracking

Per-session utilization logging to JSONL. Tracks tokens consumed, session duration, client slug, operator, and model — not dollar costs (Claude Max is flat-rate). Client tagging via `.iago/state/active-client.json`.

### Post-edit quality

Every file edit triggers quality checks:

1. **Auto-format** with Biome (the team standard)
2. **Type-check** edited `.ts`/`.tsx` files via `tsc --noEmit`, filtered to only show errors in the edited file
3. **console.log warning** with line numbers for JS/TS files

### Guard rails

- **Config protection** blocks Claude from weakening linter/formatter configs (biome.json, .eslintrc, .prettierrc, tsconfig.json, etc.)
- **Secret detection** scans file writes and commits for AWS keys, GitHub PATs, API keys, private keys, and high-entropy strings
- **Destructive command blocking** catches dangerous bash patterns (rm -rf /, force push to main, DROP TABLE outside migrations)
- **Commit quality** validates conventional commit format

### Statusline

Four fields: git branch, context %, active client, session duration.

## Design principles

- **Node.js only.** Every hook is `.mjs`. Zero bash scripts. Cross-platform (Windows + Mac).
- **File-based state.** No SQLite, no PostgreSQL. Human-readable JSON and JSONL in `.iago/state/`.
- **No dispatcher.** Each hook is a standalone file registered directly in `settings.json`. Debuggable with `node hook.mjs < test.json`.
- **No profiles.** Three people don't need minimal/standard/strict. Disable individual hooks via `IAGO_DISABLED_HOOKS=hook-id-1,hook-id-2`.
- **Sync hooks < 2s, async < 10s.** Context persistence gets 15s for transcript parsing.

## Research provenance

iaGO-OS synthesizes patterns from six open-source Claude Code configuration repos:

| Source | What we took |
|--------|-------------|
| [Everything Claude Code](https://github.com/affaan-m/everything-claude-code) | Session trio event model, post-edit quality pipeline, config protection, cost tracking structure, hook-flags env-var disable |
| [Ruflo](https://github.com/ruvnet/ruflo) | Real token tracking from transcript JSONL, importance-ranked context concepts, bridge-file statusline architecture |
| [Get Shit Done](https://github.com/gsd-build/get-shit-done) | HANDOFF.json pause/resume pattern, bridge-file context monitoring, threshold-based compaction warnings with debounce |
| [Paperclip](https://github.com/paperclipai/paperclip) | Multi-client isolation model (adapted from company_id to filesystem directories) |
| [The Architect](https://github.com/Hainrixz/the-architect) | Agent-produces-agent-config pattern, blueprint template for project kickoff |
| [Superpowers](https://github.com/obra/superpowers) | Verification-before-completion discipline, two-stage review (spec then quality), rationalization prevention |

Full analysis files in `research/`. Design decisions in `.iago/research/`.

## Team context

- 3-person AI consultancy
- CEO on Windows 11 Surface Pro (16GB), CTO on Mac
- Stack: React 19 + Vite + TypeScript strict + TailwindCSS 4 + ShadCN/UI + AWS
- Agents: LangGraph + Claude SDK, n8n
- Claude Max 200 plan, 200K context window

## Status

Research and design decisions complete. Implementation pending.

See `HANDOFF.md` for the full handoff document and `.iago/research/DECISION-*.md` for all architectural decisions.
