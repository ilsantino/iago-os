---
name: project_odysseus_eval
description: "Odysseus = pattern donor not clone; stay TS THROUGH CUTOVER but golang sidecar is a live post-cutover option under specific triggers (Santiago's decoupling point conceded)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 22243566-51ea-4299-bdde-fc5588a84c9f
---

Two deep-research workflows (2026-06-02): initial `wf_35862dc0-60e` + a reconsideration `wf_9962e6fc-458` after Santiago pushed back HARD ("VERY confident golang would make iago-os SO much faster", "why married to TS"). Full analysis in `.iago/research/2026-06-02-odysseus-clone-eval.md`.

**Verdict (90%): stay TypeScript THROUGH cutover; cherry-pick odysseus PATTERNS only (don't clone).** NOT dogmatic "zero golang" — refined below.

**Where Santiago is RIGHT (conceded loudly):** the daemon is fully decoupled from the AI layer — it imports ZERO LLM SDK (verified), the agent is the external `claude`/`codex` CLI in a PTY (`claude-pty.ts:345`), and the review pipeline is dev-time `.claude/` harness that reviews golang diffs same as TS. So the two historical anti-golang arguments ("lose SDK fit", "lose the pipeline") are DEAD. golang's operational wins are real: single static binary kills the node-gyp/native-dep bug class this team already hit, lower RSS, cleaner systemd sandbox. Don't be married to TS on principle.

**Where the speed intuition DOESN'T hold:** "SO much faster" is false for wall-clock. Daemon CPU is 1-50ms/task = 0.01-0.2% of the 20-120s a user waits; the seconds live in `claude`/`codex` subprocess token generation (language-invariant). It's an I/O supervisor asleep ~99.99% of the day, not a CPU service. The one user-visible daemon latency (5s poll) is a design choice fixable with `fs.watch`/inotify in TS (few lines), not a rewrite. Concurrency "ceiling" is imaginary today (1 agent on disk, 1x/day, maxConcurrent=1). The one real `spawnSync` event-loop stall (`cron-scheduler.ts:646`) is UNWIRED in prod (R1 replaced the bash wake-check).

**Phased path:** PHASE A (now→cutover, ALL TS): finish Phase 2/3 in TS, cut over off OpenClaw, deploy. Don't touch the language. Cherry-pick odysseus IDEAS as skills (deep_research bounded-iteration loop, loop-breaker, memory-audit guards) + iago cross-model verify + untrusted-page wrap. PHASE B (post-cutover, ONLY if a trigger fires): consider a golang SIDECAR for a specific layer first (file-bus scanner + IPC/health as a static binary w/ fsnotify), keep PTY/agent-lifecycle core in TS. Full golang rewrite stays OFF unless multiple triggers stack — and even then it's sidecar-first, profile-first, never a big-bang of freshly-hardened (~13K src + ~18K test LOC, 168 scar-fixes) UNDEPLOYED concurrency code.

**Flip-to-golang triggers:** per-agent-bot vision ships at scale (10+ standing agents) AND a profiled flame graph shows the event loop (not inference) as the ceiling; daemon starts genuine per-event CPU work (multi-MB parse, crypto/msg, high-freq tick); node-gyp/deploy pain becomes the dominant cost → targeted sidecar; a measured post-cutover bottleneck survives the cheap TS fixes; team's primary language flips to golang.

Relates to [[project_iago_v2_vision]], [[agents-never-hold-secrets]], [[feedback_llm_cost_discipline]], [[feedback_dont_be_precious_about_arch]].
