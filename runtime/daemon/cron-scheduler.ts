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
 *   with a decrement-on-resolve path via the `task-resolved`
 *   EventEmitter event on `AgentManager` (subscribed in the
 *   constructor). Plan 07b adds the emit side; without it,
 *   `runningCount` only ever grows and `maxConcurrent` permanently
 *   blocks after the first fire. The subscription is defensive —
 *   it is a no-op until 07b's emit happens.
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
 * subscribing to `'task-resolved'` (which 07b adds to AgentManager).
 * Using a type alias keeps the cross-plan coupling testable —
 * the test file constructs a bare `EventEmitter` and asserts the
 * decrement chain without standing up a full AgentManager.
 */
export type CronAgentManager = EventEmitter;

export interface CronSchedulerOpts {
	readonly agentManager: CronAgentManager;
	readonly stateRoot?: string;
	readonly logger?: Logger;
	/**
	 * Test-only override for `Date.now()`. Production code MUST omit.
	 * @internal
	 */
	readonly nowFn?: () => Date;
}

export interface RegisterCronOpts {
	readonly agentId: string;
	readonly schedule: string;
	readonly wakeCheck?: string;
	readonly promptTemplatePath: string;
	readonly outputTaskNamePrefix: string;
	readonly maxConcurrent?: number;
}

interface RegisteredCron {
	readonly agentId: string;
	readonly schedule: string;
	readonly wakeCheck: string | undefined;
	readonly promptTemplatePath: string;
	readonly outputTaskNamePrefix: string;
	readonly maxConcurrent: number;
}

interface TaskResolvedEvent {
	readonly agentId: string;
	readonly filename: string;
}

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
	if (rangeStr === "*" || rangeStr === "") {
		lo = min;
		hi = max;
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
	private readonly registered: RegisteredCron[] = [];
	private readonly runningCount = new Map<string, number>();
	private interval: NodeJS.Timeout | null = null;
	private tickInFlight: Promise<void> | null = null;
	private stopped = false;
	private readonly resolvedListener: (event: TaskResolvedEvent) => void;

	constructor(opts: CronSchedulerOpts) {
		this.agentManager = opts.agentManager;
		this.stateRoot = opts.stateRoot;
		this.logger = opts.logger ?? defaultLogger();
		this.nowFn = opts.nowFn ?? (() => new Date());
		// Subscribe immediately so the decrement chain works for every fire,
		// even if `start()` is deferred. Defensive: 07b's `AgentManager`
		// emit-side may not exist yet, so the handler tolerates absent
		// counter entries.
		this.resolvedListener = (event: TaskResolvedEvent): void => {
			if (
				typeof event !== "object" ||
				event === null ||
				typeof event.agentId !== "string"
			) {
				return;
			}
			const current = this.runningCount.get(event.agentId) ?? 0;
			this.runningCount.set(event.agentId, Math.max(0, current - 1));
		};
		this.agentManager.on("task-resolved", this.resolvedListener);
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
		// Eager parse — surfaces RangeError immediately.
		matchesCron(opts.schedule, this.nowFn());
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
		this.agentManager.off("task-resolved", this.resolvedListener);
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
		const result = spawnSync("bash", [wakeCheckPath], {
			env: process.env,
			encoding: "utf8",
			timeout: WAKE_CHECK_TIMEOUT_MS,
		});
		// `signal: "SIGKILL"` indicates timeout (Node's `spawnSync` kills
		// the child with SIGKILL when `timeout` elapses).
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
		warn: (msg) => console.error(msg),
		error: (msg) => console.error(msg),
	};
}
