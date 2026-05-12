---
title: Async review-fix routine — operator runbook
plan: feature-wedge-c-routines/01-routines-bind-viability
created: 2026-05-11
status: NO-ROUTINE-BOUND — workflow-only path is canonical until further audit
verdict_source: .iago/research/2026-05-11-routines-bind-viability.md
---

# Async Review-Fix — Operator Runbook

> **⛔ NOT AN APPROVAL TO BIND.** Verdict is `BIND-NOT-VIABLE` as of
> 2026-05-11 (see `.iago/research/2026-05-11-routines-bind-viability.md`).
> The recursion guards, collision guards, drift guards, smoke-test
> procedure, and branch matrix below are **forward-looking
> specifications** preserved so that any future audit does not have to
> re-derive them — they are **not authorization** to bind a routine
> now. Before any bind action: (1) re-run the viability audit against
> current Anthropic `/routines` docs, (2) update the canonical roadmap
> line removing or amending the audit-candidate gate, (3) explicitly
> allocate budget for the bind + smoke + monitoring. Skipping any of
> the three steps is a violation of the canonical roadmap and of this
> runbook's intent.

Operator-facing runbook for the iaGO async review-fix loop. As of
2026-05-11, **no `/routines` bind exists**; the canonical path is the
two-workflow setup in `.github/workflows/claude.yml` +
`.github/workflows/claude-review-fix.yml`. This runbook records both:

- **§ Current state** — how to observe and operate the workflow-only path.
- **§ Fallback** — what to do if a future `/routines` bind is attempted and
  needs to be rolled back to the workflow-only path. The fallback section
  is the always-write deliverable from task 3 of the plan.
- **§ Smoke test** — the procedure that would have to pass before any
  future bind is considered shipped. Recorded so the next plan run doesn't
  re-derive it.
- **§ Branch matrix** — task-4 status branch enumeration (closes stress
  finding **P5**).
- **§ Recursion / collision / drift guards** — non-negotiable invariants
  any future routine prompt must encode.

## Current state (NO-ROUTINE-BOUND)

The loop is implemented entirely in GitHub Actions:

```
PR @claude comment
   │
   ▼
.github/workflows/claude.yml
   ├─ runs Claude Code Action review
   └─ posts [claude-review-complete] signal comment (via GH_PAT)
   │
   ▼
.github/workflows/claude-review-fix.yml
   ├─ counts [review-fix-loop] markers → round N/5
   ├─ if isClean → posts review summary + exits
   ├─ if maxRounds → posts notice + exits
   └─ else → runs fix agent + commits + tags @claude (loops)
```

How to operate today:

| Task | Command |
|------|---------|
| View recent runs | `gh run list --workflow=claude-review-fix.yml --limit=20` |
| View one run | `gh run view <run-id>` |
| Tail a live run | `gh run watch <run-id>` |
| Tag @claude on an existing PR | `/iago-prfix` (or comment `@claude review` manually on the PR) |
| Stop the loop early on a PR | Edit any `[review-fix-loop]` comment to remove the marker, or close + reopen the PR |
| Inspect skipped runs | `gh run list --workflow=claude-review-fix.yml --json conclusion,createdAt --jq '[.[] \| select(.conclusion==\"skipped\")] \| length'` (skipped = `if:` guard rejected the trigger; this is normal — most comments are not `[claude-review-complete]` signals) |

Round counter — gate on the `[review-fix-loop]` marker, not on
`[claude-review-complete]`. The marker is emitted by the fix-loop
"Tag @claude for re-review" step in
`.github/workflows/claude-review-fix.yml` (re-tag body literal at line
225; step block at lines 210–226). Five emissions stops the loop (closes
stress finding **E5**).

## Fallback

This is the always-write deliverable. It documents the revert path from
any future `/routines` bind back to the workflow-only path.

### When to revert

Revert triggers (any one is sufficient):

1. `/routines` is killed by Anthropic (preview shut down, feature pulled).
2. `/routines` rate-limits below observed iaGO peak load. Today's peak is
   **20 ran/day on 2026-04-28** (verified via `gh run list
   --workflow=claude-review-fix.yml --limit=200` 2026-05-11). Sustained
   throttle below 20/day on a single repo = revert.
3. Prompt drift between routine prompt and workflow prompt becomes
   undetectable. Drift detection rule: if the routine output materially
   diverges from a workflow-equivalent run on the same PR for two
   consecutive PRs, revert.
4. Recursion incident: routine triggers itself or re-triggers `claude.yml`
   in a tight loop. Revert and investigate before re-binding.
5. Plan eligibility revoked (Max 200 downgraded, preview tier restricted).

### Revert steps

```
1. Disable the routine in the Anthropic dashboard (web UI: My Routines → toggle OFF).
2. Confirm `.github/workflows/claude-review-fix.yml` is intact:
      git diff main -- .github/workflows/claude-review-fix.yml
   should return empty. If non-empty, restore from git history:
      git checkout main -- .github/workflows/claude-review-fix.yml
3. Confirm `.github/workflows/claude.yml` is intact (same diff check).
4. Issue a manual review on the most recent open PR to confirm the
   workflow-only path is firing:
      gh pr comment <PR#> --body '@claude smoke test — workflow-only path'
   then watch `gh run watch` for the next claude.yml run.
5. Document the revert: write a stop-log entry to this runbook's
   `## Revert events` section (create if absent) with date, trigger,
   routine ID, observed behavior, and the operator's signature.
6. Update `docs/specs/iago-os-roadmap.md` § `/routines` adoption with the
   revert outcome (so the next planner sees it).
```

The revert is **safe by construction** because no migration was ever
performed: the workflow path was never disabled, only paralleled. The
revert is a single-toggle action (step 1); steps 2-6 are verification and
record-keeping.

### Original Wedge C fallback (per roadmap)

Per roadmap § `/routines` adoption (line 193): if `/routines` is killed or
rate-limits below installflow Stripe-event volume, fall back to the
**original C (cron + script + `[SILENT]`) and H (custom webhook + HMAC)
plans**. The cron + `[SILENT]`-token path means:

- A scheduled cron job (GitHub Actions `on: schedule:`) polls for
  `[claude-review-complete]` comments on open PRs.
- A `[SILENT]` token in the comment body suppresses re-triggering downstream
  workflows.
- The HMAC layer is Wedge-H scope, not Wedge-C, and does not apply here.

If revert ever escalates beyond restoring the workflow-only path (e.g.,
if GitHub Actions itself fails for an extended window), the cron +
`[SILENT]` design is the next-step fallback. No code exists for it yet —
it is the Wedge-C-original design that `/routines` would replace if shown
viable. The roadmap line is the source of truth for the design intent.

## Smoke test (procedure-only — not run)

This procedure would have to pass before any future `/routines` bind is
considered shipped. **Not executed in this plan run** because task 2 was
skipped per the `BIND-NOT-VIABLE` verdict.

### Preconditions

- Routine bound, status `Active` in Anthropic dashboard.
- Recursion-guard prompt language present (see § Recursion guards).
- A throw-away test PR open on `ilsantino/iago-os` with at least one
  Critical-class finding seeded into the diff.

### Steps

1. Operator comments `@claude review` on the test PR. Start a stopwatch.
2. **SLA gate (draft — needs baseline run before promotion to canonical):**
   Within **10 minutes**, the routine MUST have posted a
   `[claude-review-complete]` signal OR a `[review-fix-loop]` round-1
   comment. The 10-min number is a **placeholder** chosen to (a) bound
   the smoke window for the first bind attempt and (b) leave headroom
   above the existing two-workflow chain's observed end-to-end latency
   (rough estimate: `claude.yml` review ≈ 2–5 min + `claude-review-fix.yml`
   dispatch ≈ 0.5–1 min, p50 not yet measured). **Before any production
   bind, this SLA MUST be replaced with a number derived from**:
   - measured p50 + p95 latency of the existing workflow chain over the
     same 22-day window used in the volume table, AND
   - measured p50 + p95 dispatch latency for `/routines` test invocations
     (requires a live preview run on a sandbox PR — chicken-and-egg with
     the bind decision, so the first smoke run doubles as the baseline).
   Treat the 10-min number as **draft P4 closure**, not authoritative.
   Stress finding P4 is therefore "Mitigated-by-process," not "Closed."
3. Verify the existing `claude-review-fix.yml` round counter incremented
   correctly: `gh run list --workflow=claude-review-fix.yml --limit=2`
   must show the expected new run.
4. Verify no duplicate review (`claude.yml` did not also fire on
   `@claude` if the routine target was `[claude-review-complete]`, which
   it must be — see § Collision guards).
5. Screenshot the Anthropic dashboard showing routine status `Active` +
   invocation log entry; save to
   `.iago/research/screenshots/2026-MM-DD-routine-smoke/` (closes stress
   finding **A3** with the storage path convention).
6. Post the smoke-test outcome as a comment on the test PR; link the
   screenshot path; close the test PR.

### Pass / fail

- **PASS** = SLA met AND no duplicate review AND round counter
  incremented AND screenshot saved.
- **FAIL** = any of the above. On FAIL, follow § Fallback revert steps
  immediately and emit roadmap status `RAN-SMOKE-FAILED →
  FALLBACK-DOCUMENTED`.

## Branch matrix (task-4 status enumeration)

Closes stress finding **P5** by enumerating every status branch the plan
can land on, including the missing "task 2 ran but smoke test failed"
case.

| Branch | Task 1 verdict | Task 2 ran? | Smoke test | Roadmap status row |
|--------|----------------|-------------|------------|----------------------|
| A | `BIND-VIABLE` | yes | PASS | `SHIPPED-BOUND` |
| B | `BIND-VIABLE-WITH-MITIGATION` | yes, mitigations configured | PASS | `SHIPPED-BOUND` (with mitigation note) |
| C | `BIND-VIABLE` or `BIND-VIABLE-WITH-MITIGATION` | yes | FAIL | `RAN-SMOKE-FAILED → FALLBACK-DOCUMENTED` and revert per § Fallback |
| D | `BIND-VIABLE-WITH-MITIGATION` | skipped (mitigation unconfigurable) | n/a | `FALLBACK-DOCUMENTED` |
| **E (this run)** | **`BIND-NOT-VIABLE`** | **skipped** | **n/a** | **`DEFERRED-TO-CYCLE-2`** |

Branch E is the path this plan ran on; the roadmap update in task 4 uses
the `DEFERRED-TO-CYCLE-2` label.

## Recursion guards (any future routine MUST encode)

If `/routines` is ever bound for this trigger, the routine prompt MUST
include all of the following — non-negotiable.

1. **Inbound trigger filter (subscription):** the routine MUST subscribe
   to `[claude-review-complete]` signal comments ONLY. The Anthropic
   dashboard event filter MUST NEVER include `@claude` as an inbound
   match — `@claude` is the `claude.yml` handler's trigger and binding the
   routine to it would duplicate review work and create a recursion loop.
   **Caveat — filter reliability:** per the research-artifact check 2
   (`.iago/research/2026-05-11-routines-bind-viability.md` § "Trigger-type
   fit"), fine-grained content filtering inside `issue_comment` payloads
   is reported as unreliable in third-party `/routines` writeups
   (dev.to whoffagents). Treat this dashboard filter as a *first-line*
   guard, not a hard contract. The routine prompt MUST also include an
   in-prompt body-content check: if the inbound comment body does not
   contain the literal token `[claude-review-complete]`, exit immediately
   with a one-line log entry and no side effects. The smoke test
   (§ Smoke test) MUST verify the in-prompt guard rejects an `@claude`
   comment that leaks past the dashboard filter (test case: post a plain
   `@claude review` comment; routine MUST take no action). Without that
   smoke-test evidence, the recursion-safety claim in this section is
   unverified. (Addresses stress finding **C3** and resolves the
   contradiction between check 2's filter-unreliability finding and the
   former MUST language.)
2. **Outbound loop signal (re-tag) — REQUIRED, not forbidden:** the
   routine replaces `.github/workflows/claude-review-fix.yml` step `Tag
   @claude for re-review` (line 210-226), so the routine MUST post an
   `@claude` comment outbound to re-trigger `claude.yml` for the next
   review round. Loop continuation depends on this. Recursion safety
   comes from guard #1 (inbound filter scoped to `[claude-review-complete]`,
   never `@claude`): the routine's own outbound `@claude` posts cannot
   re-fire the routine, only `claude.yml`. Outbound body MUST mirror the
   workflow step exactly: `[review-fix-loop] @claude Review again. Round
   N complete. <suffix>`. The `[review-fix-loop]` marker is REQUIRED for
   the round-counter (closes stress finding **E5**). No other comment
   the routine writes (e.g., diagnostic comments, intermediate progress
   notes) may contain `@claude` — only the round-closing re-tag.
3. **PR state gate:** the routine MUST short-circuit if the target PR is
   not `state == open`. Equivalent to `.github/workflows/claude.yml` line
   26-27 + `.github/workflows/claude-review-fix.yml` line 28 (closes stress
   finding **E3** — stale `@claude` on closed/merged PRs).
4. **Round limit:** the routine MUST count `[review-fix-loop]` markers on
   the PR and exit at round 5. Same counter logic as
   `.github/workflows/claude-review-fix.yml` line 128-134.
5. **Clean-signal short-circuit:** if the latest claude[bot] comment
   matches any clean signal in `.github/workflows/claude-review-fix.yml`
   line 69-93, the routine MUST post `## Review Summary` and exit.
6. **Both markers required:** the routine MUST emit *both*
   `[claude-review-complete]` (after review) and `[review-fix-loop]`
   (after fix push) for the legacy round counter to keep functioning
   during any rollback window. Forgetting one breaks the loop. Closes
   stress finding **E5**.

## Collision guards

If `/routines` is ever bound, the routine MUST NOT also fire on `@claude`
PR comments. `.github/workflows/claude.yml` line 21 (`contains(github.event.comment.body,
'@claude')`) is the existing handler and has priority. Anthropic dashboard
event-filter configuration MUST be scoped to `body contains
'[claude-review-complete]'` — never `@claude`. **Because dashboard
content filters are reported unreliable (see § Recursion guards #1
caveat), the in-prompt body-content check is the authoritative collision
guard; the dashboard filter is best-effort defense in depth.** (Addresses
stress finding **C3**.)

If a routine is bound for any *other* trigger in the future (graphify
nightly, MUNET PR triage), the same collision rule applies: verify no
existing workflow already fires on the same event class first.

## Drift guards

Prompt drift between routine prompt and workflow prompt has no automated
guard inside `/routines` (closes stress finding **E4** with documented
manual mitigation):

- The routine prompt MUST cite the workflow file commit SHA at the time
  the routine was created: `source-of-truth:
  .github/workflows/claude-review-fix.yml@<sha>`.
- Whenever the workflow file is modified, the routine prompt MUST be
  re-synchronized on the same day. A reminder to do so MUST go into the
  PR body of any change to `.github/workflows/claude-review-fix.yml` (and
  this runbook MUST be cited in the workflow file's header comment when
  the routine is bound).
- If two consecutive routine-vs-workflow output divergences are observed
  on the same PR, revert per § Fallback.

## Multi-repo connector scope

Single-repo only: `ilsantino/iago-os`. Client repos (`munet-web`,
`dinpro-pricing`, `fulldata-pricing-mock`, `sentria`, `bas-labs/*`) are
each their own auth boundary and would need their own routine + their own
audit. Closes stress finding **E1**. Any expansion beyond `iago-os` is
out of scope for this plan and out of scope for any follow-up bind audit
unless a separate plan explicitly enumerates the target repos with the
same connector-scope check.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Routine recursion | High | § Recursion guards #1-2; bind target restricted to `[claude-review-complete]` |
| `claude.yml` duplicate-review collision | High | § Collision guards; never bind to `@claude` |
| Prompt drift | Medium | § Drift guards; same-day re-sync rule + commit-SHA citation |
| Rate-limit below 20 ran/day peak | Medium | Volume measured in task 1 (peak 2026-04-28 = 20 ran); § Fallback revert trigger #2 |
| Plan eligibility revoked | Low | § Fallback revert trigger #5; revert is single-toggle |
| Stale @claude on closed PRs | Medium | § Recursion guards #3; routine prompt must check PR state |

## Revert events

_(Empty as of 2026-05-11. Append a row per revert when it happens.)_

| Date | Trigger | Routine ID | Observed behavior | Operator |
|------|---------|------------|---------------------|----------|

## Sources

- `.iago/plans/feature-wedge-c-routines/01-routines-bind-viability.md`
- `.iago/research/2026-05-11-routines-bind-viability.md` (task 1 verdict)
- `.github/workflows/claude.yml` (existing review trigger)
- `.github/workflows/claude-review-fix.yml` (existing fix loop — source of
  truth for any future routine prompt)
- `docs/specs/iago-os-roadmap.md` § `/routines` adoption (canonical
  roadmap; line 197 = "audit candidate, not Phase 1 scope")
- `gh run list --workflow=claude-review-fix.yml --limit=200` (volume data,
  2026-04-20 → 2026-05-11)
