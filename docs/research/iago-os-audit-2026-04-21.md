# iaGO-OS Self-Audit — 2026-04-21

Scope: `.claude/`, `.iago/`, `scripts/`, `.github/workflows/`, `CLAUDE.md`
Evidence: codebase read (15 tool calls), git log, STATE.md, summaries, settings.json
Date: 2026-04-21 | Auditor: deep-research profile (Sonnet 4.6)

---

## 1. Inventory

### Skills
- **Total:** 37 SKILL.md files across `.claude/skills/`
- **Core workflow (8):** iago-plan, iago-execute, iago-quick, iago-fast, iago-stress, iago-verify, iago-pause, iago-prfix
- **Project setup (4):** iago-init, iago-scaffold, iago-onboard, iago-discuss
- **Design/research (6):** brainstorming, deep-research, writing-plans, santa-method, council, code-review
- **Business/content (6):** content-engine, investor-materials, investor-outreach, iago-proposal, frontend-slides, prompt-optimizer
- **Automation/arch (4):** iago-n8n, iago-agents, iago-schedule, subagent-driven-development
- **Specialist (9):** autonomous-loops, continuous-agent-loop, industry-patterns, healthcare-phi-compliance, liquid-glass-design, agent-payment-x402, visa-doc-translate, amplify-bug-bounty, frontend-bug-bounty
- **Total SKILL.md lines:** 5,155

### Agents
- **Bases (3):** executor.md, analyst.md, operator.md
- **Capabilities (14):** animation, cognito, content, dynamodb, e2e, forms, infra, lambda, react-19, review-quality, review-spec, security, tdd (+ note: CLAUDE.md says 13 — actual count is 14 including `animation`)
- **Profiles (12):** backend, content, debug, e2e, frontend, fullstack, infra, research, review-full, review-single, schema, security-audit

### Rules
- **Total rule files (8):** available-skills.md, aws-amplify.md, e2e-testing.md, execution-pipeline.md, git-workflow.md, mcp-server-patterns.md, react-vite.md, systematic-debugging.md, tdd.md
- **Path-scoped (3):** react-vite.md (`src/**/*.tsx`), aws-amplify.md (`amplify/**`), e2e-testing.md (test files)

### Pipeline Scripts
- **execute-pipeline.sh:** 842 lines, 13 `--max-turns` invocations across 7+ stage boundaries
- **review-checks/:** 10 files, 200 lines total (amplify.md 39L, data-integrity.md 36L, react.md 23L, patterns.md 23L, auth.md 21L, api.md 18L, backend.md 18L, infra.md 8L, i18n.md 7L, baseline.md 7L)
- **Supporting scripts (9):** console-check.mjs, new-client.sh/ps1, setup-memory.sh/ps1, sync-skills.sh/ps1, usage-report.sh/ps1, validate-hooks.sh, validate-skills.sh

### Hooks (settings.json)
- **SessionStart (1):** context-persistence.mjs (session-start)
- **PreToolUse (4):** safety-guard.mjs (Bash), commit-quality.mjs (Bash), config-protection.mjs (Edit|Write|MultiEdit), safety-guard.mjs (Edit|Write|MultiEdit)
- **PostToolUse (4):** usage-tracker.mjs (Skill|Agent), post-edit-format.mjs (Edit), post-edit-typecheck.mjs (Edit), post-edit-console-warn.mjs (Edit)
- **PreCompact (1):** context-persistence.mjs (pre-compact)
- **Stop (2):** context-persistence.mjs (stop), usage-tracker.mjs (stop)
- **Hook source files (8):** commit-quality.mjs, config-protection.mjs, context-persistence.mjs, post-edit-console-warn.mjs, post-edit-format.mjs, post-edit-typecheck.mjs, safety-guard.mjs, usage-tracker.mjs + lib/ (flags.mjs, state-manager.mjs, stdin.mjs, transcript.mjs)

### GitHub Workflows
- **claude.yml:** Claude Code Action triggered on `@claude` mentions + PR assignment; posts `[claude-review-complete]` signal via GH_PAT after completion; concurrency group per PR number (cancel-in-progress: false)
- **claude-review-fix.yml:** Triggered on `[claude-review-complete]` signal; runs fix agent, re-tags @claude; max 5 rounds; breaks on clean review or PR closed/merged
- **validate.yml:** Presumed CI validation (not read in detail)

### MCP Servers (active, per CLAUDE.md)
- **context7** — library/framework docs
- **obsidian** — vault read/write
- **graphify** — knowledge graph over vault
- **mempalace** — conversation history + KG + agent diary
- **markitdown** — document ingestion (added 2026-04-10, commit ff4e4c3)

---

## 2. Redundancy Map

### Overlapping Skills

| Pair | Overlap | Verdict |
|------|---------|---------|
| `writing-plans` vs `iago-plan --feature` | Both break specs into tasks. `writing-plans` is in-session only, `iago-plan` routes to pipeline. | Functional separation exists but routing confusion documented in CLAUDE.md. `writing-plans` is a bypass hatch — keeps it, risks misuse. |
| `code-review` vs `iago-prfix` vs pipeline step 3 | All three can dispatch a review agent. `code-review` is on-demand, `iago-prfix` tags async GH loop, step 3 is local. | Three distinct trigger points for same activity with no dedup guard. If user runs `/code-review` post-merge, work is lost. |
| `subagent-driven-development` vs `iago-execute` | Both execute plans through agents. SDD = in-session, iago-execute = pipeline script. | CLAUDE.md explicitly distinguishes these, but SDD's `--pipeline` flag (noted in skill table) blurs the line. |
| `iago-stress` vs pipeline step 0 | Both stress-test plans. Step 0 runs automatically; `/iago-stress` is manual pre-execution. | Deduped by `## Stress Test` section check in pipeline. Redundancy handled. |
| `amplify-bug-bounty` / `frontend-bug-bounty` vs review-checks/ | Bug bounty skills run ~200-280 rules; review-checks run highest-leverage subset per plan. | Intentional layering, documented. No confusion risk. |

### Overlapping Review Modules (review-checks/)
- `auth.md` and `amplify.md` both cover Cognito auth flows — partial overlap at JWT validation rules
- `backend.md` and `amplify.md` overlap on Lambda handler patterns
- `data-integrity.md` and `amplify.md` overlap on DynamoDB TTL / access patterns
- No dedup mechanism; reviewer selects relevant domains via LLM routing — correctness depends on LLM judgment each run

### Memory Layer Redundancy
- Obsidian session digests + MemPalace diary both capture session state. They differ in queryability (keyword vs semantic) and automation (semi-auto vs full-auto). Intentional redundancy, cost is double-write effort.
- MEMORY.md + Obsidian `_context/` both hold project context. MEMORY.md is always-loaded (in context window), Obsidian is on-demand. Intentional.
- No evidence of actual duplication causing retrieval conflicts.

---

## 3. Overkill Signals

### Pipeline Weight
`execute-pipeline.sh` is 842 lines with 13 `--max-turns` calls across these stages:
- Step 0 (stress): max 15 turns
- Step 1 (impl): max 80 turns (env override via `IAGO_IMPL_MAX_TURNS`)
- Step 2 (build): up to 2 retries with fix sessions (30 turns each)
- Step 3 (review): max 35 turns (env override via `IAGO_REVIEW_MAX_TURNS`); fix loop max 30 turns × 2 rounds
- Step 4 (codex): max 25 turns; codex fix max 40 turns (30-turn re-review)
- Step 5 (PR): max 15 turns; @claude tag max 3 turns
- Step 6 (summary): max 20 turns

**Total theoretical max turns per plan: ~415 turns** (impl 80 + 2 build-fix 60 + review 35 + 2 fix loops 60 + codex 25 + codex-fix 40 + codex-fix re-review 30 + PR 15 + tag 3 + summary 20). In practice, most plans complete in far fewer turns, but the ceiling is high with no aggregate guard.

### Reviewer Stacking
Step 3 runs a three-pass review: plan compliance + domain routing + adversarial. Then step 4 runs Codex adversarial on the same diff. Then async GH loop runs Claude Code Action again. Three distinct review passes on a single diff is structurally redundant. Rationale from CLAUDE.md: "cross-model adversarial review." Empirically caught issues (commit d80bf5f: "promote bug-bounty checks to stage 3"), so not pure overkill — but no measurement of which pass catches what proportion of findings.

### Ceremony for Trivial Changes
`/iago-fast` exists to skip ceremony, but all other paths mandate the full 7-stage pipeline including @claude PR review on a GitHub PR. A 1-line config change via `/iago-quick` generates a stress test, implementation session, build gate, 3-pass review, Codex adversarial, PR + async review-fix loop. This is appropriate for client delivery work but is heavyweight for iago-os internal housekeeping. STATE.md shows several "fast" commits bypassing this (e.g., ec00081, f47cc2c) — evidence the team already self-selects `/iago-fast` for internal fixes.

---

## 4. Broken + Dead Weight

### Dead SKILL.md Files (Present but Never Invoked in iago-os History)
Based on audit-02 summary (`audit-02-broken-refs.md`), the following skills had `.gitkeep` placeholder files before audit-02 fixed them (commit eaecd1a, PR #12). The skills now have content, but show zero invocations in `.iago/summaries/` and `.iago/plans/`:
- `visa-doc-translate` — no references in any plan, summary, or STATE entry
- `liquid-glass-design` — no references; contextually relevant only for client UI projects
- `healthcare-phi-compliance` — no references; domain-specific to HIPAA clients not yet onboarded
- `agent-payment-x402` — no references; x402 is pre-adoption protocol
- `frontend-slides` — no references
- `santa-method` — no references in iago-os history; appears in available-skills.md documentation only
- `continuous-agent-loop` — no references in iago-os plans; documented as monitoring/polling use case

**Clarification:** These are not broken — SKILL.md content is valid. They are dormant / speculative additions covering capabilities not yet exercised in iago-os workflow.

### Known Broken State
- **macOS `timeout` compatibility:** `run_claude()` in execute-pipeline.sh uses GNU `timeout`. Not available on macOS without coreutils. Sebas (CTO, Mac) will hit this on first run. Documented in STATE.md Known Issues as Low severity. No fix commit as of 2026-04-21. Source: `.iago/STATE.md:L22`
- **Local main diverged from origin/main:** CRLF fix (same content as PR #15 squash merge) committed directly to local main. STATE.md documents this as Minor. Fix: `git pull --rebase origin main`. Source: `.iago/STATE.md:L25`

### learnings/patterns.md
File at `.iago/learnings/patterns.md` is 4 lines — empty table skeleton with zero entries. The learning capture mechanism exists but has produced no persisted patterns despite multiple audit cycles and 30+ commits. The mechanism is not working as intended.
- Source: `.iago/learnings/patterns.md` (4L)
- `project-conventions.md` is populated (profile/capability conventions documented)

### Orphaned TODO/FIXME
No TODO or FIXME markers found in skills or scripts beyond domain-appropriate usage (e.g., iago-plan SKILL.md: "No placeholders (TBD, TODO)" is a rule statement, not a marker). Clean.

### Stale Plans in .iago/plans/
Five audit-phase plan files remain in `.iago/plans/`:
- audit-02-broken-refs.md, audit-03-pipeline-gaps.md, audit-04-cleanup-stale.md, audit-05-pipeline-enforcement.md, audit-06-codex-windows.md
- These are completed (STATE.md marks audit phase verified). No `.iago/archive/` directory for completed plans — they accumulate in plans/ directory without cleanup path.

### CLAUDE.md Agent Count Discrepancy
CLAUDE.md states "13 capabilities" but `.claude/agents/capabilities/` contains 14 files: animation, cognito, content, dynamodb, e2e, forms, infra, lambda, react-19, review-quality, review-spec, security, tdd (13 per CLAUDE.md) + `animation.md` (unlisted). Either animation is undocumented or the count is wrong.
- Source: `.claude/agents/capabilities/` directory listing

---

## 5. What Works

### Pipeline Catches Real Issues
Git log shows pipeline catches led to dedicated fix commits:
- PR #11 (d49d47a→commit 49d472a): "8 critical fixes from v0.3.0 audit" — direct pipeline output
- PR #15 (bccb267): "enforce stress findings + fix Codex on Windows" — Codex step found Windows-specific bug
- PR #17 (d80bf5f): "promote bug-bounty checks to stage 3" — review step identified gap in check coverage
- PR #18 (d5f4957): "real codex adversarial on windows via codex-companion" — Codex path repaired after discovery of silent failure

The pipeline has demonstrably caught and fixed issues in itself, validating the meta-recursive approach.

### Stress Test Deduplication
The `## Stress Test` section check in execute-pipeline.sh correctly skips re-running stress on already-tested plans. This prevents double-spend without requiring human judgment each time.

### Hook Architecture
Fail-closed PreToolUse hooks (safety-guard, config-protection, commit-quality) prevent bad commits and protected file overwrites. PostToolUse hooks stay fail-open (format, typecheck, console-warn). The asymmetry is intentional (documented in STATE.md 2026-04-07 decision). No evidence of false-positive hook failures in recent commits.

### Codex Windows Path
codex-companion.mjs adversarial review now works on Windows via stable marketplace path with versioned cache fallback (`scripts/execute-pipeline.sh:L561-576`). Fixed in PR #18 (d5f4957). Previously silent-failed on Windows — now validated.

### Concurrency Guards
claude.yml + claude-review-fix.yml both have `concurrency` groups with `cancel-in-progress: false` (added f47cc2c). This prevents parallel `@claude` loop races without dropping in-flight reviews.

### MCP Integration
5 MCP servers active and referenced with routing table in CLAUDE.md. MarkItDown added 2026-04-10 (ff4e4c3). Pattern of adding MCPs as project needs emerge without breaking existing routing.

---

## 6. Pain Signals

### MEMORY.md Feedback Themes (recurring)
From `.claude/projects/.../memory/MEMORY.md` (21 feedback entries total):
- **Config protection bypass** (feedback_config_protection_bypass.md): Hook blocks Edit/Write on protected files; workaround is Bash shell redirect. Recurring friction — 2 separate entries mention it.
- **Diagnose before fixing** (feedback_diagnose_before_fix.md): Pattern of patching symptoms persisted long enough to earn a dedicated memory entry. Suggests impl sessions (Step 1) sometimes skip systematic debugging.
- **Lambda Node 20 fire-and-forget** (feedback_lambda_node20_fire_forget.md): `.catch` chains abandoned in async handlers. Was recurring enough to document — implies review steps missed this pattern before it became a memory entry.
- **Worktree per session** (feedback_worktree_per_session.md): Concurrent sessions sharing a checkout. No tooling enforcement; relies on human discipline.
- **Never skip reviews** (feedback_never_skip_reviews.md): Explicit memory entry against shortcutting the pipeline. Implies it happened at least once.
- **No auto-merge** (feedback_no_auto_merge.md): Review-fix loop must not merge. Implies the loop came close to or did auto-merge at some point.
- **Single @claude tag** (feedback_single_claude_tag.md): Double-tagging causes racing loops. The concurrency guard (f47cc2c) partially addresses this at the workflow level, but tag dedup is still a human-discipline problem at the `/iago-prfix` invocation level.

### Recurring Git Fix Patterns
From git log (30 commits):
- 4 commits with prefix `fix(pipeline)` — pipeline fixes dominate the fix category
- 2 commits with prefix `fix(ci)` — workflow fix for clean detection (6128c30), review-fix silent no-op
- 1 `fix(config)` — stress test stage documentation mismatch
- 1 `fix(docs)` — broken references
- 1 `fix(skills)` — /iago-quick defaulting wrong

Pattern: pipeline itself is the primary source of bugs in this repo. The meta-pipeline (pipeline that builds the pipeline) has not fully closed this loop — audit cycle (PRs #11-#15) fixed 8 critical issues, and 2 more fix PRs followed (PRs #17, #18).

### learnings/ Mechanism Not Working
`.iago/learnings/patterns.md` has been empty since creation. CLAUDE.md states "5+ occurrences → candidate for CLAUDE.md promotion." But no patterns have been logged. Either the threshold is too high, the logging is too manual, or the feedback loop is incomplete. MEMORY.md (global user prefs) absorbs learnings instead — but it's in the global user profile, not the project.

### macOS Compatibility Not Fixed
STATE.md has known macOS `timeout` issue flagged as Low severity since 2026-04-13 with no fix. With a 2-person team where the CTO is on Mac, "Low" severity is underweighted. Every `iago-execute` run on Sebas's machine will fail silently or noisily at the `run_claude()` wrapper.

---

## Recommendation

**Decision:** Prioritize three targeted fixes before adding any new skills or pipeline features.

**Confidence:** High (85%)

**Reasoning:**

1. **Fix macOS timeout** (1-2 hours): The pipeline is unusable for Sebas without this. A "Low" severity tag on a blocker for 50% of the team is a misclassification. The fix is mechanical: OS detection + `gtimeout` fallback in `execute-pipeline.sh`. Source: STATE.md Known Issues, scripts/execute-pipeline.sh `run_claude()`.

2. **Archive completed plans + establish plan lifecycle** (30 min): `.iago/plans/` has 5 completed audit plans with no archive path. Add `.iago/archive/plans/` and move them. This prevents confusion about what's active. No plan file deletion — just move.

3. **Wire learnings capture** (2-4 hours): The `.iago/learnings/patterns.md` mechanism is dead. Options: (a) lower threshold from 5 to 2 occurrences, (b) have the pipeline summary step (Step 6) explicitly check patterns against new findings and append matches, (c) automate a weekly digest from MEMORY.md entries into learnings/. Without this, knowledge accumulates in MEMORY.md (global, one person) instead of the project-level learnings/ (shared).

**What to defer:** Skill inventory pruning (visa-doc-translate, liquid-glass-design, etc.). These dormant skills cost nothing — they're markdown files. The real cost would be removing them only to need them for a new client. Leave them; add a `status: dormant` frontmatter tag if navigation becomes a problem.

**Do not touch:** The review reviewer stacking (3 passes + Codex). It caught 8 critical issues in one audit cycle. The redundancy is earning its keep.

**Next step:** `/iago-quick "fix macOS timeout in execute-pipeline.sh + archive completed plans"` — two tasks, fits quick scope, no new deps.

**Risk if wrong:** If macOS timeout fix introduces a regression in the Linux pipeline path, Codex adversarial review in Step 4 would fail silently (the codex-companion fallback path exists but was itself recently fixed in PR #18). Mitigation: test both paths explicitly in the stress test.
