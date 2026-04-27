# iaGO-OS Capability Matrix

**Date:** 2026-04-26
**Repo:** github.com/ilsantino/iago-os
**Mapped from:** local checkout at `C:\Users\sanal\dev\iago-os`
**Sources:** `.claude/skills/*/SKILL.md`, `.claude/agents/`, `.claude/rules/`, `.iago/hooks/`, `scripts/execute-pipeline.sh`, `.github/workflows/`, `CLAUDE.md`

---

## Premise Corrections

Two items referenced in the original request do not exist in this repo:

**"OpenClaw / NemoClaw runtime topology"** — `OpenClaw` appears only in `docs/research/cortextos.md` (a strategy doc) and two archived research files (`docs/archive/research/`). The cortextos.md document explicitly recommends killing OpenClaw-as-runtime: *"Verdict: kill OpenClaw-the-runtime. Keep OpenClaw-the-service-offering."* `NemoClaw` appears nowhere in the repo. The actual runtime is the standard Claude Code MCP layer: context7, obsidian, graphify, mempalace, markitdown, youtube-transcript — defined in `~/.claude.json` and `.claude/` project config.

**"Pipeline phases 0B-1 → 0B-3"** — `0B-` does not appear anywhere in the repo. The real pipeline is **stages 0 → 6** in `scripts/execute-pipeline.sh`: stage 0 (stress test) → 1 (implement) → 2 (build gate) → 2b (console gate) → 3 (review) → 4 (Codex adversarial) → 4b (Codex fix) → 5 (create PR) → 5b (tag @claude) → 6 (summary). The `2b` console gate is an undocumented bonus stage not mentioned in CLAUDE.md.

---

## Skills (38)

Skills live at `.claude/skills/{name}/SKILL.md`. Every skill doubles as a slash command: `/skill-name`.

### Workflow / iago-* — Planning and Execution


| Skill            | Invoke when…                                                                          |
| ---------------- | ------------------------------------------------------------------------------------- |
| `/iago-init`     | Starting a new client project; `.iago/` does not exist yet.                           |
| `/iago-discuss`  | Clarifying gray areas for a ROADMAP phase before planning starts.                     |
| `/iago-plan`     | Breaking a ROADMAP phase (or standalone feature/spec) into implementation plans.      |
| `/iago-stress`   | Adversarially stress-testing a plan file before executing it.                         |
| `/iago-execute`  | Plans exist for a ROADMAP phase and you want to run the full 9-stage pipeline.        |
| `/iago-quick`    | 1–3 task standalone fix outside a ROADMAP (creates plan + runs pipeline in one shot). |
| `/iago-fast`     | Trivial inline change, ≤3 files, no new deps, no review needed.                       |
| `/iago-verify`   | Phase is executed and PRs are merged; verify against ROADMAP success criteria.        |
| `/iago-pause`    | Saving session state mid-work to resume in a future session.                          |
| `/iago-prfix`    | Fixing review comments on an existing open PR and re-triggering the async loop.       |
| `/iago-scaffold` | Starting a new client project that needs the full React 19 + Amplify Gen 2 skeleton.  |
| `/iago-onboard`  | Bringing an existing codebase into the iaGO workflow (produces architecture map).     |


### Workflow / iago-* — Operations and Automation


| Skill            | Invoke when…                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `/iago-proposal` | Generating a scoped, priced client proposal document.                                       |
| `/iago-n8n`      | Designing n8n automation workflows (webhook/Lambda/DynamoDB/SES integrations).              |
| `/iago-agents`   | Designing multi-agent architectures for client deliverables or production deployments.      |
| `/iago-schedule` | Installing or managing scheduled triggers (nightly reviews, usage digests, build monitors). |


### Design and Research


| Skill            | Invoke when…                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `/brainstorming` | Exploring a feature idea through Socratic Q&A; produces a spec in `docs/specs/`.                 |
| `/writing-plans` | Spec is approved; breaking it into wave-organized implementation tasks.                          |
| `/deep-research` | Multi-source investigation (codebase + docs + web) needed on any topic.                          |
| `/council`       | Business or strategic decision with genuine uncertainty; runs 5-advisor + peer-review synthesis. |
| `/santa-method`  | Complex, ambiguous problem needs decomposition before brainstorming begins.                      |
| `/code-review`   | Implementation is done; needs a structured review before merge (outside pipeline).               |


### Content and Business


| Skill                 | Invoke when…                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `/content-engine`     | Writing articles, blog posts, or multi-format content output (blog + social + newsletter). |
| `/investor-materials` | Creating pitch decks, one-pagers, or executive summaries for investors.                    |
| `/investor-outreach`  | Drafting personalized investor emails or outreach sequences.                               |
| `/frontend-slides`    | Generating presentation slides from code, data, or content.                                |
| `/visa-doc-translate` | Translating or preparing visa and immigration documents.                                   |


### Audit / Bug Bounty — On-Demand Deep Sweeps

These are periodic deep-sweep tools. The highest-leverage rules from both are already promoted into the pipeline via `scripts/review-checks/amplify.md` and `scripts/review-checks/data-integrity.md`.


| Skill                  | Invoke when…                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `/amplify-bug-bounty`  | Running a full ~200-rule Amplify Gen 2 audit (pre-launch, post-incident, or monthly sweep). |
| `/frontend-bug-bounty` | Running a full ~280-rule React 19 + Vite + TS + Tailwind audit (same cadence triggers).     |


### Specialized


| Skill                          | Invoke when…                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `/subagent-driven-development` | Executing a multi-task plan in-session (not via pipeline) with one fresh agent per task.         |
| `/autonomous-loops`            | Long bounded task (bulk refactor, migration) that doesn't need per-step approval.                |
| `/continuous-agent-loop`       | Maintaining a persistent monitoring/polling agent over time.                                     |
| `/industry-patterns`           | Building domain-specific features; loads DynamoDB schemas and compliance rules per vertical.     |
| `/healthcare-phi-compliance`   | Any feature that handles PHI (HIPAA patterns for AWS).                                           |
| `/liquid-glass-design`         | Implementing glassmorphism / liquid glass UI effects (TailwindCSS 4 + ShadCN).                   |
| `/agent-payment-x402`          | Designing agent-to-agent payment flows via the x402 HTTP payment protocol.                       |
| `/prompt-optimizer`            | Optimizing Claude SDK prompts for client-facing features (chatbots, agents, extraction).         |
| `/remotion-animation`          | Producing programmatic video deliverables with Remotion (marketing, investor decks, explainers). |


### Codex (Cross-Model)


| Skill                       | Invoke when…                                                                   |
| --------------------------- | ------------------------------------------------------------------------------ |
| `/codex:rescue`             | Delegating a stuck debug or fix to GPT-5.4 for a cross-model second opinion.   |
| `/codex:adversarial-review` | Running a cross-model auth/data-loss/race-condition review against a git diff. |
| `/codex:review`             | GPT-5.4 read-only review of the current branch's changes.                      |
| `/codex:status`             | Checking active or recent Codex background jobs.                               |
| `/codex:result`             | Retrieving output from a finished Codex job.                                   |
| `/codex:cancel`             | Cancelling an active Codex background job.                                     |
| `/codex:setup`              | Verifying Codex CLI readiness and toggling the stop-time review gate.          |


---

## Slash Commands (non-skill, Claude Code native)

These are built into Claude Code and not backed by `.claude/skills/` files.


| Command       | Invoke when…                                                            |
| ------------- | ----------------------------------------------------------------------- |
| `/simplify`   | Reviewing recently changed code for reuse, quality, and efficiency.     |
| `/loop`       | Running a prompt or slash command on a recurring interval.              |
| `/schedule`   | Creating or managing cron-scheduled remote agents (session-persistent). |
| `/claude-api` | Building, debugging, or migrating Claude API / Anthropic SDK code.      |
| `/ultraplan`  | Cloud planning on Opus 4.6 via CCR (30-minute compute budget).          |
| `/powerup`    | Running in-terminal interactive tutorials.                              |
| `/insights`   | Generating a 30-day usage analytics HTML report.                        |


No `.claude/commands/` directory exists in this repo. All slash command routing goes through `.claude/skills/`.

---

## Agents

### Base Agents (`.claude/agents/`)


| Base     | File          | Tools                                         | Model  | Role                                                |
| -------- | ------------- | --------------------------------------------- | ------ | --------------------------------------------------- |
| executor | `executor.md` | Read, Glob, Grep, Edit, Write, Bash, Notebook | opus   | Implements code; writes files.                      |
| analyst  | `analyst.md`  | Read, Glob, Grep, Bash                        | sonnet | Read-only analysis; reviews, diagnostics, modeling. |
| operator | `operator.md` | Read, Glob, Grep, Bash, WebSearch, WebFetch   | sonnet | External data, heavy CLI, infrastructure, research. |


### Profiles (`.claude/agents/profiles/`)


| Profile          | Base              | Capabilities                                      | Invoke when…                                                         |
| ---------------- | ----------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| `fullstack`      | executor / opus   | react-19, dynamodb, lambda, tdd, forms, animation | Task spans both `src/` and `amplify/`.                               |
| `frontend`       | executor / opus   | react-19, tdd, forms, animation                   | Changes confined to `src/features/` or `src/components/`.            |
| `backend`        | executor / opus   | dynamodb, lambda, cognito, tdd                    | Changes confined to `amplify/`.                                      |
| `review-full`    | analyst / sonnet  | security, review-spec, review-quality             | Full phase execution (`/iago-execute`); two-stage spec-gated review. |
| `review-single`  | analyst / sonnet  | security, review-spec, review-quality             | Lightweight workflow (`/iago-quick`); single-pass review.            |
| `security-audit` | analyst / opus    | security, cognito, review-quality                 | Auth, payment, or data-access code changes; always uses opus.        |
| `research`       | operator / sonnet | dynamic (topic-selected)                          | `/deep-research` or `/iago-onboard --deep`.                          |
| `e2e`            | executor / opus   | e2e, react-19                                     | Writing or updating Playwright tests in `e2e/`.                      |
| `infra`          | operator / sonnet | infra                                             | AWS CLI, Amplify sandbox/pipeline, CloudWatch.                       |
| `schema`         | analyst / sonnet  | dynamodb                                          | DynamoDB schema design and GSI strategy (design artifact, no code).  |
| `content`        | operator / sonnet | content                                           | Blog posts, investor materials, outreach, slide decks.               |
| `debug`          | executor / opus   | dynamic (error-type-selected)                     | Build, TypeScript, or lint failures during pipeline.                 |


### Capability Modules (`.claude/agents/capabilities/`)

13 modules injected into agent dispatch prompts:

`react-19`, `dynamodb`, `lambda`, `cognito`, `tdd`, `security`, `e2e`, `review-spec`, `review-quality`, `content`, `infra`, `forms`, `animation`

---

## MCP Servers

Defined globally in `~/.claude.json`. Six active servers.


| Server               | What                                                                 | Invoke when…                                                                                     |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `context7`           | Fetch current library/framework docs on demand                       | Need API syntax, setup, version migration for any library (React, Amplify, Zod, etc.).           |
| `obsidian`           | Read/write the Obsidian vault at `C:\Users\sanal\dev\obsidian-brain` | Accessing session digests, meeting notes, decisions, business docs, or writing new notes.        |
| `graphify`           | Knowledge graph + community wiki over the full vault                 | Entity relationships, community structure, navigation before raw keyword search.                 |
| `mempalace`          | ChromaDB vector store over conversation history + agent diary        | Past reasoning trails, rejected alternatives, cross-session agent continuity.                    |
| `markitdown`         | Convert DOCX, PPTX, XLSX, EPub, YouTube, large PDFs → markdown       | Ingesting client files Claude cannot read natively (briefs, RFPs, financial models, large PDFs). |
| `youtube-transcript` | Fetch YouTube video transcripts via InnerTube API                    | Transcribing YouTube videos (replaces the broken markitdown YouTube handler).                    |


**Retrieval routing:**


| Need                                        | Tool                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Structured notes, decisions, meetings       | Obsidian MCP                                                             |
| Entity relationships, community structure   | Graphify MCP (`query_graph`, `get_node`) or `graphify-out/wiki/index.md` |
| Past conversation recall, reasoning trails  | MemPalace (`mempalace_search`)                                           |
| Cross-session agent continuity              | MemPalace diary (`mempalace_diary_read`)                                 |
| Library/framework docs                      | Context7 (`query-docs`)                                                  |
| Document ingestion (DOCX, XLSX, large PDFs) | MarkItDown MCP (`convert_to_markdown`)                                   |
| YouTube video content                       | youtube-transcript MCP (`transcribe_video`)                              |


---

## Pipeline (`scripts/execute-pipeline.sh`, stages 0 → 6)

Invoked per plan. Controlled by `--plan`, `--project-dir`, `--no-tag`, `--no-pr`. Acquires a file-based lock (`$PROJECT_DIR/.iago/state/.pipeline.lock.d`) to prevent concurrent runs on the same worktree.


| Stage | Name              | Model                                                 | Reads                                                       | Writes / Produces                                                                | Notes                                                                                                                                                                                                                                                                               |
| ----- | ----------------- | ----------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Stress test       | opus (max 15 turns)                                   | Plan file, CLAUDE.md, referenced source files               | `$PIPELINE_TMP/stress.txt`, `stress-findings.txt`                                | Skipped if plan has `## Stress Test` section. Verdicts: PROCEED / PROCEED_WITH_NOTES / BLOCK. BLOCK halts pipeline.                                                                                                                                                                 |
| 1     | Implement         | opus (max 80 turns)                                   | Plan file, stress findings (if any)                         | Edits/creates source files in project                                            | Stress findings are MANDATORY requirements forwarded to implementer.                                                                                                                                                                                                                |
| 2     | Build gate        | —                                                     | `tsconfig.json`, `vite.config.`*                            | Build output (not written to disk)                                               | Runs `tsc --noEmit && vite build`. Max 2 retries; each retry spawns an opus fix session.                                                                                                                                                                                            |
| 2b    | Console gate      | opus (max 30 turns, fix only)                         | Routes config, Playwright, Vite preview                     | `$PIPELINE_TMP/console-errors.json` (on failure)                                 | Runs `scripts/console-check.mjs` via Playwright against `vite preview`. Skipped if no Vite config or Playwright unavailable. Max 2 retries.                                                                                                                                         |
| 3     | Review            | opus (max 35 turns)                                   | Plan file, diff, all review-checks modules, stress findings | `$PIPELINE_TMP/review.txt`                                                       | Three-pass: plan compliance → domain routing (reviewer selects relevant domains) → adversarial. Cross-cutting always checked: auth bypass, data loss, races, rollback safety. Findings trigger fix + rebuild + re-review (max 2 rounds). Verdict: PASS / PASS_WITH_CONCERNS / FAIL. |
| 4     | Codex adversarial | GPT-5.4 via `codex-companion.mjs`; falls back to opus | Plan file, diff (`PRE_IMPL_SHA..HEAD`)                      | `$PIPELINE_TMP/codex.txt`                                                        | Checks: auth bypass, data loss, race conditions, rollback safety, business logic. Falls back to Claude opus if Codex CLI unavailable.                                                                                                                                               |
| 4b    | Codex fix         | opus (max 40 turns)                                   | Codex findings file, plan file                              | Source file edits; followed by build gate re-run                                 | Skipped if no actionable findings. Fix priority: P0 → P1 → P2.                                                                                                                                                                                                                      |
| 5     | Create PR         | sonnet (max 15 turns)                                 | Plan file, git diff                                         | Feature branch push, GitHub PR (with full plan in collapsible `<details>` block) | Skipped if `--no-pr`. With `--no-pr`, creates a stacked commit locally instead.                                                                                                                                                                                                     |
| 5b    | Tag @claude       | sonnet (max 3 turns)                                  | Plan file, diff                                             | PR comment tagging @claude with context-rich review request                      | Skipped if `--no-tag`. Triggers async GH Actions review-fix loop.                                                                                                                                                                                                                   |
| 6     | Summary           | —                                                     | Pipeline state variables, `git diff --stat`                 | `.iago/summaries/{plan-name}.md`                                                 | Records: implement exit code, build/review/Codex outcomes, PR URL, diff stats.                                                                                                                                                                                                      |


**Timeout values (run_claude):** stress test 600s, implement 1800s, build/review fix 600s, review 900s, Codex fix 900s, PR creation 600s, tag synthesis 120s.

---

## GitHub Actions Review-Fix Loop

**Files:** `.github/workflows/claude.yml`, `.github/workflows/claude-review-fix.yml`, `.github/workflows/validate.yml`

### Flow

```
pipeline step 5b: gh pr comment "@claude Review this PR..."
      │
      ▼
claude.yml — Claude Code Action runs (triggered on @claude mention)
      │  Reviews PR; posts review comment as claude[bot]
      │  After action completes: posts [claude-review-complete] signal
      │  via GH_PAT (separate comment — needed to trigger next workflow)
      ▼
claude-review-fix.yml — triggered by [claude-review-complete] signal
      │
      ├── Check latest claude[bot] comment for clean signals:
      │   "no issues found", "all findings resolved", etc.
      │   Also check: no active Critical/Important finding labels
      │   Also check: allChecked (all - [x], no - [ ])
      │
      ├── Count [review-fix-loop] retag comments → round number
      │
      ├── CLEAN → post ## Review Summary → stop (human merges)
      │
      ├── MAX ROUNDS (>5) → post notice → stop (manual review required)
      │
      └── FINDINGS → Claude Code fix agent runs
                       │  Fixes all inline review comments from claude[bot]
                       ▼
                     git commit + push (with fallback push step)
                       │
                       ▼
                     Re-tag @claude with [review-fix-loop] marker
                       │
                       └──▶ back to claude.yml (next round)
```

**Key design choices:**

- `concurrency: group: claude-review-${{ pr-number }}, cancel-in-progress: false` — no parallel loops on same PR.
- `concurrency: group: claude-review-fix-${{ pr-number }}, cancel-in-progress: false` — fix loop also serialized.
- Signal comment uses `GH_PAT` (not `GITHUB_TOKEN`) — personal access tokens can trigger other workflows; `GITHUB_TOKEN` cannot.
- Both workflows guard `github.event.issue.state == 'open'` — never runs on merged/closed PRs.
- Summary auto-posted when clean; `summaryAlreadyPosted` guard prevents summary→signal→summary infinite loops.
- `validate.yml` runs on push to validate hooks and skills (uses `scripts/validate-hooks.sh`, `scripts/validate-skills.sh`).

---

## Memory Architecture (5 Layers)


| Layer      | What                                                                    | File / Location                                                  | Access                                                                          | Automation                                                                                     | When to use                                                                                 |
| ---------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| MEMORY.md  | User prefs, feedback, project context                                   | `~/.claude/projects/C--Users-sanal-dev-iago-os/memory/MEMORY.md` | Always-loaded in context                                                        | Manual (Claude writes feedback entries)                                                        | Persistent preferences and cross-project context that must survive every session.           |
| Obsidian   | Session digests, meetings, decisions, business docs                     | `C:\Users\sanal\dev\obsidian-brain`                              | MCP (`read_note`, `write_note`, `search_notes`, `list_directory`, `patch_note`) | Semi-auto (stop hook writes session digest after significant sessions)                         | Structured notes with dates, attendees, decisions, action items.                            |
| Graphify   | Knowledge graph + community wiki over full vault (incl. Drive)          | `obsidian-brain/graphify-out/` (graph.json, wiki/, graph.html)   | MCP (`query_graph`, `get_node`, `get_community`) + `wiki/index.md`              | Auto (nightly rebuild via Task Scheduler at 6am; or `bash ~/.claude/scripts/rebuild-graph.sh`) | Entity relationships, community structure — check before raw keyword search.                |
| MemPalace  | Conversation history, reasoning trails, agent diary                     | `~/.mempalace/` (ChromaDB)                                       | MCP (`mempalace_search`, `mempalace_diary_read`, `mempalace_diary_write`)       | Auto (stop hook writes diary entry every session; bulk backfill via `mempalace mine`)          | Past conversation recall, rejected alternatives, implicit reasoning not in session digests. |
| MarkItDown | Document conversion (DOCX/PPTX/XLSX/EPub/YouTube/large PDFs → markdown) | Stateless (producer, not storage)                                | MCP (`convert_to_markdown(uri)`)                                                | Manual (called on demand when ingesting client files)                                          | Upstream ingestion gateway — converts to markdown so other layers can store it.             |


**MemPalace wings (7):** `iago_os`, `munet`, `din`, `sentria`, `installflow`, `santiago`, `business`. 13.5K drawers total.

---

## Rules (`.claude/rules/`)


| Rule file                 | When it applies                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `available-skills.md`     | Reference index for all skills — consult when choosing the right skill for a task.                                                                    |
| `execution-pipeline.md`   | Mandatory enforcement: every plan must go through `/iago-execute`; no direct implementation.                                                          |
| `tdd.md`                  | RED-GREEN-REFACTOR discipline, rationalization prevention, 80% coverage target.                                                                       |
| `systematic-debugging.md` | 4-phase debug cycle (reproduce → isolate → fix → verify), 3-fix escalation rule.                                                                      |
| `git-workflow.md`         | Branch naming (`type/short-desc`), conventional commits, squash-merge to main, semver tags.                                                           |
| `react-vite.md`           | React 19 patterns: `use()` hook, Suspense, TanStack Query, ShadCN/UI, Vite aliases. Path-scoped: `src/**/*.tsx`.                                      |
| `aws-amplify.md`          | Amplify Gen 2 mandatory patterns: `defineBackend`, DynamoDB single vs multi-table, Lambda thin handlers, Cognito JWT, SES. Path-scoped: `amplify/`**. |
| `e2e-testing.md`          | Playwright conventions: selector priority, `data-testid`, `storageState`, no `waitForTimeout`. Path-scoped: test files.                               |
| `mcp-server-patterns.md`  | MCP Node/TS SDK patterns: `McpServer`, Zod validation, `McpError`, `StdioServerTransport`. Path-scoped: MCP files.                                    |


---

## Hooks (`.iago/hooks/`)

Invoked by Claude Code via settings.json event bindings.


| Hook file                    | Event trigger                          | What it does                                                                       |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `commit-quality.mjs`         | PreToolUse / Bash                      | Validates conventional commit message format and scans staged changes for secrets. |
| `config-protection.mjs`      | PreToolUse / Edit|Write|MultiEdit      | Blocks edits to protected config files (`.gitignore`, `biome.json`, etc.).         |
| `context-persistence.mjs`    | SessionStart, PreCompact, Stop         | Manages session snapshots and `HANDOFF.json` recovery across sessions.             |
| `post-edit-console-warn.mjs` | PostToolUse / Edit                     | Warns when edited JS/TS files contain `console.log/warn/error` calls.              |
| `post-edit-format.mjs`       | PostToolUse / Edit                     | Runs Biome format on the edited file immediately after each edit.                  |
| `post-edit-typecheck.mjs`    | PostToolUse / Edit                     | Runs `tsc --noEmit` filtered to the edited file after each edit.                   |
| `safety-guard.mjs`           | PreToolUse / Bash|Edit|Write|MultiEdit | Blocks destructive commands, detects secret exposure, catches injection attempts.  |
| `usage-tracker.mjs`          | PostToolUse (Skill + Agent), Stop      | Logs skill invocations and session summaries to `.iago/state/usage-log.jsonl`.     |


---

## Key Scripts (`scripts/`)


| Script                                 | What it does                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute-pipeline.sh`                  | Core 9-stage pipeline runner. Accepts `--plan`, `--project-dir`, `--no-tag`, `--no-pr`. Acquires file lock, runs all stages, writes summary. |
| `console-check.mjs`                    | Pipeline stage 2b. Starts `vite preview`, navigates routes with Playwright, captures console errors. Exit 0=clean, 1=errors, 2=skipped.      |
| `sync-skills.sh` / `sync-skills.ps1`   | Syncs `.claude/skills/`, `.claude/agents/`, and `.claude/rules/` from iago-os to a client project directory or globally.                     |
| `new-client.sh` / `new-client.ps1`     | Scaffolds a new client project (delegates to `/iago-scaffold`).                                                                              |
| `validate-hooks.sh`                    | Checks all `.iago/hooks/*.mjs` files for Node.js syntax errors.                                                                              |
| `validate-skills.sh`                   | Validates all SKILL.md files for required frontmatter (`name:`, `description:`).                                                             |
| `usage-report.sh` / `usage-report.ps1` | Generates usage analytics from `.iago/state/usage-log.jsonl`.                                                                                |
| `setup-memory.sh` / `setup-memory.ps1` | Bootstrap script for MemPalace ChromaDB and vault configuration.                                                                             |


**Codex companion scripts** (at `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/`):

- `codex-companion.mjs` — pipeline step 4 adversarial review via GPT-5.4; used by `execute-pipeline.sh`.
- `stop-review-gate-hook.mjs` — optional stop-time review gate (toggleable via `/codex:setup`).

---

## Review Checks (`scripts/review-checks/`)

10 domain modules loaded by the pipeline's step 3 review session. The reviewer LLM selects relevant domains based on the diff.


| Module              | Domain coverage                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `baseline.md`       | Always-loaded cross-cutting rules (auth bypass, data loss, race conditions, rollback safety). |
| `amplify.md`        | Amplify Gen 2 CFN cycles, AppSync auth, multi-tenancy, IAM, resource definition patterns.     |
| `api.md`            | API Gateway configuration, request validation, CORS, throttling.                              |
| `auth.md`           | Authentication flows, JWT handling, Cognito integration, token refresh.                       |
| `backend.md`        | Lambda handler patterns, DynamoDB access, error handling, cold start.                         |
| `data-integrity.md` | Section Q rules: paginated KPIs, NaN aggregates, money drift, tenant-filter on aggregates.    |
| `i18n.md`           | Internationalization patterns, locale handling, translation key hygiene.                      |
| `infra.md`          | Infrastructure-as-code patterns, Amplify Gen 2 resource definitions, IAM grants.              |
| `patterns.md`       | General code quality patterns (naming, colocation, barrel exports, TypeScript strictness).    |
| `react.md`          | React 19 hook rules, Suspense/ErrorBoundary, effect cleanup, memoization, TanStack Query.     |


---

## End-to-End Workflows

### 1. Full Delivery (multi-phase project)

```
/iago-init              → bootstrap .iago/ + PROJECT.md + ROADMAP.md + STATE.md
     │
/iago-discuss {phase}   → clarify gray areas before planning (interactive Q&A)
     │
/iago-plan {phase}      → break phase into plans (2–8 tasks each) + stress test
     │
/iago-execute {phase}   → run all plans through 9-stage pipeline
     │                     (stress → impl → build → console → review → codex → codex-fix → PR → @claude tag)
     │
/iago-verify {phase}    → verify phase against ROADMAP goals; advance to next phase
```

### 2. Standalone Feature (no ROADMAP needed)

```
/iago-plan --feature "description" (or --feature path/to/spec.md)
     │    → produces .iago/plans/feature-{slug}/01.md, 02.md, ...
     │
/iago-execute feature-{slug}
     │    → same 9-stage pipeline per plan
     │
(optional) /iago-verify feature-{slug}
```

Flags: `--research` (scan codebase first), `--discuss` (inline Q&A), `--no-stress`, `--no-review`.

### 3. Quick Fix (1–3 tasks, clear scope)

```
/iago-quick "fix login redirect after signup"
     → creates lightweight plan (max 3 tasks)
     → runs execute-pipeline.sh with full 9-stage pipeline
     → creates PR, tags @claude (suppress with --no-tag)
```

### 4. Trivial Fix (≤3 files, obvious)

```
/iago-fast "update API base URL env var"
     → inline edit + tsc --noEmit + biome check
     → atomic commit + STATE.md log entry
     → no PR, no review, no pipeline
```

All of these must be true: ≤3 files, no new deps, obvious one-sentence change, not part of ROADMAP.

### 5. Pre-Launch Audit Sweep

```
/amplify-bug-bounty          → full ~200-rule Amplify Gen 2 audit
/frontend-bug-bounty         → full ~280-rule React 19 + Vite + TS + Tailwind audit

When to run: new client onboarding, pre-launch hardening, post-incident, monthly sweep.
Not needed per-plan: pipeline already runs highest-leverage rules from each.
```

### 6. PR Review-Fix Loop (async GitHub Actions)

```
Pipeline step 5b (or /iago-prfix)
     → gh pr comment "@claude Review this PR thoroughly. [context...]"
     │
     ▼
claude.yml — Claude Code Action reviews PR
     → Posts review as claude[bot] comment
     → Posts [claude-review-complete] signal via GH_PAT
     │
     ▼
claude-review-fix.yml — triggered by signal
     ├── CLEAN → post ## Review Summary → stop
     ├── MAX ROUNDS (>5) → post notice → manual review
     └── FINDINGS → fix agent fixes all inline comments
                      → commit + push
                      → re-tag @claude with [review-fix-loop]
                      → loops back to claude.yml
```

---

## Recommendation

**Decision:** Keep `research/iago-os-capability-matrix.md` as the canonical reference; do not merge it into `.claude/rules/available-skills.md` or put it on a cron.

**Confidence:** High

**Reasoning:** `available-skills.md` is an operational quick-reference loaded into every session via CLAUDE.md's rules injection. It deliberately stays terse so it doesn't inflate context cost. This matrix is 5× longer — it includes pipeline internals, hook details, review-check modules, and GitHub Actions flow that are not needed at task-selection time. Merging them would push the always-loaded rules file past the point of diminishing returns: more tokens spent per session, no gain in routine task routing. A cron via `/schedule` is also wrong: the matrix reflects structure, not data — it should be updated when the repo changes, not on a calendar. The right trigger is a human judgment call (after significant architectural changes, new skill additions, or client onboarding). `research/` is the correct home: it's discoverable via `docs/research/` searches and Obsidian's `search_notes`, but it doesn't burn context on every session.

**Next step:** Add a one-line entry to MEMORY.md pointing to this file so it surfaces in future context loads. Then re-run this research task after any batch of skill additions or pipeline changes (treat it as a living document, not a one-time artifact).

**Risk if wrong:** If promoted to `available-skills.md`, every session pays ~2K extra tokens loading pipeline internals that only matter during debugging. If put on a cron, it generates stale matrix snapshots that diverge from the real repo faster than a cron can keep up with. Neither is catastrophic — just wasteful. The cost of keeping it in `research/` is that new team members (Sebas onboarding) need to be told it exists.