/**
 * Systemd credential bootstrap helper — Plan 01b Task 1.
 *
 * Reads files provisioned by systemd `LoadCredentialEncrypted=` (01a's
 * `provision-credentials.sh` + `iago-os-v2-daemon.service` unit) into
 * `process.env[<VAR>]` so the rest of the daemon (config loader,
 * Telegram bot, PR-triage agent's `gh` invocations, etc.) reads
 * credentials through the same env-var surface used for local-dev runs.
 *
 * Call order contract:
 *   - MUST run BEFORE `loadConfig()` in `startDaemon()` (wired in
 *     `runtime/daemon/main.ts`). Otherwise `loadConfig()` only sees
 *     credentials that were already exported in the systemd unit's
 *     `Environment=` — defeating the purpose of `LoadCredential=`.
 *   - Local-dev path is a no-op: when `process.env.CREDENTIALS_DIRECTORY`
 *     is unset (or empty), this returns immediately without touching
 *     env vars. Santiago can run the daemon locally with
 *     `IAGO_TELEGRAM_BOT_TOKEN=...` set directly in the shell and this
 *     helper does not interfere.
 *   - Env-var override path: if an env var is already set with a
 *     non-empty value AND that value did NOT come from a prior
 *     credstore load by this helper, the file value is NOT loaded
 *     (external env wins over credstore). This lets unit-test runs
 *     and one-off local overrides bypass systemd-provisioned values
 *     permanently, even across SIGHUP reloads.
 *   - Empty env-var values (`""`) are treated as not-set per spec:
 *     `process.env[envVar] !== undefined && process.env[envVar]!.length > 0`.
 *
 * Credential value handling contract (C2 carry-over):
 *   The value bytes flow from disk to `process.env` with no
 *   intermediate observable. This function NEVER logs the value to
 *   `console.log`, `console.error`, or any telemetry payload. Task 2
 *   test case 10 enforces this with a sentinel-value grep across
 *   telemetry buffers + stdout + stderr.
 *
 * Re-entrancy and reload semantics:
 *   Safe to call multiple times. Plan 06's SIGHUP credential-reload
 *   handler invokes this function on each `systemctl kill -s SIGHUP`
 *   so credstore rotations take effect without a daemon restart.
 *   Each invocation re-reads the credstore files. To support
 *   credential rotation, env vars that this helper previously
 *   populated are REPLACEABLE on reload — the helper tracks the last
 *   value it wrote per env var and rewrites when the file content
 *   changes (current env value still matches our last-written value).
 *   External overrides (env vars whose current value differs from
 *   what this helper last wrote, including values set before the
 *   first call) are preserved across reloads.
 *
 * Forward-notes for Plan 06 (SIGHUP credential-reload handler):
 *   - I1 (dual-review): the `credentialsLoaded` field on `main.ts`'s
 *     `cred-bootstrap-loaded` telemetry event is computed by diffing
 *     env-var keys-of-interest (before-unset && after-set). On cold
 *     boot this works because the before-set is always empty. On a
 *     SIGHUP-triggered reload where the env was already populated by
 *     a prior call, the diff returns `[]` — telemetry no longer
 *     reflects which credentials the helper actually replaced.
 *     Plan 06 should either change the criterion to `after !== before`
 *     (captures rotation) or have this helper return the list of file
 *     names it wrote on each call and pass that through to telemetry.
 *   - I2 (dual-review): the `lastWrittenByCredstore` map distinguishes
 *     credstore-sourced env vars from external overrides by tracking
 *     what we last wrote. If an env var was set externally to a value
 *     coincidentally equal to the credstore file contents on first
 *     boot, this helper treats it as external on every subsequent
 *     reload and the value never updates. Edge case in practice
 *     (operator would need to set systemd `Environment=` to the same
 *     literal as the credstore file). If Plan 06 surfaces this in the
 *     field, gate on "first invocation only" — track whether the
 *     helper has ever been called for this envVar in this process
 *     and on first sight accept the file value as ours regardless of
 *     match.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CredMap {
	readonly fileName: string;
	readonly envVar: string;
}

const CREDENTIALS: CredMap[] = [
	{ fileName: "iago-telegram-token", envVar: "IAGO_TELEGRAM_BOT_TOKEN" },
	{ fileName: "iago-gh-token", envVar: "GH_TOKEN" },
	// Phase 3 entries — provisioned at Phase 2 by 01a's
	// `provision-credentials.sh`, ACTIVATED at Phase 3 when the
	// claude-pty adapter wires `authProfile` → per-spawn
	// `ANTHROPIC_API_KEY` env override (see `config.ts` AgentConfig
	// `authProfile` field). Until then, leaving these commented out
	// prevents the env from being populated with Anthropic tokens
	// that no caller yet consumes.
	// { fileName: "iago-anthropic-default", envVar: "IAGO_ANTHROPIC_DEFAULT_TOKEN" },
	// { fileName: "iago-anthropic-ilsantino", envVar: "IAGO_ANTHROPIC_ILSANTINO_TOKEN" },
	// { fileName: "iago-anthropic-iaguito", envVar: "IAGO_ANTHROPIC_IAGUITO_TOKEN" },
];

/**
 * Per-env-var record of the last value this helper wrote to `process.env`.
 * Used to distinguish credstore-sourced env vars (replaceable on reload)
 * from external overrides (preserved). The current `process.env[envVar]`
 * value is considered "ours" only when it still matches the value we
 * last wrote; any external mutation since then is respected as an override.
 */
const lastWrittenByCredstore = new Map<string, string>();

/**
 * Loads credstore files into `process.env`. Returns `{ read, failed }`:
 * - `read` — env-var NAMES (NEVER values) that this call ACTUALLY READ from
 *   the credstore (regardless of whether the value changed or an external
 *   override caused the helper to leave `process.env` untouched). Plan 06's
 *   SIGHUP handler uses this set to scope its `credentialsReloaded` /
 *   `unchanged` partition — a name that was never read this invocation
 *   MUST NOT appear in either partition (Codex F8 fix).
 * - `failed` — env-var NAMES (NEVER values) whose credstore read failed with
 *   a non-ENOENT error (e.g., EACCES). ENOENT is intentionally NOT treated
 *   as failure: a missing credstore file means the credential is not
 *   provisioned on this host, which is a valid state during phased rollout.
 *   Plan 06's SIGHUP handler populates `cred-reload-fired.errors` from this.
 */
export function loadSystemdCredentials(): {
	read: readonly string[];
	failed: readonly string[];
} {
	const read: string[] = [];
	const failed: string[] = [];
	const dir = process.env.CREDENTIALS_DIRECTORY;
	if (dir === undefined || dir.length === 0) return { read, failed };

	for (const entry of CREDENTIALS) {
		const credPath = path.join(dir, entry.fileName);

		let raw: string;
		try {
			raw = fs.readFileSync(credPath, "utf8");
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code === "ENOENT") continue;
			// EACCES or unexpected error — emit structured message without value
			console.error(
				`[cred-bootstrap] failed to read ${entry.fileName}: ${code ?? String(err)}`,
			);
			failed.push(entry.envVar);
			continue;
		}
		const value = raw.trim();
		if (value.length === 0) continue;

		// File was readable and non-empty — record this envVar as actually read
		// this invocation, even if external-override precedence below prevents
		// us from writing to `process.env`. The SIGHUP handler needs to know
		// which names were genuinely consulted to scope `unchanged`.
		read.push(entry.envVar);

		const existing = process.env[entry.envVar];
		if (existing !== undefined && existing.length > 0) {
			const lastWritten = lastWrittenByCredstore.get(entry.envVar);
			const isOurs = lastWritten !== undefined && existing === lastWritten;
			if (!isOurs) continue;
		}

		process.env[entry.envVar] = value;
		lastWrittenByCredstore.set(entry.envVar, value);
	}
	return { read, failed };
}

/**
 * Test-only helper: clears the internal "last written by credstore"
 * tracking map. Vitest cases that exercise reload semantics call this
 * in `beforeEach` so module-level state does not leak across tests.
 * Not for production use.
 */
export function __resetCredstoreStateForTests(): void {
	lastWrittenByCredstore.clear();
}

/**
 * Returns the file names from the CREDENTIALS registry. Used by `main.ts`
 * to compute the `cred-bootstrap-loaded` telemetry event's
 * `credentialsLoaded` field by diffing env-var keys-of-interest before
 * and after `loadSystemdCredentials()`. Also used in tests.
 */
export function getCredentialFileNames(): readonly string[] {
	return CREDENTIALS.map((c) => c.fileName);
}

/**
 * Returns the env-var names from the CREDENTIALS registry. Used by
 * `main.ts` to compute the env-var keys-of-interest snapshot
 * before/after `loadSystemdCredentials()` for telemetry. Also used in tests.
 */
export function getCredentialEnvVars(): readonly string[] {
	return CREDENTIALS.map((c) => c.envVar);
}

/**
 * Maps a credential env-var name back to its file name for telemetry.
 * Used by `main.ts`. Returns `null` if the env var is not registered in
 * `CREDENTIALS`.
 */
export function envVarToFileName(envVar: string): string | null {
	for (const entry of CREDENTIALS) {
		if (entry.envVar === envVar) return entry.fileName;
	}
	return null;
}
