---
name: cortextOS evaluation
description: cortextOS (grandamenium/cortextos) — persistent PTY-session agents with Telegram/iOS control + Next.js dashboard + file-bus multi-agent coordination; cherry-pick patterns (file-bus locking, PTY-persistence), do NOT adopt as runtime; reference implementation for iaGO Wedge F when client triggers Telegram channel
type: project
originSessionId: 6afa8fcf-62aa-4fa4-92cb-65c492427ae0
---
cortextOS at https://github.com/grandamenium/cortextos — TypeScript, MIT, 33 stars, 194 commits, last push 2026-05-11 (active).

Persistent Claude Code/Codex agents in PTY sessions, auto-restart on 71h context rotation, multi-agent file-bus coordination, Telegram + iOS messaging control, Next.js web dashboard, multi-runtime per agent (Claude or Codex).

**Verdict: cherry-pick patterns, do not adopt as runtime.** iaGO is pipeline-driven (session-bounded). Cortextos is daemon-driven (24/7 PTY). Wrong architectural fit for direct adoption.

**Patterns worth stealing (when triggers fire):**
- File-bus locking primitive — covers multi-plan worktree-shared-file collision case our `feedback_worktree_per_session` does not.
- PTY-session persistence — relevant only when Wedge F revives (paying client requests Telegram channel).
- "Theta wave" autoresearch — overnight autonomous experiments; compare against our `/autonomous-loops`.

**Counter-patterns:** PM2 dependency (Windows-hostile), iOS adapter (zero new capability over Telegram), 57 issues / 64 PRs at 33 stars (high maintenance debt — vendor patterns, not package).

**Triggers to revisit:** Wedge F client trigger fires; multi-plan file-collision incident; Paperclip-defer triggers fire (re-evaluate cortextOS as lighter Paperclip alternative).

Full eval: `~/dev/obsidian-brain/projects/cortextos-eval.md` (written 2026-05-10).

Discovered via Santiago supplying URL after status-pull failure searched wrong slug (`cortex-os`). Same rediscovery failure mode as the original paperclip-eval correction — researched in conversation, never written to vault, every session re-discovers. The cortextos eval + this pointer close the loop.
