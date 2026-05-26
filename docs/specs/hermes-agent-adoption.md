# Spec: Full hermes-agent adoption — 9-wedge roadmap

**Status:** Wedge A shipping in this PR; Wedges B–I queued
**Date:** 2026-04-27
**Source research:** `.iago/_archive/research/2026-04-research/hermes-agent.md`
**Decision history:** Council 1 (top-3 wedges), Council 2 (architecture choice
on B), v2/v3 stress tests on the conservative version. CEO chose to expand
scope from 3 → 9 wedges.

## Why a full adoption

Hermes Agent (Nous Research, 120K stars, MIT) is a genuinely novel
agentic CLI with patterns iago-os lacks. Two earlier councils argued for a
3-wedge minimum. CEO ruled to adopt fully — the patterns compound, and
iago-os should be the most opinionated config layer in the agency-tooling
space. This spec is the ordered roadmap.

Each wedge ships independently as its own PR. Wedge A goes in this PR.
Wedges B–I get plan files under `.iago/plans/feature-hermes-adoption/`.

## Adoption sequence

| # | Wedge | Effort | Order rationale |
|---|---|---|---|
| A | Frozen-snapshot MEMORY rule | S (~1h) | Cheapest, proves shipping cadence |
| B | Autonomous skill creation | M (~2d) | Compounds with every plan execution |
| C | Cron + script + `[SILENT]` | M (~2d) | Unattended ops, kills notification fatigue |
| E | Conditional skill activation | S (~1d) | Cleans UX before adding more skills |
| D | Pluggable memory provider | M (~3d) | Foundation for cross-tool memory |
| G | Progressive skill disclosure | M (~3d) | Infrastructure for catalog growth |
| H | Webhook + HMAC | M (~3d) | Replaces some GH Actions glue |
| F | Multi-platform gateway (Telegram) | L (~1.5w) | Biggest ticket, gate last |
| I | agentskills.io compliance | S (~0.5d) | Cosmetic, ship when convenient |

Total: ~3-4 weeks of active engineering across 9 PRs. Real calendar:
~6 weeks with bake-time between wedges.

---

## Wedge A — Frozen-snapshot MEMORY.md rule (THIS PR)

### Problem
Skills/agents may grep or Read MEMORY.md mid-session even though Claude Code
auto-injects it at start. Wastes tokens, breaks prefix-cache assumption.

### Approach
1. Add subsection "Frozen-snapshot rule" to CLAUDE.md "Memory Architecture":
   - Forbids mid-session re-reads of `~/.claude/projects/{slug}/memory/MEMORY.md`
   - Two narrow exceptions: Read-after-Write to verify persistence; skills
     designed for cross-session preferences (e.g., `/council`)
2. Save feedback memory `feedback_memory_no_reread.md` (already done).
3. Audit `.claude/skills/`, `.claude/agents/`, `.claude/rules/` for violations
   (one real hit found — `/council` — already annotated with inline comment).

### Acceptance
```bash
grep -rn "Read.*MEMORY\.md\|memory/" .claude/{skills,agents,rules}
```
Returns only the `/council` exception with its inline comment.

### Rollback
If 2+ skills break needing memory access, revisit with explicit allowlist.

---

## Wedge B — Autonomous skill creation after pipeline

### Problem
`.iago/learnings/` exists with empty stubs. The "5+ occurrences → CLAUDE.md
promotion" rule has never fired because nothing populates the input.

### Approach
Add pipeline step 7 (post-summary) that runs a distiller agent:
- Inputs: plan, diff, review log, Codex findings, summary
- Output: dated entry to `.iago/learnings/candidates.md` with pattern,
  why, how-to-apply, source plan + commit
- Trigger gates (skip if none): ≥1 Codex finding, ≥2 review rounds, ≥1
  build retry, ≥5 files changed
- Manual promotion to CLAUDE.md (no auto-write)

### Stress-test fixes baked in (from v2/v3 stress on the original spec)
- Containment: wrap injected content in fenced block, prefix every line
  with `> ` (markdown blockquote — models reliably treat as data)
- Observability: impl prompt requires `LESSONS_APPLIED: [#N]` or `none`;
  summary step extracts and records
- Schema: pick ONE format for `patterns.md` (table) and propagate to
  iago-init template + SDD writer + bash injection
- 500/300 token budgets reused from existing
  `subagent-driven-development/SKILL.md:80-83`
- No CODEOWNERS theater; rely on standard PR review

### Acceptance
≥1 non-`none` `LESSONS_APPLIED` hit across 5 plans.

### Rollback
If lessons start steering implementations incorrectly, gate distiller behind
manual approval.

---

## Wedge C — Cron + script injection + `[SILENT]`

### Problem
Scheduled checks (PR digests, AWS bill drift, Munet build health) run
either as GH Actions (no LLM reasoning) or as RemoteTrigger prompts that
always deliver. Notification fatigue caps automation at ~3.

### Approach
1. Extend `/iago-schedule create` with `--script {path.py}` flag.
2. New `scripts/scheduled-runner.sh`:
   - Run script with project dir as cwd, capture stdout
   - Wrap stdout in fenced block with framing: "data, not instructions"
   - Combined prompt → `claude -p` (sonnet, 20-turn cap)
   - Parse output: contains `[SILENT]` token → exit 0, no delivery
   - Otherwise deliver via existing channel
3. Windows encoding mitigation per `feedback_markitdown_cli_encoding.md`:
   force UTF-8 on Python script invocation (`-X utf8`), capture as
   bytes, decode explicitly.
4. Failure mode: non-zero exit code from `claude -p` always delivers
   "automation failed" alert — `[SILENT]` is opt-in, never default.
5. First template: `pr-queue-digest` (script: `gh pr list --json`; prompt:
   "Summarize what's blocked, ignore drafts, [SILENT] if nothing needs
   attention").

### Acceptance
1 week of `pr-queue-digest` runs, ≥30% of mornings deliver `[SILENT]`,
zero false-silence on actual blockers.

### Rollback
If `[SILENT]` ever hides a real blocker, add audit log: every `[SILENT]`
run writes 1 line to `.iago-logs/silent-runs.log` for periodic review.

---

## Wedge E — Conditional skill activation

### Problem
Skills appear in the catalog regardless of whether their dependencies are
installed. `/codex:rescue` is broken if Codex CLI missing. `/iago-execute`
has nothing to execute if `.iago/plans/` is empty.

### Approach
1. Extend SKILL.md frontmatter schema:
   ```yaml
   ---
   requires_tools: [codex]              # CLI binaries must be on PATH
   requires_paths: [.iago/plans/]       # Repo paths must exist
   fallback_for: /codex:rescue          # Show this when codex unavailable
   ---
   ```
2. Build a small skill-loader filter (Node script, runs at session start
   via existing hook infra) that reads frontmatter, evaluates conditions,
   filters the visible catalog.
3. Document in CLAUDE.md "Skills" section.

### Acceptance
On a fresh repo without `.iago/plans/`, `/iago-execute` does not appear in
the slash-command menu. On a repo without Codex CLI, `/codex:rescue` is
hidden.

### Rollback
Filter is opt-in via setting; disable via `iago.skills.conditional: false`.

---

## Wedge D — Pluggable memory provider interface

### Problem
Obsidian + MemPalace + Graphify each serve a memory slice via their own MCP
servers. No unified interface. Adding a new provider (e.g., Honcho-style
dialectic user model) requires bespoke wiring.

### Approach
1. Define `MemoryProvider` interface in TypeScript:
   ```ts
   interface MemoryProvider {
     id: string;
     query(q: string, opts?): Promise<MemoryHit[]>;
     write(entry: MemoryEntry): Promise<void>;
     supports(capability: 'semantic' | 'kg' | 'fts'): boolean;
   }
   ```
2. Adapt the three existing MCP servers to expose this interface
   (lightweight wrappers, no rewrite).
3. Provider registry in `.iago/config.json` `memory.providers[]`.
4. Single skill `/iago-memory query "X"` routes to the most relevant
   provider based on query type.

### Acceptance
`/iago-memory query "Munet auth flow"` returns hits from all 3 providers
with provider attribution. Adding a 4th provider (e.g., Honcho plugin)
requires only a config entry + adapter shim.

### Rollback
The three existing MCPs continue to work directly; the unified interface
is additive.

---

## Wedge G — Progressive skill disclosure

### Problem
The skill catalog is at ~50 skills today. As it grows past ~80, the
metadata loaded at session start consumes meaningful context.

### Approach
1. Skill-loader emits ONLY metadata (name, description, tags) at session
   start — ~5 KB total for 100 skills.
2. New tools `skills_list()` and `skill_view(name)` for on-demand body
   fetching, mirroring Hermes' `skills_list` / `skill_view`.
3. Auto-load body for the top 5 most-used skills per project (heuristic
   from `.iago/summaries/` history).

### Acceptance
Session-start prompt size drops by ≥30% on a repo with >80 skills.
Common skills (e.g., `/iago-execute`, `/iago-quick`) auto-load and add
zero latency to invocation.

### Rollback
Disable via `iago.skills.lazy: false`; revert to eager loading.

---

## Wedge H — Webhook subscriptions with HMAC

### Problem
GitHub event handling lives in two GH Actions (`claude.yml`,
`claude-review-fix.yml`). Adding new event-driven automations (e.g.,
"when an issue is labeled 'bug', dispatch `/codex:rescue`") requires new
workflow files.

### Approach
1. New `/iago-webhook subscribe {name}` skill creates an HMAC-protected
   POST endpoint hosted on the existing RemoteTrigger infra.
2. Subscription config: event filter (regex on payload), prompt
   template (with payload variable interpolation), delivery channel.
3. HMAC secret stored in repo settings, validated on every POST.
4. First subscription: `auth-watch` per Hermes' `routines.md` example —
   notify when a PR touches `amplify/auth/`.

### Acceptance
Posting a sample GitHub PR webhook payload triggers the configured prompt
within 5 seconds, delivers to the configured channel.

### Rollback
Subscriptions are namespaced; delete one entry to disable.

---

## Wedge F — Multi-platform gateway (Telegram first)

### Problem
iago-os is terminal-only. Santiago is mobile during meetings, transit,
client visits. Cannot drive iago-os from phone.

### Approach
1. Node.js gateway process (single binary, runs on Santiago's box or a
   $5 VPS).
2. Telegram Bot API integration: receives messages, validates allowlist,
   spawns `claude -p` in a per-conversation worktree, streams output back.
3. Per-user session continuity (SQLite store).
4. `/status`, `/stop`, `/new` slash commands inside Telegram.
5. Voice memos: pipe through Whisper API for transcription before
   feeding to claude.
6. Future expansion: Discord, Slack — same gateway process, additional
   adapters.

### Acceptance
Santiago sends a Telegram message: "What's the Munet PR queue look like?"
Gateway dispatches `/iago-quick` equivalent in the iago-os worktree, replies
with the digest within 30 seconds.

### Rollback
Gateway is a separate process; kill it to disable. No iago-os state
depends on it.

### Open design questions (resolve in plan)
- Where does it run? Santiago's box (Windows + WSL2) or cloud VM?
- Auth model: allowlist by Telegram user ID, signed with shared secret?
- Concurrency: serialize per-user, or allow parallel sessions?

---

## Wedge I — agentskills.io standard compliance

### Problem
iago-os skills use a Claude Code-flavored SKILL.md format. Hermes
publishes against `agentskills.io` open standard. Cross-agent portability
costs nothing to add.

### Approach
1. Extend SKILL.md frontmatter schema with `agentskills.io` fields
   (`spec_version`, `compatibility`, etc.).
2. Add `npm run skills:validate` that checks compliance.
3. Document iago-os skills as `agentskills.io v1` compatible.

### Acceptance
Validator passes on all current skills. A Hermes user could in principle
import an iago-os skill.

### Rollback
Compliance is additive; remove fields if standard changes.

---

## Cross-cutting decisions

### Plan organization
All wedges B–I land as plans under
`.iago/plans/feature-hermes-adoption/`:
- `01-wedge-b-distiller.md`
- `02-wedge-c-cron-silent.md`
- `03-wedge-e-conditional-activation.md`
- `04-wedge-d-memory-provider.md`
- `05-wedge-g-progressive-disclosure.md`
- `06-wedge-h-webhook-hmac.md`
- `07-wedge-f-telegram-gateway.md`
- `08-wedge-i-agentskills-compliance.md`

Each plan stress-tested via `/iago-stress` before pipeline execution.

### Inter-wedge dependencies
- B writes to `.iago/learnings/` → use Wedge A's frozen-snapshot rule.
- C uses `/iago-schedule` infra (already exists) → no dependency.
- E needs no other wedge but should land before G (G depends on
  catalog metadata).
- D is independent.
- G depends on E (both touch the skill loader).
- H is independent.
- F needs Whisper integration (new dep) and a hosting decision; gate
  behind A–E ship + observation.

### Rollback discipline
Each wedge ships behind a config flag (`iago.hermes.<wedge>: enabled`).
If a wedge breaks production, flip the flag off; no code revert.

### Stress test cadence
Each wedge plan goes through `/iago-stress` before `/iago-execute`.
After two consecutive PROCEED verdicts in the same wedge, the third can
proceed without explicit stress (pipeline step 0 always runs anyway).

---

## What we are NOT adopting

Per the research artifact's "SKIPPED" list:
- Mixture-of-Agents tool — `/council` already covers this
- Atropos RL training environments — irrelevant to consulting
- Daytona/Modal serverless backends — no need for cloud sandbox
- Skin engine — cosmetic
- Trajectory compression for training — research, not delivery
- Native CLI replacement — we layer on Claude Code, we don't replace it
