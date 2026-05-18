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

export function loadSystemdCredentials(): void {
	const dir = process.env.CREDENTIALS_DIRECTORY;
	if (dir === undefined || dir.length === 0) return;

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
			continue;
		}
		const value = raw.trim();
		if (value.length === 0) continue;

		const existing = process.env[entry.envVar];
		if (existing !== undefined && existing.length > 0) {
			const lastWritten = lastWrittenByCredstore.get(entry.envVar);
			const isOurs = lastWritten !== undefined && existing === lastWritten;
			if (!isOurs) continue;
		}

		process.env[entry.envVar] = value;
		lastWrittenByCredstore.set(entry.envVar, value);
	}
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
