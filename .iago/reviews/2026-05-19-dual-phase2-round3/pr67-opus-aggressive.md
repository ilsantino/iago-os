# PR #67 — Opus AGGRESSIVE Second-Pass Review (Round 3 fix verification)

**Target:** commit `b475058` (graphql swap + C1-C3 + M1-M3) on `feat/04a-pr-triage-artifacts`
**Worktree:** `C:\Users\[redacted]\dev\iago-os-c`
**Prior reviews covered up to:** `448a4fb` (pre-graphql-swap)
**Frame:** assume the fix introduced new bugs. Verify empirically. Be harsh.

---

## Verdict: **BLOCK**

Two CRITICAL defects survive the fix commit. A third is masked by the implementer's own self-documenting comment in `agent-config.json` but the commit message ("Plan 04b originally owned this wiring; preempted into 04a so the configuration is not silently dead between 04a merge and 04b merge") explicitly claims the wiring is now non-inert. It is still inert — the cron will fire daily into a pending dir that nothing drains. One MEDIUM/HIGH scope bug also lands here.

---

## CRITICAL Findings (must fix before merge)

### C-A1. `user:ilsantino` query scope silently drops every cross-org PR Santiago authors

**Where:** `runtime/agents/pr-triage/prompt-template.md:26` + `runtime/agents/pr-triage/wake-check.sh:31`

**Empirically verified now (2026-05-19 04:41 UTC) against Santiago's real account:**

```
$ gh api graphql -f query='{ search(query: "user:ilsantino is:pr is:open", type: ISSUE, first: 50) { issueCount } }'
{"data":{"search":{"issueCount":3}}}

$ gh api graphql -f query='{ search(query: "author:ilsantino is:pr is:open", type: ISSUE, first: 50) { nodes { ... on PullRequest { number repository { nameWithOwner } } } } }'
... includes #90 in bas-labs/munet-web ...
```

`user:USERNAME` in GitHub search returns only PRs in repos **owned by** that user. `bas-labs/munet-web` PR #90 (currently open, Santiago is the author) is dropped. So are any future bas-labs/sentria, bas-labs/* PRs.

Per memory, Santiago's active workflow includes inner repos under `bas-labs/*`. The triage agent will silently miss them every day.

**Fix:** use `author:ilsantino` (catches PRs Santiago opened anywhere) or `involves:ilsantino` (also catches PRs where Santiago is reviewer / assignee). Update both `prompt-template.md` step (a) and `wake-check.sh:31`.

---

### C-A2. `waiting_claude` classification rule misses ~every PR currently in the bucket

**Where:** `runtime/agents/pr-triage/prompt-template.md:65`

The rule:
> `waiting_claude` — the PR `body` or `title` contains a literal `@claude` mention OR `labels.nodes[]` contains an entry with `name === "claude-review-requested"`, AND `reviewDecision !== "APPROVED"`

But the iaGO pipeline tags @claude via a **comment** (`scripts/execute-pipeline.sh:1017`):

```bash
gh pr comment "$PR_NUMBER" --body "$CLAUDE_REVIEW_BODY"
```

NOT in the PR body. Empirical check of the 3 currently open PRs:

```
PR #66: body contains @claude → matched
PR #67: body has NO @claude (@claude lives in a comment) → NOT matched
PR #68: body has NO @claude (@claude lives in a comment) → NOT matched
```

None of the 3 open PRs carry the `claude-review-requested` label either. So under the current rule, 2 of 3 PRs that are actively in the Claude review loop fall through every bucket and get dropped from the summary.

The entire bucket the triage agent was designed to surface ("what is Santiago waiting on Claude for?") is empirically near-empty in production. This is the load-bearing reason the daily message exists.

**Fix options (pick one):**
1. Add `comments(last: 20) { nodes { author { login } body } }` to the GraphQL query and check for `@claude` in any comment body OR for a comment author of `claude[bot]` / `github-actions[bot]`.
2. Add `reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Bot { login } } } }` and check for the `claude` bot.
3. Use a heuristic via `latestReviews` / `reviews(first: 50)` and detect Claude's automated review postings.

Whichever you pick, add a fixture-based unit test against the actual classification logic so this can't silently regress.

---

### C-A3. "Codex critical: cron config is inert" is **NOT fixed** — only half-wired

**Where:** `runtime/daemon/main.ts` (loadAgentCronEntries + cronScheduler block); `runtime/daemon/agent-manager.ts:1647` (isAgentRegistered branch).

**Commit message claim:** "wire daemon startup to discover these per-agent cron files and call CronScheduler.registerCron ... so the configuration is not silently dead between 04a merge and 04b merge."

**Reality of the fire path:**

1. `loadAgentCronEntries` discovers `runtime/agents/pr-triage/crons.json` ✓
2. `CronScheduler.registerCron(cronOpts)` registers the cron entry ✓
3. At 14:00 UTC, CronScheduler `fire()` writes `pr-triage__<unix>.json` to `tasks/pending/` with body `{prompt, agentId: "pr-triage", needsApproval: false}` ✓
4. `AgentManager` polling loop reads the file
5. `processPendingTask` checks `ndjsonAlert` → not present → skip alert branch
6. `processPendingTask` calls `isAgentRegistered("pr-triage")`. Implementation (`agent-manager.ts:1724`): iterates `this.handles.values()` for a tracked agent with that id.
7. **`pr-triage` has `autoStart: false` in `agent-config.json` and is NOT in `runtime/daemon-config.json`'s `agents[]`.** The auto-start loop at `main.ts:813` skips it. The agent is never `registerAgent`'d. `this.handles` does not contain pr-triage.
8. `isAgentRegistered("pr-triage")` returns `false`.
9. `emitUnrouted(filename, "pr-triage")` runs. Per JSDoc at `agent-manager.ts:1473`: "unregistered → **leave in pending**, emit `task-unrouted` once per filename".
10. The task file STAYS in `tasks/pending/`. Forever. The agent never spawns. The Telegram message is never sent.

Even *if* the agent were registered, the path is still broken at a second layer:

11. The CronScheduler-written task file has a `prompt` field. `grep -rn "prompt" runtime/daemon/ runtime/agent-runtime/ --include="*.ts"` for code that reads this field returns ONLY `cron-scheduler.ts:656` (the writer). Nothing reads the `prompt` and pipes it to claude-pty stdin. Even if `pr-triage` were a registered handle, `claimTask` only renames the file to `tasks/resolved/` — it doesn't dispatch the prompt to the PTY.

So this PR ships a daily-firing cron whose task files (a) are never consumed by an agent, and (b) carry a prompt nothing knows how to deliver. The cron will leak ~1 file/day into `tasks/pending/` until a human notices.

Yes — `agent-config.json` self-documents that 04b is responsible for "explicitly forward[ing] them to the PTY spawn opts during cron dispatch". But the round-3 fix's commit message and `main.ts` block claim to make the configuration NOT silently dead. They do not. This is a contradiction between the commit message ("not silently dead between 04a merge and 04b merge") and the actual behavior (silently dead, plus daily file leak).

**Fix (minimal — choose one):**
- **Option A (full):** add `pr-triage` to a sample `daemon-config.json` with `autoStart: true`, AND add a "prompt-dispatch on claimTask" path in agent-manager that pipes the task's `prompt` field to the agent's PTY stdin. This makes the cron actually fire.
- **Option B (honest):** revert `loadAgentCronEntries` registration from this PR. Defer to 04b. Update the commit message and prompt-template.md's "spawned by the iaGO v2 daemon's CronScheduler" wording to be honest about the 04b dependency. The current state ships a cron that pollutes `tasks/pending/` daily with no consumer.
- **Option C (compromise):** gate `cronScheduler.start()` behind `process.env.IAGO_ENABLE_CRON_DISCOVERY === "1"` so the discovery code lands but does not fire in production until 04b ships the agent-spawn + prompt-dispatch wiring.

Until one of these lands, the system actively makes things worse, not better.

---

## HIGH Findings

### H-A1. `merge_ready` vs `stuck` rule ordering — APPROVED+FAILING PR gets mis-bucketed

**Where:** `runtime/agents/pr-triage/prompt-template.md:64-67`

Rule ordering: `merge_ready` → `waiting_claude` → `waiting_santiago` → `stuck`. First match wins.

Edge case: a PR where `reviewDecision === "APPROVED"` AND `statusCheckRollup.state === "FAILURE"` (CI broke after approval):

- `merge_ready` (state must be SUCCESS or null) → NO
- `waiting_claude` (reviewDecision must !== APPROVED) → NO
- `waiting_santiago` (reviewDecision === APPROVED AND author === ilsantino) → **YES** (if Santiago opened it, which is the typical case)
- `stuck` (state === FAILURE) → would match, but never evaluated due to first-match rule

Result: the PR is reported as "Santiago needs to merge this" when actually CI is broken and merging would fail. Misdirects Santiago's attention.

**Fix:** evaluate `stuck` BEFORE `waiting_santiago` (or AND-not-stuck into `waiting_santiago`). The semantic intent is "santiago can merge cleanly" — so the rule should also require `statusCheckRollup.state !== "FAILURE"` AND no `TIMED_OUT` contexts.

---

### H-A2. STATE_ROOT divergence between agent fallback and daemon resolver — dev-mode fallback files are written to the wrong path

**Where:** `runtime/agents/pr-triage/prompt-template.md:129` vs `runtime/daemon/state-paths.ts:63-76`

Agent prompt's fallback: `STATE_ROOT="${IAGO_DAEMON_STATE_ROOT:-/var/lib/iago-os/daemon-state}"`

Daemon's `getStateRoot()` defaults:
1. If `IAGO_DAEMON_STATE_ROOT` set → use it ✓
2. If cwd basename is `iago-os` → `<cwd>/runtime/state`
3. Else → `~/.iago-os/daemon-state`

In production (systemd unit sets `IAGO_DAEMON_STATE_ROOT=/var/lib/iago-os/daemon-state` per `iago-os-v2-daemon.service:202`), both resolve to the same path. ✓

In local dev (daemon started from `iago-os/` repo root, no env var), the daemon polls `<repo>/runtime/state/tasks/pending/` but the agent's fallback writes to `/var/lib/iago-os/daemon-state/tasks/pending/`. The fallback file is written to a path the polling loop never reads. The misconfiguration alert is lost.

Worse on Windows: `/var/lib/iago-os/daemon-state/` doesn't exist; `mkdir -p` on that path may succeed (creating a confusing C:\var\lib\... tree) or fail silently depending on shell.

**Fix:** the agent should ask the daemon for the state root via the IPC socket OR plan 04b should propagate `agent-config.json`'s `env.IAGO_DAEMON_STATE_ROOT` into the PTY spawn opts. Document this as a 04b prerequisite in the agent-config.json `_comment_fields`.

---

## MEDIUM Findings

### M-A1. `gh api graphql` partial-error path silently passes empty list to classifier

**Where:** `runtime/agents/pr-triage/prompt-template.md:24-52`

Empirically verified: `gh api graphql` on a query with invalid fields exits 1 (good — catches the Errors-section branch). BUT on a **partial** error (some fields succeed, some fail at the field level), GraphQL returns 200 with `{"data": {...partial...}, "errors": [...]}`. The prompt uses `--jq '.data.search.nodes'` which would output the partial nodes array (with missing fields as null) and the agent proceeds as if everything worked.

For the current query, a partial failure could mean `statusCheckRollup` returns null on a PR with a check type GitHub adds in the future. The classifier's `statusCheckRollup.state === "SUCCESS"` check on null would throw or silently fall through to a wrong bucket.

**Fix:** the prompt should explicitly check for `.errors` in the response before proceeding. Replace `--jq '.data.search.nodes'` with two-stage parsing: dump full response, check `.errors == null`, then extract nodes.

---

### M-A2. `body` field is unbounded — single large PR can blow the GraphQL response budget

**Where:** `runtime/agents/pr-triage/prompt-template.md:36`

The query fetches full `body` for up to 50 PRs. PR descriptions can be 10KB+ (Santiago's own PRs have multi-section descriptions with embedded plans). 50 × 10KB = 500KB response payload. Not a hard failure, but:

- Increases GraphQL node-cost budget per request (the GitHub rate limiter throttles based on point cost, not byte size — still, larger queries cost more points)
- Increases parse/process time in the PTY shell
- The body is only used for the `@claude` mention substring check — could be replaced with a server-side `body: { contains: "@claude" }` if it existed (it doesn't in GitHub's API), OR by deferring to the comments-based detection (C-A2 fix).

**Mitigation:** if C-A2 fix moves to comments-based detection, drop `body` from the query entirely. Otherwise, cap `body` to a substring via post-processing.

---

### M-A3. `statusCheckRollup.state === "ERROR"` and `"EXPECTED"` fall through every bucket

**Where:** `runtime/agents/pr-triage/prompt-template.md:67`

`StatusState` enum: `SUCCESS | FAILURE | PENDING | ERROR | EXPECTED`. The `stuck` rule matches FAILURE and TIMED_OUT contexts. A PR with `state === "ERROR"` (CI infrastructure errored out, distinct from "tests failed") falls through every bucket. So does `EXPECTED` (rare — set when a deferred check is registered but not yet reported).

For Santiago's workflow, ERROR is the common case for GitHub Actions outages and external-service flakes. He'd want these surfaced as `stuck`.

**Fix:** widen `stuck` to also match `state in ("FAILURE", "ERROR")`.

---

## MINOR Findings

### m-A1. `date +%s%3N` is GNU-only

`prompt-template.md:130` uses `date +%s%3N` for millisecond precision. Supported on GNU coreutils (Debian VPS = ✓). On BSD/macOS `date` (rare in this stack, but possible in test fixtures), `%3N` is silently treated as literal — fallback filename becomes `pr-triage__1700000000%3N-9999.json`. Plan claims Debian-only deployment so not a prod issue; flag for future test portability.

### m-A2. Polling loop will re-emit `task-unrouted` for the stuck cron files until `unroutedSet` overflows at cap=1000

`agent-manager.ts:1700-1716`. With C-A3 unfixed, pr-triage writes one orphaned file per day. After ~1000 days (~2.7 years) the cap overflows and per-tick re-emission begins. Long horizon, but real — combined with C-A3, this is the failure mode that eventually surfaces the bug loudly.

### m-A3. Cron `_comment` field will trip strict JSON validators downstream

`crons.json` has `_comment` and `agent-config.json` has `_comment_fields` / `_comment_autoStart`. `loadAgentCronEntries` happens to ignore them by reading only known fields. If 04b's loader (or a future validator) is stricter (Zod schema with `.strict()`), the parse will fail. Note in the agent-config.json's own `_comment_fields` correctly flags this.

### m-A4. `agentId: "pr-triage"` contains hyphen — verify against `validateAgentId` not just `assertSafeIdentifier`

`validateAgentId` (state-paths.ts:105) enforces `^[a-z][a-z0-9\-]{0,62}$`. "pr-triage" matches. ✓ Fallback filename `pr-triage__<unix-ms>-<pid>.json` matches the `<prefix>__<unix>.json` shape that `assertSafeIdentifier` accepts (no path separators, no `..`). ✓ But the **double underscore** in the filename would trip `validateAgentId` (which rejects `__`). `claimTask` uses `assertSafeIdentifier`, not `validateAgentId`, so no actual break — but the inconsistency between the two validators is fragile.

---

## What was verified empirically

1. ✅ `gh api graphql` with the prompt's exact query succeeds and returns 3 PRs with the expected nested shape (StatusCheckRollupContext union resolves correctly to StatusContext / CheckRun).
2. ✅ `gh api graphql` exits 1 on field errors (Errors-section catches this).
3. ✅ `gh search prs --help` confirms its `JSON FIELDS` list omits `reviewDecision`, `statusCheckRollup`, and `labels.nodes[].name` — the commit's justification for switching to GraphQL is correct.
4. ✅ `gh api -i '/search/issues?q=user:ilsantino+is:pr+is:open&per_page=1'` returns HTTP/2.0 200 with `{"total_count":3,...}` — wake-check.sh's status grep + awk extraction works as designed.
5. ❌ Empirically demonstrated that `user:ilsantino` (3 PRs) ≠ `author:ilsantino` (4 PRs, includes bas-labs/munet-web #90) — C-A1.
6. ❌ Empirically demonstrated that the 3 currently open PRs have @claude in 1 body (#66) and 0 labels — C-A2 ("waiting_claude" rule near-empty in production).
7. ✅ `CronScheduler` uses `getUTCMinutes`/`getUTCHours` (cron-scheduler.ts:225-227) — `0 14 * * *` fires at 14:00 UTC regardless of host TZ. ✓
8. ❌ Confirmed `prompt` field written by CronScheduler is read by NO production code (`grep -rn` returned only the writer). C-A3.
9. ❌ Confirmed `isAgentRegistered("pr-triage")` returns `false` given current `daemon-config.json` (absent) and `autoStart: false` in `agent-config.json`. C-A3.
10. ✅ `assertSafeIdentifier` accepts the fallback filename pattern. ✓

---

## Reviewer note on the round-3 fix process

The prior Opus review (PASS_WITH_CONCERNS up to 448a4fb) and the Codex round-3 review surfaced four findings each. The `b475058` commit message claims to address Codex C1 ("cron config is inert") and three cosmetic findings (M1-M3). The cron-inert fix is structurally incomplete — the implementer added `loadAgentCronEntries` (registers cron) but did NOT add the agent registration or the prompt-dispatch path needed to actually fire the agent. The Codex fix message in the round-3 log ("Reached max turns (40)") is honest about the timeout but the human follow-up commit's claim of "configuration is not silently dead" is not borne out by the code.

This review walked the entire fire path turn-by-turn and verified each link empirically. The system as currently shipped will:
- Fire the cron at 14:00 UTC daily ✓
- Write a task file to `tasks/pending/` ✓
- Have the polling loop emit `task-unrouted` telemetry ✓
- Leave the file in pending forever ✓
- Never spawn the agent ✗
- Never send the Telegram message ✗

The cost of merging this is daily file accumulation in `tasks/pending/` plus the user-visible promise of a daily triage that never arrives.

---

## Verdict: **BLOCK** (do not merge until C-A1, C-A2, C-A3 are addressed)

**Minimum-viable unblock path:**
1. Fix C-A1 — swap `user:ilsantino` → `author:ilsantino` in both files (10-second fix; the `wake-check.sh` total_count and the GraphQL search both need updating).
2. Fix C-A2 — add `comments(last:20){nodes{author{login}body}}` to GraphQL query, update `waiting_claude` rule to match `@claude` in any comment body OR comment author = `claude[bot]`.
3. Fix C-A3 — pick one of Options A/B/C. Option C (gate behind env var) is the lowest-risk unblock; honest and reversible.

Verifications to add post-fix:
- A unit test that drives a realistic `gh api graphql` response (canned JSON fixture matching Santiago's actual PR shape) through the classification rules and asserts each of the 3 currently-open PRs lands in the expected bucket. This single test would have caught C-A1 and C-A2 immediately.
- An integration test that wires `loadAgentCronEntries` → `cronScheduler.fire()` → `agentManager.processPendingTask()` and asserts either (Option A) the prompt is delivered to a stubbed PTY OR (Option C) the cron is gated off when the env var is absent.
