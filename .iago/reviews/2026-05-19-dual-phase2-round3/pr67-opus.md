# Opus 4.7 — Adversarial Review of PR #67 (Plan 04a — PR-triage agent artifacts)

**Reviewer:** opus-4-7 (post-pipeline second pass)
**Pre-impl base:** fd9f27c
**HEAD reviewed:** 3549b37 (`feat(agents): PR triage config, crons, prompt, wake-check (04a)`)
**Scope of review:** Artifacts shipped in 04a (agent-config, crons, prompt-template, wake-check) + the 04b-creep wiring (`loadAgentCronEntries`, `ndjsonAlert` branch, `agent-alert` telemetry).
**Pipeline status going in:** Local review PASS after round 1; Codex adversarial returned 4 findings (1 CRITICAL, 2 HIGH, 1 MEDIUM); Codex fix session hit `Reached max turns (40)`.

---

## Methodology

1. Read plan 04a in full (104 lines).
2. Read PR67 diff (831 lines: 250 log, 230 artifacts, 351 daemon wiring & telemetry).
3. Verified each committed file against actual repo state (`C:\Users\[redacted]\dev\iago-os-c` @ 3549b37) — the diff in `.iago/reviews/2026-05-19-dual-phase2-round3/pr67-diff.patch` is an in-progress snapshot taken before Codex-fix; the committed files differ. Reviewed against the **committed** state, not the patch file.
4. Cross-checked source contracts: `runtime/daemon/agent-manager.ts` (processPendingTask + claimTask), `runtime/daemon/cron-scheduler.ts` (RegisterCronOpts + fire path), `runtime/daemon/state-paths.ts` (assertSafeIdentifier), `runtime/deploy/iago-os-v2-daemon.service` (env vars).
5. Empirically validated the gh CLI commands the prompt instructs the agent to run.

---

## Status of each Codex pipeline finding

| Codex finding | Severity | Fix in PR? | Notes |
|---|---|---|---|
| crons.json not wired into daemon | CRITICAL | **FIXED** (overruns into 04b) | `runtime/daemon/main.ts:113-267` adds `loadAgentCronEntries` + `cronScheduler.registerCron`/`start` in `startDaemon` + `stop` ordering in `shutdown`. Cron tick will fire and write `tasks/pending/pr-triage__<unix>.json`. The actual PTY/claude-pty dispatch from the queued task is still deferred to Plan 04b — but cron-tick → task-file emission is wired. |
| Telegram MarkdownV2 payload malformed | HIGH | **FIXED** | Prompt switched to plain text. `prompt-template.md:50,98` explicitly removes `parse_mode=MarkdownV2`; comment at 72-72 documents why. |
| Fallback alert envelope incompatible with polling loop | HIGH | **FIXED** | (a) `agent-manager.ts:1619-1646` adds `ndjsonAlert` branch in `processPendingTask` BEFORE the registration check; (b) `prompt-template.md:105-110,137` now includes `"agentId":"pr-triage"` in both fallback envelopes; (c) `telemetry.ts:296-829` adds `agent-alert` DaemonEvent variant with `alertKind`. End-to-end path: agent writes envelope → polling loop reads → branches on ndjsonAlert → emits `agent-alert` telemetry → `claimTask` moves to `resolved/`. |
| Classification fields not fetched (missing body/labels) | MEDIUM | **FIXED** | `prompt-template.md:27` `--json` now lists `body,labels` alongside the other fields. |

All four Codex findings have correct fixes in the committed tree. The fix session hit max-turns but the substantive fixes did land.

---

## NEW FINDINGS (Opus pass)

### CRITICAL

**C1. `gh pr list --owner ilsantino` is invalid CLI syntax — daily run will fail on the first command.**

- **File:** `runtime/agents/pr-triage/prompt-template.md:24-29`
- **Evidence:** The prompt instructs the agent to run:
  ```
  gh pr list \
    --owner ilsantino \
    --state open \
    --json number,title,url,author,reviewDecision,statusCheckRollup,createdAt,updatedAt,body,labels \
    --limit 50
  ```
  `gh pr list` has no `--owner` flag. Verified directly: `gh pr list --help` shows flags `--app, --assignee, --author, --base, --draft, --head, --jq, --json, --label, --limit, --search, --state, --template, --web` plus inherited `-R/--repo`. Running `gh pr list --owner ilsantino --state open` returns `unknown flag: --owner` and exits non-zero.
- **Impact:** At 14:00 UTC daily, the agent will (a) succeed at the wake-check (which uses `gh api /search/issues` — that path works), (b) get spawned, (c) immediately fail step (a) of the algorithm, (d) take the Errors path and POST `text=PR triage failed: unknown flag: --owner. Investigate.` to Telegram. Recoverable (Santiago gets daily noise), but the actual triage never runs until the prompt is fixed.
- **Root cause:** The Codex fix session attempted to switch to `gh search prs --owner ...` (which IS a valid command) — the in-progress diff patch in `.iago/reviews/2026-05-19-dual-phase2-round3/pr67-diff.patch:319` shows `gh search prs`. But the session hit max-turns 40 before the swap landed in the committed file, OR a later edit reverted it. The committed `prompt-template.md:24` still reads `gh pr list`.
- **Recommended fix (preferred):** Replace step (a) command with a `gh api graphql` call that fetches all PRs across `ilsantino`'s repositories *with* `reviewDecision` and `statusCheckRollup`. Example shape (one query, no per-repo loop):
  ```graphql
  query { search(query:"user:ilsantino is:pr is:open", type:ISSUE, first:50) {
    nodes { ... on PullRequest {
      number title url author{login} reviewDecision createdAt updatedAt
      statusCheckRollup{state contexts(first:20){nodes{__typename ... on StatusContext{state context} ... on CheckRun{conclusion name}}}}
      body labels(first:20){nodes{name}}
    } } } }
  ```
  Invoke via `gh api graphql -f query='...'` and parse the `data.search.nodes` array. This single call covers every classification rule.
- **Acceptable fallback:** Switch to `gh search prs --owner ilsantino --state open --json number,title,url,author,createdAt,updatedAt,body,labels --limit 50` AND change the classification rules in step (b) to use only the fields `gh search prs` returns (drop `reviewDecision` / `statusCheckRollup` dependence — see C2). This narrows the triage's usefulness but works without GraphQL.

### IMPORTANT

**C2. Classification rules depend on `reviewDecision` and `statusCheckRollup`, which `gh search prs` cannot return.**

- **File:** `runtime/agents/pr-triage/prompt-template.md:41-44`
- **Evidence:** The four bucket rules at lines 41-44 depend on:
  - `reviewDecision === "APPROVED"` — used in `merge_ready` (line 41) and `waiting_santiago` (line 43)
  - `statusCheckRollup[*].conclusion` — used in `merge_ready` (line 41) and `stuck` (line 44)

  Confirmed via `gh search prs --help` JSON field list (lines 28-31 of help output): `assignees, author, authorAssociation, body, closedAt, commentsCount, createdAt, id, isDraft, isLocked, isPullRequest, labels, number, repository, state, title, updatedAt, url`. **Neither `reviewDecision` nor `statusCheckRollup` is in the supported field list.** This means even the "Acceptable fallback" in C1 is broken without rewriting the classification rules.
- **Impact:** Whatever command replaces `gh pr list --owner`, if it is `gh search prs`, three of the four buckets degrade. Specifically:
  - `merge_ready` collapses to "PR exists" (no APPROVED check, no green checks) — every open PR gets routed here.
  - `waiting_santiago` becomes unobservable (no APPROVED signal).
  - `stuck` loses the failing-checks signal; only the 5-day-stale heuristic remains.
- **Recommended fix:** Bind C1+C2 together: use `gh api graphql` (preferred path under C1). It's the only `gh` invocation that returns full classification data for an org-wide search. Document the GraphQL query in step (a) verbatim so the spawned agent doesn't have to construct it.

**C3. Wake-check uses `q=org:ilsantino` against a User account — works today by GitHub search-syntax aliasing, but is undocumented and a future-fragility risk.**

- **File:** `runtime/agents/pr-triage/wake-check.sh:29`
- **Evidence:** `gh api users/ilsantino --jq '.type'` returns `User`; `gh api orgs/ilsantino` returns 404. Empirically `gh api search/issues?q=org:ilsantino+...` and `gh api search/issues?q=user:ilsantino+...` both return the same count (3 PRs as of this review), confirming GitHub search aliases `org:` to `user:` when the qualifier target is a user account. This is undocumented behavior in the GitHub Search syntax docs as far as I can verify — if it ever changes (e.g., GitHub starts strictly distinguishing `org:` from `user:`), wake-check.sh silently returns 0 PRs daily and the agent never fires.
- **Recommended fix:** Change line 29 from `q=org:ilsantino` to `q=user:ilsantino` (the empirically equivalent, semantically-correct qualifier for a User account). Cost: one character. Eliminates the latent fragility. The plan stress-test C1 wrote `org:ilsantino` in the example; treat that as a plan-text bug that propagated to impl.

### MINOR

**M1. Prompt repeatedly refers to `ilsantino` as a GitHub organization.**

- **File:** `runtime/agents/pr-triage/prompt-template.md:5,7` ("the iago-os GitHub org", "iago-os GitHub org")
- **Evidence:** `gh api orgs/ilsantino` returns 404. There is no `iago-os` org (or `ilsantino` org). All PRs Santiago owns live under his personal account.
- **Impact:** Cosmetic; the agent will not look up a GitHub Organization REST endpoint because none of the actual API calls in step (a)/(d) do so. But a future maintainer might try to "fix" what they assume is a typo by querying `gh api orgs/ilsantino` and get a confused day.
- **Recommended fix:** Replace "the iago-os GitHub org" with "Santiago's GitHub account (`ilsantino`)" in lines 5 and 7. Two-word change.

**M2. Length cap headroom is tight under realistic loads.**

- **File:** `runtime/agents/pr-triage/prompt-template.md:118`
- **Evidence:** Telegram caps plain text at 4096 chars. The threshold `If $SUMMARY exceeds 3800 characters` leaves 296 chars for the truncation footer `(N PRs truncated for length; see dashboard)` (47 chars) + UTF-8 multibyte overhead from PR titles containing `—`, `é`, accented characters, emoji. Each section header (`Merge Ready (n)\n`) is 17 chars. With four section headers + footer that's already 115 chars before any content. A heavy day with 30 stuck PRs at 80 chars each = 2400 chars of content alone; close enough to 3800 that the algorithm's "drop Stuck first, then Merge Ready" loop must actually run.
- **Recommended fix:** Lower threshold from 3800 to 3500 to give 596 chars of headroom for the truncation footer + worst-case Unicode expansion. Cost: one number change.

**M3. Fallback envelope `details` field has no length cap; over-long Telegram error bodies could blow up agent-manager telemetry payloads.**

- **File:** `runtime/agents/pr-triage/prompt-template.md:108` (`details: "<http-status> <first 256 bytes of /tmp/tg-resp.json, with bot token redacted>"`)
- **Evidence:** The prompt says "first 256 bytes of /tmp/tg-resp.json". `head -c 256` clips correctly. BUT the `pr-triage-double-failure` envelope at line 137 has `details: "<gh-error>; <telegram-status>"` with no length guidance. A 5MB gh error dump (unlikely but bounded by network buffers) would land in `tasks/pending/<file>.json`, get JSON-parsed by `processPendingTask`, and the entire blob would be emitted as the `agent-alert` telemetry `details` field. Telemetry sinks (file logger, future Sentry) have their own size limits.
- **Recommended fix:** Add to line 137: "Truncate `<gh-error>` to the first 200 chars before constructing the envelope; the goal is enough context to grep, not the full stderr."

---

## Cross-cutting checks

- **Auth bypass:** Token redaction in fallback `details` is explicit (`sed "s|${IAGO_TELEGRAM_BOT_TOKEN}|[REDACTED]|g"` in prompt step (d) at line 108, repeated in NEVER-echo constraint at line 125). GH_TOKEN never echoed; wake-check.sh only uses it implicitly via `gh api`. **PASS.**
- **Data loss:** No destructive writes. Fallback task-file naming `pr-triage__<unix-ms>-<pid>.json` (line 102) prevents same-second collisions. Cron scheduler's task-file write at `cron-scheduler.ts:645` uses unix-seconds, which CAN collide if two cron entries shared the same `outputTaskNamePrefix` — but `registerCron` rejects duplicate prefixes (`cron-scheduler.ts:432-437`). **PASS.**
- **Race conditions:** `maxConcurrent: 1` enforced at scheduler level (`cron-scheduler.ts:556`). Polling-loop atomic rename uses `claimTask` (`agent-manager.ts:1439`). Re-entrancy guard on cron tick + polling tick documented. **PASS.**
- **Rollback safety:** Artifact-only commit + additive daemon wiring + new telemetry variant (additive enum branch). Reversible by file deletion + `git revert`. No schema migrations. **PASS.**
- **Scope discipline:** PR overruns Plan 04a's "artifacts only" scope by adding `loadAgentCronEntries` + `cronScheduler.start()` in `main.ts` and the `ndjsonAlert` branch in `agent-manager.ts`. The orchestrator authorized this in response to Codex CRITICAL "crons.json not wired". The PTY-spawn/dispatch loop is still deferred to 04b. Acceptable — the scope creep is bounded, documented in JSDoc (`main.ts:113-138`), and the alternative ("ship inert config files now, wire them in 04b") was worse because the 04a → 04b window would have inert config in main with no telemetry surface.

---

## Verdict

**PASS_WITH_CONCERNS** — with the following gate:

C1 (gh pr list --owner) is broken-by-construction and MUST be fixed before the agent fires in production. Two paths forward:

1. **Fix in 04b** (recommended): Plan 04b already wires the dispatch loop; bundle the `gh pr list → gh api graphql` swap into 04b's Task 3. The 04a-to-04b window has no live cron firing (Phase 2 daemon is not yet running on the VPS per CONTEXT.md "OpenClaw running, audit before cutover") — there is no production-blast-radius window here.
2. **Hot-fix in a follow-up PR** if 04b is more than a few days out. The fix is a single prompt-template.md edit, no code change.

C2 and C3 should be fixed in the same edit (they are co-located in prompt-template.md).

If C1 is acknowledged with an explicit follow-up commitment, this PR is safe to merge.

If C1 is treated as "broken on first fire, fix later" without a follow-up commitment, downgrade verdict to **BLOCK** — the agent's primary command should not ship in a state where it cannot succeed.

---

## Findings summary

| ID | Severity | File:Line | Status |
|---|---|---|---|
| C1 | CRITICAL | prompt-template.md:24-29 | `gh pr list --owner` invalid; agent will fail step (a) every run |
| C2 | IMPORTANT | prompt-template.md:41-44 | Classification rules require fields gh search prs cannot return |
| C3 | IMPORTANT | wake-check.sh:29 | `q=org:ilsantino` works by aliasing; should be `user:ilsantino` |
| M1 | MINOR | prompt-template.md:5,7 | "iago-os GitHub org" — ilsantino is a User account |
| M2 | MINOR | prompt-template.md:118 | 3800-char truncation threshold tight under heavy load |
| M3 | MINOR | prompt-template.md:137 | `pr-triage-double-failure` details has no length cap |

All Codex pipeline findings (1 CRITICAL, 2 HIGH, 1 MEDIUM) were correctly resolved in this PR despite the Codex-fix session hitting max-turns.
