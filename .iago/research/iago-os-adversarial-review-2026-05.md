# iago-os — Adversarial Review

**Date:** 2026-05-12
**Author:** adversarial analyst (subagent dispatch)
**Scope:** Top 5 problems with iago-os in light of Anthropic's May 2026 Managed Agents + Outcomes + Multiagent + Agent View + Routines stack.
**Verdict:** **HYBRID — targeted fixes now, defer full Managed Agents migration until Outcomes GA.**

---

## 1. What Actually Works (evidence only)

**The pipeline script is real and battle-tested.** Six telemetry records in `.iago/state/pipeline-runs/` prove it runs end-to-end. The 2026-05-11 run on `01-routines-bind-viability` took 39.5 minutes wall-clock (stress: 2:23, implement: 9:47, review: 11:12, codex_fix: 5:45, create_pr: 6:28, tag: 1:40). That is an actual measured pipeline run, not an assertion.

Evidence: `.iago/state/pipeline-runs/20260511-191131-01-routines-bind-viability-19929.ndjson`

**The self-freeze hack works.** The problem it solves is real — `20260428-045912-06-wedge-e-tsc-vite-parallel-build-4903.ndjson` shows implement exit 1 after 16:45 (likely the byte-offset crash it was written to prevent). The fix at `scripts/execute-pipeline.sh` lines 69-75 is correct and correctly guarded with `IAGO_PIPELINE_FROZEN` sentinel.

**Telemetry infrastructure is solid for its scope.** `scripts/lib/pipeline-telemetry.sh` emits NDJSON per stage with `duration_ms`, `timed_out`, and stage-specific extras. The stage-scoped latch for timeout signals (lines 48-55) is a non-obvious correctness fix. It works.

**The Codex cwd defense-in-depth is thorough.** The "no changed files" sanity check at `execute-pipeline.sh` lines 723-731, the explicit `--cwd` flag, the timeout kill sequence, and the structured-findings fallback branch are each independently justified and the implementation is correct.

**Skill routing clarity is better than it looks from the outside.** The three-tier table (`/iago-fast` ≤3 files, `/iago-quick` 1-3 tasks, `/iago-execute` phase plans) is consistently documented in CLAUDE.md, `available-skills.md`, and the individual SKILL.md files. There is no documentation contradiction between them.

---

## 2. What's Broken or Pretending to Work

**The learnings system is DEAD. This is the most damning single fact in the repo.**

`.iago/learnings/patterns.md` contains only the table header — zero rows. Twelve pipeline runs have executed. Multiple audit cycles completed. CLAUDE.md says "5+ occurrences → candidate for CLAUDE.md promotion." Nothing has ever been promoted. The system exists to accumulate institutional knowledge and has accumulated none. Either the pipeline never surfaces patterns to the learnings file (no stage writes to it), or no one writes to it manually. Either way, it is dead infrastructure.

File: `.iago/learnings/patterns.md` — 2 lines total.

**The review pipeline's value is asserted, not measured.** Telemetry records duration per stage but captures zero outcome signal: no count of findings per severity, no whether the review forced a fix round, no whether codex_fix actually changed anything, no block rate. The summary at `.iago/summaries/01-routines-bind-viability.md` says `Review: PASS` and `Codex: exit 0` — it does not say whether codex_fix made changes (it ran for 5:45 and presumably changed files, but the summary has no diff stats for post-codex). You cannot answer: "What percentage of pipelines trigger a codex_fix round?" You have 6 runs. Codex_fix was skipped in 3 (20260428, 20260504, 20260505) and ran in 1 (20260511, 5:45). That is 25% fire rate on a 4-run sample — not enough to make a decision, and the tooling to aggregate it does not exist.

**The `--n8n` flag in `/iago-execute` is dead.** The SKILL.md documents an `--n8n` dispatch path (Step 6: n8n dispatch) that reads `.iago/config.json` for a webhook URL. Per MEMORY.md: "n8n is in the stack list but NOT yet running professionally." There is no `.iago/config.json` in the iago-os root. The flag is documented but non-functional.

**`/iago-execute` Step 3 has a correctness bug on multi-plan runs.** The SKILL.md says "Before starting any plan: `git checkout main && git pull origin main`" — but then Step 4 says "Between plans: Do NOT run `git checkout main && git pull`. The next plan builds on the previous plan's commits." These are correctly sequenced, but Step 3 will fail if the working tree is already on a feature branch with uncommitted changes (which is normal state after one plan runs and creates commits). The `git checkout main` in Step 3 is the initial sync, but if Santiago runs `/iago-execute` mid-session on a dirty branch, it will either fail or silently discard work. No guard exists in the skill against this.

**The "Santiago is not a coder" tension is real and unresolved.** MEMORY.md explicitly states: "NOT a coding developer; Claude does all implementation." But the entire workflow is plan-driven: `/iago-plan` produces `.md` files that Santiago reviews, `/iago-stress` produces adversarial findings Santiago evaluates, ROADMAP phases require Santiago to approve plan lists before execution (`Found N plans... Execute all? (y/n)`). Each of these assumes the user can read technical plans accurately and decide whether BLOCK verdicts are valid. The council roadmap (`docs/specs/iago-os-roadmap.md`) is 200+ lines of architectural analysis. The system was designed by someone who thinks in code and is operated by someone who does not — and there is no translation layer.

**The `agent` definitions in `.claude/agents/` are effectively no-ops as described.** The executor, analyst, and operator base files define frontmatter with `tools`, `model`, `maxTurns` — but the pipeline never dispatches these via an agent API. `execute-pipeline.sh` calls `claude -p` directly with inline `--allowedTools` and `--model` flags. The `.claude/agents/` directory exists as documentation of intent, not as runtime configuration. Profiles (12 described in CLAUDE.md) do not have corresponding files — `Glob .claude/agents/*.md` returns only 3 base files, not 12. The CLAUDE.md capability claim "12 profiles" is false by file count.

**Memory layer overlap is genuine, not just theoretical.** Five layers are documented: MEMORY.md, Obsidian, Graphify, MemPalace, MarkItDown. MEMORY.md and MemPalace diary both capture "session reasoning trails." Obsidian session digests and MemPalace diary both capture "what was done this session." CLAUDE.md has a routing table that attempts to differentiate them, but the practical failure mode is: when Santiago asks "why did we decide X?", the answer might be in any of three places, with no canonical tiebreaker. The frozen-snapshot rule (do not re-read MEMORY.md mid-session) adds a correctness constraint that makes the overlap harder to navigate, not easier.

**The `codex_review` stage has a systematic false-clean risk.** When the Claude adversarial fallback runs (which happens whenever Codex is unavailable or crashes), the findings-detection logic at line 778-783 explicitly skips `\bCritical\b|\bImportant\b` matching "to avoid false positives from prose like `No Critical issues found`." This means a Claude fallback review that finds real Critical issues expressed in prose (not Codex-structured `[P0]` markers) will not trigger a codex_fix session. The fallback reviewer uses a different output format than Codex, and the parser is tuned for Codex's format. Evidence: lines 776-783 in `execute-pipeline.sh`.

---

## 3. What Anthropic Now Obsoletes

**Routines vs. self-freeze byte-offset hack.** Routines runs on Anthropic infrastructure with a fresh git clone per trigger — no local bash process, no mid-run file edits possible, no byte-offset shift. The self-freeze hack (`execute-pipeline.sh` lines 69-75) is a 40-line workaround for a Windows bash limitation that disappears entirely if the pipeline moves to Routines. **However:** Routines cannot access local files or git worktrees, so the migration requires the pipeline to work from a fresh clone per run — which means no stacked commits between plans. This is a real architectural constraint, not a free win.

Migration worth it? **Hybrid:** keep `claude -p` for multi-plan stacked execution where worktree continuity matters; migrate recurring single-plan runs (nightly triage, PR triage `/loop`) to Routines immediately. The self-freeze stays until stacked execution moves to Routines.

**Managed Agents Multiagent vs. hub-and-spoke in `.claude/agents/`.** iago-os already enforces "hub-and-spoke: only the orchestrator dispatches — agents never spawn agents" (CLAUDE.md). This exactly matches Managed Agents' coordinator/specialist topology with depth capped at 1. But the existing `.claude/agents/` files are markdown documentation, not runtime agent definitions. Migrating to Managed Agents `agent_definition` blocks would replace the markdown with actual hosted loop management, SSE event streams, and shared container filesystem — giving real observability (session threads per plan, per-specialist turn counts) instead of the current "look at the terminal" monitoring. **The migration is worth it for new work but not worth retrofitting the existing pipeline.** The `claude -p` subprocess model works; Managed Agents adds SSE/webhooks and hosted execution, which matters for Routines-hosted runs but adds complexity for local runs Santiago controls directly.

**Outcomes rubric loop vs. steps 3-4b (review + codex adversarial + codex fix).** Outcomes is a server-side grader loop with a rubric — closer to what steps 3-4b approximate manually. The critical difference: Outcomes loops until `satisfied` or `max_iterations`, with a separate grader agent evaluating against the rubric. The current pipeline has max 2 fix rounds, a regex-based verdict parser, and a Claude fallback for codex. Outcomes would replace all of this with a cleaner primitive — but it is research preview, requires access request, and the API shape will change. **Do not migrate now. Evaluate at GA.**

**Dreaming vs. MemPalace diary auto-writes.** Dreaming does scheduled memory curation between sessions — extracts patterns, curates memories, runs without a session. MemPalace diary does the same but requires a stop hook to write and a human to mine. Dreaming is strictly better in design but is research preview and Managed Agents-only. **Do not migrate now.** MemPalace stays.

**Agent View (`claude agents`) vs. "look at the terminal."** This one is a free immediate win. `CLAUDE_CODE_SESSION_ID` is now injected into Bash subprocesses (v2.1.132). The pipeline already emits NDJSON telemetry per stage. Instrumenting `execute-pipeline.sh` to emit structured events keyed on `$CLAUDE_CODE_SESSION_ID` would make all running pipeline stages visible in Agent View with zero new infrastructure. This is a 1-day spike with real monitoring payoff.

**`/iago-execute --n8n` vs. Routines API trigger.** The n8n dispatch path is dead. Routines has a per-routine `/fire` endpoint with a bearer token — this is exactly what the `--n8n` flag was trying to be, without requiring n8n to be running. Delete the n8n path; replace with a Routines API trigger when needed.

---

## 4. What Only iago-os Has (Genuine Moat)

This is a short list.

**The Codex cross-model adversarial review is unique.** No Anthropic primitive does what `codex-companion.mjs` does at step 4: send the diff to GPT-5.5 for adversarial review with a different model's failure modes. Managed Agents multiagent is Claude-to-Claude; it cannot substitute. This remains iago-os-exclusive and genuinely valuable — it caught the `CODEX_EXIT not reset` P1 in the `audit-06` run (per summary).

**The `git add -A` with explicit `.env`/secret exclusion patterns at every staging point** is a discipline artifact baked into the pipeline at 4 separate locations. This is not a feature, but it represents accumulated operational caution that would be re-learned painfully without it.

**The `/iago-fast` guard conditions are tighter than most practitioners enforce.** The skill explicitly blocks use on auth/payment/data-access code regardless of file count. This is a judgment call baked into the routing that prevents the "it's just a small change" rationalization on high-risk code.

Everything else — the 8-stage pipeline structure, the review checklist modules, the hub-and-spoke constraint, the stress test step — has a Managed Agents equivalent that is either already GA or arriving at GA within a quarter.

---

## 5. The Hard Question

If starting fresh today (May 2026), with Managed Agents + Outcomes + Multiagent + Routines available, would you build iago-os the same way?

**No.**

You would build:

**A thin coordinator agent definition** (Managed Agents `agent_definition`) that receives a plan file path and dispatches specialists: one implement specialist, one review specialist, one codex-adversarial specialist (Claude calling the Codex MCP server). The coordinator uses an Outcomes rubric for the review loop instead of a regex-based verdict parser. All specialists run in isolated session threads with shared container FS — no file-passing via `$PIPELINE_TMP`. The entire self-freeze hack does not exist because Anthropic hosts the loop.

**Routines triggers** for recurring tasks: nightly PR triage, weekly review-fix loop health check. No local bash required for scheduling.

**A Telegram webhook** (not n8n, just a Cloudflare Worker or AWS Lambda) that subscribes to Outcomes SSE `span.outcome_evaluation_end` events and sends a message when a plan completes or fails. Santiago gets async mobile notifications without watching a terminal.

**Agent View** for monitoring — no custom dashboard.

**What you would keep from iago-os:**
- The cross-model Codex adversarial step (no Anthropic equivalent)
- The secret-exclusion staging patterns
- The skill routing table (fast/quick/execute/plan) — these are real workflow decisions, not infrastructure
- The review checklist modules — these encode domain knowledge, not plumbing

**What you would not build:**
- The 500-line bash pipeline script with self-freeze, liveness gates, and Windows-specific `taskkill //T` calls
- The `.claude/agents/` markdown-based agent definitions (use Managed Agents JSON/TOML)
- The `--n8n` dispatch path
- The 5-layer memory routing system (2-3 layers cover the real use cases)
- 35 skill files for a 3-person team (maybe 15 cover 90% of actual usage)

---

## 6. Migration Cost vs. Do-Nothing Cost

**Migration estimate (incremental hybrid path, not big-bang):**

| Step | Effort | Payoff |
|---|---|---|
| Instrument pipeline with `CLAUDE_CODE_SESSION_ID` → Agent View | 1 day | Monitoring without terminal babysitting |
| Delete dead `--n8n` flag + `.iago/config.json` reference | 0.5 day | Removes false documentation |
| Fix learnings write path (add a stage to pipeline that extracts patterns) | 1 day | Actually uses the infrastructure that exists |
| Migrate one Routine (nightly PR triage) | 1 day | Validates Routines for iago-os, frees Santiago's machine |
| Fix false-clean risk in Claude adversarial fallback parser | 0.5 day | Correctness fix, not optional |
| Fix `/iago-execute` Step 3 dirty-branch guard | 0.5 day | Prevents silent work loss |

Total: 4.5 days of focused work, all incremental, all reversible.

**Do-nothing cost:**
- The self-freeze hack will break again. It already broke once (the 2026-04-28 implement exit 1 at 16:45). Each recurrence costs 2-4 hours to diagnose.
- The empty learnings system means every pipeline run generates zero institutional memory. At current run rate (roughly 1-2 runs/week), that is compounding debt: patterns that should be in CLAUDE.md are being re-discovered in every review session.
- The false-clean risk in the codex fallback parser is a latent correctness bug. It does not fail loudly — it silently passes plans that should trigger a fix session.
- The 35-skill catalog with dead paths (n8n, `/autonomous-loops`, `/continuous-agent-loop` — none of which have telemetry evidence of ever being invoked) is maintenance surface that grows stale.

**Verdict: hybrid.** Migrate the specific dead/broken pieces (learnings, n8n path, dirty-branch guard, fallback parser). Add Agent View instrumentation. Move one Routine. Do not rewrite the pipeline. The bash script works; Managed Agents multiagent is research preview and not worth destabilizing a running system for. Revisit full Managed Agents migration when Outcomes GAs (estimated Q3-Q4 2026).

---

## Summary

- Files analyzed: 28
- Findings: 4 critical/important, 4 important, 2 minor
- **Verdict: HYBRID** — fix the 4.5d list above, defer full migration
