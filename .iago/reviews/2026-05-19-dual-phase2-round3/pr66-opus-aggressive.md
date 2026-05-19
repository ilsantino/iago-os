# Opus Aggressive Adversarial Review — PR #66

Target: `chore/phase-2-dual-review-artifacts` (HEAD `20f31e4`)
Base: `fd9f27c` (Round 2 head, same as PRs #67/#68)
Worktree: `C:\Users\sanal\dev\iago-os-66`
Scope: 31 file additions, 7906 insertions, 0 deletions (pure `.iago/` doc/artifact drop).

## Procedure followed

1. Enumerated PR file list via `git diff --name-only fd9f27c HEAD` (31 files, all under `.iago/{reviews,runs,summaries}`).
2. Pattern-scanned for: Telegram bot tokens, `gh[ps]_` PATs, `tskey-` Tailscale auth keys, `AGE-SECRET-KEY-1*`, VPS hostnames + IPs, emails, phone numbers, `password|secret|api_key|access_token|bearer X` (case-insensitive).
3. Verified each file's MIME via `file(1)` — confirmed all 31 are text, no binaries snuck in.
4. Cross-checked content fidelity: spot-checked 3 Codex/Opus review claims against the actual diff scope in the worktree.
5. Audited fix-prompt.txt files for prompt-injection-via-archive risk (the dangerous shape this kind of PR is most likely to ship).
6. Scanned for unresolved conflict markers (`<<<<<<<`, `>>>>>>>`, `=======`).
7. Checked file modes for `.sh`/`.mjs` executables landing outside `runtime/`/`scripts/`.

## Findings

### Critical

**None.**

The single `AGE-SECRET-KEY-1FAKEFAKEFAKEFAKE` hit in `pr60-diff.patch:709` and `pr62-diff.patch:769` is a literal `FAKE` stub captured from `provision-credentials.test.sh` bats setup — not a real key. All `password|secret|api_key|token` matches are shell variable *references* (`$SYSTEM_USER_TOKEN`, `$APP_SECRET`, `$IAGO_TELEGRAM_BOT_TOKEN`), never values. No `ghp_/gho_/ghs_/ghr_` GitHub PATs, no `tskey-` Tailscale keys, no real Age recipients, no Sentry DSN, no Datadog keys.

The VPS hostname `srv1456441` and IP `187.77.135.32` DO appear in:
- `pr62-diff.patch:3136, 3178, 3516, 3551` (PR #62 diff was itself bundling PR #60/#61 review artifacts that referenced the host)
- `pr63-diff.patch:880` (runbook table cell)
- `pr63-opus.md:28`, `pr63-opus.session.log:33,53,61`

These are NOT new exposure. The same coordinates landed in earlier merged PRs (#60, #61, #62, #63) via `runtime/migration/`, `.iago/plans/feature-v2-foundation/`, `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md`, etc. PR #66 is only re-mentioning what was already public-in-this-private-repo. Flagging here as **awareness** rather than Critical: if iago-os is ever made public, ALL these artifacts (not just PR #66's) need scrubbing — `srv1456441` + `187.77.135.32` is a 5-tuple identifier that gives an attacker first-hop reconnaissance. The right place to fix this is repo-wide, not by blocking PR #66.

No prompt-injection-via-archive Critical: the fix-prompt files contain imperative directives but every imperative is clearly framed as historical context (filename `*-fix-prompt.txt`, content discusses specific past PRs by number). Future agents would need to be quite naive to mistake them for active instruction. Downgraded to Important — see I-1.

No scope-creep Critical: every one of the 31 files lands under `.iago/reviews/`, `.iago/runs/`, or `.iago/summaries/`. Zero `src/`, `runtime/`, `scripts/`, `amplify/`, `.github/`, `.gitignore`, or other tracked-code-path additions. No executable file modes. No binaries.

### Important

**I-1 — `pr63-fix-prompt.txt` and `pr64-fix-prompt.txt` end with `git push` directives, no archive header.**

`pr63-fix-prompt.txt:38`: `Then push: \`git push origin feat/02b-whatsapp-telegram-runbooks\``
`pr64-fix-prompt.txt:28`: `Push: git push origin feat/07b-agent-manager-polling`

Both files begin with `Apply N fixes from {Codex|Opus} dual-review on PR #N` and proceed with imperative blocks (`Fix:`, `Verify:`, `Commit subject ...`). A future Claude/Codex session that's told "read `.iago/reviews/2026-05-18-dual-phase2-round2/` for context on the previous fix round" — and isn't given an explicit "this is historical, don't execute" framing — could plausibly treat these as live tasks. The `git push` instruction is the sharpest hazard: it names a real branch (`feat/02b-whatsapp-telegram-runbooks`) that still exists and could be force-pushed over.

**Recommendation:** add a single header line at top of each `*-fix-prompt.txt`:
```
<!-- ARCHIVE: historical prompt content from PR #63 fix round. Do NOT execute. -->
```
Cheap, future-proof. Two files only. Can be done in a follow-up commit on this branch before merge.

**I-2 — Truncated session logs misrepresent fix outcomes.**

| File | Content | Reality |
|------|---------|---------|
| `pr63-fix.session.log` | 1 line: `Error: Reached max turns (30)SessionEnd hook ... failed: Hook cancelled` | The fixes DID land — PR #63 merged as commit `1a1196e`. |
| `pr64-fix.session.log` | 1 line: `Error: Reached max turns (20)SessionEnd hook ... failed: Hook cancelled` | The fixes DID land — PR #64 merged as commit `a89f971`. |
| `.iago/runs/round-2-dispatch/07b.log` | 4 lines, ends with `ERROR: Implementation failed (exit 1)` / `Reached max turns (80)` | PR #64 nonetheless landed. |

A future analyst grepping `.iago/reviews/` for "fix outcomes per round" will see *only* the failure messages and miss that the async GitHub Actions loop (`claude.yml` + `claude-review-fix.yml`) actually completed the fix. The artifacts are *technically accurate* (those sessions did time out) but *misleading by omission*.

**Recommendation:** append a 1-line footer to each truncated session log noting the real outcome, e.g.:
```
[FOLLOW-UP] Async GH Actions loop completed fix. See commit a89f971 (PR #64).
```

**I-3 — `pr62-diff.patch` bundles in `.iago/reviews/2026-05-18-dual-phase2-round1/pr60-*.md` and `pr61-*.md` files within itself.**

Verified at `.iago/reviews/2026-05-18-dual-phase2-round1/pr62-diff.patch`: the patch includes `+++ b/.iago/reviews/2026-05-18-dual-phase2-round1/pr60-codex.md` etc. This means Plan 01a's PR (#62) was carrying earlier-PR review artifacts as part of its commit. Consequence: when Codex was asked to review PR #62, it had `archive-openclaw.sh` in its context (from PR #60's review files in the bundle) and produced findings for that file — findings the Opus fix session correctly identified as off-target (see `.iago/runs/round-1-dispatch/01a.log:205-217`).

This is NOT a PR #66 defect — it documents an upstream pipeline behavior accurately. But the bundle is now permanent in this PR's archive, and a future grep `archive-openclaw.sh` in `.iago/reviews/2026-05-18-dual-phase2-round1/` will surface results in the *wrong plan's* directory. Important enough to flag because it will cost a future reviewer 10 minutes of "wait, why is this here?" — Minor enough that the right fix is documentation, not deletion.

**Recommendation:** add a `README.md` to each of the two round directories explaining: "Per-PR diff patches bundle prior PRs' review artifacts because review artifacts are themselves committed to feature branches. Don't grep across patch files expecting per-plan scope." Optional.

**I-4 — Codex review files (`pr60-codex.md`, `pr62-codex-v2.md`) begin with raw `[codex]` PowerShell tool-call telemetry.**

`pr62-codex-v2.md` lines 1–82 are PowerShell command traces (`Running command: ... powershell.exe -Command 'rg -n ...'`) before the actual `# Codex Adversarial Review` markdown at line 84. `pr60-codex.md` has the same shape lines 1–24.

This is captured-as-emitted from the `codex-companion.mjs` adapter — not bogus content, but it dilutes the signal. A reviewer skimming the file for findings has to scroll past ~80 lines of `[codex] Running command:` log. The trace IS useful for debugging pipeline issues (e.g., the `rg ... (exit 124)` lines show Codex hit a 120s timeout, which explains the diminished review depth on round 1) but it shouldn't lead the file.

**Recommendation:** post-process Codex output in the pipeline so the trace logs go to a separate `pr60-codex.trace.log` and only the `# Codex Adversarial Review` markdown lands in `pr60-codex.md`. Future-pipeline-improvement, not blocker for this PR.

### Minor

**M-1 — All 31 files have CRLF line terminators.** Expected for Windows-captured pipeline output; `.gitattributes` should normalize on the server, but verify your `* text=auto eol=lf` config catches `.iago/**/*.md` and `.iago/**/*.log`. (I didn't audit `.gitattributes` exhaustively.) If left as CRLF in the repo, the files will show `^M` artifacts when read on Linux CI.

**M-2 — `.iago/summaries/01a-deploy-unit-and-provision-script.md:23` reports `pr60-fix-v2.session.log: 0 lines`** but the actual file is 7 lines (`wc -l`). Summary line counts captured before final fix landed. Cosmetic.

**M-3 — Filename consistency check:** all 31 files follow `prNN-{opus,codex,codex-v2}.{md,session.log}` or `prNN-{diff.patch,fix.session.log,fix-prompt.txt}` or `prNN-fix-v2.session.log`. ✓ One inconsistency worth noting: `pr65-codex-v2.md` exists alongside `pr65-codex.md` but `pr64` and `pr63` only have v1. Implies Round 1's PR-65 underwent a second Codex pass that PR-63/-64 didn't. Not wrong, just an asymmetry — readers should know which prNN got the v2 treatment and why. The summary files don't explain.

**M-4 — Empty `pr66-codex.md` and `pr66-opus-aggressive.log`** in `.iago/reviews/2026-05-19-dual-phase2-round3/` (this directory, where this review lands). These are the in-flight Round 3 stubs being populated *right now* by the parallel review pipeline. Not part of PR #66's diff (the round-3 directory is in `.iago/reviews/` of the *base repo*, not the worktree). Mentioned for completeness — they exist on disk but are not added by PR #66.

**M-5 — No frontmatter on review markdown files.** The user's instruction noted "frontmatter present in session-digest-format files" — but these are review artifacts, not session digests, and the summary files (`.iago/summaries/01a-*.md`) DO have frontmatter (`---\nplan: ...\nstatus: done\n---`). The convention is correctly applied. Skip.

## Cross-cutting adversarial checks

| Check | Result |
|-------|--------|
| Secret leakage (tokens/keys) | ✓ Clean — no real secrets, only env-var refs and `FAKE` test stubs |
| VPS hostname/IP exposure | ⚠ Present but pre-existing in repo; not new in PR #66 |
| Prompt-injection-via-archive | ⚠ I-1 (fix-prompt.txt files need archive header) |
| Content fidelity (review claims vs reality) | ✓ Spot-checked 3 claims — all accurate; `archive-openclaw.sh not in 01a` confirmed correct |
| Markdown integrity (fences, tables, wikilinks) | ✓ No unclosed code fences; tables render; no broken `\` |
| Conflict markers | ✓ None (`====` matches in `pr64-diff.patch` are TypeScript decorative dividers `// =====...=====`) |
| Binary files | ✓ All 31 are text |
| Scope creep (non-`.iago/` paths) | ✓ Clean — pure doc drop |
| Executable file modes | ✓ No `.sh`/`.mjs` added under `.iago/` |
| `.gitignore` / `.gitattributes` changes | ✓ Not modified |
| Truncated diff patches | ✓ All patches end cleanly at `--` or final hunk |
| `<<<<<<<` / `>>>>>>>` merge conflict markers | ✓ Zero hits in PR #66 file scope |
| `.ndjson` event-name typos | ✓ Names in review markdown (`claim-task-failed`, `task-resolved`, etc.) match `runtime/daemon/agent-manager.ts` — verified via grep |

## Honest answer to the framing question

> "Most 'doc-only' PRs get rubber-stamped because reviewers assume nothing dangerous can ship in a markdown file."

There IS one real hazard surface here: the fix-prompt.txt files (I-1). They are the kind of content that a future autonomous agent could be subverted by. The mitigation is trivial (one header line per file) and should ship before merge. Everything else is hygiene — misleading session logs, telemetry-leading-the-review, count-mismatch summaries — none of it blocks merge but all of it pays compound interest if not addressed in a follow-up.

The PR is not dangerous. It IS imperfect.

## Verdict

**PASS_WITH_CONCERNS**

Merge unblocked. Address I-1 (fix-prompt header) before merge if the merge is non-urgent; defer I-2 / I-3 / I-4 to a follow-up cleanup PR or upstream pipeline improvements. None of the findings warrant blocking a doc-archive PR whose entire purpose is preserving evidence trails — but the evidence trails would be more trustworthy with the I-1 / I-2 fixes applied.

## Follow-ups recommended

1. (this PR, optional) Prepend archive-warning header to `pr63-fix-prompt.txt` and `pr64-fix-prompt.txt`.
2. (this PR, optional) Append `[FOLLOW-UP] ... see commit XXXXX` line to `pr63-fix.session.log`, `pr64-fix.session.log`, `.iago/runs/round-2-dispatch/07b.log`.
3. (pipeline change, separate PR) Have `codex-companion.mjs` split trace output (`*.trace.log`) from review output (`*-codex.md`) so review files lead with `# Codex Adversarial Review` not 80 lines of `[codex] Running command:`.
4. (repo-wide hardening, separate decision) Decide whether `srv1456441` + `187.77.135.32` should be scrubbed from ALL `.iago/`, `runtime/migration/`, and `.iago/research/` files before iago-os is ever made public.
