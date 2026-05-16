# Opus 4.7 Adversarial Pass — PR #127

**Date:** 2026-05-15
**Branch:** feat/estado-keyword
**HEAD:** 07ffca9
**Base:** origin/sentria-qc
**Reviewer:** Opus 4.7 (orchestrator-driven; subagent stalled twice mid-investigation, completed by direct file inspection)

## Verdict

**REQUEST_CHANGES** — 2 HIGH + 2 MEDIUM + 4 LOW. The two HIGH findings are policy-relevant data-exposure issues that change the feature's risk surface vs. the existing web UI. None are runtime-blocking; all are fixable inside the existing module boundary.

## Findings

### [HIGH] Reporter authorization scope diverges from web-UI policy

- **File:** `amplify/functions/incidentFlowHandler/estado/lookup.ts:186-206` and `amplify/functions/incidentFlowHandler/estado/estado.ts:163-193`
- **Description:** `fetchIncidentStatus` accepts `(organizationId, displayIncidentId)` and returns the full `IncidentSummary` (status, reporter name, assigned tech name, timestamps) to ANY identified user in the tenant. The orchestrator passes `args.organizationId` only — never the caller's role, phone, or user id. The existing web UI scopes reporters to incidents they reported via `src/lib/incident-permissions.ts:67-72` (`canViewIncident` → `isOwnIncident`). The Estado keyword bypasses this scoping entirely. A reporter who has linked Telegram can iterate `Estado INC-0001`, `Estado INC-0002`, … and inspect every peer's incident: status transitions, who reported it, which technician handles it, when it was created.
- **Why it matters:** the comment in `incident-permissions.ts:62-66` is explicit — model-level read is granted at the backend ("not an authorization boundary"), the UX layer is what restricts reporters. The new Telegram surface IS a new UX surface that ignores that restriction. On a factory floor where reporter-to-reporter visibility is intentionally limited (workplace dynamics, safety incident discretion, complaint routing), this expands the exposed attack-surface immediately and silently. Codex GPT-5.5 independently surfaced this in its parallel pass.
- **Suggested fix:** thread caller identity into the Estado handler. `incidentFlowHandler` already receives `phoneNumber` and `userType` per `FlowHandlerEvent`. Pass `{ phoneNumber, userType, callerUserId? }` into `handleEstadoKeyword` → `fetchIncidentStatus` → return `null` (treated as not-found) when `userType === "reporter"` and the resolved incident's `reportedBy.reporterUserId !== callerUserId` AND `normalizePhoneForCompare(reportedBy.phone) !== normalizePhoneForCompare(callerPhone)`. Mirror `isOwnIncident` server-side. Staff (`technician`/`admin`/the implicit "user" role) keep unrestricted org-wide read.

### [HIGH] Markdown injection through interpolated names — known existing surface, but Estado WIDENS the blast radius enormously

- **File:** `amplify/functions/incidentFlowHandler/estado/estado.ts:117-145` (`formatEstadoReply`) and `amplify/functions/shared/messageFormatter.ts:111` (existing surface)
- **Description:** `formatEstadoReply` interpolates `incident.reportedBy.name`, `incident.assignedTechnicianName`, and `lastAction.toStatus` (mapped through `statusLabel`) into a Telegram Markdown message that is sent with the default `parse_mode: Markdown` (legacy). Telegram's legacy Markdown treats unescaped `*`, `_`, `` ` ``, `[`, `]` as formatting metacharacters; an unmatched `*` breaks the rest of the message. An admin who creates a Technician with `name = "Juan *boss* Pérez"` causes every Estado reply that includes this tech to render with broken bold spans. With the HIGH-1 finding combined, ANY reporter can probe ANY incident's tech and reporter names — a hostile or buggy admin entry now affects all Telegram replies bot-wide. Plan said "out of scope, matches existing surface"; the existing surface (`formatIncidentDetails`) is invoked only in narrow contexts (web UI rendering or specific notifications). Estado runs in EVERY user's chat, on demand, for every probed incident.
- **Why it matters:** not script execution (Telegram strips HTML), but UX corruption + potential phishing payload (`[click here](https://attacker.example)` in a reporter name field rendered as a Telegram link). Real impact: a name like `[Pago urgente — toca aquí](https://evil.example)` lands in a Markdown reply and renders as a clickable link.
- **Suggested fix:** add a Telegram-Markdown escape function (escape `*`, `_`, `` ` ``, `[`) and apply to all interpolated user-controlled fields. ~10 lines of code in `estado.ts`. OR switch the message to `parse_mode: MarkdownV2` and use the documented escape rules — but that requires `telegramSender` to accept the parse_mode override per message. The escape function is the cheaper fix. Apply to `incident.reportedBy.name`, `incident.assignedTechnicianName`, and any `lastAction.notes` if/when that ever lands in the reply. (Currently `notes` is fetched but not rendered — escape if you start rendering it.)

### [MEDIUM] Tech-assignment notification doesn't persist `state.metadata.incidentId`, so newly-assigned techs hit GSI lag

- **File:** `amplify/functions/incidentFlowHandler/handler.ts` — every path that notifies a tech of a new assignment.
- **Description:** the recently-created fast path (`fetchIncidentStatusByPk`) only fires when `state.metadata.incidentId === parsed.incidentId` AND `state.incidentId` is the PK string. The reporter creation path correctly sets both at `handler.ts:945-955` and `965-977` ("✅ Incidente creado" + Tip line). The tech-acceptance flow at `handler.ts:366` sets `state.metadata = { ...state.metadata, incidentId: activeIncident.incidentId }` on the `awaiting_technician_action` transition — also good. **Gap:** when a NEW assignment notification is dispatched to a technician (the `sendPendingAssignment` path), the technician's conversation state is updated to `awaiting_technician_acceptance` for that incident, but inspection of the `pendingAssignmentDispatch` flow shows the metadata write happens only on the tech's NEXT inbound message that triggers the dispatcher (line 366 path), not at the moment the assignment notification is sent. If the tech reads the notification and types `Estado INC-XXXX` BEFORE clicking accept/reject, `state.metadata.incidentId` may be stale (from a prior incident or unset) → fast path doesn't fire → falls through to compound-GSI lookup → returns `not found` for ~1-10s after creation.
- **Why it matters:** the most likely user behavior is exactly this: tech receives "INC-0042 has been assigned to you", reads the description, types `Estado INC-0042` to see the full context. The bot returns "no encontré el incidente". Tech doubts the system. Trust degrades.
- **Suggested fix:** the `sendPendingAssignment` path that writes the tech's pending assignment notification should also write the tech's conversation-state metadata at the same moment (DDB write) with the incident's display ID. Roughly: when sending the notification, also issue a `writeConversationState` for the tech's chatId with `metadata: { incidentId: <displayId> }`. Cost: one extra DDB write per assignment dispatch. Alternatively (cheaper): extend `fetchIncidentStatus` to also accept an `incidentPkHint?: string` and have the orchestrator try the PK fast path opportunistically when `state.incidentId` is set, even if the metadata.incidentId match doesn't pre-confirm.

### [MEDIUM] StatusChange pagination cap silently truncates "Última acción" on long histories

- **File:** `amplify/functions/incidentFlowHandler/estado/lookup.ts:100-179` (`fetchLatestStatusChange`)
- **Description:** the implementation paginates StatusChange rows in pages of 100, capped at 4 pages (400 rows total). On reaching the cap, logs `estado.status_change_cap_hit` and proceeds with whatever was collected. The "latest" status change is then picked from the collected window via `pickLatestStatusChange`. For an incident with >400 status transitions (escalations, multiple tech rejections, repeated re-assignments + cron writes), the actually-latest StatusChange is whatever DDB returned LAST in pagination — which is NOT chronologically last because the GSI's implicit sort key is `id` (lexicographic). User sees an arbitrary stale `Última acción`. The comment claims "under normal use an incident records ~3-15 transitions" — true today, but escalation cron + assignment-timeout cron + quality-check cron can push this past 100 over the lifetime of a long-cycled incident, and a single `INC` reaching 400 is possible after weeks of automated bouncing.
- **Why it matters:** the user is shown a confidently-formatted "Última acción" that is actively wrong. This is worse than not showing it.
- **Suggested fix:** when the cap is hit (`nextToken` non-null after page 4), DO NOT trust the picked latest — the real latest is in pages we didn't fetch. Either render a fallback `Última acción: histórico extenso (más de 400 cambios — abre el incidente en la web para ver el detalle)`, OR add a chronologically-sorted GSI on StatusChange (`incidentId + changedAt`) to make `sortDirection: DESC, limit: 1` reliable. The schema fix is the proper solve and matches Codex GPT-5.5's original recommendation; the truncation guard is the cheap interim.

### [LOW] `lookup.ts` `IncidentItem.reportedAt` typed as `string` but interfaces lie when DDB returns null

- **File:** `amplify/functions/incidentFlowHandler/estado/lookup.ts:42-50`
- **Description:** `IncidentItem.reportedAt: string` (non-nullable) is the GraphQL response shape, but `toSummary` widens to `IncidentSummary.reportedAt: string | null`. The widening is sound, but `executeGraphQL<T>` returns the cast result — if AppSync actually returns `reportedAt: null` for a legacy row, TypeScript thinks it's a string. The downstream `safeDateTime` handles null/garbage at runtime, so no crash; but the type contract is a soft lie. Codex's prior fix said reportedAt is `a.datetime().required()` at the schema level (line 551 of `resource.ts`) — so legitimately non-null. But Amplify Gen 2 has known footguns where required scalar fields can return null on partially-written rows during migrations. The defensive `string | null` on `IncidentSummary` is justified; tighten `IncidentItem.reportedAt` to match.
- **Suggested fix:** change `IncidentItem.reportedAt` to `string | null` to match `IncidentSummary` and the `safeDateTime` contract. One-line change.

### [LOW] `STEP_REMINDERS` map missing several conversation steps

- **File:** `amplify/functions/incidentFlowHandler/estado/estado.ts` (`STEP_REMINDERS`)
- **Description:** the map covers 14 steps (creation flow + tech action steps). Inspection of the actual `ConversationStep` enum in `shared/types.ts` is needed to confirm completeness. Steps that may be missing: any newly-introduced step from PR #111 (escalation flow), the `awaiting_quality_check` is present, but the post-cancellation transient steps may not be. Missing keys cause silent no-reminder behavior — acceptable functionally (graceful degradation), but the user sees a status reply with no continuity hint and may assume the bot has forgotten what they were doing.
- **Suggested fix:** drive the map from the `ConversationStep` enum exhaustively. TypeScript can enforce it via `Record<ConversationStep, string | null>` where `null` means "no reminder needed" (e.g., for `idle`, terminal states). Eliminates the silent-miss class.

### [LOW] `changedBy` is selected by `STATUS_CHANGE_QUERY` but never rendered, and IS logged in `estado.ok`

- **File:** `amplify/functions/incidentFlowHandler/estado/lookup.ts:93-98` (selects `changedBy`) — not directly logged, but the `lastAction` object containing `changedBy` is constructed by `pickLatestStatusChange` and could leak into log payloads if a future logger spreads it.
- **Description:** `changedBy` contains either a Cognito sub (UUID) or a Telegram chatId or the literal `"system"`. Cognito subs are not PII, but Telegram chatIds are direct user identifiers. They are NOT in the current `[ESTADO] ok` log (which logs `hasLastAction: boolean`, not the action itself), but a maintainer adding "include lastAction details" to debug a future bug would inadvertently expose chatIds in CloudWatch.
- **Suggested fix:** drop `changedBy` from the `STATUS_CHANGE_QUERY` selection set (and from the `LastAction` interface) since nothing renders or uses it. Future code can reintroduce it deliberately.

### [LOW] `.gitignore` change — `amplify_outputs*` is broader than the prior 3 patterns and silently shadows future `amplify_outputs.example.json` etc.

- **File:** `.gitignore` (existing patterns: `amplify_outputs.json`, `amplify_outputs.prod.json`, `amplify_outputs.*.json`; PR adds `amplify_outputs*`)
- **Description:** the new pattern catches `amplify_outputs.json.stub-bak` (the file that triggered the original review finding) but also silently excludes any file beginning with `amplify_outputs` — a future intentionally-checked-in `amplify_outputs.example.json` or `amplify_outputs.README.md` would also be hidden.
- **Suggested fix:** narrow to the specific pattern that was leaking: `amplify_outputs*.bak`, `amplify_outputs*.stub*`. Don't blanket-ignore the prefix.

### [LOW] Discoverability hint is interpolated correctly but only fires for the reporter who created the incident

- **File:** `amplify/functions/incidentFlowHandler/handler.ts:967` (Tip line in incident-created confirmation)
- **Description:** the Tip "_escribe Estado {incidentId} en cualquier momento_" uses the display `incidentId` correctly (verified — both line 945 and 965 paths). But the technician who later accepts the incident gets a notification template (`TECHNICIAN_ASSIGNMENT` or `TECHNICIAN_ACCEPTANCE`) without an Estado hint. Discoverability is reporter-only.
- **Suggested fix:** append the same Tip line to the technician notification templates. Combined with the MEDIUM-1 fix (persist metadata.incidentId on tech notification), this gives techs the same fast-path Estado experience reporters get.

## What I checked and is clean

- `executeGraphQL` generic addition is backward-compatible (default `T = Record<string, unknown>`); existing 30+ call sites unaffected.
- `skipStateSave` correctly guards the primary `saveConversationState` call at `telegramWebhook/handler.ts` and does NOT block `secondaryStateToSave` (which the Estado handler never sets). The wiring is correct.
- `CLAUDE.md` change is scoped to the No Test Suite section only — no accidental rewrite of CI Review Rules.
- No stale `listIncidentByIncidentId` (without `AndOrganizationId`) call sites in `amplify/` or `src/` — the schema migration is consistently consumed.
- The post-fetch `if (inc.organizationId !== organizationId) return null` defensive guard is preserved despite the compound-GSI key making it theoretically redundant — appropriate defense in depth against future schema regressions.
- `package.json` adds only `tsx` devDep and `test:estado` script. `tsx` (^4.19.2) is a portable TypeScript executor with no Node-version footguns; safer than `--experimental-strip-types`.
- `getIncident` is a real base-table GetItem (verified — no GSI involvement); `fetchIncidentStatusByPk` correctly bypasses GSI lag.
- `safeDateTime` correctly handles null and `Number.isNaN(Date.parse)` — no "Invalid Date" verbatim.
- Telegram message-length: the worst plausible reply (long reporter name + tech name + step reminder) is well under 4096 chars (~600 chars worst case).

## Top 3 to fix

1. **HIGH-1: Reporter authorization scope.** Thread caller identity into `handleEstadoKeyword` → `fetchIncidentStatus`; mirror `isOwnIncident` server-side. Without this, reporters can enumerate every incident in the org via Telegram even though the web UI hides them. Codex GPT-5.5 independently flagged the same issue — high confidence.
2. **HIGH-2: Markdown escape for interpolated names.** ~10 lines in `estado.ts`. Eliminates rendering corruption AND a low-but-real phishing-link surface (`[click](https://evil.example)` in a name field).
3. **MEDIUM-1: Persist `state.metadata.incidentId` on tech-assignment dispatch.** The fast-path was designed to handle the most likely "I just got told about INC-XXXX, let me query it" scenario; the tech path silently misses it. One DDB write per assignment, much better tech UX during GSI lag.

The two HIGH findings together change the feature from "ship as-is" to "fix before announcing publicly." The schema-deploy gate from the original plan still applies.
