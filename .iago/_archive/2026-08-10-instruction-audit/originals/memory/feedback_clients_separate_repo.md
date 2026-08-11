---
name: clients/ never in iago-os repo
description: Client deliverables, scaffolds, mocks live in separate per-client GitHub repos — never pushed to iago-os
type: feedback
originSessionId: 7e516012-5bec-4519-9391-2b8b67ed3c7e
---
iago-os repo is **strictly** for iago-os operating infrastructure (skills, hooks, scripts, agents, rules, .iago/* metadata). Client work — anything under `clients/{name}/` — is private and lives in its own GitHub repo.

`clients/` is gitignored at iago-os root (line 23 of .gitignore) and that's enforced for a reason: client code, branding, financials, and deliverables never enter the iago-os git history.

**Why:** iago-os is the consultancy's open operating layer (intended to be reusable / shareable); client repos are private business assets. Mixing them leaks client material via iago-os history and bloats what should be a tiny config layer. Santiago made this rule explicit on 2026-05-05 after I almost pushed a FullData pricing mock PR onto iago-os via `/iago-quick`.

**How to apply:**

When `/iago-quick` or `/iago-execute` would scaffold/produce code under `clients/{name}/{deliverable}/`:

1. **STOP before launching the pipeline at iago-os root.** The pipeline's PR step would push to whatever git repo `--project-dir` resolves to. iago-os root → iago-os PR. Wrong destination.

2. **Create the client deliverable's own GitHub repo first.** Under `ilsantino` (personal) by default, unless Santiago specifies an org (e.g., `bas-labs`). Naming: `{client}-{deliverable-slug}` — e.g., `fulldata-pricing-mock`, `munet-panel-ejemplo`. Visibility: private unless told otherwise.

3. **`git init` inside the client subdirectory** (`clients/fulldata/web-pricing-mock/`), set remote to the new repo, and pass that subdirectory as `--project-dir` to the pipeline. The pipeline's PR push then lands on the client repo, not iago-os.

4. **`.iago/plans/{plan}.md` and `.iago/logs/{plan}.log` MAY live in iago-os** because they are metadata about how iago-os orchestrated the work. But their *content* must not leak client-confidential business specifics. If a plan body needs detailed pricing/financials/architecture from the client, keep it in the client repo's own `.iago/plans/` instead.

5. **Vercel / deploy targets** point at the client repo, not iago-os. Root-dir override unnecessary because the client repo IS the deliverable root.

**Anti-pattern that triggered this rule:** running `/iago-quick "Scaffold at clients/fulldata/web-pricing-mock/"` with `--project-dir $(pwd)` at iago-os root. Even though `clients/` is gitignored (so the actual scaffold code wouldn't get committed), the pipeline still creates a PR on iago-os with the plan + log file as new commits. iago-os receives a PR full of FullData-flavored metadata. Wrong repo, wrong audience, wrong long-term home for the artifact.
