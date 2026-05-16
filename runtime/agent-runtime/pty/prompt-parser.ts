/**
 * Prompt / status parser for the Shape 1 PTY Claude adapter.
 *
 * Fail-closed means we trigger restart rather than guessing the agent's
 * state. Adding patterns requires capturing a fresh golden transcript and
 * verifying the pattern matches it via the test suite. The 100-byte
 * fail-closed threshold is empirical (M1) — adjust if Claude emits
 * larger intermediate states without a recognized marker.
 *
 * Buffer ownership (Plan 04 stress-test EC1): this module is pure — it
 * does NOT retain history across calls. The caller (`claude-pty.ts`)
 * truncates its `outputBuffer` to the last 4 KB on every `onData` and
 * passes the slice in. `parseStatusFromOutput` only matches what is
 * handed to it.
 */

import type { StatusValue } from "../types.js";

export interface KnownPattern {
	readonly status: StatusValue;
	readonly regex: RegExp;
	readonly description: string;
}

export interface ParseResult {
	readonly status: StatusValue;
	readonly matchedPattern: string | null;
}

const FAIL_CLOSED_MIN_BYTES = 100;

/**
 * Patterns evaluated in array order; first match wins. Order matters —
 * `crashed` is checked before `idle` so a buffer containing both signals
 * routes to the failure path rather than misclassifying as ready.
 *
 * Seed regexes are conservative best-guesses against Claude Code 2.1.x
 * output. Refine when golden transcripts are captured (see
 * `golden-transcripts/README.md`); the conformance tests in
 * `prompt-parser.test.ts` will surface drift.
 */
export const KNOWN_PATTERNS: ReadonlyArray<KnownPattern> = [
	{
		status: "crashed",
		regex: /Error:\s.+\n\s+at\s/,
		description: "Node-style stack trace following an Error: line",
	},
	{
		status: "exited",
		regex: /Session ended|process exited|\[exit\sCode:\s\d+\]/i,
		description: "Claude session-end marker or PTY exit-code line",
	},
	{
		status: "running",
		regex: /Running tool:|⏵\s|tool_use:|Calling\s\w+\(/i,
		description: "Tool-execution marker emitted while Claude is busy",
	},
	{
		status: "idle",
		regex: /\nHuman:\s*$|\n>\s*$|^Human:\s*$/,
		description: "Claude REPL prompt awaiting user input at end of buffer",
	},
];

function countNonWhitespaceBytes(buffer: string): number {
	let count = 0;
	for (let i = 0; i < buffer.length; i++) {
		const ch = buffer.charCodeAt(i);
		// Skip ASCII whitespace: space (32), tab (9), newline (10),
		// carriage return (13), form feed (12), vertical tab (11).
		if (
			ch !== 32 &&
			ch !== 9 &&
			ch !== 10 &&
			ch !== 13 &&
			ch !== 12 &&
			ch !== 11
		) {
			count++;
		}
	}
	return count;
}

export function parseStatusFromOutput(chunks: string[]): ParseResult {
	const buffer = chunks.join("");

	for (const pattern of KNOWN_PATTERNS) {
		if (pattern.regex.test(buffer)) {
			return { status: pattern.status, matchedPattern: pattern.description };
		}
	}

	if (countNonWhitespaceBytes(buffer) > FAIL_CLOSED_MIN_BYTES) {
		return { status: "unknown", matchedPattern: null };
	}

	// Below the fail-closed threshold (mostly whitespace or short banner) —
	// treat as still-warming-up, not crashed. The caller (claude-pty.ts)
	// retains the previous status until a real signal arrives.
	return { status: "idle", matchedPattern: null };
}
