> **⚠️ ORCHESTRATOR VERIFICATION NOTE (2026-05-30) — read before acting on §data-loss.** Two findings were spot-checked against `origin/main`:
> - **/industry-patterns broken (PR #79) — CONFIRMED.** `docs/patterns/` + `.claude/rules/patterns/` have ZERO files on main; `.claude/skills/industry-patterns/SKILL.md:36` still points at dead `docs/patterns/{domain}.md`. Restore from `bc4c978`. ACT ON THIS.
> - **#54/#56/#57 "wrong-base merge, content absent on main" — NOT CONFIRMED / partly contradicted.** Spot-check found `.iago/learnings/README.md` (claimed lost from #57) is PRESENT on main. Do per-PR, file-by-file verification BEFORE any re-merge; do NOT blindly open 3 recovery PRs.# Plan-State & Reorg Audit — iago-os (2026-05-30)

_Authoritative synthesis. Source: 5 track-auditor sweeps + independent re-verification against origin/main, gh PR state, and on-disk files. Where the auditors and ground truth disagreed, this doc records the verified truth._

> **Reorg discipline:** This doc PROPOSES reorg actions only. No plan files were moved or archived in writing it. The orchestrator executes after Santiago reviews.

---

## 0. Where The Hell We Stand (executive summary)

Two parallel tracks. One is a high-functioning machine; the other is stalled at a single chokepoint. Three silent data-loss bugs hide behind a green "all merged" PR list.

### Track 1 — feature-v2 (the multi-agent daemon/OS)

- **SHIPPED (on main, verified):** Phase 0 (VPS audit), Phase 0.5 (orphan cleanup), Phase 1 (the full 7-plan daemon skeleton — runtime/, file-bus, agent-manager, PTY-claude adapter, IPC, Telegram approval, hello-world acceptance gate). Phase 1's deferred-hardening + phase-1b punch-list are **mostly** landed (see data-loss caveat below).
- **CURRENT / IN-PROGRESS:** **Phase 2 — VPS bootstrap (FAST cutover + first-real-workflow PR-triage agent).** ~87% shipped: 13 of 15 plans merged (deploy unit, credential bootstrap, OpenClaw archive, cutover/rollback scripts + runbooks, cron scheduler, polling loop, SIGHUP reload, PR-triage artifacts/wiring/dispatch). Two things left: **(a)** Plan 04c (pr-triage integration test) + the gap-closure plan are bundled in **open PR #84** (MERGEABLE, pre-merge adversarial running); **(b)** Plans **05a + 05b** (Phase-2 evidence template + checker + opt-in e2e) are **genuinely not started** — no PR, no branch, deliverables absent on main.
- **NEXT:** merge #84 after the gate clears → execute 05a→05b → run /iago-verify against the 8-criterion Phase-2 acceptance gate. Production cutover itself is a human-triggered step (Santiago at the keyboard).
- **PLANNED-ONLY (Phase 3+):** the 5 cortextOS scaffolds in **open PR #85** (docs-only) — agent-comms, supervisor/chief role, Shape-2/LangChain, dashboard tabs, per-agent bots. Zero code, all gated behind a Santiago re-lock.
- **"You are here":** _Phase 2 is the finish line of the first real workflow; one open PR (#84) and one unstarted plan-pair (05a/05b) stand between us and a verified Phase 2._

### Track 2 — mwp-restructure (the repo reorganization)

- **docs sub-track:** 2 of 4 plans shipped (Plan 01 CLAUDE.md trim #77; Plan 02 docs/ consolidation #79). **Plans 03 (ROADMAP.md + PROJECT.md) and 04 (runtime/CLAUDE.md + Level-B registry) never ran.**
- **clients sub-track:** 0 of 5 shipped. Plan 01 (registry) is HARD-BLOCKED on docs/04. Plans 02–05 (din/fulldata/palazuelos/rsf shells) are independent and dispatchable once authorized.
- **code sub-track:** 0 of 3 shipped. All blocked on docs/03 + docs/04 + clients/01. Plan 02 (scripts restructure) premise is partly obsolete (pipeline is now harness-native JS, PR #83).
- **"You are here":** _Stalled at one chokepoint — docs Plan 03/04 never ran, and EVERY remaining plan depends on them. Plus a shipped-but-broken bug: PR #79's squash dropped all 8 industry-pattern files AND the skill repoint, so /industry-patterns is broken on main today._

### The three silent data-loss bugs (NOT in the "all merged" green list)

1. **PRs #54, #56, #57 merged to the WRONG BASE.** During the 2026-05-18 stacked B/C dispatch, each was squash-merged into its **parent feature branch** instead of main. gh reports them MERGED, but their content **never reached main**. Verified: `baseRefName` = sibling branch (not main), merge commits are not ancestors of origin/main, named files absent on main, present only on the still-existing orphan branches.
2. **PR #79 squash dropped 8 industry-pattern files + the skill repoint.** On main, `docs/patterns/` is gone, `.claude/rules/patterns/` is empty, and `SKILL.md` still points at the dead `docs/patterns/{domain}.md` → `/industry-patterns` STOPs with "Pattern file not found" for every domain. Recoverable from commit **bc4c978** (which has all 8 files at `.claude/rules/patterns/` AND the correct skill pointer).
3. **STATE.md drift:** lead-hunt folder empty but STATE claims 2 stressed plans; PR #85 STATE row says "4 new CONTEXTs" but ships 5; Phase-2 merge rows missing for #60–#65/#67/#74/#76/#80.

---

## 1. feature-v2 Phase-by-Phase Status (vision Phase 0 → 12)

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| **0** | VPS read-only audit | **SHIPPED** | PR #38; `runtime/migration/00-vps-audit.md` on main; STATE 2026-05-14 |
| **0.5** | Orphan cleanup (stop iaguito-hq + pulsara, ufw) | **SHIPPED** | commit 6bcbbac (VPS-side); audit doc "Orphan processes — CLEANED 2026-05-15"; no code-on-disk (server-state change) |
| **1** | Daemon skeleton (runtime+registry+Shape1 PTY claude+session-replay+heartbeat+subagent+telegram-approval+hello-world) | **SHIPPED** | PRs #40–#46; every named `runtime/` file present on main; `runtime/PHASE-1-EVIDENCE.md` on main |
| **1 (hardening)** | deferred-hardening 01–05 | **~60% LANDED** | #49 (ipc-hardening) + #50 (atomic-rename) + #51 (main coverage) + #53 (bot coverage) on main; **#54 (pr40-deferred) + #56 (minor-sweep) NOT on main — wrong-base merge** |
| **1b** | May-12 punch-list (telemetry sessionId, clean-tree guard, integration harness) | **~67% LANDED** | #52 (telemetry sessionId) + #55 (clean-tree guard) on main; **#57 (integration harness + .iago/learnings/README.md) NOT on main — wrong-base merge** |
| **2** | VPS install alongside OpenClaw (FAST cutover + PR-triage agent) | **CURRENT — ~87% SHIPPED** | 13/15 merged (#60–#68,#72–#76,#80). Open: 04c + gap-closure in **PR #84**. NOT STARTED: **05a, 05b** (evidence template/checker/e2e — absent on main) |
| **3** | Shape expansion (codex/gemini/opencode PTY + anthropic/openai SDK + hermes-mcp + cortextOS comms) | **PLANNING-ONLY** | 5 CONTEXT scaffolds in **open PR #85** (docs-only); zero NN-*.md, zero code |
| **4** | wedge-J shell-hooks | **NOT STARTED** | no plan folder |
| **5** | wedge-B distiller + Hermes-deeper | **NOT STARTED** | no plan folder |
| **6** | Full Next.js dashboard | **PLANNING-ONLY (increment)** | `feature-v2-dashboard-comms-kanban-tabs` CONTEXT in PR #85 scopes the comms/board/workflows tabs as a Phase-6 increment; main dashboard build not planned |
| **7** | OpenClaw cutover | **NOT STARTED** (artifacts ready) | cutover/rollback scripts + runbooks shipped (#68/#72); execution is human-triggered |
| **8** | Cost-ledger SQLite | **NOT STARTED** | named in vision/memory as 6th layer; no plan |
| **9** | Webhook + Shape4 | **NOT STARTED** | — |
| **10** | Auto-PR loop | **NOT STARTED** | — |
| **11** | Email + Shape5 | **NOT STARTED** | — |
| **12** | Learning-loop | **NOT STARTED** | — |

---

## 2. mwp-restructure Sub-Track Status

| Sub-track | Plan | Status | Evidence |
|---|---|---|---|
| **docs** | 01-claude-md-trim | **SHIPPED** | PR #77; CLAUDE.md=70 lines; rules extracted; (no summary file, code proves it) |
| **docs** | 02-docs-folder-consolidation | **SHIPPED (PARTIAL + DATA LOSS)** | PR #79; archive/runbooks moves landed; **8 pattern files + skill repoint LOST in squash** → `/industry-patterns` broken on main |
| **docs** | 03-roadmap-and-project-md | **NOT STARTED — KEYSTONE BLOCKER** | `.iago/ROADMAP.md` + `.iago/PROJECT.md` absent on main; no branch/summary |
| **docs** | 04-runtime-claude-md | **NOT STARTED — KEYSTONE BLOCKER** | `runtime/CLAUDE.md` + `mcp-servers/CLAUDE.md` absent; `## Level B sub-workspaces` section count = 0 in CONTEXT.md |
| **clients** | 01-register-clients-in-root-context | **BLOCKED** | depends_on docs/04 (never ran); registry section absent |
| **clients** | 02-din-shell / 03-fulldata / 04-palazuelos / 05-rsf | **NOT STARTED** | all `clients/{name}/CLAUDE.md`+`CONTEXT.md` absent; wave-1, no external dep, dispatchable once authorized |
| **code** | 01-iago-physical-split | **BLOCKED** | depends_on docs/03 + clients/01; `.iago/hooks`/`plans` unmoved; `.iago/product` absent |
| **code** | 02-scripts-restructure | **BLOCKED + SUPERSEDED-RISK** | depends_on 01; premise (reshape around bash execute-pipeline.sh) partly obsolete vs harness-native JS (PR #83) |
| **code** | 03-cleanup-final | **BLOCKED** | depends_on 01+02; `graphify-out/` orphan still present (cleanup still needed) |

---

## 3. Full Per-Plan Status Table (all tracks)

| Folder | Plan | Status | PR | Note |
|---|---|---|---|---|
| feature-v2-foundation | 01-vps-audit | merged-shipped | #38 | Phase 0 |
| feature-v2-foundation | 02-orphan-cleanup | merged-shipped | 6bcbbac | Phase 0.5, VPS-side |
| feature-v2-phase-1-daemon | 01-runtime-skeleton | merged-shipped | #40 | |
| feature-v2-phase-1-daemon | 02-file-bus-session-log | merged-shipped | #41 | |
| feature-v2-phase-1-daemon | 03-agent-manager-heartbeat | merged-shipped | #42 | |
| feature-v2-phase-1-daemon | 04-shape1-pty-claude | merged-shipped | #43 | no standalone summary (non-blocking) |
| feature-v2-phase-1-daemon | 05-ipc-server-telemetry | merged-shipped | #44 | |
| feature-v2-phase-1-daemon | 06-telegram-approval | merged-shipped | #45 | |
| feature-v2-phase-1-daemon | 07-hello-world-rollback | merged-shipped | #46 | PHASE-1-EVIDENCE on main |
| feature-phase-1-deferred-hardening | 01-ipc-server-hardening | merged-shipped | #49 | ancestor of main |
| feature-phase-1-deferred-hardening | 02-atomic-rename-audit | merged-shipped | #50 | |
| feature-phase-1-deferred-hardening | 03-coverage-pass-main | merged-shipped | #51 | split mid-exec |
| feature-phase-1-deferred-hardening | 03b-coverage-pass-bot | merged-shipped | #53 | split child, correctly landed |
| feature-phase-1-deferred-hardening | **04-pr40-deferred-items** | **ORPHAN (wrong-base)** | **#54** | base=feat/b-03b-bot-coverage; NOT on main; biome.json + adapter-isolation test + InterfaceVersion + deep-freeze lost |
| feature-phase-1-deferred-hardening | **05-minor-and-forward-sweep** | **ORPHAN (wrong-base)** | **#56** | base=feat/b-04-pr40-deferred; NOT on main |
| feature-phase-1b-pipeline-tooling | 01-telemetry-session-id | merged-shipped | #52 | |
| feature-phase-1b-pipeline-tooling | 02-clean-tree-guard | merged-shipped | #55 | |
| feature-phase-1b-pipeline-tooling | **03-integration-harness** | **ORPHAN (wrong-base)** | **#57** | base=feat/c-02-clean-tree-guard; NOT on main; test-phase-1b-integration.sh + .iago/learnings/README.md lost |
| feature-phase-2-vps-bootstrap | 01a-deploy-unit | merged-shipped | #62 | |
| feature-phase-2-vps-bootstrap | 01b-cred-bootstrap | merged-shipped | #65 | |
| feature-phase-2-vps-bootstrap | 02a-archive-openclaw | merged-shipped | #60 | |
| feature-phase-2-vps-bootstrap | 02b-whatsapp-telegram-runbooks | merged-shipped | #63 | |
| feature-phase-2-vps-bootstrap | 03a-cutover-rollback-exec | merged-shipped | #68 | 23/23 tests |
| feature-phase-2-vps-bootstrap | 03b-cutover-rollback-runbooks | merged-shipped | #72 | no summary (hand-finished) |
| feature-phase-2-vps-bootstrap | 04a-pr-triage-artifacts | merged-shipped | #67 | |
| feature-phase-2-vps-bootstrap | 04b-pr-triage-wiring | merged-shipped | #76 | no summary; 1st dispatch failed |
| feature-phase-2-vps-bootstrap | **04c-pr-triage-integration-test** | **in-pr-open** | **#84** | pr-triage.test.ts on branch |
| feature-phase-2-vps-bootstrap | 04d-pr-triage-dispatch-handler | merged-shipped | #80 | |
| feature-phase-2-vps-bootstrap | **05a-evidence-template** | **planned-not-started** | none | PHASE-2-EVIDENCE absent on main |
| feature-phase-2-vps-bootstrap | **05b-evidence-checker-e2e** | **planned-not-started** | none | check-evidence.mjs on main is from #46, NOT 05b; 05b deliverables absent |
| feature-phase-2-vps-bootstrap | 06-sighup-credential-reload | merged-shipped | #74 | |
| feature-phase-2-vps-bootstrap | 07a-cron-scheduler | merged-shipped | #61 | |
| feature-phase-2-vps-bootstrap | 07b-agent-manager-polling | merged-shipped | #64 | |
| feature-pr84-gap-closure | 01-close-green-locked-gaps | **executed-unmerged** | **#84** | plan+summary on branch feat/pr-triage-integration-test (verified); rides PR #84 in place |
| feature-v2-agent-comms-channel | CONTEXT only | planned-not-started | #85 | Phase 3.5 |
| feature-v2-supervisor-role | CONTEXT only | planned-not-started | #85 | Phase 3 |
| feature-v2-shape2-langchain-home | CONTEXT only | planned-not-started | #85 | Phase 3; dangling sibling ref |
| feature-v2-dashboard-comms-kanban-tabs | CONTEXT only | planned-not-started | #85 | Phase 6 increment |
| feature-v2-per-agent-bots | CONTEXT only | planned-not-started | #85 | Phase 3; hard-locked by ADR 2026-05-30 |
| feature-mwp-restructure-docs | 01-claude-md-trim | merged-shipped | #77 | |
| feature-mwp-restructure-docs | 02-docs-folder-consolidation | **merged-shipped (DATA LOSS)** | #79 | 8 pattern files + skill repoint lost |
| feature-mwp-restructure-docs | 03-roadmap-and-project-md | **planned-not-started (KEYSTONE)** | none | ROADMAP.md/PROJECT.md never created |
| feature-mwp-restructure-docs | 04-runtime-claude-md | **planned-not-started (KEYSTONE)** | none | Level-B registry never created |
| feature-mwp-restructure-clients | 01-register-clients | **blocked** | none | depends_on docs/04 |
| feature-mwp-restructure-clients | 02-din / 03-fulldata / 04-palazuelos / 05-rsf | planned-not-started | none | wave-1 independent |
| feature-mwp-restructure-code | 01-iago-physical-split | **blocked** | none | depends_on docs/03 + clients/01 |
| feature-mwp-restructure-code | 02-scripts-restructure | **blocked + superseded-risk** | none | bash-pipeline premise partly obsolete |
| feature-mwp-restructure-code | 03-cleanup-final | **blocked** | none | graphify-out/ orphan still present |
| feature-audit | audit-02..06 | merged-shipped | #12–#15 | audit-05/06 via #15 |
| feature-pipeline-speed-wedges | 01-measurement / 06-parallel-build | merged-shipped | #22 / #26 | |
| feature-pipeline-speed-wedges/_archive | 02–05 wedges | superseded | — | correctly archived |
| feature-tool-surveillance | 01-patterns-core | executed-unmerged | #30/#32 | 6/8 tasks; Task 6 (pipeline restart) unshipped |
| feature-tool-surveillance | 02-source-grounded / 03-obsidian-skills | planned-not-started | none | zero artifacts |
| feature-tool-surveillance | 04-what-skill | orphan | none | consumer skill never built; dep shipped |
| codex | quick-260420-companion-windows / quick-260428-stage4-liveness | merged-shipped | #18 / #27 | |
| feature-iago-os-cleanup | 01-cleanup-hygiene | merged-shipped | #31 | |
| feature-wedge-c-routines | 01-routines-bind-viability | merged-shipped | #37 | BIND-NOT-VIABLE decision |
| feature-youtube-transcript-mcp | 01-mcp-server | merged-shipped | #19 | 33 tests |
| feature-lead-hunt-scrapling | (empty) | orphan | none | empty folder; STATE claims 2 plans; skill shipped globally |

---

## 4. Consolidated Reorg Actions (de-duplicated, ordered by priority)

### P0 — Data-loss recovery (do FIRST, before any new work)

1. **Re-merge 3 orphaned-base PRs onto main.** Open 3 fresh PRs targeting main (or cherry-pick) from the still-existing orphan branches:
   - `origin/feat/b-04-pr40-deferred` (#54): runtime/biome.json, adapter-isolation.test.ts + fake-good-adapter fixture, InterfaceVersion centralization, registry deep-freeze, _resetRegistryForTests prod-guard
   - `origin/feat/b-05-minor-sweep` (#56): minor+forward sweep edits across agent-manager/markers/session-log/commands + PHASE-1-EVIDENCE coverage table
   - `origin/feat/c-03-integration-harness-and-aggregator-projection` (#57): scripts/test-phase-1b-integration.sh, .iago/learnings/README.md, metrics-aggregate sessionId projection
   - **MUST land before Phase-2 cutover relies on the ≥80% coverage floor + biome config.** Also fixes the still-unfixed sub-project format-hook drift on main.

2. **Restore the 8 industry-pattern files + skill repoint.** `/iago-fast`: `git checkout bc4c978 -- .claude/rules/patterns/ .claude/skills/industry-patterns/SKILL.md` then commit. This single source has all 8 files (carrier/customs/energy/inventory/logistics/production/quality/returns) AND the correct `.claude/rules/patterns/{domain}.md` pointer. **Note (correction to track-4 auditor): the recovery commit is bc4c978 (or 662c4ac), NOT 358fb10 — the files do not exist at 358fb10.** On main the skill still points at the deleted `docs/patterns/` AND that dir is gone, so `/industry-patterns` is fully broken today.

### P1 — Unblock the mwp chokepoint

3. **Execute docs Plan 03** (ROADMAP.md + PROJECT.md + docs/specs migration) via /iago-execute. Deps (01, 02) merged. Closes the repo-wide "no ROADMAP/PROJECT" gap.
4. **Execute docs Plan 04** (runtime/CLAUDE.md + `## Level B sub-workspaces` registry) right after. Unblocks clients/01 and code/01.

### P2 — Fix in-PR doc-drift (before #85 merges)

5. **Fix shape2 dangling sibling:** `feature-v2-shape2-langchain-home/CONTEXT.md` lines 6 + 55 reference `feature-v2-codex-cohabitation/CONTEXT.md`, which does not exist anywhere. Either create that codex/gemini-pty Shape-1 expansion CONTEXT (named as a Phase-3 co-shipping sibling) or remove/correct the dead pointer. Fix inside PR #85.
6. **Fix STATE.md undercount in PR #85:** the 2026-05-30 row says "4 new plan-stack CONTEXTs" and lists 4 — but 5 shipped (omits `feature-v2-per-agent-bots`). Update count to 5 and add per-agent-bots. Fix inside PR #85.
7. **Refresh STATE.md Status line + backfill Phase-2 merge rows:** Status line still lists 04b and 06 under "Remaining" though both merged (#76, #74); Active table missing rows for #60–#65/#67/#74/#76/#80. Correct Remaining to "05a/05b evidence + close PR #84 (04c + gap-closure)".

### P3 — Mark-superseded / cleanup (low risk, prevents future false-green)

8. **mark-superseded** header on `feature-mwp-restructure-code/02-scripts-restructure.md` → point at PR #83 / project_pipeline_v2; re-stress-test before execution.
9. **mark-superseded** headers on `feature-tool-surveillance/02,03,04` (never executed, repo focus shifted to v2 post-2026-05-13) and document inline that `01-patterns-core` Task 6 (pipeline new_answer/restart_on_critical) was never shipped (grep=0).
10. **mark-superseded** one-liner on `feature-audit/audit-06-codex-windows.md` → superseded-in-approach by #18 (codex-companion.mjs).
11. **delete** empty leftover dir `feature-pipeline-speed-wedges/_deferred/`.
12. **delete + STATE correction** for empty `feature-lead-hunt-scrapling/` (skill shipped globally outside repo; STATE/disk drift).
13. **DO NOT archive** `feature-phase-1b-pipeline-tooling/` or `feature-phase-1-deferred-hardening/` until the P0 re-merge lands — premature archival buries the orphaned-merge debt.
14. **DO NOT delete** orphan branches (b-04, b-05, c-03 + their parent chain) until P0 re-merge verified on main — they hold the only copy of the orphaned content.

### Backlog (after PR #85 merges + Santiago re-lock)

15. **create** NN-*.md plan stacks in each of the 5 Phase-3 CONTEXT folders via /iago-plan (gated per CONTEXT Process steps).
16. **backfill** `.iago/summaries/04c-pr-triage-integration-test.md` after PR #84 merges.
17. **create** 3-line CONTEXT.md in each retained SIDE/LEGACY folder (audit, wedges, codex, cleanup, wedge-c, youtube-mcp) for navigability.

---

## 5. PR #85 Correctness Verdict

**PR #85 is CORRECT to keep/commit — with 2 trivial doc fixes before merge.**

The 5 scaffolds are coherent with the LOCKED 2026-05-30 decision and correctly slotted:

| Folder | Locked-decision coherence | Phase slot | Verdict |
|---|---|---|---|
| feature-v2-per-agent-bots | Matches ADR exactly: per-agent bots for STANDING agents + ONE chief bot for EPHEMERAL + private-DM gate stays closed; generalizes the built one-bot `runtime/telegram/` to N pollers | Phase 3 (rides shape expansion) | ✅ |
| feature-v2-supervisor-role | Chief = `role:"chief"` flag, not a new shape; daemon-gated dispatch; no Paperclip org-chart | Phase 3 | ✅ |
| feature-v2-agent-comms-channel | File-bus envelope `{v,kind,from,to,body,threadId,seq,...}` + chief-as-blocker; NO broker/pub-sub/Postgres | Phase 3.5 | ✅ |
| feature-v2-shape2-langchain-home | Shape-2 HTTP/SDK adapters + LangGraph host (Santiago's "i want langchain"); http/ dir correctly does not exist yet | Phase 3 | ✅ (1 dead sibling ref) |
| feature-v2-dashboard-comms-kanban-tabs | Read-only Comms/Board/Workflows tabs; explicitly scoped as Phase-6 increment, not a new phase; depends on comms NDJSON | Phase 6 increment | ✅ |

Decision basis verified on disk: ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md` (ACCEPTED, LOCKED), research §5.2 REVERSED + §10 council, vision + master-prompt amendments. All CONTEXTs gate execution behind a Santiago re-lock — none can /iago-execute prematurely. Proposed-new code (runtime/agent-runtime/http/, runtime/daemon/peer-bus.ts, apps/dashboard/) correctly absent; reuse targets all present.

**Two must-fix-before-merge defects (both inside PR #85):** (a) shape2 CONTEXT dangling sibling `feature-v2-codex-cohabitation` (doesn't exist); (b) STATE.md "4 new CONTEXTs" should read "5" + add per-agent-bots. Neither affects the decision; both are doc hygiene.

---

## 6. Ordered Next Actions (both tracks)

1. **P0a — Recover orphaned-base content.** Open 3 fresh PRs to main from orphan branches b-04 (#54) / b-05 (#56) / c-03 (#57). Verify on main, THEN prune branches.
2. **P0b — Restore industry-patterns.** `/iago-fast`: `git checkout bc4c978 -- .claude/rules/patterns/ .claude/skills/industry-patterns/SKILL.md`; commit. Unbreaks `/industry-patterns`.
3. **Close Phase 2 — PR #84.** Let the pre-merge adversarial gate finish, then human merge (Claude must NOT merge). Backfill the 04c summary.
4. **Fix + land PR #85** (after the 2 doc fixes). Then Santiago re-locks the Phase-3 anti-scope.
5. **Finish Phase 2 — 05a → 05b.** /iago-execute the evidence template then checker+e2e (re-stress-test 05b first to confirm whether check-evidence.mjs needs extension vs a net-new file — it already exists from #46). Then /iago-verify Phase 2 against the 8-criterion gate.
6. **Unblock mwp — docs Plan 03 → docs Plan 04.** Creates ROADMAP.md + PROJECT.md + the Level-B registry. Then clients (02–05 dispatchable; 01 after docs/04), then code (re-stress 02 vs JS pipeline first).
7. **Phase 3 planning.** Once PR #85 is in + re-locked: /iago-plan each of the 5 CONTEXT folders to generate NN-*.md stacks (gated per CONTEXT; per-agent-bots already hard-locked).
8. **Housekeeping (P3 actions 8–14).** Mark-superseded headers, delete empty dirs, refresh STATE.md.

> Where PR #84 fits: the Phase-2 finish line (first real workflow) — merge unblocks 05a/05b.
> Where PR #85 fits: Phase-3 on-ramp (planning only) — merge + re-lock unblocks /iago-plan on the 5 stacks. Independent of #84; can land in either order.
