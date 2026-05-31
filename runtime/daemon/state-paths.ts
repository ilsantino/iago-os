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
 * Atomic-rename API (Plan feature-phase-1-deferred-hardening/02 — two
 * variants, named for self-documenting callsites; see
 * `runtime/daemon/state-paths.md` for the full caller audit):
 *
 *   - `atomicRename(src, dst)` — STRICT. Throws `EEXIST` (POSIX) or
 *     `EEXIST`/`EPERM`/`EBUSY` (Windows) when `dst` already exists. Use when the
 *     dst MUST NOT be destroyed because a concurrent writer's data there
 *     is a legitimate race winner (e.g., approval-bus CLAIM phase).
 *   - `atomicRenameStaleDest(src, dst)` — DESTRUCTIVE. Replaces `dst`
 *     atomically; on Windows uses unlink-then-rename to recover from
 *     `EEXIST`/`EPERM`. Use when the dst is by definition stale (e.g.,
 *     HWM markers, per-taskId resolved outputs already serialized by an
 *     owner-ID check upstream).
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
	| "tasks/poisoned"
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
	"tasks/poisoned",
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
		// Normalize against cwd at this moment — the state root MUST be absolute
		// so subprocesses with differing cwds resolve to the same directory.
		// path.resolve is a no-op if the value is already absolute.
		return path.resolve(envOverride);
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
		// 0o700: state dirs are daemon-private. Persisted agent configs under
		// `agents/` carry per-agent env, so other local users on the host must not
		// be able to traverse/read them. (R1 removed daemon-owned SECRETS from the
		// cron-agent env: composeCronAgentEnv NO LONGER injects the Telegram bot
		// token or GH PAT — only PATH/HOME/SHELL/LANG/IAGO_DAEMON_STATE_ROOT. The
		// 0o700 mode stays as defense-in-depth for per-agent env and any future
		// secret-bearing agent type.) The mode survives a 0o022 umask (no
		// group/other bits to clear). systemd `LoadCredential=` adds at-rest
		// ENCRYPTION on top in Phase 2 — filesystem perms ≠ encryption.
		const dir = pathFor(kind);
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		// pr84 IMPORTANT (upgrade hardening): `mkdirSync`'s `mode` is applied
		// ONLY when the directory is CREATED. A daemon upgraded from an older
		// build that created `agents/` (or any state dir) at the default
		// ~0o755 would leave secret-bearing configs world-readable. chmod on
		// EVERY call so an existing dir is tightened to 0o700 too. POSIX-only:
		// NTFS ignores POSIX bits (the daemon's at-rest target is the POSIX
		// VPS), and `chmod` on Windows would no-op the group/other clearing.
		if (!isWindows) {
			fs.chmodSync(dir, 0o700);
		}
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
 * STRICT atomic rename across platforms — throws if `dst` already exists.
 *
 * Use when the destination MUST NOT be destroyed because a concurrent
 * writer's data there is a legitimate race winner. The canonical caller
 * is the approval-bus CLAIM phase: two callers racing to claim the same
 * approval id rename `pending/<id>.json` → `inflight/<id>.json`; the
 * loser MUST observe EEXIST so it knows the winner has already claimed,
 * not silently overwrite the winner's inflight file.
 *
 * Implementation: `fsp.link(src, dst)` + `fsp.unlink(src)` on both
 * platforms. `link(2)` (POSIX) and `CreateHardLinkW` (Windows NTFS)
 * both fail atomically with `EEXIST` when `dst` exists (`EBUSY` on
 * Windows when `dst` is held open by another process, e.g. antivirus) — no
 * stat-then-rename TOCTOU race. Falling back to `fsp.rename` is unsafe
 * because POSIX `rename(2)` silently overwrites AND Node's Windows
 * `fs.rename` may also silently overwrite depending on the
 * `MOVEFILE_REPLACE_EXISTING` flag selection.
 *
 * Limitations:
 *   - POSIX: src and dst MUST be on the same filesystem (a state-root
 *     invariant — every caller composes paths from the same root).
 *   - Windows: requires NTFS (the daemon's state root is on the local
 *     disk; ReFS and FAT32 do not appear in supported deployments).
 *
 * Crash safety: a crash strictly between `link` and `unlink` (no chance
 * for the catch-block rollback below to run) leaves a hardlink pair (src
 * and dst point to the same inode). Boot recovery (Plan 07+) MUST
 * reconcile dual-presence — see `runtime/daemon/state-paths.md` §
 * Notes for the documented requirement (prefer the dst as the claim
 * winner's intent, unlink the src orphan).
 *
 * In-process unlink failure (e.g., AV lock on Windows, EACCES on src
 * after a successful link): the catch block below best-effort unlinks
 * `dst` to roll back the publish, so the caller observes a clean
 * "src exists, dst does not" failure state rather than dual-presence.
 * Rollback failures are swallowed; the original unlink error always
 * propagates so callers can classify (e.g., the CLAIM phase treats it
 * as "race lost" or surfaces it via the EBUSY/EPERM branch).
 *
 * Callers needing destructive replace-on-stale-dest semantics MUST use
 * `atomicRenameStaleDest` instead — see `runtime/daemon/state-paths.md`
 * for the per-caller classification audit.
 */
export async function atomicRename(src: string, dst: string): Promise<void> {
	await fsp.link(src, dst);
	try {
		await fsp.unlink(src);
	} catch (unlinkErr) {
		// link succeeded so dst was published, but the orphan-src removal
		// failed. Best-effort rollback: unlink dst so the caller observes
		// a clean failure (src still on disk, dst gone) instead of
		// dual-presence. Rollback errors are non-fatal — the original
		// unlink failure is what the caller needs to classify.
		await fsp.unlink(dst).catch(() => undefined);
		throw unlinkErr;
	}
}

/**
 * DESTRUCTIVE atomic rename across platforms — replaces `dst` if it exists.
 *
 * Use when the destination is by definition stale (e.g., the prior HWM
 * marker that we are deliberately replacing, or a per-taskId resolved
 * output whose only legitimate writer was already serialized upstream by
 * an owner-ID check). The "loser" of a rename race here was about to be
 * replaced anyway, so unlink-then-rename recovery is safe.
 *
 * Platform implementations:
 *   - POSIX: `rename(2)` overwrites the destination atomically (single
 *     syscall, no observable intermediate state).
 *   - Windows: Node's `fs.promises.rename` (libuv `uv_fs_rename`) DOES
 *     pass `MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED` on Node
 *     ≥ 14, so an ordinary overwrite is atomic. The recovery branch fires
 *     only when the destination handle is held by another process
 *     (sharing-violation surfacing as EEXIST/EPERM); the unlink-then-
 *     rename retry races the holder's release. This opens a small race
 *     window (acceptable for Phase 1; revisit in Phase 7 if strict
 *     atomicity under contention becomes a requirement). The window size
 *     is recorded via the `atomic-rename-stale-dest-window` telemetry
 *     event — read the counter as a **handle-contention signal** (not as
 *     a "Node bug" indicator), so a high count means "another process is
 *     fighting for this path" not "Windows rename is broken."
 *
 * Callers needing fail-on-EEXIST semantics MUST use `atomicRename`
 * (strict) instead — see `runtime/daemon/state-paths.md` for the
 * per-caller classification audit.
 */
export async function atomicRenameStaleDest(
	src: string,
	dst: string,
): Promise<void> {
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
		const windowStart = Date.now();
		await fsp.unlink(dst);
		await fsp.rename(src, dst);
		const windowMs = Date.now() - windowStart;
		// Fire-and-forget telemetry via dynamic import — breaks the static
		// module cycle between state-paths.ts (which needs path helpers) and
		// telemetry.ts (which needs pathFor). Dynamic import resolves after
		// both modules have finished loading so live-binding is safe.
		// emit() swallows its own write errors; the outer .catch() covers
		// any dynamic-import failure (e.g., module not found in tests).
		void import("./telemetry.js")
			.then(({ emit }) =>
				emit({
					kind: "atomic-rename-stale-dest-window",
					dst: path.basename(dst),
					windowMs,
					platform: "win32",
				}),
			)
			.catch(() => undefined);
	}
}
