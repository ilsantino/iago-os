# Prompt: iago-os MWP audit — execute council revisions + decide scope coordination

**Use this in a fresh Claude session.** Self-contained — does not depend on prior conversation context.

**Invoke:**
```
cd ~/dev/iago-os && claude
```
Then paste the prompt below (or reference this file: "Read `.iago/prompts/iago-os-mwp-revisions-execute.md` and execute it.")

---

## Prompt

You are picking up the iago-os MWP restructure work. The audit + council fired on 2026-04-28 → 2026-04-29, the council returned **PROCEED_WITH_REVISIONS** with three non-negotiable revisions, and 5 days have elapsed since (today's date is later than 2026-05-04 — verify with the system date before assuming). Several things shipped in those 5 days that change the audit's premises. Re-grounding is the first step.

### Context (read in this order)

1. **`~/dev/iago-os/.iago/research/2026-04-28-mwp-restructure-audit.md`** — full audit with §8 Council Validation. Most important sections to read closely: §1.7 (in-flight work coordination), §2.5 (what external research changed), §6 (decision requests), §8.3 (chairman synthesis with the 3 revisions), §8.4 (how recommendations changed).

2. **`~/dev/obsidian-brain/sessions/2026-04-29-iago-os-mwp-restructure-audit.md`** — session digest from the audit-write session. What was decided and why.

3. **`~/dev/obsidian-brain/sessions/2026-05-04-iago-os-mwp-handoff.md`** — handoff digest. Documents the freshness drift between council-fire and re-pickup.

4. **`~/dev/iago-os/docs/specs/iago-os-cleanup.md`** — Phase 1 cleanup spec (5 items, ~1.75 dev-days). Authored 2026-04-29. **Critical scope-decision input:** does the MWP audit's work fold into this, run alongside as its own feature, or coexist?

5. **`~/dev/iago-os/.iago/plans/feature-iago-os-cleanup/01-cleanup-hygiene.md`** — the planned execution of the cleanup spec.

6. **`~/dev/iago-os/docs/specs/iago-os-roadmap.md`** — the canonical Phase 0.3 council roadmap. Confirm what's shipped vs pending in Wave 1/2/3.

7. **`~/dev/iago-os/.iago/STATE.md`** — current iago-os phase. Note: this file is itself the subject of cleanup-hygiene Item 1 (stale `Updated:` field). Read it but treat the timestamp with suspicion.

8. **`~/dev/iago-os/clients/munet-web/.iago/STATE.md`** — Munet current state. As of 2026-05-04, Santiago is paused on Munet (between feature-roles and feature-incidents). Coordination constraint from the original audit is relaxed.

### What's known to have shipped (2026-04-29 → today)

- **PR #27** — Codex stage 4 liveness gate with bounded timeout. Closes the Codex stall RCA the council-roadmap named as #1 priority for 2026-04-29.
- **PR #29** — macOS `brew install coreutils` prereq note added to CLAUDE.md. One of the council-roadmap's Phase 1 cleanup items already done (Item 4 partial — adds the prereq, doesn't yet do the audit-call-site sweep).
- **PR #28** — Phase 0 strategic-validation artifacts (the council-roadmap itself committed to `docs/specs/`).
- **Munet feature-roles** — Plans 1, 2, 3 all shipped (PRs #75, #76, manual backfill on prod Cognito). PR #77 hotfix for AuthGuard.test.tsx awaiting merge → unblocks Munet feature-incidents.
- **Munet `feat/roles-capability-refactor`** — LambdaFn alias fix to unblock Amplify deploy job 100. Awaiting push + Amplify job #101.
- **`feature-tool-surveillance`** — 4 plans / 21 tasks planned 2026-05-04. 7 research files in `.iago/research/2026-05-04-*.md`. Browser tools deferred. Slotted post-Munet M2.
- **`.iago/plans/` partial restructure** — flat audit-NN-{slug}.md and quick-YYMMDD-{slug}.md files deleted; new folders created (codex/, feature-audit/, feature-iago-os-cleanup/, feature-tool-surveillance/). The "flat-files-no-grouping" symptom from the audit's hot-spot list is being addressed in parallel.

### What is NOT done (still outstanding)

- **Council revision #1** — `clients/munet-web/CLAUDE.md` content corruption (lines 18, 22 still say "Run ESLint" / "No test framework is configured"; Vitest is installed and Biome status should be confirmed against current `package.json`). Verified still present 2026-05-04.
- **Council revision #2** — §3.4 routing-rule placement architecture. Audit proposed `.iago/PROJECT.md` (council REJECTED — doesn't auto-load). Council says: must be a `.claude/rules/` path-scoped rule that auto-loads on relevant file reads, OR a hook on workspace entry. Decision pending.
- **Council revision #3** — Phase 2 sequencing. Audit had Phase 2 land in council-roadmap Week 6 buffer; council REJECTED (buffer overcommitted). Re-plan needed.
- **MWP migration table M01-M12** — none of the dormant-zone moves shipped (delete `CLAUDE.md.backup`, add `*.mjs text eol=lf` to `.gitattributes`, archive Munet root orphans HANDOFF/SCOPE/ASSET, move uncommitted docs).

### Scope decision required (the big one)

**Does the MWP audit's work fold into `feature-iago-os-cleanup`, or run as its own `feature-mwp-restructure`?**

- *`feature-iago-os-cleanup` scope* (per `docs/specs/iago-os-cleanup.md`): STATE.md discipline, branch hygiene, deferred-plans archive, macOS portability sweep, `.iago/state/` purpose docs. ~1.75 dev-days. One bundled PR.
- *MWP audit scope (post-council)*: revision #1 (Munet CLAUDE.md fix), revision #2 (routing rule architecture), revision #3 (Phase 2 re-plan), M01-M12 dormant-zone moves, M13-M21 structural moves (per-client trim + CONTEXT.md + workspace router).

**They don't overlap on file targets.** Different scope. The council's parallel/sequenced verdict still holds; the question is whether to ship them as separate features or fold the dormant-zone moves into the cleanup PR.

### What to do (sequenced)

1. **Run a 5-min freshness micro-check** before any execution work. Read STATE.md, run `git log --oneline -10`, list `.iago/plans/`. Confirm nothing has shipped between the date stamp on `~/dev/obsidian-brain/sessions/2026-05-04-iago-os-mwp-handoff.md` and now that further changes the picture.

2. **Council revision #1 — ship via `/iago-fast`.** Single command, ≤3 files:
   ```
   /iago-fast "fix clients/munet-web/CLAUDE.md content corruption — verify against clients/munet-web/package.json first (confirm Vitest + Biome status), then strip 'No test framework configured' line on line 22 + replace 'npm run lint  # Run ESLint' on line 18 with the actual lint/format/check command. Do not change other content."
   ```
   Build gate only. 10 minutes. Independent of MWP scope decision.

3. **Council revision #2 — architectural decision via `/brainstorming`.** Question: should the §3.4 "where new docs go" routing be (a) a `.claude/rules/routing.md` path-scoped rule with `paths: ["**/*.md", "**/*"]` so it auto-loads on any artifact write, (b) a `PreToolUse` hook on Write/Edit that reads CONTEXT.md before allowing a doc-create, (c) something else? Output: a spec written to `docs/specs/iago-os-mwp-routing-rule.md` that the cleanup or MWP feature plan can reference.

4. **Scope-decision answer (the fold-or-coexist question).** After reading the cleanup spec, write a one-paragraph decision in `.iago/context/2026-05-04-mwp-vs-cleanup-scope.md` that names: "MWP work folds into feature-iago-os-cleanup as items 6-N" OR "MWP work runs as its own feature-mwp-restructure". Defend with reasoning. If unclear, escalate one question to Santiago, no menu.

5. **Council revision #3 — Phase 2 re-plan.** Once the scope decision lands, the Phase 2 sequencing question collapses: if folded, MWP rides the cleanup PR's timeline (one bundled PR, ~2 days). If standalone, MWP runs as its own feature with its own waves. Council revision #3 was about avoiding the Week 6 buffer; both paths now avoid it because cleanup is a separate feature already.

6. **Phase 1 dormant-zone moves (M01-M12).** Once revisions #1-#3 are addressed, ship the M01-M12 batch. Per the freshness check, several may already be done (the `.iago/plans/` audit-NN cleanup matches M-rows that no longer apply). Re-verify the migration table against current repo state immediately before opening the PR — Reviewer 4's blind-spot rule.

### Hard constraints (do not violate)

1. **Don't break the review pipeline.** `scripts/execute-pipeline.sh` + GitHub Actions are battle-tested.
2. **Don't touch active client work.** Munet hotfix PR #77 is awaiting human merge — do not touch the branch. Munet `feat/roles-capability-refactor` is awaiting Amplify CI — do not touch.
3. **Don't touch settled code architecture.** React/Vite/TS/Amplify stack rules in `.claude/rules/` are settled.
4. **Don't propose absorbing iago-os ↔ iago-workspaces** (settled by 2026-04-21 council).
5. **STATE.md cap < 80 lines.** And note: the file is currently stale (`Updated: 2026-04-13` while the latest entry is 2026-05-04). Don't write to it during this session — `feature-iago-os-cleanup/01-cleanup-hygiene.md` Item 1 owns the discipline fix.
6. **Do not skip the freshness check** in step 1. The audit's premises drifted between 04-29 and 05-04; assume more drift may have happened since this prompt was written.

### What NOT to do

- Do NOT re-write the audit. It's frozen + counciled. If something changed materially, append a `## 9. Re-pickup notes` section, don't edit prior sections.
- Do NOT re-fire the council. The 3 revisions ARE the council's verdict; executing them needs no re-validation.
- Do NOT propose a new MWP scope without the cleanup spec read. The two specs interact.
- Do NOT use Edit/Write on `.iago/plans/` files in this session — `feature-iago-os-cleanup/01-cleanup-hygiene.md` is in flight.

### Tone

Opinionated, not menu-of-options (Santiago's `feedback_decisions` + `feedback_no_option_menus`). One verdict per question with reasoning. Reserve confirmation for irreversible actions (PR creation, file deletion).

If a decision is genuinely ambiguous, present 2 max with your recommendation marked.

### Output location for new artifacts this session produces

- Brainstorm spec for revision #2: `~/dev/iago-os/docs/specs/iago-os-mwp-routing-rule.md`
- Scope decision: `~/dev/iago-os/.iago/context/2026-05-04-mwp-vs-cleanup-scope.md`
- Re-pickup notes (if needed): append `## 9. Re-pickup notes` section to `~/dev/iago-os/.iago/research/2026-04-28-mwp-restructure-audit.md`
- Session digest at end: `~/dev/obsidian-brain/sessions/{today}-iago-os-mwp-revisions-execute.md`

### Final chat summary (after execution)

Give Santiago a 5-bullet handoff:
1. Revision #1 (Munet CLAUDE.md fix) — shipped or pending? PR/commit ref.
2. Revision #2 (routing rule architecture) — what was chosen, where the spec lives.
3. Scope decision (fold vs coexist) — verdict + reasoning.
4. What's next concrete action and which session-mode (`/iago-fast`, `/iago-quick`, `/iago-execute`, `/iago-plan`, `/brainstorming`).
5. Any new constraint or surprise that should change next-session planning.

---

End of prompt.
