# Prompt: iago-os MWP — verify Wave A merges + prep Wave B

**Use this in a fresh Claude session.** Self-contained — does not depend on prior conversation context.

**Invoke:**
```
cd ~/dev/iago-os && claude
```
Then paste the prompt below (or reference: "Read `.iago/prompts/iago-os-mwp-wave-a-merge-and-wave-b-prep.md` and execute it.")

---

## Prompt

You are picking up the iago-os MWP restructure work after Wave A shipped. The previous session (2026-05-04) opened 3 PRs across 2 repos. Today's date may be later than 2026-05-04 — verify with the system date and re-ground before assuming any of those PRs are still open.

### Context (read in this order)

1. **`~/dev/obsidian-brain/sessions/2026-05-04-iago-os-mwp-revisions-execute.md`** — full digest of the Wave A session. PR refs, decisions made, surprises encountered. Read first.

2. **`~/dev/iago-os/.iago/research/2026-04-28-mwp-restructure-audit.md`** §3.2 (migration table) and §5.2 (Phase 2 sequencing). Wave B = M13–M21 + M22–M23.

3. **`~/dev/iago-os/docs/specs/iago-os-mwp-routing-rule.md`** — Council Rev #2 spec. The routing rule needs to land in root CLAUDE.md as part of Wave B's M13 trim (or pulled forward as standalone — see §1.5 of the spec).

4. **`~/dev/iago-os/.iago/context/2026-05-04-mwp-vs-cleanup-scope.md`** — fold-vs-coexist verdict. Confirms MWP runs as separate `feature-mwp-restructure`.

5. **`~/dev/iago-os/.iago/STATE.md`** — current iago-os state. Note: was stale at start of last session (Updated: 2026-04-13); the cleanup PR's Item 1 was the discipline fix. Treat with suspicion; verify against `git log -10 origin/main`.

6. **`~/dev/iago-os/clients/munet-web/.iago/STATE.md`** — Munet current state.

### Last-session state to verify (5-min freshness check)

PRs that should exist (created 2026-05-04):
- **bas-labs/munet-web#88** — Rev #1 CLAUDE.md Vitest fix
- **ilsantino/iago-os#33** — Wave A (M01 + M02 + scope-decision artifact)
- **bas-labs/munet-web#89** — Wave A archives (M09+M10+M11)

Run `gh pr view 88 -R bas-labs/munet-web --json state,mergedAt,mergeCommit`, same for #33 (iago-os), #89 (munet-web). Possible states:
- **All 3 merged** → proceed to Wave B prep + M06 decision.
- **Some still open** → check for review feedback; if findings, run `/iago-prfix` on each PR with feedback (don't double-tag @claude).
- **Any closed without merge** → escalate to Santiago, do NOT re-open without his go-ahead.

Also run:
- `git -C ~/dev/iago-os log --oneline -10` (confirm main moved as expected)
- `git -C ~/dev/iago-os/clients/munet-web log --oneline -10` (confirm Munet main state)
- `git -C ~/dev/iago-os/clients/munet-web branch --show-current` (was on `preview/incidents-02-ui` last session, should still be — but origin/main has moved past it)

### What to do (sequenced)

1. **Freshness check** (above). Stop if any PR is closed-without-merge and ask Santiago.

2. **Sweep MEMORY.md `project_munet_playbook` pointer if M06 was decided.**
   - If M06 was decided to land the playbook → update `~/.claude/projects/C--Users-sanal-dev-iago-os/memory/project_munet_playbook.md` to the new path (likely `clients/munet-web/.iago/research/munet-web-playbook.md` per audit M06).
   - If M06 deferred → update the same memory entry to note "playbook v2 lives on `wip/munet-web-playbook-v2` branch only; not merged to main as of {today}."
   - Either way, this is a single memory file edit — not a PR.

3. **Munet `preview/incidents-02-ui` rebase question.** Last session noted Munet PR #84 (feature-incidents Plan 02 frontend) merged to origin/main during the Wave A work, which puts `preview/incidents-02-ui` behind. **Do NOT rebase that branch yourself** — ask Santiago first; another session may own it. Just flag it in your handoff if it's still behind.

4. **Wave B precondition check — has council-roadmap Wave 2 shipped?**
   - Wave 2 = wedges K (pre-stage gate), H (Stripe-events), D (doc-only). Audit §5.2: "Sequence MWP Phase 2 AFTER Wave 2 to avoid file collisions."
   - Check `docs/specs/iago-os-roadmap.md` for Wave 2 status.
   - Run `git log --all --oneline --grep="wedge K\|wedge H\|wedge D"` — if all 3 wedges have commits on main, Wave 2 has shipped. If not, Wave B is **NOT YET READY** to plan.
   - **If Wave 2 has not shipped yet:** STOP after step 3. Report Wave A merge status + M06 decision status + "Wave B blocked on council-roadmap Wave 2 completion" to Santiago. Do not write a Wave B plan.

5. **If Wave 2 has shipped: plan Wave B via `/iago-plan --feature`.**
   ```
   /iago-plan --feature docs/specs/iago-os-mwp-routing-rule.md
   ```
   - Plan should fold in M13 (root CLAUDE.md trim 209→≤80 incorporating the routing rule), M14 (extract CI review boilerplate to `.claude/rules/ci-review.md`), M15-M16 (Munet CLAUDE.md trim + CONTEXT.md), M17-M19 (Sentria CLAUDE.md trim + CONTEXT.md + `.iago/` scaffold), M20 (FullData CLAUDE.md + CONTEXT.md), M21 (workspace router at `clients/CLAUDE.md`), M22 (template update), M23 (MEMORY.md sweep post-merge).
   - Two-PR chain per audit §5.2: PR #1 pure `git mv` + new file creation, PR #2 path-fix sweep.
   - **Slack window required** before merging Wave B: "Sebas, landing iago-os MWP Wave B PR Friday EOD. Merge or close anything touching `.claude/rules/` or `clients/*/CLAUDE.md` before then." Audit §5.2 verbatim.
   - Stress-test the plan via `/iago-stress --deep` BEFORE execution. Wave B touches load-bearing infrastructure.

6. **DO NOT execute Wave B without Santiago's explicit go-ahead.** Plan + stress-test only. Stop and hand off the plan + stress-test results.

### Hard constraints (do not violate)

1. **Don't touch active client work.** Munet `preview/incidents-02-ui`, `feat/roles-capability-refactor`, and any in-flight branch — leave alone unless explicitly authorized. Verify all branches with `git branch -a` and check for uncommitted modifications before touching anything.
2. **Don't break the review pipeline.** `scripts/execute-pipeline.sh` + GitHub Actions are battle-tested.
3. **Don't propose absorbing iago-os ↔ iago-workspaces** (settled by 2026-04-21 council).
4. **STATE.md cap < 80 lines.** Update only if Wave A merges have shipped (cleanup PR's Item 1 owns the discipline fix).
5. **Do not re-fire the council** for Phase 2. The audit + 3 council revisions are settled. Plan execution, don't re-validate.
6. **Use `git -C <path>`** for any cross-repo work (iago-os ↔ Munet). Bash `cd` doesn't reliably persist between Bash tool calls in some sessions; chain commands in single calls or use `git -C` to bypass.
7. **Worktrees per session.** If running concurrent Claude sessions on iago-os or Munet, use `git worktree add` per `feedback_worktree_per_session`. Last session caught a near-miss where `git mv` operations landed in the wrong worktree because of cwd drift.
8. **No skip flags on the pipeline.** `/iago-fast` only for trivial ≤3-file changes; `/iago-quick` or full `/iago-execute` for everything else.

### What NOT to do

- Do NOT execute Wave B implementation. This session plans + stress-tests only.
- Do NOT re-write the audit. If something materially changed, append to `## 9. Re-pickup notes`.
- Do NOT touch the merged Wave A PRs (#88, #33, #89) unless they have unmerged review findings — and even then, route via `/iago-prfix`.
- Do NOT update `MEMORY.md` (`~/.claude/projects/.../memory/MEMORY.md`) outside of Step 2's `project_munet_playbook` entry. The frozen-snapshot rule still applies.

### Tone

Opinionated, not menu-of-options. One verdict per question with reasoning. Reserve confirmation for irreversible actions (PR creation, merging, file deletion).

### Output location for new artifacts this session produces

- Wave B plan: `.iago/plans/feature-mwp-restructure/01-wave-b-structural.md` (or 01 + 02 if the two-PR chain warrants two plans)
- Stress-test results: stress test section embedded in the plan files (per pipeline step 0 convention)
- Re-pickup notes (if needed): append `## 9. Re-pickup notes` to `~/dev/iago-os/.iago/research/2026-04-28-mwp-restructure-audit.md`
- Session digest at end: `~/dev/obsidian-brain/sessions/{today}-iago-os-mwp-wave-a-merge-and-wave-b-prep.md`

### Final chat summary (after execution)

Give Santiago a 5-bullet handoff:
1. Wave A merge status — 3 PRs (Rev #1, iago-os Wave A, Munet Wave A): merged / open / closed.
2. M06 decision status — landed / deferred / still pending; MEMORY pointer updated.
3. Munet `preview/incidents-02-ui` rebase status — flagged or done by another session.
4. Wave B plan status — written / blocked-on-Wave-2 / written-and-stress-tested.
5. Any new constraint or surprise that should change next-session planning.

---

End of prompt.
