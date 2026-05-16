import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KNOWN_PATTERNS, parseStatusFromOutput } from "./prompt-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT_DIR = path.join(__dirname, "golden-transcripts");

function transcriptPath(scenario: string): string {
	return path.join(TRANSCRIPT_DIR, `claude-code-${scenario}.jsonl`);
}

function hasContent(file: string): boolean {
	try {
		return fs.statSync(file).size > 0;
	} catch {
		return false;
	}
}

interface TranscriptEvent {
	at: number;
	kind: "stdout" | "stderr" | "exit";
	data: string | number;
}

function loadTranscriptStdout(scenario: string): string[] {
	const file = transcriptPath(scenario);
	const raw = fs.readFileSync(file, "utf8");
	const out: string[] = [];
	for (const line of raw.split("\n")) {
		if (line.length === 0) continue;
		const ev = JSON.parse(line) as TranscriptEvent;
		if (
			(ev.kind === "stdout" || ev.kind === "stderr") &&
			typeof ev.data === "string"
		) {
			out.push(ev.data);
		}
	}
	return out;
}

describe("prompt-parser — golden transcript conformance", () => {
	const runningFile = transcriptPath("running");
	const idleFile = transcriptPath("idle");
	const exitedFile = transcriptPath("exited");

	it.skipIf(!hasContent(runningFile))(
		"matches running pattern against captured running transcript",
		() => {
			const chunks = loadTranscriptStdout("running");
			const result = parseStatusFromOutput(chunks);
			expect(result.status).toBe("running");
		},
	);

	it.skipIf(!hasContent(idleFile))(
		"matches idle pattern against captured idle transcript",
		() => {
			const chunks = loadTranscriptStdout("idle");
			const result = parseStatusFromOutput(chunks);
			expect(result.status).toBe("idle");
		},
	);

	it.skipIf(!hasContent(exitedFile))(
		"matches exited pattern against captured exited transcript",
		() => {
			const chunks = loadTranscriptStdout("exited");
			const result = parseStatusFromOutput(chunks);
			expect(result.status).toBe("exited");
		},
	);
});

describe("prompt-parser — fail-closed + invariants", () => {
	it("returns unknown for unrecognized output above the byte threshold", () => {
		const noise = "completely unrelated noise XYZ ".repeat(20);
		const result = parseStatusFromOutput([noise]);
		expect(result.status).toBe("unknown");
		expect(result.matchedPattern).toBeNull();
	});

	it("does not false-positive unknown on short whitespace input", () => {
		const result = parseStatusFromOutput(["   \n\t  "]);
		expect(result.status).not.toBe("unknown");
	});

	it("KNOWN_PATTERNS is non-empty and every entry has a non-empty description", () => {
		expect(KNOWN_PATTERNS.length).toBeGreaterThan(0);
		for (const pattern of KNOWN_PATTERNS) {
			expect(pattern.description.length).toBeGreaterThan(0);
		}
	});

	it("evaluates patterns in order: crashed beats idle when both could match", () => {
		const buffer = `Error: boom\n    at thing.ts:10:5\n\nHuman: `;
		const result = parseStatusFromOutput([buffer]);
		expect(result.status).toBe("crashed");
	});
});

describe("prompt-parser — synthetic inline fixtures (MC2)", () => {
	it("matches the running branch on a tool-execution marker", () => {
		const buffer = "thinking…\nRunning tool: Read(file.ts)\n";
		const result = parseStatusFromOutput([buffer]);
		expect(result.status).toBe("running");
	});

	it("matches the idle branch on a Human: prompt at end of buffer", () => {
		const buffer = "previous reply\n\nHuman: ";
		const result = parseStatusFromOutput([buffer]);
		expect(result.status).toBe("idle");
	});

	it("matches the exited branch on Session ended marker", () => {
		const buffer = "wrap-up text\nSession ended\n";
		const result = parseStatusFromOutput([buffer]);
		expect(result.status).toBe("exited");
	});
});

describe("prompt-parser — ANSI stripping (I4)", () => {
	// Startup banners from Claude Code's TUI contain ANSI color codes and
	// box-drawing sequences. Without stripping, these push the raw byte count
	// past FAIL_CLOSED_MIN_BYTES (100), triggering "unknown" before any seed
	// pattern can match, which would cause a daemon restart loop.

	it("does not count ANSI CSI sequences toward the fail-closed threshold", () => {
		// Build a string that is >100 raw bytes but only ~10 non-ANSI chars.
		// Each "\x1b[0m" is 4 bytes; 30 of them = 120 bytes of pure ANSI.
		const ansiPadding = "\x1b[0m".repeat(30);
		const payload = `${ansiPadding}hi\n`;
		// Raw byte length is well above 100; stripped non-whitespace is 2 ("hi").
		expect(payload.length).toBeGreaterThan(100);
		const result = parseStatusFromOutput([payload]);
		// Should stay below the fail-closed threshold → warm-up "idle", not "unknown".
		expect(result.status).toBe("idle");
	});

	it("strips OSC sequences (title-setting) before threshold check", () => {
		// OSC format: \x1b]...\x07 — used by terminals to set window title.
		const osc = "\x1b]0;Claude Code\x07".repeat(8); // 8 × ~17 bytes = 136 raw bytes
		const result = parseStatusFromOutput([osc]);
		expect(result.status).toBe("idle");
	});

	it("strips ANSI before pattern matching — idle prompt survives color codes", () => {
		// The idle regex matches "\nHuman: " at end of buffer. Wrapping the
		// prompt in color codes must not prevent the match.
		const buffer = "\x1b[32mprevious reply\x1b[0m\n\nHuman: ";
		const result = parseStatusFromOutput([buffer]);
		// Pattern matching operates on the raw buffer (not stripped), so the
		// idle regex must handle interleaved ANSI. This test documents current
		// behaviour: the idle regex matches the literal "\nHuman: " substring
		// which is present even with surrounding codes.
		expect(result.status).toBe("idle");
	});

	it("startup banner with only ANSI + whitespace stays below threshold", () => {
		// Simulates Claude Code's startup banner: lots of box-drawing ANSI,
		// very few printable chars (just the ASCII art border spaces).
		const banner = [
			"\x1b[2J\x1b[H", // clear screen + home
			"\x1b[1m\x1b[36m", // bold cyan
			"   \n   \n", // whitespace-only content
			"\x1b[0m", // reset
		].join("");
		const result = parseStatusFromOutput([banner]);
		expect(result.status).toBe("idle");
	});
});
