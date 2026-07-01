# State — iaGO-OS

> **Phase:** v2 Phase 2 (VPS bootstrap) ~80% + a review-infra / daemon-hardening wave landed on main (#83–#94). Cutover off OpenClaw NOT yet executed (human-triggered; tentative 2026-05-25 target slipped). Deferred surface fully mapped — `.iago/research/2026-06-13-deferred-backlog-index.md`: ~38 OPEN items (+4 adjacent) across 3 workstreams (A gate-hardening / B daemon-durability / C cutover-gate) + 1 tracked Critical (GH-15 probe-transcription-trust, mitigated to Minor by #96); DD-R1 registration-orphan CLOSED 2026-06-13 by #92; zero untracked Criticals. Workstream A (gate-hardening) landed via #96 + #97 (production Tier 2/3 onto the dual-adversarial AUTO lens path); Workstream B daemon-recovery-hardening shipped via #92 (DD-R1 closed; plan archived 2026-06-17) — residual B/cutover items are Santiago's go/no-go. Phase-2 acceptance-evidence surface (Plan 05a #98 + 05b #99) COMPLETE — `check-evidence --phase 2` gate + opt-in VPS e2e; next code plan is 06 (SIGHUP cred reload) → 07a (cron) → 07b (agent-manager) → human-gated cutover (Workstream C).
> **Tag:** v0.1.0 | **Updated:** 2026-07-01

## Active

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| 2026-07-01 | merge | PR #99 — Phase 2 acceptance evidence checker (`check-evidence.mjs --phase 2` gate, 26 gate tests, CI-wired) + opt-in Tailscale VPS e2e (15 tests). 3 dual-adversarial rounds + async @claude converged. Summary: `.iago/summaries/05b-evidence-checker-and-e2e.md`. Next: Plan 06 (SIGHUP cred reload). | [#99](https://github.com/ilsantino/iago-os/pull/99) → `90fafa7` |
| 2026-06-29 | merge | PR #98 — Phase 2 acceptance evidence template + VPS fixtures (Plan 05a) + cutover-gate hardening (T+08 fail-closed, T+10/T+30 reachability unification, retry-once). Next: Plan 05b (evidence-checker + E2E). | [#98](https://github.com/ilsantino/iago-os/pull/98) → `8aa377c` |
| 2026-06-17 | docs | Archived daemon-recovery-hardening plan — its 8 tasks all shipped in #92; the `/iago-execute` STRESS stage correctly blocked re-execution as stale. DD-R1 (Phase 2's last code Critical) closed. Summary: `.iago/summaries/feature-daemon-recovery-hardening.md`. | `0f0d03c` |
| 2026-06-16 | merge | PR #97 — wire production Tier 2/3 review onto the dual-adversarial AUTO lens path (Workstream A follow-up to #96). | [#97](https://github.com/ilsantino/iago-os/pull/97) → `4d8a448` |
| 2026-06-16 | merge | PR #96 — harden the review pipeline's own gate scripts (risk-tiering keywords + tier_override clamp, reviewer-input integrity, compliance read-only guard, classifyTier drift-guard + CI wiring). Workstream A. | [#96](https://github.com/ilsantino/iago-os/pull/96) → `3bb7f68` |
| 2026-06-14 | merge | PR #94 — metered-model spend guardrail recorded in model-independence ADR (fail-closed spend ceiling). | [#94](https://github.com/ilsantino/iago-os/pull/94) → `6807d04` |
| 2026-06-14 | merge | PR #90 — auto-configure the code-review gate from the diff (deriveLenses by changed paths). | [#90](https://github.com/ilsantino/iago-os/pull/90) → `068c93e` |
| 2026-06-13 | merge | PR #89 — scale code-review depth to each plan's risk level (Tier 1/2/3 gate). | [#89](https://github.com/ilsantino/iago-os/pull/89) → `a5900b5` |
| 2026-06-13 | merge | PR #92 — harden daemon recovery, registration, and cron resilience. | [#92](https://github.com/ilsantino/iago-os/pull/92) → `b3af16c` |
| 2026-06-13 | research | Deferred-backlog index — canonical map of 38 OPEN deferrals (Workstreams A/B/C) feeding the next follow-on PRs. | `.iago/research/2026-06-13-deferred-backlog-index.md` |
| 2026-06-05 | merge | PR #93 — pipeline efficiency hardening. | [#93](https://github.com/ilsantino/iago-os/pull/93) → `1d7ab94` |
| 2026-06-04 | merge | PR #91 — canonical v2 ROADMAP + PROJECT + model-independence docs (supersedes scattered v2 specs). | [#91](https://github.com/ilsantino/iago-os/pull/91) → `a9c02ad` |
| 2026-06-02 | merge | PR #84 — close pr-triage alert/credential gaps; R1 "agents never hold secrets" daemon-creds rework. Tail deferred → daemon-recovery-hardening. | [#84](https://github.com/ilsantino/iago-os/pull/84) → `6953ea7` |
| 2026-05-31 | merge | PRs #85/#87/#88 — per-agent Telegram bots + agent-to-agent messaging (#85); recover lost daemon test coverage (#87, DD-R1 Critical deferred); restore `/industry-patterns` domain files (#88). | `a014801` / `5f1c1c0` / `aeeba9e` |
| 2026-05-30 | merge | PR #86 — upgrade the review gate + clean up Claude Code config. | [#86](https://github.com/ilsantino/iago-os/pull/86) → `7f26f1b` |
| 2026-05-30 | spec | cortextOS comms gap-analysis → per-agent bots (standing) + chief bot (ephemeral) + file-bus envelope. ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md` (shipped #85). | `docs/v2-cortextos-comms-replan` |
| 2026-05-29 | merge | PR #83 — rebuild the execution pipeline as a harness-native Workflow (bash deprecated 1 cycle; commit-before-review for Codex). | [#83](https://github.com/ilsantino/iago-os/pull/83) → `7aa0f09` |
| 2026-05-28 | plan | Planned + stress-tested: `feature-lead-hunt-scrapling` (Scrapling MCP + `/lead-hunt`), `feature-pr84-gap-closure`, `feature-mwp-restructure-{docs,clients,code}` — restructure awaiting `/iago-execute`. | (planned) |
| 2026-05-20 | merge | PRs #66/#68/#70/#71/#72 — Phase 2 dual-review artifacts, cutover/rollback executables (Plan 03a/03b), README v2 reframe, strategy-sync + observability ADRs. | merged |

## Known Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| `docs/v2-roadmap-project` has 2 redundant commits | Minor | `a11d920` (G-cost gate) + `67b3d21` (review fixes) sit ahead of main in ancestry, but their content already landed on main via #91 (`a9c02ad`) — verified `a11d920..origin/main` ROADMAP+vision diff is empty. Disposition: **abandon** (content-equivalent orphans, nothing to re-PR). |
| VPS cutover off OpenClaw not executed | Tracked | Human-triggered step; cutover-gate checklist = Workstream C (runs at deploy, not before). |
| GH-15 tracked (mitigated to Minor) | Tracked | GH-15 probe-transcription-trust — #96 shipped the fail-closed compliance read-only guard (mitigation); residual haiku sha-snapshot transcription jitter remains a Minor. DD-R1 registration-orphan CLOSED 2026-06-13 by #92 (recovery-hardening plan shipped + archived 2026-06-17). |

## Recent Decisions

| Date | Decision | Phase |
|------|----------|-------|
| 2026-06-13 | Deferred surface mapped; gate-hardening (A) + durability-hardening (B) PRs unblocked by #89/#92 | v2 P2 |
| 2026-05-30 | Per-agent Telegram bots (standing) + chief bot (ephemeral) — reverses one-bot stance | v2 P3 |
| 2026-05-20 | Observability = Sentry (A+D) / PostHog (B+E) / dual-MCP (C); SQLite = 6th memory layer | v2 |
| 2026-05-15 | Agent Shape Taxonomy + AgentRuntime 5-shape polymorphic interface | v2 P1 |
