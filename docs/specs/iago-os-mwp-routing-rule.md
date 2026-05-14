# Spec: MWP routing-rule architecture (council revision #2)

**Status:** Draft for `/iago-plan` (or fold into `feature-mwp-restructure` Wave A — see scope decision in `.iago/context/2026-05-04-mwp-vs-cleanup-scope.md`)
**Date:** 2026-05-04
**Parent audit:** `.iago/research/2026-04-28-mwp-restructure-audit.md` §3.4 + §8.3 + §8.4
**Resolves:** Council Revision #2 — "§3.4 routing logic must auto-load."

---

## Problem

The audit's §3.4 decision tree ("where new docs go") was proposed to live in `.iago/PROJECT.md`. The council REJECTED this placement: `.iago/PROJECT.md` does **not** auto-load into Claude's session context. Per [Anthropic memory docs](https://code.claude.com/docs/en/memory), only root `CLAUDE.md` (unconditional, every session) and nested `CLAUDE.md` in opened subdirs (on-demand) are auto-loaded. Path-scoped `.claude/rules/*.md` (with YAML `paths:` frontmatter) loads only when matching files are opened.

Any routing rule that doesn't auto-load *before* Claude decides where to put a new doc is theater — by the time the rule loads (on Write to a chosen path), the path has already been chosen.

> **Terminology note (added 2026-05-13 per `.iago/research/2026-05-13-mwp-source-synthesis.md`):** This document uses "routing" in the sense of **file-placement routing** ("where does this new artifact live in the repo?"). In the canonical ICM paper, "routing" refers to **context-loading routing** ("what files does the agent load for this stage?"). These are different problems. File-placement routing is solved by an auto-loaded decision tree (the rule below). Context-loading routing is solved by L2 stage contracts (Inputs/Process/Outputs tables). Both are MWP-aligned; they operate at different layers. Don't conflate.

## Verdict — Option A: Inline in root CLAUDE.md

**Embed the doc-routing decision tree directly in `iago-os/CLAUDE.md` as a top-level section** (`## Doc routing`), rendered as a compact lookup table (~18 lines). No reference indirection, no hook, no path-scoped supplement.

### Why not the alternatives

**Option B — Path-scoped `.claude/rules/doc-routing.md` (`paths: ["**/*.md"]`)**: Loads only when Claude opens or writes a markdown file. Decisions about *where* to put a new doc happen during reasoning that precedes any tool call. By the time the rule fires, the target path is already decided. Path-scoped rules are right for behavioral instruction conditional on file context (e.g., react-vite.md fires when editing .tsx); they're wrong for orchestrator-level routing decisions.

**Option C — `PreToolUse` hook on Write/Edit/MultiEdit**: Strongest enforcement (can block bad paths and return remediation). But: high implementation cost, cross-platform fragility (Windows vs Mac shell semantics, per `feedback_codex_windows`), false-positive risk on legitimate doc creates (`clients/sentria/CLAUDE.md` is correct but a naive pattern matcher might reject it), and the hook's value-add over an auto-loading root rule is small once the rule itself is precise. **Defer hook implementation until empirical evidence shows the rule alone is insufficient** — i.e., misrouted docs continue to land after Option A ships. Build the cheap fix first; escalate to enforcement only if it fails.

**Option D — Hybrid (root summary + path-scoped detail)**: Adds maintenance surface (two locations to keep in sync) for marginal gain. Reject.

### Council alignment

Council §8.3: *"Any routing rule that lives anywhere except root CLAUDE.md or a hook is theater."* Option A satisfies the disjunction directly with the lighter half. If Option A proves insufficient, the heavier half (hook) remains available without rework — the rule's content moves intact.

---

## Rule content (drop-in section for root CLAUDE.md)

Paste this as a new top-level section, between `## Architecture` and `## Workflow` (or wherever doc-creation reasoning is most likely to be primed):

```markdown
## Doc routing — where new docs go

Auto-loads with this file. Consult before any Write to a `.md` path.

| Doc type | Location |
|---|---|
| Feature plan (multi-task) | `.iago/plans/feature-{slug}/{NN}.md` |
| Phase plan (ROADMAP) | `.iago/plans/{phase-slug}-{NN}.md` |
| Quick-fix plan | `.iago/plans/quick-{YYMMDD}-{slug}.md` |
| Execution summary | `.iago/summaries/{plan-slug}.md` |
| Phase decision artifact | `.iago/context/{YYYY-MM-DD}-{slug}.md` |
| Research / brainstorm / audit | `.iago/research/{YYYY-MM-DD}-{slug}.md` |
| Ops runbook (repeatable how-to) | `.iago/runbooks/{slug}.md` |
| Recurring review pattern | `.iago/learnings/patterns.md` (append) |
| Client-specific (any of the above) | `clients/{name}/.iago/{same-taxonomy}/` |
| Public-facing iaGO-OS docs | `docs/` (ARCHITECTURE, MANUAL, SETUP, etc.) |
| Domain-skill reference (industry pattern) | `docs/patterns/{domain}.md` |
| Phase-cycle artifact (vision / canonical roadmap) | `docs/specs/` (paired with `.iago/research/`) |
| Stale / superseded plan | `.iago/plans/_archive/{YYYY-MM-{slug}}/` (with roadmap pointer) |
| Stale / superseded doc (decision-bearing) | `docs/archive/` |
| Stale / superseded doc (no future value) | DELETE |

**Heuristic.** Behavioral instruction for Claude → `.claude/rules/` or `CLAUDE.md`. Contextual reference Claude reads when asked → `.iago/` or `docs/`. Stable reference for external GitHub readers → `docs/`. If unsure, name the doc's primary reader (Claude in this repo / Claude in a client subtree / human via GitHub) — that names the location.
```

Line count: ~22 lines including header and heuristic paragraph. Acceptable for root if other root content is trimmed during the same MWP Phase 2 cycle (audit M13 targets root CLAUDE.md trim 209→≤80; the routing block is part of the post-trim allocation, not an addition on top of the bloated baseline).

---

## What this spec does NOT do

- **Does not deprecate `.iago/PROJECT.md`.** PROJECT.md still holds phase context, decisions log, overflow from STATE.md. It just doesn't carry routing instruction.
- **Does not remove the existing audit §3.4 prose** from `.iago/research/2026-04-28-mwp-restructure-audit.md`. The audit is frozen — re-pickup notes go to §9, not edits to §3.4.
- **Does not implement the hook (Option C).** Hook stays available as fallback if Option A measurably fails.

## Acceptance criteria

When the MWP Phase 2 PR (or a standalone Rev #2 PR if pulled forward — see §1.5 below) lands:

1. Root `CLAUDE.md` contains a `## Doc routing — where new docs go` section with the table above.
2. The section sits above `## Workflow` (so it primes doc-creation reasoning before workflow steps fire).
3. Root `CLAUDE.md` total line count is ≤ 100 lines (target ≤ 80, +20 budget if the trim sweep can't fully compensate).
4. `.iago/PROJECT.md` does NOT contain the decision tree (single source of truth at root).
5. `.claude/rules/` does NOT contain a `doc-routing.md` (Option B explicitly rejected).
6. No `PreToolUse` hook on Write/Edit checks doc paths (Option C deferred).

## Sequencing — pull forward, or ride MWP Phase 2

Two sequencing paths, picked downstream:

- **Pull forward as standalone PR.** Single-file edit to root CLAUDE.md, ~30 min, zero collision risk with cleanup or Munet work. First Principles advisor recommended this in council §8.1. Lets the routing rule start working immediately, before MWP M01-M12 even run.
- **Ride MWP Phase 2 (Wave B).** Rule lands as part of the broader root CLAUDE.md trim (audit M13). Cleaner from a "MWP Phase 2 owns root CLAUDE.md" standpoint, but delays the rule's effect by the cleanup-spec window + MWP Wave A.

**Recommendation:** Pull forward. The audit's #1 lever (root CLAUDE.md content correctness) and the council's #1 revision (auto-loading routing) both point at root. Shipping a 22-line addition now, then trimming around it during M13, is lower-risk than coupling them.

If pulled forward: matches `/iago-fast` shape (1 file, obvious, ≤ 30 min). If folded into MWP Phase 2: lands as one task within the M13 plan.

---

## Sources

- `.iago/research/2026-04-28-mwp-restructure-audit.md` §3.4 (decision tree), §3.5 (workspace map), §8.3 (council synthesis), §8.4 (recs changed table)
- [Anthropic memory docs](https://code.claude.com/docs/en/memory) — root CLAUDE.md auto-load semantics, path-scoped rule loading semantics
- `.claude/rules/react-vite.md`, `.claude/rules/aws-amplify.md` — existing path-scoped rule pattern (reference for what Option B *would* look like)
- `feedback_codex_windows` (cross-platform hook fragility), `feedback_no_extra_gates` (don't add infrastructure when a rule suffices)
