# State — iaGO-OS

> **Phase:** post-audit | **Status:** audit verified
> **Tag:** v0.1.0 | **Updated:** 2026-04-13

## Active

No active plans. Audit phase complete.

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| 2026-04-13 | fast | Add console gate (step 2b) — Playwright runtime error check | ec00081 |
| 2026-04-20 | quick | Real Codex adversarial on Windows via codex-companion | [#18](https://github.com/ilsantino/iago-os/pull/18) |
| 2026-04-20 | fast | Add concurrency guards to claude.yml + claude-review-fix.yml (stop parallel loops) | f47cc2c |
| 2026-04-23 | plan | Feature plan + stress test for `mcp-youtube-transcript` Python MCP | 1 plan / 7 tasks — PROCEED_WITH_NOTES |
| 2026-04-27 | execute | youtube-transcript MCP shipped — Python MCP via youtube-transcript-api, registered globally | [#19](https://github.com/ilsantino/iago-os/pull/19) merged, 33 tests passing |
| 2026-04-27 | plan | Feature plan + stress test for `feature-pipeline-speed-wedges` (5 wedges + measurement protocol) | 6 plans / 41 tasks — first round: 5 PROCEED_WITH_NOTES + 1 BLOCK (plan 03). Revised + re-stress-tested: all 6 PROCEED_WITH_NOTES with critical findings addressed inline. Ready for Path 2 (ship plan 01 first). |
| 2026-04-27 | quick | Codex CLI 0.118→0.125, plugin v1.0.2→v1.0.4, `~/.codex/config.toml` pinned to gpt-5.5; align stale GPT-5.4 refs to config.toml | [#20](https://github.com/ilsantino/iago-os/pull/20) merged |
| 2026-04-27 | research | hermes-agent (Nous Research, 120K stars) deep dive + 9-wedge adoption roadmap; CEO chose full adoption over conservative 3-wedge | docs/research/hermes-agent.md + docs/specs/hermes-agent-adoption.md |
| 2026-04-27 | fast | Wedge A: MEMORY.md frozen-snapshot rule — CLAUDE.md paragraph + new feedback memory + council/skill.md exception comment. Wedges B–I queued as `feature-hermes-adoption` plans. | (this commit) |

## Known Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| macOS `timeout` in pipeline | Low | `run_claude()` uses GNU `timeout` — not available on macOS without coreutils. Sebas will hit this. Fix: detect OS, use `gtimeout` or background+sleep fallback. |
| Local main diverged from origin/main | Minor | CRLF fix committed directly to local main; same content in PR #15 squash merge on remote. Run `git checkout main && git pull --rebase origin main` to reconcile. |

## Recent Decisions

| Date | Decision | Phase |
|------|----------|-------|
| 2026-04-13 | Audit phase verified — all 6 plans merged (PRs #11-#15) | audit |
| 2026-04-12 | Remove lgtm/approved from clean signals, add summary loop guard | audit |
| 2026-04-07 | Adversarial review → 4x iago-quick runs (not SDD) | hardening |
| 2026-04-07 | Pipeline build gate: skip when no tsconfig/vite | hardening |
| 2026-04-07 | PreToolUse hooks fail-closed, PostToolUse stay fail-open | hardening |

## Completed (v0.1.0 + audit cycle)

<details><summary>Audit phase (2026-04-12 → 2026-04-13, verified)</summary>

| Date | Mode | Description | Ref |
|------|------|-------------|-----|
| 2026-04-12 | execute | audit-01: 8 critical pipeline fixes | [#11](https://github.com/ilsantino/iago-os/pull/11) |
| 2026-04-12 | execute | audit-02: broken refs, dead links, model claims, pattern renames | [#12](https://github.com/ilsantino/iago-os/pull/12) |
| 2026-04-12 | execute | audit-03: config conflicts, CI gaps, stress test docs | [#13](https://github.com/ilsantino/iago-os/pull/13) |
| 2026-04-12 | execute | audit-04: stale docs, dead state, memory-stack cleanup | [#14](https://github.com/ilsantino/iago-os/pull/14) |
| 2026-04-12 | fast | Fix review-fix loop clean detection | 6128c30 |
| 2026-04-12 | execute | audit-05: enforce stress findings + pattern checks | [#15](https://github.com/ilsantino/iago-os/pull/15) |
| 2026-04-12 | execute | audit-06: Codex adversarial on Windows + fallback | [#15](https://github.com/ilsantino/iago-os/pull/15) |
| 2026-04-13 | verify | Audit phase verified — all checks passed | `.iago/reviews/audit-phase.md` |

</details>

<details><summary>Quick tasks archive (2026-04-07 → 2026-04-10)</summary>

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| 2026-04-07 | quick | Security hardening: fail-closed hooks, bash secrets, safe staging | 476e82c |
| 2026-04-07 | quick | Agent/skill config: model routing, dynamic paths, experimental tags | dc3b80b |
| 2026-04-07 | quick | Housekeeping: ECC comments, archive research, STATE.md | 2f20a3f |
| 2026-04-07 | quick | Harden SDD: --pipeline flag, Codex fallback | 5eaee56 |
| 2026-04-08 | quick | Fix review-fix silent no-op (custom_instructions → prompt) | [#8](https://github.com/ilsantino/iago-os/pull/8) |
| 2026-04-08 | fast | Compress CLAUDE.md (~19% token reduction) | ab6d5b2 |
| 2026-04-08 | fast | Add caveman-lite output rules for orchestrator | ae528fd |
| 2026-04-08 | fast | Add allowedTools, fix clean detection, compress prompts | f4e64e0 |
| 2026-04-09 | quick | Review pipeline control flags + pr-review-pipeline docs | 40c3ac7 |
| 2026-04-09 | — | Memory architecture docs, skill catalog update, tag v0.1.0 | ebe89e6 |
| 2026-04-10 | — | Graphify 0.3.27 upgrade, wiki generation, nightly rebuild | cd3c275 |
| 2026-04-10 | quick | Memory stack addon: setup script, templates, docs | [#10](https://github.com/ilsantino/iago-os/pull/10) |

</details>
