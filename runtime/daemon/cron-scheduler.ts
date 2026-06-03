/**
 * CronScheduler — 60s-tick scheduler that fires registered cron entries,
 * optionally gated by a bash wake-check script, into the file-bus
 * `tasks/pending/` directory.
 *
 * Plan 07a contract notes (binding for callers and future maintainers):
 *
 * - **Inline 5-field POSIX parser.** No third-party cron dep (Phase 2
 *   dep-bloat constraint). Supports `*`, integer literals, ranges
 *   `1-5`, step `*​/15` AND `1-30/5` (step with range), comma lists
 *   `1,3,5`, and combinations thereof. The fields are
 *   `minute hour day-of-month month day-of-week` exactly — non-standard
 *   second/year fields are NOT supported.
 *
 * - **POSIX day-OR-weekday OR semantics (C1 from stress test).** When
 *   BOTH `day-of-month` AND `day-of-week` are non-`*`, the match is
 *   `dayOfMonth OR dayOfWeek`, not AND. This is the POSIX standard
 *   (and what cron(8) does). Example: `0 0 1-7 * 1` matches the 1st-7th
 *   of EVERY month OR every Monday — NOT "the first Monday of the
 *   month". Agent authors needing "first Monday only" semantics should
 *   register the cron at `0 0 1-7 * *` and add a `wakeCheck` that
 *   exits 1 when day-of-week is not Monday.
 *
 * - **`spawnSync` 30s timeout (C2).** Wake-check scripts that exceed
 *   30s are SIGKILL'd; the cron-fire emits
 *   `cron-skipped { reason: 'wake-check-timeout', exitCode: null }`
 *   and the tick proceeds. This bounds the time the daemon's main
 *   thread is blocked per tick.
 *
 * - **Overlap prevention via `runningCount` (Codex P1-8).** Each cron
 *   entry has a `maxConcurrent` ceiling (default 1). Before firing,
 *   the scheduler reads `runningCount.get(agentId) ?? 0` and skips
 *   when it equals or exceeds `maxConcurrent` — emitting
 *   `cron-overlap-prevented`. The increment-on-fire path is paired
 *   with a decrement-on-terminal path via the `task-resolved`,
 *   `task-poisoned`, and `task-unrouted` EventEmitter events on
 *   `AgentManager` (all three subscribed in the constructor). Plan
 *   07b adds the emit side; without it, `runningCount` only ever
 *   grows and `maxConcurrent` permanently blocks after the first
 *   fire. The subscription is defensive — it is a no-op until 07b's
 *   emit happens.
 *
 * - **Per-cron filename filtering on terminal events.** A single
 *   `AgentManager` instance may process tasks from multiple sources
 *   (cron AND manual injection). Decrementing `runningCount` purely
 *   by `agentId` would let unrelated task completions reopen cron
 *   slots and defeat `maxConcurrent`. The scheduler tracks each
 *   filename emitted by `fire()` in `outstandingFilenames` (keyed
 *   by agentId) and the terminal listener only decrements when the
 *   event's filename is in that set — non-cron terminations are
 *   ignored. Subscribed to `task-resolved`, `task-poisoned`, AND
 *   `task-unrouted` so every terminal outcome releases the slot
 *   (otherwise a poisoned cron task would leak its slot forever).
 *
 * - **Atomic task-file emission (Windows-safe).** Task files are
 *   written via tmp → rename. The tmp path is on the same directory
 *   as the destination so the rename is a single-FS atomic op on
 *   POSIX and an NTFS-atomic `MOVEFILE_REPLACE_EXISTING` op on
 *   Windows. The destination is unique per fire
 *   (`<prefix>__<unix>.json`) so EEXIST should never surface; if it
 *   does (e.g., two ticks fire in the same second), we use
 *   `atomicRenameStaleDest` to recover.
 *
 * - **`start`/`stop` idempotency + stop-while-in-flight.** Second
 *   `start()` is a no-op (interval handle is single-instance). `stop()`
 *   clears the interval AND awaits any in-flight tick — callers can
 *   rely on "after `await stop()` returns, no more `cron-fired`
 *   events will surface".
 */

import { spawnSync } from "node:child_process";
import type { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";

import { composeRuntimeEnv } from "./cron-agent-env.js";
import {
	assertSafeIdentifier,
	atomicRenameStaleDest,
	getErrnoCode,
	pathFor,
} from "./state-paths.js";
import { emit } from "./telemetry.js";

/** Minimal logger surface — pluggable, defaults to console.error for warnings. */
export interface Logger {
	readonly warn: (msg: string) => void;
	readonly error: (msg: string) => void;
}

/**
 * Subset of `AgentManager` consumed by the scheduler. Typed as an
 * `EventEmitter` because the only behavior the scheduler needs is
 * subscribing to `'task-resolved'` / `'task-poisoned'` /
 * `'task-unrouted'` (which 07b adds to AgentManager). Using a type
 * alias keeps the cross-plan coupling testable — the test file
 * constructs a bare `EventEmitter` and asserts the decrement chain
 * without standing up a full AgentManager.
 */
export type CronAgentManager = EventEmitter;

/**
 * R1 (feature-pr84-r1-daemon-creds) — the daemon-side hook that pre-computes a
 * cron's prompt. For pr-triage the default implementation (wired in main.ts,
 * where `process.env.GH_TOKEN` is available) fetches all open PRs, sanitizes
 * them to a scalar payload, and either:
 *   - `{ skip: true, reason }` — gate the spawn (zero PRs, or a fetch error: do
 *     NOT spawn with stale/no data); this REPLACES the bash wake-check gate, OR
 *   - `{ skip: false, prompt }` — the rendered prompt with the sanitized
 *     payload JSON substituted into the `{{PR_DATA_JSON}}` placeholder.
 *
 * Minor (R1 dual-adversarial) — an optional `exitCode` lets a skip carry the
 * token-free HTTP status of the failed fetch (e.g. 401 vs 403 vs 429) into the
 * `cron-skipped` telemetry's `exitCode` field, so an operator can distinguish a
 * revoked PAT from a rate-limit without server-side logs. Omitted (or `null`)
 * for skips with no HTTP status (zero PRs, network error, template read).
 *
 * `cron` is the registered entry (read `promptTemplatePath` to load the
 * template). Bounded by the implementation's own timeout so a hung GitHub call
 * cannot wedge the 60s tick (the seam is already `async fire()`).
 */
export type PrepareCronPrompt = (cron: RegisteredCron) => Promise<{
	skip: boolean;
	reason?: string;
	prompt?: string;
	exitCode?: number | null;
}>;

/**
 * R1 (feature-pr84-r1-daemon-creds) — clamp a `prepareCronPrompt` hook's
 * free-form `reason` string to the daemon-side skip reasons the `cron-skipped`
 * telemetry kind accepts. An unrecognized value falls back to `prepare-skip` so
 * the telemetry union stays exhaustive without an `as` cast.
 */
function narrowPrepareSkipReason(
	reason: string | undefined,
): "no-open-prs" | "pr-fetch-failed" | "prepare-skip" {
	if (reason === "no-open-prs") return "no-open-prs";
	if (reason === "pr-fetch-failed") return "pr-fetch-failed";
	return "prepare-skip";
}

export interface CronSchedulerOpts {
	readonly agentManager: CronAgentManager;
	readonly stateRoot?: string;
	readonly logger?: Logger;
	/**
	 * Test-only override for `Date.now()`. Production code MUST omit.
	 * @internal
	 */
	readonly nowFn?: () => Date;
	/**
	 * R1 (feature-pr84-r1-daemon-creds) — optional per-cron prompt-preparation
	 * hook. When provided, `fire()` renders the prompt via this hook (daemon
	 * fetch + sanitize + inject) instead of reading the template verbatim, and
	 * gates the spawn on its `skip` result. Omitting it preserves the legacy
	 * verbatim-template behavior for every cron (back-compat).
	 */
	readonly prepareCronPrompt?: PrepareCronPrompt;
	/**
	 * Task 6 gate-finding #2 (hold-slot-until-result) — agentIds whose cron
	 * concurrency slot is held until the RUN COMPLETES, not just until the
	 * prompt is handed off.
	 *
	 * For a normal cron agent the run is a spawn-then-exit lifecycle, so
	 * `task-resolved` (emitted by `claimTask` at prompt handoff) IS the
	 * completion signal and releases the slot. But for a send-contract agent
	 * (pr-triage), `claimTask` fires `task-resolved` the moment the prompt
	 * enters the persistent PTY — long BEFORE the agent writes its result
	 * envelope. Releasing the slot there lets the next cron tick dispatch a
	 * SECOND prompt that overwrites the single-key dead-letter timer and emits a
	 * stale/duplicate envelope.
	 *
	 * For an agentId in this set, the `task-resolved` (prompt-HANDOFF) event does
	 * NOT release the slot; only a `cron-result-complete` event (emitted by the
	 * result-timer machinery when the envelope is processed OR a durable
	 * dead-letter timeout fires) does — carrying the ORIGINAL cron task filename
	 * so the correct outstanding slot is released. Empty by default (every agent
	 * keeps the legacy release-on-handoff behavior).
	 *
	 * Critical (Codex, round 1) — `task-poisoned` and `task-unrouted` are the
	 * EXCEPTION: those are PRE-DISPATCH failures (malformed/oversized payload,
	 * unregistered agentId / registration orphan window) emitted BEFORE any result
	 * timer is armed, so no `cron-result-complete` can ever follow. They ALWAYS
	 * release the slot — even for a deferred agent — so a malformed/oversized/
	 * orphan-window cron task cannot leak the slot forever.
	 */
	readonly deferReleaseAgents?: ReadonlySet<string>;
}

export interface RegisterCronOpts {
	readonly agentId: string;
	readonly schedule: string;
	readonly wakeCheck?: string;
	readonly promptTemplatePath: string;
	readonly outputTaskNamePrefix: string;
	readonly maxConcurrent?: number;
}

export interface RegisteredCron {
	readonly agentId: string;
	readonly schedule: string;
	readonly wakeCheck: string | undefined;
	readonly promptTemplatePath: string;
	readonly outputTaskNamePrefix: string;
	readonly maxConcurrent: number;
}

interface TaskTerminalEvent {
	readonly agentId: string;
	readonly filename: string;
}

const TERMINAL_EVENTS = [
	"task-resolved",
	"task-poisoned",
	"task-unrouted",
] as const;

/**
 * Critical (Codex, daemon-recovery-hardening round 1) — the PROMPT-HANDOFF
 * terminal event. For a deferred (send-contract) agent this marks prompt handoff
 * NOT run completion, so the slot is HELD until `cron-result-complete`. For every
 * other agent it releases the slot.
 *
 * `task-poisoned` and `task-unrouted` (the other two `TERMINAL_EVENTS`) are
 * DISTINCT: they are PRE-DISPATCH failures (malformed/oversized payload, or an
 * unregistered agentId / registration orphan window) emitted by the polling loop
 * BEFORE any dispatch and BEFORE any result timer is armed. No
 * `cron-result-complete` will ever fire for them, so deferring their release
 * would leak the cron slot FOREVER (with `maxConcurrent: 1`, every future cron
 * fire is blocked as an overlap until daemon restart). They therefore ALWAYS
 * release the slot, even for a deferred agent.
 */
const HANDOFF_EVENT = "task-resolved" as const;

/**
 * Task 6 gate-finding #2 — the RUN-COMPLETION terminal event for a
 * send-contract agent (see `deferReleaseAgents`). Emitted by the result-timer
 * machinery (`makeResultTimers`) when the agent's result envelope is processed
 * OR a durable dead-letter timeout fires, carrying the ORIGINAL cron task
 * filename. For a deferred agent this — NOT `task-resolved` — releases the slot.
 */
const RESULT_COMPLETE_EVENT = "cron-result-complete" as const;

const TICK_INTERVAL_MS = 60_000;
const WAKE_CHECK_TIMEOUT_MS = 30_000;

const FIELD_NAMES = [
	"minute",
	"hour",
	"day-of-month",
	"month",
	"day-of-week",
] as const;
type FieldName = (typeof FIELD_NAMES)[number];

const FIELD_RANGES: Record<FieldName, { min: number; max: number }> = {
	minute: { min: 0, max: 59 },
	hour: { min: 0, max: 23 },
	"day-of-month": { min: 1, max: 31 },
	month: { min: 1, max: 12 },
	"day-of-week": { min: 0, max: 6 },
};

/**
 * Type guard that narrows a `(string | undefined)[]` (the shape
 * `split` produces under `noUncheckedIndexedAccess`) into a
 * `[string, string, string, string, string]` tuple.
 *
 * Throws `RangeError` if any slot is unexpectedly missing — caller
 * has already validated `length === 5`, so this branch is unreachable
 * at runtime; the throw exists purely to satisfy strict TS without an
 * `as` cast.
 */
function toFiveTuple(
	xs: ReadonlyArray<string | undefined>,
): readonly [string, string, string, string, string] {
	const a = xs[0];
	const b = xs[1];
	const c = xs[2];
	const d = xs[3];
	const e = xs[4];
	if (
		a === undefined ||
		b === undefined ||
		c === undefined ||
		d === undefined ||
		e === undefined
	) {
		throw new RangeError("internal: expected 5 cron fields after length check");
	}
	return [a, b, c, d, e];
}

/**
 * Match a 5-field POSIX cron expression against a `Date`. Returns
 * `true` when the date's minute/hour/dom/month/dow all match.
 *
 * Implements the POSIX day-OR-weekday semantics: when BOTH
 * `day-of-month` AND `day-of-week` are non-wildcard, the match is
 * `dayOfMonth OR dayOfWeek`. When either is `*`, only the other is
 * consulted. See class-level JSDoc for the rationale.
 *
 * Time interpretation is **UTC** to match daemon-side cron registrations
 * documented in UTC (e.g., `pr-triage` at `0 14 * * *` → 14:00 UTC).
 * If a future caller needs local-time matching, register against a
 * UTC-equivalent schedule.
 *
 * Throws `RangeError` with the offending field named when the
 * expression is malformed (wrong field count, non-numeric token, out
 * of range, etc.).
 *
 * @internal — exported for test access only; do not use from outside
 * the daemon module.
 */
export function matchesCron(expr: string, now: Date): boolean {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new RangeError(
			`cron expression must have 5 fields (got ${fields.length}): "${expr}"`,
		);
	}
	// Hand-coded type guard converts `(string | undefined)[]` (from
	// noUncheckedIndexedAccess) into a typed 5-tuple without `as` casts.
	// Mirrors the JSON-parse type-guard pattern used elsewhere in the
	// daemon (plan 07a Task 1 constraint: NO `as` casts).
	const tuple = toFiveTuple(fields);

	const minuteOk = parseField("minute", tuple[0]).has(now.getUTCMinutes());
	if (!minuteOk) return false;
	const hourOk = parseField("hour", tuple[1]).has(now.getUTCHours());
	if (!hourOk) return false;
	const monthOk = parseField("month", tuple[3]).has(now.getUTCMonth() + 1);
	if (!monthOk) return false;

	const dom = parseField("day-of-month", tuple[2]);
	const dow = parseField("day-of-week", tuple[4]);
	const domWildcard = tuple[2].trim() === "*";
	const dowWildcard = tuple[4].trim() === "*";
	const domMatches = dom.has(now.getUTCDate());
	const dowMatches = dow.has(now.getUTCDay());

	if (domWildcard && dowWildcard) return true;
	if (domWildcard) return dowMatches;
	if (dowWildcard) return domMatches;
	// POSIX OR semantics — when both are restricted, EITHER may match.
	return domMatches || dowMatches;
}

/**
 * Walk every field of a 5-field cron expression and throw `RangeError`
 * if ANY field is malformed. Unlike `matchesCron`, this does NOT
 * short-circuit on the first non-matching minute/hour — every field is
 * parsed unconditionally so that deploy-time misconfiguration surfaces
 * at registration regardless of the current time. Without this,
 * `28 99 * * *` would register cleanly at any minute except :28 and
 * only throw at runtime when the matching minute arrived, by which
 * point the tick swallows the throw and the cron silently never fires.
 *
 * @internal — exported for test access only; do not use from outside
 * the daemon module.
 */
export function validateScheduleSyntax(expr: string): void {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new RangeError(
			`cron expression must have 5 fields (got ${fields.length}): "${expr}"`,
		);
	}
	const tuple = toFiveTuple(fields);
	parseField("minute", tuple[0]);
	parseField("hour", tuple[1]);
	parseField("day-of-month", tuple[2]);
	parseField("month", tuple[3]);
	parseField("day-of-week", tuple[4]);
}

function parseField(name: FieldName, raw: string): Set<number> {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		throw new RangeError(`empty field "${name}"`);
	}
	const { min, max } = FIELD_RANGES[name];
	const out = new Set<number>();
	for (const part of trimmed.split(",")) {
		parsePart(name, part, min, max, out);
	}
	return out;
}

function parsePart(
	name: FieldName,
	part: string,
	min: number,
	max: number,
	out: Set<number>,
): void {
	if (part.length === 0) {
		throw new RangeError(`empty comma-list element in field "${name}"`);
	}
	let stepStr: string | undefined;
	let rangeStr = part;
	const slashIdx = part.indexOf("/");
	if (slashIdx !== -1) {
		rangeStr = part.slice(0, slashIdx);
		stepStr = part.slice(slashIdx + 1);
		if (stepStr.length === 0) {
			throw new RangeError(`empty step in field "${name}": "${part}"`);
		}
	}
	const step = stepStr === undefined ? 1 : Number.parseInt(stepStr, 10);
	if (!Number.isInteger(step) || step <= 0) {
		throw new RangeError(`invalid step in field "${name}": "${part}"`);
	}

	let lo: number;
	let hi: number;
	if (rangeStr === "*") {
		lo = min;
		hi = max;
	} else if (rangeStr === "") {
		// A bare "/N" with no range prefix is a malformed expression (e.g.
		// "/5" instead of "*/5"). Reject rather than silently expand to *.
		throw new RangeError(
			`missing range before step in field "${name}": "${part}"`,
		);
	} else {
		const dashIdx = rangeStr.indexOf("-");
		if (dashIdx === -1) {
			const v = Number.parseInt(rangeStr, 10);
			if (!Number.isInteger(v)) {
				throw new RangeError(`non-numeric value in field "${name}": "${part}"`);
			}
			if (v < min || v > max) {
				throw new RangeError(
					`value out of range in field "${name}": ${v} not in ${min}-${max}`,
				);
			}
			if (stepStr === undefined) {
				out.add(v);
				return;
			}
			// integer with step → treat as "v to max step step"
			lo = v;
			hi = max;
		} else {
			const loStr = rangeStr.slice(0, dashIdx);
			const hiStr = rangeStr.slice(dashIdx + 1);
			lo = Number.parseInt(loStr, 10);
			hi = Number.parseInt(hiStr, 10);
			if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
				throw new RangeError(`non-numeric range in field "${name}": "${part}"`);
			}
			if (lo < min || hi > max || lo > hi) {
				throw new RangeError(
					`range out of bounds in field "${name}": ${lo}-${hi} not in ${min}-${max}`,
				);
			}
		}
	}
	for (let v = lo; v <= hi; v += step) {
		out.add(v);
	}
}

/**
 * CronScheduler — see file header for the contract.
 */
export class CronScheduler {
	private readonly agentManager: CronAgentManager;
	private readonly stateRoot: string | undefined;
	private readonly logger: Logger;
	private readonly nowFn: () => Date;
	private readonly prepareCronPrompt: PrepareCronPrompt | undefined;
	private readonly registered: RegisteredCron[] = [];
	private readonly runningCount = new Map<string, number>();
	// Filenames currently outstanding per agentId (cron-emitted tasks that
	// have not yet hit a terminal event). The terminal listener consults
	// this set to ignore unrelated (non-cron) task completions for the
	// same agent — otherwise a manual task resolution would lower the
	// cron concurrency counter and let the next matching tick fire past
	// `maxConcurrent`.
	private readonly outstandingFilenames = new Map<string, Set<string>>();
	// Task 6 gate-finding #2 — agentIds whose slot is released on
	// `cron-result-complete` (run completion) rather than on `task-resolved`
	// (prompt handoff). See `CronSchedulerOpts.deferReleaseAgents`.
	private readonly deferReleaseAgents: ReadonlySet<string>;
	private interval: NodeJS.Timeout | null = null;
	private tickInFlight: Promise<void> | null = null;
	private stopped = false;
	// Critical (Codex, round 1) — split the terminal listener in two:
	//   - `handoffListener` (task-resolved): prompt handoff; HELD for a deferred
	//     agent (released by `cron-result-complete`), released for everyone else.
	//   - `preDispatchFailListener` (task-poisoned / task-unrouted): a PRE-DISPATCH
	//     failure with no result timer; ALWAYS releases — even for a deferred agent
	//     — so the slot cannot leak forever.
	private readonly handoffListener: (event: TaskTerminalEvent) => void;
	private readonly preDispatchFailListener: (event: TaskTerminalEvent) => void;
	// Task 6 gate-finding #2 — the run-completion listener (separate from
	// the terminal listeners so it can be unsubscribed independently in `stop()`).
	private readonly resultCompleteListener: (event: TaskTerminalEvent) => void;

	constructor(opts: CronSchedulerOpts) {
		this.agentManager = opts.agentManager;
		this.stateRoot = opts.stateRoot;
		this.logger = opts.logger ?? defaultLogger();
		this.nowFn = opts.nowFn ?? (() => new Date());
		this.prepareCronPrompt = opts.prepareCronPrompt;
		this.deferReleaseAgents = opts.deferReleaseAgents ?? new Set<string>();
		// Subscribe immediately so the decrement chain works for every fire,
		// even if `start()` is deferred. Defensive: 07b's `AgentManager`
		// emit-side may not exist yet, so the handler tolerates absent
		// counter entries and unknown filenames.
		//
		// Task 6 gate-finding #2 — `task-resolved` marks prompt HANDOFF. It
		// releases the slot for EVERY agent EXCEPT those in `deferReleaseAgents`;
		// for a deferred (send-contract) agent prompt handoff is NOT run
		// completion, so only the `cron-result-complete` event releases.
		this.handoffListener = (event: TaskTerminalEvent): void => {
			if (!this.isValidTerminalEvent(event)) return;
			if (this.deferReleaseAgents.has(event.agentId)) {
				// Held until `cron-result-complete`. Do NOT release here.
				return;
			}
			this.releaseOutstanding(event.agentId, event.filename);
		};
		// Critical (Codex, round 1) — `task-poisoned` / `task-unrouted` are
		// PRE-DISPATCH failures (malformed/oversized payload, unregistered agent /
		// registration orphan window). They fire from the polling loop BEFORE any
		// dispatch and BEFORE any result timer exists, so NO `cron-result-complete`
		// can ever follow. They must ALWAYS release the slot — including for a
		// deferred agent — or the cron slot leaks forever and `maxConcurrent: 1`
		// blocks every future fire until daemon restart.
		this.preDispatchFailListener = (event: TaskTerminalEvent): void => {
			if (!this.isValidTerminalEvent(event)) return;
			this.releaseOutstanding(event.agentId, event.filename);
		};
		// Task 6 gate-finding #2 — the run-completion event. Releases the slot for
		// a deferred agent (and is a harmless no-op for any other agent, whose
		// outstanding filename was already cleared by `handoffListener`).
		this.resultCompleteListener = (event: TaskTerminalEvent): void => {
			if (!this.isValidTerminalEvent(event)) return;
			this.releaseOutstanding(event.agentId, event.filename);
		};
		for (const evt of TERMINAL_EVENTS) {
			this.agentManager.on(
				evt,
				evt === HANDOFF_EVENT ? this.handoffListener : this.preDispatchFailListener,
			);
		}
		this.agentManager.on(RESULT_COMPLETE_EVENT, this.resultCompleteListener);
	}

	/**
	 * Shape-guard for an inbound terminal/result event. Defensive: the
	 * emit-side (`AgentManager` / result-timer machinery) may pass an unexpected
	 * payload, and a thrown listener would surface on the emitter's call site.
	 */
	private isValidTerminalEvent(event: TaskTerminalEvent): boolean {
		return (
			typeof event === "object" &&
			event !== null &&
			typeof event.agentId === "string" &&
			typeof event.filename === "string"
		);
	}

	/**
	 * Release one outstanding cron slot for `agentId`/`filename` if (and only
	 * if) that filename is a live cron-emitted task for the agent. Idempotent:
	 * a duplicate or non-cron filename is ignored, so the counter never
	 * underflows and non-cron completions cannot reopen cron concurrency slots.
	 */
	private releaseOutstanding(agentId: string, filename: string): void {
		const outstanding = this.outstandingFilenames.get(agentId);
		if (outstanding === undefined || !outstanding.has(filename)) {
			// Not a cron-emitted filename for this agent — manual task, a
			// duplicate terminal event we already processed, or (for a deferred
			// agent) the `task-resolved` we intentionally ignored. No-op.
			return;
		}
		outstanding.delete(filename);
		if (outstanding.size === 0) {
			this.outstandingFilenames.delete(agentId);
		}
		const current = this.runningCount.get(agentId) ?? 0;
		this.runningCount.set(agentId, Math.max(0, current - 1));
	}

	/**
	 * Round-2 Minor (Codex) — RE-HOLD a concurrency slot for an in-flight run
	 * recovered after a daemon restart. The boot-recovery path
	 * (`makeResultTimers.onResultRecovered`) calls this for each still-future
	 * `result-pending/<agentId>.json` marker so the scheduler does NOT boot with
	 * `runningCount=0` for a run that is still pending — otherwise a matching cron
	 * tick could dispatch a SECOND prompt that overwrites the single result marker
	 * (duplicate/stale-run under non-daily cadences). Idempotent: if the filename
	 * is already outstanding for the agent (e.g. a double recovery), it is a no-op
	 * so the counter never over-counts. The symmetric `releaseOutstanding`
	 * (driven by `cron-result-complete` / terminal events) drops it on completion.
	 */
	restoreOutstanding(agentId: string, filename: string): void {
		if (!this.isValidTerminalEvent({ agentId, filename })) return;
		let outstanding = this.outstandingFilenames.get(agentId);
		if (outstanding === undefined) {
			outstanding = new Set<string>();
			this.outstandingFilenames.set(agentId, outstanding);
		}
		// Idempotent: a filename already outstanding must not double-increment.
		if (outstanding.has(filename)) return;
		outstanding.add(filename);
		const current = this.runningCount.get(agentId) ?? 0;
		this.runningCount.set(agentId, current + 1);
	}

	/**
	 * Register a cron entry. Validates `agentId` and `schedule` at the
	 * boundary so a bad spec fails loudly at registration, not at the
	 * first tick.
	 */
	registerCron(opts: RegisterCronOpts): void {
		assertSafeIdentifier(opts.agentId, "agentId");
		assertSafeIdentifier(opts.outputTaskNamePrefix, "outputTaskNamePrefix");
		// Two crons sharing an `outputTaskNamePrefix` that fire on the same
		// minute would land at the same `<prefix>__<unix>.json` destination
		// and `atomicRenameStaleDest` would silently overwrite the first.
		// Reject at registration so the collision surfaces loudly.
		for (const existing of this.registered) {
			if (existing.outputTaskNamePrefix === opts.outputTaskNamePrefix) {
				throw new Error(
					`outputTaskNamePrefix "${opts.outputTaskNamePrefix}" already registered (agent "${existing.agentId}"); prefixes must be unique to prevent task-file collisions`,
				);
			}
		}
		// Eager parse — walks ALL 5 fields unconditionally so that
		// `28 99 * * *` throws at registration regardless of the current
		// minute. `matchesCron` short-circuits at the first non-matching
		// field, so using it here would skip later fields whenever the
		// daemon happened to start outside the matching minute (Codex
		// High #2 from PR #61 review).
		validateScheduleSyntax(opts.schedule);
		const maxConcurrent =
			typeof opts.maxConcurrent === "number" && opts.maxConcurrent > 0
				? Math.floor(opts.maxConcurrent)
				: 1;
		this.registered.push({
			agentId: opts.agentId,
			schedule: opts.schedule,
			wakeCheck: opts.wakeCheck,
			promptTemplatePath: opts.promptTemplatePath,
			outputTaskNamePrefix: opts.outputTaskNamePrefix,
			maxConcurrent,
		});
	}

	/** Start the 60s tick. Idempotent — second call is a no-op. */
	start(): void {
		if (this.interval !== null) return;
		if (this.stopped) {
			throw new Error(
				"CronScheduler.start() called after stop(); construct a fresh instance",
			);
		}
		this.interval = setInterval(() => {
			void this.runTickGuarded();
		}, TICK_INTERVAL_MS);
		// `unref` so the interval does not pin the Node event loop during
		// test teardown if a test forgets to call `stop()`. Production
		// daemon main loop has its own keepalive sources (IPC server, etc.).
		if (typeof this.interval.unref === "function") {
			this.interval.unref();
		}
	}

	/** Stop the scheduler. Clears the interval and awaits any in-flight tick. */
	async stop(): Promise<void> {
		this.stopped = true;
		if (this.interval !== null) {
			clearInterval(this.interval);
			this.interval = null;
		}
		if (this.tickInFlight !== null) {
			try {
				await this.tickInFlight;
			} catch {
				// Swallow — tick errors are already logged via the logger.
			}
		}
		for (const evt of TERMINAL_EVENTS) {
			this.agentManager.off(
				evt,
				evt === HANDOFF_EVENT ? this.handoffListener : this.preDispatchFailListener,
			);
		}
		this.agentManager.off(RESULT_COMPLETE_EVENT, this.resultCompleteListener);
	}

	/**
	 * Test-only: synchronously fire a tick and await it. Allows tests to
	 * drive the scheduler deterministically without running the actual
	 * `setInterval` loop. @internal
	 */
	async _tickForTests(): Promise<void> {
		await this.runTickGuarded();
	}

	/**
	 * Test-only: read the runningCount map. @internal
	 */
	_runningCountForTests(): ReadonlyMap<string, number> {
		return this.runningCount;
	}

	/**
	 * Test-only: read the per-agent set of outstanding cron-emitted task
	 * filenames. Used by tests verifying the terminal listener filter.
	 * @internal
	 */
	_outstandingFilenamesForTests(): ReadonlyMap<string, ReadonlySet<string>> {
		return this.outstandingFilenames;
	}

	private async runTickGuarded(): Promise<void> {
		// Refuse overlapping ticks — if the previous tick is still in
		// flight (e.g., a long-running wakeCheck pushed past the 60s
		// interval), skip this tick. Without this guard, two ticks could
		// race the file-bus write.
		if (this.tickInFlight !== null) return;
		const p = this.runTick();
		this.tickInFlight = p;
		try {
			await p;
		} finally {
			this.tickInFlight = null;
		}
	}

	private async runTick(): Promise<void> {
		const now = this.nowFn();
		for (const cron of this.registered) {
			let matched: boolean;
			try {
				matched = matchesCron(cron.schedule, now);
			} catch (err) {
				this.logger.error(
					`[cron-scheduler] matchesCron threw for agent ${cron.agentId} schedule "${cron.schedule}": ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				continue;
			}
			if (!matched) continue;

			const current = this.runningCount.get(cron.agentId) ?? 0;
			if (current >= cron.maxConcurrent) {
				await emit({
					kind: "cron-overlap-prevented",
					agentId: cron.agentId,
					schedule: cron.schedule,
					runningCount: current,
					maxConcurrent: cron.maxConcurrent,
				});
				continue;
			}

			if (cron.wakeCheck !== undefined) {
				const wakeOk = await this.runWakeCheck(cron, cron.wakeCheck);
				if (!wakeOk) continue;
			}

			await this.fire(cron, now);
		}
	}

	private async runWakeCheck(
		cron: RegisteredCron,
		wakeCheckPath: string,
	): Promise<boolean> {
		// `spawnSync` blocks the event loop — bounded by WAKE_CHECK_TIMEOUT_MS
		// (30s) per C2 stress fix. The synchronous variant is intentional:
		// we want to serialize wake-check execution against the tick so
		// follow-up writes happen after the gate decision.
		// `wakeCheckPath` is the caller-narrowed `cron.wakeCheck` — passing
		// it as a separate parameter avoids an `as string` cast (plan 07a
		// constraint: NO `as` casts).
		// R1 (feature-pr84-r1-daemon-creds, D1 — agents never hold secrets):
		// spawn with a SCRUBBED env (only the non-secret runtime allowlist),
		// NOT the daemon's full `process.env`. Handing `process.env` to a bash
		// subprocess would leak `GH_TOKEN` / `IAGO_TELEGRAM_BOT_TOKEN` to the
		// child, contradicting the invariant that only the daemon holds secrets.
		// `composeRuntimeEnv` is the SAME allowlist `composeCronAgentEnv` uses —
		// single source of truth (`./cron-agent-env.ts`).
		const result = spawnSync("bash", [wakeCheckPath], {
			env: composeRuntimeEnv(process.env),
			encoding: "utf8",
			timeout: WAKE_CHECK_TIMEOUT_MS,
			killSignal: "SIGKILL",
		});
		// `signal: "SIGKILL"` indicates timeout — set above so the check below
		// reliably distinguishes timeout from a non-zero exit.
		if (result.signal === "SIGKILL") {
			await emit({
				kind: "cron-skipped",
				agentId: cron.agentId,
				schedule: cron.schedule,
				reason: "wake-check-timeout",
				exitCode: null,
			});
			return false;
		}
		if (result.error !== undefined) {
			// Spawn-level error (e.g., bash not on PATH). Treat as failure.
			await emit({
				kind: "cron-skipped",
				agentId: cron.agentId,
				schedule: cron.schedule,
				reason: "wake-check-failed",
				exitCode: typeof result.status === "number" ? result.status : null,
			});
			return false;
		}
		if (result.status !== 0) {
			await emit({
				kind: "cron-skipped",
				agentId: cron.agentId,
				schedule: cron.schedule,
				reason: "wake-check-failed",
				exitCode: typeof result.status === "number" ? result.status : null,
			});
			return false;
		}
		return true;
	}

	private async fire(cron: RegisteredCron, now: Date): Promise<void> {
		let prompt: string;
		if (this.prepareCronPrompt !== undefined) {
			// R1 (feature-pr84-r1-daemon-creds) — daemon-side prompt prep:
			// fetch + sanitize + inject the scalar payload, and gate the spawn.
			// This REPLACES the bash wake-check gate for pr-triage (zero PRs →
			// no spawn, no task file, matching the old wake-check exit-1
			// behavior). A fetch error returns `{ skip: true }` so we never
			// spawn with stale/no data.
			let prepared: {
				skip: boolean;
				reason?: string;
				prompt?: string;
				exitCode?: number | null;
			};
			try {
				prepared = await this.prepareCronPrompt(cron);
			} catch (err) {
				// Defensive: a throwing hook must not wedge the tick. Treat as a
				// skip with a fetch-failed reason.
				await emit({
					kind: "cron-skipped",
					agentId: cron.agentId,
					schedule: cron.schedule,
					reason: "pr-fetch-failed",
					exitCode: null,
				});
				this.logger.error(
					`[cron-scheduler] prepareCronPrompt threw for agent ${cron.agentId}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				return;
			}
			if (prepared.skip || typeof prepared.prompt !== "string") {
				await emit({
					kind: "cron-skipped",
					agentId: cron.agentId,
					schedule: cron.schedule,
					reason: narrowPrepareSkipReason(prepared.reason),
					// Minor (fetch-error observability): forward the token-free HTTP
					// status the hook surfaced (e.g. 401/403/429) so the operator can
					// tell a revoked PAT from a rate-limit. `null` when the skip has no
					// HTTP status (zero PRs, network error, template read).
					exitCode: prepared.exitCode ?? null,
				});
				return;
			}
			prompt = prepared.prompt;
		} else {
			try {
				prompt = fs.readFileSync(cron.promptTemplatePath, "utf8");
			} catch (err) {
				await emit({
					kind: "cron-fired-prompt-missing",
					agentId: cron.agentId,
					schedule: cron.schedule,
					promptTemplatePath: cron.promptTemplatePath,
					errno: getErrnoCode(err) ?? "EUNKNOWN",
				});
				return;
			}
		}

		const unix = Math.floor(now.getTime() / 1000);
		const filename = `${cron.outputTaskNamePrefix}__${unix}.json`;
		const pendingDir = this.resolvePendingDir();
		const finalPath = path.join(pendingDir, filename);
		const tmpName = `.${cron.outputTaskNamePrefix}__${unix}.${process.pid}.${Math.random()
			.toString(36)
			.slice(2, 10)}.tmp`;
		const tmpPath = path.join(pendingDir, tmpName);

		const body = JSON.stringify({
			prompt,
			agentId: cron.agentId,
			needsApproval: false,
		});

		try {
			fs.mkdirSync(pendingDir, { recursive: true });
			fs.writeFileSync(tmpPath, body, { encoding: "utf8" });
			await atomicRenameStaleDest(tmpPath, finalPath);
		} catch (err) {
			// Best-effort tmp cleanup.
			try {
				fs.unlinkSync(tmpPath);
			} catch {
				// Already gone or never created — fine.
			}
			await emit({
				kind: "cron-fired-write-failed",
				agentId: cron.agentId,
				schedule: cron.schedule,
				taskFile: finalPath,
				errno: getErrnoCode(err) ?? "EUNKNOWN",
			});
			return;
		}

		const next = (this.runningCount.get(cron.agentId) ?? 0) + 1;
		this.runningCount.set(cron.agentId, next);
		// Record the basename (not finalPath) — AgentManager (07b) emits
		// task-{resolved,poisoned,unrouted} with the basename, so the
		// terminal listener's `outstanding.has(event.filename)` compares
		// like-for-like. Without this, the decrement path would never
		// match and runningCount would only grow.
		let outstanding = this.outstandingFilenames.get(cron.agentId);
		if (outstanding === undefined) {
			outstanding = new Set<string>();
			this.outstandingFilenames.set(cron.agentId, outstanding);
		}
		outstanding.add(filename);
		await emit({
			kind: "cron-fired",
			agentId: cron.agentId,
			schedule: cron.schedule,
			taskFile: finalPath,
			runningCount: next,
		});
	}

	private resolvePendingDir(): string {
		if (this.stateRoot !== undefined && this.stateRoot.length > 0) {
			return path.join(this.stateRoot, "tasks", "pending");
		}
		return pathFor("tasks/pending");
	}
}

function defaultLogger(): Logger {
	return {
		warn: (msg) => console.warn(msg),
		error: (msg) => console.error(msg),
	};
}
