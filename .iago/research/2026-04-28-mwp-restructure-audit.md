# iago-os MWP Restructure Audit (Revised)

> **Original date:** 2026-04-28 | **Revised:** 2026-04-29 (post-self-validation + stress-test)
> **Author:** Claude Code (research session, opus 4.7)
> **Status:** Inputs cross-validated against repo state. Stress-tested against in-flight Phase 0.3 council-roadmap. Ready for council validation.
> **Hard constraints respected:** No pipeline restructure, no Munet content touches, no iago-os ↔ iago-workspaces absorption, STATE.md cap, Sebas-coordination flagged.

This audit asks: should iago-os adopt MWP discipline (Eduba's 3-layer folder system: map → rooms → tools), how, and how to coordinate with the Phase 0.3 wedge-roadmap that shipped 2026-04-28.

**Headline post-stress-test verdict:** Run MWP restructure as **parallel/sequenced track** to the council-roadmap, not folded into its Phase 1 cleanup. The council-roadmap's mess list (Codex cwd, FAIL-regex, macOS timeout, plans-folder, STATE.md, branch hygiene, embedded-git, log artifacts) does not overlap MWP's #1 lever (root CLAUDE.md trim + per-client CLAUDE.md skeletonization + decision tree). Different fires, different remedies.

---

## 1. Current-State Audit

### 1.1 Top-level structure

Root files (8): `CLAUDE.md` (12.8KB / **209 lines**), `CLAUDE.md.backup` (9KB / 168 lines orphan from 2026-04-09), `CLAUDE.local.md.template`, `README.md` (27KB / 547 lines, GitHub-rendered external doc), `package.json`, `package-lock.json`, `.gitattributes` (4 lines, missing `*.mjs`), `.gitignore`.

Root dirs (12): `.claude/`, `.git/`, `.github/`, `.iago/`, `clients/`, `docs/`, `graphify-out/` (auto), `mcp-servers/`, `n8n/`, `node_modules/` (gitignored), `scripts/`, `templates/`.

Stray top-level `.md` count: 0. Good signal — nothing leaked into root.

### 1.2 Inventory

| Dir | Contents | Status |
|---|---|---|
| `clients/` | 3 entries: `munet-web/`, `sentria/`, `fulldata/` | All ACTIVE, two distinct engagement modes (see below) |
| `clients/munet-web/` | Code-delivery engagement. `.iago/` populated (M1/M2/M3 shipped + restructure-playbook in flight). Active CLAUDE.md (84 lines). | HOT |
| `clients/sentria/` | Code-delivery engagement. CLAUDE.md exists (~80 lines). **NO `.iago/` directory** — no iaGO workflow scaffolding. | HOT but unscaffolded |
| `clients/fulldata/` | **Research-deliverable engagement** (not dormant). 3 PDFs at root + `research/` containing 9 strategic-analysis docs in Spanish (data-fintech, scaling-logistics, ERP expansion, market analysis, `fulldata_estrategia_v2.pptx`). No code, no `.iago/`, no CLAUDE.md. | ACTIVE research deliverable |
| `docs/` | 8 root files + `archive/` (37 stale decision docs) + `automations/` + `patterns/` (8 industry) + `research/` + `specs/` | Active + heavy archive tail |
| `.iago/` | `plans/`, `summaries/`, `reviews/`, `context/` (EMPTY — only `.gitkeep`), `runbooks/` (1 file), `state/`, `hooks/`, `learnings/` (nearly empty), `prompts/` (uncommitted), `research/` (7 files: `_summary.md`, `team-{1-5}-*.md`, `codex-stall-diagnosis-2026-04-28.md` — all from Phase 0.3 council cycle) | Several rooms underused or empty; `research/` is hot |
| `.claude/` | `rules/` (10 files), `agents/{capabilities,profiles}/`, `skills/` (37+) | Mature, well-routed |
| `scripts/` | `execute-pipeline.sh`, `lib/`, `review-checks/`, sync/setup/scaffold utilities, telemetry | Pipeline-critical separated from utilities |
| `templates/` | `client-project/`, `internal-project/`, `memory/` | Used by `new-client.sh` |
| `mcp-servers/` | youtube-transcript MCP source | Active |
| `n8n/` | automation source | Last touched 2026-04-17 |
| `graphify-out/` | Auto-generated wiki + graph.json from obsidian-brain rebuild | Auto |

### 1.3 Hot spots of disorganization

1. **Root `CLAUDE.md` is 209 lines.** Eduba's MWP target: 60-150. ICM paper target: ~800 tokens (~600 words). Currently holds: stack rules + code standards + workflow phases + execution pipeline rules + memory architecture + skills catalog + agents catalog + model routing + output style rules. Multiple "rooms" worth of content collapsed into the map. **#1 lever.** dev.to/anvodev documented adherence-decay at 47k words; 209 lines is below that but still over the documented ~150-line ceiling.

2. **`CLAUDE.md.backup` at root.** 2026-04-09 orphan, never cleaned. Trivially deletable.

3. **5 uncommitted `docs/` files** with unclear destinations:
   - `docs/memory-system-setup.md` — looks like a runbook, not project docs
   - `docs/research/frontend-design-skills.md` — iago-os research, fits where it is
   - `docs/research/munet-web-playbook.md` — **wrong workspace**: client research belongs in `clients/munet-web/.iago/research/` per MEMORY pointer (`project_munet_playbook.md` already documents this drift)
   - `docs/specs/iago-os-roadmap.md` — **NOT just an uncommitted product spec**: it is the Phase 0.3 council canonical roadmap shipped 2026-04-28, governing wedges A-N. Cited by 5 other artifacts. Do not move blindly. (See §1.7.)
   - `docs/specs/iago-os-vision.md` — **same as above**: Phase 0.2 brainstorming output from 2026-04-28. Live artifact in current cycle.

4. **3 stale orphans in `clients/munet-web/` root** — actively contradicted by current state:
   - `MUNET-HANDOFF.md` (2.3KB, dated 2026-04-07) references plans 02b–04b. Real state: M1/M2/M3 shipped, restructure-playbook feature-roles plans 1+2 merged 2026-04-28. Stale.
   - `SCOPE.md` (8.2KB) references OpenPay migration. `clients/munet-web/.iago/PROJECT.md` line 47 explicitly says: *"SCOPE.md reference to OpenPay is outdated — ignore it"*. Doc explicitly contradicts itself.
   - `ASSET_INTEGRATION_PLAN.md` (11.5KB) — one-shot asset-scrape integration brief. Never moved into `.iago/plans/` after consumption.

5. **Multiple "research / spec / plan" candidates with overlapping mandate:** `docs/research/`, `docs/specs/`, `.iago/plans/`, `.iago/research/`, `.iago/runbooks/`. Routing for new artifacts is unclear — exactly the symptom Santiago named ("sessions don't know where to put new artifacts").

6. **`.iago/context/` is empty** (only `.gitkeep`). Per CLAUDE.md it's the discuss-phase artifact location, but nothing has landed since post-audit phase started. Underused room.

7. **`.iago/runbooks/` has 1 file** (`build-gate-memory-pressure.md`). Other runbook-shaped artifacts (memory-system-setup, codex-companion-windows, sebas-mac-timeout) live in `docs/` or as MEMORY entries instead.

8. **`.iago/learnings/patterns.md` and `project-conventions.md` are nearly empty.** The pattern-promotion rule (5+ occurrences → CLAUDE.md candidate) cannot fire if patterns aren't being recorded. Feedback loop is dormant.

9. **Per-client `CLAUDE.md` files lack routing tables.** `clients/munet-web/CLAUDE.md` (84 lines) is architecture description + CI review boilerplate. `clients/sentria/CLAUDE.md` (~80 lines) same shape. Neither has "task → go to → read" routing structure (Eduba mistake 2). Both duplicate root-level concerns (TypeScript strict, code conventions).

10. **No client-level `CONTEXT.md`** (Eduba's "rooms" pattern). `clients/munet-web/.iago/PROJECT.md` exists but is buried 2 levels deep — Claude Code loads it only when something inside `.iago/` is touched.

11. **`docs/archive/`** holds 37 historical decision docs. Question: necessary fossil record or pruneable cruft?

12. **`.gitattributes` missing `*.mjs text eol=lf`.** Repo runs `.mjs` hooks (`commit-quality.mjs`, `config-protection.mjs`, `context-persistence.mjs`, `codex-companion.mjs`). Cross-platform LF/CRLF risk between Santiago (Windows) and Sebas (Mac).

### 1.4 What's working (do not fix)

- `.claude/` is gold-standard. Path-scoped rules, capability+profile composition, 37+ skills with discovery descriptions.
- `scripts/` is purpose-driven. Pipeline-critical (`execute-pipeline.sh`, `lib/`, `review-checks/`) clearly separated from utilities (sync/setup/scaffold). Self-freeze pattern is battle-tested.
- `.iago/hooks/` is active machinery — clean lifecycle model.
- `clients/munet-web/.iago/` is the cleanest organized subtree in the repo: M1/M2/M3/feature-* groupings, plans/ + summaries/ split, PROJECT.md at workspace root.
- Per-client CLAUDE.md files **already exist** for Munet and Sentria. The boundary is in the right place — content just needs trimming.

### 1.5 Hot vs dormant zones

| Zone | Status | Evidence |
|---|---|---|
| `scripts/` | HOT — pipeline wedges 01-06, telemetry, codex companion fixes | feat/wedge-06 active branch; council-roadmap Wave 1+2 imminent |
| `.claude/skills/`, `.claude/rules/`, `.claude/agents/` | HOT | Multiple new skills (council, hermes adoption queued), rule updates |
| `mcp-servers/` | HOT | youtube-transcript MCP shipped 2026-04-27 |
| `CLAUDE.md` | WARM | Compressed Apr 8, frozen-snapshot rule added Apr 27 |
| `clients/munet-web/.iago/` | **VERY HOT** | feature-roles plans 1+2 merged 2026-04-28 (PRs #75 + #76); blocked on AuthGuard.test.tsx hotfix; transition to feature-incidents next |
| `clients/sentria/` | HOT (no `.iago/` yet) | Active codebase touched Apr 27-28 |
| `clients/fulldata/research/` | WARM | 9 strategic-analysis docs, recent additions |
| `docs/specs/`, `docs/research/` | WARM | Active uncommitted artifacts (council-roadmap, vision, playbook) |
| `.iago/research/` | HOT | 7 council-cycle artifacts |
| `docs/archive/`, `docs/patterns/`, `docs/automations/`, `templates/`, `n8n/` | DORMANT | No commits in 50-commit window |

**Implication for migration:** dormant zones are zero-coordination Phase 1 candidates. Hot zones (`scripts/`, `.claude/`, active client `.iago/`, `docs/specs/`) are Phase 2+ — touching them mid-flight risks breaking active wedge work and council-roadmap cycle.

### 1.6 Eduba 7-mistakes check

| # | Mistake | Status | Evidence |
|---|---|---|---|
| 1 | CLAUDE.md too long | **GUILTY** | Root 209 lines vs 60-150 target |
| 2 | Skipping routing table | **PARTIAL** | Root has skills + rules tables; per-client files have NONE |
| 3 | Too many workspaces | **OK at top level** (4 workspaces is right for the size); **GUILTY at sub-workspace** | `docs/research`, `docs/specs`, `.iago/plans`, `.iago/research`, `.iago/runbooks` overlap mandate |
| 4 | AI-personality vs work in CONTEXT | OK | CLAUDE.md is ~80% work content |
| 5 | Never updating context | OK-ish | STATE.md cadence reasonable |
| 6 | Flat dump | NO | Hierarchical, labeled |
| 7 | Built before using | NO | Heavily iterated |

Score: 1 hard violation (mistake 1), 2 partial (2, 3). Mistake 1 is the dominant lever.

### 1.7 In-flight work this audit must coordinate with

This audit cannot assume greenfield. **A Phase 0.3 council cycle shipped on 2026-04-28 (same day as audit prompt was written) and is governing iago-os next 6 weeks.**

| Artifact | Path | Status | Audit-coordination implication |
|---|---|---|---|
| Phase 0.2 vision spec | `docs/specs/iago-os-vision.md` | Live brainstorming artifact | Do NOT move/merge. Council-roadmap supersedes Hermes adoption spec by name; vision spec is the brainstorm record. |
| Phase 0.3 canonical roadmap | `docs/specs/iago-os-roadmap.md` | Live council verdict | Governs wedges A-N + Phase 1 cleanup mess list + Wave 1/2/3 sequencing. Do NOT move. Cited by 5 other artifacts. |
| Phase 0.1 research artifacts | `.iago/research/team-{1-5}-*.md`, `_summary.md` | Live | Already in correct location. Stay. |
| Codex stall diagnosis | `.iago/research/codex-stall-diagnosis-2026-04-28.md` | Phase 0 deliverable | Stay. |
| Council-roadmap Phase 1 cleanup | embedded in `iago-os-roadmap.md` | Imminent (Week 1) | Selection: 5 highest-leverage items (Codex cwd, FAIL-regex, macOS timeout, plans-folder consistency, STATE.md). Defers 8 others to opportunistic margin-time. **Mess list does not overlap MWP restructure work** (root CLAUDE.md trim, per-client skeletonization, decision tree, runbooks/learnings backfill, stale-orphan archival). |
| Council-roadmap Wave 1 | imminent (Weeks 2-3) | J (shell-hook matchers), B (distiller), C (cron client-trigger) | Touches `.claude/settings.json`, distiller infra. **Collision risk with MWP Phase 2 if not sequenced.** |
| Council-roadmap Wave 2 | imminent (Weeks 4-5) | K (pre-stage gate), H (Stripe-events), D (doc-only) | Touches `scripts/lib/build-gate.sh`, new endpoint module, `.claude/rules/`. **Collision risk with MWP Phase 2.** |
| Council-roadmap Week 6 | buffer | Codex recurrence absorption + cleanup batch 2 | MWP Phase 2 can land here without contention. |
| Munet feature-roles | `clients/munet-web/.iago/plans/feature-roles/` | Plans 1+2 merged 2026-04-28; **blocked on AuthGuard.test.tsx hotfix**; transition to feature-incidents pending | Don't touch Munet during MWP work. Phase 1 archives only the stale ROOT-level orphans (HANDOFF/SCOPE/ASSET_INTEGRATION_PLAN), nothing inside `.iago/`. |

**Coordinating principle:** MWP restructure addresses a fire (organizational hygiene, "shitshow" complaint) the council didn't see. Council-roadmap addresses a different fire (operator-UX gaps + pipeline correctness). Run as parallel/sequenced tracks; don't fold and don't compete.

---

## 2. External Research Findings

### 2.1 Q1 — MWP restructures in the wild

**Headline:** "MWP" as a labeled framework is mostly Vault-gated (Clief Notes Skool community). The formalized version is the [ICM paper (arXiv:2603.16021)](https://arxiv.org/abs/2603.16021) by Van Clief & McDermott. The *pattern* is convergently reinvented across the public Claude Code ecosystem.

**Para 1 — Patterns observed across 4+ public sources:**
- *Hierarchical CLAUDE.md with strict size budget* — root <100-150 lines, per-package files load on demand. Documented by [dev.to/anvodev](https://dev.to/anvodev/how-i-organized-my-claudemd-in-a-monorepo-with-too-many-contexts-37k7) (47k-word root → measurable sluggishness, fixed by splitting to 9k), [dev.to/syntora](https://dev.to/syntora/designing-a-claudemd-context-system-how-i-give-ai-full-project-context-without-re-explaining-3p2p) (cleanest multi-client implementation: `~/.claude/CLAUDE.md` global → `clients/{name}/CLAUDE.md` per-project → `~/.claude/memory/clients/{name}.md` deep storage), [MuhammadUsmanGM](https://github.com/MuhammadUsmanGM/claude-code-best-practices/blob/main/examples/claude-md-monorepo.md) monorepo example.
- *Private workspace repo + public per-client repos as submodules* — [sunghyunroh Medium](https://medium.com/@sunghyunroh/multi-repo-workspace-strategy-the-structure-where-ai-coding-agents-actually-shine-4ed6b87fb11d). Submodule boundaries == file-system boundaries == zero cross-client bleed.
- *Virtual monorepo three-file system* — [Owen Zanzal](https://medium.com/devops-ai/the-virtual-monorepo-pattern-how-i-gave-claude-code-full-system-context-across-35-repos-43b310c97db8) for 35 repos: `.repos` script + root CLAUDE.md service map + README.
- *`CLAUDE_HOME` env-var switching with per-client config dirs* — [metaflow.life agency guide](https://metaflow.life/blog/how-to-setup-claude-code-for-multiple-marketing-agency-clients). Most operationally-mature client-isolation pattern found.

**Para 2 — Documented failure modes:**
- *Token bloat at root* — most consistently documented. dev.to/anvodev hit it at 47k words.
- *`@` references DO NOT reduce loaded context* — only per-directory CLAUDE.md files do.
- *Cross-client bleed via shared files* — metaflow.life documented this when permission deny rules are missing or `~/.claude/` directories aren't partitioned.
- *"Where do new docs go" is unsolved in published references* — no source has a clear protocol for incoming client docs in MWP.

**Para 3 — Most surprising finding:** Claude Code's hierarchical CLAUDE.md loading (root unconditionally + nested on-demand) means the "rooms" layer is **structurally free** — no wiring needed, just put a CLAUDE.md in each subdir. Per-client CLAUDE.md files inside `clients/{name}/` already exist in iago-os (Munet, Sentria). The fix is **trim root + populate the rooms with delta content**, not invent a new mechanism.

### 2.2 Q2 — Monorepo vs per-client repo for small consultancies

**Headline:** Hard verdict from research = SPLIT client repos to separate GitHub repos. Keep iago-os as the tooling hub.

**Para 1 — When monorepo wins:** [joelparkerhenderson/monorepo-vs-polyrepo](https://github.com/joelparkerhenderson/monorepo-vs-polyrepo) puts the team-size inflection at "once your team can't all attend the same standup" (~10-15 people). Below that, monorepo wins on shared script propagation, zero version drift, single lockfile, single CI cost, one-command onboarding.

**Para 2 — Where it loses (hard blockers for a consultancy):**
1. *Confidentiality.* GitHub has **no per-subdirectory read access control** ([GitHub Community Discussion #102755](https://github.com/orgs/community/discussions/102755) confirms this is a Git-level constraint).
2. *Claude Code routing.* Root CLAUDE.md loads unconditionally regardless of cwd subdir ([Anthropic memory docs](https://code.claude.com/docs/en/memory)). Files concatenate, deeper files don't replace. **No mechanism to scope Claude to a subtree.** [thepromptshelf.dev](https://thepromptshelf.dev/blog/claude-code-monorepo-setup/): "no mechanism exists for single-client code isolation using this approach."

**Para 3 — Middle-path patterns:**
- *Shared private npm packages* — publish `@iago/tooling-config` (Biome, Vitest, hooks) and `@iago/pipeline-scripts` to GitHub Packages. Each separate client repo installs as devDependency.
- *Meta-repo* — [meta](https://github.com/mateodelnorte/meta) coordinates separate repos as a unified workspace. Maintenance stale.
- *Multi-monorepo + git submodules* — CSS-Tricks final architecture for the public/private split problem.

**Bottom line:** **Hybridize.** Keep iago-os monorepo for iaGO's own product (pipeline + skills + tooling). Split client codebases into separate GitHub repos. Ship `@iago/tooling-config` + `@iago/pipeline-scripts` as private packages. The tipping point is any client NDA covering their codebase or any contractor touching a single client's code — both conditions almost certainly already true for Munet (FIMUNET) and Sentria. **This is escalated as Phase 3 with its own council, not bundled into Phase 1+2.**

### 2.3 Q3 — Per-client CLAUDE.md reference implementations

**Headline:** Per-client CLAUDE.md = **deltas only, 8-15 lines.** Don't duplicate root.

**Para 1 — What goes in per-client (observed examples):**
iago-os's own `clients/munet-web/CLAUDE.md` (84 lines) and `clients/sentria/CLAUDE.md` (~80 lines) are decent reference points but currently violate the size budget by including content that should be at root or in `CONTEXT.md`. [Prompt Shelf monorepo example](https://thepromptshelf.dev/blog/claude-code-monorepo-setup/), [MuhammadUsmanGM](https://github.com/MuhammadUsmanGM/claude-code-best-practices/blob/main/examples/claude-md-monorepo.md), [agentfactory.panaversity.org](https://agentfactory.panaversity.org/docs/General-Agents-Foundations/claude-code-teams-cicd/claude-md-configuration-hierarchy) all converge: stack deltas + dir layout + env vars + scope-specific "never do X." **No published reference puts business context (proposals, contracts) into per-client CLAUDE.md.**

**Para 2 — What goes at root + how loading resolves:**
Per [official Anthropic memory docs](https://code.claude.com/docs/en/memory): root CLAUDE.md loads in full at session start, unconditionally. Nested CLAUDE.md files load on-demand when Claude reads files in that subdir. Files concatenate, never replace. Path-scoped `.claude/rules/*.md` (with YAML `paths:` frontmatter) loads only when matching files are opened.

**Para 3 — Documented anti-patterns:**
- *Duplication* — copying root TypeScript/Biome/commit-format rules into per-client. Single-source-of-truth violation. iago-os Munet+Sentria CLAUDE.md repeat stack info already at root.
- *Business context scope creep* — putting proposals, pricing, relationship context into CLAUDE.md instead of CONTEXT.md/docs/.
- *Size bloat → adherence decay* — official docs target <200 lines per file; HumanLayer's root is <60 lines.
- *Dev URLs/sandbox secrets in committed CLAUDE.md* — should go in `CLAUDE.local.md` (gitignored).
- *Everything-in-root* — opposite anti-pattern.

**Bottom line — minimal per-client CLAUDE.md skeleton (8-15 lines):**

```markdown
# {ClientName} — client-specific context

## Project
{One sentence: product, primary user-facing language if not English.}

## Stack deltas from iago-os default
{Only divergences. Omit if standard stack.}

## Commands
{Client-specific scripts only.}

## Architecture notes
{2-4 bullets — facts not in root.}

## Do not modify
{Specific generated/protected files.}

## CI severity rules
{Client-specific finding-type elevation, e.g., "Multi-tenancy violation = Critical"}
```

Business context → `clients/{name}/CONTEXT.md`. Sandbox URLs → `clients/{name}/CLAUDE.local.md` (gitignored).

### 2.4 Q4 — CTO-handoff coordination during structural changes

**Headline:** `git mv` per commit (one move, never bundled with code edits). Phase moves dormant-first → coordinated-second → paired-third.

**Para 1 — Git history preservation:**
- Git infers renames post-hoc via content similarity. `git mv` and manual `mv + rm + add` produce identical objects ([sqlpey.com](https://sqlpey.com/git/effective-git-strategies-for-preserving-history/)).
- **One `git mv` per commit, never mixed with code edits** ([dev.to/gkampitakis](https://dev.to/gkampitakis/check-files-git-history-even-if-renamedmoved-13m0)).
- Do NOT use `git filter-repo` to rewrite shared history.
- Case-only renames (Scripts/ → scripts/) need two-hop on macOS APFS.

**Para 2 — Phasing pattern:**
- Phase 1: dormant zones, zero coordination (single chore PR).
- Phase 2: hot zones (`scripts/`, `.claude/`, `clients/`). 10-min Slack window. Two-PR chain: PR #1 pure `git mv`, PR #2 path-fix ([Netlify guide](https://developers.netlify.com/guides/migrating-git-from-multirepo-to-monorepo-without-losing-history/)).
- Phase 3: pipeline path resolution / client splits. 30-min pair + ADR.

**Para 3 — Cross-platform Windows + Mac:**
- *Line endings.* `.gitattributes` covers `*.sh`/`*.yml`/`*.yaml` as `text eol=lf`. **Gap: `*.mjs` not covered.** Hooks-folder cross-platform risk. Fix in Phase 1.
- *Case sensitivity.* macOS APFS case-insensitive. One person owns naming on the source branch.
- *Path separators in CI.* Use `path.posix.join()` or explicit `/`.

**Bottom line — phasing rule:**
- Dormant moves first (zero coordination).
- Hot zones with cut-over window (PR-pair).
- Pipeline-path-dependent + workspace splits last (pair + ADR).
- Governing principle: structural changes in pure-move commits; path-dependent scripts move last; one human pairs on first pipeline run after they land.

### 2.5 What This Changes in Our Proposal — and the post-stress-test verdict

Five deltas from internal-audit-only thinking, plus one stress-test pivot:

1. **Root CLAUDE.md is the #1 lever.** Q1+Q3 confirm: routing confusion is a *symptom*. Cause is root CLAUDE.md hoarding content that should be in workspace files. Trim root → routing decisions become obvious because the rooms actually have content.

2. **Q2 introduces a strategic-level question NOT in the original prompt.** Should `clients/` stay inside iago-os monorepo at all? Research is unambiguous: split. **This is a P3 decision, escalated to Santiago, with its own council.** Phase 1+2 do MWP-routing fixes within current monorepo; Phase 3 is the strategic split decision.

3. **Per-client CLAUDE.md target is 8-15 lines, not 80.** Munet's 84 lines + Sentria's ~80 mostly duplicate root content. CI rules belong in `.claude/rules/ci-review.md` (universal). Architecture description belongs in per-client `CONTEXT.md`.

4. **`*.mjs text eol=lf` is missing from `.gitattributes`** — Q4 surfaced this. First Phase 1 action.

5. **The "where new docs go" problem is not solved in published references.** No external answer. Decision tree in §3.4 is custom-built for iago-os.

6. **STRESS-TEST PIVOT — coordinate with in-flight council-roadmap, not fold into it.** Initial recommendation was to fold MWP restructure into council-roadmap's Phase 1 cleanup. After stress-testing: **the council-roadmap mess list does not overlap MWP's #1 lever (root CLAUDE.md trim).** Folding would either reopen the counciled selection-of-5 OR bury MWP's highest-leverage finding in the deferred-8 margin-time bucket. Different fires; run as parallel/sequenced tracks. See §5 for sequencing.

---

## 3. Proposed MWP Restructure

### 3.1 Target structure

```
iago-os/
  CLAUDE.md                    # MAP — ≤80 lines. Identity + workspace map + routing + naming. No rules, no catalogs.
  README.md                    # External GitHub-rendered. Stays.
  CLAUDE.local.md.template     # Stays.

  .claude/                     # GOLD — stays as-is.
    rules/
      ci-review.md             # NEW — extracted CI review boilerplate (was duplicated in per-client)
      stack.md                 # NEW — stack rules (was in root CLAUDE.md)
      output-style.md          # NEW — orchestrator output rules (was in root CLAUDE.md)
      execution-pipeline.md    # Existing.
      ...

  .iago/
    PROJECT.md                 # NEW — iago-os product context (currently embedded in CLAUDE.md memory architecture / workflow sections)
    STATE.md                   # Existing. <80 lines.
    plans/                     # Existing.
    summaries/                 # Existing.
    reviews/                   # Existing.
    research/                  # Existing — keeps Phase 0 council artifacts + this audit.
    runbooks/                  # NEW USE — populate with memory-system-setup, codex-companion-windows, sebas-mac-timeout, etc.
    context/                   # NEW USE — phase decision artifacts (Eduba "rooms")
    learnings/                 # Existing.
    prompts/                   # Existing — commit it.

  docs/
    ARCHITECTURE.md, MANUAL.md, SETUP.md, GITHUB-PIPELINE.md, WORKFLOW.md, IAGO-DASHBOARD.md   # External-facing. Stay.
    automations/, patterns/, archive/                                                          # Stay.
    research/                  # iago-os research only; client research moves out.
    specs/                     # Holds council-roadmap + vision (live) + integration specs. NO movement during MWP work.

  clients/
    CLAUDE.md                  # NEW — workspace-router (≤30 lines). Lists active clients, points to per-client.
    munet-web/
      CLAUDE.md                # TRIMMED to 8-15 lines (deltas only).
      CONTEXT.md               # NEW — business context + open questions (extracted from current CLAUDE.md + .iago/PROJECT.md).
      CLAUDE.local.md.template # NEW — sandbox URLs / personal env vars.
      .iago/
        research/              # NEW dir — receives munet-web-playbook.md.
        ...
      src/, amplify/, etc.
    sentria/
      CLAUDE.md                # TRIMMED.
      CONTEXT.md               # NEW.
      .iago/                   # **NEW — currently missing.** Scaffold via templates/client-project/.iago/.
    fulldata/
      CLAUDE.md                # NEW — minimal (research-deliverable engagement, not code).
      CONTEXT.md               # NEW — document research-deliverable status, language (Spanish), output format expectations.
      research/                # Existing.

  scripts/, mcp-servers/, n8n/, templates/, graphify-out/   # All stay.
```

### 3.2 Migration plan

| # | What moves | From | To | Phase |
|---|---|---|---|---|
| M01 | Delete `CLAUDE.md.backup` | `iago-os/` | DELETE | 1 |
| M02 | Add `*.mjs text eol=lf` | — | `.gitattributes` (+ `git add --renormalize . && commit`) | 1 |
| M03 | Commit `.iago/prompts/` | unstaged | tracked | 1 |
| M04 | ~~Move `iago-os-roadmap.md`~~ | ~~`docs/specs/`~~ | **DROPPED** — live council artifact, do not move | — |
| M05 | ~~Merge `iago-os-vision.md`~~ | ~~`docs/specs/`~~ | **DROPPED** — live brainstorming artifact, do not move | — |
| M06 | Create `clients/munet-web/.iago/research/` and move `munet-web-playbook.md` | `docs/research/` | `clients/munet-web/.iago/research/` | 1 |
| M07 | `memory-system-setup.md` | `docs/` | `.iago/runbooks/` | 1 |
| M08 | `frontend-design-skills.md` | `docs/research/` | stay; just commit | 1 |
| M09 | Archive `MUNET-HANDOFF.md` | `clients/munet-web/` | `clients/munet-web/.iago/state/handoffs/2026-04-07-stripe-connect.md` | 1 |
| M10 | Archive `SCOPE.md` | `clients/munet-web/` | `clients/munet-web/.iago/state/2026-03-23-original-scope.md` (with note: superseded) | 1 |
| M11 | Archive `ASSET_INTEGRATION_PLAN.md` | `clients/munet-web/` | `clients/munet-web/.iago/plans/historical/asset-integration-2026-04.md` | 1 |
| M12 | Update MEMORY.md path pointers | various | match new locations | 1 (post-merge) |
| M13 | Trim root `CLAUDE.md` to ≤80 lines | inline | extract to `.claude/rules/` + `.iago/PROJECT.md` | 2 (after council-roadmap Wave 2) |
| M14 | Extract CI review boilerplate | per-client CLAUDE.md | `.claude/rules/ci-review.md` | 2 (after Wave 2) |
| M15 | Trim `clients/munet-web/CLAUDE.md` to ≤15 lines | inline | extract architecture → CONTEXT.md | 2 (after Wave 2 + Munet feature-roles hotfix shipped) |
| M16 | Add `clients/munet-web/CONTEXT.md` | NEW | business context + open Qs | 2 |
| M17 | Trim `clients/sentria/CLAUDE.md` similarly | inline | extract → CONTEXT.md | 2 |
| M18 | Add `clients/sentria/CONTEXT.md` | NEW | business context | 2 |
| M19 | Scaffold `clients/sentria/.iago/` | NEW | from `templates/client-project/.iago/` (run `new-client.sh` against existing dir or manual) | 2 |
| M20 | Add `clients/fulldata/CLAUDE.md` + `CONTEXT.md` | NEW | document research-deliverable status | 2 |
| M21 | Add `clients/CLAUDE.md` workspace-router | NEW | active clients table + routing | 2 |
| M22 | Update `templates/client-project/` | template | match new conventions | 2 |
| M23 | Sweep MEMORY.md + obsidian-brain for path-pointer drift | various | match new paths | 2 (post-merge) |
| M24 | Split `clients/` into separate GitHub repos + `@iago/tooling-config` package | monorepo | poly-repo with shared private package | 3 (separate council, after wedge cycle ships) |

### 3.3 Per-client CLAUDE.md skeleton (Q3 reference)

In §2.3 bottom line. Apply to Munet, Sentria, FullData.

### 3.4 "Where new docs go" decision tree

The answer to Santiago's "shitshow" complaint:

```
Is the doc about iago-os product (skills, pipeline, hooks, agents)?
├─ YES → .iago/
│        ├─ feature plan? → .iago/plans/feature-{slug}/{NN}.md
│        ├─ phase plan? → .iago/plans/{phase-slug}-{NN}.md
│        ├─ quick fix plan? → .iago/plans/quick-{YYMMDD}-{slug}.md
│        ├─ execution summary? → .iago/summaries/...
│        ├─ phase decision artifact? → .iago/context/{NN}-{slug}.md
│        ├─ research / brainstorm / audit? → .iago/research/YYYY-MM-DD-{slug}.md
│        ├─ ops runbook (how-to-do-X repeatable)? → .iago/runbooks/{slug}.md
│        └─ recurring review pattern? → .iago/learnings/patterns.md (append)
│
Is the doc client-specific?
├─ YES → clients/{name}/.iago/ (same subdir taxonomy)
│
Is the doc public-facing iaGO-OS documentation (GitHub README readers)?
├─ YES → docs/ (top-level: ARCHITECTURE, MANUAL, SETUP, WORKFLOW, GITHUB-PIPELINE, IAGO-DASHBOARD)
│
Is the doc a stable reference for a domain skill (industry pattern)?
├─ YES → docs/patterns/{domain}.md
│
Is the doc a phase-cycle artifact (vision / canonical roadmap / cycle research)?
├─ YES → docs/specs/ (vision + roadmap) and .iago/research/ (research artifacts)
│         These pair: docs/specs/iago-os-roadmap.md cites .iago/research/team-{1-5}-*.md
│
Is the doc stale / superseded?
└─ DELETE (default) or → docs/archive/ (only if it documents a decision future-you might retrace)
```

**Key heuristic:** If the doc is *behavioral instruction for Claude*, it goes in `.claude/rules/` or CLAUDE.md. If it's *contextual reference Claude reads when asked*, it goes in `.iago/` or `docs/`. If it's *stable reference for external readers*, it goes in `docs/`.

### 3.5 Routing improvements at root

Replace dense workflow rules with a Workspace map at the top of CLAUDE.md:

```markdown
## Workspace Map

| Working on... | Go to | Read first |
|---|---|---|
| iaGO-OS product (skills, pipeline, hooks, agents) | iago-os/ root | .iago/PROJECT.md |
| MUNET client codebase | clients/munet-web/ | CLAUDE.md, CONTEXT.md |
| Sentria client codebase | clients/sentria/ | CLAUDE.md, CONTEXT.md |
| FullData (research-deliverable, Spanish) | clients/fulldata/ | CLAUDE.md, CONTEXT.md |
| Industry patterns | docs/patterns/ | (auto-loads via /industry-patterns) |
| Cross-cutting research | .iago/research/ | (council artifacts + audits) |

## Where new docs go
See decision tree in `.iago/PROJECT.md`.
```

That's ~10 lines that replace ~150 of the current inline rules content.

---

## 4. Trade-offs

### 4.1 Better
- Root CLAUDE.md trim 209→≤80 lines → faster session start, better instruction adherence.
- Per-client CLAUDE.md trim → no duplication, no stale-vs-current conflict (Munet's current CLAUDE.md says "ESLint flat config" while PROJECT.md says "Biome migration planned" — internal contradiction).
- Decision tree → kills the "I don't know where" pattern.
- Stale orphans archived → no more SCOPE.md ↔ PROJECT.md contradiction.
- `.gitattributes` *.mjs fix → prevents future Sebas-Mac line-ending diffs.
- Sentria gets `.iago/` scaffolding → iaGO workflow available for next plan execution.
- FullData gets CONTEXT.md → routing is unambiguous (research-deliverable, not code-delivery).
- `.iago/runbooks/` populated → setup knowledge stops being scattered.

### 4.2 Worse / costs
- Migration time: Phase 1 ~30-60 min, Phase 2 ~3-4 hrs (added Sentria scaffold + FullData CLAUDE.md + decision tree extraction), Phase 3 ~half-day if split decision goes that way.
- Sebas coordination: Phase 1 zero, Phase 2 needs 10-min cut-over window + 30-min pair on first run, Phase 3 needs 30-min pair + ADR.
- MEMORY.md pointer rot: pointers like `iago-os/research/munet-web-playbook.md` (per memory entry `project_munet_playbook.md`) → `clients/munet-web/.iago/research/munet-web-playbook.md`. Sweep needed post-move.
- Broken-link risk on README + docs cross-refs — estimated ~20-40 internal links to fix.

### 4.3 Risks
- **Pipeline regression from extracted rules.** Mitigation: keep stack.md unscoped (always loaded for any code-touching agent); only path-scope domain rules.
- **Per-client CLAUDE.md regression.** Mitigation: dry-run a `/code-review` on a recent munet-web PR with new vs old CLAUDE.md before merging Phase 2.
- **CONTEXT.md vs PROJECT.md confusion.** Reconciliation: PROJECT.md = iaGO workflow concept (phase context, decisions log). CONTEXT.md = Eduba routing concept (what to read first when entering this workspace). Not duplicates.
- **Phase 3 client-repo split is irreversible.** Don't execute without separate council validation.
- **Collision with council-roadmap Wave 1+2.** Mitigation: MWP Phase 2 sequences AFTER Wave 2 (week 5+). Phase 1 only touches dormant zones.
- **Munet feature-roles hotfix in flight.** Mitigation: Phase 1 only touches Munet ROOT-level orphans (HANDOFF/SCOPE/ASSET); nothing inside `.iago/`. Phase 2 trims Munet CLAUDE.md only after hotfix shipped.

---

## 5. Phased Execution Proposal — sequenced against council-roadmap

### 5.1 Phase 1 — Cheap wins (zero coordination, ~30-60 min)
**Sequencing:** Land in parallel with council-roadmap Phase 0 (Codex cwd RCA + standalone PR). Zero file collision — different zones (council-roadmap Phase 0 touches `scripts/lib/codex-companion.mjs`; MWP Phase 1 touches `.gitattributes`, root orphans, doc moves, archived Munet root files).

Single chore PR off main. Sebas: `git pull` after merge.

Actions: M01, M02, M03, M06, M07, M08, M09, M10, M11, M12 from §3.2.

### 5.2 Phase 2 — Structural moves (after council-roadmap Wave 2 ships)
**Sequencing:** Wait until council-roadmap Wave 2 (week 4-5) lands. Wave 1 (J/B/C) and Wave 2 (K/H/D) touch `.claude/settings.json` hooks, distiller infra, `scripts/lib/build-gate.sh`, `.claude/rules/`. MWP Phase 2 ALSO touches `.claude/rules/` (extracting stack.md, ci-review.md, output-style.md). **Sequence MWP Phase 2 AFTER Wave 2** to avoid file collisions and to let Wave 2's path-scoped rule changes settle first.

Optimal landing window: council-roadmap Week 6 buffer (no new wedge work scheduled). MWP Phase 2 fits the buffer cleanly.

Two-PR chain off main per Q4 pattern: PR #1 pure `git mv` + new file creation, PR #2 path-fix sweep.

Slack window required: "Sebas, landing iago-os MWP restructure PR Friday EOD. Merge or close anything touching `.claude/rules/` or `clients/*/CLAUDE.md` before then."

Actions: M13 → M23 from §3.2.

### 5.3 Phase 3 — Optional split (council + ADR + pair, ~half-day)
**Sequencing:** Defer until council-roadmap wedge cycle ships (week 6+ AND no incident debt). Strategic decision; needs its own council per Santiago's pattern.

Action: M24.

---

## 6. Decision Requests for Santiago

1. **Sequencing:** confirm MWP Phase 1 lands NOW (parallel with council-roadmap Phase 0); MWP Phase 2 lands council-roadmap Week 6 buffer; MWP Phase 3 deferred to its own council post-wedge-cycle.
2. **`docs/archive/` — keep, prune, or branch?** 37 stale decision docs. Default: keep.
3. **`README.md` (547 lines / 27KB) — leave?** External-facing, not Claude-loaded routing. Default: leave.
4. **`CLAUDE.md.backup` — confirm delete?** Apr 9 orphan.
5. **FullData — research-deliverable engagement only, or expected to grow into code-delivery?** Affects whether `.iago/` scaffolding is needed in Phase 2 or deferred.
6. **Sentria `.iago/` scaffold — Phase 2 includes this?** Currently no scaffolding. Confirm scope.
7. **MUNET stale docs (HANDOFF/SCOPE/ASSET) — archive (default) or delete?** Archive into `.iago/state/` with date prefix.
8. **`.iago/runbooks/` — backfill which runbooks?** Candidates: `memory-system-setup`, `codex-companion-windows`, `sebas-mac-timeout`, `worktree-per-session`, `markitdown-cli-encoding`. Pick 3 to start.
9. **`.iago/learnings/` — backfill?** Backfill 3-4 known patterns by hand (Lambda fire-and-forget, framer-motion-on-all-UI, no-stash-branch-switch are MEMORY entries that could promote)? Or organic growth.
10. **Per-client `CLAUDE.local.md.template`?** Add per-client templates for sandbox URLs / personal API keys?

---

## 7. Inputs Validated (post-self-validation 2026-04-29)

- [x] §1.1 root file count and sizes — verified via `wc -l` (CLAUDE.md 209, README 547, backup 168, Munet 84)
- [x] §1.2 `clients/` inventory — verified via `ls`. FullData = research-deliverable (9 strategic docs in Spanish), Sentria = code-delivery without `.iago/`, Munet = code-delivery with full `.iago/`
- [x] §1.3 stale-orphans — confirmed dead. SCOPE.md is contradicted by PROJECT.md line 47 explicitly.
- [x] §1.5 hot-vs-dormant zones — Munet HOT (PR #75/#76 merged 2026-04-28, hotfix blocked); council-roadmap research artifacts in `.iago/research/`.
- [x] §1.6 7-mistakes scoring — mistake 1 GUILTY (209 lines vs 60-150), 2 PARTIAL, 3 PARTIAL, others OK.
- [x] §1.7 in-flight work coordination — council-roadmap shipped 2026-04-28, governs wedges A-N + Phase 1 cleanup mess list. MWP work is orthogonal (different fires).
- [x] §2.1–2.4 external research findings — citations check out, no fabricated consensus.
- [x] §2.5 deltas — Q2 split-clients escalation framing correct; stress-test pivot (don't fold into council-roadmap) defended.
- [x] §3.2 migration table — M04/M05 dropped (don't move live council artifacts); M06 creates Munet `.iago/research/` dir (currently missing); M19 added (Sentria `.iago/` scaffold); M20 added (FullData CLAUDE.md+CONTEXT.md).
- [x] §5 phasing — sequenced against council-roadmap waves.

---

## 8. Council Validation

**Fired:** 2026-04-29 | **Pattern:** 5-advisor independent + anonymous peer review + chairman synthesis (Karpathy LLM Council).

### 8.1 Advisor responses (raw, de-anonymized)

#### The Contrarian

The parallel-track framing collapses under its own weight. §5.1 claims Phase 1 has "zero file collision" with council-roadmap Phase 0 — true only for Phase 1's cheap moves. §5.2 — the load-bearing structural work — explicitly collides with Wave 1+2 in `.claude/rules/` (M13, M14) and `clients/*/CLAUDE.md` (M15, M17). "Sequence MWP Phase 2 AFTER Wave 2" doesn't prevent coordination debt; it defers it. Wave 2 ships week 4-5, MWP Phase 2 lands week 6. That's the buffer week — already spoken for: Codex recurrence absorption + MUNET incident absorption + cleanup batch 2. The proposal is quietly pushing 3-4 hours of structural `.claude/rules/` surgery into the one week the council explicitly designated as slack. Not sequencing — queue-stuffing.

The 8-15 line per-client CLAUDE.md target is wrong for code-delivery clients. Munet's 84 lines carry legitimate load: animation stack init sequence (Lenis + GSAP tick sync order), build command divergence (`tsc -b` not `tsc --noEmit` due to Amplify CI), Vite chunk-split config impl sessions must not touch, ESLint flat config flag. Stripping to 15 lines and offloading to CONTEXT.md assumes impl agents reliably read CONTEXT.md when entering the workspace. They won't — CONTEXT.md is not CLAUDE.md. **It doesn't auto-load.** The architecture the proposal relies on doesn't exist.

§3.4's decision tree is cosmetic theater. It's a document about where documents go, living in `.iago/PROJECT.md`, which doesn't auto-load. The exact problem it claims to solve happens because sessions don't read `.iago/PROJECT.md` before creating files. Adding a decision tree to a file nobody reads doesn't change behavior. The fix is either (a) routing rule in root CLAUDE.md that auto-loads, or (b) a hook. The proposal does neither.

Phase 3 is the real decision being laundered as "deferred." Q2 research verdict is unambiguous: split clients to separate repos. §2.2 says GitHub has no per-subdirectory read access control, Claude Code context bleeds across clients, confidentiality argument is airtight. Calling this "P3, escalate, own council" means Phase 1+2 spend 4-5 hours restructuring a monorepo layout the proposal's own research says should be dissolved. Optimizing something already concluded architecturally wrong.

**Critical concern not addressed:** munet-web CLAUDE.md currently says "No test framework is configured" and "Run ESLint" — both **false** as of 2026-04-28. Vitest is installed, Biome replaced ESLint. The proposal archives stale root-level orphans (SCOPE.md, HANDOFF.md) but leaves the live CLAUDE.md containing instructions that will cause impl sessions to skip tests and run the wrong linter. Active source of pipeline regressions. Contradiction will persist through entire Phase 1 window.

**Verdict:** Don't execute Phase 2 into the buffer week. Don't execute Phase 1 before the clients/ split decision is made. Fix munet CLAUDE.md content corruption now, independently. The decision tree needs to be a CLAUDE.md routing rule or a hook, not a doc.

#### The First Principles Thinker

The actual problem: sessions don't know where to put artifacts, and the workspace is accumulating contradicted/stale docs faster than the cleanup rate. Santiago experiences it as a "shitshow."

Strip the surface question. The audit frames this as "should we adopt MWP?" — but MWP is a solution someone else named. The actual complaint is routing ambiguity and stale-doc accumulation. Two distinct failure modes with different root causes.

**What's actually broken:**
1. *Routing ambiguity* — the §3.4 decision tree is the direct fix. Doesn't require the rest of MWP to work. Could live in `.iago/PROJECT.md` tomorrow and immediately answer "where does this doc go?" That's the one artifact that kills the shitshow complaint.
2. *Stale-doc accumulation* — SCOPE.md contradicting itself, MUNET-HANDOFF.md referencing shipped plans, CLAUDE.md.backup orphaned. Not an information-architecture failure — a cleanup discipline failure. No framework prevents future drift if the habit doesn't change.
3. *Root CLAUDE.md at 209 lines* — IS the routing problem's structural cause. But this is Phase 2, post Wave 2, 6+ weeks out.

The audit's parallel/sequenced framing is correct but may be solving the wrong fire. Council-roadmap fixes pipeline correctness; MWP Phase 1 fixes organizational hygiene. Orthogonal — audit correctly identifies this. But "adopting MWP discipline" as a frame is borrowed structure.

**What the audit misses:** §3.4 decision tree is not tied to any migration step. Pure-text, zero coordination cost, could land as a single commit today. The audit treats it as a Phase 2 artifact (part of root CLAUDE.md trim). That's wrong. The tree should land NOW, independently, before Phase 1 even gets PR'd — because routing confusion is happening today, not after Wave 2.

**Smallest possible action that moves the needle:** commit §3.4 decision tree to `.iago/PROJECT.md` (or new `.iago/ROUTING.md`) as a standalone commit, today. Single file answers "where does this doc go?" without touching any hot zone, requiring coordination, or waiting for any council-roadmap wave.

**Verdict:** Execute Phase 1 as-is. Pull §3.4 decision tree out of Phase 2 and land it as a pre-Phase-1 commit. Phase 3 confirmed as separate council decision. Parallel/sequenced track framing is correct.

#### The Expansionist

The proposal is good execution hygiene. But the council is being asked the wrong question if it stops at "should we run this restructure." The restructure as written is a maintenance wedge. The opportunity inside it is a **product wedge**.

The per-client CLAUDE.md skeleton (§2.3) is not just a cleanup artifact. It's the delivery contract for every future client. Right now iaGO onboards clients manually — Munet got `.iago/` hand-scaffolded, Sentria still doesn't have it. The skeleton + CONTEXT.md + CLAUDE.local.md.template pattern is the embryo of `/iago-onboard --mwp-mode`: a 60-second CLI that drops a complete, MWP-clean, zero-drift client workspace. First engagement where a client's contractor picks up a worktree and finds perfectly scoped instructions with zero root-level bleed — that's a differentiator nameable in proposals.

Phase 3's split-clients-into-separate-repos is buried as a risk but it's actually the monetization inflection. Separate client repos + `@iago/tooling-config` as a private npm package means iaGO's pipeline ships as a versioned, installable dependency. Client pays, gets a pinned version. iaGO ships a patch, clients `npm update`. SaaS motion inside a services business — recurring value, not recurring labor.

The empty `.iago/runbooks/` and `.iago/learnings/` rooms have a second-order play the proposal misses entirely. If learnings get systematically populated — even with the 3-4 MEMORY entries that qualify now (Lambda fire-and-forget, framer-motion-on-all-UI) — the promotion loop (5+ occurrences → CLAUDE.md candidate) activates. Add an auto-distillation hook scanning summaries on pipeline-exit and appending pattern candidates to `learnings/patterns.md`. Cross-client pattern transfer becomes automatic. Every Sentria session that teaches Claude something feeds the next Munet session. Compounding moat no pure-services agency has.

MWP discipline as iaGO's positioning claim is real — but only if it ships as a demonstrable artifact (the onboarding wizard, the skeleton template, the versioned npm package), not just internal folder hygiene. The proposal gets clean rooms. The expansion gets a product.

Execute Phase 1 now. Use Phase 2 planning time to spec `/iago-onboard --mwp-mode` and the learnings auto-distillation hook alongside the structural moves. Phase 3 council should explicitly consider the npm-package monetization angle, not just the confidentiality argument.

#### The Outsider

The proposal does not land cleanly for a first-time reader.

The acronym pile is front-loaded and never resolved. The first paragraph drops "MWP," "Eduba," "Phase 0.3," "wedges A-N," "council-roadmap," and "ICM paper" in consecutive sentences. MWP gets a one-line gloss in §2.1 ("Vault-gated Clief Notes Skool community"). Eduba appears as authority throughout (§1.6, §2.3, §4.1) but is never introduced — I had to infer it's a reference implementation, not a person. "Council-roadmap" used ~30 times as governing constraint; I have no idea if it's an internal document, process, or committee. A contractor asked to execute Phase 1 tomorrow would hit a wall immediately.

The headline verdict reads as conclusion-first. Document opens with the verdict; everything in §1-4 supports it. The stress-test addendum in §2.5 claims this was a "pivot" from a prior recommendation — but the prior recommendation is nowhere in the document. To an outside reader, §2.5 looks like retrofitted support.

The migration table (§3.2) has four rows that are theater. M04 and M05 are struck-through no-ops ("DROPPED"). M08 is "just commit." M12 says "Update MEMORY.md path pointers" with no enumeration of which pointers or how many — placeholder, not action. Mixing no-ops + vague + crisp makes the table look more complete than it is.

The decision tree (§3.4) requires knowing the taxonomy to use the taxonomy. First branch: "Is the doc about iago-os product?" That assumes I know what counts as "iago-os product" vs "client-specific" vs "public-facing." Tree has five branches, none of which covers "I don't know what this doc is" — exactly the scenario triggering it.

§3.3 is a forward reference that leads nowhere useful. It says "In §2.3 bottom line. Apply to Munet, Sentria, FullData." That's not a section — it's an index redirect. A reader executing Phase 2 has to scroll back and translate a generic skeleton into three specific clients with no guidance.

**Bottom line on executability:** Phase 1 is actionable — concrete and contained. Phase 2 has enough vagueness (M12, M23 sweeps, §3.3 redirect) it would stall without someone who knows the repo. Phase 1 as-is, but Phase 2 needs M12/M23 enumerated and §3.3 written as three concrete client files before handoff.

#### The Executor

MWP Phase 1 is executable Monday. MWP Phase 2 waits. Monday morning (2026-04-29) first action: Codex stall RCA — roadmap is explicit, unanimous, non-negotiable. MWP Phase 1 doesn't compete because M02 (`.gitattributes` patch) and M01 (delete backup) are 5-minute filesystem ops on zero-contention files, not pipeline work.

Is Phase 1 actually 30-60 minutes? No. Honest accounting: M01 2 min, M02 10 min, M03 5 min, M06 10 min, M07 5 min, M08 3 min, M09-M11 20 min, M12 10 min. **Actual time: ~65 minutes**, single chore PR. "30-60 minutes" optimistic by 1.25x. Call it 90 minutes with commit + PR creation.

Is "parallel with Phase 0" clean? Yes, structurally. File collision check: zero overlap. Practical sequence: RCA first (30-min block), post diagnosis, then run MWP Phase 1 as a second block (90 min). Sequential mornings also fine.

Is MWP Phase 2 safe in Week 6 buffer? Yes, audit's reasoning holds. Sequencing is correct. One risk: if Codex recurrence #4 consumes the full buffer week, MWP Phase 2 slips to cycle 2. Acceptable — hygiene, not blocker.

**What's deferred-to-never?** M24 (split `clients/`). Trigger condition — NDA OR contractor touching single client's code — almost certainly already applies. Real decision, not horizon item. But executing before wedge cycle ships is capacity-negative. Defer, flag as real decision, not "maybe someday."

**Smallest Monday morning first action after RCA:** M02 — add `*.mjs text eol=lf` to `.gitattributes` and `git add --renormalize .`. Four lines, zero coordination, fixes cross-platform hook risk that's live now and gets worse each Sebas pull. Ship it first; everything else is cleanup.

### 8.2 Peer review (anonymized A-E during review; here de-anonymized)

Mapping: A=Executor, B=First Principles, C=Outsider, D=Contrarian, E=Expansionist.

**5-of-5 reviewers picked D (Contrarian) as strongest.** All 5 reviewers picked E (Expansionist) as biggest blind spot.

**Why D:** Only response that found a *live ship-blocking defect* (munet-web CLAUDE.md content corruption). Only response that exposed the *CONTEXT.md auto-load fiction* — the architectural assumption the proposal's per-client trim depends on. Only response that named the *Week 6 buffer queue-stuffing*. Concrete, falsifiable, actionable.

**Why E was weakest:** Treats restructure as product-wedge launchpad without verifying foundation stability. Pitches `/iago-onboard --mwp-mode` and npm-package monetization while D points out the Phase 1 fix doesn't even land cleanly. Premature scaling before defect audit.

**Cross-cutting blind spots all 5 advisors missed:**

| # | Caught by reviewer | Missed item |
|---|---|---|
| R1 | Reviewer 1 | The §3.4 decision tree only works if it's a routing rule in root CLAUDE.md (auto-loads) or a hook. No advisor proposed this — the actual lever |
| R2 | Reviewer 2 | ~20 migration tasks have no assignees + no definition-of-done. M12 placeholder unowned. Audit is wish-list, not executable plan |
| R3 | Reviewer 3 | No rollback path. If migration partial-states or pipeline breaks mid-execution, what's recovery? No stop criterion defined |
| R4 | Reviewer 4 | Audit freshness — verify migration table against current file state before executing. May be partially stale |
| R5 | Reviewer 5 | Lineage check — does this audit supersede or depend on prior munet-web playbook v2 council output? None of the 5 traced lineage |

### 8.3 Chairman Synthesis

#### Where the Council Agrees
Four of five advisors converge on a narrow, high-confidence claim: **Phase 1 is the only part of the proposal that is genuinely shovel-ready**. Executor, First Principles, Expansionist, and (with caveats) Outsider all green-light the dormant-zone moves — the Contrarian is the lone dissenter, and even his dissent is content-conditional, not structural.

Three advisors (Contrarian, First Principles, Outsider) independently flag that **§3.4's decision tree is architecturally inert as written**. Contrarian and Reviewer 1 sharpen this: nested CLAUDE.md auto-loads, but `.iago/PROJECT.md` and CONTEXT.md do not. Any routing rule that lives anywhere except root CLAUDE.md or a hook is theater.

Four advisors agree **Phase 3 (clients/ split) is a separate council**, not a deferred line item. Expansionist wants it scoped as monetization; Contrarian wants it sequenced before Phase 1; the rest accept the audit's framing. No one argues for absorbing it into the current execution.

Five of five reviewers name **D (Contrarian) as the strongest response** and **E (Expansionist) as the weakest** — unanimity on peer ranking is rare and worth weighting heavily.

#### Where the Council Clashes
**Sequencing of Phase 1 vs. Phase 0.3.** Executor says ship Phase 1 Monday after the Codex RCA — parallel-clean, zero file overlap. Contrarian says don't ship Phase 1 at all until the clients/-split decision lands, because you'd be restructuring a layout the proposal's own research says should be dissolved. Both have force. Executor is right that the file-level work doesn't collide. Contrarian is right that work invalidated within 8 weeks is waste. The disagreement is about **whether dormant-zone hygiene is worth ~90 minutes if the container is going to be split**.

**Where §3.4 belongs.** First Principles wants it as a standalone commit *today*, pre-Phase-1, treating it as the highest-leverage atomic move. Contrarian says any §3.4 placement that isn't a routing rule in root CLAUDE.md or a hook is cosmetic. They agree the routing problem is real and disagree on whether the audit's proposed location can solve it. Contrarian is correct on the architecture — pure-text decision trees in non-auto-loaded files don't change agent behavior.

**What the audit is for.** Expansionist treats it as a product wedge launchpad. Everyone else treats it as maintenance. Five of five reviewers called this out as the council's biggest blind spot — premature scaling before foundation stability. The clash is real but lopsided.

#### Blind Spots the Council Caught
Peer review surfaced four issues no individual advisor named:

1. **Reviewer 1**: routing-rule placement is the actual lever — must live in root CLAUDE.md (auto-loads) or a hook. No advisor proposed this.
2. **Reviewer 2**: ~20 migration tasks have no assignees and no definition-of-done. M12 ("update MEMORY.md path pointers") is unowned and unenumerated. Wish-list, not executable plan.
3. **Reviewer 3**: no rollback path. If migration partial-states or pipeline breaks mid-Phase-1, what's recovery? No stop criterion defined.
4. **Reviewer 4 + 5**: audit freshness and lineage. Is the audit consistent with current repo state? Does it supersede or depend on prior council output (munet-web playbook v2)?

The Contrarian also surfaced a live defect the others missed: **munet-web/CLAUDE.md contains false instructions** ("No test framework configured," "Run ESLint") that poison every pipeline session on that client *right now*. Phase 1 archives orphans but leaves this corrupted live file untouched.

#### The Recommendation: **PROCEED_WITH_REVISIONS**

The Chairman sides with the Contrarian-plus-First-Principles synthesis over the majority's "ship Phase 1 Monday" verdict. Reviewers unanimously rated the Contrarian strongest for cause: he found a live defect, an architectural fiction (CONTEXT.md auto-load), and a queue-stuffing collision the audit obscured.

**Three revisions are non-negotiable before any Phase 1 PR opens:**

1. **Fix munet-web/CLAUDE.md content corruption first, as an independent commit.** Remove "No test framework configured" (Vitest is installed). Replace "Run ESLint" with Biome. This ships harm every hour it stays. Independent of MWP. Do this regardless of whether the rest of the audit ever executes.

2. **Move the §3.4 routing logic into root CLAUDE.md as a routing rule, not a doc reference.** First Principles is right that §3.4 is the highest-leverage atomic move; Contrarian is right that the proposed location doesn't auto-load. Resolve the conflict by putting the rule where the agent will actually read it.

3. **De-scope Phase 2 from the Week 6 buffer.** Buffer is already spoken for (Codex RCA recurrence + MUNET incident + cleanup batch 2). Pushing structural surgery there is queue-stuffing. Re-plan Phase 2 into cycle 2 honestly, or pull §3.4 out and let the rest wait for the clients/ split council.

Phase 3 stays deferred to its own council. Expansionist's monetization framing is interesting but premature — ship the wedge cycle first, then re-open.

The audit is not bad. It is partially stale, architecturally optimistic about auto-loading, and silent on a live ship-blocker. With these three revisions, Phase 1 is genuinely shovel-ready.

#### The One Thing to Do First
**Open a single PR that fixes munet-web/CLAUDE.md** — strip the "No test framework configured" line, replace "Run ESLint" with the actual Biome command, and verify against current package.json. Ship it before any MWP work, before the Codex RCA, before anything else this week. 10-minute fix to a file actively corrupting every Munet pipeline session, owes nothing to the rest of the audit.

### 8.4 How the audit's recommendations changed

The council validates the audit's structural framing (parallel/sequenced track over fold; Phase 3 to its own council) but rejects three operational claims:

| Audit claim | Council verdict |
|---|---|
| §3.4 decision tree lives in `.iago/PROJECT.md` | **Reject.** Must be a routing rule in root CLAUDE.md (auto-loads) or a hook. Otherwise cosmetic. |
| Per-client CLAUDE.md trims to 8-15 lines, content moves to CONTEXT.md | **Reject as written.** CONTEXT.md doesn't auto-load. Either keep load-bearing content in per-client CLAUDE.md OR build a hook that reads CONTEXT.md on workspace entry. |
| MWP Phase 2 lands in Week 6 buffer (clean window) | **Reject.** Buffer is overcommitted. Re-plan Phase 2 to cycle 2 honestly, or pull §3.4 forward and defer rest. |
| Phase 1 archives stale Munet root orphans (HANDOFF/SCOPE/ASSET) | **Accept** — but insufficient. Munet's LIVE CLAUDE.md is also content-corrupted. Fix this as a precondition independent of MWP. |
| Phase 1 timing: 30-60 min | **Adjust to ~90 min** (Executor's honest accounting). |
| Phase 3 = its own council post-wedge-cycle | **Accept.** |
| Parallel/sequenced track over fold | **Accept** with revision #3. |

Five derived TODOs from cross-cutting blind spots:
- R1: §3.4 placement must be auto-loading. Built into revision #2.
- R2: enumerate M12 + M23 sweeps + §3.3 with concrete file lists before any Phase 2 PR.
- R3: define a rollback/stop criterion in Phase 1's chore-PR description.
- R4: re-verify migration table against current repo state immediately before executing each phase (not at audit-write time).
- R5: trace lineage to munet-web playbook v2 (MEMORY pointer `project_munet_playbook.md`) to confirm no conflict.

Council outcome: **PROCEED_WITH_REVISIONS** — execute Phase 1 only after the 3 revisions are addressed. Revision #1 is independently valuable and ships first.
