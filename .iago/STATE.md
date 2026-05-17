# State — iaGO-OS

> **Phase:** v2-phase-2-vps-bootstrap | **Status:** Phase 2 plan stack written + stress-tested; awaiting Santiago approval before `/iago-execute`. Phase 1 plan stack landed in commit `4ee40ee` (hello-world acceptance gate); Phase 1 awaiting PR merge.
> **Tag:** v0.1.0 | **Updated:** 2026-05-17

## Active

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| 2026-05-17 | plan | Feature plan + stress test for `feature-phase-2-vps-bootstrap` (FAST single-hour cutover: daemon deploy infra + OpenClaw teardown + cutover/rollback orchestration + first-real-workflow PR-triage agent + Phase 2 acceptance gate). L2 stage contract `CONTEXT.md` written per MWP discipline. Plans derive verbatim from `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` (10-section Garry-impressed delivery spec). | 5 plans / ~31 tasks / 3 waves — all 5 stress verdicts PROCEED_WITH_NOTES. Critical findings forwarded inline: runUnder=test override for Phase 1 test compat (P01-C1), credential-value never in telemetry (P01-C2), jq pre-flight + interactive-flag matrix for dry-run + age-header magic-byte check (P02-C1/C2/C3), cutover DRY_RUN flag matrix + quote-escaping via scp temp file + rollback DRY_RUN (P03-C1/C2/C3), Task 1 fork explicit + gh-token CRED_MAP authored in Plan 01 + exact PAT scope (P04-C1/C2/C3), VPS_E2E_NONDISRUPTIVE mode + HTML-comment sentinel + fenced-only path check (P05-C1/C2/C3). |
| 2026-05-15 | plan | Feature plan + stress test for `feature-v2-phase-1-daemon` (Phase 1 daemon skeleton + AgentRuntime interface + registry + Shape 1 PTY Claude adapter + session.jsonl replay + heartbeat + subagent semantics + Telegram approval hello-world). L2 stage contract written first per MWP discipline. | 7 plans / 43 tasks / 4 waves — all 7 stress verdicts PROCEED_WITH_NOTES. Critical findings forwarded inline: AgentMessage shape canon match (P01), Windows rename + orphan claim recovery (P02), lastStatusChangeMs reset + heartbeat double-restart guard (P03), version range >=2.0.0 <3.0.0 (verified claude 2.1.113) + PTYAdapter type (P04), stale socket unlink (P05+P07), per-agent file-bus tagging form + bot/approval wiring (P06), SIGINT spawn leak + startup-cleanup sequence + biome gate (P07). |
| 2026-05-15 | spec | iaGO-OS v2 vision + master prompt amended for Agent Shape Taxonomy + `AgentRuntime` polymorphic interface (5 shapes: PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon); deeper cortextOS adoption (session.jsonl replay, subagent semantics, heartbeat health, full Next.js dashboard); deeper Hermes adoption (MCP rate-limiter full impl, shell-hook router generalized cross-shape, compression threshold full impl); effort total 27-32d → 38-46d. ADR at `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` | (this commit) |
| 2026-05-14 | merge | PR #38 merged — canonical v2 vision lock + Phase 0 audit + scope updates (WhatsApp dropped, multi-LLM via PTY adapter registry) | [#38](https://github.com/ilsantino/iago-os/pull/38) |
| 2026-05-11 | fast | Remove stranded `clients/munet-web-wt-m06/` — leftover full copy of munet-web from 2026-04-28 M06 work (named like a worktree but never registered via `git worktree`); no inner `.git`, not on `git worktree list`; safe deletion | (this commit) |
| 2026-05-10 | fast | Land council-revised v2 munet-web playbook (905 lines) at `.iago/research/munet-web-playbook.md` — rescued from orphan commits 08d68a5/aab3f1e after branches `wip/munet-web-playbook-v2` and `docs/munet-web-playbook` were deleted without record; 2026-05-10 status-pull session also wrote canonical evals for cortextos + agentic-os-dashboard to close a research-rediscovery gap | [#36](https://github.com/ilsantino/iago-os/pull/36) |
| 2026-05-04 | execute | Phase 1 cleanup hygiene shipped — STATE.md discipline rule, branch-prune doc, deferred plans archived, macOS audit (`gsort` prereq + `# GNU-only` annotation), `.iago/state/` README + gitignore pattern | [#31](https://github.com/ilsantino/iago-os/pull/31) merged |
| 2026-04-13 | fast | Add console gate (step 2b) — Playwright runtime error check | ec00081 |
| 2026-04-20 | quick | Real Codex adversarial on Windows via codex-companion | [#18](https://github.com/ilsantino/iago-os/pull/18) |
| 2026-04-20 | fast | Add concurrency guards to claude.yml + claude-review-fix.yml (stop parallel loops) | f47cc2c |
| 2026-04-23 | plan | Feature plan + stress test for `mcp-youtube-transcript` Python MCP | 1 plan / 7 tasks — PROCEED_WITH_NOTES |
| 2026-04-27 | execute | youtube-transcript MCP shipped — Python MCP via youtube-transcript-api, registered globally | [#19](https://github.com/ilsantino/iago-os/pull/19) merged, 33 tests passing |
| 2026-04-27 | plan | Feature plan + stress test for `feature-pipeline-speed-wedges` (5 wedges + measurement protocol) | 6 plans / 41 tasks — first round: 5 PROCEED_WITH_NOTES + 1 BLOCK (plan 03). Revised + re-stress-tested: all 6 PROCEED_WITH_NOTES with critical findings addressed inline. Ready for Path 2 (ship plan 01 first). |
| 2026-04-27 | quick | Codex CLI 0.118→0.125, plugin v1.0.2→v1.0.4, `~/.codex/config.toml` pinned to gpt-5.5; align stale GPT-5.4 refs to config.toml | [#20](https://github.com/ilsantino/iago-os/pull/20) merged |
| 2026-04-27 | execute | Plan 01 (telemetry) shipped — per-stage NDJSON, sentinel-file timeout signal, stage-scoped latch, aggregator | [#22](https://github.com/ilsantino/iago-os/pull/22) merged |
| 2026-04-27 | research | hermes-agent (Nous Research, 120K stars) deep dive + 9-wedge adoption roadmap; CEO chose full adoption over conservative 3-wedge | docs/research/hermes-agent.md + docs/specs/hermes-agent-adoption.md |
| 2026-04-27 | fast | Wedge A: MEMORY.md frozen-snapshot rule — CLAUDE.md paragraph + new feedback memory + council/skill.md exception comment. Wedges B–I queued as `feature-hermes-adoption` plans. | (this commit) |
| 2026-04-27 | fast | Pipeline self-freeze + re-exec — copy scripts/ tree to mktemp, exec from frozen copy; fixes Windows bash byte-offset crash on script self-edit (PR #22 plan 01 run hit this) | [#24](https://github.com/ilsantino/iago-os/pull/24) |
| 2026-04-28 | fast | CLAUDE.md macOS prereq note: `brew install coreutils` for `gtimeout` (Phase 1 item 1, Sebas-on-Mac unblocker) | [#29](https://github.com/ilsantino/iago-os/pull/29) |
| 2026-05-04 | research | 6-repo tool surveillance + pattern mining (agent-browser, Scrapling, kepano/obsidian-skills, notebooklm-skill, agent-skills-context, massgen) + council on 2 architectural tensions | `.iago/research/2026-05-04-*.md` (7 files: 6 per-repo + integration matrix) |
| 2026-05-04 | plan | `feature-tool-surveillance` — 4 plans / 21 tasks across 2 waves. Pattern absorption + selective install + /what-skill recommender. Browser tools deferred until real bottleneck. Auto-dispatch rejected. Slot post-Munet M2. | `docs/specs/feature-tool-surveillance.md` + `.iago/plans/feature-tool-surveillance/01-04` |
| 2026-05-04 | fast | Fix path-concat bug in execute-pipeline.sh — accept absolute --plan (POSIX `/...` and Windows `C:/...`) as-is; prevents `C:/.../C:/.../plan.md` doubling | 2bbf5be |

## Known Issues

| Issue | Severity | Detail |
|-------|----------|--------|
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
