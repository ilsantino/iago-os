---
name: Check for inner repo before touching clients/*
description: Before any git op on clients/{name}/, check for {client}/.git inner repo and use IT, not iago-os outer
type: feedback
originSessionId: 2bf07a4d-471a-4538-8de5-a4d045f3ac2b
---
Before staging, committing, or pushing anything under `clients/{name}/{project}/`, FIRST check whether that directory has its own `.git/` (inner repo) pointing at a separate GitHub repo.

**Why:** clients/* directories often live as inner git repos pointing at per-client GitHub repos (pattern: `ilsantino/{client}-{project}`). The outer iago-os repo has `clients/` in `.gitignore`, but earlier scaffold commits sometimes force-added files past the ignore. When that happens, modifications to inner-repo files appear in BOTH the inner repo's `git status` AND the outer iago-os `git status` — they look like uncommitted iago-os changes but are already committed inside the inner repo. Committing them again at the iago-os layer pushes client code into the wrong repo. This happened on 2026-05-06 with `clients/fulldata/web-pricing-mock/` (PR #35 in iago-os, had to be closed and branch deleted) — Santiago was rightly furious. Even worse: I saw the gitignore conflict signal during staging (`The following paths are ignored by one of your .gitignore files: clients`) and used `git add -u` to bypass it instead of stopping to ask why.

**How to apply:**
1. Before any `git add`/commit involving `clients/{name}/`, run `ls -la clients/{name}/{project}/.git 2>&1` and `cat clients/{name}/{project}/.git/config | grep url` to find the real remote.
2. If `.git` exists with a non-iago-os remote, all work goes through that inner repo: `cd` into it, `git status`/`add`/`commit`/`push` from there. Outer iago-os stays out of it entirely.
3. If git complains "paths are ignored by one of your .gitignore files" while staging client files, STOP. Do not use `-f` or `-u` to bypass — investigate. The ignore is likely correct and there's an inner repo waiting.
4. Confirmed inner repos so far: `clients/din/dinpro-app/` → `ilsantino/dinpro-pricing`; `clients/fulldata/web-pricing-mock/` → `ilsantino/fulldata-pricing-mock`. Same pattern likely for future clients.
