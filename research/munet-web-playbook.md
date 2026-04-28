# Munet-web — Restructure Playbook v2 (Council-Revised)

**Date:** 2026-04-27 (revised after `/council` stress-test)
**Repo:** `C:\Users\sanal\dev\iago-os\clients\munet-web`
**Source inputs:** `research/iago-os-capability-matrix.md`, `research/munet-web-audit.md`, `research/_drop-2026-04-22/` (v1 of this playbook archived there)
**Scope:** Drive A.1 (Dashboard), A.2 (Roles), A.3 (Incidents), A.4 (Notifications scaffold deferred), B.1 (Parking deep links) from current state to deployed MVP. ~3 weeks, solo, no QA, async @claude is the de facto QA gate.

> Planning artifact only. Each prompt is a copy-paste invocation for a future Claude Code session inside the munet-web checkout (or worktree).

---

## Reality check (read this before anything else)

- **Solo execution.** Santiago drives all of this on Windows, single laptop, two worktrees max in practice.
- **No QA team.** The async `@claude` review-fix loop on every PR is the QA gate. It runs up to 5 rounds per PR; 11+ prompts × ~3 rounds will saturate review capacity. **Manual human-merge breakpoints between waves are required** — never have two waves' PRs open simultaneously without explicit merge of the prior wave first.
- **Production is live.** Museum is selling tickets right now. Two known production bugs are P-1 — they ship before any restructure work begins.
- **"Merged" means squash-merged into `main` on github.com/ilsantino/munet-web (or the actual munet-web origin). PR open is NOT merged.** Every "depends on X merged" line below means: human has clicked Squash and merge, and CI on main is green.
- **Pipeline glossary (terms used below):**
  - `/iago-fast` — direct edit, ≤3 files, no PR, build gate only. Reserved for trivial.
  - `/iago-quick` — 1-3 task plan, full 9-stage pipeline, creates PR, tags @claude.
  - `/iago-plan {phase-slug}` — generates plans in `.iago/plans/{phase-slug}/01.md, 02.md, ...`
  - `/iago-execute {phase-slug}` — runs all plans in the phase through pipeline.
  - `/iago-execute {phase-slug} --plan {N}` — runs a single plan (`scripts/execute-pipeline.sh --plan` filter, verified valid).
  - `/iago-stress` — adversarial review of plan file (single pass).
  - `/iago-stress --deep` — council-style stress-test (5 advisors + peer review).

---

## What changed from playbook v1 — Council edits applied

The `/council` stress-test on v1 (2026-04-27) returned: not execution-ready, restructure into three gates. All 20 concrete edits below are applied:

1. **H1 + H2 moved to Gate -1 (P-1)** — ship before any restructure prompt runs.
2. **H3 deleted** — its GSI work folds into H1's plan, not a separate prompt (file collision on `amplify/backend.ts`).
3. **Phase 1 rewritten around Cognito `custom:capability` attribute** — not group migration. Reversible, no staging branch needed.
4. **P3 staging branch deleted** — capability attributes remove the need.
5. **1.2 ↔ 1.3 swapped** — backend capability enforcement before frontend gates. New numbering: 1.1 backend → 1.2 frontend → 1.3 attribute backfill runbook.
6. **4.3 promoted to `/iago-quick`** (touches `PanelShell` route AuthGuard).
7. **Any prompt touching auth boundaries / `amplify_outputs.json` / SES identity is `/iago-quick` minimum.**
8. **2.3 panic button deferred to v1.1 backlog.** Pulled out of MVP. If Santiago insists on shipping, acceptance criteria includes per-user 5-min cooldown.
9. **Cut entirely:** P1, P2, P3, H3, 2.3, 3.1, 3.5, 4.1, 4.2, 4.4, S1, S2.
10. **Risk register recategorized into three buckets** — hard blockers, defaults-with-veto, phase-2-or-later.
11. **G8 Rollback rehearsal added** — pre-migration export, revert command, blast-radius bound, revert SLA.
12. **G9 Async review-fix capacity budget added** — manual merge breakpoints between waves.
13. **Decisions doc gate added (Gate 0)** — 30 min, no Claude, single file, replaces P1+P2 ceremony.
14. **Jargon stripped from prompts** — each prompt readable cold by a fresh-session executor.
15. `**/iago-execute --plan` flag verified** in `scripts/execute-pipeline.sh` (valid).
16. `**.iago/plans/` pre-flight scan added** before P-1 begins.
17. **Expansionist skill-harvest content deleted.** Out of scope for 3-week solo MVP; revisit post-launch.
18. **3.2 stress-test gate hardened to BLOCK** if SUMMARY-vs-filter contradiction surfaces (forces H1 to emit per-channel SUMMARYs).
19. **File-collision matrix added** in §6 — replaces blanket "parallelizable: yes" claims.
20. **Timeline reality check** at top: target ≤12 prompts; spillover defers to Phase 2 backlog.

**Final prompt count: 11.**

---

## 1. Capability gaps requiring ad-hoc handling


| #      | Gap                                                       | Why iago-os doesn't cover it                              | Mitigation                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1     | Amplify Gen 2 + EventBridge cron                          | Not in `.claude/rules/aws-amplify.md` or any review-check | H1 plan spells out `aws-cdk-lib/aws-events Rule` wiring; mandatory `/iago-stress`                                                                                                                                                 |
| G2     | Real-time push (WebSocket / AppSync subs)                 | No skill, rule, or review-check covers either             | A.4 fully deferred to v1.1 — no MVP scope for real-time                                                                                                                                                                           |
| G4     | Client-side PDF export from Dashboard                     | No review-check; existing PDF code is server-side         | Plan 3.2 reuses server-side PDF helper from `create-checkout-session`                                                                                                                                                             |
| G5     | Cross-table aggregation correctness                       | `data-integrity.md` covers single-table only              | `/iago-stress --deep` mandatory on plan 3.1                                                                                                                                                                                       |
| G7     | Spanish copy QA                                           | No skill                                                  | Reviewer agent flags tone/copy; final sign-off is human                                                                                                                                                                           |
| **G8** | **Rollback rehearsal for prod Cognito + DynamoDB writes** | **No skill, no runbook generator**                        | **Every plan that writes to prod Cognito or migrates schema includes: pre-write export of affected records, explicit revert command, blast-radius bound (max users/items affected per write), revert SLA <5 min from detection.** |
| **G9** | **Async @claude review-fix loop capacity budget**         | **No documented saturation policy**                       | **Santiago manually merges between waves: P-1 → P0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → V1. Never two waves' PRs open simultaneously.**                                                                                      |


(G3 Multi-env and G6 Cognito group migration from v1 are removed — capability-attribute path eliminates both gaps.)

---

## 2. Risk register (council-recategorized)

### Hard blockers (resolve before P-1 runs — only 3)


| #   | Decision                                                                                                          | Default if Santiago doesn't pick                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Capability-attribute values: Spanish (`mantenimiento`, `eventos`, `rh`, `guia`, `admin`, `superadmin`) vs English | **Default: Spanish** to match existing `DEPARTMENTS` constants. Locked at first write — reversible by re-running attribute backfill, but values land in JWT and code |
| R3  | Role downgrade path: in-place attribute change vs delete + reinvite                                               | **Default: in-place attribute change** (capability-attribute approach makes this trivial — `adminUpdateUserAttributes` call)                                         |
| R11 | Parking deep-link format: raw `?q={lat,lng}` query strings vs Google Place IDs                                    | **Need real coords or Place IDs from Santiago.** Cannot run B1 without them.                                                                                         |


### Defaults-with-veto (Santiago accepts default unless he vetoes within 24h of relevant prompt)


| #   | Decision                                        | Default                                                                 |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| R4  | "Scanned tickets" KPI on Dashboard              | **Drop card; remove `qrScans` from Lambda payload**                     |
| R5  | `/panel/export` after Dashboard absorbs filters | **Delete route + sidebar item; add 30-day redirect at the route level** |
| R6  | Date-range filter granularity                   | **Day-only**                                                            |
| R7  | Point-of-sale breakdown values                  | `**online` and `assisted` only** (no per-cashier)                       |
| R13 | Incidents KPI on Dashboard                      | **Show open-incidents count card; click-through to `/panel/incidents`** |


### Phase-2-or-later (decide when prompt fires)


| #   | Decision                       | Blocks                          |
| --- | ------------------------------ | ------------------------------- |
| R8  | Incident severity tier         | Plan 2.1 (decide inline)        |
| R9  | Panic button scope             | v1.1 backlog (cut from MVP)     |
| R10 | Notifications: polling vs push | v1.1 backlog (A.4 cut from MVP) |


### Removed risks

- **R2** (HR onboards which roles) — moot under capability attributes; no group hierarchy to invert
- **R12** (staging branch) — moot; capability-attribute approach removes the staging dependency

---

## 3. Recommended sequence

```
Pre-flight (5 min, no Claude):
  - scan .iago/plans/ for in-flight work
  - resolve R1, R3, R11 in .iago/context/restructure-decisions.md
        │
        ▼
Gate -1 — Production bug fixes (DAY 1)
  H1 ──► merge to main ──► H2 ──► merge to main
        │
        ▼
Gate 0 — P0 (DAY 2)
  P0 (ROADMAP setup)
        │
        ▼
Phase 1 — Capabilities (DAYS 3-7) — STRICT SERIAL
  1.1 backend caps ──► merge ──► 1.2 frontend caps ──► merge ──► 1.3 attribute backfill (manual ops)
        │
        ▼
Phase 2 — Incidents (DAYS 8-10)
  /iago-execute feature-incidents (covers 2.1 data+Lambda + 2.2 UI as plans 01+02)
        │
        ▼
Phase 3 — Dashboard (DAYS 11-14)
  3.1 backend ──► merge ──► 3.2 frontend + export ──► merge
        │
        ▼
Phase 4 — Cleanup (DAYS 15-16) — parallel-safe per file-collision matrix in §6
  4.1 price gate ║ B1 parking
        │
        ▼
V1 — Verify (DAY 17)
```

**No parallelism in P-1 or Phase 1.** The two production bugs and the role-model surface area are too high-risk for parallel work. Phase 2/3/4 stay serial too — Santiago is one person — but Phase 4's two prompts can be done back-to-back in one session.

---

## 4. The prompts

Each prompt below is **copy-paste-ready into a fresh Claude Code session inside `clients\munet-web\`**. Each is self-contained (no jargon dependency). Iago-os hooks documented inline.

---

### Pre-flight (no Claude — 30 min sit-down)

#### PRE-1 — Decisions doc

Resolve only the three hard blockers. Defaults-with-veto can be skipped — they will surface inline at their relevant prompt.

```
Create file: clients/munet-web/.iago/context/restructure-decisions.md

Content:
- R1 capability-attribute values (pick: Spanish or English, then list 6 values)
- R3 role downgrade path (pick: in-place attribute change OR delete+reinvite)
- R11 parking links: paste 3 Google Maps URLs or Place IDs for MUNET parking,
       Avenida Compositores parking, La Tapatía parking

Commit this file to main with message: "docs(restructure): record decisions before P-1"
```

#### PRE-2 — Pre-flight scan

```
Inside clients/munet-web/, list every file under .iago/plans/. If any open plan exists
that is NOT for these phases (feature-roles, feature-incidents, feature-dashboard,
feature-cleanup, feature-hotfix-daily-summary, feature-hotfix-export-revenue), STOP
and report — there is in-flight work that may collide with the playbook.

If clean, proceed to H1.
```

---

### Gate -1 — Production bug fixes (Day 1)

#### H1 — Daily-summary aggregator + revenue reconciliation audit

- **requirement_id:** production correctness (precondition for A.1 Dashboard)
- **iago-os hooks:** `/iago-quick`
- **expected artifacts:** new Lambda `amplify/functions/daily-summary-aggregator/handler.ts`, EventBridge rule + IAM grant in `amplify/backend.ts`, new GSI on main table for date-range queries (folds in v1's H3 work), backfill script `scripts/backfill-daily-summaries.mjs`, **reconciliation audit notes** in `.iago/runbooks/revenue-reconciliation.md`, plan, summary, PR
- **dependencies:** PRE-1, PRE-2
- **parallelizable:** no
- **gate after merge:** Santiago verifies dashboard shows non-zero data for yesterday before H2 starts.
- **prompt:**

```
/iago-quick "fix dashboard daily-summary aggregator + revenue reconciliation + prepare GSI for date-range export queries"

Context: research/munet-web-audit.md lines 156-158, 278, 335-336 — production dashboard
shows zeros because no Lambda writes DAILY#{date}/SUMMARY records. The audit ALSO flags
that /admin/export ScanCommand is full-table scan with FilterExpression. Both fix in one
plan — they collide on amplify/backend.ts so cannot be parallel.

This is a reconciliation problem, not just a missing cron. The plan MUST address:

1. New Lambda amplify/functions/daily-summary-aggregator/handler.ts:
   - Cron: cron(5 6 * * ? *) UTC = 00:05 America/Mexico_City
   - Aggregates yesterday's ORDER#META records: orders count, revenue (paidTotal sum),
     visitorsByType, qrScans (sum of validated tickets), occupancy (sum / capacity).
   - PER-CHANNEL SUMMARYs: write separate SUMMARY records per pointOfSale (online,
     assisted) and per ticketType. Write rollup SUMMARY too. Reason: dashboard filters
     for pointOfSale and ticketType cannot apply to a single rollup record.
   - Idempotent on retries: ConditionExpression on putItem; if exists, log + overwrite.

2. EventBridge wiring in amplify/backend.ts using aws-cdk-lib/aws-events Rule.
   Grant new Lambda IAM read on main table.

3. New GSI on main table — GSI2 on (createdAtDate, createdAt) where
   createdAtDate=YYYY-MM-DD. Update create-checkout-session and admin-assisted-checkout
   to populate the new attributes on every Order META put. Update admin-operations
   /admin/export handler to query GSI2 instead of Scan when date-range is provided.

4. Backfill script scripts/backfill-daily-summaries.mjs:
   - Reads ORDER records for last 90 days, computes per-day per-channel per-type
     SUMMARY records, writes them.
   - Same script also backfills GSI2 attributes on existing Order METAs.
   - Dry-run flag (--dry-run); prints what would be written without writing.

5. Reconciliation audit:
   - Write .iago/runbooks/revenue-reconciliation.md documenting:
     (a) Source of truth for revenue (Stripe transfers vs Order paidTotal)
     (b) How refunds and voids are netted (currently — answer based on actual code in
         handle-stripe-webhook)
     (c) Whether historical revenue numbers in any report are wrong, and over what period
   - This is documentation only — no code changes from this point. Surface findings,
     don't fix.

6. Tests: vitest covering aggregator math (visitorsByType edge cases, mixed channels,
   refund flows), idempotency, time-zone correctness.

MANDATORY stress test on the plan:
- Filter dimensions on Dashboard MUST match SUMMARY record granularity. If plan emits
  a single rollup SUMMARY only, stress test must BLOCK the plan and force per-channel
  + per-type SUMMARYs (this is non-negotiable per the council review).
- Idempotency on duplicate cron firings.
- Time-zone drift between cron (UTC) and user filters (CDMX).
- Backfill script must be safely re-runnable.

G8 rollback rehearsal acceptance:
- Pre-deploy: snapshot main table via DynamoDB on-demand backup (record ARN in plan summary).
- Revert: tear down EventBridge rule + GSI2 via amplify rollback or manual `aws dynamodb update-table`.
- Blast radius: bounded to main table; no Cognito or auth surface touched.
- Revert SLA: <10 min via amplify rollback.

When done: PR opens, Santiago tags @claude (review pipeline auto-tags), Santiago waits
for clean signal + manual merge to main BEFORE starting H2.
```

---

#### H2 — `/admin/export?entity=revenue` returns 200

- **requirement_id:** production correctness
- **iago-os hooks:** `/iago-fast` (verified ≤3 files, no auth surface)
- **expected artifacts:** edit to `amplify/functions/admin-operations/handler.ts`, atomic commit, no PR (per `/iago-fast`)
- **dependencies:** H1 merged to main
- **parallelizable:** no
- **prompt:**

```
/iago-fast "wire revenue entity in /admin/export so the frontend dropdown works"

Scope (≤3 files): amplify/functions/admin-operations/handler.ts only.

The export handler around lines 547-558 has a switch on entity that handles
orders | scans | staff but falls through to badRequest('Invalid entity type') on
'revenue'. Frontend ExportPage already lists revenue as a valid option (line 23).

Add a 'revenue' case that aggregates ORDER#META records with status=completed in
the date range, output columns: [date, ticketType, channel, units, grossRevenue,
netRevenue]. Use GSI2 from H1 (already merged) for the date-range query — do not
fall back to Scan.

Build gate must pass. If implementation needs cross-row state beyond a simple
groupBy, STOP — escalate to /iago-quick.

When done: regression test added to verify entity=revenue returns 200, then commit
to main directly per /iago-fast (no PR).
```

---

### Gate 0 — Setup (Day 2)

#### P0 — ROADMAP and decisions ingested

- **requirement_id:** scaffolding
- **iago-os hooks:** `/iago-onboard` only if `.iago/` missing; otherwise direct ROADMAP edit
- **expected artifacts:** `.iago/PROJECT.md`, `.iago/ROADMAP.md` updated, `.iago/STATE.md` updated
- **dependencies:** H1 merged, H2 merged
- **parallelizable:** no
- **prompt:**

```
Inside clients/munet-web/, verify these files exist and are up to date:
1. .iago/PROJECT.md — if missing or older than 2026-04-01, run /iago-init.
2. .iago/ROADMAP.md — append the following phases (preserving any existing ones above):

   ## Phase: feature-roles
   Goal: Replace binary Admin|Operador role check with Cognito custom:capability
   user-attribute approach. Backend reads the attribute; frontend gates on it.
   Migration is per-user attribute set (reversible), NOT Cognito group creation.
   Requirement A.2.

   ## Phase: feature-incidents
   Goal: Add Incident data model, /panel/incidents UI, capability-gated resolve
   path. Requirement A.3.

   ## Phase: feature-dashboard
   Goal: Replace zero-state dashboard with filtered, multi-source dashboard
   (orders + rentals + events + incidents) with date-range, ticket-type,
   day-of-week, point-of-sale filters and CSV/PDF export. Requirement A.1.

   ## Phase: feature-cleanup
   Goal: SuperAdmin price gate via capability check; parking deep links on
   PlanificaPage. Requirements A.2 final cut + B.1.

3. .iago/STATE.md — add the four phases under Active Work; trim to <80 lines.
4. Read .iago/context/restructure-decisions.md (created in PRE-1) and confirm
   R1, R3, R11 are present.

Stop after the file edits.
```

---

### Phase 1 — Capability attributes (Days 3-7, strict serial)

> **Premise (council-revised from v1):** Skip Cognito group creation. Use a single Cognito user attribute `custom:capability` whose value is one of the R1-decided values (e.g. `superadmin`, `admin`, `rh`, `guia`, `mantenimiento`, `eventos`). Backend `requireCapability(event, "mantenimiento")` reads the attribute. Migration = `adminUpdateUserAttributes` call per user. Reversible. No staging branch needed. No group migration.

#### 1.1 — Backend capability helpers + Lambda guards

- **requirement_id:** A.2
- **iago-os hooks:** `/iago-plan feature-roles --plan 01` → `/iago-stress` → `/iago-execute feature-roles --plan 01`
- **expected artifacts:** edits to `amplify/functions/shared/auth.ts` (new helpers), every Lambda handler that previously used `isAdmin()`, integration tests, plan, summary, PR
- **dependencies:** P0 merged
- **parallelizable:** no
- **prompt:**

```
/iago-plan feature-roles --plan 01

Read .iago/context/restructure-decisions.md for R1 capability values.

Plan 01 — Backend capability enforcement. Single concern: shared/auth.ts + Lambda
authz call sites. NO frontend changes in this plan.

Tasks (target 5-7):
1. Schema decision: store capability in Cognito user attribute custom:capability
   (single string value, not a CSV; one capability per user). If a user needs
   multiple capabilities, the value is a hierarchical role like 'admin' which
   inherits e.g. 'rh' and 'eventos' (define hierarchy in shared/capabilities.ts
   constant).
2. New helpers in amplify/functions/shared/auth.ts:
   - getCapability(event) → reads custom:capability claim from JWT, returns string
   - hasCapability(event, cap) → true if user's capability >= cap in the hierarchy
   - requireCapability(event, cap) → throws Forbidden if false
   - Compatibility shim: keep isAdmin(event) as alias for hasCapability(event,'admin')
     during transition; mark deprecated.
3. Update admin-config: PUT /admin/config/tickets → requireCapability('superadmin').
   PUT /admin/config/special-days → requireCapability('admin').
4. Update admin-staff: POST/PUT/DELETE /admin/staff → requireCapability('rh') OR
   requireCapability('superadmin'). On staff create, set new user's
   custom:capability to a default ('guia') unless caller specifies.
5. Update admin-events writes → requireCapability('eventos') OR 'admin'.
6. Update validate-ticket and admin-operations incident routes → broaden allowed
   capabilities to include 'guia'. (Incidents endpoints don't exist yet —
   stub the requireCapability call so plan 2.1 can wire the route directly to it.)
7. Vitest integration tests with fake JWTs covering: each capability x each
   protected route. Ensure Admin (old) cannot change prices.

Run /iago-stress on the plan. Stress test must verify:
- JWT claim format Cognito emits for custom:capability matches the helpers' parser
  (no string-array vs comma-separated surprises).
- Existing Admin users have no custom:capability set yet — backwards compatibility:
  if attribute missing AND user is in Admin Cognito group, treat as
  capability='admin' (transitional read path). Document this fallback explicitly
  in the plan; remove it after 1.3 backfill.
- Every previously-Admin-only Lambda is either still gated or explicitly broadened.
- Idempotency: running this plan twice should not break anything.

G8 rollback acceptance:
- Pre-deploy: aws cognito-idp list-users → JSON snapshot of current users + their
  groups (saved to .iago/runbooks/cognito-snapshot-{date}.json).
- Revert: re-deploy from the prior commit; the transitional fallback (Admin group
  ⇒ capability='admin') ensures rollback cannot lock anyone out.
- Blast radius: bounded to authn-affected routes; new attribute is read-only until
  1.3 backfill runs.
- Revert SLA: <5 min via git revert + amplify deploy.

Pipeline note: review-full + Codex adversarial step are critical here — auth
refactors are the #1 source of access-control bypasses. Do not /iago-execute until
stress test returns PROCEED or PROCEED_WITH_NOTES.
```

---

#### 1.2 — Frontend capability helpers + AuthGuard + Sidebar

- **requirement_id:** A.2
- **iago-os hooks:** `/iago-plan feature-roles --plan 02` → `/iago-execute feature-roles --plan 02`
- **expected artifacts:** edits to `src/lib/auth/types.ts`, `src/lib/auth/AuthContext.tsx`, `src/components/panel/AuthGuard.tsx`, `src/components/panel/PanelSidebar.tsx`, new `src/lib/auth/capabilities.ts` helpers, vitest tests, summary, PR
- **dependencies:** 1.1 merged to main (NOT just PR open — the squash-merge has happened and main is green)
- **parallelizable:** no
- **prompt:**

```
/iago-plan feature-roles --plan 02

Read amplify/functions/shared/auth.ts (merged in plan 01) and mirror the helper
names + capability hierarchy in the frontend.

Plan 02 — Frontend capability gates. NO backend changes in this plan.

Tasks (target 4-6):
1. New file src/lib/auth/capabilities.ts:
   - Capability values constant (mirror shared/capabilities.ts from plan 01).
   - hasCapability(user, cap) — reads user.capability (parsed in AuthContext).
   - canChangePrices(user) → hasCapability(user, 'superadmin')
   - canResolveIncidents(user) → hasCapability(user, 'mantenimiento') OR superadmin
   - canOnboardStaff(user) → hasCapability(user, 'rh') OR superadmin
   - canManageEvents(user) → hasCapability(user, 'eventos') OR admin
   - canScanTickets(user) → hasCapability(user, 'guia') OR higher
   - Single source of truth — no scattered isAdmin() calls.
2. Update src/lib/auth/types.ts: add capability?: string to PanelUser. Keep
   groups: string[] (still populated from cognito:groups for transitional period).
3. Update src/lib/auth/AuthContext.tsx parseUserFromPayload to read
   custom:capability claim from JWT and populate user.capability.
4. Update AuthGuard to accept either requiredCapability (preferred) or
   requiredRole (back-compat — derives capability internally).
5. Update PanelSidebar — every item visibility computed via the capability
   helpers, not inline checks. List in plan: which sidebar item uses which
   helper.
6. Sweep src/ for every isAdmin() call site — replace with the appropriate
   capability helper. Audit must list each call site before fix and after.
7. Vitest: src/lib/auth/capabilities.test.ts covers every helper × every
   capability + missing-capability fallback.

Pipeline note: this plan touches PanelSidebar.tsx, which Phase 3 plan 3.2
(Dashboard frontend) and Phase 4 plan 4.1 (price gate) ALSO touch. Strict
sequence: 1.2 must merge before 3.2 starts AND before 4.1 starts. The
file-collision matrix in §6 of the playbook is enforced.

G8 rollback acceptance:
- Pre-deploy: confirm 1.1 is in prod and the transitional Admin-group fallback
  is active.
- Revert: git revert; old AuthGuard with requiredRole continues to work.
- Blast radius: frontend only.
- Revert SLA: <2 min via git revert + amplify build.
```

---

#### 1.3 — User attribute backfill (manual ops, no code)

- **requirement_id:** A.2 — completes the transition off of Admin/Operador groups
- **iago-os hooks:** `/iago-fast` (only writes the execution log)
- **expected artifacts:** `.iago/runbooks/cognito-capability-backfill-{date}-execution-log.md`
- **dependencies:** 1.2 merged to main, decisions doc has R1 values
- **parallelizable:** no
- **prompt:**

```
/iago-fast "execute capability-attribute backfill against the deployed Cognito user pool"

Scope (only writes the execution log).

Steps (Santiago executes; Claude assists with command construction; production):
1. Read .iago/context/restructure-decisions.md for R1 (capability values).
2. List current users + groups:
   aws cognito-idp list-users --user-pool-id us-east-1_geqDpNMwF
   aws cognito-idp admin-list-groups-for-user (per user)
3. For each user, decide capability:
   - Old Admin → 'admin' (or 'superadmin' for the 1-2 designated ones)
   - Old Operador → 'guia' default; Santiago overrides to 'mantenimiento',
     'eventos', or 'rh' per the staff list.
4. Set attribute per user:
   aws cognito-idp admin-update-user-attributes \
     --user-pool-id us-east-1_geqDpNMwF \
     --username {user} \
     --user-attributes Name=custom:capability,Value={cap}
5. Verify each user via admin-get-user.
6. Log all decisions + commands + outcomes to
   .iago/runbooks/cognito-capability-backfill-{YYYY-MM-DD}-execution-log.md.

G8 rollback rehearsal:
- Pre-write: SAVE the cognito-snapshot from plan 1.1 (already on disk).
- Revert: aws cognito-idp admin-delete-user-attributes
   --user-attribute-names custom:capability per user. The transitional
   Admin-group fallback in 1.1 means deleting the attribute restores old
   behavior.
- Blast radius: ~10 users, all internal staff. Document each user touched.
- Revert SLA: <10 min via shell loop over the snapshot file.

This is reversible. If anything goes wrong mid-backfill, run the revert
loop and re-investigate.

After successful backfill, schedule a follow-up task in STATE.md:
"Remove transitional Admin-group fallback from shared/auth.ts in 30 days."
(The fallback was added in plan 1.1 to prevent lockout during the backfill window.)
```

---

### Phase 2 — Incidents (Days 8-10)

#### 2 — Incidents (data + Lambda + UI in one phase, two plans)

- **requirement_id:** A.3 (panic button A.3 deferred to v1.1)
- **iago-os hooks:** `/iago-plan feature-incidents` → `/iago-execute feature-incidents`
- **expected artifacts:** new Lambda routes (extend `admin-operations` OR new `admin-incidents`), `src/pages/panel/IncidentsPage.tsx`, `src/features/incidents/`, route + sidebar item, plans 01+02, summary, two PRs (one per plan)
- **dependencies:** 1.3 backfill complete in production
- **parallelizable:** no
- **prompt:**

```
/iago-plan feature-incidents --research

Read research/munet-web-audit.md sections 2.A.3 (incidents) and 1.2 ops-table.
Read .iago/context/restructure-decisions.md for R8 (severity tier — if Santiago
hasn't decided, default to optional severity field present from day 1).

Generate two plans for this phase:

PLAN 01 — Incident entity + Lambda routes (~5 tasks):
1. Add Incident entity to ops table:
   pk=INCIDENT#{id}, sk=META, GSI1PK=TYPE#INCIDENT, GSI1SK=STATUS#{state}.
   Fields: type (cleaning|damage|electrical|restrooms|security|other),
   severity (low|medium|high|critical, optional),
   description, location, reportedBy (cognitoSub),
   assignedTo (optional empNo), state (open|in_progress|resolved),
   createdAt, updatedAt, resolvedAt, resolvedBy.
2. Constants + Zod schemas in shared/.
3. Routes:
   POST /admin/incidents — any authenticated capability can open.
   GET  /admin/incidents — any authenticated; filters: status, type, dateRange.
   GET  /admin/incidents/{id} — any authenticated.
   PATCH /admin/incidents/{id}/status → requireCapability('mantenimiento')
       OR 'superadmin'. State machine: open → in_progress → resolved (no skips).
   PATCH /admin/incidents/{id}/assign → requireCapability('mantenimiento')
       OR 'superadmin'.
4. SES notification on POST: send to ADMIN_EMAIL with summary.
5. Vitest: state machine, capability enforcement on PATCH, GSI1 query for
   "open by type".

PLAN 02 — Incidents UI (~5 tasks):
1. src/features/incidents/ — components, hooks, api, types. api wraps the routes
   from plan 01 via TanStack Query.
2. src/pages/panel/IncidentsPage.tsx — list with filters, open-incident form,
   detail drawer with status transitions.
3. Add /panel/incidents route in PanelShell.tsx. Use canResolveIncidents()
   helper to gate status PATCH controls.
4. Sidebar item "Incidencias". Visible to all authenticated.
5. Framer Motion fade-in list, slide-in drawer (every UI change must include
   motion per project standard).
6. Vitest unit tests + Playwright e2e: report → assign → resolve flow.

After /iago-plan completes, run /iago-stress on the combined phase. Then
/iago-execute feature-incidents (runs both plans through pipeline sequentially).

G8 rollback acceptance:
- Pre-deploy: ops table snapshot via on-demand backup.
- Revert: amplify rollback prior commit; INCIDENT records persist (no harm,
  just orphaned data — can be cleaned up post-revert with a dedupe script).
- Blast radius: ops table only; no Cognito or auth surface mutated.
- Revert SLA: <10 min.

Manual merge breakpoint: after plan 01 PR merges, Santiago waits for clean main,
then runs /iago-execute on plan 02. Do NOT have both PRs open simultaneously.
```

---

### Phase 3 — Dashboard (Days 11-14)

#### 3.1 — Dashboard backend: filters + multi-source aggregation

- **requirement_id:** A.1
- **iago-os hooks:** `/iago-plan feature-dashboard --plan 01` → `/iago-stress --deep` (G5 mitigation, council mode 5 advisors) → `/iago-execute feature-dashboard --plan 01`
- **expected artifacts:** edits to `amplify/functions/admin-dashboard/handler.ts`, plan, summary, PR
- **dependencies:** Phase 2 plan 02 merged
- **parallelizable:** no
- **prompt:**

```
/iago-plan feature-dashboard --plan 01

Read research/munet-web-audit.md section 2.A.1. Read .iago/context/restructure-
decisions.md for R6 (granularity), R7 (POS values), R13 (incidents KPI on
dashboard). Defaults if unresolved: day-only, online/assisted only, show open-
incidents card with click-through.

Plan 01 — Dashboard Lambda redesign. Touches admin-dashboard handler ONLY.
Frontend changes are plan 02.

Tasks (target 5-7):
1. New query parameters: fromDate, toDate (defaults: today),
   ticketType (optional), dayOfWeek (optional), pointOfSale (optional —
   online|assisted per R7). Validate with Zod.
2. Aggregation strategy (council requirement):
   - Range entirely in past: read DAILY#{date}/SUMMARY records, summing
     across the per-channel/per-type SUMMARYs that H1 emitted.
   - Range includes today: SUMMARY records for past + on-the-fly aggregation
     of today's ORDER#META records.
   - Filters apply at the per-channel/per-type SUMMARY level — NOT at rollup.
     This depends on H1 having emitted granular SUMMARYs (verified merged).
3. Cross-table additions: events count + rentals (inquiries) count +
   incidents count. Query ops table GSI1 for TYPE#EVENT, TYPE#INQUIRY,
   TYPE#INCIDENT.
4. Response shape: KPI block (orders, revenue, occupancy, optional qrScans
   per R4 default-to-drop), filters block (echo applied), tables block
   (next 5 events, last 5 inquiries, top 5 open incidents).
5. Per R4 default: remove qrScans from Lambda response unless Santiago vetoes.
6. Vitest: every filter combination, edge cases.

Run /iago-stress --deep (council mode). Mandatory checks:
- Filter-combination NaN risks (data-integrity rules).
- Tenant-style filter on aggregates: pointOfSale=assisted must only count
  assisted orders. With H1's per-channel SUMMARYs, this is correct;
  stress test must verify the H1 schema actually supports it. If H1 only
  emitted a rollup SUMMARY, the stress test must BLOCK and force an H1
  re-spin before plan 01 ships.
- Time-zone drift between cron (UTC) and user filter input (CDMX).
- Cross-table aggregation correctness (G5).

G8 rollback acceptance:
- Pre-deploy: snapshot dashboard Lambda response shape with example call.
- Revert: amplify rollback; old handler returns the old (zeroes-when-no-aggr)
  shape, frontend handles it via a permissive parser.
- Blast radius: dashboard endpoint only.
- Revert SLA: <5 min.
```

---

#### 3.2 — Dashboard frontend filters, tables, export

- **requirement_id:** A.1
- **iago-os hooks:** `/iago-plan feature-dashboard --plan 02` → `/iago-execute feature-dashboard --plan 02`
- **expected artifacts:** edits to `src/pages/panel/DashboardPage.tsx`, new `src/features/dashboard/`, export buttons, server-side PDF helper invocation, summary, PR
- **dependencies:** 3.1 merged
- **parallelizable:** no
- **prompt:**

```
/iago-plan feature-dashboard --plan 02

Read research/munet-web-audit.md section 4 Option 2 (table rows below KPIs).
Read .iago/context/restructure-decisions.md for R4 (qrScans label or drop),
R5 (delete /panel/export route).

Plan 02 — Dashboard frontend, including export integration AND the
qrScans label change AND deletion of the standalone /panel/export route.
Folds in v1's separate 3.1, 3.4, 4.1 prompts.

Tasks (target 6-8):
1. src/features/dashboard/components/Filters.tsx — date range picker (ShadCN
   calendar; run `npx shadcn@latest add calendar` if not installed), ticket-type
   select, day-of-week multi-select, POS select. react-hook-form + Zod.
2. src/features/dashboard/hooks/useDashboard.ts — TanStack Query with filter
   state in query key. staleTime 60s.
3. Three table components (EventsTable, InquiriesTable, IncidentsTable) below
   KPI cards. Click-through to /panel/actividades, /panel/inquiries,
   /panel/incidents.
4. Update DashboardPage layout: KPI cards top, filters middle, three tables
   below.
5. R4 application: drop the qrScans card unless veto. Sync with Lambda response
   shape from 3.1.
6. Export buttons (CSV / PDF) on DashboardPage:
   - CSV: POST /admin/export with active filters + entity selector.
   - PDF: extend POST /admin/export with format=pdf parameter; server-side PDF
     reuses pdf helper from create-checkout-session (per gap G4).
   - Show toast with presigned URL (5-min TTL — surface this UX).
7. R5 application: delete src/pages/panel/ExportPage.tsx, remove route from
   PanelShell.tsx, remove sidebar item from PanelSidebar.tsx, add 30-day
   redirect at the route level.
8. Framer Motion: tables fade-in staggered on filter change.
9. Vitest + Playwright e2e: filter changes update KPIs and tables; CSV/PDF
   export round-trips work.

Pipeline note: PanelSidebar.tsx is touched here AND was touched in 1.2.
Strict sequence — 1.2 must already be merged. Plan 4.1 also touches
PanelSidebar.tsx; do NOT have 4.1 in flight while 3.2 is open.

G8 rollback acceptance:
- Pre-deploy: capture screenshots of current Dashboard for visual diff.
- Revert: git revert; old DashboardPage continues to work (queries same API).
- Blast radius: frontend + delete of /panel/export route — bookmarks 404 if no
  redirect lands. The 30-day redirect is required.
- Revert SLA: <2 min.
```

---

### Phase 4 — Cleanup (Days 15-16)

#### 4.1 — SuperAdmin price gate

- **requirement_id:** A.2 final UI cut
- **iago-os hooks:** `/iago-quick` (NOT `/iago-fast` per council — touches PanelShell route AuthGuard, a privileged endpoint)
- **expected artifacts:** edits to `PanelShell.tsx` (route AuthGuard requiredCapability), `src/pages/panel/TicketConfigPage.tsx` (in-page fallback), `PanelSidebar.tsx` (hide "Precios" for non-superadmin), summary, PR
- **dependencies:** 3.2 merged (PanelSidebar collision)
- **parallelizable:** with B1 in same session (different files)
- **prompt:**

```
/iago-quick "switch TicketConfigPage role gate from Admin to SuperAdmin via canChangePrices() helper"

Plan (1-2 tasks):
1. PanelShell.tsx route guard for /panel/config: replace requiredRole="Admin"
   with requiredCapability=canChangePrices.
2. TicketConfigPage.tsx in-page fallback: if user lacks canChangePrices, show
   "Acceso restringido" and exit early (defense in depth — direct nav
   shouldn't bypass the route guard, but this catches stale-bundle edge cases).
3. PanelSidebar.tsx: hide "Precios" item unless canChangePrices(user) is true.

Use canChangePrices() helper from src/lib/auth/capabilities.ts (created in 1.2).
No new isSuperAdmin() check.

G8 rollback acceptance:
- Pre-deploy: confirm at least one user has capability='superadmin' (per 1.3
  backfill).
- Revert: git revert; old gate (Admin) restored. No data impact.
- Blast radius: frontend gate only; backend gate (1.1) still requires
  superadmin.
- Revert SLA: <2 min.
```

---

#### B1 — Parking deep links on PlanificaPage

- **requirement_id:** B.1
- **iago-os hooks:** `/iago-fast` (≤3 files, no auth surface)
- **expected artifacts:** edit to `src/pages/PlanificaPage.tsx` Cómo Llegar card
- **dependencies:** R11 resolved in PRE-1 (else STOP)
- **parallelizable:** with 4.1 in same session (different files)
- **prompt:**

```
/iago-fast "add three parking deep links to the Cómo Llegar card on PlanificaPage"

PRECONDITION: read .iago/context/restructure-decisions.md for R11. If the three
parking links/coords are missing, STOP and ask Santiago for them before editing.

Scope (≤3 files): src/pages/PlanificaPage.tsx only. Edit the Cómo Llegar
TiltCard around lines 314-357 (per audit B.1).

Approach: extend the existing card with a list of three <a> links below the
embedded map. Use the format Santiago provided in R11 (raw query strings
or Place IDs). Spanish subheading "Estacionamientos cercanos". rel="noopener
noreferrer" target="_blank".

No state, no new dependencies, no animation changes (the surrounding TiltCard
already animates).
```

---

### Verify

#### V1 — Single verification pass

- **requirement_id:** all
- **iago-os hooks:** `/iago-verify {phase-slug}` × 4 in one session
- **expected artifacts:** `.iago/verifications/{phase}.md` × 4
- **dependencies:** all PRs merged
- **parallelizable:** verifications run sequentially in one session
- **prompt:**

```
Run these in order in one session:

1. /iago-verify feature-roles
   Check: backend custom:capability is enforced (curl with each capability's JWT
   gets the expected 200/403); frontend canChangePrices gate works in browser;
   no isAdmin() literal remains in src/ except the deprecated alias in
   shared/auth.ts; price-change route is denied to non-superadmin.

2. /iago-verify feature-incidents
   Check: open → assign → resolve flow works end-to-end against prod; SES email
   received on report; non-Maintenance capabilities cannot resolve; capability
   gate at API layer rejects guia and admin attempts to PATCH status.

3. /iago-verify feature-dashboard
   Check: every filter combination returns sensible data; H1's per-channel
   SUMMARYs are populated for the last 7 days; CSV export round-trips for
   all 4 entity types (orders, scans, staff, revenue); PDF export round-trips;
   incidents KPI shows non-zero count after Phase 2.

4. /iago-verify feature-cleanup
   Check: /panel/export redirects (or 410); price gate enforced; PlanificaPage
   shows three parking links; no broken sidebar items; all routes load without
   console errors per scripts/console-check.mjs.

After all four pass, write a final cutover digest to
.iago/summaries/munet-web-mvp-cutover-{date}.md with:
- merged PR list
- prod state diff (before / after)
- known limitations (panic button deferred, notifications deferred, no staging
  branch)
- v1.1 backlog: 2.3 panic, 4.4 notifications, p3 staging, 4.2 contenido-guia,
  S1/S2 audits.

Then write a session digest to obsidian-brain/sessions/{date}-munet-web-mvp.md
via the Obsidian MCP tool, linking each phase verification.
```

---

## 5. Backlog explicitly deferred (was in v1, cut by council)

These DO NOT run in MVP. They become v1.1+ work:


| ID (v1)           | What                                       | Why deferred                                                              | Trigger to revive                                    |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| P1, P2 (v1)       | `/iago-discuss` rounds                     | 30-min sit-down replaces this — pure ceremony                             | Never; pattern retired                               |
| P3 (v1)           | Amplify staging branch                     | Capability-attribute approach removes the need; no group migration        | If a future change requires Cognito group creation   |
| H3 (v1)           | GSI Scan→date-range                        | Folded into H1 — same file collision                                      | n/a                                                  |
| 2.3 (v1)          | Panic button                               | Safety feature with no current process; museum has phones                 | When a real workflow exists                          |
| 3.1 (v1)          | qrScans label-change prompt                | Folded into 3.2 default behavior                                          | n/a                                                  |
| 3.5 (v1)          | Refetch tuning                             | Gold-plating                                                              | If polling load becomes a real complaint             |
| 4.1 (v1)          | Delete /panel/export prompt                | Folded into 3.2 plan 02                                                   | n/a                                                  |
| 4.2 (v1)          | contenido-guia page                        | Stub stays stub; backend already works for direct API call if needed      | When ops staff request the UI                        |
| 4.4 (v1)          | Notifications scaffold                     | A.4 requires real-time or polling architecture decision; out of MVP scope | When >20 staff and miss-rate becomes pain            |
| S1, S2 (v1)       | Bug-bounty sweeps                          | Pipeline per-plan reviews + Codex stage 4 are sufficient at MVP scale     | Pre-launch hardening if museum traffic >10x          |
| Skill harvest (D) | `/iago-restructure`, `/amplify-cron`, etc. | Wrong altitude for 3-week solo MVP                                        | After munet ships and pattern repeats on next client |


---

## 6. File-collision matrix (replaces "parallelizable: yes" claims)

Any file appearing in 2+ prompts forces serial ordering between those prompts. No parallel worktrees can resolve same-file conflicts.


| File                                            | Prompts that touch it                               | Required order                                        |
| ----------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `amplify/backend.ts`                            | H1 only (post-cuts)                                 | n/a — single touchpoint                               |
| `amplify/functions/shared/auth.ts`              | 1.1 only                                            | n/a                                                   |
| `amplify/functions/admin-dashboard/handler.ts`  | 3.1 only                                            | n/a                                                   |
| `amplify/functions/admin-operations/handler.ts` | H1 (export GSI), H2 (revenue case), 2.1 (incidents) | H1 → H2 → 2.1 (already enforced by phase order)       |
| `src/lib/auth/types.ts`                         | 1.2 only                                            | n/a                                                   |
| `src/lib/auth/AuthContext.tsx`                  | 1.2 only                                            | n/a                                                   |
| `src/components/panel/AuthGuard.tsx`            | 1.2 only                                            | n/a                                                   |
| `src/components/panel/PanelSidebar.tsx`         | 1.2, 2 (plan 02), 3.2, 4.1                          | 1.2 → 2 → 3.2 → 4.1 (already enforced by phase order) |
| `src/components/panel/PanelShell.tsx`           | 2 (plan 02), 3.2, 4.1                               | 2 → 3.2 → 4.1                                         |
| `src/pages/panel/DashboardPage.tsx`             | 3.2 only                                            | n/a                                                   |
| `src/pages/PlanificaPage.tsx`                   | B1 only                                             | n/a                                                   |


**Conclusion:** the playbook is fundamentally serial because every wave touches `PanelSidebar.tsx` and `PanelShell.tsx`. Worktrees cannot help. Run one prompt at a time, merge to main, run next.

---

## 7. Capacity budget for the async @claude review-fix loop (G9)

Each PR triggers up to 5 rounds of review-fix in `.github/workflows/claude-review-fix.yml`. Running multiple PRs simultaneously will:

- Burn through GitHub Actions minutes faster than budgeted
- Confuse the loop (concurrent retags can race)
- Make Santiago juggle review threads in parallel — defeats the "one operator" model

Required discipline:

1. **Open one PR at a time per phase.** Phase 1 has three PRs — do them strictly serial: 1.1 PR opens → @claude clean → human merges → 1.2 PR opens → ...
2. **Manual merge breakpoint between waves.** P-1 → P0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → V1. After each wave, confirm main is green and prod is healthy before opening the next wave's first PR.
3. **Do not retag @claude on a stale PR.** If a PR has been open >24h with no progress, either merge or close — don't pile on more review rounds.

---

## 8. Handoff

**Today (no Claude needed):**

1. Resolve R1, R3, R11 in `.iago/context/restructure-decisions.md` (PRE-1).
2. Run PRE-2 pre-flight scan.
3. Open a session inside `clients\munet-web\` (root, not a worktree — single laptop, no parallel humans).
4. Paste **H1**.

**After H1 + H2 are merged:**
5. Paste **P0**, then proceed down §4 in the documented order.

**If anything below P0 returns BLOCK from a stress test, STOP.** Do not override. The council put the block gates in for a reason.

**Cut from MVP, owned by v1.1 backlog (§5):** panic button, notifications, staging branch, contenido-guia UI, bug-bounty sweeps, skill harvest.