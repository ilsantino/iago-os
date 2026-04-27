# Research: M2C1 — adopt, cherry-pick, or ignore?

**Date:** 2026-04-21
**Repo:** https://github.com/grandamenium/m2c1 (11 stars, 2 forks, created 2026-02-26, single commit, MIT)
**Question:** Should iago-os adopt M2C1 whole, cherry-pick pieces, or ignore it? If cherry-pick, which phases solve real gaps, and how do we integrate them without regressing the production pipeline?

## What M2C1 Is

A 12-phase Claude Code skill that turns a brain dump into "fully built, tested, deployed software" autonomously. Pure markdown — one `SKILL.md`, one `orchestration-workflow.md`, and eight artifact templates. No executable code, no CI, no shell scripts.

Hard prereq: Playwright MCP. The framework leans on Playwright to sign the agent into external dashboards, generate API keys, capture session cookies, and drive e2e tests as a simulated user.

### The 12 Phases

| Phase | Actor | Output |
|-------|-------|--------|
| 0 Setup | Main | `.claude/orchestration-<slug>/` folder |
| 1 Brain dump → PRD | Main | `PRD.md` (<500 lines) |
| 2 First research wave | Parallel subagents | `research/<domain>.md` per domain |
| 3 Discovery Q&A (+ self-audit) | Main | `DISCOVERY.md` (top authority doc, D1-Dn numbered decisions) |
| 4 Second research wave | Parallel subagents | `research/<domain>-implementation.md` — filtered through answers |
| 5 Tool setup | Main + Playwright | `.env`, MCP installs, session cookies, configured dashboards |
| 6 Tool verification | Main | `reports/tool-verification.md` (100% PASS gate) |
| 7 Skill creation | Parallel subagents | `.claude/skills/<name>/SKILL.md` per tool/domain/strategy |
| 8 Context compact | User | fresh context |
| 9 PHASES.md | Main | Master plan: tasks, contracts, per-phase regression task, final phase = e2e only |
| 10 Task sharding | Parallel subagents | `tasks/phase-N/task-N-M.md` — each a self-contained agent prompt |
| 11 Synergy review | Parallel subagents | `reports/synergy-review.md` — cross-phase contradictions |
| 12 Final artifacts | Main | `PROGRESS.md`, `START.md`, updated `CLAUDE.md` |

Execution post-setup: `/start` reads PROGRESS.md, spawns a subagent per task, each subagent branches/tests/commits. 3-tier failure escalation.

## Sub-question 1 — What does M2C1 do that iago-os does not?

1. **Two-wave research pattern.** Wave 1 (general domain) before discovery, wave 2 (implementation-focused) after, filtered through user answers. iago-os has `/deep-research` and a `--research` flag on plan but no formal two-wave split around a discovery gate.
2. **Discovery completeness self-audit.** Before leaving Phase 3, the agent re-reads DISCOVERY.md against a 12-category checklist and asks "could an execution agent implement without guessing?" If no, loops back. `/iago-discuss` has no formal completeness gate.
3. **Synergy review (Phase 11).** Cross-plan/cross-phase coherence check — contradictions between phases, data contract alignment, unreferenced shared types, gaps where later tasks assume work earlier tasks didn't produce. iago-os `/iago-stress` is per-plan; it does not check cross-plan coherence before execution.
4. **Per-project skill generation.** Every external API, MCP server, data source, testing strategy, and non-trivial framework gets its own project-local `.claude/skills/<name>/SKILL.md`. iago-os has stack-fixed skills at project root and does not auto-generate project-local ones.
5. **Autonomous Playwright-driven tool setup.** Agent signs up for services, generates API keys, captures storage_state cookies, configures webhooks in browser dashboards. iago-os does none of this.
6. **Final phase reserved entirely for multi-angle live e2e.** iago-os has `/iago-verify` per-phase but does not dedicate a whole phase to "deploy and re-test every path on the live artifact."
7. **Self-contained task-file prompts.** Each task file is the complete prompt a subagent reads — no shared-context assumption. iago-os plan tasks reference plan + CLAUDE.md; they're not standalone prompts.

## Sub-question 2 — What does iago-os do that M2C1 does not?

1. **Subprocess isolation.** Pipeline runs each stage as `claude -p` child process — zero context bleed between stress/implement/review/codex/fix/PR. M2C1 runs inside a single orchestrator session; Phase 8 has to manually ask the user to `/compact`.
2. **Cross-model adversarial (Codex / GPT-5.4).** Step 4 + 4b of the pipeline catches auth bypass, data loss, races, rollback safety from a non-Claude lens. M2C1 has no cross-model step.
3. **Async GitHub review-fix loop.** `@claude` tag on PR → `claude.yml` reviews → `claude-review-fix.yml` fixes → re-tag, max 5 rounds. M2C1 has no CI integration.
4. **Build-gate enforcement with retry.** `tsc --noEmit && vite build` as hard gate between impl and review, 2 retries with fix sessions. M2C1 lists "test locally" as a per-task step but has no enforced build gate.
5. **Opinionated fixed stack.** React 19 + Vite + TS strict + Tailwind 4 + ShadCN + Amplify Gen 2 + DynamoDB. M2C1 defers all stack choices to discovery every project, which is correct for a general framework but redundant for a consultancy with a fixed deliverable stack.
6. **Memory architecture.** Obsidian + Graphify + MemPalace + MarkItDown + auto-memory. M2C1 treats state purely as files in `.claude/orchestration-<slug>/`.
7. **Stress test with council mode.** `/iago-stress --deep` = 5-reviewer council on the plan. M2C1 has a synergy review but no council-style adversarial.
8. **Skill catalog with size-gated entry points.** `/iago-fast` (≤3 files), `/iago-quick` (1-3 tasks), `/iago-plan --feature` (medium), `/iago-init → /iago-plan → /iago-execute` (large). M2C1 is one-size-fits-all — every project gets the 12-phase treatment.

## Sub-question 3 — Where do they overlap, conflict, or complement?

**Overlap (same problem, different solution):**
- Planning — iago-os `/iago-plan` vs M2C1 PHASES.md
- Task decomposition — iago-os tasks in plan files vs M2C1 `tasks/phase-N/task-N-M.md`
- Research — iago-os `/deep-research` + `--research` vs M2C1 two-wave
- Adversarial check — iago-os `/iago-stress` vs M2C1 synergy review (different scopes — per-plan vs cross-phase)

**Conflict (adopting M2C1 would regress iago-os):**
- M2C1's single-session orchestrator vs iago-os's subprocess isolation — M2C1 regresses on context hygiene
- M2C1's stack-agnostic discovery vs iago-os's fixed stack — M2C1 regresses on speed for iago-os's use case
- M2C1's "no review pipeline, no codex, no async loop" vs iago-os's 8-stage pipeline — M2C1 regresses on quality gates

**Complement (M2C1 fills a real gap):**
- Discovery completeness self-audit → `/iago-discuss` currently ends on user judgment, no machine gate
- Cross-plan synergy review → iago-os stress-tests per-plan only; missed cross-plan contradictions are a real pipeline gap (especially in multi-plan phases)
- Two-wave research with a discovery gate between → could tighten `/iago-plan --feature --research --discuss` into a proper wave-1 → discuss → wave-2 sequence
- Per-project skill generation for non-standard client integrations (n8n workflow, Stripe, third-party APIs) → iago-os has stack skills but nothing for per-client vendor skills

## Sub-question 4 — Is the framework battle-tested?

No. Single commit, created 2026-02-26 (< 2 months old), 11 stars, 2 forks, primary language unclassified (pure markdown), no issues, no PRs, no releases, no license file present (README says MIT). Author `grandamenium` — no visible track record of production usage. The framework's own instructions reference artifact templates at `~/.claude/skills/m2c1/artifact-templates/` — install path is fragile on Windows (iago-os uses `C:/Users/sanal/.claude/skills/`).

Treat as **interesting design artifact**, not proven infrastructure. Its ideas are evaluable; its execution is not.

## Brainstormed options

**A. Adopt wholesale** — replace iago-os workflow with M2C1.
- **Upside:** One less framework to maintain; M2C1's two-wave research and synergy review are genuinely good ideas.
- **Downside:** Regresses subprocess isolation, codex adversarial, async review loop, build gate, memory stack, opinionated stack. Two months of production pipeline work thrown away. Unproven framework.
- **Verdict:** No.

**B. Install M2C1 as a parallel skill, use per-project.**
- **Upside:** Zero risk to existing iago-os pipeline. Useful when onboarding a new client with a brand-new greenfield project and ambiguous scope.
- **Downside:** Two mental models in the same codebase. Users have to decide up front "M2C1 project or iago project." M2C1 still has the subprocess bleed problem.
- **Verdict:** Possible but messy.

**C. Cherry-pick high-value phases, fold into iago-os skills.**
- Phase 3c completeness self-audit → add to `/iago-discuss` as a gate before completion
- Phase 11 synergy review → new `/iago-synergy` skill or `/iago-stress --cross-plan` flag, run once per phase after all plans written
- Phase 2+4 two-wave research → new mode for `/iago-plan --feature --research=2wave`
- Phase 7 per-project skill generation → new `/iago-skills-gen` for non-standard client vendor integrations (Stripe, n8n flows, Apify scrapers, etc.)
- Skip Phase 5 autonomous Playwright tool setup — credential handling is too risky, value is low for iago-os's fixed stack, and Playwright autonomous signup is brittle
- Skip Phase 9 PHASES.md structure — iago-os ROADMAP + per-plan structure works
- Skip Phase 12 final-e2e-only phase — redundant with `/iago-verify` + per-plan Playwright
- **Upside:** Captures the genuinely novel ideas without disrupting the pipeline; each piece can be landed independently behind a flag; can be killed individually if it doesn't pay off.
- **Downside:** Integration work (~3-5 small plans). Each addition must pass the pipeline itself.
- **Verdict:** Recommended. See council output for prioritization.

**D. Ignore entirely.**
- **Upside:** Zero effort.
- **Downside:** Three ideas (completeness audit, synergy review, two-wave research) solve real iago-os gaps — skipping them keeps those gaps open.
- **Verdict:** Lazy but defensible if council signals low ROI.

## Sources

- `gh repo view grandamenium/m2c1` — metadata (11 stars, 2 forks, single commit, MIT per README, no license file)
- `gh api repos/grandamenium/m2c1/contents/README.md` — 12-phase overview
- `gh api repos/grandamenium/m2c1/contents/SKILL.md` — installation and trigger conditions
- `gh api repos/grandamenium/m2c1/contents/orchestration-workflow.md` — full phase protocol, 25.5KB
- `C:/Users/sanal/dev/iago-os/CLAUDE.md` — stack, workflow, execution pipeline, memory architecture
- `C:/Users/sanal/dev/iago-os/.claude/rules/execution-pipeline.md` — 8-stage pipeline detail
- `C:/Users/sanal/dev/iago-os/.claude/rules/available-skills.md` — skill catalog
- `~/.claude/.../memory/MEMORY.md` — hard rules (NEVER skip reviews, worktree-per-session, stack PRs)

## Recommendation

**Decision:** Option C — cherry-pick 3 pieces into iago-os, ignore the rest.
**Confidence:** High on the diagnosis (these are the right 3 pieces). Medium on prioritization (council may reorder).
**Reasoning:** iago-os is production-proven and solves the problems M2C1 doesn't (subprocess isolation, codex, async review loop, build gate). M2C1 is unproven but contains three genuinely good design ideas (discovery completeness gate, cross-plan synergy review, two-wave research with discovery between) that address real iago-os gaps. Adopting wholesale regresses; ignoring loses the insights; cherry-picking captures value at bounded cost.
**Next step:** Run the council to stress-test this recommendation and lock prioritization, then plan the three additions as a new feature-m2c1-integration/ plan group. Start with the completeness audit (smallest, lowest risk, highest-frequency payoff).
**Risk if wrong:** Cherry-picks add complexity without payoff if the original ideas only shine in greenfield contexts. Mitigation: each cherry-pick ships behind a flag; kill any that don't earn their keep in the first 2 projects.
