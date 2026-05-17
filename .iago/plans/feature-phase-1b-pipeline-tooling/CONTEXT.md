# `.iago/plans/feature-phase-1b-pipeline-tooling/` — Phase 1b Pipeline Tooling Punch List (MWP L2 Stage Contract)

**Stage:** iago-os v2 Phase 1b — fix 4 pipeline-tooling bugs that surfaced during the Phase 1 merge train. Parallel-track to Phase 2 VPS bootstrap (independent files). Per `docs/specs/iago-os-v2-vision.md` § Roadmap row "1b — May-12 punch list (4 of 6 items)": `CLAUDE_CODE_SESSION_ID` instrumentation, learnings write path, dirty-branch guard, fallback parser fix.
**Layer:** L2 — stage contract.
**Token budget:** 200–500 tokens of contract content.
**Sibling stages:** `.iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md` (VPS bootstrap, runs in parallel — disjoint file surface).
**Preceding stage:** Phase 1 daemon skeleton landed in commit `4ee40ee` (hello-world acceptance gate).

This stage produces 3 numbered plan files (`01-*.md` … `03-*.md`) that, when executed through the iaGO pipeline, harden `scripts/execute-pipeline.sh` + its lib helpers across four orthogonal failure modes: (a) telemetry NDJSON gains a `sessionId` field linking every stage event to its originating `claude -p` session; (b) `.iago/learnings/` writes are explicit + fail-loud (or fail-with-fallback to `.iago/logs/learnings-fallback-{ts}.md`) with no silent permission/disk/lock losses; (c) `/iago-execute` pre-flight no longer false-positives on a clean working tree polluted by worktree metadata or gitignored untracked artifacts; (d) the Claude adversarial fallback (pipeline step 4 when Codex absent/failed) emits a structured `===VERDICT: CLEAN===` / `===VERDICT: ISSUES===` sentinel that the parser greps for — eliminating the "no issues found" prose false-clean. Acceptance gate = the 4-bug verification matrix in Plan 03 Task 1.

## Inputs

### Layer 3 (reference — internalized as constraints, NOT processed as input)

- `CLAUDE.md` (repo root, L0) — execution discipline + pipeline rules + memory architecture; specifically the line "`.iago/learnings/` accumulates review patterns" (drives Plan 01 Task 4 write-path design)
- `.claude/rules/execution-pipeline.md` — canonical pipeline stages 0–6 + observation-masking + frozen-snapshot self-freeze rationale
- `.claude/rules/tdd.md` — RED-GREEN-REFACTOR mandatory; pipeline scripts get shell-test coverage (bats-core where available, pure-bash harness otherwise — matches existing `scripts/test-pipeline-helpers.sh` + `scripts/test-build-gate.sh` pattern)
- `.claude/rules/systematic-debugging.md` — 4-phase debugging for any blocked plan; 3-fix escalation on the parser if structured-verdict approach fails
- `.claude/rules/layer-triage.md` — all 4 fixes are deterministic + rule-based (60/30 split); zero AI surface in this phase
- `.claude/rules/git-workflow.md` — conventional commits, STATE.md bump on merge
- `docs/specs/iago-os-v2-vision.md` § Roadmap row 1b — confirms these 4 items are scoped to a single feature PR

### Layer 4 (product — processed as input each run)

- `scripts/execute-pipeline.sh` — **PRIMARY SURFACE**; 1004 lines. Stage emission points: line 87/114 (telemetry `printf`), line 257 (stress verdict regex), line 569 (review verdict regex), line 711–717 (Codex invocation), line 660–669 (`run_claude_adversarial` fallback), line 723–731 (Codex no-files demotion), line 750/780 (Codex finding patterns), line 782 (USED_CLAUDE_FALLBACK guard — already present, demonstrates the fallback false-clean blind spot). Every `claude -p` invocation must be inspected for `CLAUDE_CODE_SESSION_ID` plumb-through (Plan 01 Task 1).
- `scripts/lib/pipeline-telemetry.sh` — 134 lines. `pipeline_init` (line 59), `stage_start` (line 80), `stage_end` (line 106), `pipeline_finalize` (line 122) all emit NDJSON `printf` lines that need a new `sessionId` field. `STAGE_EXTRAS` mechanism (line 96) is reusable for per-stage session-id capture but a top-level field is preferred for join performance.
- `scripts/lib/pipeline-telemetry.test.sh` — existing test harness (pure-bash). Add session-id round-trip tests here.
- `scripts/lib/build-gate.sh` — 217 lines. Emits no telemetry directly (uses `stage_extra` from caller); confirm no session-id leak needed inline.
- `scripts/lib/metrics-aggregate.test.sh` — aggregator over NDJSON files in `.iago/state/pipeline-runs/`. Extend to project the new `sessionId` field.
- `scripts/metrics-aggregate.mjs` — NDJSON consumer that must learn the new field (downstream of the schema bump).
- `.claude/skills/iago-execute/SKILL.md` — 164 lines. § 3 "Git sync" currently only does `git checkout main && git pull origin main`. The dirty-branch pre-flight that fires false-positive is implicit (driven by `git status` in the orchestrator session prior to invoking the skill). Plan 02 Task 1 SURFACES the check as an explicit script `scripts/check-clean-tree.sh` so its behavior is testable + corrected.
- `.iago/learnings/patterns.md`, `.iago/learnings/project-conventions.md` — only two files present. Both manually authored. No script writes today. Plan 01 Task 4 introduces the first scripted writer (`scripts/lib/learnings-writer.sh`) with fail-loud semantics from day one.
- `scripts/test-pipeline-helpers.sh` — extend with session-id assertions.
- `scripts/test-build-gate.sh` — reference pattern for shell-test harness style.
- `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` — Codex CLI wrapper; not edited (lives outside repo), but the fallback path (Claude `-p opus` with adversarial prompt) is fully inside `execute-pipeline.sh` lines 660–669 and is what Plan 02 Task 3 fixes.
- *Plan files written into this folder (`NN-*.md`)* — generated by this `/iago-plan --feature` invocation, consumed by `/iago-execute feature-phase-1b-pipeline-tooling`

## Process

1. **Plan** — already executed: this run produced 3 plan files (`01-*.md` … `03-*.md`) derived from the user's 4-bug canonical scope. Plan 01 covers bugs (1) + (2) — telemetry + learnings — independent files; Plan 02 covers bugs (3) + (4) — dirty-branch guard + fallback parser sentinel — both touch `execute-pipeline.sh` so they share a wave but get separate review surface; Plan 03 is the integration harness + 4-bug verification matrix.
2. **Stress test** — every plan stress-tested inline (`## Stress Test` section appended). Pipeline step 0 skips re-stress on plans that already carry that section.
3. **Approval gate** — present the plan stack to Santiago. Defaults stand unless overridden.
4. **Execute** — `/iago-execute feature-phase-1b-pipeline-tooling`. Full 8-stage pipeline per plan. Wave grouping: wave 1 = Plan 01 + Plan 02 in parallel (Plan 01 touches `scripts/lib/pipeline-telemetry.sh` + new `scripts/lib/learnings-writer.sh`; Plan 02 touches `scripts/execute-pipeline.sh` line 660–669 + new `scripts/check-clean-tree.sh`; surface overlap is the SHA insertion points in `execute-pipeline.sh` for telemetry — Plan 02 acknowledges this and reads Plan 01's telemetry contract before patching); wave 2 = Plan 03 (integration harness — depends on 01 + 02).
5. **Verify** — Phase 1b acceptance criteria: (a) every NDJSON line in `.iago/state/pipeline-runs/*.ndjson` carries `"sessionId":"..."` when `CLAUDE_CODE_SESSION_ID` env is set; absent or `"sessionId":""` when unset; (b) a write failure to `.iago/learnings/` (simulated via `chmod 0500`) emits a stderr line + a `learnings-write-failed` NDJSON event + writes a fallback file; (c) a clean tree with `git worktree add` artifacts AND gitignored untracked files passes the pre-flight; a tree with real uncommitted edits fails; (d) a Claude fallback response containing prose "no issues found" but ending with `===VERDICT: ISSUES===` is correctly routed to the fix loop; one ending with `===VERDICT: CLEAN===` skips the fix loop; one with NEITHER sentinel triggers a manual-review escalation (NOT auto-clean).
6. **Session digest** — write `sessions/2026-MM-DD-iago-os-v2-phase-1b-pipeline-tooling.md` to the Obsidian vault per `~/.claude/rules/obsidian.md`. Update STATE.md per project rule.

## Outputs

| Output | Location | Status |
|---|---|---|
| Phase 1b plan stack (3 plans, ~17 tasks, 2 waves) | `.iago/plans/feature-phase-1b-pipeline-tooling/NN-*.md` | Pending — generated by this `/iago-plan` run |
| Telemetry session-id plumbing | `scripts/lib/pipeline-telemetry.sh` (edit) + `scripts/execute-pipeline.sh` (edit) | Pending — Plan 01 |
| Telemetry session-id tests | `scripts/lib/pipeline-telemetry.test.sh` (extend) + `scripts/test-pipeline-helpers.sh` (extend) | Pending — Plan 01 |
| Learnings writer helper | `scripts/lib/learnings-writer.sh` + `scripts/lib/learnings-writer.test.sh` | Pending — Plan 01 |
| Learnings writer integration in pipeline | `scripts/execute-pipeline.sh` (edit — fail-loud write path) | Pending — Plan 01 |
| Clean-tree pre-flight script | `scripts/check-clean-tree.sh` + `scripts/check-clean-tree.test.sh` | Pending — Plan 02 |
| `/iago-execute` skill update | `.claude/skills/iago-execute/SKILL.md` (edit — § 3 Git sync now invokes the script) | Pending — Plan 02 |
| Adversarial fallback sentinel-verdict refactor | `scripts/execute-pipeline.sh` line 660–669 (edit `run_claude_adversarial` prompt) + line 776–784 (edit parser) | Pending — Plan 02 |
| Adversarial fallback parser tests | `scripts/test-pipeline-helpers.sh` (extend — verdict-extraction unit tests) | Pending — Plan 02 |
| 4-bug integration harness | `scripts/test-phase-1b-integration.sh` | Pending — Plan 03 |
| Metrics aggregator session-id projection | `scripts/metrics-aggregate.mjs` (edit) + `scripts/lib/metrics-aggregate.test.sh` (extend) | Pending — Plan 03 |
| `.iago/learnings/` write-path documentation | `.iago/learnings/README.md` (new) | Pending — Plan 03 |
| Pipeline summaries (one per plan) | `.iago/summaries/feature-phase-1b-pipeline-tooling-NN-<timestamp>.md` | Pending — written by pipeline step 6 |
| PR with @claude tagged for async review | GitHub | Pending — written by pipeline step 5b |

## Decided constraints (do not relitigate during planning)

These bindings are locked by the canonical scope statement, the v2 vision roadmap, and the existing helper architecture. Any plan contradicting them is wrong.

- **Single feature PR.** All 3 plans land in one branch + one PR. Wave 1 plans (01 + 02) can be implemented in parallel by the pipeline but the PR is one — `--no-pr` stacked commits per plan, single PR at the end is acceptable; default is one PR with all 3 plans' commits stacked.
- **No new external dependencies.** Existing helpers + pure bash + Node.js 20 only. No npm install, no Python, no new global tools. bats-core remains optional (Windows-awkward); pure-bash test harness pattern from `scripts/test-pipeline-helpers.sh` is the primary test surface.
- **`CLAUDE_CODE_SESSION_ID` is read-only from env.** The pipeline reads `process.env.CLAUDE_CODE_SESSION_ID` if Claude Code injects it at `claude -p` spawn time. If the env var is unset, telemetry records `"sessionId":""` (empty string) — NOT a fabricated UUID. Per v2 vision § Roadmap "join key" purpose, the value is opaque to the pipeline; aggregator-side joins handle null/empty.
- **Threading vector.** Telemetry helpers read `${CLAUDE_CODE_SESSION_ID:-}` directly at emission time — NOT passed as function argument. Avoids signature churn across all `stage_start`/`stage_end`/`stage_extra` call sites in `execute-pipeline.sh`.
- **Per-stage capture.** Each `claude -p` invocation in `execute-pipeline.sh` (stress, implement, review, fix, codex-fix, PR, tag, summary) MAY have a distinct session-id (each is a fresh session). The NDJSON record's `sessionId` reflects the env-var value AT EMISSION TIME — meaning stage-scoped if the orchestrator script exports session-id per-stage; pipeline-scoped if it does not. Plan 01 Task 1 design decision: capture session-id per `run_claude` call by `export`-ing the value into the subshell — so `stage_end` writes the spawned-session id, not the parent script's.
- **Learnings fail-loud as default, fallback as override.** Default mode = fail-loud (exit non-zero from the writer; stderr + telemetry event). Fallback mode (write to `.iago/logs/learnings-fallback-{ts}.md`) is opt-in via `LEARNINGS_WRITE_MODE=fallback` env var. Pipeline default = fail-loud (Garry standard — silent failure is the bug). Manual reviewers can opt into fallback when wedge-testing.
- **Dirty-tree check uses `git status --porcelain=v1`.** Filter out worktree metadata + gitignored entries by default; expose `--strict` flag for the rare case where untracked files are a real concern. The script reads HEAD only — does NOT touch the working tree, does NOT auto-stash.
- **Adversarial fallback verdict sentinel.** The Claude `-p opus` adversarial prompt is updated to END with: `===VERDICT: CLEAN===` (no findings) OR `===VERDICT: ISSUES===` (findings present, listed above). Parser greps for these literal strings (anchored). If NEITHER sentinel present → escalate to manual review (do NOT default-clean) per `.claude/rules/systematic-debugging.md` "no assumption when evidence absent".
- **Backward-compat.** Existing NDJSON consumers (current `metrics-aggregate.mjs`) MUST tolerate records with AND without `sessionId` for one transition window. Aggregator update in Plan 03 surfaces the new field but degrades gracefully on legacy records.
- **No pipeline-script self-edit risk.** Plan 02 edits `execute-pipeline.sh` line ranges 660–669 + 776–784 — limited surface. The self-freeze mechanism (line 69–75) ALREADY protects against mid-run edits; no new protection needed.
- **Telemetry contract precedence.** Plan 01 ships first in implementation order even though wave 1 parallelism applies — Plan 02's session-id emission in the new `check-clean-tree.sh` script depends on the contract Plan 01 defines. Wave 1 plans agree to read Plan 01's telemetry helper signature BEFORE patching.
- **Garry-impressed completeness standard.** Every script idempotent; every command verified; every test covers happy + sad + edge path; zero TODOs without tracked issue + date.

## Open questions to capture (not block) during planning

- **OQ1 — Session-id capture granularity.** Default: per-`run_claude`-call (each `claude -p` session gets its own; telemetry records it at emission). Alternative: pipeline-scoped (one session-id from orchestrator → all stages). Default chosen because it preserves the v2 vision "join key" semantics (Agent View shows per-session events).
- **OQ2 — Learnings writer schema.** Default: append-only Markdown to `.iago/learnings/patterns.md` with `## YYYY-MM-DD HH:MM — {pattern-key}` heading. Alternative: JSONL for machine queryability. Markdown chosen because existing files are Markdown.
- **OQ3 — Clean-tree script strictness default.** Default: lenient (filter worktree + gitignored). Strict mode via `--strict`. Lenient chosen because the bug is false-positive; the orchestrator runs in a worktree most of the time per `feedback_worktree_per_session` memory.
- **OQ4 — Adversarial sentinel collision.** Sentinel `===VERDICT: CLEAN===` could theoretically appear in a diff being reviewed. Mitigation: parser anchors to last line of output (`tail -3`) + exact string match. Plan 02 Task 4 includes a test for this collision case.
- **OQ5 — Aggregator legacy-record handling.** Default: emit `"sessionId":null` for legacy records (pre-Phase-1b NDJSON files). Confirmed lenient.

## Source

- L0: `CLAUDE.md` (repo root)
- L1: `.iago/CONTEXT.md`
- Sibling L2: `.iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md` (parallel-track VPS bootstrap)
- Preceding L2: Phase 1 daemon (closed in commit `4ee40ee`)
- This file: L2 stage contract scoped to Phase 1b only (4-bug pipeline-tooling punch list)
- Roadmap reference (L4): `docs/specs/iago-os-v2-vision.md` § Roadmap row "1b — May-12 punch list"
- MWP rationale: `.iago/research/2026-05-13-mwp-source-synthesis.md` §3.2 (stage contracts)
