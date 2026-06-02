/**
 * R1 (feature-pr84-r1-daemon-creds, D1 — agents never hold long-lived secrets)
 * — shared, secret-free runtime-env composition for daemon-spawned subprocesses.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the non-secret runtime
 * allowlist. It lives apart from `main.ts` because `main.ts` imports
 * `cron-scheduler.ts`; if the allowlist (and its `composeRuntimeEnv` helper)
 * stayed in `main.ts`, `cron-scheduler.ts` could not consume it without a
 * circular import. `main.ts` re-exports `CRON_AGENT_RUNTIME_ALLOWLIST` for
 * back-compat and both `composeCronAgentEnv` (main.ts) and `runWakeCheck`
 * (cron-scheduler.ts) build their child env via `composeRuntimeEnv` here.
 *
 * The pr-triage agent NO LONGER holds any secret: the daemon fetches the PRs
 * (holding `GH_TOKEN` in its own process) and sends the Telegram summary
 * itself (holding `IAGO_TELEGRAM_BOT_TOKEN`). The agent is a pure data-in →
 * text-out transform — it makes no network call and reads no token. So there is
 * NO secret-injection allowlist anymore (the former `CRON_AGENT_ENV_ALLOWLIST`
 * of `IAGO_TELEGRAM_BOT_TOKEN` / `IAGO_TELEGRAM_ALLOWED_USER_IDS` / `GH_TOKEN`
 * is DELETED).
 *
 * node-pty REPLACES (does not merge) the parent env when `env` is supplied
 * (claude-pty.ts spawnInternal — the deliberate CRITICAL #1 multi-tenant
 * isolation invariant). So a cron agent whose composed env carries ONLY a
 * state-root gets a shell with no `PATH`/`HOME`/`SHELL`/`LANG` and cannot
 * resolve the `claude` binary or basic shell utilities. These are NON-SECRET
 * runtime descriptors (search path, home dir, login shell, locale): forwarding
 * them leaks no credential and exposes nothing a local shell could not already
 * discover.
 *
 * `LC_ALL`/`XDG_*` are intentionally omitted — `LANG` covers locale for the
 * shell utilities the agent invokes, and adding `XDG_*` would forward more of
 * the daemon's home-dir layout than the agent needs. Extend this list only with
 * a documented runtime need.
 */
export const CRON_AGENT_RUNTIME_ALLOWLIST: readonly string[] = [
	"PATH",
	"HOME",
	"SHELL",
	"LANG",
	// FIX D (R1 dual-adversarial Minor) — the result-envelope rendezvous dir.
	// The cron agent writes its `pr-triage-send__*.json` envelope under
	// `$IAGO_DAEMON_STATE_ROOT/tasks/pending/`, and the daemon polls its OWN
	// resolved `IAGO_DAEMON_STATE_ROOT`. Overlaying the daemon's value (non-secret
	// config, present in the production systemd `Environment=`) onto the agent env
	// keeps the two in lockstep so a notification can't be silently written to a
	// directory the daemon never reads. Non-secret: a state-dir path, no credential.
	"IAGO_DAEMON_STATE_ROOT",
];

/**
 * R1 (feature-pr84-r1-daemon-creds) — pure runtime-env composer. Returns a
 * fresh object containing ONLY the `CRON_AGENT_RUNTIME_ALLOWLIST` keys that are
 * present (non-empty string) in `source`. Absent/empty values are skipped so we
 * never materialize empty-string env entries.
 *
 * CRITICAL SECURITY PROPERTY (D1): NO secret is EVER copied. Any
 * `IAGO_TELEGRAM_BOT_TOKEN` / `GH_TOKEN` / `IAGO_TELEGRAM_ALLOWED_USER_IDS`
 * present in `source` is NOT copied because it is not in the allowlist. This is
 * the scrubbed env handed to any daemon-spawned bash/PTY subprocess (the cron
 * agent PTY and the back-compat wake-check), so a secret can never leak into a
 * child process via the daemon's own `process.env`.
 */
export function composeRuntimeEnv(
	source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const composed: NodeJS.ProcessEnv = {};
	for (const key of CRON_AGENT_RUNTIME_ALLOWLIST) {
		const value = source[key];
		if (typeof value === "string" && value.length > 0) {
			composed[key] = value;
		}
	}
	return composed;
}
