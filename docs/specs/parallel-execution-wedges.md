# Spec: Pipeline Speed Wedges (quality-preserving only)

**Date:** 2026-04-27 (rewritten from earlier draft)
**Status:** Council-vetted. Ready for `/iago-plan --feature`.
**Hard constraint:** never sacrifice review/build/codex quality for speed.

## Problem

`scripts/execute-pipeline.sh` takes 25-65 min per plan. Several stages have hidden parallelism (no real dependency, currently run serial). Several "quick wins" people propose (skip Codex on trivial, lower turn budgets, combine PR+tag) trade quality for speed and are rejected by the hard constraint.

## Architectural decisions (committed, not deferred)

| Question | Decision | Why |
|---|---|---|
| Do we adopt **Anthropic agent-teams** (experimental peer-mailbox)? | **Yes, scoped to two wedges where peer messaging strictly beats fork-and-join: A+ (seam-findings via real-time broadcast) and B-revived (file-ownership announcements before conflict).** Behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. In-process mode works on Windows; multi-terminal works on Windows. Earlier "wait for GA" gate was lazy — Anthropic may never officially GA. | Synthesis pass for A+ is reactive; mailbox is real-time. File-overlap detection for B is static; mailbox is dynamic. Both unlock quality preservation that fork-and-join can't match. |
| Do we adopt **claude-peers-mcp**? | **No, permanently** unless its three Windows blockers (issues #31, #23, PRs #32/#46) close. | Broker fails to start on Windows, SQLite locks drop messages, repo-scope discovery breaks for worktrees. Anthropic agent-teams is the official path with the same primitive. |
| What about **subagents**? | **Already integrated.** Every `claude -p` call in the pipeline is a subagent invocation in Anthropic's vocabulary. Profile files in `.claude/agents/` are subagent definitions in the official format. The pipeline doesn't use `@-mention` syntax — it spawns subprocesses by design (control + no context bleed). Nothing to "add." | iago-os "profiles" map 1:1 to Anthropic "subagents" at file level. The `base` + `capabilities` fields are iago-os composition sugar on top of the official spec. |
| **Wedge B** (multi-plan parallel via worktrees)? | **Revived under agent teams with mailbox file-ownership.** Original cut reason was silent merge conflicts; mailbox announcements solve that BEFORE the conflict. Quality preserved. | Teammate broadcasts "touching package.json" → other teammates queue/coordinate. Static path-overlap is gone; real-time coordination replaces it. |
| **Wedge C original** ("speculative review while impl runs")? | **Reframed as Wedge C-rev.** Original was vague. Sharpened version is included below. | "Reviewer prepares focus list" is hand-wavy. "Run all I/O-bound preflight concurrent with impl" is concrete and free. |
| Skip Codex on trivial plans / lower turn budgets / combine PR+tag? | **Cut all three.** Quality-for-speed trades. | Trivial-by-file-count is exactly the static heuristic the council rejected. Lower turns truncates model thinking. Combined PR+tag adds failure coupling for 60s. |

## Agent teams: where they actually win (and where they don't)

Walked back from the previous "no agent teams" stance. Two specific wedges where peer messaging is structurally better than fork-and-join + file merge:

| Wedge | Fork-and-join version | Agent teams version | Why teams wins |
|-------|----------------------|---------------------|----------------|
| A+ seam-findings | 3 lens reviewers + synthesis pass reads all 3 outputs after | 3 lens teammates + mailbox; reviewer A finds auth bypass mid-pass, broadcasts to B who investigates rate-limiting seam in real-time | Real-time > reactive for seam interactions. Closes Contrarian's critique structurally, not after-the-fact. |
| B multi-plan parallel | Pre-flight static path-overlap check, fallback to serial on conflict | N teammates broadcast file-touches to mailbox; coordination before conflict, not after | Static heuristic vs dynamic announcement. Quality preserved instead of risked. |

Where agent teams do NOT win (fork-and-join is correct):

| Wedge | Why fork-and-join is enough |
|-------|----------------------------|
| D (Review \|\| Codex concurrent) | Two read-only checks on the same diff; no benefit from mid-flight messaging. Just run concurrent. |
| E (tsc \|\| vite parallel build) | Two CLI tools; no agent involved. |
| C-rev (preflight during impl) | I/O-bound prep; no peer coordination needed. |

**Rule:** use agent teams only when teammates need to **change behavior based on what other teammates are finding**. That's A+ (seam coordination) and B-revived (file-ownership coordination). Everything else stays fork-and-join.

## Windows reality (corrected)

| Mode | Windows status | Use case |
|------|---------------|----------|
| Split-pane display | Broken (needs tmux or iTerm2) | Cosmetic only — auto-tiled view of teammates |
| In-process mode | **Works** | Default for our use; teammates run as background processes in one parent session |
| Multi-terminal | **Works** | Open multiple Windows Terminal tabs / PowerShell windows manually if you want visual separation |

Earlier "Windows broken" framing conflated display mode with feature availability. Corrected.

## The five wedges (all quality-preserving or quality-improving)

### Wedge A+ — Review fan-out via agent teams (quality + speed)

**What:** Replace step 3's single 900s session with an agent team: 3 lens teammates (compliance / domain / adversarial) running concurrently, communicating findings via mailbox in real-time. When teammate A finds an auth bypass, it broadcasts; teammate B (adversarial lens) sees the broadcast and investigates the rate-limiting seam directly. Lead session collects final findings via shared task list, feeds existing fix loop unchanged.

**Why agent teams over fork-and-join + synthesis:** synthesis pass is reactive (after teammates finish). Mailbox is real-time. The Contrarian's "findings live in the seams" critique is solved structurally — teammates change their investigation based on what others find. Strictly better quality than synthesis-after-the-fact.

**Fallback:** if agent teams fails to spawn (env var off, version too old, in-process error), pipeline falls back to fork-and-join + synthesis pass version. Both are encoded — teams is the default when available.

**Quality argument:** today's single-reviewer splits ~33% attention per lens. Teammates give each lens 100% attention plus real-time cross-pollination on seam-findings. Net: strictly better than today.

**Speed argument:** wall-clock ≈ max(3 lens passes) + small messaging overhead. vs today's ~5-15 min single session.

**Cost:** ~3-4x review tokens (3 teammates plus possible synthesis if mailbox is light).

**Behind:** `IAGO_REVIEW_PARALLEL=teams` (default `off`, fallback `forkjoin`).

**Effort:** ~1.5 days (mostly mailbox protocol design + fallback path).

### Wedge D — Review || Codex adversarial concurrent (pure speed, zero quality risk)

**What:** Today step 3 (Review) runs, then step 4 (Codex adversarial) runs. Both read the same diff and produce findings. Zero dependency between them. Run concurrently, then merge findings into one combined fix session (step 4b).

**Quality argument:** unchanged. Both stages still run, both still produce findings, fix loop still handles all severities Critical→Important→Minor. The only change is wall-clock alignment.

**Speed argument:** saves max(min_of_two_durations) — typically 3-8 min/plan.

**Cost:** zero token change (same calls, just concurrent).

**Effort:** ~1 day. Includes adapting the merger to combine review + codex findings into one severity-prioritized list.

### Wedge E — `tsc --noEmit` || `vite build` parallel (pure speed, low quality risk)

**What:** Build gate currently runs `npx tsc --noEmit` then `npx vite build` sequentially. Run both in parallel.

**Caveat:** `vite build` runs TypeScript internally. Two type-check passes in parallel may hit memory pressure on Windows. **Verify before shipping** — measure peak memory + total time on a representative plan. If contention is real, drop to sequential.

**Quality argument:** both gates still run. Failure of either still aborts. Output capture preserved.

**Speed argument:** typical save 30s-2min per build attempt. Multiplied across build retries.

**Effort:** ~30 min implementation + 30 min verification.

### Wedge B-revived — Multi-plan parallel via agent teams + mailbox file-ownership (quality + speed)

**What:** When a phase has ≥2 plans, spawn one teammate per plan (each in its own `iago-wt` worktree). Teammates broadcast file-touches to mailbox: "I'm modifying `package.json`" / "I'm modifying `src/lib/auth.ts`." Other teammates check mailbox before writing — queue the write, coordinate, or escalate to lead.

**Why this revives B:** original cut reason was silent merge conflicts on shared files (config, types, package.json). Static path-overlap heuristic couldn't catch dynamic drift. Mailbox coordination is dynamic by construction — conflict resolution happens at write-time, not PR-time, so no work is silently lost.

**Quality argument:** parallel pipelines run in worktrees (already supported via `iago-wt`). File-ownership announcements prevent the silent-data-loss failure mode. Each teammate runs the full pipeline in its worktree (impl → build → review → PR). Quality identical to serial multi-plan today.

**Speed argument:** for phases with N truly disjoint plans, near-N speedup. For phases with shared-file overlap, mailbox coordination adds small overhead but prevents PR-time conflicts.

**Cost:** N teammates = N independent contexts. Token-cost roughly linear in plan count.

**Effort:** ~2.5 days (orchestrator + mailbox protocol + queue-write pattern + fallback to serial if teams unavailable).

**Behind:** `/iago-execute --parallel` flag. Auto-detect when phase has ≥2 plans; user opts in explicitly first.

### Wedge C-rev — Concurrent preflight during impl (free wall-clock)

**What:** While step 1 (Implement) is running, run everything that doesn't depend on the impl output:
- Build review check files (`compose_review_checks` already produces `$REVIEW_CHECKS_FILE`)
- Pre-read source files into review prompt context (cache to `$PIPELINE_TMP`)
- Pre-warm Codex's plan reading
- (Optionally) run review against pre-change code to baseline what's already broken

**Quality argument:** zero change. These are I/O-bound prep operations. Whether they happen before, during, or after impl doesn't affect the result.

**Speed argument:** removes prep latency from the critical path. Typical save 30s-2min/plan.

**Effort:** ~0.5 day.

## Where subagents / agent teams / claude-peers-mcp fit (corrected)

- **Subagents:** already in use — every `claude -p` is one. Profile files in `.claude/agents/` are subagent definitions. No work needed.
- **Agent teams:** **adopted for Wedges A+ and B-revived** under `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. In-process mode works on Windows; no GA gate. Used only when peer messaging is structurally better than fork-and-join (real-time seam coordination, real-time file-ownership coordination). Not used for D, E, C-rev (fork-and-join is correct there).
- **claude-peers-mcp:** nowhere, permanently, unless their Windows blockers close. Anthropic agent-teams is the official path with the same primitive.

## Implementation order

| # | Wedge | Transport | Effort | Quality impact | Speed save |
|---|-------|-----------|--------|----------------|------------|
| 1 | E (build gate parallel) | Shell | 30 min + verify | Neutral | 30s-2min/build |
| 2 | D (Review \|\| Codex) | Shell | 1 day | Neutral | 3-8 min/plan |
| 3 | C-rev (preflight during impl) | Shell | 0.5 day | Neutral | 30s-2min/plan |
| 4 | A+ (review fan-out, agent teams) | Agent teams + fork-join fallback | 1.5 days | **Positive** (real-time seam coord) | 3-5 min/plan |
| 5 | B-revived (multi-plan parallel) | Agent teams + mailbox | 2.5 days | Neutral (quality preserved by mailbox) | Near-Nx on multi-plan phases |

**Total effort:** ~5.5 days focused work. **Combined wall-clock save:** estimated 40-70% on multi-plan phases, 30-50% on single plans, no quality regression.

**Order rationale:** ship the shell-based wedges first (E, D, C-rev) — lowest risk, fastest wins, no experimental dependency. Then agent teams wedges (A+, B-revived) — higher reward but require the experimental flag and mailbox protocol design.

## Mandatory measurement protocol (council requirement)

Before flipping any default, gather telemetry on the next ≥5 plans:

1. **Stage timings.** Already partially in `.iago/summaries/`. Add wall-clock per stage to a structured `.iago/metrics/{plan}.json`. This tells us where time actually goes — maybe step 1 (Implement) dominates and Wedge A+ saves 3 min on a 30 min impl. Worth knowing.

2. **Timeout-hit rate on step 3.** Memory has tree-kill on timeout already biting. If step 3 hits 900s on >30% of plans, A+ is urgent. If <10%, it's a quality refactor at normal priority.

3. **Wedge A+ shadow validation.** Run parallel-with-synthesis alongside serial review for 5 plans. Diff the findings sets. If parallel misses any Critical/Important the serial caught, the synthesis pass needs work. Don't promote until shadow shows parity or better.

4. **Wedge E memory contention.** Run `tsc || vite` parallel on a representative plan with peak-memory logging. If memory spike causes OOM or measurable slowdown, fall back to sequential.

## Failure modes addressed

| Failure | Wedge | Mitigation |
|---|-------|-----------|
| One review lens times out (900s) | A+ | Synthesis pass receives 2 of 3 findings files, logs the missing lens, continues. Re-review loop catches gaps if synthesis quality drops. Add quorum: require ≥2 of 3 lens outputs to proceed. |
| Synthesis pass produces malformed merged findings | A+ | Schema-validate synthesis output before passing to fix loop. On validation fail, fall back to concatenated raw findings. |
| Review and Codex produce contradictory findings | D | Merger keeps both. Fix loop runs Critical→Important→Minor across the union. Existing logic. |
| `tsc` and `vite` race on memory | E | Verification step before shipping. Fall back to sequential if measurable contention. |
| Preflight reads stale source files (impl changes them mid-flight) | C-rev | Preflight outputs are advisory, not authoritative. Review subprocess re-reads files post-impl as today. Preflight is cache-warming, not result. |

## What to do Monday

1. Run measurement protocol on the last 10 entries in `.iago/summaries/`. ~30 min.
2. Ship Wedge E first (shell, smallest, fastest). ~1 hour incl. verification.
3. Ship Wedge D second (shell, biggest single speed win). ~1 day.
4. Ship Wedge C-rev third (shell, small wins). ~0.5 day.
5. Prototype Wedge A+ on agent teams with fork-and-join fallback. Shadow-validate before promotion. ~1.5 days.
6. Prototype Wedge B-revived on agent teams with mailbox file-ownership. Run on next phase with ≥2 plans. ~2.5 days.

**Stop here.** Do not expand to more lenses, claude-peers-mcp, or arbitrary new wedges without re-running this spec.

## Handoff

Run `/iago-plan --feature docs/specs/parallel-execution-wedges.md` to break this into 4 implementation plans (one per wedge) + a measurement-protocol plan. Then `/iago-execute pipeline-speed-wedges` runs them through the existing pipeline.

Recursive note: the wedges in this spec, once shipped, will speed up the pipeline that's executing them. First runs measure baseline; later runs measure improvement.
