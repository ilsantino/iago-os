# Research: claude-peers-mcp

**Date:** 2026-04-27
**Question:** Does iago-os benefit from adopting claude-peers-mcp alongside (or instead of) Anthropic's agent-teams feature?

---

## TL;DR

- claude-peers-mcp is an active, community-built project (1,949 stars, 244 forks, last commit 2026-04-26) that lets Claude Code instances discover and message each other via a shared SQLite-backed HTTP broker daemon.
- It is **not** dead: 42 open issues, 20+ open PRs, multiple contributors adding features (multicast, Docker, cross-machine, Codex support, tmux naming, TUI dashboard).
- Windows is **broken at two levels**: broker script path resolution fails on startup (PR #46, PR #32 — both unmerged), and even when started, SQLite write locks cause messages and summary updates to stop propagating after initial registration (issue #31, open, no fix merged). iago-os is Windows-first.
- It solves the same peer-messaging problem as Anthropic's agent-teams mailbox, but via MCP rather than native CC runtime. The transport layer is different; the coordination model is similar.
- The `repo` scope peer discovery is broken for git worktrees (issue #23) — iago-os uses worktrees as a core isolation primitive.
- Requires `--dangerously-load-development-channels`, a flag that activates push delivery. Without it, delivery degrades to 1-second polling. The flag name signals API instability.
- **Verdict: skip.** Two unresolved Windows blockers + one worktree blocker = not usable in iago-os today. Defer to reassess when all three issues are merged and closed.

---

## What claude-peers-mcp Is

| Signal | Value |
|--------|-------|
| Stars | 1,949 |
| Forks | 244 |
| Open issues | 42 |
| Open PRs | 20+ |
| Last commit | 2026-04-26 |
| Contributors | 1 owner (louislva) + community PRs |
| License | MIT (just merged 2026-04-26 via PR #45 — was unlicensed before) |
| Language | TypeScript (Bun runtime) |
| Age | Created 2026-03-21 — 36 days old |

This is a young, viral project. It hit traction fast. The owner is responsive (commits daily) but it is effectively a solo-owner project with community patches. The core is not GA-stable: the license was missing until yesterday, multiple basic Windows issues remain unmerged, and the channel API it depends on (`claude/channel`) is marked experimental.

---

## How It Works

**Architecture:**

```
Claude Code A (stdio MCP) ──┐
                             ▼
                      broker daemon (localhost:7899, SQLite)
                             ▲
Claude Code B (stdio MCP) ──┘
```

**Broker daemon:** Single HTTP server on `localhost:7899`, auto-spawned by the first MCP server instance. SQLite at `~/.claude-peers.db` (WAL mode enabled in broker). Tracks peers by PID, CWD, git root, TTY, summary. Cleans dead peers by checking `kill(pid, 0)` every 30s.

**MCP tools exposed (4):**

| Tool | Schema | What it does |
|------|--------|--------------|
| `list_peers` | `{ scope: "machine" | "directory" | "repo" }` | Discover other Claude Code instances |
| `send_message` | `{ to_id: string, message: string }` | Route message through broker to target |
| `set_summary` | `{ summary: string }` | Publish 1-2 sentence work description |
| `check_messages` | `{}` | Pull undelivered messages (fallback) |

**Transport:** stdio (one MCP server process per Claude Code session). Broker is HTTP on localhost.

**Peer discovery:** Registration on startup via `/register` with `pid`, `cwd`, `git_root`, `tty`, `summary`. Heartbeat every 15s. Scopes: `machine` = all PIDs, `directory` = same CWD, `repo` = same `git_root` string (broken for worktrees — see risks).

**Messaging model:** Send → broker stores in `messages` table → receiver polls `/poll-messages` every 1s → broker marks delivered → consumed once (no replay). If `--dangerously-load-development-channels` is active, the MCP server pushes inbound messages as `notifications/claude/channel` events — Claude sees them immediately. Without it, delivery is poll-based (up to 1s lag, and issue #8 confirms messages can be lost if channel is not enabled).

**State maintained:** SQLite `peers` table + `messages` table. All localhost, no persistence across machine restarts by design.

**Process model:** Users launch Claude Code sessions. The MCP server auto-registers each one. There is no orchestrator process — any peer can message any other by ID. True peer-to-peer via the broker.

**Auto-summary:** If `OPENAI_API_KEY` is set, uses `gpt-5.4-nano` at startup to generate a summary from git branch + recent files. Optional, non-blocking.

---

## claude-peers-mcp vs Anthropic Agent Teams

| Dimension | claude-peers-mcp | Anthropic Agent Teams |
|-----------|-----------------|----------------------|
| Communication | Peer-to-peer via broker MCP tool | Peer-to-peer via mailbox (native CC runtime) |
| Transport | HTTP localhost + SQLite | File-based (native CC internals) |
| Peer discovery | `list_peers` by scope | Task list + teammate names (set by lead) |
| Shared task list | No — messages only, no task primitives | Yes — structured task list with locking |
| File locking | No | Yes (file-based, prevents race conditions) |
| Windows support | Broken — 2 unmerged path PRs, 1 SQLite lock bug | Broken — split-pane not supported on Windows Terminal |
| GA status | Experimental / community (36 days old) | Experimental (Anthropic, requires CC v2.1.32+ + env flag) |
| License | MIT (just added) | N/A (built into CC) |
| Install path | Clone repo, `bun install`, `claude mcp add` | Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| Worktree support | Broken (`repo` scope uses wrong git path) | Unknown |
| Requires `--dangerously-*` flag | Yes (channel push) | No |
| Self-coordination | No — peers discover and message, but no task list | Yes — teammates self-assign from shared task list |
| Process model | Any user-spawned session can join | Lead spawns teammates explicitly |
| Multicast | Not yet (PR #30 open) | Broadcast to team |
| Cross-machine | Not yet (PR #28 open) | No |

**Key distinction:** agent-teams have a **shared task list with locking** — that is the coordination primitive that enables genuine parallel work without races. claude-peers-mcp has **only messaging** — it's a communication channel, not a coordination protocol. You'd still need to build task partitioning and conflict avoidance on top.

Neither is usable today on Windows without workarounds. Agent-teams has no worktree issue because teammates have assigned file domains. claude-peers-mcp's worktree bug directly blocks the iago-os pattern.

---

## Wedge Mapping

| Wedge | Use claude-peers-mcp? | Use agent-teams? | Recommendation |
|-------|-----------------------|------------------|----------------|
| A — pipeline review fan-out (3 reviewers parallel, share findings, merge) | No — broker messaging too low-level; no shared findings structure; Windows broken | Defer — experimental, no shared task list for findings aggregation | Use sequential `claude -p` sessions per pipeline design; fan-out is future work for both paths |
| B — multi-plan parallel execution (one teammate per plan, worktree isolation) | No — worktree scope broken (issue #23); broker dies on Windows; no task locking | Defer — no confirmed worktree support; experimental; Windows terminal broken | Stick with sequential plan execution; revisit when agent-teams ships stable worktree mode |
| C — speculative review (reviewer prepares focus list while impl runs) | No — messaging model doesn't help; reviewer session still has to be spawned and coordinated manually | Possibly — teammate runs as reviewer while lead runs as impl; but no structured output handoff | Neither path adds value today; speculative review is a background `claude -p` spawn problem, not a messaging problem |

**Pattern:** All three wedges need a **coordination + task-partition primitive**, not just a messaging bus. claude-peers-mcp provides the bus but not the primitive. Agent-teams provides both but is experimental and Windows-broken. Neither is ready to slot into the pipeline today.

---

## Risks

**If adopted despite blockers:**

1. **Windows startup failure** — PRs #32 and #46 both fix the broker script path issue but neither is merged. The broker won't auto-launch on Windows. Claude Code will show `claude-peers: ✗ Failed to connect`. Hard blocker for iago-os (Windows-first).

2. **Message loss on Windows** — Issue #31 (open, no fix): after initial registration, `send_message` calls are silently dropped. SQLite write-lock behavior on Windows differs from POSIX WAL mode behavior. This is fundamental to the broker design.

3. **Worktree peer discovery broken** — Issue #23 (open, fix in PR #24 not merged): `git rev-parse --show-toplevel` returns different paths per worktree. `repo` scope will never find peers in sibling worktrees. iago-os uses worktrees as the parallelism primitive.

4. **`--dangerously-*` flag dependency** — The channel push API that makes delivery instant requires `--dangerously-load-development-channels`. This flag opts into an unstable API surface. Without it, delivery is polling-only and messages can be lost (issue #8).

5. **Solo-owner abandonment risk** — 36-day-old repo, one active maintainer. Viral repos without institutional backing frequently go dormant after the hype cycle. The 20 open PRs without merges suggests bottleneck at the owner.

6. **Bun dependency** — iago-os's stack is Node 20 (Lambda) + Vite. Bun is not in the stack. Adding it as a runtime dependency for a single MCP server adds a second runtime to manage on Windows.

7. **No task coordination** — Even if all bugs were fixed, claude-peers-mcp delivers messages but does not prevent two peers from editing the same file. The coordination logic would still need to be built on top.

---

## Recommendation

**Decision:** Skip

**Confidence:** High

**Reasoning:** iago-os runs on Windows. claude-peers-mcp has two unresolved Windows blockers (broker path resolution + SQLite write locks) and one worktree blocker — all three PRs are open and unmerged. Even setting the bugs aside, claude-peers-mcp is a messaging bus, not a task-coordination protocol. For all three parallelism wedges (review fan-out, multi-plan parallel, speculative review), the missing primitive is task partitioning with conflict avoidance — which neither claude-peers-mcp nor agent-teams provides cleanly today. The correct path is to wait for Anthropic's agent-teams to reach GA with Windows and worktree support, then reassess. That is the native path with institutional maintenance.

**Next step:** File a watch on issues #31 (Windows SQLite), #23 (worktree scope), and PRs #32/#46 (path resolution). Re-evaluate when all three are closed on main. Check every 30 days or when CC 2.2+ releases.

**Risk if wrong:** If agent-teams never ships stable Windows support and claude-peers-mcp fixes its blockers first, iago-os would have a working parallelism primitive available earlier. The cost of this error is a 30-day delay in reevaluation, not a structural problem.

---

## Sources

- `gh api repos/louislva/claude-peers-mcp` — repo metadata: stars, forks, license, dates, language
- `gh api repos/louislva/claude-peers-mcp/contents/README.md` — tool list, architecture diagram, install path, config table, requirements (CC v2.1.80+, Bun, claude.ai login)
- `gh api repos/louislva/claude-peers-mcp/contents/server.ts` — full MCP server: 4 tools, channel push implementation, broker spawn logic, polling loop, heartbeat, registration flow
- `gh api repos/louislva/claude-peers-mcp/contents/broker.ts` — broker daemon: SQLite schema, WAL mode, prepared statements, HTTP routes, stale peer cleanup, PID check pattern
- `gh api repos/louislva/claude-peers-mcp/contents/cli.ts` — CLI: status, peers, send, kill-broker
- `gh issue list --repo louislva/claude-peers-mcp --state all --limit 20` — all open issues
- `gh api repos/louislva/claude-peers-mcp/issues/31` — Windows SQLite write lock detail: root cause, reproduction steps, symptom (messages silently dropped after initial registration)
- `gh api repos/louislva/claude-peers-mcp/issues/23` — worktree scope bug: `--show-toplevel` vs `--git-common-dir` explained
- `gh api repos/louislva/claude-peers-mcp/pulls/32` — Windows broker path PR: `fileURLToPath` fix, also surfaces broker detach issue on Windows
- `gh api repos/louislva/claude-peers-mcp/pulls/46` — Windows leading-slash strip PR: companion to #42
- `C:\Users\sanal\dev\iago-os\docs\research\agent-teams-vs-subagents.md` — prior research: agent-teams architecture, Windows split-pane limitation, worktree gaps, iago-os pipeline design
