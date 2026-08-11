---
name: Per-client deliverable repo + branch pattern
description: Every client deliverable = ilsantino planning repo + long-lived feat branch on client source repos; PRs target feat branch, never main directly
type: feedback
originSessionId: c2b34dac-2a7a-463a-a6be-e0b4fd00beee
---
Every client deliverable gets the same 3-layer git layout. Apply this without asking once `clients/{name}/{deliverable}/` exists or is about to start producing code.

**Layer 1 — Planning repo (ours).** `github.com/ilsantino/{client}-{deliverable-slug}` (private). Holds briefing, architecture, intent contracts, mockups, stage gate outputs, project-level `.claude/CLAUDE.md`. Local path: `clients/{client}/{deliverable}/` is a git repo of its own — gitignored from iago-os via the `clients/` rule, so the nested .git is invisible to iago-os. Must `.gitignore` `repos/` and `.env*` at planning root.

**Docs vs development PR rule (Santiago, 2026-05-28).** Planning-repo **docs/stage-gate artifacts commit direct to `main`, NO PR** — they are gated by Santiago's per-stage "go" (the human read-and-approve gate), so a GitHub PR would be self-review of design docs. PRs are ONLY for **development/code** (Layer 3, the source repos). Do not create PRs for planning-repo markdown. This matches FullData precedent: stages 00–02 all committed straight to the planning-repo `main`, zero PRs.

**Layer 2 — Source repos (theirs).** Client owns these. Clone read-only into `clients/{client}/{deliverable}/repos/{RepoName}/`. Never push to their `main` directly. Create a **long-lived integration branch** on EACH source repo (named to match the client's convention — check existing branches first; onetuweb uses `feat-{slug}`, others may use `feat/{slug}` or `feature/{slug}`).

**Layer 3 — Stage PRs (the workflow).** Every implementation PR targets the long-lived feat branch, not the client's main. Stages 03/04/05 each spawn small PRs into `feat-{slug}` on the relevant source repo. Once Stage 05 testing passes end-to-end, a SINGLE final PR `feat-{slug} → main` per source repo for the client to review/merge.

**Why:** Pushing directly to client main risks contaminating their production line during multi-week builds. The long-lived feat branch is the integration target we control end-to-end; the final feat→main PR is the only thing the client has to review. Planning repo separates client-confidential strategy (briefings, cost notes, prompts) from their codebase. This pattern was set with FullData bot asistente on 2026-05-28 and matches the existing precedent for DIN (`dinpro-pricing`), FullData pricing mock (`fulldata-pricing-mock`), and Sentria (`bas-labs/sentria`).

**How to apply:**

1. **Verify access on the client's source repos first** via `gh api repos/{org}/{repo} --jq '.permissions'`. Need `push: true`. If `push: false`, stop and ask Santiago to request a seat in their org before going further.

2. **Check existing branches** on the client's source repos via `gh api repos/{org}/{repo}/branches --jq '.[].name'`. Match their naming convention exactly when picking the long-lived feat branch name.

3. **Create the long-lived branches** from latest `main` on each client source repo. Pull main first, then `git checkout -b feat-{slug}` and `git push -u origin feat-{slug}`.

4. **Create the ilsantino planning repo** via `gh repo create ilsantino/{client}-{deliverable-slug} --private --description "..."`. Description should name the source repos + branch.

5. **Init the planning git inside the local planning dir** (`git init -b main` inside `clients/{client}/{deliverable}/`, add remote, `git add -A`, commit with conventional prefix). Verify `.gitignore` excludes `repos/` and `.env*` BEFORE the first commit. After init verify `git rev-parse --show-toplevel` resolves to the planning dir, not iago-os — if it resolves to iago-os, the nested init failed silently and you must rerun it.

6. **Write a README at the planning root** that names the source repos + long-lived branch + current stage gate status. The team reads this to know where the actual code lives.

7. **Save a reference memory** at `reference_{client}_{deliverable}.md` with the planning repo URL, source repos, branch name, and access scope (push/admin/triage) so the next session knows the layout cold.

**Anti-patterns this rule blocks:**
- Pushing implementation PRs directly to a client's `main`.
- Adding workspace docs to iago-os's git history (the `clients/` gitignore already prevents this, but a forgotten `git add -f` would slip through).
- Mixing planning content (briefings, pricing, prompts) into the client's source repo — wrong audience, wrong long-term home.
- Creating per-stage feat branches on the client's source repo (e.g., `feat-stage-03-impl`). Stages get PRs INTO the long-lived branch, not their own branches off main.
