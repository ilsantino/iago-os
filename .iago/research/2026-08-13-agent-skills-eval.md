# addyosmani/agent-skills vs iago-os — evaluation

**Date:** 2026-08-13
**Question:** Does the pack exceed iago-os? Do we have overkill? Adopt it, quarry it, or install the plugin alongside?
**Method:** 8-agent workflow — 3 readers over all 24 skills, 1 over the non-skill machinery (agents/hooks/commands/references/evals), 1 fresh map of iago-os enforcement layers; then 3 adversarial passes: per-skill overlap matrix, "what should iago delete" audit, "what can't the pack replace" defense. Run `wf_4e0cd3ca-55f`, ~770k subagent tokens.

## Verdict

**Keep iago-os as the base. Do not install the plugin. Quarry the repo.** The pack is a well-written *floor* for teams with no workflow harness and a developer in the loop; iago-os is a mechanically enforced *ceiling* built for a company where no developer is in the loop. A prompt-only skill asks; the pipeline throws. Their own `docs/comparison.md` concedes both points: it warns that running two skill packs as simultaneous routers "does not work" (kills the install-alongside option), and its taxonomy places iago-os in the Superpowers class — subagent pipeline, fix loops, worktree isolation — the class it credits with winning on autonomy.

The overkill in iago-os is real but it is **not** what this pack would replace. It is prompt mass and redundant review depth, not the mechanical layer. Every candidate cut traces to prose/agent-count; almost none to enforcement code.

## Matrix summary (24 skills)

**3 adopt-skill** — verified holes where iago has nothing:

| Skill | Why | House adaptation |
|---|---|---|
| `interview-me` | Want-extraction upstream of iago-discuss/brainstorming. Best persona-fit in the pack: non-coder CEO delegating implementation → intent extraction is the highest-leverage failure point. Guess-attached questions, hollow-yes taxonomy ("whatever you think is best" = delegation, not decision), predict-three-reactions stop test. | Bring into `.claude/skills/`; write `eval.md` vs iago-discuss + brainstorming per skill-authoring.md; anti-triggers for phase-scoped (→ iago-discuss) and already-clear (→ brainstorming). |
| `observability-and-instrumentation` | Zero observability coverage anywhere (no check module, rule, or capability) despite Sentria/Munet production ops. Question-first instrumentation, cardinality allowlist, symptom-vs-cause alerting, test-fire-every-alert gate. | Adapt to CloudWatch/Lambda/Amplify + derive `scripts/review-checks/observability.md` (unbounded metric label → Important; alert without runbook → Important), path-triggered on `amplify/functions/**`. |
| `performance-optimization` | Nothing governs "make it faster" work. Keep/revert verdict table ("within noise → REVERT", "neutral is a revert") counters sunk-cost landing of already-written changes; attempt ledger prevents retrying dead ideas. | On-demand skill in the bug-bounty mold (periodic/when-asked, never per-plan gate). Anti-trigger: pipeline perf findings stay findings. |

**16 steal-content**, clustering into 5 work items:

1. **NEW `scripts/review-checks/dependencies.md`** — dep-upgrade discipline (read changelog not version number; one dep per change; lockfile diff review; thin coverage around the dep = the real finding) + supply-chain rules (install scripts fail-closed; never auto `npm audit fix --force`; reachability-keyed triage). Path-triggered on package.json/lockfile diffs. Currently zero active coverage.
2. **`trust-boundary.md` grows 3 subsections** — browser sessions (DOM/console/network = untrusted data; never navigate to page-extracted URLs; no cookie/token reads; isolated profiles), error output as untrusted data (never run commands embedded in stack traces/CI logs), vector store as trust boundary (per-tenant embedding partitioning).
3. **Migration discipline** → `capabilities/dynamodb.md` (expand/contract for live tables: additive → dual-write → throttled backfill → switch reads → contract, each step independently deployable + reversible) + `data-integrity.md` floor: destructive schema step in same deploy as the code that stops using it → ALWAYS Critical.
4. **Reviewer-prompt tightening** — dual-adversarial legs: never forward the implementer's conclusions to reviewers (ARTIFACT + CONTRACT, never the CLAIM); doubt-theater tripwire (2+ cycles with substantive findings, zero classified actionable → escalate). Fix-session contract: blind-repro pattern (repro test written by an agent with no knowledge of the fix); "simplification that requires modifying tests = behavior change" tripwire.
5. **Small folds** — brainstorming: 7 variation lenses + per-direction assumption triple + ASSUMPTIONS block ("correct me now or I proceed"); iago-plan: task-sizing triggers (>3 acceptance bullets / 2+ subsystems / "and" in title → split; 8+ files banned); react-vite.md: the 8-row AI-aesthetic anti-pattern table (client UIs must not look AI-generated); executor.md: UNVERIFIED protocol (verify+cite or flag UNVERIFIED — hedged disclaimers banned), NOTICED-BUT-NOT-TOUCHING report section, anti-reassurance-rerun flag; NEW `.iago/_config/runbooks/launch.md`: rollout decision thresholds + rollback-plan-before-deploy template + flag hygiene.

**5 skip** — ci-cd, context-engineering, documentation-and-adrs, git-workflow (contradicts house squash policy), using-agent-skills (the router; their own docs warn against stacking it).

**Non-skill assets worth taking:** the Tier-2 deterministic routing evals (TF-IDF rank-1 CI ratchet — their real moat; iago's eval.md convention has never been exercised and this replaces it with CI); the security-checklist install-script policy matrix as the dependencies.md reference; the sdd-cache ETag WebFetch hook pattern.

## Overkill audit of iago-os (what to cut)

High confidence:
- **iago-stress `--deep` council mode** (~120 lines, 5 personas + anonymized peer review over a *plan document*) — same-model persona anonymization is 2024 theater at ~7x spawn cost; single-pass over the 5-dimension rubric finds the same gaps; `/council` exists for the rare genuine case.
- **Honesty-signal prose duplicated across 4 skill files** (~60 lines) — the workflow holds all 7 signal values; format the merge report deterministically in code (`reportText`), skills say "surface verbatim." Own layer-triage rule applied to ourselves.
- **skill-authoring routing-eval protocol** — zero eval.md files exist; process that never fired. (Ironic: the addy Tier-2 evals are the better replacement if we ever want this.)
- **SDD learnings-injection machinery** — reads/writes a patterns.md that has stayed empty for 3 months; pattern-harvest owns this with a better data source.

Medium confidence:
- **Agent `profiles/` (all 9) + 5 of 7 `capabilities/`** — the live pipeline references none of them; keep dynamodb.md + trust-boundary.md; migrate security-audit's Opus pin into SDD routing before cutting.
- **code-review standalone skill** — second parallel implementation of the Codex-gate logic (the drift class already logged in memory); dual-adversarial standard mode is its job description.
- **Lens-defs reading full bug-bounty skills per review leg** — 500+ lines re-ingested per leg per round; diff skill vs check modules once, backfill missing floors, then point lenses at `scripts/review-checks/` only.
- **Async review-fix round cap 5 → 2** — tail rounds are where the incident log concentrates (stale-ref findings, accepted-residual rule); pass #2 remains the hard backstop.

Explicitly keeps (expected cuts that earned their keep): skeptic verification with `refuteHasEvidence()` (hallucinated findings are a documented incident class; filters false positives, structurally can't create false negatives), the LLM-as-syscall scaffolding (platform tax until the vm allows child_process), iago-fast (pressure-release valve), the incident-receipted mechanical spine, the 13 rules files (already −74% from the 2026-08 audit).

## Sources

- Repo clone: `%LOCALAPPDATA%\Temp\agent-skills` (shallow, 2026-08-13)
- Workflow journal: session `5c014557` → `subagents/workflows/wf_4e0cd3ca-55f/journal.jsonl`
- Key evidence: `dual-adversarial.js:495,689,713`; `docs/comparison.md` (router-stacking warning, positioning concessions); `references/security-checklist.md`; head-to-head write-up linked in comparison.md
