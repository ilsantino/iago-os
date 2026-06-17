/**
 * Regression guard for the Phase 2 evidence template + fixtures (Plan 05a).
 *
 * These assertions lock in the dual-adversarial review fixes (round 1):
 *
 *  - FALSE-GREEN MERGE GATE (Important x5): PHASE-2-EVIDENCE.md must NOT claim
 *    in present tense that `npm run check:evidence -- --phase 2` is a working
 *    Phase 2 gate. The on-disk `check-evidence.mjs` ignores argv, is hardcoded
 *    to PHASE-1-EVIDENCE.md, and greps the `PASTE-` sentinel — so running it
 *    today silently green-passes an empty Phase 2 template. The doc must
 *    down-state the `--phase` capability to a Plan-05b forward dependency. We
 *    assert that wherever the doc names the `--phase 2` command it is paired
 *    with an explicit "not yet wired / ships in Plan 05b / does NOT" caveat.
 *
 *  - BAD pr-triage SHELLCHECK GLOB (Important): block (a) must not instruct the
 *    operator to `shellcheck ... runtime/agents/pr-triage/*.sh` — that dir ships
 *    zero `.sh` files (TypeScript-only per Plan 04), so the glob errors non-zero
 *    and contradicts the documented "exit 0" expectation.
 *
 *  - STALE CASE COUNT (Minor): block (c) must not assert "all 10 cutover
 *    dry-run cases" — test-cutover.mjs has grown past 10 cases.
 *
 *  - FIXTURE QUALITY (Minor): the heartbeat fixture entry must not carry a
 *    literal 1440 floor that contradicts its own note; the systemd-analyze
 *    sample must not duplicate a directive row.
 *
 * Run from `runtime/`: npx vitest run integration/phase-2-evidence-template.test.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(here, "..");

const phase2 = readFileSync(
	resolve(runtimeRoot, "PHASE-2-EVIDENCE.md"),
	"utf8",
);
const phase1 = readFileSync(
	resolve(runtimeRoot, "PHASE-1-EVIDENCE.md"),
	"utf8",
);
const expectedEvents = JSON.parse(
	readFileSync(
		resolve(runtimeRoot, "integration/phase-2-vps.fixtures/expected-events.json"),
		"utf8",
	),
);
const securitySample = readFileSync(
	resolve(
		runtimeRoot,
		"integration/phase-2-vps.fixtures/security-analyze-sample.txt",
	),
	"utf8",
);

/** Split a markdown doc into paragraph-ish blocks for "claim + caveat in the same breath" checks. */
function paragraphsMentioning(doc: string, needle: string): string[] {
	return doc.split(/\n\s*\n/).filter((block) => block.includes(needle));
}

describe("PHASE-2-EVIDENCE.md — false-green merge-gate guard", () => {
	it("never presents `--phase 2` as an already-working gate without a not-yet-wired caveat", () => {
		const blocks = paragraphsMentioning(phase2, "--phase 2");
		expect(blocks.length).toBeGreaterThan(0);
		// Every block that names the command must, in the same block, flag that
		// the current checker does NOT support it yet (forward dependency on 05b).
		const caveat =
			/(not yet wired|NOT YET WIRED|does NOT|do NOT rely|will be|will enforce|ships in Plan 05b)/;
		for (const block of blocks) {
			expect(
				caveat.test(block),
				`A block mentioning "--phase 2" lacks a not-yet-wired caveat:\n${block}`,
			).toBe(true);
		}
	});

	it("states the current check-evidence.mjs is hardcoded to Phase 1 / PASTE- sentinel", () => {
		// The doc must disclose the actual current behavior so a reviewer is not
		// misled into trusting the command before 05b lands.
		expect(phase2).toMatch(/hardcoded to .*PHASE-1-EVIDENCE\.md/);
		expect(phase2).toMatch(/PASTE-/);
	});
});

describe("PHASE-2-EVIDENCE.md — block (a) shellcheck target", () => {
	it("does not shellcheck the non-existent pr-triage/*.sh glob", () => {
		expect(phase2).not.toContain("runtime/agents/pr-triage/*.sh");
	});

	it("still shellchecks the real deploy/*.sh target", () => {
		expect(phase2).toContain("shellcheck runtime/deploy/*.sh");
	});
});

describe("PHASE-2-EVIDENCE.md — block (c) cutover case count", () => {
	it("does not assert the stale 'all 10 cutover dry-run cases' figure", () => {
		expect(phase2).not.toContain("all 10 cutover dry-run cases");
	});
});

describe("PHASE-1-EVIDENCE.md — forward link tense", () => {
	it("does not claim the current checker already supports both phases", () => {
		// The old wording: "supports both phases via the `--phase` flag" — a false
		// present-tense capability claim. Must be future / forward-dependency.
		expect(phase1).not.toMatch(
			/supports both phases via the\s+`?--phase`?\s+flag/,
		);
	});
});

describe("expected-events.json — heartbeat floor", () => {
	type EventEntry = {
		kind: string;
		expected_count_per_24h: number;
		floor_applies?: boolean;
	};
	const heartbeat = (expectedEvents as EventEntry[]).find(
		(e) => e.kind === "heartbeat",
	);

	it("does not carry an impossible 1440 per-24h floor", () => {
		expect(heartbeat).toBeDefined();
		// The note says the daemon does NOT emit one line per 60s tick; the
		// structured field must agree (0) and mark the floor as inapplicable.
		expect(heartbeat?.expected_count_per_24h).toBe(0);
		expect(heartbeat?.floor_applies).toBe(false);
	});
});

describe("security-analyze-sample.txt — fixture realism", () => {
	it("does not duplicate a directive row", () => {
		const directiveLines = securitySample
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.includes("=") && l.startsWith("✓"))
			.map((l) => l.split("=")[0]);
		const unique = new Set(directiveLines);
		expect(unique.size).toBe(directiveLines.length);
	});

	it("still exposes the score line the 05b --strict regex parses", () => {
		const regex =
			/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|EXPOSED|MEDIUM|OK|SAFE)/m;
		expect(regex.test(securitySample)).toBe(true);
	});
});
