# Spec: iago-os-v2 — Phase 1 (MWP-Native Workspaces)

## Problem

iago-os is code-biased by construction. Its orchestration lives in `scripts/execute-pipeline.sh` plus `.claude/skills/` plus `.claude/agents/` — powerful for React + Amplify code delivery (Munet), but a poor fit for content creation, freelance consulting intake, and research-heavy deliverables. Those workflows currently live as skill bolt-ons (`/content-engine`, `/iago-proposal`, `/investor-materials`) that share one global context surface, which forces Claude to filter across unrelated domains on every task.

Eduba's Model Workspace Protocol (MWP), formalized in Van Clief & McDermott (2026), demonstrates a cleaner pattern for sequential human-reviewed workflows: **numbered folders as stages, plain markdown as instructions, layered context loading (L0–L4) to prevent "lost in the middle" degradation** (Liu et al. 2024). Corpus-validated across Eduba, University of Edinburgh Neuropolitics Lab, ICR Research, and Bonn Academy of International Affairs.

iago-os has the code-pipeline story locked. It does not have the non-code story. Rather than contort iago-os further, build **iago-os-v2** as a parallel MWP-native system for content + consulting + research workflows. Phase 1 ships two production workspaces and validates the pattern before any decision to absorb iago-os code delivery.

## Solution

Build `iago-os-v2` as a separate Git repo at `~/dev/iago-os-v2/`. MWP five-layer hierarchy at the root. Two Phase-1 workspaces: `content-pipeline/` and `client-intake/`. Shared reference material (iaGO brand, Santiago voice, stack conventions) imported via git submodule from iago-os to avoid duplication. MCP stack (obsidian, graphify, mempalace, markitdown, context7) stays globally configured — per-workspace scoping is documented in each workspace's `CONTEXT.md`, not enforced at transport.

Phase 1 is scoped to 4 weeks and explicitly excludes the code-delivery workspace (deferred to Phase 2+ under trigger conditions). Munet remains on iago-os. Nothing in iago-os is modified during Phase 1.

**Chosen approach: B+ (MWP + iaGO capabilities, with placeholder for future code absorption)**.

Rationale vs alternatives:
- **A (MWP-pure, copy vault-toolkit verbatim)** — too generic. Ships faster but produces workspaces that ignore iaGO's brand voice and existing skill library. Outgrown in a week.
- **C (MWP + workspace-builder first)** — violates MWP Mistake #7 ("building the whole system before using it"). Builds a tool-that-builds-tools before any end-user value ships.
- **B+** — scaffolds real workspaces that use iaGO's brand as L3 reference and existing research/content skills as internal helpers, while marking `workspaces/code-delivery/` as `UNIMPLEMENTED — Phase 2+`. Fastest path to validated value with a clean upgrade path.

## Scope

### In Scope (Phase 1)

- New git repo `~/dev/iago-os-v2/`, MIT license, README with MWP attribution
- Layer 0: root `CLAUDE.md` (~40 lines, workspace-routing table, naming conventions)
- Layer 1: root `CONTEXT.md` (workspace index + shared L3 pointers)
- Shared L3 references via git submodule of iago-os `docs/specs/iago-brand.md` + a new `iago-voice.md` (extracted from `/content-engine` skill) + a new `iago-stack.md` (extracted from `.claude/rules/react-vite.md` + `.claude/rules/aws-amplify.md`)
- Workspace 1 — `workspaces/content-pipeline/`:
  - Stages `01_research/`, `02_script/`, `03_production/`, `04_distribution/`
  - Each stage: `CONTEXT.md` with Inputs/Process/Outputs contract, `output/` folder, stage-local `references/` where needed
  - Setup questionnaire: `setup/questionnaire.md` capturing content type, audience, platform targets
  - Ship 1 long-form blog post + 1 short-form video script before Phase 1 closes
- Workspace 2 — `workspaces/client-intake/`:
  - Stages `01_discovery/`, `02_scoping/`, `03_proposal/`, `04_engagement-setup/`
  - L3 references: `proposal-templates.md`, `scope-agreement.md`, `engagement-terms.md` (pulled from iaGO consulting history)
  - Setup questionnaire capturing client name, industry, engagement type, budget signals
  - Run once on next inbound before Phase 1 closes
- Workspace placeholder — `workspaces/code-delivery/`:
  - Empty folder with a single `CONTEXT.md` marked `STATUS: UNIMPLEMENTED — Phase 2+`
  - Lists known gaps (wave-parallel dispatch, async GitHub loop, build-retry loop) and the artifact-reference pattern design for when Phase 2 opens
- Phase 1 trigger document: `docs/phase-1-completion.md` — explicit checklist for "proven by use" before Phase 2 unlocks
- One MWP workspace-builder reference: a README section linking to the upstream workspace-blueprint repo and ICM paper

### Out of Scope (Phase 1)

- Code-delivery workspace implementation (Phase 2+, gated)
- Any modification to iago-os (code, scripts, skills, agents, rules)
- Any migration of Munet from iago-os
- Automated workspace-builder (Phase 3+, if ever)
- Per-workspace MCP scoping at transport layer (documented only)
- Semantic debugging / output provenance identifiers from ICM Section 6 (future research)
- Cross-model (Codex) integration (handled by iago-os, not v2)
- Concurrent worktree hygiene (Phase 1 is single-user sequential)
- CI/CD for v2 itself (not needed — v2 is a workspace format, not a deployed system)

## Technical Approach

**Stack**: v2 is not an application. It is a Git repository of folders + markdown files. No React, no Vite, no Amplify, no Lambda. The only code is the Python scripts inside individual stages (e.g., an Obsidian MCP fetch script in `03_production/`) and they are hand-authored per workspace, not framework-generated.

**Folder structure (root)**:

```
iago-os-v2/
  CLAUDE.md                        # L0 — workspace routing (~40 lines)
  CONTEXT.md                       # L1 — workspace index
  README.md                        # attribution to MWP + ICM paper
  shared/                          # L3 — submodule of iago-os brand/voice/stack
    iago-brand.md
    iago-voice.md
    iago-stack.md
  workspaces/
    content-pipeline/
      CLAUDE.md                    # L0 per workspace (some routing)
      CONTEXT.md                   # L1 per workspace
      stages/
        01_research/
          CONTEXT.md               # L2 stage contract
          references/              # L3 — stage-specific refs
          output/                  # L4 — per-run artifacts
        02_script/
          CONTEXT.md
          references/
          output/
        03_production/
          CONTEXT.md
          references/
          output/
        04_distribution/
          CONTEXT.md
          references/
          output/
      _config/                     # L3 — workspace-wide config
      setup/
        questionnaire.md
    client-intake/
      CLAUDE.md
      CONTEXT.md
      stages/
        01_discovery/
        02_scoping/
        03_proposal/
        04_engagement-setup/
      _config/
      setup/
        questionnaire.md
    code-delivery/                 # UNIMPLEMENTED — Phase 2+
      CONTEXT.md                   # STATUS marker only
  docs/
    phase-1-completion.md          # trigger checklist
    migration-plan.md              # Phases 2-4 high level
```

**Layer-by-layer contract** (aligned to ICM Figure 1):

- L0 `CLAUDE.md` — identity + workspace index + routing table (target: ~800 tokens)
- L1 `CONTEXT.md` per workspace — intra-workspace routing (target: ~300 tokens)
- L2 stage `CONTEXT.md` — Inputs / Process / Outputs (target: 200–500 tokens)
- L3 `references/` + `_config/` + `shared/` — reference material stable across runs (variable, 500–2k tokens scoped per stage)
- L4 `output/` — per-run working artifacts (variable)

**Shared refs via git submodule**:

```bash
# From iago-os repo:
git subtree split --prefix=docs/specs/iago-brand.md -b iago-shared-refs
# In v2 repo:
git submodule add <url> shared/
```

Actual approach may be simpler: maintain a small `iago-os-shared/` repo as the canonical source for brand/voice/stack, submodule it into both iago-os and v2. Decide during scaffolding.

**MCP scoping**: global MCPs stay global. Each stage `CONTEXT.md` explicitly lists which MCPs it uses (e.g., `Uses: obsidian MCP for research note fetch; context7 for stack docs`). No transport-level enforcement.

**Naming convention** (root `CLAUDE.md`):

- Drafts: `{topic}_draft.md`
- Final: `{topic}_final.md`
- Per-run outputs: `YYYY-MM-DD_{slug}.md`
- Workspace runs logged in `_runs/YYYY-MM-DD_HH-MM.md`

## Delivery Path

### Phase 1.1 — Scaffold (Week 1)

**Deliverable**: empty but valid v2 repo, both workspaces scaffolded, submodule wired, runs a no-op end-to-end on the content-pipeline.

Tasks:
- Create `~/dev/iago-os-v2/` Git repo, README, MIT license
- Write root `CLAUDE.md` + `CONTEXT.md`
- Copy workspace-blueprint structure from ingested ZIP as starting point
- Adapt content-pipeline stages to Eduba-style long-form + short-form
- Adapt client-intake stages from vault-toolkit `architectures/client-delivery/`
- Submodule the shared refs (brand, voice, stack)
- Test: open Claude Code in v2, run "write a test blog post about iaGO's memory architecture" — verify Claude routes to `content-pipeline` and reads the correct CONTEXT.md files

### Phase 1.2 — Ship first content piece (Week 2)

**Deliverable**: 1 real long-form blog post or deep-dive documentation piece shipped via v2.

Tasks:
- Pick a topic from iaGO backlog (e.g., "MWP adoption: building iago-os-v2 in public", "How we integrated 5 MCP servers for multi-memory AI")
- Run through all 4 stages: research → script → production → distribution
- Edit between stages (U-shape expected — stage 1 heavy, middle light, stage 4 heavy per ICM Section 4.5)
- Publish to iaGO blog / LinkedIn / Obsidian
- Document friction points in `docs/phase-1-learnings.md`

### Phase 1.3 — Ship second content piece + first client intake (Week 3)

**Deliverable**: 1 short-form video script (Remotion-ready, bridges to iago-os Remotion workspace) + 1 client intake run on next inbound.

Tasks:
- Run content-pipeline on a short-form deliverable
- When next inbound arrives, run client-intake workspace end-to-end (discovery → scoping → proposal → engagement-setup)
- Compare output vs current ad-hoc proposal process
- Update learnings doc

### Phase 1.4 — Validation + trigger decision (Week 4)

**Deliverable**: signed `docs/phase-1-completion.md` checklist, go/no-go decision on Phase 2.

Tasks:
- Check Phase 1 proven-by-use criteria:
  - [ ] ≥3 content pieces shipped via content-pipeline
  - [ ] ≥1 client onboarded via client-intake
  - [ ] Sebas runs v2 Mac-side independently without Santiago intervention (evidence: a session summary posted by Sebas to Obsidian)
- If all three met → open Phase 2 (code-delivery workspace on non-Munet test repo)
- If not met → extend Phase 1 by 2 weeks, diagnose what's blocking adoption
- Write retrospective to Obsidian `sessions/YYYY-MM-DD-iago-os-v2-phase1-retro.md`

## Future Phases (Referenced, Not Specified)

Phases 2–4 will each get their own spec when their trigger conditions are met. This spec covers **only** Phase 1. Summary of the phased absorption plan (detail deferred):

- **Phase 2** (weeks 5-8): build `code-delivery/` workspace, validate on non-Munet code (MarkItDown MCP updates, Remotion animation-studio expansion, or v2 itself)
- **Phase 3** (weeks 9-12): challenger mode on one deferred Munet plan (ticket-email-fix wave 2 is primary candidate)
- **Phase 4** (post-validation): federate (v2 for new work, iago-os for Munet through its lifetime) OR full migrate (next new client bootstraps on v2). Federate is favored.

**Explicit prohibition across all phases**: v2 does not touch Munet until Munet MVP ships to production (defined as M2 wave 1 + ticket-email-fix wave 1 live on prod account 851725296610, per memory).

## Open Questions

1. **Shared refs repo layout** — dedicated `iago-os-shared/` repo with submodule into both iago-os and v2, or is it simpler to cp-on-scaffold and accept some drift? (Affects Phase 1.1 scope by ~0.5 days.)

2. **Phase 2 test repo** — MarkItDown MCP updates, Remotion animation-studio expansion, or a small greenfield utility? (Decide at Phase 1 close, not now.)

3. **Obsidian as v2 output sink** — content-pipeline's final stage should probably write to Obsidian vault via MCP. Confirm this is the preferred default vs generic markdown-to-filesystem. (Decide at Phase 1.2 execution.)

4. **Client-intake trigger** — wait for next real inbound (could be weeks), or retroactively run through the MUNET or Din engagement as a backtest for Week 3? (Retroactive is faster but less real.)

5. **Sebas independence test** — concrete criterion is "posts a session summary to Obsidian". Should it be a specific kind of content or just any workspace run? (Lean: any workspace run, documented in Obsidian, is sufficient evidence.)

Address in Phase 1.1 kickoff conversation with Sebas.

---

**Handoff**: Run `/council` on this spec before `/writing-plans`. Council should stress-test the phased absorption strategy (specifically: is Phase 2→4 realistic, or should v2 permanently federate with iago-os?).

## Stress Test

**Verdict:** BLOCK
**Date:** 2026-04-27
**Mode:** council (5 reviewers + peer review + chairman)

### Consensus Findings

- **Submodule mechanics are technically broken.** Reviewers A and D both flagged that `git subtree split --prefix=docs/specs/iago-brand.md` cannot operate on a file — subtree split requires a directory. The spec's submodule strategy fails at the first scaffolding command. Reviewer B independently argued the submodule itself is excessive ceremony for 3 markdown files. Three independent angles converging on the same construct = the construct must change.
- **Phase 1 exit checklist is unreachable as written.** Reviewer D caught that the checklist requires ≥3 content pieces while Phases 1.2 + 1.3 only ship 2. Reviewer A noted the same arithmetic gap. The spec cannot be marked complete by its own criteria.
- **Public-repo + client-derived L3 = irreversible harm.** Reviewer E flagged this as a hard BLOCK; all 5 peers ranked E as the strongest review precisely because public commit history of client-named content cannot be unwritten. License + visibility + scrubbing requirements must be decided before any commit.
- **Sebas independence is asserted, not delivered.** Reviewers C, D, and 3/5 peers independently flagged that the Phase 1 exit gate ("Sebas runs on Mac unaided") has no corresponding artifact in any phase deliverable — no README, no walkthrough, no clone path, no remote URL, no pairing session. The exit gate fails on its own definition.

### Contested Findings

- **New repo vs in-place workspaces (B vs spec).** B argued `workspaces/content-pipeline/` inside iago-os is the same MWP at zero second-repo cost. The spec's implicit counter is context bleed: a single global CLAUDE.md/MEMORY.md surface forces Claude to filter unrelated domains on every turn. Peer review verdict: B is right that the repo cost is real but framed it incorrectly — the actual debate is **context surface area**, not repo count. Neither side has fully argued it. Resolution: spec must add Alternative A (in-place workspaces) and engage the context-bleed rationale explicitly with evidence, not assertion.
- **MEMORY.md scope (C) vs worktree rule (peer #1).** C argued v2 starts with a blank MEMORY.md, losing 30+ trained feedback entries — a real cost. Peer #1 countered that putting workspaces inside iago-os doesn't dodge the worktree-per-session rule (`feedback_worktree_per_session`), so the "just use one repo" alternative still pays a multi-checkout cost. Both true. Resolution: whichever path is chosen, the MEMORY.md migration question (port subset? symlink? re-train?) must be answered in the spec, not deferred.
- **Submodule vs copy-on-scaffold for shared brand/voice/stack.** E flagged submodule as a leak vector (commit history, object hashes). B flagged it as YAGNI. A/D flagged the mechanics as broken. No reviewer defended the submodule. Apparent consensus, but the spec's stated rationale (single source of truth for brand drift) is real. Resolution: copy-on-scaffold with version stamp + a documented re-sync command achieves the rationale without any of the submodule failure modes.

### Blind Spots Caught

- **L3 verifiability has zero observability.** Every stage CONTEXT.md declares which MCPs it "uses," but no reviewer caught that nothing confirms the model actually loaded the declared L3 at runtime. The MWP layering is assertion-only. Surfaced by peer review only.
- **L0 CLAUDE.md is the routing root and is unauthored.** Phase 1.1 says "verify Claude routes to content-pipeline" — but routing depends on L0 content the spec hasn't written. The verification step targets a non-existent artifact. Surfaced by peer review only.
- **Dirty foundation.** Current git status shows `scripts/console-check.mjs` and `scripts/execute-pipeline.sh` modified. Phase 1 launches from unclean substrate. Surfaced by peer review only.
- **Sebas access path undefined.** Repo at `~/dev/iago-os-v2/` is on Santiago's Windows machine. No remote URL, no GitHub org, no clone/branch/SSH path documented. Sebas's "independence test" has no transport. Surfaced by peer review only.
- **Stale STATE.md is a Phase 1.1 trap.** Reviewer A flagged the macOS-timeout entry; peer review elevated it: Sebas's first action will be reading STATE, seeing an open blocker, and aborting. Phase 1 fails the trigger for an unrelated stale entry.

### Consolidated Findings

- **[BLOCK]** Public-repo + MIT + L3 refs pulled from iaGO consulting history (proposal templates, scope agreements, engagement terms) with no scrubbing requirement creates irreversible client-confidentiality exposure. Decide visibility before any commit. (source: E)
- **[BLOCK]** Submodule from private iago-os to (likely-public) v2 leaks commit history, object hashes, and file content on drift. (source: E)
- **[BLOCK]** `git subtree split --prefix=docs/specs/iago-brand.md -b iago-shared-refs` is technically broken — subtree split requires a directory, not a file. The spec defers the fix to "decide during scaffolding." (source: A, D)
- **[BLOCK]** Phase 1 exit checklist requires ≥3 content pieces shipped; Phases 1.2 + 1.3 only deliver 2. Checklist is unreachable as written. (source: D, A)
- **[BLOCK]** Stale STATE.md macOS-timeout entry will fire on Sebas's first read and abort the Phase 1.1 independence test for a wrong reason. Must be cleared as Phase 1.0 prereq. (source: A, peer)
- **[BLOCK]** New repo is premature. The same source research recommends `workspaces/content-pipeline/` + `workspaces/client-intake/` inside iago-os — same MWP, zero second repo, no submodule, no MEMORY.md migration. Spec must engage this alternative explicitly. (source: B)
- **[BLOCK]** Submodule for 3 markdown files is excessive ceremony. Copy-on-scaffold with attribution header + version stamp is unambiguously simpler and eliminates both the mechanics bug and the leak vector. (source: B, E, A, D)
- **[BLOCK]** Mode-switching cost is unacknowledged: Santiago in Munet on iago-os, content task arrives, must close Claude Code + cd v2 + reopen. Zero mitigation. Daily-friction adoption killer. (source: C)
- **[BLOCK]** MEMORY.md is project-scoped. v2 is a new project scope = blank slate. 30+ trained feedback entries (output style, PR rules, framer motion, worktree hygiene) do not port. v2-Claude won't know iaGO conventions on day 1. (source: C)
- **[BLOCK]** Sebas Phase 1 exit gate ("runs on Mac unaided") has no corresponding artifact: no README, no walkthrough, no clone path, no pairing session, no remote URL. Spec defers to a "Phase 1.1 kickoff conversation" — that is not a deliverable. (source: C, D, peer 3/5)
- **[IMPORTANT]** MCP global scope = v2 has full Obsidian client data access; prompt injection in client-intake exfiltrates. Sebas credential handoff is undefined. GH_PAT inheritance for Phase 2+ is unspecified. (source: E)
- **[IMPORTANT]** Inbound-driven validation has no floor — real client inbound may not arrive in 4 weeks; Phase 1.3 stalls with no fallback. (source: A)
- **[IMPORTANT]** `code-delivery/` placeholder violates YAGNI and is a routing trap (Claude will use it before it exists). Remove from Phase 1 entirely; reintroduce when Phase 2 starts. (source: A, B, D)
- **[IMPORTANT]** Two-CLAUDE drift (iago-os CLAUDE.md vs v2 CLAUDE.md on orchestrator behavior, output style, pipeline rules) has no catch mechanism. (source: A, C)
- **[IMPORTANT]** MCP concurrent session writes interleave on the same Obsidian vault unlocked. (source: A)
- **[IMPORTANT]** `_runs/YYYY-MM-DD_HH-MM.md` ceremony with no automation = either drop it or automate it. (source: B)
- **[IMPORTANT]** 4 stages → 3 (research/draft/distribute) for short-form content; 4-stage flow is over-staged for Phase 1.2 scope. (source: B)
- **[IMPORTANT]** Phase 2-4 roadmap doesn't belong in a Phase 1 spec. (source: B)
- **[IMPORTANT]** No cross-repo routing nudge — iago-os available-skills.md doesn't redirect to v2, so old paths keep working and v2 never gets used. Naming convention declared but unenforced. (source: C)
- **[IMPORTANT]** Workspace-blueprint structure (flat) is incompatible with v2 numbered stages. Vault-toolkit client-delivery stage names don't match. iago-voice.md + iago-stack.md authoring tasks are unscoped. (source: D)
- **[IMPORTANT]** Sebas Week 4 timeline is unrealistic with no concrete onboarding session in the plan. (source: D)
- **[IMPORTANT]** OQ1 (open question 1) is a kickoff blocker. Resolve before Phase 1.0 commits. (source: D)
- **[IMPORTANT]** L3 verifiability has zero observability — no mechanism confirms the model loaded the declared L3 at runtime. (source: peer review)
- **[IMPORTANT]** L0 CLAUDE.md is unauthored, but Phase 1.1 verifies routing against it. Author L0 first or move the routing-verification gate. (source: peer review)
- **[NOTE]** `output/` and `_runs/` need .gitignore entries or the repo must be private. (source: E)
- **[NOTE]** iago-os settings.json hooks (safety-guard, commit-quality) don't port to v2 — re-author or re-link. (source: E)
- **[NOTE]** MIT-licensing extracted methodology (brand/voice/stack) may be an unintended IP grant. (source: E)
- **[NOTE]** Rollback path for Phase 1 is unspecified. (source: A)
- **[NOTE]** Workspace-blueprint version is not pinned. (source: A)
- **[NOTE]** Sebas independence proof should be an artifact committed to the repo, not an MCP-dependent assertion. (source: B)
- **[NOTE]** `_config/` per workspace is undefined. (source: B)
- **[NOTE]** `_examples/` has no re-entry semantics. (source: C)
- **[NOTE]** Cross-workspace Remotion handoff is undesigned. (source: C)
- **[NOTE]** code-delivery placeholder requires authored text even as a stub. (source: D)
- **[NOTE]** Completion docs (phase-1-completion.md, migration-plan.md) are unscoped — neither author nor template specified. (source: D)
- **[NOTE]** Dirty git foundation: `scripts/console-check.mjs` and `scripts/execute-pipeline.sh` are modified per current status. Clean before Phase 1.0 starts. (source: peer review)
- **[NOTE]** Sebas access path: no remote URL, no GitHub org, no clone/SSH path documented. (source: peer review)

### Required Revisions Before /iago-plan

The spec ships 10 BLOCKs across 5 independent reviewers, includes one technically-impossible git command, has an arithmetically-unreachable exit checklist, and lacks any artifact backing its declared exit gate. It cannot proceed to planning. Concrete revisions required:

1. **Decide repo visibility.** If any L3 contains client-derived material (proposal templates, scope agreements, engagement terms), the repo must be private. Document the visibility decision and a scrubbing policy in the spec before Phase 1.0.
2. **Replace submodule with copy-on-scaffold.** Drop the subtree-split mechanic entirely. Adopt copy-on-scaffold with an attribution header (`Source: iago-os@<sha> · iago-brand.md`) and a documented `iago-resync-shared` command. Eliminates the broken mechanics, the leak vector, and the YAGNI complaint in one move.
3. **Fix STATE.md staleness as Phase 1.0 prerequisite.** Clear the macOS-timeout entry and any other open blockers in iago-os/STATE.md before scaffolding v2. Otherwise Sebas's first read aborts Phase 1.1.
4. **Add Sebas onboarding artifact + access path to Phase 1.1 deliverables.** Concrete list: (a) remote URL (GitHub org + repo name), (b) `README-sebas.md` with clone + first-run + smoke-test commands, (c) one explicit pairing-session deliverable, (d) the credential handoff path (GH_PAT, MCP secrets, Obsidian vault access from Mac).
5. **Reconcile checklist (≥3) vs delivery (2).** Either add a third Phase 1 content piece (1.2b: short-form distribution post derived from 1.2a) OR change the exit criterion to "≥2." Pick one and update both ends.
6. **Add Alternative A: in-place workspaces.** `workspaces/content-pipeline/` + `workspaces/client-intake/` inside iago-os. Engage the actual rationale for a separate repo — context surface area, MEMORY.md scope, mode-switching cost — with evidence, not assertion. If the v2 repo wins on merits, the spec is stronger; if Alternative A wins, ship that instead.

Additional revisions strongly recommended (do not block planning but should land before Phase 1.0): drop `code-delivery/` from Phase 1 scope; answer OQ1; pin workspace-blueprint version; decide MEMORY.md migration strategy (port subset, symlink, or fresh-train); author L0 CLAUDE.md before any L0-dependent verification step; add an L3-loaded observability hook (even a single log line per stage); commit clean working tree before Phase 1.0 first commit.

VERDICT: BLOCK
