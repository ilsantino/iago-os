# Team 5 — iago-os internal inventory

> Date: 2026-04-28 | Sprint: strategic-validation (5-team)

---

## TL;DR (3-line verdict)

- **Top 3 capabilities (the moat):** (1) 9-stage automated review pipeline with severity floors and local fix loops — no peer system runs this end-to-end in bash with no SaaS dependency; (2) cross-model adversarial review via Codex/GPT-5.5 as a mandatory pipeline gate, not optional lint; (3) 5-layer memory architecture with auto-write hooks, retrieval routing, and frozen-snapshot cache-preservation rule.
- **Wedges already covered:** A (frozen-snapshot — SHIPPED #23), C (cron/autonomous loops — CAPABILITY via `/autonomous-loops` + `/iago-schedule` skills), D (memory provider — PARTIAL, 5 layers exist, no aggregator API), G (progressive skill disclosure — PARTIAL, skill dispatch table exists, no runtime capability flags).
- **Internal gaps to fill (prioritized):** (1) distiller stage — no session-compression between pipeline steps (Wedge B); (2) webhook + HMAC inbound events — no signed external trigger path (Wedge H); (3) conditional skill activation — skills are dispatched by keyword match, not declared capability flags (Wedge E/G gap).

---

## Capabilities inventory

### Workflow primitives

**Skills: 36 SKILL.md files across 8 categories**

| Category | Skills | Status |
|---|---|---|
| Planning & execution | `/iago-init`, `/iago-plan`, `/iago-execute`, `/iago-quick`, `/iago-fast`, `/iago-stress`, `/iago-verify`, `/iago-pause`, `/iago-prfix` | CAPABILITY |
| Design & research | `/brainstorming`, `/writing-plans`, `/deep-research`, `/council`, `/santa-method`, `/code-review` | CAPABILITY |
| Project setup | `/iago-scaffold`, `/iago-onboard`, `/iago-discuss` | CAPABILITY |
| Automation & architecture | `/iago-n8n`, `/iago-agents`, `/iago-schedule` | CAPABILITY |
| Content & business | `/content-engine`, `/investor-materials`, `/investor-outreach`, `/iago-proposal`, `/frontend-slides`, `/visa-doc-translate` | CAPABILITY |
| Audit / bug bounty | `/amplify-bug-bounty`, `/frontend-bug-bounty` | CAPABILITY |
| Specialized | `/subagent-driven-development`, `/autonomous-loops`, `/continuous-agent-loop`, `/industry-patterns`, `/healthcare-phi-compliance`, `/liquid-glass-design`, `/agent-payment-x402`, `/prompt-optimizer` | CAPABILITY |
| Codex (cross-model) | `/codex:rescue`, `/codex:adversarial-review`, `/codex:review`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup` | CAPABILITY |

**Pipeline stages: 9 stages** (stage 2b added 2026-04-13)

| # | Name | What |
|---|------|------|
| 0 | Stress test | Adversarial plan review before impl; BLOCK halts; skipped if `## Stress Test` present |
| 1 | Implement | Fresh opus session writes code from plan (max 80 turns) |
| 2 | Build gate | `tsc --noEmit && vite build`; sequential default, parallel via `IAGO_PARALLEL_BUILD=1`; max 2 retries |
| 2b | Console gate | Playwright-driven browser console scan for runtime errors; max 2 retries |
| 3 | Review | Three-pass opus review (plan compliance + domain routing + adversarial); severity floors enforced; local fix loop max 2 rounds |
| 4 | Codex adversarial | GPT-5.5 via codex-companion.mjs; falls back to claude opus adversarial if Codex unavailable |
| 4b | Codex fix | Opus fixes Codex findings P0→P1→P2; rebuild gate after; skipped if no findings |
| 5 | Create PR | Sonnet stages + commits + pushes + creates PR via `gh`; plan embedded in PR body |
| 5b | Tag @claude | Sonnet writes context-rich review comment, posts on PR; triggers async loop |
| 6 | Summary | NDJSON telemetry + `.iago/summaries/{plan}.md` written |

**Plan artifact format:** `PLAN_NAME` slug at `.iago/plans/` — markdown with `## Tasks`, optional `## Stress Test` section (skips step 0), optional `## Context`. Multi-plan clusters in `feature-{slug}/01.md, 02.md, ...`. Deferred plans in `_deferred/` subfolder.

**ROADMAP system:** `.iago/STATE.md` (≤80 lines, overflow to PROJECT.md), phase tracking via header. `/iago-init` bootstraps; `/iago-verify` gates phase completion.

---

### Agent system

**3 bases:**

| Base | Model | Tools | Purpose |
|---|---|---|---|
| executor | opus | Read/Glob/Grep/Edit/Write/Bash/Notebook | Implementation tasks |
| analyst | sonnet | Read/Glob/Grep/Bash | Read-only analysis, reviews |
| operator | (unread) | Read/Glob/Grep/Bash + external | External data access |

**12 profiles:** `fullstack`, `frontend`, `backend`, `review-single`, `review-full`, `security-audit`, `research`, `e2e`, `infra`, `schema`, `content`, `debug`

**13 capability modules:** `react-19`, `dynamodb`, `lambda`, `cognito`, `tdd`, `security`, `e2e`, `review-spec`, `review-quality`, `content`, `infra`, `forms`, `animation`

**Dispatch model:** Hub-and-spoke only — orchestrator dispatches agents, agents never spawn agents. Profiles compose base + injected capabilities via dispatch prompt. No sub-orchestration.

---

### Review pipeline (the moat)

**Stage detail with model and turn budget:**

| Stage | Model | Max turns | Notes |
|---|---|---|---|
| 0 stress test | opus | 15 | Read+Glob+Grep only; verdict: PROCEED / PROCEED_WITH_NOTES / BLOCK |
| 1 implement | opus | 80 (env-overridable) | Full tool access; BLOCKED/NEEDS_CONTEXT halts |
| 2 build gate | n/a (bash) | 2 retries | tsc + vite; parallel mode opt-in |
| 2b console gate | opus (fix) | 30 | Playwright runtime scan; warning-only if max retries hit |
| 3 review | opus | 35 (env-overridable) | Three-pass; fix loop max 2 rounds × 40 turns each |
| 4 codex adversarial | GPT-5.5 / opus fallback | 20 (fallback) | Codex via codex-companion.mjs; cwd-misfire sanity check |
| 4b codex fix | opus | 40 | Skipped if no findings |
| 5 create PR | sonnet | 15 | Plan embedded in `<details>` block |
| 5b tag @claude | sonnet | 3 | Context-rich comment under 300 words |

**Review check modules** (10 files, all loaded; reviewer selects relevant domains):
`baseline`, `auth`, `api`, `backend`, `data-integrity`, `react`, `amplify`, `infra`, `i18n`, `patterns`

**Severity floors:** Modules mark checks `ALWAYS Critical` or `ALWAYS Important` — reviewer cannot downgrade below floor. Cross-cutting (auth bypass, data loss, races, rollback) checked regardless of domain selection.

**Build gate parallel mode (Wedge 06):** `IAGO_PARALLEL_BUILD=1` runs tsc + vite concurrently; kills survivor on first failure; assembles labeled `# --- tsc ---` / `# --- vite ---` block for fix session. Default off (memory pressure on 16GB Windows). Telemetry records `tsc_duration_ms`, `vite_duration_ms`, `build_gate_mode` per stage.

**Cross-model:** Codex/GPT-5.5 is a mandatory gate (step 4), not optional. Falls back to opus adversarial if Codex CLI unavailable. Cwd-misfire detection prevents spurious "no changed files" approvals.

---

### Memory architecture

**5 layers:**

| Layer | Stores | Access | Auto-write |
|---|---|---|---|
| MEMORY.md | User prefs, feedback, project context (key→file pointer index) | Always-loaded in context (frozen snapshot) | Manual (Claude writes mid-session, reflects next session) |
| Obsidian vault | Session digests, meeting notes, decisions, business docs | MCP: `search_notes`, `read_note`, `write_note` | Semi-auto (session digests post-session) |
| Graphify KG | Entity relationships, community structure over full vault | MCP: `query_graph`, `get_node`; `graphify-out/wiki/` | Auto (nightly rebuild via Windows Task Scheduler) |
| MemPalace | Conversation history, reasoning trails, agent diary | MCP: `mempalace_search`, `mempalace_diary_read` | Auto (stop hook writes diary every session; 13.5K drawers, 7 wings) |
| MarkItDown | Document conversion (DOCX/PPTX/XLSX/EPub/YT/large PDF → markdown) | MCP: `convert_to_markdown` | Manual (producer, not storage) |

**Frozen-snapshot rule:** MEMORY.md is injected at session start. Mid-session reads prohibited (cache waste + redundant). Read-after-Write permitted for persistence verification. `/council` skill has documented exception for cross-project reads.

**Auto-write hooks:** MemPalace diary written by stop hook every session. Graphify rebuilt nightly. Session digests written to Obsidian by orchestrator after significant sessions.

---

### Tooling integrations

**MCP servers (active):** `context7` (library docs), `obsidian` (vault R/W), `graphify` (knowledge graph), `mempalace` (conversation history + diary), `markitdown` (document ingestion), `youtube-transcript` (shipped #19, 2026-04-27)

**External:**
- **Codex/GPT-5.5** — mandatory pipeline gate step 4 via `codex-companion.mjs`; CLI ≥0.125.0; model pinned per-operator in `~/.codex/config.toml`
- **GitHub Actions** — `claude.yml` (review on @claude tag) + `claude-review-fix.yml` (fix loop, max 5 rounds); both use GH_PAT for cross-workflow triggers; concurrency groups prevent parallel loops
- **AWS Amplify Gen 2** — all client backend infra; `defineBackend`/`defineAuth`/`defineData`/`defineFunction`
- **Biome** — formatter + linter (enforced; Prettier/ESLint blocked by convention)
- **Pipeline lock** — `$PROJECT_DIR/.iago/state/.pipeline.lock.d` (atomic mkdir); liveness-checked; worktree required for parallel work

---

## Hermes wedge cross-reference table

| Wedge | iago-os status | Notes |
|---|---|---|
| A frozen-snapshot | **SHIPPED** (PR #23, 2026-04-27) | CLAUDE.md rule + MEMORY.md feedback entry + council exception comment. Fully operational. |
| B distiller | **NOT DONE** | No session-compression step exists between pipeline stages or between sessions. Long pipeline runs accumulate context without trimming. |
| C cron + [SILENT] | **PARTIAL** | `/autonomous-loops`, `/continuous-agent-loop`, `/iago-schedule` skills exist as CAPABILITY. `ScheduleWakeup` dynamic-pacing available. No `[SILENT]` marker convention in pipeline. Cron jobs are per-project manual setup, not a framework primitive. |
| D memory provider | **PARTIAL** | 5-layer architecture is richer than Hermes aggregator concept. But no single aggregator API or unified retrieval proxy — routing is documented convention, not enforced middleware. MemPalace + Obsidian + Graphify are separate MCP servers with manual routing. |
| E conditional skill activation | **NOT DONE** | Skills dispatched by orchestrator keyword match from CLAUDE.md table. No declared capability flags or runtime feature detection. No `@requires` / `@activates` convention. |
| F Telegram gateway | **NOT DONE** | No external messaging gateway. No inbound channel other than GitHub PR comments and local `claude -p`. |
| G progressive skill disclosure | **PARTIAL** | Skill catalog exists (`available-skills.md`) with size-based routing table. No runtime capability flags or session-state-aware disclosure. Skill list is fully visible in every context load, not progressively revealed. |
| H webhook + HMAC | **NOT DONE** | No signed inbound webhook path. claude-review-fix.yml uses GH_PAT for auth but no HMAC verification for external event sources. |
| I agentskills.io compliance | **NOT DONE** | No skill manifest in agentskills.io format. SKILL.md files are internal CLAUDE.md convention, not a published registry schema. |

---

## Existing competitive moat

### Moat 1: 9-stage review pipeline with no SaaS dependency

The pipeline runs entirely in bash (`scripts/execute-pipeline.sh`) with `claude -p` subprocesses. It covers: adversarial plan review before a line of code is written, implementation, build gate (tsc + vite + Playwright console), three-pass code review with domain routing and severity floors, cross-model adversarial, and async GitHub fix loop — all chained without n8n, external orchestration, or vendor lock-in beyond the Claude API. Competitors (Cursor, Copilot Workspace, Devin) run single-pass generation with optional post-hoc review. The local fix loop (max 2 rounds before PR) means most issues resolve before the PR even lands. Evidence: 10 summaries logged in `.iago/summaries/`, audit phase shipped 6 plans across PRs #11–#15 with full pipeline runs.

### Moat 2: Cross-model adversarial (Codex/GPT-5.5 gate)

Step 4 uses a different LLM (GPT-5.5) to review every diff — not Claude reviewing its own output. This catches systematic blind spots. The cwd-misfire sanity check (detects spurious "no changed files" approvals) and structured findings format (`[P0]`/`[P1]`/`[P2]`) make the gate robust. Fallback to opus adversarial ensures the gate never silently skips. No peer system makes cross-model review a mandatory, automated gate rather than an optional human step.

### Moat 3: 5-layer memory architecture with auto-capture

Most AI dev tools have zero persistent memory. iago-os has: always-loaded frozen snapshot (MEMORY.md), structured notes (Obsidian MCP), knowledge graph with entity relationships (Graphify, nightly rebuild), conversation history with vector search (MemPalace, 13.5K drawers, auto-written by stop hook), and document ingestion (MarkItDown). Retrieval routing is documented and enforced by convention. The frozen-snapshot rule preserves prefix cache — a production-quality optimization most teams don't implement. This enables cross-project context (multiple client wings) without context bleed.

---

## Internal gaps (wedge candidates)

### Gap 1: Session distiller (Wedge B)

**What's missing:** No compression step exists between long pipeline stages or at session boundaries. A 80-turn implement session accumulates full output; the review session receives it wholesale. No mechanism to emit a structured digest (changed files, decisions made, blockers) that downstream sessions can consume instead of raw output.

**Why it matters:** Pipeline stages hit context limits on large plans. The stress-test notes forwarded to impl are the only inter-stage structured handoff. Review sessions re-read full source files rather than receiving a diff-anchored summary. Token cost and latency scale with plan size.

**Suggested wedge name:** `wedge-b-distiller` — add a compress step after impl and after review that emits a structured `STAGE_SUMMARY` block (files changed, findings, decisions) written to `$PIPELINE_TMP/stage-{n}-summary.txt`; downstream sessions read summary instead of raw output when context budget is tight.

**Replication confidence:** Medium. Requires prompt engineering for consistent structured output; the pipeline's tmp-file pattern makes plumbing straightforward.

---

### Gap 2: Signed inbound webhook path (Wedge H)

**What's missing:** No HTTP endpoint accepts external events (client webhook, CI system, Slack notification) with HMAC verification. The only inbound triggers are: GitHub PR comments (GH_PAT-gated), and manual `claude -p` invocations. External systems cannot trigger a pipeline run or skill invocation without shell access.

**Why it matters:** Client deliverables increasingly need webhook-driven automation (Stripe events → n8n → pipeline, client Slack → review request, third-party CI → fix dispatch). Without a signed endpoint, integrations require manual intervention or unsecured polling.

**Suggested wedge name:** `wedge-h-webhook-gateway` — lightweight Node.js handler (verifies `X-Hub-Signature-256` or custom HMAC header) that parses event payload and shells out to `execute-pipeline.sh` or a skill with appropriate args. Deploy as Lambda or local ngrok for dev.

**Replication confidence:** High. Standard HMAC pattern, straightforward Lambda integration with existing Amplify Gen 2 stack.

---

### Gap 3: Conditional skill activation via capability flags (Wedge E)

**What's missing:** Skills are invoked by orchestrator keyword match against the `available-skills.md` table. There is no runtime mechanism for a session to declare `@requires react-19` or for the system to detect that a capability module should be injected based on file context (e.g., auto-inject `dynamodb` capability when plan references `amplify/data/`). The 13 capability modules exist but are manually composed into profiles by the skill author, not dynamically activated.

**Why it matters:** As the skill catalog grows (currently 36 SKILL.md files), manual profile composition becomes a maintenance burden. Plans touching cross-domain code (React + Lambda + DynamoDB) require the `fullstack` profile to be pre-declared rather than assembled at dispatch time. This limits modularity and creates stale profiles as capabilities evolve.

**Suggested wedge name:** `wedge-e-capability-flags` — add a `@requires` frontmatter field to SKILL.md and plan files; dispatch logic reads declared requirements and injects matching capability modules at session start. Start with static declaration, evolve to file-path-based auto-detection (if plan references `src/**/*.tsx`, inject `react-19`).

**Replication confidence:** Medium. Requires changes to dispatch prompt assembly in pipeline and skill invocation; no external dependencies.

---

## Mess to clean (housekeeping, not gaps)

- **macOS `timeout` incompatibility** — `run_claude()` uses GNU `timeout`; not available on macOS without coreutils. Sebas (Mac CTO) will hit this on first pipeline run. Fix: OS-detect, use `gtimeout` or background+sleep fallback. Tracked in STATE.md Known Issues.
- **Local main diverged from origin/main** — CRLF fix committed directly to local main; same content in PR #15. Needs `git checkout main && git pull --rebase origin main`. Tracked in STATE.md Known Issues.
- **Plan 03 (wedge-b multi-plan parallel) BLOCKED** — `.iago/plans/feature-pipeline-speed-wedges/_deferred/03-wedge-b-revived-multi-plan-parallel.md` deferred after BLOCK verdict in stress test. Not the same as Hermes Wedge B (distiller) — this is parallel plan execution. Separate concern. Confirm if deferred permanently or conditionally.
- **Plans 02/04/05 (wedge-a-plus-review-fanout, concurrent-preflight, review-codex-concurrent) all deferred** — three of five pipeline speed wedges are in `_deferred/`. Only wedge 06 (tsc/vite parallel build) shipped. Deferred plans may rot; periodic review recommended.
- **Pipeline FAIL-regex per-line bug + Codex stage 4 wrong-cwd bug** — documented in MEMORY.md `project_pipeline_bugs.md` entry. Must fix before next `/iago-execute` or `/iago-quick` run involving Codex on munet-web.
- **STATE.md timestamp stale** — `Updated: 2026-04-13` but latest entries are 2026-04-27. Minor but signals digest discipline gap.

---

## Sources

- `C:\Users\sanal\dev\iago-os\CLAUDE.md` — full read
- `C:\Users\sanal\dev\iago-os\.claude\rules\available-skills.md` — full read (in system context)
- `C:\Users\sanal\dev\iago-os\.claude\rules\execution-pipeline.md` — full read (in system context)
- `C:\Users\sanal\dev\iago-os\.claude\agents\executor.md` — full read
- `C:\Users\sanal\dev\iago-os\.claude\agents\analyst.md` — full read
- `C:\Users\sanal\dev\iago-os\.claude\skills\*\SKILL.md` — 36 files listed (not read individually; categories inferred from filenames + CLAUDE.md catalog)
- `C:\Users\sanal\dev\iago-os\scripts\execute-pipeline.sh` — full read (959 lines)
- `C:\Users\sanal\dev\iago-os\scripts\review-checks\*.md` — 10 files listed (titles/names only)
- `C:\Users\sanal\dev\iago-os\.iago\plans\**\*.md` — 14 files listed (structure inferred)
- `C:\Users\sanal\dev\iago-os\.iago\summaries\*.md` — 10 files listed
- `C:\Users\sanal\dev\iago-os\.iago\STATE.md` — full read
- `C:\Users\sanal\dev\iago-os\.github\workflows\claude.yml` — full read
- `C:\Users\sanal\dev\iago-os\.github\workflows\claude-review-fix.yml` — full read
- MEMORY.md — injected in context (project_pipeline_bugs.md, project_munet_playbook.md, reference_codex_windows.md entries referenced)
