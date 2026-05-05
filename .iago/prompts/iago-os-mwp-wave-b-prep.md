# Prompt: iago-os MWP — M06 decision + Wave B prep

**Use this in a fresh Claude session.** Self-contained — does not depend on prior conversation context.

**Invoke:**
```
cd ~/dev/iago-os && claude
```
Then paste the prompt below (or reference: "Read `.iago/prompts/iago-os-mwp-wave-b-prep.md` and execute it.")

---

## Prompt

You are picking up the iago-os MWP restructure work after Wave A merged. The previous session (2026-05-04) shipped 3 PRs across 2 repos (Munet #88 Vitest fix, iago-os #33 dormant moves M01+M02, Munet #89 root-orphan archives M09+M10+M11) — all confirmed merged by Santiago. Today's date may be later than 2026-05-04 — verify with the system date and re-ground before assuming any state from the digest.

### Context (read in this order)

1. **`~/dev/obsidian-brain/sessions/2026-05-04-iago-os-mwp-revisions-execute.md`** — full digest of the Wave A session. Decisions, surprises, files changed.

2. **`~/dev/iago-os/.iago/research/2026-04-28-mwp-restructure-audit.md`** — full MWP audit. Most relevant for this session: §3.2 (migration table M13–M23), §3.3 (per-client CLAUDE.md skeleton), §3.5 (workspace map), §4.1–4.3 (tradeoffs/risks), §5.2 (Phase 2 sequencing), §8.3 (council synthesis), §8.4 (recs changed). Phase 1 sections (§5.1, M01–M12) are now mostly history — read only as context for what shipped.

3. **`~/dev/iago-os/docs/specs/iago-os-mwp-routing-rule.md`** — Council Rev #2 spec. The verdict was Option A (inline routing rule in root CLAUDE.md). Either pull forward as standalone OR fold into Wave B M13. Recommendation already documented in the spec's §1.5.

4. **`~/dev/iago-os/.iago/context/2026-05-04-mwp-vs-cleanup-scope.md`** — fold-vs-coexist verdict. MWP runs as `feature-mwp-restructure`; this session creates Wave B plans under `.iago/plans/feature-mwp-restructure/`.

5. **`~/dev/iago-os/.iago/STATE.md`** — current iago-os state (cleanup PR's Item 1 was the discipline fix; should now be fresh).

6. **`~/dev/iago-os/clients/munet-web/.iago/STATE.md`** — Munet current state. Note: previous session noted `preview/incidents-02-ui` was behind origin/main after PR #84 merged. May or may not have been rebased since.

7. **`~/dev/iago-os/docs/specs/iago-os-roadmap.md`** — Phase 0.3 canonical roadmap. Critical for Wave B precondition: confirm Wave 2 (wedges K + H + D) shipped status.

### Freshness micro-check (5-min)

```bash
git -C ~/dev/iago-os log --oneline -15
git -C ~/dev/iago-os/clients/munet-web log --oneline -10
git -C ~/dev/iago-os/clients/munet-web branch --show-current
ls ~/dev/iago-os/.iago/plans/feature-mwp-restructure/ 2>&1 || echo "no Wave B plans yet"
```

Cross-check: does iago-os main contain the Wave A commits (`chore(iago): MWP Wave A — dormant-zone cleanup`)? If not, Wave A may have been rebased away — escalate to Santiago.

### What to do (sequenced)

1. **Read the digest + audit sections + roadmap.** Re-ground.

2. **M06 decision — `wip/munet-web-playbook-v2` destination.** This was deferred from Wave A. Three options:
   - (a) Land the playbook on Munet's main as `clients/munet-web/.iago/research/munet-web-playbook.md` (audit M06's intent — Munet-specific business context belongs in Munet).
   - (b) Land on iago-os as `docs/research/munet-web-playbook.md` (where MEMORY pointer claims it lives, but contradicts MWP audit's "client-specific → clients/{name}/").
   - (c) Leave on the wip branch indefinitely as draft material.
   - **Verdict-required.** Read `git log wip/munet-web-playbook-v2 --oneline -5` to see what's there. Pick (a), (b), or (c) with reasoning, name the choice in your handoff. If (a) or (b): ship via `/iago-fast` (single-file move) AFTER the user authorizes.
   - Update `~/.claude/projects/C--Users-sanal-dev-iago-os/memory/project_munet_playbook.md` MEMORY entry to reflect the new state regardless of choice.

3. **Wave B precondition check — has council-roadmap Wave 2 shipped?**
   - Wave 2 = wedges K (pre-stage gate), H (Stripe-events), D (doc-only). Audit §5.2 says: "Sequence MWP Phase 2 AFTER Wave 2 to avoid file collisions" (Wave 2 touches `.claude/rules/`, `scripts/lib/build-gate.sh`, new endpoint module).
   - Check `docs/specs/iago-os-roadmap.md` for Wave 2 status.
   - Run `git log --all --oneline --grep="wedge K\|wedge H\|wedge D\|Wave 2"` — if all 3 wedges have commits on main, Wave 2 has shipped.
   - **If Wave 2 has NOT shipped:** STOP after step 2. Hand off: M06 decision + status + "Wave B blocked on council-roadmap Wave 2 completion" + estimated Wave 2 completion date if visible. Do not write a Wave B plan.
   - **If Wave 2 HAS shipped:** proceed to step 4.

4. **Plan Wave B via `/iago-plan --feature`.**
   ```
   /iago-plan --feature docs/specs/iago-os-mwp-routing-rule.md
   ```
   Wave B scope (from audit §3.2 M13–M23):
   - **M13** — Trim root `CLAUDE.md` 209→≤80 lines; **incorporate** the routing-rule spec inline (the Rev #2 verdict). Per the spec, this is the post-trim allocation, not addition on top.
   - **M14** — Extract CI review boilerplate from per-client CLAUDE.md to `.claude/rules/ci-review.md` (universal).
   - **M15** — Trim `clients/munet-web/CLAUDE.md` to ≤15 lines (per audit §2.3 minimal skeleton); architecture description → `clients/munet-web/CONTEXT.md`.
   - **M16** — Add `clients/munet-web/CONTEXT.md` (NEW): business context + open questions.
   - **M17** — Trim `clients/sentria/CLAUDE.md` similarly.
   - **M18** — Add `clients/sentria/CONTEXT.md` (NEW).
   - **M19** — Scaffold `clients/sentria/.iago/` from `templates/client-project/.iago/` (currently sentria has no scaffolding).
   - **M20** — Add `clients/fulldata/CLAUDE.md` + `CONTEXT.md` (NEW): document research-deliverable status (per Decision Request #5 in audit §6 — confirm with Santiago whether FullData is research-only or growing into code-delivery).
   - **M21** — Add `clients/CLAUDE.md` workspace router (active clients table + routing).
   - **M22** — Update `templates/client-project/` to match new conventions.
   - **M23** — Sweep MEMORY.md + obsidian-brain notes for path-pointer drift (post-merge).

5. **Plan structure: TWO PRs, sequenced.** Per audit §5.2 + Q4 §2.4: PR #1 pure `git mv` + new file creation. PR #2 path-fix sweep (any cross-references that point at moved files). Sub-plans should reflect this:
   - `.iago/plans/feature-mwp-restructure/01-wave-b-pure-moves.md` — M13 (trim + routing rule inline), M14 (extract ci-review), M15+M17 (trim per-client), M16+M18+M20 (new CONTEXT.md), M19 (sentria scaffold), M21 (clients/CLAUDE.md), M22 (templates).
   - `.iago/plans/feature-mwp-restructure/02-wave-b-path-fixes.md` — sweep CLAUDE.md cross-references, README internal links, MEMORY.md pointer updates (M23). May fold into pipeline summary stage if minimal.

6. **Stress-test the plans.**
   ```
   /iago-stress --deep .iago/plans/feature-mwp-restructure/
   ```
   Wave B touches load-bearing infrastructure (root CLAUDE.md, `.claude/rules/`, every client's CLAUDE.md). Stress test must surface: pipeline-regression risk (extracted rules), per-client CLAUDE.md regression (run `/code-review` dry-run on a recent munet-web PR with new vs old CLAUDE.md before merging), CONTEXT.md vs PROJECT.md confusion, MEMORY.md pointer rot.

7. **STOP and hand off the plan + stress-test results.** Do NOT execute Wave B implementation in this session. Santiago needs to coordinate the Slack window with Sebas before Wave B PR opens.

### Hard constraints (do not violate)

1. **Don't touch active client work.** Munet `preview/incidents-02-ui`, `feat/roles-capability-refactor`, any in-flight branch — leave alone unless explicitly authorized. Verify branches with `git branch -a` and check for uncommitted modifications before touching anything.
2. **Don't break the review pipeline.** `scripts/execute-pipeline.sh` + GitHub Actions are battle-tested.
3. **Don't propose absorbing iago-os ↔ iago-workspaces** (settled by 2026-04-21 council).
4. **STATE.md cap < 80 lines.** Update only after Wave B PR merges (separate session).
5. **Do not re-fire the council** for Phase 2. The audit + 3 council revisions are settled. Plan execution, don't re-validate.
6. **Use `git -C <path>`** for any cross-repo work (iago-os ↔ Munet). Bash `cd` doesn't reliably persist between Bash tool calls in some sessions; chain commands in single calls or use `git -C`.
7. **Worktrees per session.** If creating worktrees, **clean them up** (`git worktree remove --force <path>` + `rm -rf <dir>` if Windows handle release fails). Last session left two leftover worktrees on disk — `iago-wt-clean` is the recovery path. Don't repeat the mistake.
8. **No skip flags on the pipeline.** `/iago-fast` only for trivial ≤3-file changes; `/iago-quick` or full `/iago-execute` for everything else.
9. **Slack window required for Wave B.** Audit §5.2 verbatim: "Sebas, landing iago-os MWP restructure PR Friday EOD. Merge or close anything touching `.claude/rules/` or `clients/*/CLAUDE.md` before then." Santiago coordinates this; do NOT message Sebas yourself.

### What NOT to do

- Do NOT execute Wave B implementation. This session plans + stress-tests only.
- Do NOT re-write the audit. If something materially changed, append to `## 9. Re-pickup notes`.
- Do NOT touch the merged Wave A PRs (#88, #33, #89). They're history.
- Do NOT update `MEMORY.md` (`~/.claude/projects/.../memory/MEMORY.md`) outside of Step 2's `project_munet_playbook` entry. The frozen-snapshot rule still applies.
- Do NOT proceed to step 4 if Wave 2 hasn't shipped (step 3 gate).

### Tone

Opinionated, not menu-of-options. One verdict per question with reasoning. Reserve confirmation for irreversible actions (PR creation, file deletion, worktree creation).

### Output location for new artifacts

- M06 decision: brief decision-line in your handoff + (if landing the playbook) a `/iago-fast` PR after authorization.
- Wave B plans: `.iago/plans/feature-mwp-restructure/01-wave-b-pure-moves.md` + `02-wave-b-path-fixes.md` (or just 01 if scope shrinks).
- Stress-test results: embedded in plan files (per pipeline step 0 convention).
- Re-pickup notes (if needed): append `## 9. Re-pickup notes` to `~/dev/iago-os/.iago/research/2026-04-28-mwp-restructure-audit.md`.
- Session digest at end: `~/dev/obsidian-brain/sessions/{today}-iago-os-mwp-wave-b-prep.md`.

### Final chat summary (after execution)

5-bullet handoff:
1. Freshness verification — Wave A commits present on main? Munet `preview/incidents-02-ui` rebase status?
2. M06 verdict + reasoning + MEMORY pointer status.
3. Wave 2 status — shipped / not shipped / partial.
4. Wave B plan status — written / blocked-on-Wave-2 / written-and-stress-tested. If written, name the plan files + verdict from stress test.
5. Any new constraint or surprise that should change next-session planning. Specifically flag any worktrees you created so they can be cleaned up.

---

End of prompt.
