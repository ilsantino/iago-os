# Orphan Recovery — Content-Presence Manifest (G1)

_2026-05-30. A4 of the v2 sharpened action plan. Proves every file carried by the orphaned-base PRs is present on the recovery branch HEAD after the 3-way merges. Companion to `2026-05-30-v2-sharpened-action-plan.md` (G1 guardrail)._

## What was recovered

Three PRs (#54, #56, #57) were squash-merged into **sibling feature branches** instead of `main` during the 2026-05-18 stacked B/C dispatch, so `gh` reported them MERGED but their content never reached main. Recovered here via 3-way `git merge` (never cherry-pick) of the salvage tags:

- `salvage/b-05` (2666ff2) = tip of the `b-04 → b-05` stack → restores #54 (deferred-hardening: `biome.json`, adapter-isolation tests + fixtures, InterfaceVersion centralization, registry deep-freeze) **and** #56 (minor sweep).
- `salvage/c-03` (4d4b0b8) = tip of the C stack → restores #57 (`scripts/test-phase-1b-integration.sh`, `.iago/learnings/README.md`, metrics-aggregate sessionId projection).

## Conflict resolution (manual — every hunk inspected, no blanket `-X`)

| File | Side taken | Rationale |
|---|---|---|
| `runtime/daemon/telemetry.ts` | **both** | Kept main's full `TelemetryEvent` union (through `claim-task-failed`) AND appended b-05's `runtime-registration-failed` member. |
| `runtime/telegram/bot.test.ts` | **b-05** | HEAD side empty; took b-05's 3 net-new describe blocks (PR45 M5/M6/M8); titles verified unique. |
| `scripts/execute-pipeline.sh` | **main** | Deprecated bash pipeline (superseded by harness-native JS, PR #83). Main strictly ahead (PR #78 env-validation + gitignored-path `|| true` guards); c-03 edits obsolete. |
| `scripts/lib/learnings-writer.sh` | **main** | Same deprecated tree; main is the shipped PR #55 redirect-order fix. c-03's tmpfile idiom is a separate improvement for a dying file, out of recovery scope. |
| `.iago/summaries/_dispatch-c-02.log` | **c-03** | Provenance log artifact; took c-03's dispatch record. |

## Presence proof — `git ls-tree -r HEAD` (daac474724902bf37e5b5129405495a231041d79)

All 66 orphan paths asserted present. 0 missing.

### salvage/b-05 paths

| Present | Status | Path |
|---|---|---|
| ✅ | added | `.iago/decisions/2026-05-17-exact-optional-property-types.md` |
| ✅ | added | `.iago/plans/feature-phase-1-deferred-hardening/03b-coverage-pass-bot.md` |
| ✅ | added | `.iago/summaries/02-atomic-rename-audit.md` |
| ✅ | added | `.iago/summaries/03b-coverage-pass-bot.md` |
| ✅ | added | `.iago/summaries/_dispatch-b-03.log` |
| ✅ | added | `.iago/summaries/_dispatch-b-03b.log` |
| ✅ | added | `.iago/summaries/_pr-body-b03-main.md` |
| ✅ | added | `.iago/summaries/_pr-body-b04.md` |
| ✅ | added | `.iago/summaries/_pr-body-c01-telemetry.md` |
| ✅ | modified | `runtime/PHASE-1-EVIDENCE.md` |
| ✅ | modified | `runtime/agent-runtime/README.md` |
| ✅ | modified | `runtime/agent-runtime/pty/claude-pty.test.ts` |
| ✅ | modified | `runtime/agent-runtime/pty/claude-pty.ts` |
| ✅ | modified | `runtime/agent-runtime/pty/prompt-parser.ts` |
| ✅ | modified | `runtime/agent-runtime/registry.test.ts` |
| ✅ | modified | `runtime/agent-runtime/registry.ts` |
| ✅ | modified | `runtime/agent-runtime/types.ts` |
| ✅ | added | `runtime/biome.json` |
| ✅ | modified | `runtime/daemon/agent-manager.test.ts` |
| ✅ | modified | `runtime/daemon/agent-manager.ts` |
| ✅ | modified | `runtime/daemon/config.test.ts` |
| ✅ | modified | `runtime/daemon/config.ts` |
| ✅ | modified | `runtime/daemon/file-bus.test.ts` |
| ✅ | modified | `runtime/daemon/heartbeat.ts` |
| ✅ | modified | `runtime/daemon/ipc-server.test.ts` |
| ✅ | modified | `runtime/daemon/ipc-server.ts` |
| ✅ | modified | `runtime/daemon/main.test.ts` |
| ✅ | modified | `runtime/daemon/main.ts` |
| ✅ | modified | `runtime/daemon/markers.ts` |
| ✅ | modified | `runtime/daemon/session-log.test.ts` |
| ✅ | modified | `runtime/daemon/session-log.ts` |
| ✅ | modified | `runtime/daemon/state-paths.test.ts` |
| ✅ | modified | `runtime/daemon/state-paths.ts` |
| ✅ | modified | `runtime/daemon/telemetry.ts` |
| ✅ | added | `runtime/integration/adapter-isolation.test.ts` |
| ✅ | added | `runtime/integration/fixtures/fake-broken-adapter.ts` |
| ✅ | added | `runtime/integration/fixtures/fake-good-adapter.ts` |
| ✅ | modified | `runtime/integration/hello-world.test.ts` |
| ✅ | modified | `runtime/scripts/check-evidence.mjs` |
| ✅ | modified | `runtime/scripts/test-rollback.mjs` |
| ✅ | modified | `runtime/telegram/README.md` |
| ✅ | modified | `runtime/telegram/approval-bus.test.ts` |
| ✅ | modified | `runtime/telegram/approval-bus.ts` |
| ✅ | modified | `runtime/telegram/bot.test.ts` |
| ✅ | modified | `runtime/telegram/bot.ts` |
| ✅ | modified | `runtime/telegram/commands.test.ts` |
| ✅ | modified | `runtime/telegram/commands.ts` |
| ✅ | modified | `runtime/vitest.config.ts` |

### salvage/c-03 paths

| Present | Status | Path |
|---|---|---|
| ✅ | added | `.iago/learnings/README.md` |
| ✅ | modified | `.iago/learnings/patterns.md` |
| ✅ | modified | `.iago/plans/feature-phase-1b-pipeline-tooling/02-clean-tree-guard-and-adversarial-fallback-sentinel.md` |
| ✅ | added | `.iago/summaries/02-clean-tree-guard-and-adversarial-fallback-sentinel.md` |
| ✅ | modified | `.iago/summaries/_dispatch-c-01-retry.log` |
| ✅ | added | `.iago/summaries/_dispatch-c-02.log` |
| ✅ | added | `.iago/summaries/_dispatch-c-03.log` |
| ✅ | added | `scripts/check-clean-tree.sh` |
| ✅ | added | `scripts/check-clean-tree.test.sh` |
| ✅ | modified | `scripts/execute-pipeline.sh` |
| ✅ | added | `scripts/lib/adversarial-verdict.sh` |
| ✅ | modified | `scripts/lib/learnings-writer.sh` |
| ✅ | modified | `scripts/lib/learnings-writer.test.sh` |
| ✅ | modified | `scripts/lib/metrics-aggregate.test.sh` |
| ✅ | modified | `scripts/lib/pipeline-telemetry.sh` |
| ✅ | modified | `scripts/metrics-aggregate.mjs` |
| ✅ | added | `scripts/test-phase-1b-integration.sh` |
| ✅ | modified | `scripts/test-pipeline-helpers.sh` |
