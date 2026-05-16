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
