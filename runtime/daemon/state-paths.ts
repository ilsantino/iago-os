/**
 * Centralized state path resolution + cross-platform primitives for the
 * v2 daemon. Imported by file-bus, session-log, agent-manager (Plan 03),
 * telemetry (Plan 05), approvals (Plan 06), and Telegram routing
 * (Plan 07). Every Phase 1 plan calls `pathFor(kind)` instead of
 * constructing paths inline.
 *
 * Resolution order for the state root:
 *   1. process.env.IAGO_DAEMON_STATE_ROOT
 *   2. <cwd>/runtime/state if path.basename(cwd) === "iago-os"
 *   3. <homedir>/.iago-os/daemon-state
 *
 * Plan 02 stress-test E2: `atomicRename(src, dst)` exposed here so every
 * tmp→final rename across the daemon (resolved outputs, HWM markers,
 * approvals, telemetry checkpoints) goes through the Windows EEXIST
 * handler. Acceptable small race on Windows between unlink and rename
 * — revisit in Phase 7 if a paying client needs strict atomicity.
 *
 * Plan 02 stress-test 2nd-pass: `validateAgentId(id)` enforces the
 * filename safety contract for `<agentId>__<taskId>.json` task files
 * across the daemon's file-bus and Telegram routing. The file-bus
 * itself treats taskIds as opaque (see `file-bus.ts` header).
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type StateKind =
	| "tasks/pending"
	| "tasks/claimed"
	| "tasks/resolved"
	| "approvals/pending"
	| "approvals/resolved"
	| "agents"
	| "telemetry"
	| "session-logs"
	| "markers";

const ALL_KINDS: ReadonlyArray<StateKind> = [
	"tasks/pending",
	"tasks/claimed",
	"tasks/resolved",
	"approvals/pending",
	"approvals/resolved",
	"agents",
	"telemetry",
	"session-logs",
	"markers",
];

export function getStateRoot(): string {
	const envOverride = process.env.IAGO_DAEMON_STATE_ROOT;
	if (envOverride !== undefined && envOverride.length > 0) {
		return envOverride;
	}
	const cwd = process.cwd();
	if (path.basename(cwd) === "iago-os") {
		return path.join(cwd, "runtime", "state");
	}
	return path.join(os.homedir(), ".iago-os", "daemon-state");
}

export function pathFor(kind: StateKind): string {
	return path.join(getStateRoot(), kind);
}

export function ensureStateDirsSync(): void {
	for (const kind of ALL_KINDS) {
		fs.mkdirSync(pathFor(kind), { recursive: true });
	}
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const AGENT_ID_PATTERN = /^[a-z][a-z0-9\-]{0,62}$/;

export type AgentIdValidation =
	| { readonly valid: true }
	| { readonly valid: false; readonly reason: string };

/**
 * Validate an agent id against the filename safety contract.
 *
 * Constraints (Plan 02 stress-test 2nd-pass):
 *   - 1–63 chars, starts with [a-z], rest [a-z0-9-]
 *   - no `__` substring (defense-in-depth — also blocked by the regex)
 *   - rejects Windows reserved basenames (CON/PRN/AUX/NUL/COM[1-9]/LPT[1-9])
 *     case-insensitive
 *   - rejects empty string
 */
export function validateAgentId(id: string): AgentIdValidation {
	if (typeof id !== "string" || id.length === 0) {
		return { valid: false, reason: "empty" };
	}
	if (id.length > 63) {
		return { valid: false, reason: "too-long" };
	}
	if (id.includes("__")) {
		return { valid: false, reason: "double-underscore" };
	}
	if (!AGENT_ID_PATTERN.test(id)) {
		return { valid: false, reason: "invalid-chars" };
	}
	if (WINDOWS_RESERVED.test(id)) {
		return { valid: false, reason: "windows-reserved" };
	}
	return { valid: true };
}

const isWindows = process.platform === "win32";

const MAX_IDENTIFIER_LEN = 200;

/**
 * Reject identifiers that could escape the state root when composed into
 * file paths. Callers of the file-bus and session-log MUST validate
 * `taskId`/`handleId` at the trust boundary; Plan 07 will feed
 * user-derived strings into the `<agentId>__<taskId>.json` convention,
 * so this is defense-in-depth rather than a hypothetical concern.
 *
 * Throws `TypeError` (a programmer/security error, not a regular
 * recoverable failure).
 */
export function assertSafeIdentifier(value: string, label: string): void {
	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(`${label} must be a non-empty string`);
	}
	if (value.length > MAX_IDENTIFIER_LEN) {
		throw new TypeError(`${label} exceeds ${MAX_IDENTIFIER_LEN} characters`);
	}
	if (value.includes("/") || value.includes("\\")) {
		throw new TypeError(`${label} must not contain path separators`);
	}
	if (value.includes("..")) {
		throw new TypeError(`${label} must not contain ".."`);
	}
	if (value.includes("\0")) {
		throw new TypeError(`${label} must not contain NUL bytes`);
	}
}

export function getErrnoCode(err: unknown): string | undefined {
	if (err instanceof Error && "code" in err) {
		const candidate = (err as { code?: unknown }).code;
		return typeof candidate === "string" ? candidate : undefined;
	}
	return undefined;
}

/**
 * Atomic rename across platforms.
 *
 * On POSIX, `rename(2)` overwrites the destination atomically.
 * On Windows, Node's `fs.promises.rename` does not pass
 * MOVEFILE_REPLACE_EXISTING and returns EEXIST/EPERM when the target
 * exists; we unlink then rename. This opens a small race window —
 * acceptable for Phase 1; revisit in Phase 7 if strict atomicity is
 * required.
 *
 * Used by Plan 02 (resolved outputs, HWM markers) and Plans 03/05/06
 * for any tmp→final publish.
 */
export async function atomicRename(src: string, dst: string): Promise<void> {
	if (!isWindows) {
		await fsp.rename(src, dst);
		return;
	}
	try {
		await fsp.rename(src, dst);
	} catch (err) {
		const code = getErrnoCode(err);
		if (code !== "EEXIST" && code !== "EPERM") {
			throw err;
		}
		await fsp.unlink(dst);
		await fsp.rename(src, dst);
	}
}
